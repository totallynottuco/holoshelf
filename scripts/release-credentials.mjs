import fs from "node:fs";
import path from "node:path";

export function parseReleaseCredentials(text) {
  const keys = {};
  for (const line of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const match = line.match(/^(?:\s*export\s+)?\s*(HOLODEX(?:[_ -]+API)?(?:[_ -]+KEY)?|YOUTUBE(?:[_ -]+DATA)?(?:[_ -]+API)?(?:[_ -]+KEY)?)\s*(?:=|:|\s)\s*(.*?)\s*$/i);
    if (!match) throw new Error("Invalid api-keys.txt format. Use HOLODEX or YOUTUBE followed by a key.");
    const name = /^holodex/i.test(match[1]) ? "holodex" : "youtube";
    const value = match[2].replace(/^(["'])(.*)\1$/, "$2").trim();
    if (!value || /\s|["']/.test(value)) throw new Error(`Invalid ${name} key in api-keys.txt.`);
    if (keys[name] && keys[name] !== value) throw new Error(`Conflicting ${name} keys in api-keys.txt.`);
    keys[name] = value;
  }
  return keys;
}

export function loadReleaseCredentials({ projectRoot, env = process.env }) {
  const credentials = {
    holodexKey: env.HOLODEX_API_KEY?.trim() || "",
    youtubeKey: env.YOUTUBE_API_KEY?.trim() || "",
    sources: { holodex: "not configured", youtube: "not configured" }
  };
  if (credentials.holodexKey) credentials.sources.holodex = "environment";
  if (credentials.youtubeKey) credentials.sources.youtube = "environment";
  if (credentials.holodexKey && credentials.youtubeKey) return credentials;

  let directory = env.HOLOSHELF_RELEASE_SECRETS_DIR?.trim();
  let explicitDirectory = Boolean(directory);
  const configPath = path.join(projectRoot, ".release-secrets.json");
  if (!directory && fs.existsSync(configPath)) {
    let config;
    try { config = JSON.parse(fs.readFileSync(configPath, "utf8").replace(/^\uFEFF/, "")); }
    catch { throw new Error("Cannot read .release-secrets.json. Expected a JSON object with a directory field."); }
    if (typeof config.directory !== "string" || !config.directory.trim()) {
      throw new Error(".release-secrets.json must specify a nonempty directory field.");
    }
    directory = config.directory.trim();
    explicitDirectory = true;
  }
  const secretsFile = path.resolve(projectRoot, directory || "secrets", "api-keys.txt");
  let text;
  try { text = fs.readFileSync(secretsFile, "utf8"); }
  catch (error) {
    if (error.code === "ENOENT" && !explicitDirectory) return credentials;
    throw new Error("Cannot read api-keys.txt in the configured secrets folder. Check its location and access.");
  }
  const keys = parseReleaseCredentials(text);
  for (const [source, property] of [["holodex", "holodexKey"], ["youtube", "youtubeKey"]]) {
    if (!credentials[property] && keys[source]) {
      credentials[property] = keys[source];
      credentials.sources[source] = "secrets folder";
    }
  }
  return credentials;
}

export function releaseCredentialStatus(credentials) {
  return {
    holodex: { configured: Boolean(credentials.holodexKey), source: credentials.sources.holodex },
    youtube: { configured: Boolean(credentials.youtubeKey), source: credentials.sources.youtube }
  };
}
