import type { HolodexCatalogRow, HolodexVideoDetail, HolodexVideoRecord } from "./types";

const DISTINCT_VERSION_MARKERS: Array<[string, RegExp]> = [
  ["acoustic", /\bacoustic\b/iu],
  ["piano", /\bpiano\b/iu],
  ["repaint", /\bre\s*:?\s*paint\b/iu],
  ["live", /\blive\b/iu],
  ["tour", /\btour\b/iu]
];

const LOW_PRIORITY_VERSION_PATTERN =
  /\b(?:tv\s*size|remaster(?:ed)?(?:\s+ver(?:sion)?)?|daybreak\s+ver(?:sion)?|solo\s+ver(?:sion)?|japanese\s+ver(?:sion)?|english\s+ver(?:sion)?|jp\s+ver(?:sion)?|en\s+ver(?:sion)?|indonesian\s+ver(?:sion)?|korean\s+ver(?:sion)?|chinese\s+ver(?:sion)?|spanish\s+ver(?:sion)?)\b/iu;
const BRACKETED_CONTEXT_PATTERN = /\s*[\(\[\u3010]([^\)\]\u3011]*)[\)\]\u3011]\s*/gu;
const TRAILING_VERSION_PATTERN =
  /(?:\s*[-–—:]\s*|\s+)(?:tv\s*size|japanese\s+ver(?:sion)?|english\s+ver(?:sion)?|jp\s+ver(?:sion)?|en\s+ver(?:sion)?|indonesian\s+ver(?:sion)?|korean\s+ver(?:sion)?|chinese\s+ver(?:sion)?|spanish\s+ver(?:sion)?)\.?\s*$/iu;

export function normalizeHololiveMusicText(value: string): string {
  return (value || "").normalize("NFKC");
}

export function buildNormalizedHololiveMusicKey(value: string): string {
  return normalizeHololiveMusicText(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function hasDistinctVersionMarker(value: string): boolean {
  return DISTINCT_VERSION_MARKERS.some(([, pattern]) => pattern.test(value));
}

export function hasHololiveLowPriorityVersionMarker(value: string | null | undefined): boolean {
  const normalized = normalizeHololiveMusicText(value ?? "");
  if (!normalized.trim()) {
    return false;
  }

  return LOW_PRIORITY_VERSION_PATTERN.test(normalized);
}

export function stripHololiveLowPriorityVersionMarkers(value: string): string {
  const original = normalizeHololiveMusicText(value).trim();
  if (!original) {
    return "";
  }

  let cleaned = original.replace(BRACKETED_CONTEXT_PATTERN, (match, context: string) => {
    if (hasDistinctVersionMarker(context)) {
      return match;
    }
    return hasHololiveLowPriorityVersionMarker(context) ? " " : match;
  });

  for (;;) {
    const withoutDaybreakVersion = cleaned.replace(
      /(?:\s*[-\u2013\u2014:]\s*|\s+)daybreak\s+ver(?:sion)?\.?\s*$/iu,
      " "
    );
    const withoutRemasteredVersion = withoutDaybreakVersion.replace(
      /(?:\s*[-\u2013\u2014:]\s*|\s+)remaster(?:ed)?(?:\s+ver(?:sion)?)?\.?\s*$/iu,
      " "
    );
    const withoutSoloVersion = withoutRemasteredVersion.replace(
      /(?:\s*[-\u2013\u2014:]\s*|\s+)solo\s+ver(?:sion)?\.?\s*$/iu,
      " "
    );
    const next = withoutSoloVersion.replace(TRAILING_VERSION_PATTERN, " ").trim();
    if (next === cleaned.trim()) {
      break;
    }
    cleaned = next;
  }

  return cleaned.trim() || original;
}

export function buildHololiveMusicSongKey(input: { songName?: string | null; title?: string | null }): string {
  const rawName = normalizeHololiveMusicText(input.songName || input.title || "").trim();
  const canonicalName = stripHololiveLowPriorityVersionMarkers(rawName);
  let firstSegment = canonicalName;

  for (const separator of [" / ", "/"]) {
    if (canonicalName.includes(separator)) {
      firstSegment = canonicalName.split(separator, 1)[0];
      break;
    }
  }

  const baseKey = buildNormalizedHololiveMusicKey(firstSegment) || buildNormalizedHololiveMusicKey(canonicalName);
  if (!baseKey) {
    return "";
  }

  const versionTokens = DISTINCT_VERSION_MARKERS
    .filter(([, pattern]) => pattern.test(canonicalName))
    .map(([marker]) => marker)
    .filter((marker, index, markers) => markers.indexOf(marker) === index);

  return versionTokens.length > 0 ? [baseKey, ...versionTokens].join(" ") : baseKey;
}

export function getHolodexEffectiveOwnerChannelId(input: {
  channelId?: string | null;
  originalChannelId?: string | null;
  providedToYoutube?: boolean | number | null;
}): string {
  const originalChannelId = input.originalChannelId?.trim() ?? "";
  const channelId = input.channelId?.trim() ?? "";
  return input.providedToYoutube && originalChannelId ? originalChannelId : channelId;
}

export function buildHolodexDuplicateOwnerKey(
  row: HolodexCatalogRow,
  recordsById: Record<string, HolodexVideoRecord>,
  detailsById: Record<string, HolodexVideoDetail>
): string {
  const detail = detailsById[row.youtubeVideoId];
  const effectiveOwnerChannelId = detail ? getHolodexEffectiveOwnerChannelId(detail) : "";
  if (effectiveOwnerChannelId) {
    return effectiveOwnerChannelId;
  }

  const record = recordsById[row.youtubeVideoId];
  if (record?.channelId) {
    return record.channelId;
  }

  const detailChannelId = detail?.channelId;
  return detailChannelId || row.channelId?.trim() || buildNormalizedHololiveMusicKey(row.channelName);
}

export function buildHololiveMusicPerformanceKey(input: {
  youtubeVideoId?: string | null;
  topicId: string;
  canonicalSongKey: string;
  ownedIdolIds: string[];
  effectiveOwnerChannelId?: string | null;
  channelId?: string | null;
}): string {
  const topicKey = input.topicId.trim();
  const songKey = input.canonicalSongKey.trim();
  const performerKey =
    input.ownedIdolIds.length > 0
      ? input.ownedIdolIds.map((idolId) => idolId.trim()).filter(Boolean).sort().join("+")
      : [
          "unowned",
          input.youtubeVideoId?.trim() || input.effectiveOwnerChannelId?.trim() || input.channelId?.trim() || "unknown-owner"
        ].join(":");

  return [topicKey, songKey || "unknown-song", performerKey].join(":");
}
