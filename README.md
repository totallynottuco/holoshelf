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

Double-click `Update Release Data.cmd` to refresh the maintainer database and regenerate the sanitized data shipped with the installer. The wizard can then bump the patch version, package, install, and verify a local update. The source database is `data/holoshelf.sqlite`; an installed app keeps personal data separately in AppData.

Holodex pages, collaboration channels, and missing video details now use up to four simultaneous requests. Channel metadata and music fetching share the existing quota of 76 requests per 120 seconds. A server `Retry-After` response pauses all workers. The full historical scan, cleanup rules, backups, and seed sanitization remain enabled. Collaboration responses already include video details, so those details are reused instead of requested again ([Holodex API documentation](https://docs.holodex.net/)).

YouTube statistics also use four simultaneous 50-video batches, with one database write per group. Failed HTTP requests and malformed responses do not remove videos. The console reports stage timings and quota waits; `data/holodex-refresh/latest/summary.json` records `timingsMs`. The wizard also reports elapsed time for build and install commands.

Concurrency can be adjusted independently (1–8) when running the refresh directly. For serial requests:

```powershell
npm run release:data:refresh -- --concurrency=1 --stats-concurrency=1
```

Run the offline benchmark without API keys or network access:

```powershell
npm run build:electron
node scripts/benchmark-release-data.mjs
node scripts/benchmark-release-data.mjs --concurrency=1
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
