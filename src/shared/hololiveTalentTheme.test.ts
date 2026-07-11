import { describe, expect, it } from "vitest";
import { resolveHololiveTalentTheme } from "./hololiveTalentTheme";

describe("hololive talent themes", () => {
  it("returns talent-specific colors for known talents", () => {
    const baelz = resolveHololiveTalentTheme("hakos-baelz");
    const suisei = resolveHololiveTalentTheme("hoshimachi-suisei");

    expect(baelz.primary).toBe("#f34846");
    expect(suisei.primary).toBe("#40c8ee");
    expect(baelz.secondary).not.toBe(baelz.primary);
  });

  it("keeps member-specific themes before canonical fallbacks", () => {
    const fuwawa = resolveHololiveTalentTheme("fuwawa-abyssgard");
    const mococo = resolveHololiveTalentTheme("mococo-abyssgard");

    expect(fuwawa.primary).toBe("#68c7ff");
    expect(mococo.primary).toBe("#f7a1c8");
  });

  it("uses a stable neutral theme for unknown talent ids", () => {
    const unknown = resolveHololiveTalentTheme("some-custom-talent");

    expect(unknown.primary).toBe("#314d5d");
    expect(unknown.secondary).toBe("#83b4c8");
  });
});
