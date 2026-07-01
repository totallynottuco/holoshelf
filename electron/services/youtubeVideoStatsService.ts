import type { HololiveMusicVideoStatsRefreshResult } from "../../src/shared/contracts";
import type { DatabaseService } from "./database";

const YOUTUBE_VIDEOS_API_URL = "https://www.googleapis.com/youtube/v3/videos";
const YOUTUBE_VIDEO_STATS_BATCH_SIZE = 50;

interface YouTubeVideoStatsServiceOptions {
  apiKey?: string | null;
  fetcher?: typeof fetch;
}

interface YouTubeVideosApiItem {
  id?: string;
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
  stats: Array<{ youtubeVideoId: string; viewCount: number; fetchedAt: string }>;
  unavailableVideos: Array<{ youtubeVideoId: string; reason: string }>;
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
        this.database.upsertHololiveMusicVideoStats(batchResult.stats);
        updatedVideos += batchResult.stats.length;
        for (const unavailable of batchResult.unavailableVideos) {
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

  private async fetchBatch(
    youtubeVideoIds: string[],
    apiKey: string,
    fetchedAt: string
  ): Promise<YouTubeVideoStatsBatchResult> {
    const url = new URL(YOUTUBE_VIDEOS_API_URL);
    url.searchParams.set("part", "statistics,status");
    url.searchParams.set("fields", "items(id,statistics(viewCount),status(uploadStatus,privacyStatus,embeddable))");
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
          fetchedAt
        };
      })
      .filter((item): item is { youtubeVideoId: string; viewCount: number; fetchedAt: string } => Boolean(item));

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
    if (this.apiKeyOverride) {
      return this.apiKeyOverride;
    }

    const settingsApiKey = this.database.getSettings()["sources.youtubeApiKey"]?.trim();
    if (settingsApiKey) {
      return settingsApiKey;
    }

    throw new Error("YouTube API key not found. Save a YouTube Data API key in Settings.");
  }

  private chunk<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let index = 0; index < items.length; index += size) {
      chunks.push(items.slice(index, index + size));
    }
    return chunks;
  }
}
