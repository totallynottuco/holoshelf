import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { loadReleaseCredentials, releaseCredentialStatus } from "./release-credentials.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
try {
  // Help works without accessing local credentials.
  const check = args.includes("--check-credentials");
  const help = !check && args.some((arg) => ["-help", "--help", "-h"].includes(arg.toLowerCase()));
  const credentials = help ? null : loadReleaseCredentials({ projectRoot });
  if (check) {
    console.log(JSON.stringify(releaseCredentialStatus(credentials), null, 2));
    process.exitCode = credentials.youtubeKey ? 0 : 1;
  } else {
    const env = { ...process.env };
    if (credentials?.holodexKey) env.HOLODEX_API_KEY = credentials.holodexKey;
    if (credentials?.youtubeKey) env.YOUTUBE_API_KEY = credentials.youtubeKey;
    const result = spawnSync("powershell.exe", [
      "-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
      path.join(projectRoot, "scripts", "release-data-wizard.ps1"),
      ...(help ? ["-Help"] : args)
    ], { cwd: projectRoot, env, stdio: "inherit", windowsHide: true });
    if (result.error) throw new Error("Could not start the release data wizard. Check that PowerShell is available.");
    process.exitCode = result.status ?? 1;
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
