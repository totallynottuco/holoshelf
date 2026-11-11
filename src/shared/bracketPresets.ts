import { z } from "zod";

export const BRACKET_PRESETS_SETTING = "hololive.bracketPresets";

const hololiveMusicTopicSchema = z.enum(["Original_Song", "Music_Cover"]);
const hololiveBracketRatingBucketSchema = z.enum(["unrated", "favorite", "like", "neutral", "dislike"]);
const hololiveBracketVocalScopeSchema = z.enum(["solo", "group"]);
const hololiveBracketTalentStatusFilterSchema = z.enum(["active", "alumni", "custom"]);
const hololiveBracketHistoryParticipationSchema = z.enum(["never", "appeared", "top8", "top4", "finalist", "winner"]);
export const bracketYearPopularitySchema = z.enum(["top10", "top25", "middle50", "bottom50", "outsideTop25"]);
const popularityDirection = z.enum(["most", "least"]);
export const bracketPopularitySchema = z.discriminatedUnion("unit", [
  z.object({ direction: popularityDirection, unit: z.literal("percent"), amount: z.number().min(0.01).max(100) }),
  z.object({ direction: popularityDirection, unit: z.literal("songs"), amount: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER) })
]);
const bracketPoolFiltersSchema = z.object({
  excludeDisliked: z.boolean().optional(),
  excludeRated: z.boolean().optional(),
  ratingBuckets: z.array(hololiveBracketRatingBucketSchema).optional(),
  includedTalentIds: z.array(z.string().trim().min(1)).optional(),
  vocalScopes: z.array(hololiveBracketVocalScopeSchema).optional(),
  talentStatuses: z.array(hololiveBracketTalentStatusFilterSchema).optional(),
  historyParticipation: hololiveBracketHistoryParticipationSchema.optional().nullable(),
  maxEntriesPerTalent: z.number().int().min(0).max(256).optional().nullable(),
  preferTopicSplitPerTalent: z.boolean().optional().nullable(),
  excludeTopViewedPerTalent: z.boolean().optional(),
  excludePreviousChampions: z.boolean().optional(),
  excludePreviousFinalists: z.boolean().optional(),
  excludePreviousTop4: z.boolean().optional(),
  excludePreviousTop8: z.boolean().optional(),
  excludeAboveViews: z.number().int().min(0).max(10_000_000_000).optional().nullable(),
  excludeBelowViews: z.number().int().min(0).max(10_000_000_000).optional().nullable(),
  dateBasis: z.enum(["song_release","video_upload"]).optional(),
  includeEstimatedReleaseDates: z.boolean().optional(),
  excludeAfterDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  excludeBeforeDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  excludeTopicIds: z.array(hololiveMusicTopicSchema).optional(),
  popularity: bracketPopularitySchema.optional(),
  yearPopularity: bracketYearPopularitySchema.optional()
});

const yearQuotaSchema = z.object({ kind: z.literal("years") });
const playlistQuotaSchema = z.object({ kind: z.literal("playlists"), playlistIds: z.array(z.string().trim().min(1)).max(256) });
const evenQuotaSchema = z.discriminatedUnion("kind", [yearQuotaSchema, playlistQuotaSchema]);

export const bracketSlotQuotaSchema = z.discriminatedUnion("kind", [
  yearQuotaSchema,
  playlistQuotaSchema,
  z.object({
    kind: z.literal("wildcard"),
    slots: z.number().int().min(1).max(256),
    name: z.string().trim().min(1).max(48),
    generationStyle: z.enum(["top_songs", "random_songs"]),
    filters: bracketPoolFiltersSchema,
    main: evenQuotaSchema.optional()
  })
]);

export const hololiveBracketGenerationFiltersSchema = bracketPoolFiltersSchema.extend({
  slotQuota: bracketSlotQuotaSchema.optional()
});

const configurationSchema = z.object({
  size: z.enum(["RO16", "RO32", "RO64", "RO128", "RO256"]),
  format: z.enum(["single_elimination", "double_elimination"]),
  generationStyle: z.enum(["top_songs", "random_songs"]),
  filters: hololiveBracketGenerationFiltersSchema
});
const presetSchema = configurationSchema.extend({
  id: z.string().min(1).max(120),
  name: z.string().trim().min(1).max(48)
});
const collectionSchema = z.object({ schema: z.literal(1), presets: z.array(presetSchema) }).refine(value =>
  new Set(value.presets.map(preset => preset.id)).size === value.presets.length &&
  new Set(value.presets.map(preset => preset.name.toLowerCase())).size === value.presets.length
);

export type BracketPresetConfiguration = z.infer<typeof configurationSchema>;
export type SavedBracketPreset = z.infer<typeof presetSchema>;

export function readBracketPresets(value: string | undefined): SavedBracketPreset[] {
  if (value === undefined) return [];
  try { return collectionSchema.parse(JSON.parse(value)).presets; }
  catch { throw new Error("Could not load presets."); }
}

export function writeBracketPresets(presets: SavedBracketPreset[]): string {
  return JSON.stringify(collectionSchema.parse({ schema: 1, presets }));
}

export function saveBracketPreset(presets: SavedBracketPreset[], configuration: BracketPresetConfiguration, name: string, loadedId: string | null, newId: string): SavedBracketPreset[] {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 48) throw new Error("Enter a name up to 48 characters.");
  const existing = presets.find(preset => preset.name.toLowerCase() === trimmed.toLowerCase());
  if (existing && existing.id !== loadedId) throw new Error("Name already used.");
  const preset = presetSchema.parse({ ...configuration, name: trimmed, id: existing?.id ?? newId });
  return existing ? presets.map(item => item.id === existing.id ? preset : item) : [...presets, preset];
}

export function bracketPresetSignature(configuration: BracketPresetConfiguration): string {
  const parsed = configurationSchema.parse(configuration);
  function normalize(value: unknown, key?: string): unknown {
    if (Array.isArray(value)) return key === "playlistIds" ? value : [...value].sort();
    if (value === null || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([field, entry]) => [field, normalize(entry, field)]));
  }
  const filters = normalize(parsed.filters);
  return JSON.stringify({ size: parsed.size, format: parsed.format, generationStyle: parsed.generationStyle, filters });
}
