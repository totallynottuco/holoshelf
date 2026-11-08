import { describe, expect, it } from "vitest";
import { isTopBracketPlacement, normalizeBracketPlacements } from "./bracketPlacements";

describe("overall bracket placements", () => {
  const dense = [1, 2, 3, 4, 5, 5, 6, 6, 7, 7, 7, 7, 8, 8, 8, 8].map((rank, id) => ({ id, rank }));
  it("turns dense DE groups into competition ranks and complete tie ranges", () => {
    const normalized = normalizeBracketPlacements(dense);
    expect(normalized.map(row => row.rank)).toEqual([1, 2, 3, 4, 5, 5, 7, 7, 9, 9, 9, 9, 13, 13, 13, 13]);
    expect(normalized.map(row => row.rankEnd)).toEqual([1, 2, 3, 4, 6, 6, 8, 8, 12, 12, 12, 12, 16, 16, 16, 16]);
    expect(normalized.map(row => row.id)).toEqual(dense.map(row => row.id));
    expect(dense[6].rank).toBe(6);
    expect(normalizeBracketPlacements(normalized)).toEqual(normalized);
  });
  it("also normalizes legacy SE round bounds, independent of input ordering", () => {
    const legacy = [16, 4, 8, 2, 16, 8, 16, 8, 16, 4, 16, 1, 16, 8, 16, 16].map((rank, id) => ({ id, rank }));
    const normalized = normalizeBracketPlacements(legacy);
    expect(normalized.filter(row => row.rank === 3)).toHaveLength(2);
    expect(normalized.filter(row => row.rank === 5 && row.rankEnd === 8)).toHaveLength(4);
    expect(normalized.filter(row => row.rank === 9 && row.rankEnd === 16)).toHaveLength(8);
    expect(normalizeBracketPlacements(normalized)).toEqual(normalized);
    expect(normalizeBracketPlacements([])).toEqual([]);
  });
  it("includes whole ties at arbitrary cutoffs rather than inventing tiebreakers", () => {
    const normalized = normalizeBracketPlacements(dense);
    for (const [cutoff, count] of [[1, 1], [2, 2], [4, 4], [5, 6], [6, 6], [7, 8], [8, 8], [16, 16], [32, 16]]) {
      expect(normalized.filter(row => isTopBracketPlacement(row.rank, cutoff))).toHaveLength(count);
    }
  });
  it.each([0, -1, 1.5, NaN, Infinity])("rejects invalid ranks and cutoffs: %s", rank => {
    expect(() => normalizeBracketPlacements([{ rank }])).toThrow("Invalid bracket finishing rank");
    expect(isTopBracketPlacement(rank, 8)).toBe(false);
    expect(isTopBracketPlacement(1, rank)).toBe(false);
    expect(isTopBracketPlacement(null, 8)).toBe(false);
  });
});
