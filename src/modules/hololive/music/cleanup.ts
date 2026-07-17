import type {
  HolodexCatalogRow,
  HolodexCleanupResult,
  HolodexDuplicateRemoval,
  HolodexVideoDetail,
  HolodexVideoRecord
} from "./types";
import {
  buildHolodexDuplicateOwnerKey,
  buildHololiveMusicSongKey,
  buildNormalizedHololiveMusicKey,
  normalizeHololiveMusicText
} from "./classification";
import { isExcludedHolodexChannelId } from "./types";

const MIN_FULL_DURATION_SECONDS = 90;
const LONG_FORM_COMPILATION_MIN_SECONDS = 600;
export const HOLODEX_TOPIC_DUPLICATE_DURATION_TOLERANCE_SECONDS = 20;
export const HOLODEX_TOPIC_DUPLICATE_DURATION_MAX_DIFFERENCE_SECONDS = 45;
export const HOLODEX_TOPIC_DUPLICATE_DURATION_MAX_RATIO = 0.2;
export const KNOWN_HOLOLIVE_MUSIC_DUPLICATE_REPLACEMENTS = [
  { removedYoutubeVideoId: "APB19Vr233c", keptYoutubeVideoId: "LYFciXBcXIQ" },
  { removedYoutubeVideoId: "ev7menqLdK4", keptYoutubeVideoId: "LYFciXBcXIQ" }
] as const;
const OFFICIAL_TITLE_MARKERS = ["official", "mv", "original", "\u30aa\u30ea\u30b8\u30ca\u30eb", "\u30aa\u30ea\u30b8\u30ca\u30eb\u30bd\u30f3\u30b0"];
const VERSION_KEEP_MARKERS = ["acoustic", "piano", "re paint", "repaint", "live", "tour"];
const DUPLICATE_CONTEXT_DROP_MARKERS = [
  "hololive",
  "official",
  "original",
  "song",
  "mv",
  "music video",
  "promise",
  "myth",
  "council",
  "advent",
  "justice",
  "regloss",
  "flow glow",
  "project"
];
const TITLE_NOISE_TOKENS = new Set([
  "a",
  "an",
  "audio",
  "channel",
  "ch",
  "feat",
  "featuring",
  "full",
  "hololive",
  "music",
  "mv",
  "official",
  "original",
  "song",
  "the",
  "video"
]);
const QUOTED_TITLE_PATTERN = /["'\u201c\u2018\u300e\u300c](.{2,80}?)["'\u201d\u2019\u300f\u300d]/u;
const FULL_VERSION_DROP_PATTERNS: Array<[string, RegExp]> = [
  ["preview_or_short", /\b(preview|teaser|trailer|short)\b/iu],
  ["preview_or_short", /(\u8a66\u8074\u52d5\u753b|\u8a66\u8074|\u30b7\u30e7\u30fc\u30c8)/iu],
  ["preview_or_short", /\bpromo\b|\bpromotional\s+(?:mv|pv)\b|\bpromotion\s+(?:mv|pv)\b|\u5ba3\u4f1d\s*(?:mv|pv)?/iu],
  ["preview_or_short", /cross[-\s]?fade|\bxfd\b|\b(?:album\s+)?digest\b|\u30af\u30ed\u30b9\u30d5\u30a7\u30fc\u30c9/iu],
  [
    "compilation_or_mix",
    /\bfull\s+album\b|\b(?:album|ep)\b.{0,120}\b(?:releas(?:e|ed|ing)|announcement|sampler|track\s*list)\b|\b(?:releas(?:e|ed|ing)|announcement)\b.{0,120}\b(?:album|ep)\b/iu
  ],
  ["compilation_or_mix", /\u30c0\u30a4\u30b8\u30a7\u30b9\u30c8|\u5168\u66f2\s*(?:\u8a66\u8074|\u7d39\u4ecb)|\u30a2\u30eb\u30d0\u30e0.{0,80}(?:\u8a66\u8074|\u544a\u77e5|\u767a\u58f2|\u30c8\u30ec\u30fc\u30e9\u30fc|\u30c6\u30a3\u30b6\u30fc)/iu],
  ["compilation_or_mix", /\b(medley|soundtrack|release pv|image soundtrack)\b/iu],
  ["compilation_or_mix", /bgm|\blo[-\s]?fi\b/iu],
  ["compilation_or_mix", /\b(?:bgm|lo[-\s]?fi|chill|ambient|orgel|jazz)\b.*\bmix\b/iu],
  [
    "compilation_or_mix",
    /\b(?:songs?|music|bangers?|beats?|mix|playlist|ost)\s+(?:to|for)\s+(?:study|work|working|focus|relax|relaxing|sleep|chill)(?:\s+to)?\b/iu
  ],
  [
    "compilation_or_mix",
    /\b(?:study|work|working|focus|relax|relaxing|sleep|chill)\s+(?:music|mix|playlist|beats?|bgm)\b/iu
  ],
  ["remix", /remix/iu],
  [
    "alternate_version",
    /\b(?:midnight|bouquet|twilight|daybreak|solo)\s+ver(?:sion)?\b|\bremaster(?:ed)?(?:\s+ver(?:sion)?)?\b/iu
  ],
  ["karaoke_or_off_vocal", /\bkaraoke\b|off[-\s]?vocal|on[-\s]?vocal|\u30ab\u30e9\u30aa\u30b1|\u30aa\u30d5\u30dc\u30fc\u30ab\u30eb/iu],
  ["instrumental", /\binstrumental\b|\binst(?:\.|\s+ver|\s+version|\)|\]|$)|\u30a4\u30f3\u30b9\u30c8/iu],
  ["non_song_variant", /\bwithout music version\b|\bbehind the scenes\b|\bmaking of\b/iu],
  ["demo", /(?:^|\s|\(|\[|\u3010)\bdemo\b(?:\s|\)|\]|\u3011|$)/iu]
];
const LONG_FORM_COMPILATION_PATTERN =
  /\b(?:mash[\s-]?up|mega[\s-]?mix|non[\s-]?stop|continuous\s+mix|song\s+compilation|music\s+compilation)\b/iu;

export function normalizeText(value: string): string {
  return normalizeHololiveMusicText(value);
}

export function parseDuration(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value);
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

export function parsePublishedAt(value: string | null | undefined): number {
  if (!value) {
    return Number.MAX_SAFE_INTEGER;
  }

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : Number.MAX_SAFE_INTEGER;
}

export function buildNormalizedSongKey(value: string): string {
  return buildNormalizedHololiveMusicKey(value);
}

export function buildDuplicateSongKey(songName: string): string {
  return buildHololiveMusicSongKey({ songName: stripDuplicateSongContext(songName), title: stripDuplicateSongContext(songName) });
}

function stripDuplicateSongContext(songName: string): string {
  let cleaned = normalizeText(songName).trim();
  const removableTrailingContext = /\s*(?:\(([^()]*)\)|\[([^\[\]]*)\]|\u3010([^\u3010\u3011]*)\u3011)\s*$/u;

  for (;;) {
    const match = removableTrailingContext.exec(cleaned);
    if (!match) {
      return cleaned;
    }

    const context = match[1] ?? match[2] ?? match[3] ?? "";
    const contextKey = buildNormalizedSongKey(context);
    if (!contextKey) {
      cleaned = cleaned.slice(0, match.index).trim();
      continue;
    }

    if (DUPLICATE_CONTEXT_DROP_MARKERS.some((marker) => contextKey.includes(marker))) {
      cleaned = cleaned.slice(0, match.index).trim();
      continue;
    }

    if (VERSION_KEEP_MARKERS.some((marker) => contextKey.includes(marker))) {
      return cleaned;
    }

    cleaned = cleaned.slice(0, match.index).trim();
  }
}

export function buildCandidateTitleTokens(title: string): string[] {
  return buildNormalizedSongKey(title)
    .split(" ")
    .filter((token) => token && !TITLE_NOISE_TOKENS.has(token))
    .filter((token) => !(token.length <= 1 && /^[\x00-\x7F]$/.test(token)));
}

export function buildCandidateTitleKey(title: string): string {
  return buildCandidateTitleTokens(title).join(" ");
}

function stripLeadingGenericSegment(title: string): string {
  const cleanedTitle = title.trim();
  const pairs: Array<[string, string]> = [
    ["\u3010", "\u3011"],
    ["[", "]"],
    ["(", ")"]
  ];

  for (const [opener, closer] of pairs) {
    if (!cleanedTitle.startsWith(opener) || !cleanedTitle.includes(closer)) {
      continue;
    }

    const endIndex = cleanedTitle.indexOf(closer);
    const innerKey = buildCandidateTitleKey(cleanedTitle.slice(opener.length, endIndex));
    if (OFFICIAL_TITLE_MARKERS.some((marker) => innerKey.includes(marker))) {
      return cleanedTitle.slice(endIndex + closer.length).trimStart();
    }
  }

  return cleanedTitle;
}

interface DuplicateTitleContext {
  channelName?: string | null;
}

function hasLikelyChannelPrefix(segmentKey: string, context: DuplicateTitleContext): boolean {
  const segmentTokens = segmentKey.split(" ").filter(Boolean);
  const channelTokens = new Set(buildCandidateTitleTokens(context.channelName ?? ""));
  if (segmentTokens.length === 0 || channelTokens.size === 0) {
    return false;
  }

  const overlapCount = segmentTokens.filter((token) => channelTokens.has(token)).length;
  return overlapCount >= Math.min(segmentTokens.length, 2) && overlapCount / segmentTokens.length >= 0.6;
}

export function buildDuplicateTitleCore(title: string, context: DuplicateTitleContext = {}): string {
  const cleanedTitle = stripDuplicateSongContext(stripLeadingGenericSegment(normalizeText(title).trim()));
  const loweredTitle = cleanedTitle.toLowerCase();

  if (OFFICIAL_TITLE_MARKERS.some((marker) => loweredTitle.includes(marker))) {
    const quotedMatch = QUOTED_TITLE_PATTERN.exec(cleanedTitle);
    if (quotedMatch) {
      const quotedKey = buildCandidateTitleKey(quotedMatch[1]);
      if (quotedKey.length >= 4) {
        return quotedKey;
      }
    }
  }

  for (const separator of [" / ", "/", " - ", "|"]) {
    if (!cleanedTitle.includes(separator)) {
      continue;
    }

    const [leftSegment, rightSegment] = cleanedTitle.split(separator, 2);
    const leftKey = buildCandidateTitleKey(leftSegment);
    const rightKey = buildCandidateTitleKey(rightSegment);
    if (!leftKey) {
      continue;
    }

    if (separator === " - " && hasLikelyChannelPrefix(leftKey, context)) {
      const rightCore = buildDuplicateTitleCore(rightSegment, context);
      if (rightCore) {
        return rightCore;
      }
    }

    if (
      VERSION_KEEP_MARKERS.some((marker) => rightKey.includes(marker)) &&
      !OFFICIAL_TITLE_MARKERS.some((marker) => rightKey.includes(marker))
    ) {
      return buildCandidateTitleKey(cleanedTitle);
    }

    if (separator === " - " && leftKey.split(" ").length <= 1) {
      for (const secondarySeparator of ["|", "/"]) {
        if (rightSegment.includes(secondarySeparator)) {
          const rightHeadKey = buildCandidateTitleKey(rightSegment.split(secondarySeparator, 1)[0]);
          if (rightHeadKey) {
            return rightHeadKey;
          }
        }
      }
    }

    return leftKey;
  }

  return buildCandidateTitleKey(cleanedTitle);
}

function isUsefulDuplicateSongKey(key: string): boolean {
  return key.length >= 4 || /^\d{2,}$/u.test(key) || /[^\x00-\x7F]/u.test(key);
}

function buildDuplicateSongKeys(songName: string): string[] {
  const normalized = normalizeText(songName).trim();
  const candidates = [
    normalized,
    ...normalized
      .split(/\s+\/\s+|\//u)
      .map((segment) => segment.trim())
      .filter(Boolean)
  ];

  return [
    ...new Set(
      candidates
        .map((candidate) => buildDuplicateSongKey(candidate))
        .filter((key) => key && isUsefulDuplicateSongKey(key))
    )
  ];
}

function buildDuplicateSongKeysForRow(row: HolodexCatalogRow, detail: HolodexVideoDetail | undefined): string[] {
  if (detail?.songNames[0]?.trim()) {
    return buildDuplicateSongKeys(detail.songNames[0]);
  }

  const titleCore = buildDuplicateTitleCore(row.title, { channelName: row.channelName });
  return titleCore && isUsefulDuplicateSongKey(titleCore) ? [titleCore] : [];
}

function titleMarkerScore(title: string): number {
  const lowered = normalizeText(title).toLowerCase();
  return OFFICIAL_TITLE_MARKERS.filter((marker) => lowered.includes(marker)).length;
}

export function normalizeVideoDetail(videoId: string, detail: Partial<HolodexVideoDetail>): HolodexVideoDetail {
  return {
    youtubeVideoId: (detail.youtubeVideoId || videoId).trim() || videoId,
    channelId: detail.channelId?.trim() ?? "",
    duration: parseDuration(detail.duration),
    originalChannelId: detail.originalChannelId?.trim() ?? "",
    providedToYoutube: Boolean(detail.providedToYoutube),
    description: detail.description?.trim() ?? "",
    songNames: (detail.songNames ?? []).map((songName) => songName.trim()).filter(Boolean),
    channel: detail.channel ?? null,
    mentions: detail.mentions ?? [],
    collabChannelIds: [
      ...new Set(
        (detail.collabChannelIds ?? [])
          .map((channelId) => channelId.trim())
          .filter((channelId) => channelId && !isExcludedHolodexChannelId(channelId))
      )
    ],
    relationshipsLoaded: Boolean(detail.relationshipsLoaded)
  };
}

export function parseProvidedToYoutubeArtistCredits(description: string | null | undefined): string[] {
  const lines = (description ?? "")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  const providerIndex = lines.findIndex((line) => /^Provided to YouTube by\b/iu.test(line));
  if (providerIndex < 0) {
    return [];
  }

  const creditLine = lines[providerIndex + 1] ?? "";
  const segments = creditLine
    .split(/\s*[·•]\s*/u)
    .map((segment) => segment.trim())
    .filter(Boolean);
  return segments.length > 1 ? segments.slice(1) : [];
}

export function hasTopicDuplicateSignal(detail: HolodexVideoDetail | undefined): boolean {
  return Boolean(detail?.originalChannelId && detail.providedToYoutube);
}

export function getPrimarySongName(row: HolodexCatalogRow, detail: HolodexVideoDetail | undefined): string {
  return detail?.songNames[0]?.trim() || row.title;
}

function buildSearchableText(row: HolodexCatalogRow, detail: HolodexVideoDetail | undefined): string {
  return [row.title, getPrimarySongName(row, detail)]
    .filter(Boolean)
    .map((part) => buildNormalizedSongKey(part))
    .join(" ");
}

function buildOwnerKey(
  row: HolodexCatalogRow,
  recordsById: Record<string, HolodexVideoRecord>,
  detailsById: Record<string, HolodexVideoDetail>
): string {
  return buildHolodexDuplicateOwnerKey(row, recordsById, detailsById);
}

export function getRowCleanupReason(
  row: HolodexCatalogRow,
  recordsById: Record<string, HolodexVideoRecord>,
  detailsById: Record<string, HolodexVideoDetail>
): string {
  if (row.status.trim().toLowerCase() === "missing") {
    return "missing_status";
  }

  const record = recordsById[row.youtubeVideoId];
  const detail = detailsById[row.youtubeVideoId];
  const duration = parseDuration(record?.duration ?? detail?.duration);
  if (duration !== null && duration > 0 && duration < MIN_FULL_DURATION_SECONDS) {
    return "under_90_seconds";
  }

  const searchableText = buildSearchableText(row, detail);
  if (
    duration !== null &&
    duration >= LONG_FORM_COMPILATION_MIN_SECONDS &&
    LONG_FORM_COMPILATION_PATTERN.test(searchableText)
  ) {
    return "compilation_or_mix";
  }
  for (const [reason, pattern] of FULL_VERSION_DROP_PATTERNS) {
    if (pattern.test(searchableText)) {
      return reason;
    }
  }

  return "";
}

export function buildDuplicateCandidateGroups(
  rows: HolodexCatalogRow[],
  recordsById: Record<string, HolodexVideoRecord>,
  detailsById: Record<string, HolodexVideoDetail>
): HolodexCatalogRow[][] {
  const rowsByGroup = new Map<string, HolodexCatalogRow[]>();

  for (const row of rows) {
    const topicKey = row.topicId.trim();
    const ownerKey = buildOwnerKey(row, recordsById, detailsById);
    const titleCore = buildDuplicateTitleCore(row.title, { channelName: row.channelName });
    if (!topicKey || !ownerKey || !titleCore) {
      continue;
    }

    const key = JSON.stringify([topicKey, ownerKey, titleCore]);
    rowsByGroup.set(key, [...(rowsByGroup.get(key) ?? []), row]);
  }

  return [...rowsByGroup.values()].filter((group) => group.length > 1);
}

function buildDuplicateParticipantSignals(detail: HolodexVideoDetail | undefined): Set<string> {
  return new Set(
    [
      detail?.channelId,
      detail?.originalChannelId,
      ...(detail?.mentions ?? []).map((mention) => mention.channelId),
      ...(detail?.collabChannelIds ?? [])
    ]
      .map((channelId) => channelId?.trim() ?? "")
      .filter(Boolean)
  );
}

function hasDuplicateParticipantOverlap(
  left: HolodexVideoDetail | undefined,
  right: HolodexVideoDetail | undefined
): boolean {
  const leftSignals = buildDuplicateParticipantSignals(left);
  if (leftSignals.size === 0) {
    return false;
  }

  for (const signal of buildDuplicateParticipantSignals(right)) {
    if (leftSignals.has(signal)) {
      return true;
    }
  }

  return false;
}

function hasSimilarDuplicateDuration(
  left: HolodexCatalogRow,
  right: HolodexCatalogRow,
  detailsById: Record<string, HolodexVideoDetail>,
  recordsById: Record<string, HolodexVideoRecord>
): boolean {
  const leftDuration = parseDuration(recordsById[left.youtubeVideoId]?.duration ?? detailsById[left.youtubeVideoId]?.duration);
  const rightDuration = parseDuration(recordsById[right.youtubeVideoId]?.duration ?? detailsById[right.youtubeVideoId]?.duration);
  if (leftDuration === null || rightDuration === null || leftDuration <= 0 || rightDuration <= 0) {
    return true;
  }

  return hasCompatibleHolodexTopicDuplicateDuration(leftDuration, rightDuration);
}

export function hasCompatibleHolodexTopicDuplicateDuration(leftDuration: number, rightDuration: number): boolean {
  const difference = Math.abs(leftDuration - rightDuration);
  if (difference <= HOLODEX_TOPIC_DUPLICATE_DURATION_TOLERANCE_SECONDS) {
    return true;
  }

  const longerDuration = Math.max(leftDuration, rightDuration);
  return (
    difference <= HOLODEX_TOPIC_DUPLICATE_DURATION_MAX_DIFFERENCE_SECONDS &&
    longerDuration > 0 &&
    difference / longerDuration <= HOLODEX_TOPIC_DUPLICATE_DURATION_MAX_RATIO
  );
}

function findKnownDuplicateRemovals(
  rows: HolodexCatalogRow[],
  detailsById: Record<string, HolodexVideoDetail>
): HolodexDuplicateRemoval[] {
  const rowsById = new Map(rows.map((row) => [row.youtubeVideoId, row]));
  const removals: HolodexDuplicateRemoval[] = [];

  for (const replacement of KNOWN_HOLOLIVE_MUSIC_DUPLICATE_REPLACEMENTS) {
    const removedRow = rowsById.get(replacement.removedYoutubeVideoId);
    const keptRow = rowsById.get(replacement.keptYoutubeVideoId);
    if (!removedRow || !keptRow) {
      continue;
    }

    removals.push({
      removedYoutubeVideoId: removedRow.youtubeVideoId,
      removedTitle: removedRow.title,
      keptYoutubeVideoId: keptRow.youtubeVideoId,
      keptTitle: keptRow.title,
      reason: "known_duplicate_of_official",
      songName: getPrimarySongName(keptRow, detailsById[keptRow.youtubeVideoId]),
      removedPublishedAt: removedRow.publishedAt,
      keptPublishedAt: keptRow.publishedAt
    });
  }

  return removals;
}

function buildCrossOwnerTopicDuplicateGroups(
  rows: HolodexCatalogRow[],
  detailsById: Record<string, HolodexVideoDetail>,
  recordsById: Record<string, HolodexVideoRecord>
): HolodexCatalogRow[][] {
  const rowsByGroup = new Map<string, HolodexCatalogRow[]>();

  for (const row of rows) {
    const songKeys = buildDuplicateSongKeysForRow(row, detailsById[row.youtubeVideoId]);
    if (!row.topicId || songKeys.length === 0) {
      continue;
    }

    for (const songKey of songKeys) {
      const key = JSON.stringify([row.topicId, songKey]);
      rowsByGroup.set(key, [...(rowsByGroup.get(key) ?? []), row]);
    }
  }

  return [...rowsByGroup.values()].flatMap((group) => {
    const topicRows = group.filter((row) => hasTopicDuplicateSignal(detailsById[row.youtubeVideoId]));
    const nonTopicRows = group.filter((row) => !hasTopicDuplicateSignal(detailsById[row.youtubeVideoId]));
    if (topicRows.length === 0 || nonTopicRows.length === 0) {
      return [];
    }

    const duplicateRowsById = new Map<string, HolodexCatalogRow>();
    for (const topicRow of topicRows) {
      const matchingNonTopicRows = nonTopicRows.filter(
        (nonTopicRow) =>
          hasSimilarDuplicateDuration(topicRow, nonTopicRow, detailsById, recordsById) &&
          hasDuplicateParticipantOverlap(detailsById[topicRow.youtubeVideoId], detailsById[nonTopicRow.youtubeVideoId])
      );
      if (matchingNonTopicRows.length === 0) {
        continue;
      }

      duplicateRowsById.set(topicRow.youtubeVideoId, topicRow);
      for (const nonTopicRow of matchingNonTopicRows) {
        duplicateRowsById.set(nonTopicRow.youtubeVideoId, nonTopicRow);
      }
    }

    const duplicateRows = [...duplicateRowsById.values()];
    return duplicateRows.length > 1 ? [duplicateRows] : [];
  });
}

function choosePreferredNonTopicRow(
  rows: HolodexCatalogRow[],
  detailsById: Record<string, HolodexVideoDetail>,
  recordsById: Record<string, HolodexVideoRecord>
): HolodexCatalogRow {
  return [...rows].sort((left, right) => {
    const leftDuration = parseDuration(recordsById[left.youtubeVideoId]?.duration ?? detailsById[left.youtubeVideoId]?.duration) ?? 0;
    const rightDuration =
      parseDuration(recordsById[right.youtubeVideoId]?.duration ?? detailsById[right.youtubeVideoId]?.duration) ?? 0;
    return (
      titleMarkerScore(right.title) - titleMarkerScore(left.title) ||
      rightDuration - leftDuration ||
      parsePublishedAt(left.publishedAt) - parsePublishedAt(right.publishedAt) ||
      left.youtubeVideoId.localeCompare(right.youtubeVideoId)
    );
  })[0];
}

function choosePreferredTopicRow(
  rows: HolodexCatalogRow[],
  detailsById: Record<string, HolodexVideoDetail>,
  recordsById: Record<string, HolodexVideoRecord>
): HolodexCatalogRow {
  return [...rows].sort((left, right) => {
    const leftDuration = parseDuration(recordsById[left.youtubeVideoId]?.duration ?? detailsById[left.youtubeVideoId]?.duration) ?? 0;
    const rightDuration =
      parseDuration(recordsById[right.youtubeVideoId]?.duration ?? detailsById[right.youtubeVideoId]?.duration) ?? 0;
    return (
      parsePublishedAt(left.publishedAt) - parsePublishedAt(right.publishedAt) ||
      rightDuration - leftDuration ||
      left.youtubeVideoId.localeCompare(right.youtubeVideoId)
    );
  })[0];
}

export function findDuplicateRemovals(
  candidateGroups: HolodexCatalogRow[][],
  detailsById: Record<string, HolodexVideoDetail>,
  recordsById: Record<string, HolodexVideoRecord>
): { removals: HolodexDuplicateRemoval[]; duplicateClusterCount: number } {
  const removals: HolodexDuplicateRemoval[] = [];
  let duplicateClusterCount = 0;

  for (const candidateRows of candidateGroups) {
    const rowsBySongKey = new Map<string, HolodexCatalogRow[]>();
    for (const row of candidateRows) {
      const songKeys = buildDuplicateSongKeysForRow(row, detailsById[row.youtubeVideoId]);
      if (songKeys.length === 0) {
        continue;
      }

      for (const songKey of songKeys) {
        rowsBySongKey.set(songKey, [...(rowsBySongKey.get(songKey) ?? []), row]);
      }
    }

    for (const componentRows of rowsBySongKey.values()) {
      if (componentRows.length < 2) {
        continue;
      }

      const topicRows = componentRows.filter((row) => hasTopicDuplicateSignal(detailsById[row.youtubeVideoId]));
      const nonTopicRows = componentRows.filter((row) => !hasTopicDuplicateSignal(detailsById[row.youtubeVideoId]));

      if (nonTopicRows.length > 0 && topicRows.length > 0) {
        const keptRow = choosePreferredNonTopicRow(nonTopicRows, detailsById, recordsById);
        const songName = getPrimarySongName(keptRow, detailsById[keptRow.youtubeVideoId]);
        duplicateClusterCount += 1;
        removals.push(
          ...topicRows.map((row) => ({
            removedYoutubeVideoId: row.youtubeVideoId,
            removedTitle: row.title,
            keptYoutubeVideoId: keptRow.youtubeVideoId,
            keptTitle: keptRow.title,
            reason: "topic_duplicate_of_non_topic",
            songName,
            removedPublishedAt: row.publishedAt,
            keptPublishedAt: keptRow.publishedAt
          }))
        );
        continue;
      }

      if (nonTopicRows.length === 0 && topicRows.length > 1) {
        const keptRow = choosePreferredTopicRow(topicRows, detailsById, recordsById);
        const songName = getPrimarySongName(keptRow, detailsById[keptRow.youtubeVideoId]);
        duplicateClusterCount += 1;
        removals.push(
          ...topicRows
            .filter((row) => row.youtubeVideoId !== keptRow.youtubeVideoId)
            .map((row) => ({
              removedYoutubeVideoId: row.youtubeVideoId,
              removedTitle: row.title,
              keptYoutubeVideoId: keptRow.youtubeVideoId,
              keptTitle: keptRow.title,
              reason: "topic_duplicate_without_non_topic",
              songName,
              removedPublishedAt: row.publishedAt,
              keptPublishedAt: keptRow.publishedAt
            }))
        );
      }
    }
  }

  return {
    removals: [...new Map(removals.map((removal) => [removal.removedYoutubeVideoId, removal])).values()],
    duplicateClusterCount
  };
}

export function cleanupCatalogRows(
  rows: HolodexCatalogRow[],
  recordsById: Record<string, HolodexVideoRecord> = {},
  detailsById: Record<string, HolodexVideoDetail> = {}
): HolodexCleanupResult {
  let removedByBaseRules = 0;
  const baseKeptRows = rows.filter((row) => {
    const reason = getRowCleanupReason(row, recordsById, detailsById);
    if (reason) {
      removedByBaseRules += 1;
      return false;
    }
    return true;
  });
  const candidateGroups = [
    ...buildDuplicateCandidateGroups(baseKeptRows, recordsById, detailsById),
    ...buildCrossOwnerTopicDuplicateGroups(baseKeptRows, detailsById, recordsById)
  ];
  const automaticResult = findDuplicateRemovals(candidateGroups, detailsById, recordsById);
  const knownRemovals = findKnownDuplicateRemovals(baseKeptRows, detailsById);
  const automaticRemovedIds = new Set(automaticResult.removals.map((removal) => removal.removedYoutubeVideoId));
  const additionalKnownClusters = new Set(
    knownRemovals
      .filter((removal) => !automaticRemovedIds.has(removal.removedYoutubeVideoId))
      .map((removal) => removal.keptYoutubeVideoId)
  ).size;
  const removals = [
    ...new Map(
      [...automaticResult.removals, ...knownRemovals].map((removal) => [removal.removedYoutubeVideoId, removal])
    ).values()
  ];
  const removedIds = new Set(removals.map((removal) => removal.removedYoutubeVideoId));

  return {
    rows: baseKeptRows.filter((row) => !removedIds.has(row.youtubeVideoId)),
    removedByBaseRules,
    removedDuplicateRows: removedIds.size,
    duplicateClusterCount: automaticResult.duplicateClusterCount + additionalKnownClusters,
    duplicateRemovals: removals
  };
}
