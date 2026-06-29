import type { BrowserWindow, WebContents } from "electron";
import { autoUpdater } from "electron-updater";
import type { ProgressInfo, UpdateCheckResult, UpdateDownloadedEvent, UpdateInfo } from "electron-updater";
import type { UpdateStatus, UpdateStatusState } from "../../src/shared/ipc";

interface UpdaterLogger {
  info(message?: unknown): void;
  warn(message?: unknown): void;
  error(message?: unknown): void;
  debug?(message: string): void;
}

export interface UpdateDriver {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  logger: UpdaterLogger | null;
  on(event: "checking-for-update", listener: () => void): unknown;
  on(event: "update-available", listener: (info: UpdateInfo) => void): unknown;
  on(event: "update-not-available", listener: (info: UpdateInfo) => void): unknown;
  on(event: "download-progress", listener: (info: ProgressInfo) => void): unknown;
  on(event: "update-downloaded", listener: (event: UpdateDownloadedEvent) => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
  checkForUpdates(): Promise<UpdateCheckResult | null>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
}

export interface UpdateServiceOptions {
  isPackaged: boolean;
  driver?: UpdateDriver;
  now?: () => string;
}

type UpdateStatusSender = Pick<WebContents, "send" | "isDestroyed">;

export class UpdateService {
  private readonly driver: UpdateDriver;
  private readonly now: () => string;
  private status: UpdateStatus = {
    state: "unsupported",
    message: "Updates are not initialized.",
    isUpdateSupported: false,
    version: null,
    percent: null,
    error: null,
    updatedAt: ""
  };
  private initialized = false;
  private checking = false;
  private sender: UpdateStatusSender | null = null;

  constructor(options: UpdateServiceOptions) {
    this.driver = options.driver ?? (autoUpdater as unknown as UpdateDriver);
    this.now = options.now ?? (() => new Date().toISOString());
    this.status = this.createStatus(
      options.isPackaged ? "idle" : "unsupported",
      options.isPackaged ? "Ready to check for updates." : "Updates are available only in the packaged Windows app.",
      { isUpdateSupported: options.isPackaged }
    );
  }

  attachWindow(window: BrowserWindow): void {
    const webContents = window.webContents;
    this.sender = webContents;
    window.on("closed", () => {
      if (this.sender === webContents) {
        this.sender = null;
      }
    });
  }

  initialize(): UpdateStatus {
    if (this.initialized || !this.status.isUpdateSupported) {
      return this.status;
    }

    this.initialized = true;
    this.driver.autoDownload = true;
    this.driver.autoInstallOnAppQuit = true;
    this.driver.logger = null;

    this.driver.on("checking-for-update", () => {
      this.checking = true;
      this.emit("checking", "Checking for updates.");
    });
    this.driver.on("update-available", (info: UpdateInfo) => {
      this.emit("available", `Update ${info.version} is available.`, { version: info.version });
    });
    this.driver.on("update-not-available", (info: UpdateInfo) => {
      this.checking = false;
      this.emit("not-available", "Holoshelf is up to date.", { version: info.version });
    });
    this.driver.on("download-progress", (progress: ProgressInfo) => {
      const percent = Number.isFinite(progress.percent) ? Math.max(0, Math.min(100, progress.percent)) : null;
      this.emit("downloading", percent === null ? "Downloading update." : `Downloading update (${Math.round(percent)}%).`, {
        percent
      });
    });
    this.driver.on("update-downloaded", (event: UpdateDownloadedEvent) => {
      this.checking = false;
      this.emit("downloaded", `Update ${event.version} is ready to install.`, { version: event.version, percent: 100 });
    });
    this.driver.on("error", (error: Error) => {
      this.checking = false;
      this.emit("error", "Update check failed.", { error: error.message });
    });

    return this.status;
  }

  getStatus(): UpdateStatus {
    return this.status;
  }

  async checkForUpdates(): Promise<UpdateStatus> {
    this.initialize();

    if (!this.status.isUpdateSupported) {
      return this.status;
    }

    if (this.checking) {
      return this.status;
    }

    this.checking = true;
    this.emit("checking", "Checking for updates.");

    try {
      const result = await this.driver.checkForUpdates();
      this.checking = false;

      if (!result && this.status.state === "checking") {
        this.emit("not-available", "Holoshelf is up to date.");
      } else if (result && !result.isUpdateAvailable && this.status.state === "checking") {
        this.emit("not-available", "Holoshelf is up to date.", { version: result.updateInfo.version });
      } else if (result?.isUpdateAvailable && this.status.state === "checking") {
        this.emit("available", `Update ${result.updateInfo.version} is available.`, { version: result.updateInfo.version });
      }
    } catch (error) {
      this.checking = false;
      this.emit("error", "Update check failed.", { error: error instanceof Error ? error.message : String(error) });
    }

    return this.status;
  }

  restartToInstall(): UpdateStatus {
    if (!this.status.isUpdateSupported) {
      return this.status;
    }

    if (this.status.state !== "downloaded") {
      return this.emit("idle", "No downloaded update is ready to install.");
    }

    this.driver.quitAndInstall(false, true);
    return this.status;
  }

  private emit(
    state: UpdateStatusState,
    message: string,
    details: Partial<Pick<UpdateStatus, "version" | "percent" | "error" | "isUpdateSupported">> = {}
  ): UpdateStatus {
    this.status = this.createStatus(state, message, details);
    const sender = this.sender;
    if (sender?.isDestroyed()) {
      this.sender = null;
      return this.status;
    }

    try {
      sender?.send("updates:status", this.status);
    } catch {
      if (this.sender === sender) {
        this.sender = null;
      }
    }
    return this.status;
  }

  private createStatus(
    state: UpdateStatusState,
    message: string,
    details: Partial<Pick<UpdateStatus, "version" | "percent" | "error" | "isUpdateSupported">> = {}
  ): UpdateStatus {
    return {
      state,
      message,
      isUpdateSupported: details.isUpdateSupported ?? this.status?.isUpdateSupported ?? true,
      version: details.version ?? null,
      percent: details.percent ?? null,
      error: details.error ?? null,
      updatedAt: this.now()
    };
  }
}
