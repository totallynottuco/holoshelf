import type { HololiveMusicVideoStatsRefreshResult } from "../../src/shared/contracts";
import type { DatabaseService } from "./database";

const YOUTUBE_VIDEOS_API_URL = "https://www.googleapis.com/youtube/v3/videos";
const YOUTUBE_VIDEO_STATS_BATCH_SIZE = 50;

interface YouTubeVideoStatsServiceOptions {
  apiKey?: string | null;
  fetcher?: typeof fetch;
}

interface YouTubeVideosApiResponse {
  items?: Array<{
    id?: string;
    statistics?: {
      viewCount?: string;
    };
  }>;
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
        failedBatches: 0,
        batches: 0,
        fetchedAt
      };
    }

    const apiKey = await this.readApiKey();
    const batches = this.chunk(videoIds, YOUTUBE_VIDEO_STATS_BATCH_SIZE);
    let updatedVideos = 0;
    let failedBatches = 0;

    for (const batch of batches) {
      try {
        const stats = await this.fetchBatch(batch, apiKey, fetchedAt);
        this.database.upsertHololiveMusicVideoStats(stats);
        updatedVideos += stats.length;
      } catch {
        failedBatches += 1;
      }
    }

    return {
      requestedVideos: videoIds.length,
      updatedVideos,
      missingVideos: Math.max(0, videoIds.length - updatedVideos),
      failedBatches,
      batches: batches.length,
      fetchedAt
    };
  }

  private async fetchBatch(
    youtubeVideoIds: string[],
    apiKey: string,
    fetchedAt: string
  ): Promise<Array<{ youtubeVideoId: string; viewCount: number; fetchedAt: string }>> {
    const url = new URL(YOUTUBE_VIDEOS_API_URL);
    url.searchParams.set("part", "statistics");
    url.searchParams.set("fields", "items(id,statistics(viewCount))");
    url.searchParams.set("id", youtubeVideoIds.join(","));
    url.searchParams.set("key", apiKey);

    const response = await this.fetcher(url);
    if (!response.ok) {
      throw new Error(`YouTube video stats request failed with HTTP ${response.status}`);
    }

    const body = (await response.json()) as YouTubeVideosApiResponse;
    return (body.items ?? [])
      .map((item) => {
        const youtubeVideoId = item.id?.trim() ?? "";
        const viewCount = Number.parseInt(item.statistics?.viewCount ?? "", 10);
        if (!youtubeVideoId || !Number.isFinite(viewCount) || viewCount < 0) {
          return null;
        }
        return {
          youtubeVideoId,
          viewCount,
          fetchedAt
        };
      })
      .filter((item): item is { youtubeVideoId: string; viewCount: number; fetchedAt: string } => Boolean(item));
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
