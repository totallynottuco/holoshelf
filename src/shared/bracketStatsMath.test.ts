import { describe, expect, it } from "vitest";
import {
  ROBUST_RELATIVE_UPSET_DOMAIN_MAX,
  calculateRobustPositiveOpportunityScores,
  calculateRobustRelativeUpsetScores,
  calculateRobustViewStrengthScores,
  calculateRobustWeightedSuccessRates,
  calculateShrunkBinaryRates,
  calculateShrunkWeightedSignedScores
} from "./bracketStatsMath";

describe("bracket stats math", () => {
  it("softens view-strength outliers without flattening different opponent levels together", () => {
    const anchorInputs = Array.from({ length: 20 }, (_, index) => ({
      id: `anchor-${index}`,
      values: [5_000_000]
    }));
    const results = calculateRobustViewStrengthScores([
      ...anchorInputs,
      { id: "nearest-cap-level", values: [50_000_000] },
      { id: "huge-outlier", values: [173_000_000] }
    ]);
    const nearestCapLevel = results.find((result) => result.id === "nearest-cap-level");
    const hugeOutlier = results.find((result) => result.id === "huge-outlier");

    expect(hugeOutlier?.score ?? 0).toBeGreaterThan(nearestCapLevel?.score ?? 0);
    expect(hugeOutlier?.score ?? Number.POSITIVE_INFINITY).toBeLessThan(173_000_000);
  });

  it("does not inflate low view-strength samples upward to the global field", () => {
    const results = calculateRobustViewStrengthScores([
      ...Array.from({ length: 10 }, (_, index) => ({
        id: `anchor-${index}`,
        values: [10_000_000]
      })),
      { id: "low-sample", values: [100_000] }
    ]);
    const lowSample = results.find((result) => result.id === "low-sample");

    expect(lowSample?.score ?? Number.POSITIVE_INFINITY).toBeLessThan(250_000);
  });

  it("lets repeated strong view-strength samples outrank one isolated outlier", () => {
    const results = calculateRobustViewStrengthScores([
      ...Array.from({ length: 20 }, (_, index) => ({
        id: `anchor-${index}`,
        values: [5_000_000]
      })),
      { id: "one-outlier", values: [173_000_000] },
      { id: "steady-strong", values: [50_000_000, 50_000_000, 50_000_000] }
    ]);
    const oneOutlier = results.find((result) => result.id === "one-outlier");
    const steadyStrong = results.find((result) => result.id === "steady-strong");

    expect(steadyStrong?.score ?? 0).toBeGreaterThan(oneOutlier?.score ?? 0);
  });

  it("caps and shrinks a single extreme relative upset sample", () => {
    const [result] = calculateRobustRelativeUpsetScores([
      {
        id: "extreme",
        values: [Math.log2(1000)]
      }
    ]);

    expect(result).toMatchObject({ id: "extreme", count: 1 });
    expect(result?.score ?? 0).toBeGreaterThan(0);
    expect(result?.score ?? Number.POSITIVE_INFINITY).toBeLessThan(ROBUST_RELATIVE_UPSET_DOMAIN_MAX);
    expect(result?.score ?? Number.POSITIVE_INFINITY).toBeLessThan(Math.log2(1000));
  });

  it("lets repeated moderate upsets outrank one isolated extreme upset", () => {
    const results = calculateRobustRelativeUpsetScores([
      {
        id: "one-extreme",
        values: [Math.log2(1000)]
      },
      {
        id: "steady",
        values: [Math.log2(5), Math.log2(5), Math.log2(5)]
      }
    ]);
    const oneExtreme = results.find((result) => result.id === "one-extreme");
    const steady = results.find((result) => result.id === "steady");

    expect(steady?.score ?? 0).toBeGreaterThan(oneExtreme?.score ?? 0);
  });

  it("rewards additional evidence by reducing zero-baseline shrinkage", () => {
    const results = calculateRobustRelativeUpsetScores([
      {
        id: "single",
        values: [Math.log2(4)]
      },
      {
        id: "repeated",
        values: [Math.log2(4), Math.log2(4), Math.log2(4), Math.log2(4)]
      }
    ]);
    const single = results.find((result) => result.id === "single");
    const repeated = results.find((result) => result.id === "repeated");

    expect(repeated?.count).toBe(4);
    expect(repeated?.score ?? 0).toBeGreaterThan(single?.score ?? 0);
  });

  it("uses confidence-adjusted relative scoring instead of raw relative totals", () => {
    const results = calculateRobustRelativeUpsetScores([
      { id: "single-large", values: [Math.log2(10)] },
      { id: "repeated-large", values: [Math.log2(10), Math.log2(10)] }
    ]);
    const singleLarge = results.find((result) => result.id === "single-large");
    const repeatedLarge = results.find((result) => result.id === "repeated-large");

    expect(singleLarge?.score ?? Number.POSITIVE_INFINITY).toBeLessThan(Math.log2(10));
    expect(repeatedLarge?.score ?? 0).toBeGreaterThan(singleLarge?.score ?? 0);
  });

  it("counts failed underdog opportunities without adding positive punch-above credit", () => {
    const [result] = calculateRobustPositiveOpportunityScores([
      {
        id: "one-win-one-loss",
        samples: [
          { weight: Math.log2(10), success: true },
          { weight: Math.log2(10), success: false }
        ]
      }
    ]);

    expect(result).toMatchObject({
      id: "one-win-one-loss",
      count: 2,
      successCount: 1,
      failureCount: 1
    });
    expect(result?.score ?? 0).toBeGreaterThan(0);
    expect(result?.score ?? Number.POSITIVE_INFINITY).toBeLessThan(Math.log2(10) / 2);
  });

  it("lets repeated moderate underdog success outrank one huge upset followed by losses", () => {
    const results = calculateRobustPositiveOpportunityScores([
      {
        id: "one-huge-with-losses",
        samples: [
          { weight: Math.log2(1000), success: true },
          { weight: Math.log2(10), success: false },
          { weight: Math.log2(10), success: false },
          { weight: Math.log2(10), success: false }
        ]
      },
      {
        id: "steady-underdog",
        samples: [
          { weight: Math.log2(4), success: true },
          { weight: Math.log2(4), success: true },
          { weight: Math.log2(4), success: true }
        ]
      }
    ]);
    const oneHugeWithLosses = results.find((result) => result.id === "one-huge-with-losses");
    const steadyUnderdog = results.find((result) => result.id === "steady-underdog");

    expect(oneHugeWithLosses).toMatchObject({ successCount: 1, failureCount: 3 });
    expect(steadyUnderdog).toMatchObject({ successCount: 3, failureCount: 0 });
    expect(steadyUnderdog?.score ?? 0).toBeGreaterThan(oneHugeWithLosses?.score ?? 0);
  });

  it("can score underdog performance as a weighted conversion rate", () => {
    const results = calculateRobustWeightedSuccessRates([
      {
        id: "one-big-win-two-losses",
        samples: [
          { weight: Math.log2(20), success: true },
          { weight: Math.log2(5), success: false },
          { weight: Math.log2(5), success: false }
        ]
      },
      {
        id: "steady",
        samples: [
          { weight: Math.log2(4), success: true },
          { weight: Math.log2(4), success: true },
          { weight: Math.log2(4), success: false }
        ]
      }
    ]);
    const oneBigWinTwoLosses = results.find((result) => result.id === "one-big-win-two-losses");
    const steady = results.find((result) => result.id === "steady");

    expect(oneBigWinTwoLosses).toMatchObject({ count: 3, successCount: 1, failureCount: 2 });
    expect(steady).toMatchObject({ count: 3, successCount: 2, failureCount: 1 });
    expect(oneBigWinTwoLosses?.score ?? Number.POSITIVE_INFINITY).toBeLessThan(1);
    expect(steady?.score ?? 0).toBeGreaterThan(oneBigWinTwoLosses?.score ?? 0);
  });

  it("returns zero opportunity scores for empty or invalid underdog samples", () => {
    expect(
      calculateRobustPositiveOpportunityScores([
        { id: "empty", samples: [] },
        {
          id: "invalid",
          samples: [
            { weight: 0, success: true },
            { weight: -1, success: true },
            { weight: Number.NaN, success: true },
            { weight: Number.POSITIVE_INFINITY, success: true },
            { weight: null, success: true },
            { weight: undefined, success: true }
          ]
        }
      ])
    ).toEqual([
      { id: "empty", score: 0, count: 0, successCount: 0, failureCount: 0, totalWeight: 0, successWeight: 0, failureWeight: 0 },
      { id: "invalid", score: 0, count: 0, successCount: 0, failureCount: 0, totalWeight: 0, successWeight: 0, failureWeight: 0 }
    ]);
  });


  it("returns zero scores for empty or invalid relative upset samples", () => {
    expect(
      calculateRobustRelativeUpsetScores([
        { id: "empty", values: [] },
        { id: "invalid", values: [0, -1, Number.NaN, Number.POSITIVE_INFINITY, null, undefined] }
      ])
    ).toEqual([
      { id: "empty", score: 0, count: 0 },
      { id: "invalid", score: 0, count: 0 }
    ]);
  });

  it("shrinks binary rates toward the global field instead of letting one result dominate", () => {
    const results = calculateShrunkBinaryRates([
      { id: "single-perfect", values: [true] },
      { id: "steady-good", values: [true, true, true, true, true, true, true, true, false] },
      { id: "anchor", values: [true, false, false, true] }
    ]);
    const singlePerfect = results.find((result) => result.id === "single-perfect");
    const steadyGood = results.find((result) => result.id === "steady-good");

    expect(singlePerfect).toMatchObject({ count: 1, successCount: 1, failureCount: 0 });
    expect(singlePerfect?.score ?? 1).toBeLessThan(1);
    expect(steadyGood?.score ?? 0).toBeGreaterThan(singlePerfect?.score ?? 0);
  });

  it("shrinks weighted pressure percentage deltas toward neutral while preserving positive and negative evidence", () => {
    const results = calculateShrunkWeightedSignedScores([
      { id: "single-positive", samples: [{ value: 1, weight: 1.5 }] },
      {
        id: "steady-positive",
        samples: [
          { value: 0.5, weight: 1 },
          { value: 0.5, weight: 1.25 },
          { value: 0.5, weight: 1.5 },
          { value: 0.5, weight: 1 }
        ]
      },
      {
        id: "steady-perfect",
        samples: [
          { value: 1, weight: 1 },
          { value: 1, weight: 1.25 },
          { value: 1, weight: 1.5 },
          { value: 1, weight: 1 }
        ]
      },
      {
        id: "negative",
        samples: [
          { value: -0.75, weight: 1.5 },
          { value: 0.25, weight: 1 }
        ]
      }
    ]);
    const singlePositive = results.find((result) => result.id === "single-positive");
    const steadyPositive = results.find((result) => result.id === "steady-positive");
    const steadyPerfect = results.find((result) => result.id === "steady-perfect");
    const negative = results.find((result) => result.id === "negative");

    expect(singlePositive).toMatchObject({ count: 1, positiveCount: 1, negativeCount: 0 });
    expect(singlePositive?.score ?? Number.POSITIVE_INFINITY).toBeLessThan(1);
    expect(steadyPositive?.score ?? 0).toBeGreaterThan(0);
    expect(steadyPositive?.score ?? Number.POSITIVE_INFINITY).toBeLessThan(0.5);
    expect(steadyPerfect?.score ?? 0).toBeGreaterThan(singlePositive?.score ?? 0);
    expect(negative).toMatchObject({ count: 2, positiveCount: 1, negativeCount: 1 });
    expect(negative?.score ?? 0).toBeLessThan(0);
    expect(Math.abs(negative?.score ?? 0)).toBeLessThan(0.75);
  });

  it("soft-compresses weighted resilience risks while preserving larger upset-risk importance", () => {
    const results = calculateRobustWeightedSuccessRates([
      {
        id: "one-huge-miss",
        samples: [{ weight: Math.log2(1000), success: false }]
      },
      {
        id: "steady-resilient",
        samples: [
          { weight: Math.log2(4), success: true },
          { weight: Math.log2(4), success: true },
          { weight: Math.log2(4), success: true }
        ]
      },
      {
        id: "mixed",
        samples: [
          { weight: Math.log2(2), success: true },
          { weight: Math.log2(50), success: false }
        ]
      }
    ]);
    const oneHugeMiss = results.find((result) => result.id === "one-huge-miss");
    const steadyResilient = results.find((result) => result.id === "steady-resilient");
    const mixed = results.find((result) => result.id === "mixed");

    expect(oneHugeMiss).toMatchObject({ count: 1, successCount: 0, failureCount: 1 });
    expect(steadyResilient?.score ?? 0).toBeGreaterThan(mixed?.score ?? 0);
    expect(mixed?.score ?? 0).toBeGreaterThan(oneHugeMiss?.score ?? 0);
    expect(oneHugeMiss?.failureWeight ?? Number.POSITIVE_INFINITY).toBeLessThan(Math.log2(1000));
  });
});
