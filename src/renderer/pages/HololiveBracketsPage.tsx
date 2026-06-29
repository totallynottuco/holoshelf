import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  BarChart3,
  Ban,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  Download,
  GitBranch,
  ListMusic,
  Loader2,
  Maximize2,
  Minimize2,
  RotateCcw,
  Swords,
  Trash2,
  Trophy,
  Undo2,
  X
} from "lucide-react";
import type {
  HololiveBracket,
  HololiveBracketEntry,
  HololiveBracketGenerationFilters,
  HololiveBracketGenerationStyle,
  HololiveBracketMatch,
  HololiveBracketRound,
  HololiveBracketSize,
  HololiveBracketStatsOverview,
  HololiveBracketSummary,
  HololiveBracketArchiveSummary,
  HololiveBracketSongStats,
  HololiveBracketTalentStats,
  HololiveMusicMarker,
  HololiveMusicPlayerData,
  HololiveMusicTopic
} from "../../shared/contracts";
import { api } from "../api";
import {
  formatHololiveDuration,
  formatHololiveSongDate,
  formatHololiveViewCount
} from "../components/HololiveMusicText";
import { MusicMarkerIcon, musicMarkerLabel } from "../components/HololiveMusicMarker";
import { HololiveMusicMarkerMenu } from "../components/HololiveMusicMarkerMenu";
import { HololivePlaylistMenu } from "../components/HololivePlaylistMenu";
import { CompactSelect } from "../components/CompactSelect";
import { HololiveViewSwitch } from "../components/HololiveViewSwitch";
import { renderHololiveBracketExportPng } from "../lib/hololiveBracketExport";

const BRACKET_SIZES: HololiveBracketSize[] = ["RO16", "RO32", "RO64", "RO128", "RO256"];
const BRACKET_GENERATION_STYLES: Array<{ value: HololiveBracketGenerationStyle; label: string }> = [
  { value: "top_songs", label: "Top Songs" },
  { value: "random_songs", label: "Random Songs" }
];
type BracketFilterCopy = {
  label: string;
  description: string;
};

const BRACKET_FILTER_COPY = {
  previousWinners: {
    label: "Previous Winners",
    description: "Exclude songs that have won brackets."
  },
  previousFinalists: {
    label: "Previous Finalists",
    description: "Exclude songs that have made Finals."
  },
  previousTop4: {
    label: "Previous Top 4",
    description: "Exclude songs that have made Semi Finals."
  },
  previousTop8: {
    label: "Previous Top 8",
    description: "Exclude songs that have made Quarter Finals."
  },
  disliked: {
    label: "Disliked",
    description: "Exclude songs marked Dislike."
  },
  rated: {
    label: "Rated",
    description: "Exclude songs that have a rating."
  },
  topViewed: {
    label: "Top Viewed",
    description: "Exclude one highest-viewed pick per talent."
  },
  minViews: {
    label: "Min Views",
    description: "Only include songs at or above this view count."
  },
  maxViews: {
    label: "Max Views",
    description: "Only include songs at or below this view count."
  },
  afterDate: {
    label: "After Date",
    description: "Only include songs published on or after this date."
  },
  beforeDate: {
    label: "Before Date",
    description: "Only include songs published on or before this date."
  }
} as const satisfies Record<string, BracketFilterCopy>;

const BRACKET_TOPIC_FILTERS: Array<{ value: HololiveMusicTopic } & BracketFilterCopy> = [
  { value: "Original_Song", label: "Originals", description: "Do not include originals." },
  { value: "Music_Cover", label: "Covers", description: "Do not include covers." }
];
const VIEW_THRESHOLD_FORMATTER = new Intl.NumberFormat("en-US");

type BracketConnectorPath = {
  id: string;
  d: string;
};

type BracketRoundState = "current" | "complete" | "upcoming";

interface ExportToastState {
  id: number;
  filePath: string;
  fading: boolean;
}

function embedUrl(videoId: string): string {
  const params = new URLSearchParams({
    playsinline: "1",
    rel: "0",
    modestbranding: "1"
  });
  return `https://www.youtube.com/embed/${encodeURIComponent(videoId)}?${params.toString()}`;
}

function youtubeThumbnailUrl(videoId: string): string {
  return `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`;
}

function displaySongTitle(title: string): string {
  const original = title.trim();
  let next = original;

  const slashParts = next
    .split(/\s+\/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (slashParts.length > 1) {
    next = slashParts.find((part) => /[A-Za-z0-9]/.test(part)) ?? slashParts[slashParts.length - 1] ?? next;
  }

  next = next
    .replace(/^【[^】]*(?:mv|music video|original song|cover)[^】]*】\s*/iu, "")
    .replace(/\s*【[^】]*(?:mv|music video|original song|cover|hololive)[^】]*】\s*$/iu, "")
    .replace(/\s*\[[^\]]*(?:mv|music video|original song|cover|hololive)[^\]]*\]\s*$/iu, "")
    .replace(/\s*\((?:official\s*)?(?:music\s*)?(?:video|mv)\)\s*$/iu, "")
    .replace(/\s+/g, " ")
    .trim();

  return next || original;
}

function matchLabel(match: HololiveBracketMatch): string {
  return `R${match.roundIndex + 1}-${match.matchIndex + 1}`;
}

function topicLabel(entry: Pick<HololiveBracketEntry, "topicId"> | null | undefined): string {
  return entry?.topicId === "Music_Cover" ? "Cover" : "Original";
}

function entryMeta(entry: HololiveBracketEntry): string {
  return [
    entry.idolName,
    topicLabel(entry),
    formatHololiveViewCount(entry.viewCount),
    formatHololiveSongDate(entry.publishedAt),
    formatHololiveDuration(entry.durationSeconds)
  ]
    .filter(Boolean)
    .join(" / ");
}

function roundProgressLabel(activeBracket: HololiveBracket, currentMatch: HololiveBracketMatch): string {
  const round = activeBracket.rounds[currentMatch.roundIndex];
  const matchCount = Math.max(round?.matches.length ?? 1, 1);
  return `${round?.label ?? "Matchup"} · ${currentMatch.matchIndex + 1}/${matchCount}`;
}

function summaryLabel(summary: HololiveBracketSummary): string {
  const progress = `${summary.completedMatches}/${summary.totalMatches}`;
  const styleLabel = summary.generationStyle === "random_songs" ? "Random" : "Top";
  return `${summary.name} · ${styleLabel} · ${progress}`;
}

function fileNameFromPath(filePath: string): string {
  return filePath.split(/[\\/]/).filter(Boolean).pop() ?? filePath;
}

function parseViewThresholdInput(value: string): number | null {
  const digits = value.replace(/[^\d]/g, "");
  if (!digits) {
    return null;
  }
  const parsed = Number(digits);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function formatViewThresholdInput(value: string): string {
  const parsed = parseViewThresholdInput(value);
  return parsed === null ? "" : VIEW_THRESHOLD_FORMATTER.format(parsed);
}

function bracketFilterAriaLabel(copy: BracketFilterCopy): string {
  return `${copy.label}: ${copy.description}`;
}

function BracketFilterOptionText({ copy }: { copy: BracketFilterCopy }) {
  return (
    <span className="hololive-bracket-filter-option-text" title={copy.description}>
      <strong>{copy.label}</strong>
    </span>
  );
}

function BracketFilterFieldLabel({ copy }: { copy: BracketFilterCopy }) {
  return (
    <span className="hololive-bracket-filter-field-label" title={copy.description}>
      {copy.label}
    </span>
  );
}

function roundState(round: HololiveBracketRound, activeBracket: HololiveBracket): BracketRoundState {
  const hasCurrentMatch = round.matches.some((match) => match.id === activeBracket.currentMatchId);
  if (hasCurrentMatch) {
    return "current";
  }

  const isComplete = round.matches.length > 0 && round.matches.every((match) => Boolean(match.winnerEntryId));
  return isComplete ? "complete" : "upcoming";
}

function roundClassName(round: HololiveBracketRound, activeBracket: HololiveBracket, extraClass = ""): string {
  const state = roundState(round, activeBracket);
  return `hololive-bracket-round ${extraClass} ${state}`.trim();
}

function MatchEntry({
  entry,
  winner
}: {
  entry: HololiveBracketEntry | null | undefined;
  winner?: boolean;
}) {
  if (!entry) {
    return (
      <div className="hololive-bracket-entry empty">
        <span>Pending</span>
      </div>
    );
  }

  const visibleTitle = displaySongTitle(entry.title);

  return (
    <div className={`hololive-bracket-entry${winner ? " winner" : ""}`}>
      <img src={youtubeThumbnailUrl(entry.youtubeVideoId)} alt="" loading="lazy" />
      <div>
        <strong title={entry.title}>{visibleTitle}</strong>
        <span title={entryMeta(entry)}>
          {entry.idolName} / {topicLabel(entry)}
        </span>
      </div>
    </div>
  );
}

function BracketMatchCard({
  match,
  current,
  side,
  registerMatch
}: {
  match: HololiveBracketMatch;
  current: boolean;
  side: "left" | "right" | "final";
  registerMatch?: (matchId: string, element: HTMLElement | null) => void;
}) {
  const pairClass = side === "final" ? "" : match.matchIndex % 2 === 0 ? " upper" : " lower";

  return (
    <article
      ref={(element) => registerMatch?.(match.id, element)}
      className={`hololive-bracket-match ${side}${pairClass}${current ? " current" : ""}`}
    >
      <div className="hololive-bracket-match-body">
        <div className="hololive-bracket-match-label" title={`Round ${match.roundIndex + 1}, match ${match.matchIndex + 1}`}>
          {matchLabel(match)}
        </div>
        <MatchEntry entry={match.entryA} winner={match.winnerEntryId === match.entryA?.id} />
        <MatchEntry entry={match.entryB} winner={match.winnerEntryId === match.entryB?.id} />
      </div>
    </article>
  );
}

function PlaySide({
  entry,
  side,
  disabled,
  marker,
  playlists,
  onAddToPlaylist,
  onSetMarker,
  onPick
}: {
  entry: HololiveBracketEntry | null | undefined;
  side: "left" | "right";
  disabled: boolean;
  marker?: HololiveMusicMarker | null;
  playlists: HololiveMusicPlayerData["playlists"];
  onAddToPlaylist: (entry: HololiveBracketEntry, playlistId: string) => Promise<void>;
  onSetMarker: (entry: HololiveBracketEntry, marker: HololiveMusicMarker | null) => Promise<void>;
  onPick: (entry: HololiveBracketEntry) => void;
}) {
  const [markerOpen, setMarkerOpen] = useState(false);
  const [playlistOpen, setPlaylistOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<"marker" | "playlist" | null>(null);
  const [confirmExclude, setConfirmExclude] = useState(false);

  useEffect(() => {
    if (!markerOpen) {
      setConfirmExclude(false);
    }
  }, [markerOpen]);

  if (!entry) {
    return (
      <article className={`hololive-bracket-arena-side ${side} empty`}>
        <div className="hololive-bracket-arena-stage">
          <div className="hololive-bracket-arena-embed empty">Waiting for previous winner</div>
        </div>
      </article>
    );
  }

  const visibleTitle = displaySongTitle(entry.title);
  const activeEntry = entry;
  const sideStyle = {
    "--hololive-bracket-arena-image": `url("${youtubeThumbnailUrl(activeEntry.youtubeVideoId)}")`
  } as CSSProperties;
  const markerLabel = musicMarkerLabel(marker);

  async function setMarker(markerValue: HololiveMusicMarker | null) {
    setPendingAction("marker");
    try {
      await onSetMarker(activeEntry, markerValue);
      setMarkerOpen(false);
      setConfirmExclude(false);
    } finally {
      setPendingAction((current) => (current === "marker" ? null : current));
    }
  }

  async function addToPlaylist(playlistId: string) {
    setPendingAction("playlist");
    try {
      await onAddToPlaylist(activeEntry, playlistId);
      setPlaylistOpen(false);
    } finally {
      setPendingAction((current) => (current === "playlist" ? null : current));
    }
  }

  return (
    <article className={`hololive-bracket-arena-side ${side}`} style={sideStyle}>
      <div className="hololive-bracket-arena-backdrop" aria-hidden="true" />
      <div className="hololive-bracket-arena-stage">
        <div className="hololive-bracket-arena-embed">
          <iframe
            title={visibleTitle}
            src={embedUrl(entry.youtubeVideoId)}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            referrerPolicy="origin"
            loading="lazy"
          />
        </div>
        <div
          className="hololive-bracket-arena-info"
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) {
              setMarkerOpen(false);
              setPlaylistOpen(false);
              setConfirmExclude(false);
            }
          }}
        >
          <div className="hololive-bracket-arena-meta" title={entryMeta(entry)}>
            <span>{entry.idolName}</span>
            <span>{topicLabel(entry)}</span>
            <span>{formatHololiveViewCount(entry.viewCount)}</span>
            <span>{formatHololiveSongDate(entry.publishedAt)}</span>
            <span>{formatHololiveDuration(entry.durationSeconds)}</span>
          </div>
          <div className="hololive-bracket-arena-actions">
            <span className="hololive-bracket-action-menu">
              <button
                className={`hololive-song-marker-button ${marker ?? "unmarked"}`}
                type="button"
                disabled={disabled || pendingAction !== null}
                aria-label={`${markerLabel} marker for ${visibleTitle}`}
                aria-expanded={markerOpen}
                title={`${markerLabel} marker`}
                onClick={(event) => {
                  event.stopPropagation();
                  setPlaylistOpen(false);
                  setConfirmExclude(false);
                  setMarkerOpen((current) => !current);
                }}
              >
                <MusicMarkerIcon marker={marker} />
              </button>
              {markerOpen ? (
                <HololiveMusicMarkerMenu
                  ariaLabel={`Set marker for ${visibleTitle}`}
                  className="hololive-song-marker-popover hololive-bracket-action-popover"
                  confirmAriaLabel={`Confirm exclusion for ${visibleTitle}`}
                  confirmingExclude={confirmExclude}
                  disabled={disabled || pendingAction !== null}
                  marker={marker}
                  onConfirmingExcludeChange={setConfirmExclude}
                  onSetMarker={(nextMarker) => void setMarker(nextMarker)}
                />
              ) : null}
            </span>
            <span className="hololive-bracket-action-menu">
              <button
                type="button"
                disabled={disabled || playlists.length === 0 || pendingAction !== null}
                aria-expanded={playlistOpen}
                title={playlists.length === 0 ? "Create a playlist first" : "Add to playlist"}
                aria-label={`Add ${visibleTitle} to playlist`}
                onClick={(event) => {
                  event.stopPropagation();
                  setMarkerOpen(false);
                  setConfirmExclude(false);
                  setPlaylistOpen((current) => !current);
                }}
              >
                <ListMusic size={13} />
              </button>
              {playlistOpen ? (
                <HololivePlaylistMenu
                  ariaLabel={`Choose playlist for ${visibleTitle}`}
                  className="hololive-bracket-action-popover"
                  disabled={disabled || pendingAction !== null}
                  emptyText="No playlists yet"
                  playlists={playlists}
                  youtubeVideoId={entry.youtubeVideoId}
                  onSelect={(playlistId) => void addToPlaylist(playlistId)}
                />
              ) : null}
            </span>
          </div>
        </div>
        <button
          type="button"
          className="hololive-bracket-pick-button"
          disabled={disabled}
          onClick={() => onPick(entry)}
          aria-label={`Pick ${visibleTitle}`}
          title={entry.title}
        >
          <span>{visibleTitle}</span>
        </button>
      </div>
    </article>
  );
}

function formatBracketPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatBracketDate(value: string | null | undefined): string {
  if (!value) {
    return "Unknown";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function StatNumber({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="hololive-bracket-stat-number">
      <span>{label}</span>
      <strong>{typeof value === "number" ? value.toLocaleString() : value}</strong>
    </div>
  );
}

function SongStatsTable({ title, rows }: { title: string; rows: HololiveBracketSongStats[] }) {
  return (
    <section className="hololive-bracket-stats-panel">
      <header>
        <strong>{title}</strong>
      </header>
      {rows.length === 0 ? (
        <div className="hololive-bracket-stats-empty">No archived songs yet.</div>
      ) : (
        <div className="hololive-bracket-stats-list">
          {rows.map((row, index) => (
            <article className="hololive-bracket-stats-row" key={`${title}:${row.youtubeVideoId}`}>
              <span className="rank">{index + 1}</span>
              <div className="main">
                <strong title={row.title}>{displaySongTitle(row.title)}</strong>
                <span>
                  {row.idolName ?? "Unknown"} / {topicLabel({ topicId: row.topicId ?? "Original_Song" })}
                </span>
              </div>
              <div className="metrics">
                <span>{row.wins}W</span>
                <span>{row.losses}L</span>
                <span>{formatBracketPercent(row.winRate)}</span>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function TalentStatsTable({ rows }: { rows: HololiveBracketTalentStats[] }) {
  return (
    <section className="hololive-bracket-stats-panel">
      <header>
        <strong>Talent Leaders</strong>
      </header>
      {rows.length === 0 ? (
        <div className="hololive-bracket-stats-empty">No archived talents yet.</div>
      ) : (
        <div className="hololive-bracket-stats-list">
          {rows.map((row, index) => (
            <article className="hololive-bracket-stats-row" key={row.idolId}>
              <span className="rank">{index + 1}</span>
              <div className="main">
                <strong title={row.idolName}>{row.idolName}</strong>
                <span>
                  {row.appearances} entries / {row.championCount} champions
                </span>
              </div>
              <div className="metrics">
                <span>{row.wins}W</span>
                <span>{row.losses}L</span>
                <span>{formatBracketPercent(row.winRate)}</span>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function BracketHistoryList({
  archives,
  deletingArchiveId,
  onDeleteArchive
}: {
  archives: HololiveBracketArchiveSummary[];
  deletingArchiveId: string | null;
  onDeleteArchive: (archive: HololiveBracketArchiveSummary) => void;
}) {
  return (
    <section className="hololive-bracket-stats-panel history">
      <header>
        <strong>Champion History</strong>
      </header>
      {archives.length === 0 ? (
        <div className="hololive-bracket-stats-empty">Completed brackets will appear here.</div>
      ) : (
        <div className="hololive-bracket-history-list">
          {archives.map((archive) => (
            <article className="hololive-bracket-history-row" key={archive.id}>
              <div className="main">
                <strong title={archive.name}>{archive.name}</strong>
                <span>
                  {BRACKET_GENERATION_STYLES.find((style) => style.value === archive.generationStyle)?.label ?? "Top Songs"} /{" "}
                  {archive.size} / {formatBracketDate(archive.completedAt)}
                </span>
              </div>
              <div className="champion">
                <Trophy size={13} />
                <span title={archive.championTitle ?? undefined}>{archive.championTitle ? displaySongTitle(archive.championTitle) : "No champion"}</span>
              </div>
              <button
                type="button"
                className="danger"
                disabled={deletingArchiveId === archive.id}
                aria-label={`Delete archived bracket ${archive.name}`}
                title="Delete archived run"
                onClick={() => onDeleteArchive(archive)}
              >
                {deletingArchiveId === archive.id ? <Loader2 size={13} className="spin" /> : <Trash2 size={13} />}
              </button>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function BracketStatsView({
  stats,
  archives,
  loading,
  deletingArchiveId,
  onDeleteArchive
}: {
  stats: HololiveBracketStatsOverview | null;
  archives: HololiveBracketArchiveSummary[];
  loading: boolean;
  deletingArchiveId: string | null;
  onDeleteArchive: (archive: HololiveBracketArchiveSummary) => void;
}) {
  if (loading && !stats) {
    return (
      <div className="hololive-bracket-empty">
        <Loader2 size={18} className="spin" />
        Loading bracket stats
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="hololive-bracket-empty">
        <BarChart3 size={20} />
        No bracket stats yet.
      </div>
    );
  }

  return (
    <div className="hololive-bracket-stats-view">
      <div className="hololive-bracket-stats-totals">
        <StatNumber label="Completed" value={stats.totals.completedBrackets} />
        <StatNumber label="Matches" value={stats.totals.totalMatches} />
        <StatNumber label="Songs" value={stats.totals.uniqueSongs} />
        <StatNumber label="Talents" value={stats.totals.uniqueTalents} />
      </div>
      <div className="hololive-bracket-stats-grid">
        <SongStatsTable title="Most Wins" rows={stats.topSongsByWins} />
        <SongStatsTable title="Best Win Rate" rows={stats.topSongsByWinRate} />
        <SongStatsTable title="Most Appearances" rows={stats.topSongsByAppearances} />
        <TalentStatsTable rows={stats.topTalents} />
      </div>
      <BracketHistoryList
        archives={archives.length > 0 ? archives : stats.championHistory}
        deletingArchiveId={deletingArchiveId}
        onDeleteArchive={onDeleteArchive}
      />
    </div>
  );
}

export function HololiveBracketsPage() {
  const bracketCanvasRef = useRef<HTMLDivElement | null>(null);
  const playArenaRef = useRef<HTMLDivElement | null>(null);
  const matchRefs = useRef(new Map<string, HTMLElement>());
  const createMenuRef = useRef<HTMLDivElement | null>(null);
  const exportToastTimersRef = useRef<{ fade: number | null; clear: number | null }>({ fade: null, clear: null });
  const [summaries, setSummaries] = useState<HololiveBracketSummary[]>([]);
  const [activeBracket, setActiveBracket] = useState<HololiveBracket | null>(null);
  const [selectedSize, setSelectedSize] = useState<HololiveBracketSize>("RO64");
  const [selectedGenerationStyle, setSelectedGenerationStyle] = useState<HololiveBracketGenerationStyle>("top_songs");
  const [excludeDisliked, setExcludeDisliked] = useState(false);
  const [excludeRated, setExcludeRated] = useState(false);
  const [excludeTopViewedPerTalent, setExcludeTopViewedPerTalent] = useState(false);
  const [excludePreviousChampions, setExcludePreviousChampions] = useState(false);
  const [excludePreviousFinalists, setExcludePreviousFinalists] = useState(false);
  const [excludePreviousTop4, setExcludePreviousTop4] = useState(false);
  const [excludePreviousTop8, setExcludePreviousTop8] = useState(false);
  const [excludeAboveViews, setExcludeAboveViews] = useState("");
  const [excludeBelowViews, setExcludeBelowViews] = useState("");
  const [excludeAfterDate, setExcludeAfterDate] = useState("");
  const [excludeBeforeDate, setExcludeBeforeDate] = useState("");
  const [excludeTopicIds, setExcludeTopicIds] = useState<HololiveMusicTopic[]>([]);
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [mode, setMode] = useState<"bracket" | "play" | "stats">("bracket");
  const [loading, setLoading] = useState(true);
  const [statsLoading, setStatsLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [deletingArchiveId, setDeletingArchiveId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exportToast, setExportToast] = useState<ExportToastState | null>(null);
  const [playerData, setPlayerData] = useState<HololiveMusicPlayerData | null>(null);
  const [statsOverview, setStatsOverview] = useState<HololiveBracketStatsOverview | null>(null);
  const [archiveSummaries, setArchiveSummaries] = useState<HololiveBracketArchiveSummary[]>([]);
  const [matchupMarkersByVideoId, setMatchupMarkersByVideoId] = useState<Record<string, HololiveMusicMarker | null>>({});
  const [arenaFullscreen, setArenaFullscreen] = useState(false);
  const [connectorLayout, setConnectorLayout] = useState<{
    width: number;
    height: number;
    paths: BracketConnectorPath[];
  }>({ width: 0, height: 0, paths: [] });

  const completedCount = useMemo(
    () => activeBracket?.rounds.flatMap((round) => round.matches).filter((match) => match.winnerEntryId).length ?? 0,
    [activeBracket]
  );
  const savedBracketOptions = useMemo(
    () =>
      summaries.length === 0
        ? [{ value: "", label: "No brackets", disabled: true }]
        : summaries.map((summary) => ({ value: summary.id, label: summaryLabel(summary) })),
    [summaries]
  );
  const currentMatch = activeBracket?.currentMatch ?? null;
  const userPlaylists = useMemo(() => (playerData?.playlists ?? []).filter((playlist) => !playlist.systemId), [playerData?.playlists]);
  const excludeAboveViewsValue = useMemo(() => parseViewThresholdInput(excludeAboveViews), [excludeAboveViews]);
  const excludeBelowViewsValue = useMemo(() => parseViewThresholdInput(excludeBelowViews), [excludeBelowViews]);
  const createFilters = useMemo<HololiveBracketGenerationFilters>(
    () => ({
      excludeDisliked,
      excludeRated,
      excludeTopViewedPerTalent,
      excludePreviousChampions,
      excludePreviousFinalists,
      excludePreviousTop4,
      excludePreviousTop8,
      excludeAboveViews: excludeAboveViewsValue,
      excludeBelowViews: excludeBelowViewsValue,
      excludeAfterDate: excludeAfterDate || null,
      excludeBeforeDate: excludeBeforeDate || null,
      excludeTopicIds
    }),
    [
      excludeAboveViewsValue,
      excludeAfterDate,
      excludeBeforeDate,
      excludeBelowViewsValue,
      excludeDisliked,
      excludePreviousChampions,
      excludePreviousFinalists,
      excludePreviousTop4,
      excludePreviousTop8,
      excludeRated,
      excludeTopViewedPerTalent,
      excludeTopicIds
    ]
  );
  const activeExclusionLabels = useMemo(() => {
    const labels: string[] = [];
    if (excludePreviousChampions) {
      labels.push(BRACKET_FILTER_COPY.previousWinners.label);
    }
    if (excludePreviousFinalists) {
      labels.push(BRACKET_FILTER_COPY.previousFinalists.label);
    }
    if (excludePreviousTop4) {
      labels.push(BRACKET_FILTER_COPY.previousTop4.label);
    }
    if (excludePreviousTop8) {
      labels.push(BRACKET_FILTER_COPY.previousTop8.label);
    }
    if (excludeDisliked) {
      labels.push(BRACKET_FILTER_COPY.disliked.label);
    }
    if (excludeRated) {
      labels.push(BRACKET_FILTER_COPY.rated.label);
    }
    if (excludeTopViewedPerTalent) {
      labels.push(BRACKET_FILTER_COPY.topViewed.label);
    }
    if (excludeBelowViewsValue !== null) {
      labels.push(`Min ${VIEW_THRESHOLD_FORMATTER.format(excludeBelowViewsValue)}`);
    }
    if (excludeAboveViewsValue !== null) {
      labels.push(`Max ${VIEW_THRESHOLD_FORMATTER.format(excludeAboveViewsValue)}`);
    }
    if (excludeTopicIds.includes("Original_Song")) {
      labels.push("Originals");
    }
    if (excludeTopicIds.includes("Music_Cover")) {
      labels.push("Covers");
    }
    if (excludeBeforeDate) {
      labels.push(BRACKET_FILTER_COPY.afterDate.label);
    }
    if (excludeAfterDate) {
      labels.push(BRACKET_FILTER_COPY.beforeDate.label);
    }
    return labels;
  }, [
    excludeAboveViewsValue,
    excludeAfterDate,
    excludeBeforeDate,
    excludeBelowViewsValue,
    excludeDisliked,
    excludePreviousChampions,
    excludePreviousFinalists,
    excludePreviousTop4,
    excludePreviousTop8,
    excludeRated,
    excludeTopViewedPerTalent,
    excludeTopicIds
  ]);

  const registerMatch = useCallback((matchId: string, element: HTMLElement | null) => {
    if (element) {
      matchRefs.current.set(matchId, element);
    } else {
      matchRefs.current.delete(matchId);
    }
  }, []);

  const bracketTree = useMemo(() => {
    if (!activeBracket) {
      return null;
    }

    const nonFinalRounds = activeBracket.rounds.slice(0, -1);
    const leftRounds = nonFinalRounds.map((round) => {
      const midpoint = Math.ceil(round.matches.length / 2);
      return {
        ...round,
        matches: round.matches.slice(0, midpoint)
      };
    });
    const rightRounds = nonFinalRounds
      .map((round) => {
        const midpoint = Math.ceil(round.matches.length / 2);
        return {
          ...round,
          matches: round.matches.slice(midpoint)
        };
      })
      .reverse();
    const finalRound = activeBracket.rounds[activeBracket.rounds.length - 1] ?? null;
    const baseMatches = Math.max(
      1,
      leftRounds[0]?.matches.length ?? 0,
      rightRounds[rightRounds.length - 1]?.matches.length ?? 0
    );

    return { leftRounds, rightRounds, finalRound, baseMatches };
  }, [activeBracket]);
  const finalRound = bracketTree?.finalRound ?? null;

  const measureBracketConnectors = useCallback(() => {
    const canvas = bracketCanvasRef.current;
    if (!activeBracket || mode !== "bracket" || !canvas) {
      setConnectorLayout({ width: 0, height: 0, paths: [] });
      return;
    }

    const canvasRect = canvas.getBoundingClientRect();
    const roundCoordinate = (value: number) => Math.round(value * 10) / 10;
    const getBodyRect = (matchId: string) => {
      const node = matchRefs.current.get(matchId);
      const body = node?.querySelector<HTMLElement>(".hololive-bracket-match-body");
      if (!body) {
        return null;
      }

      const rect = body.getBoundingClientRect();
      return {
        left: roundCoordinate(rect.left - canvasRect.left),
        right: roundCoordinate(rect.right - canvasRect.left),
        top: roundCoordinate(rect.top - canvasRect.top),
        bottom: roundCoordinate(rect.bottom - canvasRect.top),
        centerX: roundCoordinate(rect.left - canvasRect.left + rect.width / 2),
        centerY: roundCoordinate(rect.top - canvasRect.top + rect.height / 2)
      };
    };

    const paths: BracketConnectorPath[] = [];
    for (let roundIndex = 1; roundIndex < activeBracket.rounds.length; roundIndex += 1) {
      const previousRound = activeBracket.rounds[roundIndex - 1];
      const round = activeBracket.rounds[roundIndex];

      for (const parent of round.matches) {
        const parentRect = getBodyRect(parent.id);
        if (!parentRect) {
          continue;
        }

        const children = [
          previousRound.matches[parent.matchIndex * 2],
          previousRound.matches[parent.matchIndex * 2 + 1]
        ].filter((match): match is HololiveBracketMatch => Boolean(match));
        const childRects = children
          .map((match) => ({ match, rect: getBodyRect(match.id) }))
          .filter((item): item is { match: HololiveBracketMatch; rect: NonNullable<ReturnType<typeof getBodyRect>> } =>
            Boolean(item.rect)
          );

        if (childRects.length === 0) {
          continue;
        }

        const leftToRight = childRects.reduce((sum, item) => sum + item.rect.centerX, 0) / childRects.length < parentRect.centerX;
        const childEdgeX =
          childRects.reduce((sum, item) => sum + (leftToRight ? item.rect.right : item.rect.left), 0) / childRects.length;
        const parentEdgeX = leftToRight ? parentRect.left : parentRect.right;
        const midX = roundCoordinate((childEdgeX + parentEdgeX) / 2);
        const childYs = childRects.map((item) => item.rect.centerY);
        const minY = roundCoordinate(Math.min(parentRect.centerY, ...childYs));
        const maxY = roundCoordinate(Math.max(parentRect.centerY, ...childYs));
        const segments: string[] = [];

        for (const item of childRects) {
          const startX = leftToRight ? item.rect.right : item.rect.left;
          segments.push(`M ${startX} ${item.rect.centerY} H ${midX}`);
        }

        if (maxY > minY) {
          segments.push(`M ${midX} ${minY} V ${maxY}`);
        }

        segments.push(`M ${midX} ${parentRect.centerY} H ${parentEdgeX}`);
        paths.push({
          id: `connector-${parent.id}`,
          d: segments.join(" ")
        });
      }
    }

    const nextLayout = {
      width: Math.ceil(canvas.scrollWidth),
      height: Math.ceil(canvas.scrollHeight),
      paths
    };
    setConnectorLayout((current) => {
      if (
        current.width === nextLayout.width &&
        current.height === nextLayout.height &&
        current.paths.length === nextLayout.paths.length &&
        current.paths.every((path, index) => path.id === nextLayout.paths[index]?.id && path.d === nextLayout.paths[index]?.d)
      ) {
        return current;
      }
      return nextLayout;
    });
  }, [activeBracket, mode]);

  useLayoutEffect(() => {
    if (!activeBracket || mode !== "bracket") {
      setConnectorLayout({ width: 0, height: 0, paths: [] });
      return;
    }

    let frameId = window.requestAnimationFrame(measureBracketConnectors);
    const scheduleMeasure = () => {
      window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(measureBracketConnectors);
    };
    const observer = new ResizeObserver(scheduleMeasure);

    if (bracketCanvasRef.current) {
      observer.observe(bracketCanvasRef.current);
    }

    window.addEventListener("resize", scheduleMeasure);
    return () => {
      window.cancelAnimationFrame(frameId);
      observer.disconnect();
      window.removeEventListener("resize", scheduleMeasure);
    };
  }, [activeBracket, measureBracketConnectors, mode]);

  async function loadInitial() {
    setLoading(true);
    try {
      const [nextSummaries, nextPlayerData] = await Promise.all([
        api.invoke("hololive:brackets:list", null),
        api.invoke("hololive:player:data", null)
      ]);
      setPlayerData(nextPlayerData);
      setSummaries(nextSummaries);
      if (nextSummaries[0]) {
        const bracket = await api.invoke("hololive:brackets:get", { bracketId: nextSummaries[0].id });
        setActiveBracket(bracket);
      }
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Could not load brackets.");
    } finally {
      setLoading(false);
    }
  }

  async function loadBracketStats() {
    setStatsLoading(true);
    try {
      const [nextStats, nextArchives] = await Promise.all([
        api.invoke("hololive:brackets:stats", null),
        api.invoke("hololive:brackets:archives:list", null)
      ]);
      setStatsOverview(nextStats);
      setArchiveSummaries(nextArchives);
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Could not load bracket stats.");
    } finally {
      setStatsLoading(false);
    }
  }

  useEffect(() => {
    void loadInitial();
  }, []);

  useEffect(() => {
    if (mode === "stats") {
      void loadBracketStats();
    }
  }, [mode]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setArenaFullscreen(document.fullscreenElement === playArenaRef.current);
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  useEffect(() => () => clearExportToastTimers(), []);

  useEffect(() => {
    const videoIds = [
      currentMatch?.entryA?.youtubeVideoId,
      currentMatch?.entryB?.youtubeVideoId
    ].filter((videoId): videoId is string => Boolean(videoId));

    if (mode !== "play" || videoIds.length === 0) {
      setMatchupMarkersByVideoId({});
      return;
    }

    let cancelled = false;
    void api
      .invoke("hololive:music:list", {
        youtubeVideoIds: videoIds,
        limit: videoIds.length
      })
      .then((rows) => {
        if (cancelled) {
          return;
        }
        setMatchupMarkersByVideoId(Object.fromEntries(videoIds.map((videoId) => [videoId, rows.find((row) => row.youtubeVideoId === videoId)?.marker ?? null])));
      })
      .catch((nextError) => {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : "Could not load matchup song actions.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [currentMatch?.entryA?.youtubeVideoId, currentMatch?.entryB?.youtubeVideoId, mode]);

  useEffect(() => {
    if (!createMenuOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && createMenuRef.current?.contains(target)) {
        return;
      }
      setCreateMenuOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setCreateMenuOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [createMenuOpen]);

  async function selectBracket(bracketId: string) {
    if (!bracketId) {
      setActiveBracket(null);
      return;
    }

    setBusy(true);
    try {
      setActiveBracket(await api.invoke("hololive:brackets:get", { bracketId }));
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Could not open bracket.");
    } finally {
      setBusy(false);
    }
  }

  async function createBracket() {
    const generationStyle = selectedGenerationStyle;
    const name = nameDraft.trim() || null;
    setBusy(true);
    try {
      const bracket = await api.invoke("hololive:brackets:create", {
        size: selectedSize,
        generationStyle,
        filters: createFilters,
        name
      });
      setActiveBracket(bracket);
      setNameDraft("");
      setCreateMenuOpen(false);
      setSummaries(await api.invoke("hololive:brackets:list", null));
      setMode("play");
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Could not create bracket.");
    } finally {
      setBusy(false);
    }
  }

  async function pickWinner(entry: HololiveBracketEntry) {
    if (!activeBracket?.currentMatch) {
      return;
    }

    setBusy(true);
    try {
      const bracket = await api.invoke("hololive:brackets:pick-winner", {
        bracketId: activeBracket.id,
        matchId: activeBracket.currentMatch.id,
        winnerEntryId: entry.id
      });
      setActiveBracket(bracket);
      setSummaries(await api.invoke("hololive:brackets:list", null));
      if (bracket.status === "complete" && (statsOverview || archiveSummaries.length > 0)) {
        await loadBracketStats();
      }
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Could not save winner.");
    } finally {
      setBusy(false);
    }
  }

  async function undo() {
    if (!activeBracket) {
      return;
    }
    setBusy(true);
    try {
      setActiveBracket(await api.invoke("hololive:brackets:undo", { bracketId: activeBracket.id }));
      setSummaries(await api.invoke("hololive:brackets:list", null));
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Could not undo pick.");
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    if (!activeBracket) {
      return;
    }
    setBusy(true);
    try {
      setActiveBracket(await api.invoke("hololive:brackets:reset", { bracketId: activeBracket.id }));
      setSummaries(await api.invoke("hololive:brackets:list", null));
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Could not reset bracket.");
    } finally {
      setBusy(false);
    }
  }

  async function removeBracket() {
    if (!activeBracket || !window.confirm(`Delete ${activeBracket.name}?`)) {
      return;
    }
    setBusy(true);
    try {
      const nextSummaries = await api.invoke("hololive:brackets:delete", { bracketId: activeBracket.id });
      setSummaries(nextSummaries);
      setActiveBracket(nextSummaries[0] ? await api.invoke("hololive:brackets:get", { bracketId: nextSummaries[0].id }) : null);
      if (activeBracket.status === "complete" || statsOverview || archiveSummaries.length > 0) {
        await loadBracketStats();
      }
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Could not delete bracket.");
    } finally {
      setBusy(false);
    }
  }

  async function removeArchive(archive: HololiveBracketArchiveSummary) {
    if (!window.confirm(`Delete archived run "${archive.name}"? This removes its bracket stats history.`)) {
      return;
    }

    setDeletingArchiveId(archive.id);
    try {
      const nextArchives = await api.invoke("hololive:brackets:archives:delete", { archiveId: archive.id });
      const nextStats = await api.invoke("hololive:brackets:stats", null);
      setArchiveSummaries(nextArchives);
      setStatsOverview(nextStats);
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Could not delete archived bracket run.");
    } finally {
      setDeletingArchiveId(null);
    }
  }

  function clearExportToastTimers() {
    const timers = exportToastTimersRef.current;
    if (timers.fade !== null) {
      window.clearTimeout(timers.fade);
      timers.fade = null;
    }
    if (timers.clear !== null) {
      window.clearTimeout(timers.clear);
      timers.clear = null;
    }
  }

  function dismissExportToast() {
    clearExportToastTimers();
    setExportToast(null);
  }

  function showExportToast(filePath: string) {
    clearExportToastTimers();
    const id = Date.now();
    setExportToast({ id, filePath, fading: false });
    exportToastTimersRef.current.fade = window.setTimeout(() => {
      setExportToast((current) => (current?.id === id ? { ...current, fading: true } : current));
    }, 3000);
    exportToastTimersRef.current.clear = window.setTimeout(() => {
      setExportToast((current) => (current?.id === id ? null : current));
    }, 3450);
  }

  async function openExportToast(filePath: string) {
    dismissExportToast();
    try {
      await api.invoke("app:open-path", { filePath });
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Could not open exported bracket image.");
    }
  }

  async function exportFinishedBracket() {
    if (!activeBracket?.champion || exportBusy) {
      return;
    }

    setExportBusy(true);
    dismissExportToast();
    try {
      const dataUrl = await renderHololiveBracketExportPng(activeBracket);
      const safeName = `${activeBracket.name || "Hololive Bracket"} result`
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      const result = await api.invoke("app:save-image", {
        defaultFileName: `${safeName}.png`,
        dataUrl
      });
      if (result.filePath) {
        showExportToast(result.filePath);
      }
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Could not export bracket image.");
    } finally {
      setExportBusy(false);
    }
  }

  async function toggleArenaFullscreen() {
    const arena = playArenaRef.current;
    if (!arena) {
      return;
    }

    try {
      if (document.fullscreenElement === arena) {
        await document.exitFullscreen();
      } else {
        await arena.requestFullscreen();
      }
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Could not toggle fullscreen.");
    }
  }

  async function setBracketEntryMarker(entry: HololiveBracketEntry, marker: HololiveMusicMarker | null) {
    const response = await api.invoke("hololive:music-marker:set", {
      youtubeVideoId: entry.youtubeVideoId,
      marker
    });
    setMatchupMarkersByVideoId((current) => ({
      ...current,
      [entry.youtubeVideoId]: response.marker
    }));
    window.dispatchEvent(
      new CustomEvent("hololive-music-marker-updated", {
        detail: {
          youtubeVideoId: response.youtubeVideoId,
          markerKey: response.markerKey,
          marker: response.marker
        }
      })
    );
    setError(null);
  }

  async function addBracketEntryToPlaylist(entry: HololiveBracketEntry, playlistId: string) {
    setPlayerData(
      await api.invoke("hololive:player:playlist-item:add", {
        playlistId,
        youtubeVideoId: entry.youtubeVideoId
      })
    );
    setError(null);
  }

  function toggleExcludedTopic(topicId: HololiveMusicTopic) {
    setExcludeTopicIds((current) =>
      current.includes(topicId) ? current.filter((topic) => topic !== topicId) : [...current, topicId]
    );
  }

  function clearBracketExclusions() {
    setExcludeDisliked(false);
    setExcludeRated(false);
    setExcludeTopViewedPerTalent(false);
    setExcludePreviousChampions(false);
    setExcludePreviousFinalists(false);
    setExcludePreviousTop4(false);
    setExcludePreviousTop8(false);
    setExcludeAboveViews("");
    setExcludeBelowViews("");
    setExcludeAfterDate("");
    setExcludeBeforeDate("");
    setExcludeTopicIds([]);
  }

  return (
    <section className="page hololive-page hololive-brackets-page">
      <div className="hololive-brackets-workspace">
        <HololiveViewSwitch />
        {exportToast && (
          <button
            type="button"
            className={`hololive-export-toast${exportToast.fading ? " fading" : ""}`}
            onClick={() => void openExportToast(exportToast.filePath)}
            title="Open exported bracket image"
          >
            <CheckCircle2 size={16} />
            <span>
              <strong>Bracket image saved</strong>
              <small>{fileNameFromPath(exportToast.filePath)}</small>
            </span>
          </button>
        )}

        <section className="hololive-bracket-shell" aria-label="Hololive song brackets">
          <div className="hololive-bracket-toolbar">
            <label>
              <span>Saved</span>
              <CompactSelect
                ariaLabel="Saved bracket"
                value={activeBracket?.id ?? ""}
                disabled={busy || loading || summaries.length === 0}
                options={savedBracketOptions}
                onChange={(value) => void selectBracket(value)}
              />
            </label>
            <div className="hololive-bracket-create-menu" ref={createMenuRef}>
              <button
                type="button"
                className="primary"
                disabled={busy || loading}
                aria-haspopup="dialog"
                aria-expanded={createMenuOpen}
                onClick={() => setCreateMenuOpen((open) => !open)}
              >
                <Swords size={14} />
                Create
              </button>
              {createMenuOpen && (
                <div className="hololive-bracket-create-popover" role="dialog" aria-label="Create bracket">
                  <div className="hololive-bracket-create-field">
                    <span>Size</span>
                    <div className="hololive-bracket-create-options sizes" role="radiogroup" aria-label="Size">
                      {BRACKET_SIZES.map((size) => (
                        <button
                          type="button"
                          key={size}
                          role="radio"
                          aria-checked={selectedSize === size}
                          className={selectedSize === size ? "active" : ""}
                          disabled={busy}
                          onClick={() => setSelectedSize(size)}
                        >
                          {size}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="hololive-bracket-create-field">
                    <span>Style</span>
                    <div className="hololive-bracket-create-options styles" role="radiogroup" aria-label="Style">
                      {BRACKET_GENERATION_STYLES.map((style) => (
                        <button
                          type="button"
                          key={style.value}
                          role="radio"
                          aria-checked={selectedGenerationStyle === style.value}
                          className={selectedGenerationStyle === style.value ? "active" : ""}
                          disabled={busy}
                          onClick={() => setSelectedGenerationStyle(style.value)}
                        >
                          {style.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <label className="hololive-bracket-create-name-field">
                    <span>Name</span>
                    <input
                      value={nameDraft}
                      placeholder={`${BRACKET_GENERATION_STYLES.find((style) => style.value === selectedGenerationStyle)?.label ?? "Top Songs"} ${selectedSize} Bracket`}
                      disabled={busy}
                      onChange={(event) => setNameDraft(event.target.value)}
                    />
                  </label>
                  <div className={`hololive-bracket-exclusions${activeExclusionLabels.length > 0 ? " has-active" : ""}`}>
                    <div className="hololive-bracket-filter-row">
                      <span className="hololive-bracket-exclusions-title">
                        <Ban size={13} />
                        <strong>Filters</strong>
                      </span>
                      <div className="hololive-bracket-filter-chips" aria-label="Active bracket filters">
                        {activeExclusionLabels.length > 0 ? (
                          <>
                            {activeExclusionLabels.slice(0, 5).map((label) => (
                              <span key={label}>{label}</span>
                            ))}
                            {activeExclusionLabels.length > 5 && <span>+{activeExclusionLabels.length - 5}</span>}
                          </>
                        ) : (
                          <span className="empty">No exclusions</span>
                        )}
                      </div>
                      <button
                        type="button"
                        className="hololive-bracket-filters-edit"
                        aria-expanded={filtersExpanded}
                        disabled={busy}
                        onClick={() => setFiltersExpanded((expanded) => !expanded)}
                      >
                        Edit Filters
                        <ChevronDown size={13} className={filtersExpanded ? "open" : ""} />
                      </button>
                    </div>
                    {filtersExpanded && (
                      <div className="hololive-bracket-exclusions-body">
                        <section className="hololive-bracket-filter-group">
                          <h4>History</h4>
                          <div className="hololive-bracket-exclusion-list">
                            <label className="hololive-bracket-exclusion-option">
                              <input
                                type="checkbox"
                                checked={excludePreviousChampions}
                                disabled={busy}
                                onChange={(event) => setExcludePreviousChampions(event.target.checked)}
                              />
                              <BracketFilterOptionText copy={BRACKET_FILTER_COPY.previousWinners} />
                            </label>
                            <label className="hololive-bracket-exclusion-option">
                              <input
                                type="checkbox"
                                checked={excludePreviousFinalists}
                                disabled={busy}
                                onChange={(event) => setExcludePreviousFinalists(event.target.checked)}
                              />
                              <BracketFilterOptionText copy={BRACKET_FILTER_COPY.previousFinalists} />
                            </label>
                            <label className="hololive-bracket-exclusion-option">
                              <input
                                type="checkbox"
                                checked={excludePreviousTop4}
                                disabled={busy}
                                onChange={(event) => setExcludePreviousTop4(event.target.checked)}
                              />
                              <BracketFilterOptionText copy={BRACKET_FILTER_COPY.previousTop4} />
                            </label>
                            <label className="hololive-bracket-exclusion-option">
                              <input
                                type="checkbox"
                                checked={excludePreviousTop8}
                                disabled={busy}
                                onChange={(event) => setExcludePreviousTop8(event.target.checked)}
                              />
                              <BracketFilterOptionText copy={BRACKET_FILTER_COPY.previousTop8} />
                            </label>
                          </div>
                        </section>
                        <section className="hololive-bracket-filter-group">
                          <h4>Ratings</h4>
                          <div className="hololive-bracket-exclusion-list">
                            <label className="hololive-bracket-exclusion-option">
                              <input
                                type="checkbox"
                                checked={excludeDisliked}
                                disabled={busy}
                                onChange={(event) => setExcludeDisliked(event.target.checked)}
                              />
                              <BracketFilterOptionText copy={BRACKET_FILTER_COPY.disliked} />
                            </label>
                            <label className="hololive-bracket-exclusion-option">
                              <input
                                type="checkbox"
                                checked={excludeRated}
                                disabled={busy}
                                onChange={(event) => setExcludeRated(event.target.checked)}
                              />
                              <BracketFilterOptionText copy={BRACKET_FILTER_COPY.rated} />
                            </label>
                          </div>
                        </section>
                        <section className="hololive-bracket-filter-group">
                          <h4>Talents</h4>
                          <div className="hololive-bracket-exclusion-list single">
                            <label className="hololive-bracket-exclusion-option">
                              <input
                                type="checkbox"
                                checked={excludeTopViewedPerTalent}
                                disabled={busy}
                                onChange={(event) => setExcludeTopViewedPerTalent(event.target.checked)}
                              />
                              <BracketFilterOptionText copy={BRACKET_FILTER_COPY.topViewed} />
                            </label>
                          </div>
                        </section>
                        <section className="hololive-bracket-filter-group">
                          <h4>Song Type</h4>
                          <div className="hololive-bracket-exclusion-list">
                            {BRACKET_TOPIC_FILTERS.map((topic) => (
                              <label className="hololive-bracket-exclusion-option" key={topic.value}>
                                <input
                                  type="checkbox"
                                  checked={excludeTopicIds.includes(topic.value)}
                                  disabled={busy}
                                  onChange={() => toggleExcludedTopic(topic.value)}
                                />
                                <BracketFilterOptionText copy={topic} />
                              </label>
                            ))}
                          </div>
                        </section>
                        <div className="hololive-bracket-filter-fields">
                          <div className="hololive-bracket-number-filters">
                            <label>
                              <BracketFilterFieldLabel copy={BRACKET_FILTER_COPY.minViews} />
                              <input
                                type="text"
                                inputMode="numeric"
                                aria-label={bracketFilterAriaLabel(BRACKET_FILTER_COPY.minViews)}
                                placeholder="No minimum"
                                value={excludeBelowViews}
                                disabled={busy}
                                onChange={(event) => setExcludeBelowViews(event.target.value)}
                                onBlur={() => setExcludeBelowViews((value) => formatViewThresholdInput(value))}
                              />
                            </label>
                            <label>
                              <BracketFilterFieldLabel copy={BRACKET_FILTER_COPY.maxViews} />
                              <input
                                type="text"
                                inputMode="numeric"
                                aria-label={bracketFilterAriaLabel(BRACKET_FILTER_COPY.maxViews)}
                                placeholder="No maximum"
                                value={excludeAboveViews}
                                disabled={busy}
                                onChange={(event) => setExcludeAboveViews(event.target.value)}
                                onBlur={() => setExcludeAboveViews((value) => formatViewThresholdInput(value))}
                              />
                            </label>
                          </div>
                          <div className="hololive-bracket-date-filters">
                            <label>
                              <BracketFilterFieldLabel copy={BRACKET_FILTER_COPY.afterDate} />
                              <input
                                type="date"
                                aria-label={bracketFilterAriaLabel(BRACKET_FILTER_COPY.afterDate)}
                                value={excludeBeforeDate}
                                disabled={busy}
                                onChange={(event) => setExcludeBeforeDate(event.target.value)}
                              />
                            </label>
                            <label>
                              <BracketFilterFieldLabel copy={BRACKET_FILTER_COPY.beforeDate} />
                              <input
                                type="date"
                                aria-label={bracketFilterAriaLabel(BRACKET_FILTER_COPY.beforeDate)}
                                value={excludeAfterDate}
                                disabled={busy}
                                onChange={(event) => setExcludeAfterDate(event.target.value)}
                              />
                            </label>
                          </div>
                        </div>
                        {activeExclusionLabels.length > 0 && (
                          <button
                            type="button"
                            className="hololive-bracket-exclusions-clear"
                            disabled={busy}
                            onClick={clearBracketExclusions}
                          >
                            <X size={12} />
                            Clear exclusions
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="hololive-bracket-create-actions">
                    <button type="button" className="primary" disabled={busy} onClick={() => void createBracket()}>
                      {busy ? <Loader2 size={14} className="spin" /> : <Swords size={14} />}
                      Create Bracket
                    </button>
                    <button type="button" disabled={busy} onClick={() => setCreateMenuOpen(false)}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
            <div className="hololive-bracket-toolbar-divider" />
            <div className="hololive-bracket-mode-toggle" role="group" aria-label="Bracket display mode">
              <button type="button" className={mode === "bracket" ? "active" : ""} onClick={() => setMode("bracket")}>
                <GitBranch size={14} />
                Bracket
              </button>
              <button type="button" className={mode === "play" ? "active" : ""} onClick={() => setMode("play")}>
                <Swords size={14} />
                Play
              </button>
              <button type="button" className={mode === "stats" ? "active" : ""} onClick={() => setMode("stats")}>
                <BarChart3 size={14} />
                Stats
              </button>
            </div>
            <button type="button" disabled={busy || !activeBracket || completedCount === 0} onClick={() => void undo()}>
              <Undo2 size={14} />
              Undo
            </button>
            <button type="button" disabled={busy || !activeBracket || completedCount === 0} onClick={() => void reset()}>
              <RotateCcw size={14} />
              Reset
            </button>
            <button
              type="button"
              disabled={busy || exportBusy || !activeBracket?.champion}
              onClick={() => void exportFinishedBracket()}
              title={activeBracket?.champion ? "Export finished bracket image" : "Complete a bracket to export"}
            >
              {exportBusy ? <Loader2 size={14} className="spin" /> : <Download size={14} />}
              Export
            </button>
            <button type="button" className="danger" disabled={busy || !activeBracket} onClick={() => void removeBracket()}>
              <Trash2 size={14} />
            </button>
          </div>

          {error && <div className="hololive-bracket-error">{error}</div>}

          {loading ? (
            <div className="hololive-bracket-empty">
              <Loader2 size={18} className="spin" />
              Loading brackets
            </div>
          ) : mode === "stats" ? (
            <BracketStatsView
              stats={statsOverview}
              archives={archiveSummaries}
              loading={statsLoading}
              deletingArchiveId={deletingArchiveId}
              onDeleteArchive={(archive) => void removeArchive(archive)}
            />
          ) : !activeBracket ? (
            <div className="hololive-bracket-empty">
              <Swords size={20} />
              No saved brackets yet.
            </div>
          ) : mode === "bracket" && bracketTree ? (
            <div
              className="hololive-bracket-tree"
              style={{ "--bracket-base-matches": bracketTree.baseMatches } as CSSProperties}
              aria-label="Full two-sided bracket view"
            >
              <div className="hololive-bracket-canvas" ref={bracketCanvasRef}>
                {connectorLayout.paths.length > 0 && (
                  <svg
                    className="hololive-bracket-lines"
                    width={connectorLayout.width}
                    height={connectorLayout.height}
                    viewBox={`0 0 ${connectorLayout.width} ${connectorLayout.height}`}
                    aria-hidden="true"
                  >
                    {connectorLayout.paths.map((path) => (
                      <path key={path.id} d={path.d} />
                    ))}
                  </svg>
                )}

                <div className="hololive-bracket-side left">
                  {bracketTree.leftRounds.map((round) => (
                    <section
                      className={roundClassName(round, activeBracket)}
                      key={`left-${round.roundIndex}`}
                      style={{ "--round-match-count": Math.max(round.matches.length, 1) } as CSSProperties}
                    >
                      <header>
                        <strong>{round.label}</strong>
                        <span>{round.matches.length}</span>
                      </header>
                      <div className="hololive-bracket-round-stack">
                        {round.matches.map((match) => (
                          <BracketMatchCard
                            key={match.id}
                            match={match}
                            side="left"
                            current={activeBracket.currentMatchId === match.id}
                            registerMatch={registerMatch}
                          />
                        ))}
                      </div>
                    </section>
                  ))}
                </div>

                <section
                  className={
                    finalRound
                      ? roundClassName(finalRound, activeBracket, "hololive-bracket-final-round")
                      : "hololive-bracket-round hololive-bracket-final-round upcoming"
                  }
                  style={{ "--round-match-count": 1 } as CSSProperties}
                >
                  <header>
                    <strong>Final</strong>
                    <span>1</span>
                  </header>
                  <div className="hololive-bracket-round-stack">
                    {finalRound?.matches[0] ? (
                      <BracketMatchCard
                        match={finalRound.matches[0]}
                        side="final"
                        current={activeBracket.currentMatchId === finalRound.matches[0].id}
                        registerMatch={registerMatch}
                      />
                    ) : (
                      <div className="hololive-bracket-entry empty">Pending</div>
                    )}
                    {activeBracket.champion && (
                      <div className="hololive-bracket-champion-strip">
                        <Trophy size={14} />
                        <strong title={activeBracket.champion.title}>{displaySongTitle(activeBracket.champion.title)}</strong>
                      </div>
                    )}
                  </div>
                </section>

                <div className="hololive-bracket-side right">
                  {bracketTree.rightRounds.map((round) => (
                  <section
                    className={roundClassName(round, activeBracket)}
                    key={`right-${round.roundIndex}`}
                    style={{ "--round-match-count": Math.max(round.matches.length, 1) } as CSSProperties}
                  >
                    <header>
                      <strong>{round.label}</strong>
                      <span>{round.matches.length}</span>
                    </header>
                    <div className="hololive-bracket-round-stack">
                      {round.matches.map((match) => (
                        <BracketMatchCard
                          key={match.id}
                          match={match}
                          side="right"
                          current={activeBracket.currentMatchId === match.id}
                          registerMatch={registerMatch}
                        />
                      ))}
                    </div>
                  </section>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="hololive-bracket-play-view" aria-label="Play matchup view">
              {activeBracket.champion ? (
                <div className="hololive-bracket-champion">
                  <Trophy size={24} />
                  <span>Champion</span>
                  <strong title={activeBracket.champion.title}>{displaySongTitle(activeBracket.champion.title)}</strong>
                  <button type="button" onClick={() => setMode("bracket")}>
                    <ChevronLeft size={14} />
                    View Bracket
                  </button>
                </div>
              ) : currentMatch ? (
                <div className="hololive-bracket-play-arena" ref={playArenaRef}>
                  <div className="hololive-bracket-arena-top">
                    <strong title={activeBracket.name}>{activeBracket.name}</strong>
                    <span>{roundProgressLabel(activeBracket, currentMatch)}</span>
                  </div>
                  <button
                    type="button"
                    className="hololive-bracket-arena-fullscreen"
                    onClick={() => void toggleArenaFullscreen()}
                    aria-label={arenaFullscreen ? "Exit fullscreen matchup" : "Fullscreen matchup"}
                    title={arenaFullscreen ? "Exit fullscreen" : "Fullscreen"}
                  >
                    {arenaFullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
                  </button>
                  <div className="hololive-bracket-arena-divider" aria-hidden="true" />
                  <div className="hololive-bracket-vs-badge" aria-hidden="true">
                    VS
                  </div>
                  <div className="hololive-bracket-arena-layout">
                    <PlaySide
                      entry={currentMatch.entryA}
                      side="left"
                      disabled={busy}
                      marker={currentMatch.entryA ? matchupMarkersByVideoId[currentMatch.entryA.youtubeVideoId] ?? null : null}
                      playlists={userPlaylists}
                      onAddToPlaylist={addBracketEntryToPlaylist}
                      onSetMarker={setBracketEntryMarker}
                      onPick={pickWinner}
                    />
                    <PlaySide
                      entry={currentMatch.entryB}
                      side="right"
                      disabled={busy}
                      marker={currentMatch.entryB ? matchupMarkersByVideoId[currentMatch.entryB.youtubeVideoId] ?? null : null}
                      playlists={userPlaylists}
                      onAddToPlaylist={addBracketEntryToPlaylist}
                      onSetMarker={setBracketEntryMarker}
                      onPick={pickWinner}
                    />
                  </div>
                </div>
              ) : (
                <div className="hololive-bracket-empty">No matchup is ready yet.</div>
              )}
            </div>
          )}
        </section>
      </div>
    </section>
  );
}
