import { useEffect, useMemo, useState } from "react";
import { Check, Loader2, Plus, RefreshCcw, Search, Trash2 } from "lucide-react";
import type {
  HolodexChannel,
  HololiveCustomTalentInput,
  HololiveCustomTalentPreview,
  HololiveIdol,
  HololiveTierListData
} from "../../shared/contracts";
import { api } from "../api";
import { HololiveViewSwitch } from "../components/HololiveViewSwitch";

const emptyInput: HololiveCustomTalentInput = {
  channelInput: "",
  displayName: "",
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

export function HololiveTalentsPage() {
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
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const customTalents = useMemo(
    () => (tierData?.idols ?? []).filter((idol) => idol.source === "custom"),
    [tierData]
  );

  async function loadData() {
    setLoading(true);
    try {
      const [nextTierData, nextChannels] = await Promise.all([
        api.invoke("hololive:tier-data", null),
        api.invoke("hololive:channels:list", null)
      ]);
      setTierData(nextTierData);
      setChannels(nextChannels);
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Could not load talents.");
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
        setMessage(progress.message);
      }
    });
  }, []);

  async function resolveTalent() {
    const payload = customTalentInput(form);
    if (!payload.channelInput) {
      setError("Enter a YouTube handle, channel URL, Holodex link, or channel ID.");
      return;
    }

    setResolving(true);
    setMessage(null);
    try {
      const nextPreview = await api.invoke("hololive:custom-talents:resolve", payload);
      setPreview(nextPreview);
      setError(null);
      setMessage(`Resolved ${nextPreview.displayName}.`);
      if (!form.displayName?.trim()) {
        setForm((current) => ({ ...current, displayName: nextPreview.displayName }));
      }
    } catch (nextError) {
      setPreview(null);
      setError(nextError instanceof Error ? nextError.message : "Could not resolve talent.");
    } finally {
      setResolving(false);
    }
  }

  async function saveTalent() {
    const payload = customTalentInput(form);
    if (!payload.channelInput) {
      setError("Enter a YouTube handle, channel URL, Holodex link, or channel ID.");
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      const record = await api.invoke("hololive:custom-talents:upsert", payload);
      setMessage(`Saved ${record.idol.displayName}. Refreshing music...`);
      setForm(emptyInput);
      setPreview(null);
      const result = await api.invoke("hololive:custom-talents:refresh", {
        idolId: record.idol.id,
        includeRelationships: true,
        includeCollabs: true
      });
      await loadData();
      setMessage(
        `Saved and refreshed ${record.idol.displayName}: ${result.musicRefresh.importedRows} song${
          result.musicRefresh.importedRows === 1 ? "" : "s"
        }.`
      );
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Could not save talent.");
    } finally {
      setSaving(false);
    }
  }

  async function refreshTalent(idol: HololiveIdol) {
    setRefreshingId(idol.id);
    setMessage(null);
    try {
      const result = await api.invoke("hololive:custom-talents:refresh", {
        idolId: idol.id,
        includeRelationships: true,
        includeCollabs: true
      });
      await loadData();
      setMessage(
        `Refreshed ${idol.displayName}: ${result.musicRefresh.importedRows} song${
          result.musicRefresh.importedRows === 1 ? "" : "s"
        }, ${result.videoStatsRefresh.updatedVideos} video stat${
          result.videoStatsRefresh.updatedVideos === 1 ? "" : "s"
        }.`
      );
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : `Could not refresh ${idol.displayName}.`);
    } finally {
      setRefreshingId(null);
    }
  }

  async function refreshOfficialData() {
    setRefreshingOfficial(true);
    setMessage("Refreshing official Hololive songs and video stats...");
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
        setMessage(
          `Partial refresh: ${result.channelRefresh.refreshedChannels} channels, ` +
            `${result.videoStatsRefresh.updatedVideos} view counts${failedStats}.`
        );
        setError(result.musicRefresh.run.error ?? "Holodex music refresh failed.");
      } else {
        setMessage(
          `Hololive refresh complete: ${result.channelRefresh.refreshedChannels} channels, ` +
            `${result.musicRefresh.importedRows} songs, ${result.videoStatsRefresh.updatedVideos} view counts${failedStats}.`
        );
        setError(null);
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Could not refresh official Hololive data.");
    } finally {
      setRefreshingOfficial(false);
    }
  }

  async function refreshAllCustomTalents() {
    setRefreshingCustomAll(true);
    setMessage("Refreshing all custom talents...");
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
      setMessage(
        `Custom refresh complete: ${result.refreshedTalents} talent${result.refreshedTalents === 1 ? "" : "s"}, ` +
          `${importedRows} songs, ${result.videoStatsRefresh.updatedVideos} view counts${failedStats}.`
      );
      setError(failed[0]?.run.error ?? null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Could not refresh custom talents.");
    } finally {
      setRefreshingCustomAll(false);
    }
  }

  async function deleteTalent(idol: HololiveIdol) {
    if (!window.confirm(`Remove ${idol.displayName} from custom talents? Their playlists and ratings stay by YouTube ID.`)) {
      return;
    }

    setDeletingId(idol.id);
    setMessage(null);
    try {
      const nextTierData = await api.invoke("hololive:custom-talents:delete", { idolId: idol.id });
      setTierData(nextTierData);
      setChannels(await api.invoke("hololive:channels:list", null));
      setMessage(`Removed ${idol.displayName}.`);
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : `Could not remove ${idol.displayName}.`);
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="page hololive-page hololive-talents-page">
      <section className="hololive-talents-workspace" aria-label="Hololive custom talent imports">
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
        </div>

        <section className="hololive-talents-grid">
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
            {message ? <p className="hololive-talents-message">{message}</p> : null}
            {error ? <p className="hololive-talents-error">{error}</p> : null}
          </form>

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
        </section>
      </section>
    </div>
  );
}
