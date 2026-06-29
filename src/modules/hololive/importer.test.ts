import { describe, expect, it } from "vitest";
import { inferHololiveCsvMapping, rowValue } from "./importer";

describe("Hololive CSV importer", () => {
  it("infers common song columns", () => {
    const mapping = inferHololiveCsvMapping(["Song Title", "Singer", "Tier", "YouTube URL", "Notes"]);

    expect(mapping.fields.songTitle).toBe("Song Title");
    expect(mapping.fields.artistName).toBe("Singer");
    expect(mapping.fields.tier).toBe("Tier");
    expect(mapping.fields.sourceUrl).toBe("YouTube URL");
  });

  it("infers Unicode song columns", () => {
    const mapping = inferHololiveCsvMapping(["曲", "Singer"]);

    expect(mapping.fields.songTitle).toBe("曲");
  });

  it("reads mapped row values", () => {
    const mapping = inferHololiveCsvMapping(["Song", "Artist"]);
    expect(rowValue({ Song: " Stellar Stellar ", Artist: "Suisei" }, mapping, "songTitle")).toBe("Stellar Stellar");
  });
});
