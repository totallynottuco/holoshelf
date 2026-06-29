import type {
  Fetcher,
  NormalizedSourceItem,
  SourceAdapter,
  SourceDiscoveryQuery,
  SourceDiscoveryResult,
  SourceHealth
} from "../../../shared/contracts";
import { getSourcePolicy } from "../../../shared/sourcePolicy";

export class HolodexSourceAdapter implements SourceAdapter {
  descriptor = {
    id: "holodex" as const,
    label: "Holodex",
    homepage: "https://holodex.net",
    moduleId: "hololive" as const,
    publicOnly: true,
    storesCovers: false,
    rateLimitMs: 350
  };

  getPolicy() {
    return getSourcePolicy("holodex");
  }

  async healthCheck(fetcher: Fetcher): Promise<SourceHealth> {
    try {
      const response = await fetcher("https://holodex.net/api/v2/channels?org=Hololive&type=vtuber&limit=1", {
        headers: {
          Accept: "application/json"
        }
      });

      return {
        sourceId: "holodex",
        status: response.ok ? "healthy" : "degraded",
        checkedAt: new Date().toISOString(),
        httpStatus: response.status,
        message: response.ok ? "Holodex channels endpoint is reachable" : `Holodex responded with HTTP ${response.status}`
      };
    } catch (error) {
      return {
        sourceId: "holodex",
        status: "offline",
        checkedAt: new Date().toISOString(),
        httpStatus: null,
        message: error instanceof Error ? error.message : "Holodex health check failed"
      };
    }
  }

  async discover(_query: SourceDiscoveryQuery): Promise<SourceDiscoveryResult[]> {
    return [];
  }

  async fetchDetail(_sourceKey: string): Promise<NormalizedSourceItem | null> {
    return null;
  }

  async fetchCover(): Promise<ArrayBuffer | null> {
    return null;
  }

  normalize(): NormalizedSourceItem | null {
    return null;
  }
}
