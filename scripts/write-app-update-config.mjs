import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import packageJson from "../package.json" with { type: "json" };

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const resourcesDirectory = path.join(projectRoot, "release", "win-unpacked", "resources");
const publishConfig = Array.isArray(packageJson.build?.publish) ? packageJson.build.publish[0] : packageJson.build?.publish;

if (!publishConfig || publishConfig.provider !== "github") {
  throw new Error("Holoshelf update config requires a GitHub publish provider in package.json.");
}

const owner = String(publishConfig.owner ?? "").trim();
const repo = String(publishConfig.repo ?? "").trim();

if (!owner || !repo) {
  throw new Error("Holoshelf update config requires GitHub owner and repo values.");
}

fs.mkdirSync(resourcesDirectory, { recursive: true });
fs.writeFileSync(
  path.join(resourcesDirectory, "app-update.yml"),
  [
    `owner: ${owner}`,
    `repo: ${repo}`,
    "provider: github",
    `releaseType: ${publishConfig.releaseType ?? "draft"}`,
    "updaterCacheDirName: holoshelf-updater",
    ""
  ].join("\n"),
  "utf8"
);

console.log(`Wrote ${path.join(resourcesDirectory, "app-update.yml")}`);
