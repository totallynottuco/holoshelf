import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { applyInstalledSeedUpdate } from "./installedSeedUpdate";

const directories: string[] = [];
afterEach(() => { vi.restoreAllMocks(); directories.splice(0).forEach((value) => fs.rmSync(value, { recursive: true, force: true })); });
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "holoshelf-installed-data-"));
  directories.push(root);
  const sourceDirectory = path.join(root, "project", "seed");
  const installedDirectory = path.join(root, "installed", "resources", "seed");
  const databasePath = path.join(root, "personal.sqlite");
  for (const [directory, version] of [[sourceDirectory, "2026-10-15"], [installedDirectory, "2026-10-08"]]) {
    fs.mkdirSync(path.join(directory, "images"), { recursive: true });
    fs.writeFileSync(path.join(directory, "official-data.json"), JSON.stringify({ schema: 1, version, seedDatabase: "holoshelf-template.sqlite" }));
    fs.writeFileSync(path.join(directory, "holoshelf-template.sqlite"), `SQLite format 3\0${version}`);
    fs.writeFileSync(path.join(directory, "images", "unchanged.png"), "unchanged image");
  }
  fs.writeFileSync(path.join(installedDirectory, "obsolete.csv"), "old file");
  fs.writeFileSync(databasePath, "personal state before update");
  return { sourceDirectory, installedDirectory, databasePath };
}

describe("direct installed seed updates", () => {
  it("publishes the exact source tree and reuses unchanged files before verification", async () => {
    const options = fixture();
    const linkAttempt = vi.spyOn(fs, "linkSync");
    const stopApp = vi.fn();
    const result = await applyInstalledSeedUpdate({ ...options, stopApp, verify: async () => {
      expect(fs.readFileSync(path.join(options.installedDirectory, "official-data.json"), "utf8")).toContain("2026-10-15");
      expect(fs.existsSync(path.join(options.installedDirectory, "obsolete.csv"))).toBe(false);
      fs.writeFileSync(options.databasePath, "merged personal state");
    } });
    expect(result.version).toBe("2026-10-15");
    expect(result.copiedFiles + result.linkedFiles).toBe(3);
    expect(linkAttempt).toHaveBeenCalledOnce();
    expect(fs.readFileSync(options.databasePath, "utf8")).toBe("merged personal state");
    expect(stopApp).not.toHaveBeenCalled();
    expect(fs.readdirSync(path.dirname(options.installedDirectory))).toEqual(["seed"]);
  });

  it("restores both the old seed and exact personal database when verification fails", async () => {
    const options = fixture();
    const stopApp = vi.fn(async () => {});
    await expect(applyInstalledSeedUpdate({ ...options, stopApp, verify: async () => {
      fs.writeFileSync(options.databasePath, "failed merge");
      throw new Error("verification failed");
    } })).rejects.toThrow("verification failed");
    expect(stopApp).toHaveBeenCalledOnce();
    expect(fs.readFileSync(options.databasePath, "utf8")).toBe("personal state before update");
    expect(fs.readFileSync(path.join(options.installedDirectory, "official-data.json"), "utf8")).toContain("2026-10-08");
    expect(fs.existsSync(path.join(options.installedDirectory, "obsolete.csv"))).toBe(true);
    expect(fs.readdirSync(path.dirname(options.installedDirectory))).toEqual(["seed"]);
  });

  it("falls back to copying when hard links are unavailable", async () => {
    const options = fixture();
    vi.spyOn(fs, "linkSync").mockImplementation(() => { throw new Error("unsupported filesystem"); });
    const result = await applyInstalledSeedUpdate({ ...options, stopApp: async () => {}, verify: async () => {} });
    expect(result).toMatchObject({ copiedFiles: 3, linkedFiles: 0 });
  });

  it("counts unchanged files as reused when the filesystem supports links", async () => {
    const options = fixture();
    vi.spyOn(fs, "linkSync").mockImplementation((input, output) => { fs.copyFileSync(input, output); });
    const result = await applyInstalledSeedUpdate({ ...options, stopApp: async () => {}, verify: async () => {} });
    expect(result).toMatchObject({ copiedFiles: 2, linkedFiles: 1 });
  });

  it("rejects unsupported manifests before changing installed files", async () => {
    const options = fixture();
    fs.writeFileSync(path.join(options.sourceDirectory, "official-data.json"), JSON.stringify({ schema: 999 }));
    await expect(applyInstalledSeedUpdate({ ...options, stopApp: async () => {}, verify: async () => {} })).rejects.toThrow("Unsupported");
    expect(fs.readFileSync(options.databasePath, "utf8")).toBe("personal state before update");
    expect(fs.readdirSync(path.dirname(options.installedDirectory))).toEqual(["seed"]);
  });

  it("rejects a seed older than the installed data", async () => {
    const options = fixture();
    const sourceManifestPath = path.join(options.sourceDirectory, "official-data.json");
    const value = JSON.parse(fs.readFileSync(sourceManifestPath, "utf8"));
    value.version = "2026-01-01";
    fs.writeFileSync(sourceManifestPath, JSON.stringify(value));
    await expect(applyInstalledSeedUpdate({ ...options, stopApp: async () => {}, verify: async () => {} })).rejects.toThrow("older");
    expect(fs.readdirSync(path.dirname(options.installedDirectory))).toEqual(["seed"]);
  });

  it("removes a newly created personal database when rolling back a first launch", async () => {
    const options = fixture();
    fs.rmSync(options.databasePath);
    await expect(applyInstalledSeedUpdate({ ...options, stopApp: async () => {}, verify: async () => {
      fs.writeFileSync(options.databasePath, "first launch failed");
      throw new Error("verification failed");
    } })).rejects.toThrow("verification failed");
    expect(fs.existsSync(options.databasePath)).toBe(false);
    expect(fs.readFileSync(path.join(options.installedDirectory, "official-data.json"), "utf8")).toContain("2026-10-08");
  });

  it("retains recovery files if the installed app cannot be stopped for rollback", async () => {
    const options = fixture();
    await expect(applyInstalledSeedUpdate({ ...options,
      verify: async () => { throw new Error("verification failed"); },
      stopApp: async () => { throw new Error("app is locked"); }
    })).rejects.toThrow("Recovery files:");
    const recovery = fs.readdirSync(path.dirname(options.installedDirectory)).find((name) => name.startsWith(".seed-update-"))!;
    expect(fs.readFileSync(path.join(path.dirname(options.installedDirectory), recovery, "personal.sqlite"), "utf8"))
      .toBe("personal state before update");
  });
});
