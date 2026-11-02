// Publish data assets on the existing app release. Never create a release/tag,
// alter installer assets or release notes, or push source-code commits.
import fs from "node:fs";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import {gzipSync} from "node:zlib";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
let runtime;
function catalogRuntime() {
  runtime ??= {
    ...require("../dist-electron/src/shared/catalogUpdate.js"),
    ...require("../dist-electron/electron/services/catalogUpdatePackage.js")
  };
  return runtime;
}

function gh(args, capture = true) {
  // The Windows npm shim is a command file. Locate the installed CLI binary
  // instead of passing publication arguments through a command shell.
  const command = process.platform === "win32" ? "gh.exe" : "gh";
  return execFileSync(command, args, {cwd: root, encoding: "utf8", stdio: capture ? "pipe" : "inherit", windowsHide: true});
}

function currentRelease(runGh = gh) {
  const {CATALOG_REPOSITORY, CATALOG_MIN_APP_VERSION, appVersionAtLeast} = catalogRuntime();
  const release = JSON.parse(runGh(["api", `repos/${CATALOG_REPOSITORY}/releases/latest`]));
  if (release.draft || release.prerelease || release.immutable) throw new Error("Silent catalog publishing needs an existing mutable stable app release");
  if (!appVersionAtLeast(release.tag_name, CATALOG_MIN_APP_VERSION)) {
    throw new Error(`Publish an app release >= ${CATALOG_MIN_APP_VERSION} first. ${release.tag_name} cannot receive silent catalog updates.`);
  }
  if (process.env.GITHUB_REF_TYPE === "tag" && process.env.GITHUB_REF_NAME !== release.tag_name) {
    throw new Error("The app release being built is no longer the latest stable release");
  }
  release.assets = releaseAssets(release.id, runGh);
  return release;
}

function releaseAssets(id, runGh = gh) {
  const {CATALOG_REPOSITORY} = catalogRuntime();
  return JSON.parse(runGh(["api", `repos/${CATALOG_REPOSITORY}/releases/${id}/assets?per_page=100`, "--paginate", "--slurp"])).flat();
}

export function assertVideoAvailabilityVerification(summary, seed) {
  const receipt = summary.videoAvailabilityVerification;
  if (receipt?.schema !== 1 || typeof receipt.checkedAt !== "string" || !Number.isFinite(Date.parse(receipt.checkedAt)) ||
      receipt.checkedAt !== summary.videoStatsRefresh?.fetchedAt ||
      !Number.isSafeInteger(receipt.retainedVideos) || receipt.retainedVideos < 0 || receipt.retainedVideos !== seed.musicRows ||
      !Number.isSafeInteger(receipt.checkedVideos) || receipt.checkedVideos < receipt.retainedVideos) {
    throw new Error("Refresh the catalog with YouTube availability verification before publishing");
  }
}

export async function prepareCatalogUpdate({seedDirectory = path.join(root, "resources/seed"), outputDirectory = path.join(root, "data/catalog-publish"), tag = "preview"} = {}) {
  const seed = JSON.parse(fs.readFileSync(path.join(seedDirectory, "official-data.json"), "utf8"));
  const summary = JSON.parse(fs.readFileSync(path.join(seedDirectory, "holodex-refresh/latest/summary.json"), "utf8"));
  if (seed.schema !== 1 || seed.seedDatabase !== "holoshelf-template.sqlite" || seed.version !== summary.officialDataVersion ||
      !summary.holodexCoverage?.complete || !summary.refreshHolodex || !summary.refreshChannels || !summary.refreshStats || !summary.includeCollabs ||
      !summary.statsRefreshComplete || summary.videoStatsRefresh?.failedBatches !== 0 ||
      summary.statsCoverage?.catalogVideos !== seed.musicRows) throw new Error("Refresh the complete Holodex catalog and YouTube stats before publishing");
  assertVideoAvailabilityVerification(summary, seed);
  for (const topic of ["Music_Cover", "Original_Song"]) {
    const coverage = summary.holodexCoverage.topics?.[topic];
    if (!coverage?.complete || coverage.fetched !== coverage.total) throw new Error(`Incomplete ${topic} coverage`);
  }
  const {CATALOG_REPOSITORY, CATALOG_MIN_APP_VERSION, parseCatalogUpdateManifest, catalogHash, validateCatalogDatabase, CATALOG_MANIFEST_ASSET} = catalogRuntime();
  const bytes = fs.readFileSync(path.join(seedDirectory, seed.seedDatabase));
  const payload = gzipSync(bytes, {level: 9});
  const assetName = `holoshelf-catalog-${seed.version}-${catalogHash(payload).slice(0, 16)}.sqlite.gz`;
  const manifest = parseCatalogUpdateManifest({schema: 1, version: seed.version, generatedAt: seed.generatedAt,
    minAppVersion: CATALOG_MIN_APP_VERSION, musicRows: seed.musicRows, statsFetchedAt: summary.videoStatsRefresh.fetchedAt,
    database: {url: `https://github.com/${CATALOG_REPOSITORY}/releases/download/${encodeURIComponent(tag)}/${assetName}`,
      bytes: payload.length, sha256: catalogHash(payload), uncompressedBytes: bytes.length, uncompressedSha256: catalogHash(bytes)}});
  await validateCatalogDatabase(bytes, manifest);
  fs.mkdirSync(outputDirectory, {recursive: true});
  const payloadFile = path.join(outputDirectory, assetName);
  const manifestFile = path.join(outputDirectory, CATALOG_MANIFEST_ASSET);
  fs.writeFileSync(payloadFile, payload);
  fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  return {manifest, payloadFile, manifestFile, assetName};
}

export async function publishCatalogUpdate({runGh = gh, argv = process.argv.slice(2), prepare = prepareCatalogUpdate} = {}) {
  const args = new Set(argv);
  if (args.has("--help")) {
    console.log("Usage: npm run release:data:publish -- --yes\n  --check          Check GitHub access and compatible latest release only.\n  --prepare-only   Build and validate local data assets without uploading.\n  --yes            Upload data assets to the existing stable release. No version bump, release notes, tag, or installer.");
    return;
  }
  for (const arg of args) if (!["--yes", "--check", "--prepare-only"].includes(arg)) throw new Error(`Unknown option: ${arg}`);
  if (!args.has("--yes") && !args.has("--check") && !args.has("--prepare-only")) throw new Error("Choose --prepare-only or --yes to publish");
  const {CATALOG_REPOSITORY, CATALOG_MANIFEST_ASSET, parseCatalogUpdateManifest, catalogHash} = catalogRuntime();
  const release = args.has("--prepare-only") ? null : currentRelease(runGh);
  if (args.has("--check")) { console.log(`Silent catalog publishing is available on ${release.html_url}`); return; }
  const prepared = await prepare({tag: release?.tag_name ?? "preview"});
  console.log(JSON.stringify({dataVersion: prepared.manifest.version, musicRows: prepared.manifest.musicRows,
    downloadBytes: prepared.manifest.database.bytes, payloadFile: prepared.payloadFile, manifestFile: prepared.manifestFile}, null, 2));
  if (!release) return;
  // Reject stale snapshots and same-version content changes before uploading.
  const current = release.assets.find(asset => asset.name === CATALOG_MANIFEST_ASSET);
  if (current) {
    const previous = parseCatalogUpdateManifest(JSON.parse(runGh(["api", `repos/${CATALOG_REPOSITORY}/releases/assets/${current.id}`, "-H", "Accept: application/octet-stream"])));
    if (previous.version > prepared.manifest.version || (previous.version === prepared.manifest.version &&
        previous.database.uncompressedSha256 !== prepared.manifest.database.uncompressedSha256)) throw new Error("Remote catalog is newer or this data version has different contents; run a fresh refresh");
    if (previous.version === prepared.manifest.version) { console.log("This catalog is already published."); return; }
  }
  // Payloads have immutable names. Publish and verify the payload before moving
  // the small pointer. Interrupted publication leaves the old catalog usable.
  const existing = release.assets.find(asset => asset.name === prepared.assetName);
  if (!existing) runGh(["release", "upload", release.tag_name, prepared.payloadFile, "--repo", CATALOG_REPOSITORY], false);
  const assets = releaseAssets(release.id, runGh);
  const uploaded = assets.find(asset => asset.name === prepared.assetName);
  if (!uploaded || uploaded.size !== prepared.manifest.database.bytes || uploaded.digest !== `sha256:${prepared.manifest.database.sha256}`) throw new Error("Uploaded catalog payload did not verify; manifest was not changed");
  const latest = currentRelease(runGh);
  if (latest.id !== release.id) throw new Error("Latest app release changed while publishing; retry on the new release");
  if (latest.assets.find(asset => asset.name === CATALOG_MANIFEST_ASSET)?.id !== current?.id) throw new Error("Another catalog was published while uploading; retry with the current remote catalog");
  runGh(["release", "upload", release.tag_name, prepared.manifestFile, "--clobber", "--repo", CATALOG_REPOSITORY], false);
  const verified = releaseAssets(release.id, runGh);
  const pointer = verified.find(asset => asset.name === CATALOG_MANIFEST_ASSET);
  const expectedHash = catalogHash(fs.readFileSync(prepared.manifestFile));
  if (pointer?.digest !== `sha256:${expectedHash}`) throw new Error("Published catalog manifest did not verify");
  console.log(`Silent catalog ${prepared.manifest.version} published on ${release.html_url}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  publishCatalogUpdate().catch(error => { console.error(error.message); process.exitCode = 1; });
}
