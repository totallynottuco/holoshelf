import type { Fetcher, SourceHealth, SourceId } from "../../shared/contracts";

export async function checkedFetchHealth(
  sourceId: SourceId,
  url: string,
  fetcher: Fetcher,
  blockedHeaderName = "cf-mitigated"
): Promise<SourceHealth> {
  const checkedAt = new Date().toISOString();

  try {
    const response = await fetcher(url, {
      method: "GET",
      redirect: "follow",
      headers: {
        "User-Agent": "Holoshelf/0.1 personal metadata tracker"
      }
    });
    const blockedHeader = response.headers.get(blockedHeaderName);

    if (response.status === 403 && blockedHeader) {
      return {
        sourceId,
        status: "blocked",
        checkedAt,
        httpStatus: response.status,
        message: `${sourceId} returned a challenge response`
      };
    }

    if (response.status >= 200 && response.status < 300) {
      return {
        sourceId,
        status: "healthy",
        checkedAt,
        httpStatus: response.status,
        message: `${sourceId} is reachable`
      };
    }

    return {
      sourceId,
      status: response.status >= 500 ? "offline" : "degraded",
      checkedAt,
      httpStatus: response.status,
      message: `${sourceId} returned HTTP ${response.status}`
    };
  } catch (error) {
    return {
      sourceId,
      status: "offline",
      checkedAt,
      httpStatus: null,
      message: error instanceof Error ? error.message : `${sourceId} health check failed`
    };
  }
}

export function emptyDiscoveryNotice(sourceId: SourceId): Error {
  return new Error(`${sourceId} discovery is scaffolded but not enabled for automated catalog imports yet`);
}
