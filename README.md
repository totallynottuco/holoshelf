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

The batch runner and `npm run release:data:refresh` automatically load maintainer keys from `secrets/api-keys.txt`. Each line uses `HOLODEX your-key` or `YOUTUBE your-key`; `NAME=value` and `NAME: value` also work. To keep the existing file outside the repository, create an ignored `.release-secrets.json` containing `{"directory":"C:/path/to/secrets"}`, or set `HOLOSHELF_RELEASE_SECRETS_DIR`. Explicit API key arguments and environment variables take priority. The wizard only asks for keys that are missing. Key values are passed in memory, never printed or added to the installer; the secrets folder and local path configuration are ignored by Git. Run `npm run release:data:wizard -- --check-credentials` to check configuration without refreshing data or revealing values.

For an existing installation, the wizard defaults to a fast **data-only update**: it applies the new bundled catalog directly and verifies the AppData merge. The app version stays the same. A full app rebuild/install with a patch-version bump remains available for app-code changes, along with a seed-only option.

Wizard option **4: Update local data and publish a silent songs/stats update to GitHub** refreshes the complete Holodex catalog and YouTube stats, validates the sanitized seed, applies and verifies a local data-only update when Holoshelf is installed, then uploads a compressed database and `holoshelf-catalog.json` to the existing latest stable GitHub release. It does not create a release or tag, change release notes, upload an installer, bump the app version, or push source commits. It requires GitHub CLI authentication with release-upload access. Existing immutable releases cannot accept asset updates. The wizard checks publishing prerequisites before spending API quota. Option 1 continues to apply a local data-only update without publishing.

**One app release at version 1.1.90 or later is required first.** Older installations do not know about this data channel and must receive the app update once. Compatible clients check in the background shortly after startup and every six hours while open. Downloads require no API keys, and updates have no popup, patch-notes dialog, or restart. Settings includes **Automatically keep songs and stats up to date**, enabled by default. Normal app releases also publish their catalog through this channel. GitHub's own watcher notification preferences are outside the app's control; this publisher only changes assets on an existing release.

Clients validate the repository download URL, app compatibility, compressed and SQLite checksums, bounded sizes, database integrity, version, absence of personal records/secrets, and complete fresh statistics before merging. The existing transactional merge preserves personal playlists, markers, exclusions, custom songs/talents, tiers, brackets, and newer personal stats. A failed download or validation leaves the current catalog usable. User-requested API refreshes take precedence. Visible libraries refresh quietly without reloading the window or interrupting playback. Only songs, stats, and catalog metadata travel through this channel; image files continue through the existing image cache.

To inspect the assets without publishing, or publish an already fully refreshed seed:

```powershell
npm run release:data:publish -- --prepare-only
npm run release:data:publish -- --yes
```

The publisher verifies the payload asset before replacing the small manifest and retains older payloads so cached manifests remain usable. It refuses older snapshots, inconsistent same-version contents, or a release that changed during publication. GitHub may briefly return 404 while a manifest is replaced; clients keep their current data and check again later.

The data-only updater stages the complete seed, reuses unchanged files through hard links (or copies when unsupported), and swaps the installed seed directory. It retains the old seed and a personal database snapshot until verification succeeds. A verification failure closes the app and restores both snapshots. Unsupported manifests and older seeds are rejected before installation. If restoration itself fails, recovery files are retained and their location is reported.

Holodex pages, collaboration channels, and missing video details now use up to four simultaneous requests. Channel metadata and music fetching share the existing quota of 76 requests per 120 seconds. Low remaining quota reported by the server pauses new requests until its reset, retaining four requests of headroom; a `Retry-After` response also pauses all workers. Server headers can only tighten the local quota. The full historical scan, cleanup rules, backups, and seed sanitization remain enabled. Collaboration responses already include video details, so those details are reused instead of requested again ([Holodex API documentation](https://docs.holodex.net/)).

Official music now requests up to 5,000 videos per page, and channel metadata requests up to 500 channels, with the same descriptions, songs, and mentions. Live checks confirmed that the current API accepts these larger pages, although its older documentation lists a smaller limit. Video pagination follows the actual returned page size, falls back to 50 if the API rejects the larger limit, and verifies unique IDs against each topic's reported total before replacing the catalog. Missing pages, changing totals, duplicate IDs, and malformed responses fail the refresh and discard inconsistent resume pages. `holodexCoverage` records the checked totals in the release summary. Channel pagination counts raw records before filtering excluded channels, adapts to the documented 50-channel cap or rejected larger requests, and rejects repeated or malformed records. Existing HOLOSTARS exclusions also cover the English group channel. Transport failures and server errors retry twice within the same quota.

A fresh live scan with the larger pages took **25.4 seconds for fetching and cleanup including channels**, compared with **148 seconds** using 500-video and 50-channel pages. Requests fell from **90 to 76**, and quota waiting fell from about **69 seconds to zero**, with zero retries. It fetched all **6,565** reported uploads, all **138** raw channel records, and the same **73** collaboration-channel queries. Replaying identical captured responses through both implementations produced exactly matching cleaned rows, metadata, and duplicate decisions. Database import is separate and takes about seven seconds. The shared quota remained unchanged. Timings depend on upstream latency; retries, additional channels, or catalog growth can still require legitimate waits.

YouTube statistics also use four simultaneous 50-video batches, with one database write per group. Failed HTTP requests and malformed responses do not remove videos. The console reports stage timings and quota waits; `data/holodex-refresh/latest/summary.json` records `timingsMs` and `holodexRequestMetrics` (requests, retries, and elapsed `quotaWaitMs`, counting simultaneous waiters once). The wizard also reports elapsed time for build and install commands.

Statistics cover every active official catalog video, including group songs without an individual talent assignment. Duplicate cleanup runs before the API requests and again after fresh counts arrive, because representative selection can depend on view counts. Progress reports batches and updated counts; transient network/429/5xx failures are retried twice, while invalid counts and duplicate or unexpected response IDs fail the batch. A full stats refresh refuses to generate a seed until saved counts cover the remaining catalog with fresh timestamps. The summary records `statsCoverage` and `statsRefreshComplete`; explicitly skipped or limited refreshes remain visible. Installation verifies the actual YouTube counts and timestamps in both the installed seed and AppData, allowing newer personal refreshes and personal exclusions.

When using `--db`, `--images`, or `--artifacts`, seed generation uses those resolved source paths too. An explicit missing database fails instead of silently reusing an older seed.

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
node scripts/benchmark-release-data.mjs --page-size=50
node scripts/benchmark-release-data.mjs --concurrency=1
node scripts/benchmark-release-data.mjs --resume
node scripts/benchmark-data-only-update.mjs
```

The benchmark uses simulated API latency and a disposable copy of the bundled seed under `data/benchmarks`. It never reads the maintainer database. Before the larger-page changes, a local comparison with 20 ms simulated latency produced:

| Measurement | Previous implementation | Initial parallel implementation |
| --- | ---: | ---: |
| Holodex fetching and cleanup | 4,789 ms | 808 ms |
| Holodex requests | 158 | 99 |
| YouTube statistics for 2,943 videos | 2,692 ms | 726 ms |
| Full SQLite rewrites during statistics | 59 | 15 |
| SQLite bytes written during statistics | 952 MiB | 242 MiB |

The cleaned Holodex output hashes matched. These measurements isolate fetching, cleanup, and statistics; they exclude installer packaging. Live timings depend on API latency and quota waits, so the benchmark speedup does not predict the complete release workflow's duration.

A second local experiment measured the full installer build at **50.3 seconds**, before installer execution or app startup. Applying a changed database and reports directly to a disposable installation took **0.42 seconds** for staging, or **5.91 seconds including the real SQLite merge**. It copied seven changed files (25 MiB), reused 297 unchanged files, and verified personal marker values. This integration benchmark excludes launching the installed Electron app.

Before the larger-page changes, a simulated interruption after 60 successful Holodex responses resumed with **39 live requests instead of repeating all 99**, with the same cleaned-output hash. Resume only accelerates unfinished runs; fresh full scans remain subject to upstream latency and the configured quota.
