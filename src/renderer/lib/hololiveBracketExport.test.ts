import { describe, expect, it } from "vitest";

import { calculateHololiveBracketExportLayout } from "./hololiveBracketExport";

const EXPORT_MAX_CANVAS_DIMENSION = 8192;
const EXPORT_PIXEL_SCALE = 1.25;

describe("Hololive bracket export layout", () => {
  it.each([
    { name: "RO16", sideRoundCount: 3, baseMatches: 4 },
    { name: "RO32", sideRoundCount: 4, baseMatches: 8 },
    { name: "RO64", sideRoundCount: 5, baseMatches: 16 },
    { name: "RO128", sideRoundCount: 6, baseMatches: 32 },
    { name: "RO256", sideRoundCount: 7, baseMatches: 64 }
  ])("fits every match and champion area for $name exports", ({ sideRoundCount, baseMatches }) => {
    const layout = calculateHololiveBracketExportLayout(sideRoundCount, baseMatches);
    const scaledWidth = Math.ceil(layout.width * EXPORT_PIXEL_SCALE);
    const scaledHeight = Math.ceil(layout.height * EXPORT_PIXEL_SCALE);

    expect(layout.rowHeight).toBeGreaterThanOrEqual(layout.matchHeight + 2);
    expect(layout.width).toBeGreaterThan(layout.padding * 2 + layout.finalWidth);
    expect(layout.height).toBeGreaterThanOrEqual(layout.bracketTop + layout.matchAreaHeight + layout.padding);
    expect(layout.championPlaqueTop + layout.championPlaqueHeight).toBeLessThan(layout.height);
    expect(layout.championImageTop + layout.championImageHeight).toBeLessThanOrEqual(layout.height - layout.padding);
    expect(scaledWidth).toBeLessThanOrEqual(EXPORT_MAX_CANVAS_DIMENSION);
    expect(scaledHeight).toBeLessThanOrEqual(EXPORT_MAX_CANVAS_DIMENSION);
  });
});
