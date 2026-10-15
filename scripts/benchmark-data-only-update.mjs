// Offline integration benchmark. Every file and database is disposable.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { applyInstalledSeedUpdate } = require("../dist-electron/electron/services/installedSeedUpdate.js");
const { mergeBundledOfficialData } = require("../dist-electron/electron/services/officialDataMergeService.js");
const { DatabaseService } = require("../dist-electron/electron/services/database.js");
const benchmarkRoot = path.join(root, "data", "benchmarks");
fs.mkdirSync(benchmarkRoot, { recursive: true });
const temporaryRoot = fs.mkdtempSync(path.join(benchmarkRoot, "data-only-"));
try {
  const sourceDirectory = path.join(temporaryRoot, "project", "seed");
  const installedDirectory = path.join(temporaryRoot, "installed", "resources", "seed");
  const dataDirectory = path.join(temporaryRoot, "personal");
  const databasePath = path.join(dataDirectory, "holoshelf.sqlite");
  fs.cpSync(path.join(root, "resources/seed"), sourceDirectory, { recursive: true });
  fs.cpSync(sourceDirectory, installedDirectory, { recursive: true });
  fs.mkdirSync(dataDirectory, { recursive: true });
  fs.copyFileSync(path.join(sourceDirectory, "holoshelf-template.sqlite"), databasePath);
  const sourceManifest = JSON.parse(fs.readFileSync(path.join(sourceDirectory, "official-data.json"), "utf8"));
  sourceManifest.version = "2099-01-01T000000Z";
  fs.writeFileSync(path.join(sourceDirectory, "official-data.json"), JSON.stringify(sourceManifest));
  // Model a normal refresh: database/reports change while cached images stay the same.
  const sourceDatabase = new DatabaseService(path.join(sourceDirectory, "holoshelf-template.sqlite"), undefined, { createBackups: false });
  await sourceDatabase.init();
  sourceDatabase.setSetting("hololive.officialDataVersion", sourceManifest.version);
  for (const file of fs.readdirSync(path.join(sourceDirectory, "holodex-refresh/latest"))) {
    if (file.endsWith(".csv")) { fs.appendFileSync(path.join(sourceDirectory, "holodex-refresh/latest", file), "\n"); }
  }
  const original = new DatabaseService(databasePath, path.join(dataDirectory, "backups"), { createBackups: false });
  await original.init();
  const videoId = original.listHololiveMusicVideoIdsForStats()[0];
  original.setHololiveMusicMarker({ youtubeVideoId: videoId, marker: "like" });
  const beforeMarkers = original.select("SELECT marker_key, marker FROM hololive_music_marker_keys ORDER BY marker_key");
  let verifiedAt;
  const startedAt = performance.now();
  const result = await applyInstalledSeedUpdate({
    sourceDirectory, installedDirectory, databasePath,
    stopApp: async () => {},
    verify: async () => {
      verifiedAt = performance.now();
      const database = new DatabaseService(databasePath, path.join(dataDirectory, "backups"), { createBackups: false });
      await database.init();
      await mergeBundledOfficialData({ database, isPackaged: true, paths: {
        dataDirectory, seedDirectory: installedDirectory,
        hololiveImageDirectory: path.join(dataDirectory, "images/hololive")
      } });
      const afterMarkers = database.select("SELECT marker_key, marker FROM hololive_music_marker_keys ORDER BY marker_key");
      if (database.getSettings()["hololive.officialDataVersion"] !== sourceManifest.version ||
        !beforeMarkers.every((before) => afterMarkers.some((after) => after.marker_key === before.marker_key && after.marker === before.marker))) {
        throw new Error("Data merge or personal marker preservation failed");
      }
    }
  });
  console.log(JSON.stringify({
    stageMs: Math.round(verifiedAt - startedAt),
    totalWithRealMergeMs: Math.round(performance.now() - startedAt),
    ...result, personalMarkerPreserved: true
  }, null, 2));
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
