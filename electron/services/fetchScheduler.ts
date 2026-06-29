import type { Fetcher, FetchJob, SourceAdapter, SourceHealth, SourceId } from "../../src/shared/contracts";
import type { FetchEnqueueRequest } from "../../src/shared/ipc";
import { isUrlAllowedByPolicy } from "../../src/shared/sourcePolicy";
import type { DatabaseService } from "./database";

export class FetchScheduler {
  private readonly adapters = new Map<SourceId, SourceAdapter>();

  constructor(
    private readonly database: DatabaseService,
    adapters: SourceAdapter[],
    private readonly fetcher: Fetcher = globalThis.fetch.bind(globalThis)
  ) {
    for (const adapter of adapters) {
      this.adapters.set(adapter.descriptor.id, adapter);
    }
  }

  listJobs(): FetchJob[] {
    return this.database.listFetchJobs();
  }

  enqueue(input: FetchEnqueueRequest): FetchJob {
    const adapter = this.adapters.get(input.sourceId);
    if (!adapter) {
      throw new Error(`Unknown source adapter: ${input.sourceId}`);
    }

    if (!isUrlAllowedByPolicy(input.targetUrl, adapter.getPolicy())) {
      throw new Error(`URL is not allowed by ${input.sourceId} policy`);
    }

    return this.database.insertFetchJob({
      moduleId: input.moduleId,
      sourceId: input.sourceId,
      kind: input.kind,
      targetUrl: input.targetUrl,
      priority: input.priority ?? 0
    });
  }

  cancel(jobId: string): FetchJob | null {
    return this.database.updateFetchJobStatus(jobId, "cancelled", "Cancelled by user");
  }

  async runNext(): Promise<FetchJob | null> {
    const job = this.database.nextQueuedFetchJob();
    if (!job) {
      return null;
    }

    const adapter = this.adapters.get(job.sourceId);
    if (!adapter) {
      return this.database.updateFetchJobStatus(job.id, "failed", `Unknown source adapter: ${job.sourceId}`);
    }

    if (!isUrlAllowedByPolicy(job.targetUrl, adapter.getPolicy())) {
      return this.database.updateFetchJobStatus(job.id, "failed", `URL is not allowed by ${job.sourceId} policy`);
    }

    this.database.updateFetchJobStatus(job.id, "running");

    try {
      if (job.kind === "health-check") {
        const health = await adapter.healthCheck(this.fetcher);
        this.database.upsertSourceHealth(health);
        return this.database.updateFetchJobStatus(job.id, "completed");
      }

      return this.database.updateFetchJobStatus(
        job.id,
        "failed",
        `${job.kind} fetching is scaffolded and waiting for source-specific parser implementation`
      );
    } catch (error) {
      return this.database.updateFetchJobStatus(
        job.id,
        "failed",
        error instanceof Error ? error.message : "Fetch job failed"
      );
    }
  }

  async checkHealth(sourceId?: SourceId): Promise<SourceHealth[]> {
    const adapters = sourceId
      ? this.adapters.get(sourceId)
        ? [this.adapters.get(sourceId)!]
        : []
      : [...this.adapters.values()];
    const results: SourceHealth[] = [];

    for (const adapter of adapters) {
      const health = await adapter.healthCheck(this.fetcher);
      this.database.upsertSourceHealth(health);
      results.push(health);
    }

    return results;
  }
}
