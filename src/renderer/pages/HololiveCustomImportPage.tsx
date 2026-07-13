import { useEffect, useMemo, useState } from "react";
import { Check, Loader2, Music, Plus, RefreshCcw, Search, Trash2 } from "lucide-react";
import type {
  HolodexChannel,
  HololiveCustomTalentInput,
  HololiveCustomTalentPreview,
  HololiveIdol,
  HololiveMusicRow,
  HololiveTierListData
} from "../../shared/contracts";
import { api } from "../api";
import { HololiveCustomSongImportPanel } from "../components/HololiveCustomSongImportPanel";
import { useHololiveActionToast } from "../components/HololiveActionToast";
import { HololiveViewSwitch } from "../components/HololiveViewSwitch";

const emptyInput: HololiveCustomTalentInput = {
  channelInput: "",
  displayName: "",
  cardImageUrl: "",
  originalSongsUrl: "",
  coversUrl: ""
};

const countFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

function formatCount(value?: number | null): string {
  return value === null || value === undefined || !Number.isFinite(value) ? "0" : countFormatter.format(value);
}

function normalizeOptional(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed : null;
}

function customTalentInput(input: HololiveCustomTalentInput): HololiveCustomTalentInput {
  return {
    channelInput: input.channelInput.trim(),
    displayName: normalizeOptional(input.displayName),
    cardImageUrl: normalizeOptional(input.cardImageUrl),
    originalSongsUrl: normalizeOptional(input.originalSongsUrl),
    coversUrl: normalizeOptional(input.coversUrl)
  };
}

function channelForIdol(idol: HololiveIdol, channels: HolodexChannel[]): HolodexChannel | null {
  const channelId = idol.youtubeChannelId;
  if (!channelId) {
    return null;
  }

  return channels.find((channel) => channel.id === channelId) ?? null;
}

export function HololiveCustomImportPage() {
  const { showToast } = useHololiveActionToast();
  const [form, setForm] = useState<HololiveCustomTalentInput>(emptyInput);
  const [preview, setPreview] = useState<HololiveCustomTalentPreview | null>(null);
  const [tierData, setTierData] = useState<HololiveTierListData | null>(null);
  const [channels, setChannels] = useState<HolodexChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [resolving, setResolving] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [refreshingOfficial, setRefreshingOfficial] = useState(false);
  const [refreshingCustomAll, setRefreshingCustomAll] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [customSongPanelOpen, setCustomSongPanelOpen] = useState(false);
  const [editingCustomSong, setEditingCustomSong] = useState<HololiveMusicRow | null>(null);
  const [customSongs, setCustomSongs] = useState<HololiveMusicRow[]>([]);

  const customTalents = useMemo(
    () => (tierData?.idols ?? []).filter((idol) => idol.source === "custom"),
    [tierData]
  );

  async function loadData() {
    setLoading(true);
    try {
      const [nextTierData, nextChannels, nextCustomSongs] = await Promise.all([
        api.invoke("hololive:tier-data", null),
        api.invoke("hololive:channels:list", null),
        api.invoke("hololive:music:library", {
          sourceKind: "user",
          sort: "newest",
          limit: 100
        })
      ]);
      setTierData(nextTierData);
      setChannels(nextChannels);
      setCustomSongs(nextCustomSongs.rows);
    } catch (nextError) {
      showToast({
        message: "Could not load talents",
        detail: nextError instanceof Error ? nextError.message : "Try again in a moment.",
        tone: "error"
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  useEffect(() => {
    return api.onHololiveRefreshProgress((progress) => {
      if (progress.scope === "official" || progress.scope === "custom" || progress.scope === "custom-all") {
        showToast({ message: progress.message, tone: "info" });
      }
    });
  }, []);

  async function resolveTalent() {
    const payload = customTalentInput(form);
    if (!payload.channelInput) {
      showToast({
        message: "Enter a talent channel first",
        detail: "Use a YouTube handle, channel URL, Holodex link, or channel ID.",
        tone: "error"
      });
      return;
    }

    setResolving(true);
    try {
      const nextPreview = await api.invoke("hololive:custom-talents:resolve", payload);
      setPreview(nextPreview);
      showToast({ message: `Resolved ${nextPreview.displayName}`, tone: "success" });
      if (!form.displayName?.trim()) {
        setForm((current) => ({ ...current, displayName: nextPreview.displayName }));
      }
    } catch (nextError) {
      setPreview(null);
      showToast({
        message: "Could not resolve talent",
        detail: nextError instanceof Error ? nextError.message : "Check the channel input and try again.",
        tone: "error"
      });
    } finally {
      setResolving(false);
    }
  }

  async function saveTalent() {
    const payload = customTalentInput(form);
    if (!payload.channelInput) {
      showToast({
        message: "Enter a talent channel first",
        detail: "Use a YouTube handle, channel URL, Holodex link, or channel ID.",
        tone: "error"
      });
      return;
    }

    setSaving(true);
    try {
      const record = await api.invoke("hololive:custom-talents:upsert", payload);
      showToast({ message: `Saved ${record.idol.displayName}`, detail: "Refreshing music...", tone: "success" });
      setForm(emptyInput);
      setPreview(null);
      const result = await api.invoke("hololive:custom-talents:refresh", {
        idolId: record.idol.id,
        includeRelationships: true,
        includeCollabs: true
      });
      await loadData();
      showToast({
        message: `Saved and refreshed ${record.idol.displayName}`,
        detail: `${result.musicRefresh.importedRows} song${result.musicRefresh.importedRows === 1 ? "" : "s"} imported.`,
        tone: "success"
      });
    } catch (nextError) {
      showToast({
        message: "Could not save talent",
        detail: nextError instanceof Error ? nextError.message : "Try again.",
        tone: "error"
      });
    } finally {
      setSaving(false);
    }
  }

  async function refreshTalent(idol: HololiveIdol) {
    setRefreshingId(idol.id);
    try {
      const result = await api.invoke("hololive:custom-talents:refresh", {
        idolId: idol.id,
        includeRelationships: true,
        includeCollabs: true
      });
      await loadData();
      showToast({
        message: `Refreshed ${idol.displayName}`,
        detail:
          `${result.musicRefresh.importedRows} song${result.musicRefresh.importedRows === 1 ? "" : "s"}, ` +
          `${result.videoStatsRefresh.updatedVideos} video stat${result.videoStatsRefresh.updatedVideos === 1 ? "" : "s"}.`,
        tone: "success"
      });
    } catch (nextError) {
      showToast({
        message: `Could not refresh ${idol.displayName}`,
        detail: nextError instanceof Error ? nextError.message : "Try again.",
        tone: "error"
      });
    } finally {
      setRefreshingId(null);
    }
  }

  async function refreshOfficialData() {
    setRefreshingOfficial(true);
    showToast({ message: "Refreshing official Hololive songs and video stats", tone: "info" });
    try {
      const result = await api.invoke("hololive:official-data:refresh", {
        includeRelationships: true,
        includeCollabs: true,
        replaceExisting: false
      });
      await loadData();
      const failedStats =
        result.videoStatsRefresh.failedBatches > 0 ? ` (${result.videoStatsRefresh.failedBatches} stat batch failed)` : "";
      if (result.musicRefresh.run.status === "failed") {
        showToast({
          message: "Official refresh partially completed",
          detail:
            `${result.channelRefresh.refreshedChannels} channels, ${result.videoStatsRefresh.updatedVideos} view counts${failedStats}. ` +
            (result.musicRefresh.run.error ?? "Holodex music refresh failed."),
          tone: "error"
        });
      } else {
        showToast({
          message: "Hololive refresh complete",
          detail:
            `${result.channelRefresh.refreshedChannels} channels, ${result.musicRefresh.importedRows} songs, ` +
            `${result.videoStatsRefresh.updatedVideos} view counts${failedStats}.`,
          tone: "success"
        });
      }
    } catch (nextError) {
      showToast({
        message: "Could not refresh official Hololive data",
        detail: nextError instanceof Error ? nextError.message : "Try again.",
        tone: "error"
      });
    } finally {
      setRefreshingOfficial(false);
    }
  }

  async function refreshAllCustomTalents() {
    setRefreshingCustomAll(true);
    showToast({ message: "Refreshing all custom talents", tone: "info" });
    try {
      const result = await api.invoke("hololive:custom-talents:refresh-all", {
        includeRelationships: true,
        includeCollabs: true
      });
      await loadData();
      const importedRows = result.musicRefreshes.reduce((total, refresh) => total + refresh.importedRows, 0);
      const failed = result.musicRefreshes.filter((refresh) => refresh.run.status === "failed");
      const failedStats =
        result.videoStatsRefresh.failedBatches > 0 ? ` (${result.videoStatsRefresh.failedBatches} stat batch failed)` : "";
      showToast({
        message: failed.length > 0 ? "Custom refresh partially completed" : "Custom refresh complete",
        detail:
          `${result.refreshedTalents} talent${result.refreshedTalents === 1 ? "" : "s"}, ${importedRows} songs, ` +
          `${result.videoStatsRefresh.updatedVideos} view counts${failedStats}.` +
          (failed[0]?.run.error ? ` ${failed[0].run.error}` : ""),
        tone: failed.length > 0 ? "error" : "success"
      });
    } catch (nextError) {
      showToast({
        message: "Could not refresh custom talents",
        detail: nextError instanceof Error ? nextError.message : "Try again.",
        tone: "error"
      });
    } finally {
      setRefreshingCustomAll(false);
    }
  }

  async function performDeleteTalent(idol: HololiveIdol) {
    setDeletingId(idol.id);
    try {
      const nextTierData = await api.invoke("hololive:custom-talents:delete", { idolId: idol.id });
      setTierData(nextTierData);
      setChannels(await api.invoke("hololive:channels:list", null));
      showToast({ message: `Removed ${idol.displayName}`, tone: "success" });
    } catch (nextError) {
      showToast({
        message: `Could not remove ${idol.displayName}`,
        detail: nextError instanceof Error ? nextError.message : "Try again.",
        tone: "error"
      });
    } finally {
      setDeletingId(null);
    }
  }

  function deleteTalent(idol: HololiveIdol) {
    showToast({
      message: `Remove ${idol.displayName}?`,
      detail: "Playlists and ratings stay linked by YouTube video ID.",
      tone: "error",
      actionLabel: "Remove",
      onAction: () => performDeleteTalent(idol)
    });
  }

  async function handleCustomSongSaved(_song: HololiveMusicRow) {
    setEditingCustomSong(null);
    await loadData();
  }

  async function handleCustomSongDeleted() {
    setEditingCustomSong(null);
    await loadData();
  }

  function openImportSongPanel() {
    setEditingCustomSong(null);
    setCustomSongPanelOpen(true);
  }

  function openEditSongPanel(song: HololiveMusicRow) {
    setEditingCustomSong(song);
    setCustomSongPanelOpen(true);
  }

  function closeCustomSongPanel() {
    setCustomSongPanelOpen(false);
    setEditingCustomSong(null);
  }

  return (
    <section
      className="hololive-page hololive-custom-import-page hololive-custom-import-layout"
      aria-label="Hololive custom imports"
    >
      <HololiveViewSwitch />

      <div className="hololive-refresh-strip" aria-label="Hololive data refresh actions">
        <button
          type="button"
          onClick={() => void refreshOfficialData()}
          disabled={refreshingOfficial || refreshingCustomAll || saving || resolving || refreshingId !== null}
          title="Refresh official Hololive songs and video stats without replacing the catalog"
        >
          {refreshingOfficial ? <Loader2 size={12} className="spin" /> : <RefreshCcw size={12} />}
          Hololive Songs + Stats
        </button>
        <button
          type="button"
          onClick={() => void refreshAllCustomTalents()}
          disabled={refreshingOfficial || refreshingCustomAll || saving || resolving || refreshingId !== null || customTalents.length === 0}
          title="Refresh every saved custom talent"
        >
          {refreshingCustomAll ? <Loader2 size={12} className="spin" /> : <RefreshCcw size={12} />}
          All Custom
        </button>
        <button
          type="button"
          onClick={openImportSongPanel}
          disabled={refreshingOfficial || refreshingCustomAll || saving || resolving || refreshingId !== null}
          title="Import a custom YouTube song"
        >
          <Music size={12} />
          Import Song
        </button>
      </div>

      <section className="hololive-talents-grid">
        <div className="hololive-custom-import-column">
          <form
            className="hololive-talents-panel hololive-talent-form"
            onSubmit={(event) => {
              event.preventDefault();
              void saveTalent();
            }}
          >
            <div className="hololive-talents-panel-head">
              <strong>Add Talent</strong>
              <span>Handle, URL, Holodex search, or channel ID</span>
            </div>
            <label>
              <span>Channel</span>
              <input
                value={form.channelInput}
                onChange={(event) => setForm((current) => ({ ...current, channelInput: event.target.value }))}
                placeholder="@SoradukiTyra or UC..."
                autoComplete="off"
              />
            </label>
            <div className="hololive-talent-form-grid">
              <label>
                <span>Name</span>
                <input
                  value={form.displayName ?? ""}
                  onChange={(event) => setForm((current) => ({ ...current, displayName: event.target.value }))}
                  placeholder="Optional override"
                  autoComplete="off"
                />
              </label>
              <label>
                <span>Overview image</span>
                <input
                  value={form.cardImageUrl ?? ""}
                  onChange={(event) => setForm((current) => ({ ...current, cardImageUrl: event.target.value }))}
                  placeholder="Optional portrait image URL"
                  type="url"
                  autoComplete="off"
                />
              </label>
              <label>
                <span>Originals URL</span>
                <input
                  value={form.originalSongsUrl ?? ""}
                  onChange={(event) => setForm((current) => ({ ...current, originalSongsUrl: event.target.value }))}
                  placeholder="Optional Holodex search URL"
                  autoComplete="off"
                />
              </label>
              <label>
                <span>Covers URL</span>
                <input
                  value={form.coversUrl ?? ""}
                  onChange={(event) => setForm((current) => ({ ...current, coversUrl: event.target.value }))}
                  placeholder="Optional Holodex search URL"
                  autoComplete="off"
                />
              </label>
            </div>
            <div className="hololive-talents-actions">
              <button type="button" onClick={() => void resolveTalent()} disabled={resolving || saving || !form.channelInput.trim()}>
                {resolving ? <Loader2 size={13} className="spin" /> : <Search size={13} />}
                Resolve
              </button>
              <button className="primary" type="submit" disabled={saving || resolving || !form.channelInput.trim()}>
                {saving ? <Loader2 size={13} className="spin" /> : <Plus size={13} />}
                Save
              </button>
            </div>
            {preview ? (
              <div className="hololive-talent-preview">
                <img src={preview.iconUrl} alt="" />
                <div>
                  <strong>{preview.displayName}</strong>
                  <span>{preview.nativeName ? `${preview.nativeName} / ` : ""}{preview.branch}</span>
                  <small>{preview.channelId}</small>
                </div>
                <dl>
                  <div>
                    <dt>Subscribers</dt>
                    <dd>{formatCount(preview.subscriberCount)}</dd>
                  </div>
                  <div>
                    <dt>Videos</dt>
                    <dd>{formatCount(preview.videoCount)}</dd>
                  </div>
                  <div>
                    <dt>Clips</dt>
                    <dd>{formatCount(preview.clipCount)}</dd>
                  </div>
                </dl>
              </div>
            ) : null}
          </form>
        </div>

        <div className="hololive-custom-management-column">
          <section className="hololive-talents-panel hololive-custom-talent-list" aria-label="Custom talents">
            <div className="hololive-talents-panel-head">
              <div>
                <strong>Custom Talents</strong>
                <span>{loading ? "Loading" : `${customTalents.length} saved`}</span>
              </div>
              <button
                className="hololive-talents-head-action"
                type="button"
                onClick={() => void refreshAllCustomTalents()}
                disabled={refreshingOfficial || refreshingCustomAll || saving || resolving || refreshingId !== null || customTalents.length === 0}
                title="Refresh every saved custom talent"
              >
                {refreshingCustomAll ? <Loader2 size={12} className="spin" /> : <RefreshCcw size={12} />}
                Refresh All
              </button>
            </div>
            <div className="hololive-custom-talent-rows">
              {customTalents.map((idol) => {
                const channel = channelForIdol(idol, channels);
                const busy = refreshingId === idol.id || deletingId === idol.id;

                return (
                  <article className="hololive-custom-talent-row" key={idol.id}>
                    <img src={idol.cachedIconUrl ?? idol.iconUrl} alt="" />
                    <div className="hololive-custom-talent-main">
                      <strong>{idol.displayName}</strong>
                      <span>{idol.branch} / {idol.generation}</span>
                      <small>{idol.youtubeChannelId}</small>
                    </div>
                    <dl>
                      <div>
                        <dt>Subs</dt>
                        <dd>{formatCount(channel?.subscriberCount)}</dd>
                      </div>
                      <div>
                        <dt>Videos</dt>
                        <dd>{formatCount(channel?.videoCount)}</dd>
                      </div>
                      <div>
                        <dt>Clips</dt>
                        <dd>{formatCount(channel?.clipCount)}</dd>
                      </div>
                    </dl>
                    <div className="hololive-custom-talent-actions">
                      <button
                        type="button"
                        onClick={() => void refreshTalent(idol)}
                        disabled={busy}
                        title={`Refresh ${idol.displayName}`}
                        aria-label={`Refresh ${idol.displayName}`}
                      >
                        {refreshingId === idol.id ? <Loader2 size={13} className="spin" /> : <RefreshCcw size={13} />}
                      </button>
                      <button
                        className="danger"
                        type="button"
                        onClick={() => void deleteTalent(idol)}
                        disabled={busy}
                        title={`Remove ${idol.displayName}`}
                        aria-label={`Remove ${idol.displayName}`}
                      >
                        {deletingId === idol.id ? <Loader2 size={13} className="spin" /> : <Trash2 size={13} />}
                      </button>
                    </div>
                  </article>
                );
              })}
              {!loading && customTalents.length === 0 ? (
                <div className="hololive-custom-talent-empty">
                  <Check size={14} />
                  <span>No custom talents yet.</span>
                </div>
              ) : null}
            </div>
          </section>

          <section className="hololive-talents-panel hololive-custom-song-list" aria-label="Custom songs">
            <div className="hololive-talents-panel-head">
              <div>
                <strong>Custom Songs</strong>
                <span>{loading ? "Loading" : `${customSongs.length} saved`}</span>
              </div>
              <button
                className="hololive-talents-head-action"
                type="button"
                onClick={openImportSongPanel}
                disabled={refreshingOfficial || refreshingCustomAll || saving || resolving || refreshingId !== null}
                title="Import a custom YouTube song"
              >
                <Music size={12} />
                Import
              </button>
            </div>
            <div className="hololive-custom-song-rows">
              {customSongs.map((song) => (
                <article className="hololive-custom-song-row" key={song.youtubeVideoId}>
                  <div className="hololive-custom-song-row-main">
                    <strong title={song.songName || song.title}>{song.songName || song.title}</strong>
                    <span>{song.channelName} / {song.topicId === "Original_Song" ? "Original" : "Cover"}</span>
                    <small>{song.youtubeVideoId}</small>
                  </div>
                  <button
                    type="button"
                    onClick={() => openEditSongPanel(song)}
                    disabled={refreshingOfficial || refreshingCustomAll || saving || resolving || refreshingId !== null}
                    title={`Edit ${song.songName || song.title}`}
                    aria-label={`Edit ${song.songName || song.title}`}
                  >
                    <Music size={13} />
                    Edit
                  </button>
                </article>
              ))}
              {!loading && customSongs.length === 0 ? (
                <div className="hololive-custom-talent-empty">
                  <Check size={14} />
                  <span>No custom songs yet.</span>
                </div>
              ) : null}
            </div>
          </section>
        </div>
      </section>
      <HololiveCustomSongImportPanel
        open={customSongPanelOpen}
        talents={tierData?.idols ?? []}
        song={editingCustomSong}
        onClose={closeCustomSongPanel}
        onSaved={handleCustomSongSaved}
        onDeleted={handleCustomSongDeleted}
      />
    </section>
  );
}
