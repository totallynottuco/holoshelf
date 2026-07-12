import { trackerModules } from "../modules/registry";
import {
  DEFAULT_HOLOLIVE_BOARD_NAME,
  DEFAULT_HOLOLIVE_TIERS,
  HOLOLIVE_DEFAULT_BOARD_ID,
  HOLOLIVE_IDOLS
} from "../modules/hololive/idols";
import type {
  AppBootstrap,
  CatalogItem,
  HolodexChannel,
  HololiveBracket,
  HololiveBracketArchiveSummary,
  HololiveBracketEntry,
  HololiveBracketGenerationStyle,
  HololiveBracketMatch,
  HololiveBracketRound,
  HololiveBracketSize,
  HololiveBracketStatsOverview,
  HololiveBracketSummary,
  HololiveCustomTalentPreview,
  HololiveIdolProfile,
  HololiveMusicLibraryResponse,
  HololiveMusicPlayerData,
  HololiveProfilePlaybackContext,
  HololiveMusicResolvedItem,
  HololiveMusicRow,
  HololiveTierBoard,
  HololiveTierBoardSummary,
  HololiveTierListData,
  SourceHealth
} from "../shared/contracts";
import {
  calculateConfidenceAdjustedExpectedPerformanceScores,
  calculateRobustViewStrengthScores,
  calculateRobustWeightedSuccessRates,
  calculateShrunkBinaryRates,
  calculateShrunkWeightedSignedScores,
  type RobustWeightedRateSample,
  type ShrunkWeightedSignedScoreSample
} from "../shared/bracketStatsMath";
import {
  createDefaultGlicko2Rating,
  getConservativeGlicko2Rating,
  getGlicko2ExpectedScore,
  updateGlicko2RatingPeriod,
  type Glicko2Match,
  type Glicko2Rating
} from "../shared/glicko2";
import { hololiveBracketRoundLabel } from "../shared/hololiveBracketLabels";
import type {
  HololiveUndoKind,
  HoloshelfBridge,
  InstalledUpdateRelease,
  IpcChannel,
  IpcChannelMap,
  UpdateStatus
} from "../shared/ipc";

const now = new Date().toISOString();
const mockSettings: Record<string, string> = {};
let mockUpdateStatus: UpdateStatus = {
  state: "unsupported",
  message: "Updates are available only in the packaged Windows app.",
  isUpdateSupported: false,
  version: null,
  percent: null,
  error: null,
  updatedAt: now
};
let mockInstalledUpdateRelease: InstalledUpdateRelease | null =
  new URLSearchParams(window.location.search).get("updatePreview") === "1"
    ? {
        version: "1.1.7",
        releaseName: "Holoshelf 1.1.7",
        releaseDate: "2026-07-11T18:00:00.000Z",
        releaseNotes:
          "- Official song removals now carry into installed libraries\n- Duplicate and unavailable songs are cleaned up safely\n- Playlists, ratings, brackets, and custom imports remain protected\n- Update notes now appear after installation"
      }
    : null;
const mockHololiveMusicMarkers: Record<string, IpcChannelMap["hololive:music-marker:set"]["response"]> = {};
const mockHololiveMusicExclusions: Record<string, IpcChannelMap["hololive:music:exclude"]["response"]["data"]> = {};
const mockFavoritePositions: Record<string, number> = {};
const MOCK_FAVORITES_PLAYLIST_ID = "system:favorites";
let mockHolodexChannels: HolodexChannel[] = [];
const mockUndoActions = new Map<string, { kind: HololiveUndoKind; apply: () => void }>();

function createMockUndo(kind: HololiveUndoKind, apply: () => void, undoLabel = "Undo"): { undoToken: string; undoLabel: string } {
  const undoToken = `mock-undo-${crypto.randomUUID()}`;
  mockUndoActions.set(undoToken, { kind, apply });
  return { undoToken, undoLabel };
}

const mockHololiveMusicRows: HololiveMusicRow[] = [
  {
    youtubeVideoId: "tokino-sora-mock-original",
    idolId: "tokino-sora",
    title: "Tokino Sora Original Song",
    songName: "Tokino Sora Original Song",
    canonicalSongKey: "tokino-sora-original-song",
    canonicalPerformanceKey: "tokino-sora-original-song|tokino-sora",
    topicId: "Original_Song",
    status: "past",
    youtubeUrl: "https://www.youtube.com/watch?v=mock-original",
    channelId: "UCp6993wxpyDPHUpavwDFqgg",
    channelName: "Tokino Sora Channel",
    uploaderChannelKind: "idol",
    uploaderChannelGroup: null,
    participants: [
      {
        youtubeVideoId: "tokino-sora-mock-original",
        idolId: "tokino-sora",
        idolName: "Tokino Sora",
        role: "primary",
        channelId: "UCp6993wxpyDPHUpavwDFqgg"
      }
    ],
    ownedIdolIds: ["tokino-sora"],
    featuredIdolIds: [],
    publishedAt: now,
    durationSeconds: 210,
    markerKey: "tokino-sora-original-song|tokino-sora",
    marker: null,
    updatedAt: now
  },
  {
    youtubeVideoId: "tokino-sora-mock-original-2",
    idolId: "tokino-sora",
    title: "Tokino Sora Original Song 2",
    songName: "Tokino Sora Original Song 2",
    canonicalSongKey: "tokino-sora-original-song-2",
    canonicalPerformanceKey: "tokino-sora-original-song-2|tokino-sora",
    topicId: "Original_Song",
    status: "past",
    youtubeUrl: "https://www.youtube.com/watch?v=mock-original-2",
    channelId: "UCp6993wxpyDPHUpavwDFqgg",
    channelName: "Tokino Sora Channel",
    uploaderChannelKind: "idol",
    uploaderChannelGroup: null,
    participants: [
      {
        youtubeVideoId: "tokino-sora-mock-original-2",
        idolId: "tokino-sora",
        idolName: "Tokino Sora",
        role: "primary",
        channelId: "UCp6993wxpyDPHUpavwDFqgg"
      }
    ],
    ownedIdolIds: ["tokino-sora"],
    featuredIdolIds: [],
    publishedAt: now,
    durationSeconds: 211,
    markerKey: "tokino-sora-original-song-2|tokino-sora",
    marker: null,
    updatedAt: now
  },
  {
    youtubeVideoId: "tokino-sora-mock-original-3",
    idolId: "tokino-sora",
    title: "Tokino Sora Original Song 3",
    songName: "Tokino Sora Original Song 3",
    canonicalSongKey: "tokino-sora-original-song-3",
    canonicalPerformanceKey: "tokino-sora-original-song-3|tokino-sora",
    topicId: "Original_Song",
    status: "past",
    youtubeUrl: "https://www.youtube.com/watch?v=mock-original-3",
    channelId: "UCp6993wxpyDPHUpavwDFqgg",
    channelName: "Tokino Sora Channel",
    uploaderChannelKind: "idol",
    uploaderChannelGroup: null,
    participants: [
      {
        youtubeVideoId: "tokino-sora-mock-original-3",
        idolId: "tokino-sora",
        idolName: "Tokino Sora",
        role: "primary",
        channelId: "UCp6993wxpyDPHUpavwDFqgg"
      }
    ],
    ownedIdolIds: ["tokino-sora"],
    featuredIdolIds: [],
    publishedAt: now,
    durationSeconds: 212,
    markerKey: "tokino-sora-original-song-3|tokino-sora",
    marker: null,
    updatedAt: now
  },
  {
    youtubeVideoId: "tokino-sora-mock-cover",
    idolId: "tokino-sora",
    title: "Tokino Sora Cover Song",
    songName: "Tokino Sora Cover Song",
    canonicalSongKey: "tokino-sora-cover-song",
    canonicalPerformanceKey: "tokino-sora-cover-song|tokino-sora",
    topicId: "Music_Cover",
    status: "past",
    youtubeUrl: "https://www.youtube.com/watch?v=mock-cover",
    channelId: "UCp6993wxpyDPHUpavwDFqgg",
    channelName: "Tokino Sora Channel",
    uploaderChannelKind: "idol",
    uploaderChannelGroup: null,
    participants: [
      {
        youtubeVideoId: "tokino-sora-mock-cover",
        idolId: "tokino-sora",
        idolName: "Tokino Sora",
        role: "primary",
        channelId: "UCp6993wxpyDPHUpavwDFqgg"
      }
    ],
    ownedIdolIds: ["tokino-sora"],
    featuredIdolIds: [],
    publishedAt: now,
    durationSeconds: 190,
    markerKey: "tokino-sora-cover-song|tokino-sora",
    marker: null,
    updatedAt: now
  },
  {
    youtubeVideoId: "tokino-sora-mock-featured",
    idolId: null,
    title: "Tokino Sora Featured Song",
    songName: "Tokino Sora Featured Song",
    canonicalSongKey: "tokino-sora-featured-song",
    canonicalPerformanceKey: "tokino-sora-featured-song|collab",
    topicId: "Original_Song",
    status: "past",
    youtubeUrl: "https://www.youtube.com/watch?v=mock-featured",
    channelId: "UCJFZiqLMntJufDCHc6bQixg",
    channelName: "hololive",
    uploaderChannelKind: "group",
    uploaderChannelGroup: "hololive",
    participants: [
      {
        youtubeVideoId: "tokino-sora-mock-featured",
        idolId: "tokino-sora",
        idolName: "Tokino Sora",
        role: "collab",
        channelId: "UCp6993wxpyDPHUpavwDFqgg"
      }
    ],
    ownedIdolIds: [],
    featuredIdolIds: ["tokino-sora"],
    publishedAt: now,
    durationSeconds: 220,
    markerKey: "tokino-sora-featured-song|collab",
    marker: null,
    updatedAt: now
  }
];

let mockHololivePlayerData: HololiveMusicPlayerData = {
  playlists: [],
  queue: [],
  state: {
    playbackSourceType: "library",
    currentQueueItemId: null,
    currentPlaylistId: null,
    currentPlaylistItemId: null,
    currentYoutubeVideoId: null,
    repeatMode: "off",
    shuffleEnabled: false,
    autoplayEnabled: true,
    updatedAt: now
  }
};

const MOCK_BRACKET_SIZE_COUNTS: Record<HololiveBracketSize, number> = {
  RO16: 16,
  RO32: 32,
  RO64: 64,
  RO128: 128,
  RO256: 256
};
const mockHololiveBrackets = new Map<string, HololiveBracket>();
const mockHololiveBracketArchives = new Map<string, HololiveBracket>();

const mockBootstrap: AppBootstrap = {
  appName: "Holoshelf",
  dataDirectory: "data",
  databasePath: "data\\holoshelf.sqlite",
  backupDirectory: "data\\backups",
  dataLocationKind: "dev",
  modules: trackerModules,
  sourceHealth: trackerModules.flatMap((module) =>
    module.sourceAdapters.map<SourceHealth>((source) => ({
      sourceId: source.id,
      status: "unknown",
      checkedAt: now,
      httpStatus: null,
      message: "Waiting for Electron IPC"
    }))
  ),
  stats: {
    catalogItems: 0,
    trackedEntries: 0,
    fetchJobsQueued: 0,
    coversCached: 0
  }
};

function createMockBoard(id: string, name: string, idols = HOLOLIVE_IDOLS): HololiveTierBoard {
  return {
    id,
    name,
    tileSize: 64,
    createdAt: now,
    updatedAt: now,
    tiers: DEFAULT_HOLOLIVE_TIERS.map((tier) => ({
      ...tier,
      id: id === HOLOLIVE_DEFAULT_BOARD_ID ? tier.id : `${id}-${tier.id}`,
      boardId: id
    })),
    placements: idols.map((idol) => ({
      boardId: id,
      idolId: idol.id,
      tierId: null,
      position: idol.sortOrder,
      updatedAt: now
    }))
  };
}

let mockHololiveTierData: HololiveTierListData = {
  idols: HOLOLIVE_IDOLS,
  boards: [
    {
      id: HOLOLIVE_DEFAULT_BOARD_ID,
      name: DEFAULT_HOLOLIVE_BOARD_NAME,
      tileSize: 64,
      rankedCount: 0,
      totalCount: HOLOLIVE_IDOLS.length,
      updatedAt: now
    }
  ],
  activeBoard: createMockBoard(HOLOLIVE_DEFAULT_BOARD_ID, DEFAULT_HOLOLIVE_BOARD_NAME)
};

const mockHololiveBoards = new Map([[HOLOLIVE_DEFAULT_BOARD_ID, mockHololiveTierData.activeBoard]]);
const mockHololiveBoardOrder = [HOLOLIVE_DEFAULT_BOARD_ID];

function summarizeMockBoard(board: HololiveTierBoard): HololiveTierBoardSummary {
  return {
    id: board.id,
    name: board.name,
    tileSize: board.tileSize,
    rankedCount: board.placements.filter((placement) => placement.tierId !== null).length,
    totalCount: board.placements.length,
    updatedAt: board.updatedAt
  };
}

function refreshMockBoardSummary(): void {
  mockHololiveBoards.set(mockHololiveTierData.activeBoard.id, mockHololiveTierData.activeBoard);
  const orderedBoards = mockHololiveBoardOrder
    .map((boardId) => mockHololiveBoards.get(boardId))
    .filter((board): board is HololiveTierBoard => Boolean(board));
  const missingBoards = [...mockHololiveBoards.values()].filter((board) => !mockHololiveBoardOrder.includes(board.id));
  const boards = [...orderedBoards, ...missingBoards];
  mockHololiveTierData = {
    ...mockHololiveTierData,
    boards: boards.map(summarizeMockBoard),
    activeBoard: {
      ...mockHololiveTierData.activeBoard,
      updatedAt: now
    }
  };
  mockHololiveBoards.set(mockHololiveTierData.activeBoard.id, mockHololiveTierData.activeBoard);
}

function resolveMockCustomTalentPreview(input: IpcChannelMap["hololive:custom-talents:resolve"]["request"]): HololiveCustomTalentPreview {
  const channelInput = input.channelInput.trim();
  const lowerInput = channelInput.toLowerCase();
  const isTyra =
    lowerInput.includes("soradukityra") ||
    lowerInput.includes("ucdqycuyffhzoz0kowuig0lq") ||
    lowerInput.includes("%e5%ae%99%e6%9c%88%e3%83%86%e3%82%a3%e3%83%a9");
  const channelId = isTyra ? "UCdQYcUyffHZoz0KOwuiG0lQ" : channelInput.match(/UC[a-zA-Z0-9_-]{20,}/)?.[0] ?? "UCdQYcUyffHZoz0KOwuiG0lQ";
  const displayName = input.displayName?.trim() || (isTyra ? "Soraduki Tyra" : "Custom Talent");
  const slug = displayName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "custom-talent";

  return {
    channelId,
    displayName,
    nativeName: isTyra ? "宙月ティラ" : null,
    slug,
    branch: isTyra ? "Independents" : "Custom",
    generation: "Custom",
    officialUrl: `https://www.youtube.com/channel/${channelId}`,
    iconUrl: "https://yt3.googleusercontent.com/ytc/AIdro_mock_custom_talent=s176-c-k-c0x00ffffff-no-rj",
    profileImageUrl: "https://yt3.googleusercontent.com/ytc/AIdro_mock_custom_talent=s512-c-k-c0x00ffffff-no-rj",
    youtubeChannelUrl: `https://www.youtube.com/channel/${channelId}`,
    xHandle: isTyra ? "@SoradukiTyra" : null,
    xUrl: isTyra ? "https://twitter.com/SoradukiTyra" : null,
    subscriberCount: 42100,
    videoCount: 188,
    clipCount: 91,
    originalSongsUrl: input.originalSongsUrl ?? null,
    coversUrl: input.coversUrl ?? null
  };
}

function upsertMockCustomTalent(input: IpcChannelMap["hololive:custom-talents:upsert"]["request"]): IpcChannelMap["hololive:custom-talents:upsert"]["response"] {
  const preview = resolveMockCustomTalentPreview(input);
  const existingByChannel = mockHololiveTierData.idols.find((idol) => idol.youtubeChannelId === preview.channelId);
  const id = existingByChannel?.id ?? `custom-${preview.slug}`;
  const sortOrder =
    existingByChannel?.sortOrder ??
    Math.max(...mockHololiveTierData.idols.map((idol) => idol.sortOrder), HOLOLIVE_IDOLS.length - 1) + 1;
  const idol = {
    id,
    slug: preview.slug,
    displayName: preview.displayName,
    branch: preview.branch,
    generation: preview.generation,
    status: "active" as const,
    source: "custom" as const,
    officialUrl: preview.officialUrl,
    iconUrl: preview.iconUrl,
    profileImageUrl: preview.profileImageUrl,
    youtubeChannelUrl: preview.youtubeChannelUrl,
    youtubeChannelId: preview.channelId,
    xHandle: preview.xHandle ?? null,
    xUrl: preview.xUrl ?? null,
    sortOrder
  };
  const channel: HolodexChannel = {
    id: preview.channelId,
    name: preview.nativeName ?? preview.displayName,
    englishName: preview.displayName,
    type: "vtuber",
    org: preview.branch,
    group: preview.generation,
    photoUrl: preview.iconUrl,
    twitter: preview.xHandle?.replace(/^@/, "") ?? null,
    videoCount: preview.videoCount ?? null,
    subscriberCount: preview.subscriberCount ?? null,
    clipCount: preview.clipCount ?? null,
    publishedAt: null,
    inactive: false,
    kind: "idol",
    mainIdolIds: [idol.id],
    topicIdolIds: [],
    linkedIdolIds: [idol.id],
    updatedAt: new Date().toISOString()
  };

  mockHololiveTierData = {
    ...mockHololiveTierData,
    idols: [
      ...mockHololiveTierData.idols.filter((candidate) => candidate.id !== idol.id && candidate.youtubeChannelId !== idol.youtubeChannelId),
      idol
    ].sort((left, right) => left.sortOrder - right.sortOrder)
  };
  mockHolodexChannels = [
    ...mockHolodexChannels.filter((candidate) => candidate.id !== channel.id),
    channel
  ];
  for (const [boardId, board] of mockHololiveBoards.entries()) {
    if (board.placements.some((placement) => placement.idolId === idol.id)) {
      continue;
    }
    mockHololiveBoards.set(boardId, {
      ...board,
      placements: [
        ...board.placements,
        {
          boardId,
          idolId: idol.id,
          tierId: null,
          position: sortOrder,
          updatedAt: new Date().toISOString()
        }
      ]
    });
  }
  const updatedActiveBoard = mockHololiveBoards.get(mockHololiveTierData.activeBoard.id);
  if (updatedActiveBoard) {
    mockHololiveTierData = {
      ...mockHololiveTierData,
      activeBoard: updatedActiveBoard
    };
  }
  mockHololiveMusicRows.splice(
    0,
    mockHololiveMusicRows.length,
    ...mockHololiveMusicRows.filter((row) => row.channelId !== preview.channelId)
  );
  mockHololiveMusicRows.push(
    {
      youtubeVideoId: `${idol.id}-mock-original`,
      idolId: idol.id,
      title: `${idol.displayName} Original Song`,
      songName: `${idol.displayName} Original Song`,
      canonicalSongKey: `${idol.id}-mock-original`,
      canonicalPerformanceKey: `${idol.id}-mock-original|${idol.id}`,
      topicId: "Original_Song",
      status: "past",
      youtubeUrl: `https://www.youtube.com/watch?v=${idol.id}-mock-original`,
      channelId: preview.channelId,
      channelName: `${idol.displayName} Channel`,
      uploaderChannelKind: "idol",
      uploaderChannelGroup: preview.branch,
      participants: [
        {
          youtubeVideoId: `${idol.id}-mock-original`,
          idolId: idol.id,
          idolName: idol.displayName,
          role: "primary",
          channelId: preview.channelId
        }
      ],
      ownedIdolIds: [idol.id],
      featuredIdolIds: [],
      publishedAt: now,
      durationSeconds: 203,
      markerKey: `${idol.id}-mock-original|${idol.id}`,
      marker: null,
      sourceKind: "user",
      updatedAt: now
    },
    {
      youtubeVideoId: `${idol.id}-mock-cover`,
      idolId: idol.id,
      title: `${idol.displayName} Cover Song`,
      songName: `${idol.displayName} Cover Song`,
      canonicalSongKey: `${idol.id}-mock-cover`,
      canonicalPerformanceKey: `${idol.id}-mock-cover|${idol.id}`,
      topicId: "Music_Cover",
      status: "past",
      youtubeUrl: `https://www.youtube.com/watch?v=${idol.id}-mock-cover`,
      channelId: preview.channelId,
      channelName: `${idol.displayName} Channel`,
      uploaderChannelKind: "idol",
      uploaderChannelGroup: preview.branch,
      participants: [
        {
          youtubeVideoId: `${idol.id}-mock-cover`,
          idolId: idol.id,
          idolName: idol.displayName,
          role: "primary",
          channelId: preview.channelId
        }
      ],
      ownedIdolIds: [idol.id],
      featuredIdolIds: [],
      publishedAt: now,
      durationSeconds: 184,
      markerKey: `${idol.id}-mock-cover|${idol.id}`,
      marker: null,
      sourceKind: "user",
      updatedAt: now
    }
  );
  refreshMockBoardSummary();
  return { idol, channel };
}

function deleteMockCustomTalent(idolId: string): void {
  const idol = mockHololiveTierData.idols.find((candidate) => candidate.id === idolId);
  if (!idol || idol.source !== "custom") {
    throw new Error("Only custom talents can be removed.");
  }
  mockHololiveTierData = {
    ...mockHololiveTierData,
    idols: mockHololiveTierData.idols.filter((candidate) => candidate.id !== idolId)
  };
  mockHolodexChannels = mockHolodexChannels.filter((channel) => !channel.linkedIdolIds.includes(idolId));
  mockHololiveMusicRows.splice(
    0,
    mockHololiveMusicRows.length,
    ...mockHololiveMusicRows.filter((row) => row.channelId !== idol.youtubeChannelId)
  );
  for (const [boardId, board] of mockHololiveBoards.entries()) {
    mockHololiveBoards.set(boardId, {
      ...board,
      placements: board.placements.filter((placement) => placement.idolId !== idolId)
    });
  }
  refreshMockBoardSummary();
}

function parseMockYouTubeVideoId(input: string): string | null {
  const trimmed = input.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    return trimmed;
  }
  try {
    const url = new URL(trimmed);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (host === "youtu.be") {
      const id = url.pathname.split("/").filter(Boolean)[0] ?? "";
      return /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
    }
    if (host.endsWith("youtube.com") || host.endsWith("youtube-nocookie.com")) {
      const watchId = url.searchParams.get("v") ?? "";
      if (/^[a-zA-Z0-9_-]{11}$/.test(watchId)) {
        return watchId;
      }
      const parts = url.pathname.split("/").filter(Boolean);
      const markerIndex = parts.findIndex((part) => ["shorts", "embed", "live"].includes(part));
      const id = markerIndex >= 0 ? parts[markerIndex + 1] ?? "" : "";
      return /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
    }
  } catch {
    return null;
  }
  return null;
}

function mockYouTubeUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

function toMockDateInputValue(value?: string | null): string | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    return null;
  }
  if (/^\d{4}-\d{2}-\d{2}$/u.test(trimmed)) {
    return trimmed;
  }
  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function normalizeMockCustomSongPublishedAt(value?: string | null): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    throw new Error("A published date is required.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(trimmed)) {
    throw new Error("Use YYYY-MM-DD for the published date.");
  }
  const date = new Date(`${trimmed}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || !date.toISOString().startsWith(trimmed)) {
    throw new Error("Use YYYY-MM-DD for the published date.");
  }
  return date.toISOString();
}

function upsertMockCustomSong(input: IpcChannelMap["hololive:custom-songs:upsert"]["request"]): HololiveMusicRow {
  const youtubeVideoId = parseMockYouTubeVideoId(input.youtubeUrl);
  if (!youtubeVideoId) {
    throw new Error("Enter a valid YouTube video link.");
  }
  const title = input.title.trim();
  if (!title) {
    throw new Error("A song title is required.");
  }
  const ownerIdolIds = [...new Set(input.ownerIdolIds.map((id) => id.trim()).filter(Boolean))];
  if (ownerIdolIds.length === 0) {
    throw new Error("Choose at least one owner talent.");
  }
  const ownerIdols = ownerIdolIds.map((id) => mockHololiveTierData.idols.find((idol) => idol.id === id)).filter(Boolean);
  if (ownerIdols.length === 0) {
    throw new Error("Choose at least one owner talent.");
  }
  const ownerSet = new Set(ownerIdolIds);
  const featuredIdolIds = [...new Set((input.featuredIdolIds ?? []).map((id) => id.trim()).filter(Boolean))]
    .filter((id) => !ownerSet.has(id));
  const featuredIdols = featuredIdolIds.map((id) => mockHololiveTierData.idols.find((idol) => idol.id === id)).filter(Boolean);
  const primaryOwner = ownerIdols[0]!;
  const existing = mockHololiveMusicRows.find((row) => row.youtubeVideoId === youtubeVideoId);
  if (existing && existing.sourceKind !== "user") {
    throw new Error("That YouTube video is already in the official Hololive music library.");
  }
  const usedApi = /prefill|api/i.test(input.youtubeUrl);
  const songName = input.songName?.trim() || title;
  const youtubeUrl = mockYouTubeUrl(youtubeVideoId);
  const channelId = input.channelId?.trim() || (usedApi ? "UCmockImportedSong" : "") || primaryOwner.youtubeChannelId || `custom:${primaryOwner.id}`;
  const channelName = input.channelName?.trim() || (usedApi ? "Mock Import Channel" : "") || primaryOwner.displayName;
  const publishedAt = normalizeMockCustomSongPublishedAt(input.publishedAt || (usedApi ? toMockDateInputValue(now) : null));
  const row: HololiveMusicRow = {
    youtubeVideoId,
    idolId: primaryOwner.id,
    title,
    songName,
    canonicalSongKey: songName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || youtubeVideoId,
    canonicalPerformanceKey: `${input.topicId}:${youtubeVideoId}:${ownerIdolIds.join("+")}`,
    topicId: input.topicId,
    status: "past",
    youtubeUrl,
    channelId,
    channelName,
    uploaderChannelKind: "unknown",
    uploaderChannelGroup: null,
    participants: [
      ...ownerIdols.map((idol) => ({
        youtubeVideoId,
        idolId: idol!.id,
        idolName: idol!.displayName,
        role: "primary" as const,
        channelId: idol!.youtubeChannelId ?? null
      })),
      ...featuredIdols.map((idol) => ({
        youtubeVideoId,
        idolId: idol!.id,
        idolName: idol!.displayName,
        role: "collab" as const,
        channelId: idol!.youtubeChannelId ?? null
      }))
    ],
    ownedIdolIds: ownerIdolIds,
    featuredIdolIds,
    publishedAt,
    durationSeconds: input.durationSeconds ?? null,
    viewCount: input.viewCount ?? null,
    viewCountFetchedAt: input.fetchedAt ?? null,
    markerKey: `video:${youtubeVideoId}`,
    marker: mockHololiveMusicMarkers[youtubeVideoId]?.marker ?? null,
    sourceKind: "user",
    updatedAt: new Date().toISOString()
  };
  const index = mockHololiveMusicRows.findIndex((candidate) => candidate.youtubeVideoId === youtubeVideoId);
  if (index >= 0) {
    mockHololiveMusicRows[index] = row;
  } else {
    mockHololiveMusicRows.push(row);
  }
  return row;
}

function deleteMockCustomSong(youtubeVideoId: string): IpcChannelMap["hololive:custom-songs:delete"]["response"] {
  const row = mockHololiveMusicRows.find((candidate) => candidate.youtubeVideoId === youtubeVideoId);
  if (!row || row.sourceKind !== "user") {
    throw new Error("Only custom songs can be deleted.");
  }
  const rowsSnapshot = structuredClone(mockHololiveMusicRows);
  const markersSnapshot = structuredClone(mockHololiveMusicMarkers);
  const playerSnapshot = structuredClone(mockHololivePlayerData);
  mockHololiveMusicRows.splice(
    0,
    mockHololiveMusicRows.length,
    ...mockHololiveMusicRows.filter((candidate) => candidate.youtubeVideoId !== youtubeVideoId)
  );
  delete mockHololiveMusicMarkers[youtubeVideoId];
  mockHololivePlayerData = {
    ...mockHololivePlayerData,
    queue: mockHololivePlayerData.queue.filter((item) => item.youtubeVideoId !== youtubeVideoId),
    playlists: mockHololivePlayerData.playlists.map((playlist) => ({
      ...playlist,
      items: (playlist.items ?? []).filter((item) => item.youtubeVideoId !== youtubeVideoId)
    })),
    state:
      mockHololivePlayerData.state.currentYoutubeVideoId === youtubeVideoId
        ? {
            ...mockHololivePlayerData.state,
            playbackSourceType: "library",
            currentQueueItemId: null,
            currentPlaylistId: null,
            currentPlaylistItemId: null,
            currentYoutubeVideoId: null,
            updatedAt: new Date().toISOString()
          }
        : mockHololivePlayerData.state
  };
  return {
    data: refreshMockHololivePlayerData(),
    ...createMockUndo("custom-song-delete", () => {
      mockHololiveMusicRows.splice(0, mockHololiveMusicRows.length, ...rowsSnapshot);
      Object.keys(mockHololiveMusicMarkers).forEach((key) => delete mockHololiveMusicMarkers[key]);
      Object.assign(mockHololiveMusicMarkers, markersSnapshot);
      mockHololivePlayerData = playerSnapshot;
    }, "Restore custom song")
  };
}

function loadMockHololiveBoard(boardId?: string | null): void {
  const nextBoard = (boardId ? mockHololiveBoards.get(boardId) : null) ?? mockHololiveTierData.activeBoard;
  mockHololiveTierData = {
    ...mockHololiveTierData,
    activeBoard: nextBoard
  };
  refreshMockBoardSummary();
}

function createMockHololiveBoard(payload: IpcChannelMap["hololive:board:create"]["request"]): void {
  const boardId = `mock-board-${mockHololiveBoards.size + 1}`;
  const board = createMockBoard(boardId, payload.name.trim() || DEFAULT_HOLOLIVE_BOARD_NAME, mockHololiveTierData.idols);
  const afterIndex = payload.afterBoardId ? mockHololiveBoardOrder.indexOf(payload.afterBoardId) : -1;
  const insertIndex = afterIndex >= 0 ? afterIndex + 1 : mockHololiveBoardOrder.length;

  mockHololiveBoards.set(boardId, board);
  mockHololiveBoardOrder.splice(insertIndex, 0, boardId);
  mockHololiveTierData = {
    ...mockHololiveTierData,
    activeBoard: board
  };
  refreshMockBoardSummary();
}

function deleteMockHololiveBoard(boardId: string): void {
  if (mockHololiveBoards.size <= 1) {
    return;
  }

  mockHololiveBoards.delete(boardId);
  const orderIndex = mockHololiveBoardOrder.indexOf(boardId);
  if (orderIndex >= 0) {
    mockHololiveBoardOrder.splice(orderIndex, 1);
  }

  mockHololiveTierData = {
    ...mockHololiveTierData,
    activeBoard: mockHololiveBoards.get(mockHololiveBoardOrder[0]) ?? [...mockHololiveBoards.values()][0]
  };
  refreshMockBoardSummary();
}

function updateMockHololiveBoard(payload: IpcChannelMap["hololive:board:update"]["request"]): void {
  const board = mockHololiveBoards.get(payload.boardId);
  if (!board) {
    return;
  }

  const updatedAt = new Date().toISOString();
  const updatedBoard = {
    ...board,
    name: payload.name?.trim() || board.name,
    tileSize: payload.tileSize ?? board.tileSize,
    updatedAt
  };

  mockHololiveBoards.set(payload.boardId, updatedBoard);
  if (mockHololiveTierData.activeBoard.id === payload.boardId) {
    mockHololiveTierData = {
      ...mockHololiveTierData,
      activeBoard: updatedBoard
    };
  }

  refreshMockBoardSummary();
}

function reorderMockHololiveBoards(payload: IpcChannelMap["hololive:board:reorder"]["request"]): void {
  const existingIds = new Set(mockHololiveBoardOrder);
  const orderedIds = payload.boardIds.filter((boardId) => existingIds.has(boardId));
  const missingIds = mockHololiveBoardOrder.filter((boardId) => !orderedIds.includes(boardId));

  mockHololiveBoardOrder.splice(0, mockHololiveBoardOrder.length, ...orderedIds, ...missingIds);
  const activeBoard = payload.activeBoardId ? mockHololiveBoards.get(payload.activeBoardId) : null;
  if (activeBoard) {
    mockHololiveTierData = {
      ...mockHololiveTierData,
      activeBoard
    };
  }

  refreshMockBoardSummary();
}

function createMockHololiveTier(payload: IpcChannelMap["hololive:tier:create"]["request"]): void {
  const existing = [...mockHololiveTierData.activeBoard.tiers].sort((left, right) => left.position - right.position);
  const position =
    payload.position === undefined ? existing.length : Math.min(Math.max(Math.round(payload.position), 0), existing.length);
  const shifted = existing.map((tier) =>
    tier.position >= position ? { ...tier, position: tier.position + 1 } : tier
  );
  const tier = {
    id: `mock-tier-${crypto.randomUUID()}`,
    boardId: mockHololiveTierData.activeBoard.id,
    label: payload.label?.trim() || `Tier ${existing.length + 1}`,
    color: payload.color ?? "#82dfff",
    position,
    collapsed: false
  };

  mockHololiveTierData = {
    ...mockHololiveTierData,
    activeBoard: {
      ...mockHololiveTierData.activeBoard,
      tiers: [...shifted, tier].sort((left, right) => left.position - right.position),
      updatedAt: now
    }
  };
  refreshMockBoardSummary();
}

function updateMockHololiveTier(payload: IpcChannelMap["hololive:tier:update"]["request"]): void {
  mockHololiveTierData = {
    ...mockHololiveTierData,
    activeBoard: {
      ...mockHololiveTierData.activeBoard,
      tiers: mockHololiveTierData.activeBoard.tiers.map((tier) =>
        tier.id === payload.tierId && tier.boardId === payload.boardId
          ? {
              ...tier,
              label: payload.label?.trim() || tier.label,
              color: payload.color ?? tier.color,
              collapsed: payload.collapsed ?? tier.collapsed
            }
          : tier
      ),
      updatedAt: now
    }
  };
  refreshMockBoardSummary();
}

function sortedMockIdsForTier(tierId: string | null): string[] {
  return mockHololiveTierData.activeBoard.placements
    .filter((placement) => placement.tierId === tierId)
    .sort((left, right) => left.position - right.position)
    .map((placement) => placement.idolId);
}

function updateMockPlacementGroup(tierId: string | null, idolIds: string[]): void {
  const positions = new Map(idolIds.map((idolId, index) => [idolId, index]));
  mockHololiveTierData = {
    ...mockHololiveTierData,
    activeBoard: {
      ...mockHololiveTierData.activeBoard,
      placements: mockHololiveTierData.activeBoard.placements.map((placement) =>
        positions.has(placement.idolId)
          ? {
              ...placement,
              tierId,
              position: positions.get(placement.idolId) ?? placement.position,
              updatedAt: now
            }
          : placement
      )
    }
  };
}

function moveMockHololiveIdol(payload: IpcChannelMap["hololive:placement:move"]["request"]): void {
  const current = mockHololiveTierData.activeBoard.placements.find((placement) => placement.idolId === payload.idolId);
  const sourceTierId = current?.tierId ?? null;
  const destinationTierId = payload.tierId ?? null;
  const sameGroup = sourceTierId === destinationTierId;
  const sourceIds = sortedMockIdsForTier(sourceTierId).filter((idolId) => idolId !== payload.idolId);
  const destinationIds = sameGroup
    ? [...sourceIds]
    : sortedMockIdsForTier(destinationTierId).filter((idolId) => idolId !== payload.idolId);
  const insertionIndex = Math.min(Math.max(payload.index, 0), destinationIds.length);

  destinationIds.splice(insertionIndex, 0, payload.idolId);
  updateMockPlacementGroup(destinationTierId, destinationIds);

  if (!sameGroup) {
    updateMockPlacementGroup(sourceTierId, sourceIds);
  }

  refreshMockBoardSummary();
}

function deleteMockHololiveTier(payload: IpcChannelMap["hololive:tier:delete"]["request"]): void {
  const unrankedIds = sortedMockIdsForTier(null);
  const deletedTierIds = sortedMockIdsForTier(payload.tierId);
  const tiers = mockHololiveTierData.activeBoard.tiers
    .filter((tier) => !(tier.id === payload.tierId && tier.boardId === payload.boardId))
    .sort((left, right) => left.position - right.position)
    .map((tier, position) => ({ ...tier, position }));

  updateMockPlacementGroup(null, [...unrankedIds, ...deletedTierIds]);
  mockHololiveTierData = {
    ...mockHololiveTierData,
    activeBoard: {
      ...mockHololiveTierData.activeBoard,
      tiers,
      updatedAt: now
    }
  };
  refreshMockBoardSummary();
}

function clearMockHololiveBoard(): void {
  const idolIds = [...mockHololiveTierData.idols]
    .sort((left, right) => left.sortOrder - right.sortOrder || left.displayName.localeCompare(right.displayName))
    .map((idol) => idol.id);
  updateMockPlacementGroup(null, idolIds);
  refreshMockBoardSummary();
}

function sortMockHololiveUnranked(): void {
  const rankedIds = new Set(
    mockHololiveTierData.activeBoard.placements
      .filter((placement) => placement.tierId !== null)
      .map((placement) => placement.idolId)
  );
  const idolIds = [...mockHololiveTierData.idols]
    .filter((idol) => !rankedIds.has(idol.id))
    .sort((left, right) => left.sortOrder - right.sortOrder || left.displayName.localeCompare(right.displayName))
    .map((idol) => idol.id);
  updateMockPlacementGroup(null, idolIds);
  refreshMockBoardSummary();
}

function reorderMockHololiveTiers(payload: IpcChannelMap["hololive:tier:reorder"]["request"]): void {
  const positions = new Map(payload.tierIds.map((tierId, index) => [tierId, index]));
  mockHololiveTierData = {
    ...mockHololiveTierData,
    activeBoard: {
      ...mockHololiveTierData.activeBoard,
      tiers: mockHololiveTierData.activeBoard.tiers
        .map((tier) => ({
          ...tier,
          position: positions.get(tier.id) ?? tier.position,
          updatedAt: now
        }))
        .sort((left, right) => left.position - right.position)
    }
  };
  refreshMockBoardSummary();
}

function visibleMockHololiveMusicRows(): HololiveMusicRow[] {
  return mockHololiveMusicRows
    .filter((row) => !mockHololiveMusicExclusions[row.youtubeVideoId])
    .map((row) => ({
      ...row,
      marker: mockHololiveMusicMarkers[row.youtubeVideoId]?.marker ?? mockHololiveMusicMarkers[row.markerKey]?.marker ?? null
    }));
}

function getMockHololiveMusicRow(videoId: string): HololiveMusicRow {
  const row = visibleMockHololiveMusicRows().find((candidate) => candidate.youtubeVideoId === videoId);
  if (!row) {
    throw new Error(`Unknown mock Hololive music video: ${videoId}`);
  }
  return row;
}

function resolveMockHololivePlayerItems(
  items: Array<Omit<HololiveMusicResolvedItem, "available" | "music">>
): HololiveMusicResolvedItem[] {
  const rowsById = new Map(visibleMockHololiveMusicRows().map((row) => [row.youtubeVideoId, row]));
  return items.map((item) => {
    const music = rowsById.get(item.youtubeVideoId) ?? null;
    return {
      ...item,
      available: Boolean(music),
      music
    };
  });
}

function resolveMockHololiveCurrentItem(): HololiveMusicResolvedItem | null {
  const state = mockHololivePlayerData.state;
  if (state.playbackSourceType === "queue") {
    return state.currentQueueItemId
      ? mockHololivePlayerData.queue.find((item) => item.id === state.currentQueueItemId) ?? null
      : null;
  }

  if (state.playbackSourceType === "playlist") {
    const playlist = state.currentPlaylistId
      ? mockHololivePlayerData.playlists.find((candidate) => candidate.id === state.currentPlaylistId)
      : null;
    return state.currentPlaylistItemId
      ? playlist?.items?.find((item) => item.id === state.currentPlaylistItemId) ?? null
      : null;
  }

  if (!state.currentYoutubeVideoId) {
    return null;
  }
  const row = visibleMockHololiveMusicRows().find((candidate) => candidate.youtubeVideoId === state.currentYoutubeVideoId);
  return row
    ? {
        id: `library:${row.youtubeVideoId}`,
        youtubeVideoId: row.youtubeVideoId,
        position: 0,
        titleSnapshot: row.songName || row.title,
        sourceUrlSnapshot: row.youtubeUrl,
        addedAt: row.updatedAt,
        available: true,
        music: row
      }
    : null;
}

function refreshMockHololivePlayerData(): HololiveMusicPlayerData {
  const favoriteRows = visibleMockHololiveMusicRows()
    .filter((row) => row.marker === "favorite")
    .sort((left, right) => {
      const leftPosition = mockFavoritePositions[left.youtubeVideoId];
      const rightPosition = mockFavoritePositions[right.youtubeVideoId];
      if (leftPosition !== undefined || rightPosition !== undefined) {
        return (leftPosition ?? Number.MAX_SAFE_INTEGER) - (rightPosition ?? Number.MAX_SAFE_INTEGER);
      }
      const leftUpdated = mockHololiveMusicMarkers[left.youtubeVideoId]?.updatedAt ?? mockHololiveMusicMarkers[left.markerKey]?.updatedAt ?? now;
      const rightUpdated = mockHololiveMusicMarkers[right.youtubeVideoId]?.updatedAt ?? mockHololiveMusicMarkers[right.markerKey]?.updatedAt ?? now;
      return rightUpdated.localeCompare(leftUpdated) || left.title.localeCompare(right.title);
    });
  const favoriteItems = favoriteRows.map<HololiveMusicResolvedItem>((row, position) => ({
    id: `${MOCK_FAVORITES_PLAYLIST_ID}:${row.youtubeVideoId}`,
    youtubeVideoId: row.youtubeVideoId,
    position,
    titleSnapshot: row.songName || row.title,
    sourceUrlSnapshot: row.youtubeUrl,
    addedAt: mockHololiveMusicMarkers[row.youtubeVideoId]?.updatedAt ?? mockHololiveMusicMarkers[row.markerKey]?.updatedAt ?? now,
    available: true,
    music: row
  }));
  const favoritesPlaylist = {
    id: MOCK_FAVORITES_PLAYLIST_ID,
    name: "Favorites",
    position: -1,
    itemCount: favoriteItems.length,
    systemId: "favorites" as const,
    createdAt: favoriteItems[0]?.addedAt ?? now,
    updatedAt: favoriteItems[0]?.addedAt ?? now,
    items: favoriteItems
  };
  const userPlaylists = mockHololivePlayerData.playlists.filter((playlist) => playlist.systemId !== "favorites");
  mockHololivePlayerData = {
    ...mockHololivePlayerData,
    playlists: [
      favoritesPlaylist,
      ...userPlaylists
      .map((playlist, position) => ({
        ...playlist,
        position,
        itemCount: playlist.items?.length ?? 0,
        systemId: playlist.systemId ?? null,
        items: resolveMockHololivePlayerItems(playlist.items ?? [])
      }))
      .sort((left, right) => left.position - right.position)
    ],
    queue: resolveMockHololivePlayerItems(mockHololivePlayerData.queue).sort((left, right) => left.position - right.position)
  };
  mockHololivePlayerData.currentItem = resolveMockHololiveCurrentItem();
  return mockHololivePlayerData;
}

function createMockHololivePlayerItem(videoId: string, position: number): HololiveMusicResolvedItem {
  const row = getMockHololiveMusicRow(videoId);
  return {
    id: `mock-player-item-${crypto.randomUUID()}`,
    youtubeVideoId: row.youtubeVideoId,
    position,
    titleSnapshot: row.songName || row.title,
    sourceUrlSnapshot: row.youtubeUrl,
    addedAt: new Date().toISOString(),
    available: true,
    music: row
  };
}

function mockQueueAdd(payload: IpcChannelMap["hololive:player:queue:add"]["request"]): HololiveMusicPlayerData {
  const state = mockHololivePlayerData.state;
  const currentIndex = state.currentQueueItemId
    ? mockHololivePlayerData.queue.findIndex((item) => item.id === state.currentQueueItemId)
    : -1;
  const insertIndex =
    payload.placement === "now"
      ? Math.max(currentIndex, 0)
      : payload.placement === "next" && currentIndex >= 0
        ? currentIndex + 1
        : mockHololivePlayerData.queue.length;
  const item = createMockHololivePlayerItem(payload.youtubeVideoId, insertIndex);
  const queue = [...mockHololivePlayerData.queue];
  queue.splice(insertIndex, 0, item);
  mockHololivePlayerData = {
    ...mockHololivePlayerData,
    queue: queue.map((entry, position) => ({ ...entry, position })),
    state:
      payload.placement === "now"
        ? {
            ...state,
            playbackSourceType: "queue",
            currentQueueItemId: item.id,
            currentPlaylistId: null,
            currentPlaylistItemId: null,
            currentYoutubeVideoId: item.youtubeVideoId,
            updatedAt: new Date().toISOString()
          }
        : state
  };
  return refreshMockHololivePlayerData();
}

function mockQueueBulkAdd(payload: IpcChannelMap["hololive:player:queue:bulk-add"]["request"]): HololiveMusicPlayerData {
  const videoIds = payload.youtubeVideoIds.map((videoId) => videoId.trim()).filter(Boolean);
  if (videoIds.length === 0) {
    return refreshMockHololivePlayerData();
  }

  const state = mockHololivePlayerData.state;
  const currentIndex = state.currentQueueItemId
    ? mockHololivePlayerData.queue.findIndex((item) => item.id === state.currentQueueItemId)
    : -1;
  const insertIndex =
    payload.placement === "now"
      ? Math.max(currentIndex, 0)
      : payload.placement === "next" && currentIndex >= 0
        ? currentIndex + 1
        : mockHololivePlayerData.queue.length;
  const items = videoIds.map((videoId, index) => createMockHololivePlayerItem(videoId, insertIndex + index));
  const queue = [...mockHololivePlayerData.queue];
  queue.splice(insertIndex, 0, ...items);
  mockHololivePlayerData = {
    ...mockHololivePlayerData,
    queue: queue.map((entry, position) => ({ ...entry, position })),
    state:
      payload.placement === "now"
        ? {
            ...state,
            playbackSourceType: "queue",
            currentQueueItemId: items[0]?.id ?? null,
            currentPlaylistId: null,
            currentPlaylistItemId: null,
            currentYoutubeVideoId: items[0]?.youtubeVideoId ?? null,
            updatedAt: new Date().toISOString()
          }
        : state
  };
  return refreshMockHololivePlayerData();
}

function getMockHololiveIdolProfile(idolId: string): HololiveIdolProfile {
  const idol = mockHololiveTierData.idols.find((candidate) => candidate.id === idolId);
  if (!idol) {
    throw new Error(`Unknown Hololive idol: ${idolId}`);
  }
  const toProfileItem = (row: HololiveMusicRow) => ({
    id: row.youtubeVideoId,
    title: row.songName || row.title,
    url: row.youtubeUrl,
    publishedAt: row.publishedAt,
    durationSeconds: row.durationSeconds,
    viewCount: row.viewCount ?? null,
    viewCountFetchedAt: row.viewCountFetchedAt ?? null,
    markerKey: row.markerKey,
    marker: row.marker ?? null
  });
  const originalItems = visibleMockHololiveMusicRows()
    .filter((row) => row.ownedIdolIds.includes(idolId) && row.topicId === "Original_Song")
    .map(toProfileItem);
  const coverItems = visibleMockHololiveMusicRows()
    .filter((row) => row.ownedIdolIds.includes(idolId) && row.topicId === "Music_Cover")
    .map(toProfileItem);
  const featuredItems = visibleMockHololiveMusicRows()
    .filter((row) => row.featuredIdolIds.includes(idolId))
    .map(toProfileItem);

  return {
    idol,
    links: [
      ...(idol.xUrl
        ? [
            {
              id: "x",
              label: idol.xHandle ?? "X",
              url: idol.xUrl,
              kind: "x" as const
            }
          ]
        : [])
    ],
    mainChannel: {
      id: idol.youtubeChannelId ?? "UCp6993wxpyDPHUpavwDFqgg",
      name: `${idol.displayName} Channel`,
      url: idol.youtubeChannelUrl ?? "https://www.youtube.com/channel/UCp6993wxpyDPHUpavwDFqgg",
      photoUrl: idol.cachedIconUrl ?? idol.iconUrl,
      twitter: idol.xHandle?.replace(/^@/, "") ?? null,
      subscriberCount: 1230000,
      videoCount: 640,
      clipCount: 2100,
      publishedAt: "2017-09-07T00:00:00.000Z",
      updatedAt: now,
      kind: "idol"
    },
    topicChannels: [],
    mediaGroups: [
      {
        id: "original-songs",
        label: "Original Songs",
        items: originalItems.length
          ? originalItems
          : [
          {
            id: `${idol.id}-mock-original`,
            title: `${idol.displayName} Original Song`,
            url: "https://www.youtube.com/watch?v=mock-original",
            publishedAt: now,
            durationSeconds: 210,
            markerKey: `video:${idol.id}-mock-original`,
            marker: mockHololiveMusicMarkers[`${idol.id}-mock-original`]?.marker ?? null
          }
        ]
      },
      {
        id: "covers",
        label: "Covers",
        items: coverItems.length
          ? coverItems
          : [
          {
            id: `${idol.id}-mock-cover`,
            title: `${idol.displayName} Cover Song`,
            url: "https://www.youtube.com/watch?v=mock-cover",
            publishedAt: now,
            durationSeconds: 190,
            markerKey: `video:${idol.id}-mock-cover`,
            marker: mockHololiveMusicMarkers[`${idol.id}-mock-cover`]?.marker ?? null
          }
        ]
      },
      {
        id: "featured-in",
        label: "Featured In",
        items: featuredItems.length
          ? featuredItems
          : [
          {
            id: `${idol.id}-mock-featured`,
            title: `${idol.displayName} Featured Song`,
            url: "https://www.youtube.com/watch?v=mock-featured",
            publishedAt: now,
            durationSeconds: 220,
            markerKey: `video:${idol.id}-mock-featured`,
            marker: mockHololiveMusicMarkers[`${idol.id}-mock-featured`]?.marker ?? null
          }
        ]
      },
      { id: "playlists", label: "Playlists", items: [] }
    ]
  };
}

function getMockHololiveProfilePlaybackContext(
  payload: IpcChannelMap["hololive:profile:playback-context"]["request"]
): HololiveProfilePlaybackContext | null {
  const youtubeVideoId = payload.youtubeVideoId.trim();
  const row = visibleMockHololiveMusicRows().find((candidate) => candidate.youtubeVideoId === youtubeVideoId);
  if (!row) {
    return null;
  }

  const candidateIds = [
    payload.preferredIdolId ?? null,
    ...row.ownedIdolIds,
    ...row.featuredIdolIds.filter((idolId) => !row.ownedIdolIds.includes(idolId))
  ].filter((idolId): idolId is string => Boolean(idolId));
  const ownedGroupId = row.topicId === "Original_Song" ? "original-songs" : "covers";
  const groupOrder = [
    payload.preferredGroupId ?? null,
    ownedGroupId,
    ownedGroupId === "original-songs" ? "covers" : "original-songs",
    "featured-in"
  ].filter((groupId): groupId is HololiveProfilePlaybackContext["mediaGroupId"] => Boolean(groupId && groupId !== "playlists"));
  const tried = new Set<string>();

  for (const idolId of candidateIds) {
    if (tried.has(idolId)) {
      continue;
    }
    tried.add(idolId);

    const profile = getMockHololiveIdolProfile(idolId);
    for (const groupId of [...new Set(groupOrder)]) {
      const group = profile.mediaGroups.find((candidate) => candidate.id === groupId);
      const currentIndex = group?.items.findIndex((item) => item.id === youtubeVideoId) ?? -1;
      if (!group || currentIndex < 0) {
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
  }

  return null;
}

function listMockHololiveBracketSummaries(): HololiveBracketSummary[] {
  return [...mockHololiveBrackets.values()]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .map((bracket) => {
      const matches = bracket.rounds.flatMap((round) => round.matches);
      return {
        id: bracket.id,
        name: bracket.name,
        size: bracket.size,
        generationStyle: bracket.generationStyle,
        generationFilters: bracket.generationFilters,
        status: bracket.status,
        currentMatchId: bracket.currentMatchId,
        completedMatches: matches.filter((match) => match.winnerEntryId).length,
        totalMatches: matches.length,
        championTitle: bracket.champion?.title ?? null,
        createdAt: bracket.createdAt,
        updatedAt: bracket.updatedAt
      };
    });
}

function archiveMockHololiveBracket(bracket: HololiveBracket): void {
  if (bracket.status === "complete" && bracket.champion) {
    mockHololiveBracketArchives.set(bracket.id, structuredClone(bracket) as HololiveBracket);
  }
}

function listMockHololiveBracketArchiveSummaries(): HololiveBracketArchiveSummary[] {
  return [...mockHololiveBracketArchives.values()]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .map((bracket) => {
      const matches = bracket.rounds.flatMap((round) => round.matches);
      const completedMatches = matches.filter((match) => match.winnerEntryId);
      const finalMatch = bracket.rounds[bracket.rounds.length - 1]?.matches[0] ?? null;
      const completedAt = finalMatch?.completedAt ?? bracket.updatedAt;
      return {
        id: `archive:${bracket.id}`,
        sourceBracketId: bracket.id,
        name: bracket.name,
        size: bracket.size,
        generationStyle: bracket.generationStyle,
        generationFilters: bracket.generationFilters,
        totalEntries: bracket.entries.length,
        totalMatches: matches.length,
        completedMatches: completedMatches.length,
        championYoutubeVideoId: bracket.champion?.youtubeVideoId ?? null,
        championTitle: bracket.champion?.title ?? null,
        championIdolId: bracket.champion?.idolId ?? null,
        championIdolName: bracket.champion?.idolName ?? null,
        createdAt: bracket.createdAt,
        completedAt,
        archivedAt: bracket.updatedAt
      };
    });
}

function getMockHololiveBracketStatsOverview(): HololiveBracketStatsOverview {
  const archives = listMockHololiveBracketArchiveSummaries();
  const archivedBrackets = [...mockHololiveBracketArchives.values()].sort((left, right) => left.updatedAt.localeCompare(right.updatedAt));
  const currentViewCountsByVideoId = new Map(mockHololiveMusicRows.map((row) => [row.youtubeVideoId, row.viewCount ?? null]));
  const currentRowsByCanonicalKey = new Map(
    mockHololiveMusicRows.map((row) => [row.canonicalPerformanceKey?.trim() || row.youtubeVideoId, row])
  );
  const canonicalSongKeyFor = (entry: HololiveBracketEntry) => entry.canonicalPerformanceKey?.trim() || entry.youtubeVideoId;
  const representativeSongFor = (entry: HololiveBracketEntry) => currentRowsByCanonicalKey.get(canonicalSongKeyFor(entry)) ?? null;
  const currentViewCountFor = (youtubeVideoId: string, snapshotViewCount: number | null | undefined) => {
    const currentViewCount = currentViewCountsByVideoId.get(youtubeVideoId);
    return currentViewCount ?? snapshotViewCount ?? null;
  };
  const songStats = new Map<string, HololiveBracketStatsOverview["topSongsByWins"][number]>();
  const talentStats = new Map<string, HololiveBracketStatsOverview["topTalents"][number]>();
  const rivalryStats = new Map<string, HololiveBracketStatsOverview["topRivalries"][number]>();
  const finalsRivalryStats = new Map<string, HololiveBracketStatsOverview["topRivalries"][number]>();
  const previousSongResults = new Set<string>();
  const finalsConversionSamplesByTalent = new Map<string, boolean[]>();
  const deepRunSamplesByTalent = new Map<string, boolean[]>();
  const earlyExitSamplesByTalent = new Map<string, boolean[]>();
  const strengthOfWinsSamplesByTalent = new Map<string, number[]>();
  const strengthOfLossesSamplesByTalent = new Map<string, number[]>();
  const punchingAboveSamplesByTalent = new Map<string, RobustWeightedRateSample[]>();
  const clutchSamplesByTalent = new Map<string, ShrunkWeightedSignedScoreSample[]>();
  const pressureEdgeSamplesByTalent = new Map<string, ShrunkWeightedSignedScoreSample[]>();
  const upsetResilienceSamplesByTalent = new Map<string, RobustWeightedRateSample[]>();
  const highStakesSamplesBySong = new Map<string, RobustWeightedRateSample[]>();
  const strengthOfWinsSamplesBySong = new Map<string, number[]>();
  const strengthOfLossesSamplesBySong = new Map<string, number[]>();
  const punchingAboveSamplesBySong = new Map<string, RobustWeightedRateSample[]>();
  const clutchSamplesBySong = new Map<string, ShrunkWeightedSignedScoreSample[]>();
  const pressureEdgeSamplesBySong = new Map<string, ShrunkWeightedSignedScoreSample[]>();
  const upsetResilienceSamplesBySong = new Map<string, RobustWeightedRateSample[]>();
  let songRatings = new Map<string, Glicko2Rating>();
  let talentRatings = new Map<string, Glicko2Rating>();

  for (const bracket of archivedBrackets) {
    const matches = bracket.rounds.flatMap((round) => round.matches);
    const finalRoundIndex = Math.max(0, ...matches.map((match) => match.roundIndex));
    const finalMatch = matches.find((match) => match.roundIndex === finalRoundIndex && match.matchIndex === 0);
    const finalistIds = new Set([finalMatch?.entryA?.id, finalMatch?.entryB?.id].filter((id): id is string => Boolean(id)));
    const seenSongAppearances = new Set<string>();
    const seenSongChampions = new Set<string>();
    const seenSongFinalists = new Set<string>();
    const seenSongRunnerUps = new Set<string>();
    const seenSongTop4 = new Set<string>();
    const seenSongTop8 = new Set<string>();
    const seenSongTop16 = new Set<string>();
    const seenSongEarlyExits = new Set<string>();
    const songRatingPeriod = new Map<string, Glicko2Match[]>();
    const talentRatingPeriod = new Map<string, Glicko2Match[]>();
    const addRatingMatch = (period: Map<string, Glicko2Match[]>, playerId: string, opponentId: string, score: 0 | 1) => {
      const matches = period.get(playerId) ?? [];
      matches.push({ opponentId, score });
      period.set(playerId, matches);
    };

    for (const entry of bracket.entries) {
      const participatedMatches = matches.filter((match) => match.entryA?.id === entry.id || match.entryB?.id === entry.id);
      const wins = participatedMatches.filter((match) => match.winnerEntryId === entry.id).length;
      const loss = participatedMatches.find((match) => match.winnerEntryId && match.winnerEntryId !== entry.id);
      const topRound = Math.max(0, ...participatedMatches.map((match) => match.roundIndex));
      const top4Round = Math.max(0, finalRoundIndex - 1);
      const top8Round = Math.max(0, finalRoundIndex - 2);
      const top16Round = Math.max(0, finalRoundIndex - 3);
      const isChampion = bracket.champion?.id === entry.id ? 1 : 0;
      const isFinalist = finalistIds.has(entry.id) ? 1 : 0;
      const isRunnerUp = isFinalist && !isChampion ? 1 : 0;
      const earlyExit = loss && loss.roundIndex === 0 ? 1 : 0;

      const canonicalPerformanceKey = canonicalSongKeyFor(entry);
      const representative = representativeSongFor(entry);
      const song =
        songStats.get(canonicalPerformanceKey) ??
        ({
          canonicalPerformanceKey,
          youtubeVideoId: representative?.youtubeVideoId ?? entry.youtubeVideoId,
          title: representative?.songName?.trim() || representative?.title || entry.title,
          topicId: representative?.topicId ?? entry.topicId,
          idolId: representative?.idolId ?? entry.idolId,
          idolName: representative?.participants.find((participant) => participant.idolId === representative.idolId)?.idolName ?? entry.idolName,
          appearances: 0,
          wins: 0,
          losses: 0,
          winRate: 0,
          championCount: 0,
          finalistCount: 0,
          runnerUpCount: 0,
          top4Count: 0,
          top8Count: 0,
          top16Count: 0,
          firstRoundEliminations: 0,
          upsetWins: 0,
          revengeWins: 0,
          giantKillerScore: 0,
          bigGameScore: 0,
          bigGameWins: 0,
          highStakesPerformanceRate: 0,
          highStakesPerformanceWins: 0,
          highStakesPerformanceLosses: 0,
          highStakesPerformanceMatches: 0,
          strengthOfWinsScore: 0,
          strengthOfWinsCount: 0,
          strengthOfLossesScore: 0,
          strengthOfLossesCount: 0,
          punchingAboveScore: 0,
          punchingAboveWins: 0,
          punchingAboveOpportunities: 0,
          clutchRate: 0,
          clutchWins: 0,
          clutchLosses: 0,
          clutchMatches: 0,
          pressureEdgeScore: 0,
          pressureEdgeMatches: 0,
          pressureEdgePositiveMatches: 0,
          pressureEdgeNegativeMatches: 0,
          upsetResilienceScore: 0,
          upsetResilienceChecks: 0,
          upsetResilienceUpsetLosses: 0,
          lastArchivedAt: bracket.updatedAt
        } satisfies HololiveBracketStatsOverview["topSongsByWins"][number]);
      if (!seenSongAppearances.has(canonicalPerformanceKey)) {
        song.appearances += 1;
        seenSongAppearances.add(canonicalPerformanceKey);
      }
      song.wins += wins;
      song.losses += loss ? 1 : 0;
      if (isChampion && !seenSongChampions.has(canonicalPerformanceKey)) {
        song.championCount += 1;
        seenSongChampions.add(canonicalPerformanceKey);
      }
      if (isFinalist && !seenSongFinalists.has(canonicalPerformanceKey)) {
        song.finalistCount += 1;
        seenSongFinalists.add(canonicalPerformanceKey);
      }
      if (isRunnerUp && !seenSongRunnerUps.has(canonicalPerformanceKey)) {
        song.runnerUpCount += 1;
        seenSongRunnerUps.add(canonicalPerformanceKey);
      }
      if (topRound >= top4Round && !seenSongTop4.has(canonicalPerformanceKey)) {
        song.top4Count += 1;
        seenSongTop4.add(canonicalPerformanceKey);
      }
      if (topRound >= top8Round && !seenSongTop8.has(canonicalPerformanceKey)) {
        song.top8Count += 1;
        seenSongTop8.add(canonicalPerformanceKey);
      }
      if (topRound >= top16Round && !seenSongTop16.has(canonicalPerformanceKey)) {
        song.top16Count += 1;
        seenSongTop16.add(canonicalPerformanceKey);
      }
      if (loss?.roundIndex === 0 && !seenSongEarlyExits.has(canonicalPerformanceKey)) {
        song.firstRoundEliminations += 1;
        seenSongEarlyExits.add(canonicalPerformanceKey);
      }
      song.winRate = song.wins + song.losses > 0 ? song.wins / (song.wins + song.losses) : 0;
      songStats.set(canonicalPerformanceKey, song);

      const talent =
        talentStats.get(entry.idolId) ??
        ({
          idolId: entry.idolId,
          idolName: entry.idolName,
          appearances: 0,
          wins: 0,
          losses: 0,
          winRate: 0,
          championCount: 0,
          finalistCount: 0,
          finalsConversionRate: 0,
          runnerUpCount: 0,
          top4Count: 0,
          deepRunRate: 0,
          top8Count: 0,
          top16Count: 0,
          firstRoundEliminations: 0,
          earlyExitCount: 0,
          earlyExitRate: 0,
          strengthOfWinsScore: 0,
          strengthOfWinsCount: 0,
          strengthOfLossesScore: 0,
          strengthOfLossesCount: 0,
          punchingAboveScore: 0,
          punchingAboveWins: 0,
          punchingAboveOpportunities: 0,
          clutchRate: 0,
          clutchWins: 0,
          clutchLosses: 0,
          clutchMatches: 0,
          pressureEdgeScore: 0,
          pressureEdgeMatches: 0,
          pressureEdgePositiveMatches: 0,
          pressureEdgeNegativeMatches: 0,
          upsetResilienceScore: 0,
          upsetResilienceChecks: 0,
          upsetResilienceUpsetLosses: 0,
          lastArchivedAt: bracket.updatedAt
        } satisfies HololiveBracketStatsOverview["topTalents"][number]);
      talent.appearances += 1;
      talent.wins += wins;
      talent.losses += loss ? 1 : 0;
      talent.championCount += isChampion;
      talent.finalistCount += isFinalist;
      talent.runnerUpCount += isRunnerUp;
      talent.top4Count += topRound >= top4Round ? 1 : 0;
      talent.top8Count += topRound >= top8Round ? 1 : 0;
      talent.top16Count += topRound >= top16Round ? 1 : 0;
      talent.firstRoundEliminations += loss?.roundIndex === 0 ? 1 : 0;
      talent.earlyExitCount += earlyExit;
      talent.winRate = talent.wins + talent.losses > 0 ? talent.wins / (talent.wins + talent.losses) : 0;
      talentStats.set(entry.idolId, talent);

      const deepRunSamples = deepRunSamplesByTalent.get(entry.idolId) ?? [];
      deepRunSamples.push(topRound >= top4Round);
      deepRunSamplesByTalent.set(entry.idolId, deepRunSamples);
      const earlyExitSamples = earlyExitSamplesByTalent.get(entry.idolId) ?? [];
      earlyExitSamples.push(earlyExit > 0);
      earlyExitSamplesByTalent.set(entry.idolId, earlyExitSamples);
      if (isFinalist) {
        const finalsSamples = finalsConversionSamplesByTalent.get(entry.idolId) ?? [];
        finalsSamples.push(Boolean(isChampion));
        finalsConversionSamplesByTalent.set(entry.idolId, finalsSamples);
      }
    }

    for (const match of matches) {
      if (!match.winner || !match.winnerEntryId) {
        continue;
      }
      const winner = match.winner;

      const loser = [match.entryA, match.entryB].find((entry) => entry && entry.id !== match.winnerEntryId) ?? null;
      if (!loser) {
        continue;
      }

      const winnerSongKey = canonicalSongKeyFor(winner);
      const loserSongKey = canonicalSongKeyFor(loser);
      const winnerSong = songStats.get(winnerSongKey);
      const loserViews = representativeSongFor(loser)?.viewCount ?? currentViewCountFor(loser.youtubeVideoId, loser.viewCount);
      const winnerViews = representativeSongFor(winner)?.viewCount ?? currentViewCountFor(winner.youtubeVideoId, winner.viewCount);
      const isDistinctSongResult = winnerSongKey !== loserSongKey;
      const isClutchRound = match.roundIndex >= Math.max(0, finalRoundIndex - 2);
      if (isDistinctSongResult) {
        if (isClutchRound) {
          const roundWeight = match.roundIndex >= finalRoundIndex ? 1.5 : match.roundIndex === finalRoundIndex - 1 ? 1.25 : 1;
          const winnerRating = songRatings.get(winnerSongKey) ?? createDefaultGlicko2Rating();
          const loserRating = songRatings.get(loserSongKey) ?? createDefaultGlicko2Rating();
          const winnerPressure = pressureEdgeSamplesBySong.get(winnerSongKey) ?? [];
          winnerPressure.push({ value: 1 - getGlicko2ExpectedScore(winnerRating, loserRating), weight: roundWeight });
          pressureEdgeSamplesBySong.set(winnerSongKey, winnerPressure);
          const loserPressure = pressureEdgeSamplesBySong.get(loserSongKey) ?? [];
          loserPressure.push({ value: -getGlicko2ExpectedScore(loserRating, winnerRating), weight: roundWeight });
          pressureEdgeSamplesBySong.set(loserSongKey, loserPressure);
        }
        addRatingMatch(songRatingPeriod, winnerSongKey, loserSongKey, 1);
        addRatingMatch(songRatingPeriod, loserSongKey, winnerSongKey, 0);
      }
      if (isDistinctSongResult && loserViews != null && Number.isFinite(loserViews) && loserViews > 0) {
        const songSamples = strengthOfWinsSamplesBySong.get(winnerSongKey) ?? [];
        songSamples.push(loserViews);
        strengthOfWinsSamplesBySong.set(winnerSongKey, songSamples);
        const samples = strengthOfWinsSamplesByTalent.get(winner.idolId) ?? [];
        samples.push(loserViews);
        strengthOfWinsSamplesByTalent.set(winner.idolId, samples);
      }
      if (isDistinctSongResult && winnerViews != null && Number.isFinite(winnerViews) && winnerViews > 0) {
        const songSamples = strengthOfLossesSamplesBySong.get(loserSongKey) ?? [];
        songSamples.push(winnerViews);
        strengthOfLossesSamplesBySong.set(loserSongKey, songSamples);
        const samples = strengthOfLossesSamplesByTalent.get(loser.idolId) ?? [];
        samples.push(winnerViews);
        strengthOfLossesSamplesByTalent.set(loser.idolId, samples);
      }
      if (
        isDistinctSongResult &&
        winnerViews != null &&
        loserViews != null &&
        Number.isFinite(winnerViews) &&
        Number.isFinite(loserViews) &&
        winnerViews > 0 &&
        loserViews > 0 &&
        winnerViews !== loserViews
      ) {
        const underdogTalentId = winnerViews < loserViews ? winner.idolId : loser.idolId;
        const underdogSongKey = winnerViews < loserViews ? winnerSongKey : loserSongKey;
        const songSamples = punchingAboveSamplesBySong.get(underdogSongKey) ?? [];
        songSamples.push({
          weight: Math.log2(Math.max(winnerViews, loserViews) / Math.min(winnerViews, loserViews)),
          success: winnerViews < loserViews
        });
        punchingAboveSamplesBySong.set(underdogSongKey, songSamples);
        const samples = punchingAboveSamplesByTalent.get(underdogTalentId) ?? [];
        samples.push({
          weight: Math.log2(Math.max(winnerViews, loserViews) / Math.min(winnerViews, loserViews)),
          success: winnerViews < loserViews
        });
        punchingAboveSamplesByTalent.set(underdogTalentId, samples);
      }
      if (isDistinctSongResult && isClutchRound && winner.idolId !== loser.idolId) {
        const roundWeight = match.roundIndex >= finalRoundIndex ? 1.5 : match.roundIndex === finalRoundIndex - 1 ? 1.25 : 1;
        const winnerSamples = clutchSamplesByTalent.get(winner.idolId) ?? [];
        winnerSamples.push({ value: 1, weight: roundWeight });
        clutchSamplesByTalent.set(winner.idolId, winnerSamples);
        const loserSamples = clutchSamplesByTalent.get(loser.idolId) ?? [];
        loserSamples.push({ value: -1, weight: roundWeight });
        clutchSamplesByTalent.set(loser.idolId, loserSamples);
      }
      if (isDistinctSongResult && isClutchRound) {
        const roundWeight = match.roundIndex >= finalRoundIndex ? 1.5 : match.roundIndex === finalRoundIndex - 1 ? 1.25 : 1;
        const winnerSamples = clutchSamplesBySong.get(winnerSongKey) ?? [];
        winnerSamples.push({ value: 1, weight: roundWeight });
        clutchSamplesBySong.set(winnerSongKey, winnerSamples);
        const loserSamples = clutchSamplesBySong.get(loserSongKey) ?? [];
        loserSamples.push({ value: -1, weight: roundWeight });
        clutchSamplesBySong.set(loserSongKey, loserSamples);
      }
      if (
        isDistinctSongResult &&
        winnerViews != null &&
        loserViews != null &&
        Number.isFinite(winnerViews) &&
        Number.isFinite(loserViews) &&
        winnerViews > 0 &&
        loserViews > 0 &&
        winnerViews !== loserViews
      ) {
        const favoredTalentId = winnerViews > loserViews ? winner.idolId : loser.idolId;
        const favoredSongKey = winnerViews > loserViews ? winnerSongKey : loserSongKey;
        const songSamples = upsetResilienceSamplesBySong.get(favoredSongKey) ?? [];
        songSamples.push({
          weight: Math.log2(Math.max(winnerViews, loserViews) / Math.min(winnerViews, loserViews)),
          success: winnerViews > loserViews
        });
        upsetResilienceSamplesBySong.set(favoredSongKey, songSamples);
        const samples = upsetResilienceSamplesByTalent.get(favoredTalentId) ?? [];
        samples.push({
          weight: Math.log2(Math.max(winnerViews, loserViews) / Math.min(winnerViews, loserViews)),
          success: winnerViews > loserViews
        });
        upsetResilienceSamplesByTalent.set(favoredTalentId, samples);
      }
      if (
        isDistinctSongResult &&
        winnerViews != null &&
        loserViews != null &&
        Number.isFinite(winnerViews) &&
        Number.isFinite(loserViews) &&
        winnerViews > 0 &&
        loserViews > 0
      ) {
        const winnerSamples = highStakesSamplesBySong.get(winnerSongKey) ?? [];
        winnerSamples.push({ weight: Math.log1p(loserViews), success: true });
        highStakesSamplesBySong.set(winnerSongKey, winnerSamples);
        const loserSamples = highStakesSamplesBySong.get(loserSongKey) ?? [];
        loserSamples.push({ weight: Math.log1p(winnerViews), success: false });
        highStakesSamplesBySong.set(loserSongKey, loserSamples);
      }
      if (winnerSong) {
        if (loserViews != null) {
          winnerSong.bigGameScore += loserViews;
          winnerSong.bigGameWins += 1;
        }
        if (winnerViews != null && loserViews != null && winnerViews < loserViews) {
          winnerSong.upsetWins += 1;
          winnerSong.giantKillerScore += loserViews - winnerViews;
        }
        if (previousSongResults.has(`${loserSongKey}|${winnerSongKey}`)) {
          winnerSong.revengeWins += 1;
        }
      }
      previousSongResults.add(`${winnerSongKey}|${loserSongKey}`);

      if (winner.idolId === loser.idolId) {
        continue;
      }

      if (isClutchRound) {
        const roundWeight = match.roundIndex >= finalRoundIndex ? 1.5 : match.roundIndex === finalRoundIndex - 1 ? 1.25 : 1;
        const winnerRating = talentRatings.get(winner.idolId) ?? createDefaultGlicko2Rating();
        const loserRating = talentRatings.get(loser.idolId) ?? createDefaultGlicko2Rating();
        const winnerPressure = pressureEdgeSamplesByTalent.get(winner.idolId) ?? [];
        winnerPressure.push({ value: 1 - getGlicko2ExpectedScore(winnerRating, loserRating), weight: roundWeight });
        pressureEdgeSamplesByTalent.set(winner.idolId, winnerPressure);
        const loserPressure = pressureEdgeSamplesByTalent.get(loser.idolId) ?? [];
        loserPressure.push({ value: -getGlicko2ExpectedScore(loserRating, winnerRating), weight: roundWeight });
        pressureEdgeSamplesByTalent.set(loser.idolId, loserPressure);
      }
      addRatingMatch(talentRatingPeriod, winner.idolId, loser.idolId, 1);
      addRatingMatch(talentRatingPeriod, loser.idolId, winner.idolId, 0);

      const [left, right] = [
        { id: winner.idolId, name: winner.idolName },
        { id: loser.idolId, name: loser.idolName }
      ].sort((leftValue, rightValue) => leftValue.name.localeCompare(rightValue.name) || leftValue.id.localeCompare(rightValue.id));
      const key = `${left.id}|${right.id}`;
      const addRivalryResult = (target: Map<string, HololiveBracketStatsOverview["topRivalries"][number]>) => {
        const targetRivalry =
          target.get(key) ??
          ({
            key,
            leftIdolId: left.id,
            leftIdolName: left.name,
            rightIdolId: right.id,
            rightIdolName: right.name,
            matches: 0,
            leftWins: 0,
            rightWins: 0,
            lastArchivedAt: bracket.updatedAt
          } satisfies HololiveBracketStatsOverview["topRivalries"][number]);
        targetRivalry.matches += 1;
        if (winner.idolId === targetRivalry.leftIdolId) {
          targetRivalry.leftWins += 1;
        } else {
          targetRivalry.rightWins += 1;
        }
        if (bracket.updatedAt > targetRivalry.lastArchivedAt) {
          targetRivalry.lastArchivedAt = bracket.updatedAt;
        }
        target.set(key, targetRivalry);
      };
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
          lastArchivedAt: bracket.updatedAt
        } satisfies HololiveBracketStatsOverview["topRivalries"][number]);
      rivalry.matches += 1;
      if (winner.idolId === rivalry.leftIdolId) {
        rivalry.leftWins += 1;
      } else {
        rivalry.rightWins += 1;
      }
      if (bracket.updatedAt > rivalry.lastArchivedAt) {
        rivalry.lastArchivedAt = bracket.updatedAt;
      }
      rivalryStats.set(key, rivalry);
      if (match.roundIndex === finalRoundIndex) {
        addRivalryResult(finalsRivalryStats);
      }
    }
    songRatings = updateGlicko2RatingPeriod(songRatings, songRatingPeriod);
    talentRatings = updateGlicko2RatingPeriod(talentRatings, talentRatingPeriod);
  }

  const byWins = <T extends { wins: number; championCount: number; appearances: number }>(left: T, right: T) =>
    right.wins - left.wins || right.championCount - left.championCount || right.appearances - left.appearances;
  const finalsWithoutTitle = (song: HololiveBracketStatsOverview["topSongsByWins"][number]) => Math.max(0, song.finalistCount - song.championCount);
  const giantKillerAverageScore = (song: HololiveBracketStatsOverview["topSongsByWins"][number]) => (song.upsetWins > 0 ? song.giantKillerScore / song.upsetWins : 0);
  const bigGameAverageScore = (song: HololiveBracketStatsOverview["topSongsByWins"][number]) =>
    song.bigGameWins > 0 ? song.bigGameScore / song.bigGameWins : 0;
  const songs = [...songStats.values()];
  const talents = [...talentStats.values()];
  for (const result of calculateRobustViewStrengthScores(
    songs.map((song) => ({
      id: song.canonicalPerformanceKey,
      values: strengthOfWinsSamplesBySong.get(song.canonicalPerformanceKey) ?? []
    }))
  )) {
    const song = songStats.get(result.id);
    if (song) {
      song.strengthOfWinsScore = result.score;
      song.strengthOfWinsCount = result.count;
    }
  }
  for (const result of calculateRobustViewStrengthScores(
    songs.map((song) => ({
      id: song.canonicalPerformanceKey,
      values: strengthOfLossesSamplesBySong.get(song.canonicalPerformanceKey) ?? []
    }))
  )) {
    const song = songStats.get(result.id);
    if (song) {
      song.strengthOfLossesScore = result.score;
      song.strengthOfLossesCount = result.count;
    }
  }
  for (const result of calculateRobustViewStrengthScores(
    talents.map((talent) => ({
      id: talent.idolId,
      values: strengthOfWinsSamplesByTalent.get(talent.idolId) ?? []
    }))
  )) {
    const talent = talentStats.get(result.id);
    if (talent) {
      talent.strengthOfWinsScore = result.score;
      talent.strengthOfWinsCount = result.count;
    }
  }
  for (const result of calculateRobustViewStrengthScores(
    talents.map((talent) => ({
      id: talent.idolId,
      values: strengthOfLossesSamplesByTalent.get(talent.idolId) ?? []
    }))
  )) {
    const talent = talentStats.get(result.id);
    if (talent) {
      talent.strengthOfLossesScore = result.score;
      talent.strengthOfLossesCount = result.count;
    }
  }
  for (const result of calculateShrunkBinaryRates(
    talents.map((talent) => ({
      id: talent.idolId,
      values: finalsConversionSamplesByTalent.get(talent.idolId) ?? []
    }))
  )) {
    const talent = talentStats.get(result.id);
    if (talent) {
      talent.finalsConversionRate = result.score;
    }
  }
  for (const result of calculateShrunkBinaryRates(
    talents.map((talent) => ({
      id: talent.idolId,
      values: deepRunSamplesByTalent.get(talent.idolId) ?? []
    }))
  )) {
    const talent = talentStats.get(result.id);
    if (talent) {
      talent.deepRunRate = result.score;
    }
  }
  for (const result of calculateShrunkBinaryRates(
    talents.map((talent) => ({
      id: talent.idolId,
      values: earlyExitSamplesByTalent.get(talent.idolId) ?? []
    }))
  )) {
    const talent = talentStats.get(result.id);
    if (talent) {
      talent.earlyExitRate = result.score;
    }
  }
  for (const result of calculateRobustWeightedSuccessRates(
    songs.map((song) => ({
      id: song.canonicalPerformanceKey,
      samples: highStakesSamplesBySong.get(song.canonicalPerformanceKey) ?? []
    })),
    3,
    Number.POSITIVE_INFINITY
  )) {
    const song = songStats.get(result.id);
    if (song) {
      song.highStakesPerformanceRate = result.score;
      song.highStakesPerformanceWins = result.successCount;
      song.highStakesPerformanceLosses = result.failureCount;
      song.highStakesPerformanceMatches = result.count;
    }
  }
  for (const result of calculateConfidenceAdjustedExpectedPerformanceScores(
    talents.map((talent) => ({
      id: talent.idolId,
      samples: punchingAboveSamplesByTalent.get(talent.idolId) ?? []
    })),
    "underdog"
  )) {
    const talent = talentStats.get(result.id);
    if (talent) {
      talent.punchingAboveScore = result.score;
      talent.punchingAboveWins = result.successCount;
      talent.punchingAboveOpportunities = result.count;
    }
  }
  for (const result of calculateShrunkWeightedSignedScores(
    talents.map((talent) => ({
      id: talent.idolId,
      samples: clutchSamplesByTalent.get(talent.idolId) ?? []
    }))
  )) {
    const talent = talentStats.get(result.id);
    if (talent) {
      talent.clutchRate = result.score;
      talent.clutchWins = result.positiveCount;
      talent.clutchLosses = result.negativeCount;
      talent.clutchMatches = result.count;
    }
  }
  for (const result of calculateShrunkWeightedSignedScores(
    talents.map((talent) => ({
      id: talent.idolId,
      samples: pressureEdgeSamplesByTalent.get(talent.idolId) ?? []
    }))
  )) {
    const talent = talentStats.get(result.id);
    if (talent) {
      talent.pressureEdgeScore = result.score;
      talent.pressureEdgeMatches = result.count;
      talent.pressureEdgePositiveMatches = result.positiveCount;
      talent.pressureEdgeNegativeMatches = result.negativeCount;
    }
  }
  for (const result of calculateConfidenceAdjustedExpectedPerformanceScores(
    talents.map((talent) => ({
      id: talent.idolId,
      samples: upsetResilienceSamplesByTalent.get(talent.idolId) ?? []
    })),
    "favorite"
  )) {
    const talent = talentStats.get(result.id);
    if (talent) {
      talent.upsetResilienceScore = result.score;
      talent.upsetResilienceChecks = result.count;
      talent.upsetResilienceUpsetLosses = result.failureCount;
    }
  }
  for (const result of calculateConfidenceAdjustedExpectedPerformanceScores(
    songs.map((song) => ({
      id: song.canonicalPerformanceKey,
      samples: punchingAboveSamplesBySong.get(song.canonicalPerformanceKey) ?? []
    })),
    "underdog"
  )) {
    const song = songStats.get(result.id);
    if (song) {
      song.punchingAboveScore = result.score;
      song.punchingAboveWins = result.successCount;
      song.punchingAboveOpportunities = result.count;
    }
  }
  for (const result of calculateShrunkWeightedSignedScores(
    songs.map((song) => ({
      id: song.canonicalPerformanceKey,
      samples: clutchSamplesBySong.get(song.canonicalPerformanceKey) ?? []
    }))
  )) {
    const song = songStats.get(result.id);
    if (song) {
      song.clutchRate = result.score;
      song.clutchWins = result.positiveCount;
      song.clutchLosses = result.negativeCount;
      song.clutchMatches = result.count;
    }
  }
  for (const result of calculateShrunkWeightedSignedScores(
    songs.map((song) => ({
      id: song.canonicalPerformanceKey,
      samples: pressureEdgeSamplesBySong.get(song.canonicalPerformanceKey) ?? []
    }))
  )) {
    const song = songStats.get(result.id);
    if (song) {
      song.pressureEdgeScore = result.score;
      song.pressureEdgeMatches = result.count;
      song.pressureEdgePositiveMatches = result.positiveCount;
      song.pressureEdgeNegativeMatches = result.negativeCount;
    }
  }
  for (const result of calculateConfidenceAdjustedExpectedPerformanceScores(
    songs.map((song) => ({
      id: song.canonicalPerformanceKey,
      samples: upsetResilienceSamplesBySong.get(song.canonicalPerformanceKey) ?? []
    })),
    "favorite"
  )) {
    const song = songStats.get(result.id);
    if (song) {
      song.upsetResilienceScore = result.score;
      song.upsetResilienceChecks = result.count;
      song.upsetResilienceUpsetLosses = result.failureCount;
    }
  }
  const bySongTitle = (left: HololiveBracketStatsOverview["topSongsByWins"][number], right: HololiveBracketStatsOverview["topSongsByWins"][number]) =>
    left.title.localeCompare(right.title);
  const rivalries = [...rivalryStats.values()];
  const finalsRivalries = [...finalsRivalryStats.values()];
  const sortedSongsByWins = [...songs].sort(byWins);
  const sortedSongsByTitles = [...songs]
    .filter((song) => song.championCount > 0)
    .sort((left, right) => right.championCount - left.championCount || right.finalistCount - left.finalistCount || byWins(left, right));
  const sortedSongsByRunnerUps = [...songs]
    .filter((song) => song.runnerUpCount > 0)
    .sort((left, right) => right.runnerUpCount - left.runnerUpCount || right.finalistCount - left.finalistCount || byWins(left, right));
  const sortedSongsByDeepRuns = [...songs]
    .filter((song) => song.top4Count > 0)
    .sort((left, right) => right.top4Count - left.top4Count || right.championCount - left.championCount || byWins(left, right));
  const sortedSongsByEarlyExits = [...songs]
    .filter((song) => song.firstRoundEliminations > 0)
    .sort((left, right) => right.firstRoundEliminations - left.firstRoundEliminations || right.appearances - left.appearances || byWins(left, right));
  const sortedSongsByStrengthOfWins = [...songs]
    .filter((song) => song.strengthOfWinsScore > 0 && song.strengthOfWinsCount > 0)
    .sort((left, right) => right.strengthOfWinsScore - left.strengthOfWinsScore || right.strengthOfWinsCount - left.strengthOfWinsCount || byWins(left, right));
  const sortedSongsByStrengthOfLosses = [...songs]
    .filter((song) => song.strengthOfLossesScore > 0 && song.strengthOfLossesCount > 0)
    .sort((left, right) => right.strengthOfLossesScore - left.strengthOfLossesScore || right.strengthOfLossesCount - left.strengthOfLossesCount || byWins(left, right));
  const sortedSongsByPunchingAbove = [...songs]
    .filter((song) => song.punchingAboveScore > 0 && song.punchingAboveWins > 0)
    .sort(
      (left, right) =>
        right.punchingAboveScore - left.punchingAboveScore ||
        right.punchingAboveWins - left.punchingAboveWins ||
        right.punchingAboveOpportunities - left.punchingAboveOpportunities ||
        byWins(left, right)
    );
  const sortedSongsByClutchRate = [...songs]
    .filter((song) => song.clutchMatches > 0)
    .sort((left, right) => right.clutchRate - left.clutchRate || right.clutchWins - left.clutchWins || right.clutchMatches - left.clutchMatches || byWins(left, right));
  const sortedSongsByPressureEdge = [...songs]
    .filter((song) => song.pressureEdgeMatches > 0)
    .sort(
      (left, right) =>
        right.pressureEdgeScore - left.pressureEdgeScore ||
        right.pressureEdgePositiveMatches - left.pressureEdgePositiveMatches ||
        right.pressureEdgeMatches - left.pressureEdgeMatches ||
        byWins(left, right)
    );
  const sortedSongsByUpsetResilience = [...songs]
    .filter((song) => song.upsetResilienceChecks > 0)
    .sort(
      (left, right) =>
        right.upsetResilienceScore - left.upsetResilienceScore ||
        right.upsetResilienceChecks - left.upsetResilienceChecks ||
        left.upsetResilienceUpsetLosses - right.upsetResilienceUpsetLosses ||
        byWins(left, right)
    );
  const sortedTalentsByWins = [...talents].sort(byWins);
  const sortedTalentsByTitles = [...talents]
    .filter((talent) => talent.championCount > 0)
    .sort((left, right) => right.championCount - left.championCount || right.finalistCount - left.finalistCount || byWins(left, right));
  const sortedTalentsByRunnerUps = [...talents]
    .filter((talent) => talent.runnerUpCount > 0)
    .sort((left, right) => right.runnerUpCount - left.runnerUpCount || right.finalistCount - left.finalistCount || byWins(left, right));
  const sortedTalentsByFinalsConversion = [...talents]
    .filter((talent) => talent.finalistCount > 0)
    .sort(
      (left, right) =>
        right.finalsConversionRate - left.finalsConversionRate ||
        right.championCount - left.championCount ||
        right.finalistCount - left.finalistCount ||
        byWins(left, right)
    );
  const sortedTalentsByDeepRuns = [...talents]
    .filter((talent) => talent.top4Count > 0)
    .sort((left, right) => right.top4Count - left.top4Count || right.championCount - left.championCount || byWins(left, right));
  const sortedTalentsByDeepRunRate = [...talents]
    .filter((talent) => talent.appearances > 0)
    .sort(
      (left, right) =>
        right.deepRunRate - left.deepRunRate ||
        right.top4Count - left.top4Count ||
        right.appearances - left.appearances ||
        byWins(left, right)
    );
  const sortedTalentsByEarlyExits = [...talents]
    .filter((talent) => talent.earlyExitCount > 0)
    .sort((left, right) => right.earlyExitCount - left.earlyExitCount || right.losses - left.losses || right.appearances - left.appearances || byWins(left, right));
  const sortedTalentsByEarlyExitRate = [...talents]
    .filter((talent) => talent.appearances > 0)
    .sort(
      (left, right) =>
        left.earlyExitRate - right.earlyExitRate ||
        left.earlyExitCount - right.earlyExitCount ||
        right.appearances - left.appearances ||
        byWins(left, right)
    );
  const sortedTalentsByStrengthOfWins = [...talents]
    .filter((talent) => talent.strengthOfWinsScore > 0 && talent.strengthOfWinsCount > 0)
    .sort(
      (left, right) =>
        right.strengthOfWinsScore - left.strengthOfWinsScore ||
        right.strengthOfWinsCount - left.strengthOfWinsCount ||
        byWins(left, right)
    );
  const sortedTalentsByStrengthOfLosses = [...talents]
    .filter((talent) => talent.strengthOfLossesScore > 0 && talent.strengthOfLossesCount > 0)
    .sort(
      (left, right) =>
        right.strengthOfLossesScore - left.strengthOfLossesScore ||
        right.strengthOfLossesCount - left.strengthOfLossesCount ||
        byWins(left, right)
    );
  const sortedTalentsByPunchingAbove = [...talents]
    .filter((talent) => talent.punchingAboveScore > 0 && talent.punchingAboveWins > 0)
    .sort(
      (left, right) =>
        right.punchingAboveScore - left.punchingAboveScore ||
        right.punchingAboveWins - left.punchingAboveWins ||
        right.punchingAboveOpportunities - left.punchingAboveOpportunities ||
        byWins(left, right)
    );
  const sortedTalentsByClutchRate = [...talents]
    .filter((talent) => talent.clutchMatches > 0)
    .sort(
      (left, right) =>
        right.clutchRate - left.clutchRate ||
        right.clutchWins - left.clutchWins ||
        right.clutchMatches - left.clutchMatches ||
        byWins(left, right)
    );
  const sortedTalentsByPressureEdge = [...talents]
    .filter((talent) => talent.pressureEdgeMatches > 0)
    .sort(
      (left, right) =>
        right.pressureEdgeScore - left.pressureEdgeScore ||
        right.pressureEdgePositiveMatches - left.pressureEdgePositiveMatches ||
        right.pressureEdgeMatches - left.pressureEdgeMatches ||
        byWins(left, right)
    );
  const sortedTalentsByUpsetResilience = [...talents]
    .filter((talent) => talent.upsetResilienceChecks > 0)
    .sort(
      (left, right) =>
        right.upsetResilienceScore - left.upsetResilienceScore ||
        right.upsetResilienceChecks - left.upsetResilienceChecks ||
        left.upsetResilienceUpsetLosses - right.upsetResilienceUpsetLosses ||
        byWins(left, right)
    );
  const sortedRivalries = [...rivalries].sort(
    (left, right) =>
      right.matches - left.matches ||
      Math.min(right.leftWins, right.rightWins) - Math.min(left.leftWins, left.rightWins) ||
      right.lastArchivedAt.localeCompare(left.lastArchivedAt) ||
      left.key.localeCompare(right.key)
  );
  const sortedFinalsRivalries = [...finalsRivalries].sort(
    (left, right) =>
      right.matches - left.matches ||
      Math.min(right.leftWins, right.rightWins) - Math.min(left.leftWins, left.rightWins) ||
      right.lastArchivedAt.localeCompare(left.lastArchivedAt) ||
      left.key.localeCompare(right.key)
  );
  const buildRatingRows = <T extends { wins: number; losses: number; championCount: number; lastArchivedAt: string }>(
    items: T[],
    getId: (item: T) => string,
    getLabel: (item: T) => string,
    getDetail: (item: T) => string | null,
    ratings: Map<string, Glicko2Rating>
  ): HololiveBracketStatsOverview["topSongRatings"] =>
    items
      .filter((item) => item.wins + item.losses > 0)
      .flatMap((item) => {
        const id = getId(item);
        const currentRating = ratings.get(id);
        if (!currentRating) {
          return [];
        }
        const matches = item.wins + item.losses;
        return [{
          id,
          label: getLabel(item),
          detail: getDetail(item),
          rating: currentRating.rating,
          conservativeRating: getConservativeGlicko2Rating(currentRating),
          ratingDeviation: currentRating.ratingDeviation,
          volatility: currentRating.volatility,
          wins: item.wins,
          losses: item.losses,
          matches,
          lastArchivedAt: item.lastArchivedAt
        }];
      })
      .sort(
        (left, right) =>
          right.conservativeRating - left.conservativeRating ||
          right.rating - left.rating ||
          right.matches - left.matches ||
          right.wins - left.wins ||
          left.label.localeCompare(right.label)
      );

  return {
    totals: {
      completedBrackets: archives.length,
      totalMatches: archives.reduce((sum, archive) => sum + archive.completedMatches, 0),
      uniqueSongs: songStats.size,
      uniqueTalents: talentStats.size
    },
    songStats: sortedSongsByWins,
    talentStats: sortedTalentsByWins,
    rivalryStats: sortedRivalries,
    finalsRivalryStats: sortedFinalsRivalries,
    topSongsByWins: sortedSongsByWins.slice(0, 10),
    topSongsByTitles: sortedSongsByTitles.slice(0, 10),
    topSongsByRunnerUps: sortedSongsByRunnerUps.slice(0, 10),
    topSongsByDeepRuns: sortedSongsByDeepRuns.slice(0, 10),
    topSongsByEarlyExits: sortedSongsByEarlyExits.slice(0, 10),
    topSongsByStrengthOfWins: sortedSongsByStrengthOfWins.slice(0, 10),
    topSongsByStrengthOfLosses: sortedSongsByStrengthOfLosses.slice(0, 10),
    topSongsByClutchRate: sortedSongsByClutchRate.slice(0, 10),
    topSongsByPressureEdge: sortedSongsByPressureEdge.slice(0, 10),
    topSongsByPunchingAbove: sortedSongsByPunchingAbove.slice(0, 10),
    topSongsByUpsetResilience: sortedSongsByUpsetResilience.slice(0, 10),
    topSongsByWinRate: [...songs].sort((left, right) => right.winRate - left.winRate || byWins(left, right)).slice(0, 10),
    topSongsByAppearances: [...songs].sort((left, right) => right.appearances - left.appearances || byWins(left, right)).slice(0, 10),
    topSongsByFinalsWithoutTitle: [...songs]
      .filter((song) => finalsWithoutTitle(song) > 0)
      .sort((left, right) => finalsWithoutTitle(right) - finalsWithoutTitle(left) || right.finalistCount - left.finalistCount || byWins(left, right))
      .slice(0, 10),
    topSongsByFirstRoundEliminations: [...songs]
      .filter((song) => song.firstRoundEliminations > 0)
      .sort((left, right) => right.firstRoundEliminations - left.firstRoundEliminations || right.appearances - left.appearances || byWins(left, right))
      .slice(0, 10),
    topSongsByUpsetWins: [...songs]
      .filter((song) => song.upsetWins > 0)
      .sort((left, right) => right.upsetWins - left.upsetWins || right.giantKillerScore - left.giantKillerScore || byWins(left, right) || bySongTitle(left, right))
      .slice(0, 10),
    topSongsByRevengeWins: [...songs]
      .filter((song) => song.revengeWins > 0)
      .sort((left, right) => right.revengeWins - left.revengeWins || byWins(left, right) || bySongTitle(left, right))
      .slice(0, 10),
    topSongsByGiantKillerScore: [...songs]
      .filter((song) => song.giantKillerScore > 0)
      .sort((left, right) => right.giantKillerScore - left.giantKillerScore || right.upsetWins - left.upsetWins || byWins(left, right) || bySongTitle(left, right))
      .slice(0, 10),
    topSongsByGiantKillerAverage: [...songs]
      .filter((song) => song.giantKillerScore > 0 && song.upsetWins > 0)
      .sort(
        (left, right) =>
          giantKillerAverageScore(right) - giantKillerAverageScore(left) ||
          right.giantKillerScore - left.giantKillerScore ||
          right.upsetWins - left.upsetWins ||
          byWins(left, right) ||
          bySongTitle(left, right)
      )
      .slice(0, 10),
    topSongsByBigGameScore: [...songs]
      .filter((song) => song.bigGameScore > 0 && song.bigGameWins > 0)
      .sort(
        (left, right) =>
          right.bigGameScore - left.bigGameScore ||
          bigGameAverageScore(right) - bigGameAverageScore(left) ||
          right.bigGameWins - left.bigGameWins ||
          byWins(left, right) ||
          bySongTitle(left, right)
      )
      .slice(0, 10),
    topSongsByBigGameAverage: [...songs]
      .filter((song) => song.bigGameScore > 0 && song.bigGameWins > 0)
      .sort(
        (left, right) =>
          bigGameAverageScore(right) - bigGameAverageScore(left) ||
          right.bigGameScore - left.bigGameScore ||
          right.bigGameWins - left.bigGameWins ||
          byWins(left, right) ||
          bySongTitle(left, right)
      )
      .slice(0, 10),
    topSongsByHighStakesPerformance: [...songs]
      .filter((song) => song.highStakesPerformanceRate > 0 && song.highStakesPerformanceWins > 0)
      .sort(
        (left, right) =>
          right.highStakesPerformanceRate - left.highStakesPerformanceRate ||
          right.highStakesPerformanceWins - left.highStakesPerformanceWins ||
          right.highStakesPerformanceMatches - left.highStakesPerformanceMatches ||
          right.bigGameScore - left.bigGameScore ||
          bySongTitle(left, right)
      )
      .slice(0, 10),
    topTalents: sortedTalentsByWins.slice(0, 10),
    topTalentsByWins: sortedTalentsByWins.slice(0, 10),
    topTalentsByTitles: sortedTalentsByTitles.slice(0, 10),
    topTalentsByRunnerUps: sortedTalentsByRunnerUps.slice(0, 10),
    topTalentsByFinalsConversion: sortedTalentsByFinalsConversion.slice(0, 10),
    topTalentsByDeepRuns: sortedTalentsByDeepRuns.slice(0, 10),
    topTalentsByDeepRunRate: sortedTalentsByDeepRunRate.slice(0, 10),
    topTalentsByEarlyExits: sortedTalentsByEarlyExits.slice(0, 10),
    topTalentsByEarlyExitRate: sortedTalentsByEarlyExitRate.slice(0, 10),
    topTalentsByTop4: sortedTalentsByDeepRuns.slice(0, 10),
    topTalentsByStrengthOfWins: sortedTalentsByStrengthOfWins.slice(0, 10),
    topTalentsByStrengthOfLosses: sortedTalentsByStrengthOfLosses.slice(0, 10),
    topTalentsByPunchingAbove: sortedTalentsByPunchingAbove.slice(0, 10),
    topTalentsByClutchRate: sortedTalentsByClutchRate.slice(0, 10),
    topTalentsByPressureEdge: sortedTalentsByPressureEdge.slice(0, 10),
    topTalentsByUpsetResilience: sortedTalentsByUpsetResilience.slice(0, 10),
    topSongRatings: buildRatingRows(
      songs,
      (song) => song.canonicalPerformanceKey,
      (song) => song.title,
      (song) => song.idolName ?? null,
      songRatings
    ),
    topTalentRatings: buildRatingRows(
      talents,
      (talent) => talent.idolId,
      (talent) => talent.idolName,
      () => null,
      talentRatings
    ),
    topRivalries: sortedRivalries.slice(0, 10),
    championHistory: archives.slice(0, 12)
  };
}

function createMockHololiveBracket(payload: IpcChannelMap["hololive:brackets:create"]["request"]): HololiveBracket {
  const size = payload.size;
  const generationStyle: HololiveBracketGenerationStyle = payload.generationStyle ?? "top_songs";
  const sizeCount = MOCK_BRACKET_SIZE_COUNTS[size];
  const id = `mock-bracket-${crypto.randomUUID()}`;
  const officialIdols = mockHololiveTierData.idols.filter((idol) => idol.source === "official");
  const entries: HololiveBracketEntry[] = [];

  for (let index = 0; entries.length < sizeCount; index += 1) {
    const idol = officialIdols[index % Math.max(officialIdols.length, 1)];
    const isOriginal = generationStyle === "random_songs" ? (index + idol.id.length) % 2 === 0 : index % 2 === 0;
    const title = `${idol?.displayName ?? "Mock Talent"} ${isOriginal ? "Original" : "Cover"} ${Math.floor(index / 2) + 1}`;
    entries.push({
      id: `${id}:entry:${entries.length}`,
      bracketId: id,
      slotIndex: entries.length,
      youtubeVideoId: `${id}-video-${entries.length}`,
      title,
      songName: title,
      topicId: isOriginal ? "Original_Song" : "Music_Cover",
      youtubeUrl: `https://www.youtube.com/watch?v=${id}-video-${entries.length}`,
      channelName: `${idol?.displayName ?? "Mock Talent"} Channel`,
      idolId: idol?.id ?? "mock-talent",
      idolName: idol?.displayName ?? "Mock Talent",
      canonicalPerformanceKey: `${id}:canonical:${entries.length}`,
      viewCount: 1_000_000 - entries.length * 1000,
      publishedAt: now,
      durationSeconds: 210
    });
  }

  const rounds: HololiveBracketRound[] = [];
  for (let roundIndex = 0; roundIndex < Math.log2(sizeCount); roundIndex += 1) {
    const matchesInRound = sizeCount / 2 ** (roundIndex + 1);
    const matches: HololiveBracketMatch[] = [];
    for (let matchIndex = 0; matchIndex < matchesInRound; matchIndex += 1) {
      matches.push({
        id: `${id}:r${roundIndex}:m${matchIndex}`,
        bracketId: id,
        roundIndex,
        matchIndex,
        entryA: roundIndex === 0 ? entries[matchIndex * 2] ?? null : null,
        entryB: roundIndex === 0 ? entries[matchIndex * 2 + 1] ?? null : null,
        winnerEntryId: null,
        winner: null,
        completedAt: null,
        updatedAt: now
      });
    }
    rounds.push({
      roundIndex,
      label: getMockHololiveBracketRoundLabel(sizeCount, roundIndex),
      matches
    });
  }

  const bracket = updateMockHololiveBracketProgress({
    id,
    name: payload.name?.trim() || `${size} Bracket`,
    size,
    generationStyle,
    generationFilters: payload.filters ?? {},
    seed: id,
    status: "active",
    currentMatchId: `${id}:r0:m0`,
    currentMatch: rounds[0]?.matches[0] ?? null,
    champion: null,
    entries,
    rounds,
    createdAt: now,
    updatedAt: now
  });
  mockHololiveBrackets.set(id, bracket);
  return bracket;
}

function getMockHololiveBracketRoundLabel(sizeCount: number, roundIndex: number): string {
  return hololiveBracketRoundLabel(sizeCount, roundIndex);
}

function getMockHololiveBracket(bracketId: string): HololiveBracket {
  const bracket = mockHololiveBrackets.get(bracketId);
  if (!bracket) {
    throw new Error(`Unknown mock bracket: ${bracketId}`);
  }
  return bracket;
}

function updateMockHololiveBracketProgress(bracket: HololiveBracket): HololiveBracket {
  const rounds = bracket.rounds.map((round) => ({
    ...round,
    matches: round.matches.map((match) => ({
      ...match,
      winner: match.winnerEntryId ? bracket.entries.find((entry) => entry.id === match.winnerEntryId) ?? null : null
    }))
  }));
  const matches = rounds.flatMap((round) => round.matches);
  const currentMatch = matches.find((match) => match.entryA && match.entryB && !match.winnerEntryId) ?? null;
  const finalMatch = rounds[rounds.length - 1]?.matches[0] ?? null;
  const champion = finalMatch?.winner ?? null;
  return {
    ...bracket,
    rounds,
    status: champion ? "complete" : "active",
    currentMatchId: champion ? null : currentMatch?.id ?? null,
    currentMatch,
    champion,
    updatedAt: new Date().toISOString()
  };
}

function clearMockHololiveBracketDownstream(
  bracket: HololiveBracket,
  roundIndex: number,
  matchIndex: number
): void {
  const nextRound = bracket.rounds[roundIndex + 1];
  const nextMatch = nextRound?.matches[Math.floor(matchIndex / 2)];
  if (!nextMatch) {
    return;
  }

  if (matchIndex % 2 === 0) {
    nextMatch.entryA = null;
  } else {
    nextMatch.entryB = null;
  }
  nextMatch.winnerEntryId = null;
  nextMatch.winner = null;
  nextMatch.completedAt = null;
  nextMatch.updatedAt = new Date().toISOString();
  clearMockHololiveBracketDownstream(bracket, roundIndex + 1, Math.floor(matchIndex / 2));
}

function pickMockHololiveBracketWinner(
  payload: IpcChannelMap["hololive:brackets:pick-winner"]["request"]
): HololiveBracket {
  const bracket = structuredClone(getMockHololiveBracket(payload.bracketId)) as HololiveBracket;
  const match = bracket.rounds
    .flatMap((round) => round.matches)
    .find((candidate) => candidate.id === payload.matchId);
  if (!match || !match.entryA || !match.entryB) {
    throw new Error("This mock matchup is not ready");
  }
  if (payload.winnerEntryId !== match.entryA.id && payload.winnerEntryId !== match.entryB.id) {
    throw new Error("The mock winner is not in this matchup");
  }

  clearMockHololiveBracketDownstream(bracket, match.roundIndex, match.matchIndex);
  match.winnerEntryId = payload.winnerEntryId;
  match.winner = bracket.entries.find((entry) => entry.id === payload.winnerEntryId) ?? null;
  match.completedAt = new Date().toISOString();
  match.updatedAt = match.completedAt;
  const nextMatch = bracket.rounds[match.roundIndex + 1]?.matches[Math.floor(match.matchIndex / 2)];
  if (nextMatch && match.winner) {
    if (match.matchIndex % 2 === 0) {
      nextMatch.entryA = match.winner;
    } else {
      nextMatch.entryB = match.winner;
    }
  }

  const updated = updateMockHololiveBracketProgress(bracket);
  mockHololiveBrackets.set(updated.id, updated);
  archiveMockHololiveBracket(updated);
  return updated;
}

function undoMockHololiveBracket(bracketId: string): HololiveBracket {
  const bracket = structuredClone(getMockHololiveBracket(bracketId)) as HololiveBracket;
  const completed = bracket.rounds
    .flatMap((round) => round.matches)
    .filter((match) => match.winnerEntryId)
    .sort(
      (left, right) =>
        (right.completedAt ?? right.updatedAt).localeCompare(left.completedAt ?? left.updatedAt) ||
        right.roundIndex - left.roundIndex ||
        right.matchIndex - left.matchIndex
    )[0];
  if (!completed) {
    return bracket;
  }

  clearMockHololiveBracketDownstream(bracket, completed.roundIndex, completed.matchIndex);
  completed.winnerEntryId = null;
  completed.winner = null;
  completed.completedAt = null;
  completed.updatedAt = new Date().toISOString();
  const updated = updateMockHololiveBracketProgress(bracket);
  mockHololiveBrackets.set(updated.id, updated);
  return updated;
}

function resetMockHololiveBracket(bracketId: string): HololiveBracket {
  const bracket = structuredClone(getMockHololiveBracket(bracketId)) as HololiveBracket;
  for (const round of bracket.rounds) {
    for (const match of round.matches) {
      if (round.roundIndex > 0) {
        match.entryA = null;
        match.entryB = null;
      }
      match.winnerEntryId = null;
      match.winner = null;
      match.completedAt = null;
      match.updatedAt = new Date().toISOString();
    }
  }
  const updated = updateMockHololiveBracketProgress(bracket);
  mockHololiveBrackets.set(updated.id, updated);
  return updated;
}

function duplicateMockHololiveBracket(bracketId: string): HololiveBracket {
  const source = getMockHololiveBracket(bracketId);
  const id = `mock-bracket-${crypto.randomUUID()}`;
  const entryIdBySourceId = new Map<string, string>();
  const entries = source.entries.map((entry) => {
    const nextId = `${id}:entry:${entry.slotIndex}`;
    entryIdBySourceId.set(entry.id, nextId);
    return {
      ...entry,
      id: nextId,
      bracketId: id
    };
  });
  const rounds = source.rounds.map((round) => ({
    ...round,
    matches: round.matches.map((match) => ({
      id: `${id}:r${match.roundIndex}:m${match.matchIndex}`,
      bracketId: id,
      roundIndex: match.roundIndex,
      matchIndex: match.matchIndex,
      entryA: match.roundIndex === 0 && match.entryA ? entries.find((entry) => entry.id === entryIdBySourceId.get(match.entryA?.id ?? "")) ?? null : null,
      entryB: match.roundIndex === 0 && match.entryB ? entries.find((entry) => entry.id === entryIdBySourceId.get(match.entryB?.id ?? "")) ?? null : null,
      winnerEntryId: null,
      winner: null,
      completedAt: null,
      updatedAt: new Date().toISOString()
    }))
  }));
  const duplicate = updateMockHololiveBracketProgress({
    ...source,
    id,
    name: `Copy of ${source.name}`.slice(0, 120),
    seed: id,
    status: "active",
    currentMatchId: `${id}:r0:m0`,
    currentMatch: null,
    champion: null,
    entries,
    rounds,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
  mockHololiveBrackets.set(id, duplicate);
  return duplicate;
}

const mockBridge: HoloshelfBridge = {
  onHololiveRefreshProgress() {
    return () => undefined;
  },
  onUpdateStatus() {
    return () => undefined;
  },
  async invoke<C extends IpcChannel>(
    channel: C,
    _payload: IpcChannelMap[C]["request"]
  ): Promise<IpcChannelMap[C]["response"]> {
    switch (channel) {
      case "app:bootstrap":
        return mockBootstrap as IpcChannelMap[C]["response"];
      case "settings:get":
        return mockSettings as IpcChannelMap[C]["response"];
      case "settings:set":
        {
          const payload = _payload as IpcChannelMap["settings:set"]["request"];
          mockSettings[payload.key] = payload.value;
          return mockSettings as IpcChannelMap[C]["response"];
        }
      case "updates:status":
        return mockUpdateStatus as IpcChannelMap[C]["response"];
      case "updates:check":
        mockUpdateStatus = {
          ...mockUpdateStatus,
          state: "unsupported",
          message: "Updates are available only in the packaged Windows app.",
          updatedAt: new Date().toISOString()
        };
        return mockUpdateStatus as IpcChannelMap[C]["response"];
      case "updates:install":
        return mockUpdateStatus as IpcChannelMap[C]["response"];
      case "updates:installed-release":
        return mockInstalledUpdateRelease as IpcChannelMap[C]["response"];
      case "updates:installed-release:dismiss":
        mockInstalledUpdateRelease = null;
        return { dismissed: true } as IpcChannelMap[C]["response"];
      case "app:save-image":
        return { filePath: "mock-bracket-export.png" } as IpcChannelMap[C]["response"];
      case "app:open-path":
        return { opened: true } as IpcChannelMap[C]["response"];
      case "app:data-backup:export":
        return {
          exported: true,
          filePath: "Documents\\Holoshelf Backups\\Holoshelf Backup mock.holoshelf-backup",
          canceled: false
        } as IpcChannelMap[C]["response"];
      case "app:data-backup:import":
        return {
          imported: true,
          backupFilePath: "data\\backups\\holoshelf.pre-import.mock.sqlite",
          importedFromPath: "Documents\\Holoshelf Backups\\Holoshelf Backup mock.holoshelf-backup",
          requiresRestart: true
        } as IpcChannelMap[C]["response"];
      case "app:data:reset":
        return {
          reset: true,
          backupFilePath: "data\\backups\\holoshelf.pre-reset.mock.sqlite",
          requiresRestart: true
        } as IpcChannelMap[C]["response"];
      case "catalog:list":
        return [] as CatalogItem[] as IpcChannelMap[C]["response"];
      case "source:health-check":
        return mockBootstrap.sourceHealth as IpcChannelMap[C]["response"];
      case "fetch:list":
        return [] as IpcChannelMap[C]["response"];
      case "fetch:enqueue":
      case "fetch:run-next":
      case "fetch:cancel":
        return null as IpcChannelMap[C]["response"];
      case "import:open-csv":
        return null as IpcChannelMap[C]["response"];
      case "import:apply-csv":
        return { inserted: 0, skipped: 0 } as IpcChannelMap[C]["response"];
      case "hololive:tier-data":
      case "hololive:board:create":
      case "hololive:board:update":
      case "hololive:board:reorder":
      case "hololive:board:delete":
      case "hololive:board:clear":
      case "hololive:tier:create":
      case "hololive:tier:update":
      case "hololive:tier:delete":
      case "hololive:tier:reorder":
      case "hololive:placement:move":
      case "hololive:unranked:sort":
        if (channel === "hololive:tier-data") {
          loadMockHololiveBoard((_payload as IpcChannelMap["hololive:tier-data"]["request"])?.boardId);
        }
        if (channel === "hololive:board:create") {
          createMockHololiveBoard(_payload as IpcChannelMap["hololive:board:create"]["request"]);
        }
        if (channel === "hololive:board:update") {
          updateMockHololiveBoard(_payload as IpcChannelMap["hololive:board:update"]["request"]);
        }
        if (channel === "hololive:board:reorder") {
          reorderMockHololiveBoards(_payload as IpcChannelMap["hololive:board:reorder"]["request"]);
        }
        if (channel === "hololive:board:delete") {
          const snapshot = structuredClone(mockHololiveTierData);
          deleteMockHololiveBoard((_payload as IpcChannelMap["hololive:board:delete"]["request"]).boardId);
          return {
            data: mockHololiveTierData,
            ...createMockUndo("tier-board-delete", () => {
              mockHololiveTierData = snapshot;
            })
          } as IpcChannelMap[C]["response"];
        }
        if (channel === "hololive:tier:create") {
          createMockHololiveTier(_payload as IpcChannelMap["hololive:tier:create"]["request"]);
        }
        if (channel === "hololive:tier:update") {
          updateMockHololiveTier(_payload as IpcChannelMap["hololive:tier:update"]["request"]);
        }
        if (channel === "hololive:tier:delete") {
          deleteMockHololiveTier(_payload as IpcChannelMap["hololive:tier:delete"]["request"]);
        }
        if (channel === "hololive:placement:move") {
          moveMockHololiveIdol(_payload as IpcChannelMap["hololive:placement:move"]["request"]);
        }
        if (channel === "hololive:board:clear") {
          const snapshot = structuredClone(mockHololiveTierData);
          clearMockHololiveBoard();
          return {
            data: mockHololiveTierData,
            ...createMockUndo("tier-board-clear", () => {
              mockHololiveTierData = snapshot;
            })
          } as IpcChannelMap[C]["response"];
        }
        if (channel === "hololive:unranked:sort") {
          sortMockHololiveUnranked();
        }
        if (channel === "hololive:tier:reorder") {
          reorderMockHololiveTiers(_payload as IpcChannelMap["hololive:tier:reorder"]["request"]);
        }
        return mockHololiveTierData as IpcChannelMap[C]["response"];
      case "hololive:icons:refresh":
        return { cached: 0, failed: 0 } as IpcChannelMap[C]["response"];
      case "hololive:idol:profile":
        return getMockHololiveIdolProfile(
          (_payload as IpcChannelMap["hololive:idol:profile"]["request"]).idolId
        ) as IpcChannelMap[C]["response"];
      case "hololive:profile:playback-context":
        return getMockHololiveProfilePlaybackContext(
          _payload as IpcChannelMap["hololive:profile:playback-context"]["request"]
        ) as IpcChannelMap[C]["response"];
      case "hololive:music:import-artifacts":
      case "hololive:music:refresh":
        return {
          run: {
            id: "mock-holodex-run",
            source: channel === "hololive:music:refresh" ? "live" : "artifact",
            status: "completed",
            startedAt: now,
            completedAt: now,
            fetchedRows: 0,
            keptRows: 0,
            filteredRows: 0,
            duplicateRows: 0,
            error: null
          },
          sourceRows: 0,
          idolMatchedRows: 0,
          importedRows: 0,
          detailCacheRows: 0,
          duplicateRows: 0
        } as IpcChannelMap[C]["response"];
      case "hololive:music-video-stats:refresh":
        return {
          requestedVideos: visibleMockHololiveMusicRows().length,
          updatedVideos: visibleMockHololiveMusicRows().length,
          missingVideos: 0,
          unavailableVideos: 0,
          failedBatches: 0,
          batches: 1,
          fetchedAt: now
        } as IpcChannelMap[C]["response"];
      case "hololive:official-data:refresh":
      case "hololive:data:refresh":
        return {
          channelRefresh: {
            refreshedChannels: mockHolodexChannels.length,
            classifiedChannels: mockHololiveTierData.idols.length,
            updatedAt: now
          },
          musicRefresh: {
            run: {
              id: "mock-full-refresh-run",
              source: "live",
              status: "completed",
              startedAt: now,
              completedAt: now,
              fetchedRows: visibleMockHololiveMusicRows().length,
              keptRows: visibleMockHololiveMusicRows().length,
              filteredRows: 0,
              duplicateRows: 0,
              error: null
            },
            sourceRows: visibleMockHololiveMusicRows().length,
            idolMatchedRows: visibleMockHololiveMusicRows().length,
            importedRows: visibleMockHololiveMusicRows().length,
            detailCacheRows: visibleMockHololiveMusicRows().length,
            duplicateRows: 0
          },
          videoStatsRefresh: {
            requestedVideos: visibleMockHololiveMusicRows().length,
            updatedVideos: visibleMockHololiveMusicRows().length,
            missingVideos: 0,
            unavailableVideos: 0,
            failedBatches: 0,
            batches: 1,
            fetchedAt: now
          },
          updatedAt: now
        } as IpcChannelMap[C]["response"];
      case "hololive:music:status":
        return { latestRun: null, totalRows: 0 } as IpcChannelMap[C]["response"];
      case "hololive:music:list":
        {
          const payload = (_payload ?? {}) as IpcChannelMap["hololive:music:list"]["request"];
          let rows = visibleMockHololiveMusicRows();
          if (payload?.youtubeVideoIds?.length) {
            const ids = new Set(payload.youtubeVideoIds);
            rows = rows.filter((row) => ids.has(row.youtubeVideoId));
          }
          if (payload?.topicId) {
            rows = rows.filter((row) => row.topicId === payload.topicId);
          }
          if (payload?.query) {
            const query = payload.query.toLowerCase();
            rows = rows.filter((row) =>
              `${row.title} ${row.songName ?? ""} ${row.channelName}`.toLowerCase().includes(query)
            );
          }
          return rows.slice(0, payload?.limit ?? 100) as IpcChannelMap[C]["response"];
        }
      case "hololive:music:library":
        {
          const payload = (_payload ?? {}) as IpcChannelMap["hololive:music:library"]["request"];
          let rows = visibleMockHololiveMusicRows();
          if (payload?.topicId) {
            rows = rows.filter((row) => row.topicId === payload.topicId);
          }
          if (payload?.sourceKind) {
            rows = rows.filter((row) => (row.sourceKind ?? "official") === payload.sourceKind);
          }
          if (payload?.talentId) {
            rows = rows.filter(
              (row) =>
                row.idolId === payload.talentId ||
                row.participants.some((participant) => participant.idolId === payload.talentId) ||
                row.ownedIdolIds.includes(payload.talentId ?? "") ||
                row.featuredIdolIds.includes(payload.talentId ?? "")
            );
          }
          if (payload?.collabScope === "solo") {
            rows = rows.filter(
              (row) =>
                row.ownedIdolIds.length === 1 &&
                row.featuredIdolIds.length === 0 &&
                new Set(row.participants.map((participant) => participant.idolId)).size <= 1 &&
                row.uploaderChannelKind !== "group"
            );
          }
          if (payload?.marker) {
            rows = rows.filter((row) => row.marker === payload.marker);
          }
          if (payload?.query) {
            const query = payload.query.toLowerCase();
            rows = rows.filter((row) =>
              `${row.title} ${row.songName ?? ""} ${row.channelName}`.toLowerCase().includes(query)
            );
          }
          const titleCompare = (left: HololiveMusicRow, right: HololiveMusicRow) =>
            (left.songName ?? left.title).localeCompare(right.songName ?? right.title) ||
            left.youtubeVideoId.localeCompare(right.youtubeVideoId);
          switch (payload?.sort ?? "newest") {
            case "oldest":
              rows = [...rows].sort(
                (left, right) =>
                  Number(!left.publishedAt) - Number(!right.publishedAt) ||
                  (left.publishedAt ?? "").localeCompare(right.publishedAt ?? "") ||
                  titleCompare(left, right)
              );
              break;
            case "views_desc":
              rows = [...rows].sort(
                (left, right) =>
                  Number(left.viewCount == null) - Number(right.viewCount == null) ||
                  (right.viewCount ?? 0) - (left.viewCount ?? 0) ||
                  (right.publishedAt ?? "").localeCompare(left.publishedAt ?? "") ||
                  titleCompare(left, right)
              );
              break;
            case "views_asc":
              rows = [...rows].sort(
                (left, right) =>
                  Number(left.viewCount == null) - Number(right.viewCount == null) ||
                  (left.viewCount ?? 0) - (right.viewCount ?? 0) ||
                  (right.publishedAt ?? "").localeCompare(left.publishedAt ?? "") ||
                  titleCompare(left, right)
              );
              break;
            case "newest":
            default:
              rows = [...rows].sort(
                (left, right) =>
                  (right.publishedAt ?? "").localeCompare(left.publishedAt ?? "") ||
                  titleCompare(left, right)
              );
              break;
          }
          const offset = payload?.offset ?? 0;
          const limit = payload?.limit ?? 50;
          const response: HololiveMusicLibraryResponse = {
            rows: rows.slice(offset, offset + limit),
            total: rows.length,
            offset,
            limit
          };
          return response as IpcChannelMap[C]["response"];
        }
      case "hololive:music-marker:set":
        {
          const payload = _payload as IpcChannelMap["hololive:music-marker:set"]["request"];
          const updatedAt = payload.marker ? new Date().toISOString() : null;
          const response = {
            youtubeVideoId: payload.youtubeVideoId,
            markerKey: `video:${payload.youtubeVideoId}`,
            marker: payload.marker,
            updatedAt
          };
          if (payload.marker) {
            mockHololiveMusicMarkers[payload.youtubeVideoId] = response;
            if (payload.marker !== "favorite") {
              delete mockFavoritePositions[payload.youtubeVideoId];
            }
          } else {
            delete mockHololiveMusicMarkers[payload.youtubeVideoId];
            delete mockFavoritePositions[payload.youtubeVideoId];
          }
          return response as IpcChannelMap[C]["response"];
        }
      case "hololive:music:exclude":
        {
          const payload = _payload as IpcChannelMap["hololive:music:exclude"]["request"];
          const exclusionsSnapshot = structuredClone(mockHololiveMusicExclusions);
          const markersSnapshot = structuredClone(mockHololiveMusicMarkers);
          const favoritePositionsSnapshot = structuredClone(mockFavoritePositions);
          const playerSnapshot = structuredClone(mockHololivePlayerData);
          const response = {
            youtubeVideoId: payload.youtubeVideoId,
            titleSnapshot: payload.title ?? null,
            sourceUrlSnapshot: payload.sourceUrl ?? null,
            createdAt: new Date().toISOString()
          };
          mockHololiveMusicExclusions[payload.youtubeVideoId] = response;
          delete mockHololiveMusicMarkers[payload.youtubeVideoId];
          delete mockFavoritePositions[payload.youtubeVideoId];
          mockHololivePlayerData = {
            ...mockHololivePlayerData,
            queue: mockHololivePlayerData.queue.filter((item) => item.youtubeVideoId !== payload.youtubeVideoId),
            playlists: mockHololivePlayerData.playlists.map((playlist) => ({
              ...playlist,
              items: (playlist.items ?? []).filter((item) => item.youtubeVideoId !== payload.youtubeVideoId)
            })),
            state:
              mockHololivePlayerData.state.currentYoutubeVideoId === payload.youtubeVideoId
                ? {
                    ...mockHololivePlayerData.state,
                    playbackSourceType: "library",
                    currentQueueItemId: null,
                    currentPlaylistId: null,
                    currentPlaylistItemId: null,
                    currentYoutubeVideoId: null,
                    updatedAt: new Date().toISOString()
                  }
                : mockHololivePlayerData.state
          };
          return {
            data: response,
            ...createMockUndo("music-exclusion", () => {
              Object.keys(mockHololiveMusicExclusions).forEach((key) => delete mockHololiveMusicExclusions[key]);
              Object.assign(mockHololiveMusicExclusions, exclusionsSnapshot);
              Object.keys(mockHololiveMusicMarkers).forEach((key) => delete mockHololiveMusicMarkers[key]);
              Object.assign(mockHololiveMusicMarkers, markersSnapshot);
              Object.keys(mockFavoritePositions).forEach((key) => delete mockFavoritePositions[key]);
              Object.assign(mockFavoritePositions, favoritePositionsSnapshot);
              mockHololivePlayerData = playerSnapshot;
            })
          } as IpcChannelMap[C]["response"];
        }
      case "hololive:music:mark-unavailable":
        {
          const payload = _payload as IpcChannelMap["hololive:music:mark-unavailable"]["request"];
          const row = visibleMockHololiveMusicRows().find((candidate) => candidate.youtubeVideoId === payload.youtubeVideoId) ?? null;
          const replacement =
            row
              ? visibleMockHololiveMusicRows()
                  .filter((candidate) => candidate.youtubeVideoId !== row.youtubeVideoId)
                  .filter(
                    (candidate) =>
                      candidate.topicId === row.topicId &&
                      ((row.canonicalPerformanceKey &&
                        candidate.canonicalPerformanceKey === row.canonicalPerformanceKey) ||
                        (row.canonicalSongKey && candidate.canonicalSongKey === row.canonicalSongKey))
                  )
                  .sort(
                    (left, right) =>
                      Number(right.canonicalPerformanceKey === row.canonicalPerformanceKey) -
                        Number(left.canonicalPerformanceKey === row.canonicalPerformanceKey) ||
                      (right.publishedAt ?? "").localeCompare(left.publishedAt ?? "") ||
                      left.title.localeCompare(right.title)
                  )[0] ?? null
              : null;
          let replacementId = replacement?.youtubeVideoId ?? null;
          mockHololiveMusicExclusions[payload.youtubeVideoId] = {
            youtubeVideoId: payload.youtubeVideoId,
            titleSnapshot: payload.title ?? row?.title ?? null,
            sourceUrlSnapshot: payload.sourceUrl ?? row?.youtubeUrl ?? null,
            createdAt: new Date().toISOString()
          };
          if (replacement) {
            const replacementVideoId = replacement.youtubeVideoId;
            replacementId = replacementVideoId;
            const marker = mockHololiveMusicMarkers[payload.youtubeVideoId];
            if (marker) {
              mockHololiveMusicMarkers[replacementVideoId] = {
                ...marker,
                youtubeVideoId: replacementVideoId,
                markerKey: `video:${replacementVideoId}`
              };
              delete mockHololiveMusicMarkers[payload.youtubeVideoId];
            }
            mockHololivePlayerData = {
              ...mockHololivePlayerData,
              queue: mockHololivePlayerData.queue.map((item) =>
                item.youtubeVideoId === payload.youtubeVideoId
                  ? {
                      ...item,
                      youtubeVideoId: replacementVideoId,
                      titleSnapshot: replacement.songName || replacement.title,
                      sourceUrlSnapshot: replacement.youtubeUrl
                    }
                  : item
              ),
              playlists: mockHololivePlayerData.playlists.map((playlist) => ({
                ...playlist,
                items: (playlist.items ?? []).map((item) =>
                  item.youtubeVideoId === payload.youtubeVideoId
                    ? {
                        ...item,
                        youtubeVideoId: replacementVideoId,
                        titleSnapshot: replacement.songName || replacement.title,
                        sourceUrlSnapshot: replacement.youtubeUrl
                      }
                    : item
                )
              })),
              state:
                mockHololivePlayerData.state.currentYoutubeVideoId === payload.youtubeVideoId
                  ? {
                      ...mockHololivePlayerData.state,
                      currentYoutubeVideoId: replacementVideoId,
                      updatedAt: new Date().toISOString()
                    }
                  : mockHololivePlayerData.state
            };
          } else {
            mockHololivePlayerData = {
              ...mockHololivePlayerData,
              queue: mockHololivePlayerData.queue.filter((item) => item.youtubeVideoId !== payload.youtubeVideoId),
              playlists: mockHololivePlayerData.playlists.map((playlist) => ({
                ...playlist,
                items: (playlist.items ?? []).filter((item) => item.youtubeVideoId !== payload.youtubeVideoId)
              })),
              state:
                mockHololivePlayerData.state.currentYoutubeVideoId === payload.youtubeVideoId
                  ? {
                      ...mockHololivePlayerData.state,
                      playbackSourceType: "library",
                      currentQueueItemId: null,
                      currentPlaylistId: null,
                      currentPlaylistItemId: null,
                      currentYoutubeVideoId: null,
                      updatedAt: new Date().toISOString()
                    }
                  : mockHololivePlayerData.state
            };
          }
          return {
            removedYoutubeVideoId: payload.youtubeVideoId,
            replacementYoutubeVideoId: replacementId,
            replacementTitle: replacement?.songName || replacement?.title || null,
            data: refreshMockHololivePlayerData()
          } as IpcChannelMap[C]["response"];
        }
      case "hololive:custom-songs:preview":
        {
          const payload = _payload as IpcChannelMap["hololive:custom-songs:preview"]["request"];
          const youtubeVideoId = parseMockYouTubeVideoId(payload.youtubeUrl);
          if (!youtubeVideoId) {
            throw new Error("Enter a valid YouTube video link.");
          }
          const usedApi = /prefill|api/i.test(payload.youtubeUrl);
          return {
            youtubeVideoId,
            youtubeUrl: mockYouTubeUrl(youtubeVideoId),
            title: usedApi ? "Mock Imported Song" : null,
            songName: usedApi ? "Mock Imported Song" : null,
            channelId: usedApi ? "UCmockImportedSong" : null,
            channelName: usedApi ? "Mock Import Channel" : null,
            publishedAt: usedApi ? now : null,
            durationSeconds: usedApi ? 201 : null,
            viewCount: usedApi ? 123456 : null,
            fetchedAt: usedApi ? now : null,
            thumbnailUrl: null,
            usedApi,
            apiKeyMissing: !usedApi
          } as IpcChannelMap[C]["response"];
        }
      case "hololive:custom-songs:upsert":
        return upsertMockCustomSong(_payload as IpcChannelMap["hololive:custom-songs:upsert"]["request"]) as IpcChannelMap[C]["response"];
      case "hololive:custom-songs:delete":
        return deleteMockCustomSong((_payload as IpcChannelMap["hololive:custom-songs:delete"]["request"]).youtubeVideoId) as IpcChannelMap[C]["response"];
      case "hololive:channels:refresh":
        return { refreshedChannels: mockHolodexChannels.length, classifiedChannels: mockHololiveTierData.idols.length, updatedAt: now } as IpcChannelMap[C]["response"];
      case "hololive:channels:list":
        return mockHolodexChannels as IpcChannelMap[C]["response"];
      case "hololive:custom-talents:resolve":
        return resolveMockCustomTalentPreview(
          _payload as IpcChannelMap["hololive:custom-talents:resolve"]["request"]
        ) as IpcChannelMap[C]["response"];
      case "hololive:custom-talents:upsert":
        return upsertMockCustomTalent(
          _payload as IpcChannelMap["hololive:custom-talents:upsert"]["request"]
        ) as IpcChannelMap[C]["response"];
      case "hololive:custom-talents:delete":
        deleteMockCustomTalent((_payload as IpcChannelMap["hololive:custom-talents:delete"]["request"]).idolId);
        return mockHololiveTierData as IpcChannelMap[C]["response"];
      case "hololive:custom-talents:refresh":
        return {
          musicRefresh: {
            run: {
              id: "mock-custom-holodex-run",
              source: "live",
              status: "completed",
              startedAt: now,
              completedAt: now,
              fetchedRows: 2,
              keptRows: 2,
              filteredRows: 0,
              duplicateRows: 0,
              error: null
            },
            sourceRows: 2,
            idolMatchedRows: 2,
            importedRows: 2,
            detailCacheRows: 2,
            duplicateRows: 0
          },
          videoStatsRefresh: {
            requestedVideos: visibleMockHololiveMusicRows().length,
            updatedVideos: visibleMockHololiveMusicRows().length,
            missingVideos: 0,
            unavailableVideos: 0,
            failedBatches: 0,
            batches: 1,
            fetchedAt: now
          },
          updatedAt: now
        } as IpcChannelMap[C]["response"];
      case "hololive:custom-talents:refresh-all":
        return {
          refreshedTalents: mockHololiveTierData.idols.filter((idol) => idol.source === "custom").length,
          musicRefreshes: [
            {
              run: {
                id: "mock-custom-all-holodex-run",
                source: "live",
                status: "completed",
                startedAt: now,
                completedAt: now,
                fetchedRows: 2,
                keptRows: 2,
                filteredRows: 0,
                duplicateRows: 0,
                error: null
              },
              sourceRows: 2,
              idolMatchedRows: 2,
              importedRows: 2,
              detailCacheRows: 2,
              duplicateRows: 0
            }
          ],
          videoStatsRefresh: {
            requestedVideos: visibleMockHololiveMusicRows().length,
            updatedVideos: visibleMockHololiveMusicRows().length,
            missingVideos: 0,
            unavailableVideos: 0,
            failedBatches: 0,
            batches: 1,
            fetchedAt: now
          },
          updatedAt: now
        } as IpcChannelMap[C]["response"];
      case "hololive:player:data":
        return refreshMockHololivePlayerData() as IpcChannelMap[C]["response"];
      case "hololive:player:playlist:create":
        {
          const payload = _payload as IpcChannelMap["hololive:player:playlist:create"]["request"];
          mockHololivePlayerData.playlists.push({
            id: `mock-playlist-${crypto.randomUUID()}`,
            name: payload.name,
            position: mockHololivePlayerData.playlists.length,
            itemCount: 0,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            items: []
          });
          return refreshMockHololivePlayerData() as IpcChannelMap[C]["response"];
        }
      case "hololive:player:playlist:update":
        {
          const payload = _payload as IpcChannelMap["hololive:player:playlist:update"]["request"];
          mockHololivePlayerData.playlists = mockHololivePlayerData.playlists.map((playlist) =>
            playlist.id === payload.playlistId ? { ...playlist, name: payload.name, updatedAt: new Date().toISOString() } : playlist
          );
          return refreshMockHololivePlayerData() as IpcChannelMap[C]["response"];
        }
      case "hololive:player:playlist:delete":
        {
          const payload = _payload as IpcChannelMap["hololive:player:playlist:delete"]["request"];
          mockHololivePlayerData.playlists = mockHololivePlayerData.playlists.filter(
            (playlist) => playlist.id !== payload.playlistId
          );
          return refreshMockHololivePlayerData() as IpcChannelMap[C]["response"];
        }
      case "hololive:player:playlist:reorder":
        {
          const payload = _payload as IpcChannelMap["hololive:player:playlist:reorder"]["request"];
          const byId = new Map(mockHololivePlayerData.playlists.map((playlist) => [playlist.id, playlist]));
          mockHololivePlayerData.playlists = payload.playlistIds
            .map((id) => byId.get(id))
            .filter((playlist): playlist is HololiveMusicPlayerData["playlists"][number] => Boolean(playlist));
          return refreshMockHololivePlayerData() as IpcChannelMap[C]["response"];
        }
      case "hololive:player:playlist-item:add":
        {
          const payload = _payload as IpcChannelMap["hololive:player:playlist-item:add"]["request"];
          mockHololivePlayerData.playlists = mockHololivePlayerData.playlists.map((playlist) => {
            if (playlist.id !== payload.playlistId) {
              return playlist;
            }
            const items = [...(playlist.items ?? [])];
            if (items.some((item) => item.youtubeVideoId === payload.youtubeVideoId)) {
              return {
                ...playlist,
                items: items
                  .filter((item) => item.youtubeVideoId !== payload.youtubeVideoId)
                  .map((item, index) => ({ ...item, position: index }))
              };
            }
            const position = payload.position ?? items.length;
            items.splice(position, 0, createMockHololivePlayerItem(payload.youtubeVideoId, position));
            return { ...playlist, items: items.map((item, index) => ({ ...item, position: index })) };
          });
          return refreshMockHololivePlayerData() as IpcChannelMap[C]["response"];
        }
      case "hololive:player:playlist-items:add":
        {
          const payload = _payload as IpcChannelMap["hololive:player:playlist-items:add"]["request"];
          mockHololivePlayerData.playlists = mockHololivePlayerData.playlists.map((playlist) => {
            if (playlist.id !== payload.playlistId) {
              return playlist;
            }
            const items = [...(playlist.items ?? [])];
            for (const videoId of payload.youtubeVideoIds) {
              if (!items.some((item) => item.youtubeVideoId === videoId)) {
                items.push(createMockHololivePlayerItem(videoId, items.length));
              }
            }
            return { ...playlist, items: items.map((item, position) => ({ ...item, position })) };
          });
          return refreshMockHololivePlayerData() as IpcChannelMap[C]["response"];
        }
      case "hololive:player:playlist-item:remove":
        {
          const payload = _payload as IpcChannelMap["hololive:player:playlist-item:remove"]["request"];
          const snapshot = structuredClone(mockHololivePlayerData);
          mockHololivePlayerData.playlists = mockHololivePlayerData.playlists.map((playlist) => ({
            ...playlist,
            items: (playlist.items ?? []).filter((item) => item.id !== payload.itemId)
          }));
          const data = refreshMockHololivePlayerData();
          return {
            data,
            ...createMockUndo("playlist-item-remove", () => {
              mockHololivePlayerData = snapshot;
            })
          } as IpcChannelMap[C]["response"];
        }
      case "hololive:player:playlist-item:reorder":
        {
          const payload = _payload as IpcChannelMap["hololive:player:playlist-item:reorder"]["request"];
          if (payload.playlistId === MOCK_FAVORITES_PLAYLIST_ID) {
            payload.itemIds.forEach((id, position) => {
              const videoId = id.startsWith(`${MOCK_FAVORITES_PLAYLIST_ID}:`)
                ? id.slice(MOCK_FAVORITES_PLAYLIST_ID.length + 1)
                : id;
              mockFavoritePositions[videoId] = position;
            });
            return refreshMockHololivePlayerData() as IpcChannelMap[C]["response"];
          }
          mockHololivePlayerData.playlists = mockHololivePlayerData.playlists.map((playlist) => {
            if (playlist.id !== payload.playlistId) {
              return playlist;
            }
            const byId = new Map((playlist.items ?? []).map((item) => [item.id, item]));
            return {
              ...playlist,
              items: payload.itemIds
                .map((id, position) => {
                  const item = byId.get(id);
                  return item ? { ...item, position } : null;
                })
                .filter((item): item is HololiveMusicResolvedItem => Boolean(item))
            };
          });
          return refreshMockHololivePlayerData() as IpcChannelMap[C]["response"];
        }
      case "hololive:player:playlist:play":
        {
          const payload = _payload as IpcChannelMap["hololive:player:playlist:play"]["request"];
          const data = refreshMockHololivePlayerData();
          const playlist = data.playlists.find((candidate) => candidate.id === payload.playlistId);
          const item =
            (payload.itemId ? playlist?.items?.find((candidate) => candidate.id === payload.itemId) : null) ??
            playlist?.items?.find((candidate) => candidate.available);
          if (!playlist || !item?.available) {
            throw new Error("This playlist has no playable songs");
          }
          mockHololivePlayerData.state = {
            ...mockHololivePlayerData.state,
            playbackSourceType: "playlist",
            currentQueueItemId: null,
            currentPlaylistId: playlist.id,
            currentPlaylistItemId: item.id,
            currentYoutubeVideoId: item.youtubeVideoId,
            updatedAt: new Date().toISOString()
          };
          return refreshMockHololivePlayerData() as IpcChannelMap[C]["response"];
        }
      case "hololive:player:play-video":
        {
          const payload = _payload as IpcChannelMap["hololive:player:play-video"]["request"];
          const row = getMockHololiveMusicRow(payload.youtubeVideoId);
          mockHololivePlayerData.state = {
            ...mockHololivePlayerData.state,
            playbackSourceType: "library",
            currentQueueItemId: null,
            currentPlaylistId: null,
            currentPlaylistItemId: null,
            currentYoutubeVideoId: row.youtubeVideoId,
            updatedAt: new Date().toISOString()
          };
          return refreshMockHololivePlayerData() as IpcChannelMap[C]["response"];
        }
      case "hololive:player:queue:add":
        return mockQueueAdd(_payload as IpcChannelMap["hololive:player:queue:add"]["request"]) as IpcChannelMap[C]["response"];
      case "hololive:player:queue:bulk-add":
        return mockQueueBulkAdd(_payload as IpcChannelMap["hololive:player:queue:bulk-add"]["request"]) as IpcChannelMap[C]["response"];
      case "hololive:player:visible:play":
        return mockQueueBulkAdd({
          youtubeVideoIds: (_payload as IpcChannelMap["hololive:player:visible:play"]["request"]).youtubeVideoIds,
          placement: "now"
        }) as IpcChannelMap[C]["response"];
      case "hololive:player:queue:remove":
        {
          const payload = _payload as IpcChannelMap["hololive:player:queue:remove"]["request"];
          const snapshot = structuredClone(mockHololivePlayerData);
          mockHololivePlayerData.queue = mockHololivePlayerData.queue.filter((item) => item.id !== payload.itemId);
          if (mockHololivePlayerData.state.currentQueueItemId === payload.itemId) {
            const next = mockHololivePlayerData.queue.find((item) => item.available);
            mockHololivePlayerData.state = {
              ...mockHololivePlayerData.state,
              playbackSourceType: next ? "queue" : "library",
              currentQueueItemId: next?.id ?? null,
              currentPlaylistId: null,
              currentPlaylistItemId: null,
              currentYoutubeVideoId: next?.youtubeVideoId ?? null,
              updatedAt: new Date().toISOString()
            };
          }
          const data = refreshMockHololivePlayerData();
          return {
            data,
            ...createMockUndo("queue-item-remove", () => {
              mockHololivePlayerData = snapshot;
            })
          } as IpcChannelMap[C]["response"];
        }
      case "hololive:player:queue:reorder":
        {
          const payload = _payload as IpcChannelMap["hololive:player:queue:reorder"]["request"];
          const byId = new Map(mockHololivePlayerData.queue.map((item) => [item.id, item]));
          mockHololivePlayerData.queue = payload.itemIds
            .map((id, position) => {
              const item = byId.get(id);
              return item ? { ...item, position } : null;
            })
            .filter((item): item is HololiveMusicResolvedItem => Boolean(item));
          return refreshMockHololivePlayerData() as IpcChannelMap[C]["response"];
        }
      case "hololive:player:queue:clear":
        mockHololivePlayerData = {
          ...mockHololivePlayerData,
          queue: [],
          state:
            mockHololivePlayerData.state.playbackSourceType === "queue"
              ? {
                  ...mockHololivePlayerData.state,
                  playbackSourceType: "library",
                  currentQueueItemId: null,
                  currentPlaylistId: null,
                  currentPlaylistItemId: null,
                  currentYoutubeVideoId: null,
                  updatedAt: new Date().toISOString()
                }
              : mockHololivePlayerData.state
        };
        return refreshMockHololivePlayerData() as IpcChannelMap[C]["response"];
      case "hololive:player:queue:save":
        {
          const payload = _payload as IpcChannelMap["hololive:player:queue:save"]["request"];
          const uniqueQueueItems = mockHololivePlayerData.queue.filter(
            (item, index, items) => items.findIndex((candidate) => candidate.youtubeVideoId === item.youtubeVideoId) === index
          );
          mockHololivePlayerData.playlists.push({
            id: `mock-playlist-${crypto.randomUUID()}`,
            name: payload.name,
            position: mockHololivePlayerData.playlists.length,
            itemCount: uniqueQueueItems.length,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            items: uniqueQueueItems.map((item, position) => ({ ...item, id: `mock-playlist-item-${crypto.randomUUID()}`, position }))
          });
          return refreshMockHololivePlayerData() as IpcChannelMap[C]["response"];
        }
      case "hololive:player:state:update":
        {
          const payload = _payload as IpcChannelMap["hololive:player:state:update"]["request"];
          mockHololivePlayerData.state = {
            ...mockHololivePlayerData.state,
            playbackSourceType:
              payload.playbackSourceType === undefined
                ? mockHololivePlayerData.state.playbackSourceType
                : payload.playbackSourceType ?? "library",
            currentQueueItemId:
              payload.currentQueueItemId === undefined
                ? mockHololivePlayerData.state.currentQueueItemId
                : payload.currentQueueItemId,
            currentPlaylistId:
              payload.currentPlaylistId === undefined
                ? mockHololivePlayerData.state.currentPlaylistId
                : payload.currentPlaylistId,
            currentPlaylistItemId:
              payload.currentPlaylistItemId === undefined
                ? mockHololivePlayerData.state.currentPlaylistItemId
                : payload.currentPlaylistItemId,
            currentYoutubeVideoId:
              payload.currentYoutubeVideoId === undefined
                ? mockHololivePlayerData.state.currentYoutubeVideoId
                : payload.currentYoutubeVideoId,
            repeatMode: payload.repeatMode ?? mockHololivePlayerData.state.repeatMode,
            shuffleEnabled: payload.shuffleEnabled ?? mockHololivePlayerData.state.shuffleEnabled,
            autoplayEnabled: payload.autoplayEnabled ?? mockHololivePlayerData.state.autoplayEnabled,
            updatedAt: new Date().toISOString()
          };
          return refreshMockHololivePlayerData() as IpcChannelMap[C]["response"];
        }
      case "hololive:brackets:list":
        return listMockHololiveBracketSummaries() as IpcChannelMap[C]["response"];
      case "hololive:brackets:create":
        {
          const payload = _payload as IpcChannelMap["hololive:brackets:create"]["request"];
          const maxEntriesPerTalent = payload.filters?.maxEntriesPerTalent;
          const shouldWarnAboutRelaxedCap = typeof maxEntriesPerTalent === "number" && maxEntriesPerTalent <= 1;
          return {
            bracket: createMockHololiveBracket(payload),
            warnings: shouldWarnAboutRelaxedCap
              ? [
                  {
                    code: "talent_cap_relaxed",
                    requestedMaxEntriesPerTalent: maxEntriesPerTalent,
                    message: `Max per talent was relaxed from ${maxEntriesPerTalent} so the bracket could be filled.`
                  }
                ]
              : []
          } as IpcChannelMap[C]["response"];
        }
      case "hololive:brackets:get":
        return getMockHololiveBracket(
          (_payload as IpcChannelMap["hololive:brackets:get"]["request"]).bracketId
        ) as IpcChannelMap[C]["response"];
      case "hololive:brackets:pick-winner":
        return pickMockHololiveBracketWinner(
          _payload as IpcChannelMap["hololive:brackets:pick-winner"]["request"]
        ) as IpcChannelMap[C]["response"];
      case "hololive:brackets:undo":
        return undoMockHololiveBracket(
          (_payload as IpcChannelMap["hololive:brackets:undo"]["request"]).bracketId
        ) as IpcChannelMap[C]["response"];
      case "hololive:brackets:reset":
        return resetMockHololiveBracket(
          (_payload as IpcChannelMap["hololive:brackets:reset"]["request"]).bracketId
        ) as IpcChannelMap[C]["response"];
      case "hololive:brackets:duplicate":
        return duplicateMockHololiveBracket(
          (_payload as IpcChannelMap["hololive:brackets:duplicate"]["request"]).bracketId
        ) as IpcChannelMap[C]["response"];
      case "hololive:brackets:delete":
        {
          const bracketId = (_payload as IpcChannelMap["hololive:brackets:delete"]["request"]).bracketId;
          const bracket = mockHololiveBrackets.get(bracketId);
          if (bracket) {
            archiveMockHololiveBracket(bracket);
          }
          mockHololiveBrackets.delete(bracketId);
        }
        return listMockHololiveBracketSummaries() as IpcChannelMap[C]["response"];
      case "hololive:brackets:archives:list":
        return listMockHololiveBracketArchiveSummaries() as IpcChannelMap[C]["response"];
      case "hololive:brackets:archives:delete":
        {
          const archiveId = (_payload as IpcChannelMap["hololive:brackets:archives:delete"]["request"]).archiveId;
          const archivesSnapshot = new Map(mockHololiveBracketArchives);
          mockHololiveBracketArchives.delete(archiveId.replace(/^archive:/, ""));
          return {
            data: listMockHololiveBracketArchiveSummaries(),
            ...createMockUndo("bracket-archive-delete", () => {
              mockHololiveBracketArchives.clear();
              for (const [key, value] of archivesSnapshot) {
                mockHololiveBracketArchives.set(key, value);
              }
            })
          } as IpcChannelMap[C]["response"];
        }
      case "hololive:brackets:stats":
        return getMockHololiveBracketStatsOverview() as IpcChannelMap[C]["response"];
      case "hololive:undo:apply":
        {
          const token = (_payload as IpcChannelMap["hololive:undo:apply"]["request"]).token;
          const action = mockUndoActions.get(token);
          if (!action) {
            throw new Error("This undo action has expired.");
          }
          mockUndoActions.delete(token);
          action.apply();
          return { applied: true, kind: action.kind } as IpcChannelMap[C]["response"];
        }
      default:
        throw new Error(`Unhandled mock IPC channel: ${String(channel)}`);
    }
  }
};

export const api: HoloshelfBridge = mockBridge;
