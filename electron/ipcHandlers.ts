import { dialog, ipcMain, shell } from "electron";
import type { IpcMainInvokeEvent } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { z } from "zod";
import type {
  AppBootstrap,
  HololiveMusicImportResult,
  HololiveMusicVideoStatsRefreshResult,
  HololiveTierListData
} from "../src/shared/contracts";
import type { HololiveIconsRefreshResponse, HololiveRefreshProgressEvent, IpcChannelMap } from "../src/shared/ipc";
import { trackerModules } from "../src/modules/registry";
import type { DatabaseService } from "./services/database";
import type { FetchScheduler } from "./services/fetchScheduler";
import { applyCsvImport, createCsvPreview } from "./services/imports";
import { HolodexMusicService } from "./services/holodexMusicService";
import type { UpdateService } from "./services/updateService";
import type { YouTubeVideoStatsService } from "./services/youtubeVideoStatsService";

const TRANSPARENT_PIXEL = { r: 0, g: 0, b: 0, alpha: 0 };
const HOLOLIVE_IMAGE_CACHE_VERSION = 6;
const OPTIMIZED_ICON_SIZE = 128;
const PROFILE_CANVAS_WIDTH = 260;
const PROFILE_CANVAS_HEIGHT = 340;
const PROFILE_SUBJECT_TARGET_HEIGHT = 332;
const PROFILE_SUBJECT_BOTTOM_PAD = 4;
const PROFILE_ALPHA_THRESHOLD = 12;
const PROFILE_FOCUS_X_LOW = 0.06;
const PROFILE_FOCUS_X_HIGH = 0.94;

const settingSchema = z.object({
  key: z.string().min(1),
  value: z.string()
});

const imageSaveSchema = z.object({
  defaultFileName: z.string().trim().min(1).max(180),
  dataUrl: z.string().startsWith("data:image/png;base64,")
});

const openPathSchema = z.object({
  filePath: z.string().trim().min(1)
});

const catalogListSchema = z.object({
  moduleId: z.enum(["hololive"]).optional(),
  query: z.string().optional(),
  limit: z.number().int().positive().max(500).optional()
});

const fetchEnqueueSchema = z.object({
  moduleId: z.enum(["hololive"]),
  sourceId: z.enum(["holodex"]),
  kind: z.enum(["health-check", "discover", "detail", "cover"]),
  targetUrl: z.string().url(),
  priority: z.number().int().optional()
});

const fetchCancelSchema = z.object({
  jobId: z.string().min(1)
});

const openCsvSchema = z.object({
  moduleId: z.enum(["hololive"])
});

const sourceHealthSchema = z
  .object({
    sourceId: z.enum(["holodex"]).optional()
  })
  .nullable();

const hololiveTierDataSchema = z
  .object({
    boardId: z.string().min(1).optional().nullable()
  })
  .nullable();

const hololiveBoardCreateSchema = z.object({
  name: z.string().min(1).max(80),
  afterBoardId: z.string().min(1).optional().nullable()
});

const hololiveBoardUpdateSchema = z.object({
  boardId: z.string().min(1),
  name: z.string().min(1).max(80).optional(),
  tileSize: z.number().int().min(36).max(96).optional()
});

const hololiveBoardReorderSchema = z.object({
  boardIds: z.array(z.string().min(1)).min(1),
  activeBoardId: z.string().min(1).optional().nullable()
});

const hololiveBoardDeleteSchema = z.object({
  boardId: z.string().min(1)
});

const hololiveBoardClearSchema = z.object({
  boardId: z.string().min(1)
});

const hololiveTierCreateSchema = z.object({
  boardId: z.string().min(1),
  label: z.string().min(1).max(12).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  position: z.number().int().min(0).optional()
});

const hololiveTierUpdateSchema = z.object({
  boardId: z.string().min(1),
  tierId: z.string().min(1),
  label: z.string().min(1).max(12).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  collapsed: z.boolean().optional()
});

const hololiveTierDeleteSchema = z.object({
  boardId: z.string().min(1),
  tierId: z.string().min(1)
});

const hololiveTierReorderSchema = z.object({
  boardId: z.string().min(1),
  tierIds: z.array(z.string().min(1)).min(1)
});

const hololivePlacementMoveSchema = z.object({
  boardId: z.string().min(1),
  idolId: z.string().min(1),
  tierId: z.string().min(1).nullable(),
  index: z.number().int().min(0)
});

const hololiveUnrankedSortSchema = z.object({
  boardId: z.string().min(1)
});

const hololiveIconsRefreshSchema = z
  .object({
    idolIds: z.array(z.string().min(1)).optional()
  })
  .nullable();

const hololiveIdolProfileSchema = z.object({
  idolId: z.string().min(1)
});

const hololiveProfilePlaybackContextSchema = z.object({
  youtubeVideoId: z.string().trim().min(1),
  preferredIdolId: z.string().trim().min(1).optional().nullable(),
  preferredGroupId: z.enum(["original-songs", "covers", "featured-in", "playlists"]).optional().nullable()
});

const hololiveMusicImportArtifactsSchema = z
  .object({
    directoryPath: z.string().min(1).optional().nullable()
  })
  .nullable();

const hololiveMusicRefreshObjectSchema = z.object({
    searchUrl: z.string().url().optional().nullable(),
    pageLimit: z.number().int().positive().max(500).optional().nullable(),
    pageSize: z.number().int().positive().max(50).optional().nullable(),
    includeChannels: z.boolean().optional().nullable(),
    includeCustomTalents: z.boolean().optional().nullable(),
    includeRelationships: z.boolean().optional().nullable(),
    includeCollabs: z.boolean().optional().nullable(),
    collabPageLimit: z.number().int().positive().max(50).optional().nullable(),
    replaceExisting: z.boolean().optional().nullable(),
    maxRequestsPerWindow: z.number().int().positive().max(500).optional().nullable(),
    requestWindowMs: z.number().int().positive().max(600_000).optional().nullable()
  });

const hololiveMusicRefreshSchema = hololiveMusicRefreshObjectSchema
  .nullable();

const hololiveMusicVideoStatsRefreshSchema = z
  .object({
    youtubeVideoIds: z.array(z.string().trim().min(1)).optional().nullable(),
    limit: z.number().int().positive().max(50_000).optional().nullable()
  })
  .nullable();

const hololiveFullDataRefreshSchema = hololiveMusicRefreshObjectSchema
  .extend({
    videoStatsLimit: z.number().int().positive().max(50_000).optional().nullable()
  })
  .nullable();

const hololiveMusicListSchema = z
  .object({
    idolId: z.string().min(1).optional().nullable(),
    topicId: z.enum(["Original_Song", "Music_Cover"]).optional().nullable(),
    youtubeVideoIds: z.array(z.string().trim().min(1)).optional().nullable(),
    query: z.string().optional().nullable(),
    limit: z.number().int().positive().max(500).optional().nullable()
  })
  .nullable();

const hololiveMusicLibrarySchema = z
  .object({
    query: z.string().optional().nullable(),
    topicId: z.enum(["Original_Song", "Music_Cover"]).optional().nullable(),
    marker: z.enum(["favorite", "like", "neutral", "dislike"]).optional().nullable(),
    offset: z.number().int().min(0).optional().nullable(),
    limit: z.number().int().positive().max(100).optional().nullable()
  })
  .nullable();

const hololiveMusicMarkerSetSchema = z.object({
  youtubeVideoId: z.string().min(1),
  marker: z.enum(["favorite", "like", "neutral", "dislike"]).nullable()
});

const hololiveMusicExcludeSchema = z.object({
  youtubeVideoId: z.string().trim().min(1),
  title: z.string().optional().nullable(),
  sourceUrl: z.string().optional().nullable()
});

const hololiveChannelsListSchema = z
  .object({
    kind: z.enum(["idol", "topic", "group", "unknown"]).optional().nullable()
  })
  .nullable();

const hololiveCustomTalentInputSchema = z.object({
  channelInput: z.string().trim().min(1).max(500),
  displayName: z.string().trim().max(120).optional().nullable(),
  originalSongsUrl: z.string().trim().url().optional().nullable(),
  coversUrl: z.string().trim().url().optional().nullable()
});

const hololiveCustomTalentDeleteSchema = z.object({
  idolId: z.string().trim().min(1)
});

const hololiveCustomTalentRefreshSchema = z.object({
  idolId: z.string().trim().min(1),
  pageLimit: z.number().int().positive().max(100).optional().nullable(),
  includeRelationships: z.boolean().optional().nullable(),
  includeCollabs: z.boolean().optional().nullable(),
  collabPageLimit: z.number().int().positive().max(50).optional().nullable()
});

const hololiveCustomTalentsRefreshSchema = z
  .object({
    idolIds: z.array(z.string().trim().min(1)).optional().nullable(),
    pageLimit: z.number().int().positive().max(100).optional().nullable(),
    includeRelationships: z.boolean().optional().nullable(),
    includeCollabs: z.boolean().optional().nullable(),
    collabPageLimit: z.number().int().positive().max(50).optional().nullable(),
    videoStatsLimit: z.number().int().positive().max(50_000).optional().nullable()
  })
  .nullable();

const hololivePlayerPlaylistCreateSchema = z.object({
  name: z.string().trim().min(1).max(120)
});

const hololivePlayerPlaylistUpdateSchema = z.object({
  playlistId: z.string().trim().min(1),
  name: z.string().trim().min(1).max(120)
});

const hololivePlayerPlaylistDeleteSchema = z.object({
  playlistId: z.string().trim().min(1)
});

const hololivePlayerPlaylistReorderSchema = z.object({
  playlistIds: z.array(z.string().trim().min(1)).min(1)
});

const hololivePlayerPlaylistItemAddSchema = z.object({
  playlistId: z.string().trim().min(1),
  youtubeVideoId: z.string().trim().min(1),
  position: z.number().int().min(0).optional().nullable()
});

const hololivePlayerPlaylistItemRemoveSchema = z.object({
  itemId: z.string().trim().min(1)
});

const hololivePlayerPlaylistItemReorderSchema = z.object({
  playlistId: z.string().trim().min(1),
  itemIds: z.array(z.string().trim().min(1)).min(1)
});

const hololivePlayerPlaylistPlaySchema = z.object({
  playlistId: z.string().trim().min(1),
  itemId: z.string().trim().min(1).optional().nullable()
});

const hololivePlayerPlayVideoSchema = z.object({
  youtubeVideoId: z.string().trim().min(1)
});

const hololivePlayerQueueAddSchema = z.object({
  youtubeVideoId: z.string().trim().min(1),
  placement: z.enum(["now", "next", "end"])
});

const hololivePlayerQueueRemoveSchema = z.object({
  itemId: z.string().trim().min(1)
});

const hololivePlayerQueueReorderSchema = z.object({
  itemIds: z.array(z.string().trim().min(1)).min(1)
});

const hololivePlayerQueueSaveSchema = z.object({
  name: z.string().trim().min(1).max(120)
});

const hololivePlayerStateUpdateSchema = z.object({
  playbackSourceType: z.enum(["queue", "playlist", "library"]).optional().nullable(),
  currentQueueItemId: z.string().trim().min(1).optional().nullable(),
  currentPlaylistId: z.string().trim().min(1).optional().nullable(),
  currentPlaylistItemId: z.string().trim().min(1).optional().nullable(),
  currentYoutubeVideoId: z.string().trim().min(1).optional().nullable(),
  repeatMode: z.enum(["off", "all", "one"]).optional().nullable(),
  shuffleEnabled: z.boolean().optional().nullable(),
  autoplayEnabled: z.boolean().optional().nullable()
});

const hololiveBracketSizeSchema = z.enum(["RO16", "RO32", "RO64", "RO128", "RO256"]);
const hololiveBracketGenerationStyleSchema = z.enum(["top_songs", "random_songs"]);
const hololiveMusicTopicSchema = z.enum(["Original_Song", "Music_Cover"]);
const hololiveBracketGenerationFiltersSchema = z.object({
  excludeDisliked: z.boolean().optional(),
  excludeRated: z.boolean().optional(),
  excludeTopViewedPerTalent: z.boolean().optional(),
  excludePreviousChampions: z.boolean().optional(),
  excludePreviousFinalists: z.boolean().optional(),
  excludePreviousTop4: z.boolean().optional(),
  excludePreviousTop8: z.boolean().optional(),
  excludeAboveViews: z.number().int().min(0).max(10_000_000_000).optional().nullable(),
  excludeBelowViews: z.number().int().min(0).max(10_000_000_000).optional().nullable(),
  excludeAfterDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  excludeBeforeDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  excludeTopicIds: z.array(hololiveMusicTopicSchema).optional()
});

const hololiveBracketCreateSchema = z.object({
  size: hololiveBracketSizeSchema,
  generationStyle: hololiveBracketGenerationStyleSchema.optional().default("top_songs"),
  filters: hololiveBracketGenerationFiltersSchema.optional().nullable(),
  name: z.string().trim().max(120).optional().nullable()
});

const hololiveBracketGetSchema = z.object({
  bracketId: z.string().trim().min(1)
});

const hololiveBracketPickWinnerSchema = z.object({
  bracketId: z.string().trim().min(1),
  matchId: z.string().trim().min(1),
  winnerEntryId: z.string().trim().min(1)
});

const hololiveBracketUndoSchema = z.object({
  bracketId: z.string().trim().min(1)
});

const hololiveBracketResetSchema = z.object({
  bracketId: z.string().trim().min(1)
});

const hololiveBracketDeleteSchema = z.object({
  bracketId: z.string().trim().min(1)
});

const hololiveBracketArchiveDeleteSchema = z.object({
  archiveId: z.string().trim().min(1)
});

export interface IpcContext {
  appName: string;
  dataDirectory: string;
  databasePath: string;
  backupDirectory: string;
  dataLocationKind: "appData" | "dev" | "custom";
  hololiveImageDirectory: string;
  database: DatabaseService;
  fetchScheduler: FetchScheduler;
  holodexMusicService: HolodexMusicService;
  youtubeVideoStatsService: YouTubeVideoStatsService;
  updateService: UpdateService;
}

function collectHololiveMusicVideoIdsForIdols(context: IpcContext, idolIds: string[]): string[] {
  const videoIds = new Set<string>();
  const uniqueIdolIds = [...new Set(idolIds.map((idolId) => idolId.trim()).filter(Boolean))];

  for (const idolId of uniqueIdolIds) {
    for (const row of context.database.listHololiveMusicRows({ idolId, limit: 5000 })) {
      videoIds.add(row.youtubeVideoId);
    }
  }

  return [...videoIds];
}

function emptyVideoStatsRefresh(): HololiveMusicVideoStatsRefreshResult {
  return {
    requestedVideos: 0,
    updatedVideos: 0,
    missingVideos: 0,
    failedBatches: 0,
    batches: 0,
    fetchedAt: new Date().toISOString()
  };
}

async function refreshOptionalCustomTalentVideoStats(
  context: IpcContext,
  input: { idolIds: string[]; limit?: number | null }
): Promise<HololiveMusicVideoStatsRefreshResult> {
  if (!context.database.getSettings()["sources.youtubeApiKey"]?.trim()) {
    return emptyVideoStatsRefresh();
  }

  return context.youtubeVideoStatsService.refreshViewCounts({
    youtubeVideoIds: collectHololiveMusicVideoIdsForIdols(context, input.idolIds),
    limit: input.limit ?? null
  });
}

function createProgressHolodexMusicService(
  context: IpcContext,
  event: IpcMainInvokeEvent,
  scope: HololiveRefreshProgressEvent["scope"],
  idolId?: string | null
): HolodexMusicService {
  return new HolodexMusicService(context.database, globalThis.fetch.bind(globalThis), (message) => {
    event.sender.send("hololive:refresh-progress", {
      scope,
      idolId: idolId ?? null,
      message,
      timestamp: new Date().toISOString()
    } satisfies HololiveRefreshProgressEvent);
  });
}

function safePngFileName(fileName: string): string {
  const baseName = path
    .basename(fileName)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140);
  const withoutExtension = baseName.replace(/\.png$/i, "").trim() || "holoshelf-export";
  return `${withoutExtension}.png`;
}

export function installIpcHandlers(context: IpcContext): void {
  handle("app:bootstrap", async (): Promise<AppBootstrap> => ({
    appName: context.appName,
    dataDirectory: context.dataDirectory,
    databasePath: context.databasePath,
    backupDirectory: context.backupDirectory,
    dataLocationKind: context.dataLocationKind,
    modules: trackerModules,
    sourceHealth: context.database.getSourceHealth(),
    stats: context.database.getStats()
  }));

  handle("settings:get", async () => context.database.getSettings());

  handle("settings:set", async (_event, payload) => {
    const input = settingSchema.parse(payload);
    return context.database.setSetting(input.key, input.value);
  });

  handle("updates:status", async () => context.updateService.getStatus());

  handle("updates:check", async () => context.updateService.checkForUpdates());

  handle("updates:install", async () => context.updateService.restartToInstall());

  handle("app:save-image", async (_event, payload) => {
    const input = imageSaveSchema.parse(payload);
    const safeFileName = safePngFileName(input.defaultFileName);
    const result = await dialog.showSaveDialog({
      title: "Save Bracket Image",
      defaultPath: safeFileName,
      filters: [{ name: "PNG image", extensions: ["png"] }]
    });

    if (result.canceled || !result.filePath) {
      return { filePath: null };
    }

    const base64 = input.dataUrl.replace(/^data:image\/png;base64,/, "");
    await fs.writeFile(result.filePath, Buffer.from(base64, "base64"));
    return { filePath: result.filePath };
  });

  handle("app:open-path", async (_event, payload) => {
    const input = openPathSchema.parse(payload);
    const openError = await shell.openPath(input.filePath);
    if (openError) {
      throw new Error(openError);
    }
    return { opened: true };
  });

  handle("catalog:list", async (_event, payload) => {
    const filters = catalogListSchema.parse(payload ?? {});
    return context.database.listCatalog(filters);
  });

  handle("source:health-check", async (_event, payload) => {
    const input = sourceHealthSchema.parse(payload ?? null);
    return context.fetchScheduler.checkHealth(input?.sourceId);
  });

  handle("fetch:list", async () => context.fetchScheduler.listJobs());

  handle("fetch:enqueue", async (_event, payload) => {
    const input = fetchEnqueueSchema.parse(payload);
    return context.fetchScheduler.enqueue(input);
  });

  handle("fetch:run-next", async () => context.fetchScheduler.runNext());

  handle("fetch:cancel", async (_event, payload) => {
    const input = fetchCancelSchema.parse(payload);
    return context.fetchScheduler.cancel(input.jobId);
  });

  handle("import:open-csv", async (_event, payload) => {
    openCsvSchema.parse(payload);
    const result = await dialog.showOpenDialog({
      title: "Open Hololive CSV",
      filters: [{ name: "CSV files", extensions: ["csv"] }],
      properties: ["openFile"]
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    const filePath = result.filePaths[0];
    const text = await fs.readFile(filePath, "utf8");
    return createCsvPreview(path.basename(filePath), text);
  });

  handle("import:apply-csv", async (_event, payload) => applyCsvImport(context.database, payload));

  handle("hololive:tier-data", async (_event, payload) => {
    const input = hololiveTierDataSchema.parse(payload ?? null);
    return getHololiveTierData(context, input?.boardId ?? null);
  });

  handle("hololive:board:create", async (_event, payload) => {
    const input = hololiveBoardCreateSchema.parse(payload);
    const boardId = context.database.createHololiveTierBoard(input.name, undefined, input.afterBoardId ?? null);
    return getHololiveTierData(context, boardId);
  });

  handle("hololive:board:update", async (_event, payload) => {
    const input = hololiveBoardUpdateSchema.parse(payload);
    context.database.updateHololiveTierBoard(input);
    return getHololiveTierData(context, input.boardId);
  });

  handle("hololive:board:reorder", async (_event, payload) => {
    const input = hololiveBoardReorderSchema.parse(payload);
    context.database.reorderHololiveTierBoards(input.boardIds);
    return getHololiveTierData(context, input.activeBoardId ?? input.boardIds[0] ?? null);
  });

  handle("hololive:board:delete", async (_event, payload) => {
    const input = hololiveBoardDeleteSchema.parse(payload);
    const fallbackBoardId = context.database.deleteHololiveTierBoard(input.boardId);
    return getHololiveTierData(context, fallbackBoardId);
  });

  handle("hololive:board:clear", async (_event, payload) => {
    const input = hololiveBoardClearSchema.parse(payload);
    context.database.clearHololiveTierBoard(input.boardId);
    return getHololiveTierData(context, input.boardId);
  });

  handle("hololive:tier:create", async (_event, payload) => {
    const input = hololiveTierCreateSchema.parse(payload);
    context.database.createHololiveTier(input);
    return getHololiveTierData(context, input.boardId);
  });

  handle("hololive:tier:update", async (_event, payload) => {
    const input = hololiveTierUpdateSchema.parse(payload);
    context.database.updateHololiveTier(input);
    return getHololiveTierData(context, input.boardId);
  });

  handle("hololive:tier:delete", async (_event, payload) => {
    const input = hololiveTierDeleteSchema.parse(payload);
    context.database.deleteHololiveTier(input.boardId, input.tierId);
    return getHololiveTierData(context, input.boardId);
  });

  handle("hololive:tier:reorder", async (_event, payload) => {
    const input = hololiveTierReorderSchema.parse(payload);
    context.database.reorderHololiveTiers(input.boardId, input.tierIds);
    return getHololiveTierData(context, input.boardId);
  });

  handle("hololive:placement:move", async (_event, payload) => {
    const input = hololivePlacementMoveSchema.parse(payload);
    context.database.moveHololiveIdol(input);
    return getHololiveTierData(context, input.boardId);
  });

  handle("hololive:unranked:sort", async (_event, payload) => {
    const input = hololiveUnrankedSortSchema.parse(payload);
    context.database.sortHololiveUnrankedByDefaultOrder(input.boardId);
    return getHololiveTierData(context, input.boardId);
  });

  handle("hololive:icons:refresh", async (_event, payload) => {
    const input = hololiveIconsRefreshSchema.parse(payload ?? null);
    return refreshHololiveIcons(context, input?.idolIds);
  });

  handle("hololive:idol:profile", async (_event, payload) => {
    const input = hololiveIdolProfileSchema.parse(payload);
    return context.database.getHololiveIdolProfile(input.idolId, resolveHololiveCachedImageUrl);
  });

  handle("hololive:profile:playback-context", async (_event, payload) => {
    const input = hololiveProfilePlaybackContextSchema.parse(payload);
    return context.database.getHololiveProfilePlaybackContext(input);
  });

  handle("hololive:music:import-artifacts", async (_event, payload) => {
    const input = hololiveMusicImportArtifactsSchema.parse(payload ?? null);
    const directoryPath = input?.directoryPath ?? (await openHolodexArtifactDirectory());

    if (!directoryPath) {
      throw new Error("Holodex artifact import requires a directory");
    }

    return context.holodexMusicService.importArtifacts(directoryPath);
  });

  handle("hololive:music:refresh", async (_event, payload) => {
    const input = hololiveMusicRefreshSchema.parse(payload ?? null);
    const holodexMusicService = createProgressHolodexMusicService(context, _event, "music");
    return holodexMusicService.refreshLive({
      searchUrl: input?.searchUrl ?? null,
      pageLimit: input?.pageLimit ?? null,
      pageSize: input?.pageSize ?? null,
      includeChannels: input?.includeChannels ?? null,
      includeCustomTalents: input?.includeCustomTalents ?? null,
      includeRelationships: input?.includeRelationships ?? null,
      includeCollabs: input?.includeCollabs ?? null,
      collabPageLimit: input?.collabPageLimit ?? null,
      replaceExisting: input?.replaceExisting ?? null,
      maxRequestsPerWindow: input?.maxRequestsPerWindow ?? null,
      requestWindowMs: input?.requestWindowMs ?? null
    });
  });

  handle("hololive:music-video-stats:refresh", async (_event, payload) => {
    const input = hololiveMusicVideoStatsRefreshSchema.parse(payload ?? null);
    return context.youtubeVideoStatsService.refreshViewCounts({
      youtubeVideoIds: input?.youtubeVideoIds ?? null,
      limit: input?.limit ?? null
    });
  });

  handle("hololive:data:refresh", async (_event, payload) => {
    const input = hololiveFullDataRefreshSchema.parse(payload ?? null);
    const holodexMusicService = createProgressHolodexMusicService(context, _event, "music");
    const channelRefresh = await holodexMusicService.refreshChannels();
    const musicRefresh = await holodexMusicService.refreshLive({
      searchUrl: input?.searchUrl ?? null,
      pageLimit: input?.pageLimit ?? null,
      pageSize: input?.pageSize ?? null,
      includeChannels: false,
      includeCustomTalents: input?.includeCustomTalents ?? true,
      includeRelationships: input?.includeRelationships ?? true,
      includeCollabs: input?.includeCollabs ?? true,
      collabPageLimit: input?.collabPageLimit ?? null,
      replaceExisting: input?.replaceExisting ?? false,
      maxRequestsPerWindow: input?.maxRequestsPerWindow ?? null,
      requestWindowMs: input?.requestWindowMs ?? null
    });
    const videoStatsRefresh = await context.youtubeVideoStatsService.refreshViewCounts({
      limit: input?.videoStatsLimit ?? null
    });

    return {
      channelRefresh,
      musicRefresh,
      videoStatsRefresh,
      updatedAt: new Date().toISOString()
    };
  });

  handle("hololive:official-data:refresh", async (_event, payload) => {
    const input = hololiveFullDataRefreshSchema.parse(payload ?? null);
    const holodexMusicService = createProgressHolodexMusicService(context, _event, "official");
    const channelRefresh = await holodexMusicService.refreshChannels();
    const musicRefresh = await holodexMusicService.refreshLive({
      searchUrl: input?.searchUrl ?? null,
      pageLimit: input?.pageLimit ?? null,
      pageSize: input?.pageSize ?? null,
      includeChannels: false,
      includeCustomTalents: false,
      includeRelationships: input?.includeRelationships ?? true,
      includeCollabs: input?.includeCollabs ?? true,
      collabPageLimit: input?.collabPageLimit ?? null,
      replaceExisting: input?.replaceExisting ?? false,
      maxRequestsPerWindow: input?.maxRequestsPerWindow ?? null,
      requestWindowMs: input?.requestWindowMs ?? null
    });
    const officialIdolIds = context.database
      .listHololiveIdols()
      .filter((idol) => idol.source !== "custom")
      .map((idol) => idol.id);
    const videoStatsRefresh = await context.youtubeVideoStatsService.refreshViewCounts({
      youtubeVideoIds: collectHololiveMusicVideoIdsForIdols(context, officialIdolIds),
      limit: input?.videoStatsLimit ?? null
    });

    return {
      channelRefresh,
      musicRefresh,
      videoStatsRefresh,
      updatedAt: new Date().toISOString()
    };
  });

  handle("hololive:music:status", async () => context.database.getHololiveMusicStatus());

  handle("hololive:music:list", async (_event, payload) => {
    const input = hololiveMusicListSchema.parse(payload ?? null);
    return context.database.listHololiveMusicRows(input ?? {});
  });

  handle("hololive:music:library", async (_event, payload) => {
    const input = hololiveMusicLibrarySchema.parse(payload ?? null);
    return context.database.listHololiveMusicLibrary(input ?? {});
  });

  handle("hololive:music-marker:set", async (_event, payload) => {
    const input = hololiveMusicMarkerSetSchema.parse(payload);
    return context.database.setHololiveMusicMarker(input);
  });

  handle("hololive:music:exclude", async (_event, payload) => {
    const input = hololiveMusicExcludeSchema.parse(payload);
    return context.database.excludeHololiveMusicVideo(input);
  });

  handle("hololive:channels:refresh", async () => context.holodexMusicService.refreshChannels());

  handle("hololive:channels:list", async (_event, payload) => {
    const input = hololiveChannelsListSchema.parse(payload ?? null);
    return context.database.listHololiveChannels(input ?? {});
  });

  handle("hololive:custom-talents:resolve", async (_event, payload) => {
    const input = hololiveCustomTalentInputSchema.parse(payload);
    return context.holodexMusicService.resolveCustomTalent(input);
  });

  handle("hololive:custom-talents:upsert", async (_event, payload) => {
    const input = hololiveCustomTalentInputSchema.parse(payload);
    return context.holodexMusicService.upsertCustomTalent(input);
  });

  handle("hololive:custom-talents:delete", async (_event, payload) => {
    const input = hololiveCustomTalentDeleteSchema.parse(payload);
    context.holodexMusicService.deleteCustomTalent(input.idolId);
    return getHololiveTierData(context);
  });

  handle("hololive:custom-talents:refresh", async (_event, payload) => {
    const input = hololiveCustomTalentRefreshSchema.parse(payload);
    const holodexMusicService = createProgressHolodexMusicService(context, _event, "custom", input.idolId);
    const musicRefresh = await holodexMusicService.refreshCustomTalent(input);
    const videoStatsRefresh = await refreshOptionalCustomTalentVideoStats(context, {
      idolIds: [input.idolId]
    });

    return {
      musicRefresh,
      videoStatsRefresh,
      updatedAt: new Date().toISOString()
    };
  });

  handle("hololive:custom-talents:refresh-all", async (_event, payload) => {
    const input = hololiveCustomTalentsRefreshSchema.parse(payload ?? null);
    const requestedIdols = new Set((input?.idolIds ?? []).map((idolId) => idolId.trim()).filter(Boolean));
    const customIdols = context.database
      .listHololiveIdols()
      .filter((idol) => idol.source === "custom" && idol.youtubeChannelId)
      .filter((idol) => requestedIdols.size === 0 || requestedIdols.has(idol.id));
    const musicRefreshes: HololiveMusicImportResult[] = [];

    for (const idol of customIdols) {
      try {
        musicRefreshes.push(
          await createProgressHolodexMusicService(context, _event, "custom-all", idol.id).refreshCustomTalent({
            idolId: idol.id,
            pageLimit: input?.pageLimit ?? null,
            includeRelationships: input?.includeRelationships ?? true,
            includeCollabs: input?.includeCollabs ?? true,
            collabPageLimit: input?.collabPageLimit ?? null
          })
        );
      } catch (error) {
        musicRefreshes.push(
          context.database.recordFailedHolodexRefresh({
            source: "live",
            error:
              `${idol.displayName}: ` +
              (error instanceof Error ? error.message : "Custom talent Holodex refresh failed")
          })
        );
      }
    }

    const videoStatsRefresh = await refreshOptionalCustomTalentVideoStats(context, {
      idolIds: customIdols.map((idol) => idol.id),
      limit: input?.videoStatsLimit ?? null
    });

    return {
      refreshedTalents: customIdols.length,
      musicRefreshes,
      videoStatsRefresh,
      updatedAt: new Date().toISOString()
    };
  });

  handle("hololive:player:data", async () => context.database.getHololiveMusicPlayerData());

  handle("hololive:player:playlist:create", async (_event, payload) => {
    const input = hololivePlayerPlaylistCreateSchema.parse(payload);
    return context.database.createHololiveMusicPlaylist(input.name);
  });

  handle("hololive:player:playlist:update", async (_event, payload) => {
    const input = hololivePlayerPlaylistUpdateSchema.parse(payload);
    return context.database.updateHololiveMusicPlaylist(input);
  });

  handle("hololive:player:playlist:delete", async (_event, payload) => {
    const input = hololivePlayerPlaylistDeleteSchema.parse(payload);
    return context.database.deleteHololiveMusicPlaylist(input.playlistId);
  });

  handle("hololive:player:playlist:reorder", async (_event, payload) => {
    const input = hololivePlayerPlaylistReorderSchema.parse(payload);
    return context.database.reorderHololiveMusicPlaylists(input.playlistIds);
  });

  handle("hololive:player:playlist-item:add", async (_event, payload) => {
    const input = hololivePlayerPlaylistItemAddSchema.parse(payload);
    return context.database.addHololiveMusicPlaylistItem(input);
  });

  handle("hololive:player:playlist-item:remove", async (_event, payload) => {
    const input = hololivePlayerPlaylistItemRemoveSchema.parse(payload);
    return context.database.removeHololiveMusicPlaylistItem(input.itemId);
  });

  handle("hololive:player:playlist-item:reorder", async (_event, payload) => {
    const input = hololivePlayerPlaylistItemReorderSchema.parse(payload);
    return context.database.reorderHololiveMusicPlaylistItems(input);
  });

  handle("hololive:player:playlist:play", async (_event, payload) => {
    const input = hololivePlayerPlaylistPlaySchema.parse(payload);
    return context.database.playHololiveMusicPlaylist(input);
  });

  handle("hololive:player:play-video", async (_event, payload) => {
    const input = hololivePlayerPlayVideoSchema.parse(payload);
    return context.database.playHololiveMusicVideo(input.youtubeVideoId);
  });

  handle("hololive:player:queue:add", async (_event, payload) => {
    const input = hololivePlayerQueueAddSchema.parse(payload);
    return context.database.addHololiveMusicQueueItem(input);
  });

  handle("hololive:player:queue:remove", async (_event, payload) => {
    const input = hololivePlayerQueueRemoveSchema.parse(payload);
    return context.database.removeHololiveMusicQueueItem(input.itemId);
  });

  handle("hololive:player:queue:reorder", async (_event, payload) => {
    const input = hololivePlayerQueueReorderSchema.parse(payload);
    return context.database.reorderHololiveMusicQueueItems(input.itemIds);
  });

  handle("hololive:player:queue:clear", async () => context.database.clearHololiveMusicQueue());

  handle("hololive:player:queue:save", async (_event, payload) => {
    const input = hololivePlayerQueueSaveSchema.parse(payload);
    return context.database.saveHololiveMusicQueueAsPlaylist(input.name);
  });

  handle("hololive:player:state:update", async (_event, payload) => {
    const input = hololivePlayerStateUpdateSchema.parse(payload);
    return context.database.updateHololiveMusicPlayerState(input);
  });

  handle("hololive:brackets:list", async () => context.database.listHololiveBrackets());

  handle("hololive:brackets:create", async (_event, payload) => {
    const input = hololiveBracketCreateSchema.parse(payload);
    return context.database.createHololiveBracket(input);
  });

  handle("hololive:brackets:get", async (_event, payload) => {
    const input = hololiveBracketGetSchema.parse(payload);
    return context.database.getHololiveBracket(input.bracketId);
  });

  handle("hololive:brackets:pick-winner", async (_event, payload) => {
    const input = hololiveBracketPickWinnerSchema.parse(payload);
    return context.database.pickHololiveBracketWinner(input);
  });

  handle("hololive:brackets:undo", async (_event, payload) => {
    const input = hololiveBracketUndoSchema.parse(payload);
    return context.database.undoHololiveBracket(input.bracketId);
  });

  handle("hololive:brackets:reset", async (_event, payload) => {
    const input = hololiveBracketResetSchema.parse(payload);
    return context.database.resetHololiveBracket(input.bracketId);
  });

  handle("hololive:brackets:delete", async (_event, payload) => {
    const input = hololiveBracketDeleteSchema.parse(payload);
    return context.database.deleteHololiveBracket(input.bracketId);
  });

  handle("hololive:brackets:archives:list", async () => context.database.listHololiveBracketArchives());

  handle("hololive:brackets:archives:delete", async (_event, payload) => {
    const input = hololiveBracketArchiveDeleteSchema.parse(payload);
    return context.database.deleteHololiveBracketArchive(input.archiveId);
  });

  handle("hololive:brackets:stats", async () => context.database.getHololiveBracketStatsOverview());
}

function getHololiveTierData(context: IpcContext, boardId?: string | null): HololiveTierListData {
  return context.database.getHololiveTierListData(boardId, resolveHololiveCachedImageUrl);
}

function resolveHololiveCachedImageUrl(fileName: string): string {
  const safeFileName = path.basename(fileName);
  return `app://holoshelf-data/hololive-images/${encodeURIComponent(safeFileName)}`;
}

async function openHolodexArtifactDirectory(): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    title: "Open Holodex Artifact Folder",
    properties: ["openDirectory"]
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  return result.filePaths[0];
}

async function refreshHololiveIcons(
  context: IpcContext,
  idolIds?: string[]
): Promise<HololiveIconsRefreshResponse> {
  const selectedIds = idolIds ? new Set(idolIds) : null;
  const idols = context.database.listHololiveIdols().filter((idol) => !selectedIds || selectedIds.has(idol.id));
  const existingCache = new Map(
    context.database
      .listHololiveImageCaches()
      .map((entry) => [`${entry.idolId}:${entry.kind}`, entry])
  );
  const cacheEntries: Array<{
    idolId: string;
    kind: "icon" | "profile";
    sourceUrl: string;
    localFilename: string;
    mimeType?: string | null;
    sizeBytes?: number | null;
  }> = [];
  const candidateTargets = idols.flatMap((idol) => {
    const imageTargets: Array<{ idolId: string; slug: string; kind: "icon" | "profile"; sourceUrl: string }> = [
      { idolId: idol.id, slug: idol.slug, kind: "icon", sourceUrl: idol.iconUrl }
    ];

    if (idol.profileImageUrl) {
      imageTargets.push({ idolId: idol.id, slug: idol.slug, kind: "profile", sourceUrl: idol.profileImageUrl });
    }

    return imageTargets;
  });
  const targets: typeof candidateTargets = [];
  let cached = 0;
  let failed = 0;

  await fs.mkdir(context.hololiveImageDirectory, { recursive: true });

  for (const target of candidateTargets) {
    if (!(await hasFreshCachedImage(context, existingCache, target))) {
      targets.push(target);
    }
  }

  async function cacheTarget(target: (typeof targets)[number]): Promise<void> {
    try {
      const sourceUrl = new URL(target.sourceUrl);
      if (sourceUrl.hostname !== "hololive.hololivepro.com" || !sourceUrl.pathname.startsWith("/wp-content/uploads/")) {
        throw new Error("Unsupported Hololive image host");
      }

      const localFilename = getHololiveImageCacheFileName(target.slug, target.kind);
      const localPath = path.join(context.hololiveImageDirectory, localFilename);
      const response = await fetch(sourceUrl, {
        redirect: "follow",
        headers: {
          "User-Agent": "Holoshelf personal local image cache"
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const sourceMimeType = response.headers.get("content-type")?.split(";")[0] ?? null;
      if (sourceMimeType && !sourceMimeType.startsWith("image/")) {
        throw new Error(`Unexpected content type ${sourceMimeType}`);
      }

      const bytes = Buffer.from(await response.arrayBuffer());
      const optimized = await optimizeHololiveImage(bytes, target.kind);
      await fs.writeFile(localPath, optimized.bytes);
      await deleteSupersededHololiveImageFiles(context.hololiveImageDirectory, target.slug, target.kind, localFilename);
      cacheEntries.push({
        idolId: target.idolId,
        kind: target.kind,
        sourceUrl: target.sourceUrl,
        localFilename,
        mimeType: optimized.mimeType,
        sizeBytes: optimized.bytes.length
      });
      cached += 1;
    } catch {
      failed += 1;
    }
  }

  const workerCount = Math.min(6, targets.length);
  let nextIndex = 0;
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < targets.length) {
        const target = targets[nextIndex];
        nextIndex += 1;
        await cacheTarget(target);
      }
    })
  );

  context.database.upsertHololiveImageCaches(cacheEntries);

  return { cached, failed };
}

async function hasFreshCachedImage(
  context: IpcContext,
  existingCache: Map<string, { sourceUrl: string; localFilename: string }>,
  target: { idolId: string; slug: string; kind: "icon" | "profile"; sourceUrl: string }
): Promise<boolean> {
  const cache = existingCache.get(`${target.idolId}:${target.kind}`);
  if (!cache || cache.sourceUrl !== target.sourceUrl) {
    return false;
  }

  const safeFileName = path.basename(cache.localFilename);
  if (safeFileName !== cache.localFilename || safeFileName !== getHololiveImageCacheFileName(target.slug, target.kind)) {
    return false;
  }

  try {
    const stats = await fs.stat(path.join(context.hololiveImageDirectory, safeFileName));
    return stats.isFile() && stats.size > 0;
  } catch {
    return false;
  }
}

function getHololiveImageCacheFileName(slug: string, kind: "icon" | "profile"): string {
  return `${slug}-${kind}-v${HOLOLIVE_IMAGE_CACHE_VERSION}.webp`;
}

async function optimizeHololiveImage(
  bytes: Buffer,
  kind: "icon" | "profile"
): Promise<{ bytes: Buffer; mimeType: string }> {
  if (kind === "icon") {
    return {
      bytes: await sharp(bytes, { animated: false, failOn: "none" })
        .rotate()
        .resize({
          width: OPTIMIZED_ICON_SIZE,
          height: OPTIMIZED_ICON_SIZE,
          fit: "cover",
          position: "center"
        })
        .webp({ quality: 84, effort: 4 })
        .toBuffer(),
      mimeType: "image/webp"
    };
  }

  try {
    const subject = await sharp(bytes, { animated: false, failOn: "none" })
      .rotate()
      .ensureAlpha()
      .trim({ background: TRANSPARENT_PIXEL, threshold: PROFILE_ALPHA_THRESHOLD })
      .png()
      .toBuffer();
    const { data, info } = await sharp(subject).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const focus = getProfileAlphaFocusBounds(data, info.width, info.height, info.channels);
    const scaled = await sharp(subject)
      .resize({
        height: PROFILE_SUBJECT_TARGET_HEIGHT,
        fit: "inside",
        withoutEnlargement: false
      })
      .webp({ quality: 90, effort: 4 })
      .toBuffer();
    const scaledMetadata = await sharp(scaled).metadata();
    const scaledWidth = Math.max(1, scaledMetadata.width ?? PROFILE_CANVAS_WIDTH);
    const scaledHeight = Math.max(1, scaledMetadata.height ?? PROFILE_SUBJECT_TARGET_HEIGHT);
    const scale = scaledHeight / info.height;
    const focusCenterX = ((focus.minX + focus.maxX + 1) / 2) * scale;
    let left = Math.round(PROFILE_CANVAS_WIDTH / 2 - focusCenterX);
    let input = scaled;

    if (scaledWidth <= PROFILE_CANVAS_WIDTH) {
      left = Math.round((PROFILE_CANVAS_WIDTH - scaledWidth) / 2);
    } else {
      left = Math.min(0, Math.max(PROFILE_CANVAS_WIDTH - scaledWidth, left));
      const cropLeft = Math.max(0, Math.min(scaledWidth - PROFILE_CANVAS_WIDTH, -left));
      input = await sharp(scaled)
        .extract({
          left: cropLeft,
          top: 0,
          width: PROFILE_CANVAS_WIDTH,
          height: scaledHeight
        })
        .webp({ quality: 90, effort: 4 })
        .toBuffer();
      left = 0;
    }

    return {
      bytes: await sharp({
        create: {
          width: PROFILE_CANVAS_WIDTH,
          height: PROFILE_CANVAS_HEIGHT,
          channels: 4,
          background: TRANSPARENT_PIXEL
        }
      })
        .composite([
          {
            input,
            left,
            top: Math.max(0, PROFILE_CANVAS_HEIGHT - scaledHeight - PROFILE_SUBJECT_BOTTOM_PAD)
          }
        ])
        .webp({ quality: 90, effort: 4 })
        .toBuffer(),
      mimeType: "image/webp"
    };
  } catch {
    return {
      bytes: await sharp(bytes, { animated: false, failOn: "none" })
        .rotate()
        .resize({
          width: PROFILE_CANVAS_WIDTH,
          height: PROFILE_CANVAS_HEIGHT,
          fit: "contain",
          background: TRANSPARENT_PIXEL
        })
        .webp({ quality: 90, effort: 4 })
        .toBuffer(),
      mimeType: "image/webp"
    };
  }
}

function getProfileAlphaFocusBounds(
  data: Buffer,
  width: number,
  height: number,
  channels: number
): { minX: number; maxX: number } {
  const columnWeights = new Float64Array(width);
  let totalWeight = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = data[(y * width + x) * channels + 3];
      if (alpha > PROFILE_ALPHA_THRESHOLD) {
        columnWeights[x] += alpha;
        totalWeight += alpha;
      }
    }
  }

  if (totalWeight <= 0) {
    return { minX: 0, maxX: width - 1 };
  }

  return {
    minX: findWeightedIndex(columnWeights, totalWeight * PROFILE_FOCUS_X_LOW),
    maxX: findWeightedIndex(columnWeights, totalWeight * PROFILE_FOCUS_X_HIGH)
  };
}

function findWeightedIndex(weights: Float64Array, targetWeight: number): number {
  let runningWeight = 0;
  for (let index = 0; index < weights.length; index += 1) {
    runningWeight += weights[index];
    if (runningWeight >= targetWeight) {
      return index;
    }
  }

  return weights.length - 1;
}

async function deleteSupersededHololiveImageFiles(
  imageDirectory: string,
  slug: string,
  kind: "icon" | "profile",
  currentFileName: string
): Promise<void> {
  const prefix = `${slug}-${kind}`;

  try {
    const entries = await fs.readdir(imageDirectory);
    await Promise.all(
      entries
        .filter((entry) => entry !== currentFileName && entry.startsWith(prefix) && entry.endsWith(".webp"))
        .map((entry) => fs.rm(path.join(imageDirectory, entry), { force: true }))
    );
  } catch {
    // Cache cleanup is best-effort; a failed cleanup should never block profile loading.
  }
}

function handle<C extends keyof IpcChannelMap>(
  channel: C,
  listener: (
    event: Electron.IpcMainInvokeEvent,
    payload: IpcChannelMap[C]["request"]
  ) => Promise<IpcChannelMap[C]["response"]> | IpcChannelMap[C]["response"]
): void {
  ipcMain.handle(channel, listener as never);
}
