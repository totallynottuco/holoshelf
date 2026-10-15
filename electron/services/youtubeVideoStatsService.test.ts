import { describe, expect, it, vi } from "vitest";
import type { DatabaseService } from "./database";
import { YouTubeVideoStatsService } from "./youtubeVideoStatsService";

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
      markHololiveMusicVideoUnavailable: unavailable
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
          id, statistics: { viewCount: "100" },
          status: { privacyStatus: id === "100" ? "private" : "public" }
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
      markHololiveMusicVideoUnavailable: unavailable
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
      upsertHololiveMusicVideoStats: () => { throw new Error("disk full"); }
    } as unknown as DatabaseService;
    const service = new YouTubeVideoStatsService(database, {
      apiKey: "test", fetcher: (async () => Response.json({ items: [{ id: "song", statistics: { viewCount: "1" } }] })) as typeof fetch
    });
    await expect(service.refreshViewCounts()).rejects.toThrow("disk full");
  });
});
