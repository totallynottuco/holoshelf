import fs from "node:fs";
import path from "node:path";
import type initSqlJs from "sql.js";
import type { Database } from "sql.js";

type SqlJsApi = Awaited<ReturnType<typeof initSqlJs>>;

export interface RollingDatabaseBackupResult {
  created: boolean;
  filePath: string | null;
  reason: string;
  skippedReason?: string;
}

export interface RollingDatabaseBackupOptions {
  force?: boolean;
}

export interface TimestampedDatabaseBackupResult {
  created: boolean;
  filePath: string | null;
  reason: string;
  skippedReason?: string;
}

export interface DatabaseExportResult {
  exported: boolean;
  filePath: string;
}

const BACKUP_SLOTS = 3;
const HOLOSHELF_BACKUP_EXTENSION = ".holoshelf-backup";

function isValidSqliteDatabase(SQL: SqlJsApi, bytes: Buffer): boolean {
  if (bytes.length === 0) {
    return false;
  }

  let database: Database | null = null;

  try {
    database = new SQL.Database(bytes);
    const result = database.exec("PRAGMA integrity_check;")?.[0]?.values?.[0]?.[0];
    return result === "ok";
  } catch {
    return false;
  } finally {
    database?.close();
  }
}

export function validateSqliteDatabaseFile(filePath: string, SQL: SqlJsApi): boolean {
  if (!fs.existsSync(filePath)) {
    return false;
  }

  return isValidSqliteDatabase(SQL, fs.readFileSync(filePath));
}

function timestampForBackupName(date = new Date()): string {
  return date
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z")
    .replace(/[-:]/g, "")
    .replace("T", "-")
    .replace("Z", "");
}

function sanitizeBackupReason(reason: string): string {
  return (
    reason
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "manual"
  );
}

export function ensureHoloshelfBackupExtension(filePath: string): string {
  const trimmedPath = filePath.trim();
  if (!trimmedPath) {
    return trimmedPath;
  }

  return path.extname(trimmedPath) ? trimmedPath : `${trimmedPath}${HOLOSHELF_BACKUP_EXTENSION}`;
}

export function exportDatabaseBackupToFile(
  databasePath: string,
  destinationPath: string,
  SQL: SqlJsApi
): DatabaseExportResult {
  const filePath = ensureHoloshelfBackupExtension(destinationPath);
  if (!filePath) {
    throw new Error("Choose where to export the backup.");
  }

  const resolvedDatabase = path.resolve(databasePath);
  const resolvedDestination = path.resolve(filePath);
  if (resolvedDatabase.toLowerCase() === resolvedDestination.toLowerCase()) {
    throw new Error("Choose a backup file instead of the active database.");
  }

  if (!fs.existsSync(databasePath)) {
    throw new Error("The active Holoshelf database was not found.");
  }

  const bytes = fs.readFileSync(databasePath);
  if (!isValidSqliteDatabase(SQL, bytes)) {
    throw new Error("The active Holoshelf database failed its integrity check.");
  }

  fs.mkdirSync(path.dirname(resolvedDestination), { recursive: true });
  const tempPath = path.join(
    path.dirname(resolvedDestination),
    `.${path.basename(resolvedDestination)}.tmp-${process.pid}-${Date.now()}`
  );

  try {
    fs.writeFileSync(tempPath, bytes);
    if (!validateSqliteDatabaseFile(tempPath, SQL)) {
      throw new Error("The exported backup failed its integrity check.");
    }
    fs.rmSync(resolvedDestination, { force: true });
    fs.renameSync(tempPath, resolvedDestination);
  } catch (error) {
    fs.rmSync(tempPath, { force: true });
    throw error;
  }

  return { exported: true, filePath: resolvedDestination };
}

export function createRollingDatabaseBackup(
  databasePath: string,
  backupDirectory: string,
  SQL: SqlJsApi,
  reason: string,
  options: RollingDatabaseBackupOptions = {}
): RollingDatabaseBackupResult {
  if (!fs.existsSync(databasePath)) {
    return { created: false, filePath: null, reason, skippedReason: "database-missing" };
  }

  const newestBackup = path.join(backupDirectory, "holoshelf.autosave.1.sqlite");
  if (!options.force && fs.existsSync(newestBackup)) {
    const databaseStats = fs.statSync(databasePath);
    const backupStats = fs.statSync(newestBackup);
    if (backupStats.size === databaseStats.size && backupStats.mtimeMs >= databaseStats.mtimeMs) {
      return { created: false, filePath: newestBackup, reason, skippedReason: "backup-current" };
    }
  }

  const bytes = fs.readFileSync(databasePath);
  if (!isValidSqliteDatabase(SQL, bytes)) {
    return { created: false, filePath: null, reason, skippedReason: "integrity-check-failed" };
  }

  fs.mkdirSync(backupDirectory, { recursive: true });

  const oldestBackup = path.join(backupDirectory, `holoshelf.autosave.${BACKUP_SLOTS}.sqlite`);
  if (fs.existsSync(oldestBackup)) {
    fs.rmSync(oldestBackup, { force: true });
  }

  for (let slot = BACKUP_SLOTS - 1; slot >= 1; slot -= 1) {
    const source = path.join(backupDirectory, `holoshelf.autosave.${slot}.sqlite`);
    const target = path.join(backupDirectory, `holoshelf.autosave.${slot + 1}.sqlite`);
    if (fs.existsSync(source)) {
      fs.renameSync(source, target);
    }
  }

  fs.writeFileSync(newestBackup, bytes);

  return { created: true, filePath: newestBackup, reason };
}

export function createTimestampedDatabaseBackup(
  databasePath: string,
  backupDirectory: string,
  SQL: SqlJsApi,
  reason: string
): TimestampedDatabaseBackupResult {
  if (!fs.existsSync(databasePath)) {
    return { created: false, filePath: null, reason, skippedReason: "database-missing" };
  }

  const bytes = fs.readFileSync(databasePath);
  if (!isValidSqliteDatabase(SQL, bytes)) {
    return { created: false, filePath: null, reason, skippedReason: "integrity-check-failed" };
  }

  fs.mkdirSync(backupDirectory, { recursive: true });

  const baseName = `holoshelf.${sanitizeBackupReason(reason)}.${timestampForBackupName()}`;
  let filePath = path.join(backupDirectory, `${baseName}.sqlite`);
  let suffix = 2;
  while (fs.existsSync(filePath)) {
    filePath = path.join(backupDirectory, `${baseName}-${suffix}.sqlite`);
    suffix += 1;
  }

  fs.writeFileSync(filePath, bytes);
  return { created: true, filePath, reason };
}
