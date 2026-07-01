import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  ListMusic,
  PanelRightOpen,
  Pause,
  Play,
  Repeat,
  SkipForward,
  X
} from "lucide-react";
import type {
  HololiveMusicMarker,
  HololiveMusicPlaybackSource,
  HololiveMusicPlayerData,
  HololiveMusicRepeatMode,
  HololiveMusicResolvedItem,
  HololiveProfileMediaGroupId,
  HololiveProfilePlaybackContext
} from "../../shared/contracts";
import type { IpcChannelMap } from "../../shared/ipc";
import { api } from "../api";
import { MusicMarkerIcon, musicMarkerLabel } from "../components/HololiveMusicMarker";
import { HololiveMusicMarkerMenu } from "../components/HololiveMusicMarkerMenu";
import { hololiveResolvedItemTitle } from "../components/HololiveMusicText";
import { HololivePlaylistMenu } from "../components/HololivePlaylistMenu";
import { useHololiveActionToast } from "../components/HololiveActionToast";

declare global {
  interface Window {
    YT?: {
      Player: new (
        element: HTMLElement,
        options: {
          videoId?: string;
          playerVars?: Record<string, unknown>;
          events?: {
            onReady?: () => void;
            onStateChange?: (event: { data: number }) => void;
            onError?: (event: { data: number }) => void;
          };
        }
      ) => YouTubePlayerInstance;
      PlayerState: {
        ENDED: number;
        PLAYING: number;
        PAUSED: number;
      };
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

interface YouTubePlayerInstance {
  loadVideoById(videoId: string): void;
  playVideo(): void;
  pauseVideo(): void;
  destroy(): void;
}

interface AnchorRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface MiniPlayerPosition {
  x: number;
  y: number;
}

interface MiniPlayerBounds extends MiniPlayerPosition {
  width: number;
  height: number;
}

type MiniPlayerResizeHandle = "n" | "e" | "s" | "w" | "ne" | "nw" | "se" | "sw";
type AutoplayAdvanceMode = "active-source" | "profile-context";

export interface HololiveProfilePlaybackSource {
  idolId?: string | null;
  mediaGroupId?: HololiveProfileMediaGroupId | null;
}

type MiniPlayerInteraction =
  | {
      type: "move";
      pointerId: number;
      startX: number;
      startY: number;
      origin: MiniPlayerBounds;
      element: HTMLElement;
    }
  | {
      type: "resize";
      pointerId: number;
      startX: number;
      startY: number;
      origin: MiniPlayerBounds;
      element: HTMLElement;
      handle: MiniPlayerResizeHandle;
    };

interface HololivePlayerContextValue {
  data: HololiveMusicPlayerData | null;
  queue: HololiveMusicResolvedItem[];
  state: HololiveMusicPlayerData["state"] | null;
  activePlaylist: HololiveMusicPlayerData["playlists"][number] | null;
  activeItems: HololiveMusicResolvedItem[];
  currentItem: HololiveMusicResolvedItem | null;
  currentVideoId: string | null;
  currentIndex: number;
  playableCount: number;
  profileContext: HololiveProfilePlaybackContext | null;
  playing: boolean;
  loadPlayerData: () => Promise<HololiveMusicPlayerData>;
  applyPlayerData: (
    work: () => Promise<HololiveMusicPlayerData>,
    message?: string
  ) => Promise<HololiveMusicPlayerData | null>;
  updateState: (input: IpcChannelMap["hololive:player:state:update"]["request"]) => Promise<HololiveMusicPlayerData | null>;
  playQueueItem: (itemId: string) => Promise<void>;
  loadQueueItem: (itemId: string) => Promise<void>;
  playPlaylistItem: (playlistId: string, itemId?: string | null, shouldPlay?: boolean) => Promise<void>;
  playVideoNow: (youtubeVideoId: string, source?: HololiveProfilePlaybackSource) => Promise<HololiveMusicPlayerData | null>;
  queueVideo: (youtubeVideoId: string, placement: "now" | "next" | "end") => Promise<HololiveMusicPlayerData | null>;
  playVisibleVideos: (youtubeVideoIds: string[]) => Promise<HololiveMusicPlayerData | null>;
  playNext: (direction: 1 | -1) => Promise<void>;
  togglePlayPause: () => void;
}

const HololivePlayerContext = createContext<HololivePlayerContextValue | null>(null);

let youtubeApiPromise: Promise<void> | null = null;
const YOUTUBE_EMBED_REFERRER = "https://holoshelf.localhost/";
const MINI_PLAYER_BOUNDS_SETTING_KEY = "hololive.playerMiniBounds";
const MINI_PLAYER_DISMISSED_SETTING_KEY = "hololive.playerMiniDismissed";
const LEGACY_MINI_PLAYER_POSITION_SETTING_KEY = "hololive.playerMiniPosition";
const MINI_PLAYER_DEFAULT_WIDTH = 320;
const MINI_PLAYER_HEADER_HEIGHT = 30;
const MINI_PLAYER_VIDEO_ASPECT_RATIO = 16 / 9;
const MINI_PLAYER_DEFAULT_HEIGHT = Math.round(MINI_PLAYER_HEADER_HEIGHT + MINI_PLAYER_DEFAULT_WIDTH / MINI_PLAYER_VIDEO_ASPECT_RATIO);
const MINI_PLAYER_MIN_WIDTH = 230;
const MINI_PLAYER_MIN_HEIGHT = Math.round(MINI_PLAYER_HEADER_HEIGHT + MINI_PLAYER_MIN_WIDTH / MINI_PLAYER_VIDEO_ASPECT_RATIO);
const MINI_PLAYER_MAX_WIDTH_RATIO = 0.72;
const MINI_PLAYER_MAX_HEIGHT_RATIO = 0.72;
const MINI_PLAYER_EDGE_GAP = 12;
const MINI_PLAYER_SNAP_DISTANCE = 28;
const MINI_PLAYER_RESIZE_HANDLES: MiniPlayerResizeHandle[] = ["se", "e", "s", "n", "w", "ne", "nw", "sw"];

function loadYouTubeApi(): Promise<void> {
  if (window.YT?.Player) {
    return Promise.resolve();
  }

  if (!youtubeApiPromise) {
    youtubeApiPromise = new Promise((resolve, reject) => {
      const previousReady = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        previousReady?.();
        resolve();
      };

      if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
        const script = document.createElement("script");
        script.src = "https://www.youtube.com/iframe_api";
        script.async = true;
        script.onerror = () => {
          youtubeApiPromise = null;
          reject(new Error("Could not load the YouTube player API."));
        };
        document.head.appendChild(script);
      }
    });
  }

  return youtubeApiPromise;
}

function isYouTubePlayerInstance(player: YouTubePlayerInstance | null): player is YouTubePlayerInstance {
  return (
    !!player &&
    typeof player.loadVideoById === "function" &&
    typeof player.playVideo === "function" &&
    typeof player.pauseVideo === "function"
  );
}

function playYouTubePlayer(player: YouTubePlayerInstance | null): boolean {
  if (!isYouTubePlayerInstance(player)) {
    return false;
  }

  player.playVideo();
  return true;
}

function getYouTubeEmbedOrigin(): string {
  return window.location.origin;
}

function getYouTubePlayerVars(autoplay = false): Record<string, unknown> {
  const vars: Record<string, unknown> = {
    autoplay: autoplay ? 1 : 0,
    enablejsapi: 1,
    origin: getYouTubeEmbedOrigin(),
    playsinline: 1,
    rel: 0,
    widget_referrer: YOUTUBE_EMBED_REFERRER
  };

  return vars;
}

function getYouTubeEmbedUrl(videoId: string, autoplay = false): string {
  const url = new URL(`https://www.youtube.com/embed/${encodeURIComponent(videoId)}`);
  const vars = getYouTubePlayerVars(autoplay);

  for (const [key, value] of Object.entries(vars)) {
    url.searchParams.set(key, String(value));
  }

  return url.toString();
}

function clearYouTubeShell(shell: HTMLDivElement | null): void {
  if (!shell?.isConnected) {
    return;
  }

  try {
    shell.replaceChildren();
  } catch {
    // The YouTube player can mutate its iframe while a route/layout is settling.
  }
}

function findItemIndex(items: HololiveMusicResolvedItem[], itemId?: string | null): number {
  return itemId ? items.findIndex((item) => item.id === itemId) : -1;
}

function findPlayableItemIndex(
  items: HololiveMusicResolvedItem[],
  startIndex: number,
  direction: 1 | -1,
  wrap: boolean
): number {
  if (items.length === 0) {
    return -1;
  }

  for (let step = 1; step <= items.length; step += 1) {
    const rawIndex = startIndex + step * direction;
    const index = wrap ? (rawIndex + items.length) % items.length : rawIndex;

    if (index < 0 || index >= items.length) {
      return -1;
    }

    if (items[index]?.available) {
      return index;
    }
  }

  return -1;
}

function itemTitle(item: HololiveMusicResolvedItem | null | undefined): string {
  return hololiveResolvedItemTitle(item, "Nothing selected");
}

function isPermanentYouTubePlaybackError(errorCode?: number): boolean {
  return errorCode === 100 || errorCode === 101 || errorCode === 150;
}

function resolvePlaybackSource(
  value?: HololiveMusicPlaybackSource | null
): HololiveMusicPlaybackSource {
  return value === "queue" || value === "playlist" || value === "library" ? value : "library";
}

function resolveRepeatMode(value?: HololiveMusicRepeatMode | null): HololiveMusicRepeatMode {
  return value === "all" || value === "one" ? value : "off";
}

function anchorRectsEqual(left: AnchorRect | null, right: AnchorRect | null): boolean {
  if (!left || !right) {
    return left === right;
  }

  return (
    Math.abs(left.top - right.top) < 0.5 &&
    Math.abs(left.left - right.left) < 0.5 &&
    Math.abs(left.width - right.width) < 0.5 &&
    Math.abs(left.height - right.height) < 0.5
  );
}

function defaultMiniPlayerBounds(): MiniPlayerBounds {
  return clampMiniPlayerBounds({
    x: MINI_PLAYER_EDGE_GAP,
    y: window.innerHeight - MINI_PLAYER_DEFAULT_HEIGHT - MINI_PLAYER_EDGE_GAP,
    width: MINI_PLAYER_DEFAULT_WIDTH,
    height: MINI_PLAYER_DEFAULT_HEIGHT
  });
}

function clampMiniPlayerBounds(bounds: MiniPlayerBounds): MiniPlayerBounds {
  const { maxWidth, maxHeight } = getMiniPlayerSizeLimits();
  const width = Math.min(Math.max(Math.round(bounds.width), MINI_PLAYER_MIN_WIDTH), maxWidth);
  const height = Math.min(Math.max(Math.round(bounds.height), MINI_PLAYER_MIN_HEIGHT), maxHeight);
  const maxX = Math.max(window.innerWidth - width - MINI_PLAYER_EDGE_GAP, MINI_PLAYER_EDGE_GAP);
  const maxY = Math.max(window.innerHeight - height - MINI_PLAYER_EDGE_GAP, MINI_PLAYER_EDGE_GAP);

  return {
    x: Math.min(Math.max(Math.round(bounds.x), MINI_PLAYER_EDGE_GAP), maxX),
    y: Math.min(Math.max(Math.round(bounds.y), MINI_PLAYER_EDGE_GAP), maxY),
    width,
    height
  };
}

function getMiniPlayerSizeLimits(): { maxWidth: number; maxHeight: number } {
  return {
    maxWidth: Math.max(MINI_PLAYER_MIN_WIDTH, Math.round(window.innerWidth * MINI_PLAYER_MAX_WIDTH_RATIO)),
    maxHeight: Math.max(MINI_PLAYER_MIN_HEIGHT, Math.round(window.innerHeight * MINI_PLAYER_MAX_HEIGHT_RATIO))
  };
}

function snapMiniPlayerBounds(bounds: MiniPlayerBounds): MiniPlayerBounds {
  const clamped = clampMiniPlayerBounds(bounds);
  const maxX = Math.max(window.innerWidth - clamped.width - MINI_PLAYER_EDGE_GAP, MINI_PLAYER_EDGE_GAP);
  const maxY = Math.max(window.innerHeight - clamped.height - MINI_PLAYER_EDGE_GAP, MINI_PLAYER_EDGE_GAP);
  let { x, y } = clamped;

  if (Math.abs(x - MINI_PLAYER_EDGE_GAP) <= MINI_PLAYER_SNAP_DISTANCE) {
    x = MINI_PLAYER_EDGE_GAP;
  } else if (Math.abs(x - maxX) <= MINI_PLAYER_SNAP_DISTANCE) {
    x = maxX;
  }

  if (Math.abs(y - MINI_PLAYER_EDGE_GAP) <= MINI_PLAYER_SNAP_DISTANCE) {
    y = MINI_PLAYER_EDGE_GAP;
  } else if (Math.abs(y - maxY) <= MINI_PLAYER_SNAP_DISTANCE) {
    y = maxY;
  }

  return { ...clamped, x, y };
}

function withVideoAspectRatio(width: number): Pick<MiniPlayerBounds, "width" | "height"> {
  const { maxWidth: viewportMaxWidth, maxHeight } = getMiniPlayerSizeLimits();
  const maxContentHeight = Math.max(1, maxHeight - MINI_PLAYER_HEADER_HEIGHT);
  const maxWidth = Math.min(viewportMaxWidth, Math.round(maxContentHeight * MINI_PLAYER_VIDEO_ASPECT_RATIO));
  const nextWidth = Math.min(Math.max(Math.round(width), MINI_PLAYER_MIN_WIDTH), maxWidth);
  return {
    width: nextWidth,
    height: Math.round(MINI_PLAYER_HEADER_HEIGHT + nextWidth / MINI_PLAYER_VIDEO_ASPECT_RATIO)
  };
}

function resizeMiniPlayerBounds(
  origin: MiniPlayerBounds,
  deltaX: number,
  deltaY: number,
  handle: MiniPlayerResizeHandle,
  keepVideoRatio: boolean
): MiniPlayerBounds {
  const movesWest = handle.includes("w");
  const movesEast = handle.includes("e");
  const movesNorth = handle.includes("n");
  const movesSouth = handle.includes("s");
  const widthDelta = movesEast ? deltaX : movesWest ? -deltaX : 0;
  const heightDelta = movesSouth ? deltaY : movesNorth ? -deltaY : 0;

  if (keepVideoRatio) {
    const originContentHeight = Math.max(1, origin.height - MINI_PLAYER_HEADER_HEIGHT);
    const widthFromHorizontal = origin.width + widthDelta;
    const widthFromVertical = (originContentHeight + heightDelta) * MINI_PLAYER_VIDEO_ASPECT_RATIO;
    const targetWidth =
      (movesNorth || movesSouth) && !(movesEast || movesWest)
        ? widthFromVertical
        : (movesEast || movesWest) && !(movesNorth || movesSouth)
          ? widthFromHorizontal
          : Math.abs(widthDelta) >= Math.abs(heightDelta * MINI_PLAYER_VIDEO_ASPECT_RATIO)
            ? widthFromHorizontal
            : widthFromVertical;
    const size = withVideoAspectRatio(targetWidth);

    return clampMiniPlayerBounds({
      x: movesWest ? origin.x + origin.width - size.width : origin.x,
      y: movesNorth ? origin.y + origin.height - size.height : origin.y,
      ...size
    });
  }

  const { maxWidth, maxHeight } = getMiniPlayerSizeLimits();
  const width = Math.min(Math.max(Math.round(origin.width + widthDelta), MINI_PLAYER_MIN_WIDTH), maxWidth);
  const height = Math.min(Math.max(Math.round(origin.height + heightDelta), MINI_PLAYER_MIN_HEIGHT), maxHeight);

  return clampMiniPlayerBounds({
    x: movesWest ? origin.x + origin.width - width : origin.x,
    y: movesNorth ? origin.y + origin.height - height : origin.y,
    width,
    height
  });
}

function parseMiniPlayerBounds(value?: string): MiniPlayerBounds | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as Partial<MiniPlayerBounds>;
    if (Number.isFinite(parsed.x) && Number.isFinite(parsed.y)) {
      if (Number.isFinite(parsed.width) && Number.isFinite(parsed.height)) {
        return clampMiniPlayerBounds({
          x: Number(parsed.x),
          y: Number(parsed.y),
          width: Number(parsed.width),
          height: Number(parsed.height)
        });
      }

      return clampMiniPlayerBounds({
        x: Number(parsed.x),
        y: Number(parsed.y),
        width: MINI_PLAYER_DEFAULT_WIDTH,
        height: MINI_PLAYER_DEFAULT_HEIGHT
      });
    }
  } catch {
    return null;
  }

  return null;
}

interface YouTubePlayerProps {
  videoId: string | null;
  playSignal: number;
  playTargetVideoId: string | null;
  pauseSignal: number;
  onPlayingChange: (playing: boolean) => void;
  onEnded: () => void;
  onError: (errorCode?: number) => void;
}

function YouTubePlayer({
  videoId,
  playSignal,
  playTargetVideoId,
  pauseSignal,
  onPlayingChange,
  onEnded,
  onError
}: YouTubePlayerProps) {
  const shellRef = useRef<HTMLDivElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const playerRef = useRef<YouTubePlayerInstance | null>(null);
  const videoIdRef = useRef<string | null>(null);
  const playSignalRef = useRef(playSignal);
  const playTargetVideoIdRef = useRef(playTargetVideoId);
  const pauseSignalRef = useRef(pauseSignal);
  const handledEndedPlaybackTokenRef = useRef<string | null>(null);
  const pendingPlayRef = useRef(
    playSignal > 0 && Boolean(videoId) && (!playTargetVideoId || playTargetVideoId === videoId)
  );
  const onPlayingChangeRef = useRef(onPlayingChange);
  const onEndedRef = useRef(onEnded);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onPlayingChangeRef.current = onPlayingChange;
    onEndedRef.current = onEnded;
    onErrorRef.current = onError;
  }, [onEnded, onError, onPlayingChange]);

  useEffect(() => {
    playTargetVideoIdRef.current = playTargetVideoId;
  }, [playTargetVideoId]);

  function getPlaybackToken(): string {
    return `${videoIdRef.current ?? "none"}:${playSignalRef.current}`;
  }

  const handlePlayerStateChange = useCallback((state: number) => {
    const endedState = window.YT?.PlayerState.ENDED ?? 0;
    const playingState = window.YT?.PlayerState.PLAYING ?? 1;
    const pausedState = window.YT?.PlayerState.PAUSED ?? 2;

    if (state === endedState) {
      const playbackToken = getPlaybackToken();
      if (handledEndedPlaybackTokenRef.current === playbackToken) {
        return;
      }

      handledEndedPlaybackTokenRef.current = playbackToken;
      pendingPlayRef.current = false;
      onPlayingChangeRef.current(false);
      onEndedRef.current();
    } else if (state === playingState) {
      onPlayingChangeRef.current(true);
    } else if (state === pausedState) {
      onPlayingChangeRef.current(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const shell = shellRef.current;

    async function createPlayer() {
      if (!shell || !videoId) {
        clearYouTubeShell(shell);
        playerRef.current = null;
        iframeRef.current = null;
        videoIdRef.current = null;
        return;
      }

      clearYouTubeShell(shell);
      const targetVideoId = playTargetVideoIdRef.current;
      const shouldAutoplay = pendingPlayRef.current && (!targetVideoId || targetVideoId === videoId);
      videoIdRef.current = videoId;
      handledEndedPlaybackTokenRef.current = null;

      try {
        await loadYouTubeApi();
      } catch {
        if (!cancelled && shell.isConnected) {
          clearYouTubeShell(shell);
          const iframe = document.createElement("iframe");
          iframe.className = "hololive-youtube-host";
          iframe.title = "Hololive YouTube player";
          iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture";
          iframe.allowFullscreen = true;
          iframe.referrerPolicy = "origin";
          iframe.src = getYouTubeEmbedUrl(videoId, shouldAutoplay);
          shell.appendChild(iframe);
          iframeRef.current = iframe;
          onErrorRef.current();
        }
        return;
      }

      if (cancelled || !window.YT?.Player) {
        clearYouTubeShell(shell);
        return;
      }

      const apiHost = document.createElement("div");
      apiHost.className = "hololive-youtube-api-host";
      shell.appendChild(apiHost);

      playerRef.current = new window.YT.Player(apiHost, {
        videoId,
        playerVars: getYouTubePlayerVars(shouldAutoplay),
        events: {
          onReady: () => {
            onPlayingChangeRef.current(false);
            if (pendingPlayRef.current && playYouTubePlayer(playerRef.current)) {
              pendingPlayRef.current = false;
            }
          },
          onStateChange: (event) => handlePlayerStateChange(event.data),
          onError: (event) => onErrorRef.current(event.data)
        }
      });
    }

    void createPlayer();

    return () => {
      cancelled = true;
      const player = playerRef.current;
      playerRef.current = null;
      iframeRef.current = null;
      videoIdRef.current = null;
      handledEndedPlaybackTokenRef.current = null;

      try {
        if (typeof player?.destroy === "function") {
          player.destroy();
        }
      } catch {
        // YouTube can already be tearing down the iframe during video swaps.
      }

      clearYouTubeShell(shell);
    };
  }, [handlePlayerStateChange, videoId]);

  useEffect(() => {
    if (playSignal === playSignalRef.current) {
      return;
    }

    playSignalRef.current = playSignal;
    pendingPlayRef.current = true;
    if (playTargetVideoId && playTargetVideoId !== videoId) {
      return;
    }
    if (videoId && !isYouTubePlayerInstance(playerRef.current) && iframeRef.current) {
      iframeRef.current.src = getYouTubeEmbedUrl(videoId, true);
    }
    if (videoId && isYouTubePlayerInstance(playerRef.current) && videoIdRef.current !== videoId) {
      playerRef.current.loadVideoById(videoId);
      videoIdRef.current = videoId;
      handledEndedPlaybackTokenRef.current = null;
    }
    if (playYouTubePlayer(playerRef.current)) {
      pendingPlayRef.current = false;
    }
  }, [playSignal, playTargetVideoId, videoId]);

  useEffect(() => {
    if (pauseSignal === pauseSignalRef.current) {
      return;
    }

    pauseSignalRef.current = pauseSignal;
    pendingPlayRef.current = false;
    if (isYouTubePlayerInstance(playerRef.current)) {
      playerRef.current.pauseVideo();
    }
  }, [pauseSignal]);

  return (
    <div className="hololive-youtube-player-root">
      <div className="hololive-youtube-host-shell" ref={shellRef} aria-hidden={!videoId} />
      {!videoId ? (
      <div className="hololive-youtube-empty">
        <ListMusic size={28} />
        <span>Select a song to play.</span>
      </div>
      ) : null}
    </div>
  );
}

function HololivePersistentPlayerSurface({
  currentVideoId,
  currentItem,
  profileContext,
  playlists,
  marker,
  playing,
  playSignal,
  playTargetVideoId,
  pauseSignal,
  onPlayingChange,
  onEnded,
  onError,
  onTogglePlayPause,
  onNext,
  canNext,
  autoplayEnabled,
  onToggleAutoplay,
  onAddToPlaylist,
  onSetMarker,
  onExclude,
  onViewInShelf,
  onClose,
  miniDismissed,
  miniBounds,
  onMiniBoundsChange
}: {
  currentVideoId: string | null;
  currentItem: HololiveMusicResolvedItem | null;
  profileContext: HololiveProfilePlaybackContext | null;
  playlists: HololiveMusicPlayerData["playlists"];
  marker?: HololiveMusicMarker | null;
  playing: boolean;
  playSignal: number;
  playTargetVideoId: string | null;
  pauseSignal: number;
  onPlayingChange: (playing: boolean) => void;
  onEnded: (mode: AutoplayAdvanceMode) => void;
  onError: (errorCode: number | undefined, mode: AutoplayAdvanceMode) => void;
  onTogglePlayPause: () => void;
  onNext: () => void;
  canNext: boolean;
  autoplayEnabled: boolean;
  onToggleAutoplay: () => void;
  onAddToPlaylist: (playlistId: string) => Promise<void>;
  onSetMarker: (marker: HololiveMusicMarker | null) => Promise<void>;
  onExclude: () => Promise<void>;
  onViewInShelf: () => void;
  onClose: () => void;
  miniDismissed: boolean;
  miniBounds: MiniPlayerBounds;
  onMiniBoundsChange: (bounds: MiniPlayerBounds, options?: { persist?: boolean; snap?: boolean }) => void;
}) {
  const location = useLocation();
  const [anchorRect, setAnchorRect] = useState<AnchorRect | null>(null);
  const [miniInteractionType, setMiniInteractionType] = useState<MiniPlayerInteraction["type"] | null>(null);
  const miniPlayerRef = useRef<HTMLElement | null>(null);
  const miniInteractionRef = useRef<MiniPlayerInteraction | null>(null);
  const latestMiniBoundsRef = useRef(miniBounds);
  const pendingMiniBoundsRef = useRef<MiniPlayerBounds | null>(null);
  const miniBoundsFrameRef = useRef<number | null>(null);
  const [playlistMenuOpen, setPlaylistMenuOpen] = useState(false);
  const [markerMenuOpen, setMarkerMenuOpen] = useState(false);
  const [confirmExclude, setConfirmExclude] = useState(false);
  const [pendingAction, setPendingAction] = useState<"playlist" | "marker" | null>(null);

  useEffect(() => {
    latestMiniBoundsRef.current = miniBounds;
  }, [miniBounds]);

  useEffect(
    () => () => {
      if (miniBoundsFrameRef.current !== null) {
        window.cancelAnimationFrame(miniBoundsFrameRef.current);
      }
    },
    []
  );

  useLayoutEffect(() => {
    let animationFrame = 0;
    let observer: ResizeObserver | null = null;
    let currentAnchor: Element | null = null;

    function updateAnchorRect() {
      const anchor = document.querySelector(".hololive-youtube-frame-anchor");
      currentAnchor = anchor;

      if (!anchor) {
        setAnchorRect((current) => (current === null ? current : null));
        return;
      }

      const rect = anchor.getBoundingClientRect();
      const nextRect: AnchorRect = {
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height
      };
      setAnchorRect((current) => (anchorRectsEqual(current, nextRect) ? current : nextRect));
    }

    function scheduleUpdate() {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(updateAnchorRect);
    }

    scheduleUpdate();
    window.addEventListener("resize", scheduleUpdate);
    window.addEventListener("scroll", scheduleUpdate, true);

    const anchor = document.querySelector(".hololive-youtube-frame-anchor");
    if (anchor) {
      observer = new ResizeObserver(scheduleUpdate);
      observer.observe(anchor);
      currentAnchor = anchor;
    }

    function bindCurrentAnchor() {
      const nextAnchor = document.querySelector(".hololive-youtube-frame-anchor");
      if (nextAnchor !== currentAnchor) {
        observer?.disconnect();
        observer = null;
        currentAnchor = nextAnchor;
        if (nextAnchor) {
          observer = new ResizeObserver(scheduleUpdate);
          observer.observe(nextAnchor);
        }
        scheduleUpdate();
      }
    }

    const anchorRetryTimers = [80, 240, 600].map((delay) =>
      window.setTimeout(() => {
        bindCurrentAnchor();
        scheduleUpdate();
      }, delay)
    );

    return () => {
      window.cancelAnimationFrame(animationFrame);
      anchorRetryTimers.forEach((timer) => window.clearTimeout(timer));
      window.removeEventListener("resize", scheduleUpdate);
      window.removeEventListener("scroll", scheduleUpdate, true);
      observer?.disconnect();
    };
  }, [location.pathname]);

  useEffect(() => {
    function cancelInteraction() {
      finishMiniInteraction();
    }

    window.addEventListener("blur", cancelInteraction);
    return () => window.removeEventListener("blur", cancelInteraction);
  }, []);

  const anchored = Boolean(anchorRect);
  if (!anchored && (!currentVideoId || miniDismissed)) {
    return null;
  }

  const autoplayMode: AutoplayAdvanceMode = anchored ? "active-source" : "profile-context";
  const currentMarkerLabel = musicMarkerLabel(marker);

  const style = anchored
    ? ({
        top: anchorRect?.top,
        left: anchorRect?.left,
        width: anchorRect?.width,
        height: anchorRect?.height
      } satisfies CSSProperties)
    : ({
        top: miniBounds.y,
        left: miniBounds.x,
        width: miniBounds.width,
        height: miniBounds.height
      } satisfies CSSProperties);

  function beginMiniMove(event: ReactPointerEvent<HTMLElement>) {
    if (anchored || event.button !== 0 || (event.target instanceof Element && event.target.closest("button, [data-mini-popover]"))) {
      return;
    }

    event.preventDefault();
    const element = miniPlayerRef.current;
    if (!element) {
      return;
    }

    try {
      element.setPointerCapture(event.pointerId);
    } catch {
      // If capture fails, the normal pointer handlers still get a chance to clean up.
    }

    setMiniInteractionType("move");
    miniInteractionRef.current = {
      type: "move",
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origin: miniBounds,
      element
    };
  }

  function beginMiniResize(event: ReactPointerEvent<HTMLButtonElement>, handle: MiniPlayerResizeHandle) {
    if (anchored || event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const element = miniPlayerRef.current;
    if (!element) {
      return;
    }

    try {
      element.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is best-effort; cancellation paths below are still safe.
    }

    setMiniInteractionType("resize");
    miniInteractionRef.current = {
      type: "resize",
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origin: miniBounds,
      element,
      handle
    };
  }

  function scheduleMiniBoundsChange(bounds: MiniPlayerBounds) {
    latestMiniBoundsRef.current = bounds;
    pendingMiniBoundsRef.current = bounds;

    if (miniBoundsFrameRef.current !== null) {
      return;
    }

    miniBoundsFrameRef.current = window.requestAnimationFrame(() => {
      miniBoundsFrameRef.current = null;
      const nextBounds = pendingMiniBoundsRef.current;
      pendingMiniBoundsRef.current = null;

      if (nextBounds) {
        onMiniBoundsChange(nextBounds);
      }
    });
  }

  function cancelPendingMiniBoundsChange() {
    if (miniBoundsFrameRef.current !== null) {
      window.cancelAnimationFrame(miniBoundsFrameRef.current);
      miniBoundsFrameRef.current = null;
    }

    pendingMiniBoundsRef.current = null;
  }

  function handleMiniPointerMove(event: ReactPointerEvent<HTMLElement>) {
    const interaction = miniInteractionRef.current;
    if (!interaction || anchored || event.pointerId !== interaction.pointerId) {
      return;
    }

    event.preventDefault();
    const deltaX = event.clientX - interaction.startX;
    const deltaY = event.clientY - interaction.startY;

    if (interaction.type === "move") {
      const nextBounds = clampMiniPlayerBounds({
        ...interaction.origin,
        x: interaction.origin.x + deltaX,
        y: interaction.origin.y + deltaY
      });
      scheduleMiniBoundsChange(nextBounds);
      return;
    }

    const nextBounds = resizeMiniPlayerBounds(interaction.origin, deltaX, deltaY, interaction.handle, event.shiftKey);
    scheduleMiniBoundsChange(nextBounds);
  }

  function finishMiniInteraction(event?: ReactPointerEvent<HTMLElement>) {
    const interaction = miniInteractionRef.current;
    if (!interaction || (event && event.pointerId !== interaction.pointerId)) {
      return;
    }

    const shouldSnap = interaction.type === "move";
    cancelPendingMiniBoundsChange();
    miniInteractionRef.current = null;
    setMiniInteractionType(null);

    try {
      if (interaction.element.hasPointerCapture(interaction.pointerId)) {
        interaction.element.releasePointerCapture(interaction.pointerId);
      }
    } catch {
      // Release can throw if the browser already cancelled capture.
    }

    onMiniBoundsChange(latestMiniBoundsRef.current, { persist: true, snap: shouldSnap });
  }
  async function addCurrentToPlaylist(playlistId: string) {
    setPendingAction("playlist");
    try {
      await onAddToPlaylist(playlistId);
      setPlaylistMenuOpen(false);
    } finally {
      setPendingAction((current) => (current === "playlist" ? null : current));
    }
  }

  async function setCurrentMarker(nextMarker: HololiveMusicMarker | null) {
    setPendingAction("marker");
    try {
      await onSetMarker(nextMarker);
      setMarkerMenuOpen(false);
    } finally {
      setPendingAction((current) => (current === "marker" ? null : current));
    }
  }

  async function excludeCurrentSong() {
    setPendingAction("marker");
    try {
      await onExclude();
      setMarkerMenuOpen(false);
      setConfirmExclude(false);
    } finally {
      setPendingAction((current) => (current === "marker" ? null : current));
    }
  }

  return (
    <section
      ref={miniPlayerRef}
      className={`hololive-persistent-player ${anchored ? "anchored" : "mini"}`}
      data-dragging={miniInteractionType ? "true" : "false"}
      data-interaction={miniInteractionType ?? undefined}
      style={style}
      aria-label="Hololive YouTube player"
      onPointerMove={handleMiniPointerMove}
      onPointerUp={finishMiniInteraction}
      onPointerCancel={finishMiniInteraction}
      onLostPointerCapture={finishMiniInteraction}
    >
      {!anchored ? (
        <div className="hololive-persistent-player-head" onPointerDown={beginMiniMove}>
          <div>
            <strong title={itemTitle(currentItem)}>{itemTitle(currentItem)}</strong>
          </div>
          <div
            className="hololive-persistent-player-actions"
            onPointerDown={(event) => event.stopPropagation()}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) {
                setPlaylistMenuOpen(false);
                setMarkerMenuOpen(false);
                setConfirmExclude(false);
              }
            }}
          >
            <button type="button" onClick={onTogglePlayPause} disabled={!currentVideoId} title={playing ? "Pause" : "Play"}>
              {playing ? <Pause size={12} /> : <Play size={12} />}
            </button>
            <button
              type="button"
              onClick={onNext}
              disabled={!currentVideoId || !canNext}
              title={profileContext ? `Next ${profileContext.mediaGroupLabel} song` : "No profile context"}
            >
              <SkipForward size={12} />
            </button>
            <button
              className={autoplayEnabled ? "active" : undefined}
              type="button"
              onClick={onToggleAutoplay}
              disabled={!currentVideoId}
              title={`Autoplay: ${autoplayEnabled ? "on" : "off"}`}
              aria-label="Toggle autoplay"
              aria-pressed={autoplayEnabled}
            >
              <Repeat size={12} />
            </button>
            <span className="hololive-mini-player-menu-anchor">
              <button
                type="button"
                onClick={() => {
                  setMarkerMenuOpen(false);
                  setPlaylistMenuOpen((current) => !current);
                }}
                disabled={!currentVideoId || playlists.length === 0 || pendingAction !== null}
                title={playlists.length === 0 ? "Create a playlist first" : "Add to playlist"}
                aria-expanded={playlistMenuOpen}
                aria-label="Add current song to playlist"
              >
                <ListMusic size={12} />
              </button>
              {playlistMenuOpen ? (
                <HololivePlaylistMenu
                  ariaLabel="Choose playlist"
                  className="hololive-mini-player-popover playlist"
                  dataMiniPopover
                  disabled={pendingAction !== null}
                  playlists={playlists}
                  youtubeVideoId={currentVideoId}
                  onSelect={(playlistId) => void addCurrentToPlaylist(playlistId)}
                />
              ) : null}
            </span>
            <button
              type="button"
              onClick={onViewInShelf}
              disabled={!currentVideoId || !profileContext}
              title={profileContext ? `View in ${profileContext.idolName} profile` : "No profile context"}
              aria-label="View current song in profile shelf"
            >
              <PanelRightOpen size={12} />
            </button>
            <span className="hololive-mini-player-menu-anchor">
              <button
                className={`marker ${marker ?? "unmarked"}`}
                type="button"
                onClick={() => {
                  setPlaylistMenuOpen(false);
                  setConfirmExclude(false);
                  setMarkerMenuOpen((current) => !current);
                }}
                disabled={!currentVideoId || pendingAction !== null}
                title={`${currentMarkerLabel} marker`}
                aria-expanded={markerMenuOpen}
                aria-label={`${currentMarkerLabel} marker for current song`}
              >
                <MusicMarkerIcon marker={marker} size={12} />
              </button>
              {markerMenuOpen ? (
                <HololiveMusicMarkerMenu
                  ariaLabel="Set current song marker"
                  className="hololive-mini-player-popover marker"
                  confirmAriaLabel="Confirm exclusion for current song"
                  confirmingExclude={confirmExclude}
                  dataMiniPopover
                  disabled={pendingAction !== null}
                  marker={marker}
                  onConfirmingExcludeChange={setConfirmExclude}
                  onExclude={() => void excludeCurrentSong()}
                  onSetMarker={(nextMarker) => void setCurrentMarker(nextMarker)}
                />
              ) : null}
            </span>
            <button type="button" onClick={onClose} title="Close mini player" aria-label="Close mini player">
              <X size={12} />
            </button>
          </div>
        </div>
      ) : null}
      <div className="hololive-persistent-youtube-frame">
        <YouTubePlayer
          videoId={currentVideoId}
          playSignal={playSignal}
          playTargetVideoId={playTargetVideoId}
          pauseSignal={pauseSignal}
          onPlayingChange={onPlayingChange}
          onEnded={() => onEnded(autoplayMode)}
          onError={(errorCode) => onError(errorCode, autoplayMode)}
        />
      </div>
      {!anchored
        ? MINI_PLAYER_RESIZE_HANDLES.map((handle) => (
            <button
              key={handle}
              className={`hololive-persistent-player-resize ${handle}`}
              type="button"
              onPointerDown={(event) => beginMiniResize(event, handle)}
              title="Resize player. Hold Shift to keep video ratio."
              aria-label={`Resize mini player from ${handle.toUpperCase()}`}
            />
          ))
        : null}
    </section>
  );
}

export function HololivePlayerProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const { showToast, showUndoToast } = useHololiveActionToast();
  const [data, setData] = useState<HololiveMusicPlayerData | null>(null);
  const [playSignal, setPlaySignal] = useState(0);
  const [playTargetVideoId, setPlayTargetVideoId] = useState<string | null>(null);
  const [pauseSignal, setPauseSignal] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [miniDismissed, setMiniDismissed] = useState(true);
  const [miniBounds, setMiniBounds] = useState<MiniPlayerBounds>(() => defaultMiniPlayerBounds());
  const [profileContext, setProfileContext] = useState<HololiveProfilePlaybackContext | null>(null);
  const profileContextPreferenceRef = useRef<{
    youtubeVideoId: string;
    preferredIdolId?: string | null;
    preferredGroupId?: HololiveProfileMediaGroupId | null;
  } | null>(null);
  const profileContextSeqRef = useRef(0);
  const handledEndedPlaybackTokenRef = useRef<string | null>(null);
  const unavailableVideoHandlingRef = useRef<Set<string>>(new Set());

  const queue = data?.queue ?? [];
  const state = data?.state ?? null;
  const activePlaylist =
    state?.playbackSourceType === "playlist" && state.currentPlaylistId
      ? data?.playlists.find((playlist) => playlist.id === state.currentPlaylistId) ?? null
      : null;
  const activeItems =
    state?.playbackSourceType === "playlist"
      ? activePlaylist?.items ?? []
      : state?.playbackSourceType === "queue"
        ? queue
        : [];
  const activeItemId =
    state?.playbackSourceType === "playlist"
      ? state.currentPlaylistItemId
      : state?.playbackSourceType === "queue"
        ? state.currentQueueItemId
        : null;
  const currentIndex = findItemIndex(activeItems, activeItemId);
  const currentItem = data?.currentItem ?? null;
  const currentVideoId = state?.currentYoutubeVideoId ?? currentItem?.youtubeVideoId ?? null;
  const playableCount = useMemo(() => activeItems.filter((item) => item.available).length, [activeItems]);
  const userPlaylists = useMemo(() => (data?.playlists ?? []).filter((playlist) => !playlist.systemId), [data?.playlists]);
  const currentMarker = currentItem?.music?.marker ?? null;
  const canPlayProfileNext = Boolean(profileContext && profileContext.currentIndex >= 0 && profileContext.songIds.length > 1);

  function notifyPlayer(message: string, tone: "info" | "success" | "error" = "info", detail?: string | null) {
    showToast({ message, detail, tone });
  }

  async function loadPlayerData() {
    const next = await api.invoke("hololive:player:data", null);
    setData(next);
    return next;
  }

  async function applyPlayerData(work: () => Promise<HololiveMusicPlayerData>, message?: string) {
    try {
      const next = await work();
      setData(next);
      if (message) {
        notifyPlayer(message, "success");
      }
      return next;
    } catch (error) {
      console.error(error);
      notifyPlayer("Player action failed", "error", error instanceof Error ? error.message : "Try again.");
      return null;
    }
  }

  async function updateState(input: IpcChannelMap["hololive:player:state:update"]["request"]) {
    return applyPlayerData(() => api.invoke("hololive:player:state:update", input));
  }

  async function resolveProfileContext(
    youtubeVideoId: string | null | undefined,
    source?: HololiveProfilePlaybackSource | null
  ) {
    const videoId = youtubeVideoId?.trim();
    const sequence = ++profileContextSeqRef.current;
    if (!videoId) {
      setProfileContext(null);
      profileContextPreferenceRef.current = null;
      return null;
    }

    const preferred =
      source ??
      (profileContextPreferenceRef.current?.youtubeVideoId === videoId
        ? {
            idolId: profileContextPreferenceRef.current.preferredIdolId,
            mediaGroupId: profileContextPreferenceRef.current.preferredGroupId
          }
        : null);

    try {
      const context = await api.invoke("hololive:profile:playback-context", {
        youtubeVideoId: videoId,
        preferredIdolId: preferred?.idolId ?? null,
        preferredGroupId: preferred?.mediaGroupId ?? null
      });
      if (sequence === profileContextSeqRef.current) {
        setProfileContext(context);
      }
      return context;
    } catch (error) {
      console.error(error);
      if (sequence === profileContextSeqRef.current) {
        setProfileContext(null);
      }
      return null;
    }
  }

  function setMiniDismissedState(dismissed: boolean, persist = true) {
    setMiniDismissed(dismissed);

    if (persist) {
      void api
        .invoke("settings:set", {
          key: MINI_PLAYER_DISMISSED_SETTING_KEY,
          value: String(dismissed)
        })
        .catch((error: unknown) => {
          console.error("Failed to save mini player visibility state", error);
        });
    }
  }

  async function playQueueIndex(index: number) {
    const item = queue[index];
    if (!item?.available) {
      return;
    }

    const next = await updateState({
      playbackSourceType: "queue",
      currentQueueItemId: item.id,
      currentPlaylistId: null,
      currentPlaylistItemId: null,
      currentYoutubeVideoId: item.youtubeVideoId
    });
    if (!next) {
      return;
    }
    setMiniDismissedState(false);
    void resolveProfileContext(next.state.currentYoutubeVideoId);
    requestPlayback(next.state.currentYoutubeVideoId);
  }

  async function playQueueItem(itemId: string) {
    const item = queue.find((candidate) => candidate.id === itemId);
    if (!item?.available) {
      return;
    }

    const next = await updateState({
      playbackSourceType: "queue",
      currentQueueItemId: item.id,
      currentPlaylistId: null,
      currentPlaylistItemId: null,
      currentYoutubeVideoId: item.youtubeVideoId
    });
    if (!next) {
      return;
    }
    setMiniDismissedState(false);
    void resolveProfileContext(next.state.currentYoutubeVideoId);
    requestPlayback(next.state.currentYoutubeVideoId);
  }

  async function loadQueueItem(itemId: string) {
    const item = queue.find((candidate) => candidate.id === itemId);
    if (!item?.available) {
      return;
    }

    setPlaying(false);
    setPauseSignal((value) => value + 1);
    const next = await updateState({
      playbackSourceType: "queue",
      currentQueueItemId: item.id,
      currentPlaylistId: null,
      currentPlaylistItemId: null,
      currentYoutubeVideoId: item.youtubeVideoId
    });
    if (next) {
      void resolveProfileContext(next.state.currentYoutubeVideoId);
      notifyPlayer("Loaded in player", "success");
    }
  }

  async function playPlaylistItem(playlistId: string, itemId?: string | null, shouldPlay = true) {
    const next = await applyPlayerData(
      () => api.invoke("hololive:player:playlist:play", { playlistId, itemId }),
      shouldPlay ? "Playing playlist" : "Loaded in player"
    );
    if (!next) {
      return;
    }

    if (shouldPlay) {
      setMiniDismissedState(false);
      const selectedItem =
        itemId
          ? next.playlists.find((playlist) => playlist.id === playlistId)?.items?.find((item) => item.id === itemId)
          : next.playlists.find((playlist) => playlist.id === playlistId)?.items?.find((item) => item.available);
      void resolveProfileContext(selectedItem?.youtubeVideoId ?? next.state.currentYoutubeVideoId);
      requestPlayback(selectedItem?.youtubeVideoId ?? next.state.currentYoutubeVideoId);
    } else {
      void resolveProfileContext(next.state.currentYoutubeVideoId);
      setPlaying(false);
      setPauseSignal((value) => value + 1);
    }
  }

  async function playVideoNow(youtubeVideoId: string, source?: HololiveProfilePlaybackSource) {
    profileContextPreferenceRef.current = {
      youtubeVideoId,
      preferredIdolId: source?.idolId ?? null,
      preferredGroupId: source?.mediaGroupId ?? null
    };
    const next = await applyPlayerData(
      () => api.invoke("hololive:player:play-video", { youtubeVideoId }),
      "Playing now"
    );
    if (next) {
      setMiniDismissedState(false);
      void resolveProfileContext(next.state.currentYoutubeVideoId, source);
      requestPlayback(next.state.currentYoutubeVideoId);
    }
    return next;
  }

  async function queueVideo(youtubeVideoId: string, placement: "now" | "next" | "end") {
    const next = await applyPlayerData(
      () => api.invoke("hololive:player:queue:add", { youtubeVideoId, placement }),
      placement === "now" ? "Playing now" : placement === "next" ? "Queued next" : "Added to queue"
    );
    if (next && placement === "now") {
      setMiniDismissedState(false);
      void resolveProfileContext(next.state.currentYoutubeVideoId);
      requestPlayback(next.state.currentYoutubeVideoId);
    }
    return next;
  }

  async function playVisibleVideos(youtubeVideoIds: string[]) {
    const next = await applyPlayerData(
      () => api.invoke("hololive:player:visible:play", { youtubeVideoIds }),
      "Playing visible songs"
    );
    if (next) {
      setMiniDismissedState(false);
      void resolveProfileContext(next.state.currentYoutubeVideoId);
      requestPlayback(next.state.currentYoutubeVideoId);
    }
    return next;
  }

  async function playNext(direction: 1 | -1) {
    const start = currentIndex >= 0 ? currentIndex : -1;
    const wrap = resolveRepeatMode(state?.repeatMode) === "all";
    const nextIndex = findPlayableItemIndex(activeItems, start, direction, wrap);

    if (nextIndex >= 0 && resolvePlaybackSource(state?.playbackSourceType) === "queue") {
      await playQueueIndex(nextIndex);
    } else if (nextIndex >= 0 && resolvePlaybackSource(state?.playbackSourceType) === "playlist" && activePlaylist) {
      await playPlaylistItem(activePlaylist.id, activeItems[nextIndex]?.id ?? null);
    }
  }

  async function playProfileContextNext(context = profileContext) {
    if (!context || context.currentIndex < 0) {
      return;
    }

    if (context.songIds.length <= 1) {
      return;
    }

    const nextIndex = (context.currentIndex + 1) % context.songIds.length;
    const nextVideoId = context.songIds[nextIndex];
    if (!nextVideoId) {
      return;
    }

    await playVideoNow(nextVideoId, {
      idolId: context.idolId,
      mediaGroupId: context.mediaGroupId
    });
  }

  async function addCurrentVideoToPlaylist(playlistId: string) {
    if (!currentVideoId) {
      return;
    }

    const playlist = userPlaylists.find((candidate) => candidate.id === playlistId);
    const alreadyInPlaylist = Boolean(playlist?.items?.some((item) => item.youtubeVideoId === currentVideoId));
    await applyPlayerData(
      () => api.invoke("hololive:player:playlist-item:add", { playlistId, youtubeVideoId: currentVideoId }),
      playlist
        ? alreadyInPlaylist
          ? `Removed from ${playlist.name}`
          : `Added to ${playlist.name}`
        : "Playlist updated"
    );
  }

  async function setCurrentVideoMarker(marker: HololiveMusicMarker | null) {
    if (!currentVideoId) {
      return;
    }

    const response = await api.invoke("hololive:music-marker:set", { youtubeVideoId: currentVideoId, marker });
    window.dispatchEvent(
      new CustomEvent("hololive-music-marker-updated", {
        detail: response
      })
    );
    await loadPlayerData();
    notifyPlayer(marker ? `${musicMarkerLabel(marker)} saved` : "Marker cleared", "success");
  }

  async function excludeCurrentVideo() {
    if (!currentVideoId) {
      return;
    }

    try {
      setPauseSignal((value) => value + 1);
      setPlaying(false);
      const response = await api.invoke("hololive:music:exclude", {
        youtubeVideoId: currentVideoId,
        title: currentItem ? itemTitle(currentItem) : null,
        sourceUrl: currentItem?.music?.youtubeUrl ?? currentItem?.sourceUrlSnapshot ?? null
      });
      window.dispatchEvent(
        new CustomEvent("hololive-music-excluded", {
          detail: response.data
        })
      );
      setProfileContext(null);
      profileContextPreferenceRef.current = null;
      await loadPlayerData();
      notifyPlayer("Song excluded", "success");
      if (response.undoToken) {
        showUndoToast({
          message: "Song excluded",
          undoToken: response.undoToken,
          undoLabel: response.undoLabel,
          onApplied: async () => {
            await loadPlayerData();
          }
        });
      }
    } catch (error) {
      console.error(error);
      notifyPlayer("Exclude failed", "error", error instanceof Error ? error.message : "Try again.");
    }
  }

  async function handlePlayerError(errorCode: number | undefined, mode: AutoplayAdvanceMode) {
    const errorDetail = errorCode ? `Error ${errorCode}.` : null;
    if (!currentVideoId || !isPermanentYouTubePlaybackError(errorCode)) {
      notifyPlayer("YouTube could not play this video", "error", errorDetail);
      if (state?.autoplayEnabled) {
        if (mode === "profile-context" && profileContext && profileContext.songIds.length > 1) {
          void playProfileContextNext();
        } else {
          void playNext(1);
        }
      }
      return;
    }

    const failedVideoId = currentVideoId;
    if (unavailableVideoHandlingRef.current.has(failedVideoId)) {
      return;
    }
    unavailableVideoHandlingRef.current.add(failedVideoId);

    try {
      setPauseSignal((value) => value + 1);
      setPlaying(false);
      const response = await api.invoke("hololive:music:mark-unavailable", {
        youtubeVideoId: failedVideoId,
        title: currentItem ? itemTitle(currentItem) : null,
        sourceUrl: currentItem?.music?.youtubeUrl ?? currentItem?.sourceUrlSnapshot ?? null,
        reason: errorDetail
      });
      window.dispatchEvent(
        new CustomEvent("hololive-music-excluded", {
          detail: {
            youtubeVideoId: response.removedYoutubeVideoId,
            titleSnapshot: currentItem ? itemTitle(currentItem) : null,
            sourceUrlSnapshot: currentItem?.music?.youtubeUrl ?? currentItem?.sourceUrlSnapshot ?? null,
            createdAt: new Date().toISOString()
          }
        })
      );
      setData(response.data);
      setProfileContext(null);
      profileContextPreferenceRef.current = null;

      if (response.replacementYoutubeVideoId) {
        notifyPlayer(
          "Video unavailable; switched versions",
          "info",
          response.replacementTitle ? `Now playing ${response.replacementTitle}.` : null
        );
        setMiniDismissedState(false);
        void resolveProfileContext(response.replacementYoutubeVideoId);
        requestPlayback(response.replacementYoutubeVideoId);
        return;
      }

      notifyPlayer("Video unavailable; hidden from library", "error", errorDetail);
      if (state?.autoplayEnabled) {
        if (mode === "profile-context" && profileContext && profileContext.songIds.length > 1) {
          void playProfileContextNext();
        } else {
          void playNext(1);
        }
      }
    } catch (error) {
      console.error(error);
      notifyPlayer(
        "YouTube could not play this video",
        "error",
        error instanceof Error ? error.message : errorDetail
      );
      if (state?.autoplayEnabled) {
        if (mode === "profile-context" && profileContext && profileContext.songIds.length > 1) {
          void playProfileContextNext();
        } else {
          void playNext(1);
        }
      }
    } finally {
      unavailableVideoHandlingRef.current.delete(failedVideoId);
    }
  }

  function viewCurrentVideoInShelf() {
    if (!currentVideoId || !profileContext) {
      return;
    }

    const params = new URLSearchParams({
      profile: profileContext.idolId,
      group: profileContext.mediaGroupId,
      song: currentVideoId,
      focus: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
    });
    navigate(`/module/hololive?${params.toString()}`);
  }

  async function handleEnded(mode: AutoplayAdvanceMode) {
    const playbackToken = `${currentVideoId ?? "none"}:${playSignal}`;
    if (!currentVideoId || handledEndedPlaybackTokenRef.current === playbackToken) {
      return;
    }

    handledEndedPlaybackTokenRef.current = playbackToken;

    if (!state?.autoplayEnabled) {
      setPlaying(false);
      notifyPlayer("Autoplay is off", "info");
      return;
    }

    if (state.repeatMode === "one") {
      requestPlayback(currentVideoId);
      return;
    }

    if (mode === "profile-context" && currentVideoId) {
      const context =
        profileContext?.youtubeVideoId === currentVideoId
          ? profileContext
          : await resolveProfileContext(currentVideoId);
      if (context && context.songIds.length > 1) {
        await playProfileContextNext(context);
        return;
      }
    }

    if (mode === "profile-context") {
      return;
    }

    if (state.shuffleEnabled) {
      const playableIndexes = activeItems
        .map((item, index) => (item.available && index !== currentIndex ? index : -1))
        .filter((index) => index >= 0);
      const nextIndex = playableIndexes[Math.floor(Math.random() * playableIndexes.length)];

      if (nextIndex !== undefined && state.playbackSourceType === "queue") {
        await playQueueIndex(nextIndex);
      } else if (nextIndex !== undefined && state.playbackSourceType === "playlist" && activePlaylist) {
        await playPlaylistItem(activePlaylist.id, activeItems[nextIndex]?.id ?? null);
      }
      return;
    }

    await playNext(1);
  }

  async function toggleMiniAutoplay() {
    const nextEnabled = !state?.autoplayEnabled;
    await updateState({ autoplayEnabled: nextEnabled });
    notifyPlayer(`Autoplay: ${nextEnabled ? "on" : "off"}`, "info");
  }

  function togglePlayPause() {
    if (playing) {
      setPauseSignal((value) => value + 1);
      setPlaying(false);
    } else {
      setMiniDismissedState(false);
      requestPlayback(currentVideoId);
    }
  }

  function closeMiniPlayer() {
    setPauseSignal((value) => value + 1);
    setPlayTargetVideoId(null);
    setPlaying(false);
    setProfileContext(null);
    profileContextPreferenceRef.current = null;
    setMiniDismissedState(true);
    setData((current) =>
      current
        ? {
            ...current,
            state: {
              ...current.state,
              playbackSourceType: "library",
              currentQueueItemId: null,
              currentPlaylistId: null,
              currentPlaylistItemId: null,
              currentYoutubeVideoId: null,
              updatedAt: new Date().toISOString()
            },
            currentItem: null
          }
        : current
    );
    void api
      .invoke("hololive:player:state:update", {
        playbackSourceType: "library",
        currentQueueItemId: null,
        currentPlaylistId: null,
        currentPlaylistItemId: null,
        currentYoutubeVideoId: null
      })
      .then((next) => {
        setData((current) => {
          if (current?.state.currentYoutubeVideoId) {
            return current;
          }

          return next;
        });
      })
      .catch((error: unknown) => {
        console.error(error);
        notifyPlayer("Could not clear the mini player", "error", error instanceof Error ? error.message : "Try again.");
      });
  }

  useEffect(() => {
    let cancelled = false;

    async function loadInitialData() {
      try {
        const next = await api.invoke("hololive:player:data", null);
        if (!cancelled) {
          setData(next);
        }
      } catch (error) {
        console.error(error);
        if (!cancelled) {
          notifyPlayer("Could not load Hololive player", "error", error instanceof Error ? error.message : "Try again.");
        }
      }
    }

    void loadInitialData();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadMiniBounds() {
      try {
        const settings = await api.invoke("settings:get", null);
        const parsed =
          parseMiniPlayerBounds(settings[MINI_PLAYER_BOUNDS_SETTING_KEY]) ??
          parseMiniPlayerBounds(settings[LEGACY_MINI_PLAYER_POSITION_SETTING_KEY]);
        if (!cancelled && parsed) {
          setMiniBounds(parsed);
        }
        if (!cancelled) {
          setMiniDismissed(settings[MINI_PLAYER_DISMISSED_SETTING_KEY] !== "false");
        }
      } catch (error) {
        console.error("Failed to load mini player bounds", error);
      }
    }

    void loadMiniBounds();

    function handleResize() {
      setMiniBounds((current) => clampMiniPlayerBounds(current));
    }

    window.addEventListener("resize", handleResize);
    return () => {
      cancelled = true;
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  useEffect(() => {
    if (!currentVideoId) {
      setProfileContext(null);
      profileContextPreferenceRef.current = null;
      return;
    }

    if (profileContext?.youtubeVideoId === currentVideoId) {
      return;
    }

    void resolveProfileContext(currentVideoId);
  }, [currentVideoId]);

  function requestPlayback(videoId: string | null | undefined) {
    setPlayTargetVideoId(videoId ?? null);
    handledEndedPlaybackTokenRef.current = null;
    setPlaySignal((value) => value + 1);
  }

  function updateMiniBounds(bounds: MiniPlayerBounds, options: { persist?: boolean; snap?: boolean } = {}) {
    const next = options.snap ? snapMiniPlayerBounds(bounds) : clampMiniPlayerBounds(bounds);
    setMiniBounds(next);

    if (options.persist) {
      void api.invoke("settings:set", {
        key: MINI_PLAYER_BOUNDS_SETTING_KEY,
        value: JSON.stringify(next)
      });
    }
  }

  const value = useMemo<HololivePlayerContextValue>(
    () => ({
      data,
      queue,
      state,
      activePlaylist,
      activeItems,
      currentItem,
      currentVideoId,
      currentIndex,
      playableCount,
      profileContext,
      playing,
      loadPlayerData,
      applyPlayerData,
      updateState,
      playQueueItem,
      loadQueueItem,
      playPlaylistItem,
      playVideoNow,
      queueVideo,
      playVisibleVideos,
      playNext,
      togglePlayPause
    }),
    [
      activeItems,
      activePlaylist,
      currentIndex,
      currentItem,
      currentVideoId,
      data,
      playableCount,
      profileContext,
      playing,
      queue,
      state
    ]
  );

  return (
    <HololivePlayerContext.Provider value={value}>
      {children}
      <HololivePersistentPlayerSurface
        currentVideoId={currentVideoId}
        currentItem={currentItem}
        profileContext={profileContext}
        playlists={userPlaylists}
        marker={currentMarker}
        playing={playing}
        playSignal={playSignal}
        playTargetVideoId={playTargetVideoId}
        pauseSignal={pauseSignal}
        onPlayingChange={setPlaying}
        onEnded={(mode) => void handleEnded(mode)}
        onError={(errorCode, mode) => void handlePlayerError(errorCode, mode)}
        onTogglePlayPause={togglePlayPause}
        onNext={() => void playProfileContextNext()}
        canNext={canPlayProfileNext}
        autoplayEnabled={state?.autoplayEnabled ?? false}
        onToggleAutoplay={() => void toggleMiniAutoplay()}
        onAddToPlaylist={addCurrentVideoToPlaylist}
        onSetMarker={setCurrentVideoMarker}
        onExclude={excludeCurrentVideo}
        onViewInShelf={viewCurrentVideoInShelf}
        onClose={closeMiniPlayer}
        miniDismissed={miniDismissed}
        miniBounds={miniBounds}
        onMiniBoundsChange={updateMiniBounds}
      />
    </HololivePlayerContext.Provider>
  );
}

export function useHololivePlayer() {
  const context = useContext(HololivePlayerContext);
  if (!context) {
    throw new Error("useHololivePlayer must be used inside HololivePlayerProvider.");
  }

  return context;
}
