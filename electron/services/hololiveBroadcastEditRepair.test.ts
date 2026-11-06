import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseService } from "./database";
import { mergeBundledOfficialData } from "./officialDataMergeService";
import { normalizeVideoDetail } from "../../src/modules/hololive/music/cleanup";
import type { HolodexArtifactBundle } from "../../src/modules/hololive/music/types";

const MARINE = "UCCzUftO8KOVkV4wQG1vkUvg";
const EDIT = "CCjQ0FuVx7s";
const FULL = "zfYGdSqliRU";
const EDIT_TITLE = 'TVアニメ『株式会社マジルミエ』第2期ノンクレジットエンディング映像｜宝鐘マリン「BooooM!!!」';
const folders: string[] = [];
afterEach(() => {
  for (const folder of folders.splice(0)) {
    if (!path.resolve(folder).startsWith(`${path.resolve(os.tmpdir())}${path.sep}`)) throw new Error("Unsafe cleanup");
    fs.rmSync(folder, { recursive: true, force: true });
  }
});
async function database(persistWrites = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "holoshelf-broadcast-"));
  folders.push(root);
  const file = path.join(root, "holoshelf.sqlite");
  const db = new DatabaseService(file, undefined, { persistWrites, createBackups: false });
  await db.init();
  return { db, root, file };
}
function bundle(id: string, title: string, songNames: string[], duration: number | null): HolodexArtifactBundle {
  return { rows: [{ youtubeVideoId: id, youtubeUrl: `https://youtu.be/${id}`, title, status: "past", topicId: "Original_Song",
    channelId: MARINE, channelName: "Marine Ch. 宝鐘マリン", publishedAt: "2026-07-30T12:00:00.000Z" }],
    detailCache: { [id]: normalizeVideoDetail(id, { channelId: MARINE, duration, songNames, relationshipsLoaded: true }) }, duplicateRemovals: [] };
}
function visible(db: DatabaseService) { return db.listHololiveMusicRows({}).map(row => row.youtubeVideoId).sort(); }
function savePersonal(db: DatabaseService) {
  db.setHololiveMusicMarker({ youtubeVideoId: EDIT, marker: "favorite" });
  const playlist = db.createHololiveMusicPlaylist("Saved broadcast").playlists.find(p => !p.systemId)!;
  db.addHololiveMusicPlaylistItem({ playlistId: playlist.id, youtubeVideoId: EDIT });
  db.addHololiveMusicQueueItem({ youtubeVideoId: EDIT, placement: "now" });
  db.run(`UPDATE tracked_entries SET notes = 'Saved edit note', rating = 9
    WHERE item_id = (SELECT item_id FROM hololive_music_videos WHERE youtube_video_id = ?)`, [EDIT]);
  return playlist.id;
}
function assertPersonal(db: DatabaseService, playlist: string) {
  expect(visible(db)).toEqual([FULL]);
  expect(db.listHololiveMusicRows({})[0].marker).toBe("favorite");
  expect(db.select("SELECT youtube_video_id FROM hololive_music_playlist_items WHERE playlist_id = ?", [playlist])).toEqual([{ youtube_video_id: FULL }]);
  expect(db.select("SELECT youtube_video_id FROM hololive_music_queue_items")).toEqual([{ youtube_video_id: FULL }]);
  expect(db.select(`SELECT t.notes, t.rating FROM tracked_entries t JOIN hololive_music_videos v ON v.item_id = t.item_id
    WHERE v.youtube_video_id = ?`, [FULL])).toEqual([{ notes: "Saved edit note", rating: 9 }]);
}

describe("broadcast edit repair on existing libraries", () => {
  it("matches Towa's Rewrite the Answer anime opening using its explicit description credit", async () => {
    const { db } = await database();
    const towa = "UC1uv2Oq6kNxgATlCiez59hw";
    const edit = bundle("qWry2uaHqx8", '『追放された転生重騎士はゲーム知識で無双する』第2クールノンクレジットオープニング映像', [], 91);
    edit.rows[0].channelId = "UC6VPE3kztGEtFVcJI0oIiUg";
    edit.rows[0].channelName = "SHOCHIKU anime";
    edit.detailCache.qWry2uaHqx8 = normalizeVideoDetail("qWry2uaHqx8", {
      channelId: edit.rows[0].channelId, duration: 91, songNames: [], relationshipsLoaded: true,
      description: 'オープニング主題歌：常闇トワ「Rewrite the Answer」\nエンディングテーマ：PompadollS「コンテンポラリーダンス」',
      collabChannelIds: [towa]
    });
    db.importHolodexMusicArtifacts(edit);
    expect(visible(db)).toEqual(["qWry2uaHqx8"]);
    const full = bundle("yOI1qMpfuRw", "Rewrite the Answer / 常闇トワ (official)", ["Rewrite the Answer"], 199);
    full.rows[0].channelId = towa;
    full.rows[0].channelName = "Towa Ch. 常闇トワ";
    full.detailCache.yOI1qMpfuRw.channelId = towa;
    db.importHolodexMusicArtifacts(full);
    expect(visible(db)).toEqual(["yOI1qMpfuRw"]);
  });

  it("matches Towa's Shirube edit when structured metadata uses hiragana but video titles agree", async () => {
    const { db } = await database();
    db.importHolodexMusicArtifacts(bundle(EDIT, "シルベ (TV Size)", ["シルベ (TV Size) / Shirube (TV Size)"], 96));
    db.importHolodexMusicArtifacts(bundle(FULL, "シルベ / 常闇トワ (official)", ["シルべ / Shirube"], 210));
    expect(visible(db)).toEqual([FULL]);
  });

  it("replaces Marine's metadata-free anime ending on incremental import and keeps personal state", async () => {
    const { db } = await database();
    db.importHolodexMusicArtifacts(bundle(EDIT, EDIT_TITLE, [], 91));
    const playlist = savePersonal(db);
    db.importHolodexMusicArtifacts(bundle(FULL, "【original MV】BooooM!!!【hololive/宝鐘マリン】", ["BooooM!!!"], 175));
    assertPersonal(db, playlist);
  });

  it.each(["TV Size Version", "TV Sized", "TVアニメver."])("replaces a %s edit even when it comes from another channel", async label => {
    const { db } = await database();
    db.importHolodexMusicArtifacts(bundle(EDIT, `BooooM!!! (${label})`, [`BooooM!!! (${label})`], 91));
    // Model an external distributor credited to the same performer.
    db.run("UPDATE hololive_music_videos SET channel_id = 'external-anime-channel', channel_name = 'Anime', canonical_performance_key = 'external-edit' WHERE youtube_video_id = ?", [EDIT]);
    db.importHolodexMusicArtifacts(bundle(FULL, "【original MV】BooooM!!!", ["BooooM!!!"], 175));
    expect(visible(db)).toEqual([FULL]);
  });

  it.each([
    { name: "unknown duration", title: "BooooM!!!", songs: ["BooooM!!!"], duration: null },
    { name: "another short cut", title: "BooooM!!!", songs: ["BooooM!!!"], duration: 100 },
    { name: "multi-song performance", title: "BooooM!!! / Other", songs: ["BooooM!!!", "Other"], duration: 400 },
    { name: "acoustic performance", title: "BooooM!!! (Acoustic)", songs: ["BooooM!!!"], duration: 200 }
  ])("keeps the edit when the replacement is $name", async candidate => {
    const { db } = await database();
    db.importHolodexMusicArtifacts(bundle(EDIT, EDIT_TITLE, [], 91));
    db.importHolodexMusicArtifacts(bundle(FULL, candidate.title, candidate.songs, candidate.duration));
    expect(visible(db)).toEqual([EDIT, FULL].sort());
  });

  it("preserves conflicting notes on an inactive edit rather than deleting them", async () => {
    const { db } = await database();
    db.importHolodexMusicArtifacts(bundle(EDIT, EDIT_TITLE, [], 91));
    savePersonal(db);
    db.importHolodexMusicArtifacts(bundle(FULL, "BooooM!!!", ["BooooM!!!"], 100));
    db.run("UPDATE tracked_entries SET notes = 'Full MV note' WHERE item_id = (SELECT item_id FROM hololive_music_videos WHERE youtube_video_id = ?)", [FULL]);
    db.run("UPDATE hololive_music_videos SET duration_seconds = 175 WHERE youtube_video_id = ?", [FULL]);
    db.repairHololiveMusicDuplicateRows();
    expect(visible(db)).toEqual([FULL]);
    expect(db.select(`SELECT v.official_catalog_active, t.notes FROM hololive_music_videos v JOIN tracked_entries t ON t.item_id = v.item_id
      WHERE v.youtube_video_id = ?`, [EDIT])).toEqual([{ official_catalog_active: 0, notes: "Saved edit note" }]);
  });

  it("rejects an old broadcast-edit mapping to an unrelated song", async () => {
    const { db } = await database();
    db.importHolodexMusicArtifacts(bundle(EDIT, EDIT_TITLE, [], 91));
    db.importHolodexMusicArtifacts(bundle(FULL, "Different Song", ["Different Song"], 200));
    db.run(`INSERT INTO hololive_music_duplicate_removals
      (removed_youtube_video_id,removed_title,kept_youtube_video_id,kept_title,reason,updated_at)
      VALUES (?, ?, ?, 'Different Song', 'canonical_variant_duplicate_of_full', '2026-11-05')`, [EDIT, EDIT_TITLE, FULL]);
    db.repairHololiveMusicDuplicateRows();
    expect(visible(db)).toEqual([EDIT, FULL].sort());
  });

  it("does not collapse a different performer's version on the same channel", async () => {
    const { db } = await database();
    db.importHolodexMusicArtifacts(bundle(EDIT, EDIT_TITLE, [], 91));
    db.run(`UPDATE hololive_music_videos SET owned_idol_ids_json = '["tokoyami-towa"]',
      canonical_performance_key = 'other-performer' WHERE youtube_video_id = ?`, [EDIT]);
    db.importHolodexMusicArtifacts(bundle(FULL, "BooooM!!!", ["BooooM!!!"], 175));
    expect(visible(db)).toEqual([EDIT, FULL].sort());
  });

  it("handles incomplete START AGAIN credits only on the same trusted group channel", async () => {
    const { db } = await database();
    const group = "UCotXwY6s8pWmuWd_snKYjhg";
    db.refreshHolodexChannels([{ id: group, name: "hololive English", englishName: "hololive English", type: "suborg", org: "Hololive",
      group: "English", photoUrl: "", twitter: "", videoCount: 0, subscriberCount: 0, clipCount: 0, publishedAt: "", inactive: false }]);
    db.importHolodexMusicArtifacts(bundle(EDIT, "START AGAIN", ["START AGAIN (TV Size)"], 105));
    db.run(`UPDATE hololive_music_videos SET channel_id = ?, owned_idol_ids_json = '[]',
      featured_idol_ids_json = '["mori-calliope","elizabeth-rose-bloodflame"]', canonical_performance_key = 'short-group' WHERE youtube_video_id = ?`, [group, EDIT]);
    db.importHolodexMusicArtifacts(bundle(FULL, "START AGAIN", ["START AGAIN"], 220));
    db.run(`UPDATE hololive_music_videos SET channel_id = ?, owned_idol_ids_json = '[]',
      featured_idol_ids_json = '["mori-calliope","irys","nerissa-ravencroft","elizabeth-rose-bloodflame"]', canonical_performance_key = 'full-group' WHERE youtube_video_id = ?`, [group, FULL]);
    db.repairHololiveMusicDuplicateRows();
    expect(visible(db)).toEqual([FULL]);
  });

  it("keeps a personally added version under the user's control", async () => {
    const { db } = await database();
    db.importHolodexMusicArtifacts(bundle(EDIT, EDIT_TITLE, [], 91));
    db.run("UPDATE hololive_music_videos SET source_kind = 'user' WHERE youtube_video_id = ?", [EDIT]);
    db.importHolodexMusicArtifacts(bundle(FULL, "BooooM!!!", ["BooooM!!!"], 175));
    expect(visible(db)).toEqual([EDIT, FULL].sort());
  });

  it("does not replace a usable edit with an excluded or locally unavailable full video", async () => {
    for (const excluded of [true, false]) {
      const { db } = await database();
      db.importHolodexMusicArtifacts(bundle(EDIT, EDIT_TITLE, [], 91));
      db.importHolodexMusicArtifacts(bundle(FULL, "BooooM!!!", ["BooooM!!!"], 100));
      if (excluded) db.run("INSERT INTO hololive_music_exclusions (youtube_video_id,created_at) VALUES (?, '2026-11-05')", [FULL]);
      else db.deferHololiveMusicVideo({ youtubeVideoId: FULL, reason: "Region unavailable", createBackup: false });
      db.run("UPDATE hololive_music_videos SET duration_seconds = 175 WHERE youtube_video_id = ?", [FULL]);
      db.repairHololiveMusicDuplicateRows();
      expect(visible(db)).toEqual([EDIT]);
    }
  });

  it("does not move an anime-ending exclusion onto the full MV during a silent merge", async () => {
    const user = await database();
    user.db.importHolodexMusicArtifacts(bundle(EDIT, EDIT_TITLE, [], 91));
    user.db.run("INSERT INTO hololive_music_exclusions (youtube_video_id,created_at) VALUES (?, '2026-11-05')", [EDIT]);
    const exclusions = user.db.select("SELECT * FROM hololive_music_exclusions");
    const seed = await database(true);
    seed.db.importHolodexMusicArtifacts(bundle(EDIT, EDIT_TITLE, [], 91));
    seed.db.importHolodexMusicArtifacts(bundle(FULL, "BooooM!!!", ["BooooM!!!"], 175));
    seed.db.flush();
    fs.copyFileSync(seed.file, path.join(seed.root, "holoshelf-template.sqlite"));
    fs.writeFileSync(path.join(seed.root, "official-data.json"), JSON.stringify({ version: "2026-11-05T000000Z" }));
    await mergeBundledOfficialData({ database: user.db, isPackaged: true,
      paths: { seedDirectory: seed.root, dataDirectory: user.root, hololiveImageDirectory: path.join(user.root, "images") } });
    expect(visible(user.db)).toEqual([FULL]);
    expect(user.db.select("SELECT * FROM hololive_music_exclusions")).toEqual(exclusions);
  });

  it("repairs an already-maintained 1.1.94 library once on startup", async () => {
    const { db, file } = await database(true);
    db.importHolodexMusicArtifacts(bundle(EDIT, EDIT_TITLE, [], 91));
    // Reproduce the old incorrect anime-title key so the full import cannot match it.
    db.run("UPDATE hololive_music_videos SET canonical_song_key = 'anime-title', canonical_performance_key = 'anime-title' WHERE youtube_video_id = ?", [EDIT]);
    const playlist = savePersonal(db);
    db.importHolodexMusicArtifacts(bundle(FULL, "BooooM!!!", ["BooooM!!!"], 175));
    db.markStartupMaintenanceCurrent();
    db.setSetting("internal.startupMaintenanceVersion", "2");
    db.flush();
    const reopened = new DatabaseService(file, undefined, { persistWrites: false, createBackups: false });
    await reopened.init();
    assertPersonal(reopened, playlist);
    expect(reopened.getSettings()["internal.startupMaintenanceVersion"]).toBe("3");
  });

  it("applies a corrected silent catalog to an existing client library", async () => {
    const user = await database();
    user.db.importHolodexMusicArtifacts(bundle(EDIT, EDIT_TITLE, [], 91));
    const playlist = savePersonal(user.db);
    const seed = await database(true);
    seed.db.importHolodexMusicArtifacts(bundle(EDIT, EDIT_TITLE, [], 91));
    seed.db.importHolodexMusicArtifacts(bundle(FULL, "BooooM!!!", ["BooooM!!!"], 175));
    seed.db.flush();
    fs.copyFileSync(seed.file, path.join(seed.root, "holoshelf-template.sqlite"));
    fs.writeFileSync(path.join(seed.root, "official-data.json"), JSON.stringify({ schema: 1, version: "2026-11-05T000000Z", generatedAt: "2026-11-05T00:00:00.000Z" }));
    const result = await mergeBundledOfficialData({ database: user.db, isPackaged: true,
      paths: { seedDirectory: seed.root, dataDirectory: user.root, hololiveImageDirectory: path.join(user.root, "images") } });
    expect(result.status).toBe("merged");
    assertPersonal(user.db, playlist);
  });
});
