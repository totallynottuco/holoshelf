import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseService } from "./database";
import { normalizeVideoDetail } from "../../src/modules/hololive/music/cleanup";

const directories: string[] = [];
const sourceId = "deferred001";
const alternateId = "alternate01";
const sourceChannelId = "UCp6993wxpyDPHUpavwDFqgg";

afterEach(() => {
  for (const directory of directories.splice(0)) {
    if (!path.resolve(directory).startsWith(`${path.resolve(os.tmpdir())}${path.sep}`)) {
      throw new Error("Unsafe availability test cleanup path");
    }
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

async function createDatabase(): Promise<{ database: DatabaseService; databasePath: string }> {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "holoshelf-availability-"));
  directories.push(directory);
  const databasePath = path.join(directory, "holoshelf.sqlite");
  const database = new DatabaseService(databasePath, undefined, { createBackups: false });
  await database.init();
  return { database, databasePath };
}

function addSong(database: DatabaseService, youtubeVideoId = sourceId, title = "Availability Source"): void {
  database.upsertHololiveCustomSong({
    youtubeUrl: `https://youtu.be/${youtubeVideoId}`,
    title,
    songName: "Availability Song",
    topicId: "Original_Song",
    ownerIdolIds: ["tokino-sora"],
    channelId: sourceChannelId,
    channelName: "SoraCh. ときのそらチャンネル",
    publishedAt: "2026-10-27",
    durationSeconds: 180,
    viewCount: 1234
  });
}

function addPersonalReferences(database: DatabaseService): string {
  database.setHololiveMusicMarker({ youtubeVideoId: sourceId, marker: "favorite" });
  database.run("UPDATE hololive_music_marker_keys SET favorite_position = 13 WHERE marker = 'favorite'");
  const playlist = database.createHololiveMusicPlaylist("Preserved playlist").playlists.find((entry) => !entry.systemId)!;
  database.addHololiveMusicPlaylistItem({ playlistId: playlist.id, youtubeVideoId: sourceId });
  database.addHololiveMusicQueueItem({ youtubeVideoId: sourceId, placement: "now" });
  return playlist.id;
}

function personalRecords(database: DatabaseService): unknown {
  return {
    markers: database.select("SELECT * FROM hololive_music_marker_keys ORDER BY marker_key"),
    playlists: database.select("SELECT * FROM hololive_music_playlist_items ORDER BY id"),
    queue: database.select("SELECT * FROM hololive_music_queue_items ORDER BY id"),
    stats: database.select("SELECT * FROM hololive_music_video_stats ORDER BY youtube_video_id"),
    tracked: database.select("SELECT * FROM tracked_entries ORDER BY id")
  };
}

describe("retryable music availability persistence", () => {
  it("hides an unavailable song while retaining its rating, favorite order, lists, queue and statistics", async () => {
    const { database } = await createDatabase();addSong(database);
    const playlistId = addPersonalReferences(database);
    const before = personalRecords(database);

    expect(database.deferHololiveMusicVideo({ youtubeVideoId: sourceId, reason: "Worldwide release embargo" })).toBe(true);
    expect(database.listHololiveMusicRows({ youtubeVideoIds: [sourceId] })).toEqual([]);
    expect(database.listHololiveMusicLibrary().total).toBe(0);
    expect(database.getHololiveMusicStatus().totalRows).toBe(0);
    expect(personalRecords(database)).toEqual(before);
    expect(database.select("SELECT * FROM hololive_music_exclusions")).toEqual([]);
    const unavailable = database.getHololiveMusicPlayerData();
    expect(unavailable.queue[0]).toMatchObject({ youtubeVideoId: sourceId, available: false });
    expect(unavailable.playlists.find((playlist) => playlist.id === playlistId)?.items?.[0]).toMatchObject({ youtubeVideoId: sourceId, available: false });

    expect(database.listHololiveMusicVideoIdsForStats()).toContain(sourceId);
    expect(database.restoreHololiveMusicVideoAvailability(sourceId)).toBe(true);
    expect(database.listHololiveMusicRows({ youtubeVideoIds: [sourceId] })[0].marker).toBe("favorite");
    expect(personalRecords(database)).toEqual(before);
    expect(database.getHololiveMusicPlayerData().queue[0].available).toBe(true);
  });

  it("retains deferred availability across restart and includes it in automatic retry checks", async () => {
    const { database, databasePath } = await createDatabase();addSong(database);addPersonalReferences(database);
    database.run("UPDATE hololive_music_videos SET source_kind='official' WHERE youtube_video_id = ?", [sourceId]);
    const before = personalRecords(database);
    database.deferHololiveMusicVideo({ youtubeVideoId: sourceId });database.flush();
    const reopened = new DatabaseService(databasePath, undefined, { createBackups: false });await reopened.init();
    expect(reopened.listHololiveMusicRows({ youtubeVideoIds: [sourceId] })).toEqual([]);
    expect(reopened.listHololiveMusicVideoIdsForStats()).toContain(sourceId);
    expect(reopened.restoreHololiveMusicVideoAvailability(sourceId)).toBe(true);
    expect(reopened.listHololiveMusicRows({ youtubeVideoIds: [sourceId] })[0].marker).toBe("favorite");
    expect(personalRecords(reopened)).toEqual(before);
  });

  it("never reactivates unrelated retired rows or explicitly excluded songs", async () => {
    const { database } = await createDatabase();addSong(database);
    database.run("UPDATE hololive_music_videos SET official_catalog_active=0 WHERE youtube_video_id = ?", [sourceId]);
    expect(database.restoreHololiveMusicVideoAvailability(sourceId)).toBe(false);
    expect(database.deferHololiveMusicVideo({ youtubeVideoId: sourceId })).toBe(false);
    expect(database.listHololiveMusicVideoIdsForStats()).not.toContain(sourceId);
    database.run("UPDATE hololive_music_videos SET official_catalog_active=1 WHERE youtube_video_id = ?", [sourceId]);
    database.deferHololiveMusicVideo({ youtubeVideoId: sourceId });
    database.run("INSERT INTO hololive_music_exclusions (youtube_video_id, created_at) VALUES (?, ?)", [sourceId, new Date().toISOString()]);
    expect(database.restoreHololiveMusicVideoAvailability(sourceId)).toBe(false);
    expect(database.listHololiveMusicVideoIdsForStats()).not.toContain(sourceId);
    expect(database.listHololiveMusicRows({ youtubeVideoIds: [sourceId] })).toEqual([]);
  });

  it("keeps failed-player entries and their references for recovery when no alternate exists", async () => {
    const { database } = await createDatabase();addSong(database);addPersonalReferences(database);
    const before = personalRecords(database);
    const result = database.markHololiveMusicVideoUnavailable({ youtubeVideoId: sourceId, reason: "Error 150" });
    expect(result.replacementYoutubeVideoId).toBeNull();
    expect(result.data.queue[0]).toMatchObject({ youtubeVideoId: sourceId, available: false });
    expect(personalRecords(database)).toEqual(before);
    expect(database.select("SELECT * FROM hololive_music_exclusions")).toEqual([]);
    expect(database.restoreHololiveMusicVideoAvailability(sourceId)).toBe(true);
    expect(database.listHololiveMusicRows({ youtubeVideoIds: [sourceId] })[0].marker).toBe("favorite");
  });

  it("uses an active alternate without deleting the failed video, source markers, statistics or favorite position", async () => {
    const { database } = await createDatabase();addSong(database);addSong(database, alternateId, "Availability Alternate");
    addSong(database, "inactive001", "Unavailable Alternate");
    database.deferHololiveMusicVideo({ youtubeVideoId: "inactive001" });
    const playlistId = addPersonalReferences(database);
    const sourceMarkers = database.select("SELECT * FROM hololive_music_marker_keys WHERE marker_key = ?", [`video:${sourceId}`]);
    const result = database.markHololiveMusicVideoUnavailable({ youtubeVideoId: sourceId, reason: "Error 150" });
    expect(result.replacementYoutubeVideoId).toBe(alternateId);
    expect(result.data.queue[0].youtubeVideoId).toBe(alternateId);
    expect(result.data.playlists.find((playlist) => playlist.id === playlistId)?.items?.[0].youtubeVideoId).toBe(alternateId);
    expect(database.select("SELECT official_catalog_active FROM hololive_music_videos WHERE youtube_video_id = ?", [sourceId])).toEqual([{ official_catalog_active: 0 }]);
    expect(database.select("SELECT * FROM hololive_music_marker_keys WHERE marker_key = ?", [`video:${sourceId}`])).toEqual(sourceMarkers);
    expect(database.select("SELECT favorite_position FROM hololive_music_marker_keys WHERE marker_key = ?", [`video:${alternateId}`])).toEqual([{ favorite_position: 13 }]);
    expect(database.select("SELECT view_count FROM hololive_music_video_stats WHERE youtube_video_id = ?", [sourceId])).toEqual([{ view_count: 1234 }]);
    expect(database.select("SELECT * FROM hololive_music_exclusions")).toEqual([]);
  });

  it("does not turn a missing playback record into a permanent personal exclusion", async () => {
    const { database } = await createDatabase();
    expect(database.markHololiveMusicVideoUnavailable({ youtubeVideoId: sourceId }).replacementYoutubeVideoId).toBeNull();
    expect(database.select("SELECT * FROM hololive_music_exclusions")).toEqual([]);
    expect(database.deferHololiveMusicVideo({ youtubeVideoId: sourceId })).toBe(false);
  });

  it("preserves deferred official records through replacement refreshes and restores them without losing personal metadata", async () => {
    const { database } = await createDatabase();
    const bundle = {
      rows: [{
        youtubeVideoId: sourceId,
        youtubeUrl: `https://youtu.be/${sourceId}`,
        title: "Availability Original",
        status: "past",
        topicId: "Original_Song" as const,
        channelId: sourceChannelId,
        channelName: "SoraCh. ときのそらチャンネル",
        publishedAt: "2026-10-27T10:00:00.000Z"
      }],
      detailCache: {
        [sourceId]: normalizeVideoDetail(sourceId, {
          channelId: sourceChannelId, duration: 180, songNames: ["Availability Original"], relationshipsLoaded: true
        })
      },
      duplicateRemovals: []
    };
    database.importHolodexMusicArtifacts(bundle, "live");
    database.upsertHololiveMusicVideoStats([{ youtubeVideoId: sourceId, viewCount: 1234, fetchedAt: new Date().toISOString() }]);
    addPersonalReferences(database);
    database.run("UPDATE tracked_entries SET notes='Keep my notes', rating=5 WHERE item_id=(SELECT item_id FROM hololive_music_videos WHERE youtube_video_id=?)", [sourceId]);
    const before = personalRecords(database);
    const detailsBefore = database.select("SELECT * FROM hololive_music_detail_cache WHERE youtube_video_id=?", [sourceId]);
    const refsBefore = database.select("SELECT * FROM source_refs WHERE source_key=?", [sourceId]);
    const emptyBundle = { rows: [], detailCache: {}, duplicateRemovals: [] };

    database.importHolodexMusicArtifacts(emptyBundle, "live", {
      replaceExisting: true,
      deferredVideos: [{ youtubeVideoId: sourceId, reason: "Worldwide release embargo" }, { youtubeVideoId: "unknown0001", reason: "Not public" }]
    });
    expect(database.listHololiveMusicLibrary().total).toBe(0);
    expect(database.select("SELECT official_catalog_active FROM hololive_music_videos WHERE youtube_video_id=?", [sourceId])).toEqual([{ official_catalog_active: 0 }]);
    expect(personalRecords(database)).toEqual(before);
    expect(database.select("SELECT * FROM hololive_music_detail_cache WHERE youtube_video_id=?", [sourceId])).toEqual(detailsBefore);
    expect(database.select("SELECT * FROM source_refs WHERE source_key=?", [sourceId])).toEqual(refsBefore);
    expect(database.select("SELECT * FROM hololive_music_videos WHERE youtube_video_id='unknown0001'")).toEqual([]);
    expect(database.getSettings()["internal.musicAvailabilityDeferred.unknown0001"]).toBeUndefined();

    // A temporarily unavailable video can disappear from Holodex's next response entirely.
    database.importHolodexMusicArtifacts(emptyBundle, "live", { replaceExisting: true });
    expect(personalRecords(database)).toEqual(before);
    expect(database.listHololiveMusicVideoIdsForStats()).toContain(sourceId);

    database.importHolodexMusicArtifacts(bundle, "live", { replaceExisting: true });
    database.restoreHololiveMusicVideoAvailability(sourceId);
    expect(database.listHololiveMusicRows({ youtubeVideoIds: [sourceId] })[0].marker).toBe("favorite");
    expect(database.getSettings()[`internal.musicAvailabilityDeferred.${sourceId}`]).toBeUndefined();
    expect(personalRecords(database)).toEqual(before);
    expect(database.getHololiveMusicPlayerData().queue[0].available).toBe(true);
  });
});
