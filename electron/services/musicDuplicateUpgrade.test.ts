import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DatabaseService } from "./database";
import { normalizeVideoDetail } from "../../src/modules/hololive/music/cleanup";
import type { HolodexArtifactBundle } from "../../src/modules/hololive/music/types";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) {
    if (!path.resolve(directory).startsWith(`${path.resolve(os.tmpdir())}${path.sep}`)) throw new Error("Unsafe cleanup");
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
const mv = "Mfcj1AdnzhQ", audio = "Fv8ijeYqTS8";
const title = "FLOW GLOW / BOUNCE BACK！【Official Music Video】";
function bundle(mvTitle = title): HolodexArtifactBundle {
  const channelId = "UCu2n3qHuOuQIygREMnWeQWg";
  const mentions = ["UC9LSiN9hXI55svYEBrrK-tw", "UCuI_opAVX6qbxZY-a-AxFuQ", "UCKMWFR6lAstLa7Vbf5dH7ig"].map(channelId => ({ channelId, name: "Member", englishName: "Member", type: "vtuber", photoUrl: "", org: "Hololive" }));
  return {
    rows: [mv, audio].map(id => ({ youtubeVideoId: id, youtubeUrl: `https://youtu.be/${id}`, title: id === mv ? mvTitle : "BOUNCE BACK！",
      status: "past", topicId: "Original_Song", channelId, channelName: "hololive FLOW GLOW", publishedAt: "2026-11-09T12:00:00.000Z" })),
    detailCache: {
      [mv]: normalizeVideoDetail(mv, { channelId, duration: 241, songNames: [], mentions, collabChannelIds: mentions.map(member => member.channelId), relationshipsLoaded: true }),
      [audio]: normalizeVideoDetail(audio, { channelId, originalChannelId: "UC3VId8brfshtHO6gMMqnZ5A", providedToYoutube: true,
        duration: 222, songNames: ["BOUNCE BACK!"], mentions: mentions.slice(0, 2), collabChannelIds: mentions.slice(0, 2).map(member => member.channelId), relationshipsLoaded: true })
    }, duplicateRemovals: []
  };
}
async function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "holoshelf-song-upgrade-"));
  directories.push(directory);
  const file = path.join(directory, "test.sqlite");
  const db = new DatabaseService(file, undefined, { createBackups: false });
  await db.init();
  return { db, file };
}

describe("new songs with delayed Holodex song metadata", () => {
  it.each(["together", "audio-first", "mv-first"])("keeps the official MV across refresh order: %s", async order => {
    const { db } = await fixture();
    const input = bundle();
    db.setHololiveMusicMarker({ youtubeVideoId: audio, marker: "favorite" });
    if (order === "together") db.importHolodexMusicArtifacts(input, "live");
    else for (const id of order === "audio-first" ? [audio, mv] : [mv, audio]) {
      db.importHolodexMusicArtifacts({ ...input, rows: input.rows.filter(row => row.youtubeVideoId === id) }, "live");
    }
    const visible = db.listHololiveMusicRows({ youtubeVideoIds: [audio, mv] });
    expect(visible).toHaveLength(1);
    expect(visible[0]).toMatchObject({ youtubeVideoId: mv, canonicalSongKey: "bounce back", marker: "favorite" });
    db.importHolodexMusicArtifacts(input, "live");
    expect(db.listHololiveMusicRows({ youtubeVideoIds: [audio, mv] }).map(row => row.youtubeVideoId)).toEqual([mv]);
  });

  it.each([false, true])("repairs unchanged legacy data once and preserves personal state (conflicting notes: %s)", async conflictingNotes => {
    const { db, file } = await fixture();
    // Reproduce the earlier client: both rows survived and the MV's key was the
    // group name. Keep the fingerprint current so only the version change repairs it.
    db.importHolodexMusicArtifacts(bundle("Unidentified Upload"), "live");
    db.run("UPDATE hololive_music_videos SET title=?,canonical_song_key='flow glow',canonical_performance_key=? WHERE youtube_video_id=?",
      [title, `Original_Song:flow glow:unowned:${mv}`, mv]);
    db.setHololiveMusicMarker({ youtubeVideoId: audio, marker: "favorite" });
    db.run("UPDATE hololive_music_marker_keys SET favorite_position=47 WHERE marker_key=?", [`video:${audio}`]);
    const playlistId = db.createHololiveMusicPlaylist("Saved songs").playlists.find(p => !p.systemId)!.id;
    db.addHololiveMusicPlaylistItem({ playlistId, youtubeVideoId: audio });
    db.addHololiveMusicQueueItem({ youtubeVideoId: audio, placement: "now" });
    db.run("UPDATE tracked_entries SET notes='Audio note',rating=8 WHERE item_id=(SELECT item_id FROM hololive_music_videos WHERE youtube_video_id=?)", [audio]);
    if (conflictingNotes) db.run("UPDATE tracked_entries SET notes='MV note',rating=9 WHERE item_id=(SELECT item_id FROM hololive_music_videos WHERE youtube_video_id=?)", [mv]);
    db.setSetting("song-upgrade.preference", "preserved");
    db.markStartupMaintenanceCurrent();
    db.setSetting("internal.startupMaintenanceVersion", "3");
    db.flush();
    const upgraded = new DatabaseService(file, undefined, { createBackups: false });
    await upgraded.init();
    expect(upgraded.listHololiveMusicRows({ youtubeVideoIds: [audio, mv] })).toMatchObject([{ youtubeVideoId: mv, canonicalSongKey: "bounce back", marker: "favorite" }]);
    expect(upgraded.select("SELECT favorite_position FROM hololive_music_marker_keys WHERE marker_key=?", [`video:${mv}`])[0]).toEqual({ favorite_position: 47 });
    expect(upgraded.select("SELECT youtube_video_id FROM hololive_music_playlist_items WHERE playlist_id=?", [playlistId])).toEqual([{ youtube_video_id: mv }]);
    expect(upgraded.select("SELECT youtube_video_id FROM hololive_music_queue_items")).toEqual([{ youtube_video_id: mv }]);
    expect(upgraded.select("SELECT current_youtube_video_id FROM hololive_music_player_state")[0].current_youtube_video_id).toBe(mv);
    const tracking = upgraded.select("SELECT v.youtube_video_id,v.official_catalog_active,t.notes,t.rating FROM hololive_music_videos v JOIN tracked_entries t ON t.item_id=v.item_id ORDER BY v.youtube_video_id");
    expect(tracking).toEqual(conflictingNotes
      ? [{ youtube_video_id: audio, official_catalog_active: 0, notes: "Audio note", rating: 8 }, { youtube_video_id: mv, official_catalog_active: 1, notes: "MV note", rating: 9 }]
      : [{ youtube_video_id: mv, official_catalog_active: 1, notes: "Audio note", rating: 8 }]);
    expect(upgraded.getSettings()["song-upgrade.preference"]).toBe("preserved");
    expect(upgraded.select("PRAGMA integrity_check")[0].integrity_check).toBe("ok");
    expect(upgraded.select("PRAGMA foreign_key_check")).toEqual([]);
    const bytes = fs.readFileSync(file);
    await new DatabaseService(file, undefined, { createBackups: false }).init();
    expect(fs.readFileSync(file)).toEqual(bytes);
  });
});
