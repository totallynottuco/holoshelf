import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseService } from "./database";
import { mergeBundledOfficialData } from "./officialDataMergeService";
import { normalizeVideoDetail } from "../../src/modules/hololive/music/cleanup";
import type { HolodexArtifactBundle } from "../../src/modules/hololive/music/types";

const AUDIO = "CeTdduq4KbI";
const MV = "3f0PTj1xrvw";
const KIARA = "UCHsx4Hqa-1ORjQTh9TYDhww";
const IRISE = "UCMmcz1ybSoAD-GUlDx_7H2A";
const PLAY_COLOR = "pYB-xfIcd9c";
const folders: string[] = [];
afterEach(() => {
  for (const folder of folders.splice(0)) {
    if (!path.resolve(folder).startsWith(`${path.resolve(os.tmpdir())}${path.sep}`)) throw new Error("Unsafe test cleanup path");
    fs.rmSync(folder, { recursive: true, force: true });
  }
});
async function database(persistWrites = false) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "holoshelf-verified-mirrors-"));
  folders.push(folder);
  const file = path.join(folder, "test.sqlite");
  const db = new DatabaseService(file, undefined, { persistWrites, createBackups: false });
  await db.init();
  return { db, file };
}
function bundle(extraSongs: Array<{ id: string; song: string }> = []): HolodexArtifactBundle {
  const songs = [
    { id: AUDIO, title: "IRISÉ ‘TRAUMA (Feat. Takanashi Kiara)’ (Official Audio)", song: "TRAUMA (Feat. Takanashi Kiara)", duration: 157 },
    { id: MV, title: "IRISÉ ‘TRAUMA (Feat. Takanashi Kiara)’ Official MV", song: "TRAUMA (Feat. Takanashi Kiara)", duration: 172 },
    ...extraSongs.map(song => ({ ...song, title: song.song, duration: 180 }))
  ];
  return {
    rows: songs.map(song => ({ youtubeVideoId: song.id, youtubeUrl: `https://youtu.be/${song.id}`, title: song.title, channelId: IRISE,
      channelName: "IRISÉ", status: "past", topicId: "Original_Song", publishedAt: "2026-10-30T00:00:00.000Z" })),
    detailCache: Object.fromEntries(songs.map(song => [song.id, normalizeVideoDetail(song.id, {
      channelId: IRISE, duration: song.duration, songNames: [song.song], relationshipsLoaded: true, collabChannelIds: [KIARA],
      mentions: [{ channelId: KIARA, name: "Takanashi Kiara", englishName: "Takanashi Kiara", type: "vtuber", org: "Hololive", photoUrl: "" }]
    })])), duplicateRemovals: []
  };
}
function only(bundleValue: HolodexArtifactBundle, videoIds: string[]): HolodexArtifactBundle {
  return { ...bundleValue, rows: bundleValue.rows.filter(row => videoIds.includes(row.youtubeVideoId)),
    detailCache: Object.fromEntries(Object.entries(bundleValue.detailCache).filter(([id]) => videoIds.includes(id))) };
}
function ids(db: DatabaseService) {
  return db.select<{ youtube_video_id: string }>("SELECT youtube_video_id FROM hololive_music_videos ORDER BY youtube_video_id").map(row => row.youtube_video_id);
}
function savePersonalReferences(db: DatabaseService, youtubeVideoId = AUDIO) {
  db.setHololiveMusicMarker({ youtubeVideoId, marker: "favorite" });
  const data = db.createHololiveMusicPlaylist("Saved songs");
  const playlistId = data.playlists.find(playlist => !playlist.systemId)!.id;
  db.addHololiveMusicPlaylistItem({ playlistId, youtubeVideoId });
  db.addHololiveMusicQueueItem({ youtubeVideoId, placement: "now" });
  return playlistId;
}
function insertMapping(db: DatabaseService, removed = AUDIO, kept = MV, reason = "official_audio_duplicate_of_mv") {
  db.run(`INSERT INTO hololive_music_duplicate_removals
    (removed_youtube_video_id,removed_title,kept_youtube_video_id,kept_title,reason,source_run_id,updated_at)
    VALUES (?, 'Removed', ?, 'Kept', ?, NULL, '2999-01-01T00:00:00.000Z')`, [removed, kept, reason]);
}
function track(db: DatabaseService, id: string, notes: string, rating: number) {
  db.run(`UPDATE tracked_entries SET status = 'completed', rating = ?, notes = ?, started_at = '2026-10-30', completed_at = '2026-10-31'
    WHERE item_id = (SELECT item_id FROM hololive_music_videos WHERE youtube_video_id = ?)`, [rating, notes, id]);
}

function presentationBundle(): HolodexArtifactBundle {
  const result = bundle([{ id: PLAY_COLOR, song: "TRAUMA (Feat. Takanashi Kiara)" }]);
  result.rows.find(row => row.youtubeVideoId === PLAY_COLOR)!.title = "[PLAY COLOR | 4K] 아이리제 (IRISÉ) - TRAUMA (Feat. Takanashi Kiara)";
  result.detailCache[PLAY_COLOR].songNames = [];
  result.detailCache[PLAY_COLOR].duration = 182;
  result.detailCache[PLAY_COLOR].originalChannelId = "UCd-OrgPLrnQiQBcq19j5oEQ";
  return result;
}

describe("curated preferred song presentations", () => {
  it("prefers the MV for new same-artist performance uploads without a curated ID", async () => {
    for (const id of ["3d1AbOhFUxE", "futureVideo"]){
      const { db } = await database();
      const input = bundle([{ id, song: "TRAUMA (Feat. Takanashi Kiara)" }]);
      input.rows.find(row => row.youtubeVideoId === id)!.title = "IRISÉ (아이리제) ‘TRAUMA (Feat. Takanashi Kiara)’ Performance Video";
      input.detailCache[id].songNames = [];
      input.detailCache[id].duration = 165;
      db.importHolodexMusicArtifacts(input);
      const playlist = savePersonalReferences(db, id);
      track(db, id, "Saved performance notes", 8);
      expect(db.repairVerifiedHololiveMusicAudioMirrors([id])).toBe(0);
      expect(db.repairVerifiedHololiveMusicAudioMirrors([MV])).toBe(0);
      expect(db.repairVerifiedHololiveMusicAudioMirrors([id, MV])).toBe(1);
      expect(db.listHololiveMusicRows({ youtubeVideoIds: [id, MV] }).map(row => row.youtubeVideoId)).toEqual([MV]);
      expect(db.select("SELECT youtube_video_id FROM hololive_music_playlist_items WHERE playlist_id=?", [playlist])).toEqual([{ youtube_video_id: MV }]);
      expect(db.select(`SELECT t.notes,t.rating FROM tracked_entries t JOIN hololive_music_videos v ON t.item_id=v.item_id WHERE v.youtube_video_id=?`, [MV]))
        .toEqual([{ notes: "Saved performance notes", rating: 8 }]);
    }
  });
  it("requires both videos verified before preferring the official MV to PLAY COLOR", async () => {
    const { db } = await database();
    db.importHolodexMusicArtifacts(presentationBundle());
    const playlist = savePersonalReferences(db, PLAY_COLOR);
    track(db, PLAY_COLOR, "Saved on the performance upload", 8);
    expect(db.repairHololiveMusicDuplicateRows(null, new Set([PLAY_COLOR]))).toBe(0);
    expect(db.repairHololiveMusicDuplicateRows(null, new Set([MV]))).toBe(0);
    db.importHolodexMusicArtifacts(presentationBundle(), "live", { verifiedVideoIds: [PLAY_COLOR, MV] });
    expect(ids(db)).toEqual([AUDIO, MV].sort());
    expect(db.select("SELECT youtube_video_id FROM hololive_music_playlist_items WHERE playlist_id = ?", [playlist])).toEqual([{ youtube_video_id: MV }]);
    expect(db.listHololiveMusicRows({ youtubeVideoIds: [MV] })[0].marker).toBe("favorite");
    expect(db.select(`SELECT t.notes,t.rating FROM tracked_entries t JOIN hololive_music_videos v ON v.item_id=t.item_id
      WHERE v.youtube_video_id=?`, [MV])).toEqual([{ notes: "Saved on the performance upload", rating: 8 }]);
  });

  it("keeps the performance when its preferred MV is inactive or excluded", async () => {
    for (const excluded of [true, false]) {
      const { db } = await database();
      db.importHolodexMusicArtifacts(presentationBundle());
      if (excluded) db.run("INSERT INTO hololive_music_exclusions (youtube_video_id,created_at) VALUES (?, '2026-11-05')", [MV]);
      else db.deferHololiveMusicVideo({ youtubeVideoId: MV, reason: "Unavailable", createBackup: false });
      expect(db.repairHololiveMusicDuplicateRows(null, new Set([PLAY_COLOR, MV]))).toBe(0);
      expect(ids(db)).toContain(PLAY_COLOR);
    }
  });

  it("does not guess replacements for other performance videos or multi-song recordings", async () => {
    const { db } = await database();
    const input = presentationBundle();
    input.detailCache[PLAY_COLOR].songNames = ["TRAUMA (Feat. Takanashi Kiara)", "Another song"];
    db.importHolodexMusicArtifacts(input, "live", { verifiedVideoIds: [PLAY_COLOR, MV] });
    expect(ids(db)).toContain(PLAY_COLOR);
    const other = bundle([{ id: "anotherShow", song: "TRAUMA (Feat. Takanashi Kiara)" }]);
    other.rows.find(row => row.youtubeVideoId === "anotherShow")!.title = "TRAUMA (Live acoustic performance)";
    db.importHolodexMusicArtifacts(other, "live", { verifiedVideoIds: ["anotherShow", MV] });
    expect(ids(db)).toContain("anotherShow");
  });

  it("preserves conflicting performance notes on an inactive row", async () => {
    const { db } = await database();
    db.importHolodexMusicArtifacts(presentationBundle());
    track(db, PLAY_COLOR, "Performance-specific note", 8);
    track(db, MV, "MV-specific note", 9);
    db.repairHololiveMusicDuplicateRows(null, new Set([PLAY_COLOR, MV]));
    expect(db.listHololiveMusicRows({ youtubeVideoIds: [PLAY_COLOR] })).toEqual([]);
    expect(db.select(`SELECT v.official_catalog_active,t.notes FROM hololive_music_videos v JOIN tracked_entries t ON t.item_id=v.item_id
      WHERE v.youtube_video_id=?`, [PLAY_COLOR])).toEqual([{ official_catalog_active: 0, notes: "Performance-specific note" }]);
  });
});

describe("freshly verified official audio mirror repair", () => {
  it("requires proof for both videos and transfers personal references only after both are verified", async () => {
    const { db } = await database();
    db.importHolodexMusicArtifacts(bundle());
    const playlistId = savePersonalReferences(db);
    db.run("UPDATE hololive_music_marker_keys SET favorite_position = 42 WHERE marker_key = ?", [`video:${AUDIO}`]);
    track(db, AUDIO, "My saved audio notes", 9);
    expect(ids(db)).toEqual([MV, AUDIO].sort());
    expect(db.repairHololiveMusicDuplicateRows()).toBe(0);
    expect(db.repairVerifiedHololiveMusicAudioMirrors([AUDIO])).toBe(0);
    expect(db.repairVerifiedHololiveMusicAudioMirrors([MV])).toBe(0);
    expect(ids(db)).toHaveLength(2);
    expect(db.repairVerifiedHololiveMusicAudioMirrors([AUDIO, MV])).toBe(1);
    expect(ids(db)).toEqual([MV]);
    expect(db.select("SELECT youtube_video_id FROM hololive_music_playlist_items WHERE playlist_id = ?", [playlistId])).toEqual([{ youtube_video_id: MV }]);
    expect(db.select("SELECT youtube_video_id FROM hololive_music_queue_items")).toEqual([{ youtube_video_id: MV }]);
    expect(db.select("SELECT marker, favorite_position FROM hololive_music_marker_keys WHERE marker_key = ?", [`video:${MV}`])).toEqual([{ marker: "favorite", favorite_position: 42 }]);
    expect(db.select(`SELECT t.status, t.rating, t.notes, t.started_at, t.completed_at FROM tracked_entries t
      JOIN hololive_music_videos v ON v.item_id = t.item_id WHERE v.youtube_video_id = ?`, [MV])).toEqual([
      { status: "completed", rating: 9, notes: "My saved audio notes", started_at: "2026-10-30", completed_at: "2026-10-31" }
    ]);
  });

  it("does not prefer an inactive or private MV even when its ID was supplied", async () => {
    const { db } = await database();
    db.importHolodexMusicArtifacts(bundle());
    savePersonalReferences(db);
    db.deferHololiveMusicVideo({ youtubeVideoId: MV, reason: "Private", createBackup: false });
    expect(db.repairVerifiedHololiveMusicAudioMirrors([AUDIO, MV])).toBe(0);
    expect(ids(db)).toHaveLength(2);
    expect(db.listHololiveMusicRows({}).map(row => row.youtubeVideoId)).toEqual([AUDIO]);
    expect(db.select("SELECT youtube_video_id FROM hololive_music_queue_items")).toEqual([{ youtube_video_id: AUDIO }]);
  });

  it("does not replay unchecked mirror mappings or transfer their personal data at repair or startup", async () => {
    const { db, file } = await database(true);
    db.importHolodexMusicArtifacts(bundle());
    const playlistId = savePersonalReferences(db);
    const markers = db.select("SELECT * FROM hololive_music_marker_keys");
    insertMapping(db);
    expect(db.repairHololiveMusicDuplicateRows()).toBe(0);
    expect(ids(db)).toHaveLength(2);
    expect(db.select("SELECT * FROM hololive_music_marker_keys")).toEqual(markers);
    db.setSetting("internal.startupMaintenanceFingerprint", "force-maintenance");
    db.flush();
    const reopened = new DatabaseService(file, undefined, { persistWrites: false, createBackups: false });
    await reopened.init();
    expect(ids(reopened)).toHaveLength(2);
    expect(reopened.getSettings()["internal.startupMaintenanceVersion"]).toBe("4");
    expect(reopened.select("SELECT * FROM hololive_music_marker_keys")).toEqual(markers);
    expect(reopened.select("SELECT youtube_video_id FROM hololive_music_playlist_items WHERE playlist_id = ?", [playlistId])).toEqual([{ youtube_video_id: AUDIO }]);
    expect(reopened.select("SELECT youtube_video_id FROM hololive_music_queue_items")).toEqual([{ youtube_video_id: AUDIO }]);
  });

  it("only applies the new import rule when both imported candidates have verification proof", async () => {
    const { db } = await database();
    db.importHolodexMusicArtifacts(bundle(), "live", { verifiedVideoIds: [AUDIO] });
    expect(ids(db)).toHaveLength(2);
    db.importHolodexMusicArtifacts(bundle(), "live", { verifiedVideoIds: [AUDIO, MV] });
    expect(ids(db)).toEqual([MV]);
  });

  it("keeps the verified repair narrow instead of running unrelated stored duplicate rules", async () => {
    const { db } = await database();
    db.importHolodexMusicArtifacts(bundle([{ id: "unrelated01", song: "Different song one" }, { id: "unrelated02", song: "Different song two" }]));
    insertMapping(db, "unrelated01", "unrelated02", "known_duplicate_of_official");
    expect(db.repairVerifiedHololiveMusicAudioMirrors([AUDIO, MV])).toBe(1);
    expect(ids(db)).toEqual([MV, "unrelated01", "unrelated02"].sort());
  });

  it("permits only explicitly trusted incoming catalog mappings to transfer markers with favorite order", async () => {
    const { db } = await database();
    db.importHolodexMusicArtifacts(bundle());
    savePersonalReferences(db);
    db.run("UPDATE hololive_music_marker_keys SET favorite_position = 17 WHERE marker_key = ?", [`video:${AUDIO}`]);
    track(db, AUDIO, "Keep this note through a silent catalog update", 8);
    insertMapping(db);
    expect(db.repairHololiveMusicDuplicateRows(null, new Set([AUDIO, MV]))).toBe(1);
    expect(ids(db)).toEqual([MV]);
    expect(db.select("SELECT marker, favorite_position FROM hololive_music_marker_keys WHERE marker_key = ?", [`video:${MV}`])).toEqual([{ marker: "favorite", favorite_position: 17 }]);
    expect(db.select(`SELECT t.notes, t.rating FROM tracked_entries t JOIN hololive_music_videos v ON v.item_id = t.item_id
      WHERE v.youtube_video_id = ?`, [MV])).toEqual([{ notes: "Keep this note through a silent catalog update", rating: 8 }]);
  });

  it("retains conflicting personal notes and ratings on an inactive audio record", async () => {
    const { db } = await database();
    db.importHolodexMusicArtifacts(bundle());
    track(db, AUDIO, "Audio-specific note", 8);
    track(db, MV, "MV-specific note", 9);
    expect(db.repairVerifiedHololiveMusicAudioMirrors([AUDIO, MV])).toBe(1);
    expect(db.listHololiveMusicRows({}).map(row => row.youtubeVideoId)).toEqual([MV]);
    expect(db.select(`SELECT v.youtube_video_id, v.official_catalog_active, t.notes, t.rating FROM hololive_music_videos v
      JOIN tracked_entries t ON t.item_id = v.item_id ORDER BY v.youtube_video_id`)).toEqual([
      { youtube_video_id: MV, official_catalog_active: 1, notes: "MV-specific note", rating: 9 },
      { youtube_video_id: AUDIO, official_catalog_active: 0, notes: "Audio-specific note", rating: 8 }
    ].sort((left, right) => left.youtube_video_id.localeCompare(right.youtube_video_id)));
  });

  it("preserves tracked personal state across replacement, reactivates valid rows and hides absent rows", async () => {
    const { db } = await database();
    const catalog = bundle([{ id: "savedabsent", song: "Saved absent song" }, { id: "defaultgone", song: "Default absent song" }]);
    db.importHolodexMusicArtifacts(catalog);
    track(db, MV, "Keep the valid song's note", 10);
    track(db, "savedabsent", "Keep the absent song's note", 7);
    const previousState = db.select(`SELECT t.* FROM tracked_entries t JOIN hololive_music_videos v ON v.item_id = t.item_id
      WHERE v.youtube_video_id IN (?, ?) ORDER BY v.youtube_video_id`, [MV, "savedabsent"]);
    db.importHolodexMusicArtifacts(only(catalog, [MV]), "live", { replaceExisting: true, verifiedVideoIds: [MV] });
    expect(ids(db)).toEqual([MV, "savedabsent"].sort());
    expect(db.listHololiveMusicRows({}).map(row => row.youtubeVideoId)).toEqual([MV]);
    expect(db.select(`SELECT t.* FROM tracked_entries t JOIN hololive_music_videos v ON v.item_id = t.item_id
      WHERE v.youtube_video_id IN (?, ?) ORDER BY v.youtube_video_id`, [MV, "savedabsent"])).toEqual(previousState);
    expect(db.select("SELECT * FROM settings WHERE key = 'internal.musicAvailabilityDeferred.savedabsent'")).toEqual([]);
    db.importHolodexMusicArtifacts(only(catalog, [MV, "savedabsent"]), "live", { verifiedVideoIds: [MV, "savedabsent"] });
    expect(db.listHololiveMusicRows({}).map(row => row.youtubeVideoId).sort()).toEqual([MV, "savedabsent"].sort());
  });

  it("transfers saved audio notes, rating and favorite order when replacement receives only the verified preferred MV", async () => {
    const { db } = await database();
    const catalog = bundle();
    db.importHolodexMusicArtifacts(only(catalog, [AUDIO]));
    const playlistId = savePersonalReferences(db);
    track(db, AUDIO, "Personal note saved before replacement", 8);
    db.run("UPDATE hololive_music_marker_keys SET favorite_position = 11 WHERE marker_key = ?", [`video:${AUDIO}`]);
    const replacement = only(catalog, [MV]);
    replacement.duplicateRemovals = [{ removedYoutubeVideoId: AUDIO, removedTitle: catalog.rows[0].title,
      keptYoutubeVideoId: MV, keptTitle: catalog.rows[1].title, reason: "official_audio_duplicate_of_mv",
      songName: "TRAUMA (Feat. Takanashi Kiara)", removedPublishedAt: "2026-10-30", keptPublishedAt: "2026-10-30" }];
    const result = db.importHolodexMusicArtifacts(replacement, "live", { replaceExisting: true, verifiedVideoIds: [AUDIO, MV] });
    expect(result).toMatchObject({ importedRows: 1, detailCacheRows: 1, run: { keptRows: 1, filteredRows: 0 } });
    expect(ids(db)).toEqual([MV]);
    expect(db.select(`SELECT t.notes, t.rating FROM tracked_entries t JOIN hololive_music_videos v ON v.item_id = t.item_id
      WHERE v.youtube_video_id = ?`, [MV])).toEqual([{ notes: "Personal note saved before replacement", rating: 8 }]);
    expect(db.select("SELECT marker, favorite_position FROM hololive_music_marker_keys WHERE marker_key = ?", [`video:${MV}`])).toEqual([{ marker: "favorite", favorite_position: 11 }]);
    expect(db.select("SELECT youtube_video_id FROM hololive_music_playlist_items WHERE playlist_id = ?", [playlistId])).toEqual([{ youtube_video_id: MV }]);
    expect(db.select("SELECT youtube_video_id FROM hololive_music_queue_items")).toEqual([{ youtube_video_id: MV }]);
  });

  it("keeps audio exclusions tied to their video during a direct verified mirror repair", async () => {
    const { db } = await database();
    db.importHolodexMusicArtifacts(bundle());
    db.run(`INSERT INTO hololive_music_exclusions (youtube_video_id, title_snapshot, source_url_snapshot, created_at)
      VALUES (?, 'Excluded audio', ?, '2026-10-31T00:00:00.000Z')`, [AUDIO, `https://youtu.be/${AUDIO}`]);
    const originalExclusions = db.select("SELECT * FROM hololive_music_exclusions");
    expect(db.repairVerifiedHololiveMusicAudioMirrors([AUDIO, MV])).toBe(1);
    expect(db.select("SELECT * FROM hololive_music_exclusions")).toEqual(originalExclusions);
    expect(db.listHololiveMusicRows({}).map(row => row.youtubeVideoId)).toEqual([MV]);
  });

  it("keeps an excluded audio's original exclusion unchanged when a trusted incoming seed supplies its preferred MV", async () => {
    const { db, file } = await database();
    db.importHolodexMusicArtifacts(only(bundle(), [AUDIO]));
    db.excludeHololiveMusicVideo({ youtubeVideoId: AUDIO });
    const originalExclusions = db.select("SELECT * FROM hololive_music_exclusions");
    const { db: seed, file: seedFile } = await database(true);
    seed.importHolodexMusicArtifacts(bundle(), "live", { verifiedVideoIds: [AUDIO, MV] });
    // Keep this incoming report eligible for transfer regardless of millisecond ordering.
    seed.run("UPDATE hololive_music_duplicate_removals SET updated_at = '2999-01-01T00:00:00.000Z'");
    seed.flush();
    const seedDirectory = path.dirname(seedFile);
    fs.copyFileSync(seedFile, path.join(seedDirectory, "holoshelf-template.sqlite"));
    fs.writeFileSync(path.join(seedDirectory, "official-data.json"), JSON.stringify({ schema: 1, version: "2026.11.01.exclusion-test" }));
    const result = await mergeBundledOfficialData({ database: db, isPackaged: true,
      paths: { dataDirectory: path.dirname(file), hololiveImageDirectory: path.join(path.dirname(file), "images"), seedDirectory } });
    expect(result.status).toBe("merged");
    expect(db.select("SELECT * FROM hololive_music_exclusions")).toEqual(originalExclusions);
    expect(db.listHololiveMusicRows({}).map(row => row.youtubeVideoId)).toEqual([MV]);
    expect(db.select("SELECT * FROM hololive_music_duplicate_removals WHERE removed_youtube_video_id = ?", [AUDIO])).toHaveLength(1);
  });
});

const MIO_TOPIC = "4fJuqc_2Y_I";
const MIO_DIRECT = "cr9iLdXK9ik";
const BOWWOW = "わんわん!わおーん / Bowwow Ahwoooooo";
const SASHIMIO = "さしみお (feat. スバおか) / Sashimio (feat. SubaOka)";
function mioBundle(directDuration = 397, directSongNames = [BOWWOW, SASHIMIO]): HolodexArtifactBundle {
  const channelId = "UCp-5t9SrOQwXMU7iIjQfARg";
  return {
    rows: [MIO_TOPIC, MIO_DIRECT].map(id => ({ youtubeVideoId: id, youtubeUrl: `https://youtu.be/${id}`,
      title: id === MIO_TOPIC ? "わんわん！わおーん" : "わんわんわおーん / さしみお feat.スバおか", status: "past",
      topicId: "Original_Song", channelId, channelName: "Mio Channel 大神ミオ", publishedAt: "2021-08-20T10:00:00.000Z" })),
    detailCache: {
      [MIO_TOPIC]: normalizeVideoDetail(MIO_TOPIC, { channelId, duration: 193, songNames: [BOWWOW], providedToYoutube: true,
        originalChannelId: "UCHYTTba2SyK82DuoFh1FLDg", relationshipsLoaded: true }),
      [MIO_DIRECT]: normalizeVideoDetail(MIO_DIRECT, { channelId, duration: directDuration, songNames: directSongNames, relationshipsLoaded: true })
    }, duplicateRemovals: []
  };
}

describe("recording compatibility for stored Topic duplicate repair", () => {
  it.each([
    [397, [BOWWOW, SASHIMIO]],
    [205, [BOWWOW, SASHIMIO]],
    [397, [BOWWOW]]
  ])("retains a single track beside an incompatible direct recording (%is)", async (duration, songNames) => {
    const { db } = await database();
    db.importHolodexMusicArtifacts(mioBundle(duration as number, songNames as string[]));
    expect(ids(db)).toEqual([MIO_TOPIC, MIO_DIRECT].sort());
    expect(db.repairHololiveMusicDuplicateRows()).toBe(0);
    expect(db.select("SELECT * FROM hololive_music_duplicate_removals WHERE removed_youtube_video_id = ?", [MIO_TOPIC])).toEqual([]);
  });

  it.each(["canonical_topic_duplicate_of_non_topic", "topic_duplicate_of_non_topic"])("rejects a stale %s report before deleting a song or moving personal references", async (reason) => {
    const { db } = await database();
    db.importHolodexMusicArtifacts(mioBundle());
    const playlistId = savePersonalReferences(db, MIO_TOPIC);
    track(db, MIO_TOPIC, "Keep this single-track rating", 9);
    const markers = db.select("SELECT * FROM hololive_music_marker_keys");
    insertMapping(db, MIO_TOPIC, MIO_DIRECT, reason);
    expect(db.repairHololiveMusicDuplicateRows()).toBe(0);
    expect(ids(db)).toEqual([MIO_TOPIC, MIO_DIRECT].sort());
    expect(db.select("SELECT * FROM hololive_music_marker_keys")).toEqual(markers);
    expect(db.select("SELECT youtube_video_id FROM hololive_music_playlist_items WHERE playlist_id = ?", [playlistId])).toEqual([{ youtube_video_id: MIO_TOPIC }]);
    expect(db.select("SELECT youtube_video_id FROM hololive_music_queue_items")).toEqual([{ youtube_video_id: MIO_TOPIC }]);
    expect(db.select("SELECT * FROM hololive_music_duplicate_removals WHERE removed_youtube_video_id = ?", [MIO_TOPIC])).toEqual([]);
  });

  it.each([false, true])("also rejects incompatible transfer reports when only the removed track's detail cache remains (other repair: %s)", async (otherRepair) => {
    const { db } = await database();
    const extras = bundle([{ id: "unrelated01", song: "Different song one" }, { id: "unrelated02", song: "Different song two" }]);
    db.importHolodexMusicArtifacts({ rows: [...mioBundle().rows, ...extras.rows], detailCache: { ...mioBundle().detailCache, ...extras.detailCache }, duplicateRemovals: [] });
    const playlistId = savePersonalReferences(db, MIO_TOPIC);
    const markers = db.select("SELECT * FROM hololive_music_marker_keys");
    db.run("DELETE FROM hololive_music_videos WHERE youtube_video_id = ?", [MIO_TOPIC]);
    insertMapping(db, MIO_TOPIC, MIO_DIRECT, "canonical_topic_duplicate_of_non_topic");
    if (otherRepair) insertMapping(db, "unrelated01", "unrelated02", "known_duplicate_of_official");
    expect(db.repairHololiveMusicDuplicateRows()).toBe(otherRepair ? 1 : 0);
    expect(db.select("SELECT * FROM hololive_music_marker_keys")).toEqual(markers);
    expect(db.select("SELECT youtube_video_id FROM hololive_music_playlist_items WHERE playlist_id = ?", [playlistId])).toEqual([{ youtube_video_id: MIO_TOPIC }]);
    expect(db.select("SELECT youtube_video_id FROM hololive_music_queue_items")).toEqual([{ youtube_video_id: MIO_TOPIC }]);
    expect(db.select("SELECT * FROM hololive_music_duplicate_removals WHERE removed_youtube_video_id = ?", [MIO_TOPIC])).toEqual([]);
  });

  it("still consolidates a genuine Topic/audio recording with an MV containing a short intro", async () => {
    const { db } = await database();
    db.importHolodexMusicArtifacts(mioBundle(208, [BOWWOW]));
    expect(ids(db)).toEqual([MIO_DIRECT]);
    expect(db.select("SELECT kept_youtube_video_id FROM hololive_music_duplicate_removals WHERE removed_youtube_video_id = ?", [MIO_TOPIC])).toEqual([{ kept_youtube_video_id: MIO_DIRECT }]);
  });
});

describe("separate identity for multi-song recordings", () => {
  it("shows both Mio recordings in raw and deduplicated profile lists with stable identity across song order", async () => {
    const { db } = await database();
    db.importHolodexMusicArtifacts(mioBundle());
    const singleKey = db.listHololiveMusicRows({ youtubeVideoIds: [MIO_TOPIC] })[0].canonicalPerformanceKey;
    expect(singleKey).not.toContain(":recording:");
    expect(db.listHololiveMusicRows({ dedupeCanonicalPerformance: true }).map(row => row.youtubeVideoId).sort()).toEqual([MIO_TOPIC, MIO_DIRECT].sort());
    const profileItems = db.getHololiveIdolProfile("ookami-mio").mediaGroups.find(group => group.id === "original-songs")!.items;
    expect(profileItems.map(item => item.id).sort()).toEqual([MIO_TOPIC, MIO_DIRECT].sort());
    expect(profileItems.find(item => item.id === MIO_DIRECT)?.title).toBe("わんわんわおーん / さしみお feat.スバおか");
    expect(db.listHololiveMusicRows({ youtubeVideoIds: [MIO_DIRECT] })[0].canonicalPerformanceKey).toBe(`Original_Song:recording:${MIO_DIRECT}`);
    db.importHolodexMusicArtifacts(mioBundle(397, [SASHIMIO, BOWWOW]));
    db.repairHololiveMusicClassifications();
    expect(db.listHololiveMusicRows({ youtubeVideoIds: [MIO_TOPIC] })[0].canonicalPerformanceKey).toBe(singleKey);
    expect(db.listHololiveMusicRows({ youtubeVideoIds: [MIO_DIRECT] })[0].canonicalPerformanceKey).toBe(`Original_Song:recording:${MIO_DIRECT}`);
    expect(db.getHololiveIdolProfile("ookami-mio").mediaGroups.find(group => group.id === "original-songs")!.items).toHaveLength(2);
  });

  it("keeps Favorite state and positions independent when either recording is rated or refreshed", async () => {
    const { db } = await database();
    db.importHolodexMusicArtifacts(mioBundle());
    db.setHololiveMusicMarker({ youtubeVideoId: MIO_TOPIC, marker: "favorite" });
    expect(db.listHololiveMusicRows({ youtubeVideoIds: [MIO_DIRECT] })[0].marker).toBeNull();
    db.setHololiveMusicMarker({ youtubeVideoId: MIO_DIRECT, marker: "favorite" });
    const singleKey = db.listHololiveMusicRows({ youtubeVideoIds: [MIO_TOPIC] })[0].canonicalPerformanceKey;
    db.run("UPDATE hololive_music_marker_keys SET favorite_position = 3 WHERE marker_key IN (?, ?)", [singleKey, `video:${MIO_TOPIC}`]);
    db.run("UPDATE hololive_music_marker_keys SET favorite_position = 17 WHERE marker_key IN (?, ?)", [`Original_Song:recording:${MIO_DIRECT}`, `video:${MIO_DIRECT}`]);
    const markers = db.select("SELECT * FROM hololive_music_marker_keys ORDER BY marker_key");
    db.importHolodexMusicArtifacts(mioBundle(397, [SASHIMIO, BOWWOW]));
    expect(db.select("SELECT * FROM hololive_music_marker_keys ORDER BY marker_key")).toEqual(markers);
    db.setHololiveMusicMarker({ youtubeVideoId: MIO_TOPIC, marker: "dislike" });
    expect(db.listHololiveMusicRows({ youtubeVideoIds: [MIO_DIRECT] })[0].marker).toBe("favorite");
    expect(db.select("SELECT favorite_position FROM hololive_music_marker_keys WHERE marker_key = ?", [`Original_Song:recording:${MIO_DIRECT}`])).toEqual([{ favorite_position: 17 }]);
    expect(db.getHololiveMusicPlayerData().playlists.find(playlist => playlist.systemId === "favorites")?.items?.map(item => item.youtubeVideoId)).toEqual([MIO_DIRECT]);
  });

  it("migrates explicit video Favorite state and order without erasing shared legacy marker rows", async () => {
    const { db } = await database();
    db.importHolodexMusicArtifacts(mioBundle());
    const legacyKey = db.listHololiveMusicRows({ youtubeVideoIds: [MIO_TOPIC] })[0].canonicalPerformanceKey;
    db.run("UPDATE hololive_music_videos SET canonical_performance_key = ? WHERE youtube_video_id = ?", [legacyKey, MIO_DIRECT]);
    db.setHololiveMusicMarker({ youtubeVideoId: MIO_TOPIC, marker: "favorite" });
    db.run("UPDATE hololive_music_marker_keys SET favorite_position = 17 WHERE marker_key = ?", [`video:${MIO_DIRECT}`]);
    const previousMarkers = db.select("SELECT * FROM hololive_music_marker_keys ORDER BY marker_key");
    db.repairHololiveMusicClassifications();
    expect(db.select("SELECT marker, favorite_position FROM hololive_music_marker_keys WHERE marker_key = ?", [`Original_Song:recording:${MIO_DIRECT}`])).toEqual([{ marker: "favorite", favorite_position: 17 }]);
    expect(db.select("SELECT * FROM hololive_music_marker_keys WHERE marker_key != ? ORDER BY marker_key", [`Original_Song:recording:${MIO_DIRECT}`])).toEqual(previousMarkers);
    db.setHololiveMusicMarker({ youtubeVideoId: MIO_TOPIC, marker: "like" });
    expect(db.listHololiveMusicRows({ youtubeVideoIds: [MIO_DIRECT] })[0].marker).toBe("favorite");
  });

  it("does not copy an ambiguous shared single-track Favorite to a multi-song recording without a video alias", async () => {
    const { db } = await database();
    db.importHolodexMusicArtifacts(mioBundle());
    db.setHololiveMusicMarker({ youtubeVideoId: MIO_TOPIC, marker: "favorite" });
    const legacyKey = db.listHololiveMusicRows({ youtubeVideoIds: [MIO_TOPIC] })[0].canonicalPerformanceKey;
    db.run("UPDATE hololive_music_videos SET canonical_performance_key = ? WHERE youtube_video_id = ?", [legacyKey, MIO_DIRECT]);
    db.repairHololiveMusicClassifications();
    expect(db.listHololiveMusicRows({ youtubeVideoIds: [MIO_TOPIC] })[0].marker).toBe("favorite");
    expect(db.listHololiveMusicRows({ youtubeVideoIds: [MIO_DIRECT] })[0].marker).toBeNull();
    expect(db.select("SELECT * FROM hololive_music_marker_keys WHERE marker_key = ?", [`Original_Song:recording:${MIO_DIRECT}`])).toEqual([]);
  });
});
