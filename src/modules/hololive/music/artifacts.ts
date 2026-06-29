import Papa from "papaparse";
import type {
  HolodexArtifactBundle,
  HolodexCatalogRow,
  HolodexDuplicateRemoval,
  HolodexVideoDetail
} from "./types";
import { normalizeVideoDetail, parseDuration } from "./cleanup";

function parseCsvRows<T extends Record<string, string>>(text: string): T[] {
  const parsed = Papa.parse<T>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim()
  });

  if (parsed.errors.length > 0) {
    throw new Error(parsed.errors[0].message);
  }

  return parsed.data;
}

export function parseHolodexVideosCsv(text: string): HolodexCatalogRow[] {
  return parseCsvRows<{
    youtube_video_id: string;
    youtube_url: string;
    title: string;
    status: string;
    topic_id: string;
    channel_name: string;
    published_at: string;
  }>(text)
    .map((row) => ({
      youtubeVideoId: row.youtube_video_id?.trim(),
      youtubeUrl: row.youtube_url?.trim(),
      title: row.title ?? "",
      status: row.status ?? "",
      topicId: row.topic_id?.trim(),
      channelName: row.channel_name ?? "",
      publishedAt: row.published_at ?? ""
    }))
    .filter((row): row is HolodexCatalogRow =>
      Boolean(
        row.youtubeVideoId &&
          row.youtubeUrl &&
          row.title &&
          (row.topicId === "Original_Song" || row.topicId === "Music_Cover")
      )
    );
}

export function parseHolodexDetailCacheJson(text: string): Record<string, HolodexVideoDetail> {
  const raw = JSON.parse(text) as Record<
    string,
    {
      youtube_video_id?: string;
      channel_id?: string;
      duration?: number | string | null;
      original_channel_id?: string;
      provided_to_youtube?: boolean;
      song_names?: string[];
    }
  >;
  const details: Record<string, HolodexVideoDetail> = {};

  for (const [videoId, detail] of Object.entries(raw)) {
    if (!videoId || typeof detail !== "object" || detail === null) {
      continue;
    }

    details[videoId] = normalizeVideoDetail(videoId, {
      youtubeVideoId: detail.youtube_video_id ?? videoId,
      channelId: detail.channel_id ?? "",
      duration: parseDuration(detail.duration),
      originalChannelId: detail.original_channel_id ?? "",
      providedToYoutube: Boolean(detail.provided_to_youtube),
      songNames: Array.isArray(detail.song_names) ? detail.song_names : []
    });
  }

  return details;
}

export function parseHolodexDuplicateReportCsv(text: string): HolodexDuplicateRemoval[] {
  return parseCsvRows<{
    removed_youtube_video_id: string;
    removed_title: string;
    kept_youtube_video_id: string;
    kept_title: string;
    reason: string;
    song_name: string;
    removed_published_at: string;
    kept_published_at: string;
  }>(text)
    .map((row) => ({
      removedYoutubeVideoId: row.removed_youtube_video_id?.trim(),
      removedTitle: row.removed_title ?? "",
      keptYoutubeVideoId: row.kept_youtube_video_id?.trim() ?? "",
      keptTitle: row.kept_title ?? "",
      reason: row.reason ?? "",
      songName: row.song_name ?? "",
      removedPublishedAt: row.removed_published_at ?? "",
      keptPublishedAt: row.kept_published_at ?? ""
    }))
    .filter((row): row is HolodexDuplicateRemoval => Boolean(row.removedYoutubeVideoId && row.reason));
}

export function parseHolodexArtifactBundle(input: {
  videosCsvText: string;
  detailCacheJsonText: string;
  duplicateReportCsvText?: string | null;
}): HolodexArtifactBundle {
  return {
    rows: parseHolodexVideosCsv(input.videosCsvText),
    detailCache: parseHolodexDetailCacheJson(input.detailCacheJsonText),
    duplicateRemovals: input.duplicateReportCsvText ? parseHolodexDuplicateReportCsv(input.duplicateReportCsvText) : []
  };
}
