import fs from "node:fs";
import path from "node:path";
import initSqlJs, { type Database } from "sql.js";
import type { AppPathSet } from "./appPaths";
import type { DatabaseService } from "./database";

export const OFFICIAL_DATA_VERSION_SETTING = "hololive.officialDataVersion";
export const OFFICIAL_DATA_MERGED_AT_SETTING = "hololive.officialDataMergedAt";
export const OFFICIAL_DATA_MERGE_SUMMARY_SETTING = "hololive.officialDataMergeSummary";

interface OfficialDataManifest {
  version?: unknown;
  generatedAt?: unknown;
}

interface SeedRow {
  [key: string]: unknown;
}

type MissingMusicRow = Record<string, unknown> & {
  youtube_video_id: string;
  item_id: string;
  canonical_performance_key: string | null;
};

export interface OfficialDataMergeResult {
  status: "merged" | "skipped";
  reason?: "unpackaged" | "missing-seed" | "current-version";
  bundledVersion: string | null;
  previousVersion: string | null;
  mergedAt: string | null;
  musicRows: number;
  idols: number;
  channels: number;
  catalogItems: number;
  sourceRefs: number;
  itemTags: number;
  detailCacheRows: number;
  duplicateRemovalRows: number;
  statsRows: number;
  imageCacheRows: number;
  copiedImageFiles: number;
  copiedArtifactFiles: number;
  prunedMissingRows: number;
  preservedMissingRows: number;
}

export interface OfficialImageCacheRepairResult {
  copiedImageFiles: number;
  imageCacheRows: number;
  reason?: "missing-seed";
}

interface MergeOptions {
  database: DatabaseService;
  paths: Pick<AppPathSet, "dataDirectory" | "hololiveImageDirectory" | "seedDirectory">;
  isPackaged: boolean;
  now?: () => string;
  log?: (message: string) => void;
}

type ImageCacheRepairOptions = Pick<MergeOptions, "database" | "paths" | "log">;

function resolveSqlWasmPath(): string {
  const packagedPath = path.join(process.resourcesPath ?? "", "sql-wasm.wasm");
  if (process.resourcesPath && fs.existsSync(packagedPath)) {
    return packagedPath;
  }

  return path.join(process.cwd(), "node_modules", "sql.js", "dist", "sql-wasm.wasm");
}

function readOfficialDataManifest(seedDirectory: string): { version: string; generatedAt: string | null } | null {
  const manifestPath = path.join(seedDirectory, "official-data.json");
  if (!fs.existsSync(manifestPath)) {
    return null;
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as OfficialDataManifest;
  const version = typeof manifest.version === "string" ? manifest.version.trim() : "";
  if (!version) {
    return null;
  }

  return {
    version,
    generatedAt: typeof manifest.generatedAt === "string" ? manifest.generatedAt : null
  };
}

function compareOfficialDataVersions(left: string | null | undefined, right: string | null | undefined): number {
  const normalizedLeft = left?.trim() ?? "";
  const normalizedRight = right?.trim() ?? "";

  if (normalizedLeft === normalizedRight) {
    return 0;
  }

  if (!normalizedLeft) {
    return -1;
  }

  if (!normalizedRight) {
    return 1;
  }

  return normalizedLeft.localeCompare(normalizedRight, undefined, { numeric: true, sensitivity: "base" });
}

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

function selectSeedRows<T extends SeedRow>(seedDatabase: Database, sql: string, params: unknown[] = []): T[] {
  const statement = seedDatabase.prepare(sql);
  const rows: T[] = [];

  try {
    statement.bind(params as never[]);
    while (statement.step()) {
      rows.push(statement.getAsObject() as T);
    }
  } finally {
    statement.free();
  }

  return rows;
}

function seedTableExists(seedDatabase: Database, tableName: string): boolean {
  return (
    selectSeedRows<{ name: string }>(seedDatabase, "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", [
      tableName
    ]).length > 0
  );
}

function seedTableColumns(seedDatabase: Database, tableName: string): Set<string> {
  return new Set(selectSeedRows<{ name: string }>(seedDatabase, `PRAGMA table_info(${quoteIdentifier(tableName)})`).map((row) => row.name));
}

function userOwnedMusicVideoIds(database: DatabaseService): Set<string> {
  return new Set(
    database
      .select<{ youtube_video_id: string }>(
        "SELECT youtube_video_id FROM hololive_music_videos WHERE COALESCE(source_kind, 'official') = 'user'"
      )
      .map((row) => row.youtube_video_id)
      .filter(Boolean)
  );
}

function selectOfficialImageCacheRows(seedDatabase: Database): SeedRow[] {
  return seedTableExists(seedDatabase, "hololive_image_cache")
    ? selectSeedRows(seedDatabase, `SELECT c.*
         FROM hololive_image_cache c
         INNER JOIN hololive_idols i ON i.id = c.idol_id
         WHERE i.source = 'official'
         ORDER BY c.idol_id, c.kind`)
    : [];
}

export async function repairBundledOfficialImageCache(
  options: ImageCacheRepairOptions
): Promise<OfficialImageCacheRepairResult> {
  const seedDirectory = options.paths.seedDirectory;
  const seedDatabasePath = seedDirectory ? path.join(seedDirectory, "holoshelf-template.sqlite") : "";
  if (!seedDirectory || !fs.existsSync(seedDatabasePath)) {
    options.log?.("[official-data] image cache repair skipped: bundled seed template database is missing");
    return { copiedImageFiles: 0, imageCacheRows: 0, reason: "missing-seed" };
  }

  const copiedImageFiles = copyMissingDirectoryEntries(
    path.join(seedDirectory, "images", "hololive"),
    options.paths.hololiveImageDirectory
  );
  const SQL = await initSqlJs({
    locateFile: () => resolveSqlWasmPath()
  });
  const seedDatabase = new SQL.Database(fs.readFileSync(seedDatabasePath));
  let imageCacheRows = 0;

  try {
    imageCacheRows = upsertRows(options.database, "hololive_image_cache", selectOfficialImageCacheRows(seedDatabase), [
      "idol_id",
      "kind"
    ]);
  } finally {
    seedDatabase.close();
  }

  options.log?.(`[official-data] image cache repaired images=${copiedImageFiles} imageCacheRows=${imageCacheRows}`);
  return { copiedImageFiles, imageCacheRows };
}

function upsertRows(
  database: DatabaseService,
  tableName: string,
  rows: SeedRow[],
  conflictColumns: string[],
  updateColumns?: string[]
): number {
  if (rows.length === 0) {
    return 0;
  }

  const columns = Object.keys(rows[0]);
  const effectiveUpdateColumns = updateColumns ?? columns.filter((column) => !conflictColumns.includes(column));
  const conflictSql = conflictColumns.map(quoteIdentifier).join(", ");
  const updateSql =
    effectiveUpdateColumns.length > 0
      ? `DO UPDATE SET ${effectiveUpdateColumns
          .map((column) => `${quoteIdentifier(column)} = excluded.${quoteIdentifier(column)}`)
          .join(", ")}`
      : "DO NOTHING";
  const sql = `INSERT INTO ${quoteIdentifier(tableName)} (${columns.map(quoteIdentifier).join(", ")})
               VALUES (${placeholders(columns.length)})
               ON CONFLICT(${conflictSql}) ${updateSql}`;

  for (const row of rows) {
    database.run(
      sql,
      columns.map((column) => row[column] ?? null)
    );
  }

  return rows.length;
}

function upsertOfficialStats(database: DatabaseService, rows: SeedRow[]): number {
  if (rows.length === 0) {
    return 0;
  }

  for (const row of rows) {
    database.run(
      `INSERT INTO hololive_music_video_stats (youtube_video_id, view_count, fetched_at)
       VALUES (?, ?, ?)
       ON CONFLICT(youtube_video_id) DO UPDATE SET
         view_count = excluded.view_count,
         fetched_at = excluded.fetched_at
       WHERE excluded.fetched_at >= hololive_music_video_stats.fetched_at`,
      [row.youtube_video_id, row.view_count, row.fetched_at]
    );
  }

  return rows.length;
}

function copyMissingDirectoryEntries(sourceDirectory: string, targetDirectory: string): number {
  if (!fs.existsSync(sourceDirectory)) {
    return 0;
  }

  let copied = 0;
  fs.mkdirSync(targetDirectory, { recursive: true });

  for (const entry of fs.readdirSync(sourceDirectory, { withFileTypes: true })) {
    const source = path.join(sourceDirectory, entry.name);
    const target = path.join(targetDirectory, entry.name);

    if (entry.isDirectory()) {
      copied += copyMissingDirectoryEntries(source, target);
      continue;
    }

    if (entry.isFile() && !fs.existsSync(target)) {
      fs.copyFileSync(source, target);
      copied += 1;
    }
  }

  return copied;
}

function count(database: DatabaseService, sql: string, params: unknown[] = []): number {
  return Number(database.select<{ count: number }>(sql, params)[0]?.count ?? 0);
}

function hasUserOwnedMusicReferences(database: DatabaseService, row: MissingMusicRow): boolean {
  const videoId = row.youtube_video_id;
  const itemId = row.item_id;
  const markerKeys = [`video:${videoId}`, row.canonical_performance_key?.trim() ?? ""].filter(Boolean);

  if (
    markerKeys.length > 0 &&
    count(
      database,
      `SELECT COUNT(*) AS count
       FROM hololive_music_marker_keys
       WHERE marker_key IN (${placeholders(markerKeys.length)})`,
      markerKeys
    ) > 0
  ) {
    return true;
  }

  const videoReferenceQueries: Array<[string, unknown[]]> = [
    ["SELECT COUNT(*) AS count FROM hololive_music_exclusions WHERE youtube_video_id = ?", [videoId]],
    ["SELECT COUNT(*) AS count FROM hololive_music_playlist_items WHERE youtube_video_id = ?", [videoId]],
    ["SELECT COUNT(*) AS count FROM hololive_music_queue_items WHERE youtube_video_id = ?", [videoId]],
    ["SELECT COUNT(*) AS count FROM hololive_music_player_state WHERE current_youtube_video_id = ?", [videoId]],
    ["SELECT COUNT(*) AS count FROM hololive_bracket_entries WHERE youtube_video_id = ?", [videoId]],
    ["SELECT COUNT(*) AS count FROM hololive_bracket_archive_entries WHERE youtube_video_id = ?", [videoId]],
    [
      `SELECT COUNT(*) AS count
       FROM hololive_bracket_archive_matches
       WHERE entry_a_youtube_video_id = ?
          OR entry_b_youtube_video_id = ?
          OR winner_youtube_video_id = ?
          OR loser_youtube_video_id = ?`,
      [videoId, videoId, videoId, videoId]
    ]
  ];

  if (videoReferenceQueries.some(([sql, params]) => count(database, sql, params) > 0)) {
    return true;
  }

  return (
    count(
      database,
      `SELECT COUNT(*) AS count
       FROM tracked_entries
       WHERE item_id = ?
         AND (
           status != 'planned'
           OR rating IS NOT NULL
           OR NULLIF(TRIM(COALESCE(notes, '')), '') IS NOT NULL
           OR started_at IS NOT NULL
           OR completed_at IS NOT NULL
         )`,
      [itemId]
    ) > 0 ||
    count(database, "SELECT COUNT(*) AS count FROM list_items WHERE item_id = ?", [itemId]) > 0
  );
}

function deleteOfficialMusicRow(database: DatabaseService, row: MissingMusicRow): void {
  const videoId = row.youtube_video_id.trim();
  const itemIds = [
    row.item_id,
    ...database
      .select<{ item_id: string }>(
        `SELECT item_id
         FROM source_refs
         WHERE source_id = 'holodex' AND source_key = ?`,
        [videoId]
      )
      .map((sourceRow) => sourceRow.item_id)
  ].filter((itemId, index, values) => itemId && values.indexOf(itemId) === index);

  if (itemIds.length > 0) {
    database.run(`DELETE FROM catalog_items WHERE id IN (${placeholders(itemIds.length)})`, itemIds);
  }

  database.run("DELETE FROM source_refs WHERE source_id = 'holodex' AND source_key = ?", [videoId]);
  database.run("DELETE FROM hololive_music_videos WHERE youtube_video_id = ?", [videoId]);
  database.run("DELETE FROM hololive_music_detail_cache WHERE youtube_video_id = ?", [videoId]);
  database.run("DELETE FROM hololive_music_video_stats WHERE youtube_video_id = ?", [videoId]);
  database.run("DELETE FROM hololive_music_duplicate_removals WHERE removed_youtube_video_id = ? OR kept_youtube_video_id = ?", [
    videoId,
    videoId
  ]);
}

function pruneMissingOfficialMusicRows(
  database: DatabaseService,
  officialYoutubeVideoIds: Set<string>
): Pick<OfficialDataMergeResult, "prunedMissingRows" | "preservedMissingRows"> {
  const rows = database.select<MissingMusicRow>(
    `SELECT v.youtube_video_id, v.item_id, v.canonical_performance_key
     FROM hololive_music_videos v
     INNER JOIN hololive_idols i ON i.id = v.idol_id
     WHERE i.source = 'official'
       AND COALESCE(v.source_kind, 'official') = 'official'
     ORDER BY v.youtube_video_id`
  );
  const missingRows = rows.filter((row) => !officialYoutubeVideoIds.has(row.youtube_video_id));

  if (officialYoutubeVideoIds.size === 0) {
    return { prunedMissingRows: 0, preservedMissingRows: missingRows.length };
  }

  let prunedMissingRows = 0;
  let preservedMissingRows = 0;

  for (const row of missingRows) {
    if (hasUserOwnedMusicReferences(database, row)) {
      preservedMissingRows += 1;
      continue;
    }

    deleteOfficialMusicRow(database, row);
    prunedMissingRows += 1;
  }

  return { prunedMissingRows, preservedMissingRows };
}

export async function mergeBundledOfficialData(options: MergeOptions): Promise<OfficialDataMergeResult> {
  const previousVersion = options.database.getSettings()[OFFICIAL_DATA_VERSION_SETTING] ?? null;
  const seedDirectory = options.paths.seedDirectory;
  const manifest = seedDirectory ? readOfficialDataManifest(seedDirectory) : null;
  const bundledVersion = manifest?.version ?? null;
  const emptyResult: OfficialDataMergeResult = {
    status: "skipped",
    bundledVersion,
    previousVersion,
    mergedAt: null,
    musicRows: 0,
    idols: 0,
    channels: 0,
    catalogItems: 0,
    sourceRefs: 0,
    itemTags: 0,
    detailCacheRows: 0,
    duplicateRemovalRows: 0,
    statsRows: 0,
    imageCacheRows: 0,
    copiedImageFiles: 0,
    copiedArtifactFiles: 0,
    prunedMissingRows: 0,
    preservedMissingRows: 0
  };

  if (!options.isPackaged) {
    return { ...emptyResult, reason: "unpackaged" };
  }

  const seedDatabasePath = seedDirectory ? path.join(seedDirectory, "holoshelf-template.sqlite") : "";
  if (!seedDirectory || !manifest || !fs.existsSync(seedDatabasePath)) {
    options.log?.("[official-data] skipped: bundled seed manifest or template database is missing");
    return { ...emptyResult, reason: "missing-seed" };
  }

  if (compareOfficialDataVersions(previousVersion, manifest.version) >= 0) {
    const imageRepair = await repairBundledOfficialImageCache(options);
    const copiedArtifactFiles = copyMissingDirectoryEntries(
      path.join(seedDirectory, "holodex-refresh"),
      path.join(options.paths.dataDirectory, "holodex-refresh")
    );

    options.log?.(
      `[official-data] skipped: user database already has version ${previousVersion}; repaired seed files images=${imageRepair.copiedImageFiles} artifacts=${copiedArtifactFiles} imageCacheRows=${imageRepair.imageCacheRows}`
    );
    return {
      ...emptyResult,
      copiedImageFiles: imageRepair.copiedImageFiles,
      copiedArtifactFiles,
      imageCacheRows: imageRepair.imageCacheRows,
      reason: "current-version"
    };
  }

  const SQL = await initSqlJs({
    locateFile: () => resolveSqlWasmPath()
  });
  const seedDatabase = new SQL.Database(fs.readFileSync(seedDatabasePath));
  const mergedAt = options.now?.() ?? new Date().toISOString();

  try {
    const idolRows = seedTableExists(seedDatabase, "hololive_idols")
      ? selectSeedRows(seedDatabase, "SELECT * FROM hololive_idols WHERE source = 'official' ORDER BY sort_order")
      : [];
    const channelRows = seedTableExists(seedDatabase, "hololive_channels")
      ? selectSeedRows(seedDatabase, "SELECT * FROM hololive_channels ORDER BY id")
      : [];
    let catalogRows = seedTableExists(seedDatabase, "catalog_items")
      ? selectSeedRows(
          seedDatabase,
          `SELECT *
           FROM catalog_items
           WHERE id IN (SELECT item_id FROM hololive_music_videos)
           ORDER BY id`
        )
      : [];
    let sourceRefRows = seedTableExists(seedDatabase, "source_refs")
      ? selectSeedRows(seedDatabase, `SELECT 'holodex-source:' || source_key AS id, item_id, source_id, source_key, detail_url, cover_url, created_at, updated_at
           FROM source_refs
           WHERE source_id = 'holodex'
             AND item_id IN (SELECT item_id FROM hololive_music_videos)
           ORDER BY source_key`)
      : [];
    let tagRows = seedTableExists(seedDatabase, "item_tags")
      ? selectSeedRows(
          seedDatabase,
          `SELECT item_id, tag
           FROM item_tags
           WHERE item_id IN (SELECT item_id FROM hololive_music_videos)
           ORDER BY item_id, tag`
        )
      : [];
    let trackedRows = seedTableExists(seedDatabase, "tracked_entries")
      ? selectSeedRows(seedDatabase, `SELECT 'official-tracked:' || item_id AS id, item_id, 'planned' AS status,
                  NULL AS rating, NULL AS notes, NULL AS started_at, NULL AS completed_at,
                  created_at, updated_at
           FROM tracked_entries
           WHERE item_id IN (SELECT item_id FROM hololive_music_videos)
           ORDER BY item_id`)
      : [];
    let detailRows = seedTableExists(seedDatabase, "hololive_music_detail_cache")
      ? selectSeedRows(seedDatabase, "SELECT * FROM hololive_music_detail_cache ORDER BY youtube_video_id")
      : [];
    let duplicateRows = seedTableExists(seedDatabase, "hololive_music_duplicate_removals")
      ? selectSeedRows(seedDatabase, `SELECT removed_youtube_video_id, removed_title, kept_youtube_video_id, kept_title, reason,
                  song_name, removed_published_at, kept_published_at, NULL AS source_run_id, updated_at
           FROM hololive_music_duplicate_removals
           ORDER BY removed_youtube_video_id`)
      : [];
    const seedMusicColumns = seedTableExists(seedDatabase, "hololive_music_videos")
      ? seedTableColumns(seedDatabase, "hololive_music_videos")
      : new Set<string>();
    const sourceKindSelect = seedMusicColumns.has("source_kind") ? "source_kind" : "'official' AS source_kind";
    let musicRows = seedTableExists(seedDatabase, "hololive_music_videos")
      ? selectSeedRows(seedDatabase, `SELECT youtube_video_id, item_id, idol_id, youtube_url, title, status, topic_id,
                  channel_id, channel_name, published_at, duration_seconds, song_name, original_channel_id,
                  provided_to_youtube, participants_json, participant_idol_ids_json, canonical_song_key,
                  canonical_performance_key, owned_idol_ids_json, featured_idol_ids_json, ${sourceKindSelect}, NULL AS source_run_id,
                  updated_at
           FROM hololive_music_videos
           WHERE ${seedMusicColumns.has("source_kind") ? "source_kind = 'official'" : "1 = 1"}
           ORDER BY youtube_video_id`)
      : [];
    const userVideoIds = userOwnedMusicVideoIds(options.database);
    if (userVideoIds.size > 0) {
      musicRows = musicRows.filter((row) => !userVideoIds.has(String(row.youtube_video_id ?? "")));
    }
    const officialMusicItemIds = new Set(musicRows.map((row) => String(row.item_id ?? "")).filter(Boolean));
    const officialMusicVideoIds = new Set(musicRows.map((row) => String(row.youtube_video_id ?? "")).filter(Boolean));
    catalogRows = catalogRows.filter((row) => officialMusicItemIds.has(String(row.id ?? "")));
    sourceRefRows = sourceRefRows.filter((row) => officialMusicItemIds.has(String(row.item_id ?? "")));
    tagRows = tagRows.filter((row) => officialMusicItemIds.has(String(row.item_id ?? "")));
    trackedRows = trackedRows.filter((row) => officialMusicItemIds.has(String(row.item_id ?? "")));
    detailRows = detailRows.filter((row) => officialMusicVideoIds.has(String(row.youtube_video_id ?? "")));
    duplicateRows = duplicateRows.filter((row) => {
      const removedId = String(row.removed_youtube_video_id ?? "");
      const keptId = String(row.kept_youtube_video_id ?? "");
      return officialMusicVideoIds.has(removedId) && (!keptId || officialMusicVideoIds.has(keptId));
    });
    const statsRows = seedTableExists(seedDatabase, "hololive_music_video_stats")
      ? selectSeedRows(seedDatabase, "SELECT * FROM hololive_music_video_stats ORDER BY youtube_video_id").filter((row) =>
          officialMusicVideoIds.has(String(row.youtube_video_id ?? ""))
        )
      : [];
    const imageCacheRows = selectOfficialImageCacheRows(seedDatabase);
    const officialVideoIds = new Set(musicRows.map((row) => String(row.youtube_video_id ?? "")).filter(Boolean));
    const copiedImageFiles = copyMissingDirectoryEntries(
      path.join(seedDirectory, "images", "hololive"),
      options.paths.hololiveImageDirectory
    );
    const copiedArtifactFiles = copyMissingDirectoryEntries(
      path.join(seedDirectory, "holodex-refresh"),
      path.join(options.paths.dataDirectory, "holodex-refresh")
    );
    let prunedMissingRows = 0;
    let preservedMissingRows = 0;
    let counts = {
      idols: 0,
      channels: 0,
      catalogItems: 0,
      sourceRefs: 0,
      itemTags: 0,
      trackedRows: 0,
      detailCacheRows: 0,
      duplicateRemovalRows: 0,
      musicRows: 0,
      statsRows: 0,
      imageCacheRows: 0
    };

    options.database.transaction(() => {
      counts = {
        idols: upsertRows(options.database, "hololive_idols", idolRows, ["id"]),
        channels: upsertRows(options.database, "hololive_channels", channelRows, ["id"]),
        catalogItems: upsertRows(options.database, "catalog_items", catalogRows, ["id"]),
        sourceRefs: upsertRows(options.database, "source_refs", sourceRefRows, ["source_id", "source_key"], [
          "item_id",
          "detail_url",
          "cover_url",
          "updated_at"
        ]),
        itemTags: upsertRows(options.database, "item_tags", tagRows, ["item_id", "tag"], []),
        trackedRows: upsertRows(options.database, "tracked_entries", trackedRows, ["item_id"], []),
        detailCacheRows: upsertRows(options.database, "hololive_music_detail_cache", detailRows, ["youtube_video_id"]),
        duplicateRemovalRows: upsertRows(options.database, "hololive_music_duplicate_removals", duplicateRows, [
          "removed_youtube_video_id"
        ]),
        musicRows: upsertRows(options.database, "hololive_music_videos", musicRows, ["youtube_video_id"]),
        statsRows: upsertOfficialStats(options.database, statsRows),
        imageCacheRows: upsertRows(options.database, "hololive_image_cache", imageCacheRows, ["idol_id", "kind"])
      };
      options.database.repairHololiveMusicClassifications();
      options.database.repairHololiveMusicDuplicateRows("official-data-merge");

      const pruneResult = pruneMissingOfficialMusicRows(options.database, officialVideoIds);
      prunedMissingRows = pruneResult.prunedMissingRows;
      preservedMissingRows = pruneResult.preservedMissingRows;

      const storedSummary = {
        version: manifest.version,
        previousVersion,
        mergedAt,
        generatedAt: manifest.generatedAt,
        musicRows: counts.musicRows,
        prunedMissingRows,
        preservedMissingRows,
        copiedImageFiles,
        copiedArtifactFiles
      };
      options.database.setSetting(OFFICIAL_DATA_VERSION_SETTING, manifest.version);
      options.database.setSetting(OFFICIAL_DATA_MERGED_AT_SETTING, mergedAt);
      options.database.setSetting(OFFICIAL_DATA_MERGE_SUMMARY_SETTING, JSON.stringify(storedSummary));
    });

    const result: OfficialDataMergeResult = {
      status: "merged",
      bundledVersion: manifest.version,
      previousVersion,
      mergedAt,
      musicRows: counts.musicRows,
      idols: counts.idols,
      channels: counts.channels,
      catalogItems: counts.catalogItems,
      sourceRefs: counts.sourceRefs,
      itemTags: counts.itemTags,
      detailCacheRows: counts.detailCacheRows,
      duplicateRemovalRows: counts.duplicateRemovalRows,
      statsRows: counts.statsRows,
      imageCacheRows: counts.imageCacheRows,
      copiedImageFiles,
      copiedArtifactFiles,
      prunedMissingRows,
      preservedMissingRows
    };
    options.log?.(
      `[official-data] merged version=${manifest.version} previous=${previousVersion ?? "none"} musicRows=${counts.musicRows} prunedMissing=${prunedMissingRows} preservedMissing=${preservedMissingRows}`
    );
    return result;
  } finally {
    seedDatabase.close();
  }
}
