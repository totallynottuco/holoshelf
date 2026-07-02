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

async function createSeedDirectory(version: string): Promise<string> {
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
        }
      ])
    );
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
    user.database.addHololiveMusicQueueItem({ youtubeVideoId: "referenced-missing", placement: "end" });

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
      prunedMissingRows: 1,
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
    expect(user.database.listHololiveMusicRows({ youtubeVideoIds: ["referenced-missing"] })[0]).toMatchObject({
      youtubeVideoId: "referenced-missing",
      marker: "favorite"
    });
    expect(user.database.listHololiveMusicRows({ youtubeVideoIds: ["untouched-missing"] })).toHaveLength(0);
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
        ?.items?.map((item) => item.youtubeVideoId)
    ).toEqual(["referenced-missing"]);
    expect(user.database.getHololiveMusicPlayerData().queue.map((item) => item.youtubeVideoId)).toEqual([
      "referenced-missing"
    ]);
    expect(fs.existsSync(path.join(user.hololiveImageDirectory, "tokino-sora-icon-v6.webp"))).toBe(true);
    expect(fs.existsSync(path.join(user.dataDirectory, "holodex-refresh", "latest", "summary.json"))).toBe(true);
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
