import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import {
  ArrowUpDown,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
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
  HololiveBracketRatingStatsRow,
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
import { getHololiveCanonicalTalentIdentity, getHololiveCanonicalTalentId } from "../../shared/hololiveTalentIdentity";
import { resolveHololiveTalentTheme, type HololiveTalentTheme } from "../../shared/hololiveTalentTheme";
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

function formatBracketRating(value: number): string {
  return Math.round(value).toLocaleString();
}

function formatBracketRawScore(value: number): string {
  if (!Number.isFinite(value)) {
    return "0.00";
  }
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function formatBracketSignedRawScore(value: number): string {
  if (!Number.isFinite(value)) {
    return "0.00";
  }
  const formatted = Math.abs(value).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  return `${value > 0 ? "+" : value < 0 ? "-" : ""}${formatted}`;
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

function formatBracketRelativeRatioScore(value: number): string {
  const ratio = Math.pow(2, Math.max(0, value));
  if (!Number.isFinite(ratio)) {
    return "1.0x";
  }

  return `${ratio.toLocaleString(undefined, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  })}x`;
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
  { label: "Opportunity-adjusted upset ratio", header: "Score", value: (row) => formatBracketRelativeRatioScore(row.punchingAboveScore) }
];

const RATING_METRICS: Array<BracketStatsMetric<HololiveBracketRatingStatsRow>> = [
  { label: "Conservative rating (rating - 2*RD)", header: "Rating", value: (row) => formatBracketRating(row.conservativeRating) },
  { label: "Rating uncertainty", header: "\u00b1RD", value: (row) => `\u00b1${formatBracketRating(row.ratingDeviation)}` },
  { label: "Wins-losses", header: "W-L", value: formatBracketRecord },
  { label: "Matches", header: "Matches", value: (row) => formatBracketNumber(row.matches) }
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

type BracketRatingMode = "song" | "talent";

function RatingStatsTable({
  songRows,
  talentRows
}: {
  songRows: HololiveBracketRatingStatsRow[];
  talentRows: HololiveBracketRatingStatsRow[];
}) {
  const [mode, setMode] = useState<BracketRatingMode>("song");
  const rows = mode === "song" ? songRows : talentRows;
  const mainLabel = mode === "song" ? "Song" : "Talent";

  return (
    <section className="hololive-bracket-stats-panel ratings">
      <header title="Conservative Glicko-2 ratings calculated as raw rating minus twice the rating uncertainty.">
        <strong>Ratings</strong>
        <div className="hololive-bracket-rating-switcher" role="group" aria-label="Rating leaderboard type">
          <button type="button" aria-pressed={mode === "song"} onClick={() => setMode("song")}>
            Song Rating
          </button>
          <button type="button" aria-pressed={mode === "talent"} onClick={() => setMode("talent")}>
            Talent Rating
          </button>
        </div>
      </header>
      {rows.length === 0 ? (
        <div className="hololive-bracket-stats-empty">No archived rating history yet.</div>
      ) : (
        <div className="hololive-bracket-rating-scroll">
          <div className="hololive-bracket-stats-list">
            <BracketStatsColumnHead mainLabel={mainLabel} metrics={RATING_METRICS} />
            {rows.map((row, index) => (
              <article className={`hololive-bracket-stats-row${bracketStatRankClass(index)}`} key={`${mode}:${row.id}`}>
                <span className="rank">{index + 1}</span>
                <div className="main">
                  <strong title={row.label}>{mode === "song" ? displaySongTitle(row.label) : row.label}</strong>
                  {row.detail ? <span title={row.detail}>{row.detail}</span> : null}
                </div>
                <BracketStatsMetrics row={row} metrics={RATING_METRICS} />
              </article>
            ))}
          </div>
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

type BracketStatsSection = "overview" | "detailed";
type BracketSongSort = "rating" | "wins" | "winRate" | "titles" | "apps" | "upsets" | "highStakes";
type BracketTalentSort = "rating" | "wins" | "winRate" | "strength" | "top4" | "titles";
type BracketStatsDetail =
  | { kind: "song"; row: HololiveBracketSongStats }
  | { kind: "talent"; row: HololiveBracketTalentStats };

const BRACKET_STATS_SECTIONS: Array<{ value: BracketStatsSection; label: string }> = [
  { value: "overview", label: "Overview" },
  { value: "detailed", label: "Detailed Stats" }
];

const BRACKET_SONG_SORTS: Array<{ value: BracketSongSort; label: string }> = [
  { value: "rating", label: "Rating" },
  { value: "wins", label: "Wins" },
  { value: "winRate", label: "Win Rate" },
  { value: "titles", label: "Titles" },
  { value: "apps", label: "Apps" },
  { value: "upsets", label: "Upsets" },
  { value: "highStakes", label: "High-Stakes" }
];

const BRACKET_TALENT_SORTS: Array<{ value: BracketTalentSort; label: string }> = [
  { value: "rating", label: "Rating" },
  { value: "wins", label: "Wins" },
  { value: "winRate", label: "Win Rate" },
  { value: "strength", label: "Opp Level" },
  { value: "top4", label: "Top 4" },
  { value: "titles", label: "Titles" }
];

function compareBracketStatText(left: string | null | undefined, right: string | null | undefined): number {
  return (left ?? "").localeCompare(right ?? "");
}

function ratingOrZero(row: HololiveBracketRatingStatsRow | undefined): number {
  return row?.conservativeRating ?? Number.NEGATIVE_INFINITY;
}

function handleStatsRowKeyDown(event: ReactKeyboardEvent<HTMLElement>, action: () => void) {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    action();
  }
}

function songStatsFallback(left: HololiveBracketSongStats, right: HololiveBracketSongStats): number {
  return (
    right.wins - left.wins ||
    right.championCount - left.championCount ||
    right.appearances - left.appearances ||
    compareBracketStatText(left.title, right.title) ||
    left.youtubeVideoId.localeCompare(right.youtubeVideoId)
  );
}

function talentStatsFallback(left: HololiveBracketTalentStats, right: HololiveBracketTalentStats): number {
  return (
    right.wins - left.wins ||
    right.championCount - left.championCount ||
    right.appearances - left.appearances ||
    compareBracketStatText(left.idolName, right.idolName) ||
    left.idolId.localeCompare(right.idolId)
  );
}

function sortBracketSongs(
  rows: HololiveBracketSongStats[],
  sort: BracketSongSort,
  ratingRows: Map<string, HololiveBracketRatingStatsRow>
): HololiveBracketSongStats[] {
  return [...rows].sort((left, right) => {
    const leftRating = ratingRows.get(left.youtubeVideoId);
    const rightRating = ratingRows.get(right.youtubeVideoId);
    switch (sort) {
      case "rating":
        return ratingOrZero(rightRating) - ratingOrZero(leftRating) || songStatsFallback(left, right);
      case "winRate":
        return right.winRate - left.winRate || right.wins - left.wins || right.appearances - left.appearances || songStatsFallback(left, right);
      case "titles":
        return right.championCount - left.championCount || right.finalistCount - left.finalistCount || songStatsFallback(left, right);
      case "apps":
        return right.appearances - left.appearances || songStatsFallback(left, right);
      case "upsets":
        return right.upsetWins - left.upsetWins || right.punchingAboveScore - left.punchingAboveScore || right.giantKillerScore - left.giantKillerScore || songStatsFallback(left, right);
      case "highStakes":
        return right.bigGameScore - left.bigGameScore || right.bigGameWins - left.bigGameWins || songStatsFallback(left, right);
      case "wins":
      default:
        return songStatsFallback(left, right);
    }
  });
}

function sortBracketTalents(
  rows: HololiveBracketTalentStats[],
  sort: BracketTalentSort,
  ratingRows: Map<string, HololiveBracketRatingStatsRow>
): HololiveBracketTalentStats[] {
  return [...rows].sort((left, right) => {
    const leftRating = ratingRows.get(left.idolId);
    const rightRating = ratingRows.get(right.idolId);
    switch (sort) {
      case "rating":
        return ratingOrZero(rightRating) - ratingOrZero(leftRating) || talentStatsFallback(left, right);
      case "winRate":
        return right.winRate - left.winRate || right.wins - left.wins || right.appearances - left.appearances || talentStatsFallback(left, right);
      case "strength":
        return (
          right.strengthOfWinsScore - left.strengthOfWinsScore ||
          right.strengthOfWinsCount - left.strengthOfWinsCount ||
          talentStatsFallback(left, right)
        );
      case "top4":
        return right.top4Count - left.top4Count || right.finalistCount - left.finalistCount || talentStatsFallback(left, right);
      case "titles":
        return right.championCount - left.championCount || right.finalistCount - left.finalistCount || talentStatsFallback(left, right);
      case "wins":
      default:
        return talentStatsFallback(left, right);
    }
  });
}

function BracketStatsSortButtons<T extends string>({
  label,
  options,
  value,
  onChange
}: {
  label: string;
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="hololive-bracket-stats-sort" role="group" aria-label={label}>
      {options.map((option) => (
        <button type="button" key={option.value} aria-pressed={value === option.value} onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

function BracketStatsRatingLeaderboard({
  mode,
  songRows,
  talentRows,
  songStatsById,
  talentStatsById,
  onSongSelect,
  onTalentSelect,
  limit
}: {
  mode: BracketRatingMode;
  songRows: HololiveBracketRatingStatsRow[];
  talentRows: HololiveBracketRatingStatsRow[];
  songStatsById: Map<string, HololiveBracketSongStats>;
  talentStatsById: Map<string, HololiveBracketTalentStats>;
  onSongSelect: (row: HololiveBracketSongStats) => void;
  onTalentSelect: (row: HololiveBracketTalentStats) => void;
  limit?: number;
}) {
  const rows = (mode === "song" ? songRows : talentRows).slice(0, limit);
  const mainLabel = mode === "song" ? "Song" : "Talent";

  return (
    <section className="hololive-bracket-stats-panel ratings">
      <header title="Conservative Glicko-2 rating, sorted by rating minus twice the uncertainty.">
        <strong>{mainLabel} Leaderboard</strong>
      </header>
      {rows.length === 0 ? (
        <div className="hololive-bracket-stats-empty">No archived rating history yet.</div>
      ) : (
        <div className="hololive-bracket-rating-scroll">
          <div className="hololive-bracket-rating-table">
            <div className="hololive-bracket-rating-row head">
              <span>#</span>
              <span>{mainLabel}</span>
              <span>Rating</span>
              <span>Record</span>
              <span>Win %</span>
              <span>Matches</span>
            </div>
            {rows.map((row, index) => (
              <article
                className={`hololive-bracket-rating-row clickable${bracketStatRankClass(index)}`}
                key={`${mode}:${row.id}`}
                role="button"
                tabIndex={0}
                onClick={() => {
                  const detailRow = mode === "song" ? songStatsById.get(row.id) : talentStatsById.get(row.id);
                  if (detailRow) {
                    if (mode === "song") {
                      onSongSelect(detailRow as HololiveBracketSongStats);
                    } else {
                      onTalentSelect(detailRow as HololiveBracketTalentStats);
                    }
                  }
                }}
                onKeyDown={(event) =>
                  handleStatsRowKeyDown(event, () => {
                    const detailRow = mode === "song" ? songStatsById.get(row.id) : talentStatsById.get(row.id);
                    if (detailRow) {
                      if (mode === "song") {
                        onSongSelect(detailRow as HololiveBracketSongStats);
                      } else {
                        onTalentSelect(detailRow as HololiveBracketTalentStats);
                      }
                    }
                  })
                }
              >
                <span className="rank">{index + 1}</span>
                <div className="main">
                  <strong title={row.label}>{mode === "song" ? displaySongTitle(row.label) : row.label}</strong>
                  <small title={row.detail ?? `Uncertainty +/-${formatBracketRating(row.ratingDeviation)}`}>
                    {row.detail ? `${row.detail} / ` : ""}&plusmn;{formatBracketRating(row.ratingDeviation)}
                  </small>
                </div>
                <span title={`Raw rating ${formatBracketRating(row.rating)} minus 2*RD`}>{formatBracketRating(row.conservativeRating)}</span>
                <span>{formatBracketRecord(row)}</span>
                <span>{formatBracketPercent(row.matches > 0 ? row.wins / row.matches : 0)}</span>
                <span>{formatBracketNumber(row.matches)}</span>
              </article>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function BracketSongPerformanceTable({
  rows,
  ratingRows,
  sort,
  onSortChange,
  onSongSelect,
  limit,
  title = "Song Performance"
}: {
  rows: HololiveBracketSongStats[];
  ratingRows: Map<string, HololiveBracketRatingStatsRow>;
  sort: BracketSongSort;
  onSortChange: (sort: BracketSongSort) => void;
  onSongSelect: (row: HololiveBracketSongStats) => void;
  limit?: number;
  title?: string;
}) {
  const sortedRows = sortBracketSongs(rows, sort, ratingRows).slice(0, limit);

  return (
    <section className={`hololive-bracket-stats-panel performance songs${limit ? " preview" : " full"}`}>
      <header>
        <strong>{title}</strong>
        <BracketStatsSortButtons label="Sort songs" options={BRACKET_SONG_SORTS} value={sort} onChange={onSortChange} />
      </header>
      {sortedRows.length === 0 ? (
        <div className="hololive-bracket-stats-empty">No archived songs yet.</div>
      ) : (
        <div className="hololive-bracket-performance-scroll">
          <div className="hololive-bracket-performance-table songs">
            <div className="hololive-bracket-performance-row head">
              <span>#</span>
              <span>Song</span>
              <span>Rating</span>
              <span>Record</span>
              <span>Win %</span>
              <span>Apps</span>
              <span>Titles</span>
              <span>Upsets</span>
              <span>High-Stakes</span>
            </div>
            {sortedRows.map((row, index) => {
              const rating = ratingRows.get(row.youtubeVideoId);
              return (
                <article
                  className={`hololive-bracket-performance-row clickable${bracketStatRankClass(index)}`}
                  key={row.youtubeVideoId}
                  role="button"
                  tabIndex={0}
                  onClick={() => onSongSelect(row)}
                  onKeyDown={(event) => handleStatsRowKeyDown(event, () => onSongSelect(row))}
                >
                  <span className="rank">{index + 1}</span>
                  <div className="main">
                    <strong title={row.title}>{displaySongTitle(row.title)}</strong>
                    <small>
                      {row.idolName ?? "Unknown"} / {topicLabel({ topicId: row.topicId ?? "Original_Song" })}
                    </small>
                  </div>
                  <span title={rating ? `Raw ${formatBracketRating(rating.rating)}, RD ${formatBracketRating(rating.ratingDeviation)}` : undefined}>
                    {rating ? formatBracketRating(rating.conservativeRating) : "-"}
                  </span>
                  <span>{formatBracketRecord(row)}</span>
                  <span>{formatBracketPercent(row.winRate)}</span>
                  <span>{formatBracketNumber(row.appearances)}</span>
                  <span>{formatBracketNumber(row.championCount)}</span>
                  <span>{row.upsetWins > 0 ? formatBracketNumber(row.upsetWins) : "-"}</span>
                  <span>{row.bigGameScore > 0 ? formatBracketViewScore(row.bigGameScore) : "-"}</span>
                </article>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

function BracketTalentPerformanceTable({
  rows,
  ratingRows,
  sort,
  onSortChange,
  onTalentSelect
}: {
  rows: HololiveBracketTalentStats[];
  ratingRows: Map<string, HololiveBracketRatingStatsRow>;
  sort: BracketTalentSort;
  onSortChange: (sort: BracketTalentSort) => void;
  onTalentSelect: (row: HololiveBracketTalentStats) => void;
}) {
  const sortedRows = sortBracketTalents(rows, sort, ratingRows);

  return (
    <section className="hololive-bracket-stats-panel performance talents full">
      <header>
        <strong>Talent Performance</strong>
        <BracketStatsSortButtons label="Sort talents" options={BRACKET_TALENT_SORTS} value={sort} onChange={onSortChange} />
      </header>
      {sortedRows.length === 0 ? (
        <div className="hololive-bracket-stats-empty">No archived talents yet.</div>
      ) : (
        <div className="hololive-bracket-performance-scroll">
          <div className="hololive-bracket-performance-table talents">
            <div className="hololive-bracket-performance-row head">
              <span>#</span>
              <span>Talent</span>
              <span>Rating</span>
              <span>Record</span>
              <span>Win %</span>
              <span>Matches</span>
              <span title="Confidence-adjusted typical view level of songs this talent's songs have defeated, soft-capped and shrunk so one extreme outlier does not dominate.">
                Opp Level
              </span>
              <span>Top 4</span>
              <span>Titles</span>
            </div>
            {sortedRows.map((row, index) => {
              const rating = ratingRows.get(row.idolId);
              const matches = row.wins + row.losses;
              return (
                <article
                  className={`hololive-bracket-performance-row clickable${bracketStatRankClass(index)}`}
                  key={row.idolId}
                  role="button"
                  tabIndex={0}
                  onClick={() => onTalentSelect(row)}
                  onKeyDown={(event) => handleStatsRowKeyDown(event, () => onTalentSelect(row))}
                >
                  <span className="rank">{index + 1}</span>
                  <div className="main">
                    <strong title={row.idolName}>{row.idolName}</strong>
                    <small>{formatBracketNumber(row.appearances)} entries</small>
                  </div>
                  <span title={rating ? `Raw ${formatBracketRating(rating.rating)}, RD ${formatBracketRating(rating.ratingDeviation)}` : undefined}>
                    {rating ? formatBracketRating(rating.conservativeRating) : "-"}
                  </span>
                  <span>{formatBracketRecord(row)}</span>
                  <span>{formatBracketPercent(row.winRate)}</span>
                  <span>{formatBracketNumber(matches)}</span>
                  <span title={`${formatBracketNumber(row.strengthOfWinsCount)} qualifying wins`}>
                    {row.strengthOfWinsScore > 0 ? formatBracketViewScore(row.strengthOfWinsScore) : "-"}
                  </span>
                  <span>{formatBracketNumber(row.top4Count)}</span>
                  <span>{formatBracketNumber(row.championCount)}</span>
                </article>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

type BracketRecordItem = {
  key: string;
  title: string;
  detail: string;
  value: string;
  titleText?: string;
};

type BracketOverviewAward = {
  key: string;
  title: string;
  winnerId: string | null;
  winnerName: string;
  value: string;
  imageUrls: string[];
  tooltip: string;
  theme: HololiveTalentTheme;
  visualKind: "talent" | "song";
  leaderboard: BracketOverviewAwardLeaderboardItem[];
};

type BracketOverviewAwardLeaderboardItem = {
  id: string;
  name: string;
  value: string;
  detail: string;
};

const HOLOLIVE_AWARD_CARD_IMAGE_VERSION = 2;
const BRACKET_OVERVIEW_AWARD_LEADERBOARD_LIMIT = 10;
const MINIMUM_USABLE_YOUTUBE_THUMBNAIL_WIDTH = 320;
const MINIMUM_USABLE_YOUTUBE_THUMBNAIL_HEIGHT = 180;

function resolveHololiveAwardCardImageUrl(slug: string | null | undefined): string | null {
  const safeSlug = slug?.trim();
  if (!safeSlug || !/^[a-z0-9-]+$/i.test(safeSlug)) {
    return null;
  }

  return `app://holoshelf-data/hololive-images/${encodeURIComponent(
    `${safeSlug}-card-v${HOLOLIVE_AWARD_CARD_IMAGE_VERSION}.png`
  )}?v=award-card-v${HOLOLIVE_AWARD_CARD_IMAGE_VERSION}`;
}

function BracketRecordPanel({
  title,
  items,
  emptyText = "No records yet.",
  headerTitle
}: {
  title: string;
  items: BracketRecordItem[];
  emptyText?: string;
  headerTitle?: string;
}) {
  return (
    <section className="hololive-bracket-stats-panel record">
      <header title={headerTitle}>
        <strong>{title}</strong>
      </header>
      {items.length === 0 ? (
        <div className="hololive-bracket-stats-empty">{emptyText}</div>
      ) : (
        <div className="hololive-bracket-record-list">
          {items.map((item, index) => (
            <article className={`hololive-bracket-record-row${bracketStatRankClass(index)}`} key={item.key}>
              <span className="rank">{index + 1}</span>
              <div className="main">
                <strong title={item.titleText ?? item.title}>{item.title}</strong>
                <small title={item.detail}>{item.detail}</small>
              </div>
              <span>{item.value}</span>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function buildTalentImageLookup(talents: HololiveIdol[]): Map<string, HololiveIdol> {
  const lookup = new Map<string, HololiveIdol>();
  for (const talent of talents) {
    lookup.set(talent.id, talent);
    const canonical = getHololiveCanonicalTalentIdentity(talent.id, talent.displayName);
    if (!lookup.has(canonical.id)) {
      lookup.set(canonical.id, talent);
    }
  }
  return lookup;
}

function resolveTalentImage(talentsById: Map<string, HololiveIdol>, talentId: string | null, talentName: string): HololiveIdol | null {
  if (talentId) {
    const direct = talentsById.get(talentId);
    if (direct) {
      return direct;
    }
    const canonical = getHololiveCanonicalTalentIdentity(talentId, talentName);
    const canonicalTalent = talentsById.get(canonical.id);
    if (canonicalTalent) {
      return canonicalTalent;
    }
  }
  const normalizedName = talentName.trim().toLowerCase();
  if (!normalizedName) {
    return null;
  }
  return [...talentsById.values()].find((talent) => talent.displayName.toLowerCase() === normalizedName) ?? null;
}

function talentImageUrls(talent: HololiveIdol | null): Pick<BracketOverviewAward, "imageUrls"> {
  if (!talent) {
    return { imageUrls: [] };
  }
  const imageUrls = [
    resolveHololiveAwardCardImageUrl(talent.slug),
    talent.cachedCardImageUrl,
    talent.cardImageUrl,
    talent.cachedProfileImageUrl,
    talent.profileImageUrl,
    talent.cachedIconUrl,
    talent.iconUrl
  ].filter((source): source is string => Boolean(source?.trim()));

  return {
    imageUrls: [...new Set(imageUrls)]
  };
}

function talentAwardTheme(
  talent: HololiveIdol | null,
  fallbackId: string | null | undefined,
  fallbackName: string | null | undefined
): HololiveTalentTheme {
  return resolveHololiveTalentTheme(talent?.id ?? fallbackId ?? null, talent?.displayName ?? fallbackName ?? null);
}

function createTalentAward(
  key: string,
  title: string,
  tooltip: string,
  rows: HololiveBracketTalentStats[],
  talentsById: Map<string, HololiveIdol>,
  getValue: (row: HololiveBracketTalentStats) => string,
  getDetail: (row: HololiveBracketTalentStats) => string
): BracketOverviewAward {
  const row = rows[0];
  const winnerName = row?.idolName ?? "No winner yet";
  const talent = row ? resolveTalentImage(talentsById, row.idolId, row.idolName) : null;
  return {
    key,
    title,
    winnerId: row?.idolId ?? null,
    winnerName,
    value: row ? getValue(row) : "-",
    ...talentImageUrls(talent),
    tooltip,
    theme: talentAwardTheme(talent, row?.idolId ?? null, row?.idolName ?? null),
    visualKind: "talent",
    leaderboard: rows.slice(0, BRACKET_OVERVIEW_AWARD_LEADERBOARD_LIMIT).map((leader) => ({
      id: leader.idolId,
      name: leader.idolName,
      value: getValue(leader),
      detail: getDetail(leader)
    }))
  };
}

function createRatingAward(
  key: string,
  title: string,
  tooltip: string,
  rows: HololiveBracketRatingStatsRow[],
  talentsById: Map<string, HololiveIdol>,
  getValue: (row: HololiveBracketRatingStatsRow) => string,
  getDetail: (row: HololiveBracketRatingStatsRow) => string
): BracketOverviewAward {
  const row = rows[0];
  const winnerName = row?.label ?? "No winner yet";
  const talent = row ? resolveTalentImage(talentsById, row.id, row.label) : null;
  return {
    key,
    title,
    winnerId: row?.id ?? null,
    winnerName,
    value: row ? getValue(row) : "-",
    ...talentImageUrls(talent),
    tooltip,
    theme: talentAwardTheme(talent, row?.id ?? null, row?.label ?? null),
    visualKind: "talent",
    leaderboard: rows.slice(0, BRACKET_OVERVIEW_AWARD_LEADERBOARD_LIMIT).map((leader) => ({
      id: leader.id,
      name: leader.label,
      value: getValue(leader),
      detail: getDetail(leader)
    }))
  };
}

function songAwardImageUrls(youtubeVideoId: string | null | undefined): string[] {
  const videoId = youtubeVideoId?.trim();
  if (!videoId) {
    return [];
  }
  return [
    `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/maxresdefault.jpg`,
    `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/maxres1.jpg`,
    `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/sddefault.jpg`,
    youtubeThumbnailUrl(videoId),
    `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/mqdefault.jpg`
  ];
}

function createSongAward(
  key: string,
  title: string,
  tooltip: string,
  rows: HololiveBracketSongStats[],
  talentsById: Map<string, HololiveIdol>,
  getValue: (row: HololiveBracketSongStats) => string,
  getDetail: (row: HololiveBracketSongStats) => string
): BracketOverviewAward {
  const row = rows[0];
  const winnerName = row ? displaySongTitle(row.title) : "No winner yet";
  const talent = row ? resolveTalentImage(talentsById, row.idolId ?? null, row.idolName ?? "") : null;
  return {
    key,
    title,
    winnerId: row?.canonicalPerformanceKey ?? null,
    winnerName,
    value: row ? getValue(row) : "-",
    imageUrls: songAwardImageUrls(row?.youtubeVideoId),
    tooltip,
    theme: talentAwardTheme(talent, row?.idolId ?? null, row?.idolName ?? null),
    visualKind: "song",
    leaderboard: rows.slice(0, BRACKET_OVERVIEW_AWARD_LEADERBOARD_LIMIT).map((leader) => ({
      id: leader.canonicalPerformanceKey,
      name: displaySongTitle(leader.title),
      value: getValue(leader),
      detail: getDetail(leader)
    }))
  };
}

function createSongRatingAward(
  rows: HololiveBracketRatingStatsRow[],
  songStats: HololiveBracketSongStats[],
  talentsById: Map<string, HololiveIdol>
): BracketOverviewAward {
  const songByKey = new Map(songStats.map((song) => [song.canonicalPerformanceKey, song]));
  const row = rows[0];
  const winnerSong = row ? songByKey.get(row.id) ?? null : null;
  const winnerName = winnerSong ? displaySongTitle(winnerSong.title) : row?.label ?? "No winner yet";
  const talent = winnerSong
    ? resolveTalentImage(talentsById, winnerSong.idolId ?? null, winnerSong.idolName ?? "")
    : null;
  return {
    key: "top-song",
    title: "Top Song",
    winnerId: row?.id ?? null,
    winnerName,
    value: row ? formatBracketRating(row.conservativeRating) : "-",
    imageUrls: songAwardImageUrls(winnerSong?.youtubeVideoId),
    tooltip: "Highest conservative Glicko-2 rating.",
    theme: talentAwardTheme(talent, winnerSong?.idolId ?? null, winnerSong?.idolName ?? null),
    visualKind: "song",
    leaderboard: rows.slice(0, BRACKET_OVERVIEW_AWARD_LEADERBOARD_LIMIT).map((leader) => {
      const song = songByKey.get(leader.id);
      return {
        id: leader.id,
        name: song ? displaySongTitle(song.title) : leader.label,
        value: formatBracketRating(leader.conservativeRating),
        detail: `${song?.idolName ?? leader.detail ?? "Unknown"} / ${formatBracketRecord(leader)} / ${formatBracketNumber(leader.matches)} matches`
      };
    })
  };
}

function bracketOverviewInitials(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0 || name === "No winner yet") {
    return "-";
  }
  return words
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
}

function bracketOverviewRankBadge(index: number): string {
  if (index === 0) {
    return "🥇";
  }
  if (index === 1) {
    return "🥈";
  }
  if (index === 2) {
    return "🥉";
  }
  return String(index + 1);
}

function BracketOverviewAwardCard({ award }: { award: BracketOverviewAward }) {
  const imageSignature = award.imageUrls.join("\n");
  const [imageIndex, setImageIndex] = useState(0);
  const wasFocusedBeforePointerDownRef = useRef(false);
  const src = award.imageUrls[imageIndex] ?? "";
  const awardStyle = {
    "--award-bg-a": award.theme.primary,
    "--award-bg-b": award.theme.secondary,
    "--award-accent": award.theme.secondary,
    "--award-accent-deep": award.theme.primary
  } as CSSProperties;

  useEffect(() => {
    setImageIndex(0);
  }, [imageSignature]);

  return (
    <article
      className={`hololive-bracket-award-card ${award.visualKind}${award.winnerId ? "" : " empty"}`}
      style={awardStyle}
    >
      <h3 title={award.tooltip}>
        <span className="hololive-bracket-award-accent" aria-hidden="true" />
        {award.title}
      </h3>
      <div
        className="hololive-bracket-award-body"
        tabIndex={award.leaderboard.length > 0 ? 0 : undefined}
        onPointerDown={(event) => {
          wasFocusedBeforePointerDownRef.current = document.activeElement === event.currentTarget;
        }}
        onClick={(event) => {
          if (award.leaderboard.length === 0) {
            return;
          }
          if (wasFocusedBeforePointerDownRef.current) {
            event.currentTarget.blur();
            wasFocusedBeforePointerDownRef.current = false;
          } else {
            event.currentTarget.focus();
          }
        }}
        onKeyDown={(event) => {
          if (award.leaderboard.length === 0 || (event.key !== "Enter" && event.key !== " ")) {
            return;
          }
          event.preventDefault();
          event.currentTarget.blur();
        }}
      >
        <div className="hololive-bracket-award-image">
          {src ? (
            <img
              key={src}
              src={src}
              alt=""
              loading="eager"
              decoding="sync"
              draggable={false}
              onError={() => setImageIndex((current) => current + 1)}
              onLoad={(event) => {
                if (
                  award.visualKind === "song" &&
                  (event.currentTarget.naturalWidth < MINIMUM_USABLE_YOUTUBE_THUMBNAIL_WIDTH ||
                    event.currentTarget.naturalHeight < MINIMUM_USABLE_YOUTUBE_THUMBNAIL_HEIGHT)
                ) {
                  setImageIndex((current) => current + 1);
                }
              }}
            />
          ) : (
            <span>{bracketOverviewInitials(award.winnerName)}</span>
          )}
        </div>
        <div className="hololive-bracket-award-value" title={`${award.title}: ${award.value}`}>
          {award.value}
        </div>
        <div className="hololive-bracket-award-nameplate">
          <strong title={award.winnerName}>{award.winnerName}</strong>
        </div>
        {award.leaderboard.length > 0 ? (
          <div className="hololive-bracket-award-reveal" aria-label={`${award.title} top 10`}>
            {award.leaderboard.map((item, index) => (
              <div className={`hololive-bracket-award-rank${bracketStatRankClass(index)}`} key={item.id} title={item.detail}>
                <span aria-label={`Rank ${index + 1}`}>{bracketOverviewRankBadge(index)}</span>
                <strong>{item.name}</strong>
                <em>{item.value}</em>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </article>
  );
}

function songRecordItems(
  rows: HololiveBracketSongStats[],
  getValue: (row: HololiveBracketSongStats) => string,
  limit = 10,
  getDetail?: (row: HololiveBracketSongStats) => string
): BracketRecordItem[] {
  return rows.slice(0, limit).map((row) => ({
    key: row.youtubeVideoId,
    title: displaySongTitle(row.title),
    titleText: row.title,
    detail: getDetail?.(row) ?? `${row.idolName ?? "Unknown"} / ${topicLabel({ topicId: row.topicId ?? "Original_Song" })}`,
    value: getValue(row)
  }));
}

function talentRecordItems(
  rows: HololiveBracketTalentStats[],
  getValue: (row: HololiveBracketTalentStats) => string,
  limit = 10,
  getDetail?: (row: HololiveBracketTalentStats) => string
): BracketRecordItem[] {
  return rows.slice(0, limit).map((row) => ({
    key: row.idolId,
    title: row.idolName,
    detail: getDetail?.(row) ?? `${formatBracketNumber(row.appearances)} entries`,
    value: getValue(row)
  }));
}

function talentRecordDetail(row: HololiveBracketTalentStats): string {
  return `${formatBracketRecord(row)} / ${formatBracketNumber(row.appearances)} entries`;
}

function songUnderdogDetail(row: HololiveBracketSongStats): string {
  return `${formatBracketNumber(row.punchingAboveWins)} upset wins / ${formatBracketNumber(row.punchingAboveOpportunities)} underdog matches`;
}

function songRecordDetail(row: HololiveBracketSongStats): string {
  return `${row.idolName ?? "Unknown"} / ${formatBracketRecord(row)} / ${formatBracketNumber(row.appearances)} brackets`;
}

function songFinalsDetail(row: HololiveBracketSongStats): string {
  return `${row.idolName ?? "Unknown"} / ${formatBracketNumber(row.finalistCount)} finals / ${formatBracketNumber(row.championCount)} titles`;
}

function songStrengthOfWinsDetail(row: HololiveBracketSongStats): string {
  return `${row.idolName ?? "Unknown"} / ${formatBracketNumber(row.strengthOfWinsCount)} qualifying wins`;
}

function songStrengthOfLossesDetail(row: HololiveBracketSongStats): string {
  return `${row.idolName ?? "Unknown"} / ${formatBracketNumber(row.strengthOfLossesCount)} qualifying losses`;
}

function songClutchDetail(row: HololiveBracketSongStats): string {
  return `${row.idolName ?? "Unknown"} / ${formatBracketRecord({ wins: row.clutchWins, losses: row.clutchLosses })} / ${formatBracketNumber(row.clutchMatches)} late-round matches`;
}

function songPressureDetail(row: HololiveBracketSongStats): string {
  return `${row.idolName ?? "Unknown"} / ${formatBracketNumber(row.pressureEdgePositiveMatches)} over / ${formatBracketNumber(row.pressureEdgeNegativeMatches)} under / ${formatBracketNumber(row.pressureEdgeMatches)} late-round matches`;
}

function songOverperformerDetail(row: HololiveBracketSongStats): string {
  return `${row.idolName ?? "Unknown"} / ${formatBracketNumber(row.punchingAboveWins)} upset wins / ${formatBracketNumber(row.punchingAboveOpportunities)} underdog matches`;
}

function songReliabilityDetail(row: HololiveBracketSongStats): string {
  const favoriteWins = Math.max(0, row.upsetResilienceChecks - row.upsetResilienceUpsetLosses);
  return `${row.idolName ?? "Unknown"} / ${formatBracketNumber(favoriteWins)} wins / ${formatBracketNumber(row.upsetResilienceChecks)} favored matches`;
}

function songHighStakesPerformanceDetail(row: HololiveBracketSongStats): string {
  return `${formatBracketNumber(row.highStakesPerformanceWins)} wins / ${formatBracketNumber(row.highStakesPerformanceMatches)} high-stakes matches`;
}

function talentFinalsDetail(row: HololiveBracketTalentStats): string {
  return `${formatBracketNumber(row.finalistCount)} finals / ${formatBracketNumber(row.championCount)} titles`;
}

function talentFinalsConversionDetail(row: HololiveBracketTalentStats): string {
  return `${formatBracketNumber(row.championCount)} titles / ${formatBracketNumber(row.finalistCount)} finals`;
}

function talentDeepRunRateDetail(row: HololiveBracketTalentStats): string {
  return `${formatBracketNumber(row.top4Count)} top 4 / ${formatBracketNumber(row.appearances)} entries`;
}

function talentEarlyExitDetail(row: HololiveBracketTalentStats): string {
  return `${formatBracketNumber(row.earlyExitCount)} first-round exits / ${formatBracketNumber(row.losses)} losses`;
}

function talentEarlyExitRateDetail(row: HololiveBracketTalentStats): string {
  return `${formatBracketNumber(row.earlyExitCount)} first-round exits / ${formatBracketNumber(row.appearances)} entries`;
}

function talentStrengthOfWinsDetail(row: HololiveBracketTalentStats): string {
  return `${formatBracketNumber(row.strengthOfWinsCount)} qualifying wins`;
}

function talentStrengthOfLossesDetail(row: HololiveBracketTalentStats): string {
  return `${formatBracketNumber(row.strengthOfLossesCount)} qualifying losses`;
}

function talentPunchingAboveDetail(row: HololiveBracketTalentStats): string {
  return `${formatPunchingAboveRecord(row)} / ${formatBracketNumber(row.punchingAboveOpportunities)} underdog matches`;
}

function talentClutchRateDetail(row: HololiveBracketTalentStats): string {
  return `${formatBracketRecord({ wins: row.clutchWins, losses: row.clutchLosses })} / ${formatBracketNumber(row.clutchMatches)} late-round matches`;
}

function talentPressureEdgeDetail(row: HololiveBracketTalentStats): string {
  return `${formatBracketNumber(row.pressureEdgePositiveMatches)} over / ${formatBracketNumber(row.pressureEdgeNegativeMatches)} under / ${formatBracketNumber(row.pressureEdgeMatches)} late-round matches`;
}

function talentUpsetResilienceDetail(row: HololiveBracketTalentStats): string {
  return `${formatUpsetResilienceRecord(row)} / ${formatBracketNumber(row.upsetResilienceChecks)} favored matches`;
}

function formatPunchingAboveRecord(row: HololiveBracketTalentStats): string {
  return formatBracketRecord({
    wins: row.punchingAboveWins,
    losses: Math.max(0, row.punchingAboveOpportunities - row.punchingAboveWins)
  });
}

function formatUpsetResilienceRecord(row: HololiveBracketTalentStats): string {
  return formatBracketRecord({
    wins: Math.max(0, row.upsetResilienceChecks - row.upsetResilienceUpsetLosses),
    losses: row.upsetResilienceUpsetLosses
  });
}

function BracketStatsOverviewView({
  stats,
  talents,
  subject
}: {
  stats: HololiveBracketStatsOverview;
  talents: HololiveIdol[];
  subject: "talent" | "song";
}) {
  const talentsById = useMemo(() => buildTalentImageLookup(talents), [talents]);
  const talentAwards = useMemo(
    () => [
      createRatingAward(
        "top-talent",
        "Top Talent",
        "Highest ELO rating.",
        stats.topTalentRatings,
        talentsById,
        (row) => formatBracketRating(row.conservativeRating),
        (row) => `${formatBracketRecord(row)} / ${formatBracketNumber(row.matches)} matches`
      ),
      createTalentAward(
        "most-wins",
        "Most Wins",
        "Most matchup wins.",
        stats.topTalentsByWins,
        talentsById,
        (row) => formatBracketNumber(row.wins),
        talentRecordDetail
      ),
      createTalentAward(
        "most-titles",
        "Most Titles",
        "Most bracket wins.",
        stats.topTalentsByTitles,
        talentsById,
        (row) => formatBracketNumber(row.championCount),
        talentFinalsDetail
      ),
      createTalentAward(
        "most-second-places",
        "Most 2nd Places",
        "Most runner-up finishes.",
        stats.topTalentsByRunnerUps,
        talentsById,
        (row) => formatBracketNumber(row.runnerUpCount),
        talentFinalsDetail
      ),
      createTalentAward(
        "most-deep-runs",
        "Most Deep Runs",
        "Most bracket runs reaching at least the top 4.",
        stats.topTalentsByDeepRuns,
        talentsById,
        (row) => formatBracketNumber(row.top4Count),
        talentDeepRunRateDetail
      ),
      createTalentAward(
        "most-early-exits",
        "Most Early Exits",
        "Most exits in the first round.",
        stats.topTalentsByEarlyExits,
        talentsById,
        (row) => formatBracketNumber(row.earlyExitCount),
        talentEarlyExitDetail
      ),
      createTalentAward(
        "strength-of-wins",
        "Strength of Wins",
        "Typical view level of defeated songs, dynamically compressed and confidence-adjusted for sample size.",
        stats.topTalentsByStrengthOfWins,
        talentsById,
        (row) => formatBracketViewScore(row.strengthOfWinsScore),
        talentStrengthOfWinsDetail
      ),
      createTalentAward(
        "strength-of-losses",
        "Strength of Losses",
        "Typical view level of victorious opponents, dynamically compressed and confidence-adjusted for sample size.",
        stats.topTalentsByStrengthOfLosses,
        talentsById,
        (row) => formatBracketViewScore(row.strengthOfLossesScore),
        talentStrengthOfLossesDetail
      ),
      createTalentAward(
        "most-clutch",
        "Most Clutch",
        "Win-loss performance from Quarter Finals onward, with deeper rounds carrying more magnitude and match count controlling confidence.",
        stats.topTalentsByClutchRate,
        talentsById,
        (row) => formatBracketRawScore(row.clutchRate),
        talentClutchRateDetail
      ),
      createTalentAward(
        "under-pressure",
        "Under Pressure",
        "Results above or below Glicko expectations from Quarter Finals onward, with deeper rounds carrying more magnitude and match count controlling confidence.",
        stats.topTalentsByPressureEdge,
        talentsById,
        (row) => formatBracketSignedRawScore(row.pressureEdgeScore),
        talentPressureEdgeDetail
      ),
      createTalentAward(
        "overperformer",
        "Overperformer",
        "Performance above view-based expectations in underdog matches, confidence-adjusted for sample size.",
        stats.topTalentsByPunchingAbove,
        talentsById,
        (row) => formatBracketRawScore(row.punchingAboveScore),
        talentPunchingAboveDetail
      ),
      createTalentAward(
        "most-reliable",
        "Most Reliable",
        "Performance above view-based expectations as the favorite, confidence-adjusted for sample size.",
        stats.topTalentsByUpsetResilience,
        talentsById,
        (row) => formatBracketRawScore(row.upsetResilienceScore),
        talentUpsetResilienceDetail
      )
    ],
    [stats, talentsById]
  );
  const songAwards = useMemo(
    () => [
      createSongRatingAward(stats.topSongRatings, stats.songStats, talentsById),
      createSongAward(
        "song-most-wins",
        "Most Wins",
        "Most matchup wins.",
        stats.topSongsByWins,
        talentsById,
        (row) => formatBracketNumber(row.wins),
        songRecordDetail
      ),
      createSongAward(
        "song-most-titles",
        "Most Titles",
        "Most bracket wins.",
        stats.topSongsByTitles,
        talentsById,
        (row) => formatBracketNumber(row.championCount),
        songFinalsDetail
      ),
      createSongAward(
        "song-most-second-places",
        "Most 2nd Places",
        "Most runner-up finishes.",
        stats.topSongsByRunnerUps,
        talentsById,
        (row) => formatBracketNumber(row.runnerUpCount),
        songFinalsDetail
      ),
      createSongAward(
        "song-most-deep-runs",
        "Most Deep Runs",
        "Most bracket runs reaching at least the top 4.",
        stats.topSongsByDeepRuns,
        talentsById,
        (row) => formatBracketNumber(row.top4Count),
        songRecordDetail
      ),
      createSongAward(
        "song-most-early-exits",
        "Most Early Exits",
        "Most exits in the first round.",
        stats.topSongsByEarlyExits,
        talentsById,
        (row) => formatBracketNumber(row.firstRoundEliminations),
        songRecordDetail
      ),
      createSongAward(
        "song-strength-of-wins",
        "Strength of Wins",
        "Typical current view level of defeated songs, dynamically compressed and confidence-adjusted for sample size.",
        stats.topSongsByStrengthOfWins,
        talentsById,
        (row) => formatBracketViewScore(row.strengthOfWinsScore),
        songStrengthOfWinsDetail
      ),
      createSongAward(
        "song-strength-of-losses",
        "Strength of Losses",
        "Typical current view level of victorious opponents, dynamically compressed and confidence-adjusted for sample size.",
        stats.topSongsByStrengthOfLosses,
        talentsById,
        (row) => formatBracketViewScore(row.strengthOfLossesScore),
        songStrengthOfLossesDetail
      ),
      createSongAward(
        "song-most-clutch",
        "Most Clutch",
        "Win-loss performance from Quarter Finals onward, with deeper rounds carrying more magnitude and match count controlling confidence.",
        stats.topSongsByClutchRate,
        talentsById,
        (row) => formatBracketRawScore(row.clutchRate),
        songClutchDetail
      ),
      createSongAward(
        "song-under-pressure",
        "Under Pressure",
        "Results above or below pre-period Glicko expectations from Quarter Finals onward.",
        stats.topSongsByPressureEdge,
        talentsById,
        (row) => formatBracketSignedRawScore(row.pressureEdgeScore),
        songPressureDetail
      ),
      createSongAward(
        "song-overperformer",
        "Overperformer",
        "Performance above current view-based expectations across every underdog opportunity.",
        stats.topSongsByPunchingAbove,
        talentsById,
        (row) => formatBracketRawScore(row.punchingAboveScore),
        songOverperformerDetail
      ),
      createSongAward(
        "song-most-reliable",
        "Most Reliable",
        "Performance above current view-based expectations across every favored opportunity.",
        stats.topSongsByUpsetResilience,
        talentsById,
        (row) => formatBracketRawScore(row.upsetResilienceScore),
        songReliabilityDetail
      )
    ],
    [stats, talentsById]
  );
  const awards = subject === "song" ? songAwards : talentAwards;

  return (
    <div className={`hololive-bracket-stats-overview ${subject}`}>
      <div className={`hololive-bracket-award-grid ${subject}`} aria-label={`${subject === "song" ? "Song" : "Talent"} stats overview winners`}>
        {awards.map((award) => (
          <BracketOverviewAwardCard award={award} key={award.key} />
        ))}
      </div>
    </div>
  );
}

function BracketRivalryTable({
  title = "Repeated Matchups",
  rows,
  emptyText = "No repeat rivalries yet."
}: {
  title?: string;
  rows: HololiveBracketRivalryStats[];
  emptyText?: string;
}) {
  return (
    <section className="hololive-bracket-stats-panel matchups">
      <header title="Talent pairings with repeat archived head-to-head results.">
        <strong>{title}</strong>
      </header>
      {rows.length === 0 ? (
        <div className="hololive-bracket-stats-empty">{emptyText}</div>
      ) : (
        <div className="hololive-bracket-performance-scroll">
          <div className="hololive-bracket-rivalry-table">
            <div className="hololive-bracket-rivalry-row head">
              <span>#</span>
              <span>Matchup</span>
              <span>H2H</span>
            </div>
            {rows.map((row, index) => (
              <article className={`hololive-bracket-rivalry-row${bracketStatRankClass(index)}`} key={row.key}>
                <span className="rank">{index + 1}</span>
                <div className="main">
                  <strong title={`${row.leftIdolName} vs ${row.rightIdolName}`}>
                    {row.leftIdolName} vs {row.rightIdolName}
                  </strong>
                  <small>{formatBracketNumber(row.matches)} matches</small>
                </div>
                <span>{row.leftWins}-{row.rightWins}</span>
              </article>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function BracketStatsDetailPanel({
  detail,
  songRows,
  talentRows,
  rivalryRows,
  songRatingRows,
  talentRatingRows,
  songStatsById,
  talentStatsById,
  onClose,
  onSongSelect,
  onTalentSelect
}: {
  detail: BracketStatsDetail;
  songRows: HololiveBracketSongStats[];
  talentRows: HololiveBracketTalentStats[];
  rivalryRows: HololiveBracketRivalryStats[];
  songRatingRows: Map<string, HololiveBracketRatingStatsRow>;
  talentRatingRows: Map<string, HololiveBracketRatingStatsRow>;
  songStatsById: Map<string, HololiveBracketSongStats>;
  talentStatsById: Map<string, HololiveBracketTalentStats>;
  onClose: () => void;
  onSongSelect: (row: HololiveBracketSongStats) => void;
  onTalentSelect: (row: HololiveBracketTalentStats) => void;
}) {
  const panelRef = useRef<HTMLElement | null>(null);
  useDismissableLayer({
    enabled: true,
    ref: panelRef,
    onDismiss: onClose
  });

  if (detail.kind === "song") {
    const row = detail.row;
    const rating = songRatingRows.get(row.youtubeVideoId);
    const talent = row.idolId ? talentStatsById.get(row.idolId) : undefined;
    const detailStats = [
      { label: "Rating", value: rating ? formatBracketRating(rating.conservativeRating) : "-" },
      { label: "Record", value: formatBracketRecord(row) },
      { label: "Win %", value: formatBracketPercent(row.winRate) },
      { label: "Apps", value: formatBracketNumber(row.appearances) },
      { label: "Titles", value: formatBracketNumber(row.championCount) },
      { label: "Top 4", value: formatBracketNumber(row.top4Count) },
      { label: "Upsets", value: formatBracketNumber(row.upsetWins) },
      {
        label: "Underdog",
        value:
          row.punchingAboveOpportunities > 0
            ? `${formatBracketNumber(row.punchingAboveWins)} of ${formatBracketNumber(row.punchingAboveOpportunities)}`
            : "-"
      },
      {
        label: "High-Stakes %",
        value: row.highStakesPerformanceMatches > 0 ? formatBracketPercent(row.highStakesPerformanceRate) : "-"
      },
      { label: "High-Stakes", value: row.bigGameScore > 0 ? formatBracketViewScore(row.bigGameScore) : "-" }
    ];

    return (
      <aside className="hololive-bracket-detail-panel" ref={panelRef} aria-label="Song stats detail">
        <header>
          <div>
            <span>Song Detail</span>
            <strong title={row.title}>{displaySongTitle(row.title)}</strong>
            <small>
              {row.idolName ?? "Unknown"} / {topicLabel({ topicId: row.topicId ?? "Original_Song" })}
            </small>
          </div>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </header>
        <div className="hololive-bracket-detail-metrics">
          {detailStats.map((item) => (
            <article key={item.label}>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </article>
          ))}
        </div>
        {rating ? (
          <p title={`Raw rating ${formatBracketRating(rating.rating)}, volatility ${rating.volatility.toFixed(4)}`}>
            Rating is conservative Glicko-2: {formatBracketRating(rating.rating)} raw minus &plusmn;{formatBracketRating(rating.ratingDeviation)} uncertainty twice.
          </p>
        ) : null}
        {talent ? (
          <section>
            <h3>Talent</h3>
            <button type="button" className="hololive-bracket-detail-row" onClick={() => onTalentSelect(talent)}>
              <strong>{talent.idolName}</strong>
              <span>
                {formatBracketRecord(talent)} / {formatBracketNumber(talent.championCount)} titles
              </span>
            </button>
          </section>
        ) : null}
      </aside>
    );
  }

  const row = detail.row;
  const rating = talentRatingRows.get(row.idolId);
  const bestSongs = sortBracketSongs(
    songRows.filter((song) => song.idolId === row.idolId),
    "wins",
    songRatingRows
  ).slice(0, 6);
  const rivalries = rivalryRows
    .filter((rivalry) => rivalry.leftIdolId === row.idolId || rivalry.rightIdolId === row.idolId)
    .slice(0, 6);
  const detailStats = [
    { label: "Rating", value: rating ? formatBracketRating(rating.conservativeRating) : "-" },
    { label: "Record", value: formatBracketRecord(row) },
    { label: "Win %", value: formatBracketPercent(row.winRate) },
    { label: "Entries", value: formatBracketNumber(row.appearances) },
    { label: "Titles", value: formatBracketNumber(row.championCount) },
    { label: "2nd Places", value: formatBracketNumber(row.runnerUpCount) },
    { label: "Finals", value: formatBracketNumber(row.finalistCount) },
    {
      label: "Final Conv",
      value: row.finalistCount > 0 ? formatBracketPercent(row.finalsConversionRate) : "-"
    },
    { label: "Top 4", value: formatBracketNumber(row.top4Count) },
    {
      label: "Deep Rate",
      value: row.appearances > 0 ? formatBracketPercent(row.deepRunRate) : "-"
    },
    {
      label: "Opp Level",
      value: row.strengthOfWinsScore > 0 ? formatBracketViewScore(row.strengthOfWinsScore) : "-"
    },
    {
      label: "Loss Level",
      value: row.strengthOfLossesScore > 0 ? formatBracketViewScore(row.strengthOfLossesScore) : "-"
    },
    {
      label: "Punch Above",
      value: row.punchingAboveOpportunities > 0 ? formatBracketRawScore(row.punchingAboveScore) : "-"
    },
    {
      label: "Underdog",
      value:
        row.punchingAboveOpportunities > 0
          ? `${formatBracketNumber(row.punchingAboveWins)} of ${formatBracketNumber(row.punchingAboveOpportunities)}`
          : "-"
    },
    {
      label: "Clutch",
      value: row.clutchMatches > 0 ? formatBracketRawScore(row.clutchRate) : "-"
    },
    {
      label: "Pressure Edge",
      value: row.pressureEdgeMatches > 0 ? formatBracketSignedRawScore(row.pressureEdgeScore) : "-"
    },
    {
      label: "Resilience",
      value: row.upsetResilienceChecks > 0 ? formatBracketRawScore(row.upsetResilienceScore) : "-"
    },
    { label: "Early Exits", value: formatBracketNumber(row.earlyExitCount) },
    {
      label: "Exit Rate",
      value: row.appearances > 0 ? formatBracketPercent(row.earlyExitRate) : "-"
    }
  ];

  return (
    <aside className="hololive-bracket-detail-panel" ref={panelRef} aria-label="Talent stats detail">
      <header>
        <div>
          <span>Talent Detail</span>
          <strong title={row.idolName}>{row.idolName}</strong>
          <small>
            {formatBracketRecord(row)} / {formatBracketPercent(row.winRate)} / {formatBracketNumber(row.appearances)} entries
          </small>
        </div>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </header>
      <div className="hololive-bracket-detail-metrics">
        {detailStats.map((item) => (
          <article key={item.label}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
          </article>
        ))}
      </div>
      {rating ? (
        <p title={`Raw rating ${formatBracketRating(rating.rating)}, volatility ${rating.volatility.toFixed(4)}`}>
          Rating is conservative Glicko-2: {formatBracketRating(rating.rating)} raw minus &plusmn;{formatBracketRating(rating.ratingDeviation)} uncertainty twice.
        </p>
      ) : null}
      <section>
        <h3>Best Songs</h3>
        {bestSongs.length === 0 ? (
          <div className="hololive-bracket-detail-empty">No song history yet.</div>
        ) : (
          bestSongs.map((song) => (
            <button type="button" className="hololive-bracket-detail-row" key={song.youtubeVideoId} onClick={() => onSongSelect(song)}>
              <strong title={song.title}>{displaySongTitle(song.title)}</strong>
              <span>
                {formatBracketRecord(song)} / {formatBracketNumber(song.championCount)} titles
              </span>
            </button>
          ))
        )}
      </section>
      <section>
        <h3>Rivalries</h3>
        {rivalries.length === 0 ? (
          <div className="hololive-bracket-detail-empty">No repeat rivalries yet.</div>
        ) : (
          rivalries.map((rivalry) => {
            const otherId = rivalry.leftIdolId === row.idolId ? rivalry.rightIdolId : rivalry.leftIdolId;
            const other = talentStatsById.get(otherId);
            return (
              <button
                type="button"
                className="hololive-bracket-detail-row"
                key={rivalry.key}
                onClick={() => {
                  if (other) {
                    onTalentSelect(other);
                  }
                }}
              >
                <strong title={`${rivalry.leftIdolName} vs ${rivalry.rightIdolName}`}>
                  {rivalry.leftIdolName} vs {rivalry.rightIdolName}
                </strong>
                <span>
                  {rivalry.leftWins}-{rivalry.rightWins} / {formatBracketNumber(rivalry.matches)} matches
                </span>
              </button>
            );
          })
        )}
      </section>
    </aside>
  );
}

type DetailedTalentSortKey =
  | "talent"
  | "rating"
  | "wins"
  | "titles"
  | "runnerUps"
  | "deepRuns"
  | "earlyExits"
  | "strengthWins"
  | "strengthLosses"
  | "clutch"
  | "pressure"
  | "overperformer"
  | "reliable";
type DetailedTalentSortDirection = "asc" | "desc";
type DetailedTalentRow = { stats: HololiveBracketTalentStats; rating: HololiveBracketRatingStatsRow };
type DetailedTalentColumn = {
  key: DetailedTalentSortKey;
  label: string;
  tooltip: string;
  value: (row: DetailedTalentRow) => string;
  sortValue: (row: DetailedTalentRow) => number | string;
  detail: (row: DetailedTalentRow) => string;
};

const DETAILED_TALENT_COLUMNS: DetailedTalentColumn[] = [
  {
    key: "talent",
    label: "Talent",
    tooltip: "Talent name.",
    value: (row) => row.stats.idolName,
    sortValue: (row) => row.stats.idolName,
    detail: (row) => `${formatBracketRecord(row.stats)} across ${formatBracketNumber(row.stats.appearances)} brackets`
  },
  {
    key: "rating",
    label: "Elo Rating",
    tooltip: "Conservative Glicko-2 rating: rating minus twice the uncertainty.",
    value: (row) => formatBracketRating(row.rating.conservativeRating),
    sortValue: (row) => row.rating.conservativeRating,
    detail: (row) => `Raw ${formatBracketRating(row.rating.rating)} / uncertainty +/-${formatBracketRating(row.rating.ratingDeviation)}`
  },
  {
    key: "wins",
    label: "Wins",
    tooltip: "Total matchup wins.",
    value: (row) => formatBracketNumber(row.stats.wins),
    sortValue: (row) => row.stats.wins,
    detail: (row) => formatBracketRecord(row.stats)
  },
  {
    key: "titles",
    label: "Titles",
    tooltip: "Total bracket championships.",
    value: (row) => formatBracketNumber(row.stats.championCount),
    sortValue: (row) => row.stats.championCount,
    detail: (row) => talentFinalsDetail(row.stats)
  },
  {
    key: "runnerUps",
    label: "2nd Places",
    tooltip: "Total runner-up finishes.",
    value: (row) => formatBracketNumber(row.stats.runnerUpCount),
    sortValue: (row) => row.stats.runnerUpCount,
    detail: (row) => talentFinalsDetail(row.stats)
  },
  {
    key: "deepRuns",
    label: "Deep Runs",
    tooltip: "Total bracket appearances reaching the Top 4.",
    value: (row) => formatBracketNumber(row.stats.top4Count),
    sortValue: (row) => row.stats.top4Count,
    detail: (row) => talentDeepRunRateDetail(row.stats)
  },
  {
    key: "earlyExits",
    label: "Early Exits",
    tooltip: "Total first-round eliminations.",
    value: (row) => formatBracketNumber(row.stats.earlyExitCount),
    sortValue: (row) => row.stats.earlyExitCount,
    detail: (row) => talentEarlyExitDetail(row.stats)
  },
  {
    key: "strengthWins",
    label: "Strength of Wins",
    tooltip: "Confidence-adjusted typical current view level of defeated songs.",
    value: (row) => formatBracketViewScore(row.stats.strengthOfWinsScore),
    sortValue: (row) => row.stats.strengthOfWinsScore,
    detail: (row) => talentStrengthOfWinsDetail(row.stats)
  },
  {
    key: "strengthLosses",
    label: "Strength of Losses",
    tooltip: "Confidence-adjusted typical current view level of songs lost to.",
    value: (row) => formatBracketViewScore(row.stats.strengthOfLossesScore),
    sortValue: (row) => row.stats.strengthOfLossesScore,
    detail: (row) => talentStrengthOfLossesDetail(row.stats)
  },
  {
    key: "clutch",
    label: "Most Clutch",
    tooltip: "Confidence-adjusted performance from Quarter Finals onward.",
    value: (row) => formatBracketRawScore(row.stats.clutchRate),
    sortValue: (row) => row.stats.clutchRate,
    detail: (row) => talentClutchRateDetail(row.stats)
  },
  {
    key: "pressure",
    label: "Under Pressure",
    tooltip: "Late-round results above or below pre-period Glicko expectations.",
    value: (row) => formatBracketSignedRawScore(row.stats.pressureEdgeScore),
    sortValue: (row) => row.stats.pressureEdgeScore,
    detail: (row) => talentPressureEdgeDetail(row.stats)
  },
  {
    key: "overperformer",
    label: "Overperformer",
    tooltip: "Confidence-adjusted performance across lower-view underdog opportunities.",
    value: (row) => formatBracketRawScore(row.stats.punchingAboveScore),
    sortValue: (row) => row.stats.punchingAboveScore,
    detail: (row) => talentPunchingAboveDetail(row.stats)
  },
  {
    key: "reliable",
    label: "Most Reliable",
    tooltip: "Confidence-adjusted performance across higher-view favorite opportunities.",
    value: (row) => formatBracketRawScore(row.stats.upsetResilienceScore),
    sortValue: (row) => row.stats.upsetResilienceScore,
    detail: (row) => talentUpsetResilienceDetail(row.stats)
  }
];

function BracketDetailedStatsView({ stats }: { stats: HololiveBracketStatsOverview }) {
  const [sortKey, setSortKey] = useState<DetailedTalentSortKey>("rating");
  const [sortDirection, setSortDirection] = useState<DetailedTalentSortDirection>("desc");
  const ratingByTalentId = useMemo(() => new Map(stats.topTalentRatings.map((rating) => [rating.id, rating])), [stats.topTalentRatings]);
  const rows = useMemo(() => {
    const column = DETAILED_TALENT_COLUMNS.find((candidate) => candidate.key === sortKey) ?? DETAILED_TALENT_COLUMNS[1];
    const direction = sortDirection === "desc" ? -1 : 1;
    return stats.talentStats
      .flatMap((talent) => {
        const rating = ratingByTalentId.get(talent.idolId);
        return rating ? [{ stats: talent, rating } satisfies DetailedTalentRow] : [];
      })
      .sort((left, right) => {
        const leftValue = column.sortValue(left);
        const rightValue = column.sortValue(right);
        const comparison =
          typeof leftValue === "string" && typeof rightValue === "string"
            ? leftValue.localeCompare(rightValue)
            : Number(leftValue) - Number(rightValue);
        return comparison * direction || left.stats.idolName.localeCompare(right.stats.idolName);
      });
  }, [ratingByTalentId, sortDirection, sortKey, stats.talentStats]);

  const changeSort = (key: DetailedTalentSortKey) => {
    if (key === sortKey) {
      setSortDirection((current) => (current === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDirection(key === "talent" ? "asc" : "desc");
    }
  };

  return (
    <section className="hololive-bracket-detailed-stats" aria-label="Detailed talent stats">
      <div className="hololive-bracket-detailed-table-scroll">
        <table className="hololive-bracket-detailed-table">
          <colgroup>
            <col className="detailed-col-rank" />
            {DETAILED_TALENT_COLUMNS.map((column) => (
              <col className={`detailed-col-${column.key}`} key={column.key} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th className="rank" scope="col">#</th>
              {DETAILED_TALENT_COLUMNS.map((column) => {
                const active = column.key === sortKey;
                return (
                  <th
                    className={`${column.key === "talent" ? "talent " : ""}column-${column.key}`}
                    scope="col"
                    key={column.key}
                    aria-sort={active ? (sortDirection === "desc" ? "descending" : "ascending") : "none"}
                  >
                    <button type="button" title={column.tooltip} onClick={() => changeSort(column.key)}>
                      <span>{column.label}</span>
                      {active ? (sortDirection === "desc" ? <ChevronDown size={13} /> : <ChevronUp size={13} />) : <ArrowUpDown size={12} />}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.stats.idolId}>
                <td className="rank">{index + 1}</td>
                {DETAILED_TALENT_COLUMNS.map((column) => (
                  <td
                    className={`${column.key === "talent" ? "talent " : ""}column-${column.key}`}
                    data-sort-value={column.sortValue(row)}
                    key={column.key}
                    title={column.detail(row)}
                  >
                    {column.value(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function BracketStatsView({
  stats,
  talents,
  loading
}: {
  stats: HololiveBracketStatsOverview | null;
  archives: HololiveBracketArchiveSummary[];
  talents: HololiveIdol[];
  loading: boolean;
  deletingArchiveId: string | null;
  onDeleteArchive: (archive: HololiveBracketArchiveSummary) => void;
}) {
  const statsViewRef = useRef<HTMLDivElement | null>(null);
  const [section, setSection] = useState<BracketStatsSection>("overview");
  const [subject, setSubject] = useState<"talent" | "song">("talent");

  useEffect(() => {
    statsViewRef.current?.scrollTo({ top: 0, left: 0 });
  }, [section]);

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
    <div className={`hololive-bracket-stats-view section-${section}`} ref={statsViewRef}>
      <div className="hololive-bracket-stats-topbar">
        <div className="hololive-bracket-stats-tabs" role="tablist" aria-label="Bracket stats views">
          {BRACKET_STATS_SECTIONS.map((item) => (
            <button
              type="button"
              role="tab"
              aria-selected={section === item.value}
              key={item.value}
              onClick={() => setSection(item.value)}
            >
              {item.label}
            </button>
          ))}
        </div>
        {section === "overview" ? (
          <div className="hololive-bracket-stats-scope-switcher" role="group" aria-label="Stats subject">
            <button type="button" aria-pressed={subject === "talent"} onClick={() => setSubject("talent")}>
              Talent View
            </button>
            <button type="button" aria-pressed={subject === "song"} onClick={() => setSubject("song")}>
              Song View
            </button>
          </div>
        ) : null}
      </div>
      {section === "overview" ? (
        <BracketStatsOverviewView stats={stats} talents={talents} subject={subject} />
      ) : (
        <BracketDetailedStatsView stats={stats} />
      )}
    </div>
  );
}

export function HololiveBracketPage() {
  const { showToast, showUndoToast } = useHololiveActionToast();
  const bracketCanvasRef = useRef<HTMLDivElement | null>(null);
  const playArenaRef = useRef<HTMLDivElement | null>(null);
  const matchRefs = useRef(new Map<string, HTMLElement>());
  const createMenuRef = useRef<HTMLDivElement | null>(null);
  const moreMenuRef = useRef<HTMLDivElement | null>(null);
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
  const [maxEntriesPerTalentEnabled, setMaxEntriesPerTalentEnabled] = useState(true);
  const [maxEntriesPerTalent, setMaxEntriesPerTalent] = useState("2");
  const [preferTopicSplitPerTalent, setPreferTopicSplitPerTalent] = useState(true);
  const [bracketTalents, setBracketTalents] = useState<HololiveIdol[]>([]);
  const [includedTalentIds, setIncludedTalentIds] = useState<string[] | null>(null);
  const [talentSelectorOpen, setTalentSelectorOpen] = useState(false);
  const [talentSelectorQuery, setTalentSelectorQuery] = useState("");
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
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

  useDismissableLayer({
    enabled: moreMenuOpen,
    ref: moreMenuRef,
    onDismiss: () => setMoreMenuOpen(false)
  });
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
  const selectableBracketTalents = useMemo(() => {
    const options = new Map<string, Pick<HololiveIdol, "id" | "displayName" | "source" | "sortOrder">>();
    for (const talent of bracketTalents
      .filter((candidate) => selectedTalentStatuses.includes(bracketTalentStatusFilter(candidate)))
      .slice()
      .sort(
        (left, right) =>
          (left.source === right.source ? 0 : left.source === "official" ? -1 : 1) ||
          left.sortOrder - right.sortOrder ||
          left.displayName.localeCompare(right.displayName)
      )) {
      const identity = getHololiveCanonicalTalentIdentity(talent.id, talent.displayName);
      if (!options.has(identity.id)) {
        options.set(identity.id, {
          id: identity.id,
          displayName: identity.name,
          source: talent.source,
          sortOrder: talent.sortOrder
        });
      }
    }
    return [...options.values()];
  }, [bracketTalents, selectedTalentStatuses]);
  const allBracketTalentIds = useMemo(() => selectableBracketTalents.map((talent) => talent.id), [selectableBracketTalents]);
  const selectedTalentIds = useMemo(() => {
    if (allBracketTalentIds.length === 0) {
      return [];
    }
    if (includedTalentIds === null) {
      return allBracketTalentIds;
    }
    const knownIds = new Set(allBracketTalentIds);
    const selectedIds = includedTalentIds.map((talentId) => getHololiveCanonicalTalentId(talentId)).filter((talentId) => knownIds.has(talentId));
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
      const [nextStats, nextArchives, nextTierData] = await Promise.all([
        api.invoke("hololive:brackets:stats", null),
        api.invoke("hololive:brackets:archives:list", null),
        api.invoke("hololive:tier-data", null)
      ]);
      setStatsOverview(nextStats);
      setArchiveSummaries(nextArchives);
      setBracketTalents(nextTierData.idols);
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
    const nextTalentIds = includedTalentIds
      .map((talentId) => getHololiveCanonicalTalentId(talentId))
      .filter((talentId, index, values) => knownIds.has(talentId) && values.indexOf(talentId) === index);
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

  async function duplicateBracket() {
    if (!activeBracket) {
      return;
    }
    setBusy(true);
    try {
      const bracket = await api.invoke("hololive:brackets:duplicate", { bracketId: activeBracket.id });
      setActiveBracket(bracket);
      setSummaries(await api.invoke("hololive:brackets:list", null));
      setMode("bracket");
      showToast({
        message: "Bracket duplicated",
        detail: bracket.name,
        tone: "success"
      });
    } catch (nextError) {
      showBracketError(nextError, "Could not duplicate bracket");
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
    setMaxEntriesPerTalentEnabled(true);
    setMaxEntriesPerTalent("2");
    setPreferTopicSplitPerTalent(true);
  }

  return (
    <section className="hololive-page hololive-bracket-page hololive-bracket-layout" aria-label="Hololive song brackets">
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
                                  title="Limit how many songs one talent can receive before the picker skips ahead to other talents. Blank or 0 removes the cap."
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
                                    Number.isFinite(parsed) && parsed > 0
                                      ? String(Math.min(parsed, HOLOLIVE_BRACKET_SIZE_COUNTS[selectedSize]))
                                      : ""
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
            <button
              type="button"
              disabled={busy || exportBusy || !activeBracket?.champion}
              onClick={() => void exportFinishedBracket()}
              title={activeBracket?.champion ? "Export finished bracket image" : "Complete a bracket to export"}
            >
              {exportBusy ? <Loader2 size={14} className="spin" /> : <Download size={14} />}
              Export
            </button>
            <div className="hololive-bracket-more-menu" ref={moreMenuRef}>
              <button
                type="button"
                aria-expanded={moreMenuOpen}
                aria-haspopup="menu"
                disabled={busy || !activeBracket}
                onClick={() => setMoreMenuOpen((current) => !current)}
              >
                More
                <ChevronDown size={13} />
              </button>
              {moreMenuOpen ? (
                <div className="hololive-bracket-more-popover" role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    disabled={busy || !activeBracket}
                    onClick={() => {
                      setMoreMenuOpen(false);
                      void duplicateBracket();
                    }}
                  >
                    <GitBranch size={13} />
                    Duplicate bracket
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    disabled={busy || !activeBracket || completedCount === 0}
                    onClick={() => {
                      setMoreMenuOpen(false);
                      void undo();
                    }}
                  >
                    <Undo2 size={13} />
                    Undo pick
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    disabled={busy || !activeBracket || completedCount === 0}
                    onClick={() => {
                      setMoreMenuOpen(false);
                      void reset();
                    }}
                  >
                    <RotateCcw size={13} />
                    Reset bracket
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="danger"
                    disabled={busy || !activeBracket}
                    onClick={() => {
                      setMoreMenuOpen(false);
                      void removeBracket();
                    }}
                  >
                    <Trash2 size={13} />
                    Delete bracket
                  </button>
                </div>
              ) : null}
            </div>
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
              talents={bracketTalents}
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
  );
}
