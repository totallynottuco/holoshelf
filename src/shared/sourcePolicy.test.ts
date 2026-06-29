import { describe, expect, it } from "vitest";
import { getSourcePolicy, isUrlAllowedByPolicy } from "./sourcePolicy";

describe("source policy filtering", () => {
  it("rejects non-HTTPS source URLs", () => {
    expect(isUrlAllowedByPolicy("http://holodex.net/api/v2/search/videoSearch", getSourcePolicy("holodex"))).toBe(false);
  });

  it("rejects URLs outside the source host", () => {
    expect(isUrlAllowedByPolicy("https://example.com/api/v2/search/videoSearch", getSourcePolicy("holodex"))).toBe(false);
  });

  it("allows Holodex API URLs", () => {
    const policy = getSourcePolicy("holodex");

    expect(isUrlAllowedByPolicy("https://holodex.net/api/v2/search/videoSearch", policy)).toBe(true);
    expect(isUrlAllowedByPolicy("https://holodex.net/api/v2/videos/abc", policy)).toBe(true);
  });
});
