import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { DatabaseService } from "./database";
import type { HololiveBracketFormat, HololiveBracketGenerationStyle } from "../../src/shared/contracts";
import { getHololiveCanonicalTalentId } from "../../src/shared/hololiveTalentIdentity";

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

  it("ranks popularity within the release year before applying talent filters", async () => {
    const db = await fixture();
    const known = new Set(db.listHololiveIdols().map(idol => getHololiveCanonicalTalentId(idol.id)));
    const cohort = db.listHololiveMusicRows({ dedupeCanonicalPerformance: true }, true)
      .filter(song => song.releaseDate?.startsWith("2022-") && song.viewCount != null &&
        song.ownedIdolIds.some(id => known.has(getHololiveCanonicalTalentId(id))))
      .sort((a, b) => b.viewCount! - a.viewCount!);
    const cutoff = cohort[Math.ceil(cohort.length / 10) - 1].viewCount!;
    const talent = cohort[0].ownedIdolIds.map(getHololiveCanonicalTalentId).find(id => known.has(id))!;
    const expected = cohort.filter(song => song.viewCount! >= cutoff &&
      song.ownedIdolIds.map(getHololiveCanonicalTalentId).includes(talent));
    const narrowed = db.previewHololiveBracketSelection({
      size: "RO16", filters: {
        dateBasis: "song_release", excludeBeforeDate: "2022-01-01", excludeAfterDate: "2022-12-31",
        yearPopularity: "top10", includedTalentIds: [talent], maxEntriesPerTalent: null
      }
    });
    expect(narrowed.eligibleCount).toBe(expected.length);
    expect(narrowed.entries.length).toBeGreaterThan(0);
    expect(narrowed.entries.every(entry => expected.some(song => song.youtubeVideoId === entry.youtubeVideoId))).toBe(true);
  });

  it("ranks one release window by views before applying other song filters", async () => {
    const db = await fixture();
    const known = new Set(db.listHololiveIdols().map(idol => getHololiveCanonicalTalentId(idol.id)));
    const catalog = db.listHololiveMusicRows({ dedupeCanonicalPerformance: true }, true)
      .filter(song => song.viewCount != null && song.ownedIdolIds.some(id => known.has(getHololiveCanonicalTalentId(id))));
    const before = snapshot(db);
    for (const [from, to] of [["2020-01-01", "2022-12-31"], ["2022-05-01", "2022-12-31"]]) {
      const cohort = catalog.filter(song => song.releaseDate && song.releaseDate >= from && song.releaseDate <= to);
      const cutoff = cohort.slice().sort((a, b) => a.viewCount! - b.viewCount! || a.youtubeVideoId.localeCompare(b.youtubeVideoId)).slice(0, 48);
      const result = db.previewHololiveBracketSelection({
        size: "RO32", filters: {
          dateBasis: "song_release", excludeBeforeDate: from, excludeAfterDate: to,
          excludeTopicIds: ["Original_Song"], maxEntriesPerTalent: null, preferTopicSplitPerTalent: false,
          popularity: { direction: "least", unit: "songs", amount: 48 }
        }
      });
      const expectedIds = new Set(cutoff.filter(song => song.topicId === "Music_Cover").map(song => song.youtubeVideoId));
      expect(result.popularityPoolCount).toBe(cohort.length);
      expect(result.eligibleCount).toBe(expectedIds.size);
      expect(result.entries.length).toBeGreaterThan(0);
      expect(result.entries.every(entry => expectedIds.has(entry.youtubeVideoId))).toBe(true);

      const mostViewed = cohort.slice().sort((a, b) => b.viewCount! - a.viewCount! || a.youtubeVideoId.localeCompare(b.youtubeVideoId))
        .slice(0, Math.ceil(cohort.length * 0.17));
      const percent = db.previewHololiveBracketSelection({
        size: "RO16", filters: {
          excludeBeforeDate: from, excludeAfterDate: to, maxEntriesPerTalent: null, preferTopicSplitPerTalent: false,
          popularity: { direction: "most", unit: "percent", amount: 17 }
        }
      });
      expect(percent.eligibleCount).toBe(mostViewed.length);
      expect(new Set(percent.entries.map(entry => entry.youtubeVideoId)))
        .toEqual(new Set(mostViewed.slice(0, 16).map(song => song.youtubeVideoId)));
    }
    expect(snapshot(db)).toEqual(before);
  });

  it("keeps exact reservations across release windows and redraws, and rejects unavailable reservations", async () => {
    const db = await fixture();
    const original = await db.createHololiveBracket({ size: "RO16", filters, selectionSeed: "existing-bracket" });
    db.setHololiveMusicMarker({ youtubeVideoId: original.entries[0].youtubeVideoId, marker: "favorite" });
    const before = snapshot(db);
    const base = { size: "RO16" as const, format: "double_elimination" as const, generationStyle: "random_songs" as const };
    const old = db.previewHololiveBracketSelection({
      ...base, filters: { ...filters, excludeAfterDate: "2020-12-31" }, selectionSeed: "first-window"
    });
    const reservedSongs = old.entries.slice(0, 4).map(({ youtubeVideoId, idolId }) => ({ youtubeVideoId, idolId }));
    expect(reservedSongs).toHaveLength(4);
    const request = {
      ...base, reservedSongs,
      filters: { ...filters, excludeBeforeDate: "2022-01-01", popularity: { direction: "most" as const, unit: "percent" as const, amount: 50 } }
    };
    const first = db.previewHololiveBracketSelection({ ...request, selectionSeed: "first-draw" });
    const next = db.previewHololiveBracketSelection({ ...request, selectionSeed: "next-draw" });
    expect(first.creationError).toBeNull();
    expect(next.creationError).toBeNull();
    expect(next.entries).toHaveLength(16);
    expect(first.entries.slice(0, 4)).toEqual(old.entries.slice(0, 4));
    expect(next.entries.slice(0, 4)).toEqual(old.entries.slice(0, 4));
    expect(next.entries.slice(4)).not.toEqual(first.entries.slice(4));
    expect(next.entries.slice(4).every(entry => entry.dateUsed?.startsWith("2022"))).toBe(true);
    expect(snapshot(db)).toEqual(before);

    const expectedVideoIds = next.entries.map(entry => entry.youtubeVideoId);
    const created = await db.createHololiveBracket({ ...request, selectionSeed: "next-draw", expectedVideoIds });
    expect(new Set(created.entries.map(entry => entry.youtubeVideoId))).toEqual(new Set(expectedVideoIds));
    expect(new Set(created.entries.map(entry => entry.canonicalPerformanceKey)).size).toBe(16);
    for (const pick of reservedSongs) expect(created.entries).toContainEqual(expect.objectContaining(pick));
    expect(db.getHololiveBracket(original.id)).toEqual(original);

    db.run("UPDATE hololive_music_videos SET official_catalog_active=0 WHERE youtube_video_id=?", [reservedSongs[0].youtubeVideoId]);
    const after = snapshot(db);
    expect(db.previewHololiveBracketSelection(request).creationError).toContain("reserved song is unavailable");
    await expect(db.createHololiveBracket(request)).rejects.toThrow("reserved song is unavailable");
    expect(snapshot(db)).toEqual(after);
  });

  it("fills an even release-year quota and reports empty years explicitly", async () => {
    const db = await fixture();
    const request = { size: "RO16" as const, filters: { ...filters, slotQuota: { kind: "years" as const } } };
    const preview = db.previewHololiveBracketSelection(request);
    expect(preview.creationError).toBeNull();
    expect(preview.quotaProgress).toEqual([
      { label: "2020", requested: 6, filled: 6 },
      { label: "2021", requested: 5, filled: 5 },
      { label: "2022", requested: 5, filled: 5 }
    ]);
    const years = preview.entries.map(entry => entry.dateUsed?.slice(0, 4));
    expect(years.filter(year => year === "2020")).toHaveLength(6);
    expect(years.filter(year => year === "2021")).toHaveLength(5);
    expect(years.filter(year => year === "2022")).toHaveLength(5);

    const empty = { ...request, filters: { ...request.filters, excludeBeforeDate: "1900-01-01", excludeAfterDate: "1901-12-31" } };
    expect(db.previewHololiveBracketSelection(empty).quotaProgress).toEqual([
      { label: "1900", requested: 8, filled: 0 },
      { label: "1901", requested: 8, filled: 0 }
    ]);
    await expect(db.createHololiveBracket(empty)).rejects.toThrow("Slot quotas could not be filled");
    expect(db.listHololiveBrackets()).toEqual([]);
  });

  it("shares overlapping playlist songs without duplicates or starving a smaller pool", async () => {
    const db = await fixture();
    const request = { size: "RO16" as const, filters, selectionSeed: "playlist-quota" };
    const original = db.previewHololiveBracketSelection(request).entries.map(entry => entry.youtubeVideoId);
    const large = db.createHololiveMusicPlaylist("Large pool").playlists.find(playlist => playlist.name === "Large pool")!;
    const small = db.createHololiveMusicPlaylist("Small pool").playlists.find(playlist => playlist.name === "Small pool")!;
    db.addHololiveMusicPlaylistItems({ playlistId: large.id, youtubeVideoIds: original });
    db.addHololiveMusicPlaylistItems({ playlistId: small.id, youtubeVideoIds: original.slice(0, 8) });

    const quotaRequest = { ...request, filters: { ...filters, slotQuota: { kind: "playlists" as const, playlistIds: [large.id, small.id] } } };
    const preview = db.previewHololiveBracketSelection(quotaRequest);
    expect(preview.creationError).toBeNull();
    expect(preview.quotaProgress).toEqual([
      { label: large.name, requested: 8, filled: 8 },
      { label: small.name, requested: 8, filled: 8 }
    ]);
    expect(new Set(preview.entries.map(entry => entry.youtubeVideoId))).toEqual(new Set(original));
  });

  it("combines popularity with a separately filtered wildcard and creates the previewed draw", async () => {
    const db = await fixture();
    const wildcard = {
      kind: "wildcard" as const, name: "2020 covers", slots: 4, generationStyle: "random_songs" as const,
      main: { kind: "years" as const },
      filters: { dateBasis: "song_release" as const, excludeBeforeDate: "2020-01-01", excludeAfterDate: "2020-12-31", excludeTopicIds: ["Original_Song" as const] }
    };
    const request = {
      size: "RO16" as const, format: "double_elimination" as const, selectionSeed: "wildcard-quota",
      filters: { ...filters, excludeBeforeDate: "2021-01-01", yearPopularity: "top25" as const, slotQuota: wildcard }
    };
    const before = snapshot(db);
    const preview = db.previewHololiveBracketSelection(request);
    expect(preview.creationError).toBeNull();
    expect(preview.quotaProgress).toEqual([
      { label: "2021", requested: 6, filled: 6 },
      { label: "2022", requested: 6, filled: 6 },
      { label: "Wildcard", requested: 4, filled: 4 }
    ]);
    const main = (entries: typeof preview.entries) => entries.filter(entry => !entry.dateUsed?.startsWith("2020")).map(entry => entry.youtubeVideoId);
    expect(main(preview.entries)).toHaveLength(12);
    const redraw = db.previewHololiveBracketSelection({ ...request, selectionSeed: "another-draw" });
    expect(main(redraw.entries)).toEqual(main(preview.entries));
    expect(redraw.entries).not.toEqual(preview.entries);
    expect(snapshot(db)).toEqual(before);
    const expectedVideoIds = preview.entries.map(entry => entry.youtubeVideoId);
    const created = await db.createHololiveBracket({ ...request, expectedVideoIds });
    expect(new Set(created.entries.map(entry => entry.youtubeVideoId))).toEqual(new Set(expectedVideoIds));
    expect(db.getHololiveBracket(created.id).generationFilters).toMatchObject({
      yearPopularity: "top25", slotQuota: wildcard
    });
  });
});
