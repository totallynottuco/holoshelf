import { describe, expect, it, vi } from "vitest";
import type { DatabaseService } from "./database";
import { HolodexMusicService } from "./holodexMusicService";
import type { HolodexArtifactBundle } from "../../src/modules/hololive/music/types";

const channel = (id: string) => ({ id, name: id, org: "Hololive", type: "vtuber" });
const item = (id: string, uploader = "official-1") => ({
  id, title: `Song ${id}`, type: "stream", topic_id: "Original_Song", status: "past",
  duration: 180, published_at: "2026-01-01T00:00:00.000Z", description: "",
  channel: channel(uploader), songs: [{ name: `Song ${id}` }], mentions: []
});

function fixture() {
  const imported = vi.fn((bundle: HolodexArtifactBundle) => ({ importedRows: bundle.rows.length, run: { status: "completed" } }));
  const failed = vi.fn(() => ({ run: { status: "failed" } }));
  const database = {
    getSettings: () => ({}),
    listHololiveChannels: () => ["official-1", "official-2"].map((id) => ({ ...channel(id), kind: "main" })),
    listHololiveIdols: () => [
      { id: "idol-1", source: "official" }, { id: "idol-2", source: "official" }, { id: "custom", source: "custom" }
    ],
    listHololiveIdolMainChannels: () => [
      { idolId: "idol-1", youtubeChannelId: "official-1" },
      { idolId: "idol-2", youtubeChannelId: "official-2" },
      { idolId: "custom", youtubeChannelId: "custom-channel" }
    ],
    listHolodexDetailCache: () => ({}),
    importHolodexMusicArtifacts: imported,
    recordFailedHolodexRefresh: failed
  } as unknown as DatabaseService;
  return { database, imported, failed };
}

describe("parallel Holodex refresh", () => {
  it("shares one quota between the channel and music phases", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(0);
      const { database } = fixture();
      database.listHololiveIdolMainChannels = () => [];
      database.refreshHolodexChannels = () => ({ refreshedChannels: 0, classifiedChannels: 0, updatedAt: "test" });
      const starts: number[] = [];
      const service = new HolodexMusicService(database, (async (input) => {
        starts.push(Date.now());
        return new URL(String(input)).pathname === "/api/v2/channels"
          ? Response.json([]) : Response.json({ total: 0, items: [] });
      }) as typeof fetch);
      const quota = { maxRequestsPerWindow: 1, requestWindowMs: 1000 };
      await service.refreshChannels(quota);
      const pending = service.refreshLive({ ...quota, includeChannels: false, includeCustomTalents: false, includeCollabs: false });
      await vi.advanceTimersByTimeAsync(0);
      expect(starts).toEqual([0]);
      await vi.advanceTimersByTimeAsync(2500);
      expect((await pending).run.status).toBe("completed");
      expect(starts).toEqual([0, 1250, 2500]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps sequential output and all collaboration links without refetching included details", async () => {
    async function run(concurrency: number) {
      const { database, imported } = fixture();
      const requested: string[] = [];
      const service = new HolodexMusicService(database, (async (input) => {
        const url = new URL(String(input));
        requested.push(String(input));
        await new Promise((resolve) => setImmediate(resolve));
        if (url.pathname === "/api/v2/videos") {
          if (url.searchParams.get("topic") === "Music_Cover") {
            return Response.json({ total: 0, items: [] });
          }
          const index = Number(url.searchParams.get("offset"));
          return Response.json({ total: 3, items: [item(`official-song-${index}`)] });
        }
        if (url.pathname.endsWith("/collabs")) {
          return Response.json({ total: 2, items: [item("external-song", "external-uploader"), item("official-song-0")] });
        }
        return new Response("unexpected detail request", { status: 500 });
      }) as typeof fetch, null, { requestConcurrency: concurrency });
      const result = await service.refreshLive({
        includeChannels: false, includeCustomTalents: false, pageSize: 1, maxRequestsPerWindow: 1000
      });
      expect(result.run.status).toBe("completed");
      expect(requested).toHaveLength(6);
      expect(requested.some((url) => url.includes("custom-channel"))).toBe(false);
      const bundle = imported.mock.calls[0][0];
      expect(bundle.rows.map((row) => row.youtubeVideoId)).toEqual([
        "official-song-0", "official-song-1", "official-song-2", "external-song"
      ]);
      expect(bundle.detailCache["external-song"].collabChannelIds).toEqual(["official-1", "official-2"]);
      expect(bundle.detailCache["external-song"].relationshipsLoaded).toBe(true);
      return bundle;
    }
    expect(await run(4)).toEqual(await run(1));
  });

  it("drains in-flight pages and records failure without importing a partial replacement", async () => {
    const { database, imported, failed } = fixture();
    let finalPageFinished = false;
    const service = new HolodexMusicService(database, (async (input) => {
      const url = new URL(String(input));
      if (url.searchParams.get("topic") === "Music_Cover") {
        return Response.json({ total: 0, items: [] });
      }
      const index = Number(url.searchParams.get("offset"));
      if (index === 1) {
        return new Response("failed page", { status: 500 });
      }
      if (index === 2) {
        await new Promise((resolve) => setImmediate(resolve));
        finalPageFinished = true;
      }
      return Response.json({ total: 3, items: [item(`song-${index}`)] });
    }) as typeof fetch);
    const result = await service.refreshLive({
      includeChannels: false, includeCustomTalents: false, includeCollabs: false,
      replaceExisting: true, pageSize: 1, maxRequestsPerWindow: 1000
    });
    expect(finalPageFinished).toBe(true);
    expect(result.run.status).toBe("failed");
    expect(failed).toHaveBeenCalledOnce();
    expect(imported).not.toHaveBeenCalled();
  });

  it("fetches full details when collaboration responses omit requested include fields", async () => {
    const { database, imported } = fixture();
    const detailRequests: string[] = [];
    const service = new HolodexMusicService(database, (async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/v2/videos") {
        return Response.json({ total: 0, items: [] });
      }
      if (url.pathname.endsWith("/collabs")) {
        const sparse: Partial<ReturnType<typeof item>> = item("external-song", "external-uploader");
        delete sparse.description;
        delete sparse.songs;
        delete sparse.mentions;
        return Response.json({ total: 1, items: [sparse] });
      }
      detailRequests.push(url.pathname);
      return Response.json({ ...item("external-song", "external-uploader"), description: "Full metadata" });
    }) as typeof fetch);
    const result = await service.refreshLive({ includeChannels: false, includeCustomTalents: false });
    expect(result.run.status).toBe("completed");
    expect(detailRequests).toEqual(["/api/v2/videos/external-song"]);
    expect(imported.mock.calls[0][0].detailCache["external-song"].description).toBe("Full metadata");
  });
});
