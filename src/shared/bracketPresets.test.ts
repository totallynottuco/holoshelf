import { describe, expect, it } from "vitest";
import { bracketPresetSignature, readBracketPresets, saveBracketPreset, writeBracketPresets, type BracketPresetConfiguration } from "./bracketPresets";

const configuration: BracketPresetConfiguration = {
  size: "RO32", format: "double_elimination", generationStyle: "random_songs",
  filters: {
    ratingBuckets: ["favorite", "unrated"], includedTalentIds: ["sora", "suisei"],
    vocalScopes: ["solo"], talentStatuses: ["active", "alumni", "custom"], historyParticipation: "top8",
    maxEntriesPerTalent: 3, preferTopicSplitPerTalent: true, excludeTopViewedPerTalent: true,
    excludePreviousChampions: true, excludePreviousFinalists: true, excludePreviousTop4: true, excludePreviousTop8: true,
    excludeAboveViews: 5_000_000, excludeBelowViews: 100, dateBasis: "song_release",
    excludeAfterDate: "2022-12-31", excludeBeforeDate: "2020-01-01", excludeTopicIds: ["Music_Cover"]
  }
};

describe("saved bracket filters", () => {
  it("round-trips the entire configuration without changing the source", () => {
    const before = structuredClone(configuration);
    const presets = saveBracketPreset([], configuration, "  My filters  ", null, "preset-one");
    expect(readBracketPresets(writeBracketPresets(presets))).toEqual([{ ...configuration, id: "preset-one", name: "My filters" }]);
    expect(configuration).toEqual(before);
    expect(readBracketPresets(undefined)).toEqual([]);
  });
  it("updates the loaded preset and saves a new name as a separate preset", () => {
    const first = saveBracketPreset([], configuration, "First", null, "one");
    const changed = { ...configuration, size: "RO16" as const };
    const updated = saveBracketPreset(first, changed, "First", "one", "unused");
    expect(updated).toHaveLength(1); expect(updated[0]).toMatchObject({id:"one",size:"RO16"});
    const copied = saveBracketPreset(updated, configuration, "Second", "one", "two");
    expect(copied.map(preset => preset.id)).toEqual(["one", "two"]);
    expect(updated).toHaveLength(1);
    expect(() => saveBracketPreset(copied, configuration, "first", "two", "three")).toThrow("Name already used");
  });
  it.each(["", " ", "x".repeat(49)])("rejects invalid names: %s", name => {
    expect(() => saveBracketPreset([], configuration, name, null, "one")).toThrow("Enter a name");
  });
  it.each(["", "not json", '{"schema":2,"presets":[]}', '{"schema":1,"presets":[{"id":"invalid"}]}'])("rejects unreadable stored data without replacing it: %s", value => {
    expect(() => readBracketPresets(value)).toThrow("Could not load presets");
  });
  it("rejects duplicate IDs and names in stored collections", () => {
    const preset = { ...configuration, id:"one", name:"First" };
    for(const duplicate of [{...preset,name:"Second"},{...preset,id:"two",name:"first"}]) {
      expect(() => readBracketPresets(JSON.stringify({schema:1,presets:[preset,duplicate]}))).toThrow();
    }
  });
  it("matches unordered filters and distinguishes changed rules", () => {
    const reversed = { ...configuration, filters: { ...configuration.filters, ratingBuckets: [...configuration.filters.ratingBuckets!].reverse(), includedTalentIds: ["suisei", "sora"] } };
    expect(bracketPresetSignature(reversed)).toBe(bracketPresetSignature(configuration));
    expect(bracketPresetSignature({...configuration,format:"single_elimination"})).not.toBe(bracketPresetSignature(configuration));
    expect(bracketPresetSignature({...configuration,filters:{...configuration.filters,excludePreviousTop8:false}})).not.toBe(bracketPresetSignature(configuration));
  });
});
