import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Link2, Loader2, Music, Search, Trash2, X } from "lucide-react";
import type {
  HololiveCustomSongPreview,
  HololiveIdol,
  HololiveMusicPlayerData,
  HololiveMusicRow,
  HololiveMusicTopic
} from "../../shared/contracts";
import { api } from "../api";
import { useDismissableLayer } from "../lib/useDismissableLayer";
import { useHololiveActionToast } from "./HololiveActionToast";

interface HololiveCustomSongImportPanelProps {
  open: boolean;
  talents: HololiveIdol[];
  song?: HololiveMusicRow | null;
  onClose: () => void;
  onSaved: (song: HololiveMusicRow) => void | Promise<void>;
  onDeleted?: (data: HololiveMusicPlayerData) => void | Promise<void>;
}

const emptyPreview: HololiveCustomSongPreview | null = null;
const viewFormatter = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
}

function topicLabel(topicId: HololiveMusicTopic): string {
  return topicId === "Original_Song" ? "Original" : "Cover";
}

function songTitle(song: HololiveMusicRow): string {
  return song.songName || song.title;
}

function RequiredMark() {
  return <span className="hololive-custom-song-required" aria-hidden="true">*</span>;
}

function formatDuration(totalSeconds: number | null): string | null {
  if (totalSeconds === null || !Number.isFinite(totalSeconds) || totalSeconds <= 0) {
    return null;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function formatPublishedDate(value: string): string | null {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function toDateInputValue(value?: string | null): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    return "";
  }
  if (/^\d{4}-\d{2}-\d{2}$/u.test(trimmed)) {
    return trimmed;
  }
  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? trimmed : date.toISOString().slice(0, 10);
}

function isValidDateInput(value: string): boolean {
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(trimmed)) {
    return false;
  }
  const date = new Date(`${trimmed}T00:00:00.000Z`);
  return Boolean(!Number.isNaN(date.getTime()) && date.toISOString().startsWith(trimmed));
}

export function HololiveCustomSongImportPanel({
  open,
  talents,
  song,
  onClose,
  onSaved,
  onDeleted
}: HololiveCustomSongImportPanelProps) {
  const { showToast, showUndoToast } = useHololiveActionToast();
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [title, setTitle] = useState("");
  const [songName, setSongName] = useState("");
  const [topicId, setTopicId] = useState<HololiveMusicTopic>("Original_Song");
  const [ownerIdolIds, setOwnerIdolIds] = useState<string[]>([]);
  const [featuredIdolIds, setFeaturedIdolIds] = useState<string[]>([]);
  const [channelId, setChannelId] = useState("");
  const [channelName, setChannelName] = useState("");
  const [publishedAt, setPublishedAt] = useState("");
  const [durationSeconds, setDurationSeconds] = useState<number | null>(null);
  const [viewCount, setViewCount] = useState<number | null>(null);
  const [fetchedAt, setFetchedAt] = useState("");
  const [preview, setPreview] = useState<HololiveCustomSongPreview | null>(emptyPreview);
  const [busy, setBusy] = useState<"preview" | "save" | "delete" | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);

  const editing = Boolean(song);
  const canDelete = song?.sourceKind === "user";
  const loadedMetadataForCurrentUrl = Boolean(!editing && preview?.usedApi && preview.youtubeUrl === youtubeUrl.trim());
  const durationLabel = formatDuration(durationSeconds);
  const publishedLabel = formatPublishedDate(publishedAt);
  const metadataItems = [
    channelName.trim() ? channelName.trim() : null,
    publishedLabel,
    durationLabel,
    viewCount !== null && Number.isFinite(viewCount) ? `${viewFormatter.format(viewCount)} views` : null
  ].filter((item): item is string => Boolean(item));
  const statusLabel = editing ? "Editing" : preview?.apiKeyMissing ? "Manual" : preview ? "Loaded" : "YouTube";
  const ownerIds = useMemo(() => uniqueIds(ownerIdolIds), [ownerIdolIds]);
  const saveBlockReason = (() => {
    if (!youtubeUrl.trim()) {
      return "Paste a YouTube link first";
    }
    if (!title.trim()) {
      return "Add a title or load video details";
    }
    if (ownerIds.length === 0) {
      return "Choose at least one owner talent";
    }
    if (!loadedMetadataForCurrentUrl && !channelName.trim()) {
      return "Add a channel or load video details";
    }
    if (publishedAt.trim() && !isValidDateInput(publishedAt)) {
      return "Use YYYY-MM-DD for the published date";
    }
    if (!loadedMetadataForCurrentUrl && !publishedAt.trim()) {
      return "Add a published date or load video details";
    }
    return null;
  })();
  const canSave = !saveBlockReason;

  useEffect(() => {
    if (!open) {
      return;
    }
    setYoutubeUrl(song?.youtubeUrl ?? "");
    setTitle(song?.title ?? "");
    setSongName(song?.songName ?? song?.title ?? "");
    setTopicId(song?.topicId ?? "Original_Song");
    setOwnerIdolIds(song?.ownedIdolIds?.length ? song.ownedIdolIds : song?.idolId ? [song.idolId] : []);
    setFeaturedIdolIds(song?.featuredIdolIds ?? []);
    setChannelId(song?.channelId ?? "");
    setChannelName(song?.channelName ?? "");
    setPublishedAt(toDateInputValue(song?.publishedAt));
    setDurationSeconds(song?.durationSeconds ?? null);
    setViewCount(song?.viewCount ?? null);
    setFetchedAt(song?.viewCountFetchedAt ?? "");
    setPreview(null);
  }, [open, song]);

  useDismissableLayer({
    enabled: open && busy === null,
    ref: sheetRef,
    onDismiss: onClose
  });

  const titlePreview = title.trim() || songName.trim();

  function updateYoutubeUrl(value: string) {
    setYoutubeUrl(value);
    setPreview(null);
  }

  async function previewSong() {
    if (editing) {
      return;
    }
    if (!youtubeUrl.trim()) {
      showToast({ message: "Paste a YouTube link first", tone: "error" });
      return;
    }

    setBusy("preview");
    try {
      const nextPreview = await api.invoke("hololive:custom-songs:preview", { youtubeUrl });
      setPreview(nextPreview);
      setYoutubeUrl(nextPreview.youtubeUrl);
      setTitle((current) => current || nextPreview.title || "");
      setSongName((current) => current || nextPreview.songName || nextPreview.title || "");
      setChannelId((current) => current || nextPreview.channelId || "");
      setChannelName((current) => current || nextPreview.channelName || "");
      setPublishedAt((current) => current || toDateInputValue(nextPreview.publishedAt));
      setDurationSeconds((current) => current ?? nextPreview.durationSeconds ?? null);
      setViewCount((current) => current ?? nextPreview.viewCount ?? null);
      setFetchedAt((current) => current || nextPreview.fetchedAt || "");
      showToast({
        message: nextPreview.usedApi ? "Video loaded" : "Manual import ready",
        tone: "success"
      });
    } catch (error) {
      showToast({
        message: "Could not load video",
        detail: error instanceof Error ? error.message : "Check the link and try again.",
        tone: "error"
      });
    } finally {
      setBusy(null);
    }
  }

  async function saveSong() {
    const featuredIds = uniqueIds(featuredIdolIds).filter((idolId) => !ownerIds.includes(idolId));
    if (saveBlockReason) {
      showToast({
        message: saveBlockReason,
        tone: "error"
      });
      return;
    }

    setBusy("save");
    try {
      const saved = await api.invoke("hololive:custom-songs:upsert", {
        youtubeUrl,
        title,
        songName,
        topicId,
        ownerIdolIds: ownerIds,
        featuredIdolIds: featuredIds,
        channelId,
        channelName,
        publishedAt,
        durationSeconds,
        viewCount,
        fetchedAt
      });
      await onSaved(saved);
      showToast({ message: editing ? "Custom song updated" : "Custom song imported", tone: "success" });
      onClose();
    } catch (error) {
      showToast({
        message: editing ? "Could not update song" : "Could not import song",
        detail: error instanceof Error ? error.message : "Try again.",
        tone: "error"
      });
    } finally {
      setBusy(null);
    }
  }

  function confirmDelete() {
    if (!song || !canDelete || !onDeleted) {
      return;
    }
    showToast({
      message: `Delete ${songTitle(song)}?`,
      detail: "This removes it from the library, playlists, and queue. Bracket history stays intact.",
      tone: "error",
      actionLabel: "Delete",
      onAction: async () => {
        setBusy("delete");
        try {
          const result = await api.invoke("hololive:custom-songs:delete", { youtubeVideoId: song.youtubeVideoId });
          await onDeleted(result.data);
          showUndoToast({
            message: "Custom song deleted",
            tone: "success",
            undoToken: result.undoToken,
            undoLabel: result.undoLabel,
            onApplied: async () => {
              await onDeleted(await api.invoke("hololive:player:data", null));
            }
          });
          onClose();
        } finally {
          setBusy(null);
        }
      }
    });
  }

  if (!open) {
    return null;
  }

  return (
    <div className="hololive-custom-song-panel" role="dialog" aria-modal="true" aria-label={editing ? "Edit custom song" : "Import custom song"}>
      <div className="hololive-custom-song-sheet" ref={sheetRef}>
        <div className="hololive-custom-song-head">
          <div className="hololive-custom-song-title">
            <span className="hololive-custom-song-title-icon" aria-hidden="true">
              <Music size={15} />
            </span>
            <div>
              <strong>{editing ? "Edit Song" : "Import Song"}</strong>
              {titlePreview ? <span>{titlePreview}</span> : null}
            </div>
          </div>
          <div className="hololive-custom-song-head-actions">
            <span>{statusLabel}</span>
            <button className="hololive-custom-song-close" type="button" onClick={onClose} title="Close" aria-label="Close custom song import">
              <X size={14} />
            </button>
          </div>
        </div>

        <div className="hololive-custom-song-source">
          <label className="hololive-custom-song-field">
            <span><Link2 size={12} />YouTube link<RequiredMark /></span>
            <div className="hololive-custom-song-url-row">
              <input
                value={youtubeUrl}
                onChange={(event) => updateYoutubeUrl(event.target.value)}
                placeholder="https://www.youtube.com/watch?v=..."
                disabled={editing || busy !== null}
              />
              <button
                type="button"
                onClick={() => void previewSong()}
                disabled={editing || busy !== null || !youtubeUrl.trim()}
                title={editing ? "Video link cannot be changed while editing" : "Load video details"}
              >
                {busy === "preview" ? <Loader2 size={13} className="spin" /> : <Search size={13} />}
                <span>Load</span>
              </button>
            </div>
          </label>
          {metadataItems.length > 0 ? (
            <div className="hololive-custom-song-meta" aria-label="Loaded video details">
              {metadataItems.map((item) => <span key={item}>{item}</span>)}
            </div>
          ) : null}
        </div>

        <div className="hololive-custom-song-section">
          <div className="hololive-custom-song-grid">
            <label className="hololive-custom-song-field">
              <span>Title<RequiredMark /></span>
              <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Required title" required />
            </label>
            <label className="hololive-custom-song-field">
              <span>Song name</span>
              <input value={songName} onChange={(event) => setSongName(event.target.value)} placeholder="Display title" />
            </label>
          </div>

          <div className="hololive-custom-song-type-field">
            <span>Type<RequiredMark /></span>
            <div className="hololive-custom-song-type" aria-label="Song type">
              {(["Original_Song", "Music_Cover"] as const).map((value) => (
                <button key={value} type="button" className={topicId === value ? "selected" : ""} onClick={() => setTopicId(value)}>
                  {topicLabel(value)}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="hololive-custom-song-section">
          <div className="hololive-custom-song-grid">
            <TalentPicker label="Owners" required talents={talents} selectedIds={ownerIdolIds} placeholder="Choose owners" onChange={setOwnerIdolIds} />
            <TalentPicker
              label="Featured"
              talents={talents}
              selectedIds={featuredIdolIds}
              disabledIds={new Set(ownerIdolIds)}
              placeholder="Optional"
              onChange={setFeaturedIdolIds}
            />
          </div>
        </div>

        <div className="hololive-custom-song-section">
          <div className="hololive-custom-song-grid">
            <label className="hololive-custom-song-field">
              <span>Channel<RequiredMark /></span>
              <input value={channelName} onChange={(event) => setChannelName(event.target.value)} placeholder="Channel name" required />
            </label>
            <label className="hololive-custom-song-field">
              <span>Published<RequiredMark /></span>
              <input
                value={publishedAt}
                onChange={(event) => setPublishedAt(event.target.value)}
                placeholder="YYYY-MM-DD"
                inputMode="numeric"
                pattern="\d{4}-\d{2}-\d{2}"
                required
              />
            </label>
          </div>
        </div>

        <div className="hololive-custom-song-actions">
          <div className="hololive-custom-song-actions-left">
            {canDelete ? (
              <button type="button" className="danger" onClick={confirmDelete} disabled={busy !== null}>
                {busy === "delete" ? <Loader2 size={13} className="spin" /> : <Trash2 size={13} />}
                Delete
              </button>
            ) : null}
          </div>
          <div className="hololive-custom-song-actions-right">
            <button type="button" onClick={onClose} disabled={busy !== null}>Cancel</button>
            <button type="button" className="primary" onClick={() => void saveSong()} disabled={busy !== null || !canSave} title={saveBlockReason ?? "Save custom song"}>
              {busy === "save" ? <Loader2 size={13} className="spin" /> : null}
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface TalentPickerProps {
  label: string;
  talents: HololiveIdol[];
  selectedIds: string[];
  disabledIds?: Set<string>;
  placeholder?: string;
  required?: boolean;
  onChange: (ids: string[]) => void;
}

function TalentPicker({ label, talents, selectedIds, disabledIds = new Set(), placeholder = "None", required = false, onChange }: TalentPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedNames = talents
    .filter((talent) => selectedSet.has(talent.id))
    .map((talent) => talent.displayName)
    .join(", ");
  const filteredTalents = talents.filter((talent) =>
    `${talent.displayName} ${talent.branch} ${talent.generation}`.toLowerCase().includes(query.trim().toLowerCase())
  );

  function toggle(id: string) {
    if (disabledIds.has(id)) {
      return;
    }
    if (selectedSet.has(id)) {
      onChange(selectedIds.filter((selectedId) => selectedId !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  }

  return (
    <div
      className={`hololive-custom-song-picker ${open ? "open" : ""}`}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setOpen(false);
          setQuery("");
        }
      }}
    >
      <span>{label}{required ? <RequiredMark /> : null}</span>
      <button type="button" onClick={() => setOpen((current) => !current)} aria-expanded={open}>
        <strong>{selectedNames || placeholder}</strong>
        <ChevronDown size={13} />
      </button>
      {open ? (
        <div className="hololive-custom-song-picker-menu">
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search talents" autoFocus />
          <div>
            {filteredTalents.map((talent) => {
              const selected = selectedSet.has(talent.id);
              const disabled = disabledIds.has(talent.id);
              return (
                <button
                  type="button"
                  key={talent.id}
                  className={selected ? "selected" : ""}
                  disabled={disabled}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => toggle(talent.id)}
                >
                  <span>{talent.displayName}</span>
                  <Check size={12} />
                </button>
              );
            })}
            {filteredTalents.length === 0 ? <span className="hololive-custom-song-picker-empty">No talents found</span> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
