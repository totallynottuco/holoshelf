import type { HololiveMusicTopic } from "../../../shared/contracts";

export const HOLODEX_SEARCH_API_URL = "https://holodex.net/api/v2/search/videoSearch";
export const HOLODEX_DETAIL_API_URL = "https://holodex.net/api/v2/videos";
export const HOLODEX_CHANNELS_API_URL = "https://holodex.net/api/v2/channels";
export const HOLODEX_DEFAULT_PAGE_SIZE = 30;
export const HOLODEX_CHANNEL_PAGE_SIZE = 50;
export const HOLODEX_DEFAULT_LANGS = ["en"];
export const HOLODEX_DEFAULT_TARGETS = ["stream"];
export const HOLODEX_DEFAULT_SEARCH_URL =
  "https://holodex.net/search?q=type,value,text%0Atopic,Music_Cover,Music_Cover%0A" +
  "topic,Original_Song,Original_Song%0Aorg,Hololive,Hololive&page=1&advanced=false";
export const EXCLUDED_HOLODEX_CHANNEL_IDS = new Set([
  "UCHj_mh57PVMXhAUDphUQDFA",
  "UCLbtM3JZfRTg8v2KGag-RMw",
  "UCD8HOxPs4Xvsm8H0ZxXGiBw",
  "UCp3tgHXw_HI0QMk1K8qh3gQ",
  "UCl_gCybOJRIgOXw6Qb4qJzQ",
  "UCgZuwn-O7Szh9cAgHqJ6vjw",
  "UCGSOfFtVCTBfmGxHK5OD8ag",
  "UCwL7dgTxKo8Y4RFIKWaf8gA",
  "UCKeAhJvy8zgXWbh9duVjIaQ",
  "UCNVEsYbiZjH5QLmGeSgTSzg",
  "UC2hx0xVkMoHGWijwr_lA01w",
  "UC7gxU6NXjKF1LrgOddPzgTw",
  "UCq4ky2drohLT7W0DmDEw1dQ",
  "UCgNVXGlZIFK96XdEY20sVjg",
  "UCajbFh6e_R8QZdHAMbbi4rQ",
  "UCHP4f7G2dWD4qib7BMatGAw",
  "UCJv02SHZgav7Mv3V0kBOR8Q",
  "UCl7xaOxJUq7GsD4M8N68FaA",
  "UC6t3-_N8A6ME1JShZHHqOMw",
  "UCkT1u65YS49ca_LsFwcTakw",
  "UCfpWrWvbA34LmrZ9h4Lbwag",
  "UCMqGG8BRAiI1lJfKOpETM_w",
  "UCTVSOgYuSWmNAt-lnJPkEEw",
  "UCEzsociuFqVwgZuMaZqaCsg",
  "UChSvpZYRPh0FvG4SJGSga3g",
  "UCZgOv3YDEs-ZnZWDYVwJdmA",
  "UCGNI4MENvnsymYjKiZwv9eg",
  "UC060r4zABV18vcahAWR1n7w",
  "UC7MMNHR-kf9EN1rXiesMTMw",
  "UCdfMHxjcCc2HSd9qFvfJgjg",
  "UCDRWSO281bIHYVi-OV3iFYA",
  "UCLk1hcmxg8rJ3Nm1_GvxTRA",
  "UCKYyiJwNg2nV7hM86U5_wvw",
  "UCyxtGMdWlURZ30WSnEjDOQw",
  "UC9mf_ZVpouoILRY9NUIaK-w",
  "UCWsfcksUUpoEvhia0_ut0bA",
  "UCsehvfwaWF6nWuFnXI0AqZQ",
  "UCozx5csNhCx1wsVq3SZVkBQ",
  "UCgRqGV1gBf2Esxh0Tz1vxzw",
  "UCu2DMOGLeR_DSStCyeQpi5Q",
  "UCGKgJ4MtJ1coi6tWJUfnsQA",
  "UCc88OV45ICgHbn3ZqLLb52w",
  "UCANDOlYTJT7N5jlRC3zfzVA",
  "UCt4-iv7EP0UU_w733D_r_jA",
  "UCawGfU44CZxd2ZVf_VGijbA",
  "UCNoxM_Kxoa-_gOtoyjbux7Q",
  "UCmms2EE02mK4zdECwrHBpaA",
  "UCODNLyn3L83wEmC0DLL0cxA",
  "UCEoAD_2jSLoYQd2MJZxWuxQ",
  "UCQmcltnre6aG9SkDRYZqFIg"
]);

export function isExcludedHolodexChannelId(channelId: string | null | undefined): boolean {
  return Boolean(channelId && EXCLUDED_HOLODEX_CHANNEL_IDS.has(channelId.trim()));
}

export interface HolodexSearchFilterRow {
  type: string;
  value: string;
  text?: string;
}

export interface HolodexParsedSearch {
  rows: HolodexSearchFilterRow[];
  page: number;
}

export interface HolodexSearchPayload {
  sort: "newest";
  lang: string[];
  target: string[];
  conditions: unknown[];
  topic: string[];
  vch: string[];
  org: string[];
  comment: unknown[];
  paginated: true;
  offset: number;
  limit: number;
}

export interface HolodexSearchItem {
  id?: string;
  title?: string;
  type?: string;
  status?: string;
  topic_id?: string;
  published_at?: string;
  duration?: number | string | null;
  channel_id?: string | null;
  original_channel_id?: string | null;
  description?: string | null;
  songs?: Array<{ name?: string | null }> | number | null;
  mentions?: HolodexChannelApiRecord[] | null;
  channel?: {
    id?: string;
    name?: string;
    english_name?: string;
    type?: string;
    org?: string;
    suborg?: string;
    group?: string | null;
    photo?: string | null;
    twitter?: string | null;
    video_count?: string | number | null;
    subscriber_count?: string | number | null;
    clip_count?: string | number | null;
    published_at?: string | null;
    inactive?: boolean | null;
  } | null;
}

export interface HolodexChannelApiRecord {
  id?: string;
  name?: string | null;
  english_name?: string | null;
  type?: string | null;
  org?: string | null;
  group?: string | null;
  photo?: string | null;
  twitter?: string | null;
  video_count?: string | number | null;
  subscriber_count?: string | number | null;
  clip_count?: string | number | null;
  published_at?: string | null;
  inactive?: boolean | null;
  crawled_at?: string | null;
  updated_at?: string | null;
}

export interface HolodexChannelRecord {
  id: string;
  name: string;
  englishName: string;
  type: string;
  org: string;
  group: string;
  photoUrl: string;
  twitter: string;
  videoCount: number | null;
  subscriberCount: number | null;
  clipCount: number | null;
  publishedAt: string;
  inactive: boolean;
}

export interface HolodexMentionedChannel {
  channelId: string;
  name: string;
  englishName: string;
  type: string;
  photoUrl: string;
  org: string;
}

export interface HolodexVideoRecord {
  sourcePage: number;
  positionOnPage: number;
  sourcePageUrl: string;
  holodexWatchId: string;
  holodexWatchUrl: string;
  youtubeVideoId: string;
  youtubeUrl: string;
  title: string;
  itemType: string;
  status: string;
  topicId: string;
  channelId: string;
  channelName: string;
  channelEnglishName: string;
  channelType: string;
  channelOrg: string;
  channelSuborg: string;
  publishedAt: string;
  duration: number | null;
}

export interface HolodexCatalogRow {
  youtubeVideoId: string;
  youtubeUrl: string;
  title: string;
  status: string;
  topicId: HololiveMusicTopic;
  channelId?: string | null;
  channelName: string;
  publishedAt: string;
}

export interface HolodexVideoDetail {
  youtubeVideoId: string;
  channelId: string;
  duration: number | null;
  originalChannelId: string;
  providedToYoutube: boolean;
  songNames: string[];
  channel?: HolodexChannelRecord | null;
  mentions: HolodexMentionedChannel[];
  collabChannelIds: string[];
  relationshipsLoaded: boolean;
}

export interface HolodexDuplicateRemoval {
  removedYoutubeVideoId: string;
  removedTitle: string;
  keptYoutubeVideoId: string;
  keptTitle: string;
  reason: "topic_duplicate_of_non_topic" | "topic_duplicate_without_non_topic" | string;
  songName: string;
  removedPublishedAt: string;
  keptPublishedAt: string;
}

export interface HolodexCleanupResult {
  rows: HolodexCatalogRow[];
  removedByBaseRules: number;
  removedDuplicateRows: number;
  duplicateClusterCount: number;
  duplicateRemovals: HolodexDuplicateRemoval[];
}

export interface HolodexArtifactBundle {
  rows: HolodexCatalogRow[];
  detailCache: Record<string, HolodexVideoDetail>;
  duplicateRemovals: HolodexDuplicateRemoval[];
}

export interface HolodexMusicImportBundle extends HolodexArtifactBundle {
  channels?: HolodexChannelRecord[];
  recordsById?: Record<string, HolodexVideoRecord>;
}
