import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rcedit } from "rcedit";
import packageJson from "../package.json" with { type: "json" };

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const exePath = path.join(projectRoot, "release", "win-unpacked", "Holoshelf.exe");
const iconPath = path.join(projectRoot, "icon.ico");
const windowsVersion = toWindowsVersion(packageJson.version);

if (!fs.existsSync(exePath)) {
  throw new Error(`Executable not found: ${exePath}`);
}

if (!fs.existsSync(iconPath)) {
  throw new Error(`Icon not found: ${iconPath}`);
}

await rcedit(exePath, {
  icon: iconPath,
  "file-version": windowsVersion,
  "product-version": windowsVersion,
  "requested-execution-level": "asInvoker",
  "version-string": {
    FileDescription: "Holoshelf",
    ProductName: "Holoshelf",
    InternalName: "Holoshelf",
    OriginalFilename: "Holoshelf.exe",
    CompanyName: "Holoshelf contributors",
    LegalCopyright: "Copyright (c) 2026 Holoshelf contributors"
  }
});

console.log(`Applied Windows resources to ${exePath}`);

function toWindowsVersion(version) {
  const parts = version.split(".").map((part) => Number.parseInt(part, 10) || 0);
  while (parts.length < 4) {
    parts.push(0);
  }

  return parts.slice(0, 4).join(".");
}
