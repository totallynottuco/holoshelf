import type { DatabaseService } from "./database";

type StatsReader = Pick<DatabaseService, "select">;

const activeOfficial = `COALESCE(v.source_kind, 'official') != 'user'
  AND COALESCE(v.official_catalog_active, 1) = 1
  AND NOT EXISTS (SELECT 1 FROM hololive_music_exclusions e WHERE e.youtube_video_id = v.youtube_video_id)`;

export function listOfficialMusicVideoIds(database: StatsReader): string[] {
  // A catalog entry need not have an individual talent assignment (group songs).
  // Avoid the UI's per-talent row limit and its ownership/participant filters.
  return database.select<{ youtube_video_id: string }>(
    `SELECT v.youtube_video_id FROM hololive_music_videos v WHERE ${activeOfficial} ORDER BY v.youtube_video_id`
  ).map((row) => row.youtube_video_id);
}

export function auditOfficialMusicStats(database: StatsReader, fetchedAt?: string) {
  const rows = database.select<{ youtube_video_id: string; view_count: number | null; fetched_at: string | null }>(
    `SELECT v.youtube_video_id, s.view_count, s.fetched_at
     FROM hololive_music_videos v LEFT JOIN hololive_music_video_stats s USING (youtube_video_id)
     WHERE ${activeOfficial} ORDER BY v.youtube_video_id`
  );
  const missing = rows.filter((row) => !Number.isSafeInteger(row.view_count) || Number(row.view_count) < 0 ||
    !row.fetched_at || !Number.isFinite(Date.parse(row.fetched_at)));
  const missingIds = new Set(missing.map((row) => row.youtube_video_id));
  const stale = fetchedAt ? rows.filter((row) => !missingIds.has(row.youtube_video_id) && row.fetched_at! < fetchedAt) : [];
  return {
    catalogVideos: rows.length,
    withStats: rows.length - missing.length,
    freshVideos: fetchedAt ? rows.length - missing.length - stale.length : null,
    missingVideos: missing.length,
    staleVideos: stale.length,
    missingVideoIds: [...missingIds],
    staleVideoIds: stale.map((row) => row.youtube_video_id)
  };
}

export function verifyInstalledMusicStats(seed: StatsReader, personal: StatsReader) {
  const expected = seed.select<{ youtube_video_id: string; view_count: number; fetched_at: string }>(
    `SELECT v.youtube_video_id, s.view_count, s.fetched_at
     FROM hololive_music_videos v JOIN hololive_music_video_stats s USING (youtube_video_id)
     WHERE ${activeOfficial}`
  );
  const actual = new Map(personal.select<{ youtube_video_id: string; view_count: number; fetched_at: string }>(
    "SELECT youtube_video_id, view_count, fetched_at FROM hololive_music_video_stats"
  ).map((row) => [row.youtube_video_id, row]));
  const exclusions = new Set(personal.select<{ youtube_video_id: string }>(
    "SELECT youtube_video_id FROM hololive_music_exclusions"
  ).map((row) => row.youtube_video_id));
  const activeVideos = new Set(personal.select<{ youtube_video_id: string }>(
    "SELECT youtube_video_id FROM hololive_music_videos WHERE COALESCE(official_catalog_active, 1) = 1"
  ).map((row) => row.youtube_video_id));
  const userVideos = new Set(personal.select<{ youtube_video_id: string }>(
    "SELECT youtube_video_id FROM hololive_music_videos WHERE source_kind = 'user'"
  ).map((row) => row.youtube_video_id));
  const duplicates = new Map(personal.select<{ removed_youtube_video_id: string; kept_youtube_video_id: string | null }>(
    "SELECT removed_youtube_video_id, kept_youtube_video_id FROM hololive_music_duplicate_removals"
  ).map((row) => [row.removed_youtube_video_id, row.kept_youtube_video_id]));
  let verifiedVideos = 0;
  let excludedVideos = 0;
  let deduplicatedVideos = 0;
  let userOwnedVideos = 0;
  const mismatchedVideoIds: string[] = [];
  const validAt = (saved: typeof expected[number] | undefined, timestamp: string) => Boolean(saved &&
    Number.isSafeInteger(saved.view_count) && saved.view_count >= 0 &&
    Number.isFinite(Date.parse(saved.fetched_at)) && saved.fetched_at >= timestamp);
  for (const row of expected) {
    if (exclusions.has(row.youtube_video_id)) { excludedVideos += 1; continue; }
    if (userVideos.has(row.youtube_video_id)) { userOwnedVideos += 1; continue; }
    if (!activeVideos.has(row.youtube_video_id)) {
      let keptId = duplicates.get(row.youtube_video_id);
      const visited = new Set([row.youtube_video_id]);
      while (keptId && !activeVideos.has(keptId) && !visited.has(keptId)) {
        visited.add(keptId);
        keptId = duplicates.get(keptId);
      }
      if (keptId && activeVideos.has(keptId) && validAt(actual.get(keptId), row.fetched_at)) {
        deduplicatedVideos += 1;
        continue;
      }
    }
    const saved = actual.get(row.youtube_video_id);
    if (!validAt(saved, row.fetched_at) || !saved ||
        (saved.fetched_at === row.fetched_at && saved.view_count !== row.view_count)) {
      mismatchedVideoIds.push(row.youtube_video_id);
    } else {
      // A user's later manual refresh is valid even if YouTube revised a count down.
      verifiedVideos += 1;
    }
  }
  return { verifiedVideos, excludedVideos, deduplicatedVideos, userOwnedVideos, mismatchedVideoIds };
}
