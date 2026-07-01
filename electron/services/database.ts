import initSqlJs, { type Database } from "sql.js";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  createRollingDatabaseBackup,
  createTimestampedDatabaseBackup,
  validateSqliteDatabaseFile
} from "./databaseBackups";
import type {
  AppStats,
  CatalogItem,
  CatalogListFilters,
  FetchJob,
  HolodexChannel,
  HololiveBracket,
  HololiveBracketArchiveSummary,
  HololiveBracketEntry,
  HololiveBracketGenerationFilters,
  HololiveBracketGenerationStyle,
  HololiveBracketMatch,
  HololiveBracketRatingBucket,
  HololiveBracketRound,
  HololiveBracketRivalryStats,
  HololiveBracketSize,
  HololiveBracketSongStats,
  HololiveBracketStatus,
  HololiveBracketStatsOverview,
  HololiveBracketSummary,
  HololiveBracketTalentStats,
  HololiveChannelKind,
  HololiveCustomTalentPreview,
  HololiveCustomTalentRecord,
  HololiveIdol,
  HololiveIdolProfile,
  HololiveMusicExclusionRecord,
  HololiveMusicImportResult,
  HololiveMusicLibraryResponse,
  HololiveMusicMarker,
  HololiveMusicMarkerRecord,
  HololiveMusicPlaybackSource,
  HololiveMusicPlayerData,
  HololiveMusicPlaylist,
  HololiveMusicRepeatMode,
  HololiveMusicResolvedItem,
  HololiveMusicParticipant,
  HololiveMusicParticipantRole,
  HololiveMusicRefreshRun,
  HololiveMusicRow,
  HololiveMusicTopic,
  HololiveProfileChannel,
  HololiveProfileLink,
  HololiveProfileMediaGroupId,
  HololiveProfilePlaybackContext,
  HololiveTier,
  HololiveTierBoard,
  HololiveTierBoardSummary,
  HololiveTierListData,
  HololiveTierPlacement,
  ModuleId,
  SourceHealth,
  SourceId,
  TrackerModuleManifest
} from "../../src/shared/contracts";
import { hololiveBracketRoundLabel } from "../../src/shared/hololiveBracketLabels";
import type {
  HololiveMusicLibraryCollabScope,
  HololiveMusicLibrarySort,
  HololiveMusicUnavailableResponse,
  HololiveUndoKind
} from "../../src/shared/ipc";
import type {
  HolodexArtifactBundle,
  HolodexCatalogRow,
  HolodexChannelRecord,
  HolodexDuplicateRemoval,
  HolodexMentionedChannel,
  HolodexVideoDetail
} from "../../src/modules/hololive/music/types";
import {
  buildNormalizedHololiveMusicKey,
  buildHololiveMusicPerformanceKey,
  buildHololiveMusicSongKey,
  getHolodexEffectiveOwnerChannelId,
  hasHololiveLowPriorityVersionMarker
} from "../../src/modules/hololive/music/classification";
import {
  HOLODEX_TOPIC_DUPLICATE_DURATION_TOLERANCE_SECONDS,
  buildDuplicateTitleCore,
  getRowCleanupReason
} from "../../src/modules/hololive/music/cleanup";
import { EXCLUDED_HOLODEX_CHANNEL_IDS, isExcludedHolodexChannelId } from "../../src/modules/hololive/music/types";
import { normalizeTags } from "../../src/shared/blocklist";
import {
  DEFAULT_HOLOLIVE_BOARD_NAME,
  DEFAULT_HOLOLIVE_TIERS,
  HOLOLIVE_DEFAULT_BOARD_ID,
  HOLOLIVE_IDOLS
} from "../../src/modules/hololive/idols";

const DEFAULT_HOLOLIVE_TILE_SIZE = 64;
const HOLOLIVE_ACTIVE_BOARD_SETTING_KEY = "hololive.activeBoardId";
const HOLOLIVE_FAVORITES_PLAYLIST_ID = "system:favorites";
const HOLOLIVE_IMAGE_CACHE_VERSION = 6;
const HOLOLIVE_UNDO_TTL_MS = 10 * 60 * 1000;
const HOLOLIVE_BRACKET_RATING_BUCKETS: HololiveBracketRatingBucket[] = [
  "unrated",
  "favorite",
  "like",
  "neutral",
  "dislike"
];

type DatabaseRowSnapshot = Record<string, unknown>;

interface HololiveUndoAction {
  token: string;
  kind: HololiveUndoKind;
  label: string;
  createdAt: number;
  apply: () => void;
}
const CURRENT_HOLOLIVE_ICON_CACHE_SUFFIX = `-icon-v${HOLOLIVE_IMAGE_CACHE_VERSION}.webp`;
const CURRENT_HOLOLIVE_PROFILE_CACHE_SUFFIX = `-profile-v${HOLOLIVE_IMAGE_CACHE_VERSION}.webp`;
const HOLOLIVE_UNIT_CHANNEL_IDOL_IDS: Record<string, string[]> = {
  "UC10wVt6hoQiwySRhz7RdOUA": [
    "hiodoshi-ao",
    "otonose-kanade",
    "ichijou-ririka",
    "juufuutei-raden",
    "todoroki-hajime"
  ],
  "UCu2n3qHuOuQIygREMnWeQWg": [
    "isaki-riona",
    "koganei-niko",
    "mizumiya-su",
    "rindo-chihaya",
    "kikirara-vivi"
  ],
  "UCnVbtCwr-5LXxUlGxsgD7sQ": ["hoshimachi-suisei"]
};
const HOLOLIVE_PERFORMER_ALIAS_IDOL_IDS: Record<string, string[]> = {
  soraz: ["tokino-sora", "azki"],
  ao: ["hiodoshi-ao"],
  su: ["mizumiya-su"],
  ame: ["watson-amelia"],
  calli: ["mori-calliope"],
  fauna: ["ceres-fauna"],
  sana: ["tsukumo-sana"],
  mumei: ["nanashi-mumei"],
  fuwamoco: ["fuwawa-abyssgard", "mococo-abyssgard"],
  "fuwa moco": ["fuwawa-abyssgard", "mococo-abyssgard"],
  "la+": ["la-darknesss"],
  laplus: ["la-darknesss"],
  "la darknesss": ["la-darknesss"],
  "ラプラス": ["la-darknesss"],
  "ラプラス ダークネス": ["la-darknesss"],
  "星街": ["hoshimachi-suisei"],
  "星街すいせい": ["hoshimachi-suisei"],
  "ときのそら": ["tokino-sora"],
  "湊あくあ": ["minato-aqua"],
  "こぼ": ["kobo-kanaeru"],
  "こぼ かなえる": ["kobo-kanaeru"],
  "兎田ぺこら": ["usada-pekora"],
  "不知火フレア": ["shiranui-flare"],
  "白銀ノエル": ["shirogane-noel"],
  "宝鐘マリン": ["houshou-marine"]
};

interface HololiveChannelContext {
  mainChannelToIdols: Map<string, string[]>;
  linkedChannelToIdols: Map<string, string[]>;
  groupChannelIds: Set<string>;
}

type StoredHololiveMusicParticipant = Omit<HololiveMusicParticipant, "youtubeVideoId" | "idolName">;

interface HololiveMusicClassification {
  canonicalSongKey: string;
  canonicalPerformanceKey: string;
  ownedIdolIds: string[];
  featuredIdolIds: string[];
}

interface HololiveStoredMusicDuplicateRow extends Record<string, unknown> {
  youtube_video_id: string;
  title: string;
  song_name: string | null;
  topic_id: HololiveMusicTopic;
  canonical_song_key: string;
  canonical_performance_key: string;
  channel_id: string | null;
  channel_name: string | null;
  original_channel_id: string | null;
  provided_to_youtube: number;
  duration_seconds: number | null;
  published_at: string | null;
  participants_json: string | null;
  owned_idol_ids_json: string | null;
  featured_idol_ids_json: string | null;
}

const HOLOLIVE_MUSIC_PARTICIPANT_ROLE_ORDER: Record<HololiveMusicParticipantRole, number> = {
  primary: 0,
  "topic-owner": 1,
  mentioned: 2,
  collab: 3
};

const HOLOLIVE_BRACKET_SIZE_COUNTS: Record<HololiveBracketSize, number> = {
  RO16: 16,
  RO32: 32,
  RO64: 64,
  RO128: 128,
  RO256: 256
};

const HOLOLIVE_BRACKET_SIZE_LABELS: Record<HololiveBracketSize, string> = {
  RO16: "RO16",
  RO32: "RO32",
  RO64: "RO64",
  RO128: "RO128",
  RO256: "RO256"
};

const HOLOLIVE_BRACKET_GENERATION_STYLE_LABELS: Record<HololiveBracketGenerationStyle, string> = {
  top_songs: "Top Songs",
  random_songs: "Random Songs"
};

type HololiveBracketCandidate = HololiveMusicRow & {
  idolIdForBracket: string;
  idolNameForBracket: string;
};

interface HololiveBracketCandidatePools {
  officialIdols: HololiveIdol[];
  originalsByIdol: Map<string, HololiveBracketCandidate[]>;
  coversByIdol: Map<string, HololiveBracketCandidate[]>;
  allByIdol: Map<string, HololiveBracketCandidate[]>;
}

interface HololiveBracketHistoryExclusions {
  youtubeVideoIds: Set<string>;
  canonicalPerformanceKeys: Set<string>;
}

const MIGRATIONS = [
  {
    version: 1,
    sql: `
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS modules (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        manifest_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS catalog_items (
        id TEXT PRIMARY KEY,
        module_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        subtitle TEXT,
        source_url TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_catalog_items_module ON catalog_items(module_id);
      CREATE INDEX IF NOT EXISTS idx_catalog_items_title ON catalog_items(title);

      CREATE TABLE IF NOT EXISTS source_refs (
        id TEXT PRIMARY KEY,
        item_id TEXT NOT NULL REFERENCES catalog_items(id) ON DELETE CASCADE,
        source_id TEXT NOT NULL,
        source_key TEXT NOT NULL,
        detail_url TEXT NOT NULL,
        cover_url TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(source_id, source_key)
      );

      CREATE TABLE IF NOT EXISTS item_tags (
        item_id TEXT NOT NULL REFERENCES catalog_items(id) ON DELETE CASCADE,
        tag TEXT NOT NULL,
        PRIMARY KEY(item_id, tag)
      );

      CREATE TABLE IF NOT EXISTS tracked_entries (
        id TEXT PRIMARY KEY,
        item_id TEXT NOT NULL UNIQUE REFERENCES catalog_items(id) ON DELETE CASCADE,
        status TEXT NOT NULL,
        rating REAL,
        notes TEXT,
        started_at TEXT,
        completed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS lists (
        id TEXT PRIMARY KEY,
        module_id TEXT,
        name TEXT NOT NULL,
        description TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS list_items (
        list_id TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
        item_id TEXT NOT NULL REFERENCES catalog_items(id) ON DELETE CASCADE,
        position INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        PRIMARY KEY(list_id, item_id)
      );

      CREATE TABLE IF NOT EXISTS covers (
        id TEXT PRIMARY KEY,
        item_id TEXT NOT NULL UNIQUE REFERENCES catalog_items(id) ON DELETE CASCADE,
        source_url TEXT,
        local_path TEXT NOT NULL,
        mime_type TEXT,
        size_bytes INTEGER,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS fetch_jobs (
        id TEXT PRIMARY KEY,
        module_id TEXT NOT NULL,
        source_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        target_url TEXT NOT NULL,
        status TEXT NOT NULL,
        priority INTEGER NOT NULL DEFAULT 0,
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_fetch_jobs_status ON fetch_jobs(status, priority, created_at);

      CREATE TABLE IF NOT EXISTS source_health (
        source_id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        checked_at TEXT NOT NULL,
        http_status INTEGER,
        message TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS user_blocklist (
        tag TEXT PRIMARY KEY,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS csv_import_mappings (
        id TEXT PRIMARY KEY,
        module_id TEXT NOT NULL,
        importer_id TEXT NOT NULL,
        name TEXT NOT NULL,
        fields_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS hololive_artists (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        branch TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS hololive_songs (
        item_id TEXT PRIMARY KEY REFERENCES catalog_items(id) ON DELETE CASCADE,
        artist_name TEXT,
        tier TEXT,
        playlist_name TEXT,
        source_url TEXT
      );

      CREATE TABLE IF NOT EXISTS hololive_playlist_entries (
        id TEXT PRIMARY KEY,
        playlist_name TEXT NOT NULL,
        item_id TEXT NOT NULL REFERENCES catalog_items(id) ON DELETE CASCADE,
        position INTEGER,
        created_at TEXT NOT NULL
      );
    `
  },
  {
    version: 2,
    sql: `
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS hololive_idols (
        id TEXT PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        branch TEXT NOT NULL,
        generation TEXT NOT NULL,
        status TEXT NOT NULL,
        official_url TEXT NOT NULL,
        icon_url TEXT NOT NULL,
        sort_order INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS hololive_tier_boards (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        tile_size INTEGER NOT NULL DEFAULT 64,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS hololive_tiers (
        id TEXT PRIMARY KEY,
        board_id TEXT NOT NULL REFERENCES hololive_tier_boards(id) ON DELETE CASCADE,
        label TEXT NOT NULL,
        color TEXT NOT NULL,
        position INTEGER NOT NULL,
        collapsed INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(board_id, label)
      );

      CREATE INDEX IF NOT EXISTS idx_hololive_tiers_board_position ON hololive_tiers(board_id, position);

      CREATE TABLE IF NOT EXISTS hololive_tier_placements (
        board_id TEXT NOT NULL REFERENCES hololive_tier_boards(id) ON DELETE CASCADE,
        idol_id TEXT NOT NULL REFERENCES hololive_idols(id) ON DELETE CASCADE,
        tier_id TEXT REFERENCES hololive_tiers(id) ON DELETE SET NULL,
        position INTEGER NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(board_id, idol_id)
      );

      CREATE INDEX IF NOT EXISTS idx_hololive_placements_board_tier ON hololive_tier_placements(board_id, tier_id, position);

      CREATE TABLE IF NOT EXISTS hololive_image_cache (
        idol_id TEXT NOT NULL REFERENCES hololive_idols(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK(kind IN ('icon', 'profile')),
        source_url TEXT NOT NULL,
        local_filename TEXT NOT NULL,
        mime_type TEXT,
        size_bytes INTEGER,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(idol_id, kind)
      );
    `
  },
  {
    version: 3,
    sql: `
      PRAGMA foreign_keys = ON;

      ALTER TABLE hololive_tier_boards ADD COLUMN position INTEGER NOT NULL DEFAULT 0;

      UPDATE hololive_tier_boards
      SET position = (
        SELECT COUNT(*) - 1
        FROM hololive_tier_boards ordered_boards
        WHERE ordered_boards.created_at < hololive_tier_boards.created_at
           OR (
             ordered_boards.created_at = hololive_tier_boards.created_at
             AND ordered_boards.id <= hololive_tier_boards.id
           )
      );

      CREATE INDEX IF NOT EXISTS idx_hololive_boards_position ON hololive_tier_boards(position);
    `
  },
  {
    version: 4,
    sql: `
      PRAGMA foreign_keys = ON;

      ALTER TABLE hololive_idols ADD COLUMN profile_image_url TEXT;
      ALTER TABLE hololive_idols ADD COLUMN youtube_channel_url TEXT;
      ALTER TABLE hololive_idols ADD COLUMN x_handle TEXT;
      ALTER TABLE hololive_idols ADD COLUMN x_url TEXT;
      ALTER TABLE hololive_idols ADD COLUMN birthday TEXT;
      ALTER TABLE hololive_idols ADD COLUMN debut_date TEXT;
      ALTER TABLE hololive_idols ADD COLUMN height TEXT;
      ALTER TABLE hololive_idols ADD COLUMN unit TEXT;
    `
  },
  {
    version: 5,
    sql: `
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS hololive_image_cache (
        idol_id TEXT NOT NULL REFERENCES hololive_idols(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK(kind IN ('icon', 'profile')),
        source_url TEXT NOT NULL,
        local_filename TEXT NOT NULL,
        mime_type TEXT,
        size_bytes INTEGER,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(idol_id, kind)
      );
    `
  },
  {
    version: 6,
    sql: `
      PRAGMA foreign_keys = ON;

      ALTER TABLE hololive_idols ADD COLUMN profile_quote TEXT;
    `
  },
  {
    version: 7,
    sql: "SELECT 1;"
  },
  {
    version: 8,
    sql: "SELECT 1;"
  },
  {
    version: 9,
    sql: `
      PRAGMA foreign_keys = ON;

      ALTER TABLE hololive_idols ADD COLUMN youtube_channel_id TEXT;
      CREATE INDEX IF NOT EXISTS idx_hololive_idols_youtube_channel_id ON hololive_idols(youtube_channel_id);
    `
  },
  {
    version: 10,
    sql: `
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS hololive_music_refresh_runs (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL CHECK(source IN ('artifact', 'live')),
        status TEXT NOT NULL CHECK(status IN ('running', 'completed', 'failed')),
        started_at TEXT NOT NULL,
        completed_at TEXT,
        fetched_rows INTEGER NOT NULL DEFAULT 0,
        kept_rows INTEGER NOT NULL DEFAULT 0,
        filtered_rows INTEGER NOT NULL DEFAULT 0,
        duplicate_rows INTEGER NOT NULL DEFAULT 0,
        error TEXT
      );

      CREATE TABLE IF NOT EXISTS hololive_music_detail_cache (
        youtube_video_id TEXT PRIMARY KEY,
        channel_id TEXT,
        duration_seconds INTEGER,
        original_channel_id TEXT,
        provided_to_youtube INTEGER NOT NULL DEFAULT 0,
        song_names_json TEXT NOT NULL DEFAULT '[]',
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS hololive_music_videos (
        youtube_video_id TEXT PRIMARY KEY,
        item_id TEXT NOT NULL UNIQUE REFERENCES catalog_items(id) ON DELETE CASCADE,
        idol_id TEXT NOT NULL REFERENCES hololive_idols(id) ON DELETE CASCADE,
        youtube_url TEXT NOT NULL,
        title TEXT NOT NULL,
        status TEXT NOT NULL,
        topic_id TEXT NOT NULL CHECK(topic_id IN ('Original_Song', 'Music_Cover')),
        channel_id TEXT NOT NULL,
        channel_name TEXT NOT NULL,
        published_at TEXT,
        duration_seconds INTEGER,
        song_name TEXT,
        original_channel_id TEXT,
        provided_to_youtube INTEGER NOT NULL DEFAULT 0,
        participants_json TEXT NOT NULL DEFAULT '[]',
        participant_idol_ids_json TEXT NOT NULL DEFAULT '[]',
        source_run_id TEXT REFERENCES hololive_music_refresh_runs(id),
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_hololive_music_videos_idol_topic
        ON hololive_music_videos(idol_id, topic_id, published_at);
      CREATE INDEX IF NOT EXISTS idx_hololive_music_videos_channel
        ON hololive_music_videos(channel_id);
      CREATE INDEX IF NOT EXISTS idx_hololive_music_videos_song
        ON hololive_music_videos(song_name);

      CREATE TABLE IF NOT EXISTS hololive_music_duplicate_removals (
        removed_youtube_video_id TEXT PRIMARY KEY,
        removed_title TEXT NOT NULL,
        kept_youtube_video_id TEXT,
        kept_title TEXT,
        reason TEXT NOT NULL,
        song_name TEXT,
        removed_published_at TEXT,
        kept_published_at TEXT,
        source_run_id TEXT REFERENCES hololive_music_refresh_runs(id),
        updated_at TEXT NOT NULL
      );
    `
  },
  {
    version: 11,
    sql: `
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS hololive_channels (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL DEFAULT '',
        english_name TEXT,
        type TEXT,
        org TEXT,
        group_name TEXT,
        photo_url TEXT,
        twitter TEXT,
        video_count INTEGER,
        subscriber_count INTEGER,
        clip_count INTEGER,
        published_at TEXT,
        inactive INTEGER NOT NULL DEFAULT 0,
        kind TEXT NOT NULL DEFAULT 'unknown' CHECK(kind IN ('idol', 'topic', 'group', 'unknown')),
        main_idol_ids_json TEXT NOT NULL DEFAULT '[]',
        topic_idol_ids_json TEXT NOT NULL DEFAULT '[]',
        linked_idol_ids_json TEXT NOT NULL DEFAULT '[]',
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS hololive_music_videos_next (
        youtube_video_id TEXT PRIMARY KEY,
        item_id TEXT NOT NULL UNIQUE REFERENCES catalog_items(id) ON DELETE CASCADE,
        idol_id TEXT REFERENCES hololive_idols(id) ON DELETE SET NULL,
        youtube_url TEXT NOT NULL,
        title TEXT NOT NULL,
        status TEXT NOT NULL,
        topic_id TEXT NOT NULL CHECK(topic_id IN ('Original_Song', 'Music_Cover')),
        channel_id TEXT NOT NULL,
        channel_name TEXT NOT NULL,
        published_at TEXT,
        duration_seconds INTEGER,
        song_name TEXT,
        original_channel_id TEXT,
        provided_to_youtube INTEGER NOT NULL DEFAULT 0,
        participants_json TEXT NOT NULL DEFAULT '[]',
        participant_idol_ids_json TEXT NOT NULL DEFAULT '[]',
        source_run_id TEXT REFERENCES hololive_music_refresh_runs(id),
        updated_at TEXT NOT NULL
      );

      INSERT OR IGNORE INTO hololive_music_videos_next
        (youtube_video_id, item_id, idol_id, youtube_url, title, status, topic_id, channel_id, channel_name,
         published_at, duration_seconds, song_name, original_channel_id, provided_to_youtube,
         participants_json, participant_idol_ids_json, source_run_id, updated_at)
      SELECT youtube_video_id, item_id, idol_id, youtube_url, title, status, topic_id, channel_id, channel_name,
             published_at, duration_seconds, song_name, original_channel_id, provided_to_youtube,
             '[]', '[]', source_run_id, updated_at
      FROM hololive_music_videos;

      DROP TABLE hololive_music_videos;
      ALTER TABLE hololive_music_videos_next RENAME TO hololive_music_videos;

      CREATE INDEX IF NOT EXISTS idx_hololive_music_videos_idol_topic
        ON hololive_music_videos(idol_id, topic_id, published_at);
      CREATE INDEX IF NOT EXISTS idx_hololive_music_videos_channel
        ON hololive_music_videos(channel_id);
      CREATE INDEX IF NOT EXISTS idx_hololive_music_videos_song
        ON hololive_music_videos(song_name);
    `
  },
  {
    version: 12,
    sql: "SELECT 1;"
  },
  {
    version: 13,
    sql: `
      PRAGMA foreign_keys = ON;

      ALTER TABLE hololive_music_videos ADD COLUMN canonical_song_key TEXT NOT NULL DEFAULT '';
      ALTER TABLE hololive_music_videos ADD COLUMN canonical_performance_key TEXT NOT NULL DEFAULT '';
      ALTER TABLE hololive_music_videos ADD COLUMN owned_idol_ids_json TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE hololive_music_videos ADD COLUMN featured_idol_ids_json TEXT NOT NULL DEFAULT '[]';

      CREATE INDEX IF NOT EXISTS idx_hololive_music_videos_canonical_song
        ON hololive_music_videos(canonical_song_key);
      CREATE INDEX IF NOT EXISTS idx_hololive_music_videos_canonical_performance
        ON hololive_music_videos(canonical_performance_key);
    `
  },
  {
    version: 14,
    sql: "SELECT 1;"
  },
  {
    version: 15,
    sql: `
      CREATE TABLE IF NOT EXISTS hololive_music_exclusions (
        youtube_video_id TEXT PRIMARY KEY,
        title_snapshot TEXT,
        source_url_snapshot TEXT,
        created_at TEXT NOT NULL
      );
    `
  },
  {
    version: 16,
    sql: `
      CREATE TABLE IF NOT EXISTS hololive_music_marker_keys (
        marker_key TEXT PRIMARY KEY,
        marker TEXT NOT NULL CHECK(marker IN ('favorite', 'like', 'neutral', 'dislike')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `
  },
  {
    version: 17,
    sql: `
      CREATE TABLE IF NOT EXISTS hololive_music_playlists (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        position INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_hololive_music_playlists_position
        ON hololive_music_playlists(position);

      CREATE TABLE IF NOT EXISTS hololive_music_playlist_items (
        id TEXT PRIMARY KEY,
        playlist_id TEXT NOT NULL REFERENCES hololive_music_playlists(id) ON DELETE CASCADE,
        youtube_video_id TEXT NOT NULL,
        title_snapshot TEXT,
        source_url_snapshot TEXT,
        position INTEGER NOT NULL DEFAULT 0,
        added_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_hololive_music_playlist_items_playlist_position
        ON hololive_music_playlist_items(playlist_id, position);
      CREATE INDEX IF NOT EXISTS idx_hololive_music_playlist_items_video
        ON hololive_music_playlist_items(youtube_video_id);

      CREATE TABLE IF NOT EXISTS hololive_music_queue_items (
        id TEXT PRIMARY KEY,
        youtube_video_id TEXT NOT NULL,
        title_snapshot TEXT,
        source_url_snapshot TEXT,
        position INTEGER NOT NULL DEFAULT 0,
        added_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_hololive_music_queue_items_position
        ON hololive_music_queue_items(position);
      CREATE INDEX IF NOT EXISTS idx_hololive_music_queue_items_video
        ON hololive_music_queue_items(youtube_video_id);

      CREATE TABLE IF NOT EXISTS hololive_music_player_state (
        id TEXT PRIMARY KEY CHECK(id = 'hololive'),
        current_queue_item_id TEXT,
        current_youtube_video_id TEXT,
        repeat_mode TEXT NOT NULL DEFAULT 'off' CHECK(repeat_mode IN ('off', 'all', 'one')),
        shuffle_enabled INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );
    `
  },
  {
    version: 18,
    sql: `
      ALTER TABLE hololive_music_player_state
        ADD COLUMN autoplay_enabled INTEGER NOT NULL DEFAULT 1;
    `
  },
  {
    version: 19,
    sql: `
      ALTER TABLE hololive_music_marker_keys
        ADD COLUMN favorite_position INTEGER;

      CREATE INDEX IF NOT EXISTS idx_hololive_music_marker_keys_favorite_position
        ON hololive_music_marker_keys(marker, favorite_position);
    `
  },
  {
    version: 20,
    sql: `
      ALTER TABLE hololive_music_player_state
        ADD COLUMN playback_source_type TEXT NOT NULL DEFAULT 'queue'
          CHECK(playback_source_type IN ('queue', 'playlist', 'library'));

      ALTER TABLE hololive_music_player_state
        ADD COLUMN current_playlist_id TEXT;

      ALTER TABLE hololive_music_player_state
        ADD COLUMN current_playlist_item_id TEXT;
    `
  },
  {
    version: 21,
    sql: `
      DELETE FROM hololive_music_playlist_items
      WHERE rowid NOT IN (
        SELECT MIN(rowid)
        FROM hololive_music_playlist_items
        GROUP BY playlist_id, youtube_video_id
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_hololive_music_playlist_items_playlist_video_unique
        ON hololive_music_playlist_items(playlist_id, youtube_video_id);
    `
  },
  {
    version: 22,
    sql: `
      ALTER TABLE hololive_idols
        ADD COLUMN source TEXT NOT NULL DEFAULT 'official'
          CHECK(source IN ('official', 'custom'));

      CREATE INDEX IF NOT EXISTS idx_hololive_idols_source
        ON hololive_idols(source, sort_order);
    `
  },
  {
    version: 23,
    sql: `
      CREATE TABLE IF NOT EXISTS hololive_music_video_stats (
        youtube_video_id TEXT PRIMARY KEY,
        view_count INTEGER NOT NULL,
        fetched_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_hololive_music_video_stats_fetched_at
        ON hololive_music_video_stats(fetched_at);
    `
  },
  {
    version: 24,
    sql: `
      ALTER TABLE hololive_music_detail_cache
        ADD COLUMN mentions_json TEXT NOT NULL DEFAULT '[]';

      ALTER TABLE hololive_music_detail_cache
        ADD COLUMN collab_channel_ids_json TEXT NOT NULL DEFAULT '[]';

      ALTER TABLE hololive_music_detail_cache
        ADD COLUMN relationships_loaded INTEGER NOT NULL DEFAULT 0;
    `
  },
  {
    version: 25,
    sql: `
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS hololive_brackets (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        size TEXT NOT NULL CHECK(size IN ('RO16', 'RO32', 'RO64', 'RO128', 'RO256')),
        seed TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'complete')),
        current_match_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_hololive_brackets_updated_at
        ON hololive_brackets(updated_at);

      CREATE TABLE IF NOT EXISTS hololive_bracket_entries (
        id TEXT PRIMARY KEY,
        bracket_id TEXT NOT NULL REFERENCES hololive_brackets(id) ON DELETE CASCADE,
        slot_index INTEGER NOT NULL,
        youtube_video_id TEXT NOT NULL,
        title TEXT NOT NULL,
        song_name TEXT,
        topic_id TEXT NOT NULL CHECK(topic_id IN ('Original_Song', 'Music_Cover')),
        youtube_url TEXT NOT NULL,
        channel_name TEXT NOT NULL,
        idol_id TEXT NOT NULL,
        idol_name TEXT NOT NULL,
        canonical_performance_key TEXT NOT NULL,
        view_count INTEGER,
        published_at TEXT,
        duration_seconds INTEGER,
        UNIQUE(bracket_id, slot_index),
        UNIQUE(bracket_id, canonical_performance_key)
      );

      CREATE INDEX IF NOT EXISTS idx_hololive_bracket_entries_bracket_slot
        ON hololive_bracket_entries(bracket_id, slot_index);
      CREATE INDEX IF NOT EXISTS idx_hololive_bracket_entries_video
        ON hololive_bracket_entries(youtube_video_id);

      CREATE TABLE IF NOT EXISTS hololive_bracket_matches (
        id TEXT PRIMARY KEY,
        bracket_id TEXT NOT NULL REFERENCES hololive_brackets(id) ON DELETE CASCADE,
        round_index INTEGER NOT NULL,
        match_index INTEGER NOT NULL,
        entry_a_id TEXT REFERENCES hololive_bracket_entries(id) ON DELETE SET NULL,
        entry_b_id TEXT REFERENCES hololive_bracket_entries(id) ON DELETE SET NULL,
        winner_entry_id TEXT REFERENCES hololive_bracket_entries(id) ON DELETE SET NULL,
        completed_at TEXT,
        updated_at TEXT NOT NULL,
        UNIQUE(bracket_id, round_index, match_index)
      );

      CREATE INDEX IF NOT EXISTS idx_hololive_bracket_matches_bracket_round
        ON hololive_bracket_matches(bracket_id, round_index, match_index);
      CREATE INDEX IF NOT EXISTS idx_hololive_bracket_matches_winner
        ON hololive_bracket_matches(winner_entry_id);
    `
  },
  {
    version: 26,
    sql: `
      ALTER TABLE hololive_brackets
        ADD COLUMN generation_style TEXT NOT NULL DEFAULT 'top_songs'
          CHECK(generation_style IN ('top_songs', 'random_songs'));
    `
  },
  {
    version: 27,
    sql: `
      ALTER TABLE hololive_brackets
        ADD COLUMN generation_filters_json TEXT NOT NULL DEFAULT '{}';
    `
  },
  {
    version: 28,
    sql: `
      CREATE TABLE IF NOT EXISTS hololive_bracket_archives (
        id TEXT PRIMARY KEY,
        source_bracket_id TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        size TEXT NOT NULL CHECK(size IN ('RO16', 'RO32', 'RO64', 'RO128', 'RO256')),
        generation_style TEXT NOT NULL CHECK(generation_style IN ('top_songs', 'random_songs')),
        generation_filters_json TEXT NOT NULL DEFAULT '{}',
        seed TEXT NOT NULL,
        total_entries INTEGER NOT NULL DEFAULT 0,
        total_matches INTEGER NOT NULL DEFAULT 0,
        completed_matches INTEGER NOT NULL DEFAULT 0,
        champion_youtube_video_id TEXT,
        champion_title TEXT,
        champion_idol_id TEXT,
        champion_idol_name TEXT,
        created_at TEXT NOT NULL,
        completed_at TEXT NOT NULL,
        archived_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_hololive_bracket_archives_archived_at
        ON hololive_bracket_archives(archived_at);
      CREATE INDEX IF NOT EXISTS idx_hololive_bracket_archives_champion_video
        ON hololive_bracket_archives(champion_youtube_video_id);

      CREATE TABLE IF NOT EXISTS hololive_bracket_archive_entries (
        id TEXT PRIMARY KEY,
        archive_id TEXT NOT NULL REFERENCES hololive_bracket_archives(id) ON DELETE CASCADE,
        source_entry_id TEXT,
        slot_index INTEGER NOT NULL,
        youtube_video_id TEXT NOT NULL,
        title_snapshot TEXT NOT NULL,
        song_name_snapshot TEXT,
        topic_id TEXT NOT NULL CHECK(topic_id IN ('Original_Song', 'Music_Cover')),
        youtube_url_snapshot TEXT NOT NULL,
        channel_name_snapshot TEXT NOT NULL,
        idol_id_snapshot TEXT NOT NULL,
        idol_name_snapshot TEXT NOT NULL,
        canonical_performance_key TEXT NOT NULL,
        view_count_snapshot INTEGER,
        published_at_snapshot TEXT,
        duration_seconds_snapshot INTEGER,
        wins INTEGER NOT NULL DEFAULT 0,
        losses INTEGER NOT NULL DEFAULT 0,
        final_rank INTEGER,
        eliminated_round_index INTEGER,
        eliminated_by_youtube_video_id TEXT,
        first_round_eliminated INTEGER NOT NULL DEFAULT 0,
        is_champion INTEGER NOT NULL DEFAULT 0,
        is_finalist INTEGER NOT NULL DEFAULT 0,
        is_top4 INTEGER NOT NULL DEFAULT 0,
        is_top8 INTEGER NOT NULL DEFAULT 0,
        is_top16 INTEGER NOT NULL DEFAULT 0,
        UNIQUE(archive_id, slot_index)
      );

      CREATE INDEX IF NOT EXISTS idx_hololive_bracket_archive_entries_archive
        ON hololive_bracket_archive_entries(archive_id, slot_index);
      CREATE INDEX IF NOT EXISTS idx_hololive_bracket_archive_entries_video
        ON hololive_bracket_archive_entries(youtube_video_id);
      CREATE INDEX IF NOT EXISTS idx_hololive_bracket_archive_entries_idol
        ON hololive_bracket_archive_entries(idol_id_snapshot);

      CREATE TABLE IF NOT EXISTS hololive_bracket_archive_matches (
        id TEXT PRIMARY KEY,
        archive_id TEXT NOT NULL REFERENCES hololive_bracket_archives(id) ON DELETE CASCADE,
        source_match_id TEXT,
        round_index INTEGER NOT NULL,
        match_index INTEGER NOT NULL,
        entry_a_youtube_video_id TEXT,
        entry_b_youtube_video_id TEXT,
        winner_youtube_video_id TEXT NOT NULL,
        loser_youtube_video_id TEXT,
        completed_at TEXT,
        updated_at TEXT NOT NULL,
        UNIQUE(archive_id, round_index, match_index)
      );

      CREATE INDEX IF NOT EXISTS idx_hololive_bracket_archive_matches_archive_round
        ON hololive_bracket_archive_matches(archive_id, round_index, match_index);
      CREATE INDEX IF NOT EXISTS idx_hololive_bracket_archive_matches_winner
        ON hololive_bracket_archive_matches(winner_youtube_video_id);
    `
  }
];

export class DatabaseService {
  private db: Database | null = null;
  private inTransaction = false;
  private dirty = false;
  private SQL: Awaited<ReturnType<typeof initSqlJs>> | null = null;
  private readonly hololiveUndoActions = new Map<string, HololiveUndoAction>();
  private readonly latestHololiveUndoByKind = new Map<HololiveUndoKind, { undoToken: string; undoLabel: string }>();

  constructor(
    private readonly databasePath: string,
    private readonly backupDirectory = path.join(path.dirname(databasePath), "backups")
  ) {}

  async init(): Promise<void> {
    const wasmPath = this.resolveWasmPath();
    const SQL = await initSqlJs({
      locateFile: () => wasmPath
    });
    this.SQL = SQL;
    this.createBackup("startup");

    const bytes = fs.existsSync(this.databasePath) ? fs.readFileSync(this.databasePath) : undefined;
    this.db = bytes ? new SQL.Database(bytes) : new SQL.Database();
    this.db.run("PRAGMA foreign_keys = ON");
    this.db.run("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
    this.applyMigrations();
    this.migrateHololiveChannelsToMergedSchema();
    this.migrateHololiveMusicVideosToMergedParticipants();
    this.seedHololiveTierData();
    this.purgeExcludedHololiveMusicRows();
    this.purgeRejectedHolodexMusicRows();
    this.backfillHololiveMusicClassifications();
    this.migrateHololiveMusicMarkersToKeyedSchema();
    this.backfillHololiveMusicMarkerFallbackKeys();
    const startupCanonicalDuplicateCount =
      this.purgeCanonicalTopicDuplicateRows("startup") +
      this.purgeCrossOwnerTopicDuplicateRows("startup") +
      this.purgeCanonicalVariantDuplicateRows("startup");
    if (startupCanonicalDuplicateCount > 0) {
      this.transferHololiveMusicMarkersFromDuplicateRemovals("startup");
    }
    this.transferHololiveMusicReferencesFromDuplicateRemovals("startup");
    this.normalizeAllHololiveMusicPlaylistItemPositions();
    if (this.dirty) {
      this.flush();
    }
  }

  upsertModuleManifests(manifests: TrackerModuleManifest[]): void {
    const now = new Date().toISOString();
    this.transaction(() => {
      for (const manifest of manifests) {
        this.run(
          `INSERT INTO modules (id, label, manifest_json, updated_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             label = excluded.label,
             manifest_json = excluded.manifest_json,
             updated_at = excluded.updated_at`,
          [manifest.id, manifest.label, JSON.stringify(manifest), now]
        );
      }
    });
  }

  getStats(): AppStats {
    return {
      catalogItems: this.scalarCount("SELECT COUNT(*) FROM catalog_items"),
      trackedEntries: this.scalarCount("SELECT COUNT(*) FROM tracked_entries"),
      fetchJobsQueued: this.scalarCount("SELECT COUNT(*) FROM fetch_jobs WHERE status = 'queued'"),
      coversCached: this.scalarCount("SELECT COUNT(*) FROM covers")
    };
  }

  getSettings(): Record<string, string> {
    const rows = this.select<{ key: string; value: string }>("SELECT key, value FROM settings ORDER BY key");
    return Object.fromEntries(rows.map((row) => [row.key, row.value]));
  }

  setSetting(key: string, value: string): Record<string, string> {
    this.persistSettingValue(key, value);
    return this.getSettings();
  }

  getSourceHealth(): SourceHealth[] {
    return this.select<{
      source_id: SourceId;
      status: SourceHealth["status"];
      checked_at: string;
      http_status: number | null;
      message: string;
    }>("SELECT source_id, status, checked_at, http_status, message FROM source_health ORDER BY source_id").map(
      (row) => ({
        sourceId: row.source_id,
        status: row.status,
        checkedAt: row.checked_at,
        httpStatus: row.http_status,
        message: row.message
      })
    );
  }

  upsertSourceHealth(health: SourceHealth): void {
    this.run(
      `INSERT INTO source_health (source_id, status, checked_at, http_status, message)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(source_id) DO UPDATE SET
         status = excluded.status,
         checked_at = excluded.checked_at,
         http_status = excluded.http_status,
         message = excluded.message`,
      [health.sourceId, health.status, health.checkedAt, health.httpStatus ?? null, health.message]
    );
  }

  listCatalog(filters: CatalogListFilters = {}): CatalogItem[] {
    const limit = Math.min(Math.max(filters.limit ?? 50, 1), 500);
    const where: string[] = [];
    const params: unknown[] = [];

    if (filters.moduleId) {
      where.push("ci.module_id = ?");
      params.push(filters.moduleId);
    }

    if (filters.query?.trim()) {
      where.push("(ci.title LIKE ? OR ci.subtitle LIKE ? OR ci.source_url LIKE ?)");
      const query = `%${filters.query.trim()}%`;
      params.push(query, query, query);
    }

    params.push(limit);
    const rows = this.select<{
      id: string;
      module_id: ModuleId;
      kind: string;
      title: string;
      subtitle: string | null;
      source_url: string | null;
      cover_path: string | null;
      status: CatalogItem["status"];
      rating: number | null;
      notes: string | null;
      tags: string | null;
      updated_at: string;
    }>(
      `SELECT
         ci.id,
         ci.module_id,
         ci.kind,
         ci.title,
         ci.subtitle,
         ci.source_url,
         cv.local_path AS cover_path,
         te.status,
         te.rating,
         te.notes,
         GROUP_CONCAT(it.tag, ',') AS tags,
         ci.updated_at
       FROM catalog_items ci
       LEFT JOIN tracked_entries te ON te.item_id = ci.id
       LEFT JOIN covers cv ON cv.item_id = ci.id
       LEFT JOIN item_tags it ON it.item_id = ci.id
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       GROUP BY ci.id
       ORDER BY ci.updated_at DESC
       LIMIT ?`,
      params
    );

    return rows.map((row) => ({
      id: row.id,
      moduleId: row.module_id,
      kind: row.kind,
      title: row.title,
      subtitle: row.subtitle,
      sourceUrl: row.source_url,
      coverPath: row.cover_path,
      status: row.status,
      rating: row.rating,
      notes: row.notes,
      tags: row.tags ? row.tags.split(",").filter(Boolean) : [],
      updatedAt: row.updated_at
    }));
  }

  insertFetchJob(input: Omit<FetchJob, "id" | "status" | "createdAt" | "updatedAt" | "error">): FetchJob {
    const now = new Date().toISOString();
    const job: FetchJob = {
      ...input,
      id: randomUUID(),
      status: "queued",
      error: null,
      createdAt: now,
      updatedAt: now
    };
    this.run(
      `INSERT INTO fetch_jobs (id, module_id, source_id, kind, target_url, status, priority, error, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        job.id,
        job.moduleId,
        job.sourceId,
        job.kind,
        job.targetUrl,
        job.status,
        job.priority,
        job.error,
        job.createdAt,
        job.updatedAt
      ]
    );
    return job;
  }

  listFetchJobs(): FetchJob[] {
    return this.selectFetchJobs("SELECT * FROM fetch_jobs ORDER BY created_at DESC LIMIT 200");
  }

  nextQueuedFetchJob(): FetchJob | null {
    return (
      this.selectFetchJobs(
        "SELECT * FROM fetch_jobs WHERE status = 'queued' ORDER BY priority DESC, created_at ASC LIMIT 1"
      )[0] ?? null
    );
  }

  updateFetchJobStatus(jobId: string, status: FetchJob["status"], error: string | null = null): FetchJob | null {
    const now = new Date().toISOString();
    this.run("UPDATE fetch_jobs SET status = ?, error = ?, updated_at = ? WHERE id = ?", [status, error, now, jobId]);
    return this.selectFetchJobs("SELECT * FROM fetch_jobs WHERE id = ?", [jobId])[0] ?? null;
  }

  insertHololiveSong(input: {
    title: string;
    artistName: string;
    tier: string;
    playlistName: string;
    sourceUrl: string;
    notes: string;
  }): "inserted" | "skipped" {
    const existing = this.select<{ id: string }>(
      `SELECT id FROM catalog_items
       WHERE module_id = 'hololive'
         AND lower(title) = lower(?)
         AND COALESCE(lower(subtitle), '') = COALESCE(lower(?), '')
       LIMIT 1`,
      [input.title, input.artistName]
    )[0];

    if (existing) {
      return "skipped";
    }

    const now = new Date().toISOString();
    const itemId = randomUUID();
    const tags = normalizeTags(["hololive", "song", input.artistName, input.tier, input.playlistName].filter(Boolean));

    this.run(
      `INSERT INTO catalog_items (id, module_id, kind, title, subtitle, source_url, created_at, updated_at)
       VALUES (?, 'hololive', 'song', ?, ?, ?, ?, ?)`,
      [itemId, input.title, input.artistName || null, input.sourceUrl || null, now, now]
    );
    this.run(
      `INSERT INTO tracked_entries (id, item_id, status, rating, notes, started_at, completed_at, created_at, updated_at)
       VALUES (?, ?, 'planned', NULL, ?, NULL, NULL, ?, ?)`,
      [randomUUID(), itemId, input.notes || null, now, now]
    );
    this.run(
      `INSERT INTO hololive_songs (item_id, artist_name, tier, playlist_name, source_url)
       VALUES (?, ?, ?, ?, ?)`,
      [itemId, input.artistName || null, input.tier || null, input.playlistName || null, input.sourceUrl || null]
    );

    if (input.artistName) {
      this.run(
        `INSERT INTO hololive_artists (id, name, branch, created_at, updated_at)
         VALUES (?, ?, NULL, ?, ?)
         ON CONFLICT(name) DO UPDATE SET updated_at = excluded.updated_at`,
        [randomUUID(), input.artistName, now, now]
      );
    }

    for (const tag of tags) {
      this.run("INSERT OR IGNORE INTO item_tags (item_id, tag) VALUES (?, ?)", [itemId, tag]);
    }

    return "inserted";
  }

  listHololiveIdolMainChannels(): Array<{ idolId: string; youtubeChannelId: string }> {
    return this.select<{ id: string; youtube_channel_id: string | null }>(
      `SELECT id, youtube_channel_id
       FROM hololive_idols
       WHERE youtube_channel_id IS NOT NULL AND youtube_channel_id != ''`
    ).map((row) => ({
      idolId: row.id,
      youtubeChannelId: row.youtube_channel_id ?? ""
    }));
  }

  listHololiveCustomTalentMainChannels(): Array<{ idolId: string; youtubeChannelId: string }> {
    return this.select<{ id: string; youtube_channel_id: string | null }>(
      `SELECT id, youtube_channel_id
       FROM hololive_idols
       WHERE source = 'custom'
         AND youtube_channel_id IS NOT NULL
         AND youtube_channel_id != ''
       ORDER BY sort_order ASC, display_name ASC`
    ).map((row) => ({
      idolId: row.id,
      youtubeChannelId: row.youtube_channel_id ?? ""
    }));
  }

  upsertHololiveCustomTalent(preview: HololiveCustomTalentPreview): HololiveCustomTalentRecord {
    const now = new Date().toISOString();
    const channelId = preview.channelId.trim();
    if (!channelId || isExcludedHolodexChannelId(channelId)) {
      throw new Error("A valid custom talent channel id is required");
    }

    const existingByChannel = this.select<{ id: string; source: HololiveIdol["source"] }>(
      "SELECT id, source FROM hololive_idols WHERE youtube_channel_id = ?",
      [channelId]
    )[0];
    if (existingByChannel?.source === "official") {
      throw new Error("That channel already belongs to an official roster talent");
    }

    const baseSlug = this.slugifyHololiveCustomTalent(preview.slug || preview.displayName || channelId);
    const existingId = existingByChannel?.id ?? null;
    const id = existingId ?? this.nextHololiveCustomTalentId(baseSlug);
    const slug = existingId ? this.select<{ slug: string }>("SELECT slug FROM hololive_idols WHERE id = ?", [existingId])[0]?.slug ?? baseSlug : this.nextHololiveCustomTalentSlug(baseSlug);
    const displayName = preview.displayName.trim() || preview.nativeName?.trim() || channelId;
    const sortOrder = existingId
      ? Number(this.select<{ sort_order: number }>("SELECT sort_order FROM hololive_idols WHERE id = ?", [existingId])[0]?.sort_order ?? 0)
      : this.nextHololiveIdolSortOrder();
    const youtubeChannelUrl = `https://www.youtube.com/channel/${channelId}`;
    const twitterHandle = preview.xHandle?.trim() ?? "";
    const twitterUrl = preview.xUrl?.trim() || (twitterHandle ? `https://x.com/${twitterHandle.replace(/^@/, "")}` : null);

    this.transaction(() => {
      this.run(
        `INSERT INTO hololive_idols
           (id, slug, display_name, branch, generation, status, source, official_url, icon_url,
            profile_image_url, profile_quote, youtube_channel_url, youtube_channel_id, x_handle, x_url,
            birthday, debut_date, height, unit, sort_order, updated_at)
         VALUES (?, ?, ?, ?, ?, 'active', 'custom', ?, ?, ?, NULL, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           slug = excluded.slug,
           display_name = excluded.display_name,
           branch = excluded.branch,
           generation = excluded.generation,
           status = 'active',
           source = 'custom',
           official_url = excluded.official_url,
           icon_url = excluded.icon_url,
           profile_image_url = excluded.profile_image_url,
           youtube_channel_url = excluded.youtube_channel_url,
           youtube_channel_id = excluded.youtube_channel_id,
           x_handle = excluded.x_handle,
           x_url = excluded.x_url,
           updated_at = excluded.updated_at`,
        [
          id,
          slug,
          displayName,
          preview.branch || "Custom",
          preview.generation || "Custom",
          preview.officialUrl || youtubeChannelUrl,
          preview.iconUrl || preview.profileImageUrl || "",
          preview.profileImageUrl || preview.iconUrl || "",
          preview.youtubeChannelUrl || youtubeChannelUrl,
          channelId,
          twitterHandle || null,
          twitterUrl,
          sortOrder,
          now
        ]
      );

      this.upsertHolodexChannels([
        {
          id: channelId,
          name: preview.nativeName || displayName,
          englishName: displayName,
          type: "vtuber",
          org: preview.branch || "Custom",
          group: preview.generation || "",
          photoUrl: preview.iconUrl || preview.profileImageUrl || "",
          twitter: twitterHandle.replace(/^@/, ""),
          videoCount: preview.videoCount ?? null,
          subscriberCount: preview.subscriberCount ?? null,
          clipCount: preview.clipCount ?? null,
          publishedAt: "",
          inactive: false
        }
      ], now);
      this.mergeHololiveChannelIdolIds(channelId, "main", [id], now);
      for (const board of this.listHololiveTierBoardSummaries()) {
        this.ensureHololiveBoardPlacements(board.id);
      }
      this.backfillHololiveMusicClassifications();
    });

    const idol = this.listHololiveIdols().find((candidate) => candidate.id === id);
    const channel = this.listHololiveChannels().find((candidate) => candidate.id === channelId);
    if (!idol || !channel) {
      throw new Error("Custom talent was not saved correctly");
    }
    return { idol, channel };
  }

  deleteHololiveCustomTalent(idolId: string): void {
    const id = idolId.trim();
    const idol = this.select<{ id: string; source: HololiveIdol["source"]; youtube_channel_id: string | null }>(
      "SELECT id, source, youtube_channel_id FROM hololive_idols WHERE id = ?",
      [id]
    )[0];
    if (!idol) {
      throw new Error(`Unknown custom talent: ${id}`);
    }
    if (idol.source !== "custom") {
      throw new Error("Only custom talents can be removed");
    }

    const channelId = idol.youtube_channel_id?.trim() ?? "";
    this.transaction(() => {
      this.run("DELETE FROM hololive_image_cache WHERE idol_id = ?", [id]);
      this.run("DELETE FROM hololive_tier_placements WHERE idol_id = ?", [id]);
      this.run("DELETE FROM hololive_idols WHERE id = ?", [id]);
      if (channelId) {
        this.removeHololiveChannelIdolId(channelId, id, new Date().toISOString());
        this.deleteHololiveMusicRowsForChannel(channelId);
      }
      this.backfillHololiveMusicClassifications();
    });
  }

  listHololiveChannels(filters: { kind?: HololiveChannelKind | null } = {}): HolodexChannel[] {
    const channelRows = this.select<{
      id: string;
      name: string;
      english_name: string | null;
      type: string | null;
      org: string | null;
      group_name: string | null;
      photo_url: string | null;
      twitter: string | null;
      video_count: number | null;
      subscriber_count: number | null;
      clip_count: number | null;
      published_at: string | null;
      inactive: number;
      kind: HololiveChannelKind;
      main_idol_ids_json: string;
      topic_idol_ids_json: string;
      linked_idol_ids_json: string;
      updated_at: string;
    }>(
      `SELECT id, name, english_name, type, org, group_name, photo_url, twitter,
              video_count, subscriber_count, clip_count, published_at, inactive,
              kind, main_idol_ids_json, topic_idol_ids_json, linked_idol_ids_json, updated_at
       FROM hololive_channels
       ORDER BY
         CASE kind
           WHEN 'idol' THEN 0
           WHEN 'topic' THEN 1
           WHEN 'group' THEN 2
           ELSE 3
         END,
         COALESCE(english_name, name, id) ASC`
    );

    return channelRows
      .map((row) => {
        const mainIdolIds = this.parseJsonStringArray(row.main_idol_ids_json);
        const topicIdolIds = this.parseJsonStringArray(row.topic_idol_ids_json);
        const linkedIdolIds = this.parseJsonStringArray(row.linked_idol_ids_json);
        return {
          id: row.id,
          name: row.name,
          englishName: row.english_name,
          type: row.type,
          org: row.org,
          group: row.group_name,
          photoUrl: row.photo_url,
          twitter: row.twitter,
          videoCount: row.video_count,
          subscriberCount: row.subscriber_count,
          clipCount: row.clip_count,
          publishedAt: row.published_at,
          inactive: Boolean(row.inactive),
          kind: row.kind,
          mainIdolIds,
          topicIdolIds,
          linkedIdolIds,
          updatedAt: row.updated_at
        };
      })
      .filter((channel) => !filters.kind || channel.kind === filters.kind);
  }

  refreshHolodexChannels(channels: HolodexChannelRecord[]): { refreshedChannels: number; classifiedChannels: number; updatedAt: string } {
    const updatedAt = new Date().toISOString();
    let classifiedChannels = 0;
    const allowedChannels = channels.filter((channel) => !isExcludedHolodexChannelId(channel.id));

    this.transaction(() => {
      this.deleteExcludedHolodexChannelData();
      this.seedHololiveMainChannels(updatedAt);
      this.upsertHolodexChannels(allowedChannels, updatedAt);
      this.classifyHolodexGroupChannels(updatedAt);
      classifiedChannels = this.scalarCount("SELECT COUNT(*) FROM hololive_channels WHERE kind != 'unknown'");
    });

    return {
      refreshedChannels: allowedChannels.length,
      classifiedChannels,
      updatedAt
    };
  }

  importHolodexMusicArtifacts(
    bundle: HolodexArtifactBundle,
    source: HololiveMusicRefreshRun["source"] = "artifact",
    options: { replaceExisting?: boolean } = {}
  ): HololiveMusicImportResult {
    const runId = randomUUID();
    const startedAt = new Date().toISOString();
    let matchedRows: HolodexCatalogRow[] = [];
    let matchedDetailCount = 0;
    let matchedDuplicateCount = 0;
    let canonicalDuplicateCount = 0;

    if (options.replaceExisting) {
      this.createBackup("holodex-replace-refresh");
    }

    this.transaction(() => {
      if (options.replaceExisting) {
        this.clearHolodexMusicData();
      }
      this.deleteExcludedHolodexChannelData();
      this.seedHololiveMainChannels(startedAt);
      this.classifyHolodexGroupChannels(startedAt);
      const excludedVideoIds = this.getHololiveMusicExclusionSet();
      const sourceEligibleRows = bundle.rows.filter(
        (row) => !getRowCleanupReason(row, {}, bundle.detailCache)
      );
      let channelContext = this.getHololiveChannelContext();
      matchedRows = sourceEligibleRows.filter(
        (row) =>
          !excludedVideoIds.has(row.youtubeVideoId) &&
          this.shouldImportHolodexMusicRow(row, bundle.detailCache[row.youtubeVideoId], channelContext)
      );
      let matchedDetails = this.pickHolodexDetailsForRows(bundle.detailCache, matchedRows);

      this.upsertHolodexChannels(this.extractHolodexChannelsFromDetails(matchedDetails), startedAt);
      this.inferHolodexTopicChannels(matchedDetails, startedAt);
      this.classifyHolodexGroupChannels(startedAt);
      channelContext = this.getHololiveChannelContext();
      matchedRows = matchedRows.filter(
        (row) =>
          !excludedVideoIds.has(row.youtubeVideoId) &&
          this.shouldImportHolodexMusicRow(row, matchedDetails[row.youtubeVideoId], channelContext)
      );
      matchedDetails = this.pickHolodexDetailsForRows(bundle.detailCache, matchedRows);
      const matchedDuplicateRemovals = this.filterHolodexDuplicateRemovals(bundle.duplicateRemovals, matchedRows);
      matchedDetailCount = Object.keys(matchedDetails).length;
      matchedDuplicateCount = matchedDuplicateRemovals.length;

      this.insertHololiveMusicRefreshRun({
        id: runId,
        source,
        status: "running",
        startedAt,
        completedAt: null,
        fetchedRows: bundle.rows.length,
        keptRows: 0,
        filteredRows: 0,
        duplicateRows: 0,
        error: null
      });
      this.upsertHolodexDetailCache(matchedDetails);
      this.upsertHolodexDuplicateRemovals(matchedDuplicateRemovals, runId);
      this.upsertHolodexMusicRows(matchedRows, matchedDetails, channelContext, runId);
      canonicalDuplicateCount = this.purgeCanonicalTopicDuplicateRows(runId);
      canonicalDuplicateCount += this.purgeCrossOwnerTopicDuplicateRows(runId);
      canonicalDuplicateCount += this.purgeCanonicalVariantDuplicateRows(runId);
      matchedDuplicateCount += canonicalDuplicateCount;
      matchedDetailCount = Math.max(0, matchedDetailCount - canonicalDuplicateCount);
      this.transferHololiveMusicMarkersFromDuplicateRemovals(runId);
      this.transferHololiveMusicReferencesFromDuplicateRemovals(runId);
      this.finishHololiveMusicRefreshRun(runId, {
        status: "completed",
        keptRows: matchedRows.length - canonicalDuplicateCount,
        filteredRows: bundle.rows.length - matchedRows.length + canonicalDuplicateCount,
        duplicateRows: matchedDuplicateCount,
        error: null
      });
    });

    const run = this.getHololiveMusicRefreshRun(runId);
    if (!run) {
      throw new Error("Holodex import run was not saved");
    }

    return {
      run,
      sourceRows: bundle.rows.length,
      idolMatchedRows: matchedRows.length,
      importedRows: matchedRows.length - canonicalDuplicateCount,
      detailCacheRows: matchedDetailCount,
      duplicateRows: matchedDuplicateCount
    };
  }

  recordFailedHolodexRefresh(input: { source: "artifact" | "live"; error: string }): HololiveMusicImportResult {
    const runId = randomUUID();
    const startedAt = new Date().toISOString();
    const completedAt = new Date().toISOString();

    this.insertHololiveMusicRefreshRun({
      id: runId,
      source: input.source,
      status: "failed",
      startedAt,
      completedAt,
      fetchedRows: 0,
      keptRows: 0,
      filteredRows: 0,
      duplicateRows: 0,
      error: input.error
    });

    const run = this.getHololiveMusicRefreshRun(runId);
    if (!run) {
      throw new Error("Holodex failed run was not saved");
    }

    return {
      run,
      sourceRows: 0,
      idolMatchedRows: 0,
      importedRows: 0,
      detailCacheRows: 0,
      duplicateRows: 0
    };
  }

  clearHolodexMusicData(): void {
    const itemRows = this.select<{ item_id: string }>(
      `SELECT item_id FROM hololive_music_videos
       UNION
       SELECT item_id FROM source_refs WHERE source_id = 'holodex'`
    );
    if (itemRows.length > 0) {
      this.run(
        `DELETE FROM catalog_items WHERE id IN (${itemRows.map(() => "?").join(", ")})`,
        itemRows.map((row) => row.item_id)
      );
    }

    this.run("DELETE FROM source_refs WHERE source_id = 'holodex'");
    this.run("DELETE FROM hololive_music_videos");
    this.run("DELETE FROM hololive_music_detail_cache");
    this.run("DELETE FROM hololive_music_duplicate_removals");
    this.run("DELETE FROM hololive_music_refresh_runs WHERE source IN ('artifact', 'live')");
    this.run("DELETE FROM item_tags WHERE item_id LIKE 'holodex:%'");
  }

  listHololiveMusicRows(filters: {
    idolId?: string | null;
    topicId?: HololiveMusicTopic | null;
    youtubeVideoIds?: string[] | null;
    participantRoles?: HololiveMusicParticipantRole[] | null;
    assignment?: "owned" | "featured" | null;
    excludeCanonicalPerformanceKeys?: string[] | null;
    dedupeCanonicalPerformance?: boolean | null;
    query?: string | null;
    limit?: number | null;
  } = {}): HololiveMusicRow[] {
    const where: string[] = [];
    const params: unknown[] = [];
    const videoIdLimit = filters.youtubeVideoIds ? 5000 : 500;
    const limit = Math.min(Math.max(Math.round(filters.limit ?? 100), 1), videoIdLimit);

    where.push(
      "NOT EXISTS (SELECT 1 FROM hololive_music_exclusions e WHERE e.youtube_video_id = v.youtube_video_id)"
    );

    if (filters.idolId) {
      if (filters.assignment === "owned") {
        where.push("EXISTS (SELECT 1 FROM json_each(v.owned_idol_ids_json) owned WHERE owned.value = ?)");
        params.push(filters.idolId);
      } else if (filters.assignment === "featured") {
        where.push("EXISTS (SELECT 1 FROM json_each(v.featured_idol_ids_json) featured WHERE featured.value = ?)");
        params.push(filters.idolId);
      } else {
        const participantRoles = [...new Set(filters.participantRoles ?? [])].filter((role) =>
          this.isHololiveMusicParticipantRole(role)
        );
        if (participantRoles.length > 0) {
          where.push(
            `EXISTS (
              SELECT 1 FROM json_each(v.participants_json) p
              WHERE json_extract(p.value, '$.idolId') = ?
                AND json_extract(p.value, '$.role') IN (${participantRoles.map(() => "?").join(", ")})
            )`
          );
          params.push(filters.idolId, ...participantRoles);
        } else {
          where.push("(v.idol_id = ? OR v.participant_idol_ids_json LIKE ? OR v.owned_idol_ids_json LIKE ? OR v.featured_idol_ids_json LIKE ?)");
          params.push(filters.idolId, `%"${filters.idolId}"%`, `%"${filters.idolId}"%`, `%"${filters.idolId}"%`);
        }
      }
    }

    if (filters.topicId) {
      where.push("v.topic_id = ?");
      params.push(filters.topicId);
    }

    const youtubeVideoIds = [
      ...new Set((filters.youtubeVideoIds ?? []).map((videoId) => videoId.trim()).filter(Boolean))
    ];
    if (youtubeVideoIds.length > 0) {
      where.push(`v.youtube_video_id IN (${youtubeVideoIds.map(() => "?").join(", ")})`);
      params.push(...youtubeVideoIds);
    }

    if (filters.query?.trim()) {
      const query = `%${filters.query.trim()}%`;
      where.push(
        `(v.title LIKE ?
          OR v.song_name LIKE ?
          OR v.channel_name LIKE ?
          OR v.youtube_video_id LIKE ?
          OR v.canonical_song_key LIKE ?
          OR v.canonical_performance_key LIKE ?
          OR v.participants_json LIKE ?
          OR v.owned_idol_ids_json LIKE ?
          OR v.featured_idol_ids_json LIKE ?)`
      );
      params.push(query, query, query, query, query, query, query, query, query);
    }

    const excludedCanonicalPerformanceKeys = [
      ...new Set((filters.excludeCanonicalPerformanceKeys ?? []).map((key) => key.trim()).filter(Boolean))
    ];
    if (excludedCanonicalPerformanceKeys.length > 0) {
      where.push(`v.canonical_performance_key NOT IN (${excludedCanonicalPerformanceKeys.map(() => "?").join(", ")})`);
      params.push(...excludedCanonicalPerformanceKeys);
    }

    const queryLimit = filters.dedupeCanonicalPerformance ? 500 : limit;
    params.push(queryLimit);

    const selectedRows = this.select<{
      youtube_video_id: string;
      idol_id: string | null;
      title: string;
      song_name: string | null;
      canonical_song_key: string;
      canonical_performance_key: string;
      topic_id: HololiveMusicTopic;
      status: string;
      youtube_url: string;
      channel_id: string;
      channel_name: string;
      uploader_channel_kind: HololiveChannelKind;
      uploader_channel_group: string | null;
      participants_json: string | null;
      owned_idol_ids_json: string | null;
      featured_idol_ids_json: string | null;
      published_at: string | null;
      duration_seconds: number | null;
      view_count: number | null;
      view_count_fetched_at: string | null;
      provided_to_youtube: number | null;
      marker_key: string;
      marker: HololiveMusicMarker | null;
      updated_at: string;
    }>(
      `SELECT v.youtube_video_id, v.idol_id, v.title, v.song_name, v.canonical_song_key, v.canonical_performance_key,
              v.topic_id, v.status, v.youtube_url, v.channel_id, v.channel_name,
              COALESCE(c.kind, 'unknown') AS uploader_channel_kind,
              c.group_name AS uploader_channel_group,
              v.participants_json, v.owned_idol_ids_json, v.featured_idol_ids_json,
              v.published_at, v.duration_seconds,
              s.view_count, s.fetched_at AS view_count_fetched_at,
              v.provided_to_youtube,
              COALESCE(NULLIF(v.canonical_performance_key, ''), 'video:' || v.youtube_video_id) AS marker_key,
              COALESCE(cm.marker, vm.marker) AS marker,
              v.updated_at
       FROM hololive_music_videos v
       LEFT JOIN hololive_channels c ON c.id = v.channel_id
       LEFT JOIN hololive_music_video_stats s ON s.youtube_video_id = v.youtube_video_id
       LEFT JOIN hololive_music_marker_keys cm ON cm.marker_key = NULLIF(v.canonical_performance_key, '')
       LEFT JOIN hololive_music_marker_keys vm ON vm.marker_key = 'video:' || v.youtube_video_id
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY COALESCE(v.published_at, '') DESC, v.title ASC
      LIMIT ?`,
      params
    );
    const idolMetadata = this.getHololiveIdolMetadataMap();
    const rows = filters.dedupeCanonicalPerformance
      ? this.dedupeHololiveMusicRowsByCanonicalPerformance(selectedRows).slice(0, limit)
      : selectedRows;

    return rows.map((row) => ({
      youtubeVideoId: row.youtube_video_id,
      idolId: row.idol_id,
      title: row.title,
      songName: row.song_name,
      canonicalSongKey: row.canonical_song_key,
      canonicalPerformanceKey: row.canonical_performance_key,
      topicId: row.topic_id,
      status: row.status,
      youtubeUrl: row.youtube_url,
      channelId: row.channel_id,
      channelName: row.channel_name,
      uploaderChannelKind: row.uploader_channel_kind,
      uploaderChannelGroup: row.uploader_channel_group,
      participants: this.parseStoredHololiveMusicParticipants(row.youtube_video_id, row.participants_json, idolMetadata),
      ownedIdolIds: this.parseJsonStringArray(row.owned_idol_ids_json),
      featuredIdolIds: this.parseJsonStringArray(row.featured_idol_ids_json),
      publishedAt: row.published_at,
      durationSeconds: row.duration_seconds,
      viewCount: row.view_count,
      viewCountFetchedAt: row.view_count_fetched_at,
      markerKey: row.marker_key,
      marker: row.marker,
      updatedAt: row.updated_at
    }));
  }

  setHololiveMusicMarker(input: { youtubeVideoId: string; marker: HololiveMusicMarker | null }): HololiveMusicMarkerRecord {
    const youtubeVideoId = input.youtubeVideoId.trim();
    if (!youtubeVideoId) {
      throw new Error("A YouTube video ID is required");
    }
    const markerKeys = this.getHololiveMusicMarkerKeysForVideo(youtubeVideoId);
    const primaryMarkerKey = markerKeys[0] ?? this.getHololiveMusicVideoMarkerKey(null, youtubeVideoId);

    if (this.getHololiveMusicExclusionSet().has(youtubeVideoId)) {
      this.deleteHololiveMusicMarkersForKeys(markerKeys);
      return {
        youtubeVideoId,
        markerKey: primaryMarkerKey,
        marker: null,
        updatedAt: null
      };
    }

    if (input.marker === null) {
      this.deleteHololiveMusicMarkersForKeys(markerKeys);
      return {
        youtubeVideoId,
        markerKey: primaryMarkerKey,
        marker: null,
        updatedAt: null
      };
    }

    if (!this.isHololiveMusicMarker(input.marker)) {
      throw new Error(`Unsupported Hololive music marker: ${input.marker}`);
    }

    const now = new Date().toISOString();
    this.transaction(() => {
      for (const markerKey of markerKeys) {
        this.run(
          `INSERT INTO hololive_music_marker_keys (marker_key, marker, created_at, updated_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(marker_key) DO UPDATE SET
             marker = excluded.marker,
             updated_at = excluded.updated_at,
             favorite_position = CASE
               WHEN excluded.marker = 'favorite' THEN hololive_music_marker_keys.favorite_position
               ELSE NULL
             END`,
          [markerKey, input.marker, now, now]
        );
      }
    });

    return {
      youtubeVideoId,
      markerKey: primaryMarkerKey,
      marker: input.marker,
      updatedAt: now
    };
  }

  private getHololiveMusicItemIdsForVideo(youtubeVideoId: string): string[] {
    const id = youtubeVideoId.trim();
    return [
      this.getHolodexMusicItemId(id),
      ...this
        .select<{ item_id: string }>(
          `SELECT item_id FROM hololive_music_videos WHERE youtube_video_id = ?
           UNION
           SELECT item_id FROM source_refs WHERE source_id = 'holodex' AND source_key = ?`,
          [id, id]
        )
        .map((row) => row.item_id)
    ].filter((itemId, index, values) => itemId && values.indexOf(itemId) === index);
  }

  private registerHololiveMusicExclusionUndo(youtubeVideoId: string): void {
    const id = youtubeVideoId.trim();
    const markerKeys = this.getHololiveMusicMarkerKeysForVideo(id);
    const itemIds = this.getHololiveMusicItemIdsForVideo(id);
    const itemPlaceholders = itemIds.map(() => "?").join(", ");
    const markerPlaceholders = markerKeys.map(() => "?").join(", ");
    const snapshot = {
      catalogItems: itemIds.length > 0 ? this.selectTableRows("catalog_items", `WHERE id IN (${itemPlaceholders})`, itemIds) : [],
      itemTags: itemIds.length > 0 ? this.selectTableRows("item_tags", `WHERE item_id IN (${itemPlaceholders})`, itemIds) : [],
      sourceRefs:
        itemIds.length > 0
          ? this.selectTableRows(
              "source_refs",
              `WHERE (source_id = 'holodex' AND source_key = ?) OR item_id IN (${itemPlaceholders})`,
              [id, ...itemIds]
            )
          : this.selectTableRows("source_refs", "WHERE source_id = 'holodex' AND source_key = ?", [id]),
      musicVideos: this.selectTableRows("hololive_music_videos", "WHERE youtube_video_id = ?", [id]),
      detailCache: this.selectTableRows("hololive_music_detail_cache", "WHERE youtube_video_id = ?", [id]),
      stats: this.selectTableRows("hololive_music_video_stats", "WHERE youtube_video_id = ?", [id]),
      duplicateRemovals: this.selectTableRows(
        "hololive_music_duplicate_removals",
        "WHERE removed_youtube_video_id = ? OR kept_youtube_video_id = ?",
        [id, id]
      ),
      markerKeys:
        markerKeys.length > 0 ? this.selectTableRows("hololive_music_marker_keys", `WHERE marker_key IN (${markerPlaceholders})`, markerKeys) : [],
      playlistItems: this.selectTableRows("hololive_music_playlist_items", "WHERE youtube_video_id = ?", [id]),
      queueItems: this.selectTableRows("hololive_music_queue_items", "WHERE youtube_video_id = ?", [id]),
      playerState: this.selectTableRows("hololive_music_player_state", "WHERE id = 'hololive'")
    };

    this.registerHololiveUndoAction("music-exclusion", "Restore song", () => {
      this.run("DELETE FROM hololive_music_exclusions WHERE youtube_video_id = ?", [id]);
      this.insertOrReplaceRows("catalog_items", snapshot.catalogItems);
      this.insertOrReplaceRows("source_refs", snapshot.sourceRefs);
      this.insertOrReplaceRows("item_tags", snapshot.itemTags);
      this.insertOrReplaceRows("hololive_music_detail_cache", snapshot.detailCache);
      this.insertOrReplaceRows("hololive_music_videos", snapshot.musicVideos);
      this.insertOrReplaceRows("hololive_music_video_stats", snapshot.stats);
      this.insertOrReplaceRows("hololive_music_duplicate_removals", snapshot.duplicateRemovals);
      this.insertOrReplaceRows("hololive_music_marker_keys", snapshot.markerKeys);
      this.insertOrReplaceRows("hololive_music_playlist_items", snapshot.playlistItems);
      this.insertOrReplaceRows("hololive_music_queue_items", snapshot.queueItems);
      this.insertOrReplaceRows("hololive_music_player_state", snapshot.playerState);
      const playlistIds = [
        ...new Set(snapshot.playlistItems.map((row) => String(row.playlist_id ?? "")).filter(Boolean))
      ];
      for (const playlistId of playlistIds) {
        this.normalizeHololiveMusicPlaylistItemPositionsWithinTransaction(playlistId);
      }
      this.normalizeHololiveMusicQueuePositionsWithinTransaction();
    });
  }

  private isHololiveMusicMarker(value: unknown): value is HololiveMusicMarker {
    return value === "favorite" || value === "like" || value === "neutral" || value === "dislike";
  }

  private getHololiveMusicVideoMarkerKey(
    canonicalPerformanceKey: string | null | undefined,
    youtubeVideoId: string
  ): string {
    const canonicalKey = canonicalPerformanceKey?.trim() ?? "";
    return canonicalKey || `video:${youtubeVideoId.trim()}`;
  }

  private getHololiveMusicMarkerKeysForVideo(youtubeVideoId: string): string[] {
    const id = youtubeVideoId.trim();
    if (!id) {
      return [];
    }

    const row = this.select<{ canonical_performance_key: string | null }>(
      "SELECT canonical_performance_key FROM hololive_music_videos WHERE youtube_video_id = ?",
      [id]
    )[0];
    const canonicalPerformanceKey = row?.canonical_performance_key?.trim() ?? "";
    const videoIds = canonicalPerformanceKey
      ? this.select<{ youtube_video_id: string }>(
          `SELECT youtube_video_id
           FROM hololive_music_videos
           WHERE canonical_performance_key = ?
           ORDER BY youtube_video_id`,
          [canonicalPerformanceKey]
        ).map((candidate) => candidate.youtube_video_id)
      : [id];
    const keys = [
      this.getHololiveMusicVideoMarkerKey(canonicalPerformanceKey, id),
      ...videoIds.map((videoId) => `video:${videoId}`)
    ];
    return [...new Set(keys.map((key) => key.trim()).filter(Boolean))];
  }

  private deleteHololiveMusicMarkersForKeys(markerKeys: string[]): void {
    const keys = [...new Set(markerKeys.map((key) => key.trim()).filter(Boolean))];
    if (keys.length === 0) {
      return;
    }

    this.run(
      `DELETE FROM hololive_music_marker_keys WHERE marker_key IN (${keys.map(() => "?").join(", ")})`,
      keys
    );
  }

  private upsertHololiveMusicExclusion(input: {
    youtubeVideoId: string;
    titleSnapshot?: string | null;
    sourceUrlSnapshot?: string | null;
    createdAt?: string | null;
  }): void {
    const youtubeVideoId = input.youtubeVideoId.trim();
    if (!youtubeVideoId) {
      return;
    }

    this.run(
      `INSERT INTO hololive_music_exclusions (youtube_video_id, title_snapshot, source_url_snapshot, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(youtube_video_id) DO UPDATE SET
         title_snapshot = COALESCE(excluded.title_snapshot, hololive_music_exclusions.title_snapshot),
         source_url_snapshot = COALESCE(excluded.source_url_snapshot, hololive_music_exclusions.source_url_snapshot)`,
      [
        youtubeVideoId,
        input.titleSnapshot?.trim() || null,
        input.sourceUrlSnapshot?.trim() || null,
        input.createdAt?.trim() || new Date().toISOString()
      ]
    );
  }

  excludeHololiveMusicVideo(input: {
    youtubeVideoId: string;
    title?: string | null;
    sourceUrl?: string | null;
  }): HololiveMusicExclusionRecord {
    const youtubeVideoId = input.youtubeVideoId.trim();
    if (!youtubeVideoId) {
      throw new Error("A YouTube video ID is required");
    }

    const existing = this.select<{
      title: string | null;
      source_url: string | null;
    }>(
      `SELECT title, youtube_url AS source_url
       FROM hololive_music_videos
       WHERE youtube_video_id = ?`,
      [youtubeVideoId]
    )[0];
    const titleSnapshot = input.title?.trim() || existing?.title || null;
    const sourceUrlSnapshot = input.sourceUrl?.trim() || existing?.source_url || null;
    const now = new Date().toISOString();

    this.registerHololiveMusicExclusionUndo(youtubeVideoId);
    this.createBackup("hololive-music-exclusion");

    this.transaction(() => {
      this.upsertHololiveMusicExclusion({ youtubeVideoId, titleSnapshot, sourceUrlSnapshot, createdAt: now });
      this.run("DELETE FROM hololive_music_playlist_items WHERE youtube_video_id = ?", [youtubeVideoId]);
      this.run("DELETE FROM hololive_music_queue_items WHERE youtube_video_id = ?", [youtubeVideoId]);
      const state = this.ensureHololiveMusicPlayerState();
      if (state.currentYoutubeVideoId === youtubeVideoId) {
        this.setHololiveMusicPlayerStateRow({
          playbackSourceType: "library",
          currentQueueItemId: null,
          currentPlaylistId: null,
          currentPlaylistItemId: null,
          currentYoutubeVideoId: null
        });
      }
      this.deleteHololiveMusicVideoData(youtubeVideoId, { deleteMarker: true, deleteStats: true });
    });

    const row = this.select<{
      youtube_video_id: string;
      title_snapshot: string | null;
      source_url_snapshot: string | null;
      created_at: string;
    }>(
      `SELECT youtube_video_id, title_snapshot, source_url_snapshot, created_at
       FROM hololive_music_exclusions
       WHERE youtube_video_id = ?`,
      [youtubeVideoId]
    )[0];

    if (!row) {
      throw new Error("Hololive music exclusion was not saved");
    }

    return {
      youtubeVideoId: row.youtube_video_id,
      titleSnapshot: row.title_snapshot,
      sourceUrlSnapshot: row.source_url_snapshot,
      createdAt: row.created_at
    };
  }

  markHololiveMusicVideoUnavailable(input: {
    youtubeVideoId: string;
    title?: string | null;
    sourceUrl?: string | null;
    reason?: string | null;
    createBackup?: boolean | null;
  }): HololiveMusicUnavailableResponse {
    const youtubeVideoId = input.youtubeVideoId.trim();
    if (!youtubeVideoId) {
      throw new Error("A YouTube video ID is required");
    }

    const row = this.select<HololiveStoredMusicDuplicateRow & { youtube_url: string }>(
      `SELECT youtube_video_id, youtube_url, title, song_name, topic_id, canonical_song_key, canonical_performance_key,
              channel_id, channel_name, original_channel_id, provided_to_youtube, duration_seconds, published_at,
              participants_json, owned_idol_ids_json, featured_idol_ids_json
       FROM hololive_music_videos
       WHERE youtube_video_id = ?`,
      [youtubeVideoId]
    )[0];
    const titleSnapshot = input.title?.trim() || row?.title || null;
    const sourceUrlSnapshot = input.sourceUrl?.trim() || row?.youtube_url || null;

    if (!row) {
      this.upsertHololiveMusicExclusion({
        youtubeVideoId,
        titleSnapshot,
        sourceUrlSnapshot,
        createdAt: new Date().toISOString()
      });
      return {
        removedYoutubeVideoId: youtubeVideoId,
        replacementYoutubeVideoId: null,
        replacementTitle: null,
        data: this.getHololiveMusicPlayerData()
      };
    }

    const replacement = this.findHololiveMusicUnavailableReplacement(row);
    const replacementYoutubeVideoId = replacement?.youtube_video_id ?? null;

    if (input.createBackup !== false) {
      this.createBackup("hololive-music-unavailable");
    }
    this.transaction(() => {
      this.upsertHololiveMusicExclusion({
        youtubeVideoId,
        titleSnapshot,
        sourceUrlSnapshot,
        createdAt: new Date().toISOString()
      });

      if (replacementYoutubeVideoId) {
        this.transferHololiveMusicReferencesBetweenVideos(youtubeVideoId, replacementYoutubeVideoId);
        this.transferHololiveMusicMarkersBetweenVideos(youtubeVideoId, replacementYoutubeVideoId);
        this.deleteHololiveMusicVideoData(youtubeVideoId, { deleteStats: true });
      } else {
        this.run("DELETE FROM hololive_music_playlist_items WHERE youtube_video_id = ?", [youtubeVideoId]);
        this.run("DELETE FROM hololive_music_queue_items WHERE youtube_video_id = ?", [youtubeVideoId]);
        const state = this.ensureHololiveMusicPlayerState();
        if (state.currentYoutubeVideoId === youtubeVideoId) {
          this.setHololiveMusicPlayerStateRow({
            playbackSourceType: "library",
            currentQueueItemId: null,
            currentPlaylistId: null,
            currentPlaylistItemId: null,
            currentYoutubeVideoId: null
          });
        }
        this.deleteHololiveMusicVideoData(youtubeVideoId, { deleteMarker: true, deleteStats: true });
      }
    });

    return {
      removedYoutubeVideoId: youtubeVideoId,
      replacementYoutubeVideoId,
      replacementTitle: replacement?.song_name || replacement?.title || null,
      data: this.getHololiveMusicPlayerData()
    };
  }

  private findHololiveMusicUnavailableReplacement(
    row: HololiveStoredMusicDuplicateRow
  ): HololiveStoredMusicDuplicateRow | null {
    const canonicalPerformanceKey = row.canonical_performance_key?.trim() ?? "";
    const canonicalSongKey = row.canonical_song_key?.trim() ?? "";
    if (!canonicalPerformanceKey && !canonicalSongKey) {
      return null;
    }

    const candidates = this.select<HololiveStoredMusicDuplicateRow>(
      `SELECT v.youtube_video_id, v.title, v.song_name, v.topic_id, v.canonical_song_key, v.canonical_performance_key,
              v.channel_id, v.channel_name, v.original_channel_id, v.provided_to_youtube, v.duration_seconds, v.published_at,
              v.participants_json, v.owned_idol_ids_json, v.featured_idol_ids_json
       FROM hololive_music_videos v
       WHERE v.youtube_video_id != ?
         AND v.topic_id = ?
         AND NOT EXISTS (SELECT 1 FROM hololive_music_exclusions e WHERE e.youtube_video_id = v.youtube_video_id)
         AND (
           (? != '' AND v.canonical_performance_key = ?)
           OR (? != '' AND v.canonical_song_key = ?)
         )`,
      [row.youtube_video_id, row.topic_id, canonicalPerformanceKey, canonicalPerformanceKey, canonicalSongKey, canonicalSongKey]
    ).filter((candidate) => {
      if (canonicalPerformanceKey && candidate.canonical_performance_key === canonicalPerformanceKey) {
        return true;
      }

      return (
        Boolean(canonicalSongKey && candidate.canonical_song_key === canonicalSongKey) &&
        this.hasStoredHololiveDuplicateDurationOverlap(row, candidate) &&
        this.hasStoredHololiveDuplicateParticipantOverlap(row, candidate)
      );
    });

    if (candidates.length === 0) {
      return null;
    }

    return [...candidates].sort((left, right) => {
      const leftSamePerformance = canonicalPerformanceKey && left.canonical_performance_key === canonicalPerformanceKey;
      const rightSamePerformance = canonicalPerformanceKey && right.canonical_performance_key === canonicalPerformanceKey;
      if (leftSamePerformance !== rightSamePerformance) {
        return leftSamePerformance ? -1 : 1;
      }

      return this.compareHololiveMusicDisplayRow(right, left);
    })[0];
  }

  private transferHololiveMusicReferencesBetweenVideos(removedYoutubeVideoId: string, keptYoutubeVideoId: string): void {
    const removedId = removedYoutubeVideoId.trim();
    const keptId = keptYoutubeVideoId.trim();
    if (!removedId || !keptId || removedId === keptId) {
      return;
    }

    const keptSnapshot = this.select<{ title: string; youtube_url: string }>(
      "SELECT title, youtube_url FROM hololive_music_videos WHERE youtube_video_id = ?",
      [keptId]
    )[0];
    if (!keptSnapshot) {
      return;
    }

    const keptTitle = keptSnapshot.title || null;
    const keptUrl = keptSnapshot.youtube_url || null;
    const transferReferences = () => {
      const state = this.ensureHololiveMusicPlayerState();
      const affectedPlaylistIds = this.select<{ playlist_id: string }>(
        "SELECT DISTINCT playlist_id FROM hololive_music_playlist_items WHERE youtube_video_id = ?",
        [removedId]
      ).map((row) => row.playlist_id);
      const duplicatePlaylistRows = this.select<{
        playlist_id: string;
        removed_item_id: string;
        kept_item_id: string;
      }>(
        `SELECT removed.playlist_id, removed.id AS removed_item_id, kept.id AS kept_item_id
         FROM hololive_music_playlist_items removed
         JOIN hololive_music_playlist_items kept
           ON kept.playlist_id = removed.playlist_id
          AND kept.youtube_video_id = ?
         WHERE removed.youtube_video_id = ?`,
        [keptId, removedId]
      );
      const currentPlaylistReplacement =
        state.currentPlaylistItemId
          ? duplicatePlaylistRows.find((row) => row.removed_item_id === state.currentPlaylistItemId)
          : null;

      this.run(
        `DELETE FROM hololive_music_playlist_items
         WHERE youtube_video_id = ?
           AND EXISTS (
             SELECT 1
             FROM hololive_music_playlist_items kept
             WHERE kept.playlist_id = hololive_music_playlist_items.playlist_id
               AND kept.youtube_video_id = ?
           )`,
        [removedId, keptId]
      );
      this.run(
        `UPDATE hololive_music_playlist_items
         SET youtube_video_id = ?,
             title_snapshot = COALESCE(?, title_snapshot),
             source_url_snapshot = COALESCE(?, source_url_snapshot)
         WHERE youtube_video_id = ?`,
        [keptId, keptTitle, keptUrl, removedId]
      );
      for (const playlistId of affectedPlaylistIds) {
        this.normalizeHololiveMusicPlaylistItemPositionsWithinTransaction(playlistId);
      }

      this.run(
        `UPDATE hololive_music_queue_items
         SET youtube_video_id = ?,
             title_snapshot = COALESCE(?, title_snapshot),
             source_url_snapshot = COALESCE(?, source_url_snapshot)
         WHERE youtube_video_id = ?`,
        [keptId, keptTitle, keptUrl, removedId]
      );

      if (state.currentYoutubeVideoId === removedId || currentPlaylistReplacement) {
        this.setHololiveMusicPlayerStateRow({
          currentPlaylistItemId: currentPlaylistReplacement?.kept_item_id,
          currentYoutubeVideoId: keptId
        });
      }

      this.normalizeHololiveMusicQueuePositionsWithinTransaction();
    };

    if (this.inTransaction) {
      transferReferences();
    } else {
      this.transaction(transferReferences);
    }
  }

  private transferHololiveMusicMarkersBetweenVideos(removedYoutubeVideoId: string, keptYoutubeVideoId: string): void {
    const removedId = removedYoutubeVideoId.trim();
    const keptId = keptYoutubeVideoId.trim();
    if (!removedId || !keptId || removedId === keptId) {
      return;
    }

    const removedMarkerKeys = this.getHololiveMusicMarkerKeysForVideo(removedId);
    if (removedMarkerKeys.length === 0) {
      return;
    }

    const markerRow = this.select<{
      marker: HololiveMusicMarker;
      created_at: string;
      updated_at: string;
    }>(
      `SELECT marker, created_at, updated_at
       FROM hololive_music_marker_keys
       WHERE marker_key IN (${removedMarkerKeys.map(() => "?").join(", ")})
       ORDER BY updated_at DESC
       LIMIT 1`,
      removedMarkerKeys
    )[0];
    if (!markerRow || !this.isHololiveMusicMarker(markerRow.marker)) {
      return;
    }

    const transferMarkers = () => {
      for (const markerKey of this.getHololiveMusicMarkerKeysForVideo(keptId)) {
        this.run(
          `INSERT INTO hololive_music_marker_keys (marker_key, marker, created_at, updated_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(marker_key) DO UPDATE SET
             marker = CASE
               WHEN excluded.updated_at >= hololive_music_marker_keys.updated_at THEN excluded.marker
               ELSE hololive_music_marker_keys.marker
             END,
             updated_at = CASE
               WHEN excluded.updated_at >= hololive_music_marker_keys.updated_at THEN excluded.updated_at
               ELSE hololive_music_marker_keys.updated_at
             END`,
          [markerKey, markerRow.marker, markerRow.created_at, markerRow.updated_at]
        );
      }
      this.run("DELETE FROM hololive_music_marker_keys WHERE marker_key = ?", [`video:${removedId}`]);
    };

    if (this.inTransaction) {
      transferMarkers();
    } else {
      this.transaction(transferMarkers);
    }
  }

  getHololiveMusicStatus(): { latestRun: HololiveMusicRefreshRun | null; totalRows: number } {
    return {
      latestRun: this.selectHololiveMusicRefreshRuns("ORDER BY started_at DESC LIMIT 1")[0] ?? null,
      totalRows: this.scalarCount(
        `SELECT COUNT(*)
         FROM hololive_music_videos v
         WHERE NOT EXISTS (
           SELECT 1 FROM hololive_music_exclusions e WHERE e.youtube_video_id = v.youtube_video_id
         )`
      )
    };
  }

  listHolodexDetailCache(youtubeVideoIds: string[]): Record<string, HolodexVideoDetail> {
    const requestedIds = [...new Set(youtubeVideoIds.map((videoId) => videoId.trim()).filter(Boolean))];
    if (requestedIds.length === 0) {
      return {};
    }

    const rows = this.select<{
      youtube_video_id: string;
      channel_id: string | null;
      duration_seconds: number | null;
      original_channel_id: string | null;
      provided_to_youtube: number;
      song_names_json: string;
      mentions_json?: string | null;
      collab_channel_ids_json?: string | null;
      relationships_loaded?: number | null;
    }>(
      `SELECT youtube_video_id, channel_id, duration_seconds, original_channel_id, provided_to_youtube,
              song_names_json, mentions_json, collab_channel_ids_json, relationships_loaded
       FROM hololive_music_detail_cache
       WHERE youtube_video_id IN (${requestedIds.map(() => "?").join(", ")})`,
      requestedIds
    );
    const details: Record<string, HolodexVideoDetail> = {};

    for (const row of rows) {
      const mentions = this.parseHolodexMentionedChannels(row.mentions_json);
      details[row.youtube_video_id] = {
        youtubeVideoId: row.youtube_video_id,
        channelId: row.channel_id ?? "",
        duration: row.duration_seconds,
        originalChannelId: row.original_channel_id ?? "",
        providedToYoutube: Boolean(row.provided_to_youtube),
        songNames: this.parseJsonStringArray(row.song_names_json),
        channel: null,
        mentions,
        collabChannelIds: this.parseJsonStringArray(row.collab_channel_ids_json),
        relationshipsLoaded: Boolean(row.relationships_loaded)
      };
    }

    return details;
  }

  listHololiveMusicVideoIdsForStats(input: {
    youtubeVideoIds?: string[] | null;
    limit?: number | null;
  } = {}): string[] {
    const where: string[] = [
      "NOT EXISTS (SELECT 1 FROM hololive_music_exclusions e WHERE e.youtube_video_id = v.youtube_video_id)"
    ];
    const params: unknown[] = [];
    const requestedIds = [
      ...new Set((input.youtubeVideoIds ?? []).map((videoId) => videoId.trim()).filter(Boolean))
    ];
    const limit = Math.min(Math.max(Math.round(input.limit ?? 10_000), 1), 50_000);

    if (requestedIds.length > 0) {
      where.push(`v.youtube_video_id IN (${requestedIds.map(() => "?").join(", ")})`);
      params.push(...requestedIds);
    }

    params.push(limit);

    return this.select<{ youtube_video_id: string }>(
      `SELECT v.youtube_video_id
       FROM hololive_music_videos v
       LEFT JOIN hololive_music_video_stats s ON s.youtube_video_id = v.youtube_video_id
       WHERE ${where.join(" AND ")}
       ORDER BY
         CASE WHEN s.fetched_at IS NULL THEN 0 ELSE 1 END ASC,
         COALESCE(s.fetched_at, '') ASC,
         COALESCE(v.published_at, '') DESC,
         v.youtube_video_id ASC
       LIMIT ?`,
      params
    ).map((row) => row.youtube_video_id);
  }

  upsertHololiveMusicVideoStats(
    stats: Array<{ youtubeVideoId: string; viewCount: number; fetchedAt: string }>
  ): void {
    const normalizedStats = stats
      .map((stat) => ({
        youtubeVideoId: stat.youtubeVideoId.trim(),
        viewCount: Math.max(0, Math.trunc(Number(stat.viewCount))),
        fetchedAt: stat.fetchedAt.trim()
      }))
      .filter((stat) => stat.youtubeVideoId && Number.isFinite(stat.viewCount) && stat.fetchedAt);

    if (normalizedStats.length === 0) {
      return;
    }

    this.transaction(() => {
      for (const stat of normalizedStats) {
        this.run(
          `INSERT INTO hololive_music_video_stats (youtube_video_id, view_count, fetched_at)
           VALUES (?, ?, ?)
           ON CONFLICT(youtube_video_id) DO UPDATE SET
             view_count = excluded.view_count,
             fetched_at = excluded.fetched_at`,
          [stat.youtubeVideoId, stat.viewCount, stat.fetchedAt]
        );
      }
    });
  }

  listHololiveMusicLibrary(filters: {
    query?: string | null;
    topicId?: HololiveMusicTopic | null;
    marker?: HololiveMusicMarker | null;
    sort?: HololiveMusicLibrarySort | null;
    talentId?: string | null;
    collabScope?: HololiveMusicLibraryCollabScope | null;
    offset?: number | null;
    limit?: number | null;
  } = {}): HololiveMusicLibraryResponse {
    const where: string[] = [
      "NOT EXISTS (SELECT 1 FROM hololive_music_exclusions e WHERE e.youtube_video_id = v.youtube_video_id)"
    ];
    const params: unknown[] = [];
    const limit = Math.min(Math.max(Math.round(filters.limit ?? 50), 1), 100);
    const offset = Math.max(Math.round(filters.offset ?? 0), 0);
    const sort = filters.sort ?? "newest";

    if (filters.topicId) {
      where.push("v.topic_id = ?");
      params.push(filters.topicId);
    }

    if (filters.talentId?.trim()) {
      const talentId = filters.talentId.trim();
      where.push(
        `(v.idol_id = ?
          OR EXISTS (SELECT 1 FROM json_each(v.participant_idol_ids_json) participant WHERE participant.value = ?)
          OR EXISTS (SELECT 1 FROM json_each(v.owned_idol_ids_json) owned WHERE owned.value = ?)
          OR EXISTS (SELECT 1 FROM json_each(v.featured_idol_ids_json) featured WHERE featured.value = ?))`
      );
      params.push(talentId, talentId, talentId, talentId);
    }

    if (filters.collabScope === "solo") {
      where.push(
        `json_array_length(v.owned_idol_ids_json) = 1
         AND json_array_length(v.featured_idol_ids_json) = 0
         AND json_array_length(v.participant_idol_ids_json) <= 1
         AND COALESCE(c.kind, 'unknown') != 'group'`
      );
    }

    if (filters.query?.trim()) {
      const rawQuery = filters.query.trim();
      const normalizedQuery = rawQuery.toLowerCase();
      const query = `%${rawQuery}%`;
      const idolMatches = HOLOLIVE_IDOLS
        .filter((idol) =>
          `${idol.displayName} ${idol.slug} ${idol.branch} ${idol.generation}`
            .toLowerCase()
            .includes(normalizedQuery)
        )
        .map((idol) => idol.id);
      const idolSearchSql = idolMatches
        .map(
          () =>
            "(v.idol_id = ? OR v.participant_idol_ids_json LIKE ? OR v.owned_idol_ids_json LIKE ? OR v.featured_idol_ids_json LIKE ?)"
        )
        .join(" OR ");
      where.push(
        `(
          v.title LIKE ?
          OR v.song_name LIKE ?
          OR v.channel_name LIKE ?
          OR v.youtube_video_id LIKE ?
          OR v.canonical_song_key LIKE ?
          OR v.canonical_performance_key LIKE ?
          OR v.participants_json LIKE ?
          OR v.owned_idol_ids_json LIKE ?
          OR v.featured_idol_ids_json LIKE ?
          ${idolSearchSql ? `OR ${idolSearchSql}` : ""}
        )`
      );
      params.push(query, query, query, query, query, query, query, query, query);
      for (const idolId of idolMatches) {
        params.push(idolId, `%"${idolId}"%`, `%"${idolId}"%`, `%"${idolId}"%`);
      }
    }

    if (filters.marker) {
      if (!this.isHololiveMusicMarker(filters.marker)) {
        throw new Error(`Unsupported Hololive music marker: ${filters.marker}`);
      }
      where.push("COALESCE(cm.marker, vm.marker) = ?");
      params.push(filters.marker);
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const orderBySql = this.getHololiveMusicLibraryOrderBy(sort);
    const total =
      this.select<{ count: number }>(
        `SELECT COUNT(*) AS count
         FROM hololive_music_videos v
         LEFT JOIN hololive_channels c ON c.id = v.channel_id
         LEFT JOIN hololive_music_marker_keys cm ON cm.marker_key = NULLIF(v.canonical_performance_key, '')
         LEFT JOIN hololive_music_marker_keys vm ON vm.marker_key = 'video:' || v.youtube_video_id
         ${whereSql}`,
        params
      )[0]?.count ?? 0;

    const idRows = this.select<{ youtube_video_id: string }>(
      `SELECT v.youtube_video_id
       FROM hololive_music_videos v
       LEFT JOIN hololive_channels c ON c.id = v.channel_id
       LEFT JOIN hololive_music_video_stats s ON s.youtube_video_id = v.youtube_video_id
       LEFT JOIN hololive_music_marker_keys cm ON cm.marker_key = NULLIF(v.canonical_performance_key, '')
       LEFT JOIN hololive_music_marker_keys vm ON vm.marker_key = 'video:' || v.youtube_video_id
       ${whereSql}
       ${orderBySql}
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    const orderedIds = idRows.map((row) => row.youtube_video_id);
    const rowsById = new Map(
      this.listHololiveMusicRows({ youtubeVideoIds: orderedIds, limit: Math.max(orderedIds.length, 1) }).map((row) => [
        row.youtubeVideoId,
        row
      ])
    );

    return {
      rows: orderedIds.map((id) => rowsById.get(id)).filter((row): row is HololiveMusicRow => Boolean(row)),
      total: Number(total),
      offset,
      limit
    };
  }

  private getHololiveMusicLibraryOrderBy(sort: HololiveMusicLibrarySort): string {
    const titleTieBreak = "COALESCE(v.song_name, v.title) ASC, v.youtube_video_id ASC";
    switch (sort) {
      case "oldest":
        return `ORDER BY
          CASE WHEN NULLIF(v.published_at, '') IS NULL THEN 1 ELSE 0 END ASC,
          COALESCE(v.published_at, '') ASC,
          ${titleTieBreak}`;
      case "views_desc":
        return `ORDER BY
          CASE WHEN s.view_count IS NULL THEN 1 ELSE 0 END ASC,
          s.view_count DESC,
          COALESCE(v.published_at, '') DESC,
          ${titleTieBreak}`;
      case "views_asc":
        return `ORDER BY
          CASE WHEN s.view_count IS NULL THEN 1 ELSE 0 END ASC,
          s.view_count ASC,
          COALESCE(v.published_at, '') DESC,
          ${titleTieBreak}`;
      case "newest":
      default:
        return `ORDER BY COALESCE(v.published_at, '') DESC, ${titleTieBreak}`;
    }
  }

  getHololiveMusicPlayerData(): HololiveMusicPlayerData {
    const playlists = [this.buildHololiveFavoritesPlaylist(), ...this.listHololiveMusicPlaylists()];
    const queue = this.resolveHololiveMusicStoredItems(
      this.select<{
        id: string;
        youtube_video_id: string;
        title_snapshot: string | null;
        source_url_snapshot: string | null;
        position: number;
        added_at: string;
      }>(
        `SELECT id, youtube_video_id, title_snapshot, source_url_snapshot, position, added_at
         FROM hololive_music_queue_items
         ORDER BY position ASC, added_at ASC`
      )
    );
    let state = this.ensureHololiveMusicPlayerState();

    if (state.playbackSourceType === "queue" && state.currentQueueItemId && !queue.some((item) => item.id === state.currentQueueItemId)) {
      state = this.setHololiveMusicPlayerStateRow({
        currentQueueItemId: null,
        currentYoutubeVideoId: null
      });
    }

    if (state.playbackSourceType === "playlist") {
      const playlist = state.currentPlaylistId ? playlists.find((candidate) => candidate.id === state.currentPlaylistId) : null;
      const item = playlist?.items?.find((candidate) => candidate.id === state.currentPlaylistItemId);
      if (!playlist || !item || !item.available) {
        state = this.setHololiveMusicPlayerStateRow({
          playbackSourceType: "library",
          currentQueueItemId: null,
          currentPlaylistId: null,
          currentPlaylistItemId: null,
          currentYoutubeVideoId: null
        });
      }
    }

    if (state.playbackSourceType === "library" && state.currentYoutubeVideoId && !this.resolveHololiveMusicVideoAsPlayerItem(state.currentYoutubeVideoId)) {
      state = this.setHololiveMusicPlayerStateRow({
        currentYoutubeVideoId: null
      });
    }

    const currentItem = this.resolveHololiveCurrentPlayerItem(state, playlists, queue);

    return {
      playlists,
      queue,
      state,
      currentItem
    };
  }

  createHololiveMusicPlaylist(name: string): HololiveMusicPlayerData {
    const playlistName = name.trim();
    if (!playlistName) {
      throw new Error("A playlist name is required");
    }

    const now = new Date().toISOString();
    const id = randomUUID();
    const position =
      (this.select<{ max_position: number | null }>(
        "SELECT MAX(position) AS max_position FROM hololive_music_playlists"
      )[0]?.max_position ?? -1) + 1;

    this.run(
      `INSERT INTO hololive_music_playlists (id, name, position, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      [id, playlistName, position, now, now]
    );

    return this.getHololiveMusicPlayerData();
  }

  updateHololiveMusicPlaylist(input: { playlistId: string; name: string }): HololiveMusicPlayerData {
    const playlistId = input.playlistId.trim();
    const name = input.name.trim();
    if (!playlistId || !name) {
      throw new Error("A playlist id and name are required");
    }
    if (this.isHololiveSystemPlaylistId(playlistId)) {
      throw new Error("System playlists are automatically managed");
    }

    this.assertHololiveMusicPlaylist(playlistId);
    this.run(
      `UPDATE hololive_music_playlists
       SET name = ?, updated_at = ?
       WHERE id = ?`,
      [name, new Date().toISOString(), playlistId]
    );

    return this.getHololiveMusicPlayerData();
  }

  deleteHololiveMusicPlaylist(playlistId: string): HololiveMusicPlayerData {
    const id = playlistId.trim();
    if (!id) {
      throw new Error("A playlist id is required");
    }
    if (this.isHololiveSystemPlaylistId(id)) {
      throw new Error("System playlists are automatically managed");
    }

    this.run("DELETE FROM hololive_music_playlists WHERE id = ?", [id]);
    this.normalizeHololiveMusicPlaylistPositions();
    return this.getHololiveMusicPlayerData();
  }

  reorderHololiveMusicPlaylists(playlistIds: string[]): HololiveMusicPlayerData {
    const orderedIds = [
      ...new Set(playlistIds.map((id) => id.trim()).filter((id) => id && !this.isHololiveSystemPlaylistId(id)))
    ];
    const existingIds = this.select<{ id: string }>("SELECT id FROM hololive_music_playlists ORDER BY position ASC").map(
      (row) => row.id
    );
    const existingSet = new Set(existingIds);
    const nextIds = [...orderedIds.filter((id) => existingSet.has(id)), ...existingIds.filter((id) => !orderedIds.includes(id))];

    this.transaction(() => {
      nextIds.forEach((id, position) => {
        this.run("UPDATE hololive_music_playlists SET position = ?, updated_at = ? WHERE id = ?", [
          position,
          new Date().toISOString(),
          id
        ]);
      });
    });

    return this.getHololiveMusicPlayerData();
  }

  addHololiveMusicPlaylistItem(input: {
    playlistId: string;
    youtubeVideoId: string;
    position?: number | null;
  }): HololiveMusicPlayerData {
    const playlistId = input.playlistId.trim();
    if (this.isHololiveSystemPlaylistId(playlistId)) {
      throw new Error("System playlists are automatically managed");
    }
    this.assertHololiveMusicPlaylist(playlistId);
    const youtubeVideoId = input.youtubeVideoId.trim();
    if (!youtubeVideoId) {
      throw new Error("A YouTube video id is required");
    }
    const existingIds = this.select<{ id: string }>(
      `SELECT id
       FROM hololive_music_playlist_items
       WHERE playlist_id = ? AND youtube_video_id = ?
       ORDER BY position ASC, added_at ASC`,
      [playlistId, youtubeVideoId]
    ).map((row) => row.id);

    const now = new Date().toISOString();

    this.transaction(() => {
      if (existingIds.length > 0) {
        this.run("DELETE FROM hololive_music_playlist_items WHERE playlist_id = ? AND youtube_video_id = ?", [
          playlistId,
          youtubeVideoId
        ]);
        this.normalizeHololiveMusicPlaylistItemPositionsWithinTransaction(playlistId);
        this.touchHololiveMusicPlaylist(playlistId);
        return;
      }

      const snapshot = this.getPlayableHololiveMusicSnapshot(youtubeVideoId);
      const itemId = randomUUID();
      const position = this.prepareHololiveMusicListInsertPosition("hololive_music_playlist_items", input.position, playlistId);
      this.run(
        `INSERT INTO hololive_music_playlist_items
           (id, playlist_id, youtube_video_id, title_snapshot, source_url_snapshot, position, added_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [itemId, playlistId, snapshot.youtubeVideoId, snapshot.title, snapshot.youtubeUrl, position, now]
      );
      this.touchHololiveMusicPlaylist(playlistId);
    });
    return this.getHololiveMusicPlayerData();
  }

  addHololiveMusicPlaylistItems(input: { playlistId: string; youtubeVideoIds: string[] }): HololiveMusicPlayerData {
    const playlistId = input.playlistId.trim();
    if (this.isHololiveSystemPlaylistId(playlistId)) {
      throw new Error("System playlists are automatically managed");
    }
    this.assertHololiveMusicPlaylist(playlistId);
    const youtubeVideoIds = [...new Set(input.youtubeVideoIds.map((videoId) => videoId.trim()).filter(Boolean))];
    if (youtubeVideoIds.length === 0) {
      throw new Error("No songs were selected.");
    }

    const existingVideoIds = new Set(
      this.select<{ youtube_video_id: string }>(
        `SELECT youtube_video_id
         FROM hololive_music_playlist_items
         WHERE playlist_id = ? AND youtube_video_id IN (${youtubeVideoIds.map(() => "?").join(", ")})`,
        [playlistId, ...youtubeVideoIds]
      ).map((row) => row.youtube_video_id)
    );
    const snapshots = youtubeVideoIds
      .filter((videoId) => !existingVideoIds.has(videoId))
      .map((videoId) => this.getPlayableHololiveMusicSnapshot(videoId));
    if (snapshots.length === 0) {
      return this.getHololiveMusicPlayerData();
    }

    const now = new Date().toISOString();
    this.transaction(() => {
      for (const snapshot of snapshots) {
        const position = this.prepareHololiveMusicListInsertPosition("hololive_music_playlist_items", undefined, playlistId);
        this.run(
          `INSERT INTO hololive_music_playlist_items
             (id, playlist_id, youtube_video_id, title_snapshot, source_url_snapshot, position, added_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [randomUUID(), playlistId, snapshot.youtubeVideoId, snapshot.title, snapshot.youtubeUrl, position, now]
        );
      }
      this.touchHololiveMusicPlaylist(playlistId);
    });

    return this.getHololiveMusicPlayerData();
  }

  removeHololiveMusicPlaylistItem(itemId: string): HololiveMusicPlayerData {
    const id = itemId.trim();
    if (!id) {
      throw new Error("A playlist item id is required");
    }
    if (id.startsWith(`${HOLOLIVE_FAVORITES_PLAYLIST_ID}:`)) {
      throw new Error("System playlist items are automatically managed");
    }

    const itemSnapshot = this.selectTableRows("hololive_music_playlist_items", "WHERE id = ?", [id])[0];
    const playlistId = String(itemSnapshot?.playlist_id ?? "");
    this.run("DELETE FROM hololive_music_playlist_items WHERE id = ?", [id]);
    if (playlistId) {
      this.normalizeHololiveMusicPlaylistItemPositions(playlistId);
      this.touchHololiveMusicPlaylist(playlistId);
    }
    if (itemSnapshot) {
      this.registerHololiveUndoAction("playlist-item-remove", "Restore playlist item", () => {
        this.restoreHololiveMusicPlaylistItemSnapshot(itemSnapshot);
      });
    }
    return this.getHololiveMusicPlayerData();
  }

  reorderHololiveMusicPlaylistItems(input: { playlistId: string; itemIds: string[] }): HololiveMusicPlayerData {
    const playlistId = input.playlistId.trim();
    if (this.isHololiveSystemPlaylistId(playlistId)) {
      return this.reorderHololiveFavoritePlaylistItems(input.itemIds);
    }
    this.assertHololiveMusicPlaylist(playlistId);
    this.reorderHololiveMusicPositionedItems("hololive_music_playlist_items", input.itemIds, playlistId);
    this.touchHololiveMusicPlaylist(playlistId);
    return this.getHololiveMusicPlayerData();
  }

  playHololiveMusicPlaylist(input: { playlistId: string; itemId?: string | null }): HololiveMusicPlayerData {
    const playlistId = input.playlistId.trim();
    if (!playlistId) {
      throw new Error("A playlist id is required");
    }

    const playlist = this.getHololiveMusicPlayerData().playlists.find((candidate) => candidate.id === playlistId);
    if (!playlist) {
      throw new Error(`Unknown Hololive music playlist: ${playlistId}`);
    }

    const requestedItemId = input.itemId?.trim() || null;
    const item =
      (requestedItemId ? playlist.items?.find((candidate) => candidate.id === requestedItemId) : null) ??
      playlist.items?.find((candidate) => candidate.available);
    if (!item?.available) {
      throw new Error("This playlist has no playable songs");
    }

    this.setHololiveMusicPlayerStateRow({
      playbackSourceType: "playlist",
      currentQueueItemId: null,
      currentPlaylistId: playlist.id,
      currentPlaylistItemId: item.id,
      currentYoutubeVideoId: item.youtubeVideoId
    });

    return this.getHololiveMusicPlayerData();
  }

  playHololiveMusicVideo(youtubeVideoId: string): HololiveMusicPlayerData {
    const snapshot = this.getPlayableHololiveMusicSnapshot(youtubeVideoId);
    this.setHololiveMusicPlayerStateRow({
      playbackSourceType: "library",
      currentQueueItemId: null,
      currentPlaylistId: null,
      currentPlaylistItemId: null,
      currentYoutubeVideoId: snapshot.youtubeVideoId
    });

    return this.getHololiveMusicPlayerData();
  }

  addHololiveMusicQueueItem(input: {
    youtubeVideoId: string;
    placement: "now" | "next" | "end";
  }): HololiveMusicPlayerData {
    const snapshot = this.getPlayableHololiveMusicSnapshot(input.youtubeVideoId);
    const currentState = this.ensureHololiveMusicPlayerState();
    const currentPosition = currentState.currentQueueItemId
      ? this.select<{ position: number }>("SELECT position FROM hololive_music_queue_items WHERE id = ?", [
          currentState.currentQueueItemId
        ])[0]?.position
      : null;
    const position =
      input.placement === "now"
        ? currentPosition ?? 0
        : input.placement === "next" && currentPosition !== null && currentPosition !== undefined
          ? currentPosition + 1
          : this.nextHololiveMusicQueuePosition();
    const itemId = randomUUID();
    const now = new Date().toISOString();

    this.transaction(() => {
      this.shiftHololiveMusicQueuePositions(position);
      this.run(
        `INSERT INTO hololive_music_queue_items
           (id, youtube_video_id, title_snapshot, source_url_snapshot, position, added_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [itemId, snapshot.youtubeVideoId, snapshot.title, snapshot.youtubeUrl, position, now]
      );

      if (input.placement === "now") {
        this.setHololiveMusicPlayerStateRow({
          playbackSourceType: "queue",
          currentQueueItemId: itemId,
          currentPlaylistId: null,
          currentPlaylistItemId: null,
          currentYoutubeVideoId: snapshot.youtubeVideoId
        });
      }
    });

    this.normalizeHololiveMusicQueuePositions();
    return this.getHololiveMusicPlayerData();
  }

  addHololiveMusicQueueItems(input: {
    youtubeVideoIds: string[];
    placement: "now" | "next" | "end";
  }): HololiveMusicPlayerData {
    const snapshots = input.youtubeVideoIds
      .map((videoId) => videoId.trim())
      .filter(Boolean)
      .map((videoId) => this.getPlayableHololiveMusicSnapshot(videoId));
    if (snapshots.length === 0) {
      throw new Error("No songs were selected.");
    }

    const currentState = this.ensureHololiveMusicPlayerState();
    const currentPosition = currentState.currentQueueItemId
      ? this.select<{ position: number }>("SELECT position FROM hololive_music_queue_items WHERE id = ?", [
          currentState.currentQueueItemId
        ])[0]?.position
      : null;
    const position =
      input.placement === "now"
        ? currentPosition ?? 0
        : input.placement === "next" && currentPosition !== null && currentPosition !== undefined
          ? currentPosition + 1
          : this.nextHololiveMusicQueuePosition();
    const now = new Date().toISOString();
    const itemIds = snapshots.map(() => randomUUID());

    this.transaction(() => {
      this.run("UPDATE hololive_music_queue_items SET position = position + ? WHERE position >= ?", [
        snapshots.length,
        position
      ]);
      snapshots.forEach((snapshot, index) => {
        this.run(
          `INSERT INTO hololive_music_queue_items
             (id, youtube_video_id, title_snapshot, source_url_snapshot, position, added_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [itemIds[index], snapshot.youtubeVideoId, snapshot.title, snapshot.youtubeUrl, position + index, now]
        );
      });

      if (input.placement === "now") {
        this.setHololiveMusicPlayerStateRow({
          playbackSourceType: "queue",
          currentQueueItemId: itemIds[0],
          currentPlaylistId: null,
          currentPlaylistItemId: null,
          currentYoutubeVideoId: snapshots[0]?.youtubeVideoId ?? null
        });
      }
    });

    this.normalizeHololiveMusicQueuePositions();
    return this.getHololiveMusicPlayerData();
  }

  playHololiveMusicVisibleVideos(youtubeVideoIds: string[]): HololiveMusicPlayerData {
    return this.addHololiveMusicQueueItems({ youtubeVideoIds, placement: "now" });
  }

  removeHololiveMusicQueueItem(itemId: string): HololiveMusicPlayerData {
    const id = itemId.trim();
    if (!id) {
      throw new Error("A queue item id is required");
    }

    const state = this.ensureHololiveMusicPlayerState();
    const itemSnapshot = this.selectTableRows("hololive_music_queue_items", "WHERE id = ?", [id])[0];
    const playerStateSnapshot = this.selectTableRows("hololive_music_player_state", "WHERE id = 'hololive'");
    this.run("DELETE FROM hololive_music_queue_items WHERE id = ?", [id]);
    this.normalizeHololiveMusicQueuePositions();

    if (state.currentQueueItemId === id) {
      const next = this.select<{ id: string; youtube_video_id: string }>(
        `SELECT id, youtube_video_id
         FROM hololive_music_queue_items
         ORDER BY position ASC, added_at ASC
         LIMIT 1`
      )[0];
      this.setHololiveMusicPlayerStateRow({
        playbackSourceType: "queue",
        currentQueueItemId: next?.id ?? null,
        currentPlaylistId: null,
        currentPlaylistItemId: null,
        currentYoutubeVideoId: next?.youtube_video_id ?? null
      });
    }

    if (itemSnapshot) {
      this.registerHololiveUndoAction("queue-item-remove", "Restore queue item", () => {
        this.restoreHololiveMusicQueueItemSnapshot(itemSnapshot);
        if (state.currentQueueItemId === id) {
          this.insertOrReplaceRows("hololive_music_player_state", playerStateSnapshot);
        }
      });
    }

    return this.getHololiveMusicPlayerData();
  }

  reorderHololiveMusicQueueItems(itemIds: string[]): HololiveMusicPlayerData {
    this.reorderHololiveMusicPositionedItems("hololive_music_queue_items", itemIds, null);
    return this.getHololiveMusicPlayerData();
  }

  clearHololiveMusicQueue(): HololiveMusicPlayerData {
    this.transaction(() => {
      const state = this.ensureHololiveMusicPlayerState();
      this.run("DELETE FROM hololive_music_queue_items");
      if (state.playbackSourceType === "queue") {
        this.setHololiveMusicPlayerStateRow({
          playbackSourceType: "library",
          currentQueueItemId: null,
          currentPlaylistId: null,
          currentPlaylistItemId: null,
          currentYoutubeVideoId: null
        });
      }
    });
    return this.getHololiveMusicPlayerData();
  }

  saveHololiveMusicQueueAsPlaylist(name: string): HololiveMusicPlayerData {
    const playlistName = name.trim();
    if (!playlistName) {
      throw new Error("A playlist name is required");
    }

    const queueItems = this.select<{
      youtube_video_id: string;
      title_snapshot: string | null;
      source_url_snapshot: string | null;
    }>(
      `SELECT youtube_video_id, title_snapshot, source_url_snapshot
       FROM hololive_music_queue_items
       ORDER BY position ASC, added_at ASC`
    );
    if (queueItems.length === 0) {
      throw new Error("The queue is empty");
    }
    const uniqueQueueItems = queueItems.filter(
      (item, index, items) => items.findIndex((candidate) => candidate.youtube_video_id === item.youtube_video_id) === index
    );

    const playlistId = randomUUID();
    const now = new Date().toISOString();
    const position =
      (this.select<{ max_position: number | null }>(
        "SELECT MAX(position) AS max_position FROM hololive_music_playlists"
      )[0]?.max_position ?? -1) + 1;

    this.transaction(() => {
      this.run(
        `INSERT INTO hololive_music_playlists (id, name, position, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
        [playlistId, playlistName, position, now, now]
      );
      uniqueQueueItems.forEach((item, itemPosition) => {
        this.run(
          `INSERT INTO hololive_music_playlist_items
             (id, playlist_id, youtube_video_id, title_snapshot, source_url_snapshot, position, added_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            randomUUID(),
            playlistId,
            item.youtube_video_id,
            item.title_snapshot,
            item.source_url_snapshot,
            itemPosition,
            now
          ]
        );
      });
    });

    return this.getHololiveMusicPlayerData();
  }

  updateHololiveMusicPlayerState(input: {
    playbackSourceType?: HololiveMusicPlaybackSource | null;
    currentQueueItemId?: string | null;
    currentPlaylistId?: string | null;
    currentPlaylistItemId?: string | null;
    currentYoutubeVideoId?: string | null;
    repeatMode?: HololiveMusicRepeatMode | null;
    shuffleEnabled?: boolean | null;
    autoplayEnabled?: boolean | null;
  }): HololiveMusicPlayerData {
    if (input.repeatMode && !this.isHololiveMusicRepeatMode(input.repeatMode)) {
      throw new Error(`Unsupported repeat mode: ${input.repeatMode}`);
    }
    if (input.playbackSourceType && !this.isHololiveMusicPlaybackSource(input.playbackSourceType)) {
      throw new Error(`Unsupported playback source: ${input.playbackSourceType}`);
    }

    this.setHololiveMusicPlayerStateRow(input);
    return this.getHololiveMusicPlayerData();
  }

  private isHololiveMusicRepeatMode(value: unknown): value is HololiveMusicRepeatMode {
    return value === "off" || value === "all" || value === "one";
  }

  private isHololiveMusicPlaybackSource(value: unknown): value is HololiveMusicPlaybackSource {
    return value === "queue" || value === "playlist" || value === "library";
  }

  private ensureHololiveMusicPlayerState(): HololiveMusicPlayerData["state"] {
    const now = new Date().toISOString();
    const existing = this.select<{
      current_queue_item_id: string | null;
      current_playlist_id: string | null;
      current_playlist_item_id: string | null;
      current_youtube_video_id: string | null;
      playback_source_type: HololiveMusicPlaybackSource;
      repeat_mode: HololiveMusicRepeatMode;
      shuffle_enabled: number;
      autoplay_enabled: number;
      updated_at: string;
    }>(
      `SELECT playback_source_type, current_queue_item_id, current_playlist_id, current_playlist_item_id,
              current_youtube_video_id, repeat_mode, shuffle_enabled, autoplay_enabled, updated_at
       FROM hololive_music_player_state
       WHERE id = 'hololive'`
    )[0];

    if (!existing) {
      this.run(
        `INSERT INTO hololive_music_player_state
           (id, playback_source_type, current_queue_item_id, current_playlist_id, current_playlist_item_id,
            current_youtube_video_id, repeat_mode, shuffle_enabled, autoplay_enabled, updated_at)
         VALUES ('hololive', 'library', NULL, NULL, NULL, NULL, 'off', 0, 1, ?)`,
        [now]
      );
      return {
        playbackSourceType: "library",
        currentQueueItemId: null,
        currentPlaylistId: null,
        currentPlaylistItemId: null,
        currentYoutubeVideoId: null,
        repeatMode: "off",
        shuffleEnabled: false,
        autoplayEnabled: true,
        updatedAt: now
      };
    }

    return {
      playbackSourceType: this.isHololiveMusicPlaybackSource(existing.playback_source_type)
        ? existing.playback_source_type
        : "library",
      currentQueueItemId: existing.current_queue_item_id,
      currentPlaylistId: existing.current_playlist_id,
      currentPlaylistItemId: existing.current_playlist_item_id,
      currentYoutubeVideoId: existing.current_youtube_video_id,
      repeatMode: this.isHololiveMusicRepeatMode(existing.repeat_mode) ? existing.repeat_mode : "off",
      shuffleEnabled: Number(existing.shuffle_enabled) === 1,
      autoplayEnabled: Number(existing.autoplay_enabled) === 1,
      updatedAt: existing.updated_at
    };
  }

  private setHololiveMusicPlayerStateRow(input: {
    playbackSourceType?: HololiveMusicPlaybackSource | null;
    currentQueueItemId?: string | null;
    currentPlaylistId?: string | null;
    currentPlaylistItemId?: string | null;
    currentYoutubeVideoId?: string | null;
    repeatMode?: HololiveMusicRepeatMode | null;
    shuffleEnabled?: boolean | null;
    autoplayEnabled?: boolean | null;
  }): HololiveMusicPlayerData["state"] {
    const current = this.ensureHololiveMusicPlayerState();
    const next = {
      playbackSourceType: input.playbackSourceType ?? current.playbackSourceType,
      currentQueueItemId:
        input.currentQueueItemId === undefined ? current.currentQueueItemId ?? null : input.currentQueueItemId ?? null,
      currentPlaylistId:
        input.currentPlaylistId === undefined ? current.currentPlaylistId ?? null : input.currentPlaylistId ?? null,
      currentPlaylistItemId:
        input.currentPlaylistItemId === undefined ? current.currentPlaylistItemId ?? null : input.currentPlaylistItemId ?? null,
      currentYoutubeVideoId:
        input.currentYoutubeVideoId === undefined
          ? current.currentYoutubeVideoId ?? null
          : input.currentYoutubeVideoId ?? null,
      repeatMode: input.repeatMode ?? current.repeatMode,
      shuffleEnabled: input.shuffleEnabled ?? current.shuffleEnabled,
      autoplayEnabled: input.autoplayEnabled ?? current.autoplayEnabled
    };
    if (!this.isHololiveMusicRepeatMode(next.repeatMode)) {
      throw new Error(`Unsupported repeat mode: ${next.repeatMode}`);
    }
    if (!this.isHololiveMusicPlaybackSource(next.playbackSourceType)) {
      throw new Error(`Unsupported playback source: ${next.playbackSourceType}`);
    }

    const now = new Date().toISOString();
    this.run(
      `INSERT INTO hololive_music_player_state
         (id, playback_source_type, current_queue_item_id, current_playlist_id, current_playlist_item_id,
          current_youtube_video_id, repeat_mode, shuffle_enabled, autoplay_enabled, updated_at)
       VALUES ('hololive', ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         playback_source_type = excluded.playback_source_type,
         current_queue_item_id = excluded.current_queue_item_id,
         current_playlist_id = excluded.current_playlist_id,
         current_playlist_item_id = excluded.current_playlist_item_id,
         current_youtube_video_id = excluded.current_youtube_video_id,
         repeat_mode = excluded.repeat_mode,
         shuffle_enabled = excluded.shuffle_enabled,
         autoplay_enabled = excluded.autoplay_enabled,
         updated_at = excluded.updated_at`,
      [
        next.playbackSourceType,
        next.currentQueueItemId,
        next.currentPlaylistId,
        next.currentPlaylistItemId,
        next.currentYoutubeVideoId,
        next.repeatMode,
        next.shuffleEnabled ? 1 : 0,
        next.autoplayEnabled ? 1 : 0,
        now
      ]
    );

    return {
      ...next,
      updatedAt: now
    };
  }

  private resolveHololiveMusicVideoAsPlayerItem(youtubeVideoId?: string | null): HololiveMusicResolvedItem | null {
    const id = youtubeVideoId?.trim();
    if (!id) {
      return null;
    }

    const music = this.listHololiveMusicRows({ youtubeVideoIds: [id], limit: 1 })[0] ?? null;
    if (!music) {
      return null;
    }

    return {
      id: `library:${music.youtubeVideoId}`,
      youtubeVideoId: music.youtubeVideoId,
      position: 0,
      titleSnapshot: music.songName || music.title,
      sourceUrlSnapshot: music.youtubeUrl,
      addedAt: music.updatedAt,
      available: true,
      music
    };
  }

  private resolveHololiveCurrentPlayerItem(
    state: HololiveMusicPlayerData["state"],
    playlists: HololiveMusicPlaylist[],
    queue: HololiveMusicResolvedItem[]
  ): HololiveMusicResolvedItem | null {
    if (state.playbackSourceType === "queue") {
      return state.currentQueueItemId
        ? queue.find((item) => item.id === state.currentQueueItemId) ?? null
        : null;
    }

    if (state.playbackSourceType === "playlist") {
      const playlist = state.currentPlaylistId
        ? playlists.find((candidate) => candidate.id === state.currentPlaylistId)
        : null;
      return state.currentPlaylistItemId
        ? playlist?.items?.find((item) => item.id === state.currentPlaylistItemId) ?? null
        : null;
    }

    return this.resolveHololiveMusicVideoAsPlayerItem(state.currentYoutubeVideoId);
  }

  private listHololiveMusicPlaylists(): HololiveMusicPlaylist[] {
    const playlists = this.select<{
      id: string;
      name: string;
      position: number;
      created_at: string;
      updated_at: string;
      item_count: number;
    }>(
      `SELECT p.id, p.name, p.position, p.created_at, p.updated_at,
              COUNT(i.id) AS item_count
       FROM hololive_music_playlists p
       LEFT JOIN hololive_music_playlist_items i ON i.playlist_id = p.id
       GROUP BY p.id
       ORDER BY p.position ASC, p.created_at ASC`
    );
    if (playlists.length === 0) {
      return [];
    }

    const playlistIds = playlists.map((playlist) => playlist.id);
    const playlistItemRows = this.select<{
      playlist_id: string;
      id: string;
      youtube_video_id: string;
      title_snapshot: string | null;
      source_url_snapshot: string | null;
      position: number;
      added_at: string;
    }>(
      `SELECT playlist_id, id, youtube_video_id, title_snapshot, source_url_snapshot, position, added_at
       FROM hololive_music_playlist_items
       WHERE playlist_id IN (${playlistIds.map(() => "?").join(", ")})
       ORDER BY playlist_id ASC, position ASC, added_at ASC`,
      playlistIds
    );
    const resolvedItems = this.resolveHololiveMusicStoredItems(playlistItemRows);
    const itemsByPlaylistId = new Map<string, HololiveMusicResolvedItem[]>();
    playlistItemRows.forEach((row, index) => {
      const items = itemsByPlaylistId.get(row.playlist_id) ?? [];
      items.push(resolvedItems[index]);
      itemsByPlaylistId.set(row.playlist_id, items);
    });

    return playlists.map((playlist) => ({
      id: playlist.id,
      name: playlist.name,
      position: Number(playlist.position),
      itemCount: Number(playlist.item_count),
      systemId: null,
      createdAt: playlist.created_at,
      updatedAt: playlist.updated_at,
      items: itemsByPlaylistId.get(playlist.id) ?? []
    }));
  }

  private buildHololiveFavoritesPlaylist(): HololiveMusicPlaylist {
    const favoriteRows = this.select<{
      youtube_video_id: string;
      title: string;
      title_snapshot: string | null;
      source_url_snapshot: string | null;
      canonical_performance_key: string | null;
      provided_to_youtube: number | null;
      duration_seconds: number | null;
      marker_updated_at: string | null;
      favorite_position: number | null;
      published_at: string | null;
      updated_at: string;
    }>(
      `SELECT v.youtube_video_id,
              v.title,
              COALESCE(v.song_name, v.title) AS title_snapshot,
              v.youtube_url AS source_url_snapshot,
              v.canonical_performance_key,
              v.provided_to_youtube,
              v.duration_seconds,
              COALESCE(cm.updated_at, vm.updated_at) AS marker_updated_at,
              COALESCE(cm.favorite_position, vm.favorite_position) AS favorite_position,
              v.published_at,
              v.updated_at
       FROM hololive_music_videos v
       LEFT JOIN hololive_music_marker_keys cm ON cm.marker_key = NULLIF(v.canonical_performance_key, '')
       LEFT JOIN hololive_music_marker_keys vm ON vm.marker_key = 'video:' || v.youtube_video_id
       WHERE COALESCE(cm.marker, vm.marker) = 'favorite'
         AND NOT EXISTS (
           SELECT 1 FROM hololive_music_exclusions e WHERE e.youtube_video_id = v.youtube_video_id
         )
       ORDER BY CASE WHEN COALESCE(cm.favorite_position, vm.favorite_position) IS NULL THEN 1 ELSE 0 END ASC,
                COALESCE(cm.favorite_position, vm.favorite_position) ASC,
                COALESCE(cm.updated_at, vm.updated_at, v.published_at, v.updated_at) DESC,
                COALESCE(v.published_at, '') DESC,
                COALESCE(v.song_name, v.title) ASC`
    );
    const dedupedRows = this.dedupeHololiveMusicRowsByCanonicalPerformancePreserveOrder(favoriteRows);
    const storedRows = dedupedRows.map((row, position) => ({
      id: `${HOLOLIVE_FAVORITES_PLAYLIST_ID}:${row.youtube_video_id}`,
      youtube_video_id: row.youtube_video_id,
      title_snapshot: row.title_snapshot,
      source_url_snapshot: row.source_url_snapshot,
      position,
      added_at: row.marker_updated_at ?? row.published_at ?? row.updated_at
    }));
    const items = this.resolveHololiveMusicStoredItems(storedRows);
    const updatedAt = dedupedRows[0]?.marker_updated_at ?? dedupedRows[0]?.updated_at ?? new Date().toISOString();

    return {
      id: HOLOLIVE_FAVORITES_PLAYLIST_ID,
      name: "Favorites",
      position: -1,
      itemCount: items.length,
      systemId: "favorites",
      createdAt: updatedAt,
      updatedAt,
      items
    };
  }

  private isHololiveSystemPlaylistId(playlistId: string): boolean {
    return playlistId === HOLOLIVE_FAVORITES_PLAYLIST_ID;
  }

  private resolveHololiveMusicStoredItems(
    rows: Array<{
      id: string;
      youtube_video_id: string;
      title_snapshot: string | null;
      source_url_snapshot: string | null;
      position: number;
      added_at: string;
    }>
  ): HololiveMusicResolvedItem[] {
    const youtubeVideoIds = [...new Set(rows.map((row) => row.youtube_video_id).filter(Boolean))];
    const musicRowsById = new Map(
      this.listHololiveMusicRows({ youtubeVideoIds, limit: Math.max(youtubeVideoIds.length, 1) }).map((row) => [
        row.youtubeVideoId,
        row
      ])
    );

    return rows.map((row) => {
      const music = musicRowsById.get(row.youtube_video_id) ?? null;
      return {
        id: row.id,
        youtubeVideoId: row.youtube_video_id,
        position: Number(row.position),
        titleSnapshot: row.title_snapshot,
        sourceUrlSnapshot: row.source_url_snapshot,
        addedAt: row.added_at,
        available: Boolean(music),
        music
      };
    });
  }

  private getPlayableHololiveMusicSnapshot(youtubeVideoId: string): Pick<HololiveMusicRow, "youtubeVideoId" | "title" | "songName" | "youtubeUrl"> & {
    title: string;
  } {
    const id = youtubeVideoId.trim();
    if (!id) {
      throw new Error("A YouTube video ID is required");
    }
    if (this.getHololiveMusicExclusionSet().has(id)) {
      throw new Error("This song is excluded");
    }

    const row = this.listHololiveMusicRows({ youtubeVideoIds: [id], limit: 1 })[0];
    if (!row) {
      throw new Error("This song is not in the Hololive music database");
    }

    return {
      youtubeVideoId: row.youtubeVideoId,
      title: row.songName || row.title,
      songName: row.songName,
      youtubeUrl: row.youtubeUrl
    };
  }

  private assertHololiveMusicPlaylist(playlistId: string): void {
    const exists = this.select<{ id: string }>("SELECT id FROM hololive_music_playlists WHERE id = ?", [playlistId])[0];
    if (!exists) {
      throw new Error(`Unknown Hololive music playlist: ${playlistId}`);
    }
  }

  private touchHololiveMusicPlaylist(playlistId: string): void {
    this.run("UPDATE hololive_music_playlists SET updated_at = ? WHERE id = ?", [new Date().toISOString(), playlistId]);
  }

  private prepareHololiveMusicListInsertPosition(tableName: string, requestedPosition?: number | null, playlistId?: string | null): number {
    const where = playlistId ? "WHERE playlist_id = ?" : "";
    const params = playlistId ? [playlistId] : [];
    const count = this.select<{ count: number }>(`SELECT COUNT(*) AS count FROM ${tableName} ${where}`, params)[0]?.count ?? 0;
    const position =
      requestedPosition === null || requestedPosition === undefined
        ? count
        : Math.min(Math.max(Math.round(requestedPosition), 0), count);
    const shiftWhere = playlistId ? "playlist_id = ? AND position >= ?" : "position >= ?";
    const shiftParams = playlistId ? [playlistId, position] : [position];

    this.run(`UPDATE ${tableName} SET position = position + 1 WHERE ${shiftWhere}`, shiftParams);
    return position;
  }

  private restoreHololiveMusicPlaylistItemSnapshot(row: DatabaseRowSnapshot): void {
    const id = String(row.id ?? "").trim();
    const playlistId = String(row.playlist_id ?? "").trim();
    if (!id || !playlistId || this.select<{ id: string }>("SELECT id FROM hololive_music_playlist_items WHERE id = ?", [id])[0]) {
      return;
    }

    this.assertHololiveMusicPlaylist(playlistId);
    const count =
      this.select<{ count: number }>("SELECT COUNT(*) AS count FROM hololive_music_playlist_items WHERE playlist_id = ?", [
        playlistId
      ])[0]?.count ?? 0;
    const position = Math.min(Math.max(Math.round(Number(row.position ?? count)), 0), count);
    this.run("UPDATE hololive_music_playlist_items SET position = position + 1 WHERE playlist_id = ? AND position >= ?", [
      playlistId,
      position
    ]);
    this.insertOrReplaceRows("hololive_music_playlist_items", [{ ...row, position }]);
    this.touchHololiveMusicPlaylist(playlistId);
  }

  private restoreHololiveMusicQueueItemSnapshot(row: DatabaseRowSnapshot): void {
    const id = String(row.id ?? "").trim();
    if (!id || this.select<{ id: string }>("SELECT id FROM hololive_music_queue_items WHERE id = ?", [id])[0]) {
      return;
    }

    const count = this.select<{ count: number }>("SELECT COUNT(*) AS count FROM hololive_music_queue_items")[0]?.count ?? 0;
    const position = Math.min(Math.max(Math.round(Number(row.position ?? count)), 0), count);
    this.shiftHololiveMusicQueuePositions(position);
    this.insertOrReplaceRows("hololive_music_queue_items", [{ ...row, position }]);
    this.normalizeHololiveMusicQueuePositionsWithinTransaction();
  }

  private nextHololiveMusicQueuePosition(): number {
    return (
      (this.select<{ max_position: number | null }>(
        "SELECT MAX(position) AS max_position FROM hololive_music_queue_items"
      )[0]?.max_position ?? -1) + 1
    );
  }

  private shiftHololiveMusicQueuePositions(position: number): void {
    this.run("UPDATE hololive_music_queue_items SET position = position + 1 WHERE position >= ?", [position]);
  }

  private reorderHololiveMusicPositionedItems(
    tableName: "hololive_music_playlist_items" | "hololive_music_queue_items",
    itemIds: string[],
    playlistId: string | null
  ): void {
    const orderedIds = [...new Set(itemIds.map((id) => id.trim()).filter(Boolean))];
    const where = playlistId ? "WHERE playlist_id = ?" : "";
    const params = playlistId ? [playlistId] : [];
    const existingIds = this.select<{ id: string }>(
      `SELECT id FROM ${tableName} ${where} ORDER BY position ASC, added_at ASC`,
      params
    ).map((row) => row.id);
    const existingSet = new Set(existingIds);
    const nextIds = [...orderedIds.filter((id) => existingSet.has(id)), ...existingIds.filter((id) => !orderedIds.includes(id))];

    this.transaction(() => {
      nextIds.forEach((id, position) => {
        this.run(`UPDATE ${tableName} SET position = ? WHERE id = ?`, [position, id]);
      });
    });
  }

  private reorderHololiveFavoritePlaylistItems(itemIds: string[]): HololiveMusicPlayerData {
    const orderedVideoIds = [
      ...new Set(
        itemIds
          .map((id) => id.trim())
          .filter(Boolean)
          .map((id) => (id.startsWith(`${HOLOLIVE_FAVORITES_PLAYLIST_ID}:`) ? id.slice(HOLOLIVE_FAVORITES_PLAYLIST_ID.length + 1) : id))
      )
    ];
    const rows = this.select<{
      youtube_video_id: string;
      marker_key: string | null;
      favorite_position: number | null;
      marker_updated_at: string | null;
      published_at: string | null;
      updated_at: string;
      title: string;
    }>(
      `SELECT v.youtube_video_id,
              COALESCE(cm.marker_key, vm.marker_key) AS marker_key,
              COALESCE(cm.favorite_position, vm.favorite_position) AS favorite_position,
              COALESCE(cm.updated_at, vm.updated_at) AS marker_updated_at,
              v.published_at,
              v.updated_at,
              COALESCE(v.song_name, v.title) AS title
       FROM hololive_music_videos v
       LEFT JOIN hololive_music_marker_keys cm ON cm.marker_key = NULLIF(v.canonical_performance_key, '')
       LEFT JOIN hololive_music_marker_keys vm ON vm.marker_key = 'video:' || v.youtube_video_id
       WHERE COALESCE(cm.marker, vm.marker) = 'favorite'
         AND NOT EXISTS (
           SELECT 1 FROM hololive_music_exclusions e WHERE e.youtube_video_id = v.youtube_video_id
         )
       ORDER BY CASE WHEN COALESCE(cm.favorite_position, vm.favorite_position) IS NULL THEN 1 ELSE 0 END ASC,
                COALESCE(cm.favorite_position, vm.favorite_position) ASC,
                COALESCE(cm.updated_at, vm.updated_at, v.published_at, v.updated_at) DESC,
                COALESCE(v.published_at, '') DESC,
                COALESCE(v.song_name, v.title) ASC`
    );
    const rowsByVideoId = new Map(rows.map((row) => [row.youtube_video_id, row]));
    const nextVideoIds = [
      ...orderedVideoIds.filter((id) => rowsByVideoId.has(id)),
      ...rows.map((row) => row.youtube_video_id).filter((id) => !orderedVideoIds.includes(id))
    ];

    this.transaction(() => {
      nextVideoIds.forEach((videoId, position) => {
        const markerKey = rowsByVideoId.get(videoId)?.marker_key;
        if (!markerKey) {
          return;
        }
        this.run("UPDATE hololive_music_marker_keys SET favorite_position = ? WHERE marker_key = ?", [
          position,
          markerKey
        ]);
      });
    });

    return this.getHololiveMusicPlayerData();
  }

  private normalizeHololiveMusicPlaylistPositions(): void {
    const ids = this.select<{ id: string }>("SELECT id FROM hololive_music_playlists ORDER BY position ASC, created_at ASC").map(
      (row) => row.id
    );
    this.transaction(() => {
      ids.forEach((id, position) => {
        this.run("UPDATE hololive_music_playlists SET position = ? WHERE id = ?", [position, id]);
      });
    });
  }

  private normalizeHololiveMusicPlaylistItemPositions(playlistId: string): void {
    this.transaction(() => {
      this.normalizeHololiveMusicPlaylistItemPositionsWithinTransaction(playlistId);
    });
  }

  private normalizeHololiveMusicPlaylistItemPositionsWithinTransaction(playlistId: string): void {
    const ids = this.select<{ id: string }>(
      `SELECT id FROM hololive_music_playlist_items
       WHERE playlist_id = ?
       ORDER BY position ASC, added_at ASC`,
      [playlistId]
    ).map((row) => row.id);
    ids.forEach((id, position) => {
      this.run("UPDATE hololive_music_playlist_items SET position = ? WHERE id = ?", [position, id]);
    });
  }

  private normalizeAllHololiveMusicPlaylistItemPositions(): void {
    const playlistIds = this.select<{ playlist_id: string }>(
      "SELECT DISTINCT playlist_id FROM hololive_music_playlist_items ORDER BY playlist_id"
    ).map((row) => row.playlist_id);
    for (const playlistId of playlistIds) {
      this.normalizeHololiveMusicPlaylistItemPositions(playlistId);
    }
  }

  private normalizeHololiveMusicQueuePositions(): void {
    this.transaction(() => {
      this.normalizeHololiveMusicQueuePositionsWithinTransaction();
    });
  }

  private normalizeHololiveMusicQueuePositionsWithinTransaction(): void {
    const ids = this.select<{ id: string }>(
      "SELECT id FROM hololive_music_queue_items ORDER BY position ASC, added_at ASC"
    ).map((row) => row.id);
    ids.forEach((id, position) => {
      this.run("UPDATE hololive_music_queue_items SET position = ? WHERE id = ?", [position, id]);
    });
  }

  private dedupeHololiveMusicRowsByCanonicalPerformance<
    T extends {
      youtube_video_id: string;
      title: string;
      canonical_performance_key: string | null;
      provided_to_youtube: number | null;
      duration_seconds: number | null;
      published_at: string | null;
    }
  >(rows: T[]): T[] {
    const bestByKey = new Map<string, T>();

    for (const row of rows) {
      const key = row.canonical_performance_key?.trim() || `video:${row.youtube_video_id}`;
      const existing = bestByKey.get(key);
      if (!existing || this.compareHololiveMusicDisplayRow(row, existing) > 0) {
        bestByKey.set(key, row);
      }
    }

    return [...bestByKey.values()].sort((left, right) => {
      const leftPublished = left.published_at ?? "";
      const rightPublished = right.published_at ?? "";
      return rightPublished.localeCompare(leftPublished) || left.title.localeCompare(right.title);
    });
  }

  private compareHololiveMusicDisplayRow(
    left: {
      youtube_video_id: string;
      title: string;
      song_name?: string | null;
      provided_to_youtube: number | null;
      duration_seconds: number | null;
      published_at: string | null;
    },
    right: {
      youtube_video_id: string;
      title: string;
      song_name?: string | null;
      provided_to_youtube: number | null;
      duration_seconds: number | null;
      published_at: string | null;
    }
  ): number {
    const leftScore = this.scoreHololiveMusicDisplayRow(left);
    const rightScore = this.scoreHololiveMusicDisplayRow(right);
    if (leftScore !== rightScore) {
      return leftScore - rightScore;
    }

    return (
      (left.published_at ?? "").localeCompare(right.published_at ?? "") ||
      right.youtube_video_id.localeCompare(left.youtube_video_id)
    );
  }

  private scoreHololiveMusicDisplayRow(row: {
    title: string;
    song_name?: string | null;
    provided_to_youtube: number | null;
    duration_seconds: number | null;
  }): number {
    const title = [row.title, row.song_name ?? ""].join(" ").toLowerCase();
    let score = row.provided_to_youtube ? 0 : 1000;

    if (/(official\s*(music\s*)?(video|mv)|\bmv\b|music video|original mv)/i.test(title)) {
      score += 250;
    }
    if (/\bfull\b|full ver|full version/i.test(title)) {
      score += 60;
    }
    if (hasHololiveLowPriorityVersionMarker(title)) {
      score -= 240;
    }
    if (
      /topic|provided to youtube|shorts?|teaser|trailer|preview|promo(?:tional)?|宣伝|ending|movie edition|midnight ver|remaster(?:ed)?|instrumental|off vocal|karaoke/i.test(
        title
      )
    ) {
      score -= 180;
    }

    return score + Math.min(Math.max(row.duration_seconds ?? 0, 0), 1200) / 10;
  }

  private dedupeHololiveMusicRowsByCanonicalPerformancePreserveOrder<
    T extends {
      youtube_video_id: string;
      title: string;
      canonical_performance_key: string | null;
      provided_to_youtube: number | null;
      duration_seconds: number | null;
      published_at: string | null;
    }
  >(rows: T[]): T[] {
    const bestByKey = new Map<string, T>();
    const keys: string[] = [];

    for (const row of rows) {
      const key = row.canonical_performance_key?.trim() || `video:${row.youtube_video_id}`;
      const existing = bestByKey.get(key);
      if (!existing) {
        keys.push(key);
        bestByKey.set(key, row);
      } else if (this.compareHololiveMusicDisplayRow(row, existing) > 0) {
        bestByKey.set(key, row);
      }
    }

    return keys.map((key) => bestByKey.get(key)).filter((row): row is T => Boolean(row));
  }

  private parseJsonStringArray(value: string | null | undefined): string[] {
    if (!value) {
      return [];
    }

    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed)
        ? parsed.map((entry) => String(entry).trim()).filter(Boolean)
        : [];
    } catch {
      return [];
    }
  }

  private parseHolodexMentionedChannels(value: string | null | undefined): HolodexMentionedChannel[] {
    if (!value) {
      return [];
    }

    try {
      const parsed = JSON.parse(value) as unknown;
      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed
        .map((entry): HolodexMentionedChannel | null => {
          if (!entry || typeof entry !== "object") {
            return null;
          }
          const record = entry as Partial<HolodexMentionedChannel>;
          const channelId = String(record.channelId ?? "").trim();
          if (!channelId || isExcludedHolodexChannelId(channelId)) {
            return null;
          }

          return {
            channelId,
            name: String(record.name ?? "").trim(),
            englishName: String(record.englishName ?? "").trim(),
            type: String(record.type ?? "").trim(),
            photoUrl: String(record.photoUrl ?? "").trim(),
            org: String(record.org ?? "").trim()
          };
        })
        .filter((entry): entry is HolodexMentionedChannel => Boolean(entry));
    } catch {
      return [];
    }
  }

  private normalizeIdolIdArray(
    values: Array<string | null | undefined>,
    idolMetadata = this.getHololiveIdolMetadataMap()
  ): string[] {
    const unique = [...new Set(values.map((value) => value?.trim() ?? "").filter(Boolean))];
    unique.sort((left, right) => {
      const leftOrder = idolMetadata.get(left)?.sortOrder ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = idolMetadata.get(right)?.sortOrder ?? Number.MAX_SAFE_INTEGER;
      return leftOrder - rightOrder || left.localeCompare(right);
    });
    return unique;
  }

  private stringifyIdolIdArray(
    values: Array<string | null | undefined>,
    idolMetadata = this.getHololiveIdolMetadataMap()
  ): string {
    const unique = this.normalizeIdolIdArray(values, idolMetadata);
    return JSON.stringify(unique);
  }

  private unionIdolIds(...groups: string[][]): string[] {
    return [...new Set(groups.flat().map((value) => value.trim()).filter(Boolean))];
  }

  private inferHololiveGroupUploadFeaturedIdolIds(input: {
    title: string;
    songName?: string | null;
    channelId: string;
    effectiveOwnerChannelId?: string | null;
  }, idolMetadata = this.getHololiveIdolMetadataMap()): string[] {
    const explicitPerformerIds = this.normalizeIdolIdArray(
      [
        ...this.inferHololivePerformerIdolsFromText(input.songName, idolMetadata),
        ...this.inferHololivePerformerIdolsFromText(input.title, idolMetadata)
      ],
      idolMetadata
    );
    if (explicitPerformerIds.length > 0) {
      return explicitPerformerIds;
    }

    const channelIds = [input.channelId, input.effectiveOwnerChannelId]
      .map((channelId) => channelId?.trim())
      .filter((channelId): channelId is string => Boolean(channelId));
    const unitIdolIds = channelIds.flatMap((channelId) => HOLOLIVE_UNIT_CHANNEL_IDOL_IDS[channelId] ?? []);
    return this.normalizeIdolIdArray(unitIdolIds, idolMetadata);
  }

  private inferHololivePerformerIdolsFromText(
    value: string | null | undefined,
    idolMetadata = this.getHololiveIdolMetadataMap()
  ): string[] {
    const text = value?.trim() ?? "";
    if (!text) {
      return [];
    }

    const aliasMap = this.getHololivePerformerAliasMap(idolMetadata);
    const parentheticalSegments = [...text.matchAll(/[\(（]([^()（）]+)[\)）]/g)].map((match) => match[1]);
    const inferredIds: string[] = [];

    for (const segment of parentheticalSegments) {
      const normalizedSegment = buildNormalizedHololiveMusicKey(segment);
      if (aliasMap.has(normalizedSegment)) {
        inferredIds.push(...(aliasMap.get(normalizedSegment) ?? []));
        continue;
      }

      if (!/[,&、+×/]|(?:^|\s)(?:x|and|with|ft\.?|feat\.?|featuring)(?:\s|$)/i.test(segment)) {
        continue;
      }

      const candidates = segment
        .replace(/\b(?:feat\.?|featuring|ft\.?|with)\b/gi, ",")
        .replace(/\s+(?:and|x)\s+/gi, ",")
        .replace(/\s*\/\s*/g, ",")
        .replace(/[&、+×]/g, ",")
        .split(",")
        .map((candidate) => candidate.trim())
        .filter(Boolean);

      for (const candidate of candidates) {
        const normalizedCandidate = buildNormalizedHololiveMusicKey(candidate);
        if (aliasMap.has(normalizedCandidate)) {
          inferredIds.push(...(aliasMap.get(normalizedCandidate) ?? []));
        }
      }
    }

    return this.normalizeIdolIdArray(inferredIds, idolMetadata);
  }

  private textReferencesAnyHololiveIdol(
    value: string | null | undefined,
    idolIds: string[],
    idolMetadata = this.getHololiveIdolMetadataMap()
  ): boolean {
    const normalizedText = buildNormalizedHololiveMusicKey(value ?? "");
    if (!normalizedText || idolIds.length === 0) {
      return false;
    }

    const candidateIds = new Set(idolIds.filter((idolId) => idolMetadata.has(idolId)));
    if (candidateIds.size === 0) {
      return false;
    }

    const aliases = new Set<string>();
    for (const idolId of candidateIds) {
      const idol = idolMetadata.get(idolId);
      if (idol?.name) {
        aliases.add(idol.name);
        for (const part of idol.name.split(/\s+/).filter((namePart) => namePart.length >= 5)) {
          aliases.add(part);
        }
      }
    }

    for (const [alias, aliasIdolIds] of Object.entries(HOLOLIVE_PERFORMER_ALIAS_IDOL_IDS)) {
      if (aliasIdolIds.some((idolId) => candidateIds.has(idolId))) {
        aliases.add(alias);
      }
    }

    return [...aliases]
      .map((alias) => buildNormalizedHololiveMusicKey(alias))
      .filter((alias) => alias.length >= 3)
      .some((alias) => this.normalizedTextContainsAlias(normalizedText, alias));
  }

  private normalizedTextContainsAlias(normalizedText: string, alias: string): boolean {
    const escapedAlias = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?:^|\\s)${escapedAlias}(?:\\s|$)`, "u").test(normalizedText);
  }

  private getHololivePerformerAliasMap(idolMetadata = this.getHololiveIdolMetadataMap()): Map<string, string[]> {
    const buckets = new Map<string, Set<string>>();
    const explicitAliasKeys = new Set<string>();
    const addAlias = (alias: string, idolIds: string[]) => {
      const key = buildNormalizedHololiveMusicKey(alias);
      const filteredIds = idolIds.filter((idolId) => idolMetadata.has(idolId));
      if (!key || filteredIds.length === 0) {
        return;
      }
      explicitAliasKeys.add(key);
      buckets.set(key, new Set([...(buckets.get(key) ?? []), ...filteredIds]));
    };
    const addGeneratedAlias = (alias: string, idolId: string) => {
      const key = buildNormalizedHololiveMusicKey(alias);
      if (!key || !idolMetadata.has(idolId)) {
        return;
      }
      buckets.set(key, new Set([...(buckets.get(key) ?? []), idolId]));
    };

    for (const [alias, idolIds] of Object.entries(HOLOLIVE_PERFORMER_ALIAS_IDOL_IDS)) {
      addAlias(alias, idolIds);
    }

    for (const idol of HOLOLIVE_IDOLS) {
      addGeneratedAlias(idol.displayName, idol.id);
      const nameParts = idol.displayName.split(/\s+/).filter((part) => part.length >= 3);
      for (const part of nameParts) {
        addGeneratedAlias(part, idol.id);
      }
    }

    for (const [idolId, idol] of idolMetadata) {
      addGeneratedAlias(idol.name, idolId);
      const nameParts = idol.name.split(/\s+/).filter((part) => part.length >= 3);
      for (const part of nameParts) {
        addGeneratedAlias(part, idolId);
      }
    }

    const aliases = new Map<string, string[]>();
    for (const [alias, idolIds] of buckets) {
      if (idolIds.size === 1 || explicitAliasKeys.has(alias)) {
        aliases.set(alias, [...idolIds]);
      }
    }

    return aliases;
  }

  private getHololiveIdolMetadataMap(): Map<string, { name: string; sortOrder: number }> {
    return new Map(
      this.select<{ id: string; display_name: string; sort_order: number }>(
        "SELECT id, display_name, sort_order FROM hololive_idols"
      ).map((row) => [row.id, { name: row.display_name, sortOrder: Number(row.sort_order) }])
    );
  }

  private isHololiveMusicParticipantRole(role: string): role is HololiveMusicParticipantRole {
    return role === "primary" || role === "topic-owner" || role === "mentioned" || role === "collab";
  }

  private normalizeStoredHololiveMusicParticipants(
    participants: Array<{ idolId?: string | null; role?: string | null; channelId?: string | null } | null | undefined>,
    idolMetadata = this.getHololiveIdolMetadataMap()
  ): StoredHololiveMusicParticipant[] {
    const unique = new Map<string, StoredHololiveMusicParticipant>();

    for (const participant of participants) {
      const idolId = participant?.idolId?.trim() ?? "";
      const role = participant?.role?.trim() ?? "";
      const channelId = participant?.channelId?.trim() || null;
      if (!idolId || !this.isHololiveMusicParticipantRole(role) || !idolMetadata.has(idolId)) {
        continue;
      }
      if (channelId && isExcludedHolodexChannelId(channelId)) {
        continue;
      }
      const key = `${idolId}:${role}`;
      if (!unique.has(key)) {
        unique.set(key, { idolId, role, channelId });
      }
    }

    return [...unique.values()].sort((left, right) => {
      const leftRole = HOLOLIVE_MUSIC_PARTICIPANT_ROLE_ORDER[left.role];
      const rightRole = HOLOLIVE_MUSIC_PARTICIPANT_ROLE_ORDER[right.role];
      const leftIdol = idolMetadata.get(left.idolId)?.sortOrder ?? Number.MAX_SAFE_INTEGER;
      const rightIdol = idolMetadata.get(right.idolId)?.sortOrder ?? Number.MAX_SAFE_INTEGER;
      return leftRole - rightRole || leftIdol - rightIdol || left.idolId.localeCompare(right.idolId);
    });
  }

  private stringifyHololiveMusicParticipants(
    participants: StoredHololiveMusicParticipant[],
    idolMetadata = this.getHololiveIdolMetadataMap()
  ): string {
    return JSON.stringify(this.normalizeStoredHololiveMusicParticipants(participants, idolMetadata));
  }

  private parseStoredHololiveMusicParticipants(
    youtubeVideoId: string,
    value: string | null | undefined,
    idolMetadata = this.getHololiveIdolMetadataMap()
  ): HololiveMusicParticipant[] {
    let parsed: unknown = [];
    if (value) {
      try {
        parsed = JSON.parse(value);
      } catch {
        parsed = [];
      }
    }

    const stored = Array.isArray(parsed)
      ? this.normalizeStoredHololiveMusicParticipants(
          parsed.map((entry) => {
            const candidate = entry as Record<string, unknown>;
            return {
              idolId: typeof candidate.idolId === "string" ? candidate.idolId : "",
              role: typeof candidate.role === "string" ? candidate.role : "",
              channelId: typeof candidate.channelId === "string" ? candidate.channelId : null
            };
          }),
          idolMetadata
        )
      : [];

    return stored.map((participant) => ({
      youtubeVideoId,
      idolId: participant.idolId,
      idolName: idolMetadata.get(participant.idolId)?.name ?? participant.idolId,
      role: participant.role,
      channelId: participant.channelId
    }));
  }

  private getParticipantIdolIds(
    participants: StoredHololiveMusicParticipant[],
    idolMetadata = this.getHololiveIdolMetadataMap()
  ): string[] {
    return this.parseJsonStringArray(
      this.stringifyIdolIdArray(participants.map((participant) => participant.idolId), idolMetadata)
    );
  }

  private getMergedHololiveChannelKind(
    org: string | null | undefined,
    mainIdolIds: string[],
    topicIdolIds: string[],
    existingKind: HololiveChannelKind = "unknown"
  ): HololiveChannelKind {
    if (mainIdolIds.length > 0) {
      return "idol";
    }
    if (topicIdolIds.length > 0) {
      return "topic";
    }
    if (existingKind === "topic") {
      return "topic";
    }
    if (existingKind === "group" || org === "Hololive") {
      return "group";
    }
    return "unknown";
  }

  getHololiveTierListData(
    boardId?: string | null,
    resolveCachedImageUrl: (fileName: string) => string = (fileName) => fileName
  ): HololiveTierListData {
    let boards = this.listHololiveTierBoardSummaries();
    if (boards.length === 0) {
      this.createHololiveTierBoard(DEFAULT_HOLOLIVE_BOARD_NAME, HOLOLIVE_DEFAULT_BOARD_ID);
      boards = this.listHololiveTierBoardSummaries();
    }

    const requestedBoardId = boardId ?? this.getSettingValue(HOLOLIVE_ACTIVE_BOARD_SETTING_KEY);
    const activeBoardId =
      requestedBoardId && boards.some((board) => board.id === requestedBoardId) ? requestedBoardId : boards[0].id;
    this.persistSettingValue(HOLOLIVE_ACTIVE_BOARD_SETTING_KEY, activeBoardId);
    this.ensureHololiveBoardPlacements(activeBoardId);

    return {
      idols: this.listHololiveIdols(resolveCachedImageUrl),
      boards: this.listHololiveTierBoardSummaries(),
      activeBoard: this.getHololiveTierBoard(activeBoardId)
    };
  }

  createHololiveTierBoard(name: string, boardId: string = randomUUID(), afterBoardId: string | null = null): string {
    const now = new Date().toISOString();
    const safeName = name.trim() || DEFAULT_HOLOLIVE_BOARD_NAME;
    const position = this.nextHololiveBoardPosition(afterBoardId);

    this.transaction(() => {
      this.run("UPDATE hololive_tier_boards SET position = position + 1 WHERE position >= ?", [position]);
      this.run(
        `INSERT INTO hololive_tier_boards (id, name, tile_size, position, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [boardId, safeName, DEFAULT_HOLOLIVE_TILE_SIZE, position, now, now]
      );

      for (const tier of DEFAULT_HOLOLIVE_TIERS) {
        this.run(
          `INSERT INTO hololive_tiers (id, board_id, label, color, position, collapsed, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            boardId === HOLOLIVE_DEFAULT_BOARD_ID ? tier.id : randomUUID(),
            boardId,
            tier.label,
            tier.color,
            tier.position,
            tier.collapsed ? 1 : 0,
            now,
            now
          ]
        );
      }

      this.ensureHololiveBoardPlacements(boardId);
    });

    return boardId;
  }

  updateHololiveTierBoard(input: { boardId: string; name?: string; tileSize?: number }): void {
    const updates: string[] = [];
    const params: unknown[] = [];

    if (input.name !== undefined) {
      updates.push("name = ?");
      params.push(input.name.trim() || DEFAULT_HOLOLIVE_BOARD_NAME);
    }

    if (input.tileSize !== undefined) {
      updates.push("tile_size = ?");
      params.push(Math.min(Math.max(Math.round(input.tileSize), 36), 96));
    }

    if (updates.length === 0) {
      return;
    }

    this.assertHololiveBoard(input.boardId);

    updates.push("updated_at = ?");
    params.push(new Date().toISOString(), input.boardId);
    this.run(`UPDATE hololive_tier_boards SET ${updates.join(", ")} WHERE id = ?`, params);
  }

  reorderHololiveTierBoards(boardIds: string[]): void {
    const existing = this.listHololiveTierBoardSummaries();
    const existingIds = new Set(existing.map((board) => board.id));
    const orderedIds = boardIds.filter((boardId) => existingIds.has(boardId));
    const missingIds = existing.map((board) => board.id).filter((boardId) => !orderedIds.includes(boardId));

    this.transaction(() => {
      [...orderedIds, ...missingIds].forEach((boardId, position) => {
        this.run("UPDATE hololive_tier_boards SET position = ? WHERE id = ?", [position, boardId]);
      });
    });
  }

  deleteHololiveTierBoard(boardId: string): string {
    const boards = this.listHololiveTierBoardSummaries();
    if (boards.length <= 1) {
      throw new Error("At least one Hololive tier board is required");
    }

    if (!boards.some((board) => board.id === boardId)) {
      throw new Error(`Unknown Hololive tier board: ${boardId}`);
    }

    const snapshot = {
      boards: this.selectTableRows("hololive_tier_boards"),
      tiers: this.selectTableRows("hololive_tiers", "WHERE board_id = ?", [boardId]),
      placements: this.selectTableRows("hololive_tier_placements", "WHERE board_id = ?", [boardId]),
      activeBoardSetting: this.selectTableRows("settings", "WHERE key = ?", [HOLOLIVE_ACTIVE_BOARD_SETTING_KEY])
    };
    const remainingBoardIds = boards.filter((board) => board.id !== boardId).map((board) => board.id);

    this.transaction(() => {
      this.run("DELETE FROM hololive_tier_placements WHERE board_id = ?", [boardId]);
      this.run("DELETE FROM hololive_tiers WHERE board_id = ?", [boardId]);
      this.run("DELETE FROM hololive_tier_boards WHERE id = ?", [boardId]);

      remainingBoardIds.forEach((remainingBoardId, position) => {
        this.run("UPDATE hololive_tier_boards SET position = ? WHERE id = ?", [position, remainingBoardId]);
      });
    });

    this.registerHololiveUndoAction("tier-board-delete", "Restore board", () => {
      this.insertOrReplaceRows("hololive_tier_boards", snapshot.boards);
      this.insertOrReplaceRows("hololive_tiers", snapshot.tiers);
      this.insertOrReplaceRows("hololive_tier_placements", snapshot.placements);
      this.insertOrReplaceRows("settings", snapshot.activeBoardSetting);
    });

    return this.listHololiveTierBoardSummaries()[0].id;
  }

  clearHololiveTierBoard(boardId: string): void {
    const now = new Date().toISOString();
    this.assertHololiveBoard(boardId);
    this.ensureHololiveBoardPlacements(boardId);
    const snapshot = {
      board: this.selectTableRows("hololive_tier_boards", "WHERE id = ?", [boardId]),
      placements: this.selectTableRows("hololive_tier_placements", "WHERE board_id = ?", [boardId])
    };

    const idolIds = this.select<{ idol_id: string }>(
      `SELECT p.idol_id
       FROM hololive_tier_placements p
       INNER JOIN hololive_idols i ON i.id = p.idol_id
       WHERE p.board_id = ?
       ORDER BY ${this.hololiveTierShelfOrderBySql("i")}`,
      [boardId]
    ).map((row) => row.idol_id);

    this.transaction(() => {
      this.updateHololivePlacementGroup(boardId, null, idolIds, now);
      this.touchHololiveBoard(boardId, now);
    });

    this.registerHololiveUndoAction("tier-board-clear", "Restore board placements", () => {
      this.run("DELETE FROM hololive_tier_placements WHERE board_id = ?", [boardId]);
      this.insertOrReplaceRows("hololive_tier_boards", snapshot.board);
      this.insertOrReplaceRows("hololive_tier_placements", snapshot.placements);
    });
  }

  createHololiveTier(input: { boardId: string; label?: string; color?: string; position?: number }): void {
    const now = new Date().toISOString();
    this.assertHololiveBoard(input.boardId);
    const existing = this.selectHololiveTiers(input.boardId);
    const label = input.label?.trim() || this.nextHololiveTierLabel(existing);
    const position =
      input.position === undefined ? existing.length : Math.min(Math.max(Math.round(input.position), 0), existing.length);

    this.transaction(() => {
      this.run(
        `UPDATE hololive_tiers
         SET position = position + 1, updated_at = ?
         WHERE board_id = ? AND position >= ?`,
        [now, input.boardId, position]
      );
      this.run(
        `INSERT INTO hololive_tiers (id, board_id, label, color, position, collapsed, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
        [randomUUID(), input.boardId, label, input.color ?? "#82dfff", position, now, now]
      );
      this.touchHololiveBoard(input.boardId, now);
    });
  }

  updateHololiveTier(input: {
    boardId: string;
    tierId: string;
    label?: string;
    color?: string;
    collapsed?: boolean;
  }): void {
    const updates: string[] = [];
    const params: unknown[] = [];

    if (input.label !== undefined) {
      updates.push("label = ?");
      params.push(input.label.trim() || "Tier");
    }

    if (input.color !== undefined) {
      updates.push("color = ?");
      params.push(input.color);
    }

    if (input.collapsed !== undefined) {
      updates.push("collapsed = ?");
      params.push(input.collapsed ? 1 : 0);
    }

    if (updates.length === 0) {
      return;
    }

    this.assertHololiveTier(input.boardId, input.tierId);

    const now = new Date().toISOString();
    updates.push("updated_at = ?");
    params.push(now, input.tierId, input.boardId);

    this.transaction(() => {
      this.run(`UPDATE hololive_tiers SET ${updates.join(", ")} WHERE id = ? AND board_id = ?`, params);
      this.touchHololiveBoard(input.boardId, now);
    });
  }

  deleteHololiveTier(boardId: string, tierId: string): void {
    const now = new Date().toISOString();
    this.assertHololiveTier(boardId, tierId);

    this.transaction(() => {
      const unrankedIds = this.selectHololivePlacementGroup(boardId, null).map((placement) => placement.idol_id);
      const tierIds = this.selectHololivePlacementGroup(boardId, tierId).map((placement) => placement.idol_id);

      this.updateHololivePlacementGroup(boardId, null, [...unrankedIds, ...tierIds], now);
      this.run("DELETE FROM hololive_tiers WHERE id = ? AND board_id = ?", [tierId, boardId]);
      this.repositionHololiveTiers(boardId, this.selectHololiveTiers(boardId).map((tier) => tier.id), now);
      this.touchHololiveBoard(boardId, now);
    });
  }

  reorderHololiveTiers(boardId: string, tierIds: string[]): void {
    const now = new Date().toISOString();
    this.assertHololiveBoard(boardId);
    const existing = this.selectHololiveTiers(boardId);
    const existingIds = new Set(existing.map((tier) => tier.id));
    const orderedIds = tierIds.filter((tierId) => existingIds.has(tierId));
    const missingIds = existing.map((tier) => tier.id).filter((tierId) => !orderedIds.includes(tierId));

    this.transaction(() => {
      this.repositionHololiveTiers(boardId, [...orderedIds, ...missingIds], now);
      this.touchHololiveBoard(boardId, now);
    });
  }

  moveHololiveIdol(input: { boardId: string; idolId: string; tierId: string | null; index: number }): void {
    const now = new Date().toISOString();
    const destinationTierId = input.tierId || null;

    this.transaction(() => {
      this.assertHololiveBoard(input.boardId);
      this.ensureHololiveBoardPlacements(input.boardId);
      this.assertHololiveIdol(input.idolId);

      if (destinationTierId) {
        this.assertHololiveTier(input.boardId, destinationTierId);
      }

      const current = this.select<{ tier_id: string | null }>(
        "SELECT tier_id FROM hololive_tier_placements WHERE board_id = ? AND idol_id = ?",
        [input.boardId, input.idolId]
      )[0];
      const sourceTierId = current?.tier_id ?? null;
      const sameGroup = sourceTierId === destinationTierId;
      const sourceIds = this.selectHololivePlacementGroup(input.boardId, sourceTierId)
        .map((placement) => placement.idol_id)
        .filter((idolId) => idolId !== input.idolId);
      const destinationIds = sameGroup
        ? [...sourceIds]
        : this.selectHololivePlacementGroup(input.boardId, destinationTierId)
            .map((placement) => placement.idol_id)
            .filter((idolId) => idolId !== input.idolId);
      const insertionIndex = Math.min(Math.max(Math.round(input.index), 0), destinationIds.length);

      destinationIds.splice(insertionIndex, 0, input.idolId);
      this.updateHololivePlacementGroup(input.boardId, destinationTierId, destinationIds, now);

      if (!sameGroup) {
        this.updateHololivePlacementGroup(input.boardId, sourceTierId, sourceIds, now);
      }

      this.touchHololiveBoard(input.boardId, now);
    });
  }

  sortHololiveUnrankedByDefaultOrder(boardId: string): void {
    const now = new Date().toISOString();
    this.assertHololiveBoard(boardId);
    const idolIds = this.select<{ idol_id: string }>(
      `SELECT p.idol_id
       FROM hololive_tier_placements p
       INNER JOIN hololive_idols i ON i.id = p.idol_id
       WHERE p.board_id = ? AND p.tier_id IS NULL
       ORDER BY ${this.hololiveTierShelfOrderBySql("i")}`,
      [boardId]
    ).map((row) => row.idol_id);

    this.transaction(() => {
      this.updateHololivePlacementGroup(boardId, null, idolIds, now);
      this.touchHololiveBoard(boardId, now);
    });
  }

  upsertHololiveImageCache(input: {
    idolId: string;
    kind: "icon" | "profile";
    sourceUrl: string;
    localFilename: string;
    mimeType?: string | null;
    sizeBytes?: number | null;
  }): void {
    this.upsertHololiveImageCaches([input]);
  }

  listHololiveImageCaches(): Array<{
    idolId: string;
    kind: "icon" | "profile";
    sourceUrl: string;
    localFilename: string;
  }> {
    return this.select<{
      idol_id: string;
      kind: "icon" | "profile";
      source_url: string;
      local_filename: string;
    }>(
      `SELECT idol_id, kind, source_url, local_filename
       FROM hololive_image_cache`
    ).map((row) => ({
      idolId: row.idol_id,
      kind: row.kind,
      sourceUrl: row.source_url,
      localFilename: row.local_filename
    }));
  }

  upsertHololiveImageCaches(
    inputs: Array<{
      idolId: string;
      kind: "icon" | "profile";
      sourceUrl: string;
      localFilename: string;
      mimeType?: string | null;
      sizeBytes?: number | null;
    }>
  ): void {
    if (inputs.length === 0) {
      return;
    }

    const now = new Date().toISOString();
    const upsertInputs = () => {
      for (const input of inputs) {
        this.run(
          `INSERT INTO hololive_image_cache (idol_id, kind, source_url, local_filename, mime_type, size_bytes, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(idol_id, kind) DO UPDATE SET
             source_url = excluded.source_url,
             local_filename = excluded.local_filename,
             mime_type = excluded.mime_type,
             size_bytes = excluded.size_bytes,
             updated_at = excluded.updated_at`,
          [
            input.idolId,
            input.kind,
            input.sourceUrl,
            input.localFilename,
            input.mimeType ?? null,
            input.sizeBytes ?? null,
            now
          ]
        );
      }
    };

    if (this.inTransaction) {
      upsertInputs();
    } else {
      this.transaction(upsertInputs);
    }
  }

  listHololiveIdols(resolveCachedImageUrl: (fileName: string) => string = (fileName) => fileName): HololiveIdol[] {
    return this.select<{
      id: string;
      slug: string;
      display_name: string;
      branch: HololiveIdol["branch"];
      generation: string;
      status: HololiveIdol["status"];
      source: HololiveIdol["source"];
      official_url: string;
      icon_url: string;
      profile_image_url: string | null;
      profile_quote: string | null;
      cached_profile_filename: string | null;
      youtube_channel_url: string | null;
      youtube_channel_id: string | null;
      x_handle: string | null;
      x_url: string | null;
      birthday: string | null;
      debut_date: string | null;
      height: string | null;
      unit: string | null;
      cached_icon_filename: string | null;
      sort_order: number;
    }>(
      `SELECT i.id, i.slug, i.display_name, i.branch, i.generation, i.status, i.source, i.official_url, i.icon_url,
              i.profile_image_url, i.profile_quote, i.youtube_channel_url, i.youtube_channel_id,
              i.x_handle, i.x_url, i.birthday, i.debut_date, i.height, i.unit,
              icon_cache.local_filename AS cached_icon_filename,
              profile_cache.local_filename AS cached_profile_filename,
              i.sort_order
       FROM hololive_idols i
       LEFT JOIN hololive_image_cache icon_cache
         ON icon_cache.idol_id = i.id
        AND icon_cache.kind = 'icon'
        AND icon_cache.local_filename = i.slug || ?
       LEFT JOIN hololive_image_cache profile_cache
         ON profile_cache.idol_id = i.id
        AND profile_cache.kind = 'profile'
        AND profile_cache.local_filename = i.slug || ?
       ORDER BY i.sort_order ASC, i.display_name ASC`,
      [CURRENT_HOLOLIVE_ICON_CACHE_SUFFIX, CURRENT_HOLOLIVE_PROFILE_CACHE_SUFFIX]
    ).map((row) => ({
      id: row.id,
      slug: row.slug,
      displayName: row.display_name,
      branch: row.branch,
      generation: row.generation,
      status: row.status,
      source: row.source,
      officialUrl: row.official_url,
      iconUrl: row.icon_url,
      cachedIconUrl: row.cached_icon_filename ? resolveCachedImageUrl(row.cached_icon_filename) : null,
      profileImageUrl: row.profile_image_url,
      cachedProfileImageUrl: row.cached_profile_filename ? resolveCachedImageUrl(row.cached_profile_filename) : null,
      profileQuote: row.profile_quote,
      youtubeChannelUrl: row.youtube_channel_url,
      youtubeChannelId: row.youtube_channel_id,
      xHandle: row.x_handle,
      xUrl: row.x_url,
      birthday: row.birthday,
      debutDate: row.debut_date,
      height: row.height,
      unit: row.unit,
      sortOrder: row.sort_order
    }));
  }

  getHololiveIdolProfile(
    idolId: string,
    resolveCachedImageUrl: (fileName: string) => string = (fileName) => fileName
  ): HololiveIdolProfile {
    const idol = this.listHololiveIdols(resolveCachedImageUrl).find((candidate) => candidate.id === idolId);
    if (!idol) {
      throw new Error(`Unknown Hololive idol: ${idolId}`);
    }

    const links: HololiveProfileLink[] = [];

    if (idol.xUrl) {
      links.push({
        id: "x",
        label: idol.xHandle ?? "X",
        url: idol.xUrl,
        kind: "x"
      });
    }

    const originalSongs = this.dedupeHololiveProfileSongRows(
      this.listHololiveMusicRows({
        idolId,
        topicId: "Original_Song",
        assignment: "owned",
        dedupeCanonicalPerformance: true,
        limit: 500
      })
    ).slice(0, 250);
    const originalSongKeys = new Set(originalSongs.map((row) => this.buildHololiveProfileSongDedupeKey(row)).filter(Boolean));
    const covers = this.dedupeHololiveProfileSongRows(
      this.listHololiveMusicRows({
        idolId,
        topicId: "Music_Cover",
        assignment: "owned",
        dedupeCanonicalPerformance: true,
        limit: 500
      }).filter((row) => !originalSongKeys.has(this.buildHololiveProfileSongDedupeKey(row)))
    ).slice(0, 250);
    const ownedCanonicalPerformanceKeys = [...originalSongs, ...covers].map((row) => row.canonicalPerformanceKey).filter(Boolean);
    const ownedProfileSongKeys = new Set([...originalSongs, ...covers].map((row) => this.buildHololiveProfileSongDedupeKey(row)).filter(Boolean));
    const featured = this.dedupeHololiveProfileSongRows(
      this.listHololiveMusicRows({
        idolId,
        assignment: "featured",
        excludeCanonicalPerformanceKeys: ownedCanonicalPerformanceKeys,
        dedupeCanonicalPerformance: true,
        limit: 500
      }).filter((row) => !ownedProfileSongKeys.has(this.buildHololiveProfileSongDedupeKey(row)))
    ).slice(0, 250);
    const channels = this.listHololiveChannels();
    const linkedChannels = channels.filter((channel) => channel.linkedIdolIds.includes(idolId));
    const mainChannel =
      linkedChannels.find((channel) => channel.id === idol.youtubeChannelId) ??
      linkedChannels.find((channel) => channel.kind === "idol" && channel.mainIdolIds.includes(idolId)) ??
      null;
    const topicChannels = linkedChannels.filter((channel) => channel.kind === "topic" && channel.topicIdolIds.includes(idolId));

    return {
      idol,
      links,
      mainChannel: mainChannel ? this.toHololiveProfileChannel(mainChannel) : null,
      topicChannels: topicChannels.map((channel) => this.toHololiveProfileChannel(channel)),
      mediaGroups: [
        {
          id: "original-songs",
          label: "Original Songs",
          items: originalSongs.map((row) => ({
            id: row.youtubeVideoId,
            title: row.songName || row.title,
            url: row.youtubeUrl,
            publishedAt: row.publishedAt,
            durationSeconds: row.durationSeconds,
            viewCount: row.viewCount,
            viewCountFetchedAt: row.viewCountFetchedAt,
            markerKey: row.markerKey,
            marker: row.marker
          }))
        },
        {
          id: "covers",
          label: "Covers",
          items: covers.map((row) => ({
            id: row.youtubeVideoId,
            title: row.songName || row.title,
            url: row.youtubeUrl,
            publishedAt: row.publishedAt,
            durationSeconds: row.durationSeconds,
            viewCount: row.viewCount,
            viewCountFetchedAt: row.viewCountFetchedAt,
            markerKey: row.markerKey,
            marker: row.marker
          }))
        },
        {
          id: "featured-in",
          label: "Featured In",
          items: featured.map((row) => ({
            id: row.youtubeVideoId,
            title: row.songName || row.title,
            url: row.youtubeUrl,
            publishedAt: row.publishedAt,
            durationSeconds: row.durationSeconds,
            viewCount: row.viewCount,
            viewCountFetchedAt: row.viewCountFetchedAt,
            markerKey: row.markerKey,
            marker: row.marker
          }))
        },
        { id: "playlists", label: "Playlists", items: [] }
      ]
    };
  }

  getHololiveProfilePlaybackContext(input: {
    youtubeVideoId: string;
    preferredIdolId?: string | null;
    preferredGroupId?: HololiveProfileMediaGroupId | null;
  }): HololiveProfilePlaybackContext | null {
    const youtubeVideoId = input.youtubeVideoId.trim();
    if (!youtubeVideoId) {
      return null;
    }

    const row = this.listHololiveMusicRows({ youtubeVideoIds: [youtubeVideoId], limit: 1 })[0];
    if (!row) {
      return null;
    }

    const idolsBySortOrder = new Map(this.listHololiveIdols().map((idol) => [idol.id, idol.sortOrder]));
    const sortIdols = (idolIds: string[]) =>
      [...new Set(idolIds)].sort(
        (left, right) => (idolsBySortOrder.get(left) ?? Number.MAX_SAFE_INTEGER) - (idolsBySortOrder.get(right) ?? Number.MAX_SAFE_INTEGER)
      );
    const ownedGroupId: HololiveProfileMediaGroupId = row.topicId === "Original_Song" ? "original-songs" : "covers";
    const alternateOwnedGroupId: HololiveProfileMediaGroupId = ownedGroupId === "original-songs" ? "covers" : "original-songs";
    const ownedIdols = sortIdols(row.ownedIdolIds);
    const featuredIdols = sortIdols(row.featuredIdolIds.filter((idolId) => !ownedIdols.includes(idolId)));
    const triedKeys = new Set<string>();

    const resolveCandidate = (
      idolId: string | null | undefined,
      groupOrder: Array<HololiveProfileMediaGroupId | null | undefined>
    ): HololiveProfilePlaybackContext | null => {
      if (!idolId) {
        return null;
      }

      const normalizedGroupOrder = [
        ...new Set(
          [...groupOrder, "original-songs", "covers", "featured-in"].filter(
            (groupId): groupId is HololiveProfileMediaGroupId => Boolean(groupId && groupId !== "playlists")
          )
        )
      ];
      const key = `${idolId}:${normalizedGroupOrder.join("|")}`;
      if (triedKeys.has(key)) {
        return null;
      }
      triedKeys.add(key);

      let profile: HololiveIdolProfile;
      try {
        profile = this.getHololiveIdolProfile(idolId);
      } catch {
        return null;
      }

      for (const groupId of normalizedGroupOrder) {
        const group = profile.mediaGroups.find((candidate) => candidate.id === groupId);
        if (!group) {
          continue;
        }

        const currentIndex = group.items.findIndex((item) => item.id === youtubeVideoId);
        if (currentIndex < 0) {
          continue;
        }

        return {
          youtubeVideoId,
          idolId: profile.idol.id,
          idolName: profile.idol.displayName,
          mediaGroupId: group.id,
          mediaGroupLabel: group.label,
          songIds: group.items.map((item) => item.id),
          currentIndex
        };
      }

      return null;
    };

    const preferred = resolveCandidate(input.preferredIdolId, [
      input.preferredGroupId,
      ownedGroupId,
      alternateOwnedGroupId,
      "featured-in"
    ]);
    if (preferred) {
      return preferred;
    }

    for (const idolId of ownedIdols) {
      const context = resolveCandidate(idolId, [ownedGroupId, alternateOwnedGroupId, "featured-in"]);
      if (context) {
        return context;
      }
    }

    for (const idolId of featuredIdols) {
      const context = resolveCandidate(idolId, ["featured-in", ownedGroupId, alternateOwnedGroupId]);
      if (context) {
        return context;
      }
    }

    return null;
  }

  listHololiveBrackets(): HololiveBracketSummary[] {
    const brackets = this.select<{
      id: string;
      name: string;
      size: HololiveBracketSize;
      generation_style: HololiveBracketGenerationStyle;
      generation_filters_json: string | null;
      status: HololiveBracketStatus;
      current_match_id: string | null;
      created_at: string;
      updated_at: string;
      completed_matches: number;
      total_matches: number;
      champion_title: string | null;
    }>(
      `SELECT b.id, b.name, b.size, b.generation_style, b.generation_filters_json,
              b.status, b.current_match_id, b.created_at, b.updated_at,
              COUNT(m.id) AS total_matches,
              SUM(CASE WHEN m.winner_entry_id IS NULL THEN 0 ELSE 1 END) AS completed_matches,
              champion.title AS champion_title
       FROM hololive_brackets b
       LEFT JOIN hololive_bracket_matches m ON m.bracket_id = b.id
       LEFT JOIN hololive_bracket_matches final_match
         ON final_match.bracket_id = b.id
        AND final_match.round_index = (
          SELECT MAX(round_index) FROM hololive_bracket_matches WHERE bracket_id = b.id
        )
        AND final_match.match_index = 0
       LEFT JOIN hololive_bracket_entries champion ON champion.id = final_match.winner_entry_id
       GROUP BY b.id
       ORDER BY b.updated_at DESC, b.created_at DESC`
    );

    return brackets.map((row) => ({
      id: row.id,
      name: row.name,
      size: this.normalizeHololiveBracketSize(row.size),
      generationStyle: this.normalizeHololiveBracketGenerationStyle(row.generation_style),
      generationFilters: this.normalizeHololiveBracketGenerationFilters(row.generation_filters_json),
      status: this.normalizeHololiveBracketStatus(row.status),
      currentMatchId: row.current_match_id,
      completedMatches: Number(row.completed_matches ?? 0),
      totalMatches: Number(row.total_matches ?? 0),
      championTitle: row.champion_title,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }

  createHololiveBracket(input: {
    size: HololiveBracketSize;
    generationStyle?: HololiveBracketGenerationStyle | null;
    filters?: HololiveBracketGenerationFilters | null;
    name?: string | null;
  }): HololiveBracket {
    const size = this.normalizeHololiveBracketSize(input.size);
    const generationStyle = this.normalizeHololiveBracketGenerationStyle(input.generationStyle);
    const generationFilters = this.normalizeHololiveBracketGenerationFilters(input.filters);
    const generationFiltersJson = this.stringifyHololiveBracketGenerationFilters(generationFilters);
    const sizeCount = HOLOLIVE_BRACKET_SIZE_COUNTS[size];
    const now = new Date().toISOString();
    const id = randomUUID();
    const seed = randomUUID();
    const name =
      input.name?.trim() ||
      `${HOLOLIVE_BRACKET_GENERATION_STYLE_LABELS[generationStyle]} ${HOLOLIVE_BRACKET_SIZE_LABELS[size]} Bracket`;
    const entries = this.generateHololiveBracketEntries(id, size, seed, generationStyle, generationFilters);
    if (entries.length !== sizeCount) {
      throw new Error(
        `Could not generate ${HOLOLIVE_BRACKET_GENERATION_STYLE_LABELS[generationStyle]} ${HOLOLIVE_BRACKET_SIZE_LABELS[size]} from the current music database.`
      );
    }

    this.transaction(() => {
      this.run(
        `INSERT INTO hololive_brackets
           (id, name, size, generation_style, generation_filters_json, seed, status, current_match_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
        [id, name.slice(0, 120), size, generationStyle, generationFiltersJson, seed, `${id}:r0:m0`, now, now]
      );

      for (const entry of entries) {
        this.run(
          `INSERT INTO hololive_bracket_entries
             (id, bracket_id, slot_index, youtube_video_id, title, song_name, topic_id, youtube_url, channel_name,
              idol_id, idol_name, canonical_performance_key, view_count, published_at, duration_seconds)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            entry.id,
            entry.bracketId,
            entry.slotIndex,
            entry.youtubeVideoId,
            entry.title,
            entry.songName ?? null,
            entry.topicId,
            entry.youtubeUrl,
            entry.channelName,
            entry.idolId,
            entry.idolName,
            entry.canonicalPerformanceKey,
            entry.viewCount ?? null,
            entry.publishedAt ?? null,
            entry.durationSeconds ?? null
          ]
        );
      }

      const roundCount = Math.log2(sizeCount);
      for (let roundIndex = 0; roundIndex < roundCount; roundIndex += 1) {
        const matchesInRound = sizeCount / 2 ** (roundIndex + 1);
        for (let matchIndex = 0; matchIndex < matchesInRound; matchIndex += 1) {
          const entryAId = roundIndex === 0 ? entries[matchIndex * 2]?.id ?? null : null;
          const entryBId = roundIndex === 0 ? entries[matchIndex * 2 + 1]?.id ?? null : null;
          this.run(
            `INSERT INTO hololive_bracket_matches
               (id, bracket_id, round_index, match_index, entry_a_id, entry_b_id, winner_entry_id, completed_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?)`,
            [`${id}:r${roundIndex}:m${matchIndex}`, id, roundIndex, matchIndex, entryAId, entryBId, now]
          );
        }
      }
    });

    this.recomputeHololiveBracketProgress(id);
    return this.getHololiveBracket(id);
  }

  getHololiveBracket(bracketId: string): HololiveBracket {
    const id = bracketId.trim();
    if (!id) {
      throw new Error("A bracket id is required");
    }

    const bracket = this.select<{
      id: string;
      name: string;
      size: HololiveBracketSize;
      generation_style: HololiveBracketGenerationStyle;
      generation_filters_json: string | null;
      seed: string;
      status: HololiveBracketStatus;
      current_match_id: string | null;
      created_at: string;
      updated_at: string;
    }>(
      `SELECT id, name, size, generation_style, generation_filters_json, seed, status, current_match_id, created_at, updated_at
       FROM hololive_brackets
       WHERE id = ?`,
      [id]
    )[0];
    if (!bracket) {
      throw new Error(`Unknown Hololive bracket: ${id}`);
    }

    const entries = this.listHololiveBracketEntries(id);
    const entriesById = new Map(entries.map((entry) => [entry.id, entry]));
    const matchRows = this.select<{
      id: string;
      bracket_id: string;
      round_index: number;
      match_index: number;
      entry_a_id: string | null;
      entry_b_id: string | null;
      winner_entry_id: string | null;
      completed_at: string | null;
      updated_at: string;
    }>(
      `SELECT id, bracket_id, round_index, match_index, entry_a_id, entry_b_id, winner_entry_id, completed_at, updated_at
       FROM hololive_bracket_matches
       WHERE bracket_id = ?
       ORDER BY round_index ASC, match_index ASC`,
      [id]
    );
    const matches = matchRows.map<HololiveBracketMatch>((row) => ({
      id: row.id,
      bracketId: row.bracket_id,
      roundIndex: Number(row.round_index),
      matchIndex: Number(row.match_index),
      entryA: row.entry_a_id ? entriesById.get(row.entry_a_id) ?? null : null,
      entryB: row.entry_b_id ? entriesById.get(row.entry_b_id) ?? null : null,
      winnerEntryId: row.winner_entry_id,
      winner: row.winner_entry_id ? entriesById.get(row.winner_entry_id) ?? null : null,
      completedAt: row.completed_at,
      updatedAt: row.updated_at
    }));
    const sizeCount = HOLOLIVE_BRACKET_SIZE_COUNTS[this.normalizeHololiveBracketSize(bracket.size)];
    const rounds = this.groupHololiveBracketMatchesIntoRounds(matches, sizeCount);
    let currentMatch: HololiveBracketMatch | null = null;
    if (bracket.current_match_id) {
      currentMatch = matches.find((match) => match.id === bracket.current_match_id) ?? null;
    }
    currentMatch ??= this.findNextHololiveBracketMatch(matches);
    const finalMatch = matches.find((match) => match.roundIndex === rounds.length - 1 && match.matchIndex === 0);

    return {
      id: bracket.id,
      name: bracket.name,
      size: this.normalizeHololiveBracketSize(bracket.size),
      generationStyle: this.normalizeHololiveBracketGenerationStyle(bracket.generation_style),
      generationFilters: this.normalizeHololiveBracketGenerationFilters(bracket.generation_filters_json),
      seed: bracket.seed,
      status: this.normalizeHololiveBracketStatus(bracket.status),
      currentMatchId: bracket.current_match_id,
      currentMatch,
      champion: finalMatch?.winner ?? null,
      entries,
      rounds,
      createdAt: bracket.created_at,
      updatedAt: bracket.updated_at
    };
  }

  pickHololiveBracketWinner(input: { bracketId: string; matchId: string; winnerEntryId: string }): HololiveBracket {
    const bracketId = input.bracketId.trim();
    const matchId = input.matchId.trim();
    const winnerEntryId = input.winnerEntryId.trim();
    if (!bracketId || !matchId || !winnerEntryId) {
      throw new Error("A bracket, match, and winner are required");
    }

    const match = this.getHololiveBracketMatchRow(bracketId, matchId);
    if (!match.entry_a_id || !match.entry_b_id) {
      throw new Error("This matchup is not ready yet");
    }
    if (winnerEntryId !== match.entry_a_id && winnerEntryId !== match.entry_b_id) {
      throw new Error("The selected winner is not in this matchup");
    }

    const now = new Date().toISOString();
    this.transaction(() => {
      this.clearHololiveBracketDownstream(bracketId, Number(match.round_index), Number(match.match_index), now);
      this.run(
        `UPDATE hololive_bracket_matches
         SET winner_entry_id = ?, completed_at = ?, updated_at = ?
         WHERE id = ? AND bracket_id = ?`,
        [winnerEntryId, now, now, matchId, bracketId]
      );

      const nextMatch = this.getHololiveBracketNextMatchRow(bracketId, Number(match.round_index), Number(match.match_index));
      if (nextMatch) {
        const slotColumn = Number(match.match_index) % 2 === 0 ? "entry_a_id" : "entry_b_id";
        this.run(
          `UPDATE hololive_bracket_matches
           SET ${slotColumn} = ?, updated_at = ?
           WHERE id = ? AND bracket_id = ?`,
          [winnerEntryId, now, nextMatch.id, bracketId]
        );
      }
    });

    this.recomputeHololiveBracketProgress(bracketId);
    return this.getHololiveBracket(bracketId);
  }

  undoHololiveBracket(bracketId: string): HololiveBracket {
    const id = bracketId.trim();
    if (!id) {
      throw new Error("A bracket id is required");
    }

    const latest = this.select<{
      id: string;
      round_index: number;
      match_index: number;
    }>(
      `SELECT id, round_index, match_index
       FROM hololive_bracket_matches
       WHERE bracket_id = ? AND winner_entry_id IS NOT NULL
       ORDER BY COALESCE(completed_at, updated_at) DESC, round_index DESC, match_index DESC
       LIMIT 1`,
      [id]
    )[0];
    if (!latest) {
      return this.getHololiveBracket(id);
    }

    const now = new Date().toISOString();
    this.transaction(() => {
      this.clearHololiveBracketDownstream(id, Number(latest.round_index), Number(latest.match_index), now);
      this.run(
        `UPDATE hololive_bracket_matches
         SET winner_entry_id = NULL, completed_at = NULL, updated_at = ?
         WHERE id = ? AND bracket_id = ?`,
        [now, latest.id, id]
      );
      this.run(
        `UPDATE hololive_brackets
         SET status = 'active', current_match_id = ?, updated_at = ?
         WHERE id = ?`,
        [latest.id, now, id]
      );
    });

    return this.getHololiveBracket(id);
  }

  resetHololiveBracket(bracketId: string): HololiveBracket {
    const id = bracketId.trim();
    if (!id) {
      throw new Error("A bracket id is required");
    }
    this.assertHololiveBracket(id);

    const now = new Date().toISOString();
    this.transaction(() => {
      this.run(
        `UPDATE hololive_bracket_matches
         SET winner_entry_id = NULL, completed_at = NULL, updated_at = ? 
         WHERE bracket_id = ?`,
        [now, id]
      );
      this.run(
        `UPDATE hololive_bracket_matches
         SET entry_a_id = NULL, entry_b_id = NULL, updated_at = ?
         WHERE bracket_id = ? AND round_index > 0`,
        [now, id]
      );
      this.run(
        `UPDATE hololive_brackets
         SET status = 'active', current_match_id = ?, updated_at = ?
         WHERE id = ?`,
        [`${id}:r0:m0`, now, id]
      );
    });

    return this.getHololiveBracket(id);
  }

  deleteHololiveBracket(bracketId: string): HololiveBracketSummary[] {
    const id = bracketId.trim();
    if (!id) {
      throw new Error("A bracket id is required");
    }

    const bracket = this.select<{ status: HololiveBracketStatus }>("SELECT status FROM hololive_brackets WHERE id = ?", [id])[0];
    if (bracket?.status === "complete") {
      this.createBackup("hololive-completed-bracket-delete");
      this.archiveCompletedHololiveBracket(id);
    }

    this.run("DELETE FROM hololive_brackets WHERE id = ?", [id]);
    return this.listHololiveBrackets();
  }

  listHololiveBracketArchives(): HololiveBracketArchiveSummary[] {
    return this.select<{
      id: string;
      source_bracket_id: string;
      name: string;
      size: HololiveBracketSize;
      generation_style: HololiveBracketGenerationStyle;
      generation_filters_json: string | null;
      total_entries: number;
      total_matches: number;
      completed_matches: number;
      champion_youtube_video_id: string | null;
      champion_title: string | null;
      champion_idol_id: string | null;
      champion_idol_name: string | null;
      created_at: string;
      completed_at: string;
      archived_at: string;
    }>(
      `SELECT id, source_bracket_id, name, size, generation_style, generation_filters_json,
              total_entries, total_matches, completed_matches,
              champion_youtube_video_id, champion_title, champion_idol_id, champion_idol_name,
              created_at, completed_at, archived_at
       FROM hololive_bracket_archives
       ORDER BY archived_at DESC, completed_at DESC`
    ).map((row) => ({
      id: row.id,
      sourceBracketId: row.source_bracket_id,
      name: row.name,
      size: this.normalizeHololiveBracketSize(row.size),
      generationStyle: this.normalizeHololiveBracketGenerationStyle(row.generation_style),
      generationFilters: this.normalizeHololiveBracketGenerationFilters(row.generation_filters_json),
      totalEntries: Number(row.total_entries ?? 0),
      totalMatches: Number(row.total_matches ?? 0),
      completedMatches: Number(row.completed_matches ?? 0),
      championYoutubeVideoId: row.champion_youtube_video_id,
      championTitle: row.champion_title,
      championIdolId: row.champion_idol_id,
      championIdolName: row.champion_idol_name,
      createdAt: row.created_at,
      completedAt: row.completed_at,
      archivedAt: row.archived_at
    }));
  }

  deleteHololiveBracketArchive(archiveId: string): HololiveBracketArchiveSummary[] {
    const id = archiveId.trim();
    if (!id) {
      throw new Error("A bracket archive id is required");
    }

    const archive = this.select<{ id: string }>("SELECT id FROM hololive_bracket_archives WHERE id = ?", [id])[0];
    if (!archive) {
      throw new Error(`Unknown Hololive bracket archive: ${id}`);
    }

    const snapshot = {
      archives: this.selectTableRows("hololive_bracket_archives", "WHERE id = ?", [id]),
      entries: this.selectTableRows("hololive_bracket_archive_entries", "WHERE archive_id = ?", [id]),
      matches: this.selectTableRows("hololive_bracket_archive_matches", "WHERE archive_id = ?", [id])
    };
    this.createBackup("hololive-bracket-archive-delete");

    this.transaction(() => {
      this.run("DELETE FROM hololive_bracket_archive_entries WHERE archive_id = ?", [id]);
      this.run("DELETE FROM hololive_bracket_archive_matches WHERE archive_id = ?", [id]);
      this.run("DELETE FROM hololive_bracket_archives WHERE id = ?", [id]);
    });

    this.registerHololiveUndoAction("bracket-archive-delete", "Restore archive", () => {
      this.insertOrReplaceRows("hololive_bracket_archives", snapshot.archives);
      this.insertOrReplaceRows("hololive_bracket_archive_entries", snapshot.entries);
      this.insertOrReplaceRows("hololive_bracket_archive_matches", snapshot.matches);
    });

    return this.listHololiveBracketArchives();
  }

  getHololiveBracketStatsOverview(): HololiveBracketStatsOverview {
    const archives = this.listHololiveBracketArchives();
    const rows = this.select<{
      youtube_video_id: string;
      title_snapshot: string;
      topic_id: HololiveMusicTopic;
      idol_id_snapshot: string;
      idol_name_snapshot: string;
      wins: number;
      losses: number;
      first_round_eliminated: number;
      is_champion: number;
      is_finalist: number;
      is_top4: number;
      is_top8: number;
      is_top16: number;
      archived_at: string;
    }>(
      `SELECT e.youtube_video_id, e.title_snapshot, e.topic_id, e.idol_id_snapshot, e.idol_name_snapshot,
              e.wins, e.losses, e.first_round_eliminated,
              e.is_champion, e.is_finalist, e.is_top4, e.is_top8, e.is_top16,
              a.archived_at
       FROM hololive_bracket_archive_entries e
       INNER JOIN hololive_bracket_archives a ON a.id = e.archive_id
       ORDER BY a.archived_at DESC, e.slot_index ASC`
    );

    const songStats = new Map<string, HololiveBracketSongStats>();
    const talentStats = new Map<string, HololiveBracketTalentStats>();

    for (const row of rows) {
      const wins = Number(row.wins ?? 0);
      const losses = Number(row.losses ?? 0);
      const firstRoundEliminated = Number(row.first_round_eliminated ?? 0);
      const championCount = Number(row.is_champion ?? 0);
      const finalistCount = Number(row.is_finalist ?? 0);
      const top4Count = Number(row.is_top4 ?? 0);
      const top8Count = Number(row.is_top8 ?? 0);
      const top16Count = Number(row.is_top16 ?? 0);

      const song =
        songStats.get(row.youtube_video_id) ??
        ({
          youtubeVideoId: row.youtube_video_id,
          title: row.title_snapshot,
          topicId: this.isHololiveMusicTopic(row.topic_id) ? row.topic_id : null,
          idolId: row.idol_id_snapshot,
          idolName: row.idol_name_snapshot,
          appearances: 0,
          wins: 0,
          losses: 0,
          winRate: 0,
          championCount: 0,
          finalistCount: 0,
          top4Count: 0,
          top8Count: 0,
          top16Count: 0,
          firstRoundEliminations: 0,
          upsetWins: 0,
          revengeWins: 0,
          giantKillerScore: 0,
          lastArchivedAt: row.archived_at
        } satisfies HololiveBracketSongStats);
      song.appearances += 1;
      song.wins += wins;
      song.losses += losses;
      song.championCount += championCount;
      song.finalistCount += finalistCount;
      song.top4Count += top4Count;
      song.top8Count += top8Count;
      song.top16Count += top16Count;
      song.firstRoundEliminations += firstRoundEliminated;
      if (row.archived_at > song.lastArchivedAt) {
        song.title = row.title_snapshot;
        song.topicId = this.isHololiveMusicTopic(row.topic_id) ? row.topic_id : null;
        song.idolId = row.idol_id_snapshot;
        song.idolName = row.idol_name_snapshot;
        song.lastArchivedAt = row.archived_at;
      }
      songStats.set(row.youtube_video_id, song);

      const talent =
        talentStats.get(row.idol_id_snapshot) ??
        ({
          idolId: row.idol_id_snapshot,
          idolName: row.idol_name_snapshot,
          appearances: 0,
          wins: 0,
          losses: 0,
          winRate: 0,
          championCount: 0,
          finalistCount: 0,
          top4Count: 0,
          top8Count: 0,
          top16Count: 0,
          firstRoundEliminations: 0,
          lastArchivedAt: row.archived_at
        } satisfies HololiveBracketTalentStats);
      talent.appearances += 1;
      talent.wins += wins;
      talent.losses += losses;
      talent.championCount += championCount;
      talent.finalistCount += finalistCount;
      talent.top4Count += top4Count;
      talent.top8Count += top8Count;
      talent.top16Count += top16Count;
      talent.firstRoundEliminations += firstRoundEliminated;
      if (row.archived_at > talent.lastArchivedAt) {
        talent.idolName = row.idol_name_snapshot;
        talent.lastArchivedAt = row.archived_at;
      }
      talentStats.set(row.idol_id_snapshot, talent);
    }

    const matchRows = this.select<{
      archived_at: string;
      round_index: number;
      match_index: number;
      winner_youtube_video_id: string;
      loser_youtube_video_id: string | null;
      winner_idol_id: string | null;
      winner_idol_name: string | null;
      winner_view_count: number | null;
      loser_idol_id: string | null;
      loser_idol_name: string | null;
      loser_view_count: number | null;
    }>(
      `SELECT a.archived_at, m.round_index, m.match_index,
              m.winner_youtube_video_id, m.loser_youtube_video_id,
              winner.idol_id_snapshot AS winner_idol_id,
              winner.idol_name_snapshot AS winner_idol_name,
              winner.view_count_snapshot AS winner_view_count,
              loser.idol_id_snapshot AS loser_idol_id,
              loser.idol_name_snapshot AS loser_idol_name,
              loser.view_count_snapshot AS loser_view_count
       FROM hololive_bracket_archive_matches m
       INNER JOIN hololive_bracket_archives a ON a.id = m.archive_id
       LEFT JOIN hololive_bracket_archive_entries winner
         ON winner.archive_id = m.archive_id
        AND winner.youtube_video_id = m.winner_youtube_video_id
       LEFT JOIN hololive_bracket_archive_entries loser
         ON loser.archive_id = m.archive_id
        AND loser.youtube_video_id = m.loser_youtube_video_id
       WHERE m.loser_youtube_video_id IS NOT NULL
       ORDER BY a.archived_at ASC, m.round_index ASC, m.match_index ASC`
    );

    const previousSongResults = new Set<string>();
    const rivalryStats = new Map<string, HololiveBracketRivalryStats>();

    for (const row of matchRows) {
      const loserYoutubeVideoId = row.loser_youtube_video_id;
      if (!loserYoutubeVideoId) {
        continue;
      }

      const winnerSong = songStats.get(row.winner_youtube_video_id);
      const loserSong = songStats.get(loserYoutubeVideoId);
      if (winnerSong) {
        const winnerViews = row.winner_view_count == null ? null : Number(row.winner_view_count);
        const loserViews = row.loser_view_count == null ? null : Number(row.loser_view_count);
        if (winnerViews != null && loserViews != null && winnerViews < loserViews) {
          winnerSong.upsetWins += 1;
          winnerSong.giantKillerScore += loserViews - winnerViews;
        }

        if (previousSongResults.has(`${loserYoutubeVideoId}|${row.winner_youtube_video_id}`)) {
          winnerSong.revengeWins += 1;
        }
      }

      previousSongResults.add(`${row.winner_youtube_video_id}|${loserYoutubeVideoId}`);

      const winnerIdolId = row.winner_idol_id ?? winnerSong?.idolId ?? null;
      const loserIdolId = row.loser_idol_id ?? loserSong?.idolId ?? null;
      if (!winnerIdolId || !loserIdolId || winnerIdolId === loserIdolId) {
        continue;
      }

      const winnerIdolName = row.winner_idol_name ?? winnerSong?.idolName ?? winnerIdolId;
      const loserIdolName = row.loser_idol_name ?? loserSong?.idolName ?? loserIdolId;
      const [left, right] = [
        { id: winnerIdolId, name: winnerIdolName },
        { id: loserIdolId, name: loserIdolName }
      ].sort((leftValue, rightValue) => leftValue.name.localeCompare(rightValue.name) || leftValue.id.localeCompare(rightValue.id));
      const key = `${left.id}|${right.id}`;
      const rivalry =
        rivalryStats.get(key) ??
        ({
          key,
          leftIdolId: left.id,
          leftIdolName: left.name,
          rightIdolId: right.id,
          rightIdolName: right.name,
          matches: 0,
          leftWins: 0,
          rightWins: 0,
          lastArchivedAt: row.archived_at
        } satisfies HololiveBracketRivalryStats);
      rivalry.matches += 1;
      if (winnerIdolId === rivalry.leftIdolId) {
        rivalry.leftWins += 1;
      } else {
        rivalry.rightWins += 1;
      }
      if (row.archived_at > rivalry.lastArchivedAt) {
        rivalry.lastArchivedAt = row.archived_at;
      }
      rivalryStats.set(key, rivalry);
    }

    const finalizeWinRate = <T extends { wins: number; losses: number; winRate: number }>(items: T[]): T[] =>
      items.map((item) => ({
        ...item,
        winRate: item.wins + item.losses > 0 ? item.wins / (item.wins + item.losses) : 0
      }));

    const songs = finalizeWinRate([...songStats.values()]);
    const talents = finalizeWinRate([...talentStats.values()]);
    const byWins = (left: HololiveBracketSongStats | HololiveBracketTalentStats, right: HololiveBracketSongStats | HololiveBracketTalentStats) =>
      right.wins - left.wins ||
      right.championCount - left.championCount ||
      right.appearances - left.appearances ||
      ("title" in left ? left.title.localeCompare((right as HololiveBracketSongStats).title) : left.idolName.localeCompare((right as HololiveBracketTalentStats).idolName));
    const bySongTitle = (left: HololiveBracketSongStats, right: HololiveBracketSongStats) => left.title.localeCompare(right.title);
    const finalsWithoutTitle = (song: HololiveBracketSongStats) => Math.max(0, song.finalistCount - song.championCount);
    const giantKillerAverageScore = (song: HololiveBracketSongStats) => (song.upsetWins > 0 ? song.giantKillerScore / song.upsetWins : 0);
    const rivalries = [...rivalryStats.values()];

    return {
      totals: {
        completedBrackets: archives.length,
        totalMatches: archives.reduce((sum, archive) => sum + archive.completedMatches, 0),
        uniqueSongs: songStats.size,
        uniqueTalents: talentStats.size
      },
      topSongsByWins: [...songs].sort(byWins).slice(0, 10),
      topSongsByWinRate: [...songs]
        .filter((song) => song.wins + song.losses > 0)
        .sort((left, right) => right.winRate - left.winRate || right.wins - left.wins || right.appearances - left.appearances)
        .slice(0, 10),
      topSongsByAppearances: [...songs]
        .sort((left, right) => right.appearances - left.appearances || right.wins - left.wins || left.title.localeCompare(right.title))
        .slice(0, 10),
      topSongsByFinalsWithoutTitle: [...songs]
        .filter((song) => finalsWithoutTitle(song) > 0)
        .sort(
          (left, right) =>
            finalsWithoutTitle(right) - finalsWithoutTitle(left) ||
            right.finalistCount - left.finalistCount ||
            right.top4Count - left.top4Count ||
            byWins(left, right)
        )
        .slice(0, 10),
      topSongsByFirstRoundEliminations: [...songs]
        .filter((song) => song.firstRoundEliminations > 0)
        .sort(
          (left, right) =>
            right.firstRoundEliminations - left.firstRoundEliminations ||
            right.appearances - left.appearances ||
            right.losses - left.losses ||
            left.title.localeCompare(right.title)
        )
        .slice(0, 10),
      topSongsByUpsetWins: [...songs]
        .filter((song) => song.upsetWins > 0)
        .sort((left, right) => right.upsetWins - left.upsetWins || right.giantKillerScore - left.giantKillerScore || right.wins - left.wins || bySongTitle(left, right))
        .slice(0, 10),
      topSongsByRevengeWins: [...songs]
        .filter((song) => song.revengeWins > 0)
        .sort((left, right) => right.revengeWins - left.revengeWins || right.wins - left.wins || right.upsetWins - left.upsetWins || bySongTitle(left, right))
        .slice(0, 10),
      topSongsByGiantKillerScore: [...songs]
        .filter((song) => song.giantKillerScore > 0)
        .sort((left, right) => right.giantKillerScore - left.giantKillerScore || right.upsetWins - left.upsetWins || right.wins - left.wins || bySongTitle(left, right))
        .slice(0, 10),
      topSongsByGiantKillerAverage: [...songs]
        .filter((song) => song.giantKillerScore > 0 && song.upsetWins > 0)
        .sort(
          (left, right) =>
            giantKillerAverageScore(right) - giantKillerAverageScore(left) ||
            right.giantKillerScore - left.giantKillerScore ||
            right.upsetWins - left.upsetWins ||
            right.wins - left.wins ||
            bySongTitle(left, right)
        )
        .slice(0, 10),
      topTalents: [...talents].sort(byWins).slice(0, 10),
      topTalentsByTop4: [...talents]
        .filter((talent) => talent.top4Count > 0)
        .sort((left, right) => right.top4Count - left.top4Count || right.championCount - left.championCount || right.winRate - left.winRate || byWins(left, right))
        .slice(0, 10),
      topRivalries: rivalries
        .sort(
          (left, right) =>
            right.matches - left.matches ||
            Math.min(right.leftWins, right.rightWins) - Math.min(left.leftWins, left.rightWins) ||
            right.lastArchivedAt.localeCompare(left.lastArchivedAt) ||
            left.key.localeCompare(right.key)
        )
        .slice(0, 10),
      championHistory: archives.slice(0, 12)
    };
  }

  private generateHololiveBracketEntries(
    bracketId: string,
    size: HololiveBracketSize,
    seed: string,
    generationStyle: HololiveBracketGenerationStyle,
    generationFilters: HololiveBracketGenerationFilters
  ): HololiveBracketEntry[] {
    const sizeCount = HOLOLIVE_BRACKET_SIZE_COUNTS[size];
    const pools = this.loadHololiveBracketCandidatePools(generationFilters);
    const selected =
      generationStyle === "random_songs"
        ? this.generateRandomHololiveBracketCandidates(sizeCount, seed, pools)
        : this.generateTopHololiveBracketCandidates(sizeCount, seed, pools);

    if (selected.length < sizeCount) {
      throw new Error(
        `Only ${selected.length} eligible official Hololive songs are available for ${HOLOLIVE_BRACKET_GENERATION_STYLE_LABELS[generationStyle]} ${HOLOLIVE_BRACKET_SIZE_LABELS[size]}.`
      );
    }

    return this.seedHololiveBracketFirstRoundSlots(selected, seed, size, generationStyle).map((candidate, slotIndex) =>
      this.toHololiveBracketEntry(bracketId, slotIndex, candidate)
    );
  }

  private seedHololiveBracketFirstRoundSlots(
    selected: HololiveBracketCandidate[],
    seed: string,
    size: HololiveBracketSize,
    generationStyle: HololiveBracketGenerationStyle
  ): HololiveBracketCandidate[] {
    const seeded = this.findBestHololiveBracketSlotArrangement(selected, seed);
    if (!seeded || this.hasHololiveBracketFirstRoundTalentConflict(seeded)) {
      throw new Error(
        `Could not seed ${HOLOLIVE_BRACKET_GENERATION_STYLE_LABELS[generationStyle]} ${HOLOLIVE_BRACKET_SIZE_LABELS[size]} without same-talent first-round matchups.`
      );
    }
    return seeded;
  }

  private findBestHololiveBracketSlotArrangement(
    selected: HololiveBracketCandidate[],
    seed: string
  ): HololiveBracketCandidate[] | null {
    const attempts = Math.max(64, Math.min(384, selected.length * 3));
    let best: HololiveBracketCandidate[] | null = null;
    let bestScore = Number.POSITIVE_INFINITY;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const shuffled = this.shuffleWithHololiveBracketSeed(selected, `${seed}:slots:${attempt}`);
      const arranged = this.arrangeHololiveBracketFirstRoundSlots(shuffled, `${seed}:first-round:${attempt}`);
      if (!arranged) {
        continue;
      }
      const score = this.scoreHololiveBracketTalentSpread(arranged);
      if (score < bestScore) {
        best = arranged;
        bestScore = score;
        if (score === 0) {
          break;
        }
      }
    }

    return best;
  }

  private scoreHololiveBracketTalentSpread(candidates: HololiveBracketCandidate[]): number {
    if (this.hasHololiveBracketFirstRoundTalentConflict(candidates)) {
      return Number.POSITIVE_INFINITY;
    }

    const positionsByTalent = new Map<string, number[]>();
    candidates.forEach((candidate, index) => {
      const positions = positionsByTalent.get(candidate.idolIdForBracket) ?? [];
      positions.push(index);
      positionsByTalent.set(candidate.idolIdForBracket, positions);
    });

    let score = 0;
    for (const positions of positionsByTalent.values()) {
      for (let leftIndex = 0; leftIndex < positions.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < positions.length; rightIndex += 1) {
          const left = positions[leftIndex];
          const right = positions[rightIndex];
          let blockSize = 2;
          while (blockSize < candidates.length && Math.floor(left / blockSize) !== Math.floor(right / blockSize)) {
            blockSize *= 2;
          }
          score += Math.floor(candidates.length / blockSize) * 100;
          const visualDistance = Math.abs(left - right);
          score += Math.max(0, 12 - visualDistance);
        }
      }
    }
    return score;
  }

  private arrangeHololiveBracketFirstRoundSlots(
    candidates: HololiveBracketCandidate[],
    seed: string
  ): HololiveBracketCandidate[] | null {
    if (candidates.length % 2 !== 0) {
      return null;
    }
    if (!this.hasHololiveBracketFirstRoundTalentConflict(candidates)) {
      return candidates;
    }

    const groups = new Map<string, HololiveBracketCandidate[]>();
    for (const candidate of candidates) {
      const group = groups.get(candidate.idolIdForBracket) ?? [];
      group.push(candidate);
      groups.set(candidate.idolIdForBracket, group);
    }

    const maxTalentEntries = Math.max(...[...groups.values()].map((group) => group.length));
    if (maxTalentEntries > candidates.length / 2) {
      return null;
    }

    const talentRanks = new Map(
      this.shuffleWithHololiveBracketSeed([...groups.keys()], `${seed}:talents`).map((idolId, index) => [idolId, index])
    );
    const mutableGroups = [...groups.entries()].map(([idolId, rows]) => ({
      idolId,
      rows: this.shuffleWithHololiveBracketSeed(rows, `${seed}:talent:${idolId}`)
    }));

    const pairs: Array<[HololiveBracketCandidate, HololiveBracketCandidate]> = [];
    let remaining = candidates.length;
    while (remaining > 0) {
      const activeGroups = mutableGroups
        .filter((group) => group.rows.length > 0)
        .sort(
          (left, right) =>
            right.rows.length - left.rows.length ||
            (talentRanks.get(left.idolId) ?? 0) - (talentRanks.get(right.idolId) ?? 0)
        );
      if (activeGroups.length < 2) {
        return null;
      }

      const left = activeGroups[0].rows.shift();
      const right = activeGroups[1].rows.shift();
      if (!left || !right || left.idolIdForBracket === right.idolIdForBracket) {
        return null;
      }
      pairs.push([left, right]);
      remaining -= 2;
    }

    return this.shuffleWithHololiveBracketSeed(pairs, `${seed}:pairs`).flatMap((pair, index) =>
      this.shuffleWithHololiveBracketSeed(pair, `${seed}:pair-side:${index}`)
    );
  }

  private hasHololiveBracketFirstRoundTalentConflict(candidates: HololiveBracketCandidate[]): boolean {
    for (let index = 0; index < candidates.length; index += 2) {
      const left = candidates[index];
      const right = candidates[index + 1];
      if (left && right && left.idolIdForBracket === right.idolIdForBracket) {
        return true;
      }
    }
    return false;
  }

  private loadHololiveBracketCandidatePools(generationFilters: HololiveBracketGenerationFilters): HololiveBracketCandidatePools {
    const includedTalentIds = Array.isArray(generationFilters.includedTalentIds) ? new Set(generationFilters.includedTalentIds) : null;
    const officialIdols = this.getOfficialHololiveIdolsBySubscriberPriority().filter(
      (idol) => includedTalentIds === null || includedTalentIds.has(idol.id)
    );
    const historyExclusions = this.getHololiveBracketHistoryExclusions(generationFilters);
    const originalsByIdol = new Map<string, HololiveBracketCandidate[]>();
    const coversByIdol = new Map<string, HololiveBracketCandidate[]>();
    const allByIdol = new Map<string, HololiveBracketCandidate[]>();

    for (const idol of officialIdols) {
      let originals = this.getHololiveBracketCandidatesForIdol(idol, "Original_Song", generationFilters, historyExclusions);
      let covers = this.getHololiveBracketCandidatesForIdol(idol, "Music_Cover", generationFilters, historyExclusions);
      if (generationFilters.excludeTopViewedPerTalent) {
        const topCandidate = this.sortHololiveBracketCandidates([...originals, ...covers])[0];
        const topKey = topCandidate ? this.getHololiveBracketCanonicalKey(topCandidate) : null;
        if (topKey) {
          originals = originals.filter((candidate) => this.getHololiveBracketCanonicalKey(candidate) !== topKey);
          covers = covers.filter((candidate) => this.getHololiveBracketCanonicalKey(candidate) !== topKey);
        }
      }
      originalsByIdol.set(idol.id, originals);
      coversByIdol.set(idol.id, covers);
      allByIdol.set(idol.id, this.sortHololiveBracketCandidates([...originals, ...covers]));
    }

    return { officialIdols, originalsByIdol, coversByIdol, allByIdol };
  }

  private getHololiveBracketHistoryExclusions(
    filters: HololiveBracketGenerationFilters
  ): HololiveBracketHistoryExclusions {
    const clauses: string[] = [];
    if (filters.excludePreviousChampions) {
      clauses.push("is_champion = 1");
    }
    if (filters.excludePreviousFinalists) {
      clauses.push("is_finalist = 1");
    }
    if (filters.excludePreviousTop4) {
      clauses.push("is_top4 = 1");
    }
    if (filters.excludePreviousTop8) {
      clauses.push("is_top8 = 1");
    }

    const exclusions: HololiveBracketHistoryExclusions = {
      youtubeVideoIds: new Set(),
      canonicalPerformanceKeys: new Set()
    };
    if (clauses.length === 0) {
      return exclusions;
    }

    const rows = this.select<{ youtube_video_id: string; canonical_performance_key: string | null }>(
      `SELECT youtube_video_id, canonical_performance_key
       FROM hololive_bracket_archive_entries
       WHERE ${clauses.map((clause) => `(${clause})`).join(" OR ")}`
    );
    for (const row of rows) {
      exclusions.youtubeVideoIds.add(row.youtube_video_id);
      const key = row.canonical_performance_key?.trim();
      if (key) {
        exclusions.canonicalPerformanceKeys.add(key);
      }
    }
    return exclusions;
  }

  private generateTopHololiveBracketCandidates(
    sizeCount: number,
    seed: string,
    pools: HololiveBracketCandidatePools
  ): HololiveBracketCandidate[] {
    const selected: HololiveBracketCandidate[] = [];
    const usedCanonicalKeys = new Set<string>();
    const selectedTopicsByIdol = new Map<string, Set<HololiveMusicTopic>>();
    const selectedCountsByIdol = new Map<string, number>();
    const addCandidate = (candidate: HololiveBracketCandidate | null | undefined): boolean => {
      if (!candidate || selected.length >= sizeCount) {
        return false;
      }
      const key = this.getHololiveBracketCanonicalKey(candidate);
      if (usedCanonicalKeys.has(key)) {
        return false;
      }
      usedCanonicalKeys.add(key);
      selected.push(candidate);
      selectedCountsByIdol.set(candidate.idolIdForBracket, (selectedCountsByIdol.get(candidate.idolIdForBracket) ?? 0) + 1);
      const topics = selectedTopicsByIdol.get(candidate.idolIdForBracket) ?? new Set<HololiveMusicTopic>();
      topics.add(candidate.topicId);
      selectedTopicsByIdol.set(candidate.idolIdForBracket, topics);
      return true;
    };
    const globalCandidates = this.sortHololiveBracketCandidates(
      pools.officialIdols.flatMap((idol) => pools.allByIdol.get(idol.id) ?? [])
    );

    for (const candidate of globalCandidates) {
      if (selected.length >= sizeCount) {
        break;
      }
      if ((selectedCountsByIdol.get(candidate.idolIdForBracket) ?? 0) >= 2) {
        continue;
      }
      if (selectedTopicsByIdol.get(candidate.idolIdForBracket)?.has(candidate.topicId)) {
        continue;
      }
      addCandidate(candidate);
    }

    let pass = 0;
    while (selected.length < sizeCount) {
      let addedThisPass = 0;
      const passOrder = this.shuffleWithHololiveBracketSeed(pools.officialIdols, `${seed}:extra:${pass}`);
      for (const idol of passOrder) {
        if (selected.length >= sizeCount) {
          break;
        }
        const candidate = (pools.allByIdol.get(idol.id) ?? []).find(
          (row) => !usedCanonicalKeys.has(this.getHololiveBracketCanonicalKey(row))
        );
        if (addCandidate(candidate)) {
          addedThisPass += 1;
        }
      }

      if (addedThisPass === 0) {
        break;
      }
      pass += 1;
    }

    return selected;
  }

  private generateRandomHololiveBracketCandidates(
    sizeCount: number,
    seed: string,
    pools: HololiveBracketCandidatePools
  ): HololiveBracketCandidate[] {
    const selected: HololiveBracketCandidate[] = [];
    const usedCanonicalKeys = new Set<string>();
    const pickedTopicsByIdol = new Map<string, Set<HololiveMusicTopic>>();

    const availableCandidates = (idolId: string, topicId?: HololiveMusicTopic): HololiveBracketCandidate[] => {
      const rows = topicId
        ? topicId === "Original_Song"
          ? pools.originalsByIdol.get(idolId) ?? []
          : pools.coversByIdol.get(idolId) ?? []
        : pools.allByIdol.get(idolId) ?? [];
      return rows.filter((row) => !usedCanonicalKeys.has(this.getHololiveBracketCanonicalKey(row)));
    };

    const chooseRandomCandidate = (
      idolId: string,
      topicId: HololiveMusicTopic | undefined,
      seedPart: string
    ): HololiveBracketCandidate | undefined =>
      this.shuffleWithHololiveBracketSeed(availableCandidates(idolId, topicId), seedPart)[0];

    const addCandidate = (candidate: HololiveBracketCandidate | null | undefined): boolean => {
      if (!candidate || selected.length >= sizeCount) {
        return false;
      }
      const key = this.getHololiveBracketCanonicalKey(candidate);
      if (usedCanonicalKeys.has(key)) {
        return false;
      }
      usedCanonicalKeys.add(key);
      selected.push(candidate);
      const pickedTopics = pickedTopicsByIdol.get(candidate.idolIdForBracket) ?? new Set<HololiveMusicTopic>();
      pickedTopics.add(candidate.topicId);
      pickedTopicsByIdol.set(candidate.idolIdForBracket, pickedTopics);
      return true;
    };

    const chooseExtraCandidate = (idolId: string, pass: number): HololiveBracketCandidate | undefined => {
      const pickedTopics = pickedTopicsByIdol.get(idolId) ?? new Set<HololiveMusicTopic>();
      const preferredTopic =
        pickedTopics.has("Original_Song") && !pickedTopics.has("Music_Cover")
          ? "Music_Cover"
          : pickedTopics.has("Music_Cover") && !pickedTopics.has("Original_Song")
            ? "Original_Song"
            : undefined;

      if (preferredTopic) {
        const preferred = chooseRandomCandidate(idolId, preferredTopic, `${seed}:random:extra:${pass}:${idolId}:${preferredTopic}`);
        if (preferred) {
          return preferred;
        }
      }

      return chooseRandomCandidate(idolId, undefined, `${seed}:random:extra:${pass}:${idolId}:fallback`);
    };

    const firstPass = this.shuffleWithHololiveBracketSeed(pools.officialIdols, `${seed}:random:first`);
    for (const idol of firstPass) {
      if (selected.length >= sizeCount) {
        break;
      }
      addCandidate(chooseRandomCandidate(idol.id, undefined, `${seed}:random:first:${idol.id}`));
    }

    let pass = 1;
    while (selected.length < sizeCount) {
      let addedThisPass = 0;
      const passOrder = this.shuffleWithHololiveBracketSeed(pools.officialIdols, `${seed}:random:pass:${pass}`);
      for (const idol of passOrder) {
        if (selected.length >= sizeCount) {
          break;
        }
        if (addCandidate(chooseExtraCandidate(idol.id, pass))) {
          addedThisPass += 1;
        }
      }

      if (addedThisPass === 0) {
        break;
      }
      pass += 1;
    }

    return selected;
  }

  private getOfficialHololiveIdolsBySubscriberPriority(): HololiveIdol[] {
    const channelsById = new Map(this.listHololiveChannels().map((channel) => [channel.id, channel]));
    return this.listHololiveIdols()
      .filter((idol) => idol.source === "official")
      .sort((left, right) => {
        const leftSubscribers = left.youtubeChannelId ? channelsById.get(left.youtubeChannelId)?.subscriberCount ?? 0 : 0;
        const rightSubscribers = right.youtubeChannelId ? channelsById.get(right.youtubeChannelId)?.subscriberCount ?? 0 : 0;
        if (leftSubscribers !== rightSubscribers) {
          return rightSubscribers - leftSubscribers;
        }
        return left.sortOrder - right.sortOrder || left.displayName.localeCompare(right.displayName);
      });
  }

  private getHololiveBracketCandidatesForIdol(
    idol: HololiveIdol,
    topicId: HololiveMusicTopic,
    generationFilters: HololiveBracketGenerationFilters,
    historyExclusions: HololiveBracketHistoryExclusions
  ): HololiveBracketCandidate[] {
    const rows = this.listHololiveMusicRows({
      idolId: idol.id,
      topicId,
      assignment: "owned",
      dedupeCanonicalPerformance: true,
      limit: 500
    })
      .filter((row) => this.matchesHololiveBracketGenerationFilters(row, generationFilters, historyExclusions))
      .map<HololiveBracketCandidate>((row) => ({
        ...row,
        idolIdForBracket: idol.id,
        idolNameForBracket: idol.displayName
      }));
    return this.sortHololiveBracketCandidates(rows);
  }

  private matchesHololiveBracketGenerationFilters(
    row: HololiveMusicRow,
    filters: HololiveBracketGenerationFilters,
    historyExclusions: HololiveBracketHistoryExclusions
  ): boolean {
    const excludedTopics = new Set(filters.excludeTopicIds ?? []);
    if (excludedTopics.has(row.topicId)) {
      return false;
    }

    const canonicalKey = this.getHololiveBracketCanonicalKey(row);
    if (
      historyExclusions.youtubeVideoIds.has(row.youtubeVideoId) ||
      historyExclusions.canonicalPerformanceKeys.has(canonicalKey)
    ) {
      return false;
    }

    if (filters.ratingBuckets?.length) {
      const allowedRatingBuckets = new Set(filters.ratingBuckets);
      const ratingBucket: HololiveBracketRatingBucket = row.marker ?? "unrated";
      if (!allowedRatingBuckets.has(ratingBucket)) {
        return false;
      }
    } else {
      if (filters.excludeRated && row.marker) {
        return false;
      }

      if (filters.excludeDisliked && row.marker === "dislike") {
        return false;
      }
    }

    const viewCount = typeof row.viewCount === "number" ? row.viewCount : Number.NaN;
    if (filters.excludeAboveViews !== null && filters.excludeAboveViews !== undefined) {
      if (!Number.isFinite(viewCount) || viewCount > filters.excludeAboveViews) {
        return false;
      }
    }

    if (filters.excludeBelowViews !== null && filters.excludeBelowViews !== undefined) {
      if (!Number.isFinite(viewCount) || viewCount < filters.excludeBelowViews) {
        return false;
      }
    }

    const publishedTime = row.publishedAt ? Date.parse(row.publishedAt) : Number.NaN;
    if (filters.excludeBeforeDate) {
      const boundary = Date.parse(`${filters.excludeBeforeDate}T00:00:00.000Z`);
      if (!Number.isFinite(publishedTime) || !Number.isFinite(boundary) || publishedTime < boundary) {
        return false;
      }
    }

    if (filters.excludeAfterDate) {
      const boundary = Date.parse(`${filters.excludeAfterDate}T23:59:59.999Z`);
      if (!Number.isFinite(publishedTime) || !Number.isFinite(boundary) || publishedTime > boundary) {
        return false;
      }
    }

    return true;
  }

  private sortHololiveBracketCandidates<T extends HololiveBracketCandidate>(rows: T[]): T[] {
    return [...rows].sort((left, right) => {
      const leftHasViews = Number.isFinite(left.viewCount);
      const rightHasViews = Number.isFinite(right.viewCount);
      if (leftHasViews && rightHasViews && left.viewCount !== right.viewCount) {
        return Number(right.viewCount) - Number(left.viewCount);
      }
      if (leftHasViews !== rightHasViews) {
        return leftHasViews ? -1 : 1;
      }

      const dateCompare = (right.publishedAt ?? "").localeCompare(left.publishedAt ?? "");
      if (dateCompare !== 0) {
        return dateCompare;
      }

      return (
        (left.songName || left.title).localeCompare(right.songName || right.title) ||
        left.youtubeVideoId.localeCompare(right.youtubeVideoId)
      );
    });
  }

  private toHololiveBracketEntry(
    bracketId: string,
    slotIndex: number,
    row: HololiveBracketCandidate
  ): HololiveBracketEntry {
    const title = row.songName || row.title;
    return {
      id: `${bracketId}:entry:${slotIndex}`,
      bracketId,
      slotIndex,
      youtubeVideoId: row.youtubeVideoId,
      title,
      songName: row.songName,
      topicId: row.topicId,
      youtubeUrl: row.youtubeUrl,
      channelName: row.channelName,
      idolId: row.idolIdForBracket,
      idolName: row.idolNameForBracket,
      canonicalPerformanceKey: this.getHololiveBracketCanonicalKey(row),
      viewCount: row.viewCount,
      publishedAt: row.publishedAt,
      durationSeconds: row.durationSeconds
    };
  }

  private getHololiveBracketCanonicalKey(row: Pick<HololiveMusicRow, "canonicalPerformanceKey" | "youtubeVideoId">): string {
    return row.canonicalPerformanceKey?.trim() || `video:${row.youtubeVideoId}`;
  }

  private listHololiveBracketEntries(bracketId: string): HololiveBracketEntry[] {
    return this.select<{
      id: string;
      bracket_id: string;
      slot_index: number;
      youtube_video_id: string;
      title: string;
      song_name: string | null;
      topic_id: HololiveMusicTopic;
      youtube_url: string;
      channel_name: string;
      idol_id: string;
      idol_name: string;
      canonical_performance_key: string;
      view_count: number | null;
      published_at: string | null;
      duration_seconds: number | null;
    }>(
      `SELECT id, bracket_id, slot_index, youtube_video_id, title, song_name, topic_id, youtube_url, channel_name,
              idol_id, idol_name, canonical_performance_key, view_count, published_at, duration_seconds
       FROM hololive_bracket_entries
       WHERE bracket_id = ?
       ORDER BY slot_index ASC`,
      [bracketId]
    ).map((row) => ({
      id: row.id,
      bracketId: row.bracket_id,
      slotIndex: Number(row.slot_index),
      youtubeVideoId: row.youtube_video_id,
      title: row.title,
      songName: row.song_name,
      topicId: row.topic_id,
      youtubeUrl: row.youtube_url,
      channelName: row.channel_name,
      idolId: row.idol_id,
      idolName: row.idol_name,
      canonicalPerformanceKey: row.canonical_performance_key,
      viewCount: row.view_count,
      publishedAt: row.published_at,
      durationSeconds: row.duration_seconds
    }));
  }

  private groupHololiveBracketMatchesIntoRounds(
    matches: HololiveBracketMatch[],
    sizeCount: number
  ): HololiveBracketRound[] {
    const byRound = new Map<number, HololiveBracketMatch[]>();
    for (const match of matches) {
      const round = byRound.get(match.roundIndex) ?? [];
      round.push(match);
      byRound.set(match.roundIndex, round);
    }

    return [...byRound.entries()]
      .sort(([left], [right]) => left - right)
      .map(([roundIndex, roundMatches]) => ({
        roundIndex,
        label: this.getHololiveBracketRoundLabel(sizeCount, roundIndex),
        matches: roundMatches.sort((left, right) => left.matchIndex - right.matchIndex)
      }));
  }

  private getHololiveBracketRoundLabel(sizeCount: number, roundIndex: number): string {
    return hololiveBracketRoundLabel(sizeCount, roundIndex);
  }

  private findNextHololiveBracketMatch(matches: HololiveBracketMatch[]): HololiveBracketMatch | null {
    return (
      [...matches]
        .sort((left, right) => left.roundIndex - right.roundIndex || left.matchIndex - right.matchIndex)
        .find((match) => Boolean(match.entryA && match.entryB && !match.winnerEntryId)) ?? null
    );
  }

  private getHololiveBracketMatchRow(bracketId: string, matchId: string): {
    id: string;
    bracket_id: string;
    round_index: number;
    match_index: number;
    entry_a_id: string | null;
    entry_b_id: string | null;
    winner_entry_id: string | null;
  } {
    const row = this.select<{
      id: string;
      bracket_id: string;
      round_index: number;
      match_index: number;
      entry_a_id: string | null;
      entry_b_id: string | null;
      winner_entry_id: string | null;
    }>(
      `SELECT id, bracket_id, round_index, match_index, entry_a_id, entry_b_id, winner_entry_id
       FROM hololive_bracket_matches
       WHERE id = ? AND bracket_id = ?`,
      [matchId, bracketId]
    )[0];
    if (!row) {
      throw new Error(`Unknown Hololive bracket match: ${matchId}`);
    }
    return row;
  }

  private getHololiveBracketNextMatchRow(
    bracketId: string,
    roundIndex: number,
    matchIndex: number
  ): { id: string; winner_entry_id: string | null } | null {
    return (
      this.select<{ id: string; winner_entry_id: string | null }>(
        `SELECT id, winner_entry_id
         FROM hololive_bracket_matches
         WHERE bracket_id = ? AND round_index = ? AND match_index = ?`,
        [bracketId, roundIndex + 1, Math.floor(matchIndex / 2)]
      )[0] ?? null
    );
  }

  private clearHololiveBracketDownstream(
    bracketId: string,
    roundIndex: number,
    matchIndex: number,
    timestamp: string
  ): void {
    const nextMatch = this.getHololiveBracketNextMatchRow(bracketId, roundIndex, matchIndex);
    if (!nextMatch) {
      return;
    }

    const nextRoundIndex = roundIndex + 1;
    const nextMatchIndex = Math.floor(matchIndex / 2);
    const slotColumn = matchIndex % 2 === 0 ? "entry_a_id" : "entry_b_id";
    this.run(
      `UPDATE hololive_bracket_matches
       SET ${slotColumn} = NULL, winner_entry_id = NULL, completed_at = NULL, updated_at = ?
       WHERE id = ? AND bracket_id = ?`,
      [timestamp, nextMatch.id, bracketId]
    );
    this.clearHololiveBracketDownstream(bracketId, nextRoundIndex, nextMatchIndex, timestamp);
  }

  private recomputeHololiveBracketProgress(bracketId: string): void {
    this.assertHololiveBracket(bracketId);
    const rows = this.select<{
      id: string;
      round_index: number;
      match_index: number;
      entry_a_id: string | null;
      entry_b_id: string | null;
      winner_entry_id: string | null;
    }>(
      `SELECT id, round_index, match_index, entry_a_id, entry_b_id, winner_entry_id
       FROM hololive_bracket_matches
       WHERE bracket_id = ?
       ORDER BY round_index ASC, match_index ASC`,
      [bracketId]
    );
    const nextMatch = rows.find((row) => row.entry_a_id && row.entry_b_id && !row.winner_entry_id) ?? null;
    const finalRound = rows.reduce((max, row) => Math.max(max, Number(row.round_index)), 0);
    const finalMatch = rows.find((row) => Number(row.round_index) === finalRound && Number(row.match_index) === 0);
    const status: HololiveBracketStatus = finalMatch?.winner_entry_id ? "complete" : "active";
    const now = new Date().toISOString();

    this.run(
      `UPDATE hololive_brackets
       SET status = ?, current_match_id = ?, updated_at = ?
       WHERE id = ?`,
      [status, status === "complete" ? null : nextMatch?.id ?? null, now, bracketId]
    );

    if (status === "complete") {
      this.archiveCompletedHololiveBracket(bracketId);
    }
  }

  private archiveCompletedHololiveBracket(bracketId: string): void {
    const bracket = this.getHololiveBracket(bracketId);
    if (bracket.status !== "complete" || !bracket.champion) {
      return;
    }

    const archiveId = `archive:${bracket.id}`;
    const matches = bracket.rounds.flatMap((round) => round.matches);
    const completedMatches = matches.filter((match) => match.winnerEntryId);
    const finalRoundIndex = Math.max(0, ...matches.map((match) => match.roundIndex));
    const finalMatch = matches.find((match) => match.roundIndex === finalRoundIndex && match.matchIndex === 0);
    const completedAt = finalMatch?.completedAt ?? new Date().toISOString();
    const archivedAt = new Date().toISOString();
    const entryStats = new Map<
      string,
      {
        wins: number;
        losses: number;
        eliminatedRoundIndex: number | null;
        eliminatedByYoutubeVideoId: string | null;
      }
    >();

    for (const entry of bracket.entries) {
      entryStats.set(entry.id, {
        wins: 0,
        losses: 0,
        eliminatedRoundIndex: null,
        eliminatedByYoutubeVideoId: null
      });
    }

    for (const match of completedMatches) {
      if (!match.winnerEntryId) {
        continue;
      }
      const winnerStats = entryStats.get(match.winnerEntryId);
      if (winnerStats) {
        winnerStats.wins += 1;
      }

      const loser = [match.entryA, match.entryB].find((entry) => entry && entry.id !== match.winnerEntryId) ?? null;
      if (loser) {
        const loserStats = entryStats.get(loser.id);
        if (loserStats) {
          loserStats.losses += 1;
          loserStats.eliminatedRoundIndex = match.roundIndex;
          loserStats.eliminatedByYoutubeVideoId = match.winner?.youtubeVideoId ?? null;
        }
      }
    }

    const participantIdsByRound = new Map<number, Set<string>>();
    for (const match of matches) {
      const ids = participantIdsByRound.get(match.roundIndex) ?? new Set<string>();
      if (match.entryA) {
        ids.add(match.entryA.id);
      }
      if (match.entryB) {
        ids.add(match.entryB.id);
      }
      participantIdsByRound.set(match.roundIndex, ids);
    }

    const reachedRound = (entryId: string, entrants: number): boolean => {
      const roundIndex = Math.max(0, finalRoundIndex - Math.log2(entrants) + 1);
      for (let index = Math.ceil(roundIndex); index <= finalRoundIndex; index += 1) {
        if (participantIdsByRound.get(index)?.has(entryId)) {
          return true;
        }
      }
      return false;
    };

    const finalistIds = new Set([finalMatch?.entryA?.id, finalMatch?.entryB?.id].filter((id): id is string => Boolean(id)));
    const champion = bracket.champion;

    this.createBackup("hololive-bracket-archive-upsert");

    this.transaction(() => {
      this.run("DELETE FROM hololive_bracket_archive_entries WHERE archive_id = ?", [archiveId]);
      this.run("DELETE FROM hololive_bracket_archive_matches WHERE archive_id = ?", [archiveId]);
      this.run("DELETE FROM hololive_bracket_archives WHERE source_bracket_id = ?", [bracket.id]);
      this.run(
        `INSERT INTO hololive_bracket_archives
           (id, source_bracket_id, name, size, generation_style, generation_filters_json, seed,
            total_entries, total_matches, completed_matches,
            champion_youtube_video_id, champion_title, champion_idol_id, champion_idol_name,
            created_at, completed_at, archived_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          archiveId,
          bracket.id,
          bracket.name,
          bracket.size,
          bracket.generationStyle,
          this.stringifyHololiveBracketGenerationFilters(bracket.generationFilters),
          bracket.seed,
          bracket.entries.length,
          matches.length,
          completedMatches.length,
          champion.youtubeVideoId,
          champion.title,
          champion.idolId,
          champion.idolName,
          bracket.createdAt,
          completedAt,
          archivedAt,
          archivedAt
        ]
      );

      for (const entry of bracket.entries) {
        const stats = entryStats.get(entry.id) ?? {
          wins: 0,
          losses: 0,
          eliminatedRoundIndex: null,
          eliminatedByYoutubeVideoId: null
        };
        const finalRank = entry.id === champion.id ? 1 : stats.eliminatedRoundIndex === null ? null : 2 ** (finalRoundIndex - stats.eliminatedRoundIndex + 1);
        this.run(
          `INSERT INTO hololive_bracket_archive_entries
             (id, archive_id, source_entry_id, slot_index, youtube_video_id, title_snapshot, song_name_snapshot,
              topic_id, youtube_url_snapshot, channel_name_snapshot, idol_id_snapshot, idol_name_snapshot,
              canonical_performance_key, view_count_snapshot, published_at_snapshot, duration_seconds_snapshot,
              wins, losses, final_rank, eliminated_round_index, eliminated_by_youtube_video_id,
              first_round_eliminated, is_champion, is_finalist, is_top4, is_top8, is_top16)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            `${archiveId}:entry:${entry.slotIndex}`,
            archiveId,
            entry.id,
            entry.slotIndex,
            entry.youtubeVideoId,
            entry.title,
            entry.songName ?? null,
            entry.topicId,
            entry.youtubeUrl,
            entry.channelName,
            entry.idolId,
            entry.idolName,
            entry.canonicalPerformanceKey,
            entry.viewCount ?? null,
            entry.publishedAt ?? null,
            entry.durationSeconds ?? null,
            stats.wins,
            stats.losses,
            finalRank,
            stats.eliminatedRoundIndex,
            stats.eliminatedByYoutubeVideoId,
            stats.eliminatedRoundIndex === 0 ? 1 : 0,
            entry.id === champion.id ? 1 : 0,
            finalistIds.has(entry.id) ? 1 : 0,
            reachedRound(entry.id, 4) ? 1 : 0,
            reachedRound(entry.id, 8) ? 1 : 0,
            reachedRound(entry.id, 16) ? 1 : 0
          ]
        );
      }

      for (const match of completedMatches) {
        if (!match.winner) {
          continue;
        }
        const loser = [match.entryA, match.entryB].find((entry) => entry && entry.id !== match.winnerEntryId) ?? null;
        this.run(
          `INSERT INTO hololive_bracket_archive_matches
             (id, archive_id, source_match_id, round_index, match_index,
              entry_a_youtube_video_id, entry_b_youtube_video_id, winner_youtube_video_id, loser_youtube_video_id,
              completed_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            `${archiveId}:r${match.roundIndex}:m${match.matchIndex}`,
            archiveId,
            match.id,
            match.roundIndex,
            match.matchIndex,
            match.entryA?.youtubeVideoId ?? null,
            match.entryB?.youtubeVideoId ?? null,
            match.winner.youtubeVideoId,
            loser?.youtubeVideoId ?? null,
            match.completedAt ?? archivedAt,
            match.updatedAt
          ]
        );
      }
    });
  }

  private normalizeHololiveBracketSize(size: unknown): HololiveBracketSize {
    if (size === "RO16" || size === "RO32" || size === "RO64" || size === "RO128" || size === "RO256") {
      return size;
    }
    throw new Error(`Unsupported Hololive bracket size: ${String(size)}`);
  }

  private normalizeHololiveBracketStatus(status: unknown): HololiveBracketStatus {
    return status === "complete" ? "complete" : "active";
  }

  private normalizeHololiveBracketGenerationStyle(style: unknown): HololiveBracketGenerationStyle {
    return style === "random_songs" ? "random_songs" : "top_songs";
  }

  private normalizeHololiveBracketGenerationFilters(input: unknown): HololiveBracketGenerationFilters {
    let raw: unknown = input;
    if (typeof input === "string") {
      try {
        raw = input.trim() ? JSON.parse(input) : {};
      } catch {
        raw = {};
      }
    }

    const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const excludeTopicIds = [
      ...new Set(
        Array.isArray(record.excludeTopicIds)
          ? record.excludeTopicIds.filter((topic): topic is HololiveMusicTopic => this.isHololiveMusicTopic(topic))
          : []
      )
    ];
    const ratingBuckets = this.normalizeHololiveBracketRatingBuckets(record.ratingBuckets);
    const hasRatingBuckets = ratingBuckets.length > 0;
    const hasIncludedTalentIds = Array.isArray(record.includedTalentIds);
    const includedTalentIds = this.normalizeHololiveBracketTalentIds(record.includedTalentIds);

    return {
      excludeDisliked: hasRatingBuckets ? false : record.excludeDisliked === true,
      excludeRated: hasRatingBuckets ? false : record.excludeRated === true,
      ratingBuckets: hasRatingBuckets ? ratingBuckets : undefined,
      includedTalentIds: hasIncludedTalentIds ? includedTalentIds : undefined,
      excludeTopViewedPerTalent: record.excludeTopViewedPerTalent === true,
      excludePreviousChampions: record.excludePreviousChampions === true,
      excludePreviousFinalists: record.excludePreviousFinalists === true,
      excludePreviousTop4: record.excludePreviousTop4 === true,
      excludePreviousTop8: record.excludePreviousTop8 === true,
      excludeAboveViews: this.normalizeHololiveBracketViewFilter(record.excludeAboveViews),
      excludeBelowViews: this.normalizeHololiveBracketViewFilter(record.excludeBelowViews),
      excludeAfterDate: this.normalizeHololiveBracketDateFilter(record.excludeAfterDate),
      excludeBeforeDate: this.normalizeHololiveBracketDateFilter(record.excludeBeforeDate),
      excludeTopicIds
    };
  }

  private normalizeHololiveBracketViewFilter(value: unknown): number | null {
    const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value.replace(/,/g, "")) : Number.NaN;
    return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : null;
  }

  private normalizeHololiveBracketDateFilter(value: unknown): string | null {
    if (typeof value !== "string") {
      return null;
    }
    const trimmed = value.trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
  }

  private normalizeHololiveBracketRatingBuckets(value: unknown): HololiveBracketRatingBucket[] {
    if (!Array.isArray(value)) {
      return [];
    }
    const selected = new Set(value.filter((bucket): bucket is HololiveBracketRatingBucket => this.isHololiveBracketRatingBucket(bucket)));
    return HOLOLIVE_BRACKET_RATING_BUCKETS.filter((bucket) => selected.has(bucket));
  }

  private normalizeHololiveBracketTalentIds(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return [
      ...new Set(
        value
          .map((talentId) => (typeof talentId === "string" ? talentId.trim() : ""))
          .filter(Boolean)
      )
    ];
  }

  private stringifyHololiveBracketGenerationFilters(filters: HololiveBracketGenerationFilters): string {
    const normalized = this.normalizeHololiveBracketGenerationFilters(filters);
    const payload: HololiveBracketGenerationFilters = {};
    const hasRatingBuckets = Boolean(normalized.ratingBuckets?.length);
    if (hasRatingBuckets) {
      if ((normalized.ratingBuckets?.length ?? 0) < HOLOLIVE_BRACKET_RATING_BUCKETS.length) {
        payload.ratingBuckets = normalized.ratingBuckets;
      }
    } else {
      if (normalized.excludeDisliked) {
        payload.excludeDisliked = true;
      }
      if (normalized.excludeRated) {
        payload.excludeRated = true;
      }
    }
    if (Array.isArray(normalized.includedTalentIds)) {
      payload.includedTalentIds = normalized.includedTalentIds;
    }
    if (normalized.excludeTopViewedPerTalent) {
      payload.excludeTopViewedPerTalent = true;
    }
    if (normalized.excludePreviousChampions) {
      payload.excludePreviousChampions = true;
    }
    if (normalized.excludePreviousFinalists) {
      payload.excludePreviousFinalists = true;
    }
    if (normalized.excludePreviousTop4) {
      payload.excludePreviousTop4 = true;
    }
    if (normalized.excludePreviousTop8) {
      payload.excludePreviousTop8 = true;
    }
    if (normalized.excludeAboveViews !== null && normalized.excludeAboveViews !== undefined) {
      payload.excludeAboveViews = normalized.excludeAboveViews;
    }
    if (normalized.excludeBelowViews !== null && normalized.excludeBelowViews !== undefined) {
      payload.excludeBelowViews = normalized.excludeBelowViews;
    }
    if (normalized.excludeAfterDate) {
      payload.excludeAfterDate = normalized.excludeAfterDate;
    }
    if (normalized.excludeBeforeDate) {
      payload.excludeBeforeDate = normalized.excludeBeforeDate;
    }
    if (normalized.excludeTopicIds?.length) {
      payload.excludeTopicIds = normalized.excludeTopicIds;
    }
    return JSON.stringify(payload);
  }

  private isHololiveMusicTopic(topic: unknown): topic is HololiveMusicTopic {
    return topic === "Original_Song" || topic === "Music_Cover";
  }

  private isHololiveBracketRatingBucket(value: unknown): value is HololiveBracketRatingBucket {
    return (
      value === "unrated" ||
      value === "favorite" ||
      value === "like" ||
      value === "neutral" ||
      value === "dislike"
    );
  }

  private assertHololiveBracket(bracketId: string): void {
    const exists = this.select<{ id: string }>("SELECT id FROM hololive_brackets WHERE id = ?", [bracketId])[0];
    if (!exists) {
      throw new Error(`Unknown Hololive bracket: ${bracketId}`);
    }
  }

  private shuffleWithHololiveBracketSeed<T>(items: T[], seed: string): T[] {
    const shuffled = [...items];
    let state = this.hashHololiveBracketSeed(seed);
    const nextRandom = () => {
      state += 0x6d2b79f5;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };

    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(nextRandom() * (index + 1));
      [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
    }
    return shuffled;
  }

  private hashHololiveBracketSeed(seed: string): number {
    let hash = 2166136261;
    for (let index = 0; index < seed.length; index += 1) {
      hash ^= seed.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  private toHololiveProfileChannel(channel: HolodexChannel): HololiveProfileChannel {
    return {
      id: channel.id,
      name: channel.name || channel.englishName || channel.id,
      url: `https://www.youtube.com/channel/${encodeURIComponent(channel.id)}`,
      photoUrl: channel.photoUrl,
      twitter: channel.twitter,
      subscriberCount: channel.subscriberCount,
      videoCount: channel.videoCount,
      clipCount: channel.clipCount,
      publishedAt: channel.publishedAt,
      updatedAt: channel.updatedAt,
      kind: channel.kind
    };
  }

  private dedupeHololiveProfileSongRows(rows: HololiveMusicRow[]): HololiveMusicRow[] {
    const bestBySongKey = new Map<string, HololiveMusicRow>();

    for (const row of rows) {
      const key = this.buildHololiveProfileSongDedupeKey(row);
      const existing = bestBySongKey.get(key);
      if (!existing || this.compareHololiveMusicProfileRow(row, existing) > 0) {
        bestBySongKey.set(key, row);
      }
    }

    return [...bestBySongKey.values()].sort(
      (left, right) => (right.publishedAt ?? "").localeCompare(left.publishedAt ?? "") || left.title.localeCompare(right.title)
    );
  }

  private buildHololiveProfileSongDedupeKey(row: HololiveMusicRow): string {
    const rawName = (row.songName || row.title || "").trim();
    const withoutVersionSegments = rawName
      .replace(/[\(\[\u3010][^\)\]\u3011]*(?:ft\.?|feat\.?|featuring|with|3d\s*live|live\s*ver|live from|acoustic|piano|re:?\s*arrange|ver\.?|version)[^\)\]\u3011]*[\)\]\u3011]/giu, " ")
      .replace(/\b(?:ft\.?|feat\.?|featuring|with)\b.+$/iu, " ");
    const primaryTitle = withoutVersionSegments.split(/\s+\/\s+|\//u, 1)[0]?.trim() ?? "";
    return buildNormalizedHololiveMusicKey(primaryTitle) || row.canonicalSongKey || buildNormalizedHololiveMusicKey(row.title);
  }

  private compareHololiveMusicProfileRow(left: HololiveMusicRow, right: HololiveMusicRow): number {
    const leftScore = this.scoreHololiveMusicProfileRow(left);
    const rightScore = this.scoreHololiveMusicProfileRow(right);
    if (leftScore !== rightScore) {
      return leftScore - rightScore;
    }

    return (
      (left.publishedAt ?? "").localeCompare(right.publishedAt ?? "") ||
      right.youtubeVideoId.localeCompare(left.youtubeVideoId)
    );
  }

  private scoreHololiveMusicProfileRow(row: HololiveMusicRow): number {
    let score = 0;
    const searchableTitle = [row.title, row.songName ?? ""].join(" ");
    if (row.uploaderChannelKind === "idol") {
      score += 600;
    } else if (row.uploaderChannelKind === "group") {
      score += 250;
    }
    if (/(official\s*(music\s*)?(video|mv)|\bmv\b|music video|original mv)/i.test(searchableTitle)) {
      score += 250;
    }
    if (/\bfull\b|full ver|full version/i.test(searchableTitle)) {
      score += 60;
    }
    if (hasHololiveLowPriorityVersionMarker(searchableTitle)) {
      score -= 240;
    }
    if (
      /topic|provided to youtube|shorts?|teaser|trailer|preview|promo(?:tional)?|宣伝|ending|movie edition|midnight ver|remaster(?:ed)?|instrumental|off vocal|karaoke/i.test(
        searchableTitle
      )
    ) {
      score -= 180;
    }

    return score + Math.min(Math.max(row.durationSeconds ?? 0, 0), 1200) / 10;
  }

  saveCsvMapping(moduleId: ModuleId, importerId: string, fields: Record<string, string>): void {
    const now = new Date().toISOString();
    this.run(
      `INSERT INTO csv_import_mappings (id, module_id, importer_id, name, fields_json, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [randomUUID(), moduleId, importerId, "Last import", JSON.stringify(fields), now]
    );
  }

  run(sql: string, params: unknown[] = []): void {
    const db = this.requireDb();
    db.run(sql, params as never[]);
    if (db.getRowsModified() > 0) {
      this.dirty = true;
    }
    if (!this.inTransaction && this.dirty) {
      this.flush();
    }
  }

  select<T extends Record<string, unknown>>(sql: string, params: unknown[] = []): T[] {
    const stmt = this.requireDb().prepare(sql);
    const rows: T[] = [];

    try {
      stmt.bind(params as never[]);
      while (stmt.step()) {
        rows.push(stmt.getAsObject() as T);
      }
    } finally {
      stmt.free();
    }

    return rows;
  }

  private selectTableRows(tableName: string, whereSql = "", params: unknown[] = []): DatabaseRowSnapshot[] {
    return this.select<DatabaseRowSnapshot>(`SELECT * FROM ${tableName} ${whereSql}`, params);
  }

  private insertOrReplaceRows(tableName: string, rows: DatabaseRowSnapshot[]): void {
    for (const row of rows) {
      const columns = Object.keys(row);
      if (columns.length === 0) {
        continue;
      }

      this.run(
        `INSERT OR REPLACE INTO ${tableName} (${columns.join(", ")})
         VALUES (${columns.map(() => "?").join(", ")})`,
        columns.map((column) => row[column])
      );
    }
  }

  private registerHololiveUndoAction(
    kind: HololiveUndoKind,
    label: string,
    apply: () => void
  ): { undoToken: string; undoLabel: string } {
    const now = Date.now();
    for (const [token, action] of this.hololiveUndoActions) {
      if (now - action.createdAt > HOLOLIVE_UNDO_TTL_MS) {
        this.hololiveUndoActions.delete(token);
      }
    }

    const token = randomUUID();
    this.hololiveUndoActions.set(token, { token, kind, label, createdAt: now, apply });
    const metadata = { undoToken: token, undoLabel: label };
    this.latestHololiveUndoByKind.set(kind, metadata);
    return metadata;
  }

  consumeLatestHololiveUndo(kind: HololiveUndoKind): { undoToken: string; undoLabel: string } | null {
    const metadata = this.latestHololiveUndoByKind.get(kind) ?? null;
    this.latestHololiveUndoByKind.delete(kind);
    return metadata;
  }

  applyHololiveUndo(token: string): { applied: boolean; kind: HololiveUndoKind } {
    const action = this.hololiveUndoActions.get(token.trim());
    if (!action || Date.now() - action.createdAt > HOLOLIVE_UNDO_TTL_MS) {
      throw new Error("This undo action has expired.");
    }

    this.hololiveUndoActions.delete(action.token);
    this.transaction(() => {
      action.apply();
    });
    return { applied: true, kind: action.kind };
  }

  transaction<T>(work: () => T): T {
    this.requireDb().run("BEGIN");
    this.inTransaction = true;

    try {
      const result = work();
      this.requireDb().run("COMMIT");
      this.inTransaction = false;
      if (this.dirty) {
        this.flush();
      }
      return result;
    } catch (error) {
      this.requireDb().run("ROLLBACK");
      this.inTransaction = false;
      throw error;
    }
  }

  flush(): void {
    const db = this.requireDb();
    fs.mkdirSync(path.dirname(this.databasePath), { recursive: true });
    const tempPath = `${this.databasePath}.tmp-${process.pid}-${Date.now()}`;

    try {
      fs.writeFileSync(tempPath, Buffer.from(db.export()));
      fs.renameSync(tempPath, this.databasePath);
      this.dirty = false;
    } catch (error) {
      fs.rmSync(tempPath, { force: true });
      throw error;
    }
  }

  createManualDatabaseBackup(reason = "manual"): { created: boolean; filePath: string | null; reason: string; skippedReason?: string } {
    if (!this.SQL) {
      return { created: false, filePath: null, reason, skippedReason: "sql-unavailable" };
    }

    this.flush();
    return createTimestampedDatabaseBackup(this.databasePath, this.backupDirectory, this.SQL, reason);
  }

  validateDatabaseFile(filePath: string): boolean {
    if (!this.SQL) {
      return false;
    }

    return validateSqliteDatabaseFile(filePath, this.SQL);
  }

  replaceDatabaseFromFile(
    sourcePath: string,
    reason: string
  ): { backup: { created: boolean; filePath: string | null; reason: string; skippedReason?: string } } {
    if (!this.SQL) {
      throw new Error("Database engine is not ready.");
    }

    const resolvedSource = path.resolve(sourcePath);
    const resolvedDatabase = path.resolve(this.databasePath);
    if (resolvedSource.toLowerCase() === resolvedDatabase.toLowerCase()) {
      throw new Error("Choose a backup file instead of the active database.");
    }
    if (!validateSqliteDatabaseFile(resolvedSource, this.SQL)) {
      throw new Error("The selected file is not a valid Holoshelf SQLite database.");
    }

    this.flush();
    const backup = createTimestampedDatabaseBackup(this.databasePath, this.backupDirectory, this.SQL, `pre-${reason}`);
    if (!backup.created) {
      throw new Error(`Could not create a safety backup before ${reason}.`);
    }

    fs.mkdirSync(path.dirname(this.databasePath), { recursive: true });
    const tempPath = `${this.databasePath}.replace-${process.pid}-${Date.now()}`;
    try {
      fs.copyFileSync(resolvedSource, tempPath);
      fs.renameSync(tempPath, this.databasePath);
      this.dirty = false;
    } catch (error) {
      fs.rmSync(tempPath, { force: true });
      throw error;
    }

    return { backup };
  }

  private createBackup(reason: string): void {
    if (!this.SQL) {
      return;
    }

    createRollingDatabaseBackup(this.databasePath, this.backupDirectory, this.SQL, reason);
  }

  private getSettingValue(key: string): string | null {
    return this.select<{ value: string }>("SELECT value FROM settings WHERE key = ?", [key])[0]?.value ?? null;
  }

  private persistSettingValue(key: string, value: string): void {
    if (this.getSettingValue(key) === value) {
      return;
    }

    const now = new Date().toISOString();
    this.run(
      `INSERT INTO settings (key, value, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [key, value, now]
    );
  }

  private seedHololiveTierData(): void {
    const now = new Date().toISOString();

    this.transaction(() => {
      for (const idol of HOLOLIVE_IDOLS) {
        this.run(
          `INSERT INTO hololive_idols
             (id, slug, display_name, branch, generation, status, source, official_url, icon_url,
              profile_image_url, profile_quote, youtube_channel_url, youtube_channel_id, x_handle, x_url, birthday,
              debut_date, height, unit, sort_order, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             slug = excluded.slug,
             display_name = excluded.display_name,
             branch = excluded.branch,
             generation = excluded.generation,
             status = excluded.status,
             source = 'official',
             official_url = excluded.official_url,
             icon_url = excluded.icon_url,
             profile_image_url = excluded.profile_image_url,
             profile_quote = excluded.profile_quote,
             youtube_channel_url = excluded.youtube_channel_url,
             youtube_channel_id = excluded.youtube_channel_id,
             x_handle = excluded.x_handle,
             x_url = excluded.x_url,
             birthday = excluded.birthday,
             debut_date = excluded.debut_date,
             height = excluded.height,
             unit = excluded.unit,
             sort_order = excluded.sort_order,
             updated_at = excluded.updated_at
           WHERE hololive_idols.slug IS NOT excluded.slug
              OR hololive_idols.display_name IS NOT excluded.display_name
              OR hololive_idols.branch IS NOT excluded.branch
              OR hololive_idols.generation IS NOT excluded.generation
              OR hololive_idols.status IS NOT excluded.status
              OR hololive_idols.source IS NOT 'official'
              OR hololive_idols.official_url IS NOT excluded.official_url
              OR hololive_idols.icon_url IS NOT excluded.icon_url
              OR hololive_idols.profile_image_url IS NOT excluded.profile_image_url
              OR hololive_idols.profile_quote IS NOT excluded.profile_quote
              OR hololive_idols.youtube_channel_url IS NOT excluded.youtube_channel_url
              OR hololive_idols.youtube_channel_id IS NOT excluded.youtube_channel_id
              OR hololive_idols.x_handle IS NOT excluded.x_handle
              OR hololive_idols.x_url IS NOT excluded.x_url
              OR hololive_idols.birthday IS NOT excluded.birthday
              OR hololive_idols.debut_date IS NOT excluded.debut_date
              OR hololive_idols.height IS NOT excluded.height
              OR hololive_idols.unit IS NOT excluded.unit
              OR hololive_idols.sort_order IS NOT excluded.sort_order`,
          [
            idol.id,
            idol.slug,
            idol.displayName,
            idol.branch,
            idol.generation,
            idol.status,
            "official",
            idol.officialUrl,
            idol.iconUrl,
            idol.profileImageUrl ?? null,
            idol.profileQuote ?? null,
            idol.youtubeChannelUrl ?? null,
            idol.youtubeChannelId ?? null,
            idol.xHandle ?? null,
            idol.xUrl ?? null,
            idol.birthday ?? null,
            idol.debutDate ?? null,
            idol.height ?? null,
            idol.unit ?? null,
            idol.sortOrder,
            now
          ]
        );
      }
    });

    if (this.listHololiveTierBoardSummaries().length === 0) {
      this.createHololiveTierBoard(DEFAULT_HOLOLIVE_BOARD_NAME, HOLOLIVE_DEFAULT_BOARD_ID);
    }

    for (const board of this.listHololiveTierBoardSummaries()) {
      this.ensureHololiveBoardPlacements(board.id);
    }

    this.seedHololiveMainChannels(now);
  }

  private insertHololiveMusicRefreshRun(run: HololiveMusicRefreshRun): void {
    this.run(
      `INSERT INTO hololive_music_refresh_runs
         (id, source, status, started_at, completed_at, fetched_rows, kept_rows, filtered_rows, duplicate_rows, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        run.id,
        run.source,
        run.status,
        run.startedAt,
        run.completedAt ?? null,
        run.fetchedRows,
        run.keptRows,
        run.filteredRows,
        run.duplicateRows,
        run.error ?? null
      ]
    );
  }

  private finishHololiveMusicRefreshRun(
    runId: string,
    input: {
      status: HololiveMusicRefreshRun["status"];
      keptRows: number;
      filteredRows: number;
      duplicateRows: number;
      error: string | null;
    }
  ): void {
    this.run(
      `UPDATE hololive_music_refresh_runs
       SET status = ?, completed_at = ?, kept_rows = ?, filtered_rows = ?, duplicate_rows = ?, error = ?
       WHERE id = ?`,
      [
        input.status,
        new Date().toISOString(),
        input.keptRows,
        input.filteredRows,
        input.duplicateRows,
        input.error,
        runId
      ]
    );
  }

  private getHololiveMusicRefreshRun(runId: string): HololiveMusicRefreshRun | null {
    return this.selectHololiveMusicRefreshRuns("WHERE id = ?", [runId])[0] ?? null;
  }

  private selectHololiveMusicRefreshRuns(orderOrWhereSql = "", params: unknown[] = []): HololiveMusicRefreshRun[] {
    return this.select<{
      id: string;
      source: HololiveMusicRefreshRun["source"];
      status: HololiveMusicRefreshRun["status"];
      started_at: string;
      completed_at: string | null;
      fetched_rows: number;
      kept_rows: number;
      filtered_rows: number;
      duplicate_rows: number;
      error: string | null;
    }>(
      `SELECT id, source, status, started_at, completed_at, fetched_rows, kept_rows, filtered_rows, duplicate_rows, error
       FROM hololive_music_refresh_runs ${orderOrWhereSql}`,
      params
    ).map((row) => ({
      id: row.id,
      source: row.source,
      status: row.status,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      fetchedRows: Number(row.fetched_rows),
      keptRows: Number(row.kept_rows),
      filteredRows: Number(row.filtered_rows),
      duplicateRows: Number(row.duplicate_rows),
      error: row.error
    }));
  }

  private seedHololiveMainChannels(timestamp = new Date().toISOString()): void {
    const idols = this.select<{
      id: string;
      display_name: string;
      branch: string;
      generation: string;
      source: HololiveIdol["source"];
      youtube_channel_id: string | null;
    }>(
      `SELECT id, display_name, branch, generation, source, youtube_channel_id
       FROM hololive_idols
       WHERE youtube_channel_id IS NOT NULL AND youtube_channel_id != ''`
    );

    for (const idol of idols) {
      if (isExcludedHolodexChannelId(idol.youtube_channel_id)) {
        continue;
      }

      const channel: HolodexChannelRecord = {
        id: idol.youtube_channel_id ?? "",
        name: idol.display_name,
        englishName: idol.display_name,
        type: "vtuber",
        org: idol.source === "custom" ? idol.branch || "Custom" : "Hololive",
        group: idol.generation,
        photoUrl: "",
        twitter: "",
        videoCount: null,
        subscriberCount: null,
        clipCount: null,
        publishedAt: "",
        inactive: false
      };
      const existing = this.select<{
        name: string | null;
        subscriber_count: number | null;
        video_count: number | null;
        clip_count: number | null;
      }>("SELECT name, subscriber_count, video_count, clip_count FROM hololive_channels WHERE id = ?", [channel.id])[0];
      if (
        !existing ||
        (!existing.name && existing.subscriber_count === null && existing.video_count === null && existing.clip_count === null)
      ) {
        this.upsertHolodexChannels([channel], timestamp);
      }
      this.mergeHololiveChannelIdolIds(channel.id, "main", [idol.id], timestamp);
    }
  }

  private upsertHolodexChannels(channels: HolodexChannelRecord[], timestamp = new Date().toISOString()): void {
    const uniqueChannels = new Map(
      channels
        .filter((channel) => channel.id && !isExcludedHolodexChannelId(channel.id))
        .map((channel) => [channel.id, channel])
    );

    for (const channel of uniqueChannels.values()) {
      this.run(
        `INSERT INTO hololive_channels
           (id, name, english_name, type, org, group_name, photo_url, twitter,
            video_count, subscriber_count, clip_count, published_at, inactive, kind,
            main_idol_ids_json, topic_idol_ids_json, linked_idol_ids_json, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unknown', '[]', '[]', '[]', ?)
         ON CONFLICT(id) DO UPDATE SET
           name = COALESCE(NULLIF(excluded.name, ''), hololive_channels.name),
           english_name = COALESCE(NULLIF(excluded.english_name, ''), hololive_channels.english_name),
           type = COALESCE(NULLIF(excluded.type, ''), hololive_channels.type),
           org = COALESCE(NULLIF(excluded.org, ''), hololive_channels.org),
           group_name = COALESCE(NULLIF(excluded.group_name, ''), hololive_channels.group_name),
           photo_url = COALESCE(NULLIF(excluded.photo_url, ''), hololive_channels.photo_url),
           twitter = COALESCE(NULLIF(excluded.twitter, ''), hololive_channels.twitter),
           video_count = COALESCE(excluded.video_count, hololive_channels.video_count),
           subscriber_count = COALESCE(excluded.subscriber_count, hololive_channels.subscriber_count),
           clip_count = COALESCE(excluded.clip_count, hololive_channels.clip_count),
           published_at = COALESCE(NULLIF(excluded.published_at, ''), hololive_channels.published_at),
           inactive = excluded.inactive,
           updated_at = excluded.updated_at`,
        [
          channel.id,
          channel.name,
          channel.englishName || null,
          channel.type || null,
          channel.org || null,
          channel.group || null,
          channel.photoUrl || null,
          channel.twitter || null,
          channel.videoCount,
          channel.subscriberCount,
          channel.clipCount,
          channel.publishedAt || null,
          channel.inactive ? 1 : 0,
          timestamp
        ]
      );
    }
  }

  private extractHolodexChannelsFromDetails(detailsById: Record<string, HolodexVideoDetail>): HolodexChannelRecord[] {
    return Object.values(detailsById)
      .map((detail) => detail.channel)
      .filter((channel): channel is HolodexChannelRecord => Boolean(channel?.id && !isExcludedHolodexChannelId(channel.id)));
  }

  private inferHolodexTopicChannels(
    detailsById: Record<string, HolodexVideoDetail>,
    timestamp = new Date().toISOString()
  ): void {
    const channelContext = this.getHololiveChannelContext();
    const { mainChannelToIdols, groupChannelIds } = channelContext;

    for (const detail of Object.values(detailsById)) {
      if (
        !detail.providedToYoutube ||
        !detail.channelId ||
        !detail.originalChannelId ||
        isExcludedHolodexChannelId(detail.channelId) ||
        isExcludedHolodexChannelId(detail.originalChannelId)
      ) {
        continue;
      }
      if (mainChannelToIdols.has(detail.channelId)) {
        continue;
      }

      const idolIds = mainChannelToIdols.get(detail.originalChannelId) ?? [];
      if (idolIds.length > 0) {
        this.mergeHololiveChannelIdolIds(detail.channelId, "topic", idolIds, timestamp);
      } else if (groupChannelIds.has(detail.originalChannelId)) {
        this.markHololiveChannelAsTopic(detail.channelId, timestamp);
      }
    }
  }

  private getHololiveChannelContext(): HololiveChannelContext {
    const channels = this.listHololiveChannels();
    const mainLinks = channels.flatMap((channel) =>
      channel.mainIdolIds.map((idolId) => ({ channel_id: channel.id, idol_id: idolId }))
    );
    const linkedLinks = channels.flatMap((channel) =>
      channel.linkedIdolIds.map((idolId) => ({ channel_id: channel.id, idol_id: idolId }))
    );
    return {
      mainChannelToIdols: this.groupChannelIdolLinks(mainLinks),
      linkedChannelToIdols: this.groupChannelIdolLinks(linkedLinks),
      groupChannelIds: new Set(channels.filter((channel) => channel.kind === "group").map((channel) => channel.id))
    };
  }

  private groupChannelIdolLinks(rows: Array<{ channel_id: string; idol_id: string }>): Map<string, string[]> {
    const result = new Map<string, string[]>();
    for (const row of rows) {
      result.set(row.channel_id, [...(result.get(row.channel_id) ?? []), row.idol_id]);
    }
    return result;
  }

  private mergeHololiveChannelIdolIds(
    channelId: string,
    linkType: "main" | "topic",
    idolIds: string[],
    timestamp = new Date().toISOString()
  ): void {
    if (!channelId || isExcludedHolodexChannelId(channelId) || idolIds.length === 0) {
      return;
    }

    this.run(
      `INSERT OR IGNORE INTO hololive_channels
         (id, kind, main_idol_ids_json, topic_idol_ids_json, linked_idol_ids_json, updated_at)
       VALUES (?, 'unknown', '[]', '[]', '[]', ?)`,
      [channelId, timestamp]
    );

    const row = this.select<{
      org: string | null;
      kind: HololiveChannelKind;
      main_idol_ids_json: string;
      topic_idol_ids_json: string;
      linked_idol_ids_json: string;
    }>(
      "SELECT org, kind, main_idol_ids_json, topic_idol_ids_json, linked_idol_ids_json FROM hololive_channels WHERE id = ?",
      [channelId]
    )[0];
    if (!row) {
      return;
    }

    const mainIdolIds = this.parseJsonStringArray(row.main_idol_ids_json);
    const topicIdolIds = this.parseJsonStringArray(row.topic_idol_ids_json);
    if (linkType === "main") {
      mainIdolIds.push(...idolIds);
    } else {
      topicIdolIds.push(...idolIds);
    }
    const normalizedMainIdolIds = this.unionIdolIds(mainIdolIds);
    const normalizedTopicIdolIds = this.unionIdolIds(topicIdolIds);
    const linkedIdolIds = this.unionIdolIds(normalizedMainIdolIds, normalizedTopicIdolIds);
    const kind = this.getMergedHololiveChannelKind(row.org, normalizedMainIdolIds, normalizedTopicIdolIds, row.kind);
    const mainIdolIdsJson = this.stringifyIdolIdArray(normalizedMainIdolIds);
    const topicIdolIdsJson = this.stringifyIdolIdArray(normalizedTopicIdolIds);
    const linkedIdolIdsJson = this.stringifyIdolIdArray(linkedIdolIds);

    if (
      row.kind === kind &&
      row.main_idol_ids_json === mainIdolIdsJson &&
      row.topic_idol_ids_json === topicIdolIdsJson &&
      row.linked_idol_ids_json === linkedIdolIdsJson
    ) {
      return;
    }

    this.run(
      `UPDATE hololive_channels
       SET kind = ?,
           main_idol_ids_json = ?,
           topic_idol_ids_json = ?,
           linked_idol_ids_json = ?,
           updated_at = ?
       WHERE id = ?`,
      [
        kind,
        mainIdolIdsJson,
        topicIdolIdsJson,
        linkedIdolIdsJson,
        timestamp,
        channelId
      ]
    );
  }

  private markHololiveChannelAsTopic(channelId: string, timestamp = new Date().toISOString()): void {
    if (!channelId || isExcludedHolodexChannelId(channelId)) {
      return;
    }

    this.run(
      `INSERT INTO hololive_channels
         (id, kind, main_idol_ids_json, topic_idol_ids_json, linked_idol_ids_json, updated_at)
       VALUES (?, 'topic', '[]', '[]', '[]', ?)
       ON CONFLICT(id) DO UPDATE SET
         kind = CASE WHEN kind = 'idol' THEN kind ELSE 'topic' END,
         updated_at = excluded.updated_at`,
      [channelId, timestamp]
    );
  }

  private classifyHolodexGroupChannels(timestamp = new Date().toISOString()): void {
    const rows = this.select<{
      id: string;
      org: string | null;
      kind: HololiveChannelKind;
      main_idol_ids_json: string;
      topic_idol_ids_json: string;
    }>(
      "SELECT id, org, kind, main_idol_ids_json, topic_idol_ids_json FROM hololive_channels"
    );

    for (const row of rows) {
      if (isExcludedHolodexChannelId(row.id)) {
        continue;
      }
      const mainIdolIds = this.parseJsonStringArray(row.main_idol_ids_json);
      const topicIdolIds = this.parseJsonStringArray(row.topic_idol_ids_json);
      const linkedIdolIds = this.unionIdolIds(mainIdolIds, topicIdolIds);
      const kind = this.getMergedHololiveChannelKind(row.org, mainIdolIds, topicIdolIds, row.kind);
      this.run(
        `UPDATE hololive_channels
         SET kind = ?,
             main_idol_ids_json = ?,
             topic_idol_ids_json = ?,
             linked_idol_ids_json = ?,
             updated_at = ?
         WHERE id = ?`,
        [
          kind,
          this.stringifyIdolIdArray(mainIdolIds),
          this.stringifyIdolIdArray(topicIdolIds),
          this.stringifyIdolIdArray(linkedIdolIds),
          timestamp,
          row.id
        ]
      );
    }
  }

  private shouldImportHolodexMusicRow(
    row: HolodexCatalogRow,
    detail: HolodexVideoDetail | undefined,
    channelContext: HololiveChannelContext
  ): boolean {
    if (!detail) {
      return false;
    }

    const uploaderChannelId = detail.channelId || row.channelId || "";
    const ownerChannelId = detail ? this.getEffectiveHololiveOwnerChannelId(detail) : uploaderChannelId;
    if (
      !uploaderChannelId ||
      isExcludedHolodexChannelId(uploaderChannelId) ||
      isExcludedHolodexChannelId(ownerChannelId)
    ) {
      return false;
    }

    if (this.shouldRejectExternalOriginalSourceRow(row, detail, channelContext)) {
      return false;
    }

    return (
      this.holodexChannelMatchesContext(uploaderChannelId, channelContext) ||
      this.holodexChannelMatchesContext(ownerChannelId, channelContext) ||
      detail.collabChannelIds.some((channelId) => this.holodexChannelMatchesContext(channelId, channelContext))
    );
  }

  private shouldRejectExternalOriginalSourceRow(
    row: HolodexCatalogRow,
    detail: HolodexVideoDetail,
    channelContext: HololiveChannelContext,
    idolMetadata = this.getHololiveIdolMetadataMap()
  ): boolean {
    const externalOriginalChannelId = detail.originalChannelId?.trim() ?? "";
    if (
      row.topicId !== "Original_Song" ||
      detail.providedToYoutube ||
      !externalOriginalChannelId ||
      isExcludedHolodexChannelId(externalOriginalChannelId) ||
      this.holodexChannelMatchesContext(externalOriginalChannelId, channelContext)
    ) {
      return false;
    }

    const uploaderChannelId = (detail.channelId || row.channelId || "").trim();
    const uploaderIdolIds = channelContext.mainChannelToIdols.get(uploaderChannelId) ?? [];
    if (uploaderIdolIds.length === 0) {
      return false;
    }

    const sourceShapedTitle =
      /\b(?:feat\.?|featuring|ft\.?)\b/iu.test(row.title) ||
      /^\s*[^-–—:]{2,100}\s*[-–—]\s*\S/iu.test(row.title);
    if (!sourceShapedTitle) {
      return false;
    }

    const performerText = [row.title, ...detail.songNames].join(" ");
    return !this.textReferencesAnyHololiveIdol(performerText, uploaderIdolIds, idolMetadata);
  }

  private getEffectiveHololiveOwnerChannelId(detail: HolodexVideoDetail): string {
    return detail.providedToYoutube && detail.originalChannelId ? detail.originalChannelId : detail.channelId;
  }

  private holodexChannelMatchesContext(channelId: string | null | undefined, channelContext: HololiveChannelContext): boolean {
    const id = channelId?.trim() ?? "";
    return Boolean(
      id &&
        !isExcludedHolodexChannelId(id) &&
        (channelContext.linkedChannelToIdols.has(id) || channelContext.groupChannelIds.has(id))
    );
  }

  private pickHolodexDetailsForRows(
    detailsById: Record<string, HolodexVideoDetail>,
    rows: HolodexCatalogRow[]
  ): Record<string, HolodexVideoDetail> {
    const rowIds = new Set(rows.map((row) => row.youtubeVideoId));
    return Object.fromEntries(
      Object.entries(detailsById).filter(([videoId, detail]) => rowIds.has(videoId) && Boolean(detail))
    );
  }

  private getHololiveMusicExclusionSet(): Set<string> {
    if (!this.tableExists("hololive_music_exclusions")) {
      return new Set();
    }

    return new Set(
      this.select<{ youtube_video_id: string }>("SELECT youtube_video_id FROM hololive_music_exclusions")
        .map((row) => row.youtube_video_id.trim())
        .filter(Boolean)
    );
  }

  private purgeExcludedHololiveMusicRows(): void {
    for (const youtubeVideoId of this.getHololiveMusicExclusionSet()) {
      this.deleteHololiveMusicVideoData(youtubeVideoId, { deleteMarker: true, deleteStats: true });
    }
  }

  private purgeRejectedHolodexMusicRows(): void {
    if (!this.tableExists("hololive_music_videos")) {
      return;
    }

    const rows = this.select<{
      youtube_video_id: string;
      youtube_url: string;
      title: string;
      status: string;
      topic_id: HololiveMusicTopic;
      channel_id: string | null;
      channel_name: string;
      published_at: string | null;
      duration_seconds: number | null;
      song_name: string | null;
      original_channel_id: string | null;
      provided_to_youtube: number | null;
      cache_channel_id: string | null;
      cache_duration_seconds: number | null;
      cache_original_channel_id: string | null;
      cache_provided_to_youtube: number | null;
      song_names_json: string | null;
    }>(
      `SELECT v.youtube_video_id,
              v.youtube_url,
              v.title,
              v.status,
              v.topic_id,
              v.channel_id,
              v.channel_name,
              v.published_at,
              v.duration_seconds,
              v.song_name,
              v.original_channel_id,
              v.provided_to_youtube,
              d.channel_id AS cache_channel_id,
              d.duration_seconds AS cache_duration_seconds,
              d.original_channel_id AS cache_original_channel_id,
              d.provided_to_youtube AS cache_provided_to_youtube,
              d.song_names_json
       FROM hololive_music_videos v
       LEFT JOIN hololive_music_detail_cache d
         ON d.youtube_video_id = v.youtube_video_id`
    );
    const channelContext = this.getHololiveChannelContext();
    const idolMetadata = this.getHololiveIdolMetadataMap();
    const rejectedIds = rows
      .filter((row) => {
        const catalogRow: HolodexCatalogRow = {
          youtubeVideoId: row.youtube_video_id,
          youtubeUrl: row.youtube_url,
          title: row.title,
          status: row.status,
          topicId: row.topic_id,
          channelId: row.channel_id ?? "",
          channelName: row.channel_name,
          publishedAt: row.published_at ?? ""
        };
        const detail: HolodexVideoDetail = {
          youtubeVideoId: row.youtube_video_id,
          channelId: row.cache_channel_id ?? row.channel_id ?? "",
          duration: row.cache_duration_seconds ?? row.duration_seconds,
          originalChannelId: row.cache_original_channel_id ?? row.original_channel_id ?? "",
          providedToYoutube: Boolean(row.cache_provided_to_youtube ?? row.provided_to_youtube ?? 0),
          songNames: this.parseJsonStringArray(row.song_names_json).length > 0
            ? this.parseJsonStringArray(row.song_names_json)
            : [row.song_name ?? row.title].filter(Boolean),
          mentions: [],
          collabChannelIds: [],
          relationshipsLoaded: false
        };
        return Boolean(getRowCleanupReason(catalogRow, {}, { [row.youtube_video_id]: detail })) ||
          this.shouldRejectExternalOriginalSourceRow(catalogRow, detail, channelContext, idolMetadata);
      })
      .map((row) => row.youtube_video_id);

    if (rejectedIds.length === 0) {
      return;
    }

    this.transaction(() => {
      const currentState = this.ensureHololiveMusicPlayerState();
      for (const youtubeVideoId of rejectedIds) {
        this.run("DELETE FROM hololive_music_playlist_items WHERE youtube_video_id = ?", [youtubeVideoId]);
        this.run("DELETE FROM hololive_music_queue_items WHERE youtube_video_id = ?", [youtubeVideoId]);
        this.deleteHololiveMusicVideoData(youtubeVideoId);
      }

      if (currentState.currentYoutubeVideoId && rejectedIds.includes(currentState.currentYoutubeVideoId)) {
        this.setHololiveMusicPlayerStateRow({
          playbackSourceType: "library",
          currentQueueItemId: null,
          currentPlaylistId: null,
          currentPlaylistItemId: null,
          currentYoutubeVideoId: null
        });
      }
    });
  }

  private deleteHololiveMusicVideoData(
    youtubeVideoId: string,
    options: { deleteMarker?: boolean; deleteStats?: boolean } = {}
  ): void {
    const id = youtubeVideoId.trim();
    if (!id) {
      return;
    }

    const markerKeys = options.deleteMarker ? this.getHololiveMusicMarkerKeysForVideo(id) : [];
    const itemIds = this.getHololiveMusicItemIdsForVideo(id);

    if (itemIds.length > 0) {
      this.run(
        `DELETE FROM catalog_items WHERE id IN (${itemIds.map(() => "?").join(", ")})`,
        itemIds
      );
      this.run(
        `DELETE FROM item_tags WHERE item_id IN (${itemIds.map(() => "?").join(", ")})`,
        itemIds
      );
    }

    this.run("DELETE FROM source_refs WHERE source_id = 'holodex' AND source_key = ?", [id]);
    this.run("DELETE FROM hololive_music_videos WHERE youtube_video_id = ?", [id]);
    this.run("DELETE FROM hololive_music_detail_cache WHERE youtube_video_id = ?", [id]);
    if (options.deleteStats) {
      this.run("DELETE FROM hololive_music_video_stats WHERE youtube_video_id = ?", [id]);
    }
    this.run(
      "DELETE FROM hololive_music_duplicate_removals WHERE removed_youtube_video_id = ? OR kept_youtube_video_id = ?",
      [id, id]
    );

    if (options.deleteMarker) {
      this.deleteHololiveMusicMarkersForKeys(markerKeys);
    }
  }

  private filterHolodexDuplicateRemovals(
    removals: HolodexDuplicateRemoval[],
    rows: HolodexCatalogRow[]
  ): HolodexDuplicateRemoval[] {
    const rowIds = new Set(rows.map((row) => row.youtubeVideoId));
    return removals.filter(
      (removal) => rowIds.has(removal.removedYoutubeVideoId) || rowIds.has(removal.keptYoutubeVideoId)
    );
  }

  private buildHololiveMusicParticipants(
    detail: HolodexVideoDetail,
    channelContext: HololiveChannelContext,
    topicId: HololiveMusicTopic
  ): Array<Omit<HololiveMusicParticipant, "youtubeVideoId" | "idolName">> {
    const participants = new Map<string, Omit<HololiveMusicParticipant, "youtubeVideoId" | "idolName">>();
    const add = (idolIds: string[] | null | undefined, role: HololiveMusicParticipantRole, channelId: string | null) => {
      for (const idolId of idolIds ?? []) {
        const key = `${idolId}:${role}`;
        if (participants.has(key)) {
          continue;
        }
        participants.set(key, {
          idolId,
          role,
          channelId
        });
      }
    };

    const isTopicUpload = detail.providedToYoutube && Boolean(detail.originalChannelId);
    if (isTopicUpload) {
      add(channelContext.linkedChannelToIdols.get(detail.originalChannelId), "topic-owner", detail.originalChannelId);
      add(channelContext.linkedChannelToIdols.get(detail.channelId), "topic-owner", detail.channelId);
    } else {
      const primaryIdolIds = channelContext.mainChannelToIdols.get(detail.channelId) ?? [];
      const topicIdolIds =
        primaryIdolIds.length > 0 ? [] : channelContext.linkedChannelToIdols.get(detail.channelId) ?? [];
      add(primaryIdolIds, "primary", detail.channelId);
      add(topicIdolIds, "topic-owner", detail.channelId);
    }

    if (this.shouldTrustHolodexMentionsForParticipants(detail, channelContext, topicId)) {
      for (const mention of detail.mentions) {
        add(channelContext.linkedChannelToIdols.get(mention.channelId), "mentioned", mention.channelId);
      }
    }

    for (const channelId of detail.collabChannelIds) {
      add(channelContext.linkedChannelToIdols.get(channelId), "collab", channelId);
    }

    return [...participants.values()];
  }

  private shouldTrustHolodexMentionsForParticipants(
    detail: HolodexVideoDetail,
    channelContext: HololiveChannelContext,
    topicId: HololiveMusicTopic
  ): boolean {
    const effectiveOwnerChannelId = this.getEffectiveHololiveOwnerChannelId(detail);
    const isKnownGroupUpload =
      channelContext.groupChannelIds.has(detail.channelId) ||
      (effectiveOwnerChannelId ? channelContext.groupChannelIds.has(effectiveOwnerChannelId) : false);
    if (isKnownGroupUpload) {
      return true;
    }

    const isKnownUploaderOrOwner =
      this.holodexChannelMatchesContext(detail.channelId, channelContext) ||
      this.holodexChannelMatchesContext(effectiveOwnerChannelId, channelContext);
    return topicId === "Original_Song" && isKnownUploaderOrOwner;
  }

  private buildHololiveMusicClassification(input: {
    youtubeVideoId: string;
    title: string;
    songName?: string | null;
    topicId: HololiveMusicTopic;
    channelId: string;
    channelName?: string | null;
    originalChannelId?: string | null;
    providedToYoutube: boolean | number;
    participants: StoredHololiveMusicParticipant[];
    fallbackIdolId?: string | null;
  }, channelContext: HololiveChannelContext, idolMetadata = this.getHololiveIdolMetadataMap()): HololiveMusicClassification {
    const canonicalSongKey = input.songName?.trim()
      ? buildHololiveMusicSongKey({ songName: input.songName, title: input.title })
      : buildDuplicateTitleCore(input.title, { channelName: input.channelName });
    const effectiveOwnerChannelId = getHolodexEffectiveOwnerChannelId({
      channelId: input.channelId,
      originalChannelId: input.originalChannelId,
      providedToYoutube: input.providedToYoutube
    });
    const isHololiveGroupOwnedUpload =
      channelContext.groupChannelIds.has(input.channelId) ||
      (effectiveOwnerChannelId ? channelContext.groupChannelIds.has(effectiveOwnerChannelId) : false);
    const inferredGroupFeaturedIdolIds = isHololiveGroupOwnedUpload
      ? this.inferHololiveGroupUploadFeaturedIdolIds(
          {
            title: input.title,
            songName: input.songName,
            channelId: input.channelId,
            effectiveOwnerChannelId
          },
          idolMetadata
        )
      : [];
    const rawOwnedIdolIds = input.participants
      .filter((participant) => participant.role === "primary" || participant.role === "topic-owner")
      .map((participant) => participant.idolId);
    const rawFeaturedIdolIds = input.participants
      .filter((participant) => participant.role === "mentioned" || participant.role === "collab")
      .map((participant) => participant.idolId);
    const suppressExternalSourceOwnership = this.shouldRejectExternalOriginalSourceRow(
      {
        youtubeVideoId: input.youtubeVideoId,
        youtubeUrl: `https://www.youtube.com/watch?v=${input.youtubeVideoId}`,
        title: input.title,
        status: "past",
        topicId: input.topicId,
        channelId: input.channelId,
        channelName: input.channelName ?? "",
        publishedAt: ""
      },
      {
        youtubeVideoId: input.youtubeVideoId,
        channelId: input.channelId,
        duration: null,
        originalChannelId: input.originalChannelId ?? "",
        providedToYoutube: Boolean(input.providedToYoutube),
        songNames: input.songName ? [input.songName] : [],
        mentions: [],
        collabChannelIds: [],
        relationshipsLoaded: false
      },
      channelContext,
      idolMetadata
    );
    const effectiveRawOwnedIdolIds = suppressExternalSourceOwnership ? [] : rawOwnedIdolIds;
    const ownedIdolIds = this.normalizeIdolIdArray(
      [
        ...effectiveRawOwnedIdolIds,
        ...(effectiveRawOwnedIdolIds.length === 0 &&
        !suppressExternalSourceOwnership &&
        !isHololiveGroupOwnedUpload &&
        input.fallbackIdolId
          ? [input.fallbackIdolId]
          : [])
      ],
      idolMetadata
    );
    const ownedIdolIdSet = new Set(ownedIdolIds);
    const featuredIdolIds = this.normalizeIdolIdArray(
      [...rawFeaturedIdolIds, ...inferredGroupFeaturedIdolIds].filter((idolId) => !ownedIdolIdSet.has(idolId)),
      idolMetadata
    );
    const canonicalPerformanceKey = buildHololiveMusicPerformanceKey({
      youtubeVideoId: input.youtubeVideoId,
      topicId: input.topicId,
      canonicalSongKey,
      ownedIdolIds,
      effectiveOwnerChannelId,
      channelId: input.channelId
    });

    return {
      canonicalSongKey,
      canonicalPerformanceKey,
      ownedIdolIds,
      featuredIdolIds
    };
  }

  private getPrimaryHololiveMusicIdolId(detail: HolodexVideoDetail, channelContext: HololiveChannelContext): string | null {
    const ownerChannelId = this.getEffectiveHololiveOwnerChannelId(detail);
    return (
      channelContext.mainChannelToIdols.get(ownerChannelId)?.[0] ??
      channelContext.linkedChannelToIdols.get(ownerChannelId)?.[0] ??
      channelContext.mainChannelToIdols.get(detail.channelId)?.[0] ??
      channelContext.linkedChannelToIdols.get(detail.channelId)?.[0] ??
      null
    );
  }

  private upsertHolodexDetailCache(detailsById: Record<string, HolodexVideoDetail>): void {
    const now = new Date().toISOString();

    for (const detail of Object.values(detailsById)) {
      if (isExcludedHolodexChannelId(detail.channelId) || isExcludedHolodexChannelId(detail.originalChannelId)) {
        continue;
      }

      this.run(
        `INSERT INTO hololive_music_detail_cache
           (youtube_video_id, channel_id, duration_seconds, original_channel_id, provided_to_youtube,
            song_names_json, mentions_json, collab_channel_ids_json, relationships_loaded, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(youtube_video_id) DO UPDATE SET
           channel_id = excluded.channel_id,
           duration_seconds = excluded.duration_seconds,
           original_channel_id = excluded.original_channel_id,
           provided_to_youtube = excluded.provided_to_youtube,
           song_names_json = excluded.song_names_json,
           mentions_json = excluded.mentions_json,
           collab_channel_ids_json = excluded.collab_channel_ids_json,
           relationships_loaded = excluded.relationships_loaded,
           updated_at = excluded.updated_at`,
        [
          detail.youtubeVideoId,
          detail.channelId || null,
          detail.duration,
          detail.originalChannelId || null,
          detail.providedToYoutube ? 1 : 0,
          JSON.stringify(detail.songNames),
          JSON.stringify(detail.mentions),
          JSON.stringify(detail.collabChannelIds),
          detail.relationshipsLoaded ? 1 : 0,
          now
        ]
      );
    }
  }

  private upsertHolodexDuplicateRemovals(removals: HolodexDuplicateRemoval[], runId: string): void {
    const now = new Date().toISOString();

    for (const removal of removals) {
      this.run(
        `INSERT INTO hololive_music_duplicate_removals
           (removed_youtube_video_id, removed_title, kept_youtube_video_id, kept_title, reason, song_name,
            removed_published_at, kept_published_at, source_run_id, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(removed_youtube_video_id) DO UPDATE SET
           removed_title = excluded.removed_title,
           kept_youtube_video_id = excluded.kept_youtube_video_id,
           kept_title = excluded.kept_title,
           reason = excluded.reason,
           song_name = excluded.song_name,
           removed_published_at = excluded.removed_published_at,
           kept_published_at = excluded.kept_published_at,
           source_run_id = excluded.source_run_id,
           updated_at = excluded.updated_at`,
        [
          removal.removedYoutubeVideoId,
          removal.removedTitle,
          removal.keptYoutubeVideoId || null,
          removal.keptTitle || null,
          removal.reason,
          removal.songName || null,
          removal.removedPublishedAt || null,
          removal.keptPublishedAt || null,
          runId,
          now
        ]
      );
    }
  }

  private upsertHolodexMusicRows(
    rows: HolodexCatalogRow[],
    detailsById: Record<string, HolodexVideoDetail>,
    channelContext: HololiveChannelContext,
    runId: string
  ): void {
    const now = new Date().toISOString();
    const idolMetadata = this.getHololiveIdolMetadataMap();
    const excludedVideoIds = this.getHololiveMusicExclusionSet();

    for (const row of rows) {
      if (excludedVideoIds.has(row.youtubeVideoId)) {
        continue;
      }

      const detail = detailsById[row.youtubeVideoId];
      if (!detail) {
        continue;
      }

      const idolId = this.getPrimaryHololiveMusicIdolId(detail, channelContext);
      const itemId = this.getHolodexMusicItemId(row.youtubeVideoId);
      const songName = detail.songNames[0] ?? null;
      const catalogTitle = songName || row.title;
      const participants = this.buildHololiveMusicParticipants(detail, channelContext, row.topicId);
      const participantTags = participants.map((participant) => participant.idolId);
      const participantsJson = this.stringifyHololiveMusicParticipants(participants, idolMetadata);
      const participantIdolIdsJson = this.stringifyIdolIdArray(this.getParticipantIdolIds(participants, idolMetadata), idolMetadata);
      const classification = this.buildHololiveMusicClassification(
        {
          youtubeVideoId: row.youtubeVideoId,
          title: row.title,
          songName,
          topicId: row.topicId,
          channelId: detail.channelId,
          channelName: row.channelName,
          originalChannelId: detail.originalChannelId,
          providedToYoutube: detail.providedToYoutube,
          participants,
          fallbackIdolId: idolId
        },
        channelContext,
        idolMetadata
      );
      const tags = normalizeTags(
        [
          "hololive",
          "music",
          row.topicId === "Original_Song" ? "original song" : "cover",
          idolId,
          ...participantTags,
          ...classification.ownedIdolIds,
          ...classification.featuredIdolIds,
          row.channelName,
          songName
        ]
          .filter((tag): tag is string => Boolean(tag))
      );

      this.run(
        `INSERT INTO catalog_items (id, module_id, kind, title, subtitle, source_url, created_at, updated_at)
         VALUES (?, 'hololive', 'music-video', ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           title = excluded.title,
           subtitle = excluded.subtitle,
           source_url = excluded.source_url,
           updated_at = excluded.updated_at`,
        [itemId, catalogTitle, row.channelName || null, row.youtubeUrl, now, now]
      );
      this.run(
        `INSERT OR IGNORE INTO tracked_entries
           (id, item_id, status, rating, notes, started_at, completed_at, created_at, updated_at)
         VALUES (?, ?, 'planned', NULL, NULL, NULL, NULL, ?, ?)`,
        [randomUUID(), itemId, now, now]
      );
      this.run(
        `INSERT INTO source_refs (id, item_id, source_id, source_key, detail_url, cover_url, created_at, updated_at)
         VALUES (?, ?, 'holodex', ?, ?, NULL, ?, ?)
         ON CONFLICT(source_id, source_key) DO UPDATE SET
           item_id = excluded.item_id,
           detail_url = excluded.detail_url,
           updated_at = excluded.updated_at`,
        [randomUUID(), itemId, row.youtubeVideoId, row.youtubeUrl, now, now]
      );
      this.run(
        `INSERT INTO hololive_music_videos
           (youtube_video_id, item_id, idol_id, youtube_url, title, status, topic_id, channel_id, channel_name,
            published_at, duration_seconds, song_name, original_channel_id, provided_to_youtube,
            participants_json, participant_idol_ids_json, canonical_song_key, canonical_performance_key,
            owned_idol_ids_json, featured_idol_ids_json, source_run_id, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(youtube_video_id) DO UPDATE SET
           item_id = excluded.item_id,
           idol_id = excluded.idol_id,
           youtube_url = excluded.youtube_url,
           title = excluded.title,
           status = excluded.status,
           topic_id = excluded.topic_id,
           channel_id = excluded.channel_id,
           channel_name = excluded.channel_name,
           published_at = excluded.published_at,
           duration_seconds = excluded.duration_seconds,
           song_name = excluded.song_name,
           original_channel_id = excluded.original_channel_id,
           provided_to_youtube = excluded.provided_to_youtube,
           participants_json = excluded.participants_json,
           participant_idol_ids_json = excluded.participant_idol_ids_json,
           canonical_song_key = excluded.canonical_song_key,
           canonical_performance_key = excluded.canonical_performance_key,
           owned_idol_ids_json = excluded.owned_idol_ids_json,
           featured_idol_ids_json = excluded.featured_idol_ids_json,
           source_run_id = excluded.source_run_id,
           updated_at = excluded.updated_at`,
        [
          row.youtubeVideoId,
          itemId,
          idolId,
          row.youtubeUrl,
          row.title,
          row.status,
          row.topicId,
          detail.channelId,
          row.channelName,
          row.publishedAt || null,
          detail.duration,
          songName,
          detail.originalChannelId || null,
          detail.providedToYoutube ? 1 : 0,
          participantsJson,
          participantIdolIdsJson,
          classification.canonicalSongKey,
          classification.canonicalPerformanceKey,
          JSON.stringify(classification.ownedIdolIds),
          JSON.stringify(classification.featuredIdolIds),
          runId,
          now
        ]
      );

      for (const tag of tags) {
        this.run("INSERT OR IGNORE INTO item_tags (item_id, tag) VALUES (?, ?)", [itemId, tag]);
      }
    }
  }

  private purgeCanonicalTopicDuplicateRows(runId: string): number {
    const rows = this.select<{
      youtube_video_id: string;
      title: string;
      song_name: string | null;
      topic_id: HololiveMusicTopic;
      canonical_performance_key: string;
      provided_to_youtube: number;
      duration_seconds: number | null;
      published_at: string | null;
    }>(
      `SELECT youtube_video_id, title, song_name, topic_id, canonical_performance_key,
              provided_to_youtube, duration_seconds, published_at
       FROM hololive_music_videos
       WHERE canonical_performance_key != ''
         AND canonical_performance_key IN (
           SELECT canonical_performance_key
           FROM hololive_music_videos
           WHERE canonical_performance_key != ''
           GROUP BY canonical_performance_key
           HAVING SUM(CASE WHEN provided_to_youtube = 1 THEN 1 ELSE 0 END) > 0
              AND SUM(CASE WHEN provided_to_youtube = 0 THEN 1 ELSE 0 END) > 0
         )
       ORDER BY canonical_performance_key, provided_to_youtube, youtube_video_id`
    );
    if (rows.length === 0) {
      return 0;
    }

    const rowsByKey = new Map<string, typeof rows>();
    for (const row of rows) {
      rowsByKey.set(row.canonical_performance_key, [...(rowsByKey.get(row.canonical_performance_key) ?? []), row]);
    }

    const removals: HolodexDuplicateRemoval[] = [];
    for (const componentRows of rowsByKey.values()) {
      const topicRows = componentRows.filter((row) => row.provided_to_youtube === 1);
      const nonTopicRows = componentRows.filter((row) => row.provided_to_youtube !== 1);
      if (topicRows.length === 0 || nonTopicRows.length === 0) {
        continue;
      }

      const keptRow = [...nonTopicRows].sort((left, right) => this.compareHololiveMusicDisplayRow(right, left))[0];
      for (const topicRow of topicRows) {
        removals.push({
          removedYoutubeVideoId: topicRow.youtube_video_id,
          removedTitle: topicRow.title,
          keptYoutubeVideoId: keptRow.youtube_video_id,
          keptTitle: keptRow.title,
          reason: "canonical_topic_duplicate_of_non_topic",
          songName: keptRow.song_name || keptRow.title,
          removedPublishedAt: topicRow.published_at || "",
          keptPublishedAt: keptRow.published_at || ""
        });
      }
    }

    if (removals.length === 0) {
      return 0;
    }

    for (const removal of removals) {
      this.deleteHololiveMusicVideoData(removal.removedYoutubeVideoId, { deleteStats: true });
    }
    this.upsertHolodexDuplicateRemovals(removals, runId);
    return removals.length;
  }

  private purgeCrossOwnerTopicDuplicateRows(runId: string): number {
    const rows = this.select<HololiveStoredMusicDuplicateRow>(
      `SELECT youtube_video_id, title, song_name, topic_id, canonical_song_key, canonical_performance_key,
              channel_id, channel_name, original_channel_id, provided_to_youtube, duration_seconds, published_at,
              participants_json, owned_idol_ids_json, featured_idol_ids_json
       FROM hololive_music_videos
       WHERE canonical_song_key != ''
       ORDER BY topic_id, canonical_song_key, provided_to_youtube, youtube_video_id`
    );
    if (rows.length === 0) {
      return 0;
    }

    const rowsBySongKey = new Map<string, HololiveStoredMusicDuplicateRow[]>();
    for (const row of rows) {
      const key = JSON.stringify([row.topic_id, row.canonical_song_key]);
      rowsBySongKey.set(key, [...(rowsBySongKey.get(key) ?? []), row]);
    }

    const removalsByRemovedId = new Map<string, HolodexDuplicateRemoval>();
    for (const componentRows of rowsBySongKey.values()) {
      const topicRows = componentRows.filter((row) => row.provided_to_youtube === 1);
      const nonTopicRows = componentRows.filter((row) => row.provided_to_youtube !== 1);
      if (topicRows.length === 0 || nonTopicRows.length === 0) {
        continue;
      }

      for (const topicRow of topicRows) {
        const matchingNonTopicRows = nonTopicRows.filter(
          (nonTopicRow) =>
            this.hasStoredHololiveDuplicateDurationOverlap(topicRow, nonTopicRow) &&
            this.hasStoredHololiveDuplicateParticipantOverlap(topicRow, nonTopicRow)
        );
        if (matchingNonTopicRows.length === 0) {
          continue;
        }

        const keptRow = [...matchingNonTopicRows].sort((left, right) =>
          this.compareHololiveMusicDisplayRow(right, left)
        )[0];
        if (!keptRow || keptRow.youtube_video_id === topicRow.youtube_video_id) {
          continue;
        }

        removalsByRemovedId.set(topicRow.youtube_video_id, {
          removedYoutubeVideoId: topicRow.youtube_video_id,
          removedTitle: topicRow.title,
          keptYoutubeVideoId: keptRow.youtube_video_id,
          keptTitle: keptRow.title,
          reason: "canonical_topic_duplicate_of_non_topic",
          songName: keptRow.song_name || keptRow.title,
          removedPublishedAt: topicRow.published_at || "",
          keptPublishedAt: keptRow.published_at || ""
        });
      }
    }

    const removals = [...removalsByRemovedId.values()];
    if (removals.length === 0) {
      return 0;
    }

    for (const removal of removals) {
      this.deleteHololiveMusicVideoData(removal.removedYoutubeVideoId, { deleteStats: true });
    }
    this.upsertHolodexDuplicateRemovals(removals, runId);
    return removals.length;
  }

  private hasStoredHololiveDuplicateDurationOverlap(
    left: Pick<HololiveStoredMusicDuplicateRow, "duration_seconds">,
    right: Pick<HololiveStoredMusicDuplicateRow, "duration_seconds">
  ): boolean {
    const leftDuration = left.duration_seconds ?? 0;
    const rightDuration = right.duration_seconds ?? 0;
    if (leftDuration <= 0 || rightDuration <= 0) {
      return true;
    }

    return Math.abs(leftDuration - rightDuration) <= HOLODEX_TOPIC_DUPLICATE_DURATION_TOLERANCE_SECONDS;
  }

  private hasStoredHololiveDuplicateParticipantOverlap(
    left: Pick<HololiveStoredMusicDuplicateRow, "participants_json" | "owned_idol_ids_json" | "featured_idol_ids_json">,
    right: Pick<HololiveStoredMusicDuplicateRow, "participants_json" | "owned_idol_ids_json" | "featured_idol_ids_json">
  ): boolean {
    const leftSignals = this.getStoredHololiveDuplicateParticipantSignals(left);
    if (leftSignals.size === 0) {
      return false;
    }

    for (const signal of this.getStoredHololiveDuplicateParticipantSignals(right)) {
      if (leftSignals.has(signal)) {
        return true;
      }
    }
    return false;
  }

  private getStoredHololiveDuplicateParticipantSignals(
    row: Pick<HololiveStoredMusicDuplicateRow, "participants_json" | "owned_idol_ids_json" | "featured_idol_ids_json">
  ): Set<string> {
    const signals = new Set<string>();
    for (const idolId of [...this.parseJsonStringArray(row.owned_idol_ids_json), ...this.parseJsonStringArray(row.featured_idol_ids_json)]) {
      if (idolId.trim()) {
        signals.add(idolId.trim());
      }
    }

    let participants: StoredHololiveMusicParticipant[] = [];
    try {
      const parsed = JSON.parse(row.participants_json ?? "[]") as unknown;
      participants = Array.isArray(parsed) ? (parsed as StoredHololiveMusicParticipant[]) : [];
    } catch {
      participants = [];
    }
    for (const participant of participants) {
      const idolId = participant?.idolId?.trim() ?? "";
      if (idolId) {
        signals.add(idolId);
      }
    }

    return signals;
  }

  private purgeCanonicalVariantDuplicateRows(runId: string): number {
    const rows = this.select<{
      youtube_video_id: string;
      title: string;
      song_name: string | null;
      topic_id: HololiveMusicTopic;
      canonical_song_key: string;
      canonical_performance_key: string;
      channel_id: string | null;
      channel_name: string | null;
      original_channel_id: string | null;
      provided_to_youtube: number;
      duration_seconds: number | null;
      published_at: string | null;
    }>(
      `SELECT youtube_video_id, title, song_name, topic_id, canonical_song_key, canonical_performance_key,
              channel_id, channel_name, original_channel_id, provided_to_youtube, duration_seconds, published_at
       FROM hololive_music_videos
       WHERE canonical_song_key != ''
       ORDER BY canonical_song_key, canonical_performance_key, youtube_video_id`
    );
    if (rows.length === 0) {
      return 0;
    }

    const removalsByRemovedId = new Map<string, HolodexDuplicateRemoval>();
    const collectVariantRemovals = (componentRows: typeof rows) => {
      if (componentRows.length < 2) {
        return;
      }

      const lowPriorityRows = componentRows.filter((row) =>
        hasHololiveLowPriorityVersionMarker([row.title, row.song_name ?? ""].join(" "))
      );
      const fullRows = componentRows.filter((row) => !lowPriorityRows.includes(row));
      if (lowPriorityRows.length === 0 || fullRows.length === 0) {
        return;
      }

      const keptRow = [...fullRows].sort((left, right) => this.compareHololiveMusicDisplayRow(right, left))[0];
      for (const variantRow of lowPriorityRows) {
        if (variantRow.youtube_video_id === keptRow.youtube_video_id || removalsByRemovedId.has(variantRow.youtube_video_id)) {
          continue;
        }

        removalsByRemovedId.set(variantRow.youtube_video_id, {
          removedYoutubeVideoId: variantRow.youtube_video_id,
          removedTitle: variantRow.title,
          keptYoutubeVideoId: keptRow.youtube_video_id,
          keptTitle: keptRow.title,
          reason: "canonical_variant_duplicate_of_full",
          songName: keptRow.song_name || keptRow.title,
          removedPublishedAt: variantRow.published_at || "",
          keptPublishedAt: keptRow.published_at || ""
        });
      }
    };

    const rowsByPerformanceKey = new Map<string, typeof rows>();
    for (const row of rows) {
      if (!row.canonical_performance_key.trim()) {
        continue;
      }
      rowsByPerformanceKey.set(row.canonical_performance_key, [
        ...(rowsByPerformanceKey.get(row.canonical_performance_key) ?? []),
        row
      ]);
    }

    for (const componentRows of rowsByPerformanceKey.values()) {
      collectVariantRemovals(componentRows);
    }

    const rowsBySongOwnerKey = new Map<string, typeof rows>();
    const addSongOwnerGroup = (keyParts: Array<string | null | undefined>, row: (typeof rows)[number]) => {
      const normalizedParts = keyParts.map((part) => part?.trim() ?? "");
      if (normalizedParts.some((part) => !part)) {
        return;
      }

      const key = JSON.stringify(normalizedParts);
      rowsBySongOwnerKey.set(key, [...(rowsBySongOwnerKey.get(key) ?? []), row]);
    };

    for (const row of rows) {
      addSongOwnerGroup(["performance", row.canonical_performance_key], row);
      addSongOwnerGroup(["uploader", row.topic_id, row.canonical_song_key, row.channel_id], row);
      addSongOwnerGroup(["uploader-name", row.topic_id, row.canonical_song_key, row.channel_name], row);

      const effectiveOwnerChannelId =
        row.provided_to_youtube === 1 && row.original_channel_id?.trim()
          ? row.original_channel_id.trim()
          : row.channel_id?.trim() ?? "";
      addSongOwnerGroup(["effective-owner", row.topic_id, row.canonical_song_key, effectiveOwnerChannelId], row);
    }

    for (const componentRows of rowsBySongOwnerKey.values()) {
      collectVariantRemovals(componentRows);
    }

    const removals = [...removalsByRemovedId.values()];
    if (removals.length === 0) {
      return 0;
    }

    for (const removal of removals) {
      this.deleteHololiveMusicVideoData(removal.removedYoutubeVideoId, { deleteStats: true });
    }
    this.upsertHolodexDuplicateRemovals(removals, runId);
    return removals.length;
  }

  private transferHololiveMusicReferencesFromDuplicateRemovals(runId: string): void {
    const removals = this.select<{
      removed_youtube_video_id: string;
      kept_youtube_video_id: string | null;
    }>(
      `SELECT removed_youtube_video_id, kept_youtube_video_id
       FROM hololive_music_duplicate_removals
       WHERE source_run_id = ?
         AND kept_youtube_video_id IS NOT NULL
         AND kept_youtube_video_id != ''`,
      [runId]
    );
    if (removals.length === 0) {
      return;
    }

    const transferReferences = () => {
      for (const removal of removals) {
        const removedId = removal.removed_youtube_video_id.trim();
        const keptId = removal.kept_youtube_video_id?.trim() ?? "";
        if (!removedId || !keptId || removedId === keptId) {
          continue;
        }

        const keptSnapshot = this.select<{ title: string; youtube_url: string }>(
          "SELECT title, youtube_url FROM hololive_music_videos WHERE youtube_video_id = ?",
          [keptId]
        )[0];
        const keptTitle = keptSnapshot?.title ?? null;
        const keptUrl = keptSnapshot?.youtube_url ?? null;

        const removedExclusion = this.select<{ youtube_video_id: string }>(
          "SELECT youtube_video_id FROM hololive_music_exclusions WHERE youtube_video_id = ?",
          [removedId]
        )[0];
        if (removedExclusion) {
          const keptExclusion = this.select<{ youtube_video_id: string }>(
            "SELECT youtube_video_id FROM hololive_music_exclusions WHERE youtube_video_id = ?",
            [keptId]
          )[0];
          if (keptExclusion) {
            this.run("DELETE FROM hololive_music_exclusions WHERE youtube_video_id = ?", [removedId]);
          } else {
            this.run(
              `UPDATE hololive_music_exclusions
               SET youtube_video_id = ?,
                   title_snapshot = COALESCE(?, title_snapshot),
                   source_url_snapshot = COALESCE(?, source_url_snapshot)
               WHERE youtube_video_id = ?`,
              [keptId, keptTitle, keptUrl, removedId]
            );
          }
        }

        const affectedPlaylistIds = this.select<{ playlist_id: string }>(
          "SELECT DISTINCT playlist_id FROM hololive_music_playlist_items WHERE youtube_video_id = ?",
          [removedId]
        ).map((row) => row.playlist_id);
        this.run(
          `DELETE FROM hololive_music_playlist_items
           WHERE youtube_video_id = ?
             AND EXISTS (
               SELECT 1
               FROM hololive_music_playlist_items kept
               WHERE kept.playlist_id = hololive_music_playlist_items.playlist_id
                 AND kept.youtube_video_id = ?
             )`,
          [removedId, keptId]
        );
        this.run(
          `UPDATE hololive_music_playlist_items
           SET youtube_video_id = ?,
               title_snapshot = COALESCE(?, title_snapshot),
               source_url_snapshot = COALESCE(?, source_url_snapshot)
           WHERE youtube_video_id = ?`,
          [keptId, keptTitle, keptUrl, removedId]
        );
        for (const playlistId of affectedPlaylistIds) {
          this.normalizeHololiveMusicPlaylistItemPositionsWithinTransaction(playlistId);
        }

        this.run(
          `UPDATE hololive_music_queue_items
           SET youtube_video_id = ?,
               title_snapshot = COALESCE(?, title_snapshot),
               source_url_snapshot = COALESCE(?, source_url_snapshot)
           WHERE youtube_video_id = ?`,
          [keptId, keptTitle, keptUrl, removedId]
        );
        this.run(
          "UPDATE hololive_music_player_state SET current_youtube_video_id = ? WHERE current_youtube_video_id = ?",
          [keptId, removedId]
        );
        this.run("DELETE FROM hololive_music_detail_cache WHERE youtube_video_id = ?", [removedId]);
        this.run("DELETE FROM hololive_music_video_stats WHERE youtube_video_id = ?", [removedId]);
      }

      this.normalizeHololiveMusicQueuePositionsWithinTransaction();
    };

    if (this.inTransaction) {
      transferReferences();
    } else {
      this.transaction(transferReferences);
    }
  }

  private transferHololiveMusicMarkersFromDuplicateRemovals(runId: string): void {
    const removals = this.select<{
      removed_youtube_video_id: string;
      kept_youtube_video_id: string | null;
    }>(
      `SELECT removed_youtube_video_id, kept_youtube_video_id
       FROM hololive_music_duplicate_removals
       WHERE source_run_id = ?
         AND kept_youtube_video_id IS NOT NULL
         AND kept_youtube_video_id != ''`,
      [runId]
    );
    if (removals.length === 0) {
      return;
    }

    const transferMarkers = () => {
      for (const removal of removals) {
        const markerRow = this.select<{
          marker: HololiveMusicMarker;
          created_at: string;
          updated_at: string;
        }>(
          `SELECT marker, created_at, updated_at
           FROM hololive_music_marker_keys
           WHERE marker_key = ?
           ORDER BY updated_at DESC
           LIMIT 1`,
          [`video:${removal.removed_youtube_video_id}`]
        )[0];
        if (!markerRow || !this.isHololiveMusicMarker(markerRow.marker) || !removal.kept_youtube_video_id) {
          continue;
        }

        for (const markerKey of this.getHololiveMusicMarkerKeysForVideo(removal.kept_youtube_video_id)) {
          this.run(
            `INSERT INTO hololive_music_marker_keys (marker_key, marker, created_at, updated_at)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(marker_key) DO UPDATE SET
               marker = CASE
                 WHEN excluded.updated_at >= hololive_music_marker_keys.updated_at THEN excluded.marker
                 ELSE hololive_music_marker_keys.marker
               END,
               updated_at = CASE
                 WHEN excluded.updated_at >= hololive_music_marker_keys.updated_at THEN excluded.updated_at
                 ELSE hololive_music_marker_keys.updated_at
               END`,
            [markerKey, markerRow.marker, markerRow.created_at, markerRow.updated_at]
          );
        }
      }
    };

    if (this.inTransaction) {
      transferMarkers();
    } else {
      this.transaction(transferMarkers);
    }
  }

  private getHolodexMusicItemId(youtubeVideoId: string): string {
    return `holodex:${youtubeVideoId}`;
  }

  private listHololiveTierBoardSummaries(): HololiveTierBoardSummary[] {
    const totalCount = Number(
      this.select<{ count: number }>("SELECT COUNT(*) AS count FROM hololive_idols")[0]?.count ?? 0
    );

    return this.select<{
      id: string;
      name: string;
      tile_size: number;
      updated_at: string;
      ranked_count: number;
    }>(
      `SELECT b.id, b.name, b.tile_size, b.updated_at,
              COUNT(CASE WHEN p.tier_id IS NOT NULL THEN 1 END) AS ranked_count
       FROM hololive_tier_boards b
       LEFT JOIN hololive_tier_placements p ON p.board_id = b.id
       GROUP BY b.id
       ORDER BY b.position ASC, b.created_at ASC, b.id ASC`
    ).map((row) => ({
      id: row.id,
      name: row.name,
      tileSize: Number(row.tile_size),
      rankedCount: Number(row.ranked_count ?? 0),
      totalCount,
      updatedAt: row.updated_at
    }));
  }

  private getHololiveTierBoard(boardId: string): HololiveTierBoard {
    const board = this.select<{
      id: string;
      name: string;
      tile_size: number;
      created_at: string;
      updated_at: string;
    }>("SELECT id, name, tile_size, created_at, updated_at FROM hololive_tier_boards WHERE id = ?", [boardId])[0];

    if (!board) {
      throw new Error(`Unknown Hololive tier board: ${boardId}`);
    }

    return {
      id: board.id,
      name: board.name,
      tileSize: Number(board.tile_size),
      createdAt: board.created_at,
      updatedAt: board.updated_at,
      tiers: this.selectHololiveTiers(board.id),
      placements: this.selectHololivePlacements(board.id)
    };
  }

  private nextHololiveBoardPosition(afterBoardId: string | null): number {
    if (afterBoardId) {
      const after = this.select<{ position: number }>(
        "SELECT position FROM hololive_tier_boards WHERE id = ?",
        [afterBoardId]
      )[0];

      if (after) {
        return Number(after.position) + 1;
      }
    }

    const next = this.select<{ position: number }>(
      "SELECT COALESCE(MAX(position) + 1, 0) AS position FROM hololive_tier_boards"
    )[0];
    return Number(next?.position ?? 0);
  }

  private slugifyHololiveCustomTalent(value: string): string {
    const slug = buildNormalizedHololiveMusicKey(value)
      .replace(/_/g, "-")
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
    return slug || `talent-${Date.now()}`;
  }

  private nextHololiveCustomTalentId(baseSlug: string): string {
    const baseId = `custom-${baseSlug}`;
    let candidate = baseId;
    let suffix = 2;
    while (this.select<{ id: string }>("SELECT id FROM hololive_idols WHERE id = ?", [candidate]).length > 0) {
      candidate = `${baseId}-${suffix}`;
      suffix += 1;
    }
    return candidate;
  }

  private nextHololiveCustomTalentSlug(baseSlug: string): string {
    let candidate = baseSlug;
    let suffix = 2;
    while (this.select<{ slug: string }>("SELECT slug FROM hololive_idols WHERE slug = ?", [candidate]).length > 0) {
      candidate = `${baseSlug}-${suffix}`;
      suffix += 1;
    }
    return candidate;
  }

  private nextHololiveIdolSortOrder(): number {
    return Number(this.select<{ next_order: number }>("SELECT COALESCE(MAX(sort_order) + 1, 0) AS next_order FROM hololive_idols")[0]?.next_order ?? 0);
  }

  private removeHololiveChannelIdolId(channelId: string, idolId: string, timestamp = new Date().toISOString()): void {
    const id = channelId.trim();
    if (!id) {
      return;
    }
    const row = this.select<{
      org: string | null;
      kind: HololiveChannelKind;
      main_idol_ids_json: string;
      topic_idol_ids_json: string;
    }>("SELECT org, kind, main_idol_ids_json, topic_idol_ids_json FROM hololive_channels WHERE id = ?", [id])[0];
    if (!row) {
      return;
    }

    const mainIdolIds = this.parseJsonStringArray(row.main_idol_ids_json).filter((value) => value !== idolId);
    const topicIdolIds = this.parseJsonStringArray(row.topic_idol_ids_json).filter((value) => value !== idolId);
    const linkedIdolIds = this.unionIdolIds(mainIdolIds, topicIdolIds);
    if (linkedIdolIds.length === 0 && row.org !== "Hololive") {
      this.run("DELETE FROM hololive_channels WHERE id = ?", [id]);
      return;
    }

    const kind = this.getMergedHololiveChannelKind(row.org, mainIdolIds, topicIdolIds, row.kind);
    this.run(
      `UPDATE hololive_channels
       SET kind = ?,
           main_idol_ids_json = ?,
           topic_idol_ids_json = ?,
           linked_idol_ids_json = ?,
           updated_at = ?
       WHERE id = ?`,
      [
        kind,
        this.stringifyIdolIdArray(mainIdolIds),
        this.stringifyIdolIdArray(topicIdolIds),
        this.stringifyIdolIdArray(linkedIdolIds),
        timestamp,
        id
      ]
    );
  }

  private deleteHololiveMusicRowsForChannel(channelId: string): void {
    const id = channelId.trim();
    if (!id) {
      return;
    }
    const rows = this.select<{ youtube_video_id: string }>(
      `SELECT DISTINCT v.youtube_video_id
       FROM hololive_music_videos v
       LEFT JOIN hololive_music_detail_cache d ON d.youtube_video_id = v.youtube_video_id
       WHERE v.channel_id = ?
          OR v.original_channel_id = ?
          OR d.channel_id = ?
          OR d.original_channel_id = ?`,
      [id, id, id, id]
    );

    for (const row of rows) {
      this.deleteHololiveMusicVideoData(row.youtube_video_id);
    }
  }

  private tableExists(tableName: string): boolean {
    return (
      this.select<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", [tableName]).length > 0
    );
  }

  private tableColumnNames(tableName: string): Set<string> {
    return new Set(this.select<{ name: string }>(`PRAGMA table_info(${tableName})`).map((row) => row.name));
  }

  private migrateHololiveMusicVideosToMergedParticipants(): void {
    const hasVideos = this.tableExists("hololive_music_videos");

    if (!hasVideos) {
      return;
    }

    const existingColumns = this.tableColumnNames("hololive_music_videos");
    const needsRewrite =
      !existingColumns.has("participants_json") ||
      !existingColumns.has("participant_idol_ids_json") ||
      !existingColumns.has("canonical_song_key") ||
      !existingColumns.has("canonical_performance_key") ||
      !existingColumns.has("owned_idol_ids_json") ||
      !existingColumns.has("featured_idol_ids_json");

    if (!needsRewrite) {
      this.deleteExcludedHolodexChannelData();
      return;
    }

    const selectExpression = (column: string, fallback: string) =>
      existingColumns.has(column) ? column : `${fallback} AS ${column}`;
    const rows = this.select<{
      youtube_video_id: string;
      item_id: string;
      idol_id: string | null;
      youtube_url: string;
      title: string;
      status: string;
      topic_id: HololiveMusicTopic;
      channel_id: string;
      channel_name: string;
      published_at: string | null;
      duration_seconds: number | null;
      song_name: string | null;
      original_channel_id: string | null;
      provided_to_youtube: number | null;
      participants_json: string | null;
      canonical_song_key: string | null;
      canonical_performance_key: string | null;
      owned_idol_ids_json: string | null;
      featured_idol_ids_json: string | null;
      source_run_id: string | null;
      updated_at: string;
    }>(
      `SELECT
         ${selectExpression("youtube_video_id", "''")},
         ${selectExpression("item_id", "''")},
         ${selectExpression("idol_id", "NULL")},
         ${selectExpression("youtube_url", "''")},
         ${selectExpression("title", "''")},
         ${selectExpression("status", "'past'")},
         ${selectExpression("topic_id", "'Original_Song'")},
         ${selectExpression("channel_id", "''")},
         ${selectExpression("channel_name", "''")},
         ${selectExpression("published_at", "NULL")},
         ${selectExpression("duration_seconds", "NULL")},
         ${selectExpression("song_name", "NULL")},
         ${selectExpression("original_channel_id", "NULL")},
         ${selectExpression("provided_to_youtube", "0")},
         ${selectExpression("participants_json", "'[]'")},
         ${selectExpression("canonical_song_key", "''")},
         ${selectExpression("canonical_performance_key", "''")},
         ${selectExpression("owned_idol_ids_json", "'[]'")},
         ${selectExpression("featured_idol_ids_json", "'[]'")},
         ${selectExpression("source_run_id", "NULL")},
         ${selectExpression("updated_at", "''")}
       FROM hololive_music_videos`
    );
    const idolMetadata = this.getHololiveIdolMetadataMap();
    const now = new Date().toISOString();
    this.transaction(() => {
      this.run("DROP TABLE IF EXISTS hololive_music_videos_next");
      this.run(
        `CREATE TABLE hololive_music_videos_next (
          youtube_video_id TEXT PRIMARY KEY,
          item_id TEXT NOT NULL UNIQUE REFERENCES catalog_items(id) ON DELETE CASCADE,
          idol_id TEXT REFERENCES hololive_idols(id) ON DELETE SET NULL,
          youtube_url TEXT NOT NULL,
          title TEXT NOT NULL,
          status TEXT NOT NULL,
          topic_id TEXT NOT NULL CHECK(topic_id IN ('Original_Song', 'Music_Cover')),
          channel_id TEXT NOT NULL,
          channel_name TEXT NOT NULL,
          published_at TEXT,
          duration_seconds INTEGER,
          song_name TEXT,
          original_channel_id TEXT,
          provided_to_youtube INTEGER NOT NULL DEFAULT 0,
          participants_json TEXT NOT NULL DEFAULT '[]',
          participant_idol_ids_json TEXT NOT NULL DEFAULT '[]',
          canonical_song_key TEXT NOT NULL DEFAULT '',
          canonical_performance_key TEXT NOT NULL DEFAULT '',
          owned_idol_ids_json TEXT NOT NULL DEFAULT '[]',
          featured_idol_ids_json TEXT NOT NULL DEFAULT '[]',
          source_run_id TEXT REFERENCES hololive_music_refresh_runs(id),
          updated_at TEXT NOT NULL
        )`
      );

      for (const row of rows) {
        if (
          !row.youtube_video_id ||
          isExcludedHolodexChannelId(row.channel_id) ||
          isExcludedHolodexChannelId(row.original_channel_id ?? "")
        ) {
          continue;
        }

        const existingParticipants = this.parseStoredHololiveMusicParticipants(
          row.youtube_video_id,
          row.participants_json,
          idolMetadata
        ).map(({ idolId, role, channelId }) => ({ idolId, role, channelId }));
        const mergedParticipants = this.normalizeStoredHololiveMusicParticipants(existingParticipants, idolMetadata);

        this.run(
        `INSERT INTO hololive_music_videos_next
           (youtube_video_id, item_id, idol_id, youtube_url, title, status, topic_id, channel_id, channel_name,
              published_at, duration_seconds, song_name, original_channel_id, provided_to_youtube,
              participants_json, participant_idol_ids_json, canonical_song_key, canonical_performance_key,
              owned_idol_ids_json, featured_idol_ids_json, source_run_id, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            row.youtube_video_id,
            row.item_id,
            row.idol_id || null,
            row.youtube_url,
            row.title,
            row.status,
            row.topic_id,
            row.channel_id,
            row.channel_name,
            row.published_at || null,
            row.duration_seconds,
            row.song_name || null,
            row.original_channel_id || null,
            row.provided_to_youtube ? 1 : 0,
            this.stringifyHololiveMusicParticipants(mergedParticipants),
            this.stringifyIdolIdArray(this.getParticipantIdolIds(mergedParticipants)),
            row.canonical_song_key || "",
            row.canonical_performance_key || "",
            row.owned_idol_ids_json || "[]",
            row.featured_idol_ids_json || "[]",
            row.source_run_id || null,
            row.updated_at || now
          ]
        );
      }

      this.run("DROP TABLE hololive_music_videos");
      this.run("ALTER TABLE hololive_music_videos_next RENAME TO hololive_music_videos");
      this.run(
        "CREATE INDEX IF NOT EXISTS idx_hololive_music_videos_idol_topic ON hololive_music_videos(idol_id, topic_id, published_at)"
      );
      this.run("CREATE INDEX IF NOT EXISTS idx_hololive_music_videos_channel ON hololive_music_videos(channel_id)");
      this.run("CREATE INDEX IF NOT EXISTS idx_hololive_music_videos_song ON hololive_music_videos(song_name)");
      this.run("CREATE INDEX IF NOT EXISTS idx_hololive_music_videos_canonical_song ON hololive_music_videos(canonical_song_key)");
      this.run(
        "CREATE INDEX IF NOT EXISTS idx_hololive_music_videos_canonical_performance ON hololive_music_videos(canonical_performance_key)"
      );
      this.deleteExcludedHolodexChannelData();
    });
  }

  private migrateHololiveChannelsToMergedSchema(): void {
    if (!this.tableExists("hololive_channels")) {
      return;
    }

    const desiredColumns = [
      "id",
      "name",
      "english_name",
      "type",
      "org",
      "group_name",
      "photo_url",
      "twitter",
      "video_count",
      "subscriber_count",
      "clip_count",
      "published_at",
      "inactive",
      "kind",
      "main_idol_ids_json",
      "topic_idol_ids_json",
      "linked_idol_ids_json",
      "updated_at"
    ];
    const existingColumns = this.tableColumnNames("hololive_channels");
    const needsRewrite = desiredColumns.some((column) => !existingColumns.has(column));

    if (!needsRewrite) {
      this.deleteExcludedHolodexChannelData();
      this.classifyHolodexGroupChannels();
      return;
    }

    const selectExpression = (column: string, fallback: string) =>
      existingColumns.has(column) ? column : `${fallback} AS ${column}`;
    const channelRows = this.select<{
      id: string;
      name: string | null;
      english_name: string | null;
      type: string | null;
      org: string | null;
      group_name: string | null;
      photo_url: string | null;
      twitter: string | null;
      video_count: number | null;
      subscriber_count: number | null;
      clip_count: number | null;
      published_at: string | null;
      inactive: number | null;
      kind: HololiveChannelKind | null;
      main_idol_ids_json: string | null;
      topic_idol_ids_json: string | null;
      linked_idol_ids_json: string | null;
      updated_at: string | null;
    }>(
      `SELECT
         ${selectExpression("id", "''")},
         ${selectExpression("name", "''")},
         ${selectExpression("english_name", "NULL")},
         ${selectExpression("type", "NULL")},
         ${selectExpression("org", "NULL")},
         ${selectExpression("group_name", "NULL")},
         ${selectExpression("photo_url", "NULL")},
         ${selectExpression("twitter", "NULL")},
         ${selectExpression("video_count", "NULL")},
         ${selectExpression("subscriber_count", "NULL")},
         ${selectExpression("clip_count", "NULL")},
         ${selectExpression("published_at", "NULL")},
         ${selectExpression("inactive", "0")},
         ${selectExpression("kind", "'unknown'")},
         ${selectExpression("main_idol_ids_json", "'[]'")},
         ${selectExpression("topic_idol_ids_json", "'[]'")},
         ${selectExpression("linked_idol_ids_json", "'[]'")},
         ${selectExpression("updated_at", "''")}
       FROM hololive_channels`
    );
    const rowsById = new Map<string, (typeof channelRows)[number]>();
    for (const row of channelRows) {
      const id = row.id?.trim();
      if (!id || isExcludedHolodexChannelId(id)) {
        continue;
      }
      rowsById.set(id, row);
    }

    const now = new Date().toISOString();
    this.transaction(() => {
      this.run("DROP TABLE IF EXISTS hololive_channels_next");
      this.run(
        `CREATE TABLE hololive_channels_next (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL DEFAULT '',
          english_name TEXT,
          type TEXT,
          org TEXT,
          group_name TEXT,
          photo_url TEXT,
          twitter TEXT,
          video_count INTEGER,
          subscriber_count INTEGER,
          clip_count INTEGER,
          published_at TEXT,
          inactive INTEGER NOT NULL DEFAULT 0,
          kind TEXT NOT NULL DEFAULT 'unknown' CHECK(kind IN ('idol', 'topic', 'group', 'unknown')),
          main_idol_ids_json TEXT NOT NULL DEFAULT '[]',
          topic_idol_ids_json TEXT NOT NULL DEFAULT '[]',
          linked_idol_ids_json TEXT NOT NULL DEFAULT '[]',
          updated_at TEXT NOT NULL
        )`
      );

      for (const row of rowsById.values()) {
        const mainIdolIds = this.parseJsonStringArray(row.main_idol_ids_json);
        const topicIdolIds = this.parseJsonStringArray(row.topic_idol_ids_json);
        const linkedIdolIds = this.unionIdolIds(this.parseJsonStringArray(row.linked_idol_ids_json), mainIdolIds, topicIdolIds);
        const kind = this.getMergedHololiveChannelKind(
          row.org,
          mainIdolIds,
          topicIdolIds,
          row.kind ?? "unknown"
        );
        this.run(
          `INSERT INTO hololive_channels_next
             (id, name, english_name, type, org, group_name, photo_url, twitter, video_count,
              subscriber_count, clip_count, published_at, inactive, kind, main_idol_ids_json,
              topic_idol_ids_json, linked_idol_ids_json, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            row.id,
            row.name || "",
            row.english_name || null,
            row.type || null,
            row.org || null,
            row.group_name || null,
            row.photo_url || null,
            row.twitter || null,
            row.video_count,
            row.subscriber_count,
            row.clip_count,
            row.published_at || null,
            row.inactive ? 1 : 0,
            kind,
            this.stringifyIdolIdArray(mainIdolIds),
            this.stringifyIdolIdArray(topicIdolIds),
            this.stringifyIdolIdArray(linkedIdolIds),
            row.updated_at || now
          ]
        );
      }

      this.run("DROP TABLE hololive_channels");
      this.run("ALTER TABLE hololive_channels_next RENAME TO hololive_channels");
      this.run("CREATE INDEX IF NOT EXISTS idx_hololive_channels_kind ON hololive_channels(kind)");
      this.deleteExcludedHolodexChannelData();
      this.classifyHolodexGroupChannels(now);
    });
  }

  private migrateHololiveMusicMarkersToKeyedSchema(): void {
    if (!this.tableExists("hololive_music_marker_keys")) {
      return;
    }

    if (!this.tableExists("hololive_music_markers")) {
      return;
    }

    const rows = this.select<{
      youtube_video_id: string;
      marker: HololiveMusicMarker;
      created_at: string;
      updated_at: string;
    }>(
      `SELECT youtube_video_id, marker, created_at, updated_at
       FROM hololive_music_markers`
    );

    this.transaction(() => {
      for (const row of rows) {
        if (!this.isHololiveMusicMarker(row.marker)) {
          continue;
        }
        const keys = this.getHololiveMusicMarkerKeysForVideo(row.youtube_video_id);
        for (const markerKey of [...new Set(keys.map((key) => key.trim()).filter(Boolean))]) {
          this.run(
            `INSERT INTO hololive_music_marker_keys (marker_key, marker, created_at, updated_at)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(marker_key) DO UPDATE SET
               marker = CASE
                 WHEN excluded.updated_at >= hololive_music_marker_keys.updated_at THEN excluded.marker
                 ELSE hololive_music_marker_keys.marker
               END,
               updated_at = CASE
                 WHEN excluded.updated_at >= hololive_music_marker_keys.updated_at THEN excluded.updated_at
                 ELSE hololive_music_marker_keys.updated_at
               END`,
            [markerKey, row.marker, row.created_at, row.updated_at]
          );
        }
      }

      this.run("DROP TABLE hololive_music_markers");
    });
  }

  private backfillHololiveMusicMarkerFallbackKeys(): void {
    if (!this.tableExists("hololive_music_marker_keys")) {
      return;
    }

    const rows = this.select<{
      marker_key: string;
      marker: HololiveMusicMarker;
      created_at: string;
      updated_at: string;
    }>(
      `SELECT marker_key, marker, created_at, updated_at
       FROM hololive_music_marker_keys
       WHERE marker_key NOT LIKE 'video:%'`
    );

    if (rows.length === 0) {
      return;
    }

    this.transaction(() => {
      for (const row of rows) {
        if (!this.isHololiveMusicMarker(row.marker)) {
          continue;
        }

        const videoIds = this.select<{ youtube_video_id: string }>(
          `SELECT youtube_video_id
           FROM hololive_music_videos
           WHERE canonical_performance_key = ?`,
          [row.marker_key]
        );

        for (const videoRow of videoIds) {
          this.run(
            `INSERT INTO hololive_music_marker_keys (marker_key, marker, created_at, updated_at)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(marker_key) DO UPDATE SET
               marker = CASE
                 WHEN excluded.updated_at >= hololive_music_marker_keys.updated_at THEN excluded.marker
                 ELSE hololive_music_marker_keys.marker
               END,
               updated_at = CASE
                 WHEN excluded.updated_at >= hololive_music_marker_keys.updated_at THEN excluded.updated_at
                 ELSE hololive_music_marker_keys.updated_at
               END`,
            [`video:${videoRow.youtube_video_id}`, row.marker, row.created_at, row.updated_at]
          );
        }
      }
    });
  }

  private deleteExcludedHolodexChannelData(): void {
    const excludedIds = [...EXCLUDED_HOLODEX_CHANNEL_IDS];
    if (excludedIds.length === 0) {
      return;
    }

    const placeholders = excludedIds.map(() => "?").join(", ");
    const itemRows = this.select<{ item_id: string }>(
      `SELECT item_id FROM hololive_music_videos WHERE channel_id IN (${placeholders})`,
      excludedIds
    );
    if (itemRows.length > 0) {
      this.run(
        `DELETE FROM catalog_items WHERE id IN (${itemRows.map(() => "?").join(", ")})`,
        itemRows.map((row) => row.item_id)
      );
    }
    this.run(`DELETE FROM hololive_music_detail_cache WHERE channel_id IN (${placeholders}) OR original_channel_id IN (${placeholders})`, [
      ...excludedIds,
      ...excludedIds
    ]);
    const musicVideoColumns = this.tableExists("hololive_music_videos")
      ? this.tableColumnNames("hololive_music_videos")
      : new Set<string>();
    if (musicVideoColumns.has("participants_json") && musicVideoColumns.has("participant_idol_ids_json")) {
      const rows = this.select<{ youtube_video_id: string; participants_json: string | null }>(
        "SELECT youtube_video_id, participants_json FROM hololive_music_videos"
      );
      const idolMetadata = this.getHololiveIdolMetadataMap();
      for (const row of rows) {
        const participants = this.parseStoredHololiveMusicParticipants(
          row.youtube_video_id,
          row.participants_json,
          idolMetadata
        ).map(({ idolId, role, channelId }) => ({ idolId, role, channelId }));
        const participantsJson = this.stringifyHololiveMusicParticipants(participants);
        if (participantsJson !== (row.participants_json || "[]")) {
          this.run(
            `UPDATE hololive_music_videos
             SET participants_json = ?, participant_idol_ids_json = ?
             WHERE youtube_video_id = ?`,
            [
              participantsJson,
              this.stringifyIdolIdArray(this.getParticipantIdolIds(participants)),
              row.youtube_video_id
            ]
          );
        }
      }
    }
    this.run(`DELETE FROM hololive_channels WHERE id IN (${placeholders})`, excludedIds);
  }

  private backfillHololiveMusicClassifications(): void {
    if (!this.tableExists("hololive_music_videos")) {
      return;
    }

    const columns = this.tableColumnNames("hololive_music_videos");
    const requiredColumns = [
      "canonical_song_key",
      "canonical_performance_key",
      "owned_idol_ids_json",
      "featured_idol_ids_json",
      "participants_json"
    ];
    if (requiredColumns.some((column) => !columns.has(column))) {
      return;
    }

    const rows = this.select<{
      youtube_video_id: string;
      idol_id: string | null;
      title: string;
      topic_id: HololiveMusicTopic;
      channel_id: string;
      channel_name: string | null;
      song_name: string | null;
      original_channel_id: string | null;
      provided_to_youtube: number;
      participants_json: string | null;
      canonical_song_key: string | null;
      canonical_performance_key: string | null;
      owned_idol_ids_json: string | null;
      featured_idol_ids_json: string | null;
    }>(
      `SELECT youtube_video_id, idol_id, title, topic_id, channel_id, channel_name, song_name, original_channel_id,
              provided_to_youtube, participants_json, canonical_song_key, canonical_performance_key,
              owned_idol_ids_json, featured_idol_ids_json
       FROM hololive_music_videos`
    );
    if (rows.length === 0) {
      return;
    }

    const channelContext = this.getHololiveChannelContext();
    const idolMetadata = this.getHololiveIdolMetadataMap();
    const updateClassifications = () => {
      for (const row of rows) {
        const participants = this.parseStoredHololiveMusicParticipants(
          row.youtube_video_id,
          row.participants_json,
          idolMetadata
        ).map(({ idolId, role, channelId }) => ({ idolId, role, channelId }));
        const classification = this.buildHololiveMusicClassification(
          {
            youtubeVideoId: row.youtube_video_id,
            title: row.title,
            songName: row.song_name,
            topicId: row.topic_id,
            channelId: row.channel_id,
            channelName: row.channel_name,
            originalChannelId: row.original_channel_id,
            providedToYoutube: row.provided_to_youtube,
            participants,
            fallbackIdolId: row.idol_id
          },
          channelContext,
          idolMetadata
        );
        const ownedIdolIdsJson = JSON.stringify(classification.ownedIdolIds);
        const featuredIdolIdsJson = JSON.stringify(classification.featuredIdolIds);

        if (
          row.canonical_song_key === classification.canonicalSongKey &&
          row.canonical_performance_key === classification.canonicalPerformanceKey &&
          (row.owned_idol_ids_json || "[]") === ownedIdolIdsJson &&
          (row.featured_idol_ids_json || "[]") === featuredIdolIdsJson
        ) {
          continue;
        }

        this.run(
          `UPDATE hololive_music_videos
           SET canonical_song_key = ?,
               canonical_performance_key = ?,
               owned_idol_ids_json = ?,
               featured_idol_ids_json = ?
           WHERE youtube_video_id = ?`,
          [
            classification.canonicalSongKey,
            classification.canonicalPerformanceKey,
            ownedIdolIdsJson,
            featuredIdolIdsJson,
            row.youtube_video_id
          ]
        );
      }
    };

    if (this.inTransaction) {
      updateClassifications();
    } else {
      this.transaction(updateClassifications);
    }
  }

  private selectHololiveTiers(boardId: string): HololiveTier[] {
    return this.select<{
      id: string;
      board_id: string;
      label: string;
      color: string;
      position: number;
      collapsed: number;
    }>(
      `SELECT id, board_id, label, color, position, collapsed
       FROM hololive_tiers
       WHERE board_id = ?
       ORDER BY position ASC, label ASC`,
      [boardId]
    ).map((row) => ({
      id: row.id,
      boardId: row.board_id,
      label: row.label,
      color: row.color,
      position: Number(row.position),
      collapsed: Number(row.collapsed) === 1
    }));
  }

  private selectHololivePlacements(boardId: string): HololiveTierPlacement[] {
    return this.select<{
      board_id: string;
      idol_id: string;
      tier_id: string | null;
      position: number;
      updated_at: string;
    }>(
      `SELECT board_id, idol_id, tier_id, position, updated_at
       FROM hololive_tier_placements
       WHERE board_id = ?
       ORDER BY COALESCE(tier_id, ''), position ASC`,
      [boardId]
    ).map((row) => ({
      boardId: row.board_id,
      idolId: row.idol_id,
      tierId: row.tier_id,
      position: Number(row.position),
      updatedAt: row.updated_at
    }));
  }

  private ensureHololiveBoardPlacements(boardId: string): void {
    const now = new Date().toISOString();
    this.assertHololiveBoard(boardId);
    const missing = this.select<{ id: string; sort_order: number }>(
      `SELECT i.id, i.sort_order
       FROM hololive_idols i
       WHERE NOT EXISTS (
         SELECT 1 FROM hololive_tier_placements p
         WHERE p.board_id = ? AND p.idol_id = i.id
       )
       ORDER BY ${this.hololiveTierShelfOrderBySql("i")}`,
      [boardId]
    );

    if (missing.length === 0) {
      return;
    }

    const nextPosition = Number(
      this.select<{ max_position: number | null }>(
        "SELECT MAX(position) AS max_position FROM hololive_tier_placements WHERE board_id = ? AND tier_id IS NULL",
        [boardId]
      )[0]?.max_position ?? -1
    );

    const insertMissingPlacements = () => {
      missing.forEach((idol, index) => {
        this.run(
          `INSERT INTO hololive_tier_placements (board_id, idol_id, tier_id, position, updated_at)
           VALUES (?, ?, NULL, ?, ?)`,
          [boardId, idol.id, nextPosition + index + 1, now]
        );
      });
    };

    if (this.inTransaction) {
      insertMissingPlacements();
    } else {
      this.transaction(insertMissingPlacements);
    }
  }

  private hololiveTierShelfOrderBySql(alias: string): string {
    return `CASE
        WHEN ${alias}.source = 'custom' THEN 2
        WHEN ${alias}.status IN ('affiliate', 'alum', 'retired') THEN 1
        ELSE 0
      END ASC,
      ${alias}.sort_order ASC,
      ${alias}.display_name ASC`;
  }

  private selectHololivePlacementGroup(
    boardId: string,
    tierId: string | null
  ): Array<{ idol_id: string; position: number }> {
    if (tierId === null) {
      return this.select<{ idol_id: string; position: number }>(
        `SELECT idol_id, position
         FROM hololive_tier_placements
         WHERE board_id = ? AND tier_id IS NULL
         ORDER BY position ASC`,
        [boardId]
      );
    }

    return this.select<{ idol_id: string; position: number }>(
      `SELECT idol_id, position
       FROM hololive_tier_placements
       WHERE board_id = ? AND tier_id = ?
       ORDER BY position ASC`,
      [boardId, tierId]
    );
  }

  private updateHololivePlacementGroup(
    boardId: string,
    tierId: string | null,
    idolIds: string[],
    timestamp: string
  ): void {
    idolIds.forEach((idolId, position) => {
      this.run(
        `UPDATE hololive_tier_placements
         SET tier_id = ?, position = ?, updated_at = ?
         WHERE board_id = ? AND idol_id = ?`,
        [tierId, position, timestamp, boardId, idolId]
      );
    });
  }

  private repositionHololiveTiers(boardId: string, tierIds: string[], timestamp: string): void {
    tierIds.forEach((tierId, position) => {
      this.run("UPDATE hololive_tiers SET position = ?, updated_at = ? WHERE id = ? AND board_id = ?", [
        position,
        timestamp,
        tierId,
        boardId
      ]);
    });
  }

  private touchHololiveBoard(boardId: string, timestamp = new Date().toISOString()): void {
    this.run("UPDATE hololive_tier_boards SET updated_at = ? WHERE id = ?", [timestamp, boardId]);
  }

  private nextHololiveTierLabel(existing: HololiveTier[]): string {
    const labels = new Set(existing.map((tier) => tier.label.toLowerCase()));
    let index = existing.length + 1;
    let label = `Tier ${index}`;

    while (labels.has(label.toLowerCase())) {
      index += 1;
      label = `Tier ${index}`;
    }

    return label;
  }

  private assertHololiveIdol(idolId: string): void {
    const exists = this.select<{ id: string }>("SELECT id FROM hololive_idols WHERE id = ?", [idolId])[0];
    if (!exists) {
      throw new Error(`Unknown Hololive idol: ${idolId}`);
    }
  }

  private assertHololiveBoard(boardId: string): void {
    const exists = this.select<{ id: string }>("SELECT id FROM hololive_tier_boards WHERE id = ?", [boardId])[0];
    if (!exists) {
      throw new Error(`Unknown Hololive tier board: ${boardId}`);
    }
  }

  private assertHololiveTier(boardId: string, tierId: string): void {
    const exists = this.select<{ id: string }>("SELECT id FROM hololive_tiers WHERE id = ? AND board_id = ?", [
      tierId,
      boardId
    ])[0];
    if (!exists) {
      throw new Error(`Unknown Hololive tier: ${tierId}`);
    }
  }

  private applyMigrations(): void {
    const applied = new Set(
      this.select<{ version: number }>("SELECT version FROM schema_migrations").map((row) => Number(row.version))
    );

    for (const migration of MIGRATIONS) {
      if (applied.has(migration.version)) {
        continue;
      }

      this.requireDb().run("BEGIN");
      try {
        this.requireDb().run(migration.sql);
        this.requireDb().run("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)", [
          migration.version,
          new Date().toISOString()
        ] as never[]);
        this.requireDb().run("COMMIT");
        this.dirty = true;
      } catch (error) {
        this.requireDb().run("ROLLBACK");
        throw error;
      }
    }
  }

  private scalarCount(sql: string): number {
    const row = this.select<{ count: number }>(sql.replace("COUNT(*)", "COUNT(*) AS count"))[0];
    return Number(row?.count ?? 0);
  }

  private selectFetchJobs(sql: string, params: unknown[] = []): FetchJob[] {
    return this.select<{
      id: string;
      module_id: ModuleId;
      source_id: SourceId;
      kind: FetchJob["kind"];
      target_url: string;
      status: FetchJob["status"];
      priority: number;
      error: string | null;
      created_at: string;
      updated_at: string;
    }>(sql, params).map((row) => ({
      id: row.id,
      moduleId: row.module_id,
      sourceId: row.source_id,
      kind: row.kind,
      targetUrl: row.target_url,
      status: row.status,
      priority: row.priority,
      error: row.error,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }

  private resolveWasmPath(): string {
    const packagedPath = path.join(process.resourcesPath ?? "", "sql-wasm.wasm");
    if (process.resourcesPath && fs.existsSync(packagedPath)) {
      return packagedPath;
    }

    return path.join(process.cwd(), "node_modules", "sql.js", "dist", "sql-wasm.wasm");
  }

  private requireDb(): Database {
    if (!this.db) {
      throw new Error("DatabaseService.init() must be called before using the database");
    }

    return this.db;
  }
}
