import { describe, expect, it } from "vitest";

import { createDefaultGlicko2Rating, getConservativeGlicko2Rating, updateGlicko2RatingPeriod } from "./glicko2";

describe("Glicko-2 rating helper", () => {
  it("matches the published Glicko-2 example within rounding tolerance", () => {
    const ratings = new Map([
      ["player", { rating: 1500, ratingDeviation: 200, volatility: 0.06 }],
      ["opponent-1", { rating: 1400, ratingDeviation: 30, volatility: 0.06 }],
      ["opponent-2", { rating: 1550, ratingDeviation: 100, volatility: 0.06 }],
      ["opponent-3", { rating: 1700, ratingDeviation: 300, volatility: 0.06 }]
    ]);
    const next = updateGlicko2RatingPeriod(
      ratings,
      new Map([
        [
          "player",
          [
            { opponentId: "opponent-1", score: 1 },
            { opponentId: "opponent-2", score: 0 },
            { opponentId: "opponent-3", score: 0 }
          ]
        ]
      ])
    );

    expect(next.get("player")?.rating).toBeCloseTo(1464.06, 1);
    expect(next.get("player")?.ratingDeviation).toBeCloseTo(151.52, 1);
    expect(next.get("player")?.volatility).toBeCloseTo(0.06, 3);
  });

  it("rewards an upset more than an expected win", () => {
    const expectedWin = updateGlicko2RatingPeriod(
      new Map([
        ["favorite", { rating: 1700, ratingDeviation: 80, volatility: 0.06 }],
        ["underdog", { rating: 1300, ratingDeviation: 80, volatility: 0.06 }]
      ]),
      new Map([["favorite", [{ opponentId: "underdog", score: 1 }]]])
    );
    const upsetWin = updateGlicko2RatingPeriod(
      new Map([
        ["favorite", { rating: 1700, ratingDeviation: 80, volatility: 0.06 }],
        ["underdog", { rating: 1300, ratingDeviation: 80, volatility: 0.06 }]
      ]),
      new Map([["underdog", [{ opponentId: "favorite", score: 1 }]]])
    );

    expect((upsetWin.get("underdog")?.rating ?? 0) - 1300).toBeGreaterThan((expectedWin.get("favorite")?.rating ?? 0) - 1700);
  });

  it("calculates a conservative lower-bound rating from rating deviation", () => {
    expect(getConservativeGlicko2Rating({ rating: 1700, ratingDeviation: 80, volatility: 0.06 })).toBe(1540);
  });

  it("lowers rating deviation after repeated rated games", () => {
    let ratings = new Map([
      ["song-a", createDefaultGlicko2Rating()],
      ["song-b", createDefaultGlicko2Rating()]
    ]);

    for (let index = 0; index < 5; index += 1) {
      ratings = updateGlicko2RatingPeriod(
        ratings,
        new Map([
          ["song-a", [{ opponentId: "song-b", score: 1 }]],
          ["song-b", [{ opponentId: "song-a", score: 0 }]]
        ])
      );
    }

    expect(ratings.get("song-a")?.ratingDeviation).toBeLessThan(350);
    expect(ratings.get("song-b")?.ratingDeviation).toBeLessThan(350);
  });

  it("keeps sparse ratings finite", () => {
    const ratings = updateGlicko2RatingPeriod(new Map(), new Map([["song-a", [{ opponentId: "song-b", score: 1 }]]]));
    const row = ratings.get("song-a");

    expect(Number.isFinite(row?.rating)).toBe(true);
    expect(Number.isFinite(row?.ratingDeviation)).toBe(true);
    expect(Number.isFinite(row?.volatility)).toBe(true);
  });
});
