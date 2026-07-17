import {
  HOLODEX_DEFAULT_LANGS,
  HOLODEX_DEFAULT_PAGE_SIZE,
  HOLODEX_DEFAULT_SEARCH_URL,
  HOLODEX_DEFAULT_TARGETS,
  HOLODEX_DETAIL_API_URL,
  HOLODEX_CHANNEL_PAGE_SIZE,
  HOLODEX_CHANNELS_API_URL,
  HOLODEX_SEARCH_API_URL,
  isExcludedHolodexChannelId,
  type HolodexChannelApiRecord,
  type HolodexChannelRecord,
  type HolodexMentionedChannel,
  type HolodexParsedSearch,
  type HolodexCatalogRow,
  type HolodexSearchFilterRow,
  type HolodexSearchItem,
  type HolodexSearchPayload,
  type HolodexVideoDetail,
  type HolodexVideoRecord
} from "./types";
import Papa from "papaparse";
import { normalizeVideoDetail, parseDuration } from "./cleanup";

export class HolodexQueryError extends Error {}

const HOLODEX_USER_AGENT = "Holoshelf personal local Holodex catalog";
const PROVIDED_TO_YOUTUBE_PREFIX = "Provided to YouTube by";
const HOLODEX_VIDEO_INCLUDE_FIELDS = ["mentions", "songs", "description"] as const;

type HolodexClientRateLimit = {
  maxRequests: number;
  windowMs: number;
  maxRetries?: number;
  requestTimeoutMs?: number;
};

export function parseHolodexSearchUrl(searchUrl = HOLODEX_DEFAULT_SEARCH_URL): HolodexParsedSearch {
  const parsed = new URL(searchUrl);
  const qValue = parsed.searchParams.get("q") ?? "";

  if (!qValue.trim()) {
    throw new HolodexQueryError("The Holodex URL is missing the q= search definition.");
  }

  const parsedRows = Papa.parse<Record<string, string>>(qValue, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim()
  });

  if (parsedRows.errors.length > 0) {
    throw new HolodexQueryError(parsedRows.errors[0].message);
  }

  if (!parsedRows.meta.fields?.includes("type") || !parsedRows.meta.fields.includes("value")) {
    throw new HolodexQueryError("The Holodex q= payload is empty or malformed.");
  }

  const rows = parsedRows.data
    .map((row): HolodexSearchFilterRow => ({
      type: row.type?.trim() ?? "",
      value: row.value?.trim() ?? "",
      text: row.text?.trim() || undefined
    }))
    .filter((row) => row.type && row.value);
  const page = Number.parseInt(parsed.searchParams.get("page") ?? "1", 10);

  if (!Number.isFinite(page) || page < 1) {
    throw new HolodexQueryError(`Invalid page number in search URL: ${parsed.searchParams.get("page") ?? ""}`);
  }

  return { rows, page };
}

export function buildHolodexPageUrl(searchUrl: string, pageNumber: number): string {
  const parsed = new URL(searchUrl);
  parsed.searchParams.set("page", String(pageNumber));
  return parsed.toString();
}

export function buildHolodexSearchPayload(input: {
  rows: HolodexSearchFilterRow[];
  pageNumber?: number;
  pageSize?: number;
  langs?: string[];
  targets?: string[];
}): HolodexSearchPayload {
  const pageNumber = Math.max(1, Math.round(input.pageNumber ?? 1));
  const pageSize = Math.max(1, Math.round(input.pageSize ?? HOLODEX_DEFAULT_PAGE_SIZE));
  const payload: HolodexSearchPayload = {
    sort: "newest",
    lang: input.langs ?? HOLODEX_DEFAULT_LANGS,
    target: input.targets ?? HOLODEX_DEFAULT_TARGETS,
    conditions: [],
    topic: [],
    vch: [],
    org: [],
    comment: [],
    paginated: true,
    offset: (pageNumber - 1) * pageSize,
    limit: pageSize
  };
  const unsupportedTypes: string[] = [];

  for (const row of input.rows) {
    const filterType = row.type.trim();
    const value = row.value.trim();
    if (!filterType || !value) {
      continue;
    }

    if (filterType === "topic") {
      payload.topic.push(value);
    } else if (filterType === "org") {
      payload.org.push(value);
    } else if (filterType === "channel") {
      payload.vch.push(value);
    } else {
      unsupportedTypes.push(filterType);
    }
  }

  if (unsupportedTypes.length > 0) {
    throw new HolodexQueryError(
      `Unsupported Holodex filter types: ${[...new Set(unsupportedTypes)].sort().join(", ")}`
    );
  }

  return payload;
}

export function normalizeHolodexSearchItem(input: {
  item: HolodexSearchItem;
  sourcePage: number;
  positionOnPage: number;
  sourcePageUrl: string;
  fallbackOrg?: string;
}): HolodexVideoRecord | null {
  const watchId = input.item.id?.trim();
  if (!watchId) {
    return null;
  }

  const channel = input.item.channel ?? {};
  const channelId = channel.id ?? input.item.channel_id ?? "";
  if (isExcludedHolodexChannelId(channel.id)) {
    return null;
  }

  return {
    sourcePage: input.sourcePage,
    positionOnPage: input.positionOnPage,
    sourcePageUrl: input.sourcePageUrl,
    holodexWatchId: watchId,
    holodexWatchUrl: `https://holodex.net/watch/${encodeURIComponent(watchId)}`,
    youtubeVideoId: watchId,
    youtubeUrl: `https://www.youtube.com/watch?v=${encodeURIComponent(watchId)}`,
    title: input.item.title ?? "",
    itemType: input.item.type ?? "",
    status: input.item.status ?? "",
    topicId: input.item.topic_id ?? "",
    channelId,
    channelName: channel.name ?? "",
    channelEnglishName: channel.english_name ?? "",
    channelType: channel.type ?? "",
    channelOrg: channel.org ?? input.fallbackOrg ?? "",
    channelSuborg: channel.suborg ?? "",
    publishedAt: input.item.published_at ?? "",
    duration: parseDuration(input.item.duration)
  };
}

export function makeCatalogRowsFromRecords(records: HolodexVideoRecord[]): HolodexCatalogRow[] {
  const rowsById = new Map<string, HolodexCatalogRow>();
  for (const record of records) {
    if (record.itemType && record.itemType !== "stream") {
      continue;
    }
    if (record.topicId !== "Original_Song" && record.topicId !== "Music_Cover") {
      continue;
    }
    if (!rowsById.has(record.youtubeVideoId)) {
      rowsById.set(record.youtubeVideoId, {
        youtubeVideoId: record.youtubeVideoId,
        youtubeUrl: record.youtubeUrl,
        title: record.title,
        status: record.status,
        topicId: record.topicId,
        channelId: record.channelId,
        channelName: record.channelName,
        publishedAt: record.publishedAt
      });
    }
  }
  return [...rowsById.values()];
}

export function parseHolodexCount(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value);
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value.replace(/,/g, ""), 10);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

export function normalizeHolodexChannel(channel: HolodexChannelApiRecord | null | undefined): HolodexChannelRecord | null {
  const id = channel?.id?.trim();
  if (!id || isExcludedHolodexChannelId(id)) {
    return null;
  }

  return {
    id,
    name: channel?.name?.trim() ?? "",
    englishName: channel?.english_name?.trim() ?? "",
    type: channel?.type?.trim() ?? "",
    org: channel?.org?.trim() ?? "",
    group: channel?.group?.trim() ?? "",
    photoUrl: channel?.photo?.trim() ?? "",
    twitter: channel?.twitter?.trim() ?? "",
    videoCount: parseHolodexCount(channel?.video_count),
    subscriberCount: parseHolodexCount(channel?.subscriber_count),
    clipCount: parseHolodexCount(channel?.clip_count),
    publishedAt: channel?.published_at?.trim() ?? "",
    inactive: Boolean(channel?.inactive)
  };
}

function normalizeMentionedChannel(channel: HolodexChannelApiRecord | null | undefined): HolodexMentionedChannel | null {
  const id = channel?.id?.trim();
  if (!id || isExcludedHolodexChannelId(id)) {
    return null;
  }

  return {
    channelId: id,
    name: channel?.name?.trim() ?? "",
    englishName: channel?.english_name?.trim() ?? "",
    type: channel?.type?.trim() ?? "",
    photoUrl: channel?.photo?.trim() ?? "",
    org: channel?.org?.trim() ?? ""
  };
}

function normalizeVideoDetailBody(videoId: string, body: {
  channel?: HolodexChannelApiRecord | null;
  channel_id?: string | null;
  duration?: number | string | null;
  original_channel_id?: string | null;
  description?: string | null;
  songs?: Array<{ name?: string | null }> | number | null;
  mentions?: HolodexChannelApiRecord[] | null;
}, relationshipsLoaded: boolean): HolodexVideoDetail {
  const channel = normalizeHolodexChannel(body.channel);
  const songs = Array.isArray(body.songs) ? body.songs : [];

  return normalizeVideoDetail(videoId, {
    youtubeVideoId: videoId,
    channelId: channel?.id ?? body.channel_id ?? "",
    duration: parseDuration(body.duration),
    originalChannelId: body.original_channel_id ?? "",
    providedToYoutube: (body.description ?? "").startsWith(PROVIDED_TO_YOUTUBE_PREFIX),
    description: body.description ?? "",
    songNames: songs
      .map((song) => song.name?.trim() ?? "")
      .filter(Boolean),
    channel,
    mentions: (body.mentions ?? [])
      .map((mention) => normalizeMentionedChannel(mention))
      .filter((mention): mention is HolodexMentionedChannel => Boolean(mention)),
    relationshipsLoaded
  });
}

export function normalizeHolodexVideoItemDetail(
  videoId: string,
  item: HolodexSearchItem,
  relationshipsLoaded: boolean
): HolodexVideoDetail {
  return normalizeVideoDetailBody(videoId, item, relationshipsLoaded);
}

export class HolodexApiClient {
  private requestTimestamps: number[] = [];

  constructor(
    private readonly apiKey: string | null = null,
    private readonly fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
    private readonly rateLimit: HolodexClientRateLimit | null = null
  ) {}

  async fetchSearchPage(input: {
    searchUrl?: string;
    rows: HolodexSearchFilterRow[];
    pageNumber: number;
    pageSize?: number;
    langs?: string[];
    targets?: string[];
  }): Promise<{ items: HolodexSearchItem[]; total: number }> {
    const pageUrl = buildHolodexPageUrl(input.searchUrl ?? HOLODEX_DEFAULT_SEARCH_URL, input.pageNumber);
    const payload = buildHolodexSearchPayload(input);
    const response = await this.request(HOLODEX_SEARCH_API_URL, {
      method: "POST",
      headers: this.headers({
        Referer: pageUrl,
        Origin: "https://holodex.net",
        "Content-Type": "application/json"
      }),
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`Holodex search request failed with HTTP ${response.status}: ${await response.text()}`);
    }

    const body = (await response.json()) as { items?: HolodexSearchItem[]; total?: number };
    return {
      items: Array.isArray(body.items) ? body.items : [],
      total: Number(body.total ?? 0)
    };
  }

  async fetchChannelsPage(input: {
    offset?: number;
    limit?: number;
    org?: string;
    type?: "vtuber" | "subber";
  } = {}): Promise<HolodexChannelRecord[]> {
    const url = new URL(HOLODEX_CHANNELS_API_URL);
    url.searchParams.set("offset", String(Math.max(0, Math.round(input.offset ?? 0))));
    url.searchParams.set("limit", String(Math.min(Math.max(Math.round(input.limit ?? HOLODEX_CHANNEL_PAGE_SIZE), 1), 50)));
    if (input.org) {
      url.searchParams.set("org", input.org);
    }
    if (input.type) {
      url.searchParams.set("type", input.type);
    }

    const response = await this.request(url.toString(), {
      headers: this.headers({ Referer: "https://holodex.net/", Origin: "https://holodex.net" })
    });

    if (!response.ok) {
      throw new Error(`Holodex channel list request failed with HTTP ${response.status}: ${await response.text()}`);
    }

    const body = (await response.json()) as HolodexChannelApiRecord[];
    return (Array.isArray(body) ? body : [])
      .map((channel) => normalizeHolodexChannel(channel))
      .filter((channel): channel is HolodexChannelRecord => Boolean(channel));
  }

  async fetchChannel(channelId: string): Promise<HolodexChannelRecord | null> {
    const response = await this.request(`${HOLODEX_CHANNELS_API_URL}/${encodeURIComponent(channelId)}`, {
      headers: this.headers({ Referer: "https://holodex.net/", Origin: "https://holodex.net" })
    });

    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new Error(`Holodex channel request for ${channelId} failed with HTTP ${response.status}: ${await response.text()}`);
    }

    return normalizeHolodexChannel((await response.json()) as HolodexChannelApiRecord);
  }

  async fetchChannelVideos(input: {
    channelId: string;
    type: "collabs" | "videos";
    pageNumber?: number;
    pageSize?: number;
    includeRelationships?: boolean;
  }): Promise<{ items: HolodexSearchItem[]; total: number }> {
    const pageNumber = Math.max(1, Math.round(input.pageNumber ?? 1));
    const pageSize = Math.min(Math.max(Math.round(input.pageSize ?? HOLODEX_CHANNEL_PAGE_SIZE), 1), 50);
    const url = new URL(`${HOLODEX_CHANNELS_API_URL}/${encodeURIComponent(input.channelId)}/${input.type}`);
    url.searchParams.set("paginated", "1");
    url.searchParams.set("offset", String((pageNumber - 1) * pageSize));
    url.searchParams.set("limit", String(pageSize));
    if (input.includeRelationships) {
      url.searchParams.set("include", HOLODEX_VIDEO_INCLUDE_FIELDS.join(","));
    }

    const response = await this.request(url.toString(), {
      headers: this.headers({ Referer: "https://holodex.net/", Origin: "https://holodex.net" })
    });

    if (!response.ok) {
      throw new Error(`Holodex ${input.type} request for ${input.channelId} failed with HTTP ${response.status}: ${await response.text()}`);
    }

    const body = (await response.json()) as { items?: HolodexSearchItem[]; total?: number } | HolodexSearchItem[];
    if (Array.isArray(body)) {
      return { items: body, total: body.length };
    }

    return {
      items: Array.isArray(body.items) ? body.items : [],
      total: Number(body.total ?? 0)
    };
  }

  async fetchVideosPage(input: {
    topicId: "Music_Cover" | "Original_Song";
    videoType: "stream";
    pageNumber?: number;
    pageSize?: number;
    includeRelationships?: boolean;
    org?: string;
  }): Promise<{ items: HolodexSearchItem[]; total: number }> {
    const pageNumber = Math.max(1, Math.round(input.pageNumber ?? 1));
    const pageSize = Math.min(Math.max(Math.round(input.pageSize ?? HOLODEX_CHANNEL_PAGE_SIZE), 1), 50);
    const url = new URL(HOLODEX_DETAIL_API_URL);
    url.searchParams.set("paginated", "1");
    url.searchParams.set("offset", String((pageNumber - 1) * pageSize));
    url.searchParams.set("limit", String(pageSize));
    url.searchParams.set("org", input.org ?? "Hololive");
    url.searchParams.set("topic", input.topicId);
    url.searchParams.set("type", input.videoType);
    url.searchParams.set("sort", "published_at");
    url.searchParams.set("order", "asc");
    if (input.includeRelationships !== false) {
      url.searchParams.set("include", HOLODEX_VIDEO_INCLUDE_FIELDS.join(","));
    }

    const response = await this.request(url.toString(), {
      headers: this.headers({ Referer: "https://holodex.net/", Origin: "https://holodex.net" })
    });

    if (!response.ok) {
      throw new Error(`Holodex videos request failed with HTTP ${response.status}: ${await response.text()}`);
    }

    const body = (await response.json()) as { items?: HolodexSearchItem[]; total?: number } | HolodexSearchItem[];
    if (Array.isArray(body)) {
      return { items: body, total: body.length };
    }

    return {
      items: Array.isArray(body.items) ? body.items : [],
      total: Number(body.total ?? 0)
    };
  }

  async fetchVideoDetail(videoId: string, input: { includeRelationships?: boolean } = {}): Promise<HolodexVideoDetail> {
    const url = new URL(`${HOLODEX_DETAIL_API_URL}/${encodeURIComponent(videoId)}`);
    if (input.includeRelationships !== false) {
      url.searchParams.set("include", HOLODEX_VIDEO_INCLUDE_FIELDS.join(","));
    }

    const response = await this.request(url.toString(), {
      headers: this.headers({
        Referer: "https://holodex.net/",
        Origin: "https://holodex.net"
      })
    });

    if (!response.ok) {
      throw new Error(`Holodex detail request for ${videoId} failed with HTTP ${response.status}: ${await response.text()}`);
    }

    return normalizeVideoDetailBody(videoId, await response.json(), input.includeRelationships !== false);
  }

  private async request(url: string, init: RequestInit): Promise<Response> {
    const maxRetries = this.rateLimit?.maxRetries ?? 4;
    let attempt = 0;

    for (;;) {
      await this.waitForRateLimitTurn();
      const response = await this.fetchWithTimeout(url, init);
      if (response.status !== 429 || attempt >= maxRetries) {
        return response;
      }

      attempt += 1;
      await this.sleep(this.getRetryDelayMs(response, attempt));
    }
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const timeoutMs = Math.max(5_000, Math.round(this.rateLimit?.requestTimeoutMs ?? 45_000));
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await this.fetcher(url, {
        ...init,
        signal: controller.signal
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`Holodex request timed out after ${Math.round(timeoutMs / 1000)}s`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async waitForRateLimitTurn(): Promise<void> {
    if (!this.rateLimit) {
      return;
    }

    const maxRequests = Math.max(1, Math.floor(this.rateLimit.maxRequests));
    const windowMs = Math.max(1000, Math.floor(this.rateLimit.windowMs));

    for (;;) {
      const now = Date.now();
      this.requestTimestamps = this.requestTimestamps.filter((timestamp) => now - timestamp < windowMs);
      if (this.requestTimestamps.length < maxRequests) {
        this.requestTimestamps.push(now);
        return;
      }

      const waitMs = windowMs - (now - this.requestTimestamps[0]) + 250;
      await this.sleep(Math.max(250, waitMs));
    }
  }

  private getRetryDelayMs(response: Response, attempt: number): number {
    const retryAfter = response.headers.get("retry-after");
    if (retryAfter) {
      const seconds = Number.parseFloat(retryAfter);
      if (Number.isFinite(seconds)) {
        return Math.max(1000, seconds * 1000);
      }

      const retryDate = Date.parse(retryAfter);
      if (Number.isFinite(retryDate)) {
        return Math.max(1000, retryDate - Date.now());
      }
    }

    return Math.min(120_000, 10_000 * attempt);
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private headers(extraHeaders: Record<string, string>): HeadersInit {
    const headers: Record<string, string> = {
      "User-Agent": HOLODEX_USER_AGENT,
      Accept: "application/json, text/plain, */*",
      ...extraHeaders
    };

    if (this.apiKey?.trim()) {
      headers["X-APIKEY"] = this.apiKey.trim();
    }

    return headers;
  }
}
