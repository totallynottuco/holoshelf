import type {
  AppBootstrap,
  CatalogItem,
  CatalogListFilters,
  CsvImportMapping,
  CsvPreview,
  FetchJob,
  HolodexChannel,
  HololiveBracket,
  HololiveBracketArchiveSummary,
  HololiveBracketGenerationFilters,
  HololiveBracketGenerationStyle,
  HololiveBracketSize,
  HololiveBracketStatsOverview,
  HololiveBracketSummary,
  HololiveChannelRefreshResult,
  HololiveCustomTalentInput,
  HololiveCustomTalentPreview,
  HololiveCustomTalentRecord,
  HololiveCustomTalentRefreshResult,
  HololiveCustomTalentsRefreshResult,
  HololiveIdolProfile,
  HololiveFullDataRefreshResult,
  HololiveMusicImportResult,
  HololiveMusicLibraryResponse,
  HololiveMusicExclusionRecord,
  HololiveMusicMarker,
  HololiveMusicMarkerRecord,
  HololiveMusicPlaybackSource,
  HololiveMusicPlayerData,
  HololiveMusicRepeatMode,
  HololiveMusicRefreshRun,
  HololiveMusicRow,
  HololiveMusicTopic,
  HololiveMusicVideoStatsRefreshResult,
  HololiveProfileMediaGroupId,
  HololiveProfilePlaybackContext,
  HololiveTierListData,
  ModuleId,
  SourceHealth,
  SourceId
} from "./contracts";

export interface SettingValueRequest {
  key: string;
  value: string;
}

export type UpdateStatusState =
  | "idle"
  | "unsupported"
  | "checking"
  | "available"
  | "not-available"
  | "downloading"
  | "downloaded"
  | "error";

export interface UpdateStatus {
  state: UpdateStatusState;
  message: string;
  isUpdateSupported: boolean;
  version?: string | null;
  percent?: number | null;
  error?: string | null;
  updatedAt: string;
}

export interface ImageSaveRequest {
  defaultFileName: string;
  dataUrl: string;
}

export interface ImageSaveResponse {
  filePath: string | null;
}

export interface OpenPathRequest {
  filePath: string;
}

export interface OpenPathResponse {
  opened: boolean;
}

export interface DataSafetyBackupResponse {
  created: boolean;
  filePath: string | null;
  reason: string;
  skippedReason?: string;
}

export interface DataSafetyRestoreResponse {
  restored: boolean;
  backupFilePath: string | null;
  restoredFromPath?: string | null;
  requiresRestart: boolean;
}

export interface DataSafetyResetResponse {
  reset: boolean;
  backupFilePath: string | null;
  requiresRestart: boolean;
}

export interface FetchEnqueueRequest {
  moduleId: ModuleId;
  sourceId: SourceId;
  kind: FetchJob["kind"];
  targetUrl: string;
  priority?: number;
}

export interface FetchCancelRequest {
  jobId: string;
}

export interface ImportOpenCsvRequest {
  moduleId: ModuleId;
}

export interface ImportApplyCsvRequest {
  preview: CsvPreview;
  mapping: CsvImportMapping;
}

export interface ImportApplyCsvResponse {
  inserted: number;
  skipped: number;
}

export interface HololiveTierDataRequest {
  boardId?: string | null;
}

export interface HololiveBoardCreateRequest {
  name: string;
  afterBoardId?: string | null;
}

export interface HololiveBoardUpdateRequest {
  boardId: string;
  name?: string;
  tileSize?: number;
}

export interface HololiveBoardReorderRequest {
  boardIds: string[];
  activeBoardId?: string | null;
}

export interface HololiveBoardDeleteRequest {
  boardId: string;
}

export interface HololiveBoardClearRequest {
  boardId: string;
}

export interface HololiveTierCreateRequest {
  boardId: string;
  label?: string;
  color?: string;
  position?: number;
}

export interface HololiveTierUpdateRequest {
  boardId: string;
  tierId: string;
  label?: string;
  color?: string;
  collapsed?: boolean;
}

export interface HololiveTierDeleteRequest {
  boardId: string;
  tierId: string;
}

export interface HololiveTierReorderRequest {
  boardId: string;
  tierIds: string[];
}

export interface HololivePlacementMoveRequest {
  boardId: string;
  idolId: string;
  tierId: string | null;
  index: number;
}

export interface HololiveUnrankedSortRequest {
  boardId: string;
}

export interface HololiveIconsRefreshRequest {
  idolIds?: string[];
}

export interface HololiveIconsRefreshResponse {
  cached: number;
  failed: number;
}

export interface HololiveIdolProfileRequest {
  idolId: string;
}

export interface HololiveProfilePlaybackContextRequest {
  youtubeVideoId: string;
  preferredIdolId?: string | null;
  preferredGroupId?: HololiveProfileMediaGroupId | null;
}

export interface HololiveMusicImportArtifactsRequest {
  directoryPath?: string | null;
}

export interface HololiveMusicRefreshRequest {
  searchUrl?: string | null;
  pageLimit?: number | null;
  pageSize?: number | null;
  includeChannels?: boolean | null;
  includeCustomTalents?: boolean | null;
  includeRelationships?: boolean | null;
  includeCollabs?: boolean | null;
  collabPageLimit?: number | null;
  replaceExisting?: boolean | null;
  maxRequestsPerWindow?: number | null;
  requestWindowMs?: number | null;
}

export interface HololiveMusicVideoStatsRefreshRequest {
  youtubeVideoIds?: string[] | null;
  limit?: number | null;
}

export interface HololiveFullDataRefreshRequest extends HololiveMusicRefreshRequest {
  videoStatsLimit?: number | null;
}

export interface HololiveMusicListRequest {
  idolId?: string | null;
  topicId?: HololiveMusicTopic | null;
  youtubeVideoIds?: string[] | null;
  query?: string | null;
  limit?: number | null;
}

export type HololiveMusicLibrarySort = "newest" | "oldest" | "views_desc" | "views_asc";
export type HololiveMusicLibraryCollabScope = "all" | "solo";

export interface HololiveMusicLibraryRequest {
  query?: string | null;
  topicId?: HololiveMusicTopic | null;
  marker?: HololiveMusicMarker | null;
  sort?: HololiveMusicLibrarySort | null;
  talentId?: string | null;
  collabScope?: HololiveMusicLibraryCollabScope | null;
  offset?: number | null;
  limit?: number | null;
}

export interface HololiveMusicStatusResponse {
  latestRun: HololiveMusicRefreshRun | null;
  totalRows: number;
}

export interface HololiveMusicMarkerSetRequest {
  youtubeVideoId: string;
  marker: HololiveMusicMarker | null;
}

export interface HololiveMusicExcludeRequest {
  youtubeVideoId: string;
  title?: string | null;
  sourceUrl?: string | null;
}

export interface HololiveMusicUnavailableRequest {
  youtubeVideoId: string;
  title?: string | null;
  sourceUrl?: string | null;
  reason?: string | null;
}

export interface HololiveMusicUnavailableResponse {
  removedYoutubeVideoId: string;
  replacementYoutubeVideoId?: string | null;
  replacementTitle?: string | null;
  data: HololiveMusicPlayerData;
}

export interface UndoableResponse<TData> {
  data: TData;
  undoToken?: string | null;
  undoLabel?: string | null;
}

export interface HololiveChannelsListRequest {
  kind?: HolodexChannel["kind"] | null;
}

export interface HololiveCustomTalentDeleteRequest {
  idolId: string;
}

export interface HololiveCustomTalentRefreshRequest {
  idolId: string;
  pageLimit?: number | null;
  includeRelationships?: boolean | null;
  includeCollabs?: boolean | null;
  collabPageLimit?: number | null;
}

export interface HololiveCustomTalentsRefreshRequest {
  idolIds?: string[] | null;
  pageLimit?: number | null;
  includeRelationships?: boolean | null;
  includeCollabs?: boolean | null;
  collabPageLimit?: number | null;
  videoStatsLimit?: number | null;
}

export interface HololivePlayerPlaylistCreateRequest {
  name: string;
}

export interface HololivePlayerPlaylistUpdateRequest {
  playlistId: string;
  name: string;
}

export interface HololivePlayerPlaylistDeleteRequest {
  playlistId: string;
}

export interface HololivePlayerPlaylistReorderRequest {
  playlistIds: string[];
}

export interface HololivePlayerPlaylistItemAddRequest {
  playlistId: string;
  youtubeVideoId: string;
  position?: number | null;
}

export interface HololivePlayerPlaylistItemsAddRequest {
  playlistId: string;
  youtubeVideoIds: string[];
}

export interface HololivePlayerPlaylistItemRemoveRequest {
  itemId: string;
}

export interface HololivePlayerPlaylistItemReorderRequest {
  playlistId: string;
  itemIds: string[];
}

export interface HololivePlayerPlaylistPlayRequest {
  playlistId: string;
  itemId?: string | null;
}

export interface HololivePlayerPlayVideoRequest {
  youtubeVideoId: string;
}

export interface HololivePlayerQueueAddRequest {
  youtubeVideoId: string;
  placement: "now" | "next" | "end";
}

export interface HololivePlayerQueueBulkAddRequest {
  youtubeVideoIds: string[];
  placement: "now" | "next" | "end";
}

export interface HololivePlayerVisiblePlayRequest {
  youtubeVideoIds: string[];
}

export interface HololivePlayerQueueRemoveRequest {
  itemId: string;
}

export interface HololivePlayerQueueReorderRequest {
  itemIds: string[];
}

export interface HololivePlayerQueueSaveRequest {
  name: string;
}

export interface HololivePlayerStateUpdateRequest {
  playbackSourceType?: HololiveMusicPlaybackSource | null;
  currentQueueItemId?: string | null;
  currentPlaylistId?: string | null;
  currentPlaylistItemId?: string | null;
  currentYoutubeVideoId?: string | null;
  repeatMode?: HololiveMusicRepeatMode | null;
  shuffleEnabled?: boolean | null;
  autoplayEnabled?: boolean | null;
}

export interface HololiveBracketCreateRequest {
  size: HololiveBracketSize;
  generationStyle?: HololiveBracketGenerationStyle;
  filters?: HololiveBracketGenerationFilters | null;
  name?: string | null;
}

export interface HololiveBracketGetRequest {
  bracketId: string;
}

export interface HololiveBracketPickWinnerRequest {
  bracketId: string;
  matchId: string;
  winnerEntryId: string;
}

export interface HololiveBracketUndoRequest {
  bracketId: string;
}

export interface HololiveBracketResetRequest {
  bracketId: string;
}

export interface HololiveBracketDeleteRequest {
  bracketId: string;
}

export interface HololiveBracketArchiveDeleteRequest {
  archiveId: string;
}

export interface HololiveUndoApplyRequest {
  token: string;
}

export type HololiveUndoKind =
  | "music-exclusion"
  | "playlist-item-remove"
  | "queue-item-remove"
  | "bracket-archive-delete"
  | "tier-board-clear"
  | "tier-board-delete";

export interface HololiveUndoApplyResponse {
  applied: boolean;
  kind: HololiveUndoKind;
}

export interface IpcChannelMap {
  "app:bootstrap": {
    request: null;
    response: AppBootstrap;
  };
  "settings:get": {
    request: null;
    response: Record<string, string>;
  };
  "settings:set": {
    request: SettingValueRequest;
    response: Record<string, string>;
  };
  "updates:status": {
    request: null;
    response: UpdateStatus;
  };
  "updates:check": {
    request: null;
    response: UpdateStatus;
  };
  "updates:install": {
    request: null;
    response: UpdateStatus;
  };
  "app:save-image": {
    request: ImageSaveRequest;
    response: ImageSaveResponse;
  };
  "app:open-path": {
    request: OpenPathRequest;
    response: OpenPathResponse;
  };
  "app:data-backup:create": {
    request: null;
    response: DataSafetyBackupResponse;
  };
  "app:data-backup:restore": {
    request: null;
    response: DataSafetyRestoreResponse;
  };
  "app:data:reset": {
    request: null;
    response: DataSafetyResetResponse;
  };
  "catalog:list": {
    request: CatalogListFilters;
    response: CatalogItem[];
  };
  "source:health-check": {
    request: { sourceId?: SourceId } | null;
    response: SourceHealth[];
  };
  "fetch:list": {
    request: null;
    response: FetchJob[];
  };
  "fetch:enqueue": {
    request: FetchEnqueueRequest;
    response: FetchJob;
  };
  "fetch:run-next": {
    request: null;
    response: FetchJob | null;
  };
  "fetch:cancel": {
    request: FetchCancelRequest;
    response: FetchJob | null;
  };
  "import:open-csv": {
    request: ImportOpenCsvRequest;
    response: CsvPreview | null;
  };
  "import:apply-csv": {
    request: ImportApplyCsvRequest;
    response: ImportApplyCsvResponse;
  };
  "hololive:tier-data": {
    request: HololiveTierDataRequest | null;
    response: HololiveTierListData;
  };
  "hololive:board:create": {
    request: HololiveBoardCreateRequest;
    response: HololiveTierListData;
  };
  "hololive:board:update": {
    request: HololiveBoardUpdateRequest;
    response: HololiveTierListData;
  };
  "hololive:board:reorder": {
    request: HololiveBoardReorderRequest;
    response: HololiveTierListData;
  };
  "hololive:board:delete": {
    request: HololiveBoardDeleteRequest;
    response: UndoableResponse<HololiveTierListData>;
  };
  "hololive:board:clear": {
    request: HololiveBoardClearRequest;
    response: UndoableResponse<HololiveTierListData>;
  };
  "hololive:tier:create": {
    request: HololiveTierCreateRequest;
    response: HololiveTierListData;
  };
  "hololive:tier:update": {
    request: HololiveTierUpdateRequest;
    response: HololiveTierListData;
  };
  "hololive:tier:delete": {
    request: HololiveTierDeleteRequest;
    response: HololiveTierListData;
  };
  "hololive:tier:reorder": {
    request: HololiveTierReorderRequest;
    response: HololiveTierListData;
  };
  "hololive:placement:move": {
    request: HololivePlacementMoveRequest;
    response: HololiveTierListData;
  };
  "hololive:unranked:sort": {
    request: HololiveUnrankedSortRequest;
    response: HololiveTierListData;
  };
  "hololive:icons:refresh": {
    request: HololiveIconsRefreshRequest | null;
    response: HololiveIconsRefreshResponse;
  };
  "hololive:idol:profile": {
    request: HololiveIdolProfileRequest;
    response: HololiveIdolProfile;
  };
  "hololive:profile:playback-context": {
    request: HololiveProfilePlaybackContextRequest;
    response: HololiveProfilePlaybackContext | null;
  };
  "hololive:music:import-artifacts": {
    request: HololiveMusicImportArtifactsRequest | null;
    response: HololiveMusicImportResult;
  };
  "hololive:music:refresh": {
    request: HololiveMusicRefreshRequest | null;
    response: HololiveMusicImportResult;
  };
  "hololive:music-video-stats:refresh": {
    request: HololiveMusicVideoStatsRefreshRequest | null;
    response: HololiveMusicVideoStatsRefreshResult;
  };
  "hololive:data:refresh": {
    request: HololiveFullDataRefreshRequest | null;
    response: HololiveFullDataRefreshResult;
  };
  "hololive:official-data:refresh": {
    request: HololiveFullDataRefreshRequest | null;
    response: HololiveFullDataRefreshResult;
  };
  "hololive:music:status": {
    request: null;
    response: HololiveMusicStatusResponse;
  };
  "hololive:music:list": {
    request: HololiveMusicListRequest | null;
    response: HololiveMusicRow[];
  };
  "hololive:music:library": {
    request: HololiveMusicLibraryRequest | null;
    response: HololiveMusicLibraryResponse;
  };
  "hololive:music-marker:set": {
    request: HololiveMusicMarkerSetRequest;
    response: HololiveMusicMarkerRecord;
  };
  "hololive:music:exclude": {
    request: HololiveMusicExcludeRequest;
    response: UndoableResponse<HololiveMusicExclusionRecord>;
  };
  "hololive:music:mark-unavailable": {
    request: HololiveMusicUnavailableRequest;
    response: HololiveMusicUnavailableResponse;
  };
  "hololive:channels:refresh": {
    request: null;
    response: HololiveChannelRefreshResult;
  };
  "hololive:channels:list": {
    request: HololiveChannelsListRequest | null;
    response: HolodexChannel[];
  };
  "hololive:custom-talents:resolve": {
    request: HololiveCustomTalentInput;
    response: HololiveCustomTalentPreview;
  };
  "hololive:custom-talents:upsert": {
    request: HololiveCustomTalentInput;
    response: HololiveCustomTalentRecord;
  };
  "hololive:custom-talents:delete": {
    request: HololiveCustomTalentDeleteRequest;
    response: HololiveTierListData;
  };
  "hololive:custom-talents:refresh": {
    request: HololiveCustomTalentRefreshRequest;
    response: HololiveCustomTalentRefreshResult;
  };
  "hololive:custom-talents:refresh-all": {
    request: HololiveCustomTalentsRefreshRequest | null;
    response: HololiveCustomTalentsRefreshResult;
  };
  "hololive:player:data": {
    request: null;
    response: HololiveMusicPlayerData;
  };
  "hololive:player:playlist:create": {
    request: HololivePlayerPlaylistCreateRequest;
    response: HololiveMusicPlayerData;
  };
  "hololive:player:playlist:update": {
    request: HololivePlayerPlaylistUpdateRequest;
    response: HololiveMusicPlayerData;
  };
  "hololive:player:playlist:delete": {
    request: HololivePlayerPlaylistDeleteRequest;
    response: HololiveMusicPlayerData;
  };
  "hololive:player:playlist:reorder": {
    request: HololivePlayerPlaylistReorderRequest;
    response: HololiveMusicPlayerData;
  };
  "hololive:player:playlist-item:add": {
    request: HololivePlayerPlaylistItemAddRequest;
    response: HololiveMusicPlayerData;
  };
  "hololive:player:playlist-items:add": {
    request: HololivePlayerPlaylistItemsAddRequest;
    response: HololiveMusicPlayerData;
  };
  "hololive:player:playlist-item:remove": {
    request: HololivePlayerPlaylistItemRemoveRequest;
    response: UndoableResponse<HololiveMusicPlayerData>;
  };
  "hololive:player:playlist-item:reorder": {
    request: HololivePlayerPlaylistItemReorderRequest;
    response: HololiveMusicPlayerData;
  };
  "hololive:player:playlist:play": {
    request: HololivePlayerPlaylistPlayRequest;
    response: HololiveMusicPlayerData;
  };
  "hololive:player:play-video": {
    request: HololivePlayerPlayVideoRequest;
    response: HololiveMusicPlayerData;
  };
  "hololive:player:queue:add": {
    request: HololivePlayerQueueAddRequest;
    response: HololiveMusicPlayerData;
  };
  "hololive:player:queue:bulk-add": {
    request: HololivePlayerQueueBulkAddRequest;
    response: HololiveMusicPlayerData;
  };
  "hololive:player:visible:play": {
    request: HololivePlayerVisiblePlayRequest;
    response: HololiveMusicPlayerData;
  };
  "hololive:player:queue:remove": {
    request: HololivePlayerQueueRemoveRequest;
    response: UndoableResponse<HololiveMusicPlayerData>;
  };
  "hololive:player:queue:reorder": {
    request: HololivePlayerQueueReorderRequest;
    response: HololiveMusicPlayerData;
  };
  "hololive:player:queue:clear": {
    request: null;
    response: HololiveMusicPlayerData;
  };
  "hololive:player:queue:save": {
    request: HololivePlayerQueueSaveRequest;
    response: HololiveMusicPlayerData;
  };
  "hololive:player:state:update": {
    request: HololivePlayerStateUpdateRequest;
    response: HololiveMusicPlayerData;
  };
  "hololive:brackets:list": {
    request: null;
    response: HololiveBracketSummary[];
  };
  "hololive:brackets:create": {
    request: HololiveBracketCreateRequest;
    response: HololiveBracket;
  };
  "hololive:brackets:get": {
    request: HololiveBracketGetRequest;
    response: HololiveBracket;
  };
  "hololive:brackets:pick-winner": {
    request: HololiveBracketPickWinnerRequest;
    response: HololiveBracket;
  };
  "hololive:brackets:undo": {
    request: HololiveBracketUndoRequest;
    response: HololiveBracket;
  };
  "hololive:brackets:reset": {
    request: HololiveBracketResetRequest;
    response: HololiveBracket;
  };
  "hololive:brackets:delete": {
    request: HololiveBracketDeleteRequest;
    response: HololiveBracketSummary[];
  };
  "hololive:brackets:archives:list": {
    request: null;
    response: HololiveBracketArchiveSummary[];
  };
  "hololive:brackets:archives:delete": {
    request: HololiveBracketArchiveDeleteRequest;
    response: UndoableResponse<HololiveBracketArchiveSummary[]>;
  };
  "hololive:undo:apply": {
    request: HololiveUndoApplyRequest;
    response: HololiveUndoApplyResponse;
  };
  "hololive:brackets:stats": {
    request: null;
    response: HololiveBracketStatsOverview;
  };
}

export type IpcChannel = keyof IpcChannelMap;

export interface HololiveRefreshProgressEvent {
  scope: "music" | "official" | "custom" | "custom-all";
  idolId?: string | null;
  message: string;
  timestamp: string;
}

export interface HoloshelfBridge {
  invoke<C extends IpcChannel>(
    channel: C,
    payload: IpcChannelMap[C]["request"]
  ): Promise<IpcChannelMap[C]["response"]>;
  onHololiveRefreshProgress(listener: (event: HololiveRefreshProgressEvent) => void): () => void;
  onUpdateStatus(listener: (status: UpdateStatus) => void): () => void;
}
