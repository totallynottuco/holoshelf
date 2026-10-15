import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

function manifest(directory: string): { schema: number; version: string; seedDatabase: string } {
  const value = JSON.parse(fs.readFileSync(path.join(directory, "official-data.json"), "utf8"));
  if (value.schema !== 1 || typeof value.version !== "string" || !value.version.trim() ||
    value.seedDatabase !== "holoshelf-template.sqlite") {
    throw new Error(`Unsupported official data manifest: ${directory}`);
  }
  const header = Buffer.alloc(16);
  const handle = fs.openSync(path.join(directory, value.seedDatabase), "r");
  try { fs.readSync(handle, header); } finally { fs.closeSync(handle); }
  if (header.toString() !== "SQLite format 3\0") { throw new Error("Seed database is not a SQLite file"); }
  return value;
}

function files(directory: string, prefix = ""): string[] {
  return fs.readdirSync(path.join(directory, prefix), { withFileTypes: true }).flatMap((entry) => {
    if (entry.isSymbolicLink()) { throw new Error(`Seed contains a symbolic link: ${entry.name}`); }
    const relativePath = path.join(prefix, entry.name);
    return entry.isDirectory() ? files(directory, relativePath) : entry.isFile() ? [relativePath] : [];
  }).sort();
}

function hash(file: string): string {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function restoreDatabase(backup: string, target: string): void {
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    fs.copyFileSync(backup, temporary);
    fs.renameSync(temporary, target);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

// The caller closes the installed app first. Verification must finish before old
// seed files or the personal database snapshot are discarded.
export async function applyInstalledSeedUpdate(options: {
  sourceDirectory: string;
  installedDirectory: string;
  databasePath: string;
  verify: () => Promise<void>;
  stopApp: () => Promise<void>;
  log?: (message: string) => void;
}): Promise<{ version: string; copiedFiles: number; linkedFiles: number; copiedBytes: number }> {
  const source = path.resolve(options.sourceDirectory);
  const target = path.resolve(options.installedDirectory);
  if (path.basename(target).toLowerCase() !== "seed" || source.toLowerCase() === target.toLowerCase() ||
    fs.lstatSync(source).isSymbolicLink() || fs.lstatSync(target).isSymbolicLink()) {
    throw new Error("Choose separate source and installed seed directories");
  }
  const nextManifest = manifest(source);
  const previousManifest = manifest(target);
  if (new Intl.Collator(undefined, { numeric: true, sensitivity: "base" }).compare(nextManifest.version, previousManifest.version) < 0) {
    throw new Error("The bundled seed is older than the installed data. Refresh release data first.");
  }
  const targetFiles = new Set(files(target));
  const sourceFiles = files(source);
  const parent = path.dirname(target);
  const transaction = fs.mkdtempSync(path.join(parent, ".seed-update-"));
  // All recursively removed paths are this newly created child of resources.
  const stage = path.join(transaction, "next");
  const previous = path.join(transaction, "previous");
  const personalBackup = path.join(transaction, "personal.sqlite");
  const databaseExisted = fs.existsSync(options.databasePath);
  let previousMoved = false;
  let nextMoved = false;
  let copiedFiles = 0;
  let linkedFiles = 0;
  let copiedBytes = 0;
  let mayCleanUp = false;

  try {
    if (databaseExisted) { fs.copyFileSync(options.databasePath, personalBackup); }
    fs.mkdirSync(stage);
    for (const relativePath of sourceFiles) {
      const input = path.join(source, relativePath);
      const current = path.join(target, relativePath);
      const output = path.join(stage, relativePath);
      fs.mkdirSync(path.dirname(output), { recursive: true });
      if (targetFiles.has(relativePath) && fs.statSync(input).size === fs.statSync(current).size && hash(input) === hash(current)) {
        try {
          // Immutable unchanged files can share disk blocks until the old seed
          // is removed. Unsupported filesystems simply fall back to copying.
          fs.linkSync(current, output);
          linkedFiles += 1;
          continue;
        } catch { /* copy fallback */ }
      }
      fs.copyFileSync(input, output);
      copiedFiles += 1;
      copiedBytes += fs.statSync(input).size;
    }
    manifest(stage);
    fs.renameSync(target, previous);
    previousMoved = true;
    fs.renameSync(stage, target);
    nextMoved = true;
    await options.verify();
    mayCleanUp = true;
    options.log?.(`Applied official data ${nextManifest.version}: ${copiedFiles} copied, ${linkedFiles} unchanged files reused`);
    return { version: nextManifest.version, copiedFiles, linkedFiles, copiedBytes };
  } catch (error) {
    if (previousMoved) {
      try {
        await options.stopApp();
        if (nextMoved) { fs.renameSync(target, path.join(transaction, "failed")); }
        fs.renameSync(previous, target);
        if (databaseExisted) { restoreDatabase(personalBackup, options.databasePath); }
        else { fs.rmSync(options.databasePath, { force: true }); }
        mayCleanUp = true;
        options.log?.("Restored the previous installed seed and personal database after verification failed");
      } catch (rollbackError) {
        throw new Error(`Data update failed and automatic restoration failed. Recovery files: ${transaction}`, {
          cause: new AggregateError([error, rollbackError])
        });
      }
    } else {
      mayCleanUp = true;
    }
    throw error;
  } finally {
    if (mayCleanUp) {
      try { fs.rmSync(transaction, { recursive: true, force: true }); }
      catch { options.log?.(`Temporary update files remain at ${transaction}`); }
    }
  }
}
