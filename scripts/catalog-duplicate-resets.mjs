// Data-only compatibility reports for released clients: a freshly verified catalog
// entry supersedes any older local removal report for that exact video.
export function materializeCatalogDuplicateResets(database, {checkedAt, videoStatsRefresh, statsCoverage, holodexCoverage}) {
  const validTime = typeof checkedAt === "string" && Number.isFinite(Date.parse(checkedAt));
  const completeTopics = ["Music_Cover", "Original_Song"].every(topic => {
    const coverage = holodexCoverage?.topics?.[topic];
    return coverage?.complete === true && Number.isSafeInteger(coverage.total) && coverage.total >= 0 && coverage.fetched === coverage.total;
  });
  if (!validTime || videoStatsRefresh?.fetchedAt !== checkedAt || videoStatsRefresh.failedBatches !== 0 ||
      !Number.isSafeInteger(videoStatsRefresh.requestedVideos) || !Number.isSafeInteger(videoStatsRefresh.updatedVideos) ||
      !Number.isSafeInteger(videoStatsRefresh.unavailableVideos) || videoStatsRefresh.requestedVideos < 0 ||
      videoStatsRefresh.updatedVideos < 0 || videoStatsRefresh.unavailableVideos < 0 ||
      videoStatsRefresh.updatedVideos + videoStatsRefresh.unavailableVideos !== videoStatsRefresh.requestedVideos ||
      holodexCoverage?.complete !== true || !completeTopics) {
    throw new Error("Catalog duplicate resets require complete verified Holodex and YouTube coverage");
  }
  const rows = database.select(`SELECT v.youtube_video_id, v.title, v.song_name, v.published_at, s.view_count, s.fetched_at
    FROM hololive_music_videos v LEFT JOIN hololive_music_video_stats s USING (youtube_video_id)
    WHERE COALESCE(v.source_kind, 'official') = 'official' AND COALESCE(v.official_catalog_active, 1) = 1
      AND NOT EXISTS (SELECT 1 FROM hololive_music_exclusions e WHERE e.youtube_video_id = v.youtube_video_id)
    ORDER BY v.youtube_video_id`);
  if (statsCoverage?.catalogVideos !== rows.length || statsCoverage.freshVideos !== rows.length ||
      statsCoverage.missingVideos !== 0 || statsCoverage.staleVideos !== 0 ||
      videoStatsRefresh.requestedVideos < rows.length || videoStatsRefresh.updatedVideos < rows.length ||
      rows.some(row => row.fetched_at !== checkedAt || !Number.isSafeInteger(row.view_count) || row.view_count < 0)) {
    throw new Error("Catalog duplicate resets require fresh stats for every retained official video");
  }
  database.transaction(() => {
    for (const row of rows) {
      database.run(`INSERT INTO hololive_music_duplicate_removals
        (removed_youtube_video_id,removed_title,kept_youtube_video_id,kept_title,reason,song_name,
         removed_published_at,kept_published_at,source_run_id,updated_at)
        VALUES (?, ?, NULL, NULL, 'catalog_entry_verified', ?, ?, NULL, NULL, ?)
        ON CONFLICT(removed_youtube_video_id) DO UPDATE SET
          removed_title = excluded.removed_title, kept_youtube_video_id = NULL, kept_title = NULL,
          reason = excluded.reason, song_name = excluded.song_name,
          removed_published_at = excluded.removed_published_at, kept_published_at = NULL,
          source_run_id = NULL, updated_at = excluded.updated_at`,
      [row.youtube_video_id, row.title, row.song_name || row.title, row.published_at, checkedAt]);
    }
  });
  return {resetRows: rows.length, checkedAt};
}
