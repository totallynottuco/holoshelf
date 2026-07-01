import { Archive, ChevronDown, Database, FolderOpen, KeyRound, RefreshCw, RotateCcw, Save, ShieldCheck, Trash2, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import type { AppBootstrap } from "../../shared/contracts";
import type { UpdateStatus } from "../../shared/ipc";
import { api } from "../api";
import { useHololiveActionToast } from "../components/HololiveActionToast";
import { HololiveViewSwitch } from "../components/HololiveViewSwitch";

interface SettingsPageProps {
  bootstrap: AppBootstrap;
}

type SettingsSectionId = "updates" | "dataSafety" | "apiKeys" | "officialData" | "storage";

export function SettingsPage({ bootstrap }: SettingsPageProps) {
  const { showToast } = useHololiveActionToast();
  const [holodexApiKey, setHolodexApiKey] = useState("");
  const [youtubeApiKey, setYoutubeApiKey] = useState("");
  const [officialDataVersion, setOfficialDataVersion] = useState("");
  const [officialDataMergedAt, setOfficialDataMergedAt] = useState("");
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [checkingForUpdates, setCheckingForUpdates] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dataSafetyBusy, setDataSafetyBusy] = useState(false);
  const [openSettingsSections, setOpenSettingsSections] = useState<Record<SettingsSectionId, boolean>>({
    updates: true,
    dataSafety: false,
    apiKeys: false,
    officialData: false,
    storage: false
  });

  useEffect(() => {
    let cancelled = false;

    void api
      .invoke("settings:get", null)
      .then((settings) => {
        if (!cancelled) {
          applySettings(settings);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          showToast({
            message: "Could not load settings",
            detail: error instanceof Error ? error.message : "Try reopening Settings.",
            tone: "error"
          });
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
          showToast({
            message: "Could not load update status",
            detail: error instanceof Error ? error.message : "Try again in a moment.",
            tone: "error"
          });
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
      showToast({ message: "Settings saved", tone: "success" });
    } catch (error) {
      showToast({
        message: "Could not save settings",
        detail: error instanceof Error ? error.message : "Try again.",
        tone: "error"
      });
    } finally {
      setSaving(false);
    }
  }

  async function checkForUpdates() {
    setCheckingForUpdates(true);
    try {
      const status = await api.invoke("updates:check", null);
      setUpdateStatus(status);
      if (status.state === "not-available") {
        showToast({ message: "Holoshelf is up to date", tone: "success" });
      } else if (status.state === "available" || status.state === "downloading" || status.state === "downloaded") {
        showToast({ message: "Update found", detail: status.message, tone: "success" });
      } else if (status.state === "unsupported") {
        showToast({ message: "Updates unavailable in this build", detail: status.message, tone: "info" });
      } else if (status.state === "error") {
        showToast({ message: "Update check failed", detail: status.error ?? status.message, tone: "error" });
      }
    } catch (error) {
      showToast({
        message: "Could not check for updates",
        detail: error instanceof Error ? error.message : "Try again later.",
        tone: "error"
      });
    } finally {
      setCheckingForUpdates(false);
    }
  }

  async function restartToInstall() {
    try {
      setUpdateStatus(await api.invoke("updates:install", null));
    } catch (error) {
      showToast({
        message: "Could not restart into the update",
        detail: error instanceof Error ? error.message : "Try restarting Holoshelf manually.",
        tone: "error"
      });
    }
  }

  async function openDataFolder() {
    try {
      await api.invoke("app:open-path", { filePath: bootstrap.dataDirectory });
      showToast({ message: "Opened data folder", tone: "success" });
    } catch (error) {
      showToast({
        message: "Could not open the data folder",
        detail: error instanceof Error ? error.message : bootstrap.dataDirectory,
        tone: "error"
      });
    }
  }

  async function createBackup() {
    setDataSafetyBusy(true);
    try {
      const result = await api.invoke("app:data-backup:create", null);
      showToast({
        message: result.filePath ? "Backup created" : "No backup was created",
        detail: result.filePath ? fileNameFromPath(result.filePath) : undefined,
        tone: result.filePath ? "success" : "info"
      });
    } catch (error) {
      showToast({
        message: "Could not create a backup",
        detail: error instanceof Error ? error.message : "Try again.",
        tone: "error"
      });
    } finally {
      setDataSafetyBusy(false);
    }
  }

  async function performRestoreBackup() {
    setDataSafetyBusy(true);
    try {
      const result = await api.invoke("app:data-backup:restore", null);
      showToast({
        message: result.restored ? "Backup restored" : "Restore cancelled",
        detail: result.restored ? "Restarting Holoshelf." : undefined,
        tone: result.restored ? "success" : "info"
      });
    } catch (error) {
      showToast({
        message: "Could not restore from backup",
        detail: error instanceof Error ? error.message : "Try another backup file.",
        tone: "error"
      });
    } finally {
      setDataSafetyBusy(false);
    }
  }

  function restoreBackup() {
    showToast({
      message: "Restore from backup?",
      detail: "Holoshelf creates a safety backup first, then restarts after restoring.",
      tone: "info",
      actionLabel: "Restore",
      onAction: performRestoreBackup
    });
  }

  async function performResetLocalData() {
    setDataSafetyBusy(true);
    try {
      const result = await api.invoke("app:data:reset", null);
      showToast({
        message: result.reset ? "Local data reset" : "Reset cancelled",
        detail: result.reset ? "Restarting Holoshelf." : undefined,
        tone: result.reset ? "success" : "info"
      });
    } catch (error) {
      showToast({
        message: "Could not reset local data",
        detail: error instanceof Error ? error.message : "Try again.",
        tone: "error"
      });
    } finally {
      setDataSafetyBusy(false);
    }
  }

  function resetLocalData() {
    showToast({
      message: "Reset local data?",
      detail: "Holoshelf creates a safety backup first, then returns this profile to bundled defaults.",
      tone: "error",
      actionLabel: "Reset",
      onAction: performResetLocalData
    });
  }

  function formatDateTime(value: string): string {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
  }

  function fileNameFromPath(filePath: string): string {
    return filePath.split(/[\\/]/).filter(Boolean).at(-1) ?? filePath;
  }

  function formatDataLocationKind(kind: AppBootstrap["dataLocationKind"]): string {
    if (kind === "appData") {
      return "Standard app data";
    }
    if (kind === "custom") {
      return "Custom folder";
    }
    return "Development folder";
  }

  function updateStateLabel(status: UpdateStatus | null): string {
    switch (status?.state) {
      case "unsupported":
        return "Unavailable";
      case "checking":
        return "Checking";
      case "available":
        return "Update found";
      case "downloading":
        return "Downloading";
      case "downloaded":
        return "Ready to install";
      case "not-available":
        return "Up to date";
      case "error":
        return "Needs attention";
      case "idle":
      default:
        return "Ready";
    }
  }

  function toggleSettingsSection(sectionId: SettingsSectionId) {
    setOpenSettingsSections((current) => ({
      ...current,
      [sectionId]: !current[sectionId]
    }));
  }

  function sectionBodyId(sectionId: SettingsSectionId): string {
    return `holoshelf-settings-${sectionId}-body`;
  }

  function sectionClassName(sectionId: SettingsSectionId, extraClassName = ""): string {
    return ["hololive-settings-panel", extraClassName, openSettingsSections[sectionId] ? "open" : ""].filter(Boolean).join(" ");
  }

  const updateSupported = Boolean(updateStatus?.isUpdateSupported);
  const updateReady = updateStatus?.state === "downloaded";
  const settingsBusy = settingsLoading || saving;
  const mergedAtLabel = officialDataMergedAt ? formatDateTime(officialDataMergedAt) : "";
  const updateDetail =
    updateStatus?.state === "downloading" && typeof updateStatus.percent === "number"
      ? `${updateStatus.message} (${Math.round(updateStatus.percent)}%)`
      : updateStatus?.message ?? "Loading update status.";
  const officialDataLabel = officialDataVersion || "Not recorded";
  const lastMergeLabel = mergedAtLabel || "Not yet";
  const dataLocationLabel = formatDataLocationKind(bootstrap.dataLocationKind);

  return (
    <div className="page hololive-page hololive-settings-page">
      <section className="hololive-settings-workspace" aria-label="Holoshelf settings">
        <HololiveViewSwitch />

        <div className="hololive-settings-header">
          <div>
            <h1>Settings</h1>
          </div>
          <div className="hololive-settings-header-pills" aria-label="Settings status">
            <span>
              <ShieldCheck size={14} />
              Official data: {officialDataLabel}
            </span>
            <span>
              <Database size={14} />
              {dataLocationLabel}
            </span>
          </div>
        </div>

        <div className="hololive-settings-grid">
          <section className={sectionClassName("updates", "updates")}>
            <button
              type="button"
              className="hololive-settings-panel-header"
              aria-expanded={openSettingsSections.updates}
              aria-controls={sectionBodyId("updates")}
              onClick={() => toggleSettingsSection("updates")}
            >
              <RefreshCw size={16} />
              <div>
                <strong>App Updates</strong>
              </div>
              <ChevronDown className="settings-accordion-chevron" size={15} aria-hidden="true" />
            </button>
            {openSettingsSections.updates ? (
              <div id={sectionBodyId("updates")} className="settings-panel-body">
                <div className={`settings-status-card ${updateStatus?.state ?? "idle"}`}>
                  <span>{updateStateLabel(updateStatus)}</span>
                  <strong>{updateDetail}</strong>
                </div>
                <div className="settings-action-row">
                  <button
                    className="button primary"
                    disabled={!updateSupported || checkingForUpdates || updateStatus?.state === "checking"}
                    onClick={() => void checkForUpdates()}
                  >
                    <RefreshCw size={16} />
                    <span>{checkingForUpdates || updateStatus?.state === "checking" ? "Checking" : "Update now"}</span>
                  </button>
                  {updateReady ? (
                    <button className="button" onClick={() => void restartToInstall()}>
                      <RotateCcw size={16} />
                      <span>Restart to update</span>
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}
          </section>

          <section className={sectionClassName("dataSafety", "data-safety")}>
            <button
              type="button"
              className="hololive-settings-panel-header"
              aria-expanded={openSettingsSections.dataSafety}
              aria-controls={sectionBodyId("dataSafety")}
              onClick={() => toggleSettingsSection("dataSafety")}
            >
              <Archive size={16} />
              <div>
                <strong>Data Safety</strong>
              </div>
              <ChevronDown className="settings-accordion-chevron" size={15} aria-hidden="true" />
            </button>
            {openSettingsSections.dataSafety ? (
              <div id={sectionBodyId("dataSafety")} className="settings-panel-body">
                <div className="settings-action-grid">
                  <button className="settings-action-tile" disabled={dataSafetyBusy} onClick={() => void openDataFolder()}>
                    <FolderOpen size={16} />
                    <span>
                      <strong>Open data folder</strong>
                    </span>
                  </button>
                  <button className="settings-action-tile" disabled={dataSafetyBusy} onClick={() => void createBackup()}>
                    <Archive size={16} />
                    <span>
                      <strong>Create backup</strong>
                    </span>
                  </button>
                  <button className="settings-action-tile" disabled={dataSafetyBusy} onClick={() => void restoreBackup()}>
                    <Upload size={16} />
                    <span>
                      <strong>Restore backup</strong>
                    </span>
                  </button>
                  <button className="settings-action-tile danger" disabled={dataSafetyBusy} onClick={() => void resetLocalData()}>
                    <Trash2 size={16} />
                    <span>
                      <strong>Reset local data</strong>
                    </span>
                  </button>
                </div>
              </div>
            ) : null}
          </section>

          <section className={sectionClassName("apiKeys", "api-keys")}>
            <button
              type="button"
              className="hololive-settings-panel-header"
              aria-expanded={openSettingsSections.apiKeys}
              aria-controls={sectionBodyId("apiKeys")}
              onClick={() => toggleSettingsSection("apiKeys")}
            >
              <KeyRound size={16} />
              <div>
                <strong>API Keys</strong>
              </div>
              <ChevronDown className="settings-accordion-chevron" size={15} aria-hidden="true" />
            </button>
            {openSettingsSections.apiKeys ? (
              <div id={sectionBodyId("apiKeys")} className="settings-panel-body">
                <div className="settings-field-grid">
                  <label className="settings-field">
                    <span>Holodex</span>
                    <input
                      type="password"
                      value={holodexApiKey}
                      disabled={settingsBusy}
                      onChange={(event) => setHolodexApiKey(event.target.value)}
                      placeholder="Optional Holodex API key"
                    />
                  </label>
                  <label className="settings-field">
                    <span>YouTube Data</span>
                    <input
                      type="password"
                      value={youtubeApiKey}
                      disabled={settingsBusy}
                      onChange={(event) => setYoutubeApiKey(event.target.value)}
                      placeholder="Optional YouTube Data API key"
                    />
                  </label>
                </div>
                <div className="settings-panel-footer">
                  <button className="button primary" disabled={settingsBusy} onClick={() => void save()}>
                    <Save size={16} />
                    <span>{saving ? "Saving" : "Save"}</span>
                  </button>
                </div>
              </div>
            ) : null}
          </section>

          <section className={sectionClassName("officialData", "official-data")}>
            <button
              type="button"
              className="hololive-settings-panel-header"
              aria-expanded={openSettingsSections.officialData}
              aria-controls={sectionBodyId("officialData")}
              onClick={() => toggleSettingsSection("officialData")}
            >
              <ShieldCheck size={16} />
              <div>
                <strong>Official Data</strong>
              </div>
              <ChevronDown className="settings-accordion-chevron" size={15} aria-hidden="true" />
            </button>
            {openSettingsSections.officialData ? (
              <div id={sectionBodyId("officialData")} className="settings-panel-body">
                <div className="settings-stat-grid">
                  <div>
                    <span>Version</span>
                    <strong>{officialDataLabel}</strong>
                  </div>
                  <div>
                    <span>Last merge</span>
                    <strong>{lastMergeLabel}</strong>
                  </div>
                </div>
              </div>
            ) : null}
          </section>

          <section className={sectionClassName("storage", "storage")}>
            <button
              type="button"
              className="hololive-settings-panel-header"
              aria-expanded={openSettingsSections.storage}
              aria-controls={sectionBodyId("storage")}
              onClick={() => toggleSettingsSection("storage")}
            >
              <Database size={16} />
              <div>
                <strong>Local Storage</strong>
              </div>
              <ChevronDown className="settings-accordion-chevron" size={15} aria-hidden="true" />
            </button>
            {openSettingsSections.storage ? (
              <div id={sectionBodyId("storage")} className="settings-panel-body">
                <div className="settings-path-list">
                  <div>
                    <span>Data folder</span>
                    <code title={bootstrap.dataDirectory}>{bootstrap.dataDirectory}</code>
                  </div>
                  <div>
                    <span>Database</span>
                    <code title={bootstrap.databasePath}>{bootstrap.databasePath}</code>
                  </div>
                  <div>
                    <span>Backups</span>
                    <code title={bootstrap.backupDirectory}>{bootstrap.backupDirectory}</code>
                  </div>
                  <div>
                    <span>Mode</span>
                    <code>{dataLocationLabel}</code>
                  </div>
                </div>
              </div>
            ) : null}
          </section>
        </div>
      </section>
    </div>
  );
}
