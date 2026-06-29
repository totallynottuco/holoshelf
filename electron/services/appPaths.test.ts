import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { App } from "electron";
import { ensureAppPaths, getAppPaths } from "./appPaths";

function mockApp(
  isPackaged: boolean,
  exePath: string,
  userDataPath = path.join("C:\\", "Users", "me", "AppData", "Roaming", "Holoshelf")
): App {
  return {
    isPackaged,
    getPath(name: string) {
      if (name === "exe") {
        return exePath;
      }

      if (name === "userData") {
        return userDataPath;
      }

      throw new Error(`Unexpected path request: ${name}`);
    }
  } as App;
}

describe("app paths", () => {
  const originalHoloshelfDataDirectory = process.env.HOLOSHELF_DATA_DIR;

  afterEach(() => {
    if (originalHoloshelfDataDirectory === undefined) {
      delete process.env.HOLOSHELF_DATA_DIR;
    } else {
      process.env.HOLOSHELF_DATA_DIR = originalHoloshelfDataDirectory;
    }
  });

  it("keeps unpacked build data in AppData and treats release data as legacy only", () => {
    const paths = getAppPaths(mockApp(true, path.join("F:\\", "coding", "Holoshelf", "release", "win-unpacked", "Holoshelf.exe")));

    expect(paths.dataDirectory).toBe(path.join("C:\\", "Users", "me", "AppData", "Roaming", "Holoshelf", "data"));
    expect(paths.databasePath).toBe(path.join("C:\\", "Users", "me", "AppData", "Roaming", "Holoshelf", "data", "holoshelf.sqlite"));
    expect(paths.dataLocationKind).toBe("appData");
    expect(paths.legacyDataDirectories).toEqual(
      expect.arrayContaining([
        path.join("F:\\", "coding", "Holoshelf", "release", "data"),
        path.join("F:\\", "coding", "Holoshelf", "release", "win-unpacked", "data"),
        path.join("F:\\", "coding", "Holoshelf", "data")
      ])
    );
  });

  it("keeps installed build data in userData so app updates do not wipe it", () => {
    const userData = path.join("C:\\", "Users", "me", "AppData", "Roaming", "Holoshelf");
    const paths = getAppPaths(
      mockApp(true, path.join("C:\\", "Users", "me", "AppData", "Local", "Programs", "Holoshelf", "Holoshelf.exe"), userData)
    );

    expect(paths.dataDirectory).toBe(path.join(userData, "data"));
    expect(paths.backupDirectory).toBe(path.join(userData, "data", "backups"));
    expect(paths.dataLocationKind).toBe("appData");
    expect(paths.legacyDataDirectories).toEqual([
      path.join("C:\\", "Users", "me", "AppData", "Local", "Programs", "Holoshelf", "data"),
      path.join(process.cwd(), "data")
    ]);
  });

  it("migrates old release data into AppData once", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "holoshelf-path-migration-"));
    const appData = path.join(root, "AppData", "Roaming", "Holoshelf");
    const oldData = path.join(root, "release", "data");
    const exePath = path.join(root, "release", "win-unpacked", "Holoshelf.exe");
    const oldDatabase = path.join(oldData, "holoshelf.sqlite");
    const oldImage = path.join(oldData, "images", "hololive", "tokino-sora.webp");

    fs.mkdirSync(path.dirname(oldImage), { recursive: true });
    fs.writeFileSync(oldDatabase, "saved board db");
    fs.writeFileSync(oldImage, "cached image");

    const paths = getAppPaths(mockApp(true, exePath, appData));
    ensureAppPaths(paths);

    expect(paths.dataDirectory).toBe(path.join(appData, "data"));
    expect(fs.readFileSync(path.join(paths.dataDirectory, "holoshelf.sqlite"), "utf8")).toBe("saved board db");
    expect(fs.readFileSync(path.join(paths.hololiveImageDirectory, "tokino-sora.webp"), "utf8")).toBe("cached image");
  });

  it("does not overwrite an existing AppData database with legacy data", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "holoshelf-path-no-overwrite-"));
    const appData = path.join(root, "AppData", "Roaming", "Holoshelf");
    const oldData = path.join(root, "release", "win-unpacked", "data");
    const stableData = path.join(appData, "data");
    const exePath = path.join(root, "release", "win-unpacked", "Holoshelf.exe");

    fs.mkdirSync(oldData, { recursive: true });
    fs.mkdirSync(stableData, { recursive: true });
    fs.writeFileSync(path.join(oldData, "holoshelf.sqlite"), "legacy db");
    fs.writeFileSync(path.join(stableData, "holoshelf.sqlite"), "current db");

    const paths = getAppPaths(mockApp(true, exePath, appData));
    ensureAppPaths(paths);

    expect(fs.readFileSync(path.join(paths.dataDirectory, "holoshelf.sqlite"), "utf8")).toBe("current db");
  });

  it("copies the packaged seed into AppData on first run", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "holoshelf-path-seed-"));
    const seedDirectory = path.join(root, "resources", "seed");
    const appData = path.join(root, "AppData", "Roaming", "Holoshelf");
    const exePath = path.join(root, "Programs", "Holoshelf", "Holoshelf.exe");
    const seedImage = path.join(seedDirectory, "images", "hololive", "tokino-sora-icon.webp");
    const seedArtifact = path.join(seedDirectory, "holodex-refresh", "latest", "videos.csv");

    fs.mkdirSync(path.dirname(seedImage), { recursive: true });
    fs.mkdirSync(path.dirname(seedArtifact), { recursive: true });
    fs.writeFileSync(path.join(seedDirectory, "holoshelf-template.sqlite"), "seed db");
    fs.writeFileSync(seedImage, "seed image");
    fs.writeFileSync(seedArtifact, "seed artifact");

    const paths = {
      ...getAppPaths(mockApp(true, exePath, appData)),
      seedDirectory,
      legacyDataDirectories: []
    };
    ensureAppPaths(paths);

    expect(fs.readFileSync(path.join(paths.dataDirectory, "holoshelf.sqlite"), "utf8")).toBe("seed db");
    expect(fs.readFileSync(path.join(paths.hololiveImageDirectory, "tokino-sora-icon.webp"), "utf8")).toBe("seed image");
    expect(fs.readFileSync(path.join(paths.dataDirectory, "holodex-refresh", "latest", "videos.csv"), "utf8")).toBe("seed artifact");
  });

  it("does not overwrite AppData with packaged seed during updates", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "holoshelf-path-seed-no-overwrite-"));
    const seedDirectory = path.join(root, "resources", "seed");
    const dataDirectory = path.join(root, "AppData", "Roaming", "Holoshelf", "data");
    const seedImage = path.join(seedDirectory, "images", "hololive", "tokino-sora-icon.webp");
    const currentImage = path.join(dataDirectory, "images", "hololive", "tokino-sora-icon.webp");
    const paths = {
      dataDirectory,
      databasePath: path.join(dataDirectory, "holoshelf.sqlite"),
      backupDirectory: path.join(dataDirectory, "backups"),
      coversDirectory: path.join(dataDirectory, "covers"),
      hololiveImageDirectory: path.join(dataDirectory, "images", "hololive"),
      seedDirectory,
      legacyHololiveIconDirectory: path.join(dataDirectory, "icons", "hololive"),
      legacyDataDirectories: [],
      dataLocationKind: "appData" as const
    };

    fs.mkdirSync(path.dirname(seedImage), { recursive: true });
    fs.mkdirSync(path.dirname(currentImage), { recursive: true });
    fs.writeFileSync(path.join(seedDirectory, "holoshelf-template.sqlite"), "seed db");
    fs.writeFileSync(seedImage, "seed image");
    fs.writeFileSync(paths.databasePath, "current db");
    fs.writeFileSync(currentImage, "current image");

    ensureAppPaths(paths);

    expect(fs.readFileSync(paths.databasePath, "utf8")).toBe("current db");
    expect(fs.readFileSync(currentImage, "utf8")).toBe("current image");
  });

  it("refuses packaged data inside build-owned directories", () => {
    process.env.HOLOSHELF_DATA_DIR = path.join("F:\\", "coding", "Holoshelf", "release", "data");

    expect(() => getAppPaths(mockApp(true, path.join("F:\\", "coding", "Holoshelf", "release", "win-unpacked", "Holoshelf.exe")))).toThrow(
      /build-owned Holoshelf data directory/
    );
  });

  it("allows explicit custom data directories outside build output", () => {
    process.env.HOLOSHELF_DATA_DIR = path.join("D:\\", "HoloshelfData");

    const paths = getAppPaths(mockApp(true, path.join("F:\\", "coding", "Holoshelf", "release", "win-unpacked", "Holoshelf.exe")));

    expect(paths.dataDirectory).toBe(path.join("D:\\", "HoloshelfData"));
    expect(paths.databasePath).toBe(path.join("D:\\", "HoloshelfData", "holoshelf.sqlite"));
    expect(paths.dataLocationKind).toBe("custom");
    expect(paths.legacyDataDirectories).toEqual([]);
  });

  it("does not migrate legacy release data into an explicit custom data directory", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "holoshelf-path-custom-no-migration-"));
    const customData = path.join(root, "CustomData");
    const oldData = path.join(root, "release", "data");
    const exePath = path.join(root, "release", "win-unpacked", "Holoshelf.exe");

    process.env.HOLOSHELF_DATA_DIR = customData;
    fs.mkdirSync(oldData, { recursive: true });
    fs.writeFileSync(path.join(oldData, "holoshelf.sqlite"), "legacy db");

    const paths = getAppPaths(mockApp(true, exePath, path.join(root, "AppData", "Holoshelf")));
    ensureAppPaths(paths);

    expect(fs.existsSync(paths.databasePath)).toBe(false);
  });

  it("moves the old Hololive icon cache into the image cache directory", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "holoshelf-paths-"));
    const paths = {
      dataDirectory: root,
      databasePath: path.join(root, "holoshelf.sqlite"),
      coversDirectory: path.join(root, "covers"),
      hololiveImageDirectory: path.join(root, "images", "hololive"),
      seedDirectory: null,
      legacyHololiveIconDirectory: path.join(root, "icons", "hololive"),
      legacyDataDirectories: [],
      backupDirectory: path.join(root, "backups"),
      dataLocationKind: "dev" as const
    };
    const oldIcon = path.join(paths.legacyHololiveIconDirectory, "tokino-sora.webp");

    fs.mkdirSync(paths.legacyHololiveIconDirectory, { recursive: true });
    fs.writeFileSync(oldIcon, "cached");

    ensureAppPaths(paths);

    expect(fs.existsSync(path.join(paths.hololiveImageDirectory, "tokino-sora.webp"))).toBe(true);
    expect(fs.existsSync(paths.legacyHololiveIconDirectory)).toBe(false);
  });
});
