import type { TrackerModuleManifest } from "../../shared/contracts";

export const hololiveManifest: TrackerModuleManifest = {
  id: "hololive",
  label: "Hololive",
  description: "Song, idol, playlist, and ranking tracker.",
  nav: {
    icon: "music",
    order: 40
  },
  database: {
    extensionTables: [
      "hololive_songs",
      "hololive_artists",
      "hololive_playlist_entries",
      "hololive_idols",
      "hololive_tier_boards",
      "hololive_tiers",
      "hololive_tier_placements",
      "hololive_music_refresh_runs",
      "hololive_music_videos",
      "hololive_music_video_stats",
      "hololive_music_detail_cache",
      "hololive_music_duplicate_removals",
      "hololive_music_marker_keys",
      "hololive_music_exclusions",
      "hololive_music_playlists",
      "hololive_music_playlist_items",
      "hololive_music_queue_items",
      "hololive_music_player_state"
    ]
  },
  sourceAdapters: [
    {
      id: "holodex",
      label: "Holodex",
      homepage: "https://holodex.net",
      moduleId: "hololive",
      publicOnly: true,
      storesCovers: false,
      rateLimitMs: 350
    }
  ],
  importers: [
    {
      id: "hololive-csv",
      label: "Hololive CSV",
      moduleId: "hololive",
      accepts: [".csv"]
    }
  ],
  recommender: {
    id: "local-tag-score",
    label: "Local tag score",
    localOnly: true
  }
};
