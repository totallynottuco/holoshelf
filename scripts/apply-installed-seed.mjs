import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { applyInstalledSeedUpdate } = require("../dist-electron/electron/services/installedSeedUpdate.js");
const installedExe = process.argv.find((arg) => arg.startsWith("--installed-exe="))?.slice("--installed-exe=".length)
  || path.join(process.env.LOCALAPPDATA ?? "", "Programs/Holoshelf/Holoshelf.exe");
const databasePath = path.join(process.env.HOLOSHELF_DATA_DIR?.trim()
  || path.join(process.env.APPDATA ?? "", "holoshelf/data"), "holoshelf.sqlite");

try {
  await applyInstalledSeedUpdate({
    sourceDirectory: path.join(root, "resources/seed"),
    installedDirectory: path.join(path.dirname(installedExe), "resources/seed"),
    databasePath,
    log: console.log,
    verify: async () => {
      const result = spawnSync(process.execPath, [path.join(root, "scripts/verify-installed-data-merge.mjs"), `--installed-exe=${installedExe}`], {
        stdio: "inherit", windowsHide: true
      });
      if (result.error || result.status !== 0) { throw result.error ?? new Error("Installed data verification failed"); }
    },
    stopApp: async () => {
      const result = spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(root, "scripts/stop-installed-app.ps1")], {
        stdio: "inherit", windowsHide: true
      });
      if (result.error || result.status !== 0) { throw result.error ?? new Error("Could not close Holoshelf for restoration"); }
    }
  });
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
