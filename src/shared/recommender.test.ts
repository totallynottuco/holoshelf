import { describe, expect, it } from "vitest";
import type { CatalogItem } from "./contracts";
import { localTagRecommendationProvider } from "./recommender";

const baseItem = {
  moduleId: "hololive",
  kind: "song",
  subtitle: null,
  sourceUrl: null,
  coverPath: null,
  status: "active",
  notes: null,
  updatedAt: "2026-06-05T00:00:00.000Z"
} satisfies Partial<CatalogItem>;

describe("local tag recommender", () => {
  it("ranks matching tags and ratings higher", () => {
    const items: CatalogItem[] = [
      { ...baseItem, id: "1", title: "A", tags: ["action"], rating: 3 },
      { ...baseItem, id: "2", title: "B", tags: ["music", "comedy"], rating: 5 }
    ] as CatalogItem[];

    const results = localTagRecommendationProvider.recommend(
      {
        moduleId: "hololive",
        preferredTags: ["music"],
        blockedTags: [],
        limit: 5
      },
      items
    );

    expect(results[0].item.id).toBe("2");
    expect(results[0].reasons).toContain("tag:music");
  });

  it("filters user and system blocked tags", () => {
    const items: CatalogItem[] = [
      { ...baseItem, id: "1", title: "Safe", tags: ["music"], rating: 4 },
      { ...baseItem, id: "2", title: "Blocked", tags: ["blocked"], rating: 5 },
      { ...baseItem, id: "3", title: "System", tags: ["underage"], rating: 5 },
      { ...baseItem, id: "4", title: "System Underscore", tags: ["non_consensual"], rating: 5 }
    ] as CatalogItem[];

    const results = localTagRecommendationProvider.recommend(
      {
        moduleId: "hololive",
        preferredTags: ["music", "blocked", "underage"],
        blockedTags: ["blocked"],
        limit: 5
      },
      items
    );

    expect(results.map((result) => result.item.id)).toEqual(["1"]);
  });
});
