import { describe, expect, it, vi } from "vitest";
import initSqlJs from "sql.js";
import { DatabaseService } from "./database";
import { auditOfficialMusicStats, listOfficialMusicVideoIds, verifyInstalledMusicStats } from "./musicStatsAudit";

const fresh = "2026-10-15T18:35:26.080Z";
const old = "2026-10-08T18:45:59.358Z";
async function fixture() {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run(`CREATE TABLE hololive_music_videos (youtube_video_id TEXT PRIMARY KEY, source_kind TEXT, official_catalog_active INTEGER);
    CREATE TABLE hololive_music_video_stats (youtube_video_id TEXT PRIMARY KEY, view_count INTEGER, fetched_at TEXT);
    CREATE TABLE hololive_music_exclusions (youtube_video_id TEXT PRIMARY KEY);
    CREATE TABLE hololive_music_duplicate_removals (removed_youtube_video_id TEXT PRIMARY KEY, kept_youtube_video_id TEXT);`);
  const reader = {
    select<T extends Record<string, unknown>>(sql: string): T[] {
      const result = db.exec(sql)[0];
      return result ? result.values.map((row) => Object.fromEntries(result.columns.map((column, i) => [column, row[i]])) as T) : [];
    }
  };
  return { db, reader };
}

describe("release statistics coverage", () => {
  it("selects the whole official catalog without requiring talent assignments or a UI row limit", async () => {
    const { db, reader } = await fixture();
    try {
      for (let i = 0; i < 550; i++) db.run("INSERT INTO hololive_music_videos VALUES (?, 'official', 1)", [`group-${i}`]);
      db.run("INSERT INTO hololive_music_videos VALUES ('custom', 'user', 1), ('inactive', 'official', 0), ('excluded', 'official', 1)");
      db.run("INSERT INTO hololive_music_exclusions VALUES ('excluded')");
      expect(listOfficialMusicVideoIds(reader)).toHaveLength(550);
      expect(auditOfficialMusicStats(reader, fresh)).toMatchObject({ catalogVideos: 550, missingVideos: 550, freshVideos: 0 });
    } finally { db.close(); }
  });

  it("distinguishes missing, stale, invalid, and freshly persisted counts including zero views", async () => {
    const { db, reader } = await fixture();
    try {
      for (const id of ['fresh', 'stale', 'missing', 'invalid']) db.run("INSERT INTO hololive_music_videos VALUES (?, 'official', 1)", [id]);
      db.run("INSERT INTO hololive_music_video_stats VALUES ('fresh', 0, ?), ('stale', 10, ?), ('invalid', -1, ?)", [fresh, old, fresh]);
      expect(auditOfficialMusicStats(reader, fresh)).toEqual({
        catalogVideos: 4, withStats: 2, freshVideos: 1, missingVideos: 2, staleVideos: 1,
        missingVideoIds: ['invalid', 'missing'], staleVideoIds: ['stale']
      });
    } finally { db.close(); }
  });

  it("treats an explicit empty selection as no work instead of refreshing unrelated videos", () => {
    const select = vi.fn();
    const result = DatabaseService.prototype.listHololiveMusicVideoIdsForStats.call({ select } as unknown as DatabaseService, { youtubeVideoIds: [] });
    expect(result).toEqual([]);
    expect(select).not.toHaveBeenCalled();
  });

  it("detects missing, old, and altered installed stats while accepting newer personal counts and exclusions", async () => {
    const seed = await fixture();
    const personal = await fixture();
    try {
      for (const id of ['same', 'newer', 'excluded', 'missing', 'older', 'altered']) {
        seed.db.run("INSERT INTO hololive_music_videos VALUES (?, 'official', 1)", [id]);
        seed.db.run("INSERT INTO hololive_music_video_stats VALUES (?, 100, ?)", [id, fresh]);
        if (id !== 'missing') personal.db.run("INSERT INTO hololive_music_videos VALUES (?, 'official', 1)", [id]);
      }
      personal.db.run("INSERT INTO hololive_music_exclusions VALUES ('excluded')");
      personal.db.run("INSERT INTO hololive_music_video_stats VALUES ('same', 100, ?), ('newer', 95, ?), ('older', 100, ?), ('altered', 99, ?)",
        [fresh, '2026-10-15T18:40:00.000Z', old, fresh]);
      const report = verifyInstalledMusicStats(seed.reader, personal.reader);
      expect(report).toMatchObject({ verifiedVideos: 2, excludedVideos: 1 });
      expect(report.mismatchedVideoIds.sort()).toEqual(['altered', 'missing', 'older']);
    } finally { seed.db.close(); personal.db.close(); }
  });

  it("accepts catalog cleanup only when the recorded replacement has current stats", async () => {
    const seed = await fixture();
    const personal = await fixture();
    try {
      seed.db.run("INSERT INTO hololive_music_videos VALUES ('variant', 'official', 1), ('custom', 'official', 1)");
      seed.db.run("INSERT INTO hololive_music_video_stats VALUES ('variant', 100, ?), ('custom', 100, ?)", [fresh, fresh]);
      personal.db.run("INSERT INTO hololive_music_videos VALUES ('full', 'official', 1), ('custom', 'user', 1)");
      personal.db.run("INSERT INTO hololive_music_duplicate_removals VALUES ('variant', 'intermediate'), ('intermediate', 'full')");
      personal.db.run("INSERT INTO hololive_music_video_stats VALUES ('full', 200, ?)", [old]);
      expect(verifyInstalledMusicStats(seed.reader, personal.reader).mismatchedVideoIds).toEqual(['variant']);
      personal.db.run("UPDATE hololive_music_video_stats SET fetched_at=?", [fresh]);
      expect(verifyInstalledMusicStats(seed.reader, personal.reader)).toMatchObject({
        deduplicatedVideos: 1, userOwnedVideos: 1, mismatchedVideoIds: []
      });
    } finally { seed.db.close(); personal.db.close(); }
  });
});
