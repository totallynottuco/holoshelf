import fs from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { CATALOG_CHECK_INTERVAL_MS, CATALOG_MANIFEST_ASSET, CATALOG_REPOSITORY, appVersionAtLeast, parseCatalogUpdateManifest } from "../../src/shared/catalogUpdate";
import { catalogHash, validateCatalogDatabase } from "./catalogUpdatePackage";
import { mergeBundledOfficialData } from "./officialDataMergeService";
import type { DatabaseService } from "./database";
import type { AppPathSet } from "./appPaths";

interface CatalogUpdateOptions {
  database: DatabaseService;
  paths: AppPathSet;
  appVersion: string;
  fetcher?: typeof fetch;
  merge?: typeof mergeBundledOfficialData;
  log?: (message: string) => void;
  onApplied?: (version: string) => void;
  canApply?: () => boolean;
}

async function readBounded(response: Response, maximum: number): Promise<Buffer> {
  if (Number(response.headers.get("content-length")) > maximum) throw new Error("Catalog download is too large");
  if (!response.body) throw new Error("Empty catalog response");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maximum) throw new Error("Catalog download is too large");
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  return Buffer.concat(chunks);
}

export class CatalogUpdateService {
  private initialTimer: ReturnType<typeof setTimeout> | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;
  private pending: Promise<string> | null = null;
  private applying: Promise<unknown> | null = null;
  private localRefreshes = 0;
  private stopped = false;

  constructor(private readonly options: CatalogUpdateOptions) {}

  start(): void {
    if (this.interval) return;
    this.stopped = false;
    this.initialTimer = setTimeout(() => { void this.checkForUpdates(); }, 30_000);
    this.interval = setInterval(() => { void this.checkForUpdates(); }, CATALOG_CHECK_INTERVAL_MS);
    this.initialTimer.unref(); this.interval.unref();
  }

  stop(): void {
    this.stopped = true;
    if (this.initialTimer) clearTimeout(this.initialTimer);
    if (this.interval) clearInterval(this.interval);
    this.initialTimer = null; this.interval = null;
  }

  async withLocalRefresh<T>(work: () => Promise<T>): Promise<T> {
    this.localRefreshes++;
    try { await this.applying; return await work(); } finally { this.localRefreshes--; }
  }

  checkForUpdates(force = false): Promise<string> {
    this.pending ??= this.check(force).catch(error => {
      this.options.log?.(`[catalog-update] deferred: ${error instanceof Error ? error.message : String(error)}`);
      return "failed";
    }).finally(() => { this.pending = null; });
    return this.pending;
  }

  private async check(force: boolean): Promise<string> {
    const {database, paths} = this.options;
    if (this.stopped || database.getSettings()["hololive.catalogAutoUpdates"] === "false") return "disabled";
    if (this.localRefreshes || this.options.canApply?.() === false) return "busy";
    const cache = path.join(paths.dataDirectory, "catalog-updates");
    const checkedFile = path.join(cache, "last-check.json");
    try {
      const checked = JSON.parse(fs.readFileSync(checkedFile, "utf8"));
      const elapsed = Date.now() - checked.checkedAt;
      if (!force && elapsed >= 0 && elapsed < CATALOG_CHECK_INTERVAL_MS) return "recently-checked";
    } catch { /* First check or interrupted timestamp write. */ }
    const fetcher = this.options.fetcher ?? globalThis.fetch.bind(globalThis);
    const get = (url: string) => fetcher(url, {signal: AbortSignal.timeout(90_000), cache: "no-store"});
    fs.mkdirSync(cache, {recursive: true});
    fs.writeFileSync(checkedFile, JSON.stringify({checkedAt: Date.now()}));
    const response = await get(`https://github.com/${CATALOG_REPOSITORY}/releases/latest/download/${CATALOG_MANIFEST_ASSET}`);
    if (response.status === 404) return "not-published";
    if (!response.ok) throw new Error(`Catalog manifest HTTP ${response.status}`);
    const manifest = parseCatalogUpdateManifest(JSON.parse((await readBounded(response, 16_384)).toString()));
    if (!appVersionAtLeast(this.options.appVersion, manifest.minAppVersion)) return "requires-app-update";
    if ((database.getSettings()["hololive.officialDataVersion"] ?? "") >= manifest.version) return "current";
    const payload = await get(manifest.database.url);
    if (!payload.ok) throw new Error(`Catalog database HTTP ${payload.status}`);
    const compressed = await readBounded(payload, manifest.database.bytes);
    if (compressed.length !== manifest.database.bytes || catalogHash(compressed) !== manifest.database.sha256) throw new Error("Catalog download checksum does not match");
    const bytes = gunzipSync(compressed, {maxOutputLength: manifest.database.uncompressedBytes});
    await validateCatalogDatabase(bytes, manifest);
    // Local API refreshes take precedence. Check again after all async work.
    if (this.stopped || this.localRefreshes || this.options.canApply?.() === false ||
        database.getSettings()["hololive.catalogAutoUpdates"] === "false") return "busy";
    const stage = fs.mkdtempSync(path.join(cache, "stage-"));
    try {
      fs.writeFileSync(path.join(stage, "holoshelf-template.sqlite"), bytes);
      fs.writeFileSync(path.join(stage, "official-data.json"), JSON.stringify({schema: 1, version: manifest.version, generatedAt: manifest.generatedAt}));
      const merging = (this.options.merge ?? mergeBundledOfficialData)({database, paths: {...paths, seedDirectory: stage}, isPackaged: true, log: this.options.log});
      this.applying = merging;
      const result = await merging;
      if (result.status === "merged") {
        this.options.log?.(`[catalog-update] applied ${manifest.version}`);
        this.options.onApplied?.(manifest.version);
      }
      return result.status;
    } finally {
      this.applying = null;
      // Only the freshly created child of our cache directory is removed.
      fs.rmSync(stage, {recursive: true, force: true});
    }
  }
}
