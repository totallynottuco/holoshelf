import { describe, expect, it, vi } from "vitest";
import type { DatabaseService } from "./database";
import {
  classifyYouTubeVideoAvailability,
  YouTubeVideoNotReadyError,
  YouTubeVideoStatsService,
  type YouTubeVideosApiItem
} from "./youtubeVideoStatsService";

function video(id = "ready-video", overrides: Partial<YouTubeVideosApiItem> = {}): YouTubeVideosApiItem {
  return {
    id, snippet: { title: "Verified music video", channelId: "official-channel", channelTitle: "Official Artist", liveBroadcastContent: "none" },
    contentDetails: { duration: "PT3M21S" }, statistics: { viewCount: "12345" },
    status: { uploadStatus: "processed", privacyStatus: "public", embeddable: true }, ...overrides
  };
}

function statsDatabase(ids: string[]) {
  const methods = {
    listHololiveMusicVideoIdsForStats: vi.fn(() => ids),
    getSettings: vi.fn(() => ({})),
    getHololiveMusicSourceChannelMismatchReason: vi.fn((_input: { youtubeVideoId: string }): string | null => null),
    restoreHololiveMusicVideoAvailability: vi.fn(() => false),
    upsertHololiveMusicVideoStats: vi.fn(),
    deferHololiveMusicVideo: vi.fn(() => true),
    repairVerifiedHololiveMusicAudioMirrors: vi.fn(() => 0)
  };
  return { methods, database: methods as unknown as DatabaseService };
}

async function verified(ids: string[], missing: string[] = []) {
  const checker = new YouTubeVideoStatsService({} as DatabaseService, {
    apiKey: "verification-test-key",
    fetcher: async () => Response.json({ items: ids.filter((id) => !missing.includes(id)).map((id) => video(id)) })
  });
  return checker.checkAvailability({ youtubeVideoIds: ids });
}

describe("YouTube availability evidence", () => {
  it.each(["public", "unlisted"])("accepts positively verified %s media", (privacyStatus) => {
    expect(classifyYouTubeVideoAvailability(video("ready", { status: { uploadStatus: "processed", privacyStatus, embeddable: true } })).state).toBe("ready");
  });

  it.each([
    undefined,
    video("private", { status: { uploadStatus: "processed", privacyStatus: "private", embeddable: true } }),
    video("processing", { status: { uploadStatus: "uploaded", privacyStatus: "public", embeddable: true } }),
    video("unknown-status", { status: undefined }),
    video("unknown-embed", { status: { uploadStatus: "processed", privacyStatus: "public" } }),
    video("not-embeddable", { status: { uploadStatus: "processed", privacyStatus: "public", embeddable: false } }),
    video("no-media", { contentDetails: { duration: "PT0S" } }),
    video("unknown-media", { contentDetails: {} }),
    video("no-title", { snippet: { channelId: "official-channel" } })
  ])("defers videos lacking positive playback evidence", (item) => {
    expect(classifyYouTubeVideoAvailability(item).state).toBe("deferred");
  });

  it.each(["deleted", "failed", "rejected"])("recognizes terminal upload state %s without assuming it is a user exclusion", (uploadStatus) => {
    expect(classifyYouTubeVideoAvailability(video("terminal", { status: { uploadStatus } })).state).toBe("unavailable");
  });

  it.each(["live", "upcoming"])("permits a real %s preview even before it has an archive duration", (liveBroadcastContent) => {
    const item = video("preview", {
      snippet: { title: "Music premiere", channelId: "official-channel", liveBroadcastContent },
      status: { uploadStatus: "uploaded", privacyStatus: "public", embeddable: true },
      contentDetails: { duration: "PT0S" }, liveStreamingDetails: { scheduledStartTime: "2026-11-02T15:00:00Z" }
    });
    expect(classifyYouTubeVideoAvailability(item).state).toBe("ready");
    expect(classifyYouTubeVideoAvailability({ ...item, liveStreamingDetails: undefined }).state).toBe("deferred");
    expect(classifyYouTubeVideoAvailability({ ...item, liveStreamingDetails: { scheduledStartTime: "not-a-date" } }).state).toBe("deferred");
    expect(classifyYouTubeVideoAvailability({ ...item, status: { ...item.status, privacyStatus: "private" } }).state).toBe("deferred");
  });

  it("does not treat a finished stream with no archive media as a live preview", () => {
    const item = video("finished", {
      snippet: { title: "Premiere", channelId: "official-channel", liveBroadcastContent: "live" }, contentDetails: { duration: "PT0S" },
      liveStreamingDetails: { actualStartTime: "2026-10-01T15:00:00Z", actualEndTime: "2026-10-01T16:00:00Z" }
    });
    expect(classifyYouTubeVideoAvailability(item).state).toBe("deferred");
  });

  it("rejects worldwide embargoes while retaining music available in some countries", () => {
    const countryCodes = "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW".split(" ");
    expect(countryCodes).toHaveLength(249);
    expect(classifyYouTubeVideoAvailability(video("embargo", { contentDetails: { duration: "PT3M", regionRestriction: { blocked: countryCodes } } })).state).toBe("deferred");
    expect(classifyYouTubeVideoAvailability(video("empty-allowed", { contentDetails: { duration: "PT3M", regionRestriction: { allowed: [] } } })).state).toBe("deferred");
    const restricted = video("restricted", { contentDetails: { duration: "PT3M", regionRestriction: { blocked: ["US"] } } });
    expect(classifyYouTubeVideoAvailability(restricted).state).toBe("ready");
    expect(classifyYouTubeVideoAvailability(restricted, "US").state).toBe("deferred");
    expect(classifyYouTubeVideoAvailability(restricted, "JP").state).toBe("ready");
  });

  it("checks the installed playback country while retaining public catalog entries playable elsewhere", async () => {
    const restricted = video("restricted", { contentDetails: { duration: "PT3M", regionRestriction: { blocked: ["US"] } } });
    const unlisted = video("unlisted", {
      contentDetails: { duration: "PT3M", regionRestriction: { allowed: ["US", "JP"] } },
      status: { uploadStatus: "processed", privacyStatus: "unlisted", embeddable: true }
    });
    const fetcher = vi.fn(async () => Response.json({ items: [restricted, unlisted] }));
    const database = { getSettings: () => ({ "sources.youtubeRegionCode": " us " }) } as unknown as DatabaseService;
    const local = new YouTubeVideoStatsService(database, { apiKey: "test-key", fetcher });
    const checked = await local.checkAvailability({ youtubeVideoIds: ["restricted", "unlisted"] });
    expect(checked.regionCode).toBe("US");
    expect(checked.availableVideoIds).toEqual(["unlisted"]);
    expect(checked.deferredVideos).toEqual([{ youtubeVideoId: "restricted", reason: "YouTube does not currently allow playback in US." }]);
    const global = new YouTubeVideoStatsService({} as DatabaseService, { apiKey: "test-key", fetcher });
    expect(await global.checkAvailability({ youtubeVideoIds: ["restricted", "unlisted"] }))
      .toMatchObject({ regionCode: null, availableVideoIds: ["restricted", "unlisted"], deferredVideos: [] });
    expect(await local.checkAvailability({ youtubeVideoIds: ["restricted", "unlisted"], regionCode: "JP" }))
      .toMatchObject({ regionCode: "JP", availableVideoIds: ["restricted", "unlisted"] });
    expect(await local.checkAvailability({ youtubeVideoIds: ["restricted", "unlisted"], regionCode: null }))
      .toMatchObject({ regionCode: null, availableVideoIds: ["restricted", "unlisted"] });
  });

  it("soft-defers region-blocked statistics without replacing them or using them for duplicate repair", async () => {
    const { database, methods } = statsDatabase(["restricted", "allowed"]);
    methods.getSettings.mockReturnValue({ "sources.youtubeRegionCode": "US" });
    const service = new YouTubeVideoStatsService(database, { apiKey: "test-key", fetcher: async () => Response.json({ items: [
      video("restricted", { contentDetails: { duration: "PT3M", regionRestriction: { blocked: ["US"] } } }), video("allowed")
    ] }) });
    expect(await service.refreshViewCounts()).toMatchObject({ updatedVideos: 1, unavailableVideos: 1, failedBatches: 0 });
    expect(methods.deferHololiveMusicVideo).toHaveBeenCalledExactlyOnceWith({
      youtubeVideoId: "restricted", reason: "YouTube does not currently allow playback in US.", createBackup: true
    });
    expect(methods.restoreHololiveMusicVideoAvailability).toHaveBeenCalledExactlyOnceWith("allowed");
    expect(methods.repairVerifiedHololiveMusicAudioMirrors).toHaveBeenCalledExactlyOnceWith(["allowed"]);
    expect(methods.upsertHololiveMusicVideoStats.mock.calls[0][0].map((stat: { youtubeVideoId: string }) => stat.youtubeVideoId)).toEqual(["allowed"]);
  });

  it("applies the configured playback region to both custom previews and saves", async () => {
    const service = new YouTubeVideoStatsService({ getSettings: () => ({ "sources.youtubeRegionCode": "US" }) } as unknown as DatabaseService,
      { apiKey: "test-key", fetcher: async input => {
        const id = new URL(String(input)).searchParams.get("id")!;
        return Response.json({ items: [video(id, {
          contentDetails: { duration: "PT3M", regionRestriction: id === "abcDEF12345" ? { blocked: ["US"] } : { allowed: ["US"] } },
          status: { uploadStatus: "processed", privacyStatus: "unlisted", embeddable: true }
        })] });
      } });
    await expect(service.previewCustomSong({ youtubeUrl: "https://youtu.be/abcDEF12345" })).rejects.toThrow("playback in US");
    await expect(service.enrichCustomSongUpsert({ youtubeUrl: "https://youtu.be/abcDEF12345", title: "Blocked song", topicId: "Original_Song", ownerIdolIds: [] }))
      .rejects.toBeInstanceOf(YouTubeVideoNotReadyError);
    await expect(service.previewCustomSong({ youtubeUrl: "https://youtu.be/abcDEF67890" }))
      .resolves.toMatchObject({ youtubeVideoId: "abcDEF67890", usedApi: true, durationSeconds: 180 });
    await expect(service.enrichCustomSongUpsert({ youtubeUrl: "https://youtu.be/abcDEF67890", title: "Unlisted song", topicId: "Original_Song", ownerIdolIds: [] }))
      .resolves.toMatchObject({ youtubeUrl: "https://www.youtube.com/watch?v=abcDEF67890", durationSeconds: 180 });
  });

  it.each([false, true])("never reuses a global availability cache for a configured country: legacy=%s", async (legacy) => {
    const cache = await verified(["restricted"]);
    if (legacy) delete cache.regionCode;
    const { database, methods } = statsDatabase(["restricted"]);
    methods.getSettings.mockReturnValue({ "sources.youtubeRegionCode": "US" });
    const fetcher = vi.fn(async () => Response.json({ items: [video("restricted", { contentDetails: { duration: "PT3M", regionRestriction: { blocked: ["US"] } } })] }));
    const service = new YouTubeVideoStatsService(database, { apiKey: "test-key", fetcher });
    expect(await service.refreshViewCounts({}, cache)).toMatchObject({ updatedVideos: 0, unavailableVideos: 1, batches: 1 });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(methods.restoreHololiveMusicVideoAvailability).not.toHaveBeenCalled();
  });

  it("reuses fresh matching-country verification but rechecks a different country's deferral", async () => {
    const { database, methods } = statsDatabase(["restricted"]);
    methods.getSettings.mockReturnValue({ "sources.youtubeRegionCode": "US" });
    const fetcher = vi.fn(async () => Response.json({ items: [video("restricted", { contentDetails: { duration: "PT3M", regionRestriction: { blocked: ["US"] } } })] }));
    const service = new YouTubeVideoStatsService(database, { apiKey: "test-key", fetcher });
    const cache = await service.checkAvailability({ youtubeVideoIds: ["restricted"] });
    expect(cache.regionCode).toBe("US");
    fetcher.mockClear();
    expect(await service.refreshViewCounts({}, cache)).toMatchObject({ updatedVideos: 0, unavailableVideos: 1, batches: 0 });
    expect(fetcher).not.toHaveBeenCalled();
    methods.getSettings.mockReturnValue({ "sources.youtubeRegionCode": "JP" });
    expect(await service.refreshViewCounts({}, cache)).toMatchObject({ updatedVideos: 1, unavailableVideos: 0, batches: 1 });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("checks new candidates in 50-video batches without writing to the database", async () => {
    const writes = vi.fn();
    const database = new Proxy({}, { get: (_target, property) => property === "getSettings" ? () => ({}) : writes }) as DatabaseService;
    const fetcher = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      const url = new URL(String(input));
      expect(url.searchParams.get("fields")).toContain("regionRestriction");
      expect(url.searchParams.get("fields")).toContain("liveStreamingDetails");
      const ids = url.searchParams.get("id")!.split(",");expect(ids.length).toBeLessThanOrEqual(50);
      return Response.json({ items: ids.filter((id) => id !== "missing").map((id) => video(id, id === "private" ? {
        status: { uploadStatus: "processed", privacyStatus: "private", embeddable: true }
      } : {})) });
    });
    const service = new YouTubeVideoStatsService(database, { apiKey: "private-test-key", fetcher });
    const ids = [...Array.from({ length: 100 }, (_, index) => `song-${index}`), "private", "missing"];
    const result = await service.checkAvailability({ youtubeVideoIds: [...ids, ids[0]] });
    expect(fetcher).toHaveBeenCalledTimes(3);expect(writes).not.toHaveBeenCalled();
    expect(result.requestedVideos).toBe(102);expect(result.availableVideoIds).toHaveLength(100);
    expect(result.deferredVideos.map((item) => item.youtubeVideoId)).toEqual(["private", "missing"]);
    expect(result.stats[0]).toMatchObject({ durationSeconds: 201, title: "Verified music video", status: "past", viewCount: 12345 });
  });

  it.each([
    () => Response.json({ items: [video("unexpected-id")] }),
    () => Response.json({ items: [video("requested"), video("requested")] }),
    () => Response.json({ items: [video("requested", { statistics: { viewCount: "garbled" } })] }),
    () => Response.json({ error: "bad response" }),
    () => new Response("authorization failed", { status: 403 })
  ])("fails closed on malformed or failed API checks without changing the library", async (response) => {
    const writes = vi.fn();const database = new Proxy({}, { get: (_target, property) => property === "getSettings" ? () => ({}) : writes }) as DatabaseService;
    const service = new YouTubeVideoStatsService(database, { apiKey: "private-test-key", fetcher: async () => response() });
    await expect(service.checkAvailability({ youtubeVideoIds: ["requested"] })).rejects.toThrow("verification failed");
    expect(writes).not.toHaveBeenCalled();
  });

  it("redacts credentials in failed request diagnostics", async () => {
    const key = "private-test-key";
    const service = new YouTubeVideoStatsService({} as DatabaseService, { apiKey: key, fetcher: async () => { throw new Error(`request failed key=${key}`); } });
    await expect(service.checkAvailability({ youtubeVideoIds: ["requested"] })).rejects.toThrow("key=[redacted]");
  });

  it("rejects a globally blocked custom-song preview with a typed availability error", async () => {
    const service = new YouTubeVideoStatsService({} as DatabaseService, { apiKey: "test-key", fetcher: async () => Response.json({
      items: [video("abcDEF12345", { contentDetails: { duration: "PT3M", regionRestriction: { allowed: [] } } })]
    }) });
    await expect(service.previewCustomSong({ youtubeUrl: "https://youtu.be/abcDEF12345" })).rejects.toBeInstanceOf(YouTubeVideoNotReadyError);
  });

  it("does not save manually supplied custom metadata without a successful availability check", async () => {
    const fetcher = vi.fn();
    const service = new YouTubeVideoStatsService({ getSettings: () => ({}) } as unknown as DatabaseService, { fetcher });
    await expect(service.enrichCustomSongUpsert({
      youtubeUrl: "https://youtu.be/abcDEF12345", title: "Manual song", topicId: "Original_Song",
      ownerIdolIds: ["tokino-sora"], publishedAt: "2026-11-01"
    })).rejects.toThrow("required to verify");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("reuses all freshly verified statistics without another API request or key lookup", async () => {
    const cache = await verified(["first", "second"]);
    const { database, methods } = statsDatabase(["first", "second"]);
    const fetcher = vi.fn();const log = vi.fn();
    const service = new YouTubeVideoStatsService(database, { fetcher, log });
    const result = await service.refreshViewCounts({}, cache);
    expect(fetcher).not.toHaveBeenCalled();expect(methods.getSettings).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ requestedVideos: 2, updatedVideos: 2, batches: 0, fetchedAt: cache.checkedAt, failedBatches: 0 });
    expect(methods.upsertHololiveMusicVideoStats).toHaveBeenCalledWith(cache.stats);
    expect(methods.repairVerifiedHololiveMusicAudioMirrors).toHaveBeenCalledExactlyOnceWith(["first", "second"]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("reused 2 fresh availability result"));
  });

  it("fetches only uncached retained songs and keeps the verification timestamp consistent", async () => {
    const cache = await verified(["first"]);
    const { database, methods } = statsDatabase(["first", "second"]);
    const fetcher = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      expect(new URL(String(input)).searchParams.get("id")).toBe("second");
      return Response.json({ items: [video("second")] });
    });
    const service = new YouTubeVideoStatsService(database, { apiKey: "test-key", fetcher });
    const result = await service.refreshViewCounts({}, cache);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ requestedVideos: 2, updatedVideos: 2, batches: 1, fetchedAt: cache.checkedAt });
    const written = methods.upsertHololiveMusicVideoStats.mock.calls.flatMap(([stats]) => stats);
    expect(written.map((stat) => stat.youtubeVideoId)).toEqual(["first", "second"]);
    expect(written.every((stat) => stat.fetchedAt === cache.checkedAt)).toBe(true);
  });

  it("applies cached deferrals without making another request or permanently excluding the song", async () => {
    const cache = await verified(["not-public"], ["not-public"]);
    const { database, methods } = statsDatabase(["not-public"]);const fetcher = vi.fn();
    const service = new YouTubeVideoStatsService(database, { fetcher });
    const result = await service.refreshViewCounts({}, cache);
    expect(fetcher).not.toHaveBeenCalled();expect(methods.getSettings).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ updatedVideos: 0, unavailableVideos: 1, batches: 0, failedBatches: 0 });
    expect(methods.deferHololiveMusicVideo).toHaveBeenCalledWith({
      youtubeVideoId: "not-public", reason: cache.deferredVideos[0].reason, createBackup: true
    });
  });

  it.each(["expired", "old-stat", "missing-stat"])("does not mistake %s data for a fresh verified statistic", async (kind) => {
    const cache = await verified(["retained"]);
    const old = new Date(Date.now() - 11 * 60_000).toISOString();
    if (kind === "expired") cache.checkedAt = old;
    if (kind === "old-stat") cache.stats[0].fetchedAt = old;
    if (kind === "missing-stat") cache.stats = [];
    const { database } = statsDatabase(["retained"]);
    const fetcher = vi.fn(async () => Response.json({ items: [video("retained")] }));
    const service = new YouTubeVideoStatsService(database, { apiKey: "test-key", fetcher });
    expect((await service.refreshViewCounts({}, cache)).updatedVideos).toBe(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("repairs mirrors only from validated IDs after all unavailable candidates have been deferred", async () => {
    const readyIds = Array.from({ length: 48 }, (_, index) => `ready-${index}`);
    const ids = [...readyIds, "wrong-uploader", "private", "missing"];
    const { database, methods } = statsDatabase(ids);
    methods.getHololiveMusicSourceChannelMismatchReason.mockImplementation((input) =>
      input.youtubeVideoId === "wrong-uploader" ? "Wrong uploader" : null);
    const fetcher = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      const requested = new URL(String(input)).searchParams.get("id")!.split(",");
      return Response.json({ items: requested.filter((id) => id !== "missing").map((id) => video(id, id === "private" ? {
        status: { uploadStatus: "processed", privacyStatus: "private", embeddable: true }
      } : {})) });
    });
    const service = new YouTubeVideoStatsService(database, { apiKey: "test-key", fetcher, requestConcurrency: 1 });
    expect(await service.refreshViewCounts()).toMatchObject({ updatedVideos: 48, unavailableVideos: 3, failedBatches: 0, batches: 2 });
    expect(methods.repairVerifiedHololiveMusicAudioMirrors).toHaveBeenCalledExactlyOnceWith(readyIds);
    expect(methods.repairVerifiedHololiveMusicAudioMirrors.mock.invocationCallOrder[0]).toBeGreaterThan(
      Math.max(...methods.deferHololiveMusicVideo.mock.invocationCallOrder)
    );
  });
});
