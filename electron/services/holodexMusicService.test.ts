import { describe, expect, it, vi } from "vitest";
import type { DatabaseService } from "./database";
import { HolodexMusicService } from "./holodexMusicService";
import type { HolodexArtifactBundle } from "../../src/modules/hololive/music/types";
import { EXCLUDED_HOLODEX_CHANNEL_IDS } from "../../src/modules/hololive/music/types";

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
  it("keeps large-page output identical to small pages, including fresh details and collab links", async () => {
    async function run(pageSize: number, serverCap = pageSize) {
      const { database, imported } = fixture();
      const requests: URL[] = [];
      const service = new HolodexMusicService(database, (async (input) => {
        const url = new URL(String(input)); requests.push(url);
        if (url.pathname.endsWith('/collabs')) return Response.json({total: 1, items: [item('external', 'external-uploader')]});
        const topic = url.searchParams.get('topic')!;
        const total = topic === 'Music_Cover' ? 521 : 1003;
        const offset = Number(url.searchParams.get('offset'));
        const limit = Math.min(serverCap, Number(url.searchParams.get('limit')));
        return Response.json({total, items: Array.from({length: Math.min(limit, total-offset)}, (_, i) => ({
          ...item(`${topic}-${offset+i}`), topic_id: topic,
          description: `fresh description ${offset+i}`, mentions: [channel('official-2')]
        }))});
      }) as typeof fetch);
      const result = await service.refreshLive({pageSize, includeChannels:false, includeCustomTalents:false, maxRequestsPerWindow:10000});
      expect(result.run.status).toBe('completed');
      expect(service.getRefreshCoverage().complete).toBe(true);
      expect(service.getRefreshCoverage().topics.Original_Song.fetched).toBe(1003);
      return {bundle: imported.mock.calls[0][0], requests};
    }
    const small = await run(50);
    const large = await run(5000);
    const capped = await run(5000, 50);
    const intermediate = await run(5000, 500);
    expect(large.bundle).toEqual(small.bundle);
    expect(capped.bundle).toEqual(small.bundle);
    expect(intermediate.bundle).toEqual(small.bundle);
    expect(large.requests).toHaveLength(4); // Two video pages plus both collaboration queries.
    expect(intermediate.requests).toHaveLength(7);
    expect(small.requests).toHaveLength(34);
    expect(capped.requests.filter(url=>url.searchParams.get('topic')==='Music_Cover')[1].searchParams.get('offset')).toBe('50');
  });

  it.each(['truncated', 'duplicate', 'changed-total', 'wrong-topic', 'null-item', 'invalid-id'])("rejects %s pagination without replacing the catalog", async (failure) => {
    const {database, imported, failed} = fixture();
    const discard=vi.fn();
    const service = new HolodexMusicService(database, (async (input) => {
      const url = new URL(String(input));
      if(url.searchParams.get('topic')==='Music_Cover') return Response.json({total:0,items:[]});
      const offset=Number(url.searchParams.get('offset'));
      if(failure==='null-item') return Response.json({total:3,items:[null]});
      if(failure==='invalid-id') return Response.json({total:3,items:[{...item('song'),id:8}]});
      return Response.json({total:failure==='changed-total' && offset>0 ? 4 : 3, items:
        offset>0 && failure==='truncated' ? [] : [{...item(failure==='duplicate' ? 'same' : `song-${offset}`),
          topic_id:failure==='wrong-topic' ? 'singing' : 'Original_Song'}]});
    }) as typeof fetch, null, {responseCache:{read:async()=>null,write:async()=>{},discard}});
    const result=await service.refreshLive({includeChannels:false,includeCustomTalents:false,includeCollabs:false,pageSize:1,maxRequestsPerWindow:1000});
    expect(result.run.status).toBe('failed');
    expect(imported).not.toHaveBeenCalled();
    expect(failed).toHaveBeenCalledOnce();
    expect(discard).toHaveBeenCalledOnce();
  });

  it("continues channel pagination after filtering excluded channels from a full page", async () => {
    const {database} = fixture();
    const links = database.listHololiveIdolMainChannels();
    database.listHololiveIdolMainChannels = () => links.filter(link => link.idolId !== "custom");
    const refreshed=vi.fn(channels=>({refreshedChannels:channels.length,classifiedChannels:channels.length,updatedAt:'test'}));
    database.refreshHolodexChannels=refreshed;
    const offsets:number[]=[];
    const service=new HolodexMusicService(database,(async(input)=>{
      const offset=Number(new URL(String(input)).searchParams.get('offset'));offsets.push(offset);
      return Response.json(offset===0 ? [
        ...Array.from({length:34},(_,i)=>channel(`official-${i}`)),
        ...[...EXCLUDED_HOLODEX_CHANNEL_IDS].slice(0,16).map(channel)
      ] : [channel('last-official')]);
    }) as typeof fetch);
    expect((await service.refreshChannels()).refreshedChannels).toBe(35);
    expect(offsets).toEqual([0,50]);
  });

  it.each([false, true])("fully fetches channels when larger pages are rejected: %s", async rejected => {
    const {database} = fixture();
    const links = database.listHololiveIdolMainChannels();
    database.listHololiveIdolMainChannels = () => links.filter(link => link.idolId !== "custom");
    const refreshed = vi.fn(channels => ({refreshedChannels: channels.length, classifiedChannels: channels.length, updatedAt: "test"}));
    database.refreshHolodexChannels = refreshed;
    const all = Array.from({length: 138}, (_, i) => channel(`official-${i}`));
    const offsets: number[] = [];
    const service = new HolodexMusicService(database, (async input => {
      const url = new URL(String(input));
      const offset = Number(url.searchParams.get("offset"));
      const limit = Number(url.searchParams.get("limit"));
      offsets.push(offset);
      if (rejected && limit > 50) return new Response("unsupported limit", {status: 400});
      return Response.json(all.slice(offset, offset + limit));
    }) as typeof fetch);
    expect((await service.refreshChannels()).refreshedChannels).toBe(138);
    expect(offsets).toEqual(rejected ? [0, 0, 50, 100] : [0]);
  });

  it("rejects repeated channel pages before replacing channel metadata", async () => {
    const {database} = fixture();
    database.refreshHolodexChannels = vi.fn();
    const page = Array.from({length: 500}, (_, i) => channel(`official-${i}`));
    const service = new HolodexMusicService(database, (async () => Response.json(page)) as typeof fetch);
    await expect(service.refreshChannels()).rejects.toThrow("repeated a channel");
    expect(database.refreshHolodexChannels).not.toHaveBeenCalled();
  });

  it("falls back to complete small pages if the API rejects a larger limit", async () => {
    const {database, imported} = fixture();
    const service=new HolodexMusicService(database,(async(input)=>{
      const url=new URL(String(input));
      if(Number(url.searchParams.get('limit'))>50) return new Response('unsupported limit',{status:400});
      if(url.searchParams.get('topic')==='Music_Cover') return Response.json({total:0,items:[]});
      const offset=Number(url.searchParams.get('offset'));
      return Response.json({total:51,items:Array.from({length:Math.min(50,51-offset)},(_,i)=>item(`song-${offset+i}`))});
    }) as typeof fetch);
    const result=await service.refreshLive({includeChannels:false,includeCustomTalents:false,includeCollabs:false,maxRequestsPerWindow:1000});
    expect(result.run.status).toBe('completed');
    expect(imported.mock.calls[0][0].rows).toHaveLength(51);
    expect(service.getRefreshCoverage().topics.Original_Song).toMatchObject({pageSize:50,complete:true,fetched:51});
  });

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
