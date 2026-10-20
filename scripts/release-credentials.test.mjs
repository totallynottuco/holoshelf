import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadReleaseCredentials, parseReleaseCredentials, releaseCredentialStatus } from "./release-credentials.mjs";

const folders = [];
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "holoshelf-credentials-"));
  folders.push(directory);
  fs.mkdirSync(path.join(directory, "secrets"));
  return directory;
}
function writeKeys(directory, text = "Holodex holodex-test-secret\nYoutube youtube-test-secret\n") {
  fs.writeFileSync(path.join(directory, "api-keys.txt"), text);
}
afterEach(() => {
  for (const folder of folders.splice(0)) {
    if (!path.resolve(folder).startsWith(`${path.resolve(os.tmpdir())}${path.sep}`)) throw new Error("Unsafe test cleanup path");
    fs.rmSync(folder, { recursive: true, force: true });
  }
});

describe("maintainer release credentials", () => {
  it.each([
    "Holodex holodex-test-secret\r\nYoutube youtube-test-secret",
    "HOLODEX_API_KEY=holodex-test-secret\nYOUTUBE_API_KEY=youtube-test-secret",
    "\uFEFF# local keys\nHolodex: holodex-test-secret\nYouTube: youtube-test-secret\n",
    "export HOLODEX_API_KEY='holodex-test-secret'\nYOUTUBE_DATA_API_KEY=\"youtube-test-secret\""
  ])("reads supported local file formats without executing their contents", (text) => {
    expect(parseReleaseCredentials(text)).toEqual({ holodex: "holodex-test-secret", youtube: "youtube-test-secret" });
  });

  it("loads the default secrets folder and exposes only presence and source in status", () => {
    const directory = fixture();writeKeys(path.join(directory, "secrets"));
    const credentials = loadReleaseCredentials({ projectRoot: directory, env: {} });
    expect(credentials.holodexKey).toBe("holodex-test-secret");
    expect(credentials.youtubeKey).toBe("youtube-test-secret");
    expect(releaseCredentialStatus(credentials)).toEqual({
      holodex: { configured: true, source: "secrets folder" },
      youtube: { configured: true, source: "secrets folder" }
    });
    expect(JSON.stringify(releaseCredentialStatus(credentials))).not.toContain("test-secret");
  });

  it("uses an external folder with spaces without copying the key file into the project", () => {
    const directory = fixture();const external = path.join(directory, "external secrets");fs.mkdirSync(external);writeKeys(external);
    fs.writeFileSync(path.join(directory, ".release-secrets.json"), JSON.stringify({ directory: "external secrets" }));
    expect(loadReleaseCredentials({ projectRoot: directory, env: {} }).youtubeKey).toBe("youtube-test-secret");
    expect(fs.readdirSync(path.join(directory, "secrets"))).toEqual([]);
  });

  it("lets the directory environment variable override local configuration", () => {
    const directory = fixture();writeKeys(path.join(directory, "secrets"));
    fs.writeFileSync(path.join(directory, ".release-secrets.json"), "invalid-json");
    const credentials = loadReleaseCredentials({ projectRoot: directory, env: { HOLOSHELF_RELEASE_SECRETS_DIR: "secrets" } });
    expect(credentials.youtubeKey).toBe("youtube-test-secret");
  });

  it("keeps environment overrides and fills only missing keys from the file", () => {
    const directory = fixture();writeKeys(path.join(directory, "secrets"));
    const credentials = loadReleaseCredentials({ projectRoot: directory, env: { HOLODEX_API_KEY: " override-key " } });
    expect(credentials.holodexKey).toBe("override-key");
    expect(credentials.sources.holodex).toBe("environment");
    expect(credentials.youtubeKey).toBe("youtube-test-secret");
  });

  it("does not access a configured file when both keys are explicitly provided", () => {
    const directory = fixture();fs.writeFileSync(path.join(directory, ".release-secrets.json"), "invalid-json");
    expect(loadReleaseCredentials({ projectRoot: directory, env: { HOLODEX_API_KEY: "holodex-env", YOUTUBE_API_KEY: "youtube-env" } }).youtubeKey).toBe("youtube-env");
  });

  it("preserves manual prompting when no credentials have been configured", () => {
    const credentials = loadReleaseCredentials({ projectRoot: fixture(), env: {} });
    expect(credentials.holodexKey).toBe("");expect(credentials.youtubeKey).toBe("");
  });

  it("fails clearly when an explicitly configured folder is missing", () => {
    expect(() => loadReleaseCredentials({ projectRoot: fixture(), env: { HOLOSHELF_RELEASE_SECRETS_DIR: "missing" } })).toThrow("Cannot read api-keys.txt");
  });

  it.each(["not-a-label secret-must-not-appear", "HOLODEX secret-must-not-appear\nHOLODEX conflicting-value", "YOUTUBE a value with spaces", "HOLODEX="])("reports malformed files without leaking their content", (text) => {
    let error;
    try { parseReleaseCredentials(text); } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(Error);
    expect(error.message).not.toContain("secret-must-not-appear");
    expect(error.message).not.toContain("conflicting-value");
  });

  it("checks the actual runner without printing keys, building, or accessing APIs", () => {
    const directory = fixture();writeKeys(path.join(directory, "secrets"));
    const result = spawnSync(process.execPath, [path.join(root, "scripts", "release-data-wizard.mjs"), "--check-credentials"], {
      encoding: "utf8", windowsHide: true,
      env: { ...process.env, HOLODEX_API_KEY: "", YOUTUBE_API_KEY: "", HOLOSHELF_RELEASE_SECRETS_DIR: path.join(directory, "secrets") }
    });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).youtube.configured).toBe(true);
    expect(result.stdout + result.stderr).not.toContain("test-secret");
  });

  it.skipIf(process.platform !== "win32")("skips both PowerShell key prompts when the launcher supplies keys", () => {
    const script = [
      "$ErrorActionPreference='Stop'",
      "$tokens=$null;$errors=$null",
      "$ast=[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $env:HOLOSHELF_TEST_ROOT 'scripts/release-data-wizard.ps1'),[ref]$tokens,[ref]$errors)",
      "if ($errors.Count) { throw 'PowerShell parse failed' }",
      "$functions=$ast.FindAll({param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -in @('Read-HolodexKey','Read-YoutubeKey')},$true)",
      "$functions | ForEach-Object { Invoke-Expression $_.Extent.Text }",
      "function Read-YesNo { throw 'Unexpected confirmation prompt' }",
      "function Read-SecretText { throw 'Unexpected key prompt' }",
      "if ((Read-HolodexKey) -ne $env:HOLODEX_API_KEY -or (Read-YoutubeKey) -ne $env:YOUTUBE_API_KEY) { throw 'Key mismatch' }",
      "Write-Output 'Configured keys were used without prompting'"
    ].join("\n");
    const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", script], {
      encoding: "utf8", windowsHide: true,
      env: { ...process.env, HOLOSHELF_TEST_ROOT: root, HOLODEX_API_KEY: "holodex-test-secret", YOUTUBE_API_KEY: "youtube-test-secret" }
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("without prompting");
    expect(result.stdout + result.stderr).not.toContain("test-secret");
  });
});
