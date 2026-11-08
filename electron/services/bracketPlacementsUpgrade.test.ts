import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseService } from "./database";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) {
    if (!path.resolve(directory).startsWith(`${path.resolve(os.tmpdir())}${path.sep}`)) throw new Error("Unsafe cleanup");
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
async function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "holoshelf-placement-upgrade-"));
  directories.push(dir);
  const file = path.join(dir, "personal.sqlite");
  const db = new DatabaseService(file, undefined, { createBackups: false });
  await db.init();
  return { db, file };
}
function archive(db: DatabaseService, id: string, ranks: Array<number | null>, format = "double_elimination", total = ranks.length) {
  db.run(`INSERT INTO hololive_bracket_archives
    (id,source_bracket_id,name,size,bracket_format,generation_style,seed,total_entries,created_at,completed_at,archived_at,updated_at)
    VALUES (?, ?, ?, 'RO16', ?, 'top_songs', 'unchanged-seed', ?, '2026-01-01','2026-01-02','2026-01-03','2026-01-03')`,
  [id, `deleted-source:${id}`, id, format, total]);
  for (const [i, rank] of ranks.entries()) db.run(`INSERT INTO hololive_bracket_archive_entries
    (id,archive_id,slot_index,youtube_video_id,title_snapshot,topic_id,youtube_url_snapshot,channel_name_snapshot,idol_id_snapshot,idol_name_snapshot,
     canonical_performance_key,wins,losses,final_rank,is_champion,is_finalist,is_top4,is_top8,is_top16)
    VALUES (?, ?, ?, ?, 'Saved title', 'Original_Song', 'https://youtu.be/synthetic', 'Saved channel', 'tokino-sora', 'Saved idol', ?, 3, 2, ?, ?, ?, ?, ?, ?)`,
  [`${id}:${i}`, id, i, `${id}-song-${i}`, `${id}-identity-${i}`, rank, Number(i === 0), Number(i < 2), Number(rank !== null && rank <= 4), Number(rank !== null && rank <= 8), Number(rank !== null && rank <= 16)]);
  db.run(`INSERT INTO hololive_bracket_archive_matches
    (id,archive_id,round_index,match_index,winner_youtube_video_id,loser_youtube_video_id,updated_at)
    VALUES (?, ?, 0, 0, ?, ?, '2026-01-02')`, [`match:${id}`, id, `${id}-song-0`, `${id}-song-1`]);
}
function immutableEntries(db: DatabaseService) {
  return db.select("SELECT * FROM hololive_bracket_archive_entries ORDER BY id").map(row => {
    const { final_rank, is_top4, is_top8, is_top16, ...saved } = row;
    return saved;
  });
}
function counts(db: DatabaseService) {
  return db.select("SELECT archive_id,SUM(is_top4) top4,SUM(is_top8) top8,SUM(is_top16) top16 FROM hololive_bracket_archive_entries GROUP BY archive_id ORDER BY archive_id");
}
describe("placement repair on every user's app upgrade", () => {
  it("repairs legacy DE and SE archives without their original brackets, preserving saved history and personal data", async () => {
    const { db, file } = await fixture();
    archive(db, "double", [1,2,3,4,5,5,6,6,7,7,7,7,8,8,8,8]);
    archive(db, "single", [1,2,4,4,8,8,8,8,16,16,16,16,16,16,16,16], "single_elimination");
    archive(db, "already-correct", [1,2,3,4,5,5,7,7,9,9,9,9,13,13,13,13]);
    db.setSetting("test.personal-preference", "preserved");
    db.createHololiveMusicPlaylist("Personal playlist");
    const snapshots = immutableEntries(db);
    const archives = db.select("SELECT * FROM hololive_bracket_archives ORDER BY id");
    const matches = db.select("SELECT * FROM hololive_bracket_archive_matches ORDER BY id");
    const playlists = db.select("SELECT * FROM hololive_music_playlists ORDER BY id");
    db.run("DELETE FROM schema_migrations WHERE version=37");
    db.flush();
    const upgraded = new DatabaseService(file, undefined, { createBackups: false });
    await upgraded.init();
    expect(counts(upgraded)).toEqual(["already-correct", "double", "single"].map(archive_id => ({ archive_id, top4: 4, top8: 8, top16: 16 })));
    expect(immutableEntries(upgraded)).toEqual(snapshots);
    expect(upgraded.select("SELECT * FROM hololive_bracket_archives ORDER BY id")).toEqual(archives);
    expect(upgraded.select("SELECT * FROM hololive_bracket_archive_matches ORDER BY id")).toEqual(matches);
    expect(upgraded.select("SELECT * FROM hololive_music_playlists ORDER BY id")).toEqual(playlists);
    expect(upgraded.getSettings()["test.personal-preference"]).toBe("preserved");
    expect(upgraded.select("PRAGMA integrity_check")[0].integrity_check).toBe("ok");
    expect(upgraded.select("PRAGMA foreign_key_check")).toEqual([]);
    // Reopening does not rerun or rewrite the repair, and even replaying the
    // migration itself cannot progressively shift tied ranks.
    const repaired = upgraded.select("SELECT * FROM hololive_bracket_archive_entries ORDER BY id");
    const bytes = fs.readFileSync(file);
    const reopened = new DatabaseService(file, undefined, { createBackups: false });
    await reopened.init();
    expect(fs.readFileSync(file)).toEqual(bytes);
    reopened.run("DELETE FROM schema_migrations WHERE version=37");
    const replayed = new DatabaseService(file, undefined, { createBackups: false });
    await replayed.init();
    expect(replayed.select("SELECT * FROM hololive_bracket_archive_entries ORDER BY id")).toEqual(repaired);
    expect(replayed.select("SELECT name FROM sqlite_temp_master WHERE name='bracket_placement_repair'")).toEqual([]);
  });

  it("does not invent finishing positions for incomplete or unranked historical records", async () => {
    const { db, file } = await fixture();
    archive(db, "unknown", [1,2,null,4]);
    archive(db, "incomplete", [1,2,3,4], "double_elimination", 16);
    const before = db.select("SELECT * FROM hololive_bracket_archive_entries ORDER BY id");
    db.run("DELETE FROM schema_migrations WHERE version=37");
    const upgraded = new DatabaseService(file, undefined, { createBackups: false });
    await upgraded.init();
    expect(upgraded.select("SELECT * FROM hololive_bracket_archive_entries ORDER BY id")).toEqual(before);
  });
});
