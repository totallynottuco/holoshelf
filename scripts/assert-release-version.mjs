import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));
const version = String(packageJson.version ?? "").trim();
const tagName = process.env.GITHUB_REF_TYPE === "tag" ? process.env.GITHUB_REF_NAME : "";
const publishConfig = Array.isArray(packageJson.build?.publish) ? packageJson.build.publish[0] : packageJson.build?.publish;

function fail(message) {
  throw new Error(`Release version check failed: ${message}`);
}

if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  fail(`package.json version must be SemVer, got "${version}"`);
}

if (tagName && tagName !== `v${version}`) {
  fail(`Git tag "${tagName}" must match package.json version "v${version}"`);
}

if (process.env.GITHUB_ACTIONS === "true" && tagName) {
  if (!publishConfig || publishConfig.provider !== "github") {
    fail("tag releases must use the GitHub publish provider");
  }

  const owner = String(publishConfig.owner ?? "");
  const repo = String(publishConfig.repo ?? "");
  if (!owner || owner.includes("REPLACE_WITH") || !repo || repo.includes("REPLACE_WITH")) {
    fail("tag releases must patch a real GitHub owner/repo before building");
  }

  if (publishConfig.releaseType !== "release") {
    fail(`tag releases must publish a non-draft GitHub Release, got "${publishConfig.releaseType ?? "missing"}"`);
  }
}

console.log(`Release version check passed for v${version}${tagName ? ` (${tagName})` : ""}.`);
