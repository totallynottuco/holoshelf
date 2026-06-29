import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const targets = [
  "dist",
  "dist-electron",
  "release",
  "test-results",
  "playwright-report",
  "dev-server.log",
  "holoshelf.log",
  path.join("data", "backups"),
  path.join("data", "covers")
];

function resolveProjectPath(targetPath) {
  const resolved = path.resolve(projectRoot, targetPath);
  const relative = path.relative(projectRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Refusing to remove path outside project: ${resolved}`);
  }
  return resolved;
}

const removed = [];
const skipped = [];
for (const target of targets) {
  const resolved = resolveProjectPath(target);
  if (!fs.existsSync(resolved)) {
    continue;
  }

  try {
    fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    removed.push(path.relative(projectRoot, resolved) || ".");
  } catch (error) {
    skipped.push({
      target: path.relative(projectRoot, resolved) || ".",
      reason: error instanceof Error ? error.message : String(error)
    });
  }
}

if (removed.length === 0) {
  console.log("No generated artifacts to clean.");
} else {
  console.log(`Removed generated artifacts:\n${removed.map((entry) => `- ${entry}`).join("\n")}`);
}

if (skipped.length > 0) {
  console.warn(
    `Skipped locked/unremovable generated artifacts:\n${skipped
      .map((entry) => `- ${entry.target}: ${entry.reason}`)
      .join("\n")}`
  );
}
