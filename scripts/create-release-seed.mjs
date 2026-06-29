import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import initSqlJs from "sql.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceDatabasePath = path.join(projectRoot, "data", "holoshelf.sqlite");
const sourceImagesDirectory = path.join(projectRoot, "data", "images", "hololive");
const sourceArtifactsDirectory = path.join(projectRoot, "data", "holodex-refresh", "latest");
const seedRoot = path.join(projectRoot, "resources", "seed");
const seedDatabasePath = path.join(seedRoot, "holoshelf-template.sqlite");
const seedManifestPath = path.join(seedRoot, "official-data.json");
const seedImagesDirectory = path.join(seedRoot, "images", "hololive");
const seedArtifactsDirectory = path.join(seedRoot, "holodex-refresh", "latest");
const defaultSeedTimestamp = "2026-06-29T00:00:00.000Z";
let sanitizedAt = process.env.HOLOSHELF_SEED_GENERATED_AT?.trim() || defaultSeedTimestamp;
let officialDataVersion = process.env.HOLOSHELF_OFFICIAL_DATA_VERSION?.trim() || "";
let officialDataMergedAt = process.env.HOLOSHELF_OFFICIAL_DATA_MERGED_AT?.trim() || "";

const defaultTiers = [
  ["tier-s", "S", "#2f8fd7", 0],
  ["tier-a", "A", "#2f8f5b", 1],
  ["tier-b", "B", "#91d96f", 2],
  ["tier-c", "C", "#f2d45c", 3],
  ["tier-d", "D", "#f08a35", 4],
  ["tier-f", "F", "#e14d63", 5]
];

const SQL = await initSqlJs({
  locateFile(fileName) {
    return path.join(projectRoot, "node_modules", "sql.js", "dist", fileName);
  }
});

if (!fs.existsSync(sourceDatabasePath)) {
  if (fs.existsSync(seedDatabasePath)) {
    const summary = verifySeedDatabase();
    assertSeedSummary(summary);
    writeSeedManifest(summary);
    console.log(JSON.stringify({ ...summary, reusedExistingSeed: true }, null, 2));
    process.exit(0);
  }

  throw new Error(`Source database not found: ${sourceDatabasePath}`);
}

const database = new SQL.Database(fs.readFileSync(sourceDatabasePath));

function tableExists(name) {
  const result = database.exec(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ${sqlString(name)}`);
  return Boolean(result[0]?.values.length);
}

function columnExists(tableName, columnName) {
  if (!tableExists(tableName)) {
    return false;
  }
  const result = database.exec(`PRAGMA table_info(${quoteIdentifier(tableName)})`);
  return Boolean(result[0]?.values.some((row) => row[1] === columnName));
}

function scalar(sql) {
  return database.exec(sql)[0]?.values[0]?.[0] ?? 0;
}

function rows(sql) {
  const result = database.exec(sql)[0];
  if (!result) {
    return [];
  }
  return result.values.map((valueRow) =>
    Object.fromEntries(result.columns.map((column, index) => [column, valueRow[index]]))
  );
}

function runIfTable(tableName, sql) {
  if (tableExists(tableName)) {
    database.run(sql);
  }
}

function quoteIdentifier(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function sqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function deleteDirectoryContents(directory) {
  fs.rmSync(directory, { recursive: true, force: true });
  fs.mkdirSync(directory, { recursive: true });
}

function copyDirectoryIfExists(source, target) {
  if (!fs.existsSync(source)) {
    return;
  }
  fs.cpSync(source, target, { recursive: true });
}

function removeRowsWithCustomIdReferences(tableName, textColumns, customIds) {
  if (!tableExists(tableName) || customIds.length === 0) {
    return;
  }

  for (const column of textColumns) {
    if (!columnExists(tableName, column)) {
      continue;
    }
    for (const customId of customIds) {
      database.run(
        `DELETE FROM ${quoteIdentifier(tableName)} WHERE ${quoteIdentifier(column)} LIKE ${sqlString(`%"${customId}"%`)}`
      );
    }
  }
}

function settingValue(key) {
  if (!tableExists("settings")) {
    return "";
  }

  return String(rows(`SELECT value FROM settings WHERE key = ${sqlString(key)}`)[0]?.value ?? "").trim();
}

const sourceOfficialDataVersion = settingValue("hololive.officialDataVersion");
const sourceOfficialDataMergedAt = settingValue("hololive.officialDataMergedAt");
officialDataVersion ||= sourceOfficialDataVersion || sanitizedAt.slice(0, 10);
officialDataMergedAt ||= sourceOfficialDataMergedAt || sanitizedAt;
if (!process.env.HOLOSHELF_SEED_GENERATED_AT?.trim()) {
  sanitizedAt = officialDataMergedAt;
}

database.run("PRAGMA foreign_keys = OFF;");

const customIdRows = columnExists("hololive_idols", "source")
  ? rows("SELECT id FROM hololive_idols WHERE source = 'custom'")
  : [];
const customIds = customIdRows.map((row) => String(row.id));

removeRowsWithCustomIdReferences("hololive_music_videos", ["participants_json", "owned_idol_ids_json", "featured_idol_ids_json"], customIds);
removeRowsWithCustomIdReferences("hololive_channels", ["main_idol_ids_json", "topic_idol_ids_json", "linked_idol_ids_json"], customIds);

if (customIds.length > 0 && columnExists("hololive_idols", "source")) {
  database.run("DELETE FROM hololive_idols WHERE source = 'custom';");
}

runIfTable("settings", "DELETE FROM settings;");
runIfTable(
  "settings",
  `INSERT INTO settings (key, value, updated_at) VALUES
    ('hololive.activeBoardId', 'hololive-idol-ranking', ${sqlString(sanitizedAt)}),
    ('hololive.tierLabelWidth', '70', ${sqlString(sanitizedAt)}),
    ('hololive.officialDataVersion', ${sqlString(officialDataVersion)}, ${sqlString(sanitizedAt)}),
    ('hololive.officialDataMergedAt', ${sqlString(sanitizedAt)}, ${sqlString(sanitizedAt)});`
);

runIfTable("modules", "DELETE FROM modules WHERE id != 'hololive';");
runIfTable("source_health", "DELETE FROM source_health WHERE source_id != 'holodex';");
runIfTable("fetch_jobs", "DELETE FROM fetch_jobs;");
runIfTable("csv_import_mappings", "DELETE FROM csv_import_mappings;");
runIfTable("list_items", "DELETE FROM list_items;");
runIfTable("lists", "DELETE FROM lists;");
runIfTable("covers", "DELETE FROM covers;");

runIfTable("hololive_music_marker_keys", "DELETE FROM hololive_music_marker_keys;");
runIfTable("hololive_music_exclusions", "DELETE FROM hololive_music_exclusions;");
runIfTable("hololive_music_playlist_items", "DELETE FROM hololive_music_playlist_items;");
runIfTable("hololive_music_playlists", "DELETE FROM hololive_music_playlists;");
runIfTable("hololive_music_queue_items", "DELETE FROM hololive_music_queue_items;");
runIfTable("hololive_music_player_state", "DELETE FROM hololive_music_player_state;");

runIfTable("hololive_bracket_archive_matches", "DELETE FROM hololive_bracket_archive_matches;");
runIfTable("hololive_bracket_archive_entries", "DELETE FROM hololive_bracket_archive_entries;");
runIfTable("hololive_bracket_archives", "DELETE FROM hololive_bracket_archives;");
runIfTable("hololive_bracket_matches", "DELETE FROM hololive_bracket_matches;");
runIfTable("hololive_bracket_entries", "DELETE FROM hololive_bracket_entries;");
runIfTable("hololive_brackets", "DELETE FROM hololive_brackets;");

runIfTable("hololive_tier_placements", "DELETE FROM hololive_tier_placements;");
runIfTable("hololive_tiers", "DELETE FROM hololive_tiers;");
runIfTable("hololive_tier_boards", "DELETE FROM hololive_tier_boards;");
runIfTable(
  "hololive_tier_boards",
  `INSERT INTO hololive_tier_boards (id, name, tile_size, created_at, updated_at, position)
   VALUES ('hololive-idol-ranking', 'tier list 1', 64, ${sqlString(sanitizedAt)}, ${sqlString(sanitizedAt)}, 0);`
);

for (const [id, label, color, position] of defaultTiers) {
  database.run(
    `INSERT INTO hololive_tiers (id, board_id, label, color, position, collapsed, created_at, updated_at)
     VALUES (${sqlString(id)}, 'hololive-idol-ranking', ${sqlString(label)}, ${sqlString(color)}, ${position}, 0, ${sqlString(sanitizedAt)}, ${sqlString(sanitizedAt)});`
  );
}

if (tableExists("hololive_tier_placements")) {
  const idols = rows("SELECT id, sort_order FROM hololive_idols ORDER BY sort_order ASC, display_name ASC");
  for (const idol of idols) {
    database.run(
      `INSERT INTO hololive_tier_placements (board_id, idol_id, tier_id, position, updated_at)
       VALUES ('hololive-idol-ranking', ${sqlString(idol.id)}, NULL, ${Number(idol.sort_order) || 0}, ${sqlString(sanitizedAt)});`
    );
  }
}

runIfTable(
  "tracked_entries",
  "UPDATE tracked_entries SET status = 'planned', rating = NULL, notes = NULL, started_at = NULL, completed_at = NULL;"
);

runIfTable("catalog_items", "DELETE FROM catalog_items WHERE module_id != 'hololive';");
runIfTable(
  "catalog_items",
  "DELETE FROM catalog_items WHERE module_id = 'hololive' AND id NOT IN (SELECT item_id FROM hololive_music_videos WHERE item_id IS NOT NULL);"
);
runIfTable("source_refs", "DELETE FROM source_refs WHERE item_id NOT IN (SELECT id FROM catalog_items);");
runIfTable("item_tags", "DELETE FROM item_tags WHERE item_id NOT IN (SELECT id FROM catalog_items);");
runIfTable("tracked_entries", "DELETE FROM tracked_entries WHERE item_id NOT IN (SELECT id FROM catalog_items);");
runIfTable(
  "hololive_music_videos",
  "UPDATE hololive_music_videos SET source_run_id = NULL WHERE source_run_id IS NOT NULL AND source_run_id NOT IN (SELECT id FROM hololive_music_refresh_runs);"
);
runIfTable(
  "hololive_music_duplicate_removals",
  "UPDATE hololive_music_duplicate_removals SET source_run_id = NULL WHERE source_run_id IS NOT NULL AND source_run_id NOT IN (SELECT id FROM hololive_music_refresh_runs);"
);

const foreignKeyViolations = database.exec("PRAGMA foreign_key_check;")[0]?.values ?? [];
if (foreignKeyViolations.length > 0) {
  throw new Error(`Sanitized seed has foreign key violations: ${JSON.stringify(foreignKeyViolations.slice(0, 10))}`);
}

database.run("VACUUM;");

deleteDirectoryContents(seedRoot);
fs.writeFileSync(seedDatabasePath, Buffer.from(database.export()));
database.close();

copyDirectoryIfExists(sourceImagesDirectory, seedImagesDirectory);
copyDirectoryIfExists(sourceArtifactsDirectory, seedArtifactsDirectory);

const summary = verifySeedDatabase();
assertSeedSummary(summary);
writeSeedManifest(summary);

console.log(JSON.stringify(summary, null, 2));

function tableExistsIn(db, name) {
  const result = db.exec(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ${sqlString(name)}`);
  return Boolean(result[0]?.values.length);
}

function columnExistsIn(db, tableName, columnName) {
  if (!tableExistsIn(db, tableName)) {
    return false;
  }
  const result = db.exec(`PRAGMA table_info(${quoteIdentifier(tableName)})`);
  return Boolean(result[0]?.values.some((row) => row[1] === columnName));
}

function scalarFrom(db, sql) {
  return db.exec(sql)[0]?.values[0]?.[0] ?? 0;
}

function rowsFrom(db, sql) {
  const result = db.exec(sql)[0];
  if (!result) {
    return [];
  }
  return result.values.map((valueRow) =>
    Object.fromEntries(result.columns.map((column, index) => [column, valueRow[index]]))
  );
}

function verifySeedDatabase() {
  const verification = new SQL.Database(fs.readFileSync(seedDatabasePath));
  const secretRows = rowsFrom(
    verification,
    "SELECT key FROM settings WHERE lower(key) LIKE '%key%' OR lower(key) LIKE '%token%' OR lower(key) LIKE '%secret%'"
  );
  const summary = {
    seedDatabasePath,
    officialDataVersion: rowsFrom(verification, "SELECT value FROM settings WHERE key = 'hololive.officialDataVersion'")[0]?.value ?? null,
    officialDataMergedAt: rowsFrom(verification, "SELECT value FROM settings WHERE key = 'hololive.officialDataMergedAt'")[0]?.value ?? null,
    musicRows: scalarFrom(verification, "SELECT COUNT(*) FROM hololive_music_videos"),
    idols: scalarFrom(verification, "SELECT COUNT(*) FROM hololive_idols"),
    customIdols: columnExistsIn(verification, "hololive_idols", "source")
      ? scalarFrom(verification, "SELECT COUNT(*) FROM hololive_idols WHERE source = 'custom'")
      : 0,
    tierBoards: scalarFrom(verification, "SELECT COUNT(*) FROM hololive_tier_boards"),
    rankedPlacements: scalarFrom(verification, "SELECT COUNT(*) FROM hololive_tier_placements WHERE tier_id IS NOT NULL"),
    playlists: tableExistsIn(verification, "hololive_music_playlists")
      ? scalarFrom(verification, "SELECT COUNT(*) FROM hololive_music_playlists")
      : 0,
    markers: tableExistsIn(verification, "hololive_music_marker_keys")
      ? scalarFrom(verification, "SELECT COUNT(*) FROM hololive_music_marker_keys")
      : 0,
    brackets: tableExistsIn(verification, "hololive_brackets")
      ? scalarFrom(verification, "SELECT COUNT(*) FROM hololive_brackets")
      : 0,
    fetchJobs: tableExistsIn(verification, "fetch_jobs") ? scalarFrom(verification, "SELECT COUNT(*) FROM fetch_jobs") : 0,
    secretSettingKeys: secretRows.map((row) => row.key),
    imageFiles: fs.existsSync(seedImagesDirectory) ? fs.readdirSync(seedImagesDirectory).length : 0,
    artifactFiles: fs.existsSync(seedArtifactsDirectory) ? fs.readdirSync(seedArtifactsDirectory).length : 0
  };
  verification.close();
  return summary;
}

function writeSeedManifest(summary) {
  fs.mkdirSync(seedRoot, { recursive: true });
  const manifestVersion = summary.officialDataVersion ?? officialDataVersion;
  const manifestGeneratedAt = summary.officialDataMergedAt ?? officialDataMergedAt;
  fs.writeFileSync(
    seedManifestPath,
    `${JSON.stringify(
      {
        schema: 1,
        version: manifestVersion,
        generatedAt: manifestGeneratedAt,
        seedDatabase: path.basename(seedDatabasePath),
        musicRows: summary.musicRows,
        idols: summary.idols,
        imageFiles: summary.imageFiles,
        artifactFiles: summary.artifactFiles
      },
      null,
      2
    )}\n`
  );
}

function assertSeedSummary(summary) {
  if (officialDataVersion && summary.officialDataVersion !== officialDataVersion) {
    throw new Error(`Seed official data version mismatch: ${JSON.stringify(summary, null, 2)}`);
  }

  if (
    summary.customIdols !== 0 ||
    summary.rankedPlacements !== 0 ||
    summary.playlists !== 0 ||
    summary.markers !== 0 ||
    summary.brackets !== 0 ||
    summary.fetchJobs !== 0 ||
    summary.secretSettingKeys.length !== 0
  ) {
    throw new Error(`Seed sanitization failed: ${JSON.stringify(summary, null, 2)}`);
  }
}
