// Offline benchmark: uses a disposable copy of the bundled seed and simulated API latency.
// Never reads the maintainer's source database or makes network requests.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { createHash } from "node:crypto";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { DatabaseService } = require("../dist-electron/electron/services/database.js");
const { HolodexMusicService } = require("../dist-electron/electron/services/holodexMusicService.js");
const { YouTubeVideoStatsService } = require("../dist-electron/electron/services/youtubeVideoStatsService.js");
const { ReleaseRequestCache } = require("../dist-electron/electron/services/releaseRequestCache.js");
const latencyMs = Number(process.argv.find((arg) => arg.startsWith("--latency-ms="))?.split("=")[1] ?? 20);
const concurrency = Number(process.argv.find((arg) => arg.startsWith("--concurrency="))?.split("=")[1] ?? 4);
const benchmarkResume = process.argv.includes("--resume");
const delay = () => new Promise((resolve) => setTimeout(resolve, latencyMs));
const benchmarkRoot = path.join(root, "data", "benchmarks");
fs.mkdirSync(benchmarkRoot, { recursive: true });
const directory = fs.mkdtempSync(path.join(benchmarkRoot, "refresh-"));
const databasePath = path.join(directory, "holoshelf.sqlite");
fs.copyFileSync(path.join(root, "resources/seed/holoshelf-template.sqlite"), databasePath);
const database = new DatabaseService(databasePath, path.join(directory, "backups"), { createBackups: false });
let startupFlushes = 0;
const startupFlush = database.flush.bind(database);
database.flush = () => { startupFlushes += 1; startupFlush(); };
const startupStartedAt = performance.now();
await database.init();
const startupMs = Math.round(performance.now() - startupStartedAt);
database.flush = startupFlush;
const channelIds = database.listHololiveIdolMainChannels().map((link) => link.youtubeChannelId).slice(0, 60);
const channels = channelIds.map((id) => ({ id, name: id, org: "Hololive", type: "vtuber" }));
const makeItem = (index, topic = "Original_Song") => ({
  id: `benchmark-${topic}-${index}`, title: `Benchmark Song ${topic} ${index}`, type: "stream",
  topic_id: topic, status: "past", published_at: "2026-01-01T00:00:00.000Z", duration: 180,
  channel: channels[index % channels.length], description: "", songs: [{ name: `Song ${index}` }], mentions: []
});
let requests = 0;
let active = 0;
let maxActive = 0;
let importedBundle;
let remainingBeforeFailure = Infinity;
const fakeDatabase = {
  getSettings: () => ({}),
  listHololiveChannels: () => channels.map((channel) => ({ ...channel, kind: "main" })),
  listHololiveIdols: () => channelIds.map((id) => ({ id, source: "official" })),
  listHololiveIdolMainChannels: () => channelIds.map((id) => ({ idolId: id, youtubeChannelId: id })),
  listHolodexDetailCache: () => ({}),
  importHolodexMusicArtifacts: (bundle) => {
    importedBundle = bundle;
    return { run: { status: "completed" }, importedRows: bundle.rows.length };
  },
  recordFailedHolodexRefresh: (error) => { throw new Error(error.error); }
};
const fetcher = async (input) => {
  requests += 1;
  maxActive = Math.max(maxActive, ++active);
  await delay();
  active -= 1;
  if (--remainingBeforeFailure < 0) { return new Response("simulated interruption", { status: 503 }); }
  const url = new URL(String(input));
  if (url.pathname === "/api/v2/videos") {
    const offset = Number(url.searchParams.get("offset"));
    const topic = url.searchParams.get("topic");
    return Response.json({ total: 1000, items: Array.from({ length: 50 }, (_, i) => makeItem(offset + i, topic)) });
  }
  if (url.pathname.endsWith("/collabs")) {
    const index = channelIds.indexOf(url.pathname.split("/")[4]);
    return Response.json({ total: 1, items: [makeItem(1000 + index)] });
  }
  const id = url.pathname.split("/").at(-1);
  const index = Number(id.split("-").at(-1));
  return Response.json(makeItem(index));
};
const cacheOptions = { directory: path.join(directory, "cache"), scope: "offline-fixture" };
if (benchmarkResume) {
  remainingBeforeFailure = 60;
  const interrupted = new HolodexMusicService(fakeDatabase, fetcher, null, {
    requestConcurrency: concurrency, responseCache: new ReleaseRequestCache(cacheOptions)
  });
  try {
    await interrupted.refreshLive({ includeChannels: false, includeCustomTalents: false, maxRequestsPerWindow: 10000 });
  } catch { /* Deliberately resume an interrupted refresh below. */ }
  remainingBeforeFailure = Infinity;
  requests = 0;
  maxActive = 0;
}
const responseCache = benchmarkResume ? new ReleaseRequestCache(cacheOptions) : undefined;
const holodex = new HolodexMusicService(fakeDatabase, fetcher, null, { requestConcurrency: concurrency, responseCache });
let started = performance.now();
await holodex.refreshLive({ includeChannels: false, includeCustomTalents: false, maxRequestsPerWindow: 10000 });
const holodexMs = performance.now() - started;
const digest = createHash("sha256").update(JSON.stringify({
  rows: importedBundle.rows,
  details: Object.entries(importedBundle.detailCache).sort(([a], [b]) => a.localeCompare(b)),
  duplicates: importedBundle.duplicateRemovals
})).digest("hex");

let flushes = 0;
let exportedBytes = 0;
const originalFlush = database.flush.bind(database);
database.flush = () => {
  originalFlush();
  flushes += 1;
  exportedBytes += fs.statSync(databasePath).size;
};
let statsRequests = 0;
const stats = new YouTubeVideoStatsService(database, {
  apiKey: "offline-benchmark", requestConcurrency: concurrency,
  fetcher: async (input) => {
    statsRequests += 1;
    await delay();
    const ids = new URL(String(input)).searchParams.get("id").split(",");
    return Response.json({ items: ids.map((id) => ({ id, statistics: { viewCount: "1234567" } })) });
  }
});
started = performance.now();
const statsResult = await stats.refreshViewCounts();
console.log(JSON.stringify({
  latencyMs, concurrency,
  startup: { elapsedMs: startupMs, fullDatabaseWrites: startupFlushes },
  holodex: { elapsedMs: Math.round(holodexMs), requests, maxActive, rows: importedBundle.rows.length, digest,
    resumeCache: responseCache?.getMetrics() },
  youtube: {
    elapsedMs: Math.round(performance.now() - started), requests: statsRequests,
    updatedVideos: statsResult.updatedVideos, flushes, exportedMiB: Math.round(exportedBytes / 1024 / 1024)
  }
}, null, 2));
// Retain the disposable database only for the duration of this process. No cleanup touches user data.
fs.rmSync(directory, { recursive: true, force: true });
