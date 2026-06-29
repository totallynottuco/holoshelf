import type { SourceId, SourcePolicy } from "./contracts";

const REGEX_ESCAPE = /[.+^${}()|[\]\\]/g;

function wildcardToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(REGEX_ESCAPE, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`, "i");
}

function normalizePathAndQuery(url: URL): string {
  return `${url.pathname}${url.search}`;
}

export function isUrlAllowedByPolicy(targetUrl: string, policy: SourcePolicy): boolean {
  let parsed: URL;

  try {
    parsed = new URL(targetUrl);
  } catch {
    return false;
  }

  if (parsed.protocol !== "https:") {
    return false;
  }

  if (!policy.allowedHosts.includes(parsed.hostname.toLowerCase())) {
    return false;
  }

  const pathAndQuery = normalizePathAndQuery(parsed);
  return !policy.disallow.some((pattern) => {
    const normalizedPattern = pattern.startsWith("/") || pattern.startsWith("*") ? pattern : `/${pattern}`;
    return wildcardToRegExp(normalizedPattern).test(pathAndQuery);
  });
}

export function getSourcePolicy(sourceId: SourceId): SourcePolicy {
  switch (sourceId) {
    case "holodex":
      return {
        sourceId,
        allowedHosts: ["holodex.net"],
        disallow: [],
        contentSignals: { search: true, aiTrain: false },
        minDelayMs: 350
      };
    case "hololive-csv":
      return {
        sourceId,
        allowedHosts: [],
        disallow: ["*"],
        minDelayMs: 0
      };
  }
}
