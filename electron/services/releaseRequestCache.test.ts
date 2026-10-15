import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ReleaseRequestCache } from "./releaseRequestCache";
import { HolodexApiClient } from "../../src/modules/hololive/music/holodexClient";

const directories: string[] = [];
function directory() {
  const value = fs.mkdtempSync(path.join(os.tmpdir(), "holoshelf-request-cache-"));
  directories.push(value);
  return value;
}
afterEach(() => { vi.restoreAllMocks(); directories.splice(0).forEach((value) => fs.rmSync(value, { recursive: true, force: true })); });

describe("unfinished release request cache", () => {
  it("resumes identical requests across processes without spending request quota", async () => {
    const root = directory();
    const initial = new ReleaseRequestCache({ directory: root, scope: "release-db" });
    const fetcher = vi.fn(async () => Response.json({ total: 0, items: [] }));
    const first = new HolodexApiClient("private-key", fetcher as typeof fetch, null, initial);
    await first.fetchVideosPage({ topicId: "Music_Cover", videoType: "stream" });
    await first.fetchVideosPage({ topicId: "Original_Song", videoType: "stream" });
    const resumed = new ReleaseRequestCache({ directory: root, scope: "release-db" });
    const retry = new HolodexApiClient("private-key", fetcher as typeof fetch, { maxRequests: 1, windowMs: 1000 }, resumed);
    await Promise.all([
      retry.fetchVideosPage({ topicId: "Music_Cover", videoType: "stream" }),
      retry.fetchVideosPage({ topicId: "Original_Song", videoType: "stream" })
    ]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(retry.getRequestMetrics().requests).toBe(0);
    expect(resumed.getMetrics().hits).toBe(2);
    const sessionDirectory = path.join(root, fs.readdirSync(root)[0]);
    const saved = fs.readdirSync(sessionDirectory).map((file) => fs.readFileSync(path.join(sessionDirectory, file), "utf8")).join("");
    expect(saved).not.toContain("private-key");
  });

  it("never reuses completed, expired, fresh, or differently authenticated requests", async () => {
    const root = directory();
    let now = 1000;
    const options = { directory: root, scope: "db", now: () => now, maxAgeMs: 1000 };
    const url = "https://holodex.net/api/v2/videos";
    const key = { headers: { "X-APIKEY": "first-key" } };
    let cache = new ReleaseRequestCache(options);
    await cache.write(url, key, Response.json({ items: [], total: 0 }));
    expect(await cache.read(url, { headers: { "X-APIKEY": "second-key" } })).toBeNull();
    cache = new ReleaseRequestCache({ ...options, fresh: true });
    expect(await cache.read(url, key)).toBeNull();
    await cache.write(url, key, Response.json({ items: [], total: 0 }));
    now += 1000;
    expect(await cache.read(url, key)).toBeNull();
    cache = new ReleaseRequestCache(options);
    await cache.write(url, key, Response.json({ items: [], total: 0 }));
    cache.complete();
    expect(await new ReleaseRequestCache(options).read(url, key)).toBeNull();
  });

  it("rejects corrupt pages, HTTP errors, and error envelopes", async () => {
    const root = directory();
    const cache = new ReleaseRequestCache({ directory: root, scope: "db" });
    const url = "https://holodex.net/api/v2/videos";
    await cache.write(url, {}, new Response("bad gateway", { status: 502 }));
    await cache.write(url, {}, Response.json({ error: "failed" }));
    expect(await cache.read(url, {})).toBeNull();
    await cache.write(url, {}, Response.json({ total: 0, items: [] }));
    const session = path.join(root, fs.readdirSync(root)[0]);
    const page = fs.readdirSync(session).find((name) => name !== "session.json")!;
    fs.writeFileSync(path.join(session, page), JSON.stringify({ schema: 1, body: "{}", digest: "corrupt" }));
    expect(await cache.read(url, {})).toBeNull();
  });

  it("continues without caching when the cache disk cannot be written", async () => {
    const cache = new ReleaseRequestCache({ directory: directory(), scope: "db" });
    vi.spyOn(fs, "writeFileSync").mockImplementation(() => { throw new Error("disk full"); });
    await expect(cache.write("https://holodex.net/api/v2/videos", {}, Response.json({ items: [] }))).resolves.toBeUndefined();
    expect(await cache.read("https://holodex.net/api/v2/videos", {})).toBeNull();
  });

  it("never renews completed pages when cleanup is temporarily denied", async () => {
    const root = directory();
    const options = { directory: root, scope: "db" };
    const url = "https://holodex.net/api/v2/videos";
    const cache = new ReleaseRequestCache(options);
    await cache.write(url, {}, Response.json({ items: [], total: 0 }));
    const removal = vi.spyOn(fs, "rmSync").mockImplementation(() => { throw new Error("locked"); });
    cache.complete();
    expect(await new ReleaseRequestCache(options).read(url, {})).toBeNull();
    removal.mockRestore();
    expect(await new ReleaseRequestCache(options).read(url, {})).toBeNull();
  });
});
