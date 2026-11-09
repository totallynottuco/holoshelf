export const CATALOG_REPOSITORY = "totallynottuco/holoshelf";
export const CATALOG_MANIFEST_ASSET = "holoshelf-catalog.json";
// Release-date catalogs require the date-aware app and exact-video exclusion preservation.
// Publish the compatible app before advancing the silent catalog.
export const CATALOG_MIN_APP_VERSION = "1.1.97";
export const CATALOG_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const CATALOG_MAX_DOWNLOAD_BYTES = 64 * 1024 * 1024;
export const CATALOG_MAX_DATABASE_BYTES = 256 * 1024 * 1024;

export interface CatalogUpdateManifest {
  schema: 1;
  version: string;
  generatedAt: string;
  minAppVersion: string;
  musicRows: number;
  statsFetchedAt: string;
  database: { url: string; sha256: string; bytes: number; uncompressedSha256: string; uncompressedBytes: number };
}

export function appVersionAtLeast(actual: string, required: string): boolean {
  const parts = actual.replace(/^v/, "").split(".").map(Number);
  const minimum = required.split(".").map(Number);
  if (parts.length !== 3 || parts.some(part => !Number.isSafeInteger(part) || part < 0)) return false;
  for (let index = 0; index < 3; index++) {
    if (parts[index] !== minimum[index]) return parts[index] > minimum[index];
  }
  return true;
}

export function parseCatalogUpdateManifest(value: unknown): CatalogUpdateManifest {
  const manifest = value as CatalogUpdateManifest | null;
  const validSize = (size: unknown, maximum: number) => Number.isSafeInteger(size) && Number(size) > 0 && Number(size) <= maximum;
  const validDate = (date: unknown) => typeof date === "string" && Number.isFinite(Date.parse(date));
  if (!manifest || manifest.schema !== 1 || !/^\d{4}-\d{2}-\d{2}T\d{6}Z$/.test(manifest.version) ||
      !validDate(manifest.generatedAt) || !validDate(manifest.statsFetchedAt) ||
      !/^\d+\.\d+\.\d+$/.test(manifest.minAppVersion) || !validSize(manifest.musicRows, 1_000_000) ||
      !manifest.database || !validSize(manifest.database.bytes, CATALOG_MAX_DOWNLOAD_BYTES) ||
      !validSize(manifest.database.uncompressedBytes, CATALOG_MAX_DATABASE_BYTES) ||
      !/^[a-f0-9]{64}$/.test(manifest.database.sha256) || !/^[a-f0-9]{64}$/.test(manifest.database.uncompressedSha256)) {
    throw new Error("Unsupported catalog update manifest");
  }
  const url = new URL(manifest.database.url);
  if (url.origin !== "https://github.com" || url.username || url.password || url.search || url.hash ||
      !url.pathname.startsWith(`/${CATALOG_REPOSITORY}/releases/download/`) ||
      !/^holoshelf-catalog-[\w.-]+\.sqlite\.gz$/.test(url.pathname.split("/").at(-1) ?? "")) {
    throw new Error("Catalog download must be a release asset in the official repository");
  }
  return manifest;
}
