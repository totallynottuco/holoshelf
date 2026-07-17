import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseService } from "./database";
import { HolodexMusicService } from "./holodexMusicService";
import { parseYouTubeVideoId, YouTubeVideoStatsService } from "./youtubeVideoStatsService";
import { DEFAULT_HOLOLIVE_BOARD_NAME, DEFAULT_HOLOLIVE_TIERS, HOLOLIVE_IDOLS } from "../../src/modules/hololive/idols";
import { normalizeVideoDetail } from "../../src/modules/hololive/music/cleanup";
import type {
  HololiveBracket,
  HololiveBracketHistoryParticipation,
  HololiveCustomTalentPreview,
  HololiveMusicSourceKind,
  HololiveMusicTopic
} from "../../src/shared/contracts";
import type { HolodexArtifactBundle } from "../../src/modules/hololive/music/types";

let initializedTestDatabaseBytes: Promise<Uint8Array> | null = null;

function getInitializedTestDatabaseBytes(): Promise<Uint8Array> {
  initializedTestDatabaseBytes ??= (async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "holoshelf-db-template-"));
    const databasePath = path.join(dir, "template.sqlite");
    const database = new DatabaseService(databasePath, undefined, { createBackups: false });
    await database.init();
    return fs.readFileSync(databasePath);
  })();
  return initializedTestDatabaseBytes;
}

async function createTempDatabase(): Promise<DatabaseService> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "holoshelf-db-"));
  const database = new DatabaseService(path.join(dir, "test.sqlite"), undefined, {
    persistWrites: false,
    createBackups: false,
    initializedDatabaseBytes: await getInitializedTestDatabaseBytes()
  });
  await database.init();
  return database;
}

async function createTempDatabaseAt(databasePath: string): Promise<DatabaseService> {
  const database = new DatabaseService(databasePath);
  await database.init();
  return database;
}

function createHolodexArtifactFixture(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "holoshelf-holodex-artifacts-"));
  fs.writeFileSync(
    path.join(dir, "holodex_videos.csv"),
    [
      "youtube_video_id,youtube_url,title,status,topic_id,channel_name,published_at",
      "fixture-sora-original,https://www.youtube.com/watch?v=fixture-sora-original,Sora Fixture Original,past,Original_Song,Sora Channel,2025-01-01T00:00:00.000Z",
      "fixture-roboco-cover,https://www.youtube.com/watch?v=fixture-roboco-cover,Roboco Fixture Cover,past,Music_Cover,Roboco Channel,2025-01-02T00:00:00.000Z"
    ].join("\n"),
    "utf8"
  );
  fs.writeFileSync(
    path.join(dir, "holodex_video_details_cache.json"),
    `${JSON.stringify(
      {
        "fixture-sora-original": {
          youtube_video_id: "fixture-sora-original",
          channel_id: "UCp6993wxpyDPHUpavwDFqgg",
          duration: 180,
          song_names: ["Sora Fixture Original"]
        },
        "fixture-roboco-cover": {
          youtube_video_id: "fixture-roboco-cover",
          channel_id: "UCDqI2jOz0weumE8s7paEk6g",
          duration: 210,
          song_names: ["Roboco Fixture Cover"]
        }
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  return dir;
}

function seedHololiveBracketSong(
  database: DatabaseService,
  input: {
    idolId: string;
    idolName: string;
    channelId: string;
    topicId: "Original_Song" | "Music_Cover";
    suffix: string;
    viewCount: number;
    publishedAt?: string;
    canonicalPerformanceKey?: string;
    sourceKind?: HololiveMusicSourceKind;
  }
): void {
  const now = new Date().toISOString();
  const youtubeVideoId = `${input.idolId}-${input.suffix}`;
  const itemId = `holodex:${youtubeVideoId}`;
  const title = `${input.idolName} ${input.topicId === "Original_Song" ? "Original" : "Cover"} ${input.suffix}`;
  const youtubeUrl = `https://www.youtube.com/watch?v=${youtubeVideoId}`;
  const canonicalPerformanceKey =
    input.canonicalPerformanceKey ?? `${input.idolId}:${input.topicId}:${input.suffix}`;

  database.run(
    `INSERT OR REPLACE INTO catalog_items (id, module_id, kind, title, subtitle, source_url, created_at, updated_at)
     VALUES (?, 'hololive', 'music', ?, ?, ?, ?, ?)`,
    [itemId, title, input.idolName, youtubeUrl, now, now]
  );
  database.run(
    `INSERT OR REPLACE INTO source_refs (id, item_id, source_id, source_key, detail_url, cover_url, created_at, updated_at)
     VALUES (?, ?, 'holodex', ?, ?, NULL, ?, ?)`,
    [`holodex:${youtubeVideoId}`, itemId, youtubeVideoId, youtubeUrl, now, now]
  );
  database.run(
    `INSERT OR REPLACE INTO hololive_music_videos
       (youtube_video_id, item_id, idol_id, youtube_url, title, status, topic_id, channel_id, channel_name,
        published_at, duration_seconds, song_name, original_channel_id, provided_to_youtube,
        participants_json, participant_idol_ids_json, source_run_id, updated_at,
        canonical_song_key, canonical_performance_key, owned_idol_ids_json, featured_idol_ids_json, source_kind)
     VALUES (?, ?, ?, ?, ?, 'past', ?, ?, ?, ?, 210, ?, NULL, 0, ?, ?, NULL, ?, ?, ?, ?, '[]', ?)`,
    [
      youtubeVideoId,
      itemId,
      input.idolId,
      youtubeUrl,
      title,
      input.topicId,
      input.channelId,
      `${input.idolName} Channel`,
      input.publishedAt ?? now,
      title,
      JSON.stringify([{ idolId: input.idolId, role: "primary", channelId: input.channelId }]),
      JSON.stringify([input.idolId]),
      now,
      `${input.idolId}:${input.topicId}`,
      canonicalPerformanceKey,
      JSON.stringify([input.idolId]),
      input.sourceKind ?? "official"
    ]
  );
  database.upsertHololiveMusicVideoStats([
    {
      youtubeVideoId,
      viewCount: input.viewCount,
      fetchedAt: now
    }
  ]);
}

function archiveHololiveBracketVideos(
  database: DatabaseService,
  archiveId: string,
  videos: Array<{
    youtubeVideoId: string;
    isChampion?: boolean;
    isFinalist?: boolean;
    isTop4?: boolean;
    isTop8?: boolean;
  }>
): void {
  const now = new Date().toISOString();
  database.run(
    `INSERT INTO hololive_bracket_archives
       (id, source_bracket_id, name, size, generation_style, generation_filters_json, seed,
        total_entries, total_matches, completed_matches, champion_youtube_video_id, champion_title,
        champion_idol_id, champion_idol_name, created_at, completed_at, archived_at, updated_at)
     VALUES (?, ?, ?, 'RO16', 'top_songs', '{}', ?, ?, 0, 0, NULL, NULL, NULL, NULL, ?, ?, ?, ?)`,
    [archiveId, `${archiveId}:source`, archiveId, archiveId, videos.length, now, now, now, now]
  );

  videos.forEach((video, index) => {
    const row = database.select<{
      youtube_video_id: string;
      title: string;
      song_name: string | null;
      topic_id: HololiveMusicTopic;
      youtube_url: string;
      channel_name: string;
      idol_id: string;
      canonical_performance_key: string;
      published_at: string | null;
      duration_seconds: number | null;
      view_count: number | null;
    }>(
      `SELECT v.youtube_video_id, v.title, v.song_name, v.topic_id, v.youtube_url, v.channel_name,
              v.idol_id, v.canonical_performance_key, v.published_at, v.duration_seconds, stats.view_count
       FROM hololive_music_videos v
       LEFT JOIN hololive_music_video_stats stats ON stats.youtube_video_id = v.youtube_video_id
      WHERE v.youtube_video_id = ?`,
      [video.youtubeVideoId]
    )[0];
    if (!row) {
      throw new Error(`Missing archive seed video: ${video.youtubeVideoId}`);
    }
    const idol = database.listHololiveIdols().find((candidate) => candidate.id === row.idol_id);
    if (!idol) {
      throw new Error(`Missing archive seed video: ${video.youtubeVideoId}`);
    }
    database.run(
      `INSERT INTO hololive_bracket_archive_entries
         (id, archive_id, source_entry_id, slot_index, youtube_video_id, title_snapshot, song_name_snapshot,
          topic_id, youtube_url_snapshot, channel_name_snapshot, idol_id_snapshot, idol_name_snapshot,
          canonical_performance_key, view_count_snapshot, published_at_snapshot, duration_seconds_snapshot,
          wins, losses, final_rank, eliminated_round_index, eliminated_by_youtube_video_id,
          first_round_eliminated, is_champion, is_finalist, is_top4, is_top8, is_top16)
       VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, NULL, NULL, NULL, 0, ?, ?, ?, ?, 0)`,
      [
        `${archiveId}:entry:${index}`,
        archiveId,
        index,
        row.youtube_video_id,
        row.title,
        row.song_name,
        row.topic_id,
        row.youtube_url,
        row.channel_name,
        row.idol_id,
        idol.displayName,
        row.canonical_performance_key,
        row.view_count,
        row.published_at,
        row.duration_seconds,
        video.isChampion ? 1 : 0,
        video.isFinalist || video.isChampion ? 1 : 0,
        video.isTop4 || video.isFinalist || video.isChampion ? 1 : 0,
        video.isTop8 || video.isTop4 || video.isFinalist || video.isChampion ? 1 : 0
      ]
    );
  });
}

function expectNoFirstRoundSameTalent(bracket: HololiveBracket): void {
  for (const match of bracket.rounds[0]?.matches ?? []) {
    expect(match.entryA?.idolId).toBeTruthy();
    expect(match.entryB?.idolId).toBeTruthy();
    expect(match.entryA?.idolId).not.toBe(match.entryB?.idolId);
  }
}

function expectDuplicateTalentsSpreadAcrossQuadrants(bracket: HololiveBracket): void {
  const entriesByIdol = new Map<string, HololiveBracket["entries"]>();
  for (const entry of bracket.entries) {
    entriesByIdol.set(entry.idolId, [...(entriesByIdol.get(entry.idolId) ?? []), entry]);
  }

  for (const entries of entriesByIdol.values()) {
    if (entries.length < 2) {
      continue;
    }
    const quadrants = new Set(entries.map((entry) => Math.floor(entry.slotIndex / 4)));
    expect(quadrants.size).toBe(entries.length);
  }
}

async function completeBracket(database: DatabaseService, bracket: HololiveBracket): Promise<HololiveBracket> {
  let next = bracket;
  while (next.currentMatch?.entryA) {
    next = await database.pickHololiveBracketWinner({
      bracketId: next.id,
      matchId: next.currentMatch.id,
      winnerEntryId: next.currentMatch.entryA.id
    });
  }
  return next;
}

describe("DatabaseService", () => {
  it("applies migrations and reports empty stats", async () => {
    const database = await createTempDatabase();
    expect(database.getStats()).toEqual({
      catalogItems: 0,
      trackedEntries: 0,
      fetchJobsQueued: 0,
      coversCached: 0
    });
    expect(
      database.select<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'hololive_music_marker_keys'")
    ).toEqual([{ name: "hololive_music_marker_keys" }]);
    expect(
      database.select<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'hololive_music_markers'")
    ).toEqual([]);
    expect(
      database.select<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'hololive_music_exclusions'")
    ).toEqual([{ name: "hololive_music_exclusions" }]);
    expect(
      database.select<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'hololive_music_video_stats'")
    ).toEqual([{ name: "hololive_music_video_stats" }]);
    expect(
      database.select<{ name: string }>("PRAGMA table_info(hololive_music_marker_keys)").map((row) => row.name)
    ).toContain("favorite_position");
    expect(
      database.select<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_hololive_music_playlist_items_playlist_video_unique'"
      )
    ).toEqual([{ name: "idx_hololive_music_playlist_items_playlist_video_unique" }]);
    expect(
      database.select<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'hololive_brackets'")
    ).toEqual([{ name: "hololive_brackets" }]);
    expect(
      database.select<{ name: string }>("PRAGMA table_info(hololive_brackets)").map((row) => row.name)
    ).toContain("generation_style");
    expect(
      database.select<{ name: string }>("PRAGMA table_info(hololive_brackets)").map((row) => row.name)
    ).toContain("generation_filters_json");
    expect(
      database.select<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'hololive_bracket_archives'")
    ).toEqual([{ name: "hololive_bracket_archives" }]);
    expect(
      database.select<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'hololive_bracket_archive_entries'")
    ).toEqual([{ name: "hololive_bracket_archive_entries" }]);
    expect(
      database.select<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'hololive_bracket_archive_matches'")
    ).toEqual([{ name: "hololive_bracket_archive_matches" }]);
  });

  it("sorts the Hololive music library before pagination", async () => {
    const database = await createTempDatabase();
    const seedSong = (suffix: string, publishedAt: string, viewCount: number) => {
      seedHololiveBracketSong(database, {
        idolId: "tokino-sora",
        idolName: `Sort ${suffix}`,
        channelId: `sort-channel-${suffix}`,
        topicId: "Original_Song",
        suffix,
        viewCount,
        publishedAt
      });
      return `tokino-sora-${suffix}`;
    };
    const older = seedSong("older", "2024-01-01T00:00:00.000Z", 500);
    const newest = seedSong("newest", "2026-01-01T00:00:00.000Z", 100);
    const middle = seedSong("middle", "2025-01-01T00:00:00.000Z", 1_000);
    const missingDate = seedSong("missing-date", "2027-01-01T00:00:00.000Z", 700);
    const missingViews = seedSong("missing-views", "2023-01-01T00:00:00.000Z", 2_000);
    database.run("UPDATE hololive_music_videos SET published_at = NULL WHERE youtube_video_id = ?", [missingDate]);
    database.run("DELETE FROM hololive_music_video_stats WHERE youtube_video_id = ?", [missingViews]);

    const videoIds = (sort?: "newest" | "oldest" | "views_desc" | "views_asc", offset = 0, limit = 10) =>
      database.listHololiveMusicLibrary({ sort, offset, limit }).rows.map((row) => row.youtubeVideoId);

    expect(videoIds()).toEqual([newest, middle, older, missingViews, missingDate]);
    expect(videoIds("oldest")).toEqual([missingViews, older, middle, newest, missingDate]);
    expect(videoIds("views_desc")).toEqual([middle, missingDate, older, newest, missingViews]);
    expect(videoIds("views_asc")).toEqual([newest, older, missingDate, middle, missingViews]);
    expect(videoIds("views_desc", 1, 2)).toEqual([missingDate, older]);
  });

  it("filters the Hololive music library by talent appearance and collaboration scope before pagination", async () => {
    const database = await createTempDatabase();
    seedHololiveBracketSong(database, {
      idolId: "tokino-sora",
      idolName: "Tokino Sora",
      channelId: "sora-channel",
      topicId: "Original_Song",
      suffix: "solo",
      viewCount: 100,
      publishedAt: "2026-01-01T00:00:00.000Z"
    });
    seedHololiveBracketSong(database, {
      idolId: "gawr-gura",
      idolName: "Gawr Gura",
      channelId: "gura-channel",
      topicId: "Original_Song",
      suffix: "featured",
      viewCount: 90,
      publishedAt: "2026-01-02T00:00:00.000Z"
    });
    seedHololiveBracketSong(database, {
      idolId: "tokino-sora",
      idolName: "Tokino Sora",
      channelId: "group-channel",
      topicId: "Music_Cover",
      suffix: "group",
      viewCount: 80,
      publishedAt: "2026-01-03T00:00:00.000Z"
    });
    database.run(
      `INSERT OR REPLACE INTO hololive_channels
         (id, name, english_name, type, org, group_name, photo_url, twitter, video_count, subscriber_count, clip_count,
          published_at, inactive, kind, main_idol_ids_json, topic_idol_ids_json, linked_idol_ids_json, updated_at)
       VALUES ('group-channel', 'Group Channel', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
          NULL, 0, 'group', '[]', '[]', '[]', ?)`,
      [new Date().toISOString()]
    );
    database.run(
      `UPDATE hololive_music_videos
       SET participants_json = ?, participant_idol_ids_json = ?, featured_idol_ids_json = ?
       WHERE youtube_video_id = ?`,
      [
        JSON.stringify([
          { idolId: "gawr-gura", role: "primary", channelId: "gura-channel" },
          { idolId: "tokino-sora", role: "collab", channelId: "sora-channel" }
        ]),
        JSON.stringify(["gawr-gura", "tokino-sora"]),
        JSON.stringify(["tokino-sora"]),
        "gawr-gura-featured"
      ]
    );

    const ids = (collabScope?: "all" | "solo") =>
      database
        .listHololiveMusicLibrary({ talentId: "tokino-sora", collabScope, sort: "oldest", limit: 10 })
        .rows.map((row) => row.youtubeVideoId);

    expect(ids()).toEqual(["tokino-sora-solo", "gawr-gura-featured", "tokino-sora-group"]);
    expect(ids("solo")).toEqual(["tokino-sora-solo"]);
  });

  it("exports manual backups and replaces the database only from valid backup files", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "holoshelf-db-manual-backup-"));
    const databasePath = path.join(dir, "test.sqlite");
    const exportedPath = path.join(dir, "exports", "User Backup");
    const replacementPath = path.join(dir, "replacement.holoshelf-backup");
    const legacyReplacementPath = path.join(dir, "replacement.db");
    const database = await createTempDatabaseAt(databasePath);
    database.setSetting("data-safety.test", "original");

    const exported = database.exportDatabaseBackupToFile(exportedPath);
    expect(exported).toMatchObject({ exported: true });
    expect(exported.filePath).toBe(`${exportedPath}.holoshelf-backup`);
    expect(fs.existsSync(exported.filePath)).toBe(true);

    const replacement = await createTempDatabaseAt(replacementPath);
    replacement.setSetting("data-safety.test", "replacement");
    const importResult = database.replaceDatabaseFromFile(replacementPath, "import");
    expect(importResult.backup.created).toBe(true);
    expect(importResult.backup.filePath ? fs.existsSync(importResult.backup.filePath) : false).toBe(true);

    const reopened = await createTempDatabaseAt(databasePath);
    expect(reopened.getSettings()["data-safety.test"]).toBe("replacement");
    const legacyReplacement = await createTempDatabaseAt(legacyReplacementPath);
    legacyReplacement.setSetting("data-safety.test", "legacy");
    reopened.replaceDatabaseFromFile(legacyReplacementPath, "import");

    const reopenedLegacy = await createTempDatabaseAt(databasePath);
    expect(reopenedLegacy.getSettings()["data-safety.test"]).toBe("legacy");
    expect(() => reopenedLegacy.replaceDatabaseFromFile(path.join(dir, "missing.sqlite"), "import")).toThrow(
      "The selected file is not a valid Holoshelf SQLite database."
    );
  });

  it("creates a rolling autosave before startup migration work when a database already exists", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "holoshelf-db-startup-backup-"));
    const databasePath = path.join(dir, "test.sqlite");
    const firstConnection = await createTempDatabaseAt(databasePath);
    firstConnection.setSetting("backup.test", "before-reopen");

    await createTempDatabaseAt(databasePath);

    expect(fs.existsSync(path.join(dir, "backups", "holoshelf.autosave.1.sqlite"))).toBe(true);
  });

  it("creates a rolling autosave before replace-style Holodex imports", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "holoshelf-db-replace-backup-"));
    const databasePath = path.join(dir, "test.sqlite");
    const database = await createTempDatabaseAt(databasePath);
    const bundle: HolodexArtifactBundle = { rows: [], detailCache: {}, duplicateRemovals: [] };

    database.importHolodexMusicArtifacts(bundle, "live", { replaceExisting: true });

    expect(fs.existsSync(path.join(dir, "backups", "holoshelf.autosave.1.sqlite"))).toBe(true);
  });

  it("creates and persists Hololive song brackets from view stats", async () => {
    const database = await createTempDatabase();
    const officialIdols = database.listHololiveIdols().filter((idol) => idol.source === "official").slice(0, 10);

    officialIdols.forEach((idol, index) => {
      database.run("UPDATE hololive_channels SET subscriber_count = ? WHERE id = ?", [
        2_000_000 - index * 10_000,
        idol.youtubeChannelId
      ]);
      seedHololiveBracketSong(database, {
        idolId: idol.id,
        idolName: idol.displayName,
        channelId: idol.youtubeChannelId ?? `channel-${idol.id}`,
        topicId: "Original_Song",
        suffix: "original",
        viewCount: 1_000_000 - index * 1000,
        publishedAt: `2025-01-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`
      });
      seedHololiveBracketSong(database, {
        idolId: idol.id,
        idolName: idol.displayName,
        channelId: idol.youtubeChannelId ?? `channel-${idol.id}`,
        topicId: "Music_Cover",
        suffix: "cover",
        viewCount: 900_000 - index * 1000,
        publishedAt: `2025-02-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`
      });
    });

    const bracket = await database.createHololiveBracket({ size: "RO16", name: "Test Bracket" });
    const expectedIdolIds = officialIdols.map((idol) => idol.id);

    expect(bracket.name).toBe("Test Bracket");
    expect(bracket.generationStyle).toBe("top_songs");
    expect(bracket.entries).toHaveLength(16);
    expect(new Set(bracket.entries.map((entry) => entry.canonicalPerformanceKey)).size).toBe(16);
    expect([...new Set(bracket.entries.map((entry) => entry.idolId))].sort()).toEqual([...expectedIdolIds].sort());
    expect(bracket.entries.filter((entry) => entry.topicId === "Original_Song")).toHaveLength(10);
    expect(bracket.entries.filter((entry) => entry.topicId === "Music_Cover")).toHaveLength(6);
    expectNoFirstRoundSameTalent(bracket);
    expectDuplicateTalentsSpreadAcrossQuadrants(bracket);
    expect(database.listHololiveBrackets()[0]).toMatchObject({
      id: bracket.id,
      name: "Test Bracket",
      size: "RO16",
      generationStyle: "top_songs",
      completedMatches: 0,
      totalMatches: 15
    });

    const firstMatch = bracket.currentMatch;
    expect(firstMatch?.entryA).toBeTruthy();
    expect(firstMatch?.entryB).toBeTruthy();

    const picked = await database.pickHololiveBracketWinner({
      bracketId: bracket.id,
      matchId: firstMatch?.id ?? "",
      winnerEntryId: firstMatch?.entryA?.id ?? ""
    });
    expect(picked.rounds[1].matches[0].entryA?.id).toBe(firstMatch?.entryA?.id);
    expect(picked.currentMatchId).toBe(`${bracket.id}:r0:m1`);
    expect(database.listHololiveBrackets()[0].completedMatches).toBe(1);

    const undone = await database.undoHololiveBracket(bracket.id);
    expect(undone.currentMatchId).toBe(firstMatch?.id);
    expect(undone.rounds[1].matches[0].entryA).toBeNull();
    expect(undone.rounds[0].matches[0].winnerEntryId).toBeNull();

    const pickedAgain = await database.pickHololiveBracketWinner({
      bracketId: bracket.id,
      matchId: firstMatch?.id ?? "",
      winnerEntryId: firstMatch?.entryB?.id ?? ""
    });
    expect(pickedAgain.rounds[1].matches[0].entryA?.id).toBe(firstMatch?.entryB?.id);

    const reset = await database.resetHololiveBracket(bracket.id);
    expect(reset.currentMatchId).toBe(firstMatch?.id);
    expect(reset.rounds[0].matches.every((match) => match.winnerEntryId === null)).toBe(true);
    expect(reset.rounds.slice(1).flatMap((round) => round.matches).every((match) => !match.entryA && !match.entryB)).toBe(
      true
    );

    const duplicate = await database.duplicateHololiveBracket(bracket.id);
    expect(duplicate.id).not.toBe(bracket.id);
    expect(duplicate.name).toBe("Copy of Test Bracket");
    expect(duplicate.status).toBe("active");
    expect(duplicate.currentMatchId).toBe(`${duplicate.id}:r0:m0`);
    expect(duplicate.entries.map((entry) => entry.youtubeVideoId)).toEqual(bracket.entries.map((entry) => entry.youtubeVideoId));
    expect(duplicate.entries.every((entry) => entry.bracketId === duplicate.id)).toBe(true);
    expect(duplicate.rounds[0]?.matches[0]?.entryA?.id).toBe(`${duplicate.id}:entry:0`);
    expect(duplicate.rounds.flatMap((round) => round.matches).every((match) => match.winnerEntryId === null)).toBe(true);
    expect(duplicate.rounds.slice(1).flatMap((round) => round.matches).every((match) => !match.entryA && !match.entryB)).toBe(
      true
    );

    expect(database.deleteHololiveBracket(bracket.id)).toHaveLength(1);
    expect(database.deleteHololiveBracket(duplicate.id)).toEqual([]);
  });

  it("replays active bracket results sequentially and removes them on undo and reset", async () => {
    const database = await createTempDatabase();
    const officialIdols = database.listHololiveIdols().filter((idol) => idol.source === "official").slice(0, 8);
    officialIdols.forEach((idol, index) => {
      for (const topicId of ["Original_Song", "Music_Cover"] as const) {
        seedHololiveBracketSong(database, {
          idolId: idol.id,
          idolName: idol.displayName,
          channelId: idol.youtubeChannelId ?? `channel-${idol.id}`,
          topicId,
          suffix: `live-${topicId}-${index}`,
          viewCount: 2_000_000 - index * 10_000
        });
      }
    });

    let bracket = await database.createHololiveBracket({ size: "RO16", name: "Live Ratings" });
    const firstWinner = bracket.currentMatch?.entryA;
    expect(firstWinner).toBeTruthy();

    for (let index = 0; index < 8; index += 1) {
      bracket = await database.pickHololiveBracketWinner({
        bracketId: bracket.id,
        matchId: bracket.currentMatch?.id ?? "",
        winnerEntryId: bracket.currentMatch?.entryA?.id ?? ""
      });
    }
    expect(bracket.currentMatch?.entryA?.id).toBe(firstWinner?.id);
    bracket = await database.pickHololiveBracketWinner({
      bracketId: bracket.id,
      matchId: bracket.currentMatch?.id ?? "",
      winnerEntryId: bracket.currentMatch?.entryA?.id ?? ""
    });

    const liveStats = database.getHololiveBracketStatsOverview();
    const firstWinnerStats = liveStats.songStats.find((song) => song.youtubeVideoId === firstWinner?.youtubeVideoId);
    expect(liveStats.totals.completedBrackets).toBe(0);
    expect(liveStats.totals.totalMatches).toBe(9);
    expect(firstWinnerStats).toMatchObject({ wins: 2, losses: 0, appearances: 0, championCount: 0 });
    const history = database.getHololiveBracketStatHistory(
      "song",
      firstWinnerStats?.canonicalPerformanceKey ?? "",
      "rating"
    );
    const ratingEntries = history.entries.filter((entry) => entry.kind === "rating").reverse();
    expect(ratingEntries).toHaveLength(2);
    expect(ratingEntries.every((entry) => entry.source === "active")).toBe(true);
    expect(ratingEntries[1]?.beforeRating).toBeCloseTo(ratingEntries[0]?.afterRating ?? 0, 8);
    expect(ratingEntries[1]?.beforeRatingDeviation).toBeCloseTo(ratingEntries[0]?.afterRatingDeviation ?? 0, 8);
    expect(history.total).toBe(2);
    const winsHistory = database.getHololiveBracketStatHistory(
      "song",
      firstWinnerStats?.canonicalPerformanceKey ?? "",
      "wins",
      "all",
      0,
      1
    );
    expect(winsHistory).toMatchObject({ qualifyingCount: 2, total: 2, offset: 0, limit: 1, hasMore: true });
    expect(winsHistory.entries).toHaveLength(1);
    expect(winsHistory.entries[0]).toMatchObject({ kind: "match", source: "active", result: "win" });
    expect(
      database.getHololiveBracketStatHistory(
        "song",
        firstWinnerStats?.canonicalPerformanceKey ?? "",
        "wins",
        "double_elimination"
      )
    ).toMatchObject({ qualifyingCount: 0, total: 0, entries: [] });
    expect(
      database.getHololiveBracketStatHistory(
        "song",
        firstWinnerStats?.canonicalPerformanceKey ?? "",
        "wins",
        "all",
        1,
        1
      )
    ).toMatchObject({ total: 2, offset: 1, hasMore: false });
    expect(
      database.getHololiveBracketStatHistory(
        "song",
        firstWinnerStats?.canonicalPerformanceKey ?? "",
        "titles"
      )
    ).toMatchObject({ qualifyingCount: 0, total: 0, entries: [] });

    bracket = await database.undoHololiveBracket(bracket.id);
    expect(database.getHololiveBracketStatsOverview().totals.totalMatches).toBe(8);
    expect(
      database.getHololiveBracketStatHistory(
        "song",
        firstWinnerStats?.canonicalPerformanceKey ?? "",
        "rating"
      ).entries
    ).toHaveLength(1);

    bracket = await database.resetHololiveBracket(bracket.id);
    expect(database.getHololiveBracketStatsOverview().totals).toEqual({
      completedBrackets: 0,
      totalMatches: 0,
      uniqueSongs: 0,
      uniqueTalents: 0
    });

    bracket = await database.pickHololiveBracketWinner({
      bracketId: bracket.id,
      matchId: bracket.currentMatch?.id ?? "",
      winnerEntryId: bracket.currentMatch?.entryA?.id ?? ""
    });
    expect(database.getHololiveBracketStatsOverview("single_elimination").totals.totalMatches).toBe(1);
    expect(database.getHololiveBracketStatsOverview("double_elimination").totals.totalMatches).toBe(0);
    database.deleteHololiveBracket(bracket.id);
    expect(database.getHololiveBracketStatsOverview().totals.totalMatches).toBe(0);
  });

  it("archives completed brackets for durable stats and preserves archives after saved bracket deletion", async () => {
    const database = await createTempDatabase();
    const officialIdols = database.listHololiveIdols().filter((idol) => idol.source === "official").slice(0, 8);

    officialIdols.forEach((idol, index) => {
      seedHololiveBracketSong(database, {
        idolId: idol.id,
        idolName: idol.displayName,
        channelId: idol.youtubeChannelId ?? `channel-${idol.id}`,
        topicId: "Original_Song",
        suffix: "archive-original",
        viewCount: 2_000_000 - index,
        publishedAt: `2025-05-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`
      });
      seedHololiveBracketSong(database, {
        idolId: idol.id,
        idolName: idol.displayName,
        channelId: idol.youtubeChannelId ?? `channel-${idol.id}`,
        topicId: "Music_Cover",
        suffix: "archive-cover",
        viewCount: 1_000_000 - index,
        publishedAt: `2025-06-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`
      });
    });

    const bracket = await database.createHololiveBracket({ size: "RO16", name: "Archive Bracket" });
    const completed = await completeBracket(database, bracket);
    expect(completed.status).toBe("complete");
    expect(completed.champion).toBeTruthy();

    const archives = database.listHololiveBracketArchives();
    expect(archives).toHaveLength(1);
    expect(archives[0]).toMatchObject({
      sourceBracketId: bracket.id,
      name: "Archive Bracket",
      size: "RO16",
      completedMatches: 15,
      totalMatches: 15,
      totalEntries: 16,
      championYoutubeVideoId: completed.champion?.youtubeVideoId
    });
    expect(
      database.select<{ count: number }>(
        "SELECT COUNT(*) AS count FROM hololive_bracket_archive_entries WHERE archive_id = ?",
        [archives[0].id]
      )[0]?.count
    ).toBe(16);
    expect(
      database.select<{ count: number }>(
        "SELECT COUNT(*) AS count FROM hololive_bracket_archive_matches WHERE archive_id = ?",
        [archives[0].id]
      )[0]?.count
    ).toBe(15);

    const stats = database.getHololiveBracketStatsOverview();
    expect(stats.totals).toEqual({
      completedBrackets: 1,
      totalMatches: 15,
      uniqueSongs: 16,
      uniqueTalents: 8
    });
    expect(stats.songStats).toHaveLength(16);
    expect(stats.talentStats).toHaveLength(8);
    expect(stats.rivalryStats.length).toBeGreaterThan(0);
    expect(Array.isArray(stats.finalsRivalryStats)).toBe(true);
    expect(stats.topSongsByWins[0]).toMatchObject({
      youtubeVideoId: completed.champion?.youtubeVideoId,
      wins: 4,
      losses: 0,
      championCount: 1,
      finalistCount: 1,
      top4Count: 1,
      top8Count: 1,
      top16Count: 1
    });
    expect(stats.topSongsByFinalsWithoutTitle[0]).toMatchObject({
      finalistCount: 1,
      championCount: 0
    });
    expect(stats.topSongsByFirstRoundEliminations[0]?.firstRoundEliminations).toBe(1);
    expect(stats.topTalents[0]?.wins).toBeGreaterThan(0);
    expect(stats.topTalentsByTop4[0]?.top4Count).toBeGreaterThan(0);
    const championSong = stats.songStats.find((row) => row.youtubeVideoId === completed.champion?.youtubeVideoId);
    const championRating = stats.topSongRatings.find((row) => row.id === championSong?.canonicalPerformanceKey);
    expect(championRating).toMatchObject({
      wins: 4,
      losses: 0,
      matches: 4
    });
    expect(championRating?.rating).toBeGreaterThan(1500);
    expect(championRating?.conservativeRating).toBeCloseTo((championRating?.rating ?? 0) - (championRating?.ratingDeviation ?? 0) * 2);
    expect(championRating?.conservativeRating).toBeLessThan(championRating?.rating ?? Number.POSITIVE_INFINITY);
    expect(championRating?.ratingDeviation).toBeLessThan(350);
    expect(stats.topTalentRatings.length).toBeGreaterThan(0);
    expect(stats.topTalentRatings[0]?.matches).toBeGreaterThan(0);
    const titleHistory = database.getHololiveBracketStatHistory(
      "song",
      championSong?.canonicalPerformanceKey ?? "",
      "titles"
    );
    expect(titleHistory).toMatchObject({ currentValue: 1, qualifyingCount: 1, total: 1, hasMore: false });
    expect(titleHistory.entries[0]).toMatchObject({
      kind: "placement",
      source: "archive",
      placement: "champion",
      bracketName: "Archive Bracket"
    });
    expect(
      database.getHololiveBracketStatHistory(
        "song",
        championSong?.canonicalPerformanceKey ?? "",
        "deepRuns"
      ).entries[0]
    ).toMatchObject({ kind: "placement", placement: "top4" });

    const reset = await database.resetHololiveBracket(bracket.id);
    const recompleted = await completeBracket(database, reset);
    expect(recompleted.status).toBe("complete");
    expect(database.listHololiveBracketArchives()).toHaveLength(1);
    expect(database.listHololiveBracketArchives()[0].championYoutubeVideoId).toBe(recompleted.champion?.youtubeVideoId);

    expect(database.deleteHololiveBracket(bracket.id)).toEqual([]);
    expect(database.listHololiveBracketArchives()).toHaveLength(1);
    expect(database.getHololiveBracketStatsOverview().totals.completedBrackets).toBe(1);

    expect(database.deleteHololiveBracketArchive(archives[0].id)).toEqual([]);
    const archiveUndo = database.consumeLatestHololiveUndo("bracket-archive-delete");
    expect(archiveUndo?.undoToken).toBeTruthy();
    expect(
      database.select<{ count: number }>(
        "SELECT COUNT(*) AS count FROM hololive_bracket_archive_entries WHERE archive_id = ?",
        [archives[0].id]
      )[0]?.count
    ).toBe(0);
    expect(
      database.select<{ count: number }>(
        "SELECT COUNT(*) AS count FROM hololive_bracket_archive_matches WHERE archive_id = ?",
        [archives[0].id]
      )[0]?.count
    ).toBe(0);
    expect(database.getHololiveBracketStatsOverview().totals).toEqual({
      completedBrackets: 0,
      totalMatches: 0,
      uniqueSongs: 0,
      uniqueTalents: 0
    });
    expect(database.getHololiveBracketStatsOverview().topSongRatings).toEqual([]);

    database.applyHololiveUndo(archiveUndo?.undoToken ?? "");
    expect(database.listHololiveBracketArchives()).toHaveLength(1);
    expect(database.getHololiveBracketStatsOverview().totals.completedBrackets).toBe(1);
    expect(database.getHololiveBracketStatsOverview().topSongRatings.length).toBeGreaterThan(0);
  });

  it("repairs stale archives whose source bracket is active on every startup", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "holoshelf-stale-bracket-archive-"));
    const databasePath = path.join(dir, "test.sqlite");
    const database = await createTempDatabaseAt(databasePath);
    const officialIdols = database.listHololiveIdols().filter((idol) => idol.source === "official").slice(0, 8);
    officialIdols.forEach((idol, index) => {
      for (const topicId of ["Original_Song", "Music_Cover"] as const) {
        seedHololiveBracketSong(database, {
          idolId: idol.id,
          idolName: idol.displayName,
          channelId: idol.youtubeChannelId ?? `channel-${idol.id}`,
          topicId,
          suffix: `stale-archive-${topicId}-${index}`,
          viewCount: 1_000_000 - index
        });
      }
    });
    const completed = await completeBracket(
      database,
      await database.createHololiveBracket({ size: "RO16", name: "Stale Archive Source" })
    );
    expect(database.listHololiveBracketArchives()).toHaveLength(1);
    database.run("UPDATE hololive_brackets SET status = 'active' WHERE id = ?", [completed.id]);

    const reopened = await createTempDatabaseAt(databasePath);
    expect(reopened.listHololiveBracketArchives()).toEqual([]);
    expect(reopened.getHololiveBracketStatsOverview().totals.completedBrackets).toBe(0);
  });

  it("persists and archives a complete double-elimination bracket", async () => {
    const database = await createTempDatabase();
    const officialIdols = database.listHololiveIdols().filter((idol) => idol.source === "official").slice(0, 8);
    officialIdols.forEach((idol, index) => {
      for (const topicId of ["Original_Song", "Music_Cover"] as const) {
        seedHololiveBracketSong(database, {
          idolId: idol.id,
          idolName: idol.displayName,
          channelId: idol.youtubeChannelId ?? `channel-${idol.id}`,
          topicId,
          suffix: `double-${topicId}-${index}`,
          viewCount: 2_000_000 - index * 1000
        });
      }
    });

    const bracket = await database.createHololiveBracket({
      size: "RO16",
      format: "double_elimination",
      name: "Double Test"
    });
    expect(bracket.format).toBe("double_elimination");
    expect(bracket.rounds.flatMap((round) => round.matches)).toHaveLength(30);
    expect(bracket.rounds.some((round) => round.stage === "losers")).toBe(true);

    const completed = await completeBracket(database, bracket);
    expect(completed.status).toBe("complete");
    expect(completed.champion).toBeTruthy();
    expect(completed.rounds.find((round) => round.stage === "grand_final")?.matches[0]?.winnerEntryId).toBe(
      completed.champion?.id
    );

    const archive = database.listHololiveBracketArchives()[0];
    expect(archive).toMatchObject({
      sourceBracketId: bracket.id,
      format: "double_elimination",
      totalMatches: 30,
      completedMatches: 30
    });
    const archivedEntries = database.select<{
      final_rank: number | null;
      losses: number;
      first_round_eliminated: number;
    }>(
      `SELECT final_rank, losses, first_round_eliminated
       FROM hololive_bracket_archive_entries
       WHERE archive_id = ?`,
      [archive.id]
    );
    expect(archivedEntries.filter((entry) => entry.final_rank === 1)).toHaveLength(1);
    expect(archivedEntries.filter((entry) => entry.final_rank === 2)).toHaveLength(1);
    expect(archivedEntries.filter((entry) => entry.final_rank === 3)).toHaveLength(1);
    expect(archivedEntries.some((entry) => entry.first_round_eliminated === 1)).toBe(true);

    const allStats = database.getHololiveBracketStatsOverview("all");
    const doubleStats = database.getHololiveBracketStatsOverview("double_elimination");
    const singleStats = database.getHololiveBracketStatsOverview("single_elimination");
    expect(allStats.totals.completedBrackets).toBe(1);
    expect(doubleStats.totals.completedBrackets).toBe(1);
    expect(doubleStats.topSongsByFirstRoundEliminations[0]?.firstRoundEliminations).toBeGreaterThan(0);
    expect(doubleStats.topTalentsByEarlyExits[0]?.earlyExitCount).toBeGreaterThan(0);
    expect(singleStats.totals).toEqual({
      completedBrackets: 0,
      totalMatches: 0,
      uniqueSongs: 0,
      uniqueTalents: 0
    });

    const duplicate = await database.duplicateHololiveBracket(bracket.id);
    expect(duplicate).toMatchObject({
      format: "double_elimination",
      status: "active"
    });
    expect(duplicate.rounds.flatMap((round) => round.matches)).toHaveLength(30);
    expect(duplicate.rounds.flatMap((round) => round.matches).every((match) => !match.winnerEntryId)).toBe(true);
    const firstMatch = duplicate.currentMatch;
    expect(firstMatch?.entryA).toBeTruthy();
    const afterPick = await database.pickHololiveBracketWinner({
      bracketId: duplicate.id,
      matchId: firstMatch?.id ?? "",
      winnerEntryId: firstMatch?.entryA?.id ?? ""
    });
    expect(afterPick.rounds.flatMap((round) => round.matches).filter((match) => match.winnerEntryId)).toHaveLength(1);
    const afterUndo = await database.undoHololiveBracket(duplicate.id);
    expect(afterUndo.currentMatchId).toBe(firstMatch?.id);
    expect(afterUndo.rounds.flatMap((round) => round.matches).every((match) => !match.winnerEntryId)).toBe(true);
    const afterSecondPick = await database.pickHololiveBracketWinner({
      bracketId: duplicate.id,
      matchId: afterUndo.currentMatch?.id ?? "",
      winnerEntryId: afterUndo.currentMatch?.entryA?.id ?? ""
    });
    expect(afterSecondPick.currentMatchId).not.toBe(firstMatch?.id);
    const reset = await database.resetHololiveBracket(duplicate.id);
    expect(reset.currentMatchId).toBe(firstMatch?.id);
    expect(reset.rounds.flatMap((round) => round.matches).every((match) => !match.winnerEntryId)).toBe(true);
  });

  it("tracks bracket upset, big game, punching up, giant killer, and rivalry stats", async () => {
    const database = await createTempDatabase();
    const insertArchive = (input: {
      id: string;
      sourceBracketId: string;
      archivedAt: string;
      winnerVideoId: string;
      loserVideoId: string;
      winnerTitle: string;
      loserTitle: string;
      winnerIdolId: string;
      winnerIdolName: string;
      loserIdolId: string;
      loserIdolName: string;
      winnerViews: number;
      loserViews: number;
      loserEliminatedRoundIndex?: number;
      roundIndex?: number;
      matchIndex?: number;
    }) => {
      database.run(
        `INSERT INTO hololive_bracket_archives
           (id, source_bracket_id, name, size, generation_style, generation_filters_json, seed,
            total_entries, total_matches, completed_matches,
            champion_youtube_video_id, champion_title, champion_idol_id, champion_idol_name,
            created_at, completed_at, archived_at, updated_at)
         VALUES (?, ?, ?, 'RO16', 'top_songs', '{}', ?, 2, 1, 1, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          input.id,
          input.sourceBracketId,
          `Stats ${input.id}`,
          input.id,
          input.winnerVideoId,
          input.winnerTitle,
          input.winnerIdolId,
          input.winnerIdolName,
          input.archivedAt,
          input.archivedAt,
          input.archivedAt,
          input.archivedAt
        ]
      );
      for (const entry of [
        {
          videoId: input.winnerVideoId,
          title: input.winnerTitle,
          idolId: input.winnerIdolId,
          idolName: input.winnerIdolName,
          views: input.winnerViews,
          slotIndex: 0,
          wins: 1,
          losses: 0,
          isChampion: 1
        },
        {
          videoId: input.loserVideoId,
          title: input.loserTitle,
          idolId: input.loserIdolId,
          idolName: input.loserIdolName,
          views: input.loserViews,
          slotIndex: 1,
          wins: 0,
          losses: 1,
          isChampion: 0
        }
      ]) {
        database.run(
          `INSERT INTO hololive_bracket_archive_entries
             (id, archive_id, source_entry_id, slot_index, youtube_video_id, title_snapshot, song_name_snapshot,
              topic_id, youtube_url_snapshot, channel_name_snapshot, idol_id_snapshot, idol_name_snapshot,
              canonical_performance_key, view_count_snapshot, published_at_snapshot, duration_seconds_snapshot,
              wins, losses, final_rank, eliminated_round_index, eliminated_by_youtube_video_id,
              first_round_eliminated, is_champion, is_finalist, is_top4, is_top8, is_top16)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'Original_Song', ?, ?, ?, ?, ?, ?, ?, 210, ?, ?, ?, ?, ?, ?, ?, 1, 1, 1, 1)`,
          [
            `${input.id}:entry:${entry.slotIndex}`,
            input.id,
            `${input.id}:source:${entry.slotIndex}`,
            entry.slotIndex,
            entry.videoId,
            entry.title,
            entry.title,
            `https://www.youtube.com/watch?v=${entry.videoId}`,
            `${entry.idolName} Channel`,
            entry.idolId,
            entry.idolName,
            `${entry.idolId}:${entry.videoId}`,
            entry.views,
            input.archivedAt,
            entry.wins,
            entry.losses,
            entry.isChampion ? 1 : 2,
            entry.isChampion ? null : (input.loserEliminatedRoundIndex ?? 0),
            entry.isChampion ? null : input.winnerVideoId,
            entry.isChampion ? 0 : (input.loserEliminatedRoundIndex ?? 0) === 0 ? 1 : 0,
            entry.isChampion
          ]
        );
      }
      database.run(
        `INSERT INTO hololive_bracket_archive_matches
           (id, archive_id, source_match_id, round_index, match_index,
            entry_a_youtube_video_id, entry_b_youtube_video_id, winner_youtube_video_id, loser_youtube_video_id,
            completed_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          `${input.id}:match:0`,
          input.id,
          `${input.id}:source-match:0`,
          input.roundIndex ?? 0,
          input.matchIndex ?? 0,
          input.winnerVideoId,
          input.loserVideoId,
          input.winnerVideoId,
          input.loserVideoId,
          input.archivedAt,
          input.archivedAt
        ]
      );
    };

    insertArchive({
      id: "stats-archive-1",
      sourceBracketId: "stats-bracket-1",
      archivedAt: "2025-01-01T00:00:00.000Z",
      winnerVideoId: "high-view-song",
      loserVideoId: "low-view-song",
      winnerTitle: "High View Song",
      loserTitle: "Low View Song",
      winnerIdolId: "idol-high",
      winnerIdolName: "High Talent",
      loserIdolId: "idol-low",
      loserIdolName: "Low Talent",
      winnerViews: 1_000_000,
      loserViews: 100_000
    });
    insertArchive({
      id: "stats-archive-2",
      sourceBracketId: "stats-bracket-2",
      archivedAt: "2025-01-02T00:00:00.000Z",
      winnerVideoId: "low-view-song",
      loserVideoId: "high-view-song",
      winnerTitle: "Low View Song",
      loserTitle: "High View Song",
      winnerIdolId: "idol-low",
      winnerIdolName: "Low Talent",
      loserIdolId: "idol-high",
      loserIdolName: "High Talent",
      winnerViews: 100_000,
      loserViews: 1_000_000
    });
    insertArchive({
      id: "stats-archive-3",
      sourceBracketId: "stats-bracket-3",
      archivedAt: "2025-01-03T00:00:00.000Z",
      winnerVideoId: "steady-upset-song",
      loserVideoId: "big-target-song-a",
      winnerTitle: "Steady Upset Song",
      loserTitle: "Big Target Song A",
      winnerIdolId: "idol-steady",
      winnerIdolName: "Steady Talent",
      loserIdolId: "idol-big-a",
      loserIdolName: "Big Talent A",
      winnerViews: 500_000,
      loserViews: 1_100_000
    });
    insertArchive({
      id: "stats-archive-4",
      sourceBracketId: "stats-bracket-4",
      archivedAt: "2025-01-04T00:00:00.000Z",
      winnerVideoId: "steady-upset-song",
      loserVideoId: "big-target-song-b",
      winnerTitle: "Steady Upset Song",
      loserTitle: "Big Target Song B",
      winnerIdolId: "idol-steady",
      winnerIdolName: "Steady Talent",
      loserIdolId: "idol-big-b",
      loserIdolName: "Big Talent B",
      winnerViews: 500_000,
      loserViews: 1_100_000
    });
    insertArchive({
      id: "stats-archive-5",
      sourceBracketId: "stats-bracket-5",
      archivedAt: "2025-01-05T00:00:00.000Z",
      winnerVideoId: "same-talent-winner",
      loserVideoId: "same-talent-loser",
      winnerTitle: "Same Talent Winner",
      loserTitle: "Same Talent Loser",
      winnerIdolId: "idol-shared",
      winnerIdolName: "Shared Talent",
      loserIdolId: "idol-shared",
      loserIdolName: "Shared Talent",
      winnerViews: 800_000,
      loserViews: 900_000,
      roundIndex: 1,
      loserEliminatedRoundIndex: 1
    });
    insertArchive({
      id: "stats-archive-6",
      sourceBracketId: "stats-bracket-6",
      archivedAt: "2025-01-06T00:00:00.000Z",
      winnerVideoId: "fuwawa-win-song",
      loserVideoId: "fuwamoco-target-a",
      winnerTitle: "Fuwawa Win Song",
      loserTitle: "Fuwamoco Target A",
      winnerIdolId: "fuwawa-abyssgard",
      winnerIdolName: "Fuwawa Abyssgard",
      loserIdolId: "idol-high",
      loserIdolName: "High Talent",
      winnerViews: 700_000,
      loserViews: 750_000
    });
    insertArchive({
      id: "stats-archive-7",
      sourceBracketId: "stats-bracket-7",
      archivedAt: "2025-01-07T00:00:00.000Z",
      winnerVideoId: "fuwamoco-target-b",
      loserVideoId: "mococo-loss-song",
      winnerTitle: "Fuwamoco Target B",
      loserTitle: "Mococo Loss Song",
      winnerIdolId: "idol-low",
      winnerIdolName: "Low Talent",
      loserIdolId: "mococo-abyssgard",
      loserIdolName: "Mococo Abyssgard",
      winnerViews: 720_000,
      loserViews: 710_000
    });
    insertArchive({
      id: "stats-archive-8",
      sourceBracketId: "stats-bracket-8",
      archivedAt: "2025-01-08T00:00:00.000Z",
      winnerVideoId: "one-outlier-win-song",
      loserVideoId: "extreme-target-song",
      winnerTitle: "One Outlier Win Song",
      loserTitle: "Extreme Target Song",
      winnerIdolId: "idol-outlier",
      winnerIdolName: "Outlier Talent",
      loserIdolId: "idol-extreme",
      loserIdolName: "Extreme Talent",
      winnerViews: 250_000_000,
      loserViews: 200_000_000
    });
    for (let index = 0; index < 3; index += 1) {
      insertArchive({
        id: `stats-archive-consistent-${index}`,
        sourceBracketId: `stats-bracket-consistent-${index}`,
        archivedAt: `2025-01-${String(9 + index).padStart(2, "0")}T00:00:00.000Z`,
        winnerVideoId: `consistent-win-song-${index}`,
        loserVideoId: `strong-target-song-${index}`,
        winnerTitle: `Consistent Win Song ${index}`,
        loserTitle: `Strong Target Song ${index}`,
        winnerIdolId: "idol-consistent",
        winnerIdolName: "Consistent Talent",
        loserIdolId: `idol-strong-${index}`,
        loserIdolName: `Strong Talent ${index}`,
        winnerViews: 9_000_000,
        loserViews: 8_000_000
      });
    }
    insertArchive({
      id: "stats-archive-zero-views",
      sourceBracketId: "stats-bracket-zero-views",
      archivedAt: "2025-01-12T00:00:00.000Z",
      winnerVideoId: "zero-view-winner",
      loserVideoId: "zero-view-target",
      winnerTitle: "Zero View Winner",
      loserTitle: "Zero View Target",
      winnerIdolId: "idol-zero",
      winnerIdolName: "Zero Talent",
      loserIdolId: "idol-zero-target",
      loserIdolName: "Zero Target Talent",
      winnerViews: 1_000_000,
      loserViews: 0,
      loserEliminatedRoundIndex: 1
    });
    insertArchive({
      id: "stats-archive-late-exit",
      sourceBracketId: "stats-bracket-late-exit",
      archivedAt: "2025-01-13T00:00:00.000Z",
      winnerVideoId: "late-exit-winner",
      loserVideoId: "late-exit-loser",
      winnerTitle: "Late Exit Winner",
      loserTitle: "Late Exit Loser",
      winnerIdolId: "idol-late-winner",
      winnerIdolName: "Late Winner Talent",
      loserIdolId: "idol-late-exit",
      loserIdolName: "Late Exit Talent",
      winnerViews: 2_000_000,
      loserViews: 1_000_000,
      loserEliminatedRoundIndex: 2
    });
    for (let index = 0; index < 4; index += 1) {
      insertArchive({
        id: `stats-archive-clutch-win-${index}`,
        sourceBracketId: `stats-bracket-clutch-win-${index}`,
        archivedAt: `2025-01-${String(14 + index).padStart(2, "0")}T00:00:00.000Z`,
        winnerVideoId: `clutch-win-song-${index}`,
        loserVideoId: `clutch-target-song-${index}`,
        winnerTitle: `Clutch Win Song ${index}`,
        loserTitle: `Clutch Target Song ${index}`,
        winnerIdolId: "idol-clutch",
        winnerIdolName: "Clutch Talent",
        loserIdolId: `idol-clutch-target-${index}`,
        loserIdolName: `Clutch Target Talent ${index}`,
        winnerViews: 2_000_000,
        loserViews: 1_000_000,
        roundIndex: index % 2 === 0 ? 1 : 2,
        loserEliminatedRoundIndex: index % 2 === 0 ? 1 : 2
      });
    }
    insertArchive({
      id: "stats-archive-clutch-loss",
      sourceBracketId: "stats-bracket-clutch-loss",
      archivedAt: "2025-01-18T00:00:00.000Z",
      winnerVideoId: "clutch-loss-winner",
      loserVideoId: "clutch-loss-song",
      winnerTitle: "Clutch Loss Winner",
      loserTitle: "Clutch Loss Song",
      winnerIdolId: "idol-clutch-final-opponent",
      winnerIdolName: "Clutch Final Opponent",
      loserIdolId: "idol-clutch",
      loserIdolName: "Clutch Talent",
      winnerViews: 3_000_000,
      loserViews: 2_000_000,
      roundIndex: 3,
      loserEliminatedRoundIndex: 3
    });
    for (let index = 0; index < 3; index += 1) {
      insertArchive({
        id: `stats-archive-resilient-${index}`,
        sourceBracketId: `stats-bracket-resilient-${index}`,
        archivedAt: `2025-01-${String(19 + index).padStart(2, "0")}T00:00:00.000Z`,
        winnerVideoId: `resilient-win-song-${index}`,
        loserVideoId: `resilient-underdog-song-${index}`,
        winnerTitle: `Resilient Win Song ${index}`,
        loserTitle: `Resilient Underdog Song ${index}`,
        winnerIdolId: "idol-resilient",
        winnerIdolName: "Resilient Talent",
        loserIdolId: `idol-resilient-underdog-${index}`,
        loserIdolName: `Resilient Underdog Talent ${index}`,
        winnerViews: 4_000_000,
        loserViews: 1_000_000
      });
    }
    insertArchive({
      id: "stats-archive-fragile",
      sourceBracketId: "stats-bracket-fragile",
      archivedAt: "2025-01-22T00:00:00.000Z",
      winnerVideoId: "fragile-upsetter",
      loserVideoId: "fragile-favorite",
      winnerTitle: "Fragile Upsetter",
      loserTitle: "Fragile Favorite",
      winnerIdolId: "idol-fragile-upsetter",
      winnerIdolName: "Fragile Upsetter Talent",
      loserIdolId: "idol-fragile",
      loserIdolName: "Fragile Talent",
      winnerViews: 900_000,
      loserViews: 1_000_000
    });

    const stats = database.getHololiveBracketStatsOverview();
    expect(stats.songStats.length).toBeGreaterThanOrEqual(stats.topSongsByWins.length);
    expect(stats.talentStats.length).toBeGreaterThanOrEqual(stats.topTalents.length);
    expect(stats.rivalryStats.length).toBeGreaterThanOrEqual(stats.topRivalries.length);
    for (let index = 1; index < stats.topSongRatings.length; index += 1) {
      expect(stats.topSongRatings[index - 1].conservativeRating).toBeGreaterThanOrEqual(stats.topSongRatings[index].conservativeRating);
    }
    const sameTalentWinner = stats.songStats.find((row) => row.youtubeVideoId === "same-talent-winner");
    expect(stats.topSongRatings.find((row) => row.id === sameTalentWinner?.canonicalPerformanceKey)).toMatchObject({
      wins: 1,
      matches: 1
    });
    const fuwawaWinner = stats.songStats.find((row) => row.youtubeVideoId === "fuwawa-win-song");
    expect(stats.topSongRatings.find((row) => row.id === fuwawaWinner?.canonicalPerformanceKey)).toMatchObject({
      detail: "FUWAMOCO"
    });
    expect(stats.topTalents.find((row) => row.idolId === "fuwamoco")).toMatchObject({
      idolName: "FUWAMOCO",
      wins: 1,
      losses: 1
    });
    expect(stats.topTalents.some((row) => row.idolId === "fuwawa-abyssgard" || row.idolId === "mococo-abyssgard")).toBe(false);
    expect(stats.topTalentRatings.find((row) => row.id === "fuwamoco")).toMatchObject({
      label: "FUWAMOCO",
      wins: 1,
      losses: 1
    });
    expect(stats.topTalentRatings.some((row) => row.id === "fuwawa-abyssgard" || row.id === "mococo-abyssgard")).toBe(false);
    expect(stats.topTalentRatings.some((row) => row.id === "idol-shared")).toBe(false);
    expect(database.getHololiveBracketStatHistory("talent", "idol-shared", "rating").entries).toEqual([]);
    expect(
      database.getHololiveBracketStatHistory(
        "song",
        sameTalentWinner?.canonicalPerformanceKey ?? "",
        "rating"
      ).entries
    ).toHaveLength(1);
    const sharedTalent = stats.talentStats.find((row) => row.idolId === "idol-shared");
    expect(sharedTalent).toMatchObject({
      strengthOfWinsCount: 1,
      strengthOfLossesCount: 1,
      punchingAboveWins: 1,
      punchingAboveOpportunities: 1,
      clutchMatches: 0,
      pressureEdgeMatches: 0
    });
    expect(sharedTalent?.strengthOfLossesScore ?? 0).toBeGreaterThan(0);
    expect(sharedTalent?.punchingAboveScore ?? 0).toBeGreaterThan(0);
    expect(sharedTalent?.punchingAboveScore ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(1);
    expect(stats.talentStats.find((row) => row.idolId === "idol-zero")).toMatchObject({
      strengthOfWinsCount: 0,
      strengthOfWinsScore: 0
    });
    const highTalent = stats.talentStats.find((row) => row.idolId === "idol-high");
    expect(highTalent?.runnerUpCount).toBe((highTalent?.finalistCount ?? 0) - (highTalent?.championCount ?? 0));
    expect(stats.talentStats.find((row) => row.idolId === "idol-low")).toMatchObject({
      earlyExitCount: 1
    });
    expect(stats.talentStats.find((row) => row.idolId === "idol-zero-target")).toMatchObject({
      earlyExitCount: 0
    });
    expect(stats.talentStats.find((row) => row.idolId === "idol-late-exit")).toMatchObject({
      earlyExitCount: 0
    });
    const consistentStrength = stats.topTalentsByStrengthOfWins.find((row) => row.idolId === "idol-consistent");
    const outlierStrength = stats.topTalentsByStrengthOfWins.find((row) => row.idolId === "idol-outlier");
    expect(consistentStrength).toMatchObject({
      strengthOfWinsCount: 3
    });
    expect(outlierStrength).toMatchObject({
      strengthOfWinsCount: 1
    });
    expect(stats.topTalentsByStrengthOfWins.findIndex((row) => row.idolId === "idol-consistent")).toBeLessThan(
      stats.topTalentsByStrengthOfWins.findIndex((row) => row.idolId === "idol-outlier")
    );
    expect(consistentStrength?.strengthOfWinsScore ?? 0).toBeGreaterThanOrEqual(outlierStrength?.strengthOfWinsScore ?? 0);
    expect(outlierStrength?.strengthOfWinsScore ?? Number.POSITIVE_INFINITY).toBeLessThan(200_000_000);
    expect(stats.topTalentsByStrengthOfLosses[0]?.strengthOfLossesScore ?? 0).toBeGreaterThan(0);
    expect(stats.topTalentsByStrengthOfLosses[0]?.strengthOfLossesCount ?? 0).toBeGreaterThan(0);
    expect(stats.topTalentsByWins[0]?.wins ?? 0).toBeGreaterThanOrEqual(stats.topTalentsByWins[1]?.wins ?? 0);
    expect(stats.topTalentsByTitles[0]?.championCount ?? 0).toBeGreaterThanOrEqual(stats.topTalentsByTitles[1]?.championCount ?? 0);
    expect(stats.topTalentsByRunnerUps.find((row) => row.idolId === "idol-high")).toMatchObject({
      runnerUpCount: highTalent?.runnerUpCount
    });
    expect(stats.topTalentsByFinalsConversion[0]?.finalsConversionRate ?? 0).toBeGreaterThanOrEqual(
      stats.topTalentsByFinalsConversion[1]?.finalsConversionRate ?? 0
    );
    expect(stats.topTalentsByDeepRuns[0]?.top4Count ?? 0).toBeGreaterThan(0);
    expect(stats.topTalentsByDeepRunRate[0]?.deepRunRate ?? 0).toBeGreaterThan(0);
    expect(stats.topTalentsByEarlyExits[0]?.earlyExitCount ?? 0).toBeGreaterThan(0);
    expect(stats.topTalentsByEarlyExitRate[0]?.earlyExitRate ?? 1).toBeLessThanOrEqual(
      stats.topTalentsByEarlyExitRate[1]?.earlyExitRate ?? 1
    );
    expect(stats.topTalentsByPunchingAbove[0]).toMatchObject({
      idolId: "idol-steady",
      punchingAboveWins: 2,
      punchingAboveOpportunities: 2
    });
    expect(stats.topTalentsByPunchingAbove[0]?.punchingAboveScore ?? 0).toBeGreaterThan(0);
    expect(stats.topTalentsByPunchingAbove[0]?.punchingAboveScore ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(1);
    expect(stats.talentStats.find((row) => row.idolId === "idol-clutch")).toMatchObject({
      clutchWins: 4,
      clutchLosses: 1,
      clutchMatches: 5,
      pressureEdgeMatches: 5
    });
    expect(stats.topTalentsByClutchRate.find((row) => row.idolId === "idol-clutch")?.clutchRate ?? 0).toBeGreaterThan(0);
    expect(stats.topTalentsByPressureEdge.find((row) => row.idolId === "idol-clutch")?.pressureEdgeScore ?? 0).toBeGreaterThan(0);
    const resilientTalent = stats.topTalentsByUpsetResilience.find((row) => row.idolId === "idol-resilient");
    const fragileTalent = stats.talentStats.find((row) => row.idolId === "idol-fragile");
    expect(resilientTalent).toMatchObject({
      upsetResilienceChecks: 3,
      upsetResilienceUpsetLosses: 0
    });
    expect(fragileTalent).toMatchObject({
      upsetResilienceChecks: 1,
      upsetResilienceUpsetLosses: 1
    });
    expect(resilientTalent?.upsetResilienceScore ?? 0).toBeGreaterThan(fragileTalent?.upsetResilienceScore ?? 0);
    expect(stats.topSongsByUpsetWins[0]).toMatchObject({
      youtubeVideoId: "steady-upset-song",
      upsetWins: 2,
      giantKillerScore: 1_200_000
    });
    expect(stats.topSongsByRevengeWins[0]).toMatchObject({
      youtubeVideoId: "low-view-song",
      revengeWins: 1
    });
    expect(stats.topSongsByBigGameScore.find((row) => row.youtubeVideoId === "steady-upset-song")).toMatchObject({
      youtubeVideoId: "steady-upset-song",
      bigGameScore: 2_200_000,
      bigGameWins: 2
    });
    expect(stats.topSongsByBigGameAverage.find((row) => row.youtubeVideoId === "steady-upset-song")).toMatchObject({
      youtubeVideoId: "steady-upset-song",
      bigGameScore: 2_200_000,
      bigGameWins: 2
    });
    expect(stats.topSongsByHighStakesPerformance.find((row) => row.youtubeVideoId === "steady-upset-song")).toMatchObject({
      youtubeVideoId: "steady-upset-song",
      highStakesPerformanceWins: 2,
      highStakesPerformanceMatches: 2
    });
    expect(stats.topSongsByHighStakesPerformance[0]?.highStakesPerformanceRate ?? 0).toBeGreaterThan(0);
    const lowViewSong = stats.songStats.find((row) => row.youtubeVideoId === "low-view-song");
    const steadyUpsetSong = stats.topSongsByPunchingAbove.find((row) => row.youtubeVideoId === "steady-upset-song");
    expect(lowViewSong).toMatchObject({
      youtubeVideoId: "low-view-song",
      punchingAboveWins: 1,
      punchingAboveOpportunities: 2
    });
    expect(steadyUpsetSong).toMatchObject({
      youtubeVideoId: "steady-upset-song",
      punchingAboveWins: 2,
      punchingAboveOpportunities: 2
    });
    expect(lowViewSong?.punchingAboveScore ?? 0).toBeGreaterThan(0);
    expect(lowViewSong?.punchingAboveScore ?? Number.POSITIVE_INFINITY).toBeLessThan(Math.log2(10) / 4);
    expect(steadyUpsetSong?.punchingAboveScore ?? 0).toBeGreaterThan(0);
    expect(stats.topSongsByGiantKillerScore[0]).toMatchObject({
      youtubeVideoId: "steady-upset-song",
      giantKillerScore: 1_200_000
    });
    expect(stats.topSongsByGiantKillerAverage[0]).toMatchObject({
      youtubeVideoId: "low-view-song",
      giantKillerScore: 900_000
    });
    expect(stats.topRivalries[0]).toMatchObject({
      leftIdolName: "High Talent",
      rightIdolName: "Low Talent",
      matches: 2,
      leftWins: 1,
      rightWins: 1
    });

    const steadySongId = stats.songStats.find((row) => row.youtubeVideoId === "steady-upset-song")?.canonicalPerformanceKey ?? "";
    const clutchSongId = stats.songStats.find((row) => row.youtubeVideoId === "clutch-win-song-0")?.canonicalPerformanceKey ?? "";
    const highViewSongId = stats.songStats.find((row) => row.youtubeVideoId === "high-view-song")?.canonicalPerformanceKey ?? "";
    const strongestSongId = stats.topSongsByStrengthOfWins[0]?.canonicalPerformanceKey ?? "";
    const historyChecks = [
      database.getHololiveBracketStatHistory("talent", "idol-steady", "rating").entries[0],
      database.getHololiveBracketStatHistory("song", steadySongId, "rating").entries[0],
      database.getHololiveBracketStatHistory("talent", "idol-steady", "titles").entries[0],
      database.getHololiveBracketStatHistory("song", steadySongId, "titles").entries[0],
      database.getHololiveBracketStatHistory("talent", "idol-consistent", "strengthWins").entries[0],
      database.getHololiveBracketStatHistory("song", strongestSongId, "strengthWins").entries[0],
      database.getHololiveBracketStatHistory("talent", "idol-clutch", "pressure").entries[0],
      database.getHololiveBracketStatHistory("song", clutchSongId, "pressure").entries[0],
      database.getHololiveBracketStatHistory("talent", "idol-steady", "overperformer").entries[0],
      database.getHololiveBracketStatHistory("song", highViewSongId, "reliable").entries[0]
    ];
    expect(historyChecks.map((entry) => entry?.kind)).toEqual([
      "rating",
      "rating",
      "placement",
      "placement",
      "match",
      "match",
      "match",
      "match",
      "match",
      "match"
    ]);
    expect(historyChecks[4]).toMatchObject({
      evidence: { kind: "strength", opponentViews: expect.any(Number), scoreDelta: expect.any(Number) }
    });
    expect(historyChecks[5]).toMatchObject({
      evidence: { kind: "strength", opponentViews: expect.any(Number), scoreDelta: expect.any(Number) }
    });
    expect(historyChecks[4]?.evidence).not.toHaveProperty("adjustedViews");
    expect(historyChecks[5]?.evidence).not.toHaveProperty("adjustedViews");
    expect(historyChecks[6]).toMatchObject({ evidence: { kind: "pressure" } });
    expect(historyChecks[7]).toMatchObject({ evidence: { kind: "pressure" } });
    expect(historyChecks[8]).toMatchObject({ evidence: { kind: "viewExpectation", perspective: "underdog" } });
    expect(historyChecks[9]).toMatchObject({ evidence: { kind: "viewExpectation", perspective: "favorite" } });
    expect(historyChecks[0]).toMatchObject({ subjectSongLabel: expect.any(String) });
    for (const placementEntry of [historyChecks[2], historyChecks[3]]) {
      expect(placementEntry).toMatchObject({ kind: "placement" });
      expect(placementEntry).not.toHaveProperty("runMatches");
    }
  });

  it("uses current video stats for retroactive view-count bracket stats", async () => {
    const database = await createTempDatabase();
    const archivedAt = "2025-02-01T00:00:00.000Z";
    database.run(
      `INSERT INTO hololive_bracket_archives
         (id, source_bracket_id, name, size, generation_style, generation_filters_json, seed,
          total_entries, total_matches, completed_matches,
          champion_youtube_video_id, champion_title, champion_idol_id, champion_idol_name,
          created_at, completed_at, archived_at, updated_at)
       VALUES ('retro-archive', 'retro-bracket', 'Retro Stats', 'RO16', 'top_songs', '{}', 'retro-seed',
               2, 1, 1, 'new-song', 'New Song', 'idol-new', 'New Talent',
               ?, ?, ?, ?)`,
      [archivedAt, archivedAt, archivedAt, archivedAt]
    );

    for (const entry of [
      {
        slotIndex: 0,
        videoId: "new-song",
        title: "New Song",
        idolId: "idol-new",
        idolName: "New Talent",
        snapshotViews: 50_000,
        wins: 1,
        losses: 0,
        isChampion: 1
      },
      {
        slotIndex: 1,
        videoId: "older-hit",
        title: "Older Hit",
        idolId: "idol-old",
        idolName: "Old Talent",
        snapshotViews: 10_000_000,
        wins: 0,
        losses: 1,
        isChampion: 0
      }
    ]) {
      database.run(
        `INSERT INTO hololive_bracket_archive_entries
           (id, archive_id, source_entry_id, slot_index, youtube_video_id, title_snapshot, song_name_snapshot,
            topic_id, youtube_url_snapshot, channel_name_snapshot, idol_id_snapshot, idol_name_snapshot,
            canonical_performance_key, view_count_snapshot, published_at_snapshot, duration_seconds_snapshot,
            wins, losses, final_rank, eliminated_round_index, eliminated_by_youtube_video_id,
            first_round_eliminated, is_champion, is_finalist, is_top4, is_top8, is_top16)
         VALUES (?, 'retro-archive', ?, ?, ?, ?, ?, 'Original_Song', ?, ?, ?, ?, ?, ?, ?, 210,
                 ?, ?, ?, ?, ?, ?, ?, 1, 1, 1, 1)`,
        [
          `retro-archive:entry:${entry.slotIndex}`,
          `retro-entry-${entry.slotIndex}`,
          entry.slotIndex,
          entry.videoId,
          entry.title,
          entry.title,
          `https://www.youtube.com/watch?v=${entry.videoId}`,
          `${entry.idolName} Channel`,
          entry.idolId,
          entry.idolName,
          `${entry.idolId}:${entry.videoId}`,
          entry.snapshotViews,
          archivedAt,
          entry.wins,
          entry.losses,
          entry.isChampion ? 1 : 2,
          entry.isChampion ? null : 0,
          entry.isChampion ? null : "new-song",
          entry.isChampion ? 0 : 1,
          entry.isChampion
        ]
      );
    }

    database.run(
      `INSERT INTO hololive_bracket_archive_matches
         (id, archive_id, source_match_id, round_index, match_index,
          entry_a_youtube_video_id, entry_b_youtube_video_id, winner_youtube_video_id, loser_youtube_video_id,
          completed_at, updated_at)
       VALUES ('retro-archive:match:0', 'retro-archive', 'retro-match-0', 0, 0,
               'new-song', 'older-hit', 'new-song', 'older-hit', ?, ?)`,
      [archivedAt, archivedAt]
    );

    const snapshotStats = database.getHololiveBracketStatsOverview();
    const snapshotNewTalent = snapshotStats.talentStats.find((row) => row.idolId === "idol-new");
    const snapshotOldTalent = snapshotStats.talentStats.find((row) => row.idolId === "idol-old");
    expect(snapshotStats.songStats.find((row) => row.youtubeVideoId === "new-song")).toMatchObject({
      upsetWins: 1,
      giantKillerScore: 9_950_000,
      bigGameScore: 10_000_000
    });
    expect(snapshotNewTalent).toMatchObject({
      strengthOfWinsCount: 1,
      punchingAboveWins: 1,
      punchingAboveOpportunities: 1
    });
    expect(snapshotNewTalent?.strengthOfWinsScore ?? 0).toBeCloseTo(10_000_000, 0);
    expect(snapshotNewTalent?.punchingAboveScore ?? 0).toBeGreaterThan(0);
    expect(snapshotOldTalent).toMatchObject({
      strengthOfLossesCount: 1,
      upsetResilienceChecks: 1,
      upsetResilienceUpsetLosses: 1
    });
    expect(snapshotOldTalent?.strengthOfLossesScore ?? 0).toBeCloseTo(50_000, 0);

    database.upsertHololiveMusicVideoStats([
      {
        youtubeVideoId: "new-song",
        viewCount: 20_000_000,
        fetchedAt: "2025-03-01T00:00:00.000Z"
      },
      {
        youtubeVideoId: "older-hit",
        viewCount: 11_000_000,
        fetchedAt: "2025-03-01T00:00:00.000Z"
      }
    ]);

    const currentStats = database.getHololiveBracketStatsOverview();
    const currentNewTalent = currentStats.talentStats.find((row) => row.idolId === "idol-new");
    const currentOldTalent = currentStats.talentStats.find((row) => row.idolId === "idol-old");
    expect(currentStats.songStats.find((row) => row.youtubeVideoId === "new-song")).toMatchObject({
      upsetWins: 0,
      giantKillerScore: 0,
      bigGameScore: 11_000_000
    });
    expect(currentNewTalent).toMatchObject({
      strengthOfWinsCount: 1,
      punchingAboveWins: 0,
      punchingAboveOpportunities: 0,
      upsetResilienceChecks: 1,
      upsetResilienceUpsetLosses: 0
    });
    expect(currentNewTalent?.strengthOfWinsScore ?? 0).toBeCloseTo(11_000_000, 0);
    expect(currentNewTalent?.punchingAboveScore ?? Number.POSITIVE_INFINITY).toBe(0);
    expect(currentNewTalent?.upsetResilienceScore ?? 0).toBeGreaterThan(0);
    expect(currentOldTalent).toMatchObject({
      strengthOfLossesCount: 1,
      punchingAboveWins: 0,
      punchingAboveOpportunities: 1,
      upsetResilienceChecks: 0,
      upsetResilienceUpsetLosses: 0
    });
    expect(currentOldTalent?.strengthOfLossesScore ?? 0).toBeCloseTo(20_000_000, 0);
    expect(currentStats.topSongsByGiantKillerScore.some((row) => row.youtubeVideoId === "new-song")).toBe(false);
    expect(currentStats.topTalentsByPunchingAbove.some((row) => row.idolId === "idol-new")).toBe(false);
    expect(currentStats.topTalentsByStrengthOfWins[0]).toMatchObject({
      idolId: "idol-new",
      strengthOfWinsCount: 1
    });
    expect(currentStats.topTalentsByStrengthOfLosses[0]).toMatchObject({
      idolId: "idol-old",
      strengthOfLossesCount: 1
    });
    expect(currentStats.topTalentsByUpsetResilience[0]).toMatchObject({
      idolId: "idol-new",
      upsetResilienceChecks: 1,
      upsetResilienceUpsetLosses: 0
    });
  });

  it("combines replacement uploads into one canonical song history", async () => {
    const database = await createTempDatabase();
    const canonicalPerformanceKey = "tokino-sora:original:shared-performance";
    seedHololiveBracketSong(database, {
      idolId: "tokino-sora",
      idolName: "Tokino Sora",
      channelId: "UCp6993wxpyDPHUpavwDFqgg",
      topicId: "Original_Song",
      suffix: "old-upload",
      viewCount: 100_000,
      canonicalPerformanceKey
    });
    seedHololiveBracketSong(database, {
      idolId: "tokino-sora",
      idolName: "Tokino Sora",
      channelId: "UCp6993wxpyDPHUpavwDFqgg",
      topicId: "Original_Song",
      suffix: "acoustic-arrangement",
      viewCount: 400_000,
      canonicalPerformanceKey: "tokino-sora:original:shared-performance:acoustic"
    });
    seedHololiveBracketSong(database, {
      idolId: "tokino-sora",
      idolName: "Tokino Sora",
      channelId: "UCp6993wxpyDPHUpavwDFqgg",
      topicId: "Original_Song",
      suffix: "preferred-upload",
      viewCount: 900_000,
      canonicalPerformanceKey
    });
    archiveHololiveBracketVideos(database, "replacement-old-archive", [
      { youtubeVideoId: "tokino-sora-old-upload", isChampion: true }
    ]);
    archiveHololiveBracketVideos(database, "replacement-new-archive", [
      { youtubeVideoId: "tokino-sora-preferred-upload", isChampion: true }
    ]);
    archiveHololiveBracketVideos(database, "replacement-arrangement-archive", [
      { youtubeVideoId: "tokino-sora-acoustic-arrangement", isChampion: true }
    ]);
    database.run(
      `INSERT INTO hololive_music_duplicate_removals
         (removed_youtube_video_id, removed_title, kept_youtube_video_id, kept_title, reason, song_name, updated_at)
       VALUES (?, 'Old Upload', ?, 'Preferred Upload', 'replacement_upload', 'Shared Performance', ?)`,
      ["tokino-sora-old-upload", "tokino-sora-preferred-upload", new Date().toISOString()]
    );

    const stats = database.getHololiveBracketStatsOverview();
    const canonicalSongs = stats.songStats.filter((song) => song.canonicalPerformanceKey === canonicalPerformanceKey);

    expect(canonicalSongs).toHaveLength(1);
    expect(canonicalSongs[0]).toMatchObject({
      youtubeVideoId: "tokino-sora-preferred-upload",
      appearances: 2,
      championCount: 2
    });
    expect(stats.songStats).toContainEqual(
      expect.objectContaining({
        canonicalPerformanceKey: "tokino-sora:original:shared-performance:acoustic",
        youtubeVideoId: "tokino-sora-acoustic-arrangement",
        appearances: 1,
        championCount: 1
      })
    );
    expect(stats.topSongsByTitles[0]).toMatchObject({
      canonicalPerformanceKey,
      championCount: 2
    });
  });

  it("creates deterministic random Hololive song brackets with the default per-talent cap", async () => {
    const database = await createTempDatabase();
    const officialIdols = database.listHololiveIdols().filter((idol) => idol.source === "official").slice(0, 20);

    officialIdols.forEach((idol, index) => {
      seedHololiveBracketSong(database, {
        idolId: idol.id,
        idolName: idol.displayName,
        channelId: idol.youtubeChannelId ?? `channel-${idol.id}`,
        topicId: "Original_Song",
        suffix: "random-original",
        viewCount: 1_000_000 - index,
        publishedAt: `2025-03-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`
      });
      seedHololiveBracketSong(database, {
        idolId: idol.id,
        idolName: idol.displayName,
        channelId: idol.youtubeChannelId ?? `channel-${idol.id}`,
        topicId: "Music_Cover",
        suffix: "random-cover",
        viewCount: 900_000 - index,
        publishedAt: `2025-04-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`
      });
    });

    const bracket = await database.createHololiveBracket({
      size: "RO16",
      generationStyle: "random_songs",
      name: "Random Bracket"
    });
    const reloaded = database.getHololiveBracket(bracket.id);

    expect(bracket.generationStyle).toBe("random_songs");
    expect(bracket.entries).toHaveLength(16);
    const entriesByIdol = new Map<string, typeof bracket.entries>();
    for (const entry of bracket.entries) {
      entriesByIdol.set(entry.idolId, [...(entriesByIdol.get(entry.idolId) ?? []), entry]);
    }
    expect([...entriesByIdol.values()].every((entries) => entries.length <= 2)).toBe(true);
    expect(entriesByIdol.size).toBeGreaterThanOrEqual(8);
    expectNoFirstRoundSameTalent(bracket);
    expect(reloaded.entries.map((entry) => entry.youtubeVideoId)).toEqual(
      bracket.entries.map((entry) => entry.youtubeVideoId)
    );
    expect(database.listHololiveBrackets()[0].generationStyle).toBe("random_songs");
  });

  it("prefers the opposite category on random bracket extra passes", async () => {
    const database = await createTempDatabase();
    const officialIdols = database.listHololiveIdols().filter((idol) => idol.source === "official").slice(0, 10);

    officialIdols.forEach((idol, index) => {
      seedHololiveBracketSong(database, {
        idolId: idol.id,
        idolName: idol.displayName,
        channelId: idol.youtubeChannelId ?? `channel-${idol.id}`,
        topicId: "Original_Song",
        suffix: "balanced-original",
        viewCount: 500_000 - index
      });
      seedHololiveBracketSong(database, {
        idolId: idol.id,
        idolName: idol.displayName,
        channelId: idol.youtubeChannelId ?? `channel-${idol.id}`,
        topicId: "Music_Cover",
        suffix: "balanced-cover",
        viewCount: 400_000 - index
      });
    });

    const bracket = await database.createHololiveBracket({ size: "RO16", generationStyle: "random_songs" });
    const entriesByIdol = new Map<string, typeof bracket.entries>();
    for (const entry of bracket.entries) {
      entriesByIdol.set(entry.idolId, [...(entriesByIdol.get(entry.idolId) ?? []), entry]);
    }

    expect(bracket.entries).toHaveLength(16);
    expectNoFirstRoundSameTalent(bracket);
    expect([...entriesByIdol.values()].every((entries) => entries.length <= 2)).toBe(true);
    expect(
      [...entriesByIdol.values()]
        .filter((entries) => entries.length === 2)
        .every((entries) => new Set(entries.map((entry) => entry.topicId)).size === 2)
    ).toBe(true);
  });

  it("respects the default per-talent cap on wide random brackets", async () => {
    const database = await createTempDatabase();
    const officialIdols = database.listHololiveIdols().filter((idol) => idol.source === "official").slice(0, 28);

    officialIdols.forEach((idol, index) => {
      seedHololiveBracketSong(database, {
        idolId: idol.id,
        idolName: idol.displayName,
        channelId: idol.youtubeChannelId ?? `channel-${idol.id}`,
        topicId: "Original_Song",
        suffix: "wide-random-original",
        viewCount: 1_000_000 - index
      });
      seedHololiveBracketSong(database, {
        idolId: idol.id,
        idolName: idol.displayName,
        channelId: idol.youtubeChannelId ?? `channel-${idol.id}`,
        topicId: "Music_Cover",
        suffix: "wide-random-cover",
        viewCount: 900_000 - index
      });
    });

    const bracket = await database.createHololiveBracket({ size: "RO32", generationStyle: "random_songs" });
    const entriesByIdol = new Map<string, typeof bracket.entries>();
    for (const entry of bracket.entries) {
      entriesByIdol.set(entry.idolId, [...(entriesByIdol.get(entry.idolId) ?? []), entry]);
    }

    expect(bracket.entries).toHaveLength(32);
    expect([...entriesByIdol.values()].every((entries) => entries.length <= 2)).toBe(true);
    expect(entriesByIdol.size).toBeGreaterThanOrEqual(16);
    expectNoFirstRoundSameTalent(bracket);
  });

  it("falls back to same-category songs when random brackets need extra entries", async () => {
    const database = await createTempDatabase();
    const officialIdols = database.listHololiveIdols().filter((idol) => idol.source === "official").slice(0, 8);

    officialIdols.forEach((idol, index) => {
      seedHololiveBracketSong(database, {
        idolId: idol.id,
        idolName: idol.displayName,
        channelId: idol.youtubeChannelId ?? `channel-${idol.id}`,
        topicId: "Music_Cover",
        suffix: "cover-a",
        viewCount: 300_000 - index
      });
      seedHololiveBracketSong(database, {
        idolId: idol.id,
        idolName: idol.displayName,
        channelId: idol.youtubeChannelId ?? `channel-${idol.id}`,
        topicId: "Music_Cover",
        suffix: "cover-b",
        viewCount: 200_000 - index
      });
    });

    const bracket = await database.createHololiveBracket({ size: "RO16", generationStyle: "random_songs" });
    const entriesByIdol = new Map<string, typeof bracket.entries>();
    for (const entry of bracket.entries) {
      entriesByIdol.set(entry.idolId, [...(entriesByIdol.get(entry.idolId) ?? []), entry]);
    }

    expect(bracket.entries).toHaveLength(16);
    expectNoFirstRoundSameTalent(bracket);
    expect(new Set(bracket.entries.map((entry) => entry.canonicalPerformanceKey)).size).toBe(16);
    expect([...entriesByIdol.values()]).toHaveLength(8);
    expect([...entriesByIdol.values()].every((entries) => entries.length === 2)).toBe(true);
    expect(bracket.entries.every((entry) => entry.topicId === "Music_Cover")).toBe(true);
  });

  it("applies and relaxes max-per-talent bracket coverage", async () => {
    const database = await createTempDatabase();
    const capIdols = database.listHololiveIdols().filter((idol) => idol.source === "official").slice(0, 16);

    capIdols.forEach((idol, index) => {
      seedHololiveBracketSong(database, {
        idolId: idol.id,
        idolName: idol.displayName,
        channelId: idol.youtubeChannelId ?? `cap-channel-${idol.id}`,
        topicId: "Original_Song",
        suffix: "cap-original",
        viewCount: 1_000_000 - index
      });
      seedHololiveBracketSong(database, {
        idolId: idol.id,
        idolName: idol.displayName,
        channelId: idol.youtubeChannelId ?? `cap-channel-${idol.id}`,
        topicId: "Music_Cover",
        suffix: "cap-cover",
        viewCount: 900_000 - index
      });
    });

    const cappedResult = await database.createHololiveBracketResult({
      size: "RO16",
      filters: {
        includedTalentIds: capIdols.map((idol) => idol.id),
        maxEntriesPerTalent: 1
      }
    });
    expect(cappedResult.warnings).toEqual([]);
    expect(cappedResult.bracket.entries).toHaveLength(16);
    expect(new Set(cappedResult.bracket.entries.map((entry) => entry.idolId)).size).toBe(16);
    expectNoFirstRoundSameTalent(cappedResult.bracket);

    const relaxedIdols = capIdols.slice(0, 8);
    relaxedIdols.forEach((idol, index) => {
      seedHololiveBracketSong(database, {
        idolId: idol.id,
        idolName: idol.displayName,
        channelId: idol.youtubeChannelId ?? `cap-channel-${idol.id}`,
        topicId: "Original_Song",
        suffix: "cap-extra",
        viewCount: 800_000 - index
      });
    });
    const relaxedResult = await database.createHololiveBracketResult({
      size: "RO16",
      filters: {
        includedTalentIds: relaxedIdols.map((idol) => idol.id),
        maxEntriesPerTalent: 1
      }
    });
    const relaxedCounts = new Map<string, number>();
    for (const entry of relaxedResult.bracket.entries) {
      relaxedCounts.set(entry.idolId, (relaxedCounts.get(entry.idolId) ?? 0) + 1);
    }
    expect(relaxedResult.warnings).toEqual([
      expect.objectContaining({
        code: "talent_cap_relaxed",
        requestedMaxEntriesPerTalent: 1,
        appliedMaxEntriesPerTalent: 2
      })
    ]);
    expect(relaxedResult.bracket.entries).toHaveLength(16);
    expect([...relaxedCounts.values()].every((count) => count === 2)).toBe(true);
    expectNoFirstRoundSameTalent(relaxedResult.bracket);
  });

  it("uses the smallest viable relaxed cap for a large bracket", async () => {
    const database = await createTempDatabase();
    const capIdols = database.listHololiveIdols().filter((idol) => idol.source === "official").slice(0, 43);
    expect(capIdols).toHaveLength(43);

    capIdols.forEach((idol, idolIndex) => {
      for (let songIndex = 0; songIndex < 4; songIndex += 1) {
        seedHololiveBracketSong(database, {
          idolId: idol.id,
          idolName: idol.displayName,
          channelId: idol.youtubeChannelId ?? `large-cap-channel-${idol.id}`,
          topicId: songIndex % 2 === 0 ? "Original_Song" : "Music_Cover",
          suffix: `large-cap-${songIndex}`,
          viewCount: 2_000_000 - idolIndex * 10_000 - songIndex
        });
      }
    });

    const result = await database.createHololiveBracketResult({
      size: "RO128",
      filters: {
        includedTalentIds: capIdols.map((idol) => idol.id),
        maxEntriesPerTalent: 1
      }
    });
    const entriesPerTalent = new Map<string, number>();
    for (const entry of result.bracket.entries) {
      entriesPerTalent.set(entry.idolId, (entriesPerTalent.get(entry.idolId) ?? 0) + 1);
    }

    expect(result.bracket.entries).toHaveLength(128);
    expect(result.warnings).toEqual([
      expect.objectContaining({
        code: "talent_cap_relaxed",
        requestedMaxEntriesPerTalent: 1,
        appliedMaxEntriesPerTalent: 3
      })
    ]);
    expect(Math.max(...entriesPerTalent.values())).toBe(3);
  });

  it("uses the original-cover split preference when max-per-talent allows two entries", async () => {
    const database = await createTempDatabase();
    const splitIdols = database.listHololiveIdols().filter((idol) => idol.source === "official").slice(0, 8);

    splitIdols.forEach((idol, index) => {
      seedHololiveBracketSong(database, {
        idolId: idol.id,
        idolName: idol.displayName,
        channelId: idol.youtubeChannelId ?? `split-channel-${idol.id}`,
        topicId: "Original_Song",
        suffix: "split-original-a",
        viewCount: 3_000_000 - index
      });
      seedHololiveBracketSong(database, {
        idolId: idol.id,
        idolName: idol.displayName,
        channelId: idol.youtubeChannelId ?? `split-channel-${idol.id}`,
        topicId: "Original_Song",
        suffix: "split-original-b",
        viewCount: 2_000_000 - index
      });
      seedHololiveBracketSong(database, {
        idolId: idol.id,
        idolName: idol.displayName,
        channelId: idol.youtubeChannelId ?? `split-channel-${idol.id}`,
        topicId: "Music_Cover",
        suffix: "split-cover",
        viewCount: 1_000_000 - index
      });
    });

    const splitPreferred = await database.createHololiveBracket({
      size: "RO16",
      filters: {
        includedTalentIds: splitIdols.map((idol) => idol.id),
        maxEntriesPerTalent: 2
      }
    });
    const preferredEntriesByIdol = new Map<string, typeof splitPreferred.entries>();
    for (const entry of splitPreferred.entries) {
      preferredEntriesByIdol.set(entry.idolId, [...(preferredEntriesByIdol.get(entry.idolId) ?? []), entry]);
    }
    expect([...preferredEntriesByIdol.values()].every((entries) => new Set(entries.map((entry) => entry.topicId)).size === 2)).toBe(true);
    expectNoFirstRoundSameTalent(splitPreferred);

    const splitDisabled = await database.createHololiveBracket({
      size: "RO16",
      filters: {
        includedTalentIds: splitIdols.map((idol) => idol.id),
        maxEntriesPerTalent: 2,
        preferTopicSplitPerTalent: false
      }
    });
    expect(splitDisabled.generationFilters.preferTopicSplitPerTalent).toBe(false);
    expect(splitDisabled.entries.every((entry) => entry.topicId === "Original_Song")).toBe(true);
    expectNoFirstRoundSameTalent(splitDisabled);
  });

  it("honors higher, zero, and null max-per-talent settings during top-song selection", async () => {
    const database = await createTempDatabase();
    const capIdols = database.listHololiveIdols().filter((idol) => idol.source === "official").slice(0, 8);
    const dominant = capIdols[0];
    if (!dominant) {
      throw new Error("Expected at least one test idol");
    }

    for (let index = 0; index < 8; index += 1) {
      seedHololiveBracketSong(database, {
        idolId: dominant.id,
        idolName: dominant.displayName,
        channelId: dominant.youtubeChannelId ?? `cap-channel-${dominant.id}`,
        topicId: "Original_Song",
        suffix: `dominant-${index}`,
        viewCount: 10_000_000 - index
      });
    }

    capIdols.slice(1).forEach((idol, idolIndex) => {
      for (let songIndex = 0; songIndex < 2; songIndex += 1) {
        seedHololiveBracketSong(database, {
          idolId: idol.id,
          idolName: idol.displayName,
          channelId: idol.youtubeChannelId ?? `cap-channel-${idol.id}`,
          topicId: "Original_Song",
          suffix: `support-${songIndex}`,
          viewCount: 1_000_000 - idolIndex * 10 - songIndex
        });
      }
    });

    const countDominantSongs = (bracket: HololiveBracket) =>
      bracket.entries.filter((entry) => entry.idolId === dominant.id).length;
    const baseFilters = {
      includedTalentIds: capIdols.map((idol) => idol.id),
      preferTopicSplitPerTalent: false
    };

    const cappedAtTwo = await database.createHololiveBracket({
      size: "RO16",
      filters: {
        ...baseFilters,
        maxEntriesPerTalent: 2
      }
    });
    expect(countDominantSongs(cappedAtTwo)).toBe(2);
    expectNoFirstRoundSameTalent(cappedAtTwo);

    const cappedAtFour = await database.createHololiveBracket({
      size: "RO16",
      filters: {
        ...baseFilters,
        maxEntriesPerTalent: 4
      }
    });
    expect(countDominantSongs(cappedAtFour)).toBe(4);
    expectNoFirstRoundSameTalent(cappedAtFour);

    const zeroMeansNoCap = await database.createHololiveBracket({
      size: "RO16",
      filters: {
        ...baseFilters,
        maxEntriesPerTalent: 0
      }
    });
    expect(countDominantSongs(zeroMeansNoCap)).toBeGreaterThan(4);
    expectNoFirstRoundSameTalent(zeroMeansNoCap);

    const nullMeansNoCap = await database.createHololiveBracket({
      size: "RO16",
      filters: {
        ...baseFilters,
        maxEntriesPerTalent: null
      }
    });
    expect(countDominantSongs(nullMeansNoCap)).toBe(countDominantSongs(zeroMeansNoCap));
    expectNoFirstRoundSameTalent(nullMeansNoCap);
  });

  it("applies bracket creation filters before selecting entries", async () => {
    const database = await createTempDatabase();
    const officialIdols = database.listHololiveIdols().filter((idol) => idol.source === "official").slice(0, 24);

    officialIdols.forEach((idol, index) => {
      seedHololiveBracketSong(database, {
        idolId: idol.id,
        idolName: idol.displayName,
        channelId: idol.youtubeChannelId ?? `channel-${idol.id}`,
        topicId: "Original_Song",
        suffix: "date-original",
        viewCount: 1_000_000 - index,
        publishedAt: `2025-01-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`
      });
      seedHololiveBracketSong(database, {
        idolId: idol.id,
        idolName: idol.displayName,
        channelId: idol.youtubeChannelId ?? `channel-${idol.id}`,
        topicId: "Music_Cover",
        suffix: "date-cover",
        viewCount: 900_000 - index,
        publishedAt: `2025-01-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`
      });
    });

    database.setHololiveMusicMarker({ youtubeVideoId: `${officialIdols[4].id}-date-original`, marker: "favorite" });
    database.setHololiveMusicMarker({ youtubeVideoId: `${officialIdols[5].id}-date-original`, marker: "dislike" });

    const bracket = await database.createHololiveBracket({
      size: "RO16",
      filters: {
        excludeRated: true,
        excludeBeforeDate: "2025-01-03",
        excludeAfterDate: "2025-01-20",
        excludeTopicIds: ["Music_Cover"]
      }
    });

    expect(bracket.generationFilters).toMatchObject({
      excludeRated: true,
      excludeBeforeDate: "2025-01-03",
      excludeAfterDate: "2025-01-20",
      excludeTopicIds: ["Music_Cover"]
    });
    expect(database.listHololiveBrackets()[0].generationFilters.excludeRated).toBe(true);
    expect(bracket.entries).toHaveLength(16);
    expect(bracket.entries.every((entry) => entry.topicId === "Original_Song")).toBe(true);
    expect(bracket.entries.map((entry) => entry.youtubeVideoId)).toContain(`${officialIdols[2].id}-date-original`);
    expect(bracket.entries.map((entry) => entry.youtubeVideoId)).toContain(`${officialIdols[19].id}-date-original`);
    expect(bracket.entries.map((entry) => entry.youtubeVideoId)).not.toContain(`${officialIdols[1].id}-date-original`);
    expect(bracket.entries.map((entry) => entry.youtubeVideoId)).not.toContain(`${officialIdols[4].id}-date-original`);
    expect(bracket.entries.map((entry) => entry.youtubeVideoId)).not.toContain(`${officialIdols[5].id}-date-original`);
    expect(bracket.entries.map((entry) => entry.youtubeVideoId)).not.toContain(`${officialIdols[20].id}-date-original`);
    expect(
      bracket.entries.every((entry) => {
        const publishedAt = entry.publishedAt ?? "";
        return publishedAt >= "2025-01-03T00:00:00.000Z" && publishedAt <= "2025-01-20T23:59:59.999Z";
      })
    ).toBe(true);
    expectNoFirstRoundSameTalent(bracket);
  });

  it("limits bracket generation to selected official talents", async () => {
    const database = await createTempDatabase();
    const officialIdols = database.listHololiveIdols().filter((idol) => idol.source === "official").slice(0, 10);
    const includedIdols = officialIdols.slice(0, 8);
    const excludedIdols = officialIdols.slice(8);

    includedIdols.forEach((idol, index) => {
      seedHololiveBracketSong(database, {
        idolId: idol.id,
        idolName: idol.displayName,
        channelId: idol.youtubeChannelId ?? `channel-${idol.id}`,
        topicId: "Original_Song",
        suffix: "included-original",
        viewCount: 1_000_000 - index
      });
      seedHololiveBracketSong(database, {
        idolId: idol.id,
        idolName: idol.displayName,
        channelId: idol.youtubeChannelId ?? `channel-${idol.id}`,
        topicId: "Music_Cover",
        suffix: "included-cover",
        viewCount: 900_000 - index
      });
    });
    excludedIdols.forEach((idol, index) => {
      seedHololiveBracketSong(database, {
        idolId: idol.id,
        idolName: idol.displayName,
        channelId: idol.youtubeChannelId ?? `channel-${idol.id}`,
        topicId: "Original_Song",
        suffix: "excluded-original",
        viewCount: 10_000_000 - index
      });
      seedHololiveBracketSong(database, {
        idolId: idol.id,
        idolName: idol.displayName,
        channelId: idol.youtubeChannelId ?? `channel-${idol.id}`,
        topicId: "Music_Cover",
        suffix: "excluded-cover",
        viewCount: 9_000_000 - index
      });
    });

    const bracket = await database.createHololiveBracket({
      size: "RO16",
      filters: {
        includedTalentIds: includedIdols.map((idol) => idol.id)
      }
    });

    expect(bracket.generationFilters.includedTalentIds).toEqual(includedIdols.map((idol) => idol.id));
    expect(bracket.entries).toHaveLength(16);
    expect(new Set(bracket.entries.map((entry) => entry.idolId))).toEqual(new Set(includedIdols.map((idol) => idol.id)));
    expect(bracket.entries.some((entry) => excludedIdols.some((idol) => entry.idolId === idol.id))).toBe(false);
    expectNoFirstRoundSameTalent(bracket);
  });

  it("filters bracket generation by talent status, including custom talents", async () => {
    const database = await createTempDatabase();
    const activeIdols = database
      .listHololiveIdols()
      .filter((idol) => idol.source === "official" && idol.status !== "alum" && idol.status !== "retired")
      .slice(0, 8);
    const alumniIdols = database
      .listHololiveIdols()
      .filter((idol) => idol.source === "official" && (idol.status === "alum" || idol.status === "retired"))
      .slice(0, 8);
    const customIdols = Array.from({ length: 8 }, (_, index) =>
      database.upsertHololiveCustomTalent({
        channelId: `custom-status-channel-${index}`,
        displayName: `Custom Status ${index + 1}`,
        slug: `custom-status-${index + 1}`,
        branch: "Custom",
        generation: "Custom",
        officialUrl: `https://youtube.com/channel/custom-status-channel-${index}`,
        iconUrl: "",
        profileImageUrl: "",
        youtubeChannelUrl: `https://youtube.com/channel/custom-status-channel-${index}`
      }).idol
    );

    expect(activeIdols).toHaveLength(8);
    expect(alumniIdols).toHaveLength(8);

    const seedStatusSongs = (
      idols: typeof activeIdols,
      suffix: string,
      baseViews: number,
      sourceKind: HololiveMusicSourceKind = "official"
    ) => {
      idols.forEach((idol, index) => {
        seedHololiveBracketSong(database, {
          idolId: idol.id,
          idolName: idol.displayName,
          channelId: idol.youtubeChannelId ?? `${suffix}-channel-${index}`,
          topicId: "Original_Song",
          suffix: `${suffix}-original`,
          viewCount: baseViews - index,
          sourceKind
        });
        seedHololiveBracketSong(database, {
          idolId: idol.id,
          idolName: idol.displayName,
          channelId: idol.youtubeChannelId ?? `${suffix}-channel-${index}`,
          topicId: "Music_Cover",
          suffix: `${suffix}-cover`,
          viewCount: baseViews - 1_000 - index,
          sourceKind
        });
      });
    };

    seedStatusSongs(activeIdols, "status-active", 3_000_000);
    seedStatusSongs(alumniIdols, "status-alumni", 2_000_000);
    seedStatusSongs(customIdols, "status-custom", 1_000_000, "user");

    const activeBracket = await database.createHololiveBracket({
      size: "RO16",
      filters: { talentStatuses: ["active"] }
    });
    expect(activeBracket.entries).toHaveLength(16);
    expect(new Set(activeBracket.entries.map((entry) => entry.idolId))).toEqual(new Set(activeIdols.map((idol) => idol.id)));
    expectNoFirstRoundSameTalent(activeBracket);

    const alumniBracket = await database.createHololiveBracket({
      size: "RO16",
      filters: { talentStatuses: ["alumni"] }
    });
    expect(alumniBracket.entries).toHaveLength(16);
    expect(new Set(alumniBracket.entries.map((entry) => entry.idolId))).toEqual(new Set(alumniIdols.map((idol) => idol.id)));
    expectNoFirstRoundSameTalent(alumniBracket);

    const customBracket = await database.createHololiveBracket({
      size: "RO16",
      filters: { talentStatuses: ["custom"] }
    });
    expect(customBracket.entries).toHaveLength(16);
    expect(new Set(customBracket.entries.map((entry) => entry.idolId))).toEqual(new Set(customIdols.map((idol) => idol.id)));
    expectNoFirstRoundSameTalent(customBracket);
  });

  it("filters bracket generation by solo and group vocal scope", async () => {
    const database = await createTempDatabase();
    const officialIdols = database.listHololiveIdols().filter((idol) => idol.source === "official").slice(0, 24);
    const featuredIdol = officialIdols[23];
    if (!featuredIdol) {
      throw new Error("Expected enough official idols for vocal scope test");
    }

    officialIdols.forEach((idol, index) => {
      seedHololiveBracketSong(database, {
        idolId: idol.id,
        idolName: idol.displayName,
        channelId: idol.youtubeChannelId ?? `channel-${idol.id}`,
        topicId: "Original_Song",
        suffix: "vocal-solo",
        viewCount: 2_000_000 - index
      });
      seedHololiveBracketSong(database, {
        idolId: idol.id,
        idolName: idol.displayName,
        channelId: idol.youtubeChannelId ?? `channel-${idol.id}`,
        topicId: "Music_Cover",
        suffix: "vocal-group",
        viewCount: 1_000_000 - index
      });
      database.run(
        `UPDATE hololive_music_videos
         SET title = ?, song_name = ?, canonical_song_key = ?
        WHERE youtube_video_id = ?`,
        [
          `${idol.displayName} & ${featuredIdol.displayName} Cover`,
          `Vocal Group Song & ${featuredIdol.displayName}`,
          `vocal group song and ${featuredIdol.id}`,
          `${idol.id}-vocal-group`
        ]
      );
    });

    const soloBracket = await database.createHololiveBracket({
      size: "RO16",
      filters: { vocalScopes: ["solo"] }
    });
    expect(soloBracket.generationFilters.vocalScopes).toEqual(["solo"]);
    expect(soloBracket.entries).toHaveLength(16);
    expect(soloBracket.entries.every((entry) => entry.youtubeVideoId.endsWith("-vocal-solo"))).toBe(true);
    expectNoFirstRoundSameTalent(soloBracket);

    const groupBracket = await database.createHololiveBracket({
      size: "RO16",
      filters: { vocalScopes: ["group"] }
    });
    expect(groupBracket.generationFilters.vocalScopes).toEqual(["group"]);
    expect(groupBracket.entries).toHaveLength(16);
    expect(groupBracket.entries.every((entry) => entry.youtubeVideoId.endsWith("-vocal-group"))).toBe(true);
    expectNoFirstRoundSameTalent(groupBracket);
  });

  it("treats an explicit empty talent filter as no selected talents", async () => {
    const database = await createTempDatabase();
    const officialIdols = database.listHololiveIdols().filter((idol) => idol.source === "official").slice(0, 8);

    officialIdols.forEach((idol, index) => {
      seedHololiveBracketSong(database, {
        idolId: idol.id,
        idolName: idol.displayName,
        channelId: idol.youtubeChannelId ?? `channel-${idol.id}`,
        topicId: "Original_Song",
        suffix: "empty-talent-original",
        viewCount: 1_000_000 - index
      });
      seedHololiveBracketSong(database, {
        idolId: idol.id,
        idolName: idol.displayName,
        channelId: idol.youtubeChannelId ?? `channel-${idol.id}`,
        topicId: "Music_Cover",
        suffix: "empty-talent-cover",
        viewCount: 900_000 - index
      });
    });

    await expect(
      database.createHololiveBracket({
        size: "RO16",
        filters: {
          includedTalentIds: []
        }
      })
    ).rejects.toThrow(/Only 0 eligible official Hololive songs/);
  });

  it("supports rating buckets while preserving legacy bracket rating filters", async () => {
    const database = await createTempDatabase();
    const officialIdols = database.listHololiveIdols().filter((idol) => idol.source === "official").slice(0, 24);

    officialIdols.forEach((idol, index) => {
      const common = {
        idolId: idol.id,
        idolName: idol.displayName,
        channelId: idol.youtubeChannelId ?? `channel-${idol.id}`
      };
      seedHololiveBracketSong(database, {
        ...common,
        topicId: "Original_Song",
        suffix: "rating-disliked",
        viewCount: 5_000_000 - index
      });
      seedHololiveBracketSong(database, {
        ...common,
        topicId: "Music_Cover",
        suffix: "rating-unrated",
        viewCount: 4_000_000 - index
      });
      seedHololiveBracketSong(database, {
        ...common,
        topicId: "Original_Song",
        suffix: "rating-favorite",
        viewCount: 3_000_000 - index
      });
      seedHololiveBracketSong(database, {
        ...common,
        topicId: "Music_Cover",
        suffix: "rating-like",
        viewCount: 2_000_000 - index
      });
      seedHololiveBracketSong(database, {
        ...common,
        topicId: "Original_Song",
        suffix: "rating-neutral",
        viewCount: 1_000_000 - index
      });

      database.setHololiveMusicMarker({ youtubeVideoId: `${idol.id}-rating-disliked`, marker: "dislike" });
      database.setHololiveMusicMarker({ youtubeVideoId: `${idol.id}-rating-favorite`, marker: "favorite" });
      database.setHololiveMusicMarker({ youtubeVideoId: `${idol.id}-rating-like`, marker: "like" });
      database.setHololiveMusicMarker({ youtubeVideoId: `${idol.id}-rating-neutral`, marker: "neutral" });
    });

    const legacyUnratedOnly = await database.createHololiveBracket({
      size: "RO16",
      filters: { excludeRated: true }
    });
    expect(legacyUnratedOnly.entries).toHaveLength(16);
    expect(legacyUnratedOnly.entries.every((entry) => entry.youtubeVideoId.endsWith("-rating-unrated"))).toBe(true);
    expectNoFirstRoundSameTalent(legacyUnratedOnly);

    const legacyWithoutDisliked = await database.createHololiveBracket({
      size: "RO16",
      filters: { excludeDisliked: true }
    });
    expect(legacyWithoutDisliked.entries).toHaveLength(16);
    expect(legacyWithoutDisliked.entries.some((entry) => entry.youtubeVideoId.endsWith("-rating-disliked"))).toBe(false);
    expectNoFirstRoundSameTalent(legacyWithoutDisliked);

    const bucketFiltered = await database.createHololiveBracket({
      size: "RO16",
      filters: {
        ratingBuckets: ["favorite", "like"],
        excludeRated: true,
        excludeDisliked: true
      }
    });
    expect(bucketFiltered.generationFilters).toMatchObject({
      ratingBuckets: ["favorite", "like"],
      excludeRated: false,
      excludeDisliked: false
    });
    expect(bucketFiltered.entries).toHaveLength(16);
    expect(
      bucketFiltered.entries.every(
        (entry) => entry.youtubeVideoId.endsWith("-rating-favorite") || entry.youtubeVideoId.endsWith("-rating-like")
      )
    ).toBe(true);
    expectNoFirstRoundSameTalent(bucketFiltered);
  });

  it("can exclude each selected talent's top viewed song from bracket generation", async () => {
    const database = await createTempDatabase();
    const officialIdols = database.listHololiveIdols().filter((idol) => idol.source === "official").slice(0, 16);

    officialIdols.forEach((idol, index) => {
      seedHololiveBracketSong(database, {
        idolId: idol.id,
        idolName: idol.displayName,
        channelId: idol.youtubeChannelId ?? `channel-${idol.id}`,
        topicId: "Original_Song",
        suffix: "top-original",
        viewCount: 2_000_000 - index
      });
      seedHololiveBracketSong(database, {
        idolId: idol.id,
        idolName: idol.displayName,
        channelId: idol.youtubeChannelId ?? `channel-${idol.id}`,
        topicId: "Music_Cover",
        suffix: "runner-up-cover",
        viewCount: 1_000_000 - index
      });
    });

    const bracket = await database.createHololiveBracket({
      size: "RO16",
      filters: {
        excludeTopViewedPerTalent: true
      }
    });

    expect(bracket.entries).toHaveLength(16);
    expect(bracket.entries.every((entry) => entry.youtubeVideoId.endsWith("-runner-up-cover"))).toBe(true);
    expectNoFirstRoundSameTalent(bracket);
  });

  it("can exclude songs outside bracket view thresholds", async () => {
    const database = await createTempDatabase();
    const officialIdols = database.listHololiveIdols().filter((idol) => idol.source === "official").slice(0, 30);

    officialIdols.forEach((idol, index) => {
      seedHololiveBracketSong(database, {
        idolId: idol.id,
        idolName: idol.displayName,
        channelId: idol.youtubeChannelId ?? `channel-${idol.id}`,
        topicId: "Original_Song",
        suffix: "threshold-original",
        viewCount: 1_000_000 + index
      });
      seedHololiveBracketSong(database, {
        idolId: idol.id,
        idolName: idol.displayName,
        channelId: idol.youtubeChannelId ?? `channel-${idol.id}`,
        topicId: "Music_Cover",
        suffix: "threshold-cover",
        viewCount: 400_000 + index
      });
    });

    const bracket = await database.createHololiveBracket({
      size: "RO16",
      filters: {
        excludeBelowViews: 1_000_010,
        excludeAboveViews: 1_000_025
      }
    });

    expect(bracket.generationFilters).toMatchObject({
      excludeBelowViews: 1_000_010,
      excludeAboveViews: 1_000_025
    });
    expect(bracket.entries).toHaveLength(16);
    expect(
      bracket.entries.every((entry) => Number(entry.viewCount) >= 1_000_010 && Number(entry.viewCount) <= 1_000_025)
    ).toBe(true);
    expect(bracket.entries.map((entry) => Number(entry.viewCount))).toContain(1_000_010);
    expect(bracket.entries.map((entry) => Number(entry.viewCount))).toContain(1_000_025);
    expectNoFirstRoundSameTalent(bracket);
  });

  it("can exclude previous archive champions, finalists, top 4, and top 8 entries", async () => {
    const database = await createTempDatabase();
    const officialIdols = database.listHololiveIdols().filter((idol) => idol.source === "official").slice(0, 24);

    officialIdols.forEach((idol, index) => {
      seedHololiveBracketSong(database, {
        idolId: idol.id,
        idolName: idol.displayName,
        channelId: idol.youtubeChannelId ?? `channel-${idol.id}`,
        topicId: "Original_Song",
        suffix: "history-original",
        viewCount: 2_000_000 - index
      });
      seedHololiveBracketSong(database, {
        idolId: idol.id,
        idolName: idol.displayName,
        channelId: idol.youtubeChannelId ?? `channel-${idol.id}`,
        topicId: "Music_Cover",
        suffix: "history-cover",
        viewCount: 1_000_000 - index
      });
      seedHololiveBracketSong(database, {
        idolId: idol.id,
        idolName: idol.displayName,
        channelId: idol.youtubeChannelId ?? `channel-${idol.id}`,
        topicId: "Original_Song",
        suffix: "history-backfill",
        viewCount: 500_000 - index
      });
    });

    const completed = await completeBracket(
      database,
      await database.createHololiveBracket({ size: "RO16", name: "History Source" })
    );
    expect(completed.status).toBe("complete");
    const archivedTop8Keys = new Set(
      database
        .select<{ canonical_performance_key: string }>(
          "SELECT canonical_performance_key FROM hololive_bracket_archive_entries WHERE is_top8 = 1"
        )
        .map((row) => row.canonical_performance_key)
    );
    expect(archivedTop8Keys.size).toBe(8);

    const bracket = await database.createHololiveBracket({
      size: "RO16",
      filters: {
        excludePreviousChampions: true,
        excludePreviousFinalists: true,
        excludePreviousTop4: true,
        excludePreviousTop8: true
      }
    });

    expect(bracket.generationFilters).toMatchObject({
      excludePreviousChampions: true,
      excludePreviousFinalists: true,
      excludePreviousTop4: true,
      excludePreviousTop8: true
    });
    expect(bracket.entries).toHaveLength(16);
    expect(bracket.entries.every((entry) => !archivedTop8Keys.has(entry.canonicalPerformanceKey))).toBe(true);
    expectNoFirstRoundSameTalent(bracket);
  });

  it("filters bracket generation by history participation tier", async () => {
    const database = await createTempDatabase();
    const officialIdols = database.listHololiveIdols().filter((idol) => idol.source === "official").slice(0, 16);
    const historySuffixes = ["history-never", "history-appeared", "history-top8", "history-top4", "history-finalist", "history-winner"];

    officialIdols.forEach((idol, idolIndex) => {
      historySuffixes.forEach((suffix, suffixIndex) => {
        seedHololiveBracketSong(database, {
          idolId: idol.id,
          idolName: idol.displayName,
          channelId: idol.youtubeChannelId ?? `history-channel-${idol.id}`,
          topicId: "Original_Song",
          suffix,
          viewCount: 6_000_000 - suffixIndex * 100_000 - idolIndex,
          canonicalPerformanceKey: `${idol.id}:${suffix}`
        });
      });
    });

    archiveHololiveBracketVideos(database, "history-participation-archive", [
      ...officialIdols.map((idol) => ({ youtubeVideoId: `${idol.id}-history-appeared` })),
      ...officialIdols.map((idol) => ({ youtubeVideoId: `${idol.id}-history-top8`, isTop8: true })),
      ...officialIdols.map((idol) => ({ youtubeVideoId: `${idol.id}-history-top4`, isTop4: true })),
      ...officialIdols.map((idol) => ({ youtubeVideoId: `${idol.id}-history-finalist`, isFinalist: true })),
      ...officialIdols.map((idol) => ({ youtubeVideoId: `${idol.id}-history-winner`, isChampion: true }))
    ]);

    const expectSuffix = async (mode: HololiveBracketHistoryParticipation, allowed: string[]) => {
      const bracket = await database.createHololiveBracket({
        size: "RO16",
        filters: { historyParticipation: mode }
      });
      expect(bracket.generationFilters.historyParticipation).toBe(mode);
      expect(bracket.entries).toHaveLength(16);
      expect(bracket.entries.every((entry) => allowed.some((suffix) => entry.youtubeVideoId.endsWith(suffix)))).toBe(true);
      expectNoFirstRoundSameTalent(bracket);
    };

    await expectSuffix("never", ["history-never"]);
    await expectSuffix("appeared", ["history-appeared", "history-top8", "history-top4", "history-finalist", "history-winner"]);
    await expectSuffix("top8", ["history-top8", "history-top4", "history-finalist", "history-winner"]);
    await expectSuffix("top4", ["history-top4", "history-finalist", "history-winner"]);
    await expectSuffix("finalist", ["history-finalist", "history-winner"]);
    await expectSuffix("winner", ["history-winner"]);
  });

  it("refuses to create a bracket when first-round same-talent matchups are unavoidable", async () => {
    const database = await createTempDatabase();
    const idol = database.listHololiveIdols().find((candidate) => candidate.source === "official");
    expect(idol).toBeTruthy();

    for (let index = 0; index < 16; index += 1) {
      seedHololiveBracketSong(database, {
        idolId: idol?.id ?? "single-idol",
        idolName: idol?.displayName ?? "Single Idol",
        channelId: idol?.youtubeChannelId ?? "single-idol-channel",
        topicId: index % 2 === 0 ? "Original_Song" : "Music_Cover",
        suffix: `solo-${index}`,
        viewCount: 1_000_000 - index
      });
    }

    await expect(database.createHololiveBracket({ size: "RO16" })).rejects.toThrow(
      /without same-talent first-round matchups/
    );
  });

  it("seeds Hololive idols and the default tier board", async () => {
    const database = await createTempDatabase();

    const data = database.getHololiveTierListData();

    expect(data.idols).toHaveLength(HOLOLIVE_IDOLS.length);
    expect(data.idols.every((idol) => idol.source === "official")).toBe(true);
    expect(data.idols.map((idol) => idol.id)).not.toContain("friend-a");
    expect(data.idols.map((idol) => idol.id)).not.toContain("izuki-michiru");
    expect(data.activeBoard.name).toBe(DEFAULT_HOLOLIVE_BOARD_NAME);
    expect(data.activeBoard.tiers.map((tier) => tier.label)).toEqual(DEFAULT_HOLOLIVE_TIERS.map((tier) => tier.label));
    expect(data.activeBoard.tiers.map((tier) => tier.label)).toEqual(["S", "A", "B", "C", "D", "F"]);
    expect(data.activeBoard.tiers[0].color).toBe("#2f8fd7");
    expect(data.activeBoard.tileSize).toBe(64);
    expect(data.activeBoard.placements).toHaveLength(HOLOLIVE_IDOLS.length);
    expect(data.activeBoard.placements.every((placement) => placement.tierId === null)).toBe(true);

    const unrankedIds = data.activeBoard.placements
      .filter((placement) => placement.tierId === null)
      .sort((left, right) => left.position - right.position)
      .map((placement) => placement.idolId);
    expect(unrankedIds.slice(0, 4)).toEqual(["tokino-sora", "roboco-san", "aki-rosenthal", "akai-haato"]);
    expect(unrankedIds.indexOf("sakamata-chloe")).toBeGreaterThan(unrankedIds.indexOf("kikirara-vivi"));
    expect(unrankedIds.slice(-11)).toEqual([
      "sakamata-chloe",
      "watson-amelia",
      "minato-aqua",
      "murasaki-shion",
      "amane-kanata",
      "kiryu-coco",
      "gawr-gura",
      "tsukumo-sana",
      "ceres-fauna",
      "nanashi-mumei",
      "hiodoshi-ao"
    ]);
  });

  it("adds custom talents to every tier board without resetting saved rankings", async () => {
    const database = await createTempDatabase();
    const defaultBoard = database.getHololiveTierListData().activeBoard;
    const rankedTierId = defaultBoard.tiers[0].id;
    database.moveHololiveIdol({ boardId: defaultBoard.id, idolId: "tokino-sora", tierId: rankedTierId, index: 0 });
    const secondBoardId = database.createHololiveTierBoard("Side Board");

    const preview: HololiveCustomTalentPreview = {
      channelId: "UCdQYcUyffHZoz0KOwuiG0lQ",
      displayName: "Soraduki Tyra",
      nativeName: "宙月ティラ",
      slug: "soraduki-tyra",
      branch: "Independents",
      generation: "Custom",
      officialUrl: "https://holodex.net/channel/UCdQYcUyffHZoz0KOwuiG0lQ",
      iconUrl: "https://yt3.googleusercontent.com/mock=s176-c-k-c0x00ffffff-no-rj",
      profileImageUrl: "https://yt3.googleusercontent.com/mock=s512-c-k-c0x00ffffff-no-rj",
      youtubeChannelUrl: "https://www.youtube.com/channel/UCdQYcUyffHZoz0KOwuiG0lQ",
      xHandle: "@SoradukiTyra",
      xUrl: "https://twitter.com/SoradukiTyra",
      subscriberCount: 42000,
      videoCount: 188,
      clipCount: 91
    };

    const record = database.upsertHololiveCustomTalent(preview);
    const defaultData = database.getHololiveTierListData(defaultBoard.id);
    const secondData = database.getHololiveTierListData(secondBoardId);

    expect(record.idol).toMatchObject({
      id: "custom-soraduki-tyra",
      source: "custom",
      displayName: "Soraduki Tyra",
      branch: "Independents",
      youtubeChannelId: "UCdQYcUyffHZoz0KOwuiG0lQ",
      cardImageUrl: null
    });
    expect(record.channel).toMatchObject({
      id: "UCdQYcUyffHZoz0KOwuiG0lQ",
      kind: "idol",
      mainIdolIds: ["custom-soraduki-tyra"]
    });
    const defaultUnrankedIds = defaultData.activeBoard.placements
      .filter((placement) => placement.tierId === null)
      .sort((left, right) => left.position - right.position)
      .map((placement) => placement.idolId);
    expect(defaultData.idols.at(-1)).toMatchObject({ id: "custom-soraduki-tyra", source: "custom" });
    expect(defaultUnrankedIds.at(-2)).toBe("hiodoshi-ao");
    expect(defaultUnrankedIds.at(-1)).toBe("custom-soraduki-tyra");
    expect(defaultData.activeBoard.placements.find((placement) => placement.idolId === "tokino-sora")?.tierId).toBe(rankedTierId);
    expect(defaultData.activeBoard.placements.find((placement) => placement.idolId === "custom-soraduki-tyra")?.tierId).toBeNull();
    expect(secondData.activeBoard.placements.find((placement) => placement.idolId === "custom-soraduki-tyra")?.tierId).toBeNull();
    expect(database.listHololiveCustomTalentMainChannels()).toEqual([
      { idolId: "custom-soraduki-tyra", youtubeChannelId: "UCdQYcUyffHZoz0KOwuiG0lQ" }
    ]);

    database.seedHololiveTierData();
    expect(database.getHololiveTierListData().idols.find((idol) => idol.id === "custom-soraduki-tyra")?.source).toBe("custom");

    const cardImageUrl = "https://example.com/soraduki-tyra-card.webp";
    database.upsertHololiveCustomTalent({ ...preview, cardImageUrl });
    expect(database.listHololiveIdols().find((idol) => idol.id === "custom-soraduki-tyra")?.cardImageUrl).toBe(cardImageUrl);

    database.upsertHololiveCustomTalent(preview);
    expect(database.listHololiveIdols().find((idol) => idol.id === "custom-soraduki-tyra")?.cardImageUrl).toBe(cardImageUrl);
  });

  it("does not allow custom talents to replace official Hololive channels", async () => {
    const database = await createTempDatabase();

    expect(() =>
      database.upsertHololiveCustomTalent({
        channelId: "UCp6993wxpyDPHUpavwDFqgg",
        displayName: "Fake Sora",
        slug: "fake-sora",
        branch: "Custom",
        generation: "Custom",
        officialUrl: "https://holodex.net/channel/UCp6993wxpyDPHUpavwDFqgg",
        iconUrl: "https://example.com/icon.png",
        profileImageUrl: "https://example.com/profile.png",
        youtubeChannelUrl: "https://www.youtube.com/channel/UCp6993wxpyDPHUpavwDFqgg"
      })
    ).toThrow(/official roster talent/);
  });

  it("resolves custom talent metadata from a Holodex search URL channel filter", async () => {
    const database = await createTempDatabase();
    const requests: string[] = [];
    const fetcher = (async (url: Parameters<typeof fetch>[0]) => {
      const href = String(url);
      requests.push(href);
      expect(href).toContain("/api/v2/channels/UCdQYcUyffHZoz0KOwuiG0lQ");
      return new Response(
        JSON.stringify({
          id: "UCdQYcUyffHZoz0KOwuiG0lQ",
          name: "宙月ティラ",
          english_name: "Soraduki Tyra",
          type: "vtuber",
          org: "Independents",
          group: "",
          photo: "https://yt3.googleusercontent.com/tyra=s176-c-k-c0x00ffffff-no-rj",
          twitter: "SoradukiTyra",
          video_count: "188",
          subscriber_count: "42,100",
          clip_count: "91",
          inactive: false
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;
    const service = new HolodexMusicService(database, fetcher);
    const preview = await service.resolveCustomTalent({
      channelInput:
        "https://holodex.net/search?q=type,value,text%0Atopic,Original_Song,Original_Song%0Achannel,UCdQYcUyffHZoz0KOwuiG0lQ,%E5%AE%99%E6%9C%88%E3%83%86%E3%82%A3%E3%83%A9&advanced=true"
    });

    expect(requests).toHaveLength(1);
    expect(preview).toMatchObject({
      channelId: "UCdQYcUyffHZoz0KOwuiG0lQ",
      displayName: "Soraduki Tyra",
      nativeName: "宙月ティラ",
      branch: "Independents",
      youtubeChannelUrl: "https://www.youtube.com/channel/UCdQYcUyffHZoz0KOwuiG0lQ",
      xHandle: "@SoradukiTyra",
      subscriberCount: 42100,
      videoCount: 188,
      clipCount: 91
    });
  });

  it("resolves YouTube handles from channel metadata instead of unrelated channel ids", async () => {
    const database = await createTempDatabase();
    const requests: string[] = [];
    const leeAndLieChannelId = "UC8THb_fnOptyVgpi3xuCd-A";
    const vodsChannelId = "UCPnT8Fa3khqsILlxhxcCKHA";
    const fetcher = (async (url: Parameters<typeof fetch>[0]) => {
      const href = String(url);
      requests.push(href);
      if (href === "https://www.youtube.com/@LeeandLie") {
        return new Response(
          `<!doctype html>
          <html><head><link rel="canonical" href="https://www.youtube.com/@LeeandLie"></head>
          <body>
            {"metadata":{"channelMetadataRenderer":{"title":"LeeandLie","externalId":"${leeAndLieChannelId}","vanityChannelUrl":"http://www.youtube.com/@LeeandLie","ownerUrls":["http://www.youtube.com/@LeeandLie"]}}}
            {"channelRenderer":{"channelId":"${vodsChannelId}","title":{"simpleText":"LeeandLie VODS"}}}
          </body></html>`,
          { status: 200, headers: { "Content-Type": "text/html" } }
        );
      }
      if (href.includes(`/api/v2/channels/${leeAndLieChannelId}`)) {
        return new Response(
          JSON.stringify({
            id: leeAndLieChannelId,
            name: "LeeandLie",
            english_name: "LeeandLie",
            type: "vtuber",
            org: "Independents",
            group: "",
            photo: "https://example.com/leeandlie.png",
            twitter: "LeeandLie",
            video_count: "100",
            subscriber_count: "1,000,000",
            clip_count: "0",
            inactive: false
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      throw new Error(`Unexpected request: ${href}`);
    }) as typeof fetch;
    const service = new HolodexMusicService(database, fetcher);

    const preview = await service.resolveCustomTalent({ channelInput: "@LeeandLie" });

    expect(requests).toEqual([
      "https://www.youtube.com/@LeeandLie",
      expect.stringContaining(`/api/v2/channels/${leeAndLieChannelId}`)
    ]);
    expect(requests.some((request) => request.includes(vodsChannelId))).toBe(false);
    expect(preview).toMatchObject({
      channelId: leeAndLieChannelId,
      displayName: "LeeandLie",
      youtubeChannelUrl: `https://www.youtube.com/channel/${leeAndLieChannelId}`
    });
  });

  it("rejects YouTube handle lookups that resolve to a different handle", async () => {
    const database = await createTempDatabase();
    const fetcher = (async (url: Parameters<typeof fetch>[0]) => {
      const href = String(url);
      expect(href).toBe("https://www.youtube.com/@LeeandLie");
      return new Response(
        `<!doctype html>
        <html><head><link rel="canonical" href="https://www.youtube.com/@LeeandLieVODS"></head>
        <body>{"metadata":{"channelMetadataRenderer":{"title":"LeeandLie VODS","externalId":"UCPnT8Fa3khqsILlxhxcCKHA","ownerUrls":["http://www.youtube.com/@LeeandLieVODS"]}}}</body></html>`,
        { status: 200, headers: { "Content-Type": "text/html" } }
      );
    }) as typeof fetch;
    const service = new HolodexMusicService(database, fetcher);

    await expect(service.resolveCustomTalent({ channelInput: "@LeeandLie" })).rejects.toThrow(
      /resolved @LeeandLie to @LeeandLieVODS/
    );
  });

  it("persists Hololive idol moves and placement ordering", async () => {
    const database = await createTempDatabase();
    const data = database.getHololiveTierListData();
    const boardId = data.activeBoard.id;
    const tierId = data.activeBoard.tiers[0].id;

    database.moveHololiveIdol({ boardId, idolId: "tokino-sora", tierId, index: 0 });
    database.moveHololiveIdol({ boardId, idolId: "roboco-san", tierId, index: 0 });
    database.moveHololiveIdol({ boardId, idolId: "azki", tierId, index: 1 });

    const ranked = database
      .getHololiveTierListData(boardId)
      .activeBoard.placements.filter((placement) => placement.tierId === tierId)
      .sort((left, right) => left.position - right.position);

    expect(ranked.map((placement) => placement.idolId)).toEqual(["roboco-san", "azki", "tokino-sora"]);
  });

  it("loads seeded Hololive idol profile metadata", async () => {
    const database = await createTempDatabase();

    const profile = database.getHololiveIdolProfile("tokino-sora");

    expect(profile.idol.displayName).toBe("Tokino Sora");
    expect(profile.idol.profileImageUrl).toContain("Tokino-Sora_pr-img_01.webp");
    expect(profile.idol.profileQuote).toBe("“Hey, Sora-tomo! How are you all doing? It's me, Tokino Sora!”");
    expect(profile.idol.youtubeChannelUrl).toContain("youtube.com/channel/");
    expect(profile.idol.youtubeChannelId).toBe("UCp6993wxpyDPHUpavwDFqgg");
    expect(profile.idol.xHandle).toBe("@tokino_sora");
    expect(profile.idol.birthday).toBe("May 15");
    expect(profile.idol.debutDate).toBe("September 7, 2017");
    expect(profile.idol.height).toBe("160 cm");
    expect(profile.links.map((link) => link.kind)).toEqual(["x"]);
    expect(profile.mainChannel).toMatchObject({
      id: "UCp6993wxpyDPHUpavwDFqgg",
      name: "Tokino Sora",
      subscriberCount: null,
      videoCount: null,
      clipCount: null
    });
    expect(profile.topicChannels).toEqual([]);
    expect(profile.mediaGroups.map((group) => group.label)).toEqual(["Original Songs", "Covers", "Featured In", "Playlists"]);
    expect(profile.mediaGroups.every((group) => group.items.length === 0)).toBe(true);
  });

  it("seeds rich official profile data for every in-scope Hololive idol", async () => {
    const database = await createTempDatabase();
    const data = database.getHololiveTierListData();
    const missingDebutIds = data.idols.filter((idol) => !idol.debutDate).map((idol) => idol.id);
    const missingHeightIds = data.idols.filter((idol) => !idol.height).map((idol) => idol.id);
    const reine = data.idols.find((idol) => idol.id === "pavolia-reine");
    const kronii = data.idols.find((idol) => idol.id === "ouro-kronii");

    expect(data.idols).toHaveLength(74);
    expect(data.idols.every((idol) => idol.profileImageUrl)).toBe(true);
    expect(data.idols.every((idol) => idol.profileQuote)).toBe(true);
    expect(data.idols.every((idol) => idol.youtubeChannelUrl)).toBe(true);
    expect(data.idols.every((idol) => idol.youtubeChannelId)).toBe(true);
    expect(data.idols.every((idol) => !idol.youtubeChannelUrl?.includes("sub_confirmation"))).toBe(true);
    expect(data.idols.every((idol) => idol.xHandle && idol.xUrl)).toBe(true);
    expect(data.idols.every((idol) => idol.birthday)).toBe(true);
    expect(missingDebutIds).toEqual(["azki"]);
    expect(missingHeightIds).toEqual([]);
    expect(reine?.debutDate).toBe("December 6, 2020");
    expect(reine?.height).toBe("172 cm");
    expect(kronii?.profileImageUrl).toContain("Ouro-Kronii_pr-img_05.webp");
    expect(kronii?.cardImageUrl).toBe(kronii?.profileImageUrl);
    expect(data.idols.find((idol) => idol.id === "elizabeth-rose-bloodflame")?.profileQuote).toBe(
      "“Let my voice be your strength.”"
    );
    expect(data.idols.every((idol) => idol.unit)).toBe(true);
  });

  it("ignores stale Hololive image cache filenames", async () => {
    const database = await createTempDatabase();
    const sourceUrl = "https://hololive.hololivepro.com/wp-content/uploads/2020/07/Mori-Calliope_pr-img_01.webp";

    database.upsertHololiveImageCache({
      idolId: "mori-calliope",
      kind: "profile",
      sourceUrl,
      localFilename: "mori-calliope-profile.webp",
      mimeType: "image/webp",
      sizeBytes: 123
    });

    expect(
      database
        .getHololiveTierListData()
        .idols.find((idol) => idol.id === "mori-calliope")?.cachedProfileImageUrl
    ).toBeNull();

    database.upsertHololiveImageCache({
      idolId: "mori-calliope",
      kind: "profile",
      sourceUrl,
      localFilename: "mori-calliope-profile-v6.webp",
      mimeType: "image/webp",
      sizeBytes: 456
    });

    expect(
      database
        .getHololiveTierListData()
        .idols.find((idol) => idol.id === "mori-calliope")?.cachedProfileImageUrl
    ).toBe("mori-calliope-profile-v6.webp");

    database.upsertHololiveImageCache({
      idolId: "mori-calliope",
      kind: "card",
      sourceUrl,
      localFilename: "mori-calliope-card.webp",
      mimeType: "image/webp",
      sizeBytes: 789
    });

    expect(
      database
        .getHololiveTierListData()
        .idols.find((idol) => idol.id === "mori-calliope")?.cachedCardImageUrl
    ).toBeNull();

    database.upsertHololiveImageCache({
      idolId: "mori-calliope",
      kind: "card",
      sourceUrl,
      localFilename: "mori-calliope-card-v2.png",
      mimeType: "image/png",
      sizeBytes: 1024
    });

    expect(
      database
        .getHololiveTierListData()
        .idols.find((idol) => idol.id === "mori-calliope")?.cachedCardImageUrl
    ).toBe("mori-calliope-card-v2.png");
  });

  it("does not update unchanged Hololive image cache rows", async () => {
    const database = await createTempDatabase();
    const input = {
      idolId: "tokino-sora",
      kind: "profile" as const,
      sourceUrl: "https://example.com/tokino-sora.webp",
      localFilename: "tokino-sora-profile-v9.webp",
      mimeType: "image/webp",
      sizeBytes: 2048
    };

    database.upsertHololiveImageCache(input);
    database.run(
      "UPDATE hololive_image_cache SET updated_at = ? WHERE idol_id = ? AND kind = ?",
      ["2000-01-01T00:00:00.000Z", input.idolId, input.kind]
    );
    database.upsertHololiveImageCache(input);

    expect(
      database.select<{ updated_at: string }>(
        "SELECT updated_at FROM hololive_image_cache WHERE idol_id = ? AND kind = ?",
        [input.idolId, input.kind]
      )[0]?.updated_at
    ).toBe("2000-01-01T00:00:00.000Z");
  });

  it("creates separate Hololive boards with independent placements", async () => {
    const database = await createTempDatabase();
    const defaultData = database.getHololiveTierListData();
    const defaultTierId = defaultData.activeBoard.tiers[0].id;
    database.moveHololiveIdol({ boardId: defaultData.activeBoard.id, idolId: "tokino-sora", tierId: defaultTierId, index: 0 });

    const secondBoardId = database.createHololiveTierBoard("Design Ranking");
    const secondBoard = database.getHololiveTierListData(secondBoardId).activeBoard;

    expect(secondBoard.name).toBe("Design Ranking");
    expect(secondBoard.placements).toHaveLength(HOLOLIVE_IDOLS.length);
    expect(secondBoard.placements.every((placement) => placement.tierId === null)).toBe(true);
  });

  it("undoes Hololive tier board clear and delete actions", async () => {
    const database = await createTempDatabase();
    const defaultData = database.getHololiveTierListData();
    const defaultBoardId = defaultData.activeBoard.id;
    const defaultTierId = defaultData.activeBoard.tiers[0].id;
    database.moveHololiveIdol({ boardId: defaultBoardId, idolId: "tokino-sora", tierId: defaultTierId, index: 0 });

    database.clearHololiveTierBoard(defaultBoardId);
    const clearUndo = database.consumeLatestHololiveUndo("tier-board-clear");
    expect(database.getHololiveTierListData(defaultBoardId).activeBoard.placements.find((placement) => placement.idolId === "tokino-sora")?.tierId).toBeNull();
    database.applyHololiveUndo(clearUndo?.undoToken ?? "");
    expect(
      database.getHololiveTierListData(defaultBoardId).activeBoard.placements.find((placement) => placement.idolId === "tokino-sora")?.tierId
    ).toBe(defaultTierId);

    const secondBoardId = database.createHololiveTierBoard("Undo Delete");
    database.deleteHololiveTierBoard(secondBoardId);
    const deleteUndo = database.consumeLatestHololiveUndo("tier-board-delete");
    expect(database.getHololiveTierListData().boards.some((board) => board.id === secondBoardId)).toBe(false);
    database.applyHololiveUndo(deleteUndo?.undoToken ?? "");
    expect(database.getHololiveTierListData(secondBoardId).activeBoard.name).toBe("Undo Delete");
  });

  it("persists every board placement and restores only the last active board pointer after reopening", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "holoshelf-db-active-board-"));
    const databasePath = path.join(dir, "test.sqlite");
    const firstConnection = await createTempDatabaseAt(databasePath);
    const defaultData = firstConnection.getHololiveTierListData();
    const defaultBoardId = defaultData.activeBoard.id;
    const defaultTierId = defaultData.activeBoard.tiers[0].id;

    firstConnection.moveHololiveIdol({ boardId: defaultBoardId, idolId: "tokino-sora", tierId: defaultTierId, index: 0 });

    const secondBoardId = firstConnection.createHololiveTierBoard("Second");
    const secondData = firstConnection.getHololiveTierListData(secondBoardId);
    const secondTierId = secondData.activeBoard.tiers[1].id;
    firstConnection.moveHololiveIdol({ boardId: secondBoardId, idolId: "roboco-san", tierId: secondTierId, index: 0 });

    const thirdBoardId = firstConnection.createHololiveTierBoard("Third");
    const thirdData = firstConnection.getHololiveTierListData(thirdBoardId);
    const thirdTierId = thirdData.activeBoard.tiers[2].id;
    firstConnection.moveHololiveIdol({ boardId: thirdBoardId, idolId: "azki", tierId: thirdTierId, index: 0 });
    firstConnection.getHololiveTierListData(thirdBoardId);

    const reopened = await createTempDatabaseAt(databasePath);
    const reopenedLastActive = reopened.getHololiveTierListData().activeBoard;
    const reopenedDefault = reopened.getHololiveTierListData(defaultBoardId).activeBoard;
    const reopenedSecond = reopened.getHololiveTierListData(secondBoardId).activeBoard;
    const reopenedThird = reopened.getHololiveTierListData(thirdBoardId).activeBoard;

    const defaultTokino = reopenedDefault.placements.find((placement) => placement.idolId === "tokino-sora");
    const defaultRoboco = reopenedDefault.placements.find((placement) => placement.idolId === "roboco-san");
    const secondRoboco = reopenedSecond.placements.find((placement) => placement.idolId === "roboco-san");
    const secondTokino = reopenedSecond.placements.find((placement) => placement.idolId === "tokino-sora");
    const thirdAzki = reopenedThird.placements.find((placement) => placement.idolId === "azki");
    const thirdRoboco = reopenedThird.placements.find((placement) => placement.idolId === "roboco-san");

    expect(reopenedLastActive.id).toBe(thirdBoardId);
    expect(defaultTokino?.tierId).toBe(defaultTierId);
    expect(defaultRoboco?.tierId).toBeNull();
    expect(secondRoboco?.tierId).toBe(secondTierId);
    expect(secondTokino?.tierId).toBeNull();
    expect(thirdAzki?.tierId).toBe(thirdTierId);
    expect(thirdRoboco?.tierId).toBeNull();
    expect(reopened.getHololiveTierListData(thirdBoardId).boards.map((board) => board.name)).toEqual([
      DEFAULT_HOLOLIVE_BOARD_NAME,
      "Second",
      "Third"
    ]);
  });

  it("keeps foreign key cleanup active after reopening an existing database", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "holoshelf-db-reopen-"));
    const databasePath = path.join(dir, "test.sqlite");
    const firstConnection = await createTempDatabaseAt(databasePath);
    const secondBoardId = firstConnection.createHololiveTierBoard("Temporary");

    const reopened = await createTempDatabaseAt(databasePath);
    reopened.deleteHololiveTierBoard(secondBoardId);

    expect(
      reopened.select<{ count: number }>(
        "SELECT COUNT(*) AS count FROM hololive_tier_placements WHERE board_id = ?",
        [secondBoardId]
      )[0].count
    ).toBe(0);
    expect(
      reopened.select<{ count: number }>("SELECT COUNT(*) AS count FROM hololive_tiers WHERE board_id = ?", [
        secondBoardId
      ])[0].count
    ).toBe(0);
  });

  it("inserts new Hololive boards after the requested board", async () => {
    const database = await createTempDatabase();
    const defaultBoardId = database.getHololiveTierListData().activeBoard.id;
    const secondBoardId = database.createHololiveTierBoard("Second");

    database.createHololiveTierBoard("Inserted", undefined, defaultBoardId);

    expect(database.getHololiveTierListData().boards.map((board) => board.name)).toEqual([
      DEFAULT_HOLOLIVE_BOARD_NAME,
      "Inserted",
      "Second"
    ]);
    expect(database.getHololiveTierListData(secondBoardId).activeBoard.name).toBe("Second");
  });

  it("persists Hololive board reordering", async () => {
    const database = await createTempDatabase();
    const firstBoardId = database.getHololiveTierListData().activeBoard.id;
    const secondBoardId = database.createHololiveTierBoard("Second");
    const thirdBoardId = database.createHololiveTierBoard("Third");

    database.reorderHololiveTierBoards([thirdBoardId, firstBoardId, secondBoardId]);

    expect(database.getHololiveTierListData().boards.map((board) => board.name)).toEqual([
      "Third",
      DEFAULT_HOLOLIVE_BOARD_NAME,
      "Second"
    ]);
  });

  it("sorts only unranked Hololive idols back to official order", async () => {
    const database = await createTempDatabase();
    const data = database.getHololiveTierListData();
    const boardId = data.activeBoard.id;
    const tierId = data.activeBoard.tiers[0].id;

    database.moveHololiveIdol({ boardId, idolId: "roboco-san", tierId, index: 0 });
    database.moveHololiveIdol({ boardId, idolId: "azki", tierId: null, index: 0 });
    database.sortHololiveUnrankedByDefaultOrder(boardId);

    const sorted = database.getHololiveTierListData(boardId).activeBoard.placements;
    const ranked = sorted.find((placement) => placement.idolId === "roboco-san");
    const unranked = sorted
      .filter((placement) => placement.tierId === null)
      .sort((left, right) => left.position - right.position)
      .map((placement) => placement.idolId);

    expect(ranked?.tierId).toBe(tierId);
    expect(unranked.slice(0, 4)).toEqual(["tokino-sora", "aki-rosenthal", "akai-haato", "shirakami-fubuki"]);
    expect(unranked.indexOf("sakamata-chloe")).toBeGreaterThan(unranked.indexOf("kikirara-vivi"));
    expect(unranked.slice(-11)).toEqual([
      "sakamata-chloe",
      "watson-amelia",
      "minato-aqua",
      "murasaki-shion",
      "amane-kanata",
      "kiryu-coco",
      "gawr-gura",
      "tsukumo-sana",
      "ceres-fauna",
      "nanashi-mumei",
      "hiodoshi-ao"
    ]);
  });

  it("clears a Hololive tier board while preserving board and tier settings", async () => {
    const database = await createTempDatabase();
    const data = database.getHololiveTierListData();
    const boardId = data.activeBoard.id;
    const tierId = data.activeBoard.tiers[0].id;

    database.updateHololiveTierBoard({ boardId, name: "Design Ranking", tileSize: 80 });
    database.updateHololiveTier({ boardId, tierId, color: "#123456", collapsed: true });
    database.moveHololiveIdol({ boardId, idolId: "roboco-san", tierId, index: 0 });
    database.moveHololiveIdol({ boardId, idolId: "azki", tierId, index: 1 });
    database.clearHololiveTierBoard(boardId);

    const cleared = database.getHololiveTierListData(boardId).activeBoard;
    const firstTier = cleared.tiers.find((tier) => tier.id === tierId);
    const firstFourUnranked = cleared.placements
      .filter((placement) => placement.tierId === null)
      .sort((left, right) => left.position - right.position)
      .slice(0, 4)
      .map((placement) => placement.idolId);

    expect(cleared.name).toBe("Design Ranking");
    expect(cleared.tileSize).toBe(80);
    expect(firstTier?.color).toBe("#123456");
    expect(firstTier?.collapsed).toBe(true);
    expect(cleared.placements.every((placement) => placement.tierId === null)).toBe(true);
    expect(firstFourUnranked).toEqual(["tokino-sora", "roboco-san", "aki-rosenthal", "akai-haato"]);
  });

  it("moves idols back to unranked when a Hololive tier is deleted", async () => {
    const database = await createTempDatabase();
    const data = database.getHololiveTierListData();
    const boardId = data.activeBoard.id;

    database.createHololiveTier({ boardId, label: "X", color: "#82dfff" });
    const customTier = database.getHololiveTierListData(boardId).activeBoard.tiers.find((tier) => tier.label === "X");
    expect(customTier).toBeDefined();

    database.moveHololiveIdol({ boardId, idolId: "tokino-sora", tierId: customTier!.id, index: 0 });
    database.deleteHololiveTier(boardId, customTier!.id);

    const placement = database
      .getHololiveTierListData(boardId)
      .activeBoard.placements.find((candidate) => candidate.idolId === "tokino-sora");

    expect(placement?.tierId).toBeNull();
  });

  it("rejects invalid Hololive board mutations without creating orphan rows", async () => {
    const database = await createTempDatabase();

    expect(() =>
      database.moveHololiveIdol({
        boardId: "missing-board",
        idolId: "tokino-sora",
        tierId: null,
        index: 0
      })
    ).toThrow(/Unknown Hololive tier board/);
    expect(() => database.createHololiveTier({ boardId: "missing-board", label: "X" })).toThrow(
      /Unknown Hololive tier board/
    );

    expect(
      database.select<{ count: number }>(
        "SELECT COUNT(*) AS count FROM hololive_tier_placements WHERE board_id = 'missing-board'"
      )[0].count
    ).toBe(0);
    expect(
      database.select<{ count: number }>(
        "SELECT COUNT(*) AS count FROM hololive_tiers WHERE board_id = 'missing-board'"
      )[0].count
    ).toBe(0);
  });

  it("inserts Hololive tiers at a requested position", async () => {
    const database = await createTempDatabase();
    const data = database.getHololiveTierListData();
    const boardId = data.activeBoard.id;

    database.createHololiveTier({ boardId, label: "X", color: "#82dfff", position: 1 });

    const labels = database
      .getHololiveTierListData(boardId)
      .activeBoard.tiers.sort((left, right) => left.position - right.position)
      .map((tier) => tier.label);

    expect(labels).toEqual(["S", "X", "A", "B", "C", "D", "F"]);
  });

  it("inserts Hololive songs with tags and tracking rows", async () => {
    const database = await createTempDatabase();

    const result = database.insertHololiveSong({
      title: "Stellar Stellar",
      artistName: "Suisei",
      tier: "SS",
      playlistName: "Favorites",
      sourceUrl: "https://example.com/song",
      notes: "top tier"
    });

    expect(result).toBe("inserted");
    const items = database.listCatalog({ moduleId: "hololive" });
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("Stellar Stellar");
    expect(items[0].tags).toContain("suisei");
  });

  it("imports Holodex final artifacts idempotently for the current idol roster", async () => {
    const artifactDir = createHolodexArtifactFixture();
    const database = await createTempDatabase();
    const service = new HolodexMusicService(database);

    const firstImport = await service.importArtifacts(artifactDir);
    const secondImport = await service.importArtifacts(artifactDir);
    const status = database.getHololiveMusicStatus();
    const originals = database.listHololiveMusicRows({ topicId: "Original_Song", limit: 10 });
    const covers = database.listHololiveMusicRows({ topicId: "Music_Cover", limit: 10 });
    const soraProfile = database.getHololiveIdolProfile("tokino-sora");

    expect(firstImport.sourceRows).toBe(2);
    expect(firstImport.importedRows).toBe(2);
    expect(firstImport.detailCacheRows).toBe(firstImport.importedRows);
    expect(firstImport.duplicateRows).toBe(0);
    expect(secondImport.importedRows).toBe(firstImport.importedRows);
    expect(status.totalRows).toBe(2);
    expect(originals.map((row) => row.youtubeVideoId)).toEqual(["fixture-sora-original"]);
    expect(covers.map((row) => row.youtubeVideoId)).toEqual(["fixture-roboco-cover"]);
    expect(database.listCatalog({ moduleId: "hololive", limit: 10 }).map((row) => row.title)).toEqual([
      "Sora Fixture Original",
      "Roboco Fixture Cover"
    ]);
    expect(soraProfile.mediaGroups.find((group) => group.id === "original-songs")?.items.length).toBeGreaterThan(0);
  });

  it("can replace existing Holodex music rows and stale cache data", async () => {
    const database = await createTempDatabase();
    const defaultBoard = database.getHololiveTierListData().activeBoard;
    const defaultTierId = defaultBoard.tiers[0].id;
    database.moveHololiveIdol({ boardId: defaultBoard.id, idolId: "tokino-sora", tierId: defaultTierId, index: 0 });

    const customBoardId = database.createHololiveTierBoard("Saved Personal Board");
    const customBoard = database.getHololiveTierListData(customBoardId).activeBoard;
    const customTierId = customBoard.tiers[2].id;
    database.moveHololiveIdol({ boardId: customBoardId, idolId: "roboco-san", tierId: customTierId, index: 0 });

    const firstBundle: HolodexArtifactBundle = {
      rows: [
        {
          youtubeVideoId: "old-song",
          youtubeUrl: "https://www.youtube.com/watch?v=old-song",
          title: "Old Song",
          status: "past",
          topicId: "Original_Song",
          channelId: "UCp6993wxpyDPHUpavwDFqgg",
          channelName: "SoraCh.",
          publishedAt: "2025-01-01T00:00:00.000Z"
        }
      ],
      detailCache: {
        "old-song": normalizeVideoDetail("old-song", {
          youtubeVideoId: "old-song",
          channelId: "UCp6993wxpyDPHUpavwDFqgg",
          duration: 180,
          songNames: ["Old Song"],
          relationshipsLoaded: true
        })
      },
      duplicateRemovals: []
    };
    const replacementBundle: HolodexArtifactBundle = {
      rows: [
        {
          youtubeVideoId: "new-song",
          youtubeUrl: "https://www.youtube.com/watch?v=new-song",
          title: "New Song",
          status: "past",
          topicId: "Music_Cover",
          channelId: "UCp6993wxpyDPHUpavwDFqgg",
          channelName: "SoraCh.",
          publishedAt: "2026-01-01T00:00:00.000Z"
        }
      ],
      detailCache: {
        "new-song": normalizeVideoDetail("new-song", {
          youtubeVideoId: "new-song",
          channelId: "UCp6993wxpyDPHUpavwDFqgg",
          duration: 180,
          songNames: ["New Song"],
          relationshipsLoaded: true
        })
      },
      duplicateRemovals: []
    };

    database.importHolodexMusicArtifacts(firstBundle, "live");
    database.setHololiveMusicMarker({ youtubeVideoId: "old-song", marker: "favorite" });
    const result = database.importHolodexMusicArtifacts(replacementBundle, "live", { replaceExisting: true });
    const marker = database.setHololiveMusicMarker({ youtubeVideoId: "new-song", marker: "like" });

    expect(result.importedRows).toBe(1);
    expect(marker).toMatchObject({ youtubeVideoId: "new-song", marker: "like" });
    expect(database.listHololiveMusicRows({ query: "Old Song" })).toHaveLength(0);
    expect(database.listHololiveMusicRows({ query: "New Song" })).toMatchObject([{ youtubeVideoId: "new-song", marker: "like" }]);
    expect(database.select<{ youtube_video_id: string }>("SELECT youtube_video_id FROM hololive_music_detail_cache")).toEqual([
      { youtube_video_id: "new-song" }
    ]);
    expect(database.select<{ title: string }>("SELECT title FROM catalog_items WHERE id = 'holodex:old-song'")).toHaveLength(0);
    expect(database.select<{ count: number }>("SELECT COUNT(*) AS count FROM hololive_music_refresh_runs")[0].count).toBe(1);
    expect(
      database.select<{ marker_key: string; marker: string }>(
        "SELECT marker_key, marker FROM hololive_music_marker_keys ORDER BY marker_key"
      )
    ).toEqual([
      { marker_key: "Music_Cover:new song:tokino-sora", marker: "like" },
      { marker_key: "Original_Song:old song:tokino-sora", marker: "favorite" },
      { marker_key: "video:new-song", marker: "like" },
      { marker_key: "video:old-song", marker: "favorite" }
    ]);

    const reopenedDefault = database.getHololiveTierListData(defaultBoard.id).activeBoard;
    const reopenedCustom = database.getHololiveTierListData(customBoardId).activeBoard;
    expect(database.getHololiveTierListData(customBoardId).boards.map((board) => board.name)).toEqual([
      DEFAULT_HOLOLIVE_BOARD_NAME,
      "Saved Personal Board"
    ]);
    expect(reopenedDefault.placements.find((placement) => placement.idolId === "tokino-sora")?.tierId).toBe(defaultTierId);
    expect(reopenedCustom.placements.find((placement) => placement.idolId === "roboco-san")?.tierId).toBe(customTierId);
  });

  it("filters disallowed Holodex song variants before storing music rows", async () => {
    const database = await createTempDatabase();
    const bundle: HolodexArtifactBundle = {
      rows: [
        {
          youtubeVideoId: "valid-song",
          youtubeUrl: "https://www.youtube.com/watch?v=valid-song",
          title: "Valid Song",
          status: "past",
          topicId: "Original_Song",
          channelId: "UCp6993wxpyDPHUpavwDFqgg",
          channelName: "SoraCh.",
          publishedAt: "2026-01-01T00:00:00.000Z"
        },
        {
          youtubeVideoId: "midnight-song",
          youtubeUrl: "https://www.youtube.com/watch?v=midnight-song",
          title: "Valid Song (Midnight ver.)",
          status: "past",
          topicId: "Original_Song",
          channelId: "UCp6993wxpyDPHUpavwDFqgg",
          channelName: "SoraCh.",
          publishedAt: "2026-01-02T00:00:00.000Z"
        },
        {
          youtubeVideoId: "metadata-bouquet-song",
          youtubeUrl: "https://www.youtube.com/watch?v=metadata-bouquet-song",
          title: "Plain Display Title",
          status: "past",
          topicId: "Music_Cover",
          channelId: "UCp6993wxpyDPHUpavwDFqgg",
          channelName: "SoraCh.",
          publishedAt: "2026-01-03T00:00:00.000Z"
        },
        {
          youtubeVideoId: "twilight-song",
          youtubeUrl: "https://www.youtube.com/watch?v=twilight-song",
          title: "Valid Song (Twilight ver.)",
          status: "past",
          topicId: "Music_Cover",
          channelId: "UCp6993wxpyDPHUpavwDFqgg",
          channelName: "SoraCh.",
          publishedAt: "2026-01-04T00:00:00.000Z"
        },
        {
          youtubeVideoId: "daybreak-song",
          youtubeUrl: "https://www.youtube.com/watch?v=daybreak-song",
          title: "Valid Song (Daybreak ver.)",
          status: "past",
          topicId: "Music_Cover",
          channelId: "UCp6993wxpyDPHUpavwDFqgg",
          channelName: "SoraCh.",
          publishedAt: "2026-01-04T12:00:00.000Z"
        },
        {
          youtubeVideoId: "remastered-song",
          youtubeUrl: "https://www.youtube.com/watch?v=remastered-song",
          title: "Valid Song (Remastered)",
          status: "past",
          topicId: "Original_Song",
          channelId: "UCp6993wxpyDPHUpavwDFqgg",
          channelName: "SoraCh.",
          publishedAt: "2026-01-04T12:30:00.000Z"
        },
        {
          youtubeVideoId: "solo-song",
          youtubeUrl: "https://www.youtube.com/watch?v=solo-song",
          title: "\u77ac\u9593\u30cf\u30fc\u30c8\u30d3\u30fc\u30c8 (\u4e00\u6761\u8389\u3005\u83ef SOLO ver.)",
          status: "past",
          topicId: "Original_Song",
          channelId: "UCp6993wxpyDPHUpavwDFqgg",
          channelName: "SoraCh.",
          publishedAt: "2026-01-04T12:35:00.000Z"
        },
        {
          youtubeVideoId: "metadata-solo-song",
          youtubeUrl: "https://www.youtube.com/watch?v=metadata-solo-song",
          title: "Plain Solo Display Title",
          status: "past",
          topicId: "Music_Cover",
          channelId: "UCp6993wxpyDPHUpavwDFqgg",
          channelName: "SoraCh.",
          publishedAt: "2026-01-04T12:36:00.000Z"
        },
        {
          youtubeVideoId: "promo-song",
          youtubeUrl: "https://www.youtube.com/watch?v=promo-song",
          title: "\u300eValid Song\u300f1st\u30aa\u30ea\u30b8\u30ca\u30eb\u30bd\u30f3\u30b0-\u5ba3\u4f1dMV-",
          status: "past",
          topicId: "Original_Song",
          channelId: "UCp6993wxpyDPHUpavwDFqgg",
          channelName: "SoraCh.",
          publishedAt: "2026-01-04T12:40:00.000Z"
        },
        {
          youtubeVideoId: "promotion-day",
          youtubeUrl: "https://www.youtube.com/watch?v=promotion-day",
          title: "Promotion Day",
          status: "past",
          topicId: "Music_Cover",
          channelId: "UCp6993wxpyDPHUpavwDFqgg",
          channelName: "SoraCh.",
          publishedAt: "2026-01-04T12:50:00.000Z"
        },
        {
          youtubeVideoId: "daybreak-frontline",
          youtubeUrl: "https://www.youtube.com/watch?v=daybreak-frontline",
          title: "DAYBREAK FRONTLINE",
          status: "past",
          topicId: "Music_Cover",
          channelId: "UCp6993wxpyDPHUpavwDFqgg",
          channelName: "SoraCh.",
          publishedAt: "2026-01-04T13:00:00.000Z"
        },
        {
          youtubeVideoId: "metadata-twilight-song",
          youtubeUrl: "https://www.youtube.com/watch?v=metadata-twilight-song",
          title: "Another Plain Display Title",
          status: "past",
          topicId: "Music_Cover",
          channelId: "UCp6993wxpyDPHUpavwDFqgg",
          channelName: "SoraCh.",
          publishedAt: "2026-01-05T00:00:00.000Z"
        },
        {
          youtubeVideoId: "lofi-song",
          youtubeUrl: "https://www.youtube.com/watch?v=lofi-song",
          title: "Valid Song Lofi Version",
          status: "past",
          topicId: "Music_Cover",
          channelId: "UCp6993wxpyDPHUpavwDFqgg",
          channelName: "SoraCh.",
          publishedAt: "2026-01-06T00:00:00.000Z"
        },
        {
          youtubeVideoId: "remix-song",
          youtubeUrl: "https://www.youtube.com/watch?v=remix-song",
          title: "Valid Song Remix",
          status: "past",
          topicId: "Music_Cover",
          channelId: "UCp6993wxpyDPHUpavwDFqgg",
          channelName: "SoraCh.",
          publishedAt: "2026-01-07T00:00:00.000Z"
        }
      ],
      detailCache: {
        "valid-song": normalizeVideoDetail("valid-song", {
          youtubeVideoId: "valid-song",
          channelId: "UCp6993wxpyDPHUpavwDFqgg",
          duration: 180,
          songNames: ["Valid Song"],
          relationshipsLoaded: true
        }),
        "midnight-song": normalizeVideoDetail("midnight-song", {
          youtubeVideoId: "midnight-song",
          channelId: "UCp6993wxpyDPHUpavwDFqgg",
          duration: 180,
          songNames: ["Valid Song (Midnight ver.)"],
          relationshipsLoaded: true
        }),
        "metadata-bouquet-song": normalizeVideoDetail("metadata-bouquet-song", {
          youtubeVideoId: "metadata-bouquet-song",
          channelId: "UCp6993wxpyDPHUpavwDFqgg",
          duration: 180,
          songNames: ["Plain Display Title (Bouquet ver.)"],
          relationshipsLoaded: true
        }),
        "twilight-song": normalizeVideoDetail("twilight-song", {
          youtubeVideoId: "twilight-song",
          channelId: "UCp6993wxpyDPHUpavwDFqgg",
          duration: 180,
          songNames: ["Valid Song (Twilight ver.)"],
          relationshipsLoaded: true
        }),
        "daybreak-song": normalizeVideoDetail("daybreak-song", {
          youtubeVideoId: "daybreak-song",
          channelId: "UCp6993wxpyDPHUpavwDFqgg",
          duration: 180,
          songNames: ["Valid Song (Daybreak ver.)"],
          relationshipsLoaded: true
        }),
        "remastered-song": normalizeVideoDetail("remastered-song", {
          youtubeVideoId: "remastered-song",
          channelId: "UCp6993wxpyDPHUpavwDFqgg",
          duration: 180,
          songNames: ["Valid Song (Remastered)"],
          relationshipsLoaded: true
        }),
        "solo-song": normalizeVideoDetail("solo-song", {
          youtubeVideoId: "solo-song",
          channelId: "UCp6993wxpyDPHUpavwDFqgg",
          duration: 180,
          songNames: ["\u77ac\u9593\u30cf\u30fc\u30c8\u30d3\u30fc\u30c8 (\u4e00\u6761\u8389\u3005\u83ef SOLO ver.)"],
          relationshipsLoaded: true
        }),
        "metadata-solo-song": normalizeVideoDetail("metadata-solo-song", {
          youtubeVideoId: "metadata-solo-song",
          channelId: "UCp6993wxpyDPHUpavwDFqgg",
          duration: 180,
          songNames: ["FG ROADSTER (\u864e\u91d1\u5983\u7b11\u864e SOLO ver.)"],
          relationshipsLoaded: true
        }),
        "promo-song": normalizeVideoDetail("promo-song", {
          youtubeVideoId: "promo-song",
          channelId: "UCp6993wxpyDPHUpavwDFqgg",
          duration: 85,
          songNames: [],
          relationshipsLoaded: true
        }),
        "promotion-day": normalizeVideoDetail("promotion-day", {
          youtubeVideoId: "promotion-day",
          channelId: "UCp6993wxpyDPHUpavwDFqgg",
          duration: 180,
          songNames: ["Promotion Day"],
          relationshipsLoaded: true
        }),
        "daybreak-frontline": normalizeVideoDetail("daybreak-frontline", {
          youtubeVideoId: "daybreak-frontline",
          channelId: "UCp6993wxpyDPHUpavwDFqgg",
          duration: 180,
          songNames: ["DAYBREAK FRONTLINE"],
          relationshipsLoaded: true
        }),
        "metadata-twilight-song": normalizeVideoDetail("metadata-twilight-song", {
          youtubeVideoId: "metadata-twilight-song",
          channelId: "UCp6993wxpyDPHUpavwDFqgg",
          duration: 180,
          songNames: ["Another Plain Display Title (Twilight ver.)"],
          relationshipsLoaded: true
        }),
        "lofi-song": normalizeVideoDetail("lofi-song", {
          youtubeVideoId: "lofi-song",
          channelId: "UCp6993wxpyDPHUpavwDFqgg",
          duration: 180,
          songNames: ["Valid Song Lofi Version"],
          relationshipsLoaded: true
        }),
        "remix-song": normalizeVideoDetail("remix-song", {
          youtubeVideoId: "remix-song",
          channelId: "UCp6993wxpyDPHUpavwDFqgg",
          duration: 180,
          songNames: ["Valid Song Remix"],
          relationshipsLoaded: true
        })
      },
      duplicateRemovals: []
    };

    const result = database.importHolodexMusicArtifacts(bundle, "live");

    expect(result.importedRows).toBe(3);
    expect(database.listHololiveMusicRows({ query: "SOLO ver", limit: 10 })).toHaveLength(0);
    expect(database.listHololiveMusicRows({ limit: 10 }).map((row) => row.youtubeVideoId).sort()).toEqual([
      "daybreak-frontline",
      "promotion-day",
      "valid-song"
    ]);
    expect(
      database.select<{ youtube_video_id: string }>(
        "SELECT youtube_video_id FROM hololive_music_videos ORDER BY youtube_video_id"
      )
    ).toEqual([
      { youtube_video_id: "daybreak-frontline" },
      { youtube_video_id: "promotion-day" },
      { youtube_video_id: "valid-song" }
    ]);
  });

  it("purges album release promos and their detached stats on startup", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "holoshelf-db-album-promo-"));
    const databasePath = path.join(dir, "test.sqlite");
    const database = await createTempDatabaseAt(databasePath);

    seedHololiveBracketSong(database, {
      idolId: "mori-calliope",
      idolName: "Mori Calliope",
      channelId: "UCL_qhgtOy0dy1Agp8vkySQg",
      topicId: "Original_Song",
      suffix: "album-release",
      viewCount: 476479
    });
    database.run(
      "UPDATE hololive_music_videos SET title = ?, song_name = NULL WHERE youtube_video_id = ?",
      ["【1st Full Album】“UnAlive\" Calliope Mori Releasing 3.21.2022", "mori-calliope-album-release"]
    );
    database.run(
      "INSERT INTO hololive_music_video_stats (youtube_video_id, view_count, fetched_at) VALUES (?, ?, ?)",
      ["detached-album-promo", 1000, new Date().toISOString()]
    );
    database.flush();

    const reopened = await createTempDatabaseAt(databasePath);

    expect(reopened.listHololiveMusicRows({ query: "UnAlive", limit: 10 })).toHaveLength(0);
    expect(
      reopened.select("SELECT youtube_video_id FROM hololive_music_video_stats WHERE youtube_video_id = ?", [
        "mori-calliope-album-release"
      ])
    ).toHaveLength(0);
    expect(
      reopened.select("SELECT youtube_video_id FROM hololive_music_video_stats WHERE youtube_video_id = ?", [
        "detached-album-promo"
      ])
    ).toHaveLength(0);
    expect(
      reopened.select("SELECT youtube_video_id FROM hololive_music_detail_cache WHERE youtube_video_id = ?", [
        "mori-calliope-album-release"
      ])
    ).toHaveLength(0);
  });

  it("deactivates rejected long compilations without deleting personal references", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "holoshelf-db-study-compilation-"));
    const databasePath = path.join(dir, "test.sqlite");
    const database = await createTempDatabaseAt(databasePath);
    const youtubeVideoId = "takanashi-kiara-study-compilation";

    seedHololiveBracketSong(database, {
      idolId: "takanashi-kiara",
      idolName: "Takanashi Kiara",
      channelId: "UCHsx4Hqa-1ORjQTh9TYDhww",
      topicId: "Music_Cover",
      suffix: "study-compilation",
      viewCount: 21844
    });
    database.run(
      `UPDATE hololive_music_videos
       SET title = ?, song_name = NULL, duration_seconds = ?
       WHERE youtube_video_id = ?`,
      ["【KFP OST】Kiara Bangers To Study To 【Pineapple, Mirage, Chimera, Perfume, Tasty】", 1035, youtubeVideoId]
    );
    database.setHololiveMusicMarker({ youtubeVideoId, marker: "favorite" });
    database.createHololiveMusicPlaylist("Saved mixes");
    const playlistId = database.getHololiveMusicPlayerData().playlists.find((playlist) => playlist.name === "Saved mixes")?.id;
    expect(playlistId).toBeTruthy();
    database.addHololiveMusicPlaylistItem({ playlistId: playlistId ?? "", youtubeVideoId });
    database.flush();

    const reopened = await createTempDatabaseAt(databasePath);

    expect(reopened.listHololiveMusicRows({ youtubeVideoIds: [youtubeVideoId] })).toHaveLength(0);
    expect(
      reopened.select<{ official_catalog_active: number }>(
        "SELECT official_catalog_active FROM hololive_music_videos WHERE youtube_video_id = ?",
        [youtubeVideoId]
      )
    ).toEqual([{ official_catalog_active: 0 }]);
    const preservedMarkers = reopened.select<{ marker: string }>("SELECT marker FROM hololive_music_marker_keys");
    expect(preservedMarkers.length).toBeGreaterThan(0);
    expect(preservedMarkers.every((row) => row.marker === "favorite")).toBe(true);
    expect(
      reopened
        .getHololiveMusicPlayerData()
        .playlists.find((playlist) => playlist.id === playlistId)
        ?.items?.map((item) => ({ youtubeVideoId: item.youtubeVideoId, available: item.available }))
    ).toEqual([{ youtubeVideoId, available: false }]);
  });

  it("persists Hololive music markers across database reopen and profile queries", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "holoshelf-db-music-marker-"));
    const databasePath = path.join(dir, "test.sqlite");
    const database = await createTempDatabaseAt(databasePath);
    const bundle: HolodexArtifactBundle = {
      rows: [
        {
          youtubeVideoId: "sora-marker-song",
          youtubeUrl: "https://www.youtube.com/watch?v=sora-marker-song",
          title: "Sora Marker Song",
          status: "past",
          topicId: "Original_Song",
          channelId: "UCp6993wxpyDPHUpavwDFqgg",
          channelName: "SoraCh.",
          publishedAt: "2026-01-01T00:00:00.000Z"
        }
      ],
      detailCache: {
        "sora-marker-song": normalizeVideoDetail("sora-marker-song", {
          youtubeVideoId: "sora-marker-song",
          channelId: "UCp6993wxpyDPHUpavwDFqgg",
          duration: 180,
          songNames: ["Sora Marker Song"],
          relationshipsLoaded: true
        })
      },
      duplicateRemovals: []
    };

    database.importHolodexMusicArtifacts(bundle, "live");
    database.setHololiveMusicMarker({ youtubeVideoId: "sora-marker-song", marker: "neutral" });

    const reopened = await createTempDatabaseAt(databasePath);
    const row = reopened.listHololiveMusicRows({ query: "Sora Marker Song" })[0];
    const profileItem = reopened
      .getHololiveIdolProfile("tokino-sora")
      .mediaGroups.find((group) => group.id === "original-songs")
      ?.items.find((item) => item.id === "sora-marker-song");

    expect(row.marker).toBe("neutral");
    expect(profileItem?.marker).toBe("neutral");
    expect(reopened.setHololiveMusicMarker({ youtubeVideoId: "sora-marker-song", marker: null })).toMatchObject({
      youtubeVideoId: "sora-marker-song",
      marker: null,
      updatedAt: null
    });
    expect(reopened.listHololiveMusicRows({ query: "Sora Marker Song" })[0].marker).toBeNull();
  });

  it("stores referenced Hololive performers as featured talents during music import", async () => {
    const database = await createTempDatabase();
    const bundle: HolodexArtifactBundle = {
      rows: [
        {
          youtubeVideoId: "saikai-feature",
          youtubeUrl: "https://www.youtube.com/watch?v=saikai-feature",
          title: "【COVER】SAIKAI | 再会【Moona x Suisei Hoshimachi | ムーナ/星街すいせい】",
          status: "past",
          topicId: "Music_Cover",
          channelId: "UCP0BspO_AMEe3aQqqpo89Dg",
          channelName: "Moona Hoshinova hololive-ID",
          publishedAt: "2021-12-03T12:00:13.000Z"
        }
      ],
      detailCache: {
        "saikai-feature": normalizeVideoDetail("saikai-feature", {
          youtubeVideoId: "saikai-feature",
          channelId: "UCP0BspO_AMEe3aQqqpo89Dg",
          duration: 243,
          songNames: ["再会 / Saikai (feat. Hoshimachi Suisei)"],
          mentions: [
            {
              channelId: "UC5CwaMl1eIgY8h02uZw7u8A",
              name: "Suisei Channel",
              englishName: "Hoshimachi Suisei",
              type: "vtuber",
              photoUrl: "",
              org: "Hololive"
            }
          ],
          relationshipsLoaded: true
        })
      },
      duplicateRemovals: []
    };

    database.importHolodexMusicArtifacts(bundle, "live");
    const row = database.listHololiveMusicRows({ youtubeVideoIds: ["saikai-feature"] })[0];
    const suiseiFeaturedItems = database
      .getHololiveIdolProfile("hoshimachi-suisei")
      .mediaGroups.find((group) => group.id === "featured-in")
      ?.items ?? [];

    expect(row.ownedIdolIds).toEqual(["moona-hoshinova"]);
    expect(row.featuredIdolIds).toEqual(["hoshimachi-suisei"]);
    expect(row.participants.some((participant) => participant.idolId === "hoshimachi-suisei")).toBe(true);
    expect(suiseiFeaturedItems.some((item) => item.id === "saikai-feature")).toBe(true);
  });

  it("repairs stale featured talent metadata during database startup backfill", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "holoshelf-db-feature-backfill-"));
    const databasePath = path.join(dir, "test.sqlite");
    const database = await createTempDatabaseAt(databasePath);
    seedHololiveBracketSong(database, {
      idolId: "moona-hoshinova",
      idolName: "Moona Hoshinova",
      channelId: "UCP0BspO_AMEe3aQqqpo89Dg",
      topicId: "Music_Cover",
      suffix: "stale-feature",
      viewCount: 1_000_000
    });
    database.run(
      `UPDATE hololive_music_videos
       SET title = ?, song_name = ?, canonical_song_key = ?, canonical_performance_key = ?, featured_idol_ids_json = ?
       WHERE youtube_video_id = ?`,
      [
        "【COVER】SAIKAI | 再会【Moona x Suisei Hoshimachi | ムーナ/星街すいせい】",
        "再会 / Saikai (feat. Hoshimachi Suisei)",
        "再会",
        "Music_Cover:再会:moona-hoshinova",
        "[]",
        "moona-hoshinova-stale-feature"
      ]
    );
    database.flush();

    const reopened = await createTempDatabaseAt(databasePath);
    const row = reopened.listHololiveMusicRows({ youtubeVideoIds: ["moona-hoshinova-stale-feature"] })[0];

    expect(row.ownedIdolIds).toEqual(["moona-hoshinova"]);
    expect(row.featuredIdolIds).toEqual(["hoshimachi-suisei"]);
    expect(row.participants.some((participant) => participant.idolId === "hoshimachi-suisei")).toBe(true);
  });

  it("refreshes YouTube view counts into durable music stats", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "holoshelf-db-video-stats-"));
    const databasePath = path.join(dir, "test.sqlite");
    const database = await createTempDatabaseAt(databasePath);
    const bundle: HolodexArtifactBundle = {
      rows: [
        {
          youtubeVideoId: "sora-stats-song",
          youtubeUrl: "https://www.youtube.com/watch?v=sora-stats-song",
          title: "Sora Stats Song",
          status: "past",
          topicId: "Original_Song",
          channelId: "UCp6993wxpyDPHUpavwDFqgg",
          channelName: "SoraCh.",
          publishedAt: "2026-01-01T00:00:00.000Z"
        }
      ],
      detailCache: {
        "sora-stats-song": normalizeVideoDetail("sora-stats-song", {
          youtubeVideoId: "sora-stats-song",
          channelId: "UCp6993wxpyDPHUpavwDFqgg",
          duration: 180,
          songNames: ["Sora Stats Song"],
          relationshipsLoaded: true
        })
      },
      duplicateRemovals: []
    };
    database.importHolodexMusicArtifacts(bundle, "live");
    const fetcher = (async (input: Parameters<typeof fetch>[0]) => {
      const url = new URL(String(input));
      expect(url.searchParams.get("part")).toBe("snippet,statistics,status");
      expect(url.searchParams.get("fields")).toBe(
        "items(id,snippet(channelId,channelTitle),statistics(viewCount),status(uploadStatus,privacyStatus,embeddable))"
      );
      expect(url.searchParams.get("id")).toBe("sora-stats-song");
      expect(url.searchParams.get("key")).toBe("test-youtube-key");
      return new Response(
        JSON.stringify({
          items: [
            {
              id: "sora-stats-song",
              snippet: { channelId: "UCp6993wxpyDPHUpavwDFqgg", channelTitle: "SoraCh." },
              statistics: { viewCount: "1234567" },
              status: { uploadStatus: "processed", privacyStatus: "public", embeddable: true }
            }
          ]
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;
    const service = new YouTubeVideoStatsService(database, {
      apiKey: "test-youtube-key",
      fetcher
    });

    const result = await service.refreshViewCounts();
    const row = database.listHololiveMusicRows({ query: "Sora Stats Song" })[0];
    const profileItem = database
      .getHololiveIdolProfile("tokino-sora")
      .mediaGroups.find((group) => group.id === "original-songs")
      ?.items.find((item) => item.id === "sora-stats-song");

    expect(result).toMatchObject({
      requestedVideos: 1,
      updatedVideos: 1,
      missingVideos: 0,
      failedBatches: 0,
      batches: 1
    });
    expect(row.viewCount).toBe(1234567);
    expect(row.viewCountFetchedAt).toBe(result.fetchedAt);
    expect(profileItem).toMatchObject({
      id: "sora-stats-song",
      viewCount: 1234567,
      viewCountFetchedAt: result.fetchedAt
    });

    database.importHolodexMusicArtifacts(
      {
        ...bundle,
        rows: [{ ...bundle.rows[0], title: "Sora Stats Song Updated" }]
      },
      "live",
      { replaceExisting: true }
    );
    expect(database.listHololiveMusicRows({ query: "Sora Stats Song Updated" })[0].viewCount).toBe(1234567);

    database.setSetting("sources.youtubeApiKey", "settings-youtube-key");
    const settingsFetcher = (async (input: Parameters<typeof fetch>[0]) => {
      const url = new URL(String(input));
      expect(url.searchParams.get("key")).toBe("settings-youtube-key");
      return new Response(
        JSON.stringify({
          items: [
            {
              id: "sora-stats-song",
              snippet: { channelId: "UCp6993wxpyDPHUpavwDFqgg", channelTitle: "SoraCh." },
              statistics: { viewCount: "7654321" },
              status: { uploadStatus: "processed", privacyStatus: "public", embeddable: true }
            }
          ]
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;
    const settingsService = new YouTubeVideoStatsService(database, {
      fetcher: settingsFetcher
    });

    await settingsService.refreshViewCounts({ youtubeVideoIds: ["sora-stats-song"] });
    expect(database.listHololiveMusicRows({ query: "Sora Stats Song Updated" })[0].viewCount).toBe(7654321);
  });

  it("rejects Holodex topic rows when YouTube reports a different uploader channel", async () => {
    const database = await createTempDatabase();
    const youtubeVideoId = "topic-mismatch-song";
    database.importHolodexMusicArtifacts(
      {
        rows: [
          {
            youtubeVideoId,
            youtubeUrl: `https://www.youtube.com/watch?v=${youtubeVideoId}`,
            title: "Imposter Topic Song",
            status: "past",
            topicId: "Original_Song",
            channelId: "UCp6993wxpyDPHUpavwDFqgg",
            channelName: "SoraCh.",
            publishedAt: "2026-01-01T00:00:00.000Z"
          }
        ],
        detailCache: {
          [youtubeVideoId]: normalizeVideoDetail(youtubeVideoId, {
            channelId: "UCp6993wxpyDPHUpavwDFqgg",
            originalChannelId: "expected-topic-channel",
            providedToYoutube: true,
            duration: 180,
            songNames: ["Imposter Topic Song"],
            relationshipsLoaded: true
          })
        },
        duplicateRemovals: []
      },
      "live"
    );
    expect(database.listHololiveMusicRows({ youtubeVideoIds: [youtubeVideoId] })).toHaveLength(1);

    const service = new YouTubeVideoStatsService(database, {
      apiKey: "test-youtube-key",
      fetcher: (async () =>
        new Response(
          JSON.stringify({
            items: [
              {
                id: youtubeVideoId,
                snippet: { channelId: "imposter-topic-channel", channelTitle: "Sora - Topic" },
                statistics: { viewCount: "123" },
                status: { uploadStatus: "processed", privacyStatus: "public", embeddable: true }
              }
            ]
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )) as typeof fetch
    });

    const result = await service.refreshViewCounts({ youtubeVideoIds: [youtubeVideoId] });

    expect(result).toMatchObject({ updatedVideos: 0, unavailableVideos: 1, missingVideos: 1, failedBatches: 0 });
    expect(database.listHololiveMusicRows({ youtubeVideoIds: [youtubeVideoId] })).toHaveLength(0);
    expect(
      database.select<{ youtube_video_id: string }>(
        "SELECT youtube_video_id FROM hololive_music_exclusions WHERE youtube_video_id = ?",
        [youtubeVideoId]
      )
    ).toEqual([{ youtube_video_id: youtubeVideoId }]);

    seedHololiveBracketSong(database, {
      idolId: "tokino-sora",
      idolName: "Tokino Sora",
      channelId: "manually-assigned-owner",
      topicId: "Original_Song",
      suffix: "custom-source-channel",
      viewCount: 100,
      sourceKind: "user"
    });
    expect(
      database.getHololiveMusicSourceChannelMismatchReason({
        youtubeVideoId: "tokino-sora-custom-source-channel",
        youtubeChannelId: "physical-youtube-uploader",
        youtubeChannelName: "Physical Uploader"
      })
    ).toBeNull();
  });

  it("excludes YouTube-unavailable Hololive music rows during stats refresh and swaps to an alternate", async () => {
    const database = await createTempDatabase();
    const canonicalPerformanceKey = "Original_Song:stats-unavailable-song:tokino-sora";
    seedHololiveBracketSong(database, {
      idolId: "tokino-sora",
      idolName: "Tokino Sora",
      channelId: "sora-channel",
      topicId: "Original_Song",
      suffix: "stats-unavailable-bad",
      viewCount: 100,
      publishedAt: "2026-01-01T00:00:00.000Z",
      canonicalPerformanceKey
    });
    seedHololiveBracketSong(database, {
      idolId: "tokino-sora",
      idolName: "Tokino Sora",
      channelId: "sora-channel",
      topicId: "Original_Song",
      suffix: "stats-unavailable-alt",
      viewCount: 90,
      publishedAt: "2026-01-02T00:00:00.000Z",
      canonicalPerformanceKey
    });
    database.createHololiveMusicPlaylist("Stats Unavailable");
    const playlistId = database.getHololiveMusicPlayerData().playlists.find((playlist) => !playlist.systemId)?.id;
    if (!playlistId) {
      throw new Error("Expected a user playlist");
    }
    database.addHololiveMusicPlaylistItem({ playlistId, youtubeVideoId: "tokino-sora-stats-unavailable-bad" });
    database.addHololiveMusicQueueItem({ youtubeVideoId: "tokino-sora-stats-unavailable-bad", placement: "now" });

    const fetcher = (async (input: Parameters<typeof fetch>[0]) => {
      const url = new URL(String(input));
      expect(new Set(url.searchParams.get("id")?.split(",") ?? [])).toEqual(
        new Set(["tokino-sora-stats-unavailable-bad", "tokino-sora-stats-unavailable-alt"])
      );
      return new Response(
        JSON.stringify({
          items: [
            {
              id: "tokino-sora-stats-unavailable-alt",
              statistics: { viewCount: "2222" },
              status: { uploadStatus: "processed", privacyStatus: "public", embeddable: true }
            }
          ]
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;
    const service = new YouTubeVideoStatsService(database, {
      apiKey: "test-youtube-key",
      fetcher
    });

    const result = await service.refreshViewCounts({
      youtubeVideoIds: ["tokino-sora-stats-unavailable-bad", "tokino-sora-stats-unavailable-alt"]
    });
    const playerData = database.getHololiveMusicPlayerData();

    expect(result).toMatchObject({
      requestedVideos: 2,
      updatedVideos: 1,
      missingVideos: 1,
      unavailableVideos: 1,
      failedBatches: 0
    });
    expect(database.listHololiveMusicRows({ query: "stats-unavailable-bad" })).toHaveLength(0);
    expect(database.listHololiveMusicRows({ query: "stats-unavailable-alt" })[0]).toMatchObject({
      youtubeVideoId: "tokino-sora-stats-unavailable-alt",
      viewCount: 2222
    });
    expect(playerData.playlists.find((playlist) => playlist.id === playlistId)?.items?.map((item) => item.youtubeVideoId)).toEqual([
      "tokino-sora-stats-unavailable-alt"
    ]);
    expect(playerData.queue.map((item) => item.youtubeVideoId)).toEqual(["tokino-sora-stats-unavailable-alt"]);
    expect(playerData.currentItem?.youtubeVideoId).toBe("tokino-sora-stats-unavailable-alt");
  });

  it("permanently excludes Hololive music rows without touching channel stats", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "holoshelf-db-music-exclusion-"));
    const databasePath = path.join(dir, "test.sqlite");
    const database = await createTempDatabaseAt(databasePath);
    const tokinoSoraChannelId = "UCp6993wxpyDPHUpavwDFqgg";
    const bundle: HolodexArtifactBundle = {
      rows: [
        {
          youtubeVideoId: "sora-excluded-song",
          youtubeUrl: "https://www.youtube.com/watch?v=sora-excluded-song",
          title: "Sora Excluded Song",
          status: "past",
          topicId: "Original_Song",
          channelId: tokinoSoraChannelId,
          channelName: "SoraCh.",
          publishedAt: "2026-01-01T00:00:00.000Z"
        }
      ],
      detailCache: {
        "sora-excluded-song": normalizeVideoDetail("sora-excluded-song", {
          youtubeVideoId: "sora-excluded-song",
          channelId: tokinoSoraChannelId,
          duration: 180,
          songNames: ["Sora Excluded Song"],
          relationshipsLoaded: true
        })
      },
      duplicateRemovals: [
        {
          removedYoutubeVideoId: "sora-excluded-song",
          removedTitle: "Sora Excluded Song Topic",
          keptYoutubeVideoId: "sora-excluded-song",
          keptTitle: "Sora Excluded Song",
          reason: "topic duplicate",
          songName: "Sora Excluded Song",
          removedPublishedAt: "2026-01-01T00:00:00.000Z",
          keptPublishedAt: "2026-01-01T00:00:00.000Z"
        }
      ]
    };

    database.refreshHolodexChannels([
      {
        id: tokinoSoraChannelId,
        name: "SoraCh. ã¨ãã®ãã‚‰ãƒãƒ£ãƒ³ãƒãƒ«",
        englishName: "Tokino Sora",
        type: "vtuber",
        org: "Hololive",
        group: "Gen 0",
        photoUrl: "https://example.com/sora.jpg",
        twitter: "tokino_sora",
        videoCount: 1200,
        subscriberCount: 1500000,
        clipCount: 6000,
        publishedAt: "2017-09-07T00:00:00.000Z",
        inactive: false
      }
    ]);
    database.importHolodexMusicArtifacts(bundle, "live");
    database.setHololiveMusicMarker({ youtubeVideoId: "sora-excluded-song", marker: "favorite" });

    const exclusion = database.excludeHololiveMusicVideo({
      youtubeVideoId: "sora-excluded-song",
      title: "Sora Excluded Song",
      sourceUrl: "https://www.youtube.com/watch?v=sora-excluded-song"
    });
    const reimport = database.importHolodexMusicArtifacts(bundle, "live", { replaceExisting: true });
    const excludedMarker = database.setHololiveMusicMarker({ youtubeVideoId: "sora-excluded-song", marker: "like" });
    const reopened = await createTempDatabaseAt(databasePath);

    expect(exclusion).toMatchObject({
      youtubeVideoId: "sora-excluded-song",
      titleSnapshot: "Sora Excluded Song",
      sourceUrlSnapshot: "https://www.youtube.com/watch?v=sora-excluded-song"
    });
    expect(reimport.importedRows).toBe(0);
    expect(excludedMarker).toMatchObject({ youtubeVideoId: "sora-excluded-song", marker: null });
    expect(reopened.listHololiveMusicRows({ query: "Sora Excluded Song" })).toHaveLength(0);
    expect(reopened.getHololiveMusicStatus().totalRows).toBe(0);
    expect(reopened.select("SELECT youtube_video_id FROM hololive_music_detail_cache")).toHaveLength(0);
    expect(reopened.select("SELECT removed_youtube_video_id FROM hololive_music_duplicate_removals")).toHaveLength(0);
    expect(
      reopened.select("SELECT marker_key FROM hololive_music_marker_keys WHERE marker_key LIKE '%sora-excluded-song%'")
    ).toHaveLength(0);
    expect(reopened.select("SELECT id FROM catalog_items WHERE id = 'holodex:sora-excluded-song'")).toHaveLength(0);
    expect(
      reopened.select<{ youtube_video_id: string }>("SELECT youtube_video_id FROM hololive_music_exclusions")
    ).toEqual([{ youtube_video_id: "sora-excluded-song" }]);
    expect(reopened.getHololiveIdolProfile("tokino-sora").mainChannel).toMatchObject({
      subscriberCount: 1500000,
      videoCount: 1200,
      clipCount: 6000
    });
  });

  it("keeps Hololive playlists and queue state durable across replace refreshes", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "holoshelf-db-player-"));
    const databasePath = path.join(dir, "test.sqlite");
    const database = await createTempDatabaseAt(databasePath);
    const firstBundle: HolodexArtifactBundle = {
      rows: [
        {
          youtubeVideoId: "player-song",
          youtubeUrl: "https://www.youtube.com/watch?v=player-song",
          title: "Player Song",
          status: "past",
          topicId: "Original_Song",
          channelId: "UCp6993wxpyDPHUpavwDFqgg",
          channelName: "SoraCh.",
          publishedAt: "2026-01-01T00:00:00.000Z"
        }
      ],
      detailCache: {
        "player-song": normalizeVideoDetail("player-song", {
          youtubeVideoId: "player-song",
          channelId: "UCp6993wxpyDPHUpavwDFqgg",
          duration: 180,
          songNames: ["Player Song"],
          relationshipsLoaded: true
        })
      },
      duplicateRemovals: []
    };
    const replacementBundle: HolodexArtifactBundle = {
      rows: [
        {
          youtubeVideoId: "replacement-player-song",
          youtubeUrl: "https://www.youtube.com/watch?v=replacement-player-song",
          title: "Replacement Player Song",
          status: "past",
          topicId: "Music_Cover",
          channelId: "UCp6993wxpyDPHUpavwDFqgg",
          channelName: "SoraCh.",
          publishedAt: "2026-02-01T00:00:00.000Z"
        }
      ],
      detailCache: {
        "replacement-player-song": normalizeVideoDetail("replacement-player-song", {
          youtubeVideoId: "replacement-player-song",
          channelId: "UCp6993wxpyDPHUpavwDFqgg",
          duration: 200,
          songNames: ["Replacement Player Song"],
          relationshipsLoaded: true
        })
      },
      duplicateRemovals: []
    };

    database.importHolodexMusicArtifacts(firstBundle, "live");
    database.setHololiveMusicMarker({ youtubeVideoId: "player-song", marker: "favorite" });
    const favorites = database.getHololiveMusicPlayerData().playlists[0];
    expect(favorites).toMatchObject({ id: "system:favorites", name: "Favorites", systemId: "favorites", itemCount: 1 });
    expect(favorites.items?.[0]).toMatchObject({ youtubeVideoId: "player-song", available: true });
    database.playHololiveMusicPlaylist({ playlistId: favorites.id });
    expect(database.getHololiveMusicPlayerData().queue).toHaveLength(0);
    expect(database.getHololiveMusicPlayerData().currentItem?.youtubeVideoId).toBe("player-song");
    expect(database.getHololiveMusicPlayerData().state.playbackSourceType).toBe("playlist");

    database.createHololiveMusicPlaylist("Favorites");
    const playlistId = database.getHololiveMusicPlayerData().playlists.find((playlist) => !playlist.systemId)?.id;
    if (!playlistId) {
      throw new Error("Expected a user playlist");
    }
    database.addHololiveMusicPlaylistItem({ playlistId, youtubeVideoId: "player-song" });
    database.addHololiveMusicQueueItem({ youtubeVideoId: "player-song", placement: "now" });
    database.updateHololiveMusicPlayerState({ autoplayEnabled: false });

    database.importHolodexMusicArtifacts(replacementBundle, "live", { replaceExisting: true });
    const refreshed = database.getHololiveMusicPlayerData();
    const reopened = await createTempDatabaseAt(databasePath);
    const reopenedData = reopened.getHololiveMusicPlayerData();

    const refreshedUserPlaylist = refreshed.playlists.find((playlist) => !playlist.systemId);
    expect(refreshed.playlists[0]).toMatchObject({ id: "system:favorites", name: "Favorites", systemId: "favorites" });
    expect(refreshedUserPlaylist).toMatchObject({ name: "Favorites", itemCount: 1 });
    expect(refreshedUserPlaylist?.items?.[0]).toMatchObject({
      youtubeVideoId: "player-song",
      titleSnapshot: "Player Song",
      available: false
    });
    expect(refreshed.queue[0]).toMatchObject({
      youtubeVideoId: "player-song",
      available: false
    });
    expect(reopenedData.playlists.find((playlist) => !playlist.systemId)?.items?.[0].youtubeVideoId).toBe("player-song");
    expect(reopenedData.queue[0].youtubeVideoId).toBe("player-song");
    expect(reopenedData.state.autoplayEnabled).toBe(false);

    reopened.excludeHololiveMusicVideo({
      youtubeVideoId: "player-song",
      title: "Player Song",
      sourceUrl: "https://www.youtube.com/watch?v=player-song"
    });

    const excluded = reopened.getHololiveMusicPlayerData();
    expect(excluded.playlists[0]).toMatchObject({ id: "system:favorites", itemCount: 0 });
    expect(excluded.playlists.find((playlist) => !playlist.systemId)?.items).toHaveLength(0);
    expect(excluded.queue).toHaveLength(0);
  });

  it("does not load or play a song when appending it to an empty queue", async () => {
    const database = await createTempDatabase();
    database.importHolodexMusicArtifacts(
      {
        rows: [
          {
            youtubeVideoId: "append-only-song",
            youtubeUrl: "https://www.youtube.com/watch?v=append-only-song",
            title: "Append Only Song",
            status: "past",
            topicId: "Original_Song",
            channelId: "UCp6993wxpyDPHUpavwDFqgg",
            channelName: "SoraCh.",
            publishedAt: "2026-04-01T00:00:00.000Z"
          }
        ],
        detailCache: {
          "append-only-song": normalizeVideoDetail("append-only-song", {
            youtubeVideoId: "append-only-song",
            channelId: "UCp6993wxpyDPHUpavwDFqgg",
            duration: 180,
            songNames: ["Append Only Song"],
            relationshipsLoaded: true
          })
        },
        duplicateRemovals: []
      },
      "live"
    );

    database.updateHololiveMusicPlayerState({
      playbackSourceType: "queue",
      currentQueueItemId: null,
      currentPlaylistId: null,
      currentPlaylistItemId: null,
      currentYoutubeVideoId: null
    });

    const appended = database.addHololiveMusicQueueItem({ youtubeVideoId: "append-only-song", placement: "end" });
    expect(appended.queue).toHaveLength(1);
    expect(appended.currentItem).toBeNull();
    expect(appended.state).toMatchObject({
      playbackSourceType: "queue",
      currentQueueItemId: null,
      currentYoutubeVideoId: null
    });

    const playingNow = database.addHololiveMusicQueueItem({ youtubeVideoId: "append-only-song", placement: "now" });
    expect(playingNow.currentItem?.youtubeVideoId).toBe("append-only-song");
    expect(playingNow.state.currentQueueItemId).toBeTruthy();
    expect(playingNow.state.currentYoutubeVideoId).toBe("append-only-song");
  });

  it("toggles duplicate playlist adds instead of storing the same song twice", async () => {
    const database = await createTempDatabase();
    database.importHolodexMusicArtifacts(
      {
        rows: [
          {
            youtubeVideoId: "toggle-playlist-song",
            youtubeUrl: "https://www.youtube.com/watch?v=toggle-playlist-song",
            title: "Toggle Playlist Song",
            status: "past",
            topicId: "Original_Song",
            channelId: "UCp6993wxpyDPHUpavwDFqgg",
            channelName: "SoraCh.",
            publishedAt: "2026-03-01T00:00:00.000Z"
          }
        ],
        detailCache: {
          "toggle-playlist-song": normalizeVideoDetail("toggle-playlist-song", {
            youtubeVideoId: "toggle-playlist-song",
            channelId: "UCp6993wxpyDPHUpavwDFqgg",
            duration: 180,
            songNames: ["Toggle Playlist Song"],
            relationshipsLoaded: true
          })
        },
        duplicateRemovals: []
      },
      "live"
    );

    database.createHololiveMusicPlaylist("Toggle Test");
    const playlistId = database.getHololiveMusicPlayerData().playlists.find((playlist) => !playlist.systemId)?.id;
    if (!playlistId) {
      throw new Error("Expected a user playlist");
    }

    expect(
      database.addHololiveMusicPlaylistItem({ playlistId, youtubeVideoId: "toggle-playlist-song" }).playlists.find(
        (playlist) => playlist.id === playlistId
      )?.items
    ).toHaveLength(1);
    expect(
      database.addHololiveMusicPlaylistItem({ playlistId, youtubeVideoId: "toggle-playlist-song" }).playlists.find(
        (playlist) => playlist.id === playlistId
      )?.items
    ).toHaveLength(0);
    const restored = database.addHololiveMusicPlaylistItem({ playlistId, youtubeVideoId: "toggle-playlist-song" });
    const restoredPlaylist = restored.playlists.find((playlist) => playlist.id === playlistId);
    expect(restoredPlaylist?.items).toHaveLength(1);
    expect(restoredPlaylist?.items?.[0].youtubeVideoId).toBe("toggle-playlist-song");
    expect(
      database.select<{ count: number }>(
        "SELECT COUNT(*) AS count FROM hololive_music_playlist_items WHERE playlist_id = ? AND youtube_video_id = ?",
        [playlistId, "toggle-playlist-song"]
      )[0]?.count
    ).toBe(1);
  });

  it("bulk adds visible songs to playlists and queue in order", async () => {
    const database = await createTempDatabase();
    seedHololiveBracketSong(database, {
      idolId: "tokino-sora",
      idolName: "Tokino Sora",
      channelId: "sora-channel",
      topicId: "Original_Song",
      suffix: "bulk-a",
      viewCount: 100,
      publishedAt: "2026-01-01T00:00:00.000Z"
    });
    seedHololiveBracketSong(database, {
      idolId: "gawr-gura",
      idolName: "Gawr Gura",
      channelId: "gura-channel",
      topicId: "Music_Cover",
      suffix: "bulk-b",
      viewCount: 90,
      publishedAt: "2026-01-02T00:00:00.000Z"
    });

    database.createHololiveMusicPlaylist("Bulk Test");
    const playlistId = database.getHololiveMusicPlayerData().playlists.find((playlist) => !playlist.systemId)?.id;
    if (!playlistId) {
      throw new Error("Expected a user playlist");
    }

    const playlistData = database.addHololiveMusicPlaylistItems({
      playlistId,
      youtubeVideoIds: ["tokino-sora-bulk-a", "gawr-gura-bulk-b", "tokino-sora-bulk-a"]
    });
    expect(playlistData.playlists.find((playlist) => playlist.id === playlistId)?.items?.map((item) => item.youtubeVideoId)).toEqual([
      "tokino-sora-bulk-a",
      "gawr-gura-bulk-b"
    ]);
    expect(
      database.addHololiveMusicPlaylistItems({
        playlistId,
        youtubeVideoIds: ["tokino-sora-bulk-a", "gawr-gura-bulk-b"]
      }).playlists.find((playlist) => playlist.id === playlistId)?.items
    ).toHaveLength(2);

    const queued = database.addHololiveMusicQueueItems({
      youtubeVideoIds: ["tokino-sora-bulk-a", "gawr-gura-bulk-b"],
      placement: "end"
    });
    expect(queued.queue.map((item) => item.youtubeVideoId)).toEqual(["tokino-sora-bulk-a", "gawr-gura-bulk-b"]);

    const playing = database.playHololiveMusicVisibleVideos(["gawr-gura-bulk-b", "tokino-sora-bulk-a"]);
    expect(playing.state.currentYoutubeVideoId).toBe("gawr-gura-bulk-b");
    expect(playing.currentItem?.youtubeVideoId).toBe("gawr-gura-bulk-b");
  });

  it("undoes playlist and queue item removal with action tokens", async () => {
    const database = await createTempDatabase();
    seedHololiveBracketSong(database, {
      idolId: "tokino-sora",
      idolName: "Tokino Sora",
      channelId: "sora-channel",
      topicId: "Original_Song",
      suffix: "undo-remove",
      viewCount: 100,
      publishedAt: "2026-01-01T00:00:00.000Z"
    });
    database.createHololiveMusicPlaylist("Undo Test");
    const playlistId = database.getHololiveMusicPlayerData().playlists.find((playlist) => !playlist.systemId)?.id;
    if (!playlistId) {
      throw new Error("Expected a user playlist");
    }
    const playlistItem = database.addHololiveMusicPlaylistItem({
      playlistId,
      youtubeVideoId: "tokino-sora-undo-remove"
    }).playlists.find((playlist) => playlist.id === playlistId)?.items?.[0];
    const queueItem = database.addHololiveMusicQueueItem({
      youtubeVideoId: "tokino-sora-undo-remove",
      placement: "now"
    }).queue[0];
    if (!playlistItem || !queueItem) {
      throw new Error("Expected player items");
    }

    database.removeHololiveMusicPlaylistItem(playlistItem.id);
    const playlistUndo = database.consumeLatestHololiveUndo("playlist-item-remove");
    expect(playlistUndo?.undoToken).toBeTruthy();
    database.applyHololiveUndo(playlistUndo?.undoToken ?? "");
    expect(database.getHololiveMusicPlayerData().playlists.find((playlist) => playlist.id === playlistId)?.items).toHaveLength(1);

    database.removeHololiveMusicQueueItem(queueItem.id);
    const queueUndo = database.consumeLatestHololiveUndo("queue-item-remove");
    expect(queueUndo?.undoToken).toBeTruthy();
    database.applyHololiveUndo(queueUndo?.undoToken ?? "");
    expect(database.getHololiveMusicPlayerData().queue.map((item) => item.youtubeVideoId)).toEqual(["tokino-sora-undo-remove"]);
  });

  it("undoes Hololive song exclusion without losing playlist and queue references", async () => {
    const database = await createTempDatabase();
    seedHololiveBracketSong(database, {
      idolId: "tokino-sora",
      idolName: "Tokino Sora",
      channelId: "sora-channel",
      topicId: "Original_Song",
      suffix: "undo-exclude",
      viewCount: 100,
      publishedAt: "2026-01-01T00:00:00.000Z"
    });
    database.createHololiveMusicPlaylist("Undo Exclude");
    const playlistId = database.getHololiveMusicPlayerData().playlists.find((playlist) => !playlist.systemId)?.id;
    if (!playlistId) {
      throw new Error("Expected a user playlist");
    }
    database.addHololiveMusicPlaylistItem({ playlistId, youtubeVideoId: "tokino-sora-undo-exclude" });
    database.addHololiveMusicQueueItem({ youtubeVideoId: "tokino-sora-undo-exclude", placement: "now" });
    database.setHololiveMusicMarker({ youtubeVideoId: "tokino-sora-undo-exclude", marker: "favorite" });

    database.excludeHololiveMusicVideo({ youtubeVideoId: "tokino-sora-undo-exclude" });
    expect(database.listHololiveMusicLibrary({ query: "undo-exclude" }).rows).toHaveLength(0);
    const undo = database.consumeLatestHololiveUndo("music-exclusion");
    expect(undo?.undoToken).toBeTruthy();

    database.applyHololiveUndo(undo?.undoToken ?? "");
    expect(database.listHololiveMusicLibrary({ query: "undo-exclude" }).rows.map((row) => row.youtubeVideoId)).toEqual([
      "tokino-sora-undo-exclude"
    ]);
    const playerData = database.getHololiveMusicPlayerData();
    expect(playerData.playlists.find((playlist) => playlist.id === playlistId)?.items?.map((item) => item.youtubeVideoId)).toEqual([
      "tokino-sora-undo-exclude"
    ]);
    expect(playerData.queue.map((item) => item.youtubeVideoId)).toEqual(["tokino-sora-undo-exclude"]);
    expect(playerData.playlists.find((playlist) => playlist.systemId === "favorites")?.items).toHaveLength(1);
  });

  it("marks permanently unavailable Hololive videos unplayable and swaps player references to an alternate", async () => {
    const database = await createTempDatabase();
    const canonicalPerformanceKey = "Original_Song:unavailable-song:tokino-sora";
    seedHololiveBracketSong(database, {
      idolId: "tokino-sora",
      idolName: "Tokino Sora",
      channelId: "sora-channel",
      topicId: "Original_Song",
      suffix: "unavailable-bad",
      viewCount: 100,
      publishedAt: "2026-01-01T00:00:00.000Z",
      canonicalPerformanceKey
    });
    seedHololiveBracketSong(database, {
      idolId: "tokino-sora",
      idolName: "Tokino Sora",
      channelId: "sora-channel",
      topicId: "Original_Song",
      suffix: "unavailable-alt",
      viewCount: 90,
      publishedAt: "2026-01-02T00:00:00.000Z",
      canonicalPerformanceKey
    });
    database.createHololiveMusicPlaylist("Unavailable Swap");
    const playlistId = database.getHololiveMusicPlayerData().playlists.find((playlist) => !playlist.systemId)?.id;
    if (!playlistId) {
      throw new Error("Expected a user playlist");
    }
    database.addHololiveMusicPlaylistItem({ playlistId, youtubeVideoId: "tokino-sora-unavailable-bad" });
    database.addHololiveMusicQueueItem({ youtubeVideoId: "tokino-sora-unavailable-bad", placement: "now" });
    database.setHololiveMusicMarker({ youtubeVideoId: "tokino-sora-unavailable-bad", marker: "favorite" });

    const response = database.markHololiveMusicVideoUnavailable({
      youtubeVideoId: "tokino-sora-unavailable-bad",
      reason: "Error 150."
    });
    const playerData = response.data;

    expect(response).toMatchObject({
      removedYoutubeVideoId: "tokino-sora-unavailable-bad",
      replacementYoutubeVideoId: "tokino-sora-unavailable-alt"
    });
    expect(database.listHololiveMusicRows({ query: "unavailable-bad" })).toHaveLength(0);
    expect(database.listHololiveMusicRows({ query: "unavailable-alt" })[0]).toMatchObject({
      youtubeVideoId: "tokino-sora-unavailable-alt",
      marker: "favorite"
    });
    expect(playerData.playlists.find((playlist) => playlist.id === playlistId)?.items?.map((item) => item.youtubeVideoId)).toEqual([
      "tokino-sora-unavailable-alt"
    ]);
    expect(playerData.queue.map((item) => item.youtubeVideoId)).toEqual(["tokino-sora-unavailable-alt"]);
    expect(playerData.currentItem?.youtubeVideoId).toBe("tokino-sora-unavailable-alt");
    expect(
      database.select<{ youtube_video_id: string }>(
        "SELECT youtube_video_id FROM hololive_music_exclusions WHERE youtube_video_id = ?",
        ["tokino-sora-unavailable-bad"]
      )
    ).toEqual([{ youtube_video_id: "tokino-sora-unavailable-bad" }]);
  });

  it("persists manual Favorites playlist ordering without converting it into a user playlist", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "holoshelf-db-favorites-order-"));
    const databasePath = path.join(dir, "test.sqlite");
    const database = await createTempDatabaseAt(databasePath);
    const bundle: HolodexArtifactBundle = {
      rows: [
        {
          youtubeVideoId: "favorite-order-a",
          youtubeUrl: "https://www.youtube.com/watch?v=favorite-order-a",
          title: "Favorite Order A",
          status: "past",
          topicId: "Original_Song",
          channelId: "UCp6993wxpyDPHUpavwDFqgg",
          channelName: "SoraCh.",
          publishedAt: "2026-01-01T00:00:00.000Z"
        },
        {
          youtubeVideoId: "favorite-order-b",
          youtubeUrl: "https://www.youtube.com/watch?v=favorite-order-b",
          title: "Favorite Order B",
          status: "past",
          topicId: "Original_Song",
          channelId: "UCp6993wxpyDPHUpavwDFqgg",
          channelName: "SoraCh.",
          publishedAt: "2026-01-02T00:00:00.000Z"
        }
      ],
      detailCache: {
        "favorite-order-a": normalizeVideoDetail("favorite-order-a", {
          youtubeVideoId: "favorite-order-a",
          channelId: "UCp6993wxpyDPHUpavwDFqgg",
          duration: 200,
          songNames: ["Favorite Order A"],
          relationshipsLoaded: true
        }),
        "favorite-order-b": normalizeVideoDetail("favorite-order-b", {
          youtubeVideoId: "favorite-order-b",
          channelId: "UCp6993wxpyDPHUpavwDFqgg",
          duration: 220,
          songNames: ["Favorite Order B"],
          relationshipsLoaded: true
        })
      },
      duplicateRemovals: []
    };

    database.importHolodexMusicArtifacts(bundle, "live");
    database.setHololiveMusicMarker({ youtubeVideoId: "favorite-order-a", marker: "favorite" });
    database.setHololiveMusicMarker({ youtubeVideoId: "favorite-order-b", marker: "favorite" });

    const favorites = database.getHololiveMusicPlayerData().playlists[0];
    expect(favorites).toMatchObject({ id: "system:favorites", systemId: "favorites" });
    const manuallyOrderedItems = [...(favorites.items ?? [])].reverse();
    const expectedOrder = manuallyOrderedItems.map((item) => item.youtubeVideoId);
    database.reorderHololiveMusicPlaylistItems({
      playlistId: favorites.id,
      itemIds: manuallyOrderedItems.map((item) => item.id)
    });

    const reordered = database.getHololiveMusicPlayerData().playlists[0];
    expect(reordered.items?.map((item) => item.youtubeVideoId)).toEqual(expectedOrder);

    const reopened = await createTempDatabaseAt(databasePath);
    expect(reopened.getHololiveMusicPlayerData().playlists[0].items?.map((item) => item.youtubeVideoId)).toEqual(expectedOrder);
  });

  it("resolves Hololive profile playback context from profile media groups", async () => {
    const database = await createTempDatabase();
    const bundle: HolodexArtifactBundle = {
      rows: [
        {
          youtubeVideoId: "profile-context-a",
          youtubeUrl: "https://www.youtube.com/watch?v=profile-context-a",
          title: "Profile Context A",
          status: "past",
          topicId: "Original_Song",
          channelId: "UCp6993wxpyDPHUpavwDFqgg",
          channelName: "SoraCh.",
          publishedAt: "2026-01-01T00:00:00.000Z"
        },
        {
          youtubeVideoId: "profile-context-b",
          youtubeUrl: "https://www.youtube.com/watch?v=profile-context-b",
          title: "Profile Context B",
          status: "past",
          topicId: "Original_Song",
          channelId: "UCp6993wxpyDPHUpavwDFqgg",
          channelName: "SoraCh.",
          publishedAt: "2026-01-02T00:00:00.000Z"
        }
      ],
      detailCache: {
        "profile-context-a": normalizeVideoDetail("profile-context-a", {
          youtubeVideoId: "profile-context-a",
          channelId: "UCp6993wxpyDPHUpavwDFqgg",
          duration: 200,
          songNames: ["Profile Context A"],
          relationshipsLoaded: true
        }),
        "profile-context-b": normalizeVideoDetail("profile-context-b", {
          youtubeVideoId: "profile-context-b",
          channelId: "UCp6993wxpyDPHUpavwDFqgg",
          duration: 210,
          songNames: ["Profile Context B"],
          relationshipsLoaded: true
        })
      },
      duplicateRemovals: []
    };

    database.importHolodexMusicArtifacts(bundle, "live");

    const context = database.getHololiveProfilePlaybackContext({
      youtubeVideoId: "profile-context-b",
      preferredIdolId: "tokino-sora",
      preferredGroupId: "original-songs"
    });

    expect(context).toMatchObject({
      youtubeVideoId: "profile-context-b",
      idolId: "tokino-sora",
      idolName: "Tokino Sora",
      mediaGroupId: "original-songs",
      mediaGroupLabel: "Original Songs"
    });
    expect(context?.songIds).toContain("profile-context-a");
    expect(context?.songIds).toContain("profile-context-b");
    expect(context?.currentIndex).toBeGreaterThanOrEqual(0);

    database.excludeHololiveMusicVideo({
      youtubeVideoId: "profile-context-b",
      title: "Profile Context B",
      sourceUrl: "https://www.youtube.com/watch?v=profile-context-b"
    });
    expect(database.getHololiveProfilePlaybackContext({ youtubeVideoId: "profile-context-b" })).toBeNull();
  });

  it("stores Holodex channel stats and classifies official group channels", async () => {
    const database = await createTempDatabase();
    const tokinoSoraChannelId = "UCp6993wxpyDPHUpavwDFqgg";

    const result = database.refreshHolodexChannels([
      {
        id: tokinoSoraChannelId,
        name: "SoraCh. ときのそらチャンネル",
        englishName: "Tokino Sora",
        type: "vtuber",
        org: "Hololive",
        group: "Gen 0",
        photoUrl: "https://example.com/sora.jpg",
        twitter: "tokino_sora",
        videoCount: 1200,
        subscriberCount: 1500000,
        clipCount: 6000,
        publishedAt: "2017-09-07T00:00:00.000Z",
        inactive: false
      },
      {
        id: "official-channel",
        name: "hololive Official",
        englishName: "hololive Official",
        type: "vtuber",
        org: "Hololive",
        group: "Official",
        photoUrl: "https://example.com/photo.jpg",
        twitter: "hololivetv",
        videoCount: 1000,
        subscriberCount: 2000,
        clipCount: 400,
        publishedAt: "2017-01-01T00:00:00.000Z",
        inactive: false
      }
    ]);

    const groupChannels = database.listHololiveChannels({ kind: "group" });
    const mainChannels = database.listHololiveChannels({ kind: "idol" });
    const soraProfile = database.getHololiveIdolProfile("tokino-sora");

    expect(result.refreshedChannels).toBe(2);
    expect(result.classifiedChannels).toBeGreaterThan(0);
    expect(mainChannels).toHaveLength(HOLOLIVE_IDOLS.length - 1);
    expect(groupChannels).toHaveLength(1);
    expect(groupChannels[0]).toMatchObject({
      id: "official-channel",
      kind: "group",
      photoUrl: "https://example.com/photo.jpg",
      videoCount: 1000,
      subscriberCount: 2000,
      clipCount: 400,
      linkedIdolIds: []
    });
    expect(soraProfile.mainChannel).toMatchObject({
      id: tokinoSoraChannelId,
      photoUrl: "https://example.com/sora.jpg",
      twitter: "tokino_sora",
      subscriberCount: 1500000,
      videoCount: 1200,
      clipCount: 6000,
      publishedAt: "2017-09-07T00:00:00.000Z",
      kind: "idol"
    });
    expect(soraProfile.mainChannel?.name).toContain("SoraCh");
  });

  it("does not let startup seeding overwrite refreshed Holodex channel metadata", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "holoshelf-db-"));
    const databasePath = path.join(dir, "test.sqlite");
    const tokinoSoraChannelId = "UCp6993wxpyDPHUpavwDFqgg";
    const database = await createTempDatabaseAt(databasePath);

    database.refreshHolodexChannels([
      {
        id: tokinoSoraChannelId,
        name: "SoraCh. ときのそらチャンネル",
        englishName: "Tokino Sora",
        type: "vtuber",
        org: "Hololive",
        group: "Gen 0",
        photoUrl: "https://example.com/sora.jpg",
        twitter: "tokino_sora",
        videoCount: 1200,
        subscriberCount: 1500000,
        clipCount: 6000,
        publishedAt: "2017-09-07T00:00:00.000Z",
        inactive: false
      }
    ]);

    const reopenedDatabase = await createTempDatabaseAt(databasePath);
    const profile = reopenedDatabase.getHololiveIdolProfile("tokino-sora");

    expect(profile.mainChannel).toMatchObject({
      id: tokinoSoraChannelId,
      name: "SoraCh. ときのそらチャンネル",
      subscriberCount: 1500000,
      videoCount: 1200,
      clipCount: 6000
    });
  });

  it("filters excluded Holodex channels from refresh and music import", async () => {
    const database = await createTempDatabase();
    const excludedChannelId = "UCHj_mh57PVMXhAUDphUQDFA";

    database.refreshHolodexChannels([
      {
        id: excludedChannelId,
        name: "Invalid Subchannel",
        englishName: "Invalid Subchannel",
        type: "vtuber",
        org: "Hololive",
        group: "Sub",
        photoUrl: "",
        twitter: "",
        videoCount: 1,
        subscriberCount: 1,
        clipCount: 1,
        publishedAt: "",
        inactive: false
      }
    ]);

    const bundle: HolodexArtifactBundle = {
      rows: [
        {
          youtubeVideoId: "excluded-song",
          youtubeUrl: "https://www.youtube.com/watch?v=excluded-song",
          title: "Excluded Song",
          status: "past",
          topicId: "Original_Song",
          channelId: excludedChannelId,
          channelName: "Invalid Subchannel",
          publishedAt: "2026-01-01T00:00:00.000Z"
        }
      ],
      detailCache: {
        "excluded-song": normalizeVideoDetail("excluded-song", {
          youtubeVideoId: "excluded-song",
          channelId: excludedChannelId,
          duration: 180,
          songNames: ["Excluded Song"],
          relationshipsLoaded: true
        })
      },
      duplicateRemovals: []
    };

    const result = database.importHolodexMusicArtifacts(bundle, "live");

    expect(database.listHololiveChannels().some((channel) => channel.id === excludedChannelId)).toBe(false);
    expect(result.importedRows).toBe(0);
    expect(database.listHololiveMusicRows({ query: "Excluded Song" })).toHaveLength(0);
  });

  it("does not store unmatched Holodex rows, details, or channels", async () => {
    const database = await createTempDatabase();
    const bundle: HolodexArtifactBundle = {
      rows: [
        {
          youtubeVideoId: "unmatched-song",
          youtubeUrl: "https://www.youtube.com/watch?v=unmatched-song",
          title: "Unmatched Song",
          status: "past",
          topicId: "Original_Song",
          channelId: "unknown-channel",
          channelName: "Unknown Channel",
          publishedAt: "2026-01-01T00:00:00.000Z"
        }
      ],
      detailCache: {
        "unmatched-song": normalizeVideoDetail("unmatched-song", {
          youtubeVideoId: "unmatched-song",
          channelId: "unknown-channel",
          duration: 180,
          songNames: ["Unmatched Song"],
          channel: {
            id: "unknown-channel",
            name: "Unknown Channel",
            englishName: "Unknown Channel",
            type: "vtuber",
            org: "Other",
            group: "",
            photoUrl: "",
            twitter: "",
            videoCount: null,
            subscriberCount: null,
            clipCount: null,
            publishedAt: "",
            inactive: false
          },
          relationshipsLoaded: true
        })
      },
      duplicateRemovals: []
    };

    const result = database.importHolodexMusicArtifacts(bundle, "live");

    expect(result.importedRows).toBe(0);
    expect(result.detailCacheRows).toBe(0);
    expect(database.listHololiveMusicRows({ query: "Unmatched Song" })).toHaveLength(0);
    expect(database.select<{ youtube_video_id: string }>("SELECT youtube_video_id FROM hololive_music_detail_cache")).toHaveLength(0);
    expect(database.listHololiveChannels().some((channel) => channel.id === "unknown-channel")).toBe(false);
  });

  it("refreshes Holodex channels through the public endpoint without requiring an API key", async () => {
    const database = await createTempDatabase();
    const service = new HolodexMusicService(
      database,
      (async (url: string | URL | Request) => {
        if (String(url).startsWith("https://holodex.net/api/v2/channels?")) {
          return new Response(
            JSON.stringify([
              {
                id: "official-channel",
                name: "hololive Official",
                english_name: "hololive Official",
                type: "vtuber",
                org: "Hololive",
                group: "Official",
                photo: "https://example.com/photo.jpg",
                video_count: 1000,
                subscriber_count: 2000,
                clip_count: 400,
                inactive: false
              }
            ])
          );
        }

        return new Response(null, { status: 404 });
      }) as typeof fetch
    );

    const result = await service.refreshChannels();
    const health = database.getSourceHealth().find((entry) => entry.sourceId === "holodex");

    expect(result.refreshedChannels).toBe(1);
    expect(database.listHololiveChannels({ kind: "group" }).some((channel) => channel.id === "official-channel")).toBe(true);
    expect(health).toBeUndefined();
  });

  it("refreshes Holodex music from the official paginated videos endpoint", async () => {
    const database = await createTempDatabase();
    const requestedUrls: string[] = [];
    const service = new HolodexMusicService(
      database,
      (async (url: string | URL | Request) => {
        const requestUrl = String(url);
        requestedUrls.push(requestUrl);
        if (requestUrl.startsWith("https://holodex.net/api/v2/videos?")) {
          const parsed = new URL(requestUrl);
          const topic = parsed.searchParams.get("topic");
          const type = parsed.searchParams.get("type");
          if (topic === "Original_Song" && type === "stream") {
            return new Response(
              JSON.stringify({
                total: 1,
                items: [
                  {
                    id: "live-song",
                    title: "Live Song",
                    type: "stream",
                    topic_id: "Original_Song",
                    status: "past",
                    published_at: "2026-01-01T00:00:00.000Z",
                    duration: 180,
                    songs: [{ name: "Live Song" }],
                    mentions: [],
                    channel_id: "UCp6993wxpyDPHUpavwDFqgg",
                    channel: {
                      id: "UCp6993wxpyDPHUpavwDFqgg",
                      name: "SoraCh. ときのそらチャンネル",
                      english_name: "Tokino Sora",
                      org: "Hololive"
                    }
                  }
                ]
              })
            );
          }

          return new Response(JSON.stringify({ total: 0, items: [] }));
        }

        return new Response(null, { status: 404 });
      }) as typeof fetch
    );

    const result = await service.refreshLive({
      includeChannels: false,
      includeCollabs: false,
      replaceExisting: true,
      maxRequestsPerWindow: 999,
      requestWindowMs: 1000
    });

    const rows = database.listHololiveMusicRows({ query: "Live Song" });
    const profile = database.getHololiveIdolProfile("tokino-sora");

    expect(result.importedRows).toBe(1);
    expect(rows).toHaveLength(1);
    expect(rows[0].participants.map((participant) => [participant.idolId, participant.role])).toEqual([
      ["tokino-sora", "primary"]
    ]);
    expect(profile.mediaGroups.find((group) => group.id === "original-songs")?.items.map((item) => item.id)).toContain(
      "live-song"
    );
    expect(requestedUrls.some((requestUrl) => requestUrl.includes("/api/v2/videos?"))).toBe(true);
    expect(requestedUrls.every((requestUrl) => !requestUrl.includes("/api/v2/search/videoSearch"))).toBe(true);
  });

  it("imports recent custom talent song uploads even before Holodex topic tagging catches up", async () => {
    const database = await createTempDatabase();
    database.upsertHololiveCustomTalent({
      channelId: "UCdQYcUyffHZoz0KOwuiG0lQ",
      displayName: "Soraduki Tyra",
      nativeName: "宙月ティラ",
      slug: "soraduki-tyra",
      branch: "Independents",
      generation: "",
      officialUrl: "https://www.youtube.com/channel/UCdQYcUyffHZoz0KOwuiG0lQ",
      iconUrl: "",
      profileImageUrl: "",
      youtubeChannelUrl: "https://www.youtube.com/channel/UCdQYcUyffHZoz0KOwuiG0lQ",
      xHandle: null,
      xUrl: null,
      subscriberCount: 139000,
      videoCount: 721,
      clipCount: null,
      originalSongsUrl: null,
      coversUrl: null
    });

    const service = new HolodexMusicService(
      database,
      (async (url: string | URL | Request, init?: RequestInit) => {
        const requestUrl = String(url);
        if (requestUrl === "https://holodex.net/api/v2/channels/UCdQYcUyffHZoz0KOwuiG0lQ") {
          return new Response(
            JSON.stringify({
              id: "UCdQYcUyffHZoz0KOwuiG0lQ",
              name: "宙月ティラ",
              english_name: "Soraduki Tyra",
              type: "vtuber",
              org: "Independents",
              group: "",
              video_count: 721,
              subscriber_count: 139000,
              clip_count: null,
              inactive: false
            })
          );
        }

        if (requestUrl.startsWith("https://holodex.net/api/v2/search/videoSearch")) {
          expect(init?.method).toBe("POST");
          return new Response(JSON.stringify({ total: 0, items: [] }));
        }

        if (requestUrl.startsWith("https://holodex.net/api/v2/channels/UCdQYcUyffHZoz0KOwuiG0lQ/videos")) {
          return new Response(
            JSON.stringify({
              total: 1,
              items: [
                {
                  id: "Z-iwk3LHFdI",
                  title: "アフターグロウ / Astrabirth (buzzG × 宙月ティラ)【#VocaDuo2026】",
                  type: "stream",
                  status: "past",
                  topic_id: "",
                  published_at: "2026-07-01T11:00:06.000Z",
                  duration: 260,
                  songs: [],
                  mentions: [],
                  channel_id: "UCdQYcUyffHZoz0KOwuiG0lQ",
                  channel: {
                    id: "UCdQYcUyffHZoz0KOwuiG0lQ",
                    name: "宙月ティラ",
                    english_name: "Soraduki Tyra",
                    org: "Independents",
                    type: "vtuber"
                  }
                }
              ]
            })
          );
        }

        if (requestUrl.startsWith("https://holodex.net/api/v2/videos/Z-iwk3LHFdI")) {
          return new Response(
            JSON.stringify({
              id: "Z-iwk3LHFdI",
              channel_id: "UCdQYcUyffHZoz0KOwuiG0lQ",
              duration: 260,
              original_channel_id: "",
              description: "",
              songs: [{ name: "アフターグロウ / Astrabirth" }],
              mentions: [],
              channel: {
                id: "UCdQYcUyffHZoz0KOwuiG0lQ",
                name: "宙月ティラ",
                english_name: "Soraduki Tyra",
                org: "Independents",
                type: "vtuber"
              }
            })
          );
        }

        return new Response(null, { status: 404 });
      }) as typeof fetch
    );

    const result = await service.refreshCustomTalent({
      idolId: "custom-soraduki-tyra",
      includeCollabs: false,
      includeRelationships: true
    });
    const rows = database.listHololiveMusicRows({ youtubeVideoIds: ["Z-iwk3LHFdI"] });

    expect(result.importedRows).toBe(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      youtubeVideoId: "Z-iwk3LHFdI",
      idolId: "custom-soraduki-tyra",
      title: "アフターグロウ / Astrabirth (buzzG × 宙月ティラ)【#VocaDuo2026】",
      topicId: "Original_Song",
      sourceKind: "user"
    });
  });

  it("keeps custom talent refresh working when the recent upload scan fails", async () => {
    const database = await createTempDatabase();
    const progressMessages: string[] = [];
    const channelId = "UCstableCustomChannel123456789";
    database.upsertHololiveCustomTalent({
      channelId,
      displayName: "Stable Custom",
      nativeName: "Stable Custom",
      slug: "stable-custom",
      branch: "Custom",
      generation: "",
      officialUrl: `https://www.youtube.com/channel/${channelId}`,
      iconUrl: "",
      profileImageUrl: "",
      youtubeChannelUrl: `https://www.youtube.com/channel/${channelId}`,
      xHandle: null,
      xUrl: null,
      subscriberCount: null,
      videoCount: null,
      clipCount: null,
      originalSongsUrl: null,
      coversUrl: null
    });

    const service = new HolodexMusicService(
      database,
      (async (url: string | URL | Request, init?: RequestInit) => {
        const requestUrl = String(url);
        if (requestUrl === `https://holodex.net/api/v2/channels/${channelId}`) {
          return new Response(
            JSON.stringify({
              id: channelId,
              name: "Stable Custom",
              english_name: "Stable Custom",
              type: "vtuber",
              org: "Custom",
              group: "",
              video_count: 1,
              subscriber_count: null,
              clip_count: null,
              inactive: false
            })
          );
        }

        if (requestUrl.startsWith("https://holodex.net/api/v2/search/videoSearch")) {
          const payload = JSON.parse(String(init?.body ?? "{}")) as { topic?: string[] };
          if (payload.topic?.includes("Original_Song")) {
            return new Response(
              JSON.stringify({
                total: 1,
                items: [
                  {
                    id: "stable-song",
                    title: "Stable Song",
                    type: "stream",
                    status: "past",
                    topic_id: "Original_Song",
                    published_at: "2026-07-01T12:00:00.000Z",
                    duration: 180,
                    songs: [],
                    mentions: [],
                    channel_id: channelId,
                    channel: {
                      id: channelId,
                      name: "Stable Custom",
                      english_name: "Stable Custom",
                      org: "Custom",
                      type: "vtuber"
                    }
                  }
                ]
              })
            );
          }
          return new Response(JSON.stringify({ total: 0, items: [] }));
        }

        if (requestUrl.startsWith(`https://holodex.net/api/v2/channels/${channelId}/videos`)) {
          return new Response("temporary unavailable", { status: 503 });
        }

        if (requestUrl.startsWith("https://holodex.net/api/v2/videos/stable-song")) {
          return new Response(
            JSON.stringify({
              id: "stable-song",
              channel_id: channelId,
              duration: 180,
              original_channel_id: "",
              description: "",
              songs: [{ name: "Stable Song" }],
              mentions: [],
              channel: {
                id: channelId,
                name: "Stable Custom",
                english_name: "Stable Custom",
                org: "Custom",
                type: "vtuber"
              }
            })
          );
        }

        return new Response(null, { status: 404 });
      }) as typeof fetch,
      (message) => progressMessages.push(message)
    );

    const result = await service.refreshCustomTalent({
      idolId: "custom-stable-custom",
      includeCollabs: false,
      includeRelationships: true
    });
    const rows = database.listHololiveMusicRows({ youtubeVideoIds: ["stable-song"] });

    expect(result.importedRows).toBe(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      youtubeVideoId: "stable-song",
      idolId: "custom-stable-custom",
      topicId: "Original_Song",
      sourceKind: "user"
    });
    expect(progressMessages.some((message) => message.includes("recent scan skipped"))).toBe(true);
  });

  it("imports group-channel music as featured for individual profile shelves", async () => {
    const database = await createTempDatabase();
    database.refreshHolodexChannels([
      {
        id: "official-channel",
        name: "hololive Official",
        englishName: "hololive Official",
        type: "vtuber",
        org: "Hololive",
        group: "Official",
        photoUrl: "",
        twitter: "",
        videoCount: null,
        subscriberCount: null,
        clipCount: null,
        publishedAt: "",
        inactive: false
      }
    ]);
    const bundle: HolodexArtifactBundle = {
      rows: [
        {
          youtubeVideoId: "group-song",
          youtubeUrl: "https://www.youtube.com/watch?v=group-song",
          title: "Group Song",
          status: "past",
          topicId: "Original_Song",
          channelId: "official-channel",
          channelName: "hololive Official",
          publishedAt: "2026-01-01T00:00:00.000Z"
        }
      ],
      detailCache: {
        "group-song": normalizeVideoDetail("group-song", {
          youtubeVideoId: "group-song",
          channelId: "official-channel",
          duration: 180,
          originalChannelId: "",
          providedToYoutube: false,
          songNames: ["Group Song"],
          mentions: [{ channelId: "UCp6993wxpyDPHUpavwDFqgg", name: "Tokino Sora", englishName: "Tokino Sora", type: "vtuber", photoUrl: "", org: "Hololive" }],
          collabChannelIds: ["UC1opHUrw8rvnsadT-iGp7Cg"],
          relationshipsLoaded: true
        })
      },
      duplicateRemovals: []
    };

    const result = database.importHolodexMusicArtifacts(bundle, "live");
    const rows = database.listHololiveMusicRows({ query: "Group Song" });
    const soraRows = database.listHololiveMusicRows({ idolId: "tokino-sora" });
    const aquaRows = database.listHololiveMusicRows({ idolId: "minato-aqua" });
    const soraProfile = database.getHololiveIdolProfile("tokino-sora");
    const soraFeatured = soraProfile.mediaGroups.find((group) => group.id === "featured-in");

    expect(result.importedRows).toBe(1);
    expect(rows).toHaveLength(1);
    expect(rows[0].idolId).toBeNull();
    expect(rows[0].uploaderChannelKind).toBe("group");
    expect(rows[0].participants.map((participant) => [participant.idolId, participant.role])).toEqual([
      ["tokino-sora", "mentioned"],
      ["minato-aqua", "collab"]
    ]);
    expect(rows[0].ownedIdolIds).toEqual([]);
    expect(rows[0].featuredIdolIds).toEqual(["tokino-sora", "minato-aqua"]);
    expect(rows[0].canonicalSongKey).toBe("group song");
    expect(rows[0].canonicalPerformanceKey).toBe("Original_Song:group song:unowned:group-song");
    expect(soraRows.map((row) => row.youtubeVideoId)).toContain("group-song");
    expect(aquaRows.map((row) => row.youtubeVideoId)).toContain("group-song");
    expect(soraFeatured?.items.map((item) => item.id)).toEqual([
      "group-song"
    ]);
    expect(soraProfile.mediaGroups.find((group) => group.id === "original-songs")?.items).toEqual([]);
    expect(soraProfile.mediaGroups.find((group) => group.id === "covers")?.items).toEqual([]);
  });

  it("keeps official group songs out of guest originals and dedupes featured duplicates by song", async () => {
    const database = await createTempDatabase();
    const officialChannelId = "UCJFZiqLMntJufDCHc6bQixg";
    const suiseiChannelId = "UC5CwaMl1eIgY8h02uZw7u8A";
    database.refreshHolodexChannels([
      {
        id: officialChannelId,
        name: "hololive Official",
        englishName: "hololive Official",
        type: "vtuber",
        org: "Hololive",
        group: "Official",
        photoUrl: "",
        twitter: "",
        videoCount: null,
        subscriberCount: null,
        clipCount: null,
        publishedAt: "",
        inactive: false
      }
    ]);
    const bundle: HolodexArtifactBundle = {
      rows: [
        {
          youtubeVideoId: "get-the-crown-group",
          youtubeUrl: "https://www.youtube.com/watch?v=get-the-crown-group",
          title: "GET THE CROWN",
          status: "past",
          topicId: "Original_Song",
          channelId: officialChannelId,
          channelName: "hololive Official",
          publishedAt: "2026-01-01T00:00:00.000Z"
        },
        {
          youtubeVideoId: "get-the-crown-suisei",
          youtubeUrl: "https://www.youtube.com/watch?v=get-the-crown-suisei",
          title: "GET THE CROWN / Hoshimachi Suisei",
          status: "past",
          topicId: "Original_Song",
          channelId: suiseiChannelId,
          channelName: "Suisei Channel",
          publishedAt: "2026-01-02T00:00:00.000Z"
        },
        {
          youtubeVideoId: "get-the-crown-live",
          youtubeUrl: "https://www.youtube.com/watch?v=get-the-crown-live",
          title: "GET THE CROWN / Hoshimachi Suisei Live Tour 2024",
          status: "past",
          topicId: "Original_Song",
          channelId: suiseiChannelId,
          channelName: "Suisei Channel",
          publishedAt: "2026-01-03T00:00:00.000Z"
        }
      ],
      detailCache: {
        "get-the-crown-group": normalizeVideoDetail("get-the-crown-group", {
          youtubeVideoId: "get-the-crown-group",
          channelId: officialChannelId,
          duration: 180,
          songNames: ["GET THE CROWN"],
          mentions: [
            { channelId: "UCFTLzh12_nrtzqBPsTCqenA", name: "Aki Rosenthal", englishName: "Aki Rosenthal", type: "vtuber", photoUrl: "", org: "Hololive" },
            { channelId: suiseiChannelId, name: "Hoshimachi Suisei", englishName: "Hoshimachi Suisei", type: "vtuber", photoUrl: "", org: "Hololive" }
          ],
          relationshipsLoaded: true
        }),
        "get-the-crown-suisei": normalizeVideoDetail("get-the-crown-suisei", {
          youtubeVideoId: "get-the-crown-suisei",
          channelId: suiseiChannelId,
          duration: 180,
          songNames: ["GET THE CROWN"],
          mentions: [
            { channelId: "UCFTLzh12_nrtzqBPsTCqenA", name: "Aki Rosenthal", englishName: "Aki Rosenthal", type: "vtuber", photoUrl: "", org: "Hololive" }
          ],
          relationshipsLoaded: true
        }),
        "get-the-crown-live": normalizeVideoDetail("get-the-crown-live", {
          youtubeVideoId: "get-the-crown-live",
          channelId: suiseiChannelId,
          duration: 220,
          songNames: ["GET THE CROWN (ft. Hoshimatic Project) [3D Live]"],
          mentions: [
            { channelId: "UCFTLzh12_nrtzqBPsTCqenA", name: "Aki Rosenthal", englishName: "Aki Rosenthal", type: "vtuber", photoUrl: "", org: "Hololive" }
          ],
          relationshipsLoaded: true
        })
      },
      duplicateRemovals: []
    };

    database.importHolodexMusicArtifacts(bundle, "live");

    const akiProfile = database.getHololiveIdolProfile("aki-rosenthal");
    const suiseiProfile = database.getHololiveIdolProfile("hoshimachi-suisei");
    const akiOriginals = akiProfile.mediaGroups.find((group) => group.id === "original-songs")?.items ?? [];
    const akiFeatured = akiProfile.mediaGroups.find((group) => group.id === "featured-in")?.items ?? [];
    const suiseiOriginals = suiseiProfile.mediaGroups.find((group) => group.id === "original-songs")?.items ?? [];
    const suiseiFeatured = suiseiProfile.mediaGroups.find((group) => group.id === "featured-in")?.items ?? [];

    expect(akiOriginals.map((item) => item.id)).toEqual([]);
    expect(akiFeatured.map((item) => item.id)).toEqual(["get-the-crown-live"]);
    expect(suiseiOriginals.map((item) => item.id)).toEqual(["get-the-crown-live"]);
    expect(suiseiFeatured.map((item) => item.id)).toEqual([]);
  });

  it("purges topic mirrors when a non-topic row has the same canonical performance", async () => {
    const database = await createTempDatabase();
    const soraChannelId = "UCp6993wxpyDPHUpavwDFqgg";
    const topicChannelId = "topic-channel-duplicate";
    const bundle: HolodexArtifactBundle = {
      rows: [
        {
          youtubeVideoId: "official-duplicate-song",
          youtubeUrl: "https://www.youtube.com/watch?v=official-duplicate-song",
          title: "[Original MV] Duplicate Song / Tokino Sora",
          status: "past",
          topicId: "Original_Song",
          channelId: soraChannelId,
          channelName: "Tokino Sora",
          publishedAt: "2026-01-02T00:00:00.000Z"
        },
        {
          youtubeVideoId: "topic-duplicate-song",
          youtubeUrl: "https://www.youtube.com/watch?v=topic-duplicate-song",
          title: "Duplicate Song",
          status: "past",
          topicId: "Original_Song",
          channelId: topicChannelId,
          channelName: "Tokino Sora - Topic",
          publishedAt: "2026-01-03T00:00:00.000Z"
        }
      ],
      detailCache: {
        "official-duplicate-song": normalizeVideoDetail("official-duplicate-song", {
          youtubeVideoId: "official-duplicate-song",
          channelId: soraChannelId,
          duration: 180,
          songNames: ["Duplicate Song"],
          relationshipsLoaded: true
        }),
        "topic-duplicate-song": normalizeVideoDetail("topic-duplicate-song", {
          youtubeVideoId: "topic-duplicate-song",
          channelId: topicChannelId,
          duration: 180,
          originalChannelId: soraChannelId,
          providedToYoutube: true,
          songNames: ["Duplicate Song"],
          relationshipsLoaded: true
        })
      },
      duplicateRemovals: []
    };

    database.setHololiveMusicMarker({ youtubeVideoId: "topic-duplicate-song", marker: "favorite" });
    database.importHolodexMusicArtifacts(bundle, "live");

    const rawRows = database.listHololiveMusicRows({ query: "Duplicate Song", limit: 10 });
    const removals = database.select<{ removed_youtube_video_id: string; kept_youtube_video_id: string; reason: string }>(
      `SELECT removed_youtube_video_id, kept_youtube_video_id, reason
       FROM hololive_music_duplicate_removals
       WHERE removed_youtube_video_id = 'topic-duplicate-song'`
    );
    const profile = database.getHololiveIdolProfile("tokino-sora");
    const originalSongs = profile.mediaGroups.find((group) => group.id === "original-songs")?.items ?? [];

    expect(rawRows).toHaveLength(1);
    expect(rawRows[0]).toMatchObject({ youtubeVideoId: "official-duplicate-song", marker: "favorite" });
    expect(new Set(rawRows.map((row) => row.canonicalPerformanceKey)).size).toBe(1);
    expect(removals).toEqual([
      {
        removed_youtube_video_id: "topic-duplicate-song",
        kept_youtube_video_id: "official-duplicate-song",
        reason: "canonical_topic_duplicate_of_non_topic"
      }
    ]);
    expect(originalSongs.map((item) => item.id)).toEqual(["official-duplicate-song"]);
    expect(originalSongs[0]?.marker).toBe("favorite");

    database.setHololiveMusicMarker({ youtubeVideoId: "official-duplicate-song", marker: null });
    expect(database.listHololiveMusicRows({ query: "Duplicate Song", limit: 10 })[0].marker).toBeNull();
  });

  it("purges provider topic mirrors by song and participant overlap on startup", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "holoshelf-db-"));
    const databasePath = path.join(dir, "test.sqlite");
    const database = await createTempDatabaseAt(databasePath);
    const officialVideoId = "kPqmld3_lSs";
    const topicVideoId = "Hew0tgd9Ipg";
    const officialChannelId = "UC5CwaMl1eIgY8h02uZw7u8A";
    const groupChannelId = "UCJFZiqLMntJufDCHc6bQixg";
    const now = new Date().toISOString();
    const officialBundle: HolodexArtifactBundle = {
      rows: [
        {
          youtubeVideoId: officialVideoId,
          youtubeUrl: `https://www.youtube.com/watch?v=${officialVideoId}`,
          title: "BEEP BEEP / Hoshimatic Project (official)",
          status: "past",
          topicId: "Original_Song",
          channelId: officialChannelId,
          channelName: "Suisei Channel",
          publishedAt: "2026-04-17T12:00:06.000Z"
        }
      ],
      detailCache: {
        [officialVideoId]: normalizeVideoDetail(officialVideoId, {
          youtubeVideoId: officialVideoId,
          channelId: officialChannelId,
          duration: 209,
          songNames: ["BEEP BEEP"],
          mentions: [{ channelId: officialChannelId, name: "Hoshimachi Suisei", englishName: "", type: "vtuber", photoUrl: "", org: "Hololive" }],
          relationshipsLoaded: true
        })
      },
      duplicateRemovals: []
    };

    database.importHolodexMusicArtifacts(officialBundle, "live");
    database.run(
      `INSERT INTO catalog_items (id, module_id, kind, title, subtitle, source_url, created_at, updated_at)
       VALUES (?, 'hololive', 'music', 'BEEP BEEP', 'hololive ホロライブ - VTuber Group', ?, ?, ?)`,
      [`holodex:${topicVideoId}`, `https://www.youtube.com/watch?v=${topicVideoId}`, now, now]
    );
    database.run(
      `INSERT INTO source_refs (id, item_id, source_id, source_key, detail_url, cover_url, created_at, updated_at)
       VALUES (?, ?, 'holodex', ?, ?, NULL, ?, ?)`,
      [
        `holodex:${topicVideoId}`,
        `holodex:${topicVideoId}`,
        topicVideoId,
        `https://www.youtube.com/watch?v=${topicVideoId}`,
        now,
        now
      ]
    );
    database.run(
      `INSERT INTO hololive_music_detail_cache
         (youtube_video_id, channel_id, duration_seconds, original_channel_id, provided_to_youtube,
          song_names_json, mentions_json, collab_channel_ids_json, relationships_loaded, updated_at)
       VALUES (?, ?, 193, 'UCSizuuBcBPqwLMrVFTuIfVg', 1, '["BEEP BEEP"]', ?, ?, 1, ?)`,
      [
        topicVideoId,
        groupChannelId,
        JSON.stringify([{ channelId: officialChannelId, name: "Hoshimachi Suisei", englishName: "", type: "vtuber", photoUrl: "", org: "Hololive" }]),
        JSON.stringify([officialChannelId]),
        now
      ]
    );
    database.run(
      `INSERT INTO hololive_music_videos
         (youtube_video_id, item_id, idol_id, youtube_url, title, status, topic_id, channel_id, channel_name,
          published_at, duration_seconds, song_name, original_channel_id, provided_to_youtube,
          participants_json, participant_idol_ids_json, source_run_id, updated_at,
          canonical_song_key, canonical_performance_key, owned_idol_ids_json, featured_idol_ids_json)
       VALUES (?, ?, 'hoshimachi-suisei', ?, 'BEEP BEEP', 'past', 'Original_Song', ?, 'hololive ホロライブ - VTuber Group',
          '2026-04-17T15:01:10.000Z', 193, 'BEEP BEEP', 'UCSizuuBcBPqwLMrVFTuIfVg', 1,
          ?, ?, NULL, ?, 'beep beep', ?, '[]', ?)`,
      [
        topicVideoId,
        `holodex:${topicVideoId}`,
        `https://www.youtube.com/watch?v=${topicVideoId}`,
        groupChannelId,
        JSON.stringify([
          { idolId: "hoshimachi-suisei", role: "mentioned", channelId: officialChannelId },
          { idolId: "hoshimachi-suisei", role: "collab", channelId: officialChannelId }
        ]),
        JSON.stringify(["hoshimachi-suisei"]),
        now,
        `Original_Song:beep beep:unowned:${topicVideoId}`,
        JSON.stringify(["hoshimachi-suisei"])
      ]
    );

    database.setHololiveMusicMarker({ youtubeVideoId: topicVideoId, marker: "favorite" });
    database.createHololiveMusicPlaylist("BEEP BEEP");
    const playlistId = database.getHololiveMusicPlayerData().playlists.find((playlist) => !playlist.systemId)?.id;
    if (!playlistId) {
      throw new Error("Expected a user playlist");
    }
    database.addHololiveMusicPlaylistItem({ playlistId, youtubeVideoId: topicVideoId });
    database.addHololiveMusicQueueItem({ youtubeVideoId: topicVideoId, placement: "now" });
    database.flush();

    const reopened = await createTempDatabaseAt(databasePath);
    const rows = reopened.listHololiveMusicRows({ query: "BEEP BEEP", limit: 10 });
    const removals = reopened.select<{ removed_youtube_video_id: string; kept_youtube_video_id: string; reason: string }>(
      `SELECT removed_youtube_video_id, kept_youtube_video_id, reason
       FROM hololive_music_duplicate_removals
       WHERE removed_youtube_video_id = ?`,
      [topicVideoId]
    );
    const playerData = reopened.getHololiveMusicPlayerData();
    const userPlaylist = playerData.playlists.find((playlist) => !playlist.systemId);

    expect(rows.map((row) => row.youtubeVideoId)).toEqual([officialVideoId]);
    expect(rows[0]).toMatchObject({ youtubeVideoId: officialVideoId, marker: "favorite" });
    expect(removals).toEqual([
      {
        removed_youtube_video_id: topicVideoId,
        kept_youtube_video_id: officialVideoId,
        reason: "canonical_topic_duplicate_of_non_topic"
      }
    ]);
    expect(userPlaylist?.items?.map((item) => item.youtubeVideoId)).toEqual([officialVideoId]);
    expect(playerData.queue.map((item) => item.youtubeVideoId)).toEqual([officialVideoId]);
    expect(playerData.currentItem?.youtubeVideoId).toBe(officialVideoId);
  });

  it("prefers full/plain official rows over TV-size and language version variants", async () => {
    const database = await createTempDatabase();
    const fuwamocoChannelId = "UCt9H_RpQzhxzlyBxFqrdHqA";
    const topicChannelId = "fuwamoco-topic";
    const bundle: HolodexArtifactBundle = {
      rows: [
        {
          youtubeVideoId: "lifetime-tv",
          youtubeUrl: "https://www.youtube.com/watch?v=lifetime-tv",
          title: "\u3010ORIGINAL INTRO SONG\u3011Lifetime Showtime\u3010FUWAMOCO\u3011",
          status: "past",
          topicId: "Original_Song",
          channelId: fuwamocoChannelId,
          channelName: "FUWAMOCO Ch. hololive-EN",
          publishedAt: "2023-08-31T03:15:11.000Z"
        },
        {
          youtubeVideoId: "lifetime-full",
          youtubeUrl: "https://www.youtube.com/watch?v=lifetime-full",
          title: "\u3010ORIGINAL SONG\u3011Lifetime Showtime \u3010FUWAMOCO\u3011",
          status: "past",
          topicId: "Original_Song",
          channelId: fuwamocoChannelId,
          channelName: "FUWAMOCO Ch. hololive-EN",
          publishedAt: "2025-07-31T03:30:08.000Z"
        },
        {
          youtubeVideoId: "lifetime-japanese",
          youtubeUrl: "https://www.youtube.com/watch?v=lifetime-japanese",
          title: "Lifetime Showtime (Japanese ver.)",
          status: "past",
          topicId: "Original_Song",
          channelId: topicChannelId,
          channelName: "FUWAMOCO Ch. hololive-EN",
          publishedAt: "2025-07-31T15:00:29.000Z"
        }
      ],
      detailCache: {
        "lifetime-tv": normalizeVideoDetail("lifetime-tv", {
          youtubeVideoId: "lifetime-tv",
          channelId: fuwamocoChannelId,
          duration: 90,
          songNames: ["Lifetime Showtime (TV Size)"],
          relationshipsLoaded: true
        }),
        "lifetime-full": normalizeVideoDetail("lifetime-full", {
          youtubeVideoId: "lifetime-full",
          channelId: fuwamocoChannelId,
          duration: 225,
          songNames: ["Lifetime Showtime"],
          relationshipsLoaded: true
        }),
        "lifetime-japanese": normalizeVideoDetail("lifetime-japanese", {
          youtubeVideoId: "lifetime-japanese",
          channelId: topicChannelId,
          originalChannelId: fuwamocoChannelId,
          providedToYoutube: true,
          duration: 226,
          songNames: ["Lifetime Showtime (Japanese ver.)"],
          relationshipsLoaded: true
        })
      },
      duplicateRemovals: []
    };

    database.setHololiveMusicMarker({ youtubeVideoId: "lifetime-tv", marker: "like" });
    const result = database.importHolodexMusicArtifacts(bundle, "live");

    const rows = database.listHololiveMusicRows({ query: "Lifetime Showtime", limit: 10 });
    const removals = database.select<{ removed_youtube_video_id: string; kept_youtube_video_id: string; reason: string }>(
      `SELECT removed_youtube_video_id, kept_youtube_video_id, reason
       FROM hololive_music_duplicate_removals
       WHERE removed_youtube_video_id IN ('lifetime-tv', 'lifetime-japanese')
       ORDER BY removed_youtube_video_id`
    );

    expect(result.importedRows).toBe(1);
    expect(rows.map((row) => row.youtubeVideoId)).toEqual(["lifetime-full"]);
    expect(rows[0].canonicalSongKey).toBe("lifetime showtime");
    expect(rows[0].marker).toBe("like");
    expect(removals).toEqual([
      {
        removed_youtube_video_id: "lifetime-japanese",
        kept_youtube_video_id: "lifetime-full",
        reason: "canonical_topic_duplicate_of_non_topic"
      },
      {
        removed_youtube_video_id: "lifetime-tv",
        kept_youtube_video_id: "lifetime-full",
        reason: "canonical_variant_duplicate_of_full"
      }
    ]);
  });

  it("keeps a TV-size song when no full/plain row exists", async () => {
    const database = await createTempDatabase();
    const fuwamocoChannelId = "UCt9H_RpQzhxzlyBxFqrdHqA";
    const bundle: HolodexArtifactBundle = {
      rows: [
        {
          youtubeVideoId: "tv-only",
          youtubeUrl: "https://www.youtube.com/watch?v=tv-only",
          title: "\u3010ORIGINAL INTRO SONG\u3011Only TV Song\u3010FUWAMOCO\u3011",
          status: "past",
          topicId: "Original_Song",
          channelId: fuwamocoChannelId,
          channelName: "FUWAMOCO Ch. hololive-EN",
          publishedAt: "2023-08-31T03:15:11.000Z"
        }
      ],
      detailCache: {
        "tv-only": normalizeVideoDetail("tv-only", {
          youtubeVideoId: "tv-only",
          channelId: fuwamocoChannelId,
          duration: 90,
          songNames: ["Only TV Song (TV Size)"],
          relationshipsLoaded: true
        })
      },
      duplicateRemovals: []
    };

    const result = database.importHolodexMusicArtifacts(bundle, "live");
    const rows = database.listHololiveMusicRows({ query: "Only TV Song", limit: 10 });

    expect(result.importedRows).toBe(1);
    expect(rows.map((row) => row.youtubeVideoId)).toEqual(["tv-only"]);
    expect(rows[0].canonicalSongKey).toBe("only tv song");
  });

  it("removes group-channel TV-size variants when a full row exists for the same song and uploader", async () => {
    const database = await createTempDatabase();
    const hololiveEnglishChannelId = "UCotXwY6s8pWmuWd_snKYjhg";
    database.refreshHolodexChannels([
      {
        id: hololiveEnglishChannelId,
        name: "hololive English",
        englishName: "hololive English",
        type: "suborg",
        org: "Hololive",
        group: "English",
        photoUrl: "",
        twitter: "",
        videoCount: 0,
        subscriberCount: 0,
        clipCount: 0,
        publishedAt: "2020-01-01T00:00:00.000Z",
        inactive: false
      }
    ]);
    const bundle: HolodexArtifactBundle = {
      rows: [
        {
          youtubeVideoId: "start-again-full",
          youtubeUrl: "https://www.youtube.com/watch?v=start-again-full",
          title: "START AGAIN",
          status: "past",
          topicId: "Original_Song",
          channelId: hololiveEnglishChannelId,
          channelName: "hololive English",
          publishedAt: "2024-08-31T03:00:00.000Z"
        },
        {
          youtubeVideoId: "start-again-tv",
          youtubeUrl: "https://www.youtube.com/watch?v=start-again-tv",
          title: "\u3010MV\u3011START AGAIN\u3010ENigmatic Recollection Chapter 1 Theme Song\u3011",
          status: "past",
          topicId: "Original_Song",
          channelId: hololiveEnglishChannelId,
          channelName: "hololive English",
          publishedAt: "2024-08-31T03:05:00.000Z"
        }
      ],
      detailCache: {
        "start-again-full": normalizeVideoDetail("start-again-full", {
          youtubeVideoId: "start-again-full",
          channelId: hololiveEnglishChannelId,
          originalChannelId: "UC8tarnCNQm0dZKQGIi5n4AQ",
          providedToYoutube: true,
          duration: 220,
          songNames: ["START AGAIN"],
          relationshipsLoaded: true
        }),
        "start-again-tv": normalizeVideoDetail("start-again-tv", {
          youtubeVideoId: "start-again-tv",
          channelId: hololiveEnglishChannelId,
          duration: 105,
          songNames: ["START AGAIN (TV Size)"],
          relationshipsLoaded: true
        })
      },
      duplicateRemovals: []
    };

    database.setHololiveMusicMarker({ youtubeVideoId: "start-again-tv", marker: "favorite" });
    const result = database.importHolodexMusicArtifacts(bundle, "live");
    const rows = database.listHololiveMusicRows({ query: "START AGAIN", limit: 10 });
    const removals = database.select<{ removed_youtube_video_id: string; kept_youtube_video_id: string; reason: string }>(
      `SELECT removed_youtube_video_id, kept_youtube_video_id, reason
       FROM hololive_music_duplicate_removals
       WHERE removed_youtube_video_id = 'start-again-tv'`
    );

    expect(result.importedRows).toBe(1);
    expect(rows.map((row) => row.youtubeVideoId)).toEqual(["start-again-full"]);
    expect(rows[0].marker).toBe("favorite");
    expect(rows[0].canonicalSongKey).toBe("start again");
    expect(removals).toEqual([
      {
        removed_youtube_video_id: "start-again-tv",
        kept_youtube_video_id: "start-again-full",
        reason: "canonical_variant_duplicate_of_full"
      }
    ]);
  });

  it("removes 3D live variants when a full official upload exists for the same song", async () => {
    const database = await createTempDatabase();
    const moriChannelId = "UCL_qhgtOy0dy1Agp8vkySQg";
    const bundle: HolodexArtifactBundle = {
      rows: [
        {
          youtubeVideoId: "kamouflage-official",
          youtubeUrl: "https://www.youtube.com/watch?v=kamouflage-official",
          title: "Kamouflage",
          status: "past",
          topicId: "Original_Song",
          channelId: moriChannelId,
          channelName: "Mori Calliope Ch. hololive-EN",
          publishedAt: "2026-01-01T00:00:00.000Z"
        },
        {
          youtubeVideoId: "kamouflage-3d-live",
          youtubeUrl: "https://www.youtube.com/watch?v=kamouflage-3d-live",
          title: "Kamouflage [3D Live]",
          status: "past",
          topicId: "Original_Song",
          channelId: moriChannelId,
          channelName: "Mori Calliope Ch. hololive-EN",
          publishedAt: "2026-01-02T00:00:00.000Z"
        },
        {
          youtubeVideoId: "live-only-song",
          youtubeUrl: "https://www.youtube.com/watch?v=live-only-song",
          title: "Only On Stage [3D Live]",
          status: "past",
          topicId: "Original_Song",
          channelId: moriChannelId,
          channelName: "Mori Calliope Ch. hololive-EN",
          publishedAt: "2026-01-03T00:00:00.000Z"
        }
      ],
      detailCache: {
        "kamouflage-official": normalizeVideoDetail("kamouflage-official", {
          youtubeVideoId: "kamouflage-official",
          channelId: moriChannelId,
          duration: 214,
          songNames: ["Kamouflage"],
          relationshipsLoaded: true
        }),
        "kamouflage-3d-live": normalizeVideoDetail("kamouflage-3d-live", {
          youtubeVideoId: "kamouflage-3d-live",
          channelId: moriChannelId,
          duration: 245,
          songNames: ["Kamouflage [3D Live]"],
          relationshipsLoaded: true
        }),
        "live-only-song": normalizeVideoDetail("live-only-song", {
          youtubeVideoId: "live-only-song",
          channelId: moriChannelId,
          duration: 238,
          songNames: ["Only On Stage [3D Live]"],
          relationshipsLoaded: true
        })
      },
      duplicateRemovals: []
    };

    database.setHololiveMusicMarker({ youtubeVideoId: "kamouflage-3d-live", marker: "favorite" });
    database.upsertHololiveMusicVideoStats([
      { youtubeVideoId: "kamouflage-official", viewCount: 2_000_000, fetchedAt: "2026-01-04T00:00:00.000Z" },
      { youtubeVideoId: "kamouflage-3d-live", viewCount: 500_000, fetchedAt: "2026-01-04T00:00:00.000Z" }
    ]);

    const result = database.importHolodexMusicArtifacts(bundle, "live");
    const kamouflageRows = database.listHololiveMusicRows({ query: "Kamouflage", limit: 10 });
    const liveOnlyRows = database.listHololiveMusicRows({ query: "Only On Stage", limit: 10 });
    const removals = database.select<{ removed_youtube_video_id: string; kept_youtube_video_id: string; reason: string }>(
      `SELECT removed_youtube_video_id, kept_youtube_video_id, reason
       FROM hololive_music_duplicate_removals
       WHERE removed_youtube_video_id = 'kamouflage-3d-live'`
    );

    expect(result.importedRows).toBe(2);
    expect(kamouflageRows.map((row) => row.youtubeVideoId)).toEqual(["kamouflage-official"]);
    expect(kamouflageRows[0]).toMatchObject({
      canonicalSongKey: "kamouflage",
      marker: "favorite"
    });
    expect(liveOnlyRows.map((row) => row.youtubeVideoId)).toEqual(["live-only-song"]);
    expect(liveOnlyRows[0]?.canonicalSongKey).toBe("only on stage");
    expect(removals).toEqual([
      {
        removed_youtube_video_id: "kamouflage-3d-live",
        kept_youtube_video_id: "kamouflage-official",
        reason: "canonical_variant_duplicate_of_full"
      }
    ]);
  });

  it("removes known multilingual topic duplicates in database repair", async () => {
    const database = await createTempDatabase();
    const suiseiChannelId = "UC5CwaMl1eIgY8h02uZw7u8A";
    const officialVideoId = "LYFciXBcXIQ";
    const duplicateVideoIds = ["APB19Vr233c", "ev7menqLdK4"];
    const bundle: HolodexArtifactBundle = {
      rows: [
        {
          youtubeVideoId: officialVideoId,
          youtubeUrl: `https://www.youtube.com/watch?v=${officialVideoId}`,
          title: "「3時12分 / TAKU INOUE & 星街すいせい」MUSIC VIDEO",
          status: "past",
          topicId: "Original_Song",
          channelId: suiseiChannelId,
          channelName: "Suisei Channel",
          publishedAt: "2021-07-14T10:00:10.000Z"
        },
        {
          youtubeVideoId: duplicateVideoIds[0],
          youtubeUrl: `https://www.youtube.com/watch?v=${duplicateVideoIds[0]}`,
          title: "Sanji Juunihun",
          status: "past",
          topicId: "Original_Song",
          channelId: suiseiChannelId,
          channelName: "Suisei Channel",
          publishedAt: "2021-12-21T10:01:44.000Z"
        },
        {
          youtubeVideoId: duplicateVideoIds[1],
          youtubeUrl: `https://www.youtube.com/watch?v=${duplicateVideoIds[1]}`,
          title: "3時12分 (Sanji Junnihun)",
          status: "past",
          topicId: "Original_Song",
          channelId: suiseiChannelId,
          channelName: "Suisei Channel",
          publishedAt: "2022-10-09T10:03:40.000Z"
        }
      ],
      detailCache: {
        [officialVideoId]: normalizeVideoDetail(officialVideoId, {
          youtubeVideoId: officialVideoId,
          channelId: suiseiChannelId,
          duration: 193,
          songNames: ["3時12分"],
          relationshipsLoaded: true
        }),
        [duplicateVideoIds[0]]: normalizeVideoDetail(duplicateVideoIds[0], {
          youtubeVideoId: duplicateVideoIds[0],
          channelId: suiseiChannelId,
          originalChannelId: "UCFUNdEg9jxy1bUsCRJGlTGg",
          providedToYoutube: true,
          duration: 193,
          songNames: ["Sanji Juunihun"],
          relationshipsLoaded: true
        }),
        [duplicateVideoIds[1]]: normalizeVideoDetail(duplicateVideoIds[1], {
          youtubeVideoId: duplicateVideoIds[1],
          channelId: suiseiChannelId,
          originalChannelId: "UCFUNdEg9jxy1bUsCRJGlTGg",
          providedToYoutube: true,
          duration: 162,
          songNames: ["3時12分 (Sanji Junnihun)"],
          relationshipsLoaded: true
        })
      },
      duplicateRemovals: []
    };

    const result = database.importHolodexMusicArtifacts(bundle, "live");
    const retainedRows = database.listHololiveMusicRows({ query: "3時12分", limit: 10 });
    const removals = database.select<{
      removed_youtube_video_id: string;
      kept_youtube_video_id: string;
      reason: string;
    }>(
      `SELECT removed_youtube_video_id, kept_youtube_video_id, reason
       FROM hololive_music_duplicate_removals
       WHERE removed_youtube_video_id IN (?, ?)
       ORDER BY removed_youtube_video_id`,
      duplicateVideoIds
    );

    expect(result.importedRows).toBe(1);
    expect(retainedRows.map((row) => row.youtubeVideoId)).toEqual([officialVideoId]);
    expect(removals).toEqual(
      duplicateVideoIds.sort().map((removedYoutubeVideoId) => ({
        removed_youtube_video_id: removedYoutubeVideoId,
        kept_youtube_video_id: officialVideoId,
        reason: "known_duplicate_of_official"
      }))
    );
  });

  it("replaces an older metadata-poor upload with its newer official 3D MV", async () => {
    const database = await createTempDatabase();
    const akiChannelId = "UCFTLzh12_nrtzqBPsTCqenA";
    const oldVideoId = "lI861CIVGgo";
    const officialVideoId = "Ii7rtNaGlls";
    const bundle: HolodexArtifactBundle = {
      rows: [
        {
          youtubeVideoId: oldVideoId,
          youtubeUrl: `https://www.youtube.com/watch?v=${oldVideoId}`,
          title: "\u30a8\u30eb\u30d5\u306e\u4f1d\u627f\u6b4c\u300c\u30b7\u30e3\u30fb\u30eb\u30fb\u30a4\u30fc\u30b9\u300d\u6b4c\u3044\u624b\u30a2\u30ad\u30ed\u30bc/\u6c11\u65cf\u8abf\u30aa\u30ea\u30b8\u30ca\u30eb\u66f2",
          status: "past",
          topicId: "Original_Song",
          channelId: akiChannelId,
          channelName: "Aki Rosenthal Channel",
          publishedAt: "2018-06-15T13:18:48.000Z"
        },
        {
          youtubeVideoId: officialVideoId,
          youtubeUrl: `https://www.youtube.com/watch?v=${officialVideoId}`,
          title: "\u30103DMV\u3011\u30b7\u30e3\u30eb\u30a4\u30fc\u30b9 /Aki Rosenthal\u3010hololive original\u3011",
          status: "past",
          topicId: "Original_Song",
          channelId: akiChannelId,
          channelName: "Aki Rosenthal Channel",
          publishedAt: "2020-06-29T14:30:13.000Z"
        }
      ],
      detailCache: {
        [oldVideoId]: normalizeVideoDetail(oldVideoId, {
          youtubeVideoId: oldVideoId,
          channelId: akiChannelId,
          duration: 118,
          songNames: [],
          relationshipsLoaded: true
        }),
        [officialVideoId]: normalizeVideoDetail(officialVideoId, {
          youtubeVideoId: officialVideoId,
          channelId: akiChannelId,
          duration: 269,
          songNames: ["\u30b7\u30e3\u30eb\u30a4\u30fc\u30b9 / SHALLYS"],
          relationshipsLoaded: true
        })
      },
      duplicateRemovals: []
    };

    database.upsertHololiveMusicVideoStats([
      { youtubeVideoId: oldVideoId, viewCount: 125_662, fetchedAt: "2026-07-11T00:00:00.000Z" },
      { youtubeVideoId: officialVideoId, viewCount: 2_288_724, fetchedAt: "2026-07-11T00:00:00.000Z" }
    ]);

    const result = database.importHolodexMusicArtifacts(bundle, "live");
    const rows = database.listHololiveMusicRows({ query: "Aki Rosenthal", limit: 10 });
    const removal = database.select<{
      removed_youtube_video_id: string;
      kept_youtube_video_id: string;
      reason: string;
    }>(
      `SELECT removed_youtube_video_id, kept_youtube_video_id, reason
       FROM hololive_music_duplicate_removals
       WHERE removed_youtube_video_id = ?`,
      [oldVideoId]
    );

    expect(result.importedRows).toBe(1);
    expect(rows.map((row) => row.youtubeVideoId)).toEqual([officialVideoId]);
    expect(removal).toEqual([
      {
        removed_youtube_video_id: oldVideoId,
        kept_youtube_video_id: officialVideoId,
        reason: "superseded_direct_upload"
      }
    ]);
  });

  it("replaces a short promotional song upload with the later full official upload", async () => {
    const database = await createTempDatabase();
    const robocoChannelId = "UCDqI2jOz0weumE8s7paEk6g";
    const promotionalVideoId = "7h7NuUAd7yg";
    const officialVideoId = "iz1CAkDctL4";
    const bundle: HolodexArtifactBundle = {
      rows: [
        {
          youtubeVideoId: promotionalVideoId,
          youtubeUrl: `https://www.youtube.com/watch?v=${promotionalVideoId}`,
          title: "\u3010\u30ed\u30dc\u5b50\u3055\u3093\u3011\u30a2\u30b6\u30df\u30ca/VTuber\u30aa\u30ea\u30b8\u30ca\u30eb\u697d\u66f2\u30a2\u30eb\u30d0\u30e0\u7b2c3\u5f3e\u300cVirtuaREAL.02\u300d",
          status: "past",
          topicId: "Original_Song",
          channelId: robocoChannelId,
          channelName: "Roboco Ch. - \u30ed\u30dc\u5b50",
          publishedAt: "2020-08-04T10:45:01.000Z"
        },
        {
          youtubeVideoId: officialVideoId,
          youtubeUrl: `https://www.youtube.com/watch?v=${officialVideoId}`,
          title: "\u30a2\u30b6\u30df\u30ca\uff1aRobocosan Original Song",
          status: "past",
          topicId: "Original_Song",
          channelId: robocoChannelId,
          channelName: "Roboco Ch. - \u30ed\u30dc\u5b50",
          publishedAt: "2023-11-12T08:00:08.000Z"
        }
      ],
      detailCache: {
        [promotionalVideoId]: normalizeVideoDetail(promotionalVideoId, {
          youtubeVideoId: promotionalVideoId,
          channelId: robocoChannelId,
          duration: 118,
          songNames: [],
          relationshipsLoaded: true
        }),
        [officialVideoId]: normalizeVideoDetail(officialVideoId, {
          youtubeVideoId: officialVideoId,
          channelId: robocoChannelId,
          duration: 246,
          songNames: ["\u30a2\u30b6\u30df\u30ca / azamina"],
          relationshipsLoaded: true
        })
      },
      duplicateRemovals: []
    };

    database.upsertHololiveMusicVideoStats([
      { youtubeVideoId: promotionalVideoId, viewCount: 592_212, fetchedAt: "2026-07-14T00:00:00.000Z" },
      { youtubeVideoId: officialVideoId, viewCount: 633_734, fetchedAt: "2026-07-14T00:00:00.000Z" }
    ]);

    const result = database.importHolodexMusicArtifacts(bundle, "live");
    const rows = database.listHololiveMusicRows({ query: "\u30a2\u30b6\u30df\u30ca", limit: 10 });
    const removal = database.select<{
      removed_youtube_video_id: string;
      kept_youtube_video_id: string;
      reason: string;
    }>(
      `SELECT removed_youtube_video_id, kept_youtube_video_id, reason
       FROM hololive_music_duplicate_removals
       WHERE removed_youtube_video_id = ?`,
      [promotionalVideoId]
    );

    expect(result.importedRows).toBe(1);
    expect(rows.map((row) => row.youtubeVideoId)).toEqual([officialVideoId]);
    expect(removal).toEqual([
      {
        removed_youtube_video_id: promotionalVideoId,
        kept_youtube_video_id: officialVideoId,
        reason: "superseded_direct_upload"
      }
    ]);
  });

  it("keeps a metadata-poor slash-title upload when the later match is not a better replacement", async () => {
    const database = await createTempDatabase();
    const channelId = "UCDqI2jOz0weumE8s7paEk6g";
    const promotionalVideoId = "promotion-version";
    const laterVideoId = "later-version";
    const bundle: HolodexArtifactBundle = {
      rows: [
        {
          youtubeVideoId: promotionalVideoId,
          youtubeUrl: `https://www.youtube.com/watch?v=${promotionalVideoId}`,
          title: "[Official Channel] Example Song/album promotion",
          status: "past",
          topicId: "Original_Song",
          channelId,
          channelName: "Roboco Ch. - \u30ed\u30dc\u5b50",
          publishedAt: "2020-01-01T00:00:00.000Z"
        },
        {
          youtubeVideoId: laterVideoId,
          youtubeUrl: `https://www.youtube.com/watch?v=${laterVideoId}`,
          title: "Example Song",
          status: "past",
          topicId: "Original_Song",
          channelId,
          channelName: "Roboco Ch. - \u30ed\u30dc\u5b50",
          publishedAt: "2023-01-01T00:00:00.000Z"
        }
      ],
      detailCache: {
        [promotionalVideoId]: normalizeVideoDetail(promotionalVideoId, {
          youtubeVideoId: promotionalVideoId,
          channelId,
          duration: 180,
          songNames: [],
          relationshipsLoaded: true
        }),
        [laterVideoId]: normalizeVideoDetail(laterVideoId, {
          youtubeVideoId: laterVideoId,
          channelId,
          duration: 185,
          songNames: ["Example Song"],
          relationshipsLoaded: true
        })
      },
      duplicateRemovals: []
    };

    database.upsertHololiveMusicVideoStats([
      { youtubeVideoId: promotionalVideoId, viewCount: 500_000, fetchedAt: "2026-07-14T00:00:00.000Z" },
      { youtubeVideoId: laterVideoId, viewCount: 400_000, fetchedAt: "2026-07-14T00:00:00.000Z" }
    ]);

    database.importHolodexMusicArtifacts(bundle, "live");

    expect(database.listHololiveMusicRows({ query: "Example Song", limit: 10 })).toHaveLength(2);
    expect(
      database.select(
        `SELECT removed_youtube_video_id
         FROM hololive_music_duplicate_removals
         WHERE removed_youtube_video_id = ?`,
        [promotionalVideoId]
      )
    ).toHaveLength(0);
  });

  it("keeps explicit external collab canonical performances video-specific when Holodex song names are too broad", async () => {
    const database = await createTempDatabase();
    const externalChannelId = "external-channel";
    const bundle: HolodexArtifactBundle = {
      rows: [
        {
          youtubeVideoId: "external-feature-a",
          youtubeUrl: "https://www.youtube.com/watch?v=external-feature-a",
          title: "Different Featured Song A",
          status: "past",
          topicId: "Music_Cover",
          channelId: externalChannelId,
          channelName: "External Channel",
          publishedAt: "2026-01-01T00:00:00.000Z"
        },
        {
          youtubeVideoId: "external-feature-b",
          youtubeUrl: "https://www.youtube.com/watch?v=external-feature-b",
          title: "Different Featured Song B",
          status: "past",
          topicId: "Music_Cover",
          channelId: externalChannelId,
          channelName: "External Channel",
          publishedAt: "2026-01-02T00:00:00.000Z"
        }
      ],
      detailCache: {
        "external-feature-a": normalizeVideoDetail("external-feature-a", {
          youtubeVideoId: "external-feature-a",
          channelId: externalChannelId,
          duration: 180,
          songNames: ["Anna"],
          collabChannelIds: ["UCp6993wxpyDPHUpavwDFqgg"],
          relationshipsLoaded: true
        }),
        "external-feature-b": normalizeVideoDetail("external-feature-b", {
          youtubeVideoId: "external-feature-b",
          channelId: externalChannelId,
          duration: 180,
          songNames: ["Anna"],
          collabChannelIds: ["UCp6993wxpyDPHUpavwDFqgg"],
          relationshipsLoaded: true
        })
      },
      duplicateRemovals: []
    };

    database.importHolodexMusicArtifacts(bundle, "live");

    const rows = database.listHololiveMusicRows({ idolId: "tokino-sora", assignment: "featured", limit: 10 });

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.ownedIdolIds)).toEqual([[], []]);
    expect(rows.map((row) => row.featuredIdolIds)).toEqual([["tokino-sora"], ["tokino-sora"]]);
    expect(new Set(rows.map((row) => row.canonicalPerformanceKey)).size).toBe(2);
    expect(rows.every((row) => row.canonicalPerformanceKey.includes("unowned:external-feature"))).toBe(true);
  });

  it("ignores unknown external covers that only mention a Hololive channel as the source song artist", async () => {
    const database = await createTempDatabase();
    const externalChannelId = "external-cover-channel";
    const suiseiChannelId = "UC5CwaMl1eIgY8h02uZw7u8A";
    const bundle: HolodexArtifactBundle = {
      rows: [
        {
          youtubeVideoId: "external-songs-source-artist",
          youtubeUrl: "https://www.youtube.com/watch?v=external-songs-source-artist",
          title: "BIBBIDIBA - Cover / Random Channel",
          status: "past",
          topicId: "Music_Cover",
          channelId: externalChannelId,
          channelName: "Random Channel",
          publishedAt: "2026-01-01T00:00:00.000Z"
        }
      ],
      detailCache: {
        "external-songs-source-artist": normalizeVideoDetail("external-songs-source-artist", {
          youtubeVideoId: "external-songs-source-artist",
          channelId: externalChannelId,
          duration: 180,
          mentions: [{ channelId: suiseiChannelId, name: "Hoshimachi Suisei", englishName: "Hoshimachi Suisei", type: "vtuber", photoUrl: "", org: "Hololive" }],
          relationshipsLoaded: true
        })
      },
      duplicateRemovals: []
    };

    const result = database.importHolodexMusicArtifacts(bundle, "live");
    const suiseiRows = database.listHololiveMusicRows({ idolId: "hoshimachi-suisei", assignment: "featured", limit: 10 });

    expect(result.importedRows).toBe(0);
    expect(suiseiRows.map((row) => row.youtubeVideoId)).not.toContain("external-songs-source-artist");
  });

  it("rejects external source originals on idol channels when the idol is not named as a performer", async () => {
    const database = await createTempDatabase();
    const laplusChannelId = "UCENwRMx5Yh42zWpzURebzTw";
    const decoChannelId = "UCGmO0S4S-AunjRdmxA6TQYg";
    const bundle: HolodexArtifactBundle = {
      rows: [
        {
          youtubeVideoId: "laplus-marshmallow-source",
          youtubeUrl: "https://www.youtube.com/watch?v=laplus-marshmallow-source",
          title: "DECO*27 - マシュマロ feat. 初音ミク",
          status: "past",
          topicId: "Original_Song",
          channelId: laplusChannelId,
          channelName: "Laplus ch. ラプラス・ダークネス - holoX -",
          publishedAt: "2025-10-08T00:00:00.000Z"
        },
        {
          youtubeVideoId: "laplus-marshmallow-cover",
          youtubeUrl: "https://www.youtube.com/watch?v=laplus-marshmallow-cover",
          title: "マシュマロ / DECO*27 ラプラス・ダークネス-cover",
          status: "past",
          topicId: "Music_Cover",
          channelId: laplusChannelId,
          channelName: "Laplus ch. ラプラス・ダークネス - holoX -",
          publishedAt: "2025-10-12T00:00:00.000Z"
        }
      ],
      detailCache: {
        "laplus-marshmallow-source": normalizeVideoDetail("laplus-marshmallow-source", {
          youtubeVideoId: "laplus-marshmallow-source",
          channelId: laplusChannelId,
          duration: 178,
          originalChannelId: decoChannelId,
          providedToYoutube: false,
          songNames: ["マシュマロ / Marshmallow"],
          relationshipsLoaded: true
        }),
        "laplus-marshmallow-cover": normalizeVideoDetail("laplus-marshmallow-cover", {
          youtubeVideoId: "laplus-marshmallow-cover",
          channelId: laplusChannelId,
          duration: 178,
          songNames: ["マシュマロ / Marshmallow"],
          relationshipsLoaded: true
        })
      },
      duplicateRemovals: []
    };

    const result = database.importHolodexMusicArtifacts(bundle, "live");
    const rows = database.listHololiveMusicRows({ query: "Marshmallow", limit: 10 });
    const laplusOriginals = database.listHololiveMusicRows({
      idolId: "la-darknesss",
      assignment: "owned",
      topicId: "Original_Song",
      query: "Marshmallow",
      limit: 10
    });

    expect(result.importedRows).toBe(1);
    expect(rows.map((row) => row.youtubeVideoId)).toEqual(["laplus-marshmallow-cover"]);
    expect(rows[0]).toMatchObject({
      topicId: "Music_Cover",
      ownedIdolIds: ["la-darknesss"]
    });
    expect(laplusOriginals).toEqual([]);
  });

  it("keeps external producer originals when the uploader idol is explicitly named", async () => {
    const database = await createTempDatabase();
    const calliChannelId = "UCL_qhgtOy0dy1Agp8vkySQg";
    const externalChannelId = "producer-channel";
    const bundle: HolodexArtifactBundle = {
      rows: [
        {
          youtubeVideoId: "calli-producer-original",
          youtubeUrl: "https://www.youtube.com/watch?v=calli-producer-original",
          title: "Producer - New Track feat. Mori Calliope",
          status: "past",
          topicId: "Original_Song",
          channelId: calliChannelId,
          channelName: "Mori Calliope Ch. hololive-EN",
          publishedAt: "2026-01-01T00:00:00.000Z"
        }
      ],
      detailCache: {
        "calli-producer-original": normalizeVideoDetail("calli-producer-original", {
          youtubeVideoId: "calli-producer-original",
          channelId: calliChannelId,
          duration: 210,
          originalChannelId: externalChannelId,
          providedToYoutube: false,
          songNames: ["New Track"],
          relationshipsLoaded: true
        })
      },
      duplicateRemovals: []
    };

    const result = database.importHolodexMusicArtifacts(bundle, "live");
    const rows = database.listHololiveMusicRows({ query: "New Track", limit: 10 });

    expect(result.importedRows).toBe(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      youtubeVideoId: "calli-producer-original",
      topicId: "Original_Song",
      ownedIdolIds: ["mori-calliope"]
    });
  });

  it("assigns explicit group-song performer suffixes as featured idols", async () => {
    const database = await createTempDatabase();
    const blueJourneyChannelId = "UCrEgFGxfrKGyy17V9csSa5w";
    database.refreshHolodexChannels([
      {
        id: blueJourneyChannelId,
        name: "Blue Journey",
        englishName: "Blue Journey",
        type: "vtuber",
        org: "Hololive",
        group: "",
        photoUrl: "",
        twitter: "",
        videoCount: null,
        subscriberCount: null,
        clipCount: null,
        publishedAt: "",
        inactive: false
      }
    ]);
    const bundle: HolodexArtifactBundle = {
      rows: [
        {
          youtubeVideoId: "blue-journey-song",
          youtubeUrl: "https://www.youtube.com/watch?v=blue-journey-song",
          title: "Dear Youthful Days",
          status: "past",
          topicId: "Original_Song",
          channelId: blueJourneyChannelId,
          channelName: "Blue Journey",
          publishedAt: "2026-01-01T00:00:00.000Z"
        }
      ],
      detailCache: {
        "blue-journey-song": normalizeVideoDetail("blue-journey-song", {
          youtubeVideoId: "blue-journey-song",
          channelId: blueJourneyChannelId,
          duration: 180,
          songNames: ["あの日の僕らへ / Anohino Bokurahe (Dear Youthful Days) (Lamy, Aqua & Kanata)"],
          relationshipsLoaded: true
        })
      },
      duplicateRemovals: []
    };

    database.importHolodexMusicArtifacts(bundle, "live");

    const rows = database.listHololiveMusicRows({ query: "Dear Youthful Days" });

    expect(rows).toHaveLength(1);
    expect(rows[0].ownedIdolIds).toEqual([]);
    expect(new Set(rows[0].featuredIdolIds)).toEqual(
      new Set(["yukihana-lamy", "minato-aqua", "amane-kanata"])
    );
  });

  it("uses exact performer aliases from group upload titles when song metadata has no performer suffix", async () => {
    const database = await createTempDatabase();
    const officialChannelId = "UCJFZiqLMntJufDCHc6bQixg";
    database.refreshHolodexChannels([
      {
        id: officialChannelId,
        name: "hololive ホロライブ - VTuber Group",
        englishName: "hololive VTuber Group",
        type: "vtuber",
        org: "Hololive",
        group: "",
        photoUrl: "",
        twitter: "",
        videoCount: null,
        subscriberCount: null,
        clipCount: null,
        publishedAt: "",
        inactive: false
      }
    ]);
    const bundle: HolodexArtifactBundle = {
      rows: [
        {
          youtubeVideoId: "fantasy-official-song",
          youtubeUrl: "https://www.youtube.com/watch?v=fantasy-official-song",
          title: "【MV】3tay on, 3tay together (兎田ぺこら/不知火フレア/白銀ノエル/宝鐘マリン)",
          status: "past",
          topicId: "Original_Song",
          channelId: officialChannelId,
          channelName: "hololive ホロライブ - VTuber Group",
          publishedAt: "2026-01-01T00:00:00.000Z"
        }
      ],
      detailCache: {
        "fantasy-official-song": normalizeVideoDetail("fantasy-official-song", {
          youtubeVideoId: "fantasy-official-song",
          channelId: officialChannelId,
          duration: 180,
          songNames: ["3tay on, 3tay together"],
          relationshipsLoaded: true
        })
      },
      duplicateRemovals: []
    };

    database.importHolodexMusicArtifacts(bundle, "live");

    const rows = database.listHololiveMusicRows({ query: "3tay" });

    expect(rows).toHaveLength(1);
    expect(rows[0].ownedIdolIds).toEqual([]);
    expect(new Set(rows[0].featuredIdolIds)).toEqual(
      new Set(["usada-pekora", "shiranui-flare", "shirogane-noel", "houshou-marine"])
    );
  });

  it("assigns exact known unit channels to their roster members without performer mentions", async () => {
    const database = await createTempDatabase();
    const reglossChannelId = "UC10wVt6hoQiwySRhz7RdOUA";
    database.refreshHolodexChannels([
      {
        id: reglossChannelId,
        name: "hololive DEV_IS ReGLOSS",
        englishName: "hololive DEV_IS ReGLOSS",
        type: "vtuber",
        org: "Hololive",
        group: "Official",
        photoUrl: "",
        twitter: "",
        videoCount: null,
        subscriberCount: null,
        clipCount: null,
        publishedAt: "",
        inactive: false
      }
    ]);
    const bundle: HolodexArtifactBundle = {
      rows: [
        {
          youtubeVideoId: "regloss-song",
          youtubeUrl: "https://www.youtube.com/watch?v=regloss-song",
          title: "Shunkan Heartbeat",
          status: "past",
          topicId: "Original_Song",
          channelId: reglossChannelId,
          channelName: "hololive DEV_IS ReGLOSS",
          publishedAt: "2026-01-01T00:00:00.000Z"
        }
      ],
      detailCache: {
        "regloss-song": normalizeVideoDetail("regloss-song", {
          youtubeVideoId: "regloss-song",
          channelId: reglossChannelId,
          duration: 180,
          songNames: ["瞬間ハートビート / Shunkan Heartbeat"],
          relationshipsLoaded: true
        })
      },
      duplicateRemovals: []
    };

    database.importHolodexMusicArtifacts(bundle, "live");

    const rows = database.listHololiveMusicRows({ query: "Shunkan Heartbeat" });

    expect(rows).toHaveLength(1);
    expect(rows[0].ownedIdolIds).toEqual([]);
    expect(new Set(rows[0].featuredIdolIds)).toEqual(
      new Set(["hiodoshi-ao", "otonose-kanade", "ichijou-ririka", "juufuutei-raden", "todoroki-hajime"])
    );
  });

  it("uses provided-to-YouTube original channel as the topic upload owner", async () => {
    const database = await createTempDatabase();
    const topicChannelId = "topic-channel";
    const soraChannelId = "UCp6993wxpyDPHUpavwDFqgg";
    const bundle: HolodexArtifactBundle = {
      rows: [
        {
          youtubeVideoId: "topic-song",
          youtubeUrl: "https://www.youtube.com/watch?v=topic-song",
          title: "Topic Song",
          status: "past",
          topicId: "Original_Song",
          channelId: topicChannelId,
          channelName: "Tokino Sora - Topic",
          publishedAt: "2026-01-01T00:00:00.000Z"
        }
      ],
      detailCache: {
        "topic-song": normalizeVideoDetail("topic-song", {
          youtubeVideoId: "topic-song",
          channelId: topicChannelId,
          duration: 180,
          originalChannelId: soraChannelId,
          providedToYoutube: true,
          songNames: ["Topic Song"],
          relationshipsLoaded: true
        })
      },
      duplicateRemovals: []
    };

    const result = database.importHolodexMusicArtifacts(bundle, "live");
    const rows = database.listHololiveMusicRows({ query: "Topic Song" });
    const topicChannel = database.listHololiveChannels().find((channel) => channel.id === topicChannelId);

    expect(result.importedRows).toBe(1);
    expect(topicChannel?.kind).toBe("topic");
    expect(topicChannel?.topicIdolIds).toEqual(["tokino-sora"]);
    expect(rows).toHaveLength(1);
    expect(rows[0].idolId).toBe("tokino-sora");
    expect(rows[0].participants.map((participant) => [participant.idolId, participant.role, participant.channelId])).toEqual([
      ["tokino-sora", "topic-owner", soraChannelId]
    ]);
  });

  it("classifies Topic uploads from their structured leading artist credits", async () => {
    const database = await createTempDatabase();
    const bundle: HolodexArtifactBundle = {
      rows: [
        {
          youtubeVideoId: "9uyK-EMEDgA",
          youtubeUrl: "https://www.youtube.com/watch?v=9uyK-EMEDgA",
          title: "Pray",
          status: "past",
          topicId: "Original_Song",
          channelId: "kanata-topic",
          channelName: "Amane Kanata - Topic",
          publishedAt: "2022-07-30T00:00:00.000Z"
        },
        {
          youtubeVideoId: "xP9AQmjqVGc",
          youtubeUrl: "https://www.youtube.com/watch?v=xP9AQmjqVGc",
          title: "Frontline of Love Letters",
          status: "past",
          topicId: "Original_Song",
          channelId: "fubuki-topic",
          channelName: "Shirakami Fubuki - Topic",
          publishedAt: "2023-07-16T00:00:00.000Z"
        }
      ],
      detailCache: {
        "9uyK-EMEDgA": normalizeVideoDetail("9uyK-EMEDgA", {
          youtubeVideoId: "9uyK-EMEDgA",
          channelId: "kanata-topic",
          duration: 226,
          originalChannelId: "UCZlDXzGoo7d44bwdNObFacg",
          providedToYoutube: true,
          description:
            "Provided to YouTube by cover corp.\n\nPray · Amane Kanata · Tokoyami Towa · Ofutonttu · t+pazolite · t+pazolite\n\nReleased on: 2022-07-30\n\nThanks to Hoshimachi Suisei.",
          songNames: ["Pray"],
          relationshipsLoaded: true
        }),
        "xP9AQmjqVGc": normalizeVideoDetail("xP9AQmjqVGc", {
          youtubeVideoId: "xP9AQmjqVGc",
          channelId: "fubuki-topic",
          duration: 231,
          originalChannelId: "UCdn5BQ06XqgXoAxIhbqw5Rg",
          providedToYoutube: true,
          description:
            "Provided to YouTube by cover corp.\n\nFrontline of Love Letters · Shirakami Fubuki · Sakura Miko · Nakiri Ayame · Ookami Mio · Ririsya · Ririsya\n\nReleased on: 2023-07-16",
          songNames: ["Frontline of Love Letters"],
          relationshipsLoaded: true
        })
      },
      duplicateRemovals: []
    };

    database.importHolodexMusicArtifacts(bundle, "live");

    const pray = database.listHololiveMusicRows({ query: "Pray", limit: 10 })[0];
    const frontline = database.listHololiveMusicRows({ query: "Frontline of Love Letters", limit: 10 })[0];
    expect(pray?.ownedIdolIds).toEqual(["amane-kanata"]);
    expect(pray?.featuredIdolIds).toEqual(["tokoyami-towa"]);
    expect(frontline?.ownedIdolIds).toEqual(["shirakami-fubuki"]);
    expect(new Set(frontline?.featuredIdolIds)).toEqual(
      new Set(["sakuramiko", "nakiri-ayame", "ookami-mio"])
    );
    expect(database.listHololiveMusicLibrary({ collabScope: "solo", limit: 100 }).rows).toHaveLength(0);
  });

  it("classifies known unit aliases and explicit description rosters as group songs", async () => {
    const database = await createTempDatabase();
    const lamyChannelId = "UCFKOVgVbGmX65RxO3EtH3iw";
    const neneChannelId = "UCAWSyEs_Io8MtpY3m-zqILA";
    const botanChannelId = "UCUKD-uaobj9jiqB-VXt71mA";
    const polkaChannelId = "UCK9V2B22uJYu3N7eR_BT9QA";
    const mentionedChannels = [
      {
        channelId: lamyChannelId,
        name: "Lamy Ch. Yukihana Lamy",
        englishName: "Yukihana Lamy",
        type: "vtuber",
        photoUrl: "",
        org: "Hololive"
      },
      {
        channelId: neneChannelId,
        name: "Nene Ch. Momosuzu Nene",
        englishName: "Momosuzu Nene",
        type: "vtuber",
        photoUrl: "",
        org: "Hololive"
      },
      {
        channelId: polkaChannelId,
        name: "Polka Ch. Omaru Polka",
        englishName: "Omaru Polka",
        type: "vtuber",
        photoUrl: "",
        org: "Hololive"
      }
    ];
    const bundle: HolodexArtifactBundle = {
      rows: [
        {
          youtubeVideoId: "nepolabo-unit-song",
          youtubeUrl: "https://www.youtube.com/watch?v=nepolabo-unit-song",
          title: "SAKURA SKIP / Covered by NePoLaBo",
          status: "past",
          topicId: "Music_Cover",
          channelId: polkaChannelId,
          channelName: "Polka Ch. Omaru Polka",
          publishedAt: "2022-01-01T00:00:00.000Z"
        },
        {
          youtubeVideoId: "description-roster-song",
          youtubeUrl: "https://www.youtube.com/watch?v=description-roster-song",
          title: "Welcome to Japari Park",
          status: "past",
          topicId: "Music_Cover",
          channelId: botanChannelId,
          channelName: "Botan Ch. Shishiro Botan",
          publishedAt: "2022-01-02T00:00:00.000Z"
        },
        {
          youtubeVideoId: "description-prose-song",
          youtubeUrl: "https://www.youtube.com/watch?v=description-prose-song",
          title: "Solo Cover",
          status: "past",
          topicId: "Music_Cover",
          channelId: botanChannelId,
          channelName: "Botan Ch. Shishiro Botan",
          publishedAt: "2022-01-03T00:00:00.000Z"
        }
      ],
      detailCache: {
        "nepolabo-unit-song": normalizeVideoDetail("nepolabo-unit-song", {
          youtubeVideoId: "nepolabo-unit-song",
          channelId: polkaChannelId,
          duration: 180,
          songNames: ["SAKURA SKIP"],
          relationshipsLoaded: true
        }),
        "description-roster-song": normalizeVideoDetail("description-roster-song", {
          youtubeVideoId: "description-roster-song",
          channelId: botanChannelId,
          duration: 180,
          description: "song\nYukihana Lamy, Momosuzu Nene, Shishiro Botan, Omaru Polka",
          songNames: ["Welcome to Japari Park"],
          mentions: [],
          relationshipsLoaded: true
        }),
        "description-prose-song": normalizeVideoDetail("description-prose-song", {
          youtubeVideoId: "description-prose-song",
          channelId: botanChannelId,
          duration: 180,
          description: "Special thanks to Yukihana Lamy, Momosuzu Nene, and Omaru Polka.",
          songNames: ["Solo Cover"],
          mentions: mentionedChannels,
          relationshipsLoaded: true
        })
      },
      duplicateRemovals: []
    };

    database.importHolodexMusicArtifacts(bundle, "live");

    const rowsById = new Map(
      database
        .listHololiveMusicRows({ youtubeVideoIds: bundle.rows.map((row) => row.youtubeVideoId) })
        .map((row) => [row.youtubeVideoId, row])
    );
    const expectedRoster = new Set(["yukihana-lamy", "momosuzu-nene", "shishiro-botan", "omaru-polka"]);
    const participantIds = (youtubeVideoId: string) =>
      rowsById.get(youtubeVideoId)?.participants.map((participant) => participant.idolId) ?? [];
    expect(new Set(participantIds("nepolabo-unit-song"))).toEqual(expectedRoster);
    expect(participantIds("nepolabo-unit-song")).not.toContain("sakuramiko");
    expect(new Set(participantIds("description-roster-song"))).toEqual(expectedRoster);
    expect(participantIds("description-prose-song")).toEqual(["shishiro-botan"]);

    const soloIds = database
      .listHololiveMusicLibrary({ collabScope: "solo", limit: 100 })
      .rows.map((row) => row.youtubeVideoId);
    expect(soloIds).not.toContain("nepolabo-unit-song");
    expect(soloIds).not.toContain("description-roster-song");
    expect(soloIds).toContain("description-prose-song");
  });

  it("assigns all idols for shared Hololive channels", async () => {
    const database = await createTempDatabase();
    const fuwamocoChannelId = "UCt9H_RpQzhxzlyBxFqrdHqA";
    const bundle: HolodexArtifactBundle = {
      rows: [
        {
          youtubeVideoId: "shared-channel-song",
          youtubeUrl: "https://www.youtube.com/watch?v=shared-channel-song",
          title: "Shared Channel Song",
          status: "past",
          topicId: "Music_Cover",
          channelId: fuwamocoChannelId,
          channelName: "FUWAMOCO Ch.",
          publishedAt: "2026-02-01T00:00:00.000Z"
        }
      ],
      detailCache: {
        "shared-channel-song": normalizeVideoDetail("shared-channel-song", {
          youtubeVideoId: "shared-channel-song",
          channelId: fuwamocoChannelId,
          duration: 180,
          songNames: ["Shared Channel Song"],
          relationshipsLoaded: true
        })
      },
      duplicateRemovals: []
    };

    database.importHolodexMusicArtifacts(bundle, "live");

    const rows = database.listHololiveMusicRows({ query: "Shared Channel Song" });
    expect(rows).toHaveLength(1);
    expect(rows[0].participants.map((participant) => [participant.idolId, participant.role])).toEqual([
      ["fuwawa-abyssgard", "primary"],
      ["mococo-abyssgard", "primary"]
    ]);
    expect(database.listHololiveMusicRows({ idolId: "fuwawa-abyssgard" })).toHaveLength(1);
    expect(database.listHololiveMusicRows({ idolId: "mococo-abyssgard" })).toHaveLength(1);
    expect(database.listHololiveMusicRows({ idolId: "fuwamoco" })).toHaveLength(1);
    expect(database.listHololiveMusicLibrary({ talentId: "fuwamoco" }).rows.map((row) => row.youtubeVideoId)).toContain("shared-channel-song");
  });

  it("parses YouTube links and supports no-key custom song preview", async () => {
    const database = await createTempDatabase();
    const service = new YouTubeVideoStatsService(database);

    expect(parseYouTubeVideoId("https://www.youtube.com/watch?v=abcDEF12345")).toBe("abcDEF12345");
    expect(parseYouTubeVideoId("https://youtu.be/abcDEF12345?t=30")).toBe("abcDEF12345");
    expect(parseYouTubeVideoId("https://www.youtube.com/shorts/abcDEF12345")).toBe("abcDEF12345");
    expect(parseYouTubeVideoId("https://www.youtube.com/embed/abcDEF12345")).toBe("abcDEF12345");
    expect(parseYouTubeVideoId("https://m.youtube.com/live/abcDEF12345")).toBe("abcDEF12345");
    expect(parseYouTubeVideoId("abcDEF12345")).toBe("abcDEF12345");
    expect(parseYouTubeVideoId("https://notyoutube.com/watch?v=abcDEF12345")).toBeNull();
    expect(parseYouTubeVideoId("https://youtube.com.evil.test/watch?v=abcDEF12345")).toBeNull();

    const preview = await service.previewCustomSong({ youtubeUrl: "https://youtu.be/abcDEF12345" });
    expect(preview).toMatchObject({
      youtubeVideoId: "abcDEF12345",
      youtubeUrl: "https://www.youtube.com/watch?v=abcDEF12345",
      usedApi: false,
      apiKeyMissing: true
    });
  });

  it("fetches custom song metadata and rejects unavailable YouTube videos when an API key is available", async () => {
    const database = await createTempDatabase();
    database.setSetting("sources.youtubeApiKey", "test-youtube-key");
    const service = new YouTubeVideoStatsService(database, {
      fetcher: async (url) => {
        const id = new URL(String(url)).searchParams.get("id");
        return new Response(
          JSON.stringify({
            items:
              id === "private1234"
                ? [
                    {
                      id,
                      status: { uploadStatus: "processed", privacyStatus: "private", embeddable: true }
                    }
                  ]
                : [
                    {
                      id,
                      snippet: {
                        title: "Fetched Custom Song",
                        channelId: "UCcustomSong",
                        channelTitle: "Custom Song Channel",
                        publishedAt: "2026-07-01T00:00:00.000Z"
                      },
                      contentDetails: { duration: "PT3M21S" },
                      statistics: { viewCount: "123456" },
                      status: { uploadStatus: "processed", privacyStatus: "public", embeddable: true }
                    }
                  ]
          }),
          { status: 200 }
        );
      }
    });

    await expect(service.previewCustomSong({ youtubeUrl: "https://youtu.be/private1234" })).rejects.toThrow("private");
    await expect(service.previewCustomSong({ youtubeUrl: "https://youtu.be/abcDEF12345" })).resolves.toMatchObject({
      youtubeVideoId: "abcDEF12345",
      title: "Fetched Custom Song",
      channelId: "UCcustomSong",
      channelName: "Custom Song Channel",
      durationSeconds: 201,
      viewCount: 123456,
      usedApi: true,
      apiKeyMissing: false
    });
  });

  it("imports, edits, deletes, and restores custom YouTube songs without losing user state", async () => {
    const database = await createTempDatabase();
    const row = database.upsertHololiveCustomSong({
      youtubeUrl: "https://youtu.be/customVid01",
      title: "My Custom Song",
      songName: "My Custom Song",
      topicId: "Original_Song",
      ownerIdolIds: ["tokino-sora"],
      featuredIdolIds: ["roboco-san"],
      channelName: "Manual Channel",
      publishedAt: "2026-07-01",
      viewCount: 987654,
      fetchedAt: "2026-07-01T00:00:00.000Z"
    });
    const playlistId = database.createHololiveMusicPlaylist("Custom Playlist").playlists.find((playlist) => playlist.name === "Custom Playlist")?.id ?? "";

    database.setHololiveMusicMarker({ youtubeVideoId: row.youtubeVideoId, marker: "favorite" });
    database.addHololiveMusicPlaylistItem({ playlistId, youtubeVideoId: row.youtubeVideoId });
    database.addHololiveMusicQueueItem({ youtubeVideoId: row.youtubeVideoId, placement: "end" });

    const edited = database.upsertHololiveCustomSong({
      youtubeUrl: row.youtubeUrl,
      title: "My Custom Song Edited",
      songName: "My Custom Song Edited",
      topicId: "Music_Cover",
      ownerIdolIds: ["tokino-sora"],
      featuredIdolIds: [],
      channelName: "Manual Channel",
      publishedAt: "2026-07-02",
      viewCount: 987655,
      fetchedAt: "2026-07-01T00:01:00.000Z"
    });

    expect(edited).toMatchObject({
      youtubeVideoId: "customVid01",
      title: "My Custom Song Edited",
      topicId: "Music_Cover",
      publishedAt: "2026-07-02T00:00:00.000Z",
      sourceKind: "user",
      marker: "favorite"
    });
    expect(database.getHololiveMusicPlayerData().queue.map((item) => item.youtubeVideoId)).toEqual(["customVid01"]);
    expect(
      database.getHololiveMusicPlayerData().playlists.find((playlist) => playlist.id === playlistId)?.items?.map((item) => item.youtubeVideoId)
    ).toEqual(["customVid01"]);

    database.deleteHololiveCustomSong("customVid01");
    expect(database.listHololiveMusicRows({ youtubeVideoIds: ["customVid01"] })).toHaveLength(0);
    const undo = database.consumeLatestHololiveUndo("custom-song-delete");
    expect(undo?.undoToken).toBeTruthy();
    database.applyHololiveUndo(undo?.undoToken ?? "");

    expect(database.listHololiveMusicRows({ youtubeVideoIds: ["customVid01"] })[0]).toMatchObject({
      youtubeVideoId: "customVid01",
      sourceKind: "user",
      marker: "favorite"
    });
    expect(database.getHololiveMusicPlayerData().queue.map((item) => item.youtubeVideoId)).toEqual(["customVid01"]);
  });

  it("requires and normalizes custom song published dates", async () => {
    const database = await createTempDatabase();
    const baseInput = {
      youtubeUrl: "https://youtu.be/customDate1",
      title: "Published Date Song",
      songName: "Published Date Song",
      topicId: "Original_Song" as const,
      ownerIdolIds: ["tokino-sora"],
      channelName: "Manual Channel"
    };

    expect(() => database.upsertHololiveCustomSong(baseInput)).toThrow("published date is required");
    expect(() => database.upsertHololiveCustomSong({ ...baseInput, publishedAt: "not a date" })).toThrow("YYYY-MM-DD");

    const row = database.upsertHololiveCustomSong({ ...baseInput, publishedAt: "2026-07-01" });
    expect(row).toMatchObject({
      youtubeVideoId: "customDate1",
      publishedAt: "2026-07-01T00:00:00.000Z",
      channelName: "Manual Channel"
    });
  });

  it("enriches custom song upserts from YouTube metadata without overwriting manual fields", async () => {
    const database = await createTempDatabase();
    database.setSetting("sources.youtubeApiKey", "test-youtube-key");
    const service = new YouTubeVideoStatsService(database, {
      fetcher: async (url) =>
        new Response(
          JSON.stringify({
            items: [
              {
                id: "customMeta1",
                snippet: {
                  title: "Fetched Metadata Song",
                  channelId: "UCmetadataChannel",
                  channelTitle: "Metadata Channel",
                  publishedAt: "2026-07-03T12:30:00.000Z"
                },
                contentDetails: { duration: "PT4M05S" },
                statistics: { viewCount: "98765" },
                status: { uploadStatus: "processed", privacyStatus: "public", embeddable: true }
              }
            ]
          })
        )
    });

    const enriched = await service.enrichCustomSongUpsert({
      youtubeUrl: "https://youtu.be/customMeta1",
      title: "Manual Title",
      songName: "Manual Song Name",
      topicId: "Original_Song",
      ownerIdolIds: ["tokino-sora"],
      featuredIdolIds: [],
      channelName: "",
      publishedAt: "",
      durationSeconds: null,
      viewCount: null,
      fetchedAt: null
    });
    expect(enriched).toMatchObject({
      youtubeUrl: "https://www.youtube.com/watch?v=customMeta1",
      title: "Manual Title",
      channelId: "UCmetadataChannel",
      channelName: "Metadata Channel",
      publishedAt: "2026-07-03",
      durationSeconds: 245,
      viewCount: 98765
    });

    const saved = database.upsertHololiveCustomSong(enriched);
    expect(saved).toMatchObject({
      youtubeVideoId: "customMeta1",
      title: "Manual Title",
      channelName: "Metadata Channel",
      publishedAt: "2026-07-03T00:00:00.000Z",
      durationSeconds: 245,
      viewCount: 98765
    });

    const manual = await service.enrichCustomSongUpsert({
      youtubeUrl: "https://youtu.be/customMeta1",
      title: "Manual Title",
      topicId: "Original_Song",
      ownerIdolIds: ["tokino-sora"],
      channelId: "UCmanualChannel",
      channelName: "Manual Channel",
      publishedAt: "2026-07-04",
      durationSeconds: 111,
      viewCount: 222,
      fetchedAt: "2026-07-04T01:00:00.000Z"
    });
    expect(manual).toMatchObject({
      channelId: "UCmanualChannel",
      channelName: "Manual Channel",
      publishedAt: "2026-07-04",
      durationSeconds: 111,
      viewCount: 222,
      fetchedAt: "2026-07-04T01:00:00.000Z"
    });
  });

  it("keeps user-owned custom songs during replace refreshes and bracket generation", async () => {
    const database = await createTempDatabase();
    const custom = database.upsertHololiveCustomSong({
      youtubeUrl: "https://youtu.be/customVid02",
      title: "Bracket Custom Song",
      songName: "Bracket Custom Song",
      topicId: "Original_Song",
      ownerIdolIds: ["tokino-sora"],
      channelName: "Manual Channel",
      publishedAt: "2026-07-01",
      viewCount: 99_000_000,
      fetchedAt: "2026-07-01T00:00:00.000Z"
    });
    const protectedHolodexVideoId = "tokino-sora-custom-holodex-user";
    const protectedHolodexItemId = `holodex:${protectedHolodexVideoId}`;
    seedHololiveBracketSong(database, {
      idolId: "tokino-sora",
      idolName: "Tokino Sora",
      channelId: "UCp6993wxpyDPHUpavwDFqgg",
      topicId: "Music_Cover",
      suffix: "custom-holodex-user",
      viewCount: 88_000_000,
      sourceKind: "user"
    });
    database.run("INSERT OR IGNORE INTO item_tags (item_id, tag) VALUES (?, ?)", [protectedHolodexItemId, "protected-custom-tag"]);
    database.run(
      `INSERT OR REPLACE INTO hololive_music_detail_cache
         (youtube_video_id, channel_id, duration_seconds, original_channel_id, provided_to_youtube,
          song_names_json, mentions_json, collab_channel_ids_json, relationships_loaded, updated_at)
       VALUES (?, ?, ?, NULL, 0, ?, '[]', '[]', 0, ?)`,
      [protectedHolodexVideoId, "custom-protected-channel", 321, JSON.stringify(["Protected Custom Song"]), "2026-07-01T00:00:00.000Z"]
    );
    const bundle: HolodexArtifactBundle = {
      rows: [
        {
          youtubeVideoId: "official-after-replace",
          youtubeUrl: "https://www.youtube.com/watch?v=official-after-replace",
          title: "Official After Replace",
          status: "past",
          topicId: "Original_Song",
          channelId: "UCp6993wxpyDPHUpavwDFqgg",
          channelName: "Sora Channel",
          publishedAt: "2026-07-01T00:00:00.000Z"
        },
        {
          youtubeVideoId: protectedHolodexVideoId,
          youtubeUrl: `https://www.youtube.com/watch?v=${protectedHolodexVideoId}`,
          title: "Official Collision Title",
          status: "past",
          topicId: "Original_Song",
          channelId: "UCp6993wxpyDPHUpavwDFqgg",
          channelName: "Official Collision Channel",
          publishedAt: "2026-07-02T00:00:00.000Z"
        }
      ],
      detailCache: {
        "official-after-replace": normalizeVideoDetail("official-after-replace", {
          youtubeVideoId: "official-after-replace",
          channelId: "UCp6993wxpyDPHUpavwDFqgg",
          duration: 180,
          songNames: ["Official After Replace"]
        }),
        [protectedHolodexVideoId]: normalizeVideoDetail(protectedHolodexVideoId, {
          youtubeVideoId: protectedHolodexVideoId,
          channelId: "UCp6993wxpyDPHUpavwDFqgg",
          duration: 999,
          songNames: ["Official Collision Title"]
        })
      },
      duplicateRemovals: [
        {
          removedYoutubeVideoId: protectedHolodexVideoId,
          removedTitle: "Official Collision Title",
          keptYoutubeVideoId: "official-after-replace",
          keptTitle: "Official After Replace",
          reason: "protected-user-owned-collision"
        }
      ]
    };

    database.importHolodexMusicArtifacts(bundle, "live", { replaceExisting: true });
    expect(database.listHololiveMusicRows({ youtubeVideoIds: [custom.youtubeVideoId] })[0]).toMatchObject({
      youtubeVideoId: custom.youtubeVideoId,
      sourceKind: "user"
    });
    expect(database.listHololiveMusicRows({ youtubeVideoIds: [protectedHolodexVideoId] })[0]).toMatchObject({
      youtubeVideoId: protectedHolodexVideoId,
      sourceKind: "user"
    });
    expect(
      database.select<{ count: number }>("SELECT COUNT(*) AS count FROM item_tags WHERE item_id = ? AND tag = ?", [
        protectedHolodexItemId,
        "protected-custom-tag"
      ])[0]?.count
    ).toBe(1);
    expect(
      database.select<{ channel_id: string; duration_seconds: number }>(
        "SELECT channel_id, duration_seconds FROM hololive_music_detail_cache WHERE youtube_video_id = ?",
        [protectedHolodexVideoId]
      )[0]
    ).toMatchObject({ channel_id: "custom-protected-channel", duration_seconds: 321 });
    expect(
      database.select<{ count: number }>(
        "SELECT COUNT(*) AS count FROM hololive_music_duplicate_removals WHERE removed_youtube_video_id = ? OR kept_youtube_video_id = ?",
        [protectedHolodexVideoId, protectedHolodexVideoId]
      )[0]?.count
    ).toBe(0);
    expect(database.listHololiveMusicLibrary({ sourceKind: "user" }).rows.map((row) => row.youtubeVideoId)).toEqual(
      expect.arrayContaining([custom.youtubeVideoId, protectedHolodexVideoId])
    );
    expect(database.listHololiveMusicLibrary({ sourceKind: "official" }).rows.map((row) => row.youtubeVideoId)).not.toEqual(
      expect.arrayContaining([custom.youtubeVideoId, protectedHolodexVideoId])
    );

    const bracketTalents = HOLOLIVE_IDOLS.filter((idol) => idol.source === "official").slice(0, 15);
    for (const [index, idol] of bracketTalents.entries()) {
      seedHololiveBracketSong(database, {
        idolId: idol.id,
        idolName: idol.displayName,
        channelId: idol.youtubeChannelId ?? `channel-${idol.id}`,
        topicId: "Original_Song",
        suffix: `custom-bracket-${index}`,
        viewCount: 10_000_000 - index
      });
    }

    const bracket = await database.createHololiveBracket({ size: "RO16", generationStyle: "top_songs" });
    expect(bracket.entries.map((entry) => entry.youtubeVideoId)).toContain(custom.youtubeVideoId);
  });
});
