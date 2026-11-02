import type { HololiveCustomSongPreview, HololiveMusicVideoStatsRefreshResult } from "../../src/shared/contracts";
import type { HololiveCustomSongUpsertRequest } from "../../src/shared/ipc";
import type { DatabaseService } from "./database";
import { mapConcurrent, requestConcurrency } from "../../src/shared/asyncPool";

const YOUTUBE_VIDEOS_API_URL = "https://www.googleapis.com/youtube/v3/videos";
const YOUTUBE_VIDEO_STATS_BATCH_SIZE = 50;

interface YouTubeVideoStatsServiceOptions {
  apiKey?: string | null;
  fetcher?: typeof fetch;
  requestConcurrency?: number;
  log?: (message: string) => void;
}

export interface YouTubeVideosApiItem {
  id?: string;
  snippet?: {
    title?: string;
    channelId?: string;
    channelTitle?: string;
    publishedAt?: string;
    liveBroadcastContent?: string;
    thumbnails?: Record<string, { url?: string; width?: number; height?: number }>;
  };
  contentDetails?: {
    duration?: string;
    regionRestriction?: { allowed?: string[]; blocked?: string[] };
  };
  liveStreamingDetails?: {
    scheduledStartTime?: string;
    actualStartTime?: string;
    actualEndTime?: string;
  };
  statistics?: {
    viewCount?: string;
  };
  status?: {
    uploadStatus?: string;
    privacyStatus?: string;
    embeddable?: boolean;
  };
}

interface YouTubeVideosApiResponse {
  items?: YouTubeVideosApiItem[];
}

export interface YouTubeVerifiedVideoStats {
  youtubeVideoId: string;
  viewCount: number;
  fetchedAt: string;
  youtubeChannelId: string | null;
  youtubeChannelName: string | null;
  durationSeconds: number | null;
  title: string | null;
  status: "past" | "live" | "upcoming";
}

export interface YouTubeVideoAvailabilityCheckResult {
  checkedAt: string;
  /** Null/omitted means globally playable somewhere, rather than checked for one country. */
  regionCode?: string | null;
  requestedVideos: number;
  availableVideoIds: string[];
  deferredVideos: Array<{ youtubeVideoId: string; reason: string }>;
  unavailableVideos: Array<{ youtubeVideoId: string; reason: string }>;
  stats: YouTubeVerifiedVideoStats[];
}

interface YouTubeVideoStatsBatchResult {
  stats: YouTubeVerifiedVideoStats[];
  deferredVideos: Array<{ youtubeVideoId: string; reason: string }>;
  unavailableVideos: Array<{ youtubeVideoId: string; reason: string }>;
}

const ISO_COUNTRY_CODES = new Set((
  "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ " +
  "CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR " +
  "GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP " +
  "KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ " +
  "NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ " +
  "TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW"
).split(" "));

export interface YouTubeVideoAvailability {
  state: "ready" | "deferred" | "unavailable";
  reason: string | null;
}

export class YouTubeVideoNotReadyError extends Error {
  constructor(readonly availabilityState: "deferred" | "unavailable", reason: string) {
    super(reason);
    this.name = "YouTubeVideoNotReadyError";
  }
}

export function classifyYouTubeVideoAvailability(
  item: YouTubeVideosApiItem | undefined,
  regionCode?: string | null
): YouTubeVideoAvailability {
  const deferred = (reason: string): YouTubeVideoAvailability => ({ state: "deferred", reason });
  const unavailable = (reason: string): YouTubeVideoAvailability => ({ state: "unavailable", reason });
  if (!item) return deferred("YouTube has not returned a publicly available video for this ID.");
  const upload = item.status?.uploadStatus?.trim().toLowerCase();
  if (upload === "deleted" || upload === "failed" || upload === "rejected") {
    return unavailable(`YouTube reports this video upload as ${upload}.`);
  }
  const privacy = item.status?.privacyStatus?.trim().toLowerCase();
  if (privacy !== "public" && privacy !== "unlisted") {
    return deferred(privacy === "private" ? "YouTube reports this video as private." : "YouTube has not confirmed public or unlisted visibility.");
  }
  if (item.status?.embeddable !== true) return deferred("YouTube has not confirmed that this video is embeddable.");
  if (!item.snippet?.title?.trim() || !item.snippet?.channelId?.trim()) {
    return deferred("YouTube has not supplied a valid video title and channel.");
  }
  const restriction = item.contentDetails?.regionRestriction;
  const normalizeRegions = (values: string[] | undefined) => new Set((values ?? []).map((value) => value.trim().toUpperCase()));
  if (restriction && ((restriction.allowed !== undefined && !Array.isArray(restriction.allowed)) ||
    (restriction.blocked !== undefined && !Array.isArray(restriction.blocked)))) {
    return deferred("YouTube supplied unverified region availability.");
  }
  const allowed = normalizeRegions(restriction?.allowed);
  const blocked = normalizeRegions(restriction?.blocked);
  if ((restriction?.allowed !== undefined && (allowed.size === 0 || [...allowed].every((code) => blocked.has(code)))) ||
    [...ISO_COUNTRY_CODES].every((code) => blocked.has(code))) {
    return deferred("YouTube currently blocks playback in every country.");
  }
  const region = regionCode?.trim().toUpperCase();
  if (region && (blocked.has(region) || (restriction?.allowed !== undefined && !allowed.has(region)))) {
    return deferred(`YouTube does not currently allow playback in ${region}.`);
  }
  const broadcast = item.snippet.liveBroadcastContent?.trim().toLowerCase();
  const liveDetails = item.liveStreamingDetails;
  const validTime = (value: string | undefined) => Boolean(value?.trim() && Number.isFinite(Date.parse(value)));
  const preview = (broadcast === "live" || broadcast === "upcoming") && !validTime(liveDetails?.actualEndTime) &&
    (validTime(liveDetails?.scheduledStartTime) || validTime(liveDetails?.actualStartTime));
  if (broadcast === "live" || broadcast === "upcoming") {
    if (!preview) return deferred("YouTube has not confirmed a real live or premiere preview.");
    if (upload !== "processed" && upload !== "uploaded") return deferred("YouTube has not confirmed a ready live or premiere preview.");
    return { state: "ready", reason: null };
  }
  if (upload !== "processed") return deferred("YouTube has not finished processing this video.");
  if ((parseIso8601DurationSeconds(item.contentDetails?.duration) ?? 0) <= 0) {
    return deferred("YouTube has not confirmed playable media or a real live preview.");
  }
  return { state: "ready", reason: null };
}

export function parseYouTubeVideoId(input: string): string | null {
  const trimmed = input.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    return trimmed;
  }

  try {
    const url = new URL(trimmed);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (host === "youtu.be") {
      const id = url.pathname.split("/").filter(Boolean)[0] ?? "";
      return /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
    }
    const isYouTubeHost = host === "youtube.com" || host.endsWith(".youtube.com");
    const isYouTubeNoCookieHost = host === "youtube-nocookie.com" || host.endsWith(".youtube-nocookie.com");
    if (isYouTubeHost || isYouTubeNoCookieHost) {
      const watchId = url.searchParams.get("v") ?? "";
      if (/^[a-zA-Z0-9_-]{11}$/.test(watchId)) {
        return watchId;
      }
      const parts = url.pathname.split("/").filter(Boolean);
      const markerIndex = parts.findIndex((part) => ["shorts", "embed", "live"].includes(part));
      const id = markerIndex >= 0 ? parts[markerIndex + 1] ?? "" : "";
      return /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
    }
  } catch {
    return null;
  }

  return null;
}

function normalizeYouTubeWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

function toPublishedDateInput(value?: string | null): string | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    return null;
  }
  if (/^\d{4}-\d{2}-\d{2}$/u.test(trimmed)) {
    return trimmed;
  }
  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function parseIso8601DurationSeconds(value?: string | null): number | null {
  const duration = value?.trim() ?? "";
  if (!duration) {
    return null;
  }
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(duration);
  if (!match) {
    return null;
  }
  const days = Number(match[1] ?? 0);
  const hours = Number(match[2] ?? 0);
  const minutes = Number(match[3] ?? 0);
  const seconds = Number(match[4] ?? 0);
  const total = days * 86400 + hours * 3600 + minutes * 60 + seconds;
  return Number.isFinite(total) ? Math.round(total) : null;
}

type YouTubeThumbnailMap = NonNullable<NonNullable<YouTubeVideosApiItem["snippet"]>["thumbnails"]>;

function pickBestThumbnail(thumbnails?: YouTubeThumbnailMap): string | null {
  if (!thumbnails) {
    return null;
  }
  const candidates = Object.values(thumbnails).filter(
    (thumbnail): thumbnail is { url: string; width?: number; height?: number } => Boolean(thumbnail?.url)
  );
  if (candidates.length === 0) {
    return null;
  }
  return [...candidates].sort((left, right) => (right.width ?? 0) * (right.height ?? 0) - (left.width ?? 0) * (left.height ?? 0))[0]?.url ?? null;
}

export class YouTubeVideoStatsService {
  private readonly fetcher: typeof fetch;
  private readonly apiKeyOverride: string | null;
  private readonly concurrency: number;
  private readonly log: (message: string) => void;

  constructor(
    private readonly database: DatabaseService,
    options: YouTubeVideoStatsServiceOptions = {}
  ) {
    this.fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
    this.apiKeyOverride = options.apiKey?.trim() || null;
    this.concurrency = requestConcurrency(options.requestConcurrency);
    this.log = options.log ?? (() => undefined);
  }

  async checkAvailability(input: {
    youtubeVideoIds: string[];
    regionCode?: string | null;
  }): Promise<YouTubeVideoAvailabilityCheckResult> {
    const videoIds = [...new Set(input.youtubeVideoIds.map((id) => id.trim()).filter(Boolean))];
    const checkedAt = new Date().toISOString();
    const regionCode = this.readRegionCode(input.regionCode);
    if (videoIds.length === 0) {
      return { checkedAt, regionCode, requestedVideos: 0, availableVideoIds: [], deferredVideos: [], unavailableVideos: [], stats: [] };
    }
    const apiKey = await this.readApiKey();
    try {
      const results = await mapConcurrent(this.chunk(videoIds, YOUTUBE_VIDEO_STATS_BATCH_SIZE), this.concurrency,
        (batch) => this.fetchBatch(batch, apiKey, checkedAt, regionCode));
      const stats = results.flatMap((result) => result.stats);
      return {
        checkedAt, regionCode, requestedVideos: videoIds.length, availableVideoIds: stats.map((stat) => stat.youtubeVideoId), stats,
        deferredVideos: results.flatMap((result) => result.deferredVideos),
        unavailableVideos: results.flatMap((result) => result.unavailableVideos)
      };
    } catch (error) {
      const reason = (error instanceof Error ? error.message : "Unknown YouTube availability failure")
        .split(apiKey).join("[redacted]").split(encodeURIComponent(apiKey)).join("[redacted]").slice(0, 300);
      throw new Error(`YouTube availability verification failed: ${reason}`);
    }
  }

  async refreshViewCounts(input: {
    youtubeVideoIds?: string[] | null;
    limit?: number | null;
  } = {}, verifiedAvailability?: YouTubeVideoAvailabilityCheckResult | null): Promise<HololiveMusicVideoStatsRefreshResult> {
    const videoIds = this.database.listHololiveMusicVideoIdsForStats(input);
    const regionCode = this.readRegionCode();
    const now = Date.now();
    const verifiedAt = verifiedAvailability ? Date.parse(verifiedAvailability.checkedAt) : Number.NaN;
    // Only reuse fresh responses supplied by this run's pre-import verification.
    // Stored library statistics are never evidence that a video is still available.
    const cacheRegion = verifiedAvailability?.regionCode?.trim().toUpperCase() || null;
    const cache = cacheRegion === regionCode && Number.isFinite(verifiedAt) && now - verifiedAt <= 10 * 60_000 && verifiedAt - now <= 60_000
      ? verifiedAvailability : null;
    const fetchedAt = cache?.checkedAt ?? new Date(now).toISOString();

    if (videoIds.length === 0) {
      return {
        requestedVideos: 0,
        updatedVideos: 0,
        missingVideos: 0,
        unavailableVideos: 0,
        failedBatches: 0,
        batches: 0,
        fetchedAt
      };
    }

    const cached: YouTubeVideoStatsBatchResult = { stats: [], deferredVideos: [], unavailableVideos: [] };
    const covered = new Set<string>();
    if (cache) {
      const available = new Set(cache.availableVideoIds);
      const stats = new Map(cache.stats.map((stat) => [stat.youtubeVideoId, stat]));
      const deferred = new Map(cache.deferredVideos.map((item) => [item.youtubeVideoId, item]));
      const unavailable = new Map(cache.unavailableVideos.map((item) => [item.youtubeVideoId, item]));
      for (const id of videoIds) {
        const stat = stats.get(id);
        if (available.has(id) && !deferred.has(id) && !unavailable.has(id) && stat?.fetchedAt === fetchedAt &&
          Number.isSafeInteger(stat.viewCount) && stat.viewCount >= 0) {
          cached.stats.push({ ...stat, fetchedAt });
          covered.add(id);
        } else if (!available.has(id) && deferred.has(id) && !unavailable.has(id)) {
          cached.deferredVideos.push(deferred.get(id)!);
          covered.add(id);
        } else if (!available.has(id) && unavailable.has(id) && !deferred.has(id)) {
          cached.unavailableVideos.push(unavailable.get(id)!);
          covered.add(id);
        }
      }
    }
    const pendingIds = videoIds.filter((id) => !covered.has(id));
    const batches = this.chunk(pendingIds, YOUTUBE_VIDEO_STATS_BATCH_SIZE);
    const apiKey = batches.length > 0 ? await this.readApiKey() : "";
    let updatedVideos = 0;
    let unavailableVideos = 0;
    let failedBatches = 0;
    const failedBatchDetails: NonNullable<HololiveMusicVideoStatsRefreshResult["failedBatchDetails"]> = [];
    let completedBatches = 0;
    let unavailableBackupCreated = false;
    const verifiedVideoIds = new Set<string>();

    const applyResults = (successful: YouTubeVideoStatsBatchResult[]) => {
      const fetchedStats = successful.flatMap((result) => result.stats);
      const sourceMismatches = fetchedStats.flatMap((stat) => {
        const reason = this.database.getHololiveMusicSourceChannelMismatchReason({
          youtubeVideoId: stat.youtubeVideoId,
          youtubeChannelId: stat.youtubeChannelId,
          youtubeChannelName: stat.youtubeChannelName
        });
        return reason ? [{ youtubeVideoId: stat.youtubeVideoId, reason }] : [];
      });
      const sourceMismatchIds = new Set(sourceMismatches.map((mismatch) => mismatch.youtubeVideoId));
      const validStats = fetchedStats.filter((stat) => !sourceMismatchIds.has(stat.youtubeVideoId));
      for (const stat of validStats) verifiedVideoIds.add(stat.youtubeVideoId);
      for (const stat of validStats) this.database.restoreHololiveMusicVideoAvailability(stat.youtubeVideoId);
      this.database.upsertHololiveMusicVideoStats(validStats);
      updatedVideos += validStats.length;
      for (const unavailable of [
        ...successful.flatMap((result) => [...result.unavailableVideos, ...result.deferredVideos]), ...sourceMismatches
      ]) {
        this.database.deferHololiveMusicVideo({
          youtubeVideoId: unavailable.youtubeVideoId,
          reason: unavailable.reason,
          createBackup: !unavailableBackupCreated
        });
        unavailableBackupCreated = true;
        unavailableVideos += 1;
      }
    };

    if (covered.size > 0) {
      applyResults([cached]);
      this.log(`YouTube stats: reused ${covered.size} fresh availability result(s); ${pendingIds.length} video(s) need another API check`);
    }

    // Checkpoint each bounded group instead of exporting the entire SQLite file
    // after every 50-video response. Failed HTTP batches never become removals.
    for (const group of this.chunk(batches, this.concurrency)) {
      const results = await mapConcurrent(group, this.concurrency, async (batch) => {
        try {
          return await this.fetchBatch(batch, apiKey, fetchedAt, regionCode);
        } catch (error) {
          failedBatches += 1;
          const reason = (error instanceof Error ? error.message : "Unknown YouTube stats failure")
            .split(apiKey).join("[redacted]").slice(0, 300);
          failedBatchDetails.push({ requestedVideos: batch.length, reason });
          this.log(`YouTube stats batch failed (${batch.length} videos): ${reason}`);
          return null;
        }
      });
      applyResults(results.filter((result): result is YouTubeVideoStatsBatchResult => result !== null));
      completedBatches += group.length;
      this.log(`YouTube stats: ${completedBatches}/${batches.length} batches, ${updatedVideos}/${videoIds.length} updated, `
        + `${unavailableVideos} unavailable, ${failedBatches} failed batches`);
    }

    // Only compare mirrors after every checked-but-unavailable candidate has been deferred.
    // The narrow repair requires current positive evidence for both videos in a pair.
    this.database.repairVerifiedHololiveMusicAudioMirrors?.([...verifiedVideoIds]);

    return {
      requestedVideos: videoIds.length,
      updatedVideos,
      missingVideos: Math.max(0, videoIds.length - updatedVideos),
      unavailableVideos,
      failedBatches,
      failedBatchDetails,
      batches: batches.length,
      fetchedAt
    };
  }

  async previewCustomSong(input: { youtubeUrl: string }): Promise<HololiveCustomSongPreview> {
    const youtubeVideoId = parseYouTubeVideoId(input.youtubeUrl);
    if (!youtubeVideoId) {
      throw new Error("Enter a valid YouTube video link.");
    }

    const youtubeUrl = normalizeYouTubeWatchUrl(youtubeVideoId);
    const apiKey = await this.readOptionalApiKey();
    if (!apiKey) {
      return {
        youtubeVideoId,
        youtubeUrl,
        title: null,
        songName: null,
        channelId: null,
        channelName: null,
        publishedAt: null,
        durationSeconds: null,
        viewCount: null,
        fetchedAt: null,
        thumbnailUrl: null,
        usedApi: false,
        apiKeyMissing: true
      };
    }

    const fetchedAt = new Date().toISOString();
    const item = await this.fetchVideoMetadata(youtubeVideoId, apiKey);
    const availability = classifyYouTubeVideoAvailability(item, this.readRegionCode());
    if (availability.state !== "ready") {
      throw new YouTubeVideoNotReadyError(availability.state, availability.reason!);
    }

    const viewCount = Number.parseInt(item.statistics?.viewCount ?? "", 10);
    return {
      youtubeVideoId,
      youtubeUrl,
      title: item.snippet?.title?.trim() || null,
      songName: null,
      channelId: item.snippet?.channelId?.trim() || null,
      channelName: item.snippet?.channelTitle?.trim() || null,
      publishedAt: item.snippet?.publishedAt?.trim() || null,
      durationSeconds: parseIso8601DurationSeconds(item.contentDetails?.duration),
      viewCount: Number.isFinite(viewCount) && viewCount >= 0 ? viewCount : null,
      fetchedAt,
      thumbnailUrl: pickBestThumbnail(item.snippet?.thumbnails),
      usedApi: true,
      apiKeyMissing: false
    };
  }

  async enrichCustomSongUpsert(input: HololiveCustomSongUpsertRequest): Promise<HololiveCustomSongUpsertRequest> {
    const preview = await this.previewCustomSong({ youtubeUrl: input.youtubeUrl });
    if (!preview.usedApi) {
      throw new Error("A YouTube Data API key is required to verify a song before importing it. Save a key in Settings.");
    }
    const manualPublishedAt = input.publishedAt?.trim();
    const normalizedManualPublishedAt = manualPublishedAt
      ? toPublishedDateInput(manualPublishedAt) ?? manualPublishedAt
      : null;

    return {
      ...input,
      youtubeUrl: preview.youtubeUrl,
      channelId: input.channelId?.trim() || preview.channelId,
      channelName: input.channelName?.trim() || preview.channelName,
      publishedAt: normalizedManualPublishedAt || toPublishedDateInput(preview.publishedAt),
      durationSeconds: input.durationSeconds ?? preview.durationSeconds,
      viewCount: input.viewCount ?? preview.viewCount,
      fetchedAt: input.fetchedAt?.trim() || preview.fetchedAt
    };
  }

  private async fetchBatch(
    youtubeVideoIds: string[],
    apiKey: string,
    fetchedAt: string,
    regionCode?: string | null
  ): Promise<YouTubeVideoStatsBatchResult> {
    const url = new URL(YOUTUBE_VIDEOS_API_URL);
    url.searchParams.set("part", "snippet,contentDetails,statistics,status,liveStreamingDetails");
    url.searchParams.set(
      "fields",
      "items(id,snippet(title,channelId,channelTitle,liveBroadcastContent),contentDetails(duration,regionRestriction),liveStreamingDetails(scheduledStartTime,actualStartTime,actualEndTime),statistics(viewCount),status(uploadStatus,privacyStatus,embeddable))"
    );
    url.searchParams.set("id", youtubeVideoIds.join(","));
    url.searchParams.set("key", apiKey);

    const response = await this.fetchStatsResponse(url);
    if (!response.ok) {
      throw new Error(`YouTube video stats request failed with HTTP ${response.status}`);
    }

    const body = (await response.json()) as YouTubeVideosApiResponse;
    if (!body || !Array.isArray(body.items)) {
      throw new Error("YouTube video stats response is missing its items array");
    }
    const returnedIds = new Set<string>();
    const requestedIds = new Set(youtubeVideoIds);
    const unavailableVideos: YouTubeVideoStatsBatchResult["unavailableVideos"] = [];
    const deferredVideos: YouTubeVideoStatsBatchResult["deferredVideos"] = [];
    const stats = (body.items ?? [])
      .map((item) => {
        const youtubeVideoId = typeof item?.id === "string" ? item.id.trim() : "";
        if (!requestedIds.has(youtubeVideoId) || returnedIds.has(youtubeVideoId)) {
          throw new Error("YouTube video stats response contains an unexpected or duplicate video ID");
        }
        returnedIds.add(youtubeVideoId);

        const availability = classifyYouTubeVideoAvailability(item, regionCode);
        if (availability.state !== "ready") {
          (availability.state === "deferred" ? deferredVideos : unavailableVideos).push({
            youtubeVideoId, reason: availability.reason!
          });
          return null;
        }

        const rawViewCount = item.statistics?.viewCount;
        const viewCount = Number(rawViewCount);
        if (typeof rawViewCount !== "string" || !/^\d+$/.test(rawViewCount) || !Number.isSafeInteger(viewCount)) {
          throw new Error(`YouTube video stats response has an invalid view count for ${youtubeVideoId}`);
        }
        return {
          youtubeVideoId,
          viewCount,
          fetchedAt,
          youtubeChannelId: item.snippet?.channelId?.trim() || null,
          youtubeChannelName: item.snippet?.channelTitle?.trim() || null,
          durationSeconds: parseIso8601DurationSeconds(item.contentDetails?.duration),
          title: item.snippet?.title?.trim() || null,
          status: item.snippet?.liveBroadcastContent?.trim().toLowerCase() === "live" ? "live" as const
            : item.snippet?.liveBroadcastContent?.trim().toLowerCase() === "upcoming" ? "upcoming" as const : "past" as const
        };
      })
      .filter((item): item is YouTubeVideoStatsBatchResult["stats"][number] => Boolean(item));

    for (const videoId of youtubeVideoIds) {
      if (!returnedIds.has(videoId)) {
        deferredVideos.push({
          youtubeVideoId: videoId,
          reason: "YouTube Data API did not return the video during stats refresh."
        });
      }
    }

    return { stats, unavailableVideos, deferredVideos };
  }

  private async fetchStatsResponse(url: URL): Promise<Response> {
    for (let attempt = 0; ; attempt += 1) {
      let response: Response;
      try {
        response = await this.fetcher(url, { signal: AbortSignal.timeout(45_000) });
      } catch (error) {
        if (attempt >= 2) throw error;
        this.log("Retrying a YouTube stats request after a network error");
        await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
        continue;
      }
      if (attempt >= 2 || (response.status !== 429 && response.status < 500)) return response;
      const retryAfter = response.headers.get("Retry-After");
      const retrySeconds = Number(retryAfter);
      const delay = retryAfter && Number.isFinite(retrySeconds)
        ? Math.min(5_000, Math.max(0, retrySeconds * 1000)) : 250 * 2 ** attempt;
      await response.body?.cancel();
      this.log(`Retrying a YouTube stats request after HTTP ${response.status}`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  private async fetchVideoMetadata(youtubeVideoId: string, apiKey: string): Promise<YouTubeVideosApiItem> {
    const url = new URL(YOUTUBE_VIDEOS_API_URL);
    url.searchParams.set("part", "snippet,contentDetails,statistics,status,liveStreamingDetails");
    url.searchParams.set(
      "fields",
      "items(id,snippet(title,channelId,channelTitle,publishedAt,thumbnails,liveBroadcastContent),contentDetails(duration,regionRestriction),liveStreamingDetails(scheduledStartTime,actualStartTime,actualEndTime),statistics(viewCount),status(uploadStatus,privacyStatus,embeddable))"
    );
    url.searchParams.set("id", youtubeVideoId);
    url.searchParams.set("key", apiKey);

    let response: Response;
    try {
      response = await this.fetchStatsResponse(url);
    } catch (error) {
      const reason = (error instanceof Error ? error.message : "Unknown metadata request failure")
        .split(apiKey).join("[redacted]").split(encodeURIComponent(apiKey)).join("[redacted]").slice(0, 300);
      throw new Error(`YouTube video metadata request failed: ${reason}`);
    }
    if (!response.ok) {
      throw new Error(`YouTube video metadata request failed with HTTP ${response.status}`);
    }

    const body = (await response.json()) as YouTubeVideosApiResponse;
    const item = body.items?.find((candidate) => candidate.id === youtubeVideoId);
    if (!item) {
      throw new YouTubeVideoNotReadyError("deferred", "YouTube Data API did not return that video.");
    }
    return item;
  }

  private async readApiKey(): Promise<string> {
    const apiKey = await this.readOptionalApiKey();
    if (apiKey) {
      return apiKey;
    }

    throw new Error("YouTube API key not found. Save a YouTube Data API key in Settings.");
  }

  private async readOptionalApiKey(): Promise<string | null> {
    if (this.apiKeyOverride) {
      return this.apiKeyOverride;
    }

    return this.database.getSettings?.()?.["sources.youtubeApiKey"]?.trim() || null;
  }

  private readRegionCode(override?: string | null): string | null {
    const value = override !== undefined ? override : this.database.getSettings?.()?.["sources.youtubeRegionCode"];
    const regionCode = value?.trim().toUpperCase() || null;
    if (regionCode && !ISO_COUNTRY_CODES.has(regionCode)) {
      throw new Error("YouTube playback region must be a two-letter country code, such as US.");
    }
    return regionCode;
  }

  private chunk<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let index = 0; index < items.length; index += size) {
      chunks.push(items.slice(index, index + size));
    }
    return chunks;
  }
}
