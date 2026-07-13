import fs from "node:fs/promises";
import path from "node:path";
import type {
  HololiveCustomTalentInput,
  HololiveCustomTalentPreview,
  HololiveCustomTalentRecord,
  HololiveMusicImportResult,
  HololiveMusicTopic
} from "../../src/shared/contracts";
import {
  HolodexApiClient,
  HOLODEX_CHANNEL_PAGE_SIZE,
  HOLODEX_DEFAULT_PAGE_SIZE,
  HOLODEX_DEFAULT_SEARCH_URL,
  buildHolodexPageUrl,
  cleanupCatalogRows,
  makeCatalogRowsFromRecords,
  normalizeHolodexSearchItem,
  normalizeHolodexVideoItemDetail,
  parseHolodexArtifactBundle,
  parseHolodexSearchUrl,
  type HolodexArtifactBundle,
  type HolodexCatalogRow,
  type HolodexChannelRecord,
  type HolodexVideoDetail,
  type HolodexVideoRecord
} from "../../src/modules/hololive/music";
import type { DatabaseService } from "./database";

const HOLODEX_API_KEY_SETTING = "sources.holodexApiKey";
const HOLODEX_VIDEOS_FILE = "holodex_videos.csv";
const HOLODEX_DETAIL_CACHE_FILE = "holodex_video_details_cache.json";
const HOLODEX_DUPLICATES_FILE = "holodex_topic_duplicates.csv";
const HOLODEX_FULL_REFRESH_RATE_LIMIT = { maxRequests: 76, windowMs: 120_000, maxRetries: 8, requestTimeoutMs: 45_000 };
const HOLODEX_MUSIC_TOPICS = ["Music_Cover", "Original_Song"] as const;
// Holodex calls normal YouTube video uploads "stream"; this is not a request for clip videos.
const HOLODEX_VIDEO_TYPES = ["stream"] as const;
const CUSTOM_CHANNEL_RECENT_MUSIC_PAGE_LIMIT = 1;
const CUSTOM_CHANNEL_RECENT_MUSIC_PAGE_SIZE = 25;
const CUSTOM_CHANNEL_RECENT_MUSIC_TIMEOUT_MS = 10_000;

interface HolodexMusicServiceOptions {
  apiKey?: string | null;
}

export class HolodexMusicService {
  private readonly apiKeyOverride: string | null;

  constructor(
    private readonly database: DatabaseService,
    private readonly fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
    private readonly onProgress: ((message: string) => void) | null = null,
    options: HolodexMusicServiceOptions = {}
  ) {
    this.apiKeyOverride = options.apiKey?.trim() || null;
  }

  async importArtifacts(directoryPath: string): Promise<HololiveMusicImportResult> {
    const artifactDirectory = path.resolve(directoryPath);
    const [videosCsvText, detailCacheJsonText, duplicateReportCsvText] = await Promise.all([
      fs.readFile(path.join(artifactDirectory, HOLODEX_VIDEOS_FILE), "utf8"),
      fs.readFile(path.join(artifactDirectory, HOLODEX_DETAIL_CACHE_FILE), "utf8"),
      fs
        .readFile(path.join(artifactDirectory, HOLODEX_DUPLICATES_FILE), "utf8")
        .catch((error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") {
            return "";
          }
          throw error;
        })
    ]);
    const bundle = parseHolodexArtifactBundle({
      videosCsvText,
      detailCacheJsonText,
      duplicateReportCsvText
    });

    return this.database.importHolodexMusicArtifacts(bundle);
  }

  async refreshChannels(): Promise<{ refreshedChannels: number; classifiedChannels: number; updatedAt: string }> {
    const client = new HolodexApiClient(this.getApiKey(), this.fetcher);
    return this.refreshChannelsWithClient(client);
  }

  async resolveCustomTalent(input: HololiveCustomTalentInput): Promise<HololiveCustomTalentPreview> {
    const client = this.createHolodexClient();
    const channelId = await this.resolveCustomTalentChannelId(input);
    const channel = await client.fetchChannel(channelId);
    if (!channel) {
      throw new Error(`Holodex does not know channel ${channelId}`);
    }

    const displayName = input.displayName?.trim() || channel.englishName || channel.name || channel.id;
    const twitter = channel.twitter?.trim() ?? "";
    const youtubeChannelUrl = `https://www.youtube.com/channel/${channel.id}`;
    return {
      channelId: channel.id,
      displayName,
      nativeName: channel.name || null,
      slug: this.slugifyTalent(displayName || channel.id),
      branch: channel.org || "Custom",
      generation: channel.group || "",
      officialUrl: youtubeChannelUrl,
      iconUrl: channel.photoUrl || "",
      profileImageUrl: channel.photoUrl || "",
      cardImageUrl: input.cardImageUrl?.trim() || null,
      youtubeChannelUrl,
      xHandle: twitter ? `@${twitter.replace(/^@/, "")}` : null,
      xUrl: twitter ? `https://x.com/${twitter.replace(/^@/, "")}` : null,
      subscriberCount: channel.subscriberCount,
      videoCount: channel.videoCount,
      clipCount: channel.clipCount,
      originalSongsUrl: input.originalSongsUrl?.trim() || null,
      coversUrl: input.coversUrl?.trim() || null
    };
  }

  async upsertCustomTalent(input: HololiveCustomTalentInput): Promise<HololiveCustomTalentRecord> {
    const preview = await this.resolveCustomTalent(input);
    return this.database.upsertHololiveCustomTalent(preview);
  }

  deleteCustomTalent(idolId: string): void {
    this.database.deleteHololiveCustomTalent(idolId);
  }

  async refreshCustomTalent(input: {
    idolId: string;
    pageLimit?: number | null;
    includeRelationships?: boolean | null;
    includeCollabs?: boolean | null;
    collabPageLimit?: number | null;
  }): Promise<HololiveMusicImportResult> {
    const idol = this.database.listHololiveIdols().find((candidate) => candidate.id === input.idolId);
    const channelId = idol?.youtubeChannelId?.trim() ?? "";
    if (!idol || idol.source !== "custom" || !channelId) {
      throw new Error(`Unknown custom talent: ${input.idolId}`);
    }

    const client = this.createHolodexClient();
    const channel = await client.fetchChannel(channelId);
    if (channel) {
      this.database.refreshHolodexChannels([channel]);
    }

    const direct = await this.fetchCustomChannelMusicRecords(client, channelId, {
      includeRelationships: input.includeRelationships !== false,
      pageLimit: input.pageLimit ?? null,
      pageSize: 50
    });
    const collabChannelIdsByVideoId = new Map<string, Set<string>>();
    const collabs =
      input.includeCollabs === false
        ? []
        : await this.fetchCollabMusicRecords(client, {
            includeRelationships: input.includeRelationships !== false,
            pageLimit: input.collabPageLimit ?? 1,
            collabChannelIdsByVideoId,
            channelLinks: [{ idolId: idol.id, youtubeChannelId: channelId }]
          });
    const records = [...direct.records, ...collabs];
    const rows = this.filterRowsToKnownHolodexChannels(makeCatalogRowsFromRecords(records), collabChannelIdsByVideoId);
    const directDetailIds = new Set(Object.keys(direct.detailCache));
    const detailCache = {
      ...direct.detailCache,
      ...(await this.fetchDetailsForRows(
        client,
        rows.map((row) => row.youtubeVideoId).filter((videoId) => !directDetailIds.has(videoId)),
        {
          includeRelationships: input.includeRelationships !== false
        }
      ))
    };
    for (const [videoId, channelIds] of collabChannelIdsByVideoId) {
      if (detailCache[videoId]) {
        detailCache[videoId].collabChannelIds = [...new Set([...detailCache[videoId].collabChannelIds, ...channelIds])];
      }
    }
    const cleanup = cleanupCatalogRows(
      rows,
      Object.fromEntries(records.map((record) => [record.youtubeVideoId, record])),
      detailCache
    );

    return this.database.importHolodexMusicArtifacts(
      {
        rows: cleanup.rows,
        detailCache,
        duplicateRemovals: cleanup.duplicateRemovals
      },
      "live"
    );
  }

  async refreshLive(input: {
    searchUrl?: string | null;
    pageLimit?: number | null;
    pageSize?: number | null;
    includeChannels?: boolean | null;
    includeCustomTalents?: boolean | null;
    includeRelationships?: boolean | null;
    includeCollabs?: boolean | null;
    collabPageLimit?: number | null;
    replaceExisting?: boolean | null;
    maxRequestsPerWindow?: number | null;
    requestWindowMs?: number | null;
  } = {}): Promise<HololiveMusicImportResult> {
    try {
      const client = this.createHolodexClient(input);
      if (input.includeChannels !== false) {
        this.reportProgress("Refreshing Holodex channel metadata");
        await this.refreshChannelsWithClient(client);
      }

      const searchUrl = input.searchUrl ?? undefined;
      const records: HolodexVideoRecord[] = [];
      let rowsForCleanup: HolodexCatalogRow[] = [];
      let detailCache: Record<string, HolodexVideoDetail> = {};
      const collabChannelIdsByVideoId = new Map<string, Set<string>>();

      if (searchUrl) {
        const parsed = parseHolodexSearchUrl(searchUrl);
        const firstPage = await client.fetchSearchPage({
          searchUrl,
          rows: parsed.rows,
          pageNumber: parsed.page,
          pageSize: input.pageSize ?? undefined
        });
        const pageSize = Math.max(1, Math.round(input.pageSize ?? HOLODEX_DEFAULT_PAGE_SIZE));
        const pageCount = Math.max(1, Math.ceil(firstPage.total / pageSize));
        const requestedLimit = input.pageLimit ? Math.max(1, Math.round(input.pageLimit)) : pageCount;
        const lastPage = Math.min(pageCount, parsed.page + requestedLimit - 1);

        records.push(...this.normalizePageItems(firstPage.items, searchUrl, parsed.page, parsed.rows));
        this.reportProgress(`Fetched custom search page ${parsed.page}/${lastPage}`);

        for (let pageNumber = parsed.page + 1; pageNumber <= lastPage; pageNumber += 1) {
          const page = await client.fetchSearchPage({
            searchUrl,
            rows: parsed.rows,
            pageNumber,
            pageSize
          });
          records.push(...this.normalizePageItems(page.items, searchUrl, pageNumber, parsed.rows));
          if (pageNumber === lastPage || pageNumber % 10 === 0) {
            this.reportProgress(`Fetched custom search page ${pageNumber}/${lastPage}`);
          }
        }

        if (input.includeCollabs !== false) {
          records.push(
            ...(await this.fetchCollabMusicRecords(client, {
              includeRelationships: input.includeRelationships !== false,
              pageLimit: input.collabPageLimit ?? 1,
              collabChannelIdsByVideoId
            }))
          );
        }

        const rows = makeCatalogRowsFromRecords(records);
        const candidateRows = this.filterRowsToKnownHolodexChannels(rows, collabChannelIdsByVideoId);
        rowsForCleanup = candidateRows;
        detailCache = await this.fetchDetailsForRows(client, candidateRows.map((row) => row.youtubeVideoId), {
          includeRelationships: input.includeRelationships !== false
        });
      } else {
        const officialResult = await this.fetchOfficialMusicVideoRecords(client, {
          includeRelationships: input.includeRelationships !== false,
          pageLimit: input.pageLimit ?? null,
          pageSize: input.pageSize ?? 50
        });
        records.push(...officialResult.records);
        detailCache = officialResult.detailCache;
        rowsForCleanup = makeCatalogRowsFromRecords(records);

        if (input.includeCustomTalents !== false) {
          const customResult = await this.fetchCustomTalentMusicRecords(client, {
            includeRelationships: input.includeRelationships !== false,
            pageLimit: input.pageLimit ?? null,
            pageSize: input.pageSize ?? 50
          });
          records.push(...customResult.records);
          detailCache = { ...detailCache, ...customResult.detailCache };
        }

        if (input.includeCollabs !== false) {
          const officialIdolIds =
            input.includeCustomTalents === false
              ? new Set(this.database.listHololiveIdols().filter((idol) => idol.source !== "custom").map((idol) => idol.id))
              : null;
          const officialOnlyChannelLinks = officialIdolIds
            ? this.database.listHololiveIdolMainChannels().filter((link) => officialIdolIds.has(link.idolId))
            : undefined;
          records.push(
            ...(await this.fetchCollabMusicRecords(client, {
              includeRelationships: input.includeRelationships !== false,
              pageLimit: input.collabPageLimit ?? 1,
              collabChannelIdsByVideoId,
              channelLinks: officialOnlyChannelLinks
            }))
          );
        }

        const candidateRows = this.filterRowsToKnownHolodexChannels(makeCatalogRowsFromRecords(records), collabChannelIdsByVideoId);
        const missingDetailIds = candidateRows
          .map((row) => row.youtubeVideoId)
          .filter((videoId) => !detailCache[videoId] || (input.includeRelationships !== false && !detailCache[videoId].relationshipsLoaded));
        if (missingDetailIds.length) {
          detailCache = {
            ...detailCache,
            ...(await this.fetchDetailsForRows(client, missingDetailIds, {
              includeRelationships: input.includeRelationships !== false
            }))
          };
        }
        rowsForCleanup = candidateRows;
      }

      for (const [videoId, collabChannelIds] of collabChannelIdsByVideoId) {
        if (detailCache[videoId]) {
          detailCache[videoId].collabChannelIds = [...new Set([...detailCache[videoId].collabChannelIds, ...collabChannelIds])];
          detailCache[videoId].relationshipsLoaded = input.includeRelationships !== false;
        }
      }
      const cleanup = cleanupCatalogRows(
        rowsForCleanup,
        Object.fromEntries(records.map((record) => [record.youtubeVideoId, record])),
        detailCache
      );
      const bundle: HolodexArtifactBundle = {
        rows: cleanup.rows,
        detailCache,
        duplicateRemovals: cleanup.duplicateRemovals
      };

      this.reportProgress(`Importing ${cleanup.rows.length} cleaned Holodex music row(s)`);
      return this.database.importHolodexMusicArtifacts(bundle, "live", { replaceExisting: Boolean(input.replaceExisting) });
    } catch (error) {
      return this.database.recordFailedHolodexRefresh({
        source: "live",
        error: error instanceof Error ? error.message : "Holodex live refresh failed"
      });
    }
  }

  private reportProgress(message: string): void {
    this.onProgress?.(message);
  }

  private async resolveCustomTalentChannelId(input: HololiveCustomTalentInput): Promise<string> {
    const candidates = [
      input.channelInput,
      input.originalSongsUrl ?? "",
      input.coversUrl ?? ""
    ].flatMap((value) => this.extractChannelIdsFromInput(value));
    const uniqueCandidates = [...new Set(candidates)];
    if (uniqueCandidates.length > 1) {
      throw new Error(`Custom talent inputs point at multiple channels: ${uniqueCandidates.join(", ")}`);
    }
    if (uniqueCandidates.length === 1) {
      return uniqueCandidates[0];
    }

    const handle = this.extractYouTubeHandle(input.channelInput);
    if (handle) {
      return this.resolveYouTubeHandleToChannelId(handle);
    }

    throw new Error("Could not resolve a YouTube channel id. Use a UC... channel ID, YouTube channel URL, @handle, or Holodex search URL.");
  }

  private extractChannelIdsFromInput(value: string): string[] {
    const text = value.trim();
    if (!text) {
      return [];
    }

    const directMatches = [...text.matchAll(/\b(UC[\w-]{20,})\b/g)].map((match) => match[1]);
    try {
      const parsed = new URL(text);
      if (parsed.hostname.includes("holodex.net") && parsed.searchParams.has("q")) {
        directMatches.push(
          ...parseHolodexSearchUrl(text)
            .rows.filter((row) => row.type === "channel")
            .map((row) => row.value)
        );
      }
    } catch {
      // Plain @handles and raw channel IDs are valid non-URL inputs.
    }

    return [...new Set(directMatches.map((id) => id.trim()).filter(Boolean))];
  }

  private extractYouTubeHandle(value: string): string | null {
    const text = value.trim();
    if (!text) {
      return null;
    }
    if (/^@[\w.-]+$/u.test(text)) {
      return text;
    }

    try {
      const parsed = new URL(text);
      if (!this.isYouTubeHost(parsed.hostname)) {
        return null;
      }
      const handleSegment = parsed.pathname.split("/").find((segment) => segment.startsWith("@"));
      return handleSegment && /^@[\w.-]+$/u.test(handleSegment) ? handleSegment : null;
    } catch {
      return null;
    }
  }

  private async resolveYouTubeHandleToChannelId(handle: string): Promise<string> {
    const url = `https://www.youtube.com/${encodeURIComponent(handle).replace("%40", "@")}`;
    const response = await this.fetcher(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 Holoshelf personal local channel resolver",
        Accept: "text/html,application/xhtml+xml"
      }
    });
    if (!response.ok) {
      throw new Error(`YouTube handle lookup failed with HTTP ${response.status}`);
    }

    const html = await response.text();
    const resolvedHandle = this.extractCanonicalYouTubeHandleFromHtml(html);
    if (resolvedHandle && resolvedHandle.toLowerCase() !== handle.toLowerCase()) {
      throw new Error(`YouTube resolved ${handle} to ${resolvedHandle}; use the exact channel URL or channel ID instead.`);
    }

    const channelId = this.extractChannelIdFromYouTubeChannelHtml(html);
    if (!channelId) {
      throw new Error(`Could not find a channel id for ${handle}`);
    }
    return channelId;
  }

  private isYouTubeHost(hostname: string): boolean {
    const host = hostname.toLowerCase().replace(/^www\./, "");
    return host === "youtube.com" || host.endsWith(".youtube.com");
  }

  private extractCanonicalYouTubeHandleFromHtml(html: string): string | null {
    const handleMatches = [
      html.match(/"ownerUrls":\["(?:https?:)?\/\/(?:www\.)?youtube\.com\/(@[\w.-]+)"\]/u),
      html.match(/"vanityChannelUrl":"(?:https?:)?\/\/(?:www\.)?youtube\.com\/(@[\w.-]+)"/u),
      html.match(/<link rel="canonical" href="(?:https?:)?\/\/(?:www\.)?youtube\.com\/(@[\w.-]+)"/u)
    ];
    return handleMatches.find((match) => match?.[1])?.[1] ?? null;
  }

  private extractChannelIdFromYouTubeChannelHtml(html: string): string | null {
    const metadataMatches = [
      html.match(/"metadata":\{"channelMetadataRenderer":\{[\s\S]*?"externalId":"(UC[^"]+)"/u),
      html.match(/"channelMetadataRenderer":\{[\s\S]*?"externalId":"(UC[^"]+)"/u),
      html.match(/<meta itemprop="channelId" content="(UC[^"]+)"/u)
    ];
    const metadataId = metadataMatches.find((match) => match?.[1])?.[1];
    if (metadataId) {
      return metadataId;
    }

    return (
      html.match(/"externalId":"(UC[^"]+)"/u)?.[1] ??
      html.match(/"browseId":"(UC[^"]+)"/u)?.[1] ??
      html.match(/"channelId":"(UC[^"]+)"/u)?.[1] ??
      null
    );
  }

  private slugifyTalent(value: string): string {
    return value
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-|-$/g, "")
      .replace(/-+/g, "-") || "custom-talent";
  }

  private createHolodexClient(input: {
    maxRequestsPerWindow?: number | null;
    requestWindowMs?: number | null;
  } = {}): HolodexApiClient {
    return new HolodexApiClient(this.getApiKey(), this.fetcher, {
      ...HOLODEX_FULL_REFRESH_RATE_LIMIT,
      maxRequests: Math.max(1, Math.round(input.maxRequestsPerWindow ?? HOLODEX_FULL_REFRESH_RATE_LIMIT.maxRequests)),
      windowMs: Math.max(1_000, Math.round(input.requestWindowMs ?? HOLODEX_FULL_REFRESH_RATE_LIMIT.windowMs))
    });
  }

  private getApiKey(): string | null {
    return this.apiKeyOverride ?? (this.database.getSettings()[HOLODEX_API_KEY_SETTING]?.trim() || null);
  }

  private async refreshChannelsWithClient(
    client: HolodexApiClient
  ): Promise<{ refreshedChannels: number; classifiedChannels: number; updatedAt: string }> {
    const channels: HolodexChannelRecord[] = [];
    for (let offset = 0; ; offset += HOLODEX_CHANNEL_PAGE_SIZE) {
      const page = await client.fetchChannelsPage({
        org: "Hololive",
        type: "vtuber",
        offset,
        limit: HOLODEX_CHANNEL_PAGE_SIZE
      });
      channels.push(...page);
      if (page.length < HOLODEX_CHANNEL_PAGE_SIZE) {
        break;
      }
    }

    const fetchedChannelIds = new Set(channels.map((channel) => channel.id));
    const storedChannels = new Map(this.database.listHololiveChannels().map((channel) => [channel.id, channel]));
    const idolsById = new Map(this.database.listHololiveIdols().map((idol) => [idol.id, idol]));
    for (const link of this.database
      .listHololiveIdolMainChannels()
      .sort((left, right) => left.youtubeChannelId.localeCompare(right.youtubeChannelId))) {
      if (fetchedChannelIds.has(link.youtubeChannelId)) {
        continue;
      }
      const storedChannel = storedChannels.get(link.youtubeChannelId);
      if (
        storedChannel &&
        storedChannel.name !== idolsById.get(link.idolId)?.displayName &&
        (storedChannel.subscriberCount !== null || storedChannel.videoCount !== null || storedChannel.clipCount !== null)
      ) {
        continue;
      }

      try {
        const channel = await client.fetchChannel(link.youtubeChannelId);
        if (channel) {
          channels.push(channel);
          fetchedChannelIds.add(channel.id);
        }
      } catch (error) {
        if (this.isHolodexRateLimitError(error)) {
          break;
        }
        throw error;
      }
    }

    return this.database.refreshHolodexChannels(channels);
  }

  private isHolodexRateLimitError(error: unknown): boolean {
    return error instanceof Error && /\bHTTP 429\b/.test(error.message);
  }

  private normalizePageItems(
    items: Parameters<typeof normalizeHolodexSearchItem>[0]["item"][],
    searchUrl: string | undefined,
    pageNumber: number,
    rows: ReturnType<typeof parseHolodexSearchUrl>["rows"]
  ): HolodexVideoRecord[] {
    const fallbackOrg = rows.find((row) => row.type === "org")?.value;
    const pageUrl = buildHolodexPageUrl(searchUrl ?? HOLODEX_DEFAULT_SEARCH_URL, pageNumber);

    return items
      .map((item, index) =>
        normalizeHolodexSearchItem({
          item,
          sourcePage: pageNumber,
          positionOnPage: index + 1,
          sourcePageUrl: pageUrl,
          fallbackOrg
        })
      )
      .filter((record): record is HolodexVideoRecord => Boolean(record));
  }

  private async fetchDetailsForRows(
    client: HolodexApiClient,
    youtubeVideoIds: string[],
    input: { includeRelationships: boolean }
  ): Promise<Record<string, HolodexVideoDetail>> {
    const uniqueVideoIds = [...new Set(youtubeVideoIds.map((videoId) => videoId.trim()).filter(Boolean))].sort();
    const details: Record<string, HolodexVideoDetail> = {};
    const cachedDetails = this.database.listHolodexDetailCache(uniqueVideoIds);
    const missingVideoIds: string[] = [];

    for (const videoId of uniqueVideoIds) {
      const cachedDetail = cachedDetails[videoId];
      if (cachedDetail && (!input.includeRelationships || cachedDetail.relationshipsLoaded)) {
        details[videoId] = cachedDetail;
      } else {
        missingVideoIds.push(videoId);
      }
    }

    if (uniqueVideoIds.length > 0) {
      this.reportProgress(
        `Holodex details: ${Object.keys(details).length} cached, ${missingVideoIds.length} to fetch`
      );
    }

    for (const [index, videoId] of missingVideoIds.entries()) {
      details[videoId] = await client.fetchVideoDetail(videoId, { includeRelationships: input.includeRelationships });
      if (index === missingVideoIds.length - 1 || (index + 1) % 25 === 0) {
        this.reportProgress(`Fetched Holodex details ${index + 1}/${missingVideoIds.length}`);
      }
    }

    return details;
  }

  private async fetchOfficialMusicVideoRecords(
    client: HolodexApiClient,
    input: {
      includeRelationships: boolean;
      pageLimit: number | null;
      pageSize: number;
    }
  ): Promise<{ records: HolodexVideoRecord[]; detailCache: Record<string, HolodexVideoDetail> }> {
    const records: HolodexVideoRecord[] = [];
    const detailCache: Record<string, HolodexVideoDetail> = {};
    const pageSize = Math.min(Math.max(Math.round(input.pageSize), 1), 50);
    const requestedPageLimit = input.pageLimit ? Math.max(1, Math.round(input.pageLimit)) : null;

    for (const topicId of HOLODEX_MUSIC_TOPICS) {
      for (const videoType of HOLODEX_VIDEO_TYPES) {
        const firstPage = await client.fetchVideosPage({
          topicId,
          videoType,
          pageNumber: 1,
          pageSize,
          includeRelationships: input.includeRelationships
        });
        const pageCount = Math.max(1, Math.ceil(firstPage.total / pageSize));
        const lastPage = Math.min(pageCount, requestedPageLimit ?? pageCount);
        this.reportProgress(`Holodex song uploads ${topicId}: ${firstPage.total} row(s), ${lastPage}/${pageCount} page(s)`);
        this.collectOfficialMusicVideoPage(firstPage.items, {
          records,
          detailCache,
          topicId,
          videoType,
          pageNumber: 1,
          includeRelationships: input.includeRelationships
        });

        for (let pageNumber = 2; pageNumber <= lastPage; pageNumber += 1) {
          const page = await client.fetchVideosPage({
            topicId,
            videoType,
            pageNumber,
            pageSize,
            includeRelationships: input.includeRelationships
          });
          this.collectOfficialMusicVideoPage(page.items, {
            records,
            detailCache,
            topicId,
            videoType,
            pageNumber,
            includeRelationships: input.includeRelationships
          });
          if (pageNumber === lastPage || pageNumber % 10 === 0) {
            this.reportProgress(`Fetched Holodex song uploads ${topicId} page ${pageNumber}/${lastPage}`);
          }
        }
      }
    }

    return {
      records: [...new Map(records.map((record) => [record.youtubeVideoId, record])).values()],
      detailCache
    };
  }

  private async fetchCustomTalentMusicRecords(
    client: HolodexApiClient,
    input: {
      includeRelationships: boolean;
      pageLimit: number | null;
      pageSize: number;
    }
  ): Promise<{ records: HolodexVideoRecord[]; detailCache: Record<string, HolodexVideoDetail> }> {
    const records: HolodexVideoRecord[] = [];
    const detailCache: Record<string, HolodexVideoDetail> = {};
    const uniqueChannels = [
      ...new Map(this.database.listHololiveCustomTalentMainChannels().map((link) => [link.youtubeChannelId, link])).values()
    ];

    for (const link of uniqueChannels) {
      const result = await this.fetchCustomChannelMusicRecords(client, link.youtubeChannelId, input);
      records.push(...result.records);
      Object.assign(detailCache, result.detailCache);
    }

    return { records, detailCache };
  }

  private async fetchCustomChannelMusicRecords(
    client: HolodexApiClient,
    channelId: string,
    input: {
      includeRelationships: boolean;
      pageLimit: number | null;
      pageSize: number;
    }
  ): Promise<{ records: HolodexVideoRecord[]; detailCache: Record<string, HolodexVideoDetail> }> {
    const records: HolodexVideoRecord[] = [];
    const detailCache: Record<string, HolodexVideoDetail> = {};
    const pageSize = Math.min(Math.max(Math.round(input.pageSize), 1), 50);

    for (const topicId of HOLODEX_MUSIC_TOPICS) {
      const rows = [
        { type: "topic", value: topicId, text: topicId },
        { type: "channel", value: channelId, text: channelId }
      ];
      const firstPage = await client.fetchSearchPage({
        rows,
        pageNumber: 1,
        pageSize
      });
      const pageCount = Math.max(1, Math.ceil(firstPage.total / pageSize));
      const lastPage = Math.min(pageCount, input.pageLimit ? Math.max(1, Math.round(input.pageLimit)) : pageCount);
      records.push(...this.normalizePageItems(firstPage.items, undefined, 1, rows));
      this.reportProgress(`Holodex custom ${channelId}/${topicId}: ${firstPage.total} row(s), ${lastPage}/${pageCount} page(s)`);

      for (let pageNumber = 2; pageNumber <= lastPage; pageNumber += 1) {
        const page = await client.fetchSearchPage({
          rows,
          pageNumber,
          pageSize
        });
        records.push(...this.normalizePageItems(page.items, undefined, pageNumber, rows));
      }
    }

    const recent = await this.fetchRecentCustomChannelLikelyMusicRecordsBestEffort(client, channelId, {
      pageSize,
      pageLimit: input.pageLimit
    });
    if (recent.records.length > 0) {
      this.reportProgress(`Holodex custom ${channelId}: recent scan found ${recent.records.length} likely untagged song(s)`);
    }
    records.push(...recent.records);

    const rowsForDetails = makeCatalogRowsFromRecords(records);
    Object.assign(
      detailCache,
      await this.fetchDetailsForRows(client, rowsForDetails.map((row) => row.youtubeVideoId), {
        includeRelationships: input.includeRelationships
      })
    );

    return {
      records: [...new Map(records.map((record) => [record.youtubeVideoId, record])).values()],
      detailCache
    };
  }

  private async fetchRecentCustomChannelLikelyMusicRecordsBestEffort(
    client: HolodexApiClient,
    channelId: string,
    input: {
      pageLimit: number | null;
      pageSize: number;
    }
  ): Promise<{ records: HolodexVideoRecord[] }> {
    let didTimeout = false;
    let timeoutId: NodeJS.Timeout | null = null;
    const emptyResult = { records: [] };
    const scanPromise = this.fetchRecentCustomChannelLikelyMusicRecords(client, channelId, input).catch((error) => {
      if (!didTimeout) {
        this.reportProgress(
          `Holodex custom ${channelId}: recent scan skipped (${error instanceof Error ? error.message : "unknown error"})`
        );
      }
      return emptyResult;
    });
    const timeoutPromise = new Promise<{ records: HolodexVideoRecord[] }>((resolve) => {
      timeoutId = setTimeout(() => {
        didTimeout = true;
        this.reportProgress(`Holodex custom ${channelId}: recent scan skipped after 10s`);
        resolve(emptyResult);
      }, CUSTOM_CHANNEL_RECENT_MUSIC_TIMEOUT_MS);
    });

    const result = await Promise.race([scanPromise, timeoutPromise]);
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    return result;
  }

  private async fetchRecentCustomChannelLikelyMusicRecords(
    client: HolodexApiClient,
    channelId: string,
    input: {
      pageLimit: number | null;
      pageSize: number;
    }
  ): Promise<{ records: HolodexVideoRecord[] }> {
    const records: HolodexVideoRecord[] = [];
    const pageLimit = Math.min(
      Math.max(1, Math.round(input.pageLimit ?? CUSTOM_CHANNEL_RECENT_MUSIC_PAGE_LIMIT)),
      CUSTOM_CHANNEL_RECENT_MUSIC_PAGE_LIMIT
    );
    const pageSize = Math.min(input.pageSize, CUSTOM_CHANNEL_RECENT_MUSIC_PAGE_SIZE);

    for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber += 1) {
      const page = await client.fetchChannelVideos({
        channelId,
        type: "videos",
        pageNumber,
        pageSize,
        includeRelationships: false
      });
      const normalized = this.normalizePageItems(page.items, undefined, pageNumber, [{ type: "channel", value: channelId }]);
      for (const record of normalized) {
        if (record.topicId === "Original_Song" || record.topicId === "Music_Cover") {
          continue;
        }

        const inferredTopic = this.inferCustomChannelMusicTopic(record);
        if (!inferredTopic) {
          continue;
        }
        records.push({ ...record, topicId: inferredTopic });
      }

      if (page.items.length < pageSize) {
        break;
      }
    }

    return {
      records: [...new Map(records.map((record) => [record.youtubeVideoId, record])).values()]
    };
  }

  private inferCustomChannelMusicTopic(record: HolodexVideoRecord): HololiveMusicTopic | null {
    const title = record.title.trim();
    const normalizedTitle = title.normalize("NFKC").toLowerCase();
    if (!title || record.itemType !== "stream" || record.status === "missing") {
      return null;
    }

    if (
      /(\u6b4c\u67a0|\u96d1\u8ac7|\u8010\u4e45|\u914d\u4fe1|\u540c\u6642\u8996\u8074|\u304a\u77e5\u3089\u305b|\u544a\u77e5)/u.test(title)
    ) {
      return null;
    }

    if (/(\u30ab\u30d0\u30fc|\u6b4c\u3063\u3066\u307f\u305f)/u.test(title)) {
      return "Music_Cover";
    }

    if (
      /(#?vocaduo|#?\u30dc\u30ab\u30c7\u30e5\u30aa|\u30aa\u30ea\u30b8\u30ca\u30eb(?:\u66f2|\u30bd\u30f3\u30b0)?|\u30aa\u30ea\u66f2|\u697d\u66f2|\u30df\u30e5\u30fc\u30b8\u30c3\u30af\u30d3\u30c7\u30aa)/iu.test(title)
    ) {
      return "Original_Song";
    }

    if (
      /\b(karaoke|singing\s+stream|free\s+chat|schedule|watchalong|gameplay|zatsudan|asmr)\b/iu.test(normalizedTitle) ||
      /(歌枠|雑談|耐久|配信|同時視聴|お知らせ|告知)/u.test(title)
    ) {
      return null;
    }

    if (/\b(cover|covered\s+by|歌ってみた)\b/iu.test(normalizedTitle) || /(カバー|歌ってみた)/u.test(title)) {
      return "Music_Cover";
    }

    if (
      /\b(original\s+song|official\s+(?:music\s+)?video|music\s+video|voca\s*duo|vocaduo)\b/iu.test(normalizedTitle) ||
      /(#?vocaduo|#?ボカデュオ|オリジナル(?:曲|ソング)?|オリ曲|楽曲|ミュージックビデオ)/iu.test(title)
    ) {
      return "Original_Song";
    }

    if (/\s\/\s/u.test(title) && !/\b(cover|covered\s+by)\b/iu.test(normalizedTitle)) {
      return "Original_Song";
    }

    return null;
  }

  private collectOfficialMusicVideoPage(
    items: Parameters<typeof normalizeHolodexSearchItem>[0]["item"][],
    input: {
      records: HolodexVideoRecord[];
      detailCache: Record<string, HolodexVideoDetail>;
      topicId: (typeof HOLODEX_MUSIC_TOPICS)[number];
      videoType: (typeof HOLODEX_VIDEO_TYPES)[number];
      pageNumber: number;
      includeRelationships: boolean;
    }
  ): void {
    const sourcePageUrl = `https://holodex.net/api/v2/videos?org=Hololive&topic=${encodeURIComponent(input.topicId)}&type=${input.videoType}`;

    items.forEach((item, index) => {
      const record = normalizeHolodexSearchItem({
        item,
        sourcePage: input.pageNumber,
        positionOnPage: index + 1,
        sourcePageUrl,
        fallbackOrg: "Hololive"
      });
      if (!record) {
        return;
      }

      input.records.push(record);
      input.detailCache[record.youtubeVideoId] = normalizeHolodexVideoItemDetail(
        record.youtubeVideoId,
        item,
        input.includeRelationships
      );
    });
  }

  private filterRowsToKnownHolodexChannels(
    rows: HolodexCatalogRow[],
    collabChannelIdsByVideoId: Map<string, Set<string>>
  ): HolodexCatalogRow[] {
    const knownChannelIds = new Set(
      this.database
        .listHololiveChannels()
        .filter((channel) => channel.kind !== "unknown")
        .map((channel) => channel.id)
    );

    return rows.filter((row) => {
      const uploaderChannelId = row.channelId?.trim() ?? "";
      if (uploaderChannelId && knownChannelIds.has(uploaderChannelId)) {
        return true;
      }

      return [...(collabChannelIdsByVideoId.get(row.youtubeVideoId) ?? [])].some((channelId) =>
        knownChannelIds.has(channelId)
      );
    });
  }

  private async fetchCollabMusicRecords(
    client: HolodexApiClient,
    input: {
      includeRelationships: boolean;
      pageLimit: number | null;
      collabChannelIdsByVideoId: Map<string, Set<string>>;
      channelLinks?: Array<{ idolId: string; youtubeChannelId: string }>;
    }
  ): Promise<HolodexVideoRecord[]> {
    const records: HolodexVideoRecord[] = [];
    const pageLimit = Math.max(1, Math.round(input.pageLimit ?? 1));

    const uniqueLinks = [
      ...new Map((input.channelLinks ?? this.database.listHololiveIdolMainChannels()).map((link) => [link.youtubeChannelId, link])).values()
    ];

    for (const link of uniqueLinks) {
      for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber += 1) {
        const page = await client.fetchChannelVideos({
          channelId: link.youtubeChannelId,
          type: "collabs",
          pageNumber,
          includeRelationships: input.includeRelationships
        });
        const normalized = this.normalizePageItems(page.items, undefined, pageNumber, [
          { type: "channel", value: link.youtubeChannelId }
        ]);
        for (const record of normalized) {
          if (record.topicId !== "Original_Song" && record.topicId !== "Music_Cover") {
            continue;
          }
          records.push(record);
          input.collabChannelIdsByVideoId.set(record.youtubeVideoId, input.collabChannelIdsByVideoId.get(record.youtubeVideoId) ?? new Set());
          input.collabChannelIdsByVideoId.get(record.youtubeVideoId)?.add(link.youtubeChannelId);
        }

        if (page.items.length < HOLODEX_CHANNEL_PAGE_SIZE) {
          break;
        }
      }
    }

    return records;
  }
}
