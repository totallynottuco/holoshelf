export type MusicReleaseDateBasis = "official_release" | "youtube_release" | "recording_upload";
export type BracketDateBasis = "song_release" | "video_upload";
export interface MusicReleaseDateEvidence {
  youtubeVideoId: string;
  releaseDate: string;
  basis: MusicReleaseDateBasis;
  sourceUrl: string;
}

export function isCalendarDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value;
}

export function parseBracketYears(value: string): { from: string; to: string } | null {
  const match = /^(\d{4})(?:\s*[-–—]\s*(\d{4}))?$/.exec(value.trim());
  if (!match) return null;
  const from = Number(match[1]), to = Number(match[2] ?? match[1]);
  if (from < 1900 || to > 9999 || from > to) return null;
  return { from: `${from}-01-01`, to: `${to}-12-31` };
}

export function parseYoutubeReleaseDate(description: string): string | null {
  // Only an explicit distributor credit; dates in lyrics/promotion are not releases.
  if (!/^Provided to YouTube by\b/imu.test(description)) return null;
  const dates = [...description.matchAll(/^Released on:\s*(\d{4}-\d{2}-\d{2})\s*$/gimu)].map(match => match[1]);
  return dates.length === 1 && isCalendarDate(dates[0]) ? dates[0] : null;
}

export function chooseReleaseDate<T extends { releaseDate: string; basis: MusicReleaseDateBasis; sourceUrl: string }>(facts: readonly T[]): T | null {
  const priorities = { official_release: 0, youtube_release: 1, recording_upload: 2 };
  // Keep the earliest verified release even when a later album page is added.
  const verified = facts.filter(fact => isCalendarDate(fact.releaseDate) && fact.basis !== "recording_upload");
  const candidates = verified.length ? verified : facts.filter(fact => isCalendarDate(fact.releaseDate));
  return [...candidates].sort((a, b) => a.releaseDate.localeCompare(b.releaseDate) || priorities[a.basis] - priorities[b.basis] || a.sourceUrl.localeCompare(b.sourceUrl))[0] ?? null;
}
