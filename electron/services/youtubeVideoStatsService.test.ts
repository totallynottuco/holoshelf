import { describe, expect, it, vi } from "vitest";
import type { DatabaseService } from "./database";
import { YouTubeVideoStatsService } from "./youtubeVideoStatsService";

function readyVideo(id: string, viewCount: unknown = "10") {
  return {
    id, snippet: { title: "Verified Song", channelId: "official-channel", channelTitle: "Official Artist" },
    contentDetails: { duration: "PT3M" }, statistics: { viewCount },
    status: { uploadStatus: "processed", privacyStatus: "public", embeddable: true }
  };
}

describe("YouTube statistics refresh batching", () => {
  it("bounds parallel requests, batches writes, and preserves HTTP failures", async () => {
    const ids = Array.from({ length: 251 }, (_, i) => String(i));
    const upsert = vi.fn();
    const unavailable = vi.fn();
    const database = {
      listHololiveMusicVideoIdsForStats: () => ids,
      getHololiveMusicSourceChannelMismatchReason: ({ youtubeVideoId }: { youtubeVideoId: string }) =>
        youtubeVideoId === "200" ? "wrong uploader" : null,
      upsertHololiveMusicVideoStats: upsert,
      deferHololiveMusicVideo: unavailable,
      restoreHololiveMusicVideoAvailability: vi.fn(() => false)
    } as unknown as DatabaseService;
    let active = 0;
    let maxActive = 0;
    const service = new YouTubeVideoStatsService(database, {
      apiKey: "test", requestConcurrency: 4,
      fetcher: (async (input) => {
        maxActive = Math.max(maxActive, ++active);
        await new Promise((resolve) => setImmediate(resolve));
        active -= 1;
        const requested = new URL(String(input)).searchParams.get("id")!.split(",");
        if (requested[0] === "50") {
          return new Response("unavailable", { status: 503 });
        }
        return Response.json({ items: requested.map((id) => ({
          ...readyVideo(id, "100"),
          status: { uploadStatus: "processed", privacyStatus: id === "100" ? "private" : "public", embeddable: true }
        })) });
      }) as typeof fetch
    });
    const result = await service.refreshViewCounts();
    expect(maxActive).toBe(4);
    expect(upsert.mock.calls.map(([stats]) => stats.length)).toEqual([149, 50]);
    expect(result).toMatchObject({ requestedVideos: 251, updatedVideos: 199, failedBatches: 1, unavailableVideos: 2, batches: 6 });
    expect(unavailable.mock.calls.map(([input]) => input.youtubeVideoId)).toEqual(["100", "200"]);
    expect(unavailable.mock.calls.map(([input]) => input.createBackup)).toEqual([true, false]);
  });

  it("does not remove videos when a successful HTTP response is malformed", async () => {
    const unavailable = vi.fn();
    const database = {
      listHololiveMusicVideoIdsForStats: () => ["keep-me"],
      upsertHololiveMusicVideoStats: vi.fn(),
      deferHololiveMusicVideo: unavailable,
      restoreHololiveMusicVideoAvailability: vi.fn(() => false)
    } as unknown as DatabaseService;
    const service = new YouTubeVideoStatsService(database, {
      apiKey: "test", fetcher: (async () => Response.json({ error: "bad response" })) as typeof fetch
    });
    expect(await service.refreshViewCounts()).toMatchObject({ updatedVideos: 0, failedBatches: 1, unavailableVideos: 0 });
    expect(unavailable).not.toHaveBeenCalled();
  });

  it("propagates storage failures instead of reporting them as failed HTTP batches", async () => {
    const database = {
      listHololiveMusicVideoIdsForStats: () => ["song"],
      getHololiveMusicSourceChannelMismatchReason: () => null,
      restoreHololiveMusicVideoAvailability: vi.fn(() => false),
      upsertHololiveMusicVideoStats: () => { throw new Error("disk full"); }
    } as unknown as DatabaseService;
    const service = new YouTubeVideoStatsService(database, {
      apiKey: "test", fetcher: (async () => Response.json({ items: [readyVideo("song", "1")] })) as typeof fetch
    });
    await expect(service.refreshViewCounts()).rejects.toThrow("disk full");
  });

  it.each(["123oops", "-1", "1.5", "", "9007199254740992", null])("fails malformed view count %j without storing partial results or removing videos", async (viewCount) => {
    const upsert = vi.fn();
    const unavailable = vi.fn();
    const database = {
      listHololiveMusicVideoIdsForStats: () => ["good", "invalid"],
      getHololiveMusicSourceChannelMismatchReason: () => null,
      upsertHololiveMusicVideoStats: upsert,
      deferHololiveMusicVideo: unavailable,
      restoreHololiveMusicVideoAvailability: vi.fn(() => false)
    } as unknown as DatabaseService;
    const service = new YouTubeVideoStatsService(database, {
      apiKey: "test", fetcher: (async () => Response.json({ items: [
        readyVideo("good", "10"), readyVideo("invalid", viewCount)
      ] })) as typeof fetch
    });
    expect(await service.refreshViewCounts()).toMatchObject({ updatedVideos: 0, failedBatches: 1, unavailableVideos: 0 });
    expect(upsert.mock.calls.flatMap(([rows]) => rows)).toEqual([]);
    expect(unavailable).not.toHaveBeenCalled();
  });

  it.each([["song", "song"], ["song", "unexpected"]])("rejects duplicate or unexpected response IDs %j", async (...returned) => {
    const unavailable = vi.fn();
    const database = {
      listHololiveMusicVideoIdsForStats: () => ["song"],
      upsertHololiveMusicVideoStats: vi.fn(),
      deferHololiveMusicVideo: unavailable,
      restoreHololiveMusicVideoAvailability: vi.fn(() => false)
    } as unknown as DatabaseService;
    const service = new YouTubeVideoStatsService(database, {
      apiKey: "test", fetcher: (async () => Response.json({ items: returned.map(id => readyVideo(id)) })) as typeof fetch
    });
    expect(await service.refreshViewCounts()).toMatchObject({ updatedVideos: 0, failedBatches: 1, unavailableVideos: 0 });
    expect(unavailable).not.toHaveBeenCalled();
  });

  it("retries throttling and server failures before persisting the successful result", async () => {
    const upsert = vi.fn();
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response("busy", { status: 429, headers: { 'Retry-After': '0' } }))
      .mockResolvedValueOnce(new Response("busy", { status: 503, headers: { 'Retry-After': '0' } }))
      .mockResolvedValueOnce(Response.json({ items: [readyVideo("song", "0")] }));
    const database = {
      listHololiveMusicVideoIdsForStats: () => ["song"],
      getHololiveMusicSourceChannelMismatchReason: () => null,
      restoreHololiveMusicVideoAvailability: vi.fn(() => false),
      upsertHololiveMusicVideoStats: upsert
    } as unknown as DatabaseService;
    const result = await new YouTubeVideoStatsService(database, { apiKey: "test", fetcher }).refreshViewCounts();
    expect(result).toMatchObject({ updatedVideos: 1, failedBatches: 0 });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(upsert.mock.calls[0][0][0].viewCount).toBe(0);
  });

  it("reports permanent failures immediately and redacts credentials from diagnostics", async () => {
    const log = vi.fn();
    const database = {
      listHololiveMusicVideoIdsForStats: () => ["song"],
      upsertHololiveMusicVideoStats: vi.fn()
    } as unknown as DatabaseService;
    const fetcher = vi.fn().mockResolvedValue(new Response("forbidden", { status: 403 }));
    const result = await new YouTubeVideoStatsService(database, { apiKey: "private-key", fetcher, log }).refreshViewCounts();
    expect(fetcher).toHaveBeenCalledOnce();
    expect(result.failedBatchDetails?.[0].reason).toContain("HTTP 403");
    expect(JSON.stringify(log.mock.calls)).not.toContain("private-key");
  });
});
