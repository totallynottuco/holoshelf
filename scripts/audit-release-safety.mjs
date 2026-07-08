import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import initSqlJs from "sql.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const seedDatabasePath = path.join(projectRoot, "resources", "seed", "holoshelf-template.sqlite");
const wasmPath = path.join(projectRoot, "node_modules", "sql.js", "dist", "sql-wasm.wasm");
const forbiddenTextPatterns = [
  { name: "YouTube API key", pattern: /AIza[0-9A-Za-z_-]{35}/ },
  { name: "GitHub token", pattern: /gh[pousr]_[0-9A-Za-z_]{36,}/ },
  { name: "Slack token", pattern: /xox[baprs]-[0-9A-Za-z-]{20,}/ }
];

function fail(message) {
  throw new Error(`Release safety audit failed: ${message}`);
}

function gitTrackedFiles() {
  return execFileSync("git", ["ls-files"], {
    cwd: projectRoot,
    encoding: "utf8"
  })
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function isScannableTextFile(relativePath) {
  const normalized = relativePath.replaceAll("\\", "/");
  if (
    normalized.startsWith("node_modules/") ||
    normalized.startsWith("release/") ||
    normalized.startsWith("dist/") ||
    normalized.startsWith("dist-electron/") ||
    normalized.startsWith("data/") ||
    normalized.endsWith(".sqlite") ||
    normalized.endsWith(".ico") ||
    normalized.endsWith(".png") ||
    normalized.endsWith(".jpg") ||
    normalized.endsWith(".jpeg") ||
    normalized.endsWith(".webp") ||
    normalized.endsWith(".wasm")
  ) {
    return false;
  }
  return true;
}

function scanTrackedTextFiles() {
  const matches = [];
  for (const relativePath of gitTrackedFiles().filter(isScannableTextFile)) {
    const absolutePath = path.join(projectRoot, relativePath);
    const text = fs.readFileSync(absolutePath, "utf8");
    for (const { name, pattern } of forbiddenTextPatterns) {
      if (pattern.test(text)) {
        matches.push(`${relativePath} (${name})`);
      }
    }
    if (/(^|[/\\])[^/\\]*-api-key\.txt$/i.test(relativePath)) {
      matches.push(`${relativePath} (API key file)`);
    }
  }

  if (matches.length > 0) {
    fail(`tracked files contain private-looking secrets:\n${matches.map((match) => `  - ${match}`).join("\n")}`);
  }
}

function tableExists(database, tableName) {
  return Boolean(
    database.exec(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ${sqlString(tableName)}`)[0]?.values.length
  );
}

function columnExists(database, tableName, columnName) {
  if (!tableExists(database, tableName)) {
    return false;
  }
  return Boolean(database.exec(`PRAGMA table_info(${quoteIdentifier(tableName)})`)[0]?.values.some((row) => row[1] === columnName));
}

function scalar(database, sql) {
  return Number(database.exec(sql)[0]?.values[0]?.[0] ?? 0);
}

function rows(database, sql) {
  const result = database.exec(sql)[0];
  if (!result) {
    return [];
  }
  return result.values.map((row) => Object.fromEntries(result.columns.map((column, index) => [column, row[index]])));
}

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function assertEmptyTable(database, tableName) {
  if (!tableExists(database, tableName)) {
    return;
  }
  const count = scalar(database, `SELECT COUNT(*) FROM ${quoteIdentifier(tableName)}`);
  if (count !== 0) {
    fail(`${tableName} should be empty in the bundled seed, found ${count} rows`);
  }
}

function auditSeedDatabase(database) {
  if (!tableExists(database, "settings")) {
    fail("seed database is missing settings table");
  }

  const privateSettings = rows(
    database,
    `SELECT key FROM settings
     WHERE lower(key) LIKE '%apikey%'
        OR lower(key) LIKE '%api_key%'
        OR lower(key) LIKE '%token%'
        OR lower(key) LIKE '%secret%'
        OR key IN ('sources.holodexApiKey', 'sources.youtubeApiKey')`
  );
  if (privateSettings.length > 0) {
    fail(`seed settings contain private keys: ${privateSettings.map((row) => row.key).join(", ")}`);
  }

  if (tableExists(database, "hololive_idols") && columnExists(database, "hololive_idols", "source")) {
    const customIdols = scalar(database, "SELECT COUNT(*) FROM hololive_idols WHERE source = 'custom'");
    if (customIdols !== 0) {
      fail(`seed contains ${customIdols} custom talents`);
    }
  }

  if (tableExists(database, "hololive_music_videos") && columnExists(database, "hololive_music_videos", "source_kind")) {
    const userMusicRows = scalar(database, "SELECT COUNT(*) FROM hololive_music_videos WHERE source_kind = 'user'");
    if (userMusicRows !== 0) {
      fail(`seed contains ${userMusicRows} user-owned custom songs`);
    }
  }

  for (const tableName of [
    "lists",
    "list_items",
    "hololive_playlist_entries",
    "hololive_music_marker_keys",
    "hololive_music_playlists",
    "hololive_music_playlist_items",
    "hololive_music_queue_items",
    "hololive_brackets",
    "hololive_bracket_entries",
    "hololive_bracket_matches",
    "hololive_bracket_archives",
    "hololive_bracket_archive_entries",
    "hololive_bracket_archive_matches"
  ]) {
    assertEmptyTable(database, tableName);
  }

  if (tableExists(database, "tracked_entries")) {
    const personalizedTrackedRows = scalar(
      database,
      "SELECT COUNT(*) FROM tracked_entries WHERE rating IS NOT NULL OR notes IS NOT NULL OR status <> 'planned'"
    );
    if (personalizedTrackedRows !== 0) {
      fail(`seed contains ${personalizedTrackedRows} personalized tracked entries`);
    }
  }

  if (tableExists(database, "hololive_tier_boards")) {
    const boardCount = scalar(database, "SELECT COUNT(*) FROM hololive_tier_boards");
    if (boardCount !== 1) {
      fail(`seed should contain exactly one default tier board, found ${boardCount}`);
    }
  }

  if (tableExists(database, "hololive_tier_placements")) {
    const rankedPlacements = scalar(database, "SELECT COUNT(*) FROM hololive_tier_placements WHERE tier_id IS NOT NULL");
    if (rankedPlacements !== 0) {
      fail(`seed contains ${rankedPlacements} ranked tier placements`);
    }
  }
}

scanTrackedTextFiles();

if (!fs.existsSync(seedDatabasePath)) {
  fail(`seed database does not exist: ${seedDatabasePath}`);
}

const SQL = await initSqlJs({
  locateFile() {
    return wasmPath;
  }
});
const database = new SQL.Database(fs.readFileSync(seedDatabasePath));
try {
  auditSeedDatabase(database);
} finally {
  database.close();
}

console.log("Release safety audit passed.");
