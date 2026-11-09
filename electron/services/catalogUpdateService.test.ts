import {afterEach, beforeAll, describe, expect, it, vi} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {gzipSync} from "node:zlib";
import initSqlJs from "sql.js";
import {CatalogUpdateService} from "./catalogUpdateService";
import {catalogHash} from "./catalogUpdatePackage";
import {CATALOG_MIN_APP_VERSION, parseCatalogUpdateManifest, type CatalogUpdateManifest} from "../../src/shared/catalogUpdate";
import {DatabaseService} from "./database";
import {mergeBundledOfficialData} from "./officialDataMergeService";
import type {AppPathSet} from "./appPaths";

const version = "2026-10-16T120000Z";
let bytes: Buffer;
let compressed: Buffer;
let manifest: CatalogUpdateManifest;
let releaseVideoId: string;
let SQL: Awaited<ReturnType<typeof initSqlJs>>;
const directories: string[] = [];
beforeAll(async () => {
  SQL = await initSqlJs();
  const seed = new SQL.Database(fs.readFileSync("resources/seed/holoshelf-template.sqlite"));
  seed.run("UPDATE settings SET value=? WHERE key='hololive.officialDataVersion'", [version]);
  seed.run("UPDATE hololive_music_videos SET official_catalog_active=1,source_kind='official'");
  seed.run("DELETE FROM hololive_music_exclusions");
  seed.run("INSERT OR REPLACE INTO hololive_music_video_stats SELECT youtube_video_id,100,'2026-10-16T12:00:00.000Z' FROM hololive_music_videos");
  releaseVideoId = String(seed.exec("SELECT youtube_video_id FROM hololive_music_videos ORDER BY youtube_video_id LIMIT 1")[0].values[0][0]);
  seed.run("INSERT OR REPLACE INTO hololive_music_release_dates VALUES(?, '2022-12-19', 'official_release', 'https://hololive.hololivepro.com/en/music/244/', '2026-10-16')", [releaseVideoId]);
  const count = Number(seed.exec("SELECT COUNT(*) FROM hololive_music_videos")[0].values[0][0]);
  bytes = Buffer.from(seed.export()); seed.close();
  compressed = gzipSync(bytes);
  manifest = {schema: 1, version, generatedAt: "2026-10-16T12:00:00.000Z", minAppVersion: "1.1.90", musicRows: count,
    statsFetchedAt: "2026-10-16T12:00:00.000Z", database: {url: "https://github.com/totallynottuco/holoshelf/releases/download/v1.1.90/holoshelf-catalog-test.sqlite.gz",
      sha256: catalogHash(compressed), bytes: compressed.length, uncompressedBytes: bytes.length, uncompressedSha256: catalogHash(bytes)}};
});
afterEach(() => { for (const directory of directories.splice(0)) fs.rmSync(directory, {recursive: true, force: true}); });

function fixture(next = manifest, body = compressed, appVersion = "1.1.90") {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "catalog-update-test-")); directories.push(dataDirectory);
  const paths = {dataDirectory, hololiveImageDirectory: path.join(dataDirectory, "images"), seedDirectory: null} as AppPathSet;
  const settings: Record<string,string> = {"hololive.officialDataVersion": "2026-10-15T120000Z"};
  const database = {getSettings: () => settings} as unknown as DatabaseService;
  const merge = vi.fn(async () => ({status: "merged", bundledVersion: next.version})) as unknown as typeof import("./officialDataMergeService").mergeBundledOfficialData;
  const onApplied = vi.fn();
  const fetcher = vi.fn(async (url: unknown) => String(url).endsWith(".json") ? Response.json(next) : new Response(body)) as unknown as typeof fetch;
  const log = vi.fn();
  const service = new CatalogUpdateService({database, paths, appVersion, fetcher, merge, onApplied, log});
  return {service, fetcher, merge, onApplied, settings, database, paths, log};
}

describe("silent catalog updates", () => {
  it.each(["1.1.90", "1.1.91", "1.1.92", "1.1.93", "1.1.94", "1.1.95", "1.1.96"])("blocks catalogs requiring date-aware safe replacement on legacy client %s before downloading or merging", async appVersion => {
    expect(CATALOG_MIN_APP_VERSION).toBe("1.1.97");
    const next = {...manifest, minAppVersion: CATALOG_MIN_APP_VERSION};
    const f = fixture(next, compressed, appVersion);
    expect(await f.service.checkForUpdates()).toBe("requires-app-update");
    expect(f.fetcher).toHaveBeenCalledTimes(1);
    expect(f.merge).not.toHaveBeenCalled();
    expect(f.onApplied).not.toHaveBeenCalled();
    expect(f.settings["hololive.officialDataVersion"]).toBe("2026-10-15T120000Z");
  });

  it("allows the compatible client to receive the current release-date catalog silently", async () => {
    const f = fixture({...manifest, minAppVersion: CATALOG_MIN_APP_VERSION}, compressed, "1.1.97");
    expect(await f.service.checkForUpdates()).toBe("merged");
    expect(f.fetcher).toHaveBeenCalledTimes(2);
    expect(f.merge).toHaveBeenCalledOnce();
    expect(f.onApplied).toHaveBeenCalledExactlyOnceWith(version);
  });

  it("downloads and applies release dates and stats through the real silent merge while preserving personal data and bracket history", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "catalog-real-merge-")); directories.push(directory);
    const file = path.join(directory, "holoshelf.sqlite"); fs.copyFileSync("resources/seed/holoshelf-template.sqlite", file);
    const database = new DatabaseService(file, undefined, {createBackups:false}); await database.init();
    database.setSetting("hololive.officialDataVersion", "2026-10-15T120000Z");
    database.setSetting("personal.preference", "preserve");
    database.run("DELETE FROM hololive_music_release_dates WHERE youtube_video_id=?", [releaseVideoId]);
    database.run("UPDATE hololive_music_video_stats SET view_count=1,fetched_at='2000-01-01T00:00:00.000Z' WHERE youtube_video_id=?", [releaseVideoId]);
    database.setHololiveMusicMarker({youtubeVideoId:releaseVideoId,marker:"favorite"});
    await database.createHololiveBracket({size:"RO16",format:"double_elimination"});
    const tables = ["hololive_music_marker_keys","hololive_music_playlists","hololive_music_playlist_items","hololive_music_queue_items","hololive_music_exclusions","hololive_brackets","hololive_bracket_entries","hololive_bracket_matches","hololive_bracket_archives","hololive_bracket_archive_entries","hololive_bracket_archive_matches"];
    const before = tables.map(table => database.select(`SELECT * FROM ${table}`));
    const paths = {dataDirectory:directory,databasePath:file,backupDirectory:path.join(directory,"backups"),hololiveImageDirectory:path.join(directory,"images"),seedDirectory:null} as AppPathSet;
    const onApplied = vi.fn();
    const next = {...manifest, minAppVersion:CATALOG_MIN_APP_VERSION};
    const fetcher = vi.fn(async (url:unknown) => String(url).endsWith(".json") ? Response.json(next) : new Response(compressed)) as unknown as typeof fetch;
    const service = new CatalogUpdateService({database,paths,appVersion:"1.1.97",fetcher,merge:mergeBundledOfficialData,onApplied});
    expect(await service.checkForUpdates()).toBe("merged");
    expect(database.listHololiveMusicRows({youtubeVideoIds:[releaseVideoId]})[0]).toMatchObject({releaseDate:"2022-12-19",releaseDateBasis:"official_release",viewCount:100,viewCountFetchedAt:"2026-10-16T12:00:00.000Z"});
    expect(database.getSettings()["personal.preference"]).toBe("preserve");
    expect(tables.map(table => database.select(`SELECT * FROM ${table}`))).toEqual(before);
    expect(onApplied).toHaveBeenCalledExactlyOnceWith(version);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(database.select("PRAGMA foreign_key_check")).toEqual([]);
  });

  it("validates and stages the complete seed, coalesces checks, and emits only a catalog event", async () => {
    const f = fixture();
    expect(await Promise.all([f.service.checkForUpdates(), f.service.checkForUpdates()]), JSON.stringify(f.log.mock.calls)).toEqual(["merged", "merged"]);
    expect(f.fetcher).toHaveBeenCalledTimes(2);
    expect(f.merge).toHaveBeenCalledOnce();
    expect(f.onApplied).toHaveBeenCalledWith(version);
    expect(await f.service.checkForUpdates()).toBe("recently-checked");
    expect(fs.readdirSync(path.join(f.paths.dataDirectory, "catalog-updates"))).toEqual(["last-check.json"]);
  });

  it.each(["checksum", "truncated", "oversized", "database-checksum", "incomplete-stats", "stale-stats"])("leaves local data untouched for %s packages", async failure => {
    const next = structuredClone(manifest);
    let body = compressed;
    if (failure === "checksum") next.database.sha256 = "0".repeat(64);
    if (failure === "truncated") body = compressed.subarray(0, -10);
    if (failure === "oversized") next.database.bytes = compressed.length - 1;
    if (failure === "database-checksum") next.database.uncompressedSha256 = "0".repeat(64);
    if (failure === "incomplete-stats") next.musicRows++;
    if (failure === "stale-stats") next.statsFetchedAt = "2026-10-17T00:00:00.000Z";
    const f = fixture(next, body);
    expect(await f.service.checkForUpdates()).toBe("failed");
    expect(f.merge).not.toHaveBeenCalled();
    expect(f.onApplied).not.toHaveBeenCalled();
    expect(f.settings["hololive.officialDataVersion"]).toBe("2026-10-15T120000Z");
  });

  it.each(["private-setting", "custom-talent", "wrong-version", "invalid-release-date"])("rejects a checksummed but invalid seed: %s", async failure => {
    const seed = new SQL.Database(bytes);
    if (failure === "private-setting") seed.run("INSERT INTO settings(key,value,updated_at) VALUES('sources.youtubeApiKey','synthetic-secret','2026-10-16')");
    if (failure === "custom-talent") seed.run("UPDATE hololive_idols SET source='custom' WHERE id=(SELECT id FROM hololive_idols LIMIT 1)");
    if (failure === "invalid-release-date") seed.run("UPDATE hololive_music_release_dates SET release_date='2022-02-31'");
    if (failure === "wrong-version") seed.run("UPDATE settings SET value='wrong' WHERE key='hololive.officialDataVersion'");
    const modified = Buffer.from(seed.export()); seed.close();
    const payload = gzipSync(modified);
    const next = structuredClone(manifest);
    Object.assign(next.database, {bytes: payload.length, sha256: catalogHash(payload), uncompressedBytes: modified.length, uncompressedSha256: catalogHash(modified)});
    const f = fixture(next, payload);
    expect(await f.service.checkForUpdates()).toBe("failed");
    expect(f.merge).not.toHaveBeenCalled();
    expect(f.onApplied).not.toHaveBeenCalled();
  });

  it.each(["disabled", "current", "requires-app-update"])("does not download database when %s", async reason => {
    const next = structuredClone(manifest);
    if (reason === "requires-app-update") next.minAppVersion = "2.0.0";
    const f = fixture(next);
    if (reason === "disabled") f.settings["hololive.catalogAutoUpdates"] = "false";
    if (reason === "current") f.settings["hololive.officialDataVersion"] = version;
    expect(await f.service.checkForUpdates()).toBe(reason);
    expect(f.fetcher).toHaveBeenCalledTimes(reason === "disabled" ? 0 : 1);
    expect(f.merge).not.toHaveBeenCalled();
  });

  it("waits for a later check while a user's local refresh is active", async () => {
    const f = fixture();
    await f.service.withLocalRefresh(async () => {
      expect(await f.service.checkForUpdates()).toBe("busy");
      expect(f.fetcher).not.toHaveBeenCalled();
    });
    expect(await f.service.checkForUpdates()).toBe("merged");
  });

  it("does not apply if a local refresh begins during downloading", async () => {
    const f = fixture();
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    let local: Promise<void> | undefined;
    vi.mocked(f.fetcher).mockImplementation(async url => {
      if (String(url).endsWith(".json")) return Response.json(manifest);
      local = f.service.withLocalRefresh(() => held);
      return new Response(compressed);
    });
    expect(await f.service.checkForUpdates()).toBe("busy");
    expect(f.merge).not.toHaveBeenCalled();
    release(); await local;
  });

  it("waits for an in-flight catalog merge before starting a local refresh", async () => {
    const f = fixture();
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    let merging!: () => void;
    const started = new Promise<void>(resolve => { merging = resolve; });
    vi.mocked(f.merge).mockImplementation(async () => { merging(); await held; return {status: "merged"} as never; });
    const check = f.service.checkForUpdates(); await started;
    const work = vi.fn(async () => undefined);
    const local = f.service.withLocalRefresh(work);
    await Promise.resolve(); expect(work).not.toHaveBeenCalled();
    release(); await check; await local;
    expect(work).toHaveBeenCalledOnce();
  });

  it("does not announce or retry immediately after a failed merge", async () => {
    const f = fixture();
    vi.mocked(f.merge).mockRejectedValue(new Error("Cannot write database"));
    expect(await f.service.checkForUpdates()).toBe("failed");
    expect(f.onApplied).not.toHaveBeenCalled();
    expect(await f.service.checkForUpdates()).toBe("recently-checked");
  });

  it.each(["https://example.com/catalog.sqlite.gz", "https://github.com/other/repo/releases/download/v1/holoshelf-catalog-test.sqlite.gz", "http://127.0.0.1/x"])("rejects untrusted download locations: %s", url => {
    expect(() => parseCatalogUpdateManifest({...manifest, database: {...manifest.database, url}})).toThrow();
  });
});
