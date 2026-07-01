import { describe, expect, it } from "vitest";
import { displayHololiveBracketRoundLabel, hololiveBracketRoundLabel } from "./hololiveBracketLabels";

describe("Hololive bracket round labels", () => {
  it("uses canonical Quarter Final and Semi Final labels for new brackets", () => {
    expect(hololiveBracketRoundLabel(32, 2)).toBe("Quarter Final");
    expect(hololiveBracketRoundLabel(32, 3)).toBe("Semi Final");
  });

  it("normalizes saved quarter-final variants for display", () => {
    expect(displayHololiveBracketRoundLabel("Round of 8")).toBe("Quarter Final");
    expect(displayHololiveBracketRoundLabel("RO8")).toBe("Quarter Final");
    expect(displayHololiveBracketRoundLabel("Quarter Finals")).toBe("Quarter Final");
    expect(displayHololiveBracketRoundLabel("Quarterfinals")).toBe("Quarter Final");
    expect(displayHololiveBracketRoundLabel("Round of 16")).toBe("Round of 16");
  });

  it("normalizes saved semi-final variants for display", () => {
    expect(displayHololiveBracketRoundLabel("Semifinals")).toBe("Semi Final");
    expect(displayHololiveBracketRoundLabel("Semi Finals")).toBe("Semi Final");
  });
});
