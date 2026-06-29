import { Database, KeyRound, RefreshCw, RotateCcw, Save, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { AppBootstrap } from "../../shared/contracts";
import type { UpdateStatus } from "../../shared/ipc";
import { api } from "../api";
import { HololiveViewSwitch } from "../components/HololiveViewSwitch";

interface SettingsPageProps {
  bootstrap: AppBootstrap;
}

export function SettingsPage({ bootstrap }: SettingsPageProps) {
  const [holodexApiKey, setHolodexApiKey] = useState("");
  const [youtubeApiKey, setYoutubeApiKey] = useState("");
  const [officialDataVersion, setOfficialDataVersion] = useState("");
  const [officialDataMergedAt, setOfficialDataMergedAt] = useState("");
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [checkingForUpdates, setCheckingForUpdates] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const savedTimerRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    void api
      .invoke("settings:get", null)
      .then((settings) => {
        if (!cancelled) {
          applySettings(settings);
          setSettingsError(null);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setSettingsError(error instanceof Error ? error.message : "Could not load settings.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setSettingsLoading(false);
        }
      });
    void api
      .invoke("updates:status", null)
      .then((status) => {
        if (!cancelled) {
          setUpdateStatus(status);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setSettingsError(error instanceof Error ? error.message : "Could not load update status.");
        }
      });
    const removeUpdateListener = api.onUpdateStatus((status) => {
      if (!cancelled) {
        setUpdateStatus(status);
        if (status.state !== "checking") {
          setCheckingForUpdates(false);
        }
      }
    });

    return () => {
      cancelled = true;
      removeUpdateListener();
      if (savedTimerRef.current !== null) {
        window.clearTimeout(savedTimerRef.current);
      }
    };
  }, []);

  function applySettings(settings: Record<string, string>) {
    setHolodexApiKey(settings["sources.holodexApiKey"] ?? "");
    setYoutubeApiKey(settings["sources.youtubeApiKey"] ?? "");
    setOfficialDataVersion(settings["hololive.officialDataVersion"] ?? "");
    setOfficialDataMergedAt(settings["hololive.officialDataMergedAt"] ?? "");
  }

  async function save() {
    setSaving(true);
    setSettingsError(null);
    try {
      await api.invoke("settings:set", {
        key: "sources.holodexApiKey",
        value: holodexApiKey.trim()
      });
      const nextSettings = await api.invoke("settings:set", {
        key: "sources.youtubeApiKey",
        value: youtubeApiKey.trim()
      });
      applySettings(nextSettings);
      setSaved(true);
      if (savedTimerRef.current !== null) {
        window.clearTimeout(savedTimerRef.current);
      }
      savedTimerRef.current = window.setTimeout(() => {
        setSaved(false);
        savedTimerRef.current = null;
      }, 1600);
    } catch (error) {
      setSettingsError(error instanceof Error ? error.message : "Could not save settings.");
    } finally {
      setSaving(false);
    }
  }

  async function checkForUpdates() {
    setCheckingForUpdates(true);
    setSettingsError(null);
    try {
      setUpdateStatus(await api.invoke("updates:check", null));
    } catch (error) {
      setSettingsError(error instanceof Error ? error.message : "Could not check for updates.");
    } finally {
      setCheckingForUpdates(false);
    }
  }

  async function restartToInstall() {
    setSettingsError(null);
    try {
      setUpdateStatus(await api.invoke("updates:install", null));
    } catch (error) {
      setSettingsError(error instanceof Error ? error.message : "Could not restart into the update.");
    }
  }

  function formatDateTime(value: string): string {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
  }

  const updateSupported = Boolean(updateStatus?.isUpdateSupported);
  const updateReady = updateStatus?.state === "downloaded";
  const settingsBusy = settingsLoading || saving;
  const mergedAtLabel = officialDataMergedAt ? formatDateTime(officialDataMergedAt) : "";
  const officialDataStatus = officialDataVersion
    ? `Version ${officialDataVersion}${mergedAtLabel ? ` merged ${mergedAtLabel}` : ""}`
    : "Official data has not been merged.";

  return (
    <div className="page hololive-page hololive-settings-page">
      <section className="hololive-settings-workspace" aria-label="Holoshelf settings">
        <HololiveViewSwitch />

        <div className="hololive-settings-grid">
          <section className="hololive-settings-panel">
            <header>
              <KeyRound size={16} />
              <strong>API Keys</strong>
            </header>
            <label className="settings-field">
              <span>Holodex</span>
              <input
                type="password"
                value={holodexApiKey}
                disabled={settingsBusy}
                onChange={(event) => setHolodexApiKey(event.target.value)}
                placeholder="optional Holodex API key"
              />
            </label>
            <label className="settings-field">
              <span>YouTube Data</span>
              <input
                type="password"
                value={youtubeApiKey}
                disabled={settingsBusy}
                onChange={(event) => setYoutubeApiKey(event.target.value)}
                placeholder="optional YouTube Data API key"
              />
            </label>
            <div className="settings-action-row">
              <button className="button primary" disabled={settingsBusy} onClick={() => void save()}>
                <Save size={16} />
                <span>{saving ? "Saving" : "Save"}</span>
              </button>
              {saved ? <div className="result-line">Saved.</div> : null}
            </div>
          </section>

          <section className="hololive-settings-panel">
            <header>
              <RefreshCw size={16} />
              <strong>Updates</strong>
            </header>
            <div className="settings-action-row">
              <button
                className="button"
                disabled={!updateSupported || checkingForUpdates || updateStatus?.state === "checking"}
                onClick={() => void checkForUpdates()}
              >
                <RefreshCw size={16} />
                <span>{checkingForUpdates || updateStatus?.state === "checking" ? "Checking" : "Update now"}</span>
              </button>
              {updateReady ? (
                <button className="button primary" onClick={() => void restartToInstall()}>
                  <RotateCcw size={16} />
                  <span>Restart to update</span>
                </button>
              ) : null}
            </div>
            <div className={`settings-status ${updateStatus?.state ?? "idle"}`}>
              {updateStatus?.message ?? "Loading update status."}
            </div>
            {updateStatus?.error ? <div className="result-line error">{updateStatus.error}</div> : null}
          </section>

          <section className="hololive-settings-panel">
            <header>
              <ShieldCheck size={16} />
              <strong>Official Data</strong>
            </header>
            <div className="settings-status">{officialDataStatus}</div>
          </section>

          <section className="hololive-settings-panel storage">
            <header>
              <Database size={16} />
              <strong>Storage</strong>
            </header>
            <label className="settings-field">
              <span>Data Directory</span>
              <input value={bootstrap.dataDirectory} readOnly />
            </label>
            <label className="settings-field">
              <span>Database</span>
              <input value={bootstrap.databasePath} readOnly />
            </label>
            <label className="settings-field">
              <span>Backups</span>
              <input value={bootstrap.backupDirectory} readOnly />
            </label>
            <label className="settings-field">
              <span>Mode</span>
              <input value={bootstrap.dataLocationKind} readOnly />
            </label>
          </section>
        </div>

        {settingsLoading ? <div className="result-line">Loading settings.</div> : null}
        {settingsError ? <div className="result-line error">{settingsError}</div> : null}
      </section>
    </div>
  );
}
