import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { SourceAdapter } from "../../src/shared/contracts";
import { HolodexSourceAdapter } from "../../src/modules/hololive/music/sourceAdapter";
import { DatabaseService } from "./database";
import { FetchScheduler } from "./fetchScheduler";

async function createScheduler(fetcher: typeof fetch, adapters: SourceAdapter[] = [new HolodexSourceAdapter()]): Promise<FetchScheduler> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "holoshelf-fetch-"));
  const database = new DatabaseService(path.join(dir, "test.sqlite"));
  await database.init();
  return new FetchScheduler(database, adapters, fetcher);
}

describe("FetchScheduler", () => {
  it("rejects URLs blocked by source policy", async () => {
    const scheduler = await createScheduler(fetch);
    expect(() =>
      scheduler.enqueue({
        moduleId: "hololive",
        sourceId: "holodex",
        kind: "health-check",
        targetUrl: "https://example.com/",
        priority: 1
      })
    ).toThrow(/not allowed/);
  });

  it("runs health-check jobs and records completion", async () => {
    const response = new Response("ok", { status: 200 });
    const scheduler = await createScheduler(async () => response);
    const job = scheduler.enqueue({
      moduleId: "hololive",
      sourceId: "holodex",
      kind: "health-check",
      targetUrl: "https://holodex.net/api/v2/channels?org=Hololive&type=vtuber&limit=1",
      priority: 1
    });

    const completed = await scheduler.runNext();
    expect(completed?.id).toBe(job.id);
    expect(completed?.status).toBe("completed");
  });

  it("checks Holodex health through the public endpoint without requiring an API key", async () => {
    let called = false;
    const scheduler = await createScheduler(
      async () => {
        called = true;
        return new Response("ok", { status: 200 });
      },
      [new HolodexSourceAdapter()]
    );

    const health = await scheduler.checkHealth("holodex");

    expect(called).toBe(true);
    expect(health).toHaveLength(1);
    expect(health[0]).toMatchObject({
      sourceId: "holodex",
      status: "healthy"
    });
  });
});
