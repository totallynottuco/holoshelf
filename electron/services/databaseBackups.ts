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

const BACKUP_SLOTS = 3;

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

export function createRollingDatabaseBackup(
  databasePath: string,
  backupDirectory: string,
  SQL: SqlJsApi,
  reason: string
): RollingDatabaseBackupResult {
  if (!fs.existsSync(databasePath)) {
    return { created: false, filePath: null, reason, skippedReason: "database-missing" };
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

  const newestBackup = path.join(backupDirectory, "holoshelf.autosave.1.sqlite");
  fs.writeFileSync(newestBackup, bytes);

  return { created: true, filePath: newestBackup, reason };
}
