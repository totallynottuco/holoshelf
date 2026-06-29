import type { App } from "electron";
import fs from "node:fs";
import path from "node:path";

export interface AppPathSet {
  dataDirectory: string;
  databasePath: string;
  backupDirectory: string;
  coversDirectory: string;
  hololiveImageDirectory: string;
  seedDirectory: string | null;
  legacyHololiveIconDirectory: string;
  legacyDataDirectories: string[];
  dataLocationKind: "appData" | "dev" | "custom";
}

function uniquePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const candidate of paths) {
    const normalized = path.resolve(candidate).toLowerCase();
    if (!seen.has(normalized)) {
      seen.add(normalized);
      result.push(candidate);
    }
  }

  return result;
}

function resolvePackagedLegacyDataDirectories(electronApp: App): string[] {
  const legacyDataDirectories: string[] = [];
  const executableDirectory = path.dirname(electronApp.getPath("exe"));
  const executableSiblingData = path.join(executableDirectory, "data");

  if (path.basename(executableDirectory).toLowerCase() === "win-unpacked") {
    const releaseDirectory = path.dirname(executableDirectory);
    const projectDirectory = path.dirname(releaseDirectory);
    legacyDataDirectories.push(path.join(releaseDirectory, "data"));
    legacyDataDirectories.push(executableSiblingData);
    legacyDataDirectories.push(path.join(projectDirectory, "data"));
  } else {
    legacyDataDirectories.push(executableSiblingData);
  }

  legacyDataDirectories.push(path.join(process.cwd(), "data"));

  return uniquePaths(legacyDataDirectories);
}

function assertSafePackagedDataDirectory(rootDirectory: string): void {
  const forbiddenSegments = new Set(["release", "dist", "dist-electron", "node_modules"]);
  const segments = path
    .resolve(rootDirectory)
    .split(/[\\/]+/)
    .map((segment) => segment.toLowerCase())
    .filter(Boolean);
  const forbiddenSegment = segments.find((segment) => forbiddenSegments.has(segment));

  if (forbiddenSegment) {
    throw new Error(
      `Refusing to use build-owned Holoshelf data directory "${rootDirectory}" because it contains "${forbiddenSegment}".`
    );
  }
}

function resolveSeedDirectory(electronApp: App): string {
  if (electronApp.isPackaged) {
    return path.join(process.resourcesPath ?? path.join(path.dirname(electronApp.getPath("exe")), "resources"), "seed");
  }

  return path.join(process.cwd(), "resources", "seed");
}

export function getAppPaths(electronApp: App): AppPathSet {
  const customDataDirectory = process.env.HOLOSHELF_DATA_DIR?.trim();
  const dataLocationKind: AppPathSet["dataLocationKind"] = customDataDirectory
    ? "custom"
    : electronApp.isPackaged
      ? "appData"
      : "dev";
  const rootDirectory = customDataDirectory
    ? path.resolve(customDataDirectory)
    : electronApp.isPackaged
      ? path.join(electronApp.getPath("userData"), "data")
      : path.join(process.cwd(), "data");
  const legacyDataDirectories =
    electronApp.isPackaged && !customDataDirectory ? resolvePackagedLegacyDataDirectories(electronApp) : [];

  if (electronApp.isPackaged) {
    assertSafePackagedDataDirectory(rootDirectory);
  }

  return {
    dataDirectory: rootDirectory,
    databasePath: path.join(rootDirectory, "holoshelf.sqlite"),
    backupDirectory: path.join(rootDirectory, "backups"),
    coversDirectory: path.join(rootDirectory, "covers"),
    hololiveImageDirectory: path.join(rootDirectory, "images", "hololive"),
    seedDirectory: resolveSeedDirectory(electronApp),
    legacyHololiveIconDirectory: path.join(rootDirectory, "icons", "hololive"),
    legacyDataDirectories: uniquePaths(legacyDataDirectories),
    dataLocationKind
  };
}

function copyMissingDirectoryEntries(sourceDirectory: string, targetDirectory: string): void {
  if (!fs.existsSync(sourceDirectory)) {
    return;
  }

  fs.mkdirSync(targetDirectory, { recursive: true });

  for (const entry of fs.readdirSync(sourceDirectory, { withFileTypes: true })) {
    const source = path.join(sourceDirectory, entry.name);
    const target = path.join(targetDirectory, entry.name);

    if (entry.isDirectory()) {
      copyMissingDirectoryEntries(source, target);
      continue;
    }

    if (entry.isFile() && !fs.existsSync(target)) {
      fs.copyFileSync(source, target);
    }
  }
}

function migrateLegacyDataDirectory(paths: AppPathSet): void {
  if (fs.existsSync(paths.databasePath)) {
    return;
  }

  for (const legacyDirectory of paths.legacyDataDirectories) {
    if (path.resolve(legacyDirectory).toLowerCase() === path.resolve(paths.dataDirectory).toLowerCase()) {
      continue;
    }

    const legacyDatabasePath = path.join(legacyDirectory, "holoshelf.sqlite");
    if (fs.existsSync(legacyDatabasePath)) {
      copyMissingDirectoryEntries(legacyDirectory, paths.dataDirectory);
      return;
    }
  }
}

function copySeedData(paths: AppPathSet): void {
  if (!paths.seedDirectory || fs.existsSync(paths.databasePath)) {
    return;
  }

  const seedDatabasePath = path.join(paths.seedDirectory, "holoshelf-template.sqlite");
  if (!fs.existsSync(seedDatabasePath)) {
    return;
  }

  fs.mkdirSync(paths.dataDirectory, { recursive: true });
  fs.copyFileSync(seedDatabasePath, paths.databasePath);
  copyMissingDirectoryEntries(path.join(paths.seedDirectory, "images", "hololive"), paths.hololiveImageDirectory);
  copyMissingDirectoryEntries(path.join(paths.seedDirectory, "holodex-refresh"), path.join(paths.dataDirectory, "holodex-refresh"));
}

export function ensureAppPaths(paths: AppPathSet): void {
  migrateLegacyDataDirectory(paths);
  copySeedData(paths);
  fs.mkdirSync(paths.dataDirectory, { recursive: true });
  fs.mkdirSync(paths.coversDirectory, { recursive: true });
  fs.mkdirSync(paths.hololiveImageDirectory, { recursive: true });

  if (fs.existsSync(paths.legacyHololiveIconDirectory)) {
    for (const entry of fs.readdirSync(paths.legacyHololiveIconDirectory, { withFileTypes: true })) {
      if (!entry.isFile()) {
        continue;
      }

      const source = path.join(paths.legacyHololiveIconDirectory, entry.name);
      const target = path.join(paths.hololiveImageDirectory, entry.name);
      if (!fs.existsSync(target)) {
        fs.copyFileSync(source, target);
      }
    }

    fs.rmSync(paths.legacyHololiveIconDirectory, { recursive: true, force: true });

    const legacyParent = path.dirname(paths.legacyHololiveIconDirectory);
    if (fs.existsSync(legacyParent) && fs.readdirSync(legacyParent).length === 0) {
      fs.rmdirSync(legacyParent);
    }
  }
}
