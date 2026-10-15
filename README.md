# Holoshelf

Holoshelf is a Windows desktop app for keeping a local Hololive music, talent, tier-list, playlist, and bracket shelf. It is an unofficial fan project and stores your data locally in SQLite.

## Features

- Drag-and-drop Hololive tier list maker with multiple boards and customization.
- Hololive music catalog built from Holodex data, including originals, covers, collabs, and duplicate cleanup.
- YouTube playlist-style player, queue, favorites, markers, ratings, and exclusions.
- Custom talent support for personal local additions.
- Single- and double-elimination song brackets with saved runs, exports, and format-filtered historical stats.
- Optional Holodex and YouTube API keys that are locally stored for manual updating.
- GitHub Releases auto-update support for packaged Windows builds.

## Updating bundled release data

Double-click `Update Release Data.cmd` to refresh the maintainer database and regenerate the sanitized data shipped with the installer. The source database is `data/holoshelf.sqlite`; an installed app keeps personal data separately in AppData.

For an existing installation, the wizard defaults to a fast **data-only update**: it applies the new bundled catalog directly and verifies the AppData merge. The app version stays the same. A full app rebuild/install with a patch-version bump remains available for app-code changes, along with a seed-only option.

The data-only updater stages the complete seed, reuses unchanged files through hard links (or copies when unsupported), and swaps the installed seed directory. It retains the old seed and a personal database snapshot until verification succeeds. A verification failure closes the app and restores both snapshots. Unsupported manifests and older seeds are rejected before installation. If restoration itself fails, recovery files are retained and their location is reported.

Holodex pages, collaboration channels, and missing video details now use up to four simultaneous requests. Channel metadata and music fetching share the existing quota of 76 requests per 120 seconds. A server `Retry-After` response pauses all workers. The full historical scan, cleanup rules, backups, and seed sanitization remain enabled. Collaboration responses already include video details, so those details are reused instead of requested again ([Holodex API documentation](https://docs.holodex.net/)).

YouTube statistics also use four simultaneous 50-video batches, with one database write per group. Failed HTTP requests and malformed responses do not remove videos. The console reports stage timings and quota waits; `data/holodex-refresh/latest/summary.json` records `timingsMs`. The wizard also reports elapsed time for build and install commands.

Database startup maintenance now persists one complete snapshot after its migrations, channel updates, and cleanup finish. Normal user edits retain immediate persistence. In the bundled-database benchmark this reduced startup from **8.41 to 5.43 seconds**, and reduced full SQLite writes from **182 to one**. A failed startup leaves the original disk snapshot unchanged. The release tool uses this immediately; choose a full app update once to include the startup improvement in the installed app, then use data-only updates for subsequent catalog refreshes.

Interrupted Holodex refreshes can resume from completed API responses under `data/release-request-cache`. Saved responses bypass network requests and quota waits; API credentials are hashed for cache identity and are not stored in the cache. Sessions expire after one hour and are invalidated when a refresh completes. Changing the database version, query options, or API credentials prevents inappropriate reuse. A resumed dataset keeps the original fetch session's timestamp. Every completed run starts fresh next time. To discard an unfinished session explicitly:

```powershell
npm run release:data:refresh -- --fresh
```

Concurrency can be adjusted independently (1–8) when running the refresh directly. For serial requests:

```powershell
npm run release:data:refresh -- --concurrency=1 --stats-concurrency=1
```

Run the offline benchmark without API keys or network access:

```powershell
npm run build:electron
node scripts/benchmark-release-data.mjs
node scripts/benchmark-release-data.mjs --concurrency=1
node scripts/benchmark-release-data.mjs --resume
node scripts/benchmark-data-only-update.mjs
```

The benchmark uses simulated API latency and a disposable copy of the bundled seed under `data/benchmarks`. It never reads the maintainer database. A local comparison with 20 ms simulated latency produced:

| Measurement | Previous implementation | Optimized default |
| --- | ---: | ---: |
| Holodex fetching and cleanup | 4,789 ms | 808 ms |
| Holodex requests | 158 | 99 |
| YouTube statistics for 2,943 videos | 2,692 ms | 726 ms |
| Full SQLite rewrites during statistics | 59 | 15 |
| SQLite bytes written during statistics | 952 MiB | 242 MiB |

The cleaned Holodex output hashes matched. These measurements isolate fetching, cleanup, and statistics; they exclude installer packaging. Live timings depend on API latency and quota waits, so the benchmark speedup does not predict the complete release workflow's duration.

A second local experiment measured the full installer build at **50.3 seconds**, before installer execution or app startup. Applying a changed database and reports directly to a disposable installation took **0.42 seconds** for staging, or **5.91 seconds including the real SQLite merge**. It copied seven changed files (25 MiB), reused 297 unchanged files, and verified personal marker values. This integration benchmark excludes launching the installed Electron app.

For a simulated interruption after 60 successful Holodex responses, the retry used **39 live requests instead of repeating all 99**, with the same cleaned-output hash. Resume only accelerates unfinished runs; fresh full scans remain subject to upstream latency and the configured quota.
