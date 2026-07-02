import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import initSqlJs from "sql.js";
import {
  createRollingDatabaseBackup,
  createTimestampedDatabaseBackup,
  ensureHoloshelfBackupExtension,
  exportDatabaseBackupToFile,
  validateSqliteDatabaseFile
} from "./databaseBackups";

describe("database backups", () => {
  async function createSqliteFile(filePath: string, label: string) {
    const SQL = await initSqlJs();
    const database = new SQL.Database();
    database.run("CREATE TABLE marker (label TEXT NOT NULL)");
    database.run("INSERT INTO marker (label) VALUES (?)", [label]);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, Buffer.from(database.export()));
    database.close();
    return SQL;
  }

  it("keeps exactly three rolling autosaves with the newest in slot one", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "holoshelf-backups-"));
    const databasePath = path.join(root, "holoshelf.sqlite");
    const backupDirectory = path.join(root, "backups");
    const SQL = await createSqliteFile(databasePath, "one");

    createRollingDatabaseBackup(databasePath, backupDirectory, SQL, "first", { force: true });
    await createSqliteFile(databasePath, "two");
    createRollingDatabaseBackup(databasePath, backupDirectory, SQL, "second", { force: true });
    await createSqliteFile(databasePath, "three");
    createRollingDatabaseBackup(databasePath, backupDirectory, SQL, "third", { force: true });
    await createSqliteFile(databasePath, "four");
    createRollingDatabaseBackup(databasePath, backupDirectory, SQL, "fourth", { force: true });

    const backupFiles = fs.readdirSync(backupDirectory).sort();
    expect(backupFiles).toEqual(["holoshelf.autosave.1.sqlite", "holoshelf.autosave.2.sqlite", "holoshelf.autosave.3.sqlite"]);

    const readLabel = (slot: number) => {
      const database = new SQL.Database(fs.readFileSync(path.join(backupDirectory, `holoshelf.autosave.${slot}.sqlite`)));
      const label = database.exec("SELECT label FROM marker")?.[0]?.values?.[0]?.[0];
      database.close();
      return label;
    };

    expect(readLabel(1)).toBe("four");
    expect(readLabel(2)).toBe("three");
    expect(readLabel(3)).toBe("two");
  });

  it("skips startup backup work when the newest backup already covers the database", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "holoshelf-backups-current-"));
    const databasePath = path.join(root, "holoshelf.sqlite");
    const backupDirectory = path.join(root, "backups");
    const SQL = await createSqliteFile(databasePath, "one");

    const first = createRollingDatabaseBackup(databasePath, backupDirectory, SQL, "startup");
    expect(first).toMatchObject({ created: true });

    const skipped = createRollingDatabaseBackup(databasePath, backupDirectory, SQL, "startup");
    expect(skipped).toMatchObject({ created: false, skippedReason: "backup-current" });
    expect(fs.readdirSync(backupDirectory).sort()).toEqual(["holoshelf.autosave.1.sqlite"]);
  });

  it("skips missing, empty, and corrupt database files", async () => {
    const SQL = await initSqlJs();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "holoshelf-backups-invalid-"));
    const backupDirectory = path.join(root, "backups");
    const missingResult = createRollingDatabaseBackup(path.join(root, "missing.sqlite"), backupDirectory, SQL, "missing");
    expect(missingResult).toMatchObject({ created: false, skippedReason: "database-missing" });

    const emptyPath = path.join(root, "empty.sqlite");
    fs.writeFileSync(emptyPath, "");
    const emptyResult = createRollingDatabaseBackup(emptyPath, backupDirectory, SQL, "empty");
    expect(emptyResult).toMatchObject({ created: false, skippedReason: "integrity-check-failed" });

    const corruptPath = path.join(root, "corrupt.sqlite");
    fs.writeFileSync(corruptPath, "not sqlite");
    const corruptResult = createRollingDatabaseBackup(corruptPath, backupDirectory, SQL, "corrupt");
    expect(corruptResult).toMatchObject({ created: false, skippedReason: "integrity-check-failed" });
    expect(fs.existsSync(backupDirectory)).toBe(false);
  });

  it("creates timestamped manual backups and validates SQLite files", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "holoshelf-backups-manual-"));
    const databasePath = path.join(root, "holoshelf.sqlite");
    const backupDirectory = path.join(root, "backups");
    const SQL = await createSqliteFile(databasePath, "manual");

    const result = createTimestampedDatabaseBackup(databasePath, backupDirectory, SQL, "manual");

    expect(result).toMatchObject({ created: true, reason: "manual" });
    expect(result.filePath).toContain("holoshelf.manual.");
    expect(result.filePath ? fs.existsSync(result.filePath) : false).toBe(true);
    expect(result.filePath ? validateSqliteDatabaseFile(result.filePath, SQL) : false).toBe(true);
  });

  it("exports user backup files with the Holoshelf backup extension", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "holoshelf-backups-export-"));
    const databasePath = path.join(root, "holoshelf.sqlite");
    const exportPath = path.join(root, "exports", "Holoshelf Backup");
    const SQL = await createSqliteFile(databasePath, "exported");

    const result = exportDatabaseBackupToFile(databasePath, exportPath, SQL);

    expect(result).toMatchObject({ exported: true });
    expect(result.filePath).toBe(`${exportPath}.holoshelf-backup`);
    expect(fs.existsSync(result.filePath)).toBe(true);
    expect(validateSqliteDatabaseFile(result.filePath, SQL)).toBe(true);
  });

  it("rejects export when the active database is invalid", async () => {
    const SQL = await initSqlJs();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "holoshelf-backups-export-invalid-"));
    const databasePath = path.join(root, "holoshelf.sqlite");
    fs.writeFileSync(databasePath, "not sqlite");

    expect(() => exportDatabaseBackupToFile(databasePath, path.join(root, "backup"), SQL)).toThrow(
      "The active Holoshelf database failed its integrity check."
    );
  });

  it("only appends the Holoshelf backup extension when the export path has no extension", () => {
    expect(ensureHoloshelfBackupExtension("backup")).toBe("backup.holoshelf-backup");
    expect(ensureHoloshelfBackupExtension("backup.sqlite")).toBe("backup.sqlite");
    expect(ensureHoloshelfBackupExtension("backup.holoshelf-backup")).toBe("backup.holoshelf-backup");
  });
});
