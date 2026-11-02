import {afterEach, describe, expect, it} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {materializeCatalogDuplicateResets} from "./catalog-duplicate-resets.mjs";
import {DatabaseService} from "../electron/services/database.ts";
import {mergeBundledOfficialData} from "../electron/services/officialDataMergeService.ts";
import {auditOfficialMusicStats} from "../electron/services/musicStatsAudit.ts";
import {normalizeVideoDetail} from "../src/modules/hololive/music/cleanup.ts";

const SUNSHINE = "6j9RL3LM0pE";
const ORDINARY = "KS4brKpD5qE";
// The protocol is independent of performer ownership; use a pre-seeded talent
// channel so this fixture does not depend on a preceding network channel refresh.
const CHANNEL = "UCp6993wxpyDPHUpavwDFqgg";
const checkedAt = "2026-11-02T10:00:00.000Z";
const directories = [];
afterEach(() => {
  for (const directory of directories.splice(0)) {
    if (!path.resolve(directory).startsWith(`${path.resolve(os.tmpdir())}${path.sep}`)) throw new Error("Unsafe test cleanup path");
    fs.rmSync(directory, {recursive: true, force: true});
  }
});
async function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "holoshelf-catalog-resets-")); directories.push(directory);
  const db = new DatabaseService(path.join(directory, "holoshelf-template.sqlite"), undefined, {createBackups: false});
  await db.init();
  const songs = [
    {id: SUNSHINE, title: "Candy-Go-Round（Sunshine ver.）", duration: 429},
    {id: ORDINARY, title: "Candy-Go-Round", duration: 243}
  ];
  db.importHolodexMusicArtifacts({
    rows: songs.map(song => ({youtubeVideoId: song.id, youtubeUrl: `https://youtu.be/${song.id}`, title: song.title,
      status: "past", topicId: "Original_Song", channelId: CHANNEL, channelName: "SoraCh.", publishedAt: "2021-08-20T10:00:00.000Z"})),
    detailCache: Object.fromEntries(songs.map(song => [song.id, normalizeVideoDetail(song.id, {
      channelId: CHANNEL, duration: song.duration, songNames: [song.title], providedToYoutube: true, originalChannelId: "group-topic", relationshipsLoaded: true
    })])), duplicateRemovals: []
  });
  db.upsertHololiveMusicVideoStats(songs.map(song => ({youtubeVideoId: song.id, viewCount: 1234, fetchedAt: checkedAt})));
  return {db, directory};
}
function proof(db) {
  const coverage = auditOfficialMusicStats(db, checkedAt);
  return {checkedAt, statsCoverage: coverage,
    videoStatsRefresh: {fetchedAt: checkedAt, failedBatches: 0, requestedVideos: coverage.catalogVideos, updatedVideos: coverage.catalogVideos, unavailableVideos: 0},
    holodexCoverage: {complete: true, topics: {
      Original_Song: {complete: true, total: 2, fetched: 2}, Music_Cover: {complete: true, total: 0, fetched: 0}
    }}
  };
}
function staleReport(db) {
  db.run(`INSERT OR REPLACE INTO hololive_music_duplicate_removals
    (removed_youtube_video_id,removed_title,kept_youtube_video_id,kept_title,reason,song_name,source_run_id,updated_at)
    VALUES (?, 'Sunshine version', ?, 'Ordinary recording', 'topic_duplicate_without_non_topic', 'Candy-Go-Round', NULL, ?)`, [SUNSHINE, ORDINARY, checkedAt]);
}
function protectedSnapshot(db) {
  return Object.fromEntries(["hololive_music_marker_keys", "hololive_music_playlist_items", "hololive_music_queue_items", "hololive_music_exclusions", "tracked_entries"]
    .map(table => [table, db.select(`SELECT * FROM ${table} ORDER BY rowid`)]));
}

describe("verified catalog entry reset reports", () => {
  it("writes authoritative null targets only for verified official rows and changes no protected tables", async () => {
    const {db} = await fixture();
    staleReport(db);
    db.run("UPDATE hololive_music_videos SET source_kind='user' WHERE youtube_video_id = ?", [ORDINARY]);
    const before = protectedSnapshot(db);
    expect(materializeCatalogDuplicateResets(db, proof(db))).toEqual({resetRows: 1, checkedAt});
    expect(db.select("SELECT removed_youtube_video_id,kept_youtube_video_id,reason,source_run_id FROM hololive_music_duplicate_removals")).toEqual([
      {removed_youtube_video_id: SUNSHINE, kept_youtube_video_id: null, reason: "catalog_entry_verified", source_run_id: null}
    ]);
    expect(protectedSnapshot(db)).toEqual(before);
  });

  it.each(["invalid-time", "failed-batch", "incomplete-topic", "wrong-count", "stale-db-stats"])("refuses %s proof without touching removal reports", async failure => {
    const {db} = await fixture(); staleReport(db);
    const evidence = proof(db);
    if (failure === "invalid-time") evidence.checkedAt = "invalid";
    if (failure === "failed-batch") evidence.videoStatsRefresh.failedBatches = 1;
    if (failure === "incomplete-topic") evidence.holodexCoverage.topics.Original_Song.fetched = 1;
    if (failure === "wrong-count") evidence.statsCoverage.catalogVideos = 1;
    if (failure === "stale-db-stats") db.run("UPDATE hololive_music_video_stats SET fetched_at='2026-11-01T10:00:00.000Z' WHERE youtube_video_id = ?", [SUNSHINE]);
    const before = db.select("SELECT * FROM hololive_music_duplicate_removals");
    expect(() => materializeCatalogDuplicateResets(db, evidence)).toThrow(/Catalog duplicate resets require/);
    expect(db.select("SELECT * FROM hololive_music_duplicate_removals")).toEqual(before);
  });

  it("repairs stale Sunshine reports through the unchanged 1.1.94 merge while preserving both recordings and personal state", async () => {
    const source = await fixture();
    source.db.setSetting("hololive.officialDataVersion", "2026-11-02T100000Z");
    fs.writeFileSync(path.join(source.directory, "official-data.json"), JSON.stringify({schema: 1, version: "2026-11-02T100000Z"}));
    const merge = target => mergeBundledOfficialData({database: target.db, isPackaged: true,
      paths: {dataDirectory: target.directory, hololiveImageDirectory: path.join(target.directory, "images"), seedDirectory: source.directory}});
    const control = await fixture(); staleReport(control.db);
    await merge(control);
    expect(control.db.select("SELECT youtube_video_id FROM hololive_music_videos WHERE youtube_video_id = ?", [SUNSHINE])).toEqual([]);

    materializeCatalogDuplicateResets(source.db, proof(source.db)); source.db.flush();
    const target = await fixture();
    target.db.setHololiveMusicMarker({youtubeVideoId: SUNSHINE, marker: "favorite"});
    const playlist = target.db.createHololiveMusicPlaylist("Saved Sunshine").playlists.find(item => !item.systemId);
    target.db.addHololiveMusicPlaylistItem({playlistId: playlist.id, youtubeVideoId: SUNSHINE});
    target.db.addHololiveMusicQueueItem({youtubeVideoId: SUNSHINE, placement: "now"});
    target.db.run("UPDATE tracked_entries SET rating=9, notes='My Sunshine version notes' WHERE item_id=(SELECT item_id FROM hololive_music_videos WHERE youtube_video_id=?)", [SUNSHINE]);
    target.db.run(`INSERT INTO hololive_music_exclusions (youtube_video_id,title_snapshot,source_url_snapshot,created_at)
      VALUES ('manual-ban','Intentionally removed','https://youtu.be/manual-ban',?)`, [checkedAt]);
    staleReport(target.db);
    const before = protectedSnapshot(target.db);
    expect((await merge(target)).status).toBe("merged");
    expect(target.db.select("SELECT youtube_video_id,duration_seconds FROM hololive_music_videos ORDER BY youtube_video_id")).toEqual([
      {youtube_video_id: SUNSHINE, duration_seconds: 429}, {youtube_video_id: ORDINARY, duration_seconds: 243}
    ].sort((a,b) => a.youtube_video_id.localeCompare(b.youtube_video_id)));
    expect(protectedSnapshot(target.db)).toEqual(before);
    expect(target.db.select("SELECT kept_youtube_video_id,reason FROM hololive_music_duplicate_removals WHERE removed_youtube_video_id=?", [SUNSHINE])).toEqual([
      {kept_youtube_video_id: null, reason: "catalog_entry_verified"}
    ]);
  });
});
