import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { DatabaseService } from "./database";
import type { HololiveBracketFormat, HololiveBracketGenerationStyle } from "../../src/shared/contracts";

const filters = { dateBasis: "song_release" as const, excludeBeforeDate: "2020-01-01", excludeAfterDate: "2022-12-31", vocalScopes: ["solo" as const], maxEntriesPerTalent: null, preferTopicSplitPerTalent: false };
const protectedTables = ["hololive_brackets", "hololive_bracket_entries", "hololive_bracket_matches", "hololive_bracket_archives", "hololive_bracket_archive_entries", "hololive_bracket_archive_matches", "hololive_music_marker_keys", "hololive_music_playlists", "hololive_music_playlist_items", "hololive_music_exclusions", "hololive_music_queue_items", "hololive_tier_placements"];
const snapshot = (db: DatabaseService) => protectedTables.map(table => db.select(`SELECT * FROM ${table}`));
async function fixture() {
  const db = new DatabaseService("unused-preview-test.sqlite", undefined, { initializedDatabaseBytes: fs.readFileSync("resources/seed/holoshelf-template.sqlite"), persistWrites: false, createBackups: false });
  await db.init();
  return db;
}

describe("live bracket lobby", () => {
  it.each([
    ["top_songs", "single_elimination"], ["top_songs", "double_elimination"],
    ["random_songs", "single_elimination"], ["random_songs", "double_elimination"]
  ] as [HololiveBracketGenerationStyle, HololiveBracketFormat][])("previews the exact %s entrants created in %s without saving anything", async (generationStyle, format) => {
    const db = await fixture();
    const original = await db.createHololiveBracket({ size: "RO16", format: "double_elimination", filters, selectionSeed: "existing-bracket" });
    db.setHololiveMusicMarker({ youtubeVideoId: original.entries[0].youtubeVideoId, marker: "favorite" });
    db.setSetting("personal.lobby-test", "preserve");
    const before = snapshot(db), run = vi.spyOn(db, "run");
    const request = { size: "RO32" as const, format, generationStyle, filters, selectionSeed: "stable-live-draw" };
    const preview = db.previewHololiveBracketSelection(request);
    expect(preview.creationError).toBeNull();
    expect(preview.entries).toHaveLength(32);
    expect(db.previewHololiveBracketSelection(request)).toEqual(preview);
    expect(run).not.toHaveBeenCalled();
    expect(snapshot(db)).toEqual(before);
    const created = await db.createHololiveBracket({ ...request, expectedVideoIds: preview.entries.map(entry => entry.youtubeVideoId) });
    expect(new Set(created.entries.map(entry => entry.youtubeVideoId))).toEqual(new Set(preview.entries.map(entry => entry.youtubeVideoId)));
    expect(db.getHololiveBracket(original.id)).toEqual(original);
    expect(db.getSettings()["personal.lobby-test"]).toBe("preserve");
    expect(db.select("PRAGMA foreign_key_check")).toEqual([]);
  });

  it("redraws random entrants only when the seed changes", async () => {
    const db = await fixture(), request = { size: "RO32" as const, generationStyle: "random_songs" as const, filters };
    const first = db.previewHololiveBracketSelection({ ...request, selectionSeed: "first" });
    const next = db.previewHololiveBracketSelection({ ...request, selectionSeed: "second" });
    expect(new Set(next.entries.map(entry => entry.youtubeVideoId))).not.toEqual(new Set(first.entries.map(entry => entry.youtubeVideoId)));
    expect(db.previewHololiveBracketSelection({ ...request, selectionSeed: "first" })).toEqual(first);
    expect(db.listHololiveBrackets()).toEqual([]);
  });

  it("rejects a stale lineup before writing any bracket or personal records", async () => {
    const db = await fixture(), request = { size: "RO16" as const, filters, selectionSeed: "stale-draw" };
    const preview = db.previewHololiveBracketSelection(request);
    db.run("UPDATE hololive_music_videos SET official_catalog_active=0 WHERE youtube_video_id=?", [preview.entries[0].youtubeVideoId]);
    const before = snapshot(db);
    await expect(db.createHololiveBracket({ ...request, expectedVideoIds: preview.entries.map(entry => entry.youtubeVideoId) })).rejects.toThrow("lineup changed");
    expect(snapshot(db)).toEqual(before);
  });

  it("reports empty pools and impossible seeding in the preview", async () => {
    const db = await fixture();
    expect(db.previewHololiveBracketSelection({ size: "RO16", filters: { ...filters, excludeBeforeDate: "1900-01-01", excludeAfterDate: "1900-12-31" } }).entries).toEqual([]);
    const talent = db.listHololiveIdols().find(idol => idol.displayName === "Hoshimachi Suisei")!;
    const result = db.previewHololiveBracketSelection({ size: "RO16", filters: { maxEntriesPerTalent: null, preferTopicSplitPerTalent: false, includedTalentIds: [talent.id] } });
    expect(result.entries).toHaveLength(16);
    expect(result.creationError).toContain("same-talent");
    expect(db.listHololiveBrackets()).toEqual([]);
  });

  it("shows the same cap-relaxation warning as creation", async () => {
    const db = await fixture();
    const ids = db.listHololiveIdols().filter(idol => ["Hoshimachi Suisei", "Houshou Marine", "Tokoyami Towa"].includes(idol.displayName)).map(idol => idol.id);
    const request = { size: "RO16" as const, selectionSeed: "limited-talents", filters: { includedTalentIds: ids, maxEntriesPerTalent: 1, preferTopicSplitPerTalent: false } };
    const preview = db.previewHololiveBracketSelection(request);
    expect(preview.warnings[0]?.code).toBe("talent_cap_relaxed");
    const result = await db.createHololiveBracketResult({ ...request, expectedVideoIds: preview.entries.map(entry => entry.youtubeVideoId) });
    expect(result.warnings).toEqual(preview.warnings);
  });
});
