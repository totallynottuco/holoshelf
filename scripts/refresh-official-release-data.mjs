import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const sharp = require("sharp");

const TRANSPARENT_PIXEL = { r: 0, g: 0, b: 0, alpha: 0 };
const CARD_IMAGE_CACHE_VERSION = 2;
const CARD_CANVAS_SIZE = 1024;
const CARD_SUBJECT_TARGET_SIZE = 992;
const CARD_SUBJECT_BOTTOM_PAD = 12;
const CARD_ALPHA_THRESHOLD = 12;

function readArg(name, fallback = "") {
  const prefix = `--${name}=`;
  const arg = process.argv.find((entry) => entry.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : fallback;
}

function readNumberArg(name, fallback) {
  const rawValue = readArg(name, "");
  if (!rawValue) {
    return fallback;
  }
  const value = Number(rawValue);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function showHelp() {
  console.log(`
Refresh Holoshelf official release data and regenerate the bundled seed.

Usage:
  npm run release:data:refresh -- [options]

Common options:
  --db=data/holoshelf.sqlite              Source release database to refresh.
  --backups=%APPDATA%/Holoshelf/release-data-backups
                                           Backup directory for the source database.
  --artifacts=data/holodex-refresh/latest Directory for refresh audit artifacts.
  --version=2026-06-29T120000Z            Official data version to stamp.
  --skip-stats                            Refresh Holodex song data but skip YouTube stats.
  --skip-holodex                          Skip Holodex refresh and only stamp/seed current DB data.
  --skip-images                           Skip high-resolution talent card image refresh.
  --keep-existing                         Keep existing Holodex rows instead of replacing official rows.
  --keep-source-api-keys                  Do not remove API key settings from the source DB after refresh.
  --no-seed                               Do not regenerate resources/seed after refresh.

API keys:
  HOLODEX_API_KEY or --holodex-key=...
  YOUTUBE_API_KEY or --youtube-key=...

Rate-limit controls:
  --page-size=50
  --page-limit=10
  --collab-page-limit=1
  --max-requests=76
  --window-ms=120000
  --video-stats-limit=10000
`);
}

if (hasFlag("help") || hasFlag("h")) {
  showHelp();
  process.exit(0);
}

let DatabaseService;
let HolodexMusicService;
let YouTubeVideoStatsService;
try {
  ({ DatabaseService } = require("../dist-electron/electron/services/database.js"));
  ({ HolodexMusicService } = require("../dist-electron/electron/services/holodexMusicService.js"));
  ({ YouTubeVideoStatsService } = require("../dist-electron/electron/services/youtubeVideoStatsService.js"));
} catch (error) {
  throw new Error(
    `Compiled Electron services are missing. Run "npm run build" before this script. Original error: ${
      error instanceof Error ? error.message : String(error)
    }`
  );
}

function defaultDatabasePath() {
  return process.env.HOLOSHELF_RELEASE_DATABASE_PATH || process.env.HOLOSHELF_DATABASE_PATH || "data/holoshelf.sqlite";
}

function defaultBackupDirectory() {
  if (process.env.HOLOSHELF_RELEASE_BACKUP_DIR) {
    return path.resolve(process.env.HOLOSHELF_RELEASE_BACKUP_DIR);
  }

  return path.join(process.env.APPDATA || os.tmpdir(), "Holoshelf", "release-data-backups");
}

function defaultImagesDirectory() {
  return process.env.HOLOSHELF_RELEASE_IMAGES_DIR || "data/images/hololive";
}

function makeOfficialDataVersion(date = new Date()) {
  const iso = date.toISOString();
  return `${iso.slice(0, 10)}T${iso.slice(11, 19).replace(/:/g, "")}Z`;
}

function csvEscape(value) {
  if (value === null || value === undefined) {
    return "";
  }

  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function writeCsv(filePath, rows) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (rows.length === 0) {
    fs.writeFileSync(filePath, "", "utf8");
    return;
  }

  const headers = Object.keys(rows[0]);
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((header) => csvEscape(row[header])).join(","));
  }
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
}

function resolveFromRoot(value) {
  return path.resolve(root, value);
}

function officialMusicVideoIds(database) {
  const officialIdolIds = database
    .listHololiveIdols()
    .filter((idol) => idol.source !== "custom")
    .map((idol) => idol.id);
  const videoIds = new Set();

  for (const idolId of officialIdolIds) {
    for (const row of database.listHololiveMusicRows({ idolId, limit: 5000 })) {
      videoIds.add(row.youtubeVideoId);
    }
  }

  return [...videoIds].sort();
}

function artifactSummary(database) {
  return {
    totalMusicRows: database.getHololiveMusicStatus().totalRows,
    totalChannels: database.select("SELECT COUNT(*) AS count FROM hololive_channels")[0]?.count ?? 0,
    officialIdols: database.select("SELECT COUNT(*) AS count FROM hololive_idols WHERE source = 'official'")[0]?.count ?? 0,
    customIdols: database.select("SELECT COUNT(*) AS count FROM hololive_idols WHERE source = 'custom'")[0]?.count ?? 0,
    statsRows: database.select("SELECT COUNT(*) AS count FROM hololive_music_video_stats")[0]?.count ?? 0,
    detailCacheRows: database.select("SELECT COUNT(*) AS count FROM hololive_music_detail_cache")[0]?.count ?? 0,
    duplicateRemovalRows:
      database.select("SELECT COUNT(*) AS count FROM hololive_music_duplicate_removals")[0]?.count ?? 0
  };
}

function exportArtifacts(database, artifactDirectory, summary) {
  fs.rmSync(artifactDirectory, { recursive: true, force: true });
  fs.mkdirSync(artifactDirectory, { recursive: true });
  fs.writeFileSync(path.join(artifactDirectory, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");

  writeCsv(
    path.join(artifactDirectory, "hololive_music_videos.csv"),
    database.select(
      `SELECT youtube_video_id, idol_id, title, song_name, topic_id, status, youtube_url,
              channel_id, channel_name, published_at, duration_seconds, original_channel_id,
              provided_to_youtube, canonical_song_key, canonical_performance_key,
              owned_idol_ids_json, featured_idol_ids_json, participants_json,
              participant_idol_ids_json, updated_at
       FROM hololive_music_videos
       ORDER BY COALESCE(published_at, ''), youtube_video_id`
    )
  );
  writeCsv(
    path.join(artifactDirectory, "hololive_music_video_stats.csv"),
    database.select(
      `SELECT youtube_video_id, view_count, fetched_at
       FROM hololive_music_video_stats
       ORDER BY youtube_video_id`
    )
  );
  writeCsv(
    path.join(artifactDirectory, "hololive_music_detail_cache.csv"),
    database.select(
      `SELECT youtube_video_id, channel_id, duration_seconds, original_channel_id,
              provided_to_youtube, description, song_names_json, mentions_json, collab_channel_ids_json,
              relationships_loaded, updated_at
       FROM hololive_music_detail_cache
       ORDER BY youtube_video_id`
    )
  );
  writeCsv(
    path.join(artifactDirectory, "hololive_music_duplicate_removals.csv"),
    database.select(
      `SELECT removed_youtube_video_id, removed_title, kept_youtube_video_id, kept_title,
              reason, song_name, removed_published_at, kept_published_at, source_run_id, updated_at
       FROM hololive_music_duplicate_removals
       ORDER BY removed_youtube_video_id`
    )
  );
  writeCsv(
    path.join(artifactDirectory, "hololive_channels.csv"),
    database.select(
      `SELECT id, name, english_name, type, org, group_name, photo_url, twitter, video_count,
              subscriber_count, clip_count, published_at, inactive, kind,
              main_idol_ids_json, topic_idol_ids_json, linked_idol_ids_json, updated_at
       FROM hololive_channels
       ORDER BY kind, name, id`
    )
  );
}

function cardCacheFileName(slug) {
  return `${slug}-card-v${CARD_IMAGE_CACHE_VERSION}.png`;
}

async function optimizeTalentCardImage(bytes) {
  try {
    const subject = await sharp(bytes, { animated: false, failOn: "none" })
      .rotate()
      .ensureAlpha()
      .trim({ background: TRANSPARENT_PIXEL, threshold: CARD_ALPHA_THRESHOLD })
      .png()
      .toBuffer();
    const scaled = await sharp(subject)
      .resize({
        width: CARD_SUBJECT_TARGET_SIZE,
        height: CARD_SUBJECT_TARGET_SIZE,
        fit: "inside",
        withoutEnlargement: false
      })
      .png()
      .toBuffer();
    const metadata = await sharp(scaled).metadata();
    const scaledWidth = Math.max(1, metadata.width ?? CARD_SUBJECT_TARGET_SIZE);
    const scaledHeight = Math.max(1, metadata.height ?? CARD_SUBJECT_TARGET_SIZE);

    return await sharp({
      create: {
        width: CARD_CANVAS_SIZE,
        height: CARD_CANVAS_SIZE,
        channels: 4,
        background: TRANSPARENT_PIXEL
      }
    })
      .composite([
        {
          input: scaled,
          left: Math.round((CARD_CANVAS_SIZE - scaledWidth) / 2),
          top: Math.max(0, CARD_CANVAS_SIZE - scaledHeight - CARD_SUBJECT_BOTTOM_PAD)
        }
      ])
      .png()
      .toBuffer();
  } catch {
    return await sharp(bytes, { animated: false, failOn: "none" })
      .rotate()
      .resize({
        width: CARD_CANVAS_SIZE,
        height: CARD_CANVAS_SIZE,
        fit: "contain",
        background: TRANSPARENT_PIXEL
      })
      .png()
      .toBuffer();
  }
}

async function refreshTalentCardImages(database, imagesDirectory, log) {
  fs.mkdirSync(imagesDirectory, { recursive: true });
  const existingCache = new Map(database.listHololiveImageCaches().map((entry) => [`${entry.idolId}:${entry.kind}`, entry]));
  const idols = database.listHololiveIdols().filter((idol) => idol.source !== "custom");
  const cacheEntries = [];
  let cached = 0;
  let skipped = 0;
  let failed = 0;

  async function refreshOne(idol) {
    const sourceUrl = idol.cardImageUrl || idol.profileImageUrl || idol.iconUrl;
    if (!sourceUrl) {
      failed += 1;
      return;
    }

    const localFilename = cardCacheFileName(idol.slug);
    const localPath = path.join(imagesDirectory, localFilename);
    const existing = existingCache.get(`${idol.id}:card`);
    if (existing?.sourceUrl === sourceUrl && existing.localFilename === localFilename && fs.existsSync(localPath) && fs.statSync(localPath).size > 0) {
      skipped += 1;
      return;
    }

    try {
      const parsedUrl = new URL(sourceUrl);
      if (parsedUrl.protocol !== "https:") {
        throw new Error("unsupported image protocol");
      }
      const response = await fetch(parsedUrl, {
        redirect: "follow",
        headers: {
          "User-Agent": "Holoshelf release card image cache"
        }
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const contentType = response.headers.get("content-type")?.split(";")[0] ?? null;
      if (contentType && !contentType.startsWith("image/")) {
        throw new Error(`Unexpected content type ${contentType}`);
      }
      const optimized = await optimizeTalentCardImage(Buffer.from(await response.arrayBuffer()));
      fs.writeFileSync(localPath, optimized);
      for (const entry of fs.readdirSync(imagesDirectory)) {
        if (
          entry !== localFilename &&
          entry.startsWith(`${idol.slug}-card`) &&
          (entry.endsWith(".webp") || entry.endsWith(".png"))
        ) {
          try {
            fs.rmSync(path.join(imagesDirectory, entry), { force: true });
          } catch {
            // Stale card cleanup is best-effort; a locked old file should not fail a refreshed card.
          }
        }
      }
      cacheEntries.push({
        idolId: idol.id,
        kind: "card",
        sourceUrl,
        localFilename,
        mimeType: "image/png",
        sizeBytes: optimized.length
      });
      cached += 1;
    } catch (error) {
      failed += 1;
      log(`Card image failed for ${idol.displayName}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const workerCount = Math.min(6, idols.length);
  let nextIndex = 0;
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < idols.length) {
        const idol = idols[nextIndex];
        nextIndex += 1;
        await refreshOne(idol);
      }
    })
  );

  database.upsertHololiveImageCaches(cacheEntries);
  return { cached, skipped, failed, total: idols.length };
}

function regenerateSeed(officialDataVersion, generatedAt) {
  const result = spawnSync(process.execPath, [path.join(root, "scripts", "create-release-seed.mjs")], {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      HOLOSHELF_OFFICIAL_DATA_VERSION: officialDataVersion,
      HOLOSHELF_OFFICIAL_DATA_MERGED_AT: generatedAt,
      HOLOSHELF_SEED_GENERATED_AT: generatedAt
    }
  });

  if (result.status !== 0) {
    throw new Error(`Seed generation failed with exit code ${result.status ?? "unknown"}`);
  }
}

async function main() {
  const startedAt = new Date().toISOString();
  const dbPath = resolveFromRoot(readArg("db", defaultDatabasePath()));
  const backupDirectory = readArg("backups", defaultBackupDirectory());
  const artifactDirectory = resolveFromRoot(readArg("artifacts", "data/holodex-refresh/latest"));
  const imagesDirectory = resolveFromRoot(readArg("images", defaultImagesDirectory()));
  const officialDataVersion = readArg("version", process.env.HOLOSHELF_OFFICIAL_DATA_VERSION || makeOfficialDataVersion());
  const holodexApiKey = readArg("holodex-key", process.env.HOLODEX_API_KEY || "");
  const youtubeApiKey = readArg("youtube-key", process.env.YOUTUBE_API_KEY || "");
  const pageSize = readNumberArg("page-size", 50);
  const pageLimit = readNumberArg("page-limit", null);
  const collabPageLimit = readNumberArg("collab-page-limit", 1);
  const maxRequestsPerWindow = readNumberArg("max-requests", 76);
  const requestWindowMs = readNumberArg("window-ms", 120000);
  const videoStatsLimit = readNumberArg("video-stats-limit", null);
  const replaceExisting = !hasFlag("keep-existing");
  const refreshHolodex = !hasFlag("skip-holodex");
  const refreshStats = !hasFlag("skip-stats");
  const refreshImages = !hasFlag("skip-images");
  const refreshChannels = !hasFlag("skip-channels");
  const includeCollabs = !hasFlag("skip-collabs");
  const writeSeed = !hasFlag("no-seed");
  const clearSourceApiKeys = !hasFlag("keep-source-api-keys");

  if (!fs.existsSync(dbPath)) {
    throw new Error(`Release source database not found: ${dbPath}`);
  }

  const database = new DatabaseService(dbPath, backupDirectory);
  await database.init();

  const log = (message) => console.log(`[release-data] ${message}`);
  log(`Database: ${dbPath}`);
  log(`Backups: ${backupDirectory}`);
  log(`Artifacts: ${artifactDirectory}`);
  log(`Images: ${imagesDirectory}`);
  log(`Official data version: ${officialDataVersion}`);
  log(`Replace existing official Holodex rows: ${replaceExisting ? "yes" : "no"}`);

  let channelRefresh = null;
  let musicRefresh = null;
  let videoStatsRefresh = null;
  let imageRefresh = null;

  if (refreshHolodex) {
      const service = new HolodexMusicService(
        database,
        globalThis.fetch.bind(globalThis),
        (message) => log(message),
        { apiKey: holodexApiKey }
      );

      if (refreshChannels) {
        log("Refreshing Holodex channel metadata");
        channelRefresh = await service.refreshChannels();
      }

      log("Refreshing official Hololive song data from Holodex");
      musicRefresh = await service.refreshLive({
        includeChannels: false,
        includeCustomTalents: false,
        includeRelationships: true,
        includeCollabs,
        collabPageLimit,
        replaceExisting,
        pageLimit,
        pageSize,
        maxRequestsPerWindow,
        requestWindowMs
      });

      if (musicRefresh.run.status !== "completed") {
        throw new Error(musicRefresh.run.error || "Holodex official data refresh failed");
      }
    } else {
      log("Skipping Holodex refresh; stamping and seeding existing source database data");
    }

    if (refreshStats) {
      const settingsYoutubeApiKey = database.getSettings()["sources.youtubeApiKey"]?.trim() ?? "";
      if (!youtubeApiKey && !settingsYoutubeApiKey) {
        throw new Error("YouTube API key missing. Set YOUTUBE_API_KEY, pass --youtube-key=..., or use --skip-stats.");
      }

      const statsService = new YouTubeVideoStatsService(database, {
        apiKey: youtubeApiKey || null
      });
      const youtubeVideoIds = officialMusicVideoIds(database);
      log(`Refreshing YouTube stats for ${youtubeVideoIds.length} official video(s)`);
      videoStatsRefresh = await statsService.refreshViewCounts({
        youtubeVideoIds,
        limit: videoStatsLimit
      });
      if (videoStatsRefresh.failedBatches > 0) {
        throw new Error(
          `YouTube stats refresh failed for ${videoStatsRefresh.failedBatches}/${videoStatsRefresh.batches} batch(es)`
        );
      }
    } else {
      log("Skipping YouTube stats refresh");
    }

    const repairedDuplicateRows = database.repairHololiveMusicDuplicateRows("release-data-refresh");
    if (repairedDuplicateRows > 0) {
      log(`Repaired ${repairedDuplicateRows} official duplicate music row(s)`);
    }

    if (refreshImages) {
      log("Refreshing high-resolution talent card images");
      imageRefresh = await refreshTalentCardImages(database, imagesDirectory, log);
    } else {
      log("Skipping talent card image refresh");
    }

    const completedAt = new Date().toISOString();
    const counts = artifactSummary(database);
    const summary = {
      startedAt,
      completedAt,
      databasePath: dbPath,
      artifactDirectory,
      officialDataVersion,
      replaceExisting,
      refreshHolodex,
      refreshChannels,
      includeCollabs,
      refreshStats,
      refreshImages,
      channelRefresh,
      musicRefresh: musicRefresh
        ? {
            sourceRows: musicRefresh.sourceRows,
            importedRows: musicRefresh.importedRows,
            filteredRows: musicRefresh.run.filteredRows,
            duplicateRows: musicRefresh.duplicateRows,
            run: musicRefresh.run
          }
        : null,
      videoStatsRefresh,
      imageRefresh,
      counts
    };

    database.setSetting("hololive.officialDataVersion", officialDataVersion);
    database.setSetting("hololive.officialDataMergedAt", completedAt);
    database.setSetting("hololive.officialDataRefreshSummary", JSON.stringify(summary));

    if (clearSourceApiKeys) {
      database.run("DELETE FROM settings WHERE key IN (?, ?)", ["sources.holodexApiKey", "sources.youtubeApiKey"]);
      log("Removed API key settings from the source release database");
    }

    exportArtifacts(database, artifactDirectory, summary);

    if (writeSeed) {
      log("Regenerating bundled seed data");
      regenerateSeed(officialDataVersion, completedAt);
    }

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
