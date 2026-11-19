import { planSongPresentations, type SongUpload } from "../../src/modules/hololive/music/presentations";
import type { DatabaseService } from "./database";

export function catalogPresentationMatches(database: Pick<DatabaseService, "select">, verifiedIds?: ReadonlySet<string>) {
  const rows = database.select<{
    youtubeVideoId: string; title: string; songName: string | null; topicId: string; channelId: string;
    channelName: string; originalChannelId: string | null; durationSeconds: number; publishedAt: string;
    songs: string | null; participants: string; owners: string; featured: string; excluded: number; description: string | null;
  }>(`SELECT v.youtube_video_id AS youtubeVideoId, v.title, v.song_name AS songName, v.topic_id AS topicId,
            v.channel_id AS channelId, v.channel_name AS channelName, v.original_channel_id AS originalChannelId,
            v.duration_seconds AS durationSeconds, v.published_at AS publishedAt, d.song_names_json AS songs,
            v.participant_idol_ids_json AS participants, v.owned_idol_ids_json AS owners, v.featured_idol_ids_json AS featured,
            d.description, EXISTS(SELECT 1 FROM hololive_music_exclusions e WHERE e.youtube_video_id=v.youtube_video_id) AS excluded
       FROM hololive_music_videos v LEFT JOIN hololive_music_detail_cache d USING (youtube_video_id)
      WHERE COALESCE(v.source_kind, 'official')='official' AND COALESCE(v.official_catalog_active, 1)=1 AND v.provided_to_youtube=0`);
  const candidates: SongUpload[] = [];
  for (const row of rows) {
    if (verifiedIds && !verifiedIds.has(row.youtubeVideoId)) continue;
    try {
      const [songs, participants, owners, featured] = [row.songs, row.participants, row.owners, row.featured]
        .map(value => JSON.parse(value ?? "[]") as unknown);
      if (![songs, participants, owners, featured].every(value => Array.isArray(value) && value.every(id => typeof id === "string"))) continue;
      candidates.push({ ...row, songNames: songs as string[], excluded: Boolean(row.excluded),
        participantIds: [...participants as string[], ...owners as string[], ...featured as string[]] });
    } catch {
      // Incomplete legacy evidence cannot establish that two performances have the same cast.
      continue;
    }
  }
  return planSongPresentations(candidates);
}

export function assertCatalogSongPresentations(database: Pick<DatabaseService, "select">) {
  const matches = catalogPresentationMatches(database);
  if (matches.length) {
    const { removed, kept } = matches[0];
    throw new Error(`Catalog still contains ${matches.length} overlapping song presentation(s), including ${removed.youtubeVideoId} and ${kept.youtubeVideoId}. Refresh release data before publishing.`);
  }
}
