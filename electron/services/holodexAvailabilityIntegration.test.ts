import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseService } from "./database";
import { HolodexMusicService } from "./holodexMusicService";
import { normalizeVideoDetail } from "../../src/modules/hololive/music/cleanup";
import type { YouTubeVideoAvailabilityCheckResult } from "./youtubeVideoStatsService";

const SORA_CHANNEL = "UCp6993wxpyDPHUpavwDFqgg";
const KIARA_CHANNEL = "UCHsx4Hqa-1ORjQTh9TYDhww";
const IRISE_CHANNEL = "UCMmcz1ybSoAD-GUlDx_7H2A";
const folders: string[] = [];
function directory() {
  const value = fs.mkdtempSync(path.join(os.tmpdir(), "holoshelf-availability-integration-"));
  folders.push(value);
  return value;
}
afterEach(() => {
  for (const folder of folders.splice(0)) {
    if (!path.resolve(folder).startsWith(`${path.resolve(os.tmpdir())}${path.sep}`)) throw new Error("Unsafe test cleanup path");
    fs.rmSync(folder, { recursive: true, force: true });
  }
});
async function database() {
  const db = new DatabaseService(path.join(directory(), "test.sqlite"), undefined, { persistWrites: false, createBackups: false });
  await db.init();
  return db;
}

function video(id: string, title: string, options: { channelId?: string; songName?: string; status?: "past" | "live" | "upcoming"; duration?: number } = {}) {
  const channelId = options.channelId ?? SORA_CHANNEL;
  return {
    id, title, type: "stream", topic_id: "Original_Song", status: options.status ?? "past",
    published_at: "2026-10-30T03:00:00.000Z", duration: options.duration ?? 180,
    songs: [{ name: options.songName ?? title }],
    channel_id: channelId,
    channel: { id: channelId, name: channelId === SORA_CHANNEL ? "SoraCh." : "IRISÉ", type: "vtuber", org: channelId === SORA_CHANNEL ? "Hololive" : "Independents" },
    mentions: channelId === IRISE_CHANNEL ? [{ id: KIARA_CHANNEL, name: "Takanashi Kiara", type: "vtuber", org: "Hololive" }] : []
  };
}
type FixtureVideo = ReturnType<typeof video>;
function fetcher(videos: FixtureVideo[]): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname === "/api/v2/videos") {
      const matching = url.searchParams.get("topic") === "Original_Song" && url.searchParams.get("type") === "stream"
        ? videos.filter(candidate => candidate.channel_id === SORA_CHANNEL) : [];
      return Response.json({ total: matching.length, items: Number(url.searchParams.get("offset") ?? 0) === 0 ? matching : [] });
    }
    if (/^\/api\/v2\/channels\/[^/]+\/collabs$/.test(url.pathname)) {
      return Response.json(url.pathname === `/api/v2/channels/${KIARA_CHANNEL}/collabs` ? videos.filter(candidate => candidate.channel_id === IRISE_CHANNEL) : []);
    }
    const detail = videos.find(candidate => url.pathname === `/api/v2/videos/${candidate.id}`);
    if (detail) return Response.json(detail);
    return new Response(null, { status: 404 });
  }) as typeof fetch;
}
function verified(videos: FixtureVideo[], availableIds = videos.map(candidate => candidate.id)): YouTubeVideoAvailabilityCheckResult {
  const checkedAt = "2026-11-01T00:00:00.000Z";
  return {
    checkedAt, requestedVideos: videos.length, availableVideoIds: availableIds,
    deferredVideos: videos.filter(candidate => !availableIds.includes(candidate.id)).map(candidate => ({ youtubeVideoId: candidate.id, reason: "YouTube reports this video as private." })),
    unavailableVideos: [],
    stats: videos.filter(candidate => availableIds.includes(candidate.id)).map(candidate => ({
      youtubeVideoId: candidate.id, viewCount: 1234, fetchedAt: checkedAt,
      youtubeChannelId: candidate.channel_id, youtubeChannelName: candidate.channel.name,
      durationSeconds: candidate.duration, title: candidate.title, status: candidate.status
    }))
  };
}
const liveOptions = { includeChannels: false, includeCustomTalents: false, includeCollabs: false, replaceExisting: true, maxRequestsPerWindow: 999, requestWindowMs: 1000 };

describe("Holodex import availability integration", () => {
  it("checks every candidate before an unavailable preferred MV can displace its public audio", async () => {
    const db = await database();
    const songName = "TRAUMA (Feat. Takanashi Kiara)";
    const videos = [
      video("CeTdduq4KbI", "IRISÉ ‘TRAUMA (Feat. Takanashi Kiara)’ (Official Audio)", { channelId: IRISE_CHANNEL, songName, duration: 157 }),
      video("3f0PTj1xrvw", "IRISÉ ‘TRAUMA (Feat. Takanashi Kiara)’ Official MV", { channelId: IRISE_CHANNEL, songName, duration: 172 })
    ];
    const availabilityVerifier = vi.fn(async (_ids: string[]) => verified(videos, ["CeTdduq4KbI"]));
    const service = new HolodexMusicService(db, fetcher(videos), null, { availabilityVerifier });
    const result = await service.refreshLive({ ...liveOptions, includeCollabs: true });
    expect(result.run.status).toBe("completed");
    expect(new Set(availabilityVerifier.mock.calls[0][0])).toEqual(new Set(videos.map(candidate => candidate.id)));
    expect(db.listHololiveMusicRows({}).map(candidate => candidate.youtubeVideoId)).toEqual(["CeTdduq4KbI"]);
    expect(db.select("SELECT * FROM hololive_music_duplicate_removals WHERE removed_youtube_video_id='CeTdduq4KbI'")).toEqual([]);
    expect(db.select("SELECT * FROM hololive_music_exclusions")).toEqual([]);
    expect(service.getVerifiedAvailability()?.deferredVideos).toHaveLength(1);
  });

  it("retains a verified public premiere preview with upcoming status and zero duration", async () => {
    const db = await database();
    const videos = [video("preview0001", "Sora premiere song", { status: "upcoming", duration: 0 })];
    const service = new HolodexMusicService(db, fetcher(videos), null, { availabilityVerifier: async () => verified(videos) });
    const result = await service.refreshLive(liveOptions);
    expect(result.run.status).toBe("completed");
    expect(db.listHololiveMusicRows({})).toMatchObject([{ youtubeVideoId: "preview0001", status: "upcoming", durationSeconds: 0 }]);
  });

  it("does not let an older stored MV that became private displace public audio during a non-replace import", async () => {
    const db = await database();
    const songName = "TRAUMA (Feat. Takanashi Kiara)";
    const audio = video("CeTdduq4KbI", "IRISÉ ‘TRAUMA (Feat. Takanashi Kiara)’ (Official Audio)", { channelId: IRISE_CHANNEL, songName, duration: 157 });
    const musicVideo = video("3f0PTj1xrvw", "IRISÉ ‘TRAUMA (Feat. Takanashi Kiara)’ Official MV", { channelId: IRISE_CHANNEL, songName, duration: 172 });
    const videos = [audio, musicVideo];
    const initial = new HolodexMusicService(db, fetcher(videos), null, { availabilityVerifier: async () => verified(videos) });
    expect((await initial.refreshLive({ ...liveOptions, includeCollabs: true })).run.status).toBe("completed");
    expect(db.listHololiveMusicRows({}).map(candidate => candidate.youtubeVideoId)).toEqual([musicVideo.id]);
    db.setHololiveMusicMarker({ youtubeVideoId: musicVideo.id, marker: "favorite" });
    const previousMarkers = db.select("SELECT * FROM hololive_music_marker_keys");
    const service = new HolodexMusicService(db, fetcher(videos), null, { availabilityVerifier: async () => verified(videos, [audio.id]) });
    const result = await service.refreshLive({ ...liveOptions, includeCollabs: true, replaceExisting: false });
    expect(result.run.status).toBe("completed");
    expect(db.listHololiveMusicRows({}).map(candidate => candidate.youtubeVideoId)).toEqual([audio.id]);
    expect(db.select("SELECT * FROM hololive_music_marker_keys")).toEqual(previousMarkers);
    expect(db.select("SELECT * FROM hololive_music_exclusions")).toEqual([]);
  });

  it("keeps existing songs and markers intact if verification fails before a replace import", async () => {
    const db = await database();
    db.importHolodexMusicArtifacts({
      rows: [{ youtubeVideoId: "existing001", youtubeUrl: "https://youtu.be/existing001", title: "Existing Sora song", status: "past", topicId: "Original_Song", channelId: SORA_CHANNEL, channelName: "SoraCh.", publishedAt: "2026-10-01T00:00:00.000Z" }],
      detailCache: { existing001: normalizeVideoDetail("existing001", { channelId: SORA_CHANNEL, duration: 180, songNames: ["Existing Sora song"] }) },
      duplicateRemovals: []
    });
    db.setHololiveMusicMarker({ youtubeVideoId: "existing001", marker: "favorite" });
    const beforeSongs = db.select("SELECT * FROM hololive_music_videos");
    const beforeMarkers = db.select("SELECT * FROM hololive_music_marker_keys");
    const videos = [video("newvideo001", "Unverified replacement song")];
    const service = new HolodexMusicService(db, fetcher(videos), null, { availabilityVerifier: async () => { throw new Error("YouTube verification temporarily failed"); } });
    const result = await service.refreshLive(liveOptions);
    expect(result.run.status).toBe("failed");
    expect(result.run.error).toContain("YouTube verification temporarily failed");
    expect(db.select("SELECT * FROM hololive_music_videos")).toEqual(beforeSongs);
    expect(db.select("SELECT * FROM hololive_music_marker_keys")).toEqual(beforeMarkers);
  });

  it("also verifies artifact imports and ignores a stale duplicate preference for a private MV", async () => {
    const db = await database();
    const artifactDirectory = directory();
    const videos = [
      video("audio000001", "Sora song (Official Audio)", { songName: "Sora song", duration: 180 }),
      video("musicvid001", "Sora song Official MV", { songName: "Sora song", duration: 190 })
    ];
    fs.writeFileSync(path.join(artifactDirectory, "holodex_videos.csv"), [
      "youtube_video_id,youtube_url,title,status,topic_id,channel_name,published_at",
      ...videos.map(candidate => `${candidate.id},https://youtu.be/${candidate.id},${candidate.title},past,Original_Song,SoraCh.,2026-10-30T03:00:00.000Z`)
    ].join("\n"));
    fs.writeFileSync(path.join(artifactDirectory, "holodex_video_details_cache.json"), JSON.stringify(Object.fromEntries(videos.map(candidate => [candidate.id, {
      youtube_video_id: candidate.id, channel_id: SORA_CHANNEL, duration: candidate.duration, song_names: ["Sora song"]
    }]))));
    fs.writeFileSync(path.join(artifactDirectory, "holodex_topic_duplicates.csv"), [
      "removed_youtube_video_id,removed_title,kept_youtube_video_id,kept_title,reason,song_name,removed_published_at,kept_published_at",
      "audio000001,Sora song (Official Audio),musicvid001,Sora song Official MV,official_audio_duplicate_of_mv,Sora song,2026-10-30,2026-10-30"
    ].join("\n"));
    const availabilityVerifier = vi.fn(async (_ids: string[]) => verified(videos, ["audio000001"]));
    const service = new HolodexMusicService(db, fetcher(videos), null, { availabilityVerifier });
    const result = await service.importArtifacts(artifactDirectory);
    expect(result.run.status).toBe("completed");
    expect(new Set(availabilityVerifier.mock.calls[0][0])).toEqual(new Set(videos.map(candidate => candidate.id)));
    expect(db.listHololiveMusicRows({}).map(candidate => candidate.youtubeVideoId)).toEqual(["audio000001"]);
    expect(db.select("SELECT * FROM hololive_music_exclusions")).toEqual([]);
  });
});
