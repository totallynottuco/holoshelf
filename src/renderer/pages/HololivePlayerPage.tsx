import { useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  GripVertical,
  ListMusic,
  ListPlus,
  Pause,
  Pencil,
  Play,
  Plus,
  Repeat,
  Repeat1,
  Save,
  Search,
  Shuffle,
  SkipBack,
  SkipForward,
  Trash2,
  X
} from "lucide-react";
import type {
  HololiveIdol,
  HololiveMusicLibraryResponse,
  HololiveMusicMarker,
  HololiveMusicPlayerData,
  HololiveMusicResolvedItem,
  HololiveMusicRow,
  HololiveMusicTopic
} from "../../shared/contracts";
import type { HololiveMusicLibraryCollabScope, HololiveMusicLibrarySort } from "../../shared/ipc";
import { getHololiveCanonicalTalentIdentity, getHololiveCanonicalTalentId } from "../../shared/hololiveTalentIdentity";
import { api } from "../api";
import { CompactSelect } from "../components/CompactSelect";
import { useHololiveActionToast } from "../components/HololiveActionToast";
import { MusicMarkerIcon, musicMarkerLabel } from "../components/HololiveMusicMarker";
import { HololiveMusicMarkerMenu } from "../components/HololiveMusicMarkerMenu";
import {
  hololiveMusicMetaParts as musicMetaParts,
  hololiveMusicRowTitle as songTitle,
  hololiveResolvedItemMeta as itemMeta,
  hololiveResolvedItemTitle
} from "../components/HololiveMusicText";
import { HololivePlaylistMenu } from "../components/HololivePlaylistMenu";
import { HololiveViewSwitch } from "../components/HololiveViewSwitch";
import { useDismissableLayer } from "../lib/useDismissableLayer";
import { useHololivePlayer } from "../player/HololivePlayerContext";

const LIBRARY_PAGE_SIZE_OPTIONS = [25, 50, 100] as const;
const LIBRARY_SORT_OPTIONS: Array<{ value: HololiveMusicLibrarySort; label: string }> = [
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
  { value: "views_desc", label: "Most views" },
  { value: "views_asc", label: "Least views" }
];
const LIBRARY_SCOPE_OPTIONS: Array<{ value: HololiveMusicLibraryCollabScope; label: string }> = [
  { value: "all", label: "All songs" },
  { value: "solo", label: "Solo" }
];
const PLAYER_LIBRARY_TOPIC_SETTING_KEY = "hololive.player.libraryTopicId";
const PLAYER_LIBRARY_SORT_SETTING_KEY = "hololive.player.librarySort";
const PLAYER_LIBRARY_PAGE_SIZE_SETTING_KEY = "hololive.player.libraryPageSize";
const PLAYER_LIBRARY_TALENT_SETTING_KEY = "hololive.player.libraryTalentId";
const PLAYER_LIBRARY_SCOPE_SETTING_KEY = "hololive.player.libraryCollabScope";
const PLAYER_SELECTED_PLAYLIST_SETTING_KEY = "hololive.player.selectedPlaylistId";

function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function itemTitle(item: HololiveMusicResolvedItem): string {
  return hololiveResolvedItemTitle(item, "Unavailable song");
}

export function HololivePlayerPage() {
  const {
    data,
    queue,
    state,
    currentItem,
    currentVideoId,
    playableCount,
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
  } = useHololivePlayer();
  const { showToast, showUndoToast } = useHololiveActionToast();
  const [library, setLibrary] = useState<HololiveMusicLibraryResponse | null>(null);
  const [talents, setTalents] = useState<HololiveIdol[]>([]);
  const [query, setQuery] = useState("");
  const [topicId, setTopicId] = useState<HololiveMusicTopic | "all">("all");
  const [librarySort, setLibrarySort] = useState<HololiveMusicLibrarySort>("newest");
  const [libraryTalentId, setLibraryTalentId] = useState<string>("all");
  const [libraryCollabScope, setLibraryCollabScope] = useState<HololiveMusicLibraryCollabScope>("all");
  const [talentFilterOpen, setTalentFilterOpen] = useState(false);
  const [talentFilterQuery, setTalentFilterQuery] = useState("");
  const [libraryPage, setLibraryPage] = useState(0);
  const [libraryPageSize, setLibraryPageSize] = useState<number>(50);
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null);
  const [expandedPlaylistId, setExpandedPlaylistId] = useState<string | null>(null);
  const [creatingPlaylist, setCreatingPlaylist] = useState(false);
  const [playlistNameDraft, setPlaylistNameDraft] = useState("");
  const [renamingPlaylistId, setRenamingPlaylistId] = useState<string | null>(null);
  const [playlistRenameDraft, setPlaylistRenameDraft] = useState("");
  const [savingQueue, setSavingQueue] = useState(false);
  const [queueNameDraft, setQueueNameDraft] = useState("New playlist");
  const [openMarkerVideoId, setOpenMarkerVideoId] = useState<string | null>(null);
  const [pendingMarkerVideoId, setPendingMarkerVideoId] = useState<string | null>(null);
  const [openPlaylistVideoId, setOpenPlaylistVideoId] = useState<string | null>(null);
  const [pendingPlaylistVideoId, setPendingPlaylistVideoId] = useState<string | null>(null);
  const [playerMarkerOpen, setPlayerMarkerOpen] = useState(false);
  const [playerPlaylistOpen, setPlayerPlaylistOpen] = useState(false);
  const [playerConfirmExclude, setPlayerConfirmExclude] = useState(false);
  const [pendingPlayerAction, setPendingPlayerAction] = useState<"marker" | "playlist" | null>(null);
  const [bulkPlaylistOpen, setBulkPlaylistOpen] = useState(false);
  const [bulkActionPending, setBulkActionPending] = useState<"play" | "queue" | "playlist" | null>(null);
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const [libraryRefreshVersion, setLibraryRefreshVersion] = useState(0);
  const libraryRequestIdRef = useRef(0);
  const playerPlaylistMenuRef = useRef<HTMLSpanElement | null>(null);
  const playerMarkerMenuRef = useRef<HTMLSpanElement | null>(null);
  const talentFilterRef = useRef<HTMLDivElement | null>(null);
  const bulkActionsRef = useRef<HTMLDivElement | null>(null);

  useDismissableLayer({
    enabled: playerPlaylistOpen,
    ref: playerPlaylistMenuRef,
    onDismiss: () => setPlayerPlaylistOpen(false)
  });

  useDismissableLayer({
    enabled: playerMarkerOpen,
    ref: playerMarkerMenuRef,
    onDismiss: () => {
      setPlayerMarkerOpen(false);
      setPlayerConfirmExclude(false);
    }
  });

  useDismissableLayer({
    enabled: talentFilterOpen,
    ref: talentFilterRef,
    onDismiss: () => {
      setTalentFilterOpen(false);
      setTalentFilterQuery("");
    }
  });

  useDismissableLayer({
    enabled: bulkPlaylistOpen,
    ref: bulkActionsRef,
    onDismiss: () => setBulkPlaylistOpen(false)
  });

  useEffect(() => {
    let cancelled = false;

    void loadPlayerData();
    void api
      .invoke("hololive:tier-data", null)
      .then((next) => {
        if (!cancelled) {
          setTalents(next.idols);
        }
      })
      .catch((error: unknown) => {
        console.error(error);
      });
    void api
      .invoke("settings:get", null)
      .then((settings) => {
        if (cancelled) {
          return;
        }
        const topic = settings[PLAYER_LIBRARY_TOPIC_SETTING_KEY];
        if (topic === "Original_Song" || topic === "Music_Cover" || topic === "all") {
          setTopicId(topic);
        }
        const sort = settings[PLAYER_LIBRARY_SORT_SETTING_KEY];
        if (sort === "newest" || sort === "oldest" || sort === "views_desc" || sort === "views_asc") {
          setLibrarySort(sort);
        }
        const pageSize = Number(settings[PLAYER_LIBRARY_PAGE_SIZE_SETTING_KEY]);
        if (LIBRARY_PAGE_SIZE_OPTIONS.includes(pageSize as (typeof LIBRARY_PAGE_SIZE_OPTIONS)[number])) {
          setLibraryPageSize(pageSize);
        }
        setLibraryTalentId(settings[PLAYER_LIBRARY_TALENT_SETTING_KEY] ? getHololiveCanonicalTalentId(settings[PLAYER_LIBRARY_TALENT_SETTING_KEY]) : "all");
        const scope = settings[PLAYER_LIBRARY_SCOPE_SETTING_KEY];
        if (scope === "all" || scope === "solo") {
          setLibraryCollabScope(scope);
        }
        setSelectedPlaylistId(settings[PLAYER_SELECTED_PLAYLIST_SETTING_KEY] || null);
      })
      .catch((error: unknown) => {
        console.error(error);
      })
      .finally(() => {
        if (!cancelled) {
          setPreferencesLoaded(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  function savePlayerPreference(key: string, value: string) {
    void api.invoke("settings:set", { key, value }).catch((error: unknown) => {
      console.error("Failed to save Player preference", error);
    });
  }

  useEffect(() => {
    if (!preferencesLoaded) {
      return;
    }

    savePlayerPreference(PLAYER_LIBRARY_TOPIC_SETTING_KEY, topicId);
  }, [preferencesLoaded, topicId]);

  useEffect(() => {
    if (!preferencesLoaded) {
      return;
    }

    savePlayerPreference(PLAYER_LIBRARY_SORT_SETTING_KEY, librarySort);
  }, [preferencesLoaded, librarySort]);

  useEffect(() => {
    if (!preferencesLoaded) {
      return;
    }

    savePlayerPreference(PLAYER_LIBRARY_PAGE_SIZE_SETTING_KEY, String(libraryPageSize));
  }, [preferencesLoaded, libraryPageSize]);

  useEffect(() => {
    if (!preferencesLoaded) {
      return;
    }

    savePlayerPreference(PLAYER_LIBRARY_TALENT_SETTING_KEY, libraryTalentId);
  }, [preferencesLoaded, libraryTalentId]);

  useEffect(() => {
    if (!preferencesLoaded) {
      return;
    }

    savePlayerPreference(PLAYER_LIBRARY_SCOPE_SETTING_KEY, libraryCollabScope);
  }, [preferencesLoaded, libraryCollabScope]);

  useEffect(() => {
    if (!preferencesLoaded || !data) {
      return;
    }

    savePlayerPreference(PLAYER_SELECTED_PLAYLIST_SETTING_KEY, selectedPlaylistId ?? "");
  }, [data, preferencesLoaded, selectedPlaylistId]);

  useEffect(() => {
    const requestId = libraryRequestIdRef.current + 1;
    libraryRequestIdRef.current = requestId;
    const timer = window.setTimeout(() => {
      void api
        .invoke("hololive:music:library", {
          query,
          topicId: topicId === "all" ? null : topicId,
          sort: librarySort,
          talentId: libraryTalentId === "all" ? null : libraryTalentId,
          collabScope: libraryCollabScope === "all" ? null : libraryCollabScope,
          limit: libraryPageSize,
          offset: libraryPage * libraryPageSize
        })
        .then((next) => {
          if (libraryRequestIdRef.current === requestId) {
            setLibrary(next);
          }
        })
        .catch((error: unknown) => {
          if (libraryRequestIdRef.current === requestId) {
            showToast({
              message: "Could not load music library",
              detail: error instanceof Error ? error.message : "Try again.",
              tone: "error"
            });
          }
        });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [libraryCollabScope, libraryPage, libraryPageSize, libraryRefreshVersion, librarySort, libraryTalentId, query, topicId]);

  useEffect(() => {
    if (!library || library.total === 0 || library.offset < library.total) {
      return;
    }
    setLibraryPage(Math.max(Math.ceil(library.total / library.limit) - 1, 0));
  }, [library]);

  useEffect(() => {
    if (!library) {
      return;
    }

    const visibleVideoIds = new Set(library.rows.map((row) => row.youtubeVideoId));
    if (openMarkerVideoId && !visibleVideoIds.has(openMarkerVideoId)) {
      setOpenMarkerVideoId(null);
    }
    if (openPlaylistVideoId && !visibleVideoIds.has(openPlaylistVideoId)) {
      setOpenPlaylistVideoId(null);
    }
  }, [library, openMarkerVideoId, openPlaylistVideoId]);

  useEffect(() => {
    function handleMusicExcluded(event: Event) {
      const detail = (event as CustomEvent<{ youtubeVideoId?: string }>).detail;
      if (!detail?.youtubeVideoId) {
        return;
      }

      setLibrary((current) =>
        current
          ? {
              ...current,
              total: Math.max(current.total - (current.rows.some((row) => row.youtubeVideoId === detail.youtubeVideoId) ? 1 : 0), 0),
              rows: current.rows.filter((row) => row.youtubeVideoId !== detail.youtubeVideoId)
            }
          : current
      );
      setOpenMarkerVideoId((current) => (current === detail.youtubeVideoId ? null : current));
      setOpenPlaylistVideoId((current) => (current === detail.youtubeVideoId ? null : current));
      setPlayerMarkerOpen(false);
      setPlayerConfirmExclude(false);
    }

    window.addEventListener("hololive-music-excluded", handleMusicExcluded);
    return () => window.removeEventListener("hololive-music-excluded", handleMusicExcluded);
  }, []);

  const selectedPlaylist = data?.playlists.find((playlist) => playlist.id === selectedPlaylistId) ?? data?.playlists[0] ?? null;
  const userPlaylists = useMemo(() => (data?.playlists ?? []).filter((playlist) => !playlist.systemId), [data?.playlists]);
  const talentOptions = useMemo(
    () => {
      const options = [{ value: "all", label: "All talents" }];
      const seen = new Set(options.map((option) => option.value));
      for (const talent of talents
        .slice()
        .sort((left, right) => left.sortOrder - right.sortOrder || left.displayName.localeCompare(right.displayName))) {
        const identity = getHololiveCanonicalTalentIdentity(talent.id, talent.displayName);
        if (!seen.has(identity.id)) {
          seen.add(identity.id);
          options.push({ value: identity.id, label: identity.name });
        }
      }
      return options;
    },
    [talents]
  );
  const selectedTalentLabel = talentOptions.find((option) => option.value === libraryTalentId)?.label ?? "All talents";
  const filteredTalentOptions = useMemo(() => {
    const normalizedQuery = talentFilterQuery.trim().toLowerCase();
    if (!normalizedQuery) {
      return talentOptions;
    }
    return talentOptions.filter((option) => option.label.toLowerCase().includes(normalizedQuery));
  }, [talentFilterQuery, talentOptions]);
  const libraryTotal = library?.total ?? 0;
  const libraryPageCount = Math.max(Math.ceil(libraryTotal / libraryPageSize), 1);
  const libraryPageStart = libraryTotal === 0 ? 0 : libraryPage * libraryPageSize + 1;
  const libraryPageEnd = library ? Math.min(library.offset + library.rows.length, library.total) : 0;
  const visibleLibraryRows = library?.rows ?? [];
  const visibleLibraryVideoIds = visibleLibraryRows.map((row) => row.youtubeVideoId);
  const visibleLibraryCount = visibleLibraryRows.length;

  useEffect(() => {
    if (!data) {
      return;
    }

    setExpandedPlaylistId((current) => (current && data.playlists.some((playlist) => playlist.id === current) ? current : null));
    setSelectedPlaylistId((current) => {
      if (current && data.playlists.some((playlist) => playlist.id === current)) {
        return current;
      }
      return data.playlists[0]?.id ?? null;
    });
  }, [data]);

  useEffect(() => {
    if (libraryTalentId === "all" || talents.length === 0) {
      return;
    }
    if (!talentOptions.some((talent) => talent.value === libraryTalentId)) {
      setLibraryTalentId("all");
      setLibraryPage(0);
    }
  }, [libraryTalentId, talentOptions]);

  function togglePlaylist(playlistId: string) {
    setSelectedPlaylistId(playlistId);
    setExpandedPlaylistId((current) => (current === playlistId ? null : playlistId));
  }

  function refreshLibrary() {
    setLibraryRefreshVersion((version) => version + 1);
  }

  function selectLibraryTalent(value: string) {
    setLibraryTalentId(value);
    setLibraryPage(0);
    setTalentFilterOpen(false);
    setTalentFilterQuery("");
  }

  function showPlayerUndoToast(
    response: { undoToken?: string | null; undoLabel?: string | null },
    message: string
  ) {
    if (!response.undoToken) {
      return;
    }

    showUndoToast({
      message,
      undoToken: response.undoToken,
      undoLabel: response.undoLabel,
      onApplied: async () => {
        await loadPlayerData();
        refreshLibrary();
      }
    });
  }

  async function playLibrarySong(row: HololiveMusicRow) {
    await playVideoNow(row.youtubeVideoId);
  }

  async function addToQueue(row: HololiveMusicRow, placement: "now" | "next" | "end") {
    await queueVideo(row.youtubeVideoId, placement);
  }

  async function playVisibleLibrarySongs() {
    if (visibleLibraryVideoIds.length === 0) {
      return;
    }

    setBulkActionPending("play");
    try {
      await playVisibleVideos(visibleLibraryVideoIds);
    } finally {
      setBulkActionPending((current) => (current === "play" ? null : current));
    }
  }

  async function queueVisibleLibrarySongs() {
    if (visibleLibraryVideoIds.length === 0) {
      return;
    }

    setBulkActionPending("queue");
    await applyPlayerData(
      () =>
        api.invoke("hololive:player:queue:bulk-add", {
          youtubeVideoIds: visibleLibraryVideoIds,
          placement: "end"
        }),
      `Queued ${visibleLibraryCount} visible songs`
    );
    setBulkActionPending((current) => (current === "queue" ? null : current));
  }

  async function addVisibleSongsToPlaylist(playlistId: string) {
    if (visibleLibraryVideoIds.length === 0) {
      return;
    }

    const playlist = userPlaylists.find((candidate) => candidate.id === playlistId);
    setBulkActionPending("playlist");
    try {
      await applyPlayerData(
        () =>
          api.invoke("hololive:player:playlist-items:add", {
            playlistId,
            youtubeVideoIds: visibleLibraryVideoIds
          }),
        playlist ? `Added visible songs to ${playlist.name}` : "Playlist updated"
      );
      setBulkPlaylistOpen(false);
    } finally {
      setBulkActionPending((current) => (current === "playlist" ? null : current));
    }
  }

  async function setLibraryMarker(row: HololiveMusicRow, marker: HololiveMusicMarker | null) {
    setPendingMarkerVideoId(row.youtubeVideoId);
    const favoritesPlaylistMayChange = row.marker === "favorite" || marker === "favorite";
    try {
      const response = await api.invoke("hololive:music-marker:set", {
        youtubeVideoId: row.youtubeVideoId,
        marker
      });
      setLibrary((current) =>
        current
          ? {
              ...current,
              rows: current.rows.map((candidate) =>
                candidate.youtubeVideoId === response.youtubeVideoId ||
                (response.markerKey && candidate.markerKey === response.markerKey)
                  ? { ...candidate, marker: response.marker }
                  : candidate
              )
            }
            : current
      );
      if (favoritesPlaylistMayChange) {
        await loadPlayerData();
      }
      setOpenMarkerVideoId(null);
    } catch (error) {
      console.error(error);
      showToast({
        message: "Marker update failed",
        detail: error instanceof Error ? error.message : "Try again.",
        tone: "error"
      });
    } finally {
      setPendingMarkerVideoId((current) => (current === row.youtubeVideoId ? null : current));
    }
  }

  async function excludeLibrarySong(row: HololiveMusicRow) {
    setPendingMarkerVideoId(row.youtubeVideoId);
    try {
      const response = await api.invoke("hololive:music:exclude", {
        youtubeVideoId: row.youtubeVideoId,
        title: songTitle(row),
        sourceUrl: row.youtubeUrl
      });
      window.dispatchEvent(
        new CustomEvent("hololive-music-excluded", {
          detail: response.data
        })
      );
      await loadPlayerData();
      setOpenMarkerVideoId(null);
      showPlayerUndoToast(response, "Song excluded");
    } catch (error) {
      console.error(error);
      showToast({
        message: "Exclude failed",
        detail: error instanceof Error ? error.message : "Try again.",
        tone: "error"
      });
    } finally {
      setPendingMarkerVideoId((current) => (current === row.youtubeVideoId ? null : current));
    }
  }

  async function addSongToPlaylist(row: HololiveMusicRow, playlistId: string) {
    const playlist = userPlaylists.find((candidate) => candidate.id === playlistId);
    const alreadyInPlaylist = Boolean(playlist?.items?.some((item) => item.youtubeVideoId === row.youtubeVideoId));
    setPendingPlaylistVideoId(row.youtubeVideoId);
    try {
      await applyPlayerData(
        () =>
          api.invoke("hololive:player:playlist-item:add", {
            playlistId,
            youtubeVideoId: row.youtubeVideoId
          }),
        playlist
          ? alreadyInPlaylist
            ? `Removed from ${playlist.name}`
            : `Added to ${playlist.name}`
          : "Playlist updated"
      );
      setOpenPlaylistVideoId(null);
    } finally {
      setPendingPlaylistVideoId((current) => (current === row.youtubeVideoId ? null : current));
    }
  }

  async function addCurrentSongToPlaylist(playlistId: string) {
    if (!currentVideoId) {
      return;
    }

    const playlist = userPlaylists.find((candidate) => candidate.id === playlistId);
    const alreadyInPlaylist = Boolean(playlist?.items?.some((item) => item.youtubeVideoId === currentVideoId));
    setPendingPlayerAction("playlist");
    try {
      await applyPlayerData(
        () =>
          api.invoke("hololive:player:playlist-item:add", {
            playlistId,
            youtubeVideoId: currentVideoId
          }),
        playlist
          ? alreadyInPlaylist
            ? `Removed from ${playlist.name}`
            : `Added to ${playlist.name}`
          : "Playlist updated"
      );
      setPlayerPlaylistOpen(false);
    } finally {
      setPendingPlayerAction((current) => (current === "playlist" ? null : current));
    }
  }

  async function addResolvedItemToPlaylist(item: HololiveMusicResolvedItem, playlistId: string) {
    const playlist = userPlaylists.find((candidate) => candidate.id === playlistId);
    const alreadyInPlaylist = Boolean(playlist?.items?.some((playlistItem) => playlistItem.youtubeVideoId === item.youtubeVideoId));
    await applyPlayerData(
      () =>
        api.invoke("hololive:player:playlist-item:add", {
          playlistId,
          youtubeVideoId: item.youtubeVideoId
        }),
      playlist
        ? alreadyInPlaylist
          ? `Removed from ${playlist.name}`
          : `Added to ${playlist.name}`
        : "Playlist updated"
    );
  }

  async function setCurrentSongMarker(marker: HololiveMusicMarker | null) {
    if (!currentVideoId) {
      return;
    }

    setPendingPlayerAction("marker");
    try {
      const response = await api.invoke("hololive:music-marker:set", {
        youtubeVideoId: currentVideoId,
        marker
      });
      setLibrary((current) =>
        current
          ? {
              ...current,
              rows: current.rows.map((candidate) =>
                candidate.youtubeVideoId === response.youtubeVideoId ||
                (response.markerKey && candidate.markerKey === response.markerKey)
                  ? { ...candidate, marker: response.marker }
                  : candidate
              )
            }
          : current
      );
      await loadPlayerData();
      showToast({ message: marker ? `${musicMarkerLabel(marker)} saved` : "Marker cleared", tone: "success" });
      setPlayerMarkerOpen(false);
    } catch (error) {
      console.error(error);
      showToast({
        message: "Marker update failed",
        detail: error instanceof Error ? error.message : "Try again.",
        tone: "error"
      });
    } finally {
      setPendingPlayerAction((current) => (current === "marker" ? null : current));
    }
  }

  async function setResolvedItemMarker(item: HololiveMusicResolvedItem, marker: HololiveMusicMarker | null) {
    const response = await api.invoke("hololive:music-marker:set", {
      youtubeVideoId: item.youtubeVideoId,
      marker
    });
    window.dispatchEvent(
      new CustomEvent("hololive-music-marker-updated", {
        detail: response
      })
    );
    setLibrary((current) =>
      current
        ? {
            ...current,
            rows: current.rows.map((candidate) =>
              candidate.youtubeVideoId === response.youtubeVideoId ||
              (response.markerKey && candidate.markerKey === response.markerKey)
                ? { ...candidate, marker: response.marker }
                : candidate
            )
          }
        : current
    );
    await loadPlayerData();
    showToast({ message: marker ? `${musicMarkerLabel(marker)} saved` : "Marker cleared", tone: "success" });
  }

  async function excludeCurrentSong() {
    if (!currentVideoId) {
      return;
    }

    setPendingPlayerAction("marker");
    try {
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
      await loadPlayerData();
      setPlayerMarkerOpen(false);
      setPlayerConfirmExclude(false);
      showPlayerUndoToast(response, "Song excluded");
    } catch (error) {
      console.error(error);
      showToast({
        message: "Exclude failed",
        detail: error instanceof Error ? error.message : "Try again.",
        tone: "error"
      });
    } finally {
      setPendingPlayerAction((current) => (current === "marker" ? null : current));
    }
  }

  async function excludeResolvedItem(item: HololiveMusicResolvedItem) {
    const response = await api.invoke("hololive:music:exclude", {
      youtubeVideoId: item.youtubeVideoId,
      title: itemTitle(item),
      sourceUrl: item.music?.youtubeUrl ?? item.sourceUrlSnapshot ?? null
    });
    window.dispatchEvent(
      new CustomEvent("hololive-music-excluded", {
        detail: response.data
      })
    );
    await loadPlayerData();
    showPlayerUndoToast(response, "Song excluded");
  }

  function startCreatePlaylist() {
    setPlaylistNameDraft(`Playlist ${(data?.playlists.filter((playlist) => !playlist.systemId).length ?? 0) + 1}`);
    setCreatingPlaylist(true);
  }

  async function createPlaylist(name: string) {
    const playlistName = name.trim();
    if (!playlistName) {
      return;
    }
    try {
      const next = await applyPlayerData(
        () => api.invoke("hololive:player:playlist:create", { name: playlistName }),
        "Playlist created"
      );
      if (!next) {
        return;
      }
      const createdPlaylistId = [...next.playlists]
        .reverse()
        .find((playlist) => !playlist.systemId && playlist.name === playlistName)?.id;
      if (createdPlaylistId) {
        setSelectedPlaylistId(createdPlaylistId);
        setExpandedPlaylistId(createdPlaylistId);
      }
      setPlaylistNameDraft("");
      setCreatingPlaylist(false);
    } catch (error) {
      console.error(error);
      showToast({
        message: "Player action failed",
        detail: error instanceof Error ? error.message : "Try again.",
        tone: "error"
      });
    }
  }

  function startRenamePlaylist(playlistId: string, currentName: string) {
    setRenamingPlaylistId(playlistId);
    setPlaylistRenameDraft(currentName);
  }

  function cancelRenamePlaylist() {
    setRenamingPlaylistId(null);
    setPlaylistRenameDraft("");
  }

  async function renamePlaylist(playlistId: string, name: string) {
    const playlistName = name.trim();
    if (!playlistName) {
      return;
    }
    await applyPlayerData(() => api.invoke("hololive:player:playlist:update", { playlistId, name: playlistName }), "Playlist renamed");
    cancelRenamePlaylist();
  }

  async function performDeletePlaylist(playlistId: string) {
    await applyPlayerData(() => api.invoke("hololive:player:playlist:delete", { playlistId }), "Playlist deleted");
    setSelectedPlaylistId(null);
    setExpandedPlaylistId((current) => (current === playlistId ? null : current));
  }

  function deletePlaylist(playlistId: string, name: string) {
    showToast({
      message: `Delete "${name}"?`,
      detail: "This removes the playlist, not the songs.",
      tone: "error",
      actionLabel: "Delete",
      onAction: () => performDeletePlaylist(playlistId)
    });
  }

  async function saveQueue(name: string) {
    const playlistName = name.trim();
    if (!playlistName) {
      return;
    }
    await applyPlayerData(() => api.invoke("hololive:player:queue:save", { name: playlistName }), "Queue saved");
    setQueueNameDraft("New playlist");
    setSavingQueue(false);
  }

  async function reorderQueueItems(itemIds: string[]) {
    await applyPlayerData(() => api.invoke("hololive:player:queue:reorder", { itemIds }));
  }

  async function reorderPlaylistItems(playlistId: string, itemIds: string[]) {
    await applyPlayerData(() =>
      api.invoke("hololive:player:playlist-item:reorder", {
        playlistId,
        itemIds
      })
    );
  }

  async function removeQueueItem(item: HololiveMusicResolvedItem) {
    let undoResponse: { undoToken?: string | null; undoLabel?: string | null } | null = null;
    await applyPlayerData(async () => {
      const response = await api.invoke("hololive:player:queue:remove", { itemId: item.id });
      undoResponse = response;
      return response.data;
    }, "Removed from queue");
    if (undoResponse) {
      showPlayerUndoToast(undoResponse, "Removed from queue");
    }
  }

  async function removePlaylistItem(item: HololiveMusicResolvedItem) {
    let undoResponse: { undoToken?: string | null; undoLabel?: string | null } | null = null;
    await applyPlayerData(async () => {
      const response = await api.invoke("hololive:player:playlist-item:remove", { itemId: item.id });
      undoResponse = response;
      return response.data;
    }, "Removed from playlist");
    if (undoResponse) {
      showPlayerUndoToast(undoResponse, "Removed from playlist");
    }
  }

  const currentMarker = currentItem?.music?.marker ?? null;
  const currentMarkerLabel = musicMarkerLabel(currentMarker);
  const currentTitle = currentItem ? itemTitle(currentItem) : "current song";

  return (
    <section className="hololive-page hololive-player-page hololive-player-layout" aria-label="Hololive YouTube playlist player">
        <HololiveViewSwitch />

        <section className="hololive-player-grid">
          <section className="hololive-player-main" aria-label="YouTube player">
            <div className={`hololive-youtube-frame hololive-youtube-frame-anchor${currentVideoId ? "" : " empty"}`} />

            <div className="hololive-now-playing">
              <span>Now Playing</span>
              <strong title={currentItem ? itemTitle(currentItem) : undefined}>
                {currentItem ? itemTitle(currentItem) : "Nothing selected"}
              </strong>
              <small>{currentItem ? itemMeta(currentItem) : "Pick a song, queue, or playlist."}</small>
            </div>

            <div className="hololive-player-controls" aria-label="Playback controls">
              <button type="button" onClick={() => void playNext(-1)} disabled={playableCount === 0} title="Previous">
                <SkipBack size={15} />
              </button>
              <button
                className="primary"
                type="button"
                onClick={togglePlayPause}
                disabled={!currentVideoId}
                title={playing ? "Pause" : "Play"}
              >
                {playing ? <Pause size={16} /> : <Play size={16} />}
              </button>
              <button type="button" onClick={() => void playNext(1)} disabled={playableCount === 0} title="Next">
                <SkipForward size={15} />
              </button>
              <button
                type="button"
                className={state?.shuffleEnabled ? "active" : ""}
                onClick={() => void updateState({ shuffleEnabled: !state?.shuffleEnabled })}
                title="Shuffle"
              >
                <Shuffle size={15} />
              </button>
              <button
                type="button"
                className={state?.autoplayEnabled ? "active hololive-autoplay-toggle" : "hololive-autoplay-toggle"}
                onClick={() => void updateState({ autoplayEnabled: !state?.autoplayEnabled })}
                title={`Autoplay: ${state?.autoplayEnabled ? "on" : "off"}`}
              >
                <span>Auto</span>
              </button>
              <button
                type="button"
                className={state?.repeatMode !== "off" ? "active" : ""}
                onClick={() => {
                  const next = state?.repeatMode === "off" ? "all" : state?.repeatMode === "all" ? "one" : "off";
                  void updateState({ repeatMode: next });
                }}
                title={`Repeat: ${state?.repeatMode ?? "off"}`}
              >
                {state?.repeatMode === "one" ? <Repeat1 size={15} /> : <Repeat size={15} />}
              </button>
              <span
                className="hololive-player-control-menu"
                ref={playerPlaylistMenuRef}
                onBlur={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget)) {
                    setPlayerPlaylistOpen(false);
                  }
                }}
              >
                <button
                  type="button"
                  disabled={!currentVideoId || userPlaylists.length === 0 || pendingPlayerAction !== null}
                  aria-expanded={playerPlaylistOpen}
                  onClick={() => {
                    setPlayerMarkerOpen(false);
                    setPlayerPlaylistOpen((current) => !current);
                  }}
                  title={userPlaylists.length === 0 ? "Create a playlist first" : "Add current song to playlist"}
                  aria-label={`Add ${currentTitle} to playlist`}
                >
                  <ListMusic size={15} />
                </button>
                {playerPlaylistOpen ? (
                  <HololivePlaylistMenu
                    ariaLabel={`Choose playlist for ${currentTitle}`}
                    className="hololive-library-playlist-popover hololive-player-control-popover"
                    disabled={pendingPlayerAction !== null}
                    playlists={userPlaylists}
                    youtubeVideoId={currentVideoId}
                    onSelect={(playlistId) => void addCurrentSongToPlaylist(playlistId)}
                  />
                ) : null}
              </span>
              <span
                className="hololive-player-control-menu"
                ref={playerMarkerMenuRef}
                onBlur={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget)) {
                    setPlayerMarkerOpen(false);
                    setPlayerConfirmExclude(false);
                  }
                }}
              >
                <button
                  className={`hololive-player-marker-button ${currentMarker ?? "unmarked"}`}
                  type="button"
                  disabled={!currentVideoId || pendingPlayerAction !== null}
                  aria-expanded={playerMarkerOpen}
                  onClick={() => {
                    setPlayerPlaylistOpen(false);
                    setPlayerConfirmExclude(false);
                    setPlayerMarkerOpen((current) => !current);
                  }}
                  title={`${currentMarkerLabel} marker`}
                  aria-label={`${currentMarkerLabel} marker for ${currentTitle}`}
                >
                  <MusicMarkerIcon marker={currentMarker} size={14} />
                </button>
                {playerMarkerOpen ? (
                  <HololiveMusicMarkerMenu
                    ariaLabel={`Set marker for ${currentTitle}`}
                    className="hololive-song-marker-popover hololive-player-control-popover"
                    confirmAriaLabel={`Confirm exclusion for ${currentTitle}`}
                    confirmingExclude={playerConfirmExclude}
                    disabled={pendingPlayerAction !== null}
                    marker={currentMarker}
                    onConfirmingExcludeChange={setPlayerConfirmExclude}
                    onExclude={() => void excludeCurrentSong()}
                    onSetMarker={(marker) => void setCurrentSongMarker(marker)}
                  />
                ) : null}
              </span>
              <button
                type="button"
                onClick={() => {
                  setSavingQueue((current) => !current);
                  setQueueNameDraft("New playlist");
                }}
                disabled={queue.length === 0}
                title="Save queue"
              >
                <Save size={15} />
              </button>
            </div>
            {savingQueue ? (
              <form
                className="hololive-playlist-create-row hololive-queue-save-row"
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveQueue(queueNameDraft);
                }}
              >
                <input
                  aria-label="Saved queue playlist name"
                  value={queueNameDraft}
                  autoFocus
                  onChange={(event) => setQueueNameDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      setSavingQueue(false);
                      setQueueNameDraft("New playlist");
                    }
                  }}
                />
                <button type="submit" disabled={!queueNameDraft.trim()} title="Save queue as playlist">
                  <Save size={12} />
                </button>
                <button
                  type="button"
                  title="Cancel queue save"
                  onClick={() => {
                    setSavingQueue(false);
                    setQueueNameDraft("New playlist");
                  }}
                >
                  <X size={12} />
                </button>
              </form>
            ) : null}
          </section>

          <section className="hololive-player-panel hololive-queue-panel" aria-label="Active queue">
            <div className="hololive-player-panel-head">
              <span>Queue</span>
              <div className="hololive-player-panel-head-actions">
                <strong>{queue.length}</strong>
                <button
                  type="button"
                  onClick={() => void applyPlayerData(() => api.invoke("hololive:player:queue:clear", null), "Queue cleared")}
                  disabled={queue.length === 0}
                  title="Clear queue"
                  aria-label="Clear queue"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
            <SongItemList
              items={queue}
              currentItemId={state?.playbackSourceType === "queue" ? state.currentQueueItemId : null}
              activeVideoId={currentVideoId}
              emptyText="No queued songs."
              onSelect={(item) => void loadQueueItem(item.id)}
              onPlayNow={(item) => void playQueueItem(item.id)}
              onRemove={(item) => void removeQueueItem(item)}
              onReorder={(itemIds) => void reorderQueueItems(itemIds)}
              playlists={userPlaylists}
              onPlaylistAdd={(item, playlistId) => void addResolvedItemToPlaylist(item, playlistId)}
              onMarkerChange={(item, marker) => void setResolvedItemMarker(item, marker)}
              onExclude={(item) => void excludeResolvedItem(item)}
            />
          </section>

          <section className="hololive-player-panel hololive-playlist-panel" aria-label="Saved playlists">
            <div className="hololive-player-panel-head">
              <span>Playlists</span>
              <button type="button" onClick={startCreatePlaylist} title="Create playlist">
                <Plus size={14} />
              </button>
            </div>
            <div className="hololive-playlist-stack">
              {creatingPlaylist ? (
                <form
                  className="hololive-playlist-create-row"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void createPlaylist(playlistNameDraft);
                  }}
                >
                  <input
                    aria-label="New playlist name"
                    value={playlistNameDraft}
                    autoFocus
                    onChange={(event) => setPlaylistNameDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        setCreatingPlaylist(false);
                        setPlaylistNameDraft("");
                      }
                    }}
                  />
                  <button type="submit" disabled={!playlistNameDraft.trim()} title="Create new playlist">
                    <Plus size={12} />
                  </button>
                  <button
                    type="button"
                    title="Cancel playlist creation"
                    onClick={() => {
                      setCreatingPlaylist(false);
                      setPlaylistNameDraft("");
                    }}
                  >
                    <X size={12} />
                  </button>
                </form>
              ) : null}
              {(data?.playlists ?? []).map((playlist) => {
                const isSelected = playlist.id === selectedPlaylist?.id;
                const isExpanded = playlist.id === expandedPlaylistId;
                const isSystem = Boolean(playlist.systemId);

                return (
                  <div
                    key={playlist.id}
                    className={[
                      "hololive-playlist-entry",
                      isSelected ? "active" : "",
                      isExpanded ? "expanded" : ""
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    <div className="hololive-playlist-row">
                      {renamingPlaylistId === playlist.id ? (
                        <form
                          className="hololive-playlist-toggle hololive-playlist-rename-form"
                          onSubmit={(event) => {
                            event.preventDefault();
                            void renamePlaylist(playlist.id, playlistRenameDraft);
                          }}
                        >
                          {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                          <input
                            aria-label={`Rename ${playlist.name}`}
                            value={playlistRenameDraft}
                            autoFocus
                            onChange={(event) => setPlaylistRenameDraft(event.target.value)}
                            onBlur={() => cancelRenamePlaylist()}
                            onKeyDown={(event) => {
                              if (event.key === "Escape") {
                                event.preventDefault();
                                cancelRenamePlaylist();
                              }
                            }}
                          />
                          <strong>{playlist.itemCount}</strong>
                        </form>
                      ) : (
                        <button
                          type="button"
                          className="hololive-playlist-toggle"
                          onClick={() => togglePlaylist(playlist.id)}
                          onDoubleClick={(event) => {
                            event.stopPropagation();
                            if (!isSystem) {
                              startRenamePlaylist(playlist.id, playlist.name);
                            }
                          }}
                          aria-expanded={isExpanded}
                          title={isSystem ? `${playlist.name} - auto-managed from favorite markers` : `${playlist.name} - double-click to rename`}
                        >
                          {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                          <span>{playlist.name}</span>
                          <strong>{playlist.itemCount}</strong>
                        </button>
                      )}
                      <div className="hololive-playlist-row-actions">
                        <button
                          type="button"
                          onClick={() =>
                            void playPlaylistItem(playlist.id)
                          }
                          title="Play playlist"
                          aria-label={`Play ${playlist.name}`}
                        >
                          <Play size={12} />
                        </button>
                        {isSystem ? null : (
                          <>
                            <button
                              type="button"
                              onClick={() => startRenamePlaylist(playlist.id, playlist.name)}
                              title="Rename playlist"
                              aria-label={`Rename ${playlist.name}`}
                            >
                              <Pencil size={12} />
                            </button>
                            <button
                              type="button"
                              className="danger"
                              onClick={() => void deletePlaylist(playlist.id, playlist.name)}
                              title="Delete playlist"
                              aria-label={`Delete ${playlist.name}`}
                            >
                              <Trash2 size={12} />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                    {isExpanded ? (
                      <div className="hololive-playlist-body">
                        <SongItemList
                          items={playlist.items ?? []}
                          emptyText="This playlist is empty."
                          currentItemId={state?.playbackSourceType === "playlist" && state.currentPlaylistId === playlist.id ? state.currentPlaylistItemId : null}
                          activeVideoId={currentVideoId}
                          onSelect={(item) => void playPlaylistItem(playlist.id, item.id, false)}
                          onPlayNow={(item) => void playPlaylistItem(playlist.id, item.id)}
                          onRemove={(item) => void removePlaylistItem(item)}
                          onReorder={(itemIds) => void reorderPlaylistItems(playlist.id, itemIds)}
                          canRemove={!isSystem}
                          playlists={userPlaylists}
                          onPlaylistAdd={(item, playlistId) => void addResolvedItemToPlaylist(item, playlistId)}
                          onMarkerChange={(item, marker) => void setResolvedItemMarker(item, marker)}
                          onExclude={(item) => void excludeResolvedItem(item)}
                        />
                      </div>
                    ) : null}
                  </div>
                );
              })}
              {data?.playlists.length === 0 ? <p>No saved playlists.</p> : null}
            </div>
          </section>

          <section className="hololive-player-panel hololive-library-panel" aria-label="Music library">
            <div className="hololive-library-tools">
              <label className="hololive-library-search">
                <Search size={14} />
                <input
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setLibraryPage(0);
                  }}
                  placeholder="Search songs"
                />
              </label>
              <CompactSelect<HololiveMusicTopic | "all">
                className="hololive-select-wrap hololive-topic-select"
                ariaLabel="Song type"
                value={topicId}
                options={[
                  { value: "all", label: "All" },
                  { value: "Original_Song", label: "Originals" },
                  { value: "Music_Cover", label: "Covers" }
                ]}
                onChange={(value) => {
                  setTopicId(value);
                  setLibraryPage(0);
                }}
              />
              <CompactSelect<HololiveMusicLibrarySort>
                className="hololive-select-wrap hololive-sort-select"
                ariaLabel="Sort songs"
                value={librarySort}
                options={LIBRARY_SORT_OPTIONS}
                onChange={(value) => {
                  setLibrarySort(value);
                  setLibraryPage(0);
                }}
              />
              <div
                className={["hololive-talent-filter", talentFilterOpen ? "open" : ""].filter(Boolean).join(" ")}
                ref={talentFilterRef}
                onBlur={(event) => {
                  const nextFocus = event.relatedTarget;
                  if (!(nextFocus instanceof Node) || !event.currentTarget.contains(nextFocus)) {
                    setTalentFilterOpen(false);
                    setTalentFilterQuery("");
                  }
                }}
              >
                <input
                  role="combobox"
                  aria-label="Talent"
                  aria-expanded={talentFilterOpen}
                  aria-controls="hololive-player-talent-filter-listbox"
                  aria-autocomplete="list"
                  value={talentFilterOpen ? talentFilterQuery : selectedTalentLabel}
                  placeholder={selectedTalentLabel}
                  onFocus={() => {
                    setTalentFilterOpen(true);
                    setTalentFilterQuery("");
                  }}
                  onChange={(event) => {
                    setTalentFilterQuery(event.target.value);
                    setTalentFilterOpen(true);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.preventDefault();
                      setTalentFilterOpen(false);
                      setTalentFilterQuery("");
                    } else if (event.key === "Enter") {
                      const nextTalent = filteredTalentOptions[0];
                      if (nextTalent) {
                        event.preventDefault();
                        selectLibraryTalent(nextTalent.value);
                      }
                    }
                  }}
                  className="hololive-talent-filter-input"
                />
                <ChevronDown className="hololive-talent-filter-chevron" size={13} aria-hidden="true" />
                {talentFilterOpen ? (
                  <div id="hololive-player-talent-filter-listbox" className="hololive-talent-filter-menu" role="listbox" aria-label="Talent">
                    {filteredTalentOptions.map((option) => (
                      <button
                        type="button"
                        key={option.value}
                        role="option"
                        aria-selected={option.value === libraryTalentId}
                        className={option.value === libraryTalentId ? "selected" : ""}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => selectLibraryTalent(option.value)}
                      >
                        {option.label}
                      </button>
                    ))}
                    {filteredTalentOptions.length === 0 ? <span className="hololive-talent-filter-empty">No talents found</span> : null}
                  </div>
                ) : null}
              </div>
              <CompactSelect<HololiveMusicLibraryCollabScope>
                className="hololive-select-wrap hololive-scope-select"
                ariaLabel="Collaboration scope"
                value={libraryCollabScope}
                options={LIBRARY_SCOPE_OPTIONS}
                onChange={(value) => {
                  setLibraryCollabScope(value);
                  setLibraryPage(0);
                }}
              />
              <div
                className="hololive-library-bulk-actions"
                ref={bulkActionsRef}
                onBlur={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget)) {
                    setBulkPlaylistOpen(false);
                  }
                }}
              >
                <button
                  type="button"
                  disabled={visibleLibraryCount === 0 || bulkActionPending !== null}
                  onClick={() => void playVisibleLibrarySongs()}
                  title="Play visible songs from the top"
                >
                  <Play size={13} />
                  <span>{bulkActionPending === "play" ? "Playing" : "Play visible"}</span>
                </button>
                <button
                  type="button"
                  disabled={visibleLibraryCount === 0 || bulkActionPending !== null}
                  onClick={() => void queueVisibleLibrarySongs()}
                  title="Add visible songs to queue"
                >
                  <ListPlus size={13} />
                  <span>{bulkActionPending === "queue" ? "Queueing" : "Queue visible"}</span>
                </button>
                <span className="hololive-library-bulk-menu">
                  <button
                    type="button"
                    disabled={visibleLibraryCount === 0 || userPlaylists.length === 0 || bulkActionPending !== null}
                    aria-expanded={bulkPlaylistOpen}
                    onClick={() => setBulkPlaylistOpen((current) => !current)}
                    title={userPlaylists.length === 0 ? "Create a playlist first" : "Add visible songs to playlist"}
                  >
                    <ListMusic size={13} />
                    <span>{bulkActionPending === "playlist" ? "Adding" : "Add visible"}</span>
                  </button>
                  {bulkPlaylistOpen ? (
                    <HololivePlaylistMenu
                      ariaLabel="Choose playlist for visible songs"
                      className="hololive-library-playlist-popover hololive-library-bulk-popover"
                      disabled={bulkActionPending !== null}
                      playlists={userPlaylists}
                      onSelect={(playlistId) => void addVisibleSongsToPlaylist(playlistId)}
                    />
                  ) : null}
                </span>
              </div>
            </div>
            <div className="hololive-library-list">
              {visibleLibraryRows.map((row) => {
                const isActive = row.youtubeVideoId === currentVideoId;

                return (
                  <div key={row.youtubeVideoId} className={`hololive-library-row ${isActive ? "playing" : ""}`}>
                    <div>
                      <span className="hololive-library-title-line">
                        <strong title={songTitle(row)}>{songTitle(row)}</strong>
                        {row.sourceKind === "user" ? <em>Custom</em> : null}
                      </span>
                      <SongMetadata music={row} />
                    </div>
                    <div className="hololive-library-actions">
                      <LibraryMarkerControl
                        row={row}
                        open={openMarkerVideoId === row.youtubeVideoId}
                        pending={pendingMarkerVideoId === row.youtubeVideoId}
                        onToggle={() => {
                          setOpenPlaylistVideoId(null);
                          setOpenMarkerVideoId((current) => (current === row.youtubeVideoId ? null : row.youtubeVideoId));
                        }}
                        onSetMarker={(marker) => void setLibraryMarker(row, marker)}
                        onExclude={() => void excludeLibrarySong(row)}
                      />
                      <button type="button" onClick={() => void playLibrarySong(row)} title="Play now">
                        <Play size={13} />
                      </button>
                      <button type="button" onClick={() => void addToQueue(row, "end")} title="Add to queue">
                        <Plus size={13} />
                      </button>
                      <LibraryPlaylistMenu
                        row={row}
                        playlists={userPlaylists}
                        open={openPlaylistVideoId === row.youtubeVideoId}
                        pending={pendingPlaylistVideoId === row.youtubeVideoId}
                        onToggle={() => {
                          setOpenMarkerVideoId(null);
                          setOpenPlaylistVideoId((current) => (current === row.youtubeVideoId ? null : row.youtubeVideoId));
                        }}
                        onAdd={(playlistId) => void addSongToPlaylist(row, playlistId)}
                      />
                    </div>
                  </div>
                );
              })}
              {library && library.rows.length === 0 ? <p>No songs found.</p> : null}
            </div>
            <div className="hololive-library-footer">
              <div className="hololive-library-range" aria-live="polite">
                {library ? (
                  <>
                    <strong>{libraryTotal === 0 ? "0" : `${libraryPageStart}-${libraryPageEnd}`}</strong>
                    <span>{formatCount(library.total)} songs</span>
                  </>
                ) : (
                  <span>Loading songs</span>
                )}
              </div>
              <div className="hololive-library-pagination" aria-label="Song library pagination">
                <button
                  type="button"
                  onClick={() => setLibraryPage((page) => Math.max(page - 1, 0))}
                  disabled={libraryPage <= 0}
                  title="Previous page"
                  aria-label="Previous song page"
                >
                  <ChevronLeft size={11} strokeWidth={1.45} />
                </button>
                <span className="hololive-library-page-pill">
                  <span>Page</span>
                  <strong>{libraryPage + 1}</strong>
                  <span>of {libraryPageCount}</span>
                </span>
                <button
                  type="button"
                  onClick={() => setLibraryPage((page) => Math.min(page + 1, libraryPageCount - 1))}
                  disabled={libraryPage >= libraryPageCount - 1}
                  title="Next page"
                  aria-label="Next song page"
                >
                  <ChevronRight size={11} strokeWidth={1.45} />
                </button>
                <label className="hololive-page-size-control">
                  <span>Rows</span>
                  <CompactSelect
                    className="hololive-select-wrap hololive-page-size-select"
                    ariaLabel="Songs per page"
                    value={String(libraryPageSize)}
                    options={LIBRARY_PAGE_SIZE_OPTIONS.map((option) => ({ value: String(option), label: String(option) }))}
                    onChange={(value) => {
                      setLibraryPageSize(Number(value));
                      setLibraryPage(0);
                    }}
                  />
                </label>
              </div>
            </div>
          </section>
        </section>
    </section>
  );
}

interface SongItemListProps {
  items: HololiveMusicResolvedItem[];
  currentItemId?: string | null;
  activeVideoId?: string | null;
  emptyText: string;
  onSelect: (item: HololiveMusicResolvedItem) => void;
  onRemove: (item: HololiveMusicResolvedItem) => void;
  onReorder: (itemIds: string[]) => void;
  onPlayNow?: (item: HololiveMusicResolvedItem) => void;
  canRemove?: boolean;
  playlists?: HololiveMusicPlayerData["playlists"];
  onPlaylistAdd?: (item: HololiveMusicResolvedItem, playlistId: string) => void;
  onMarkerChange?: (item: HololiveMusicResolvedItem, marker: HololiveMusicMarker | null) => void;
  onExclude?: (item: HololiveMusicResolvedItem) => void;
}

interface LibraryMarkerControlProps {
  row: HololiveMusicRow;
  open: boolean;
  pending: boolean;
  onToggle: () => void;
  onSetMarker: (marker: HololiveMusicMarker | null) => void;
  onExclude: () => void;
}

function LibraryMarkerControl({ row, open, pending, onToggle, onSetMarker, onExclude }: LibraryMarkerControlProps) {
  const [confirmExclude, setConfirmExclude] = useState(false);
  const menuRef = useRef<HTMLSpanElement | null>(null);
  const markerLabel = musicMarkerLabel(row.marker);

  useEffect(() => {
    if (!open) {
      setConfirmExclude(false);
    }
  }, [open]);

  useDismissableLayer({
    enabled: open,
    ref: menuRef,
    onDismiss: () => {
      setConfirmExclude(false);
      onToggle();
    }
  });

  return (
    <span
      className="hololive-library-menu-cell hololive-library-marker-cell"
      ref={menuRef}
      onBlur={(event) => {
        if (open && !event.currentTarget.contains(event.relatedTarget)) {
          setConfirmExclude(false);
          onToggle();
        }
      }}
    >
      <button
        className={`hololive-song-marker-button ${row.marker ?? "unmarked"}`}
        type="button"
        disabled={pending}
        aria-label={`${markerLabel} marker for ${songTitle(row)}`}
        aria-expanded={open}
        title={`${markerLabel} marker`}
        onClick={(event) => {
          event.stopPropagation();
          onToggle();
        }}
      >
        <MusicMarkerIcon marker={row.marker} />
      </button>
      {open ? (
        <HololiveMusicMarkerMenu
          ariaLabel={`Set marker for ${songTitle(row)}`}
          className="hololive-song-marker-popover hololive-library-popover"
          confirmAriaLabel={`Confirm exclusion for ${songTitle(row)}`}
          confirmingExclude={confirmExclude}
          disabled={pending}
          marker={row.marker}
          onConfirmingExcludeChange={setConfirmExclude}
          onExclude={onExclude}
          onSetMarker={onSetMarker}
        />
      ) : null}
    </span>
  );
}

interface LibraryPlaylistMenuProps {
  row: HololiveMusicRow;
  playlists: HololiveMusicPlayerData["playlists"];
  open: boolean;
  pending: boolean;
  onToggle: () => void;
  onAdd: (playlistId: string) => void;
}

function LibraryPlaylistMenu({ row, playlists, open, pending, onToggle, onAdd }: LibraryPlaylistMenuProps) {
  const menuRef = useRef<HTMLSpanElement | null>(null);

  useDismissableLayer({
    enabled: open,
    ref: menuRef,
    onDismiss: onToggle
  });

  return (
    <span
      className="hololive-library-menu-cell"
      ref={menuRef}
      onBlur={(event) => {
        if (open && !event.currentTarget.contains(event.relatedTarget)) {
          onToggle();
        }
      }}
    >
      <button
        type="button"
        disabled={pending || playlists.length === 0}
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation();
          onToggle();
        }}
        title={playlists.length === 0 ? "Create a playlist first" : "Add to playlist"}
        aria-label={`Add ${songTitle(row)} to playlist`}
      >
        <ListMusic size={13} />
      </button>
      {open ? (
        <HololivePlaylistMenu
          ariaLabel={`Choose playlist for ${songTitle(row)}`}
          className="hololive-library-playlist-popover"
          disabled={pending}
          emptyText="No playlists yet"
          playlists={playlists}
          youtubeVideoId={row.youtubeVideoId}
          onSelect={onAdd}
        />
      ) : null}
    </span>
  );
}

function SongItemList({
  items,
  currentItemId,
  activeVideoId,
  emptyText,
  onSelect,
  onRemove,
  onReorder,
  onPlayNow,
  canRemove = true,
  playlists = [],
  onPlaylistAdd,
  onMarkerChange,
  onExclude
}: SongItemListProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 4
      }
    })
  );

  function handleDragEnd(event: DragEndEvent) {
    const activeId = String(event.active.id);
    const overId = event.over ? String(event.over.id) : null;
    if (!overId || activeId === overId) {
      return;
    }

    const oldIndex = items.findIndex((item) => item.id === activeId);
    const newIndex = items.findIndex((item) => item.id === overId);
    if (oldIndex < 0 || newIndex < 0) {
      return;
    }

    const nextItems = arrayMove(items, oldIndex, newIndex);
    const nextIds = nextItems.map((item) => item.id);
    if (nextIds.every((id, index) => id === items[index]?.id)) {
      return;
    }
    onReorder(nextIds);
  }

  if (items.length === 0) {
    return <p className="hololive-player-empty">{emptyText}</p>;
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={items.map((item) => item.id)} strategy={verticalListSortingStrategy}>
        <ul className="hololive-player-song-list">
          {items.map((item) => {
            const active = item.id === currentItemId || item.youtubeVideoId === activeVideoId;

            return (
              <SortableSongItem
                key={item.id}
                item={item}
                active={active}
                onSelect={onSelect}
                onPlayNow={onPlayNow}
                onRemove={onRemove}
                canRemove={canRemove}
                playlists={playlists}
                onPlaylistAdd={onPlaylistAdd}
                onMarkerChange={onMarkerChange}
                onExclude={onExclude}
              />
            );
          })}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

interface SortableSongItemProps {
  item: HololiveMusicResolvedItem;
  active: boolean;
  onSelect: (item: HololiveMusicResolvedItem) => void;
  onRemove: (item: HololiveMusicResolvedItem) => void;
  onPlayNow?: (item: HololiveMusicResolvedItem) => void;
  canRemove: boolean;
  playlists: HololiveMusicPlayerData["playlists"];
  onPlaylistAdd?: (item: HololiveMusicResolvedItem, playlistId: string) => void;
  onMarkerChange?: (item: HololiveMusicResolvedItem, marker: HololiveMusicMarker | null) => void;
  onExclude?: (item: HololiveMusicResolvedItem) => void;
}

function SortableSongItem({
  item,
  active,
  onSelect,
  onRemove,
  onPlayNow,
  canRemove,
  playlists,
  onPlaylistAdd,
  onMarkerChange,
  onExclude
}: SortableSongItemProps) {
  const [markerOpen, setMarkerOpen] = useState(false);
  const [playlistOpen, setPlaylistOpen] = useState(false);
  const [confirmExclude, setConfirmExclude] = useState(false);
  const [pendingAction, setPendingAction] = useState<"marker" | "playlist" | null>(null);
  const actionsRef = useRef<HTMLDivElement | null>(null);
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition
  };
  const marker = item.music?.marker ?? null;
  const markerLabel = musicMarkerLabel(marker);
  const title = itemTitle(item);

  useDismissableLayer({
    enabled: markerOpen || playlistOpen,
    ref: actionsRef,
    onDismiss: () => {
      setMarkerOpen(false);
      setPlaylistOpen(false);
      setConfirmExclude(false);
    }
  });

  async function setMarker(nextMarker: HololiveMusicMarker | null) {
    if (!onMarkerChange) {
      return;
    }

    setPendingAction("marker");
    try {
      await onMarkerChange(item, nextMarker);
      setMarkerOpen(false);
      setConfirmExclude(false);
    } finally {
      setPendingAction((current) => (current === "marker" ? null : current));
    }
  }

  async function excludeItem() {
    if (!onExclude) {
      return;
    }

    setPendingAction("marker");
    try {
      await onExclude(item);
      setMarkerOpen(false);
      setConfirmExclude(false);
    } finally {
      setPendingAction((current) => (current === "marker" ? null : current));
    }
  }

  async function addToPlaylist(playlistId: string) {
    if (!onPlaylistAdd) {
      return;
    }

    setPendingAction("playlist");
    try {
      await onPlaylistAdd(item, playlistId);
      setPlaylistOpen(false);
    } finally {
      setPendingAction((current) => (current === "playlist" ? null : current));
    }
  }

  return (
    <li
      ref={setNodeRef}
      className={[active ? "active" : "", isDragging ? "dragging" : ""].filter(Boolean).join(" ")}
      style={style}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        className="hololive-song-drag-handle"
        title="Drag to reorder"
        aria-label={`Drag ${title} to reorder`}
        {...attributes}
        {...listeners}
      >
        <GripVertical size={13} strokeWidth={1.8} />
      </button>
      <button
        type="button"
        className="hololive-player-song-main"
        onClick={() => item.available && onSelect(item)}
        disabled={!item.available}
        title={title}
      >
        <span className="hololive-player-song-title-line">
          <strong>{title}</strong>
        </span>
        <SongMetadata music={item.music} unavailableText="Unavailable" />
      </button>
      <div
        className="hololive-player-song-actions"
        ref={actionsRef}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) {
            setMarkerOpen(false);
            setPlaylistOpen(false);
            setConfirmExclude(false);
          }
        }}
      >
        {onMarkerChange ? (
          <span className="hololive-player-row-menu">
            <button
              className={`hololive-song-marker-button ${marker ?? "unmarked"}`}
              type="button"
              disabled={!item.available || pendingAction !== null}
              aria-label={`${markerLabel} marker for ${title}`}
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
                ariaLabel={`Set marker for ${title}`}
                className="hololive-song-marker-popover hololive-player-row-popover"
                confirmAriaLabel={`Confirm exclusion for ${title}`}
                confirmingExclude={confirmExclude}
                disabled={pendingAction !== null}
                marker={marker}
                onConfirmingExcludeChange={setConfirmExclude}
                onExclude={onExclude ? () => void excludeItem() : undefined}
                onSetMarker={(nextMarker) => void setMarker(nextMarker)}
              />
            ) : null}
          </span>
        ) : null}
        {onPlaylistAdd ? (
          <span className="hololive-player-row-menu">
            <button
              type="button"
              disabled={!item.available || playlists.length === 0 || pendingAction !== null}
              aria-expanded={playlistOpen}
              onClick={(event) => {
                event.stopPropagation();
                setMarkerOpen(false);
                setConfirmExclude(false);
                setPlaylistOpen((current) => !current);
              }}
              title={playlists.length === 0 ? "Create a playlist first" : "Add to playlist"}
              aria-label={`Add ${title} to playlist`}
            >
              <ListMusic size={12} />
            </button>
            {playlistOpen ? (
              <HololivePlaylistMenu
                ariaLabel={`Choose playlist for ${title}`}
                className="hololive-library-playlist-popover hololive-player-row-popover"
                disabled={pendingAction !== null}
                playlists={playlists}
                youtubeVideoId={item.youtubeVideoId}
                onSelect={(playlistId) => void addToPlaylist(playlistId)}
              />
            ) : null}
          </span>
        ) : null}
        {onPlayNow ? (
          <button type="button" onClick={() => item.available && onPlayNow(item)} disabled={!item.available} title="Play now">
            <Play size={12} />
          </button>
        ) : null}
        {canRemove ? (
          <button type="button" onClick={() => onRemove(item)} title="Remove">
            <X size={12} />
          </button>
        ) : null}
      </div>
    </li>
  );
}

function SongMetadata({
  music,
  unavailableText
}: {
  music: HololiveMusicRow | null | undefined;
  unavailableText?: string;
}) {
  const parts = musicMetaParts(music);
  if (!parts) {
    return <span className="hololive-player-song-meta">{unavailableText ?? ""}</span>;
  }

  return (
    <span className="hololive-player-song-meta">
      <span className="hololive-player-song-meta-channel" title={parts.channelName}>
        {parts.channelName}
      </span>
      {parts.date ? <span className="hololive-player-song-meta-piece">{parts.date}</span> : null}
      {parts.duration ? <span className="hololive-player-song-meta-piece">{parts.duration}</span> : null}
      {parts.views ? <span className="hololive-player-song-meta-piece">{parts.views}</span> : null}
    </span>
  );
}
