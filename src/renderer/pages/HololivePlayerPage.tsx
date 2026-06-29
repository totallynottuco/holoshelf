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
  HololiveMusicLibraryResponse,
  HololiveMusicMarker,
  HololiveMusicPlayerData,
  HololiveMusicResolvedItem,
  HololiveMusicRow,
  HololiveMusicTopic
} from "../../shared/contracts";
import { api } from "../api";
import { CompactSelect } from "../components/CompactSelect";
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
import { useHololivePlayer } from "../player/HololivePlayerContext";

const LIBRARY_PAGE_SIZE_OPTIONS = [25, 50, 100] as const;

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
    status,
    setStatus,
    loadPlayerData,
    applyPlayerData,
    updateState,
    playQueueItem,
    loadQueueItem,
    playPlaylistItem,
    playVideoNow,
    queueVideo,
    playNext,
    togglePlayPause
  } = useHololivePlayer();
  const [library, setLibrary] = useState<HololiveMusicLibraryResponse | null>(null);
  const [query, setQuery] = useState("");
  const [topicId, setTopicId] = useState<HololiveMusicTopic | "all">("all");
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
  const libraryRequestIdRef = useRef(0);

  useEffect(() => {
    void loadPlayerData();
  }, []);

  useEffect(() => {
    const requestId = libraryRequestIdRef.current + 1;
    libraryRequestIdRef.current = requestId;
    const timer = window.setTimeout(() => {
      void api
        .invoke("hololive:music:library", {
          query,
          topicId: topicId === "all" ? null : topicId,
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
            setStatus(error instanceof Error ? error.message : "Could not load music library.");
          }
        });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [libraryPage, libraryPageSize, query, topicId]);

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
  const libraryTotal = library?.total ?? 0;
  const libraryPageCount = Math.max(Math.ceil(libraryTotal / libraryPageSize), 1);
  const libraryPageStart = libraryTotal === 0 ? 0 : libraryPage * libraryPageSize + 1;
  const libraryPageEnd = library ? Math.min(library.offset + library.rows.length, library.total) : 0;

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

  function togglePlaylist(playlistId: string) {
    setSelectedPlaylistId(playlistId);
    setExpandedPlaylistId((current) => (current === playlistId ? null : playlistId));
  }

  async function playLibrarySong(row: HololiveMusicRow) {
    await playVideoNow(row.youtubeVideoId);
  }

  async function addToQueue(row: HololiveMusicRow, placement: "now" | "next" | "end") {
    await queueVideo(row.youtubeVideoId, placement);
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
      setStatus(error instanceof Error ? error.message : "Marker update failed.");
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
          detail: response
        })
      );
      await loadPlayerData();
      setOpenMarkerVideoId(null);
      setStatus("Song excluded");
    } catch (error) {
      console.error(error);
      setStatus(error instanceof Error ? error.message : "Exclude failed.");
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
      setStatus(marker ? `${musicMarkerLabel(marker)} saved` : "Marker cleared");
      setPlayerMarkerOpen(false);
    } catch (error) {
      console.error(error);
      setStatus(error instanceof Error ? error.message : "Marker update failed.");
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
    setStatus(marker ? `${musicMarkerLabel(marker)} saved` : "Marker cleared");
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
          detail: response
        })
      );
      await loadPlayerData();
      setPlayerMarkerOpen(false);
      setPlayerConfirmExclude(false);
      setStatus("Song excluded");
    } catch (error) {
      console.error(error);
      setStatus(error instanceof Error ? error.message : "Exclude failed.");
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
        detail: response
      })
    );
    await loadPlayerData();
    setStatus("Song excluded");
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
      setStatus(error instanceof Error ? error.message : "Player action failed.");
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

  async function deletePlaylist(playlistId: string, name: string) {
    if (!window.confirm(`Delete "${name}"?`)) {
      return;
    }
    await applyPlayerData(() => api.invoke("hololive:player:playlist:delete", { playlistId }), "Playlist deleted");
    setSelectedPlaylistId(null);
    setExpandedPlaylistId((current) => (current === playlistId ? null : current));
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

  const currentMarker = currentItem?.music?.marker ?? null;
  const currentMarkerLabel = musicMarkerLabel(currentMarker);
  const currentTitle = currentItem ? itemTitle(currentItem) : "current song";

  return (
    <div className="page hololive-page hololive-player-page">
      <section className="hololive-player-workspace" aria-label="Hololive YouTube playlist player">
        <HololiveViewSwitch />

        <section className="hololive-player-grid">
          <section className="hololive-player-main" aria-label="YouTube player">
            <div className="hololive-youtube-frame hololive-youtube-frame-anchor" />

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
            {status ? <div className="hololive-player-status">{status}</div> : null}
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
              onRemove={(item) =>
                void applyPlayerData(() => api.invoke("hololive:player:queue:remove", { itemId: item.id }), "Removed from queue")
              }
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
                          onRemove={(item) =>
                            void applyPlayerData(
                              () => api.invoke("hololive:player:playlist-item:remove", { itemId: item.id }),
                              "Removed from playlist"
                            )
                          }
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
              <label>
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
            </div>
            <div className="hololive-library-list">
              {(library?.rows ?? []).map((row) => {
                const isActive = row.youtubeVideoId === currentVideoId;

                return (
                  <div key={row.youtubeVideoId} className={`hololive-library-row ${isActive ? "playing" : ""}`}>
                    <div>
                      <span className="hololive-library-title-line">
                        <strong title={songTitle(row)}>{songTitle(row)}</strong>
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
    </div>
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
  const markerLabel = musicMarkerLabel(row.marker);

  useEffect(() => {
    if (!open) {
      setConfirmExclude(false);
    }
  }, [open]);

  return (
    <span
      className="hololive-library-menu-cell hololive-library-marker-cell"
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
  return (
    <span
      className="hololive-library-menu-cell"
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
