import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));
const version = String(packageJson.version ?? "").trim();
const tagName = process.env.GITHUB_REF_TYPE === "tag" ? process.env.GITHUB_REF_NAME : `v${version}`;
const repoFullName = process.env.GITHUB_REPOSITORY || parseRepoFullName(packageJson);

function fail(message) {
  throw new Error(`Published release verification failed: ${message}`);
}

function parseRepoFullName(packageJson) {
  const repository = typeof packageJson.repository === "string" ? packageJson.repository : packageJson.repository?.url;
  const match = String(repository ?? "").match(/github\.com[:/](?<owner>[^/]+)\/(?<repo>[^/.]+)(?:\.git)?/i);
  if (!match?.groups) {
    fail("package.json repository must point at a GitHub repo");
  }
  return `${match.groups.owner}/${match.groups.repo}`;
}

async function fetchRelease() {
  const headers = {
    "User-Agent": "Holoshelf release verifier",
    Accept: "application/vnd.github+json"
  };
  if (process.env.GH_TOKEN || process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GH_TOKEN || process.env.GITHUB_TOKEN}`;
  }
  const response = await fetch(`https://api.github.com/repos/${repoFullName}/releases/tags/${tagName}`, { headers });
  if (!response.ok) {
    return null;
  }
  return response.json();
}

if (process.env.GITHUB_ACTIONS === "true" && process.env.GITHUB_REF_TYPE !== "tag") {
  console.log("Skipping published release verification for non-tag workflow run.");
  process.exit(0);
}

const deadline = Date.now() + 120_000;
let release = null;
while (Date.now() < deadline) {
  release = await fetchRelease();
  if (release) {
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, 5_000));
}

if (!release) {
  fail(`${tagName} does not exist on ${repoFullName}`);
}
if (release.draft) {
  fail(`${tagName} is still a draft release`);
}

const assetNames = Array.isArray(release.assets) ? release.assets.map((asset) => String(asset.name ?? "")) : [];
const hasInstaller = assetNames.some((name) => /^Holoshelf-Setup-.*\.exe$/i.test(name));
const hasBlockmap = assetNames.some((name) => /^Holoshelf-Setup-.*\.exe\.blockmap$/i.test(name));
const hasLatest = assetNames.includes("latest.yml");

if (!hasInstaller || !hasBlockmap || !hasLatest) {
  fail(`missing release assets for ${tagName}. Found: ${assetNames.join(", ") || "none"}`);
}

console.log(`Published release verified: ${release.html_url}`);
