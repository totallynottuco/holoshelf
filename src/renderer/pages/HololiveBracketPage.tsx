import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  BarChart3,
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
  Undo2
} from "lucide-react";
import type {
  HololiveBracket,
  HololiveBracketEntry,
  HololiveBracketGenerationFilters,
  HololiveBracketGenerationStyle,
  HololiveBracketHistoryParticipation,
  HololiveBracketMatch,
  HololiveBracketRatingBucket,
  HololiveBracketRound,
  HololiveBracketRivalryStats,
  HololiveBracketSize,
  HololiveBracketStatsOverview,
  HololiveBracketSummary,
  HololiveBracketArchiveSummary,
  HololiveBracketSongStats,
  HololiveBracketTalentStats,
  HololiveBracketTalentStatusFilter,
  HololiveBracketVocalScope,
  HololiveIdol,
  HololiveMusicMarker,
  HololiveMusicPlayerData,
  HololiveMusicTopic
} from "../../shared/contracts";
import { displayHololiveBracketRoundLabel } from "../../shared/hololiveBracketLabels";
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
import { useHololiveActionToast } from "../components/HololiveActionToast";
import { renderHololiveBracketExportPng } from "../lib/hololiveBracketExport";
import { useDismissableLayer } from "../lib/useDismissableLayer";

const BRACKET_SIZES: HololiveBracketSize[] = ["RO16", "RO32", "RO64", "RO128", "RO256"];
const HOLOLIVE_BRACKET_SIZE_COUNTS: Record<HololiveBracketSize, number> = {
  RO16: 16,
  RO32: 32,
  RO64: 64,
  RO128: 128,
  RO256: 256
};
const BRACKET_GENERATION_STYLES: Array<{ value: HololiveBracketGenerationStyle; label: string }> = [
  { value: "top_songs", label: "Top Songs" },
  { value: "random_songs", label: "Random Songs" }
];
const BRACKET_TOPIC_VALUES: HololiveMusicTopic[] = ["Original_Song", "Music_Cover"];
const BRACKET_VOCAL_SCOPE_VALUES: HololiveBracketVocalScope[] = ["solo", "group"];
const BRACKET_TALENT_STATUS_VALUES: HololiveBracketTalentStatusFilter[] = ["active", "alumni", "custom"];
const BRACKET_RATING_BUCKET_VALUES: HololiveBracketRatingBucket[] = [
  "unrated",
  "favorite",
  "like",
  "neutral",
  "dislike"
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
    description: "Exclude songs that have made Semi Final."
  },
  previousTop8: {
    label: "Previous Top 8",
    description: "Exclude songs that have made Quarter Final."
  },
  topViewed: {
    label: "Skip Top Viewed",
    description: "Skip each talent's highest-viewed pick."
  },
  minViews: {
    label: "Min views",
    description: "Only include songs at or above this view count."
  },
  maxViews: {
    label: "Max views",
    description: "Only include songs at or below this view count."
  },
  fromDate: {
    label: "From date",
    description: "Only include songs published on or after this date."
  },
  toDate: {
    label: "To date",
    description: "Only include songs published on or before this date."
  }
} as const satisfies Record<string, BracketFilterCopy>;

const BRACKET_TOPIC_FILTERS: Array<{ value: HololiveMusicTopic } & BracketFilterCopy> = [
  { value: "Original_Song", label: "Originals", description: "Include original songs." },
  { value: "Music_Cover", label: "Covers", description: "Include cover songs." }
];
const BRACKET_VOCAL_SCOPE_FILTERS: Array<{ value: HololiveBracketVocalScope } & BracketFilterCopy> = [
  { value: "solo", label: "Solo songs", description: "Include songs with one singer involved." },
  { value: "group", label: "Group Songs", description: "Include songs with multiple singers involved." }
];
const BRACKET_TALENT_STATUS_FILTERS: Array<{ value: HololiveBracketTalentStatusFilter } & BracketFilterCopy> = [
  { value: "active", label: "Active", description: "Include active and affiliate talents." },
  { value: "alumni", label: "Alumni", description: "Include alum and retired talents." },
  { value: "custom", label: "Custom", description: "Include custom imported talents." }
];
const BRACKET_HISTORY_PARTICIPATION_OPTIONS: Array<{
  value: HololiveBracketHistoryParticipation | "all";
  label: string;
}> = [
  { value: "all", label: "All" },
  { value: "never", label: "Never appeared" },
  { value: "appeared", label: "Has appeared" },
  { value: "top8", label: "Top 8+" },
  { value: "top4", label: "Top 4+" },
  { value: "finalist", label: "Finalist+" },
  { value: "winner", label: "Winner" }
];
const BRACKET_RATING_FILTERS: Array<{ value: HololiveBracketRatingBucket } & BracketFilterCopy> = [
  { value: "unrated", label: "Unrated", description: "Include songs without a rating." },
  { value: "favorite", label: "Favorite", description: "Include songs rated Favorite." },
  { value: "like", label: "Like", description: "Include songs rated Like." },
  { value: "neutral", label: "Neutral", description: "Include songs rated Neutral." },
  { value: "dislike", label: "Disliked", description: "Include songs rated Dislike." }
];
const VIEW_THRESHOLD_FORMATTER = new Intl.NumberFormat("en-US");
const HOLOLIVE_EXPORT_TOAST_DURATION_MS = 5000;

type BracketConnectorPath = {
  id: string;
  d: string;
};

type BracketConnectorLayout = {
  width: number;
  height: number;
  paths: BracketConnectorPath[];
};

function emptyBracketConnectorLayout(): BracketConnectorLayout {
  return { width: 0, height: 0, paths: [] };
}

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
  const roundLabel = round ? displayHololiveBracketRoundLabel(round.label) : "Matchup";
  return `${roundLabel} · ${currentMatch.matchIndex + 1}/${matchCount}`;
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

function orderedBracketFilterValues<T extends string>(order: T[], values: T[]): T[] {
  const selected = new Set(values);
  return order.filter((value) => selected.has(value));
}

function bracketTalentStatusFilter(talent: HololiveIdol): HololiveBracketTalentStatusFilter {
  if (talent.source === "custom") {
    return "custom";
  }
  return talent.status === "alum" || talent.status === "retired" ? "alumni" : "active";
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
  const actionMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!markerOpen) {
      setConfirmExclude(false);
    }
  }, [markerOpen]);

  useDismissableLayer({
    enabled: markerOpen || playlistOpen,
    ref: actionMenuRef,
    onDismiss: () => {
      setMarkerOpen(false);
      setPlaylistOpen(false);
      setConfirmExclude(false);
    }
  });

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
          ref={actionMenuRef}
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

type BracketStatsMetric<T> = {
  label: string;
  header: string;
  value: (row: T) => string;
};

function formatBracketRecord(row: { wins: number; losses: number }): string {
  return `${row.wins}-${row.losses}`;
}

function formatBracketNumber(value: number): string {
  return value.toLocaleString();
}

function finalsWithoutTitle(row: HololiveBracketSongStats): number {
  return Math.max(0, row.finalistCount - row.championCount);
}

function formatBracketViewDelta(value: number): string {
  const formatted = formatHololiveViewCount(value).replace(/\s+views$/i, "");
  return formatted ? `+${formatted}` : "+0";
}

function formatBracketViewScore(value: number): string {
  return formatHololiveViewCount(value).replace(/\s+views$/i, "") || "0";
}

function giantKillerAverageScore(row: HololiveBracketSongStats): number {
  return row.upsetWins > 0 ? row.giantKillerScore / row.upsetWins : 0;
}

function bigGameAverageScore(row: HololiveBracketSongStats): number {
  return row.bigGameWins > 0 ? row.bigGameScore / row.bigGameWins : 0;
}

function formatBracketRelativeScore(value: number): string {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function BracketStatsMetrics<T>({ row, metrics }: { row: T; metrics: Array<BracketStatsMetric<T>> }) {
  return (
    <div className="metrics" style={{ "--metric-count": metrics.length } as CSSProperties}>
      {metrics.map((metric) => {
        const value = metric.value(row);
        return (
          <span key={metric.label} title={`${metric.label}: ${value}`}>
            {value}
          </span>
        );
      })}
    </div>
  );
}

function BracketStatsColumnHead<T>({ mainLabel, metrics }: { mainLabel: string; metrics: Array<BracketStatsMetric<T>> }) {
  return (
    <div className="hololive-bracket-stats-column-head" style={{ "--metric-count": metrics.length } as CSSProperties}>
      <span className="rank">#</span>
      <span className="main">{mainLabel}</span>
      <div className="metrics">
        {metrics.map((metric) => (
          <span key={metric.label} title={metric.label}>
            {metric.header}
          </span>
        ))}
      </div>
    </div>
  );
}

function bracketStatRankClass(index: number): string {
  return index < 3 ? ` top-rank-${index + 1}` : "";
}

const SONG_WIN_METRICS: Array<BracketStatsMetric<HololiveBracketSongStats>> = [
  { label: "Wins", header: "Wins", value: (row) => formatBracketNumber(row.wins) },
  { label: "Titles", header: "Titles", value: (row) => formatBracketNumber(row.championCount) }
];

const SONG_WIN_RATE_METRICS: Array<BracketStatsMetric<HololiveBracketSongStats>> = [
  { label: "Win rate", header: "Rate", value: (row) => formatBracketPercent(row.winRate) },
  { label: "Wins-losses", header: "W-L", value: formatBracketRecord }
];

const SONG_APPEARANCE_METRICS: Array<BracketStatsMetric<HololiveBracketSongStats>> = [
  { label: "Appearances", header: "Apps", value: (row) => formatBracketNumber(row.appearances) }
];

const SONG_FINALS_WITHOUT_TITLE_METRICS: Array<BracketStatsMetric<HololiveBracketSongStats>> = [
  { label: "Runner-up finishes", header: "2nd", value: (row) => formatBracketNumber(finalsWithoutTitle(row)) }
];

const SONG_FIRST_ROUND_METRICS: Array<BracketStatsMetric<HololiveBracketSongStats>> = [
  { label: "First-round exits", header: "Exits", value: (row) => formatBracketNumber(row.firstRoundEliminations) }
];

const SONG_UPSET_METRICS: Array<BracketStatsMetric<HololiveBracketSongStats>> = [
  { label: "Upset wins", header: "Upsets", value: (row) => formatBracketNumber(row.upsetWins) }
];

const SONG_GIANT_KILLER_METRICS: Array<BracketStatsMetric<HololiveBracketSongStats>> = [
  { label: "Total giant killer score", header: "Total", value: (row) => formatBracketViewDelta(row.giantKillerScore) }
];

const SONG_GIANT_KILLER_AVERAGE_METRICS: Array<BracketStatsMetric<HololiveBracketSongStats>> = [
  { label: "Average giant killer score", header: "Avg", value: (row) => formatBracketViewDelta(giantKillerAverageScore(row)) }
];

const SONG_BIG_GAME_METRICS: Array<BracketStatsMetric<HololiveBracketSongStats>> = [
  { label: "Total views beaten", header: "Total", value: (row) => formatBracketViewScore(row.bigGameScore) }
];

const SONG_BIG_GAME_AVERAGE_METRICS: Array<BracketStatsMetric<HololiveBracketSongStats>> = [
  { label: "Average views beaten", header: "Avg", value: (row) => formatBracketViewScore(bigGameAverageScore(row)) }
];

const SONG_PUNCHING_UP_METRICS: Array<BracketStatsMetric<HololiveBracketSongStats>> = [
  { label: "Relative upset score", header: "Score", value: (row) => formatBracketRelativeScore(row.punchingUpScore) }
];

function SongStatsTable({
  title,
  rows,
  metrics,
  emptyText = "No archived songs yet.",
  description,
  headerAction
}: {
  title: string;
  rows: HololiveBracketSongStats[];
  metrics: Array<BracketStatsMetric<HololiveBracketSongStats>>;
  emptyText?: string;
  description?: string;
  headerAction?: ReactNode;
}) {
  return (
    <section className="hololive-bracket-stats-panel">
      <header title={description}>
        <strong>{title}</strong>
        {headerAction ? <div className="hololive-bracket-stats-header-action">{headerAction}</div> : null}
      </header>
      {rows.length === 0 ? (
        <div className="hololive-bracket-stats-empty">{emptyText}</div>
      ) : (
        <div className="hololive-bracket-stats-list">
          <BracketStatsColumnHead mainLabel="Song" metrics={metrics} />
          {rows.map((row, index) => (
            <article className={`hololive-bracket-stats-row${bracketStatRankClass(index)}`} key={`${title}:${row.youtubeVideoId}`}>
              <span className="rank">{index + 1}</span>
              <div className="main">
                <strong title={row.title}>{displaySongTitle(row.title)}</strong>
                <span>
                  {row.idolName ?? "Unknown"} / {topicLabel({ topicId: row.topicId ?? "Original_Song" })}
                </span>
              </div>
              <BracketStatsMetrics row={row} metrics={metrics} />
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

const TALENT_RECORD_METRICS: Array<BracketStatsMetric<HololiveBracketTalentStats>> = [
  { label: "Wins", header: "Wins", value: (row) => formatBracketNumber(row.wins) }
];

const TALENT_DEEP_RUN_METRICS: Array<BracketStatsMetric<HololiveBracketTalentStats>> = [
  { label: "Top 4 runs", header: "Top 4", value: (row) => formatBracketNumber(row.top4Count) }
];

function TalentStatsTable({
  title = "Talent Leaders",
  rows,
  metrics = TALENT_RECORD_METRICS,
  emptyText = "No archived talents yet.",
  description
}: {
  title?: string;
  rows: HololiveBracketTalentStats[];
  metrics?: Array<BracketStatsMetric<HololiveBracketTalentStats>>;
  emptyText?: string;
  description?: string;
}) {
  return (
    <section className="hololive-bracket-stats-panel">
      <header title={description}>
        <strong>{title}</strong>
      </header>
      {rows.length === 0 ? (
        <div className="hololive-bracket-stats-empty">{emptyText}</div>
      ) : (
        <div className="hololive-bracket-stats-list">
          <BracketStatsColumnHead mainLabel="Talent" metrics={metrics} />
          {rows.map((row, index) => (
            <article className={`hololive-bracket-stats-row${bracketStatRankClass(index)}`} key={row.idolId}>
              <span className="rank">{index + 1}</span>
              <div className="main">
                <strong title={row.idolName}>{row.idolName}</strong>
              </div>
              <BracketStatsMetrics row={row} metrics={metrics} />
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

const RIVALRY_METRICS: Array<BracketStatsMetric<HololiveBracketRivalryStats>> = [
  { label: "Head-to-head record", header: "H2H", value: (row) => `${row.leftWins}-${row.rightWins}` }
];

function RivalryStatsTable({
  rows,
  description
}: {
  rows: HololiveBracketRivalryStats[];
  description?: string;
}) {
  return (
    <section className="hololive-bracket-stats-panel rivalry">
      <header title={description}>
        <strong>Rivalries</strong>
      </header>
      {rows.length === 0 ? (
        <div className="hololive-bracket-stats-empty">No repeat rivalries yet.</div>
      ) : (
        <div className="hololive-bracket-stats-list">
          <BracketStatsColumnHead mainLabel="Matchup" metrics={RIVALRY_METRICS} />
          {rows.map((row, index) => (
            <article className={`hololive-bracket-stats-row${bracketStatRankClass(index)}`} key={row.key}>
              <span className="rank">{index + 1}</span>
              <div className="main">
                <strong title={`${row.leftIdolName} vs ${row.rightIdolName}`}>
                  {row.leftIdolName} vs {row.rightIdolName}
                </strong>
              </div>
              <BracketStatsMetrics row={row} metrics={RIVALRY_METRICS} />
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
      <header title="Completed bracket champions by archive date.">
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

type BracketViewStatsMode = "total" | "average";

function BracketStatsModeToggle({
  labelPrefix,
  mode,
  onModeChange
}: {
  labelPrefix: string;
  mode: BracketViewStatsMode;
  onModeChange: (mode: BracketViewStatsMode) => void;
}) {
  const nextMode: BracketViewStatsMode = mode === "total" ? "average" : "total";
  const label = mode === "total" ? "Total" : "Avg";
  const nextLabel = nextMode === "total" ? "Total" : "Avg";

  return (
    <button
      type="button"
      className="hololive-bracket-stat-mode-button"
      aria-label={`${labelPrefix} mode: ${label}. Switch to ${nextLabel}.`}
      aria-pressed={mode === "average"}
      title={`Showing ${label}. Click for ${nextLabel}.`}
      onClick={() => onModeChange(nextMode)}
    >
      {label}
    </button>
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
  const [giantKillerMode, setGiantKillerMode] = useState<BracketViewStatsMode>("total");
  const [bigGameMode, setBigGameMode] = useState<BracketViewStatsMode>("total");

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

  const giantKillerRows =
    giantKillerMode === "average" ? stats.topSongsByGiantKillerAverage : stats.topSongsByGiantKillerScore;
  const giantKillerMetrics = giantKillerMode === "average" ? SONG_GIANT_KILLER_AVERAGE_METRICS : SONG_GIANT_KILLER_METRICS;
  const giantKillerDescription =
    giantKillerMode === "average"
      ? "Average view-count gap per lower-view upset win."
      : "Total view-count gap beaten in lower-view upset wins.";
  const bigGameRows =
    bigGameMode === "average" ? stats.topSongsByBigGameAverage : stats.topSongsByBigGameScore;
  const bigGameMetrics = bigGameMode === "average" ? SONG_BIG_GAME_AVERAGE_METRICS : SONG_BIG_GAME_METRICS;
  const bigGameDescription =
    bigGameMode === "average"
      ? "Average defeated opponent view count across all archived wins."
      : "Total defeated opponent view count across all archived wins.";
  const punchingUpRows = stats.topSongsByPunchingUpScore;
  const punchingUpDescription = "Relative score for lower-view songs beating higher-view opponents.";

  return (
    <div className="hololive-bracket-stats-view">
      <div className="hololive-bracket-stats-grid">
        <SongStatsTable
          title="Most Wins"
          rows={stats.topSongsByWins}
          metrics={SONG_WIN_METRICS}
          description="Songs with the most archived bracket match wins."
        />
        <SongStatsTable
          title="Best Win Rate"
          rows={stats.topSongsByWinRate}
          metrics={SONG_WIN_RATE_METRICS}
          description="Songs with the best match win rate across archived brackets."
        />
        <SongStatsTable
          title="Most Played"
          rows={stats.topSongsByAppearances}
          metrics={SONG_APPEARANCE_METRICS}
          description="Songs that have appeared in the most archived brackets."
        />
        <SongStatsTable
          title="Upset Wins"
          rows={stats.topSongsByUpsetWins}
          metrics={SONG_UPSET_METRICS}
          emptyText="No lower-view wins yet."
          description="Lower-view songs beating higher-view opponents."
        />
        <SongStatsTable
          title="Punching Up"
          rows={punchingUpRows}
          metrics={SONG_PUNCHING_UP_METRICS}
          emptyText="No relative upset wins yet."
          description={punchingUpDescription}
        />
        <SongStatsTable
          title="Big Game Wins"
          rows={bigGameRows}
          metrics={bigGameMetrics}
          emptyText="No view-count wins yet."
          description={bigGameDescription}
          headerAction={<BracketStatsModeToggle labelPrefix="Big game wins" mode={bigGameMode} onModeChange={setBigGameMode} />}
        />
        <SongStatsTable
          title="Giant Killers"
          rows={giantKillerRows}
          metrics={giantKillerMetrics}
          emptyText="No giant-killer wins yet."
          description={giantKillerDescription}
          headerAction={<BracketStatsModeToggle labelPrefix="Giant killer" mode={giantKillerMode} onModeChange={setGiantKillerMode} />}
        />
        <SongStatsTable
          title="Finals Heartbreak"
          rows={stats.topSongsByFinalsWithoutTitle}
          metrics={SONG_FINALS_WITHOUT_TITLE_METRICS}
          emptyText="No runner-up finishes yet."
          description="Songs that reached finals but did not win the title."
        />
        <SongStatsTable
          title="First-Round Exits"
          rows={stats.topSongsByFirstRoundEliminations}
          metrics={SONG_FIRST_ROUND_METRICS}
          emptyText="No first-round exits yet."
          description="Songs most often eliminated in their opening matchup."
        />
        <TalentStatsTable rows={stats.topTalents} description="Talents with the strongest archived match records." />
        <TalentStatsTable
          title="Deep Run Talents"
          rows={stats.topTalentsByTop4}
          metrics={TALENT_DEEP_RUN_METRICS}
          description="Talents whose songs most often reached the top four."
        />
        <RivalryStatsTable rows={stats.topRivalries} description="Talent pairings with the most archived head-to-head matches." />
      </div>
      <BracketHistoryList
        archives={archives.length > 0 ? archives : stats.championHistory}
        deletingArchiveId={deletingArchiveId}
        onDeleteArchive={onDeleteArchive}
      />
    </div>
  );
}

export function HololiveBracketPage() {
  const { showToast, showUndoToast } = useHololiveActionToast();
  const bracketCanvasRef = useRef<HTMLDivElement | null>(null);
  const playArenaRef = useRef<HTMLDivElement | null>(null);
  const matchRefs = useRef(new Map<string, HTMLElement>());
  const createMenuRef = useRef<HTMLDivElement | null>(null);
  const talentSelectorRef = useRef<HTMLDivElement | null>(null);
  const exportToastTimersRef = useRef<{ fade: number | null; clear: number | null }>({ fade: null, clear: null });
  const [summaries, setSummaries] = useState<HololiveBracketSummary[]>([]);
  const [activeBracket, setActiveBracket] = useState<HololiveBracket | null>(null);
  const [selectedSize, setSelectedSize] = useState<HololiveBracketSize>("RO64");
  const [selectedGenerationStyle, setSelectedGenerationStyle] = useState<HololiveBracketGenerationStyle>("top_songs");
  const [includedRatingBuckets, setIncludedRatingBuckets] = useState<HololiveBracketRatingBucket[]>(BRACKET_RATING_BUCKET_VALUES);
  const [excludeTopViewedPerTalent, setExcludeTopViewedPerTalent] = useState(false);
  const [excludePreviousChampions, setExcludePreviousChampions] = useState(false);
  const [excludePreviousFinalists, setExcludePreviousFinalists] = useState(false);
  const [excludePreviousTop4, setExcludePreviousTop4] = useState(false);
  const [excludePreviousTop8, setExcludePreviousTop8] = useState(false);
  const [excludeAboveViews, setExcludeAboveViews] = useState("");
  const [excludeBelowViews, setExcludeBelowViews] = useState("");
  const [excludeAfterDate, setExcludeAfterDate] = useState("");
  const [excludeBeforeDate, setExcludeBeforeDate] = useState("");
  const [includedTopicIds, setIncludedTopicIds] = useState<HololiveMusicTopic[]>(BRACKET_TOPIC_VALUES);
  const [includedVocalScopes, setIncludedVocalScopes] = useState<HololiveBracketVocalScope[]>(BRACKET_VOCAL_SCOPE_VALUES);
  const [includedTalentStatuses, setIncludedTalentStatuses] = useState<HololiveBracketTalentStatusFilter[]>(BRACKET_TALENT_STATUS_VALUES);
  const [historyParticipation, setHistoryParticipation] = useState<HololiveBracketHistoryParticipation | "all">("all");
  const [maxEntriesPerTalentEnabled, setMaxEntriesPerTalentEnabled] = useState(false);
  const [maxEntriesPerTalent, setMaxEntriesPerTalent] = useState("2");
  const [preferTopicSplitPerTalent, setPreferTopicSplitPerTalent] = useState(true);
  const [bracketTalents, setBracketTalents] = useState<HololiveIdol[]>([]);
  const [includedTalentIds, setIncludedTalentIds] = useState<string[] | null>(null);
  const [talentSelectorOpen, setTalentSelectorOpen] = useState(false);
  const [talentSelectorQuery, setTalentSelectorQuery] = useState("");
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [mode, setMode] = useState<"bracket" | "play" | "stats">("bracket");
  const [loading, setLoading] = useState(true);
  const [statsLoading, setStatsLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [deletingArchiveId, setDeletingArchiveId] = useState<string | null>(null);
  const [exportToast, setExportToast] = useState<ExportToastState | null>(null);
  const [playerData, setPlayerData] = useState<HololiveMusicPlayerData | null>(null);
  const [statsOverview, setStatsOverview] = useState<HololiveBracketStatsOverview | null>(null);
  const [archiveSummaries, setArchiveSummaries] = useState<HololiveBracketArchiveSummary[]>([]);
  const [matchupMarkersByVideoId, setMatchupMarkersByVideoId] = useState<Record<string, HololiveMusicMarker | null>>({});
  const [arenaFullscreen, setArenaFullscreen] = useState(false);
  const [connectorLayout, setConnectorLayout] = useState<BracketConnectorLayout>(() => emptyBracketConnectorLayout());

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
  const selectedTopicIds = useMemo(
    () => orderedBracketFilterValues(BRACKET_TOPIC_VALUES, includedTopicIds.length > 0 ? includedTopicIds : BRACKET_TOPIC_VALUES),
    [includedTopicIds]
  );
  const selectedVocalScopes = useMemo(
    () => orderedBracketFilterValues(BRACKET_VOCAL_SCOPE_VALUES, includedVocalScopes.length > 0 ? includedVocalScopes : BRACKET_VOCAL_SCOPE_VALUES),
    [includedVocalScopes]
  );
  const selectedTalentStatuses = useMemo(
    () =>
      orderedBracketFilterValues(
        BRACKET_TALENT_STATUS_VALUES,
        includedTalentStatuses.length > 0 ? includedTalentStatuses : BRACKET_TALENT_STATUS_VALUES
      ),
    [includedTalentStatuses]
  );
  const selectedRatingBuckets = useMemo(
    () =>
      orderedBracketFilterValues(
        BRACKET_RATING_BUCKET_VALUES,
        includedRatingBuckets.length > 0 ? includedRatingBuckets : BRACKET_RATING_BUCKET_VALUES
      ),
    [includedRatingBuckets]
  );
  const maxEntriesPerTalentValue = useMemo(() => {
    const parsed = Number.parseInt(maxEntriesPerTalent.replace(/[^\d]/g, ""), 10);
    return maxEntriesPerTalentEnabled && Number.isFinite(parsed) && parsed >= 1 ? Math.min(parsed, HOLOLIVE_BRACKET_SIZE_COUNTS[selectedSize]) : null;
  }, [maxEntriesPerTalent, maxEntriesPerTalentEnabled, selectedSize]);
  const selectableBracketTalents = useMemo(
    () =>
      bracketTalents
        .filter((talent) => selectedTalentStatuses.includes(bracketTalentStatusFilter(talent)))
        .slice()
        .sort(
          (left, right) =>
            (left.source === right.source ? 0 : left.source === "official" ? -1 : 1) ||
            left.sortOrder - right.sortOrder ||
            left.displayName.localeCompare(right.displayName)
        ),
    [bracketTalents, selectedTalentStatuses]
  );
  const allBracketTalentIds = useMemo(() => selectableBracketTalents.map((talent) => talent.id), [selectableBracketTalents]);
  const selectedTalentIds = useMemo(() => {
    if (allBracketTalentIds.length === 0) {
      return [];
    }
    if (includedTalentIds === null) {
      return allBracketTalentIds;
    }
    const knownIds = new Set(allBracketTalentIds);
    const selectedIds = includedTalentIds.filter((talentId) => knownIds.has(talentId));
    return allBracketTalentIds.filter((talentId) => selectedIds.includes(talentId));
  }, [allBracketTalentIds, includedTalentIds]);
  const isAllTalentsSelected = allBracketTalentIds.length > 0 && selectedTalentIds.length === allBracketTalentIds.length;
  const selectedTalentLabel = useMemo(() => {
    if (isAllTalentsSelected) {
      return "All";
    }
    if (selectedTalentIds.length === 0) {
      return "None";
    }
    if (selectedTalentIds.length === 1) {
      return selectableBracketTalents.find((talent) => talent.id === selectedTalentIds[0])?.displayName ?? "1 talent";
    }
    return `${selectedTalentIds.length} talents`;
  }, [isAllTalentsSelected, selectableBracketTalents, selectedTalentIds]);
  const filteredBracketTalents = useMemo(() => {
    const normalizedQuery = talentSelectorQuery.trim().toLowerCase();
    if (!normalizedQuery) {
      return selectableBracketTalents;
    }
    return selectableBracketTalents.filter((talent) => talent.displayName.toLowerCase().includes(normalizedQuery));
  }, [selectableBracketTalents, talentSelectorQuery]);
  const excludedTopicIds = useMemo(
    () => BRACKET_TOPIC_VALUES.filter((topicId) => !selectedTopicIds.includes(topicId)),
    [selectedTopicIds]
  );

  function showBracketError(error: unknown, message: string) {
    showToast({
      message,
      detail: error instanceof Error ? error.message : "Try again.",
      tone: "error"
    });
  }

  const createFilters = useMemo<HololiveBracketGenerationFilters>(
    () => ({
      ratingBuckets: selectedRatingBuckets,
      excludeTopViewedPerTalent,
      excludePreviousChampions,
      excludePreviousFinalists,
      excludePreviousTop4,
      excludePreviousTop8,
      excludeAboveViews: excludeAboveViewsValue,
      excludeBelowViews: excludeBelowViewsValue,
      excludeAfterDate: excludeAfterDate || null,
      excludeBeforeDate: excludeBeforeDate || null,
      excludeTopicIds: excludedTopicIds,
      vocalScopes: selectedVocalScopes,
      talentStatuses: selectedTalentStatuses,
      historyParticipation: historyParticipation === "all" ? null : historyParticipation,
      maxEntriesPerTalent: maxEntriesPerTalentValue,
      preferTopicSplitPerTalent,
      includedTalentIds: isAllTalentsSelected ? undefined : selectedTalentIds
    }),
    [
      excludeAboveViewsValue,
      excludeAfterDate,
      excludeBeforeDate,
      excludeBelowViewsValue,
      excludedTopicIds,
      excludePreviousChampions,
      excludePreviousFinalists,
      excludePreviousTop4,
      excludePreviousTop8,
      excludeTopViewedPerTalent,
      historyParticipation,
      isAllTalentsSelected,
      maxEntriesPerTalentValue,
      preferTopicSplitPerTalent,
      selectedTalentIds,
      selectedTalentStatuses,
      selectedVocalScopes,
      selectedRatingBuckets
    ]
  );
  const activeFilterLabels = useMemo(() => {
    const labels: string[] = [];
    if (selectedTopicIds.length === 1) {
      labels.push(selectedTopicIds[0] === "Original_Song" ? "Originals only" : "Covers only");
    }
    if (selectedVocalScopes.length === 1) {
      labels.push(selectedVocalScopes[0] === "solo" ? "Solo only" : "Group only");
    }
    if (selectedRatingBuckets.length < BRACKET_RATING_BUCKET_VALUES.length) {
      const ratingLabels = selectedRatingBuckets.map(
        (bucket) => BRACKET_RATING_FILTERS.find((rating) => rating.value === bucket)?.label ?? bucket
      );
      labels.push(ratingLabels.join(" + "));
    }
    if (selectedTalentStatuses.length < BRACKET_TALENT_STATUS_VALUES.length) {
      const statusLabels = selectedTalentStatuses.map(
        (status) => BRACKET_TALENT_STATUS_FILTERS.find((filter) => filter.value === status)?.label ?? status
      );
      labels.push(statusLabels.join(" + "));
    }
    if (!isAllTalentsSelected) {
      labels.push(selectedTalentIds.length === 0 ? "No talents" : selectedTalentLabel);
    }
    if (historyParticipation !== "all") {
      labels.push(BRACKET_HISTORY_PARTICIPATION_OPTIONS.find((option) => option.value === historyParticipation)?.label ?? "History");
    }
    if (excludeBelowViewsValue !== null) {
      labels.push(`${VIEW_THRESHOLD_FORMATTER.format(excludeBelowViewsValue)}+ views`);
    }
    if (excludeAboveViewsValue !== null) {
      labels.push(`${VIEW_THRESHOLD_FORMATTER.format(excludeAboveViewsValue)} or fewer views`);
    }
    if (excludeBeforeDate) {
      labels.push(`From ${excludeBeforeDate}`);
    }
    if (excludeAfterDate) {
      labels.push(`To ${excludeAfterDate}`);
    }
    if (excludePreviousChampions) {
      labels.push("Avoid previous winners");
    }
    if (excludePreviousFinalists) {
      labels.push("Avoid previous finalists");
    }
    if (excludePreviousTop4) {
      labels.push("Avoid previous top 4");
    }
    if (excludePreviousTop8) {
      labels.push("Avoid previous top 8");
    }
    if (excludeTopViewedPerTalent) {
      labels.push("Skip top viewed");
    }
    if (maxEntriesPerTalentValue !== null) {
      labels.push(`Max ${maxEntriesPerTalentValue} per talent`);
    }
    if (!preferTopicSplitPerTalent) {
      labels.push("No type split");
    }
    return labels;
  }, [
    excludeAboveViewsValue,
    excludeAfterDate,
    excludeBeforeDate,
    excludeBelowViewsValue,
    excludePreviousChampions,
    excludePreviousFinalists,
    excludePreviousTop4,
    excludePreviousTop8,
    excludeTopViewedPerTalent,
    historyParticipation,
    isAllTalentsSelected,
    maxEntriesPerTalentValue,
    preferTopicSplitPerTalent,
    selectedRatingBuckets,
    selectedTalentIds,
    selectedTalentLabel,
    selectedTalentStatuses,
    selectedTopicIds,
    selectedVocalScopes
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
      setConnectorLayout(emptyBracketConnectorLayout());
      return;
    }

    const canvasRect = canvas.getBoundingClientRect();
    const contentBounds = Array.from(canvas.children).reduce(
      (bounds, child) => {
        if (!(child instanceof HTMLElement) || child.classList.contains("hololive-bracket-lines")) {
          return bounds;
        }
        const rect = child.getBoundingClientRect();
        return {
          right: Math.max(bounds.right, rect.right - canvasRect.left),
          bottom: Math.max(bounds.bottom, rect.bottom - canvasRect.top)
        };
      },
      { right: canvas.clientWidth, bottom: canvas.clientHeight }
    );
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
      width: Math.ceil(Math.max(1, contentBounds.right)),
      height: Math.ceil(Math.max(1, contentBounds.bottom)),
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
      setConnectorLayout(emptyBracketConnectorLayout());
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

  useLayoutEffect(() => {
    setConnectorLayout(emptyBracketConnectorLayout());
  }, [activeBracket?.id, activeBracket?.size, mode]);

  async function loadInitial() {
    setLoading(true);
    try {
      const [nextSummaries, nextPlayerData, nextTierData] = await Promise.all([
        api.invoke("hololive:brackets:list", null),
        api.invoke("hololive:player:data", null),
        api.invoke("hololive:tier-data", null)
      ]);
      setPlayerData(nextPlayerData);
      setBracketTalents(nextTierData.idols);
      setSummaries(nextSummaries);
      if (nextSummaries[0]) {
        const bracket = await api.invoke("hololive:brackets:get", { bracketId: nextSummaries[0].id });
        setActiveBracket(bracket);
      }
    } catch (nextError) {
      showBracketError(nextError, "Could not load brackets");
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
    } catch (nextError) {
      showBracketError(nextError, "Could not load bracket stats");
    } finally {
      setStatsLoading(false);
    }
  }

  useEffect(() => {
    void loadInitial();
  }, []);

  useEffect(() => {
    if (allBracketTalentIds.length === 0 || includedTalentIds === null) {
      return;
    }
    const knownIds = new Set(allBracketTalentIds);
    const nextTalentIds = includedTalentIds.filter((talentId) => knownIds.has(talentId));
    if (nextTalentIds.length === allBracketTalentIds.length) {
      setIncludedTalentIds(null);
    } else if (nextTalentIds.length !== includedTalentIds.length) {
      setIncludedTalentIds(nextTalentIds);
    }
  }, [allBracketTalentIds, includedTalentIds]);

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
          showBracketError(nextError, "Could not load matchup song actions");
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

  useEffect(() => {
    if (!talentSelectorOpen) {
      return;
    }

    const closeTalentSelector = () => {
      setTalentSelectorOpen(false);
      setTalentSelectorQuery("");
    };
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && talentSelectorRef.current?.contains(target)) {
        return;
      }
      closeTalentSelector();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeTalentSelector();
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [talentSelectorOpen]);

  async function selectBracket(bracketId: string) {
    if (!bracketId) {
      setActiveBracket(null);
      return;
    }

    setBusy(true);
    try {
      setActiveBracket(await api.invoke("hololive:brackets:get", { bracketId }));
    } catch (nextError) {
      showBracketError(nextError, "Could not open bracket");
    } finally {
      setBusy(false);
    }
  }

  async function createBracket() {
    const generationStyle = selectedGenerationStyle;
    const name = nameDraft.trim() || null;
    setBusy(true);
    try {
      const result = await api.invoke("hololive:brackets:create", {
        size: selectedSize,
        generationStyle,
        filters: createFilters,
        name
      });
      const bracket = result.bracket;
      setActiveBracket(bracket);
      for (const warning of result.warnings) {
        showToast({
          message: warning.message,
          tone: "info"
        });
      }
      setNameDraft("");
      setCreateMenuOpen(false);
      setSummaries(await api.invoke("hololive:brackets:list", null));
      setMode("play");
    } catch (nextError) {
      showBracketError(nextError, "Could not create bracket");
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
    } catch (nextError) {
      showBracketError(nextError, "Could not save winner");
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
    } catch (nextError) {
      showBracketError(nextError, "Could not undo pick");
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
    } catch (nextError) {
      showBracketError(nextError, "Could not reset bracket");
    } finally {
      setBusy(false);
    }
  }

  async function performRemoveBracket(bracket: HololiveBracket) {
    setBusy(true);
    try {
      const nextSummaries = await api.invoke("hololive:brackets:delete", { bracketId: bracket.id });
      setSummaries(nextSummaries);
      setActiveBracket(nextSummaries[0] ? await api.invoke("hololive:brackets:get", { bracketId: nextSummaries[0].id }) : null);
      if (bracket.status === "complete" || statsOverview || archiveSummaries.length > 0) {
        await loadBracketStats();
      }
    } catch (nextError) {
      showBracketError(nextError, "Could not delete bracket");
    } finally {
      setBusy(false);
    }
  }

  function removeBracket() {
    if (!activeBracket) {
      return;
    }
    showToast({
      message: `Delete ${activeBracket.name}?`,
      detail: "This removes the saved bracket run.",
      tone: "error",
      actionLabel: "Delete",
      onAction: () => performRemoveBracket(activeBracket)
    });
  }

  async function performRemoveArchive(archive: HololiveBracketArchiveSummary) {
    setDeletingArchiveId(archive.id);
    try {
      const response = await api.invoke("hololive:brackets:archives:delete", { archiveId: archive.id });
      const nextStats = await api.invoke("hololive:brackets:stats", null);
      setArchiveSummaries(response.data);
      setStatsOverview(nextStats);
      if (response.undoToken) {
        showUndoToast({
          message: "Archive deleted",
          undoToken: response.undoToken,
          undoLabel: response.undoLabel,
          onApplied: loadBracketStats
        });
      }
    } catch (nextError) {
      showBracketError(nextError, "Could not delete archived bracket run");
    } finally {
      setDeletingArchiveId(null);
    }
  }

  function removeArchive(archive: HololiveBracketArchiveSummary) {
    showToast({
      message: `Delete archived run "${archive.name}"?`,
      detail: "This removes its bracket stats history.",
      tone: "error",
      actionLabel: "Delete",
      onAction: () => performRemoveArchive(archive)
    });
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
    }, HOLOLIVE_EXPORT_TOAST_DURATION_MS);
    exportToastTimersRef.current.clear = window.setTimeout(() => {
      setExportToast((current) => (current?.id === id ? null : current));
    }, HOLOLIVE_EXPORT_TOAST_DURATION_MS + 500);
  }

  async function openExportToast(filePath: string) {
    dismissExportToast();
    try {
      await api.invoke("app:open-path", { filePath });
    } catch (nextError) {
      showBracketError(nextError, "Could not open exported bracket image");
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
    } catch (nextError) {
      showBracketError(nextError, "Could not export bracket image");
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
    } catch (nextError) {
      showBracketError(nextError, "Could not toggle fullscreen");
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
  }

  async function addBracketEntryToPlaylist(entry: HololiveBracketEntry, playlistId: string) {
    setPlayerData(
      await api.invoke("hololive:player:playlist-item:add", {
        playlistId,
        youtubeVideoId: entry.youtubeVideoId
      })
    );
  }

  function toggleIncludedTopic(topicId: HololiveMusicTopic) {
    setIncludedTopicIds((current) => {
      const selected = current.length > 0 ? current : BRACKET_TOPIC_VALUES;
      if (selected.includes(topicId)) {
        return selected.length <= 1 ? selected : selected.filter((topic) => topic !== topicId);
      }
      return orderedBracketFilterValues(BRACKET_TOPIC_VALUES, [...selected, topicId]);
    });
  }

  function toggleIncludedVocalScope(scope: HololiveBracketVocalScope) {
    setIncludedVocalScopes((current) => {
      const selected = current.length > 0 ? current : BRACKET_VOCAL_SCOPE_VALUES;
      if (selected.includes(scope)) {
        return selected.length <= 1 ? selected : selected.filter((value) => value !== scope);
      }
      return orderedBracketFilterValues(BRACKET_VOCAL_SCOPE_VALUES, [...selected, scope]);
    });
  }

  function toggleIncludedRatingBucket(bucket: HololiveBracketRatingBucket) {
    setIncludedRatingBuckets((current) => {
      const selected = current.length > 0 ? current : BRACKET_RATING_BUCKET_VALUES;
      if (selected.includes(bucket)) {
        return selected.length <= 1 ? selected : selected.filter((value) => value !== bucket);
      }
      return orderedBracketFilterValues(BRACKET_RATING_BUCKET_VALUES, [...selected, bucket]);
    });
  }

  function toggleIncludedTalentStatus(status: HololiveBracketTalentStatusFilter) {
    setIncludedTalentStatuses((current) => {
      const selected = current.length > 0 ? current : BRACKET_TALENT_STATUS_VALUES;
      if (selected.includes(status)) {
        return selected.length <= 1 ? selected : selected.filter((value) => value !== status);
      }
      return orderedBracketFilterValues(BRACKET_TALENT_STATUS_VALUES, [...selected, status]);
    });
  }

  function toggleAllBracketTalents() {
    setIncludedTalentIds(isAllTalentsSelected ? [] : null);
    setTalentSelectorQuery("");
  }

  function toggleIncludedTalent(talentId: string) {
    setIncludedTalentIds((current) => {
      const allIds = allBracketTalentIds;
      const selected = current === null ? allIds : current.filter((id) => allIds.includes(id));
      if (selected.includes(talentId)) {
        return selected.filter((id) => id !== talentId);
      }
      const nextSelected = allIds.filter((id) => selected.includes(id) || id === talentId);
      return nextSelected.length === allIds.length ? null : nextSelected;
    });
  }

  function clearBracketFilters() {
    setIncludedRatingBuckets(BRACKET_RATING_BUCKET_VALUES);
    setIncludedTalentIds(null);
    setTalentSelectorOpen(false);
    setTalentSelectorQuery("");
    setExcludeTopViewedPerTalent(false);
    setExcludePreviousChampions(false);
    setExcludePreviousFinalists(false);
    setExcludePreviousTop4(false);
    setExcludePreviousTop8(false);
    setExcludeAboveViews("");
    setExcludeBelowViews("");
    setExcludeAfterDate("");
    setExcludeBeforeDate("");
    setIncludedTopicIds(BRACKET_TOPIC_VALUES);
    setIncludedVocalScopes(BRACKET_VOCAL_SCOPE_VALUES);
    setIncludedTalentStatuses(BRACKET_TALENT_STATUS_VALUES);
    setHistoryParticipation("all");
    setMaxEntriesPerTalentEnabled(false);
    setMaxEntriesPerTalent("2");
    setPreferTopicSplitPerTalent(true);
  }

  return (
    <section className="page hololive-page hololive-bracket-page">
      <div className="hololive-bracket-workspace">
        <HololiveViewSwitch />
        {exportToast && (
          <button
            type="button"
            className={`hololive-export-toast${exportToast.fading ? " fading" : ""}`}
            onClick={() => void openExportToast(exportToast.filePath)}
            title="Open exported bracket image"
            style={{ "--toast-duration-ms": `${HOLOLIVE_EXPORT_TOAST_DURATION_MS}ms` } as CSSProperties}
          >
            <CheckCircle2 size={16} />
            <span>
              <strong>Bracket image saved</strong>
              <small>{fileNameFromPath(exportToast.filePath)}</small>
            </span>
            <span className="hololive-toast-progress" aria-hidden="true" />
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
                  <div className="hololive-bracket-create-field size-field">
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
                  <div className="hololive-bracket-create-field style-field">
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
                  <div className={`hololive-bracket-exclusions${activeFilterLabels.length > 0 ? " has-active" : ""}`}>
                    <div className="hololive-bracket-filter-row">
                      <span className="hololive-bracket-exclusions-title">
                        <ListMusic size={13} />
                        <strong>Song Pool</strong>
                      </span>
                      <div className="hololive-bracket-filter-chips" aria-label="Active bracket filters">
                        {activeFilterLabels.length > 0 ? (
                          <>
                            {activeFilterLabels.slice(0, 5).map((label) => (
                              <span key={label}>{label}</span>
                            ))}
                            {activeFilterLabels.length > 5 && <span>+{activeFilterLabels.length - 5}</span>}
                          </>
                        ) : (
                          <span className="empty">All songs</span>
                        )}
                      </div>
                      {activeFilterLabels.length > 0 && (
                        <button
                          type="button"
                          className="hololive-bracket-exclusions-clear"
                          title="Reset filters"
                          disabled={busy}
                          onClick={clearBracketFilters}
                        >
                          <RotateCcw size={12} />
                          Reset
                        </button>
                      )}
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
                        <section className="hololive-bracket-filter-group song-pool">
                          <h4>Song Pool</h4>
                          <div className="hololive-bracket-filter-line">
                            <div className="hololive-bracket-filter-line-grid talent-history-row">
                              <div className="hololive-bracket-filter-fieldset talent-picker-field">
                                <span className="hololive-bracket-filter-fieldset-label">Talents</span>
                                <div
                                  className={["hololive-bracket-talent-selector", talentSelectorOpen ? "open" : ""].filter(Boolean).join(" ")}
                                  ref={talentSelectorRef}
                                  onBlur={(event) => {
                                    const nextFocus = event.relatedTarget;
                                    if (!(nextFocus instanceof Node) || !event.currentTarget.contains(nextFocus)) {
                                      setTalentSelectorOpen(false);
                                      setTalentSelectorQuery("");
                                    }
                                  }}
                                >
                                  <button
                                    type="button"
                                    className="hololive-bracket-talent-selector-button"
                                    aria-expanded={talentSelectorOpen}
                                    disabled={busy || selectableBracketTalents.length === 0}
                                    onClick={() => setTalentSelectorOpen((open) => !open)}
                                  >
                                    <span>{selectedTalentLabel}</span>
                                    <ChevronDown size={13} className={talentSelectorOpen ? "open" : ""} />
                                  </button>
                                  {talentSelectorOpen ? (
                                    <div className="hololive-bracket-talent-selector-menu">
                                      <input
                                        aria-label="Search bracket talents"
                                        value={talentSelectorQuery}
                                        placeholder="Search talents"
                                        disabled={busy}
                                        onChange={(event) => setTalentSelectorQuery(event.target.value)}
                                        onKeyDown={(event) => {
                                          if (event.key === "Escape") {
                                            event.preventDefault();
                                            setTalentSelectorOpen(false);
                                            setTalentSelectorQuery("");
                                          }
                                        }}
                                      />
                                      <div className="hololive-bracket-talent-selector-list">
                                        <button
                                          type="button"
                                          className="hololive-bracket-talent-option"
                                          role="menuitemcheckbox"
                                          aria-checked={isAllTalentsSelected}
                                          disabled={busy}
                                          onMouseDown={(event) => event.preventDefault()}
                                          onClick={toggleAllBracketTalents}
                                        >
                                          <span className="hololive-bracket-talent-check" aria-hidden="true" />
                                          <span>All</span>
                                        </button>
                                        {filteredBracketTalents.map((talent) => {
                                          const checked = selectedTalentIds.includes(talent.id);
                                          return (
                                            <button
                                              type="button"
                                              className="hololive-bracket-talent-option"
                                              key={talent.id}
                                              role="menuitemcheckbox"
                                              aria-checked={checked}
                                              disabled={busy}
                                              onMouseDown={(event) => event.preventDefault()}
                                              onClick={() => toggleIncludedTalent(talent.id)}
                                            >
                                              <span className="hololive-bracket-talent-check" aria-hidden="true" />
                                              <span title={talent.displayName}>{talent.displayName}</span>
                                            </button>
                                          );
                                        })}
                                        {filteredBracketTalents.length === 0 ? (
                                          <span className="hololive-bracket-talent-empty">No talents found</span>
                                        ) : null}
                                      </div>
                                    </div>
                                  ) : null}
                                </div>
                              </div>
                              <div className="hololive-bracket-filter-fieldset">
                                <span className="hololive-bracket-filter-fieldset-label">History</span>
                                <CompactSelect
                                  ariaLabel="History participation"
                                  className="hololive-bracket-history-select"
                                  value={historyParticipation}
                                  options={BRACKET_HISTORY_PARTICIPATION_OPTIONS}
                                  disabled={busy}
                                  onChange={setHistoryParticipation}
                                />
                              </div>
                            </div>
                          </div>
                          <div className="hololive-bracket-filter-line">
                            <div className="hololive-bracket-filter-line-control">
                              <div className="hololive-bracket-filter-fieldset status-field">
                                <span className="hololive-bracket-filter-fieldset-label">Status</span>
                                <div className="hololive-bracket-exclusion-list talent-statuses">
                                  {BRACKET_TALENT_STATUS_FILTERS.map((status) => {
                                    const checked = selectedTalentStatuses.includes(status.value);
                                    return (
                                      <label className="hololive-bracket-exclusion-option" key={status.value}>
                                        <input
                                          type="checkbox"
                                          checked={checked}
                                          disabled={busy || (checked && selectedTalentStatuses.length <= 1)}
                                          onChange={() => toggleIncludedTalentStatus(status.value)}
                                        />
                                        <BracketFilterOptionText copy={status} />
                                      </label>
                                    );
                                  })}
                                </div>
                              </div>
                            </div>
                          </div>
                          <div className="hololive-bracket-filter-line">
                            <div className="hololive-bracket-filter-line-grid">
                              <div className="hololive-bracket-filter-fieldset">
                                <span className="hololive-bracket-filter-fieldset-label">Type</span>
                                <div className="hololive-bracket-exclusion-list compact-pair">
                                  {BRACKET_TOPIC_FILTERS.map((topic) => {
                                    const checked = selectedTopicIds.includes(topic.value);
                                    return (
                                      <label className="hololive-bracket-exclusion-option" key={topic.value}>
                                        <input
                                          type="checkbox"
                                          checked={checked}
                                          disabled={busy || (checked && selectedTopicIds.length <= 1)}
                                          onChange={() => toggleIncludedTopic(topic.value)}
                                        />
                                        <BracketFilterOptionText copy={topic} />
                                      </label>
                                    );
                                  })}
                                </div>
                              </div>
                              <div className="hololive-bracket-filter-fieldset">
                                <span className="hololive-bracket-filter-fieldset-label">Singers</span>
                                <div className="hololive-bracket-exclusion-list compact-pair">
                                  {BRACKET_VOCAL_SCOPE_FILTERS.map((scope) => {
                                    const checked = selectedVocalScopes.includes(scope.value);
                                    return (
                                      <label className="hololive-bracket-exclusion-option" key={scope.value}>
                                        <input
                                          type="checkbox"
                                          checked={checked}
                                          disabled={busy || (checked && selectedVocalScopes.length <= 1)}
                                          onChange={() => toggleIncludedVocalScope(scope.value)}
                                        />
                                        <BracketFilterOptionText copy={scope} />
                                      </label>
                                    );
                                  })}
                                </div>
                              </div>
                            </div>
                          </div>
                          <div className="hololive-bracket-filter-line">
                            <div className="hololive-bracket-filter-line-control">
                              <div className="hololive-bracket-filter-fieldset">
                                <span className="hololive-bracket-filter-fieldset-label">Ratings</span>
                                <div className="hololive-bracket-exclusion-list rating-buckets">
                                  {BRACKET_RATING_FILTERS.map((rating) => {
                                    const checked = selectedRatingBuckets.includes(rating.value);
                                    return (
                                      <label className="hololive-bracket-exclusion-option" key={rating.value}>
                                        <input
                                          type="checkbox"
                                          checked={checked}
                                          disabled={busy || (checked && selectedRatingBuckets.length <= 1)}
                                          onChange={() => toggleIncludedRatingBucket(rating.value)}
                                        />
                                        <BracketFilterOptionText copy={rating} />
                                      </label>
                                    );
                                  })}
                                </div>
                              </div>
                            </div>
                          </div>
                          <div className="hololive-bracket-filter-line">
                            <div className="hololive-bracket-filter-line-grid">
                              <div className="hololive-bracket-filter-fieldset">
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
                              </div>
                              <div className="hololive-bracket-filter-fieldset">
                                <div className="hololive-bracket-date-filters">
                                  <label>
                                    <BracketFilterFieldLabel copy={BRACKET_FILTER_COPY.fromDate} />
                                    <input
                                      type="date"
                                      aria-label={bracketFilterAriaLabel(BRACKET_FILTER_COPY.fromDate)}
                                      value={excludeBeforeDate}
                                      disabled={busy}
                                      onChange={(event) => setExcludeBeforeDate(event.target.value)}
                                    />
                                  </label>
                                  <label>
                                    <BracketFilterFieldLabel copy={BRACKET_FILTER_COPY.toDate} />
                                    <input
                                      type="date"
                                      aria-label={bracketFilterAriaLabel(BRACKET_FILTER_COPY.toDate)}
                                      value={excludeAfterDate}
                                      disabled={busy}
                                      onChange={(event) => setExcludeAfterDate(event.target.value)}
                                    />
                                  </label>
                                </div>
                              </div>
                            </div>
                          </div>
                        </section>
                        <section className="hololive-bracket-filter-group avoid-previous-results">
                          <h4>Avoid Previous Results</h4>
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
                        <section className="hololive-bracket-filter-group variety-rules-group">
                          <h4>Variety Rules</h4>
                          <div className="hololive-bracket-variety-rules">
                            <label className="hololive-bracket-exclusion-option">
                              <input
                                type="checkbox"
                                checked={excludeTopViewedPerTalent}
                                disabled={busy}
                                onChange={(event) => setExcludeTopViewedPerTalent(event.target.checked)}
                              />
                              <BracketFilterOptionText copy={BRACKET_FILTER_COPY.topViewed} />
                            </label>
                            <div className="hololive-bracket-coverage-control">
                              <label className="hololive-bracket-exclusion-option">
                                <input
                                  type="checkbox"
                                  checked={maxEntriesPerTalentEnabled}
                                  disabled={busy}
                                  onChange={(event) => {
                                    setMaxEntriesPerTalentEnabled(event.target.checked);
                                    if (event.target.checked && !maxEntriesPerTalent.trim()) {
                                      setMaxEntriesPerTalent("2");
                                    }
                                  }}
                                />
                                <span
                                  className="hololive-bracket-filter-option-text"
                                  title="Limit how many songs one talent can receive before the picker relaxes the cap if needed."
                                >
                                  <strong>Max per talent</strong>
                                </span>
                              </label>
                              <input
                                type="text"
                                inputMode="numeric"
                                aria-label="Max songs per talent"
                                placeholder="No limit"
                                value={maxEntriesPerTalentEnabled ? maxEntriesPerTalent : ""}
                                disabled={busy || !maxEntriesPerTalentEnabled}
                                onChange={(event) => setMaxEntriesPerTalent(event.target.value.replace(/[^\d]/g, "").slice(0, 3))}
                                onBlur={() => {
                                  const parsed = Number.parseInt(maxEntriesPerTalent.replace(/[^\d]/g, ""), 10);
                                  setMaxEntriesPerTalent(
                                    Number.isFinite(parsed) && parsed >= 1
                                      ? String(Math.min(parsed, HOLOLIVE_BRACKET_SIZE_COUNTS[selectedSize]))
                                      : "2"
                                  );
                                }}
                              />
                            </div>
                            <label className="hololive-bracket-exclusion-option">
                              <input
                                type="checkbox"
                                checked={preferTopicSplitPerTalent}
                                disabled={busy}
                                onChange={(event) => setPreferTopicSplitPerTalent(event.target.checked)}
                              />
                              <span
                                className="hololive-bracket-filter-option-text"
                                title="Prefer spreading a talent's picks across originals and covers before same-type extras."
                              >
                                <strong>Prefer original/cover split</strong>
                              </span>
                            </label>
                          </div>
                        </section>
                      </div>
                    )}
                  </div>
                  <div className="hololive-bracket-create-actions">
                    <button type="button" className="primary" disabled={busy || selectedTalentIds.length === 0} onClick={() => void createBracket()}>
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
                        <strong>{displayHololiveBracketRoundLabel(round.label)}</strong>
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
                        <strong>{displayHololiveBracketRoundLabel(round.label)}</strong>
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
