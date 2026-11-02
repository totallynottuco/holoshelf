import {afterEach, describe, expect, it, vi} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {assertVideoAvailabilityVerification, prepareCatalogUpdate} from "./publish-catalog-update.mjs";

const directories = [];
const checkedAt = "2026-11-02T01:00:00.000Z";
function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "holoshelf-publish-proof-"));directories.push(directory);
  const seed = {schema: 1, seedDatabase: "holoshelf-template.sqlite", version: "2026-11-02T010000Z", musicRows: 1};
  const summary = {
    officialDataVersion: seed.version, refreshHolodex: true, refreshChannels: true, refreshStats: true, includeCollabs: true,
    statsRefreshComplete: true, videoStatsRefresh: {failedBatches: 0, fetchedAt: checkedAt}, statsCoverage: {catalogVideos: 1},
    holodexCoverage: {complete: true, topics: {
      Original_Song: {complete: true, fetched: 1, total: 1}, Music_Cover: {complete: true, fetched: 0, total: 0}
    }},
    videoAvailabilityVerification: {schema: 1, checkedAt, checkedVideos: 2, retainedVideos: 1}
  };
  return {directory, seed, summary};
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of directories.splice(0)) {
    if (!path.resolve(directory).startsWith(`${path.resolve(os.tmpdir())}${path.sep}`)) throw new Error("Unsafe test cleanup path");
    fs.rmSync(directory, {recursive: true, force: true});
  }
});

describe("silent catalog availability verification", () => {
  it("accepts a complete same-refresh receipt including deferred or duplicate candidates", () => {
    const {seed, summary} = fixture();
    expect(() => assertVideoAvailabilityVerification(summary, seed)).not.toThrow();
  });

  it.each(["missing", "wrong-schema", "wrong-time", "invalid-time", "wrong-retained-count", "insufficient-checked-count", "invalid-count"])("rejects %s availability evidence", (failure) => {
    const {seed, summary} = fixture();
    if (failure === "missing") delete summary.videoAvailabilityVerification;
    if (failure === "wrong-schema") summary.videoAvailabilityVerification.schema = 0;
    if (failure === "wrong-time") summary.videoAvailabilityVerification.checkedAt = "2026-11-01T01:00:00.000Z";
    if (failure === "invalid-time") summary.videoAvailabilityVerification.checkedAt = summary.videoStatsRefresh.fetchedAt = "not-a-date";
    if (failure === "wrong-retained-count") summary.videoAvailabilityVerification.retainedVideos = 2;
    if (failure === "insufficient-checked-count") summary.videoAvailabilityVerification.checkedVideos = 0;
    if (failure === "invalid-count") summary.videoAvailabilityVerification.checkedVideos = "2";
    expect(() => assertVideoAvailabilityVerification(summary, seed)).toThrow("availability verification");
  });

  it("refuses a legacy unchecked seed before reading its database, writing a package, or accessing the network", async () => {
    const {directory, seed, summary} = fixture();
    delete summary.videoAvailabilityVerification;
    const reports = path.join(directory, "holodex-refresh", "latest");fs.mkdirSync(reports, {recursive: true});
    fs.writeFileSync(path.join(directory, "official-data.json"), JSON.stringify(seed));
    fs.writeFileSync(path.join(reports, "summary.json"), JSON.stringify(summary));
    const fetcher = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Unexpected network request"));
    const outputDirectory = path.join(directory, "output");
    await expect(prepareCatalogUpdate({seedDirectory: directory, outputDirectory})).rejects.toThrow("availability verification");
    expect(fetcher).not.toHaveBeenCalled();
    expect(fs.existsSync(outputDirectory)).toBe(false);
    expect(fs.existsSync(path.join(directory, seed.seedDatabase))).toBe(false);
  });
});
