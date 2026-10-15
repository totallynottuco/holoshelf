import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseService } from "./database";

const directories: string[] = [];
afterEach(() => { vi.restoreAllMocks(); directories.splice(0).forEach((directory) => fs.rmSync(directory, { recursive: true, force: true })); });
function databasePath() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "holoshelf-startup-"));
  directories.push(directory);
  return path.join(directory, "holoshelf.sqlite");
}

describe("database startup persistence", () => {
  it("persists startup maintenance once and resumes immediate writes afterwards", async () => {
    const file = databasePath();
    const database = new DatabaseService(file, undefined, { createBackups: false });
    const flush = vi.spyOn(database, "flush");
    await database.init();
    expect(flush).toHaveBeenCalledOnce();
    expect(database.listHololiveIdols().length).toBeGreaterThan(0);
    expect(database.select("PRAGMA integrity_check")[0]?.integrity_check).toBe("ok");
    database.setSetting("test.afterStartup", "persisted");
    expect(flush).toHaveBeenCalledTimes(2);
    const reopened = new DatabaseService(file, undefined, { createBackups: false });
    await reopened.init();
    expect(reopened.getSettings()["test.afterStartup"]).toBe("persisted");
    expect(reopened.select("PRAGMA foreign_key_check")).toEqual([]);
  });

  it("leaves an existing database unchanged when startup maintenance fails", async () => {
    const file = databasePath();
    const original = new DatabaseService(file, undefined, { createBackups: false });
    await original.init();
    original.run("DELETE FROM settings WHERE key = 'internal.startupMaintenanceVersion'");
    const before = fs.readFileSync(file);
    const database = new DatabaseService(file, undefined, { createBackups: false });
    const flush = vi.spyOn(database, "flush");
    vi.spyOn(database, "repairHololiveMusicDuplicateRows").mockImplementation(() => { throw new Error("maintenance failed"); });
    await expect(database.init()).rejects.toThrow("maintenance failed");
    expect(flush).not.toHaveBeenCalled();
    expect(fs.readFileSync(file)).toEqual(before);
  });
});
