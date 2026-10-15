import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import initSqlJs from "sql.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { verifyInstalledMusicStats } = require("../dist-electron/electron/services/musicStatsAudit.js");

const args = new Map(
  process.argv.slice(2).map((entry) => {
    const separator = entry.indexOf("=");
    return separator < 0 ? [entry, ""] : [entry.slice(0, separator), entry.slice(separator + 1)];
  })
);

const installedExe = args.get("--installed-exe")?.trim()
  || path.join(process.env.LOCALAPPDATA ?? "", "Programs", "Holoshelf", "Holoshelf.exe");
const resourcesDirectory = path.join(path.dirname(installedExe), "resources");
const manifestPath = path.join(resourcesDirectory, "seed", "official-data.json");
const dataDirectory = process.env.HOLOSHELF_DATA_DIR?.trim()
  || path.join(process.env.APPDATA ?? "", "holoshelf", "data");
const databasePath = path.join(dataDirectory, "holoshelf.sqlite");
const logPath = path.join(dataDirectory, "app.log");
const projectManifestPath = path.join(projectRoot, "resources", "seed", "official-data.json");
const timeoutMs = 90_000;
const pollMs = 500;
const wasmPath = path.join(projectRoot, "node_modules", "sql.js", "dist", "sql-wasm.wasm");

function fail(message) {
  throw new Error(`Installed data verification failed: ${message}`);
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function scalar(database, sql) {
  const result = database.exec(sql)[0];
  return result?.values?.[0]?.[0] ?? null;
}

function tableExists(database, tableName) {
  const statement = database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1");
  try {
    statement.bind([tableName]);
    return statement.step();
  } finally {
    statement.free();
  }
}

function columnExists(database, tableName, columnName) {
  if (!tableExists(database, tableName)) {
    return false;
  }

  const result = database.exec(`PRAGMA table_info(\"${tableName}\")`)[0];
  return result?.values?.some((row) => row[1] === columnName) ?? false;
}

function countIfPresent(database, tableName, where = "", requiredColumn = "") {
  return tableExists(database, tableName) && (!requiredColumn || columnExists(database, tableName, requiredColumn))
    ? Number(scalar(database, `SELECT COUNT(*) FROM \"${tableName}\"${where}`) ?? 0)
    : 0;
}

function readSnapshot(SQL) {
  if (!fs.existsSync(databasePath)) {
    return null;
  }

  const database = new SQL.Database(fs.readFileSync(databasePath));
  try {
    const version = tableExists(database, "settings")
      ? scalar(database, "SELECT value FROM settings WHERE key = 'hololive.officialDataVersion'")
      : null;

    return {
      version: typeof version === "string" ? version : "",
      musicRows: countIfPresent(database, "hololive_music_videos"),
      statsRows: countIfPresent(database, "hololive_music_video_stats"),
      customTalents: countIfPresent(database, "hololive_idols", " WHERE source = 'custom'", "source"),
      customSongs: countIfPresent(database, "hololive_music_videos", " WHERE source_kind = 'user'", "source_kind"),
      markers: countIfPresent(database, "hololive_music_marker_keys"),
      playlists: countIfPresent(database, "hololive_music_playlists"),
      playlistItems: countIfPresent(database, "hololive_music_playlist_items"),
      queueItems: countIfPresent(database, "hololive_music_queue_items"),
      tierBoards: countIfPresent(database, "hololive_tier_boards"),
      tierPlacements: countIfPresent(database, "hololive_tier_placements"),
      brackets: countIfPresent(database, "hololive_brackets"),
      archives: countIfPresent(database, "hololive_bracket_archives")
    };
  } finally {
    database.close();
  }
}

function compareVersions(left, right) {
  return new Intl.Collator(undefined, { numeric: true, sensitivity: "base" }).compare(left.trim(), right.trim());
}

function assertPersonalStatePreserved(before, after) {
  if (!before) {
    return;
  }

  const protectedCounts = [
    ["custom talents", "customTalents"],
    ["custom songs", "customSongs"],
    ["markers and ratings", "markers"],
    ["playlists", "playlists"],
    ["playlist items", "playlistItems"],
    ["queue items", "queueItems"],
    ["tier boards", "tierBoards"],
    ["tier placements", "tierPlacements"],
    ["saved brackets", "brackets"],
    ["bracket archives", "archives"]
  ];

  for (const [label, key] of protectedCounts) {
    if (after[key] < before[key]) {
      fail(`${label} decreased during update (${before[key]} -> ${after[key]})`);
    }
  }
}

function verifyStats(SQL) {
  const files = [
    path.join(projectRoot, "resources", "seed", "holoshelf-template.sqlite"),
    path.join(resourcesDirectory, "seed", "holoshelf-template.sqlite"),
    databasePath
  ];
  const databases = [];
  const reader = (database) => ({
    select(sql) {
      const result = database.exec(sql)[0];
      return result ? result.values.map((row) => Object.fromEntries(result.columns.map((column, i) => [column, row[i]]))) : [];
    }
  });
  try {
    for (const file of files) databases.push(new SQL.Database(fs.readFileSync(file)));
    const [project, installed, personal] = databases.map(reader);
    for (const [label, target] of [["installed seed", installed], ["AppData", personal]]) {
      const report = verifyInstalledMusicStats(project, target);
      if (report.mismatchedVideoIds.length > 0) {
        fail(`${label} has ${report.mismatchedVideoIds.length} missing, stale, or mismatched YouTube stat(s): `
          + report.mismatchedVideoIds.slice(0, 10).join(", "));
      }
      console.log(`Verified ${label} YouTube stats: ${report.verifiedVideos} match or are newer; `
        + `${report.excludedVideos} personally excluded, ${report.deduplicatedVideos} verified duplicate replacements, ${report.userOwnedVideos} user-owned`);
    }
  } finally {
    for (const database of databases) database.close();
  }
}

function readNewLog(startOffset) {
  if (!fs.existsSync(logPath)) {
    return "";
  }

  const content = fs.readFileSync(logPath);
  const offset = content.length >= startOffset ? startOffset : 0;
  return content.subarray(offset).toString("utf8");
}

async function main() {
  if (!fs.existsSync(installedExe)) {
    fail(`installed executable is missing: ${installedExe}`);
  }
  if (!fs.existsSync(manifestPath)) {
    fail(`installed seed manifest is missing: ${manifestPath}`);
  }
  if (!fs.existsSync(projectManifestPath)) {
    fail(`project seed manifest is missing: ${projectManifestPath}`);
  }
  if (!fs.existsSync(wasmPath)) {
    fail(`sql.js runtime is missing: ${wasmPath}`);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const expectedVersion = typeof manifest.version === "string" ? manifest.version.trim() : "";
  if (!expectedVersion) {
    fail("installed seed manifest has no official data version");
  }
  const projectManifest = JSON.parse(fs.readFileSync(projectManifestPath, "utf8"));
  const projectVersion = typeof projectManifest.version === "string" ? projectManifest.version.trim() : "";
  if (projectVersion !== expectedVersion) {
    fail(`installed seed is ${expectedVersion}; current project seed is ${projectVersion || "missing"}`);
  }

  const SQL = await initSqlJs({ locateFile: () => wasmPath });
  const before = readSnapshot(SQL);
  const logStartOffset = fs.existsSync(logPath) ? fs.statSync(logPath).size : 0;

  const child = spawn(installedExe, [], {
    detached: true,
    stdio: "ignore",
    windowsHide: false
  });
  child.unref();

  const deadline = Date.now() + timeoutMs;
  let lastDatabaseError = null;
  while (Date.now() < deadline) {
    const newLog = readNewLog(logStartOffset);
    const mergeFailure = newLog.match(/\[official-data\] merge failed:[\s\S]*?(?=\r?\n\[|$)/);
    if (mergeFailure) {
      fail(mergeFailure[0].trim());
    }

    if (newLog.includes("[startup] official data ready")) {
      let after;
      try {
        after = readSnapshot(SQL);
      } catch (error) {
        lastDatabaseError = error;
        await sleep(pollMs);
        continue;
      }

      if (!after) {
        fail(`AppData database was not created: ${databasePath}`);
      }
      if (compareVersions(after.version, expectedVersion) < 0) {
        fail(`AppData official data is ${after.version || "missing"}; installed seed is ${expectedVersion}`);
      }

      assertPersonalStatePreserved(before, after);
      verifyStats(SQL);
      console.log(`Verified AppData official data ${after.version} at ${databasePath}`);
      console.log(`Verified library rows: music=${after.musicRows} stats=${after.statsRows}`);
      if (before) {
        console.log(
          `Verified personal data: customTalents=${after.customTalents} customSongs=${after.customSongs} `
          + `markers=${after.markers} playlists=${after.playlists} brackets=${after.brackets} archives=${after.archives}`
        );
      }
      return;
    }

    await sleep(pollMs);
  }

  const detail = lastDatabaseError instanceof Error ? ` Last database error: ${lastDatabaseError.message}` : "";
  fail(`timed out after ${timeoutMs / 1000}s waiting for the installed app to finish its data merge.${detail}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
