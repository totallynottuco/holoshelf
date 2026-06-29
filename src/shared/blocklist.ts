const SYSTEM_BLOCKED_TAGS = new Set([
  "loli",
  "lolicon",
  "shota",
  "shotacon",
  "underage",
  "minor",
  "minors",
  "child",
  "children",
  "rape",
  "non-consensual",
  "nonconsensual"
]);

export function normalizeTag(tag: string): string {
  return tag.trim().toLowerCase().replace(/[\s_]+/g, "-");
}

export function normalizeTags(tags: string[]): string[] {
  return [...new Set(tags.map(normalizeTag).filter(Boolean))].sort();
}

export function isSystemBlockedTag(tag: string): boolean {
  return SYSTEM_BLOCKED_TAGS.has(normalizeTag(tag));
}

export function filterBlockedTags(tags: string[], userBlockedTags: string[]): string[] {
  const userBlocked = new Set(userBlockedTags.map(normalizeTag));
  return normalizeTags(tags).filter((tag) => !SYSTEM_BLOCKED_TAGS.has(tag) && !userBlocked.has(tag));
}

export function hasBlockedTags(tags: string[], userBlockedTags: string[]): boolean {
  const userBlocked = new Set(userBlockedTags.map(normalizeTag));
  return normalizeTags(tags).some((tag) => SYSTEM_BLOCKED_TAGS.has(tag) || userBlocked.has(tag));
}
