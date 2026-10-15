import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import initSqlJs from "sql.js";
import type { CatalogUpdateManifest } from "../../src/shared/catalogUpdate";
import { auditOfficialMusicStats } from "./musicStatsAudit";

export const catalogHash = (data: Uint8Array): string => createHash("sha256").update(data).digest("hex");

export async function validateCatalogDatabase(data: Uint8Array, manifest: CatalogUpdateManifest): Promise<void> {
  if (data.length !== manifest.database.uncompressedBytes || catalogHash(data) !== manifest.database.uncompressedSha256 ||
      Buffer.from(data.subarray(0, 16)).toString() !== "SQLite format 3\0") throw new Error("Catalog database checksum or size does not match");
  const packagedWasm = path.join(process.resourcesPath ?? "", "sql-wasm.wasm");
  const SQL = await initSqlJs({ locateFile: () => process.resourcesPath && fs.existsSync(packagedWasm)
    ? packagedWasm : path.join(process.cwd(), "node_modules/sql.js/dist/sql-wasm.wasm") });
  const database = new SQL.Database(data);
  const select = (sql: string) => {
    const result = database.exec(sql)[0];
    return result ? result.values.map(row => Object.fromEntries(result.columns.map((name, index) => [name, row[index]]))) : [];
  };
  try {
    if (database.exec("PRAGMA quick_check")[0]?.values[0]?.[0] !== "ok") throw new Error("Catalog database integrity check failed");
    const settings = select("SELECT key,value FROM settings");
    if (settings.some(row => /apikey|api_key|token|secret/i.test(String(row.key)))) throw new Error("Catalog contains private settings");
    if (settings.find(row => row.key === "hololive.officialDataVersion")?.value !== manifest.version) throw new Error("Catalog database version does not match");
    for (const [table, where] of [
      ["hololive_idols", " WHERE source='custom'"], ["hololive_music_videos", " WHERE source_kind='user'"],
      ...["lists", "list_items", "hololive_playlist_entries", "hololive_music_marker_keys", "hololive_music_playlists",
        "hololive_music_playlist_items", "hololive_music_queue_items", "hololive_music_exclusions", "hololive_brackets",
        "hololive_bracket_entries", "hololive_bracket_matches", "hololive_bracket_archives", "hololive_bracket_archive_entries",
        "hololive_bracket_archive_matches"].map(table => [table, ""])
    ]) {
      if (Number(select(`SELECT COUNT(*) AS count FROM ${table}${where}`)[0].count) !== 0) throw new Error(`Catalog contains personal records: ${table}`);
    }
    const coverage = auditOfficialMusicStats({ select } as Parameters<typeof auditOfficialMusicStats>[0], manifest.statsFetchedAt);
    if (coverage.catalogVideos !== manifest.musicRows || coverage.missingVideos || coverage.staleVideos) throw new Error("Catalog statistics are incomplete or stale");
  } finally { database.close(); }
}
