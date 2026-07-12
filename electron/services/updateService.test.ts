import { describe, expect, it } from "vitest";
import type { BrowserWindow } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ProgressInfo, UpdateCheckResult, UpdateDownloadedEvent, UpdateInfo } from "electron-updater";
import type { UpdateStatus } from "../../src/shared/ipc";
import { UpdateDriver, UpdateService } from "./updateService";

class FakeUpdateDriver implements UpdateDriver {
  autoDownload = false;
  autoInstallOnAppQuit = false;
  logger = null;
  checks = 0;
  quitAndInstallCalls = 0;
  nextResult: UpdateCheckResult | null = notAvailableResult("1.0.0");
  private readonly listeners = new Map<string, Array<(...args: any[]) => void>>();

  on(event: "checking-for-update", listener: () => void): unknown;
  on(event: "update-available", listener: (info: UpdateInfo) => void): unknown;
  on(event: "update-not-available", listener: (info: UpdateInfo) => void): unknown;
  on(event: "download-progress", listener: (info: ProgressInfo) => void): unknown;
  on(event: "update-downloaded", listener: (event: UpdateDownloadedEvent) => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
  on(event: string, listener: (...args: any[]) => void): unknown {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
    return this;
  }

  async checkForUpdates(): Promise<UpdateCheckResult | null> {
    this.checks += 1;
    return this.nextResult;
  }

  quitAndInstall(): void {
    this.quitAndInstallCalls += 1;
  }

  emit(event: "checking-for-update"): void;
  emit(event: "update-available", info: UpdateInfo): void;
  emit(event: "update-not-available", info: UpdateInfo): void;
  emit(event: "download-progress", info: ProgressInfo): void;
  emit(event: "update-downloaded", info: UpdateDownloadedEvent): void;
  emit(event: "error", error: Error): void;
  emit(event: string, ...args: any[]): void {
    for (const listener of this.listeners.get(event) ?? []) {
      listener(...args);
    }
  }
}

describe("update service", () => {
  it("does not check for updates outside packaged builds", async () => {
    const driver = new FakeUpdateDriver();
    const service = new UpdateService({ isPackaged: false, driver, now });

    const status = await service.checkForUpdates();

    expect(status.state).toBe("unsupported");
    expect(status.isUpdateSupported).toBe(false);
    expect(driver.checks).toBe(0);
  });

  it("configures packaged auto-updates and broadcasts renderer status", async () => {
    const driver = new FakeUpdateDriver();
    const sentStatuses: UpdateStatus[] = [];
    const service = new UpdateService({ isPackaged: true, driver, now });
    service.attachWindow(fakeWindow(sentStatuses));
    service.initialize();

    expect(driver.autoDownload).toBe(true);
    expect(driver.autoInstallOnAppQuit).toBe(true);
    expect(driver.logger).toBeNull();

    driver.nextResult = availableResult("1.1.0");
    const checkPromise = service.checkForUpdates();
    driver.emit("update-available", updateInfo("1.1.0"));
    driver.emit("download-progress", { total: 100, delta: 50, transferred: 50, percent: 50, bytesPerSecond: 1000 });
    driver.emit("update-downloaded", { ...updateInfo("1.1.0"), downloadedFile: "Holoshelf Setup 1.1.0.exe" });
    const status = await checkPromise;

    expect(status.state).toBe("downloaded");
    expect(status.version).toBe("1.1.0");
    expect(sentStatuses.map((item) => item.state)).toEqual(["checking", "available", "downloading", "downloaded"]);
  });

  it("does not touch a destroyed BrowserWindow while clearing update listeners", () => {
    const driver = new FakeUpdateDriver();
    const sentStatuses: UpdateStatus[] = [];
    const window = fakeWindow(sentStatuses);
    const service = new UpdateService({ isPackaged: true, driver, now });

    service.attachWindow(window);
    (window as unknown as { emitClosed(): void }).emitClosed();
    driver.emit("checking-for-update");

    expect(sentStatuses).toHaveLength(0);
  });

  it("reports current when no packaged update is available", async () => {
    const driver = new FakeUpdateDriver();
    const service = new UpdateService({ isPackaged: true, driver, now });

    const status = await service.checkForUpdates();

    expect(status.state).toBe("not-available");
    expect(status.message).toBe("Holoshelf is up to date.");
  });

  it("restarts into the downloaded update only after download completion", () => {
    const driver = new FakeUpdateDriver();
    const service = new UpdateService({ isPackaged: true, driver, now });
    service.initialize();

    expect(service.restartToInstall().state).toBe("idle");
    expect(driver.quitAndInstallCalls).toBe(0);

    driver.emit("update-downloaded", { ...updateInfo("1.1.0"), downloadedFile: "Holoshelf Setup 1.1.0.exe" });
    expect(service.restartToInstall().state).toBe("downloaded");
    expect(driver.quitAndInstallCalls).toBe(1);
  });

  it("shows downloaded GitHub release notes once the installed version launches", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "holoshelf-update-notes-"));
    const releaseStatePath = path.join(directory, "pending-installed-update.json");

    try {
      const driver = new FakeUpdateDriver();
      const downloadingService = new UpdateService({
        isPackaged: true,
        driver,
        now,
        currentVersion: "1.0.0",
        releaseStatePath
      });
      downloadingService.initialize();
      driver.emit("update-downloaded", {
        ...updateInfo("1.1.0"),
        releaseName: "Holoshelf 1.1.0",
        releaseNotes: "- Song updates\n- Bug fixes",
        downloadedFile: "Holoshelf Setup 1.1.0.exe"
      });

      expect(downloadingService.getInstalledRelease()).toBeNull();

      const installedService = new UpdateService({
        isPackaged: true,
        driver: new FakeUpdateDriver(),
        now,
        currentVersion: "v1.1.0",
        releaseStatePath
      });
      expect(installedService.getInstalledRelease()).toEqual({
        version: "1.1.0",
        releaseName: "Holoshelf 1.1.0",
        releaseDate: "2026-06-29T00:00:00.000Z",
        releaseNotes: "- Song updates\n- Bug fixes"
      });
      expect(installedService.dismissInstalledRelease()).toEqual({ dismissed: true });
      expect(installedService.getInstalledRelease()).toBeNull();
      expect(fs.existsSync(releaseStatePath)).toBe(false);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("uses bundled release notes on the first launch marked by the NSIS updater", () => {
    const service = new UpdateService({
      isPackaged: true,
      driver: new FakeUpdateDriver(),
      now,
      currentVersion: "1.1.0",
      startupInstalledRelease: {
        version: "1.1.0",
        releaseName: "Holoshelf 1.1.0",
        releaseDate: null,
        releaseNotes: "- First supported update"
      }
    });

    expect(service.getInstalledRelease()).toEqual({
      version: "1.1.0",
      releaseName: "Holoshelf 1.1.0",
      releaseDate: null,
      releaseNotes: "- First supported update"
    });
  });
});

function now(): string {
  return "2026-06-29T00:00:00.000Z";
}

function fakeWindow(sentStatuses: UpdateStatus[]): BrowserWindow {
  let closedListener: (() => void) | null = null;
  let destroyed = false;
  const webContents = {
    isDestroyed() {
      return destroyed;
    },
    send(channel: string, payload: UpdateStatus) {
      if (channel === "updates:status") {
        sentStatuses.push(payload);
      }
    }
  };
  return {
    webContents,
    on(event: string, listener: () => void) {
      if (event === "closed") {
        closedListener = listener;
      }
      return this;
    },
    emitClosed() {
      destroyed = true;
      closedListener?.();
    }
  } as unknown as BrowserWindow;
}

function updateInfo(version: string): UpdateInfo {
  return {
    version,
    files: [],
    path: "",
    sha512: "",
    releaseDate: "2026-06-29T00:00:00.000Z"
  };
}

function availableResult(version: string): UpdateCheckResult {
  const info = updateInfo(version);
  return {
    isUpdateAvailable: true,
    updateInfo: info,
    versionInfo: info
  } as UpdateCheckResult;
}

function notAvailableResult(version: string): UpdateCheckResult {
  const info = updateInfo(version);
  return {
    isUpdateAvailable: false,
    updateInfo: info,
    versionInfo: info
  } as UpdateCheckResult;
}
