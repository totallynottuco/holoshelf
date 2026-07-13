export type ModuleId = "hololive";

export type IconName =
  | "book-open"
  | "film"
  | "hash"
  | "music"
  | "layout-dashboard"
  | "upload"
  | "settings"
  | "activity";

export type TrackerStatus =
  | "planned"
  | "active"
  | "paused"
  | "completed"
  | "dropped"
  | "ignored";

export type SourceId = "hololive-csv" | "holodex";

export interface SourceAdapterDescriptor {
  id: SourceId;
  label: string;
  homepage: string;
  moduleId: ModuleId;
  publicOnly: boolean;
  storesCovers: boolean;
  rateLimitMs: number;
}

export interface ImporterDescriptor {
  id: string;
  label: string;
  moduleId: ModuleId;
  accepts: string[];
}

export interface TrackerModuleManifest {
  id: ModuleId;
  label: string;
  description: string;
  nav: {
    icon: IconName;
    order: number;
  };
  database: {
    extensionTables: string[];
  };
  sourceAdapters: SourceAdapterDescriptor[];
  importers: ImporterDescriptor[];
  recommender: {
    id: string;
    label: string;
    localOnly: boolean;
  };
}

export interface CatalogItem {
  id: string;
  moduleId: ModuleId;
  kind: string;
  title: string;
  subtitle?: string | null;
  sourceUrl?: string | null;
  coverPath?: string | null;
  status?: TrackerStatus | null;
  rating?: number | null;
  notes?: string | null;
  tags: string[];
  updatedAt: string;
}

export type HololiveIdolStatus = "active" | "affiliate" | "alum" | "retired";
export type HololiveTalentSource = "official" | "custom";
export type HololiveImageCacheKind = "icon" | "profile" | "card";

export interface HololiveIdol {
  id: string;
  slug: string;
  displayName: string;
  branch: string;
  generation: string;
  status: HololiveIdolStatus;
  source: HololiveTalentSource;
  officialUrl: string;
  iconUrl: string;
  cachedIconUrl?: string | null;
  profileImageUrl?: string | null;
  cachedProfileImageUrl?: string | null;
  cardImageUrl?: string | null;
  cachedCardImageUrl?: string | null;
  profileQuote?: string | null;
  youtubeChannelUrl?: string | null;
  youtubeChannelId?: string | null;
  xHandle?: string | null;
  xUrl?: string | null;
  birthday?: string | null;
  debutDate?: string | null;
  height?: string | null;
  unit?: string | null;
  sortOrder: number;
}

export interface HololiveProfileLink {
  id: string;
  label: string;
  url: string;
  kind: "youtube" | "x" | "other";
}

export type HololiveProfileMediaGroupId = "original-songs" | "covers" | "featured-in" | "playlists";

export interface HololiveProfileMediaGroup {
  id: HololiveProfileMediaGroupId;
  label: string;
  items: Array<{
    id: string;
    title: string;
    url?: string | null;
    publishedAt?: string | null;
    durationSeconds?: number | null;
    viewCount?: number | null;
    viewCountFetchedAt?: string | null;
    markerKey?: string | null;
    marker?: HololiveMusicMarker | null;
  }>;
}

export interface HololiveProfileChannel {
  id: string;
  name: string;
  url: string;
  photoUrl?: string | null;
  twitter?: string | null;
  subscriberCount?: number | null;
  videoCount?: number | null;
  clipCount?: number | null;
  publishedAt?: string | null;
  updatedAt: string;
  kind: HololiveChannelKind;
}

export type HololiveMusicTopic = "Original_Song" | "Music_Cover";
export type HololiveMusicSourceKind = "official" | "user";

export type HololiveChannelKind = "idol" | "topic" | "group" | "unknown";

export interface HolodexChannel {
  id: string;
  name: string;
  englishName?: string | null;
  type?: string | null;
  org?: string | null;
  group?: string | null;
  photoUrl?: string | null;
  twitter?: string | null;
  videoCount?: number | null;
  subscriberCount?: number | null;
  clipCount?: number | null;
  publishedAt?: string | null;
  inactive: boolean;
  kind: HololiveChannelKind;
  mainIdolIds: string[];
  topicIdolIds: string[];
  linkedIdolIds: string[];
  updatedAt: string;
}

export interface HololiveChannelRefreshResult {
  refreshedChannels: number;
  classifiedChannels: number;
  updatedAt: string;
}

export interface HololiveCustomTalentInput {
  channelInput: string;
  displayName?: string | null;
  cardImageUrl?: string | null;
  originalSongsUrl?: string | null;
  coversUrl?: string | null;
}

export interface HololiveCustomTalentPreview {
  channelId: string;
  displayName: string;
  nativeName?: string | null;
  slug: string;
  branch: string;
  generation: string;
  officialUrl: string;
  iconUrl: string;
  profileImageUrl: string;
  cardImageUrl?: string | null;
  youtubeChannelUrl: string;
  xHandle?: string | null;
  xUrl?: string | null;
  subscriberCount?: number | null;
  videoCount?: number | null;
  clipCount?: number | null;
  originalSongsUrl?: string | null;
  coversUrl?: string | null;
}

export interface HololiveCustomTalentRecord {
  idol: HololiveIdol;
  channel: HolodexChannel;
}

export type HololiveMusicParticipantRole = "primary" | "topic-owner" | "mentioned" | "collab";

export type HololiveMusicMarker = "favorite" | "like" | "neutral" | "dislike";

export interface HololiveMusicMarkerRecord {
  youtubeVideoId: string;
  markerKey: string;
  marker: HololiveMusicMarker | null;
  updatedAt: string | null;
}

export interface HololiveMusicExclusionRecord {
  youtubeVideoId: string;
  titleSnapshot?: string | null;
  sourceUrlSnapshot?: string | null;
  createdAt: string;
}

export interface HololiveMusicParticipant {
  youtubeVideoId: string;
  idolId: string;
  idolName: string;
  role: HololiveMusicParticipantRole;
  channelId?: string | null;
}

export interface HololiveMusicRow {
  youtubeVideoId: string;
  idolId?: string | null;
  title: string;
  songName?: string | null;
  canonicalSongKey: string;
  canonicalPerformanceKey: string;
  topicId: HololiveMusicTopic;
  status: string;
  youtubeUrl: string;
  channelId: string;
  channelName: string;
  uploaderChannelKind: HololiveChannelKind;
  uploaderChannelGroup?: string | null;
  participants: HololiveMusicParticipant[];
  ownedIdolIds: string[];
  featuredIdolIds: string[];
  publishedAt?: string | null;
  durationSeconds?: number | null;
  viewCount?: number | null;
  viewCountFetchedAt?: string | null;
  markerKey: string;
  marker?: HololiveMusicMarker | null;
  sourceKind?: HololiveMusicSourceKind | null;
  updatedAt: string;
}

export interface HololiveCustomSongPreview {
  youtubeVideoId: string;
  youtubeUrl: string;
  title?: string | null;
  songName?: string | null;
  channelId?: string | null;
  channelName?: string | null;
  publishedAt?: string | null;
  durationSeconds?: number | null;
  viewCount?: number | null;
  fetchedAt?: string | null;
  thumbnailUrl?: string | null;
  usedApi: boolean;
  apiKeyMissing: boolean;
}

export type HololiveMusicRepeatMode = "off" | "all" | "one";
export type HololiveMusicPlaybackSource = "queue" | "playlist" | "library";

export interface HololiveMusicResolvedItem {
  id: string;
  youtubeVideoId: string;
  position: number;
  titleSnapshot?: string | null;
  sourceUrlSnapshot?: string | null;
  addedAt: string;
  available: boolean;
  music: HololiveMusicRow | null;
}

export interface HololiveMusicPlaylist {
  id: string;
  name: string;
  position: number;
  itemCount: number;
  systemId?: "favorites" | null;
  createdAt: string;
  updatedAt: string;
  items?: HololiveMusicResolvedItem[];
}

export interface HololiveMusicPlayerState {
  playbackSourceType: HololiveMusicPlaybackSource;
  currentQueueItemId?: string | null;
  currentPlaylistId?: string | null;
  currentPlaylistItemId?: string | null;
  currentYoutubeVideoId?: string | null;
  repeatMode: HololiveMusicRepeatMode;
  shuffleEnabled: boolean;
  autoplayEnabled: boolean;
  updatedAt: string;
}

export interface HololiveMusicPlayerData {
  playlists: HololiveMusicPlaylist[];
  queue: HololiveMusicResolvedItem[];
  state: HololiveMusicPlayerState;
  currentItem?: HololiveMusicResolvedItem | null;
}

export type HololiveBracketSize = "RO16" | "RO32" | "RO64" | "RO128" | "RO256";
export type HololiveBracketStatus = "active" | "complete";
export type HololiveBracketFormat = "single_elimination" | "double_elimination";
export type HololiveBracketStage = "single" | "winners" | "losers" | "grand_final";
export type HololiveBracketStatsFormat = "all" | HololiveBracketFormat;
export type HololiveBracketGenerationStyle = "top_songs" | "random_songs";
export type HololiveBracketRatingBucket = "unrated" | "favorite" | "like" | "neutral" | "dislike";
export type HololiveBracketVocalScope = "solo" | "group";
export type HololiveBracketTalentStatusFilter = "active" | "alumni" | "custom";
export type HololiveBracketHistoryParticipation = "never" | "appeared" | "top8" | "top4" | "finalist" | "winner";

export interface HololiveBracketCreateWarning {
  code: "talent_cap_relaxed";
  message: string;
  requestedMaxEntriesPerTalent: number;
}

export interface HololiveBracketGenerationFilters {
  excludeDisliked?: boolean;
  excludeRated?: boolean;
  ratingBuckets?: HololiveBracketRatingBucket[];
  includedTalentIds?: string[];
  vocalScopes?: HololiveBracketVocalScope[];
  talentStatuses?: HololiveBracketTalentStatusFilter[];
  historyParticipation?: HololiveBracketHistoryParticipation | null;
  maxEntriesPerTalent?: number | null;
  preferTopicSplitPerTalent?: boolean | null;
  excludeTopViewedPerTalent?: boolean;
  excludePreviousChampions?: boolean;
  excludePreviousFinalists?: boolean;
  excludePreviousTop4?: boolean;
  excludePreviousTop8?: boolean;
  excludeAboveViews?: number | null;
  excludeBelowViews?: number | null;
  excludeAfterDate?: string | null;
  excludeBeforeDate?: string | null;
  excludeTopicIds?: HololiveMusicTopic[];
}

export interface HololiveBracketEntry {
  id: string;
  bracketId: string;
  slotIndex: number;
  youtubeVideoId: string;
  title: string;
  songName?: string | null;
  topicId: HololiveMusicTopic;
  youtubeUrl: string;
  channelName: string;
  idolId: string;
  idolName: string;
  canonicalPerformanceKey: string;
  viewCount?: number | null;
  publishedAt?: string | null;
  durationSeconds?: number | null;
}

export interface HololiveBracketMatch {
  id: string;
  bracketId: string;
  roundIndex: number;
  matchIndex: number;
  stage: HololiveBracketStage;
  stageRoundIndex: number;
  playOrder: number;
  lateRoundWeight: number;
  engineMatchId?: number | null;
  entryA?: HololiveBracketEntry | null;
  entryB?: HololiveBracketEntry | null;
  winnerEntryId?: string | null;
  winner?: HololiveBracketEntry | null;
  completedAt?: string | null;
  updatedAt: string;
}

export interface HololiveBracketRound {
  roundIndex: number;
  stage: HololiveBracketStage;
  stageRoundIndex: number;
  label: string;
  matches: HololiveBracketMatch[];
}

export interface HololiveBracket {
  id: string;
  name: string;
  size: HololiveBracketSize;
  format: HololiveBracketFormat;
  generationStyle: HololiveBracketGenerationStyle;
  generationFilters: HololiveBracketGenerationFilters;
  seed: string;
  status: HololiveBracketStatus;
  currentMatchId?: string | null;
  currentMatch?: HololiveBracketMatch | null;
  champion?: HololiveBracketEntry | null;
  entries: HololiveBracketEntry[];
  rounds: HololiveBracketRound[];
  createdAt: string;
  updatedAt: string;
}

export interface HololiveBracketSummary {
  id: string;
  name: string;
  size: HololiveBracketSize;
  format: HololiveBracketFormat;
  generationStyle: HololiveBracketGenerationStyle;
  generationFilters: HololiveBracketGenerationFilters;
  status: HololiveBracketStatus;
  currentMatchId?: string | null;
  completedMatches: number;
  totalMatches: number;
  championTitle?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface HololiveBracketArchiveSummary {
  id: string;
  sourceBracketId: string;
  name: string;
  size: HololiveBracketSize;
  format: HololiveBracketFormat;
  generationStyle: HololiveBracketGenerationStyle;
  generationFilters: HololiveBracketGenerationFilters;
  totalEntries: number;
  totalMatches: number;
  completedMatches: number;
  championYoutubeVideoId?: string | null;
  championTitle?: string | null;
  championIdolId?: string | null;
  championIdolName?: string | null;
  createdAt: string;
  completedAt: string;
  archivedAt: string;
}

export interface HololiveBracketSongStats {
  canonicalPerformanceKey: string;
  youtubeVideoId: string;
  title: string;
  topicId?: HololiveMusicTopic | null;
  idolId?: string | null;
  idolName?: string | null;
  appearances: number;
  wins: number;
  losses: number;
  winRate: number;
  championCount: number;
  finalistCount: number;
  runnerUpCount: number;
  top4Count: number;
  top8Count: number;
  top16Count: number;
  firstRoundEliminations: number;
  upsetWins: number;
  revengeWins: number;
  giantKillerScore: number;
  bigGameScore: number;
  bigGameWins: number;
  highStakesPerformanceRate: number;
  highStakesPerformanceWins: number;
  highStakesPerformanceLosses: number;
  highStakesPerformanceMatches: number;
  strengthOfWinsScore: number;
  strengthOfWinsCount: number;
  strengthOfLossesScore: number;
  strengthOfLossesCount: number;
  punchingAboveScore: number;
  punchingAboveWins: number;
  punchingAboveOpportunities: number;
  clutchRate: number;
  clutchWins: number;
  clutchLosses: number;
  clutchMatches: number;
  pressureEdgeScore: number;
  pressureEdgeMatches: number;
  pressureEdgePositiveMatches: number;
  pressureEdgeNegativeMatches: number;
  upsetResilienceScore: number;
  upsetResilienceChecks: number;
  upsetResilienceUpsetLosses: number;
  lastArchivedAt: string;
}

export interface HololiveBracketTalentStats {
  idolId: string;
  idolName: string;
  appearances: number;
  wins: number;
  losses: number;
  winRate: number;
  championCount: number;
  finalistCount: number;
  finalsConversionRate: number;
  runnerUpCount: number;
  top4Count: number;
  deepRunRate: number;
  top8Count: number;
  top16Count: number;
  firstRoundEliminations: number;
  earlyExitCount: number;
  earlyExitRate: number;
  strengthOfWinsScore: number;
  strengthOfWinsCount: number;
  strengthOfLossesScore: number;
  strengthOfLossesCount: number;
  punchingAboveScore: number;
  punchingAboveWins: number;
  punchingAboveOpportunities: number;
  clutchRate: number;
  clutchWins: number;
  clutchLosses: number;
  clutchMatches: number;
  pressureEdgeScore: number;
  pressureEdgeMatches: number;
  pressureEdgePositiveMatches: number;
  pressureEdgeNegativeMatches: number;
  upsetResilienceScore: number;
  upsetResilienceChecks: number;
  upsetResilienceUpsetLosses: number;
  lastArchivedAt: string;
}

export interface HololiveBracketRivalryStats {
  key: string;
  leftIdolId: string;
  leftIdolName: string;
  rightIdolId: string;
  rightIdolName: string;
  matches: number;
  leftWins: number;
  rightWins: number;
  lastArchivedAt: string;
}

export interface HololiveBracketRatingStatsRow {
  id: string;
  label: string;
  detail?: string | null;
  rating: number;
  conservativeRating: number;
  ratingDeviation: number;
  volatility: number;
  wins: number;
  losses: number;
  matches: number;
  lastArchivedAt: string;
}

export interface HololiveBracketStatsOverview {
  totals: {
    completedBrackets: number;
    totalMatches: number;
    uniqueSongs: number;
    uniqueTalents: number;
  };
  songStats: HololiveBracketSongStats[];
  talentStats: HololiveBracketTalentStats[];
  rivalryStats: HololiveBracketRivalryStats[];
  finalsRivalryStats: HololiveBracketRivalryStats[];
  topSongsByWins: HololiveBracketSongStats[];
  topSongsByTitles: HololiveBracketSongStats[];
  topSongsByRunnerUps: HololiveBracketSongStats[];
  topSongsByDeepRuns: HololiveBracketSongStats[];
  topSongsByEarlyExits: HololiveBracketSongStats[];
  topSongsByStrengthOfWins: HololiveBracketSongStats[];
  topSongsByStrengthOfLosses: HololiveBracketSongStats[];
  topSongsByClutchRate: HololiveBracketSongStats[];
  topSongsByPressureEdge: HololiveBracketSongStats[];
  topSongsByPunchingAbove: HololiveBracketSongStats[];
  topSongsByUpsetResilience: HololiveBracketSongStats[];
  topSongsByWinRate: HololiveBracketSongStats[];
  topSongsByAppearances: HololiveBracketSongStats[];
  topSongsByFinalsWithoutTitle: HololiveBracketSongStats[];
  topSongsByFirstRoundEliminations: HololiveBracketSongStats[];
  topSongsByUpsetWins: HololiveBracketSongStats[];
  topSongsByRevengeWins: HololiveBracketSongStats[];
  topSongsByGiantKillerScore: HololiveBracketSongStats[];
  topSongsByGiantKillerAverage: HololiveBracketSongStats[];
  topSongsByBigGameScore: HololiveBracketSongStats[];
  topSongsByBigGameAverage: HololiveBracketSongStats[];
  topSongsByHighStakesPerformance: HololiveBracketSongStats[];
  topTalents: HololiveBracketTalentStats[];
  topTalentsByWins: HololiveBracketTalentStats[];
  topTalentsByTitles: HololiveBracketTalentStats[];
  topTalentsByRunnerUps: HololiveBracketTalentStats[];
  topTalentsByFinalsConversion: HololiveBracketTalentStats[];
  topTalentsByDeepRuns: HololiveBracketTalentStats[];
  topTalentsByDeepRunRate: HololiveBracketTalentStats[];
  topTalentsByEarlyExits: HololiveBracketTalentStats[];
  topTalentsByEarlyExitRate: HololiveBracketTalentStats[];
  topTalentsByTop4: HololiveBracketTalentStats[];
  topTalentsByStrengthOfWins: HololiveBracketTalentStats[];
  topTalentsByStrengthOfLosses: HololiveBracketTalentStats[];
  topTalentsByPunchingAbove: HololiveBracketTalentStats[];
  topTalentsByClutchRate: HololiveBracketTalentStats[];
  topTalentsByPressureEdge: HololiveBracketTalentStats[];
  topTalentsByUpsetResilience: HololiveBracketTalentStats[];
  topSongRatings: HololiveBracketRatingStatsRow[];
  topTalentRatings: HololiveBracketRatingStatsRow[];
  topRivalries: HololiveBracketRivalryStats[];
  championHistory: HololiveBracketArchiveSummary[];
}

export interface HololiveMusicLibraryResponse {
  rows: HololiveMusicRow[];
  total: number;
  offset: number;
  limit: number;
}

export interface HololiveMusicRefreshRun {
  id: string;
  source: "artifact" | "live";
  status: "running" | "completed" | "failed";
  startedAt: string;
  completedAt?: string | null;
  fetchedRows: number;
  keptRows: number;
  filteredRows: number;
  duplicateRows: number;
  error?: string | null;
}

export interface HololiveMusicImportResult {
  run: HololiveMusicRefreshRun;
  sourceRows: number;
  idolMatchedRows: number;
  importedRows: number;
  detailCacheRows: number;
  duplicateRows: number;
}

export interface HololiveMusicVideoStatsRefreshResult {
  requestedVideos: number;
  updatedVideos: number;
  missingVideos: number;
  unavailableVideos: number;
  failedBatches: number;
  batches: number;
  fetchedAt: string;
}

export interface HololiveFullDataRefreshResult {
  channelRefresh: HololiveChannelRefreshResult;
  musicRefresh: HololiveMusicImportResult;
  videoStatsRefresh: HololiveMusicVideoStatsRefreshResult;
  updatedAt: string;
}

export interface HololiveCustomTalentRefreshResult {
  musicRefresh: HololiveMusicImportResult;
  videoStatsRefresh: HololiveMusicVideoStatsRefreshResult;
  updatedAt: string;
}

export interface HololiveCustomTalentsRefreshResult {
  refreshedTalents: number;
  musicRefreshes: HololiveMusicImportResult[];
  videoStatsRefresh: HololiveMusicVideoStatsRefreshResult;
  updatedAt: string;
}

export interface HololiveIdolProfile {
  idol: HololiveIdol;
  links: HololiveProfileLink[];
  mainChannel?: HololiveProfileChannel | null;
  topicChannels: HololiveProfileChannel[];
  mediaGroups: HololiveProfileMediaGroup[];
}

export interface HololiveProfilePlaybackContext {
  youtubeVideoId: string;
  idolId: string;
  idolName: string;
  mediaGroupId: HololiveProfileMediaGroupId;
  mediaGroupLabel: string;
  songIds: string[];
  currentIndex: number;
}

export interface HololiveTierBoardSummary {
  id: string;
  name: string;
  tileSize: number;
  rankedCount: number;
  totalCount: number;
  updatedAt: string;
}

export interface HololiveTier {
  id: string;
  boardId: string;
  label: string;
  color: string;
  position: number;
  collapsed: boolean;
}

export interface HololiveTierPlacement {
  boardId: string;
  idolId: string;
  tierId: string | null;
  position: number;
  updatedAt: string;
}

export interface HololiveTierBoard {
  id: string;
  name: string;
  tileSize: number;
  createdAt: string;
  updatedAt: string;
  tiers: HololiveTier[];
  placements: HololiveTierPlacement[];
}

export interface HololiveTierListData {
  idols: HololiveIdol[];
  boards: HololiveTierBoardSummary[];
  activeBoard: HololiveTierBoard;
}

export interface CatalogListFilters {
  moduleId?: ModuleId;
  query?: string;
  limit?: number;
}

export interface TrackedEntry {
  id: string;
  itemId: string;
  status: TrackerStatus;
  rating?: number | null;
  notes?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  updatedAt: string;
}

export interface SourcePolicy {
  sourceId: SourceId;
  allowedHosts: string[];
  disallow: string[];
  contentSignals?: {
    search?: boolean;
    aiInput?: boolean;
    aiTrain?: boolean;
  };
  minDelayMs: number;
}

export type SourceHealthStatus = "healthy" | "degraded" | "blocked" | "offline" | "unknown";

export interface SourceHealth {
  sourceId: SourceId;
  status: SourceHealthStatus;
  checkedAt: string;
  httpStatus?: number | null;
  message: string;
}

export interface SourceDiscoveryQuery {
  text?: string;
  page?: number;
  tags?: string[];
}

export interface SourceDiscoveryResult {
  sourceId: SourceId;
  sourceKey: string;
  title: string;
  detailUrl: string;
  coverUrl?: string | null;
  tags: string[];
}

export interface NormalizedSourceItem {
  moduleId: ModuleId;
  sourceId: SourceId;
  sourceKey: string;
  kind: string;
  title: string;
  subtitle?: string | null;
  detailUrl: string;
  coverUrl?: string | null;
  tags: string[];
}

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export interface SourceAdapter {
  descriptor: SourceAdapterDescriptor;
  getPolicy(): SourcePolicy;
  healthCheck(fetcher: Fetcher): Promise<SourceHealth>;
  discover(query: SourceDiscoveryQuery, fetcher: Fetcher): Promise<SourceDiscoveryResult[]>;
  fetchDetail(sourceKey: string, fetcher: Fetcher): Promise<NormalizedSourceItem | null>;
  fetchCover(item: NormalizedSourceItem, fetcher: Fetcher): Promise<ArrayBuffer | null>;
  normalize(raw: unknown): NormalizedSourceItem | null;
}

export interface RecommendationRequest {
  moduleId: ModuleId;
  seedItemId?: string;
  preferredTags: string[];
  blockedTags: string[];
  limit: number;
}

export interface RecommendationResult {
  item: CatalogItem;
  score: number;
  reasons: string[];
}

export interface RecommendationProvider {
  id: string;
  label: string;
  localOnly: boolean;
  recommend(request: RecommendationRequest, items: CatalogItem[]): RecommendationResult[];
}

export interface CsvImportMapping {
  importerId: string;
  moduleId: ModuleId;
  fields: Record<string, string>;
}

export interface CsvPreview {
  fileName: string;
  headers: string[];
  rows: Record<string, string>[];
  inferredMapping?: CsvImportMapping;
}

export interface FetchJob {
  id: string;
  moduleId: ModuleId;
  sourceId: SourceId;
  kind: "health-check" | "discover" | "detail" | "cover";
  targetUrl: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  priority: number;
  error?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AppStats {
  catalogItems: number;
  trackedEntries: number;
  fetchJobsQueued: number;
  coversCached: number;
}

export interface AppBootstrap {
  appName: string;
  dataDirectory: string;
  databasePath: string;
  backupDirectory: string;
  dataLocationKind: "appData" | "dev" | "custom";
  modules: TrackerModuleManifest[];
  sourceHealth: SourceHealth[];
  stats: AppStats;
}
