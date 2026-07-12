import type { HololiveCustomSongPreview, HololiveMusicVideoStatsRefreshResult } from "../../src/shared/contracts";
import type { HololiveCustomSongUpsertRequest } from "../../src/shared/ipc";
import type { DatabaseService } from "./database";

const YOUTUBE_VIDEOS_API_URL = "https://www.googleapis.com/youtube/v3/videos";
const YOUTUBE_VIDEO_STATS_BATCH_SIZE = 50;

interface YouTubeVideoStatsServiceOptions {
  apiKey?: string | null;
  fetcher?: typeof fetch;
}

interface YouTubeVideosApiItem {
  id?: string;
  snippet?: {
    title?: string;
    channelId?: string;
    channelTitle?: string;
    publishedAt?: string;
    thumbnails?: Record<string, { url?: string; width?: number; height?: number }>;
  };
  contentDetails?: {
    duration?: string;
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

interface YouTubeVideoStatsBatchResult {
  stats: Array<{
    youtubeVideoId: string;
    viewCount: number;
    fetchedAt: string;
    youtubeChannelId: string | null;
    youtubeChannelName: string | null;
  }>;
  unavailableVideos: Array<{ youtubeVideoId: string; reason: string }>;
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

  constructor(
    private readonly database: DatabaseService,
    options: YouTubeVideoStatsServiceOptions = {}
  ) {
    this.fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
    this.apiKeyOverride = options.apiKey?.trim() || null;
  }

  async refreshViewCounts(input: {
    youtubeVideoIds?: string[] | null;
    limit?: number | null;
  } = {}): Promise<HololiveMusicVideoStatsRefreshResult> {
    const videoIds = this.database.listHololiveMusicVideoIdsForStats(input);
    const fetchedAt = new Date().toISOString();

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

    const apiKey = await this.readApiKey();
    const batches = this.chunk(videoIds, YOUTUBE_VIDEO_STATS_BATCH_SIZE);
    let updatedVideos = 0;
    let unavailableVideos = 0;
    let failedBatches = 0;
    let unavailableBackupCreated = false;

    for (const batch of batches) {
      try {
        const batchResult = await this.fetchBatch(batch, apiKey, fetchedAt);
        const sourceMismatches = batchResult.stats.flatMap((stat) => {
          const reason = this.database.getHololiveMusicSourceChannelMismatchReason({
            youtubeVideoId: stat.youtubeVideoId,
            youtubeChannelId: stat.youtubeChannelId,
            youtubeChannelName: stat.youtubeChannelName
          });
          return reason ? [{ youtubeVideoId: stat.youtubeVideoId, reason }] : [];
        });
        const sourceMismatchIds = new Set(sourceMismatches.map((mismatch) => mismatch.youtubeVideoId));
        const validStats = batchResult.stats.filter((stat) => !sourceMismatchIds.has(stat.youtubeVideoId));
        this.database.upsertHololiveMusicVideoStats(validStats);
        updatedVideos += validStats.length;
        for (const unavailable of [...batchResult.unavailableVideos, ...sourceMismatches]) {
          this.database.markHololiveMusicVideoUnavailable({
            youtubeVideoId: unavailable.youtubeVideoId,
            reason: unavailable.reason,
            createBackup: !unavailableBackupCreated
          });
          unavailableBackupCreated = true;
          unavailableVideos += 1;
        }
      } catch {
        failedBatches += 1;
      }
    }

    return {
      requestedVideos: videoIds.length,
      updatedVideos,
      missingVideos: Math.max(0, videoIds.length - updatedVideos),
      unavailableVideos,
      failedBatches,
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
    const unavailableReason = this.getUnavailableReason(item.status);
    if (unavailableReason) {
      throw new Error(unavailableReason);
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
      return input;
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
    fetchedAt: string
  ): Promise<YouTubeVideoStatsBatchResult> {
    const url = new URL(YOUTUBE_VIDEOS_API_URL);
    url.searchParams.set("part", "snippet,statistics,status");
    url.searchParams.set(
      "fields",
      "items(id,snippet(channelId,channelTitle),statistics(viewCount),status(uploadStatus,privacyStatus,embeddable))"
    );
    url.searchParams.set("id", youtubeVideoIds.join(","));
    url.searchParams.set("key", apiKey);

    const response = await this.fetcher(url);
    if (!response.ok) {
      throw new Error(`YouTube video stats request failed with HTTP ${response.status}`);
    }

    const body = (await response.json()) as YouTubeVideosApiResponse;
    const returnedIds = new Set<string>();
    const unavailableVideos: YouTubeVideoStatsBatchResult["unavailableVideos"] = [];
    const stats = (body.items ?? [])
      .map((item) => {
        const youtubeVideoId = item.id?.trim() ?? "";
        if (!youtubeVideoId) {
          return null;
        }
        returnedIds.add(youtubeVideoId);

        const unavailableReason = this.getUnavailableReason(item.status);
        if (unavailableReason) {
          unavailableVideos.push({ youtubeVideoId, reason: unavailableReason });
          return null;
        }

        const viewCount = Number.parseInt(item.statistics?.viewCount ?? "", 10);
        if (!Number.isFinite(viewCount) || viewCount < 0) {
          return null;
        }
        return {
          youtubeVideoId,
          viewCount,
          fetchedAt,
          youtubeChannelId: item.snippet?.channelId?.trim() || null,
          youtubeChannelName: item.snippet?.channelTitle?.trim() || null
        };
      })
      .filter((item): item is YouTubeVideoStatsBatchResult["stats"][number] => Boolean(item));

    for (const videoId of youtubeVideoIds) {
      if (!returnedIds.has(videoId)) {
        unavailableVideos.push({
          youtubeVideoId: videoId,
          reason: "YouTube Data API did not return the video during stats refresh."
        });
      }
    }

    return { stats, unavailableVideos };
  }

  private async fetchVideoMetadata(youtubeVideoId: string, apiKey: string): Promise<YouTubeVideosApiItem> {
    const url = new URL(YOUTUBE_VIDEOS_API_URL);
    url.searchParams.set("part", "snippet,contentDetails,statistics,status");
    url.searchParams.set(
      "fields",
      "items(id,snippet(title,channelId,channelTitle,publishedAt,thumbnails),contentDetails(duration),statistics(viewCount),status(uploadStatus,privacyStatus,embeddable))"
    );
    url.searchParams.set("id", youtubeVideoId);
    url.searchParams.set("key", apiKey);

    const response = await this.fetcher(url);
    if (!response.ok) {
      throw new Error(`YouTube video metadata request failed with HTTP ${response.status}`);
    }

    const body = (await response.json()) as YouTubeVideosApiResponse;
    const item = body.items?.find((candidate) => candidate.id === youtubeVideoId);
    if (!item) {
      throw new Error("YouTube Data API did not return that video.");
    }
    return item;
  }

  private getUnavailableReason(status: YouTubeVideosApiItem["status"]): string | null {
    const uploadStatus = status?.uploadStatus?.trim().toLowerCase() ?? "";
    if (uploadStatus === "deleted") {
      return "YouTube reports this video as deleted.";
    }
    if (uploadStatus === "failed" || uploadStatus === "rejected") {
      return `YouTube reports this video upload as ${uploadStatus}.`;
    }

    const privacyStatus = status?.privacyStatus?.trim().toLowerCase() ?? "";
    if (privacyStatus === "private") {
      return "YouTube reports this video as private.";
    }

    if (status?.embeddable === false) {
      return "YouTube reports this video as not embeddable.";
    }

    return null;
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

    return this.database.getSettings()["sources.youtubeApiKey"]?.trim() || null;
  }

  private chunk<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let index = 0; index < items.length; index += size) {
      chunks.push(items.slice(index, index + size));
    }
    return chunks;
  }
}
