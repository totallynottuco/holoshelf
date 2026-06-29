import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const releaseDirectory = path.join(projectRoot, "release");
const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));
const version = packageJson.version;

function fail(message) {
  throw new Error(`Release artifact check failed: ${message}`);
}

function exists(relativePath) {
  return fs.existsSync(path.join(releaseDirectory, relativePath));
}

function listFiles(directory) {
  if (!fs.existsSync(directory)) {
    return [];
  }

  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFiles(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

if (!fs.existsSync(releaseDirectory)) {
  fail("release/ does not exist");
}

const setupFileName = `Holoshelf-Setup-${version}.exe`;
if (!exists(setupFileName)) {
  fail(`${setupFileName} is missing`);
}

if (!exists(`${setupFileName}.blockmap`)) {
  fail(`${setupFileName}.blockmap is missing`);
}

if (!exists("latest.yml")) {
  fail("latest.yml is missing");
}

if (!exists(path.join("win-unpacked", "Holoshelf.exe"))) {
  fail("release/win-unpacked/Holoshelf.exe is missing");
}

const files = listFiles(releaseDirectory);
const portableArtifacts = files.filter((file) => path.basename(file).startsWith("Holoshelf-Portable-"));
if (portableArtifacts.length > 0) {
  fail(`portable artifacts are present: ${portableArtifacts.map((file) => path.relative(releaseDirectory, file)).join(", ")}`);
}

const packagedLooseKeys = files.filter((file) => /(?:^|[-_.])api[-_.]?key(?:[-_.]|$)/i.test(path.basename(file)));
if (packagedLooseKeys.length > 0) {
  fail(`loose API credential artifact was packaged: ${packagedLooseKeys.map((file) => path.relative(releaseDirectory, file)).join(", ")}`);
}

console.log(`Release artifact check passed for Holoshelf ${version}.`);
