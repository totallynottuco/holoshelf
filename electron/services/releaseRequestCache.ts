import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { HolodexResponseCache } from "../../src/modules/hololive/music/holodexClient";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");

// Only unfinished runs are reusable. Completion removes the cache, so ordinary
// refreshes always reconcile current upstream data across the full catalog.
export class ReleaseRequestCache implements HolodexResponseCache {
  private readonly directory: string;
  private readonly now: () => number;
  private enabled = true;
  private readonly startedAt: number;
  private readonly maxAgeMs: number;
  private hits = 0;
  private writes = 0;

  constructor(options: {
    directory: string;
    scope: string;
    fresh?: boolean;
    maxAgeMs?: number;
    now?: () => number;
    log?: (message: string) => void;
  }) {
    this.now = options.now ?? Date.now;
    this.maxAgeMs = options.maxAgeMs ?? 60 * 60 * 1000;
    this.directory = path.join(path.resolve(options.directory), digest(options.scope));
    const manifestPath = path.join(this.directory, "session.json");
    let startedAt = this.now();
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      const age = this.now() - manifest.startedAt;
      if (!options.fresh && !manifest.completed && manifest.schema === 1 && typeof manifest.startedAt === "number" &&
        Number.isFinite(age) && age >= 0 && age < this.maxAgeMs) {
        startedAt = manifest.startedAt;
        options.log?.(`Resuming unfinished Holodex fetch started ${(age / 60000).toFixed(1)} minute(s) ago`);
      } else {
        fs.rmSync(this.directory, { recursive: true, force: true });
      }
    } catch {
      // Missing/corrupt metadata invalidates every page in that session.
      try { fs.rmSync(this.directory, { recursive: true, force: true }); } catch { this.enabled = false; }
    }
    this.startedAt = startedAt;
    if (this.enabled) {
      try {
        fs.mkdirSync(this.directory, { recursive: true });
        fs.writeFileSync(manifestPath, JSON.stringify({ schema: 1, startedAt }));
      } catch {
        this.enabled = false;
      }
    }
    if (!this.enabled) {
      options.log?.("Resume cache is unavailable; continuing with live requests");
    }
  }

  getMetrics(): { hits: number; writes: number; startedAt: number } {
    return { hits: this.hits, writes: this.writes, startedAt: this.startedAt };
  }

  private filePath(url: string, init: RequestInit): string {
    // Credentials affect cache identity but are never stored as text or filenames.
    return path.join(this.directory, `${digest(JSON.stringify([
      url, init.method ?? "GET", init.body ?? "", new Headers(init.headers).get("X-APIKEY") ?? ""
    ]))}.json`);
  }

  async read(url: string, init: RequestInit): Promise<Response | null> {
    if (!this.enabled || this.now() - this.startedAt >= this.maxAgeMs) { return null; }
    try {
      const entry = JSON.parse(fs.readFileSync(this.filePath(url, init), "utf8"));
      if (entry.schema !== 1 || typeof entry.body !== "string" || digest(entry.body) !== entry.digest) { return null; }
      JSON.parse(entry.body);
      this.hits += 1;
      return new Response(entry.body, { headers: { "Content-Type": "application/json" } });
    } catch {
      return null;
    }
  }

  async write(url: string, init: RequestInit, response: Response): Promise<void> {
    if (!this.enabled || response.status !== 200) { return; }
    let temporaryPath = "";
    try {
      const body = await response.text();
      const parsed = JSON.parse(body);
      // Never checkpoint HTML error pages or an API error envelope.
      if (!parsed || typeof parsed !== "object" || (!Array.isArray(parsed) && "error" in parsed)) { return; }
      const filePath = this.filePath(url, init);
      temporaryPath = `${filePath}.${randomUUID()}.tmp`;
      fs.writeFileSync(temporaryPath, JSON.stringify({ schema: 1, body, digest: digest(body) }));
      fs.renameSync(temporaryPath, filePath);
      this.writes += 1;
    } catch {
      // Optional caching must not turn a successful API response into a failure.
      this.enabled = false;
    } finally {
      if (temporaryPath) { try { fs.rmSync(temporaryPath, { force: true }); } catch { /* best effort */ } }
    }
  }

  complete(): void {
    // Invalidate first, so even an interrupted cleanup cannot reuse a completed run.
    if (!fs.existsSync(this.directory)) { return; }
    let invalidated = false;
    try {
      fs.writeFileSync(path.join(this.directory, "session.json"), JSON.stringify({ schema: 1, startedAt: this.startedAt, completed: true }));
      invalidated = true;
    } catch { /* Removal below can still invalidate the cache. */ }
    try { fs.rmSync(this.directory, { recursive: true, force: true }); return; }
    catch { /* Completed metadata makes leftover pages expire on the next run. */ }
    if (!invalidated) {
      throw new Error("Release data is complete, but its resume cache could not be invalidated. Use --fresh on the next run.");
    }
  }

  discard(): void {
    this.complete();
    this.enabled = false;
  }
}
