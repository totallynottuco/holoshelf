import { describe, expect, it, vi } from "vitest";
import {
  buildHolodexSearchPayload,
  HolodexApiClient,
  makeCatalogRowsFromRecords,
  normalizeHolodexVideoItemDetail,
  parseHolodexCount,
  parseHolodexSearchUrl
} from "./holodexClient";
import { HOLODEX_DEFAULT_SEARCH_URL } from "./types";

describe("Holodex client helpers", () => {
  it.each([null, {items:[],total:'2'}, {items:[],total:-1}, {error:'bad response'}, []])("rejects malformed paginated videos %j", async body => {
    const client=new HolodexApiClient(null,(async()=>Response.json(body)) as typeof fetch);
    await expect(client.fetchVideosPage({topicId:'Music_Cover',videoType:'stream',pageSize:500})).rejects.toThrow('valid items or its total');
  });

  it("retries transport and server errors with bounded attempts", async () => {
    vi.useFakeTimers();
    try {
      const fetcher=vi.fn().mockRejectedValueOnce(new TypeError('network failure'))
        .mockResolvedValueOnce(new Response('temporary failure',{status:503}))
        .mockResolvedValueOnce(Response.json([]));
      const client=new HolodexApiClient(null,fetcher,{maxRequests:76,windowMs:120000});
      const pending=client.fetchChannelsPage();
      await vi.advanceTimersByTimeAsync(2000);
      expect(await pending).toEqual([]);
      expect(fetcher).toHaveBeenCalledTimes(3);
      expect(client.getRequestMetrics()).toEqual({requests:3,retries:2});
    } finally { vi.useRealTimers(); }
  });

  it("enforces the same rolling quota across simultaneous requests", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(0);
      const starts: number[] = [];
      const client = new HolodexApiClient(null, (async () => {
        starts.push(Date.now());
        return Response.json([]);
      }) as typeof fetch, { maxRequests: 2, windowMs: 1000 });
      const pending = Promise.all(Array.from({ length: 5 }, () => client.fetchChannelsPage()));
      await vi.advanceTimersByTimeAsync(0);
      expect(starts).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(1250);
      expect(starts).toHaveLength(4);
      await vi.advanceTimersByTimeAsync(1250);
      await pending;
      expect(starts).toEqual([0, 0, 1250, 1250, 2500]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("shares Retry-After cooldown with newly queued requests", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(0);
      const starts: number[] = [];
      const client = new HolodexApiClient(null, (async () => {
        starts.push(Date.now());
        return starts.length === 1
          ? new Response("slow down", { status: 429, headers: { "Retry-After": "2" } })
          : Response.json([]);
      }) as typeof fetch, { maxRequests: 100, windowMs: 1000 });
      const first = client.fetchChannelsPage();
      await vi.advanceTimersByTimeAsync(0);
      const pending = Promise.all([first, client.fetchChannelsPage(), client.fetchChannelsPage()]);
      await vi.advanceTimersByTimeAsync(1999);
      expect(starts).toEqual([0]);
      await vi.advanceTimersByTimeAsync(1);
      await pending;
      expect(starts).toEqual([0, 2000, 2000, 2000]);
      expect(client.getRequestMetrics()).toEqual({ requests: 4, retries: 1 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("builds the default Holodex search payload for covers and originals", () => {
    const parsed = parseHolodexSearchUrl(HOLODEX_DEFAULT_SEARCH_URL);
    const payload = buildHolodexSearchPayload({
      rows: parsed.rows,
      pageNumber: 2,
      pageSize: 30
    });

    expect(payload.topic).toEqual(["Music_Cover", "Original_Song"]);
    expect(payload.org).toEqual(["Hololive"]);
    expect(payload.lang).toEqual(["en"]);
    expect(payload.target).toEqual(["stream"]);
    expect(payload.offset).toBe(30);
    expect(payload.limit).toBe(30);
  });

  it("parses advanced search CSV rows with quoted commas", () => {
    const searchUrl = `https://holodex.net/search?q=${encodeURIComponent(
      ['type,value,text', 'topic,Music_Cover,"Music, Cover"', 'org,Hololive,Hololive'].join("\n")
    )}&page=1`;

    const parsed = parseHolodexSearchUrl(searchUrl);

    expect(parsed.rows).toEqual([
      { type: "topic", value: "Music_Cover", text: "Music, Cover" },
      { type: "org", value: "Hololive", text: "Hololive" }
    ]);
  });

  it("parses channel counts from strings and numbers", () => {
    expect(parseHolodexCount("1,234,567")).toBe(1234567);
    expect(parseHolodexCount(42.2)).toBe(42);
    expect(parseHolodexCount("")).toBeNull();
    expect(parseHolodexCount(null)).toBeNull();
  });

  it("normalizes video details with channel stats, mentions, and songs", async () => {
    const fetcher = async () =>
      new Response(
        JSON.stringify({
          channel: {
            id: "uploader",
            name: "Uploader",
            english_name: "Uploader EN",
            org: "Hololive",
            group: "Official",
            photo: "https://example.com/photo.jpg",
            video_count: "1,000",
            subscriber_count: 500,
            clip_count: "30"
          },
          duration: "180",
          original_channel_id: "owner",
          description: "Provided to YouTube by example",
          songs: [{ name: "Song Name" }],
          mentions: [{ id: "mentioned", name: "Mentioned", english_name: "Mentioned EN", org: "Hololive" }]
        })
      );
    const client = new HolodexApiClient("key", fetcher as typeof fetch);

    const detail = await client.fetchVideoDetail("video");

    expect(detail.channel?.subscriberCount).toBe(500);
    expect(detail.providedToYoutube).toBe(true);
    expect(detail.description).toBe("Provided to YouTube by example");
    expect(detail.songNames).toEqual(["Song Name"]);
    expect(detail.mentions.map((mention) => mention.channelId)).toEqual(["mentioned"]);
    expect(detail.relationshipsLoaded).toBe(true);
  });

  it("fetches paginated video rows with songs and mention includes", async () => {
    const requestedUrls: string[] = [];
    const fetcher = async (url: string | URL | Request) => {
      requestedUrls.push(String(url));
      return new Response(
        JSON.stringify({
          total: 1,
          items: [
            {
              id: "song-video",
              title: "Song Video",
              type: "stream",
              topic_id: "Original_Song",
              status: "past",
              published_at: "2026-01-01T00:00:00.000Z",
              duration: 180,
              description: "Provided to YouTube by example",
              original_channel_id: "owner-channel",
              songs: [{ name: "Song Name" }],
              mentions: [{ id: "mentioned-channel", name: "Mentioned", english_name: "Mentioned EN", org: "Hololive" }],
              channel_id: "topic-channel",
              channel: { id: "topic-channel", name: "Topic Channel", org: "Hololive" }
            }
          ]
        })
      );
    };
    const client = new HolodexApiClient("key", fetcher as typeof fetch);

    const page = await client.fetchVideosPage({
      topicId: "Original_Song",
      videoType: "stream",
      pageNumber: 2,
      pageSize: 50
    });
    const detail = normalizeHolodexVideoItemDetail("song-video", page.items[0], true);

    expect(requestedUrls[0]).toContain("/api/v2/videos?");
    expect(requestedUrls[0]).toContain("topic=Original_Song");
    expect(requestedUrls[0]).toContain("type=stream");
    expect(requestedUrls[0]).toContain("include=mentions%2Csongs%2Cdescription");
    expect(page.total).toBe(1);
    expect(detail.songNames).toEqual(["Song Name"]);
    expect(detail.providedToYoutube).toBe(true);
    expect(detail.originalChannelId).toBe("owner-channel");
    expect(detail.mentions.map((mention) => mention.channelId)).toEqual(["mentioned-channel"]);
  });

  it("omits relationship include parameters when relationship loading is disabled", async () => {
    const requestedUrls: string[] = [];
    const fetcher = async (url: string | URL | Request) => {
      requestedUrls.push(String(url));
      return new Response(
        JSON.stringify({
          channel: { id: "uploader", name: "Uploader" },
          duration: 180,
          songs: [{ name: "Song Name" }],
          mentions: [{ id: "mentioned", name: "Mentioned" }]
        })
      );
    };
    const client = new HolodexApiClient("key", fetcher as typeof fetch);

    const detail = await client.fetchVideoDetail("video", { includeRelationships: false });

    expect(requestedUrls[0]).not.toContain("include=");
    expect(detail.relationshipsLoaded).toBe(false);
  });


  it("normalizes search records into unique catalog rows", () => {
    const rows = makeCatalogRowsFromRecords([
      {
        sourcePage: 1,
        positionOnPage: 1,
        sourcePageUrl: "https://holodex.net/search",
        holodexWatchId: "abc",
        holodexWatchUrl: "https://holodex.net/watch/abc",
        youtubeVideoId: "abc",
        youtubeUrl: "https://www.youtube.com/watch?v=abc",
        title: "Song",
        itemType: "stream",
        status: "past",
        topicId: "Original_Song",
        channelId: "channel",
        channelName: "Talent Ch.",
        channelEnglishName: "",
        channelType: "",
        channelOrg: "Hololive",
        channelSuborg: "",
        publishedAt: "2026-01-01T00:00:00.000Z",
        duration: 180
      },
      {
        sourcePage: 1,
        positionOnPage: 2,
        sourcePageUrl: "https://holodex.net/search",
        holodexWatchId: "abc",
        holodexWatchUrl: "https://holodex.net/watch/abc",
        youtubeVideoId: "abc",
        youtubeUrl: "https://www.youtube.com/watch?v=abc",
        title: "Duplicate",
        itemType: "stream",
        status: "past",
        topicId: "Music_Cover",
        channelId: "channel",
        channelName: "Talent Ch.",
        channelEnglishName: "",
        channelType: "",
        channelOrg: "Hololive",
        channelSuborg: "",
        publishedAt: "2026-01-02T00:00:00.000Z",
        duration: 200
      }
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ youtubeVideoId: "abc", title: "Song", topicId: "Original_Song" });
  });

  it("filters clip records out of music catalog rows", () => {
    const rows = makeCatalogRowsFromRecords([
      {
        sourcePage: 1,
        positionOnPage: 1,
        sourcePageUrl: "https://holodex.net/search",
        holodexWatchId: "clip-video",
        holodexWatchUrl: "https://holodex.net/watch/clip-video",
        youtubeVideoId: "clip-video",
        youtubeUrl: "https://www.youtube.com/watch?v=clip-video",
        title: "Clip Song",
        itemType: "clip",
        status: "past",
        topicId: "Original_Song",
        channelId: "channel",
        channelName: "Talent Ch.",
        channelEnglishName: "",
        channelType: "",
        channelOrg: "Hololive",
        channelSuborg: "",
        publishedAt: "2026-01-01T00:00:00.000Z",
        duration: 180
      }
    ]);

    expect(rows).toEqual([]);
  });
});
