import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseService } from "./database";
import { mergeBundledOfficialData } from "./officialDataMergeService";
import { normalizeVideoDetail } from "../../src/modules/hololive/music/cleanup";
import type { HololiveCustomTalentPreview, HololiveMusicTopic } from "../../src/shared/contracts";
import type { HolodexArtifactBundle } from "../../src/modules/hololive/music/types";

const SORA_CHANNEL_ID = "UCp6993wxpyDPHUpavwDFqgg";

interface TempDatabase {
  database: DatabaseService;
  dataDirectory: string;
  databasePath: string;
  hololiveImageDirectory: string;
}

async function createTempDatabase(rootPrefix: string): Promise<TempDatabase> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), rootPrefix));
  const dataDirectory = path.join(root, "data");
  const databasePath = path.join(dataDirectory, "holoshelf.sqlite");
  const database = new DatabaseService(databasePath, path.join(dataDirectory, "backups"));
  await database.init();
  return {
    database,
    dataDirectory,
    databasePath,
    hololiveImageDirectory: path.join(dataDirectory, "images", "hololive")
  };
}

function createBundle(
  rows: Array<{
    youtubeVideoId: string;
    title: string;
    songName: string;
    topicId?: HololiveMusicTopic;
    publishedAt?: string;
    channelId?: string;
    channelName?: string;
  }>
): HolodexArtifactBundle {
  return {
    rows: rows.map((row) => ({
      youtubeVideoId: row.youtubeVideoId,
      youtubeUrl: `https://www.youtube.com/watch?v=${row.youtubeVideoId}`,
      title: row.title,
      status: "past",
      topicId: row.topicId ?? "Original_Song",
      channelId: row.channelId ?? SORA_CHANNEL_ID,
      channelName: row.channelName ?? "SoraCh.",
      publishedAt: row.publishedAt ?? "2026-01-01T00:00:00.000Z"
    })),
    detailCache: Object.fromEntries(
      rows.map((row) => [
        row.youtubeVideoId,
        normalizeVideoDetail(row.youtubeVideoId, {
          youtubeVideoId: row.youtubeVideoId,
          channelId: row.channelId ?? SORA_CHANNEL_ID,
          duration: 180,
          songNames: [row.songName],
          relationshipsLoaded: true
        })
      ])
    ),
    duplicateRemovals: []
  };
}

async function createSeedDirectory(
  version: string,
  options: { includeRejectedStudyCompilation?: boolean } = {}
): Promise<string> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "holoshelf-seed-"));
  const seedDirectory = path.join(root, "seed");
  const seedDatabasePath = path.join(seedDirectory, "holoshelf-template.sqlite");
  const seedImageDirectory = path.join(seedDirectory, "images", "hololive");
  const seedArtifactDirectory = path.join(seedDirectory, "holodex-refresh", "latest");
  fs.mkdirSync(seedImageDirectory, { recursive: true });
  fs.mkdirSync(seedArtifactDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(seedDirectory, "official-data.json"),
    `${JSON.stringify({ schema: 1, version, generatedAt: "2026-06-30T00:00:00.000Z" }, null, 2)}\n`
  );
  fs.writeFileSync(path.join(seedImageDirectory, "tokino-sora-icon-v6.webp"), "seed image");
  fs.writeFileSync(path.join(seedImageDirectory, "moona-hoshinova-card-v2.png"), "seed card image");
  fs.writeFileSync(path.join(seedArtifactDirectory, "summary.json"), "{}\n");

  const seedDatabase = new DatabaseService(seedDatabasePath, path.join(root, "seed-backups"));
  await seedDatabase.init();
  seedDatabase.importHolodexMusicArtifacts(
    createBundle([
      {
        youtubeVideoId: "official-kept",
        title: "Updated Official Title",
        songName: "Updated Official Song",
        publishedAt: "2026-02-01T00:00:00.000Z"
      },
      {
        youtubeVideoId: "official-added",
        title: "Added Official Title",
        songName: "Added Official Song",
        topicId: "Music_Cover",
        publishedAt: "2026-02-02T00:00:00.000Z"
      }
    ])
  );
  seedDatabase.upsertHololiveMusicVideoStats([
    { youtubeVideoId: "official-kept", viewCount: 12345, fetchedAt: "2026-06-30T00:00:00.000Z" },
    { youtubeVideoId: "official-added", viewCount: 67890, fetchedAt: "2026-06-30T00:00:00.000Z" }
  ]);
  seedDatabase.upsertHololiveImageCache({
    idolId: "tokino-sora",
    kind: "icon",
    sourceUrl: "https://example.com/sora.png",
    localFilename: "tokino-sora-icon-v6.webp",
    mimeType: "image/webp",
    sizeBytes: 10
  });
  seedDatabase.upsertHololiveImageCache({
    idolId: "moona-hoshinova",
    kind: "card",
    sourceUrl: "https://example.com/moona.png",
    localFilename: "moona-hoshinova-card-v2.png",
    mimeType: "image/png",
    sizeBytes: 20
  });
  if (options.includeRejectedStudyCompilation) {
    seedDatabase.importHolodexMusicArtifacts(
      createBundle([
        {
          youtubeVideoId: "stale-study-compilation",
          title: "Temporary Seed Song",
          songName: "Temporary Seed Song",
          topicId: "Music_Cover"
        }
      ])
    );
    seedDatabase.run(
      `UPDATE hololive_music_videos
       SET title = ?, song_name = NULL, duration_seconds = ?
       WHERE youtube_video_id = ?`,
      ["Kiara Bangers To Study To", 1035, "stale-study-compilation"]
    );
    seedDatabase.run(
      `UPDATE hololive_music_detail_cache
       SET duration_seconds = ?, song_names_json = ?
       WHERE youtube_video_id = ?`,
      [1035, "[]", "stale-study-compilation"]
    );
    seedDatabase.flush();
  }

  return seedDirectory;
}

function upsertCustomTalent(database: DatabaseService): string {
  const preview: HololiveCustomTalentPreview = {
    channelId: "UCofficialMergeCustom",
    displayName: "Local Merge Talent",
    nativeName: null,
    slug: "local-merge-talent",
    branch: "Custom",
    generation: "Local",
    officialUrl: "https://www.youtube.com/channel/UCofficialMergeCustom",
    iconUrl: "",
    profileImageUrl: "",
    youtubeChannelUrl: "https://www.youtube.com/channel/UCofficialMergeCustom",
    xHandle: null,
    xUrl: null,
    subscriberCount: null,
    videoCount: null,
    clipCount: null,
    originalSongsUrl: null,
    coversUrl: null
  };
  return database.upsertHololiveCustomTalent(preview).idol.id;
}

describe("mergeBundledOfficialData", () => {
  it("reapplies current cleanup rules after importing a stale bundled seed", async () => {
    const user = await createTempDatabase("holoshelf-official-stale-cleanup-");
    const seedDirectory = await createSeedDirectory("2026-07-12", {
      includeRejectedStudyCompilation: true
    });

    await mergeBundledOfficialData({
      database: user.database,
      paths: {
        dataDirectory: user.dataDirectory,
        hololiveImageDirectory: user.hololiveImageDirectory,
        seedDirectory
      },
      isPackaged: true,
      now: () => "2026-07-12T12:00:00.000Z"
    });

    expect(user.database.listHololiveMusicRows({ youtubeVideoIds: ["stale-study-compilation"] })).toHaveLength(0);
    expect(
      user.database.select(
        "SELECT youtube_video_id FROM hololive_music_videos WHERE youtube_video_id = 'stale-study-compilation'"
      )
    ).toHaveLength(0);
  });

  it("merges newer official data while preserving user-owned state", async () => {
    const user = await createTempDatabase("holoshelf-official-user-");
    const seedDirectory = await createSeedDirectory("2026-06-30");
    const defaultBoard = user.database.getHololiveTierListData().activeBoard;
    const savedTierId = defaultBoard.tiers[0].id;

    user.database.importHolodexMusicArtifacts(
      createBundle([
        {
          youtubeVideoId: "official-kept",
          title: "Old Official Title",
          songName: "Old Official Song"
        },
        {
          youtubeVideoId: "referenced-missing",
          title: "Referenced Missing Title",
          songName: "Referenced Missing Song"
        },
        {
          youtubeVideoId: "untouched-missing",
          title: "Untouched Missing Title",
          songName: "Untouched Missing Song"
        },
        {
          youtubeVideoId: "unresolved-missing",
          title: "Unresolved Missing Title",
          songName: "Unresolved Missing Song"
        }
      ])
    );
    user.database.run("UPDATE hololive_music_videos SET idol_id = NULL WHERE youtube_video_id = 'unresolved-missing'");
    user.database.setSetting("sources.holodexApiKey", "secret-holodex-key");
    user.database.setSetting("sources.youtubeApiKey", "secret-youtube-key");
    user.database.moveHololiveIdol({ boardId: defaultBoard.id, idolId: "tokino-sora", tierId: savedTierId, index: 0 });
    const customTalentId = upsertCustomTalent(user.database);
    user.database.setHololiveMusicMarker({ youtubeVideoId: "referenced-missing", marker: "favorite" });
    user.database.run("UPDATE tracked_entries SET rating = 9, notes = 'keep me' WHERE item_id = 'holodex:official-kept'");
    const playlistId = user.database.createHololiveMusicPlaylist("Saved Merge Playlist").playlists.find(
      (playlist) => playlist.name === "Saved Merge Playlist"
    )?.id;
    expect(playlistId).toBeTruthy();
    user.database.addHololiveMusicPlaylistItem({ playlistId: playlistId ?? "", youtubeVideoId: "referenced-missing" });
    user.database.playHololiveMusicVisibleVideos(["referenced-missing"]);

    const result = await mergeBundledOfficialData({
      database: user.database,
      paths: {
        dataDirectory: user.dataDirectory,
        hololiveImageDirectory: user.hololiveImageDirectory,
        seedDirectory
      },
      isPackaged: true,
      now: () => "2026-06-30T12:00:00.000Z"
    });

    expect(result).toMatchObject({
      status: "merged",
      bundledVersion: "2026-06-30",
      previousVersion: null,
      musicRows: 2,
      prunedMissingRows: 2,
      preservedMissingRows: 1
    });
    expect(user.database.getSettings()).toMatchObject({
      "hololive.officialDataVersion": "2026-06-30",
      "hololive.officialDataMergedAt": "2026-06-30T12:00:00.000Z",
      "sources.holodexApiKey": "secret-holodex-key",
      "sources.youtubeApiKey": "secret-youtube-key"
    });
    expect(user.database.listHololiveMusicRows({ youtubeVideoIds: ["official-kept"] })[0]).toMatchObject({
      youtubeVideoId: "official-kept",
      title: "Updated Official Title",
      songName: "Updated Official Song",
      viewCount: 12345
    });
    expect(user.database.listHololiveMusicRows({ youtubeVideoIds: ["official-added"] })).toHaveLength(1);
    expect(user.database.listHololiveMusicRows({ youtubeVideoIds: ["referenced-missing"] })).toHaveLength(0);
    expect(
      user.database.select<{ official_catalog_active: number }>(
        "SELECT official_catalog_active FROM hololive_music_videos WHERE youtube_video_id = 'referenced-missing'"
      )
    ).toEqual([{ official_catalog_active: 0 }]);
    expect(
      user.database.select<{ marker: string }>(
        "SELECT marker FROM hololive_music_marker_keys WHERE marker_key = 'video:referenced-missing'"
      )
    ).toEqual([{ marker: "favorite" }]);
    expect(user.database.listHololiveMusicLibrary({ query: "Referenced Missing" }).rows).toHaveLength(0);
    expect(user.database.listHololiveMusicRows({ youtubeVideoIds: ["untouched-missing"] })).toHaveLength(0);
    expect(user.database.listHololiveMusicRows({ youtubeVideoIds: ["unresolved-missing"] })).toHaveLength(0);
    expect(
      user.database.select<{ rating: number; notes: string }>(
        "SELECT rating, notes FROM tracked_entries WHERE item_id = 'holodex:official-kept'"
      )[0]
    ).toEqual({ rating: 9, notes: "keep me" });
    expect(user.database.getHololiveTierListData(defaultBoard.id).activeBoard.placements.find(
      (placement) => placement.idolId === "tokino-sora"
    )?.tierId).toBe(savedTierId);
    expect(user.database.listHololiveIdols().find((idol) => idol.id === customTalentId)?.source).toBe("custom");
    expect(
      user.database
        .getHololiveMusicPlayerData()
        .playlists.find((playlist) => playlist.id === playlistId)
        ?.items?.map((item) => ({ youtubeVideoId: item.youtubeVideoId, available: item.available, music: item.music }))
    ).toEqual([{ youtubeVideoId: "referenced-missing", available: false, music: null }]);
    expect(
      user.database.getHololiveMusicPlayerData().queue.map((item) => ({ youtubeVideoId: item.youtubeVideoId, available: item.available, music: item.music }))
    ).toEqual([{ youtubeVideoId: "referenced-missing", available: false, music: null }]);
    expect(user.database.getHololiveMusicPlayerData().state).toMatchObject({
      playbackSourceType: "library",
      currentQueueItemId: null,
      currentYoutubeVideoId: null
    });
    expect(fs.existsSync(path.join(user.hololiveImageDirectory, "tokino-sora-icon-v6.webp"))).toBe(true);
    expect(fs.existsSync(path.join(user.dataDirectory, "holodex-refresh", "latest", "summary.json"))).toBe(true);

    const restoredSeedDirectory = await createSeedDirectory("2026-07-01");
    const restoredSeedDatabase = new DatabaseService(
      path.join(restoredSeedDirectory, "holoshelf-template.sqlite"),
      path.join(path.dirname(restoredSeedDirectory), "restored-seed-backups")
    );
    await restoredSeedDatabase.init();
    restoredSeedDatabase.importHolodexMusicArtifacts(
      createBundle([
        {
          youtubeVideoId: "referenced-missing",
          title: "Restored Official Title",
          songName: "Restored Official Song"
        }
      ])
    );
    restoredSeedDatabase.flush();

    await mergeBundledOfficialData({
      database: user.database,
      paths: {
        dataDirectory: user.dataDirectory,
        hololiveImageDirectory: user.hololiveImageDirectory,
        seedDirectory: restoredSeedDirectory
      },
      isPackaged: true,
      now: () => "2026-07-01T12:00:00.000Z"
    });

    expect(user.database.listHololiveMusicRows({ youtubeVideoIds: ["referenced-missing"] })[0]).toMatchObject({
      youtubeVideoId: "referenced-missing",
      title: "Restored Official Title",
      marker: "favorite"
    });
    expect(
      user.database
        .getHololiveMusicPlayerData()
        .playlists.find((playlist) => playlist.id === playlistId)
        ?.items?.map((item) => ({ youtubeVideoId: item.youtubeVideoId, available: item.available }))
    ).toEqual([{ youtubeVideoId: "referenced-missing", available: true }]);
  });

  it("repairs missing bundled image files even when official data is already current", async () => {
    const user = await createTempDatabase("holoshelf-official-current-images-");
    const seedDirectory = await createSeedDirectory("2026-06-30");
    user.database.setSetting("hololive.officialDataVersion", "2026-06-30");
    user.database.upsertHololiveImageCache({
      idolId: "tokino-sora",
      kind: "icon",
      sourceUrl: "https://example.com/old-sora.png",
      localFilename: "tokino-sora-icon-v5.webp",
      mimeType: "image/webp",
      sizeBytes: 5
    });
    user.database.upsertHololiveImageCache({
      idolId: "moona-hoshinova",
      kind: "card",
      sourceUrl: "https://example.com/old-moona.webp",
      localFilename: "moona-hoshinova-card-v1.webp",
      mimeType: "image/webp",
      sizeBytes: 6
    });

    const imagePath = path.join(user.hololiveImageDirectory, "tokino-sora-icon-v6.webp");
    const cardImagePath = path.join(user.hololiveImageDirectory, "moona-hoshinova-card-v2.png");
    expect(fs.existsSync(imagePath)).toBe(false);
    expect(fs.existsSync(cardImagePath)).toBe(false);

    const result = await mergeBundledOfficialData({
      database: user.database,
      paths: {
        dataDirectory: user.dataDirectory,
        hololiveImageDirectory: user.hololiveImageDirectory,
        seedDirectory
      },
      isPackaged: true,
      now: () => "2026-06-30T12:00:00.000Z"
    });

    expect(result).toMatchObject({
      status: "skipped",
      reason: "current-version",
      copiedImageFiles: 2,
      imageCacheRows: 2
    });
    expect(fs.existsSync(imagePath)).toBe(true);
    expect(fs.existsSync(cardImagePath)).toBe(true);
    expect(
      user.database.select<{ local_filename: string; source_url: string }>(
        "SELECT local_filename, source_url FROM hololive_image_cache WHERE idol_id = 'tokino-sora' AND kind = 'icon'"
      )[0]
    ).toEqual({
      local_filename: "tokino-sora-icon-v6.webp",
      source_url: "https://example.com/sora.png"
    });
    expect(
      user.database.select<{ local_filename: string; source_url: string }>(
        "SELECT local_filename, source_url FROM hololive_image_cache WHERE idol_id = 'moona-hoshinova' AND kind = 'card'"
      )[0]
    ).toEqual({
      local_filename: "moona-hoshinova-card-v2.png",
      source_url: "https://example.com/moona.png"
    });
  });

  it("keeps custom talents and their imported songs during official data merges", async () => {
    const user = await createTempDatabase("holoshelf-official-custom-");
    const seedDirectory = await createSeedDirectory("2026-06-30");
    const customTalentId = upsertCustomTalent(user.database);

    user.database.importHolodexMusicArtifacts(
      createBundle([
        {
          youtubeVideoId: "custom-local-song",
          title: "Local Custom Talent Song",
          songName: "Local Custom Song",
          channelId: "UCofficialMergeCustom",
          channelName: "Local Merge Talent"
        }
      ])
    );
    user.database.setHololiveMusicMarker({ youtubeVideoId: "custom-local-song", marker: "like" });
    const playlistId = user.database.createHololiveMusicPlaylist("Custom Songs").playlists.find(
      (playlist) => playlist.name === "Custom Songs"
    )?.id;
    expect(playlistId).toBeTruthy();
    user.database.addHololiveMusicPlaylistItem({ playlistId: playlistId ?? "", youtubeVideoId: "custom-local-song" });

    await mergeBundledOfficialData({
      database: user.database,
      paths: {
        dataDirectory: user.dataDirectory,
        hololiveImageDirectory: user.hololiveImageDirectory,
        seedDirectory
      },
      isPackaged: true,
      now: () => "2026-06-30T12:00:00.000Z"
    });

    expect(user.database.listHololiveIdols().find((idol) => idol.id === customTalentId)).toMatchObject({
      id: customTalentId,
      source: "custom"
    });
    expect(user.database.listHololiveMusicRows({ youtubeVideoIds: ["custom-local-song"] })[0]).toMatchObject({
      youtubeVideoId: "custom-local-song",
      idolId: customTalentId,
      title: "Local Custom Talent Song",
      songName: "Local Custom Song",
      marker: "like"
    });
    expect(
      user.database
        .getHololiveMusicPlayerData()
        .playlists.find((playlist) => playlist.id === playlistId)
        ?.items?.map((item) => item.youtubeVideoId)
    ).toEqual(["custom-local-song"]);
  });

  it("does not overwrite user-imported songs assigned to official talents", async () => {
    const user = await createTempDatabase("holoshelf-official-custom-song-");
    const seedDirectory = await createSeedDirectory("2026-06-30");
    const seedDatabase = new DatabaseService(
      path.join(seedDirectory, "holoshelf-template.sqlite"),
      path.join(path.dirname(seedDirectory), "seed-custom-song-backups")
    );
    await seedDatabase.init();
    seedDatabase.importHolodexMusicArtifacts(
      createBundle([
        {
          youtubeVideoId: "abcDEF12345",
          title: "Bundled Official Version",
          songName: "Bundled Official Song",
          publishedAt: "2026-02-03T00:00:00.000Z"
        }
      ])
    );
    seedDatabase.upsertHololiveMusicVideoStats([
      { youtubeVideoId: "abcDEF12345", viewCount: 999999, fetchedAt: "2026-06-30T00:00:00.000Z" }
    ]);
    seedDatabase.flush();

    user.database.upsertHololiveCustomSong({
      youtubeUrl: "https://youtu.be/abcDEF12345",
      title: "My Local Official Talent Import",
      songName: "My Local Song",
      topicId: "Original_Song",
      ownerIdolIds: ["tokino-sora"],
      featuredIdolIds: [],
      channelName: "Manual Channel",
      publishedAt: "2026-07-01",
      viewCount: 777,
      fetchedAt: "2026-07-01T00:00:00.000Z"
    });
    user.database.setHololiveMusicMarker({ youtubeVideoId: "abcDEF12345", marker: "favorite" });

    await mergeBundledOfficialData({
      database: user.database,
      paths: {
        dataDirectory: user.dataDirectory,
        hololiveImageDirectory: user.hololiveImageDirectory,
        seedDirectory
      },
      isPackaged: true,
      now: () => "2026-06-30T12:00:00.000Z"
    });

    expect(user.database.listHololiveMusicRows({ youtubeVideoIds: ["abcDEF12345"] })[0]).toMatchObject({
      youtubeVideoId: "abcDEF12345",
      title: "My Local Official Talent Import",
      songName: "My Local Song",
      sourceKind: "user",
      marker: "favorite",
      viewCount: 777
    });
    expect(user.database.listHololiveMusicRows({ youtubeVideoIds: ["official-added"] })[0]).toMatchObject({
      youtubeVideoId: "official-added",
      sourceKind: "official"
    });
  });

  it.each([false, true])("preserves canonical-only favorites when merging a multi-song identity without copying a shared song marker: shared=%s", async (sharedCanonical) => {
    const user = await createTempDatabase("holoshelf-official-recording-marker-");
    const seedDirectory = await createSeedDirectory("2026-11-02T080000Z");
    const singleId = "4fJuqc_2Y_I";
    const recordingId = "cr9iLdXK9ik";
    const firstSong = "わんわん!わおーん / Bowwow Ahwoooooo";
    const secondSong = "さしみお (feat. スバおか) / Sashimio (feat. SubaOka)";
    const recordingTitle = "わんわんわおーん / さしみお feat.スバおか";
    const input = [
      { youtubeVideoId: singleId, title: "わんわん！わおーん", songName: firstSong,
        channelId: "UCp-5t9SrOQwXMU7iIjQfARg", channelName: "Mio Channel 大神ミオ" },
      { youtubeVideoId: recordingId, title: recordingTitle, songName: secondSong,
        channelId: "UCp-5t9SrOQwXMU7iIjQfARg", channelName: "Mio Channel 大神ミオ" }
    ];
    const legacy = createBundle(input);
    legacy.detailCache[singleId].duration = 193;
    legacy.detailCache[singleId].providedToYoutube = true;
    legacy.detailCache[singleId].originalChannelId = "UCHYTTba2SyK82DuoFh1FLDg";
    legacy.detailCache[recordingId].duration = 397;
    user.database.importHolodexMusicArtifacts(legacy);
    const oldKeys = user.database.select<{ youtube_video_id: string; canonical_performance_key: string }>(
      "SELECT youtube_video_id,canonical_performance_key FROM hololive_music_videos WHERE youtube_video_id IN (?,?)", [singleId, recordingId]
    );
    const singleKey = oldKeys.find(row => row.youtube_video_id === singleId)!.canonical_performance_key;
    const recordingOldKey = oldKeys.find(row => row.youtube_video_id === recordingId)!.canonical_performance_key;
    expect(singleKey).not.toBe(recordingOldKey);
    // Simulate the historical key collision caused by Holodex reversing song order.
    if (sharedCanonical) user.database.run("UPDATE hololive_music_videos SET canonical_performance_key=? WHERE youtube_video_id=?", [singleKey, recordingId]);
    const favoriteOldKey = sharedCanonical ? singleKey : recordingOldKey;
    user.database.run(
      `INSERT INTO hololive_music_marker_keys (marker_key,marker,created_at,updated_at,favorite_position)
       VALUES (?,'favorite','2026-10-30T12:00:00.000Z','2026-10-31T12:00:00.000Z',17)`, [favoriteOldKey]
    );
    const originalMarker = user.database.select("SELECT * FROM hololive_music_marker_keys");
    expect(originalMarker).toHaveLength(1);
    expect(user.database.select("SELECT * FROM hololive_music_marker_keys WHERE marker_key LIKE 'video:%'")).toEqual([]);

    const current = createBundle(input);
    current.detailCache[singleId] = legacy.detailCache[singleId];
    current.detailCache[recordingId].duration = 397;
    current.detailCache[recordingId].songNames = [firstSong, secondSong];
    const seedDatabase = new DatabaseService(path.join(seedDirectory, "holoshelf-template.sqlite"));
    await seedDatabase.init();
    seedDatabase.importHolodexMusicArtifacts(current);
    const recordingKey = `Original_Song:recording:${recordingId}`;
    expect(seedDatabase.listHololiveMusicRows({ youtubeVideoIds: [recordingId] })[0].canonicalPerformanceKey).toBe(recordingKey);

    await mergeBundledOfficialData({
      database: user.database,
      paths: { dataDirectory: user.dataDirectory, hololiveImageDirectory: user.hololiveImageDirectory, seedDirectory },
      isPackaged: true, now: () => "2026-11-02T08:00:00.000Z"
    });
    const merged = user.database.listHololiveMusicRows({ youtubeVideoIds: [singleId, recordingId], dedupeCanonicalPerformance: true });
    expect(merged).toHaveLength(2);
    expect(merged.find(row => row.youtubeVideoId === singleId)?.marker).toBe(sharedCanonical ? "favorite" : null);
    expect(merged.find(row => row.youtubeVideoId === recordingId)).toMatchObject({
      canonicalPerformanceKey: recordingKey, marker: sharedCanonical ? null : "favorite"
    });
    expect(user.database.select("SELECT * FROM hololive_music_marker_keys WHERE marker_key=?", [favoriteOldKey])).toEqual(originalMarker);
    const newMarker = user.database.select("SELECT marker,favorite_position FROM hololive_music_marker_keys WHERE marker_key=?", [recordingKey]);
    expect(newMarker).toEqual(sharedCanonical ? [] : [{ marker: "favorite", favorite_position: 17 }]);
    expect(user.database.select("SELECT * FROM hololive_music_marker_keys WHERE marker_key LIKE 'video:%'")).toEqual([]);
    const profileSongs = user.database.getHololiveIdolProfile("ookami-mio").mediaGroups.find(group => group.id === "original-songs")!.items;
    expect(profileSongs.find(row => row.id === singleId)).toBeDefined();
    expect(profileSongs.find(row => row.id === recordingId)).toMatchObject({ title: recordingTitle, marker: sharedCanonical ? null : "favorite" });
  });

  it.each([true, false])("trusts an incoming audio-to-MV mapping only when its representative is in the seed: %s", async (includeMv) => {
    const user = await createTempDatabase("holoshelf-official-audio-mirror-");
    const seedDirectory = await createSeedDirectory("2026-11-02T020000Z");
    const audioId = "irys-new-single-audio";
    const mvId = "kiara-new-single-mv";
    const audio = {
      youtubeVideoId: audioId, title: "[Audio] BORN!", songName: "BORN!",
      channelId: "UC8rcEBzJSleTkf_-agPM20g", channelName: "IRyS Ch. hololive-EN"
    };
    const mv = {
      youtubeVideoId: mvId, title: "[Official MV] BORN! / Takanashi Kiara x IRyS", songName: "BORN!",
      channelId: "UCHsx4Hqa-1ORjQTh9TYDhww", channelName: "Takanashi Kiara Ch. hololive-EN"
    };
    const seedDatabase = new DatabaseService(path.join(seedDirectory, "holoshelf-template.sqlite"));
    await seedDatabase.init();
    if (includeMv) seedDatabase.importHolodexMusicArtifacts(createBundle([mv]));
    seedDatabase.run(
      `INSERT INTO hololive_music_duplicate_removals
         (removed_youtube_video_id, removed_title, kept_youtube_video_id, kept_title, reason, song_name,
          removed_published_at, kept_published_at, source_run_id, updated_at)
       VALUES (?, ?, ?, ?, 'official_audio_duplicate_of_mv', 'BORN!', ?, ?, NULL, ?)`,
      [audioId, audio.title, mvId, mv.title, "2026-10-28T00:00:00.000Z", "2026-10-29T00:00:00.000Z", "2026-11-02T02:00:00.000Z"]
    );
    seedDatabase.flush();

    // The missing-seed case deliberately has an old local MV: its existence is not fresh catalog proof.
    user.database.importHolodexMusicArtifacts(createBundle(includeMv ? [audio] : [audio, mv]));
    user.database.setHololiveMusicMarker({ youtubeVideoId: audioId, marker: "favorite" });
    user.database.run("UPDATE hololive_music_marker_keys SET favorite_position=6 WHERE marker='favorite'");
    user.database.run("UPDATE tracked_entries SET rating=9, notes='My original audio note' WHERE item_id=?", [`holodex:${audioId}`]);
    const playlist = user.database.createHololiveMusicPlaylist("Audio Mirror Transfer").playlists.find((item) => item.name === "Audio Mirror Transfer")!;
    user.database.addHololiveMusicPlaylistItem({ playlistId: playlist.id, youtubeVideoId: audioId });
    user.database.addHololiveMusicQueueItem({ youtubeVideoId: audioId, placement: "now" });
    expect(user.database.select("SELECT notes FROM tracked_entries WHERE item_id=?", [`holodex:${audioId}`])[0].notes).toBe("My original audio note");

    await mergeBundledOfficialData({
      database: user.database,
      paths: { dataDirectory: user.dataDirectory, hololiveImageDirectory: user.hololiveImageDirectory, seedDirectory },
      isPackaged: true, now: () => "2026-11-02T02:00:00.000Z"
    });

    const expectedId = includeMv ? mvId : audioId;
    expect(user.database.select("SELECT youtube_video_id FROM hololive_music_playlist_items WHERE playlist_id=?", [playlist.id]))
      .toEqual([{ youtube_video_id: expectedId }]);
    expect(user.database.select("SELECT youtube_video_id FROM hololive_music_queue_items")).toEqual([{ youtube_video_id: expectedId }]);
    expect(user.database.select("SELECT current_youtube_video_id FROM hololive_music_player_state")[0].current_youtube_video_id).toBe(expectedId);
    expect(user.database.select("SELECT marker,favorite_position FROM hololive_music_marker_keys WHERE marker_key=?", [`video:${expectedId}`])[0])
      .toMatchObject({ marker: "favorite", favorite_position: 6 });
    expect(user.database.select("SELECT rating,notes FROM tracked_entries WHERE item_id=?", [`holodex:${expectedId}`])[0])
      .toMatchObject({ rating: 9, notes: "My original audio note" });
    if (includeMv) {
      expect(user.database.listHololiveMusicRows({ youtubeVideoIds: [audioId, mvId] }).map((row) => row.youtubeVideoId)).toEqual([mvId]);
    }
    expect(user.database.select("SELECT youtube_video_id FROM hololive_music_exclusions WHERE youtube_video_id=?", [audioId])).toEqual([]);
  });

  it("keeps an explicitly excluded audio version excluded without excluding its newly bundled official MV", async () => {
    const user = await createTempDatabase("holoshelf-official-excluded-audio-");
    const seedDirectory = await createSeedDirectory("2026-11-02T030000Z");
    const audioId = "irys-excluded-audio";
    const mvId = "kiara-incoming-mv";
    const audio = {
      youtubeVideoId: audioId, title: "[Audio] BORN!", songName: "BORN!",
      channelId: "UC8rcEBzJSleTkf_-agPM20g", channelName: "IRyS Ch. hololive-EN"
    };
    const mv = {
      youtubeVideoId: mvId, title: "[Official MV] BORN! / Takanashi Kiara x IRyS", songName: "BORN!",
      channelId: "UCHsx4Hqa-1ORjQTh9TYDhww", channelName: "Takanashi Kiara Ch. hololive-EN"
    };
    user.database.importHolodexMusicArtifacts(createBundle([audio]));
    user.database.excludeHololiveMusicVideo({ youtubeVideoId: audioId });
    for (let index = 0; index < 23; index += 1) {
      user.database.run(
        `INSERT INTO hololive_music_exclusions (youtube_video_id,title_snapshot,source_url_snapshot,created_at)
         VALUES (?, ?, ?, '2026-10-31T12:00:00.000Z')`,
        [`other-explicit-exclusion-${index}`, `Previously excluded song ${index}`, `https://youtu.be/other-explicit-exclusion-${index}`]
      );
    }
    const before = user.database.select("SELECT * FROM hololive_music_exclusions ORDER BY youtube_video_id");
    expect(before).toHaveLength(24);

    const seedDatabase = new DatabaseService(path.join(seedDirectory, "holoshelf-template.sqlite"));
    await seedDatabase.init();
    seedDatabase.importHolodexMusicArtifacts(createBundle([mv]));
    seedDatabase.run(
      `INSERT INTO hololive_music_duplicate_removals
         (removed_youtube_video_id,removed_title,kept_youtube_video_id,kept_title,reason,song_name,
          removed_published_at,kept_published_at,source_run_id,updated_at)
       VALUES (?, ?, ?, ?, 'official_audio_duplicate_of_mv', 'BORN!', ?, ?, NULL, ?)`,
      [audioId, audio.title, mvId, mv.title, "2026-10-28T00:00:00.000Z", "2026-10-29T00:00:00.000Z", "2026-11-02T03:00:00.000Z"]
    );
    seedDatabase.flush();

    await mergeBundledOfficialData({
      database: user.database,
      paths: { dataDirectory: user.dataDirectory, hololiveImageDirectory: user.hololiveImageDirectory, seedDirectory },
      isPackaged: true, now: () => "2026-11-02T03:00:00.000Z"
    });

    expect(user.database.select("SELECT * FROM hololive_music_exclusions ORDER BY youtube_video_id")).toEqual(before);
    expect(user.database.listHololiveMusicRows({ youtubeVideoIds: [audioId, mvId] }).map((row) => row.youtubeVideoId)).toEqual([mvId]);
    expect(user.database.select("SELECT youtube_video_id FROM hololive_music_exclusions WHERE youtube_video_id=?", [mvId])).toEqual([]);
  });

  it("applies bundled duplicate removals after official data rows are merged", async () => {
    const user = await createTempDatabase("holoshelf-official-duplicates-");
    const seedDirectory = await createSeedDirectory("2026-07-01");
    const moriChannelId = "UCL_qhgtOy0dy1Agp8vkySQg";
    const staleRows = createBundle([
      {
        youtubeVideoId: "kamouflage-official",
        title: "Kamouflage",
        songName: "Kamouflage",
        channelId: moriChannelId,
        channelName: "Mori Calliope Ch. hololive-EN",
        publishedAt: "2022-07-27T09:00:13.000Z"
      },
      {
        youtubeVideoId: "kamouflage-3d-live",
        title: "Kamouflage [3D Live]",
        songName: "Kamouflage [3D Live]",
        channelId: moriChannelId,
        channelName: "Mori Calliope Ch. hololive-EN",
        publishedAt: "2023-04-12T08:00:10.000Z"
      }
    ]);

    const seedDatabase = new DatabaseService(
      path.join(seedDirectory, "holoshelf-template.sqlite"),
      path.join(path.dirname(seedDirectory), "seed-duplicate-backups")
    );
    await seedDatabase.init();
    seedDatabase.importHolodexMusicArtifacts(staleRows);
    seedDatabase.run(
      `INSERT INTO hololive_music_duplicate_removals
         (removed_youtube_video_id, removed_title, kept_youtube_video_id, kept_title, reason, song_name,
          removed_published_at, kept_published_at, source_run_id, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
      [
        "kamouflage-3d-live",
        "Kamouflage [3D Live]",
        "kamouflage-official",
        "Kamouflage",
        "canonical_variant_duplicate_of_full",
        "Kamouflage",
        "2023-04-12T08:00:10.000Z",
        "2022-07-27T09:00:13.000Z",
        "2026-07-01T00:00:00.000Z"
      ]
    );
    seedDatabase.run("DELETE FROM hololive_music_videos WHERE youtube_video_id = 'kamouflage-3d-live'");
    seedDatabase.flush();

    user.database.importHolodexMusicArtifacts(staleRows);
    user.database.setHololiveMusicMarker({ youtubeVideoId: "kamouflage-3d-live", marker: "favorite" });
    const playlistId = user.database.createHololiveMusicPlaylist("Duplicate Repair").playlists.find(
      (playlist) => playlist.name === "Duplicate Repair"
    )?.id;
    expect(playlistId).toBeTruthy();
    user.database.addHololiveMusicPlaylistItem({ playlistId: playlistId ?? "", youtubeVideoId: "kamouflage-3d-live" });
    user.database.run("PRAGMA foreign_keys = ON");

    await mergeBundledOfficialData({
      database: user.database,
      paths: {
        dataDirectory: user.dataDirectory,
        hololiveImageDirectory: user.hololiveImageDirectory,
        seedDirectory
      },
      isPackaged: true,
      now: () => "2026-07-01T12:00:00.000Z"
    });

    const rows = user.database.listHololiveMusicRows({ query: "Kamouflage", limit: 10 });
    expect(rows.map((row) => row.youtubeVideoId)).toEqual(["kamouflage-official"]);
    expect(rows[0]).toMatchObject({
      marker: "favorite",
      canonicalSongKey: "kamouflage"
    });
    expect(
      user.database
        .getHololiveMusicPlayerData()
        .playlists.find((playlist) => playlist.id === playlistId)
        ?.items?.map((item) => item.youtubeVideoId)
    ).toEqual(["kamouflage-official"]);
    expect(
      user.database.select<{
        removed_youtube_video_id: string;
        kept_youtube_video_id: string;
        source_run_id: string | null;
      }>(
        `SELECT removed_youtube_video_id, kept_youtube_video_id, source_run_id
         FROM hololive_music_duplicate_removals
         WHERE removed_youtube_video_id = 'kamouflage-3d-live'`
      )
    ).toEqual([
      {
        removed_youtube_video_id: "kamouflage-3d-live",
        kept_youtube_video_id: "kamouflage-official",
        source_run_id: null
      }
    ]);
  });

  it("skips packaged merge when the user database already has the bundled official data version", async () => {
    const user = await createTempDatabase("holoshelf-official-current-");
    const seedDirectory = await createSeedDirectory("2026-06-30");

    user.database.setSetting("hololive.officialDataVersion", "2026-06-30");

    const result = await mergeBundledOfficialData({
      database: user.database,
      paths: {
        dataDirectory: user.dataDirectory,
        hololiveImageDirectory: user.hololiveImageDirectory,
        seedDirectory
      },
      isPackaged: true
    });

    expect(result).toMatchObject({
      status: "skipped",
      reason: "current-version",
      bundledVersion: "2026-06-30",
      previousVersion: "2026-06-30"
    });
    expect(user.database.listHololiveMusicRows({ youtubeVideoIds: ["official-added"] })).toHaveLength(0);
  });

  it("leaves unpackaged development databases alone", async () => {
    const user = await createTempDatabase("holoshelf-official-dev-");
    const seedDirectory = await createSeedDirectory("2026-06-30");

    const result = await mergeBundledOfficialData({
      database: user.database,
      paths: {
        dataDirectory: user.dataDirectory,
        hololiveImageDirectory: user.hololiveImageDirectory,
        seedDirectory
      },
      isPackaged: false
    });

    expect(result).toMatchObject({
      status: "skipped",
      reason: "unpackaged"
    });
    expect(user.database.getSettings()["hololive.officialDataVersion"]).toBeUndefined();
    expect(user.database.listHololiveMusicRows({ youtubeVideoIds: ["official-added"] })).toHaveLength(0);
  });
});
