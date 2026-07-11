export interface RobustViewStrengthInput {
  id: string;
  values: Array<number | null | undefined>;
}

export interface RobustViewStrengthResult {
  id: string;
  score: number;
  count: number;
}

export interface RobustRelativeUpsetInput {
  id: string;
  values: Array<number | null | undefined>;
}

export interface RobustRelativeUpsetResult {
  id: string;
  score: number;
  count: number;
}

export interface ShrunkRateInput {
  id: string;
  values: Array<boolean | number | null | undefined>;
}

export interface ShrunkRateResult {
  id: string;
  score: number;
  count: number;
  successCount: number;
  failureCount: number;
}

export interface ShrunkWeightedSignedScoreSample {
  value: number | null | undefined;
  weight?: number | null | undefined;
}

export interface ShrunkWeightedSignedScoreInput {
  id: string;
  samples: ShrunkWeightedSignedScoreSample[];
}

export interface ShrunkWeightedSignedScoreResult {
  id: string;
  score: number;
  count: number;
  positiveCount: number;
  negativeCount: number;
  totalWeight: number;
}

export interface RobustWeightedRateSample {
  weight: number | null | undefined;
  success: boolean | number | null | undefined;
}

export interface RobustWeightedRateInput {
  id: string;
  samples: RobustWeightedRateSample[];
}

export interface RobustWeightedRateResult {
  id: string;
  score: number;
  count: number;
  successCount: number;
  failureCount: number;
  totalWeight: number;
  successWeight: number;
  failureWeight: number;
}

export interface RobustPositiveOpportunityInput {
  id: string;
  samples: RobustWeightedRateSample[];
}

export interface RobustPositiveOpportunityResult {
  id: string;
  score: number;
  count: number;
  successCount: number;
  failureCount: number;
  totalWeight: number;
  successWeight: number;
  failureWeight: number;
}

export const ROBUST_RELATIVE_UPSET_DOMAIN_MAX = Math.log2(100);

interface RobustUpperStats {
  cap: number;
  median: number;
  p95: number;
  scaledMad: number;
}

function percentile(sortedValues: number[], percentileValue: number): number {
  if (sortedValues.length === 0) {
    return 0;
  }
  if (sortedValues.length === 1) {
    return sortedValues[0];
  }

  const clamped = Math.min(1, Math.max(0, percentileValue));
  const index = (sortedValues.length - 1) * clamped;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) {
    return sortedValues[lower];
  }

  const weight = index - lower;
  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
}

function positiveLogViewCounts(values: Array<number | null | undefined>): number[] {
  return values
    .map((value) => (typeof value === "number" ? value : Number.NaN))
    .filter((value) => Number.isFinite(value) && value > 0)
    .map((value) => Math.log1p(value));
}

function positiveFiniteValues(values: Array<number | null | undefined>, maxValue = Number.POSITIVE_INFINITY): number[] {
  return values
    .map((value) => (typeof value === "number" ? value : Number.NaN))
    .filter((value) => Number.isFinite(value) && value > 0)
    .map((value) => Math.min(value, maxValue));
}

function binaryValues(values: Array<boolean | number | null | undefined>): number[] {
  return values
    .map((value) => {
      if (typeof value === "boolean") {
        return value ? 1 : 0;
      }
      if (typeof value === "number" && Number.isFinite(value)) {
        return value > 0 ? 1 : 0;
      }
      return Number.NaN;
    })
    .filter((value) => Number.isFinite(value));
}

function weightedRateSamples(
  samples: RobustWeightedRateSample[],
  maxWeight: number
): Array<{ weight: number; success: boolean }> {
  return samples
    .map((sample) => {
      const rawWeight = typeof sample.weight === "number" ? sample.weight : Number.NaN;
      const success =
        typeof sample.success === "boolean"
          ? sample.success
          : typeof sample.success === "number" && Number.isFinite(sample.success) && sample.success > 0;
      return {
        weight: Number.isFinite(rawWeight) ? Math.min(rawWeight, maxWeight) : Number.NaN,
        success
      };
    })
    .filter((sample) => Number.isFinite(sample.weight) && sample.weight > 0);
}

function weightedSignedScoreSamples(samples: ShrunkWeightedSignedScoreSample[]): Array<{ value: number; weight: number }> {
  return samples
    .map((sample) => {
      const rawValue = typeof sample.value === "number" ? sample.value : Number.NaN;
      const rawWeight = sample.weight == null ? 1 : typeof sample.weight === "number" ? sample.weight : Number.NaN;
      return {
        value: Number.isFinite(rawValue) ? Math.max(-1, Math.min(1, rawValue)) : Number.NaN,
        weight: Number.isFinite(rawWeight) ? rawWeight : Number.NaN
      };
    })
    .filter((sample) => Number.isFinite(sample.value) && Number.isFinite(sample.weight) && sample.weight > 0);
}

function robustUpperStats(values: number[], domainMax: number): RobustUpperStats {
  if (values.length === 0) {
    return { cap: 0, median: 0, p95: 0, scaledMad: 0 };
  }

  const sortedValues = [...values].sort((left, right) => left - right);
  const median = percentile(sortedValues, 0.5);
  const p95 = percentile(sortedValues, 0.95);
  const deviations = sortedValues.map((value) => Math.abs(value - median)).sort((left, right) => left - right);
  const scaledMad = percentile(deviations, 0.5) * 1.4826;
  const madCap = median + scaledMad * 3;
  const robustCap = Math.min(p95, madCap);
  return {
    cap: Math.min(domainMax, Math.max(0, robustCap)),
    median,
    p95,
    scaledMad
  };
}

function softCompressAboveCap(value: number, cap: number, domainMax: number, scale = 1): number {
  const clampedValue = Math.min(domainMax, Math.max(0, value));
  const safeCap = Math.min(domainMax, Math.max(0, cap));
  if (clampedValue <= safeCap) {
    return clampedValue;
  }

  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  return Math.min(domainMax, safeCap + safeScale * Math.log1p((clampedValue - safeCap) / safeScale));
}

export function calculateRobustViewStrengthScores(
  inputs: RobustViewStrengthInput[],
  priorWeight = 3
): RobustViewStrengthResult[] {
  const logsById = new Map(inputs.map((input) => [input.id, positiveLogViewCounts(input.values)]));
  const allLogs = [...logsById.values()].flat().sort((left, right) => left - right);
  if (allLogs.length === 0) {
    return inputs.map((input) => ({ id: input.id, score: 0, count: 0 }));
  }

  const capStats = robustUpperStats(allLogs, Number.POSITIVE_INFINITY);
  const compressionScale = Math.max(1, capStats.scaledMad);
  const safePriorWeight = Number.isFinite(priorWeight) && priorWeight > 0 ? priorWeight : 0;

  return inputs.map((input) => {
    const logs = logsById.get(input.id) ?? [];
    if (logs.length === 0) {
      return { id: input.id, score: 0, count: 0 };
    }

    const adjustedSum = logs.reduce(
      (sum, value) => sum + softCompressAboveCap(value, capStats.cap, Number.POSITIVE_INFINITY, compressionScale),
      0
    );
    const averageLog = adjustedSum / logs.length;
    const confidence = logs.length / (logs.length + safePriorWeight);
    const scoreLog = averageLog > capStats.median ? capStats.median + (averageLog - capStats.median) * confidence : averageLog;
    return {
      id: input.id,
      score: Math.max(0, Math.expm1(scoreLog)),
      count: logs.length
    };
  });
}

export function calculateRobustRelativeUpsetScores(
  inputs: RobustRelativeUpsetInput[],
  priorWeight = 3,
  domainMax = ROBUST_RELATIVE_UPSET_DOMAIN_MAX
): RobustRelativeUpsetResult[] {
  const safeDomainMax = Number.isFinite(domainMax) && domainMax > 0 ? domainMax : ROBUST_RELATIVE_UPSET_DOMAIN_MAX;
  const valuesById = new Map(inputs.map((input) => [input.id, positiveFiniteValues(input.values, safeDomainMax)]));
  const allValues = [...valuesById.values()].flat();
  if (allValues.length === 0) {
    return inputs.map((input) => ({ id: input.id, score: 0, count: 0 }));
  }

  const capStats = robustUpperStats(allValues, safeDomainMax);
  const compressionScale = Math.max(0.75, capStats.scaledMad);
  const safePriorWeight = Number.isFinite(priorWeight) && priorWeight > 0 ? priorWeight : 0;

  return inputs.map((input) => {
    const values = valuesById.get(input.id) ?? [];
    if (values.length === 0) {
      return { id: input.id, score: 0, count: 0 };
    }

    const adjustedSum = values.reduce((sum, value) => sum + softCompressAboveCap(value, capStats.cap, safeDomainMax, compressionScale), 0);
    return {
      id: input.id,
      score: Math.max(0, adjustedSum / (values.length + safePriorWeight)),
      count: values.length
    };
  });
}

export function calculateRobustPositiveOpportunityScores(
  inputs: RobustPositiveOpportunityInput[],
  priorWeight = 3,
  domainMax = ROBUST_RELATIVE_UPSET_DOMAIN_MAX
): RobustPositiveOpportunityResult[] {
  const safeDomainMax = Number.isFinite(domainMax) && domainMax > 0 ? domainMax : ROBUST_RELATIVE_UPSET_DOMAIN_MAX;
  const samplesById = new Map(inputs.map((input) => [input.id, weightedRateSamples(input.samples, safeDomainMax)]));
  const allWeights = [...samplesById.values()].flat().map((sample) => sample.weight);
  if (allWeights.length === 0) {
    return inputs.map((input) => ({
      id: input.id,
      score: 0,
      count: 0,
      successCount: 0,
      failureCount: 0,
      totalWeight: 0,
      successWeight: 0,
      failureWeight: 0
    }));
  }

  const capStats = robustUpperStats(allWeights, safeDomainMax);
  const compressionScale = Math.max(0.75, capStats.scaledMad);
  const safePriorWeight = Number.isFinite(priorWeight) && priorWeight > 0 ? priorWeight : 0;

  return inputs.map((input) => {
    const samples = samplesById.get(input.id) ?? [];
    if (samples.length === 0) {
      return {
        id: input.id,
        score: 0,
        count: 0,
        successCount: 0,
        failureCount: 0,
        totalWeight: 0,
        successWeight: 0,
        failureWeight: 0
      };
    }

    const adjustedSamples = samples.map((sample) => ({
      success: sample.success,
      weight: softCompressAboveCap(sample.weight, capStats.cap, safeDomainMax, compressionScale)
    }));
    const successCount = adjustedSamples.filter((sample) => sample.success).length;
    const failureCount = adjustedSamples.length - successCount;
    const totalWeight = adjustedSamples.reduce((sum, sample) => sum + sample.weight, 0);
    const successWeight = adjustedSamples.reduce((sum, sample) => sum + (sample.success ? sample.weight : 0), 0);
    const failureWeight = totalWeight - successWeight;

    return {
      id: input.id,
      score: Math.max(0, successWeight / (adjustedSamples.length + safePriorWeight)),
      count: adjustedSamples.length,
      successCount,
      failureCount,
      totalWeight,
      successWeight,
      failureWeight
    };
  });
}

export function calculateShrunkBinaryRates(inputs: ShrunkRateInput[], priorWeight = 3): ShrunkRateResult[] {
  const valuesById = new Map(inputs.map((input) => [input.id, binaryValues(input.values)]));
  const allValues = [...valuesById.values()].flat();
  if (allValues.length === 0) {
    return inputs.map((input) => ({ id: input.id, score: 0, count: 0, successCount: 0, failureCount: 0 }));
  }

  const globalMean = allValues.reduce((sum, value) => sum + value, 0) / allValues.length;
  const safePriorWeight = Number.isFinite(priorWeight) && priorWeight > 0 ? priorWeight : 0;

  return inputs.map((input) => {
    const values = valuesById.get(input.id) ?? [];
    const successCount = values.reduce((sum, value) => sum + value, 0);
    const failureCount = values.length - successCount;
    if (values.length === 0) {
      return { id: input.id, score: 0, count: 0, successCount: 0, failureCount: 0 };
    }

    return {
      id: input.id,
      score: Math.max(0, Math.min(1, (successCount + safePriorWeight * globalMean) / (values.length + safePriorWeight))),
      count: values.length,
      successCount,
      failureCount
    };
  });
}

export function calculateShrunkWeightedSignedScores(
  inputs: ShrunkWeightedSignedScoreInput[],
  priorWeight = 3
): ShrunkWeightedSignedScoreResult[] {
  const samplesById = new Map(inputs.map((input) => [input.id, weightedSignedScoreSamples(input.samples)]));
  const safePriorWeight = Number.isFinite(priorWeight) && priorWeight > 0 ? priorWeight : 0;

  return inputs.map((input) => {
    const samples = samplesById.get(input.id) ?? [];
    if (samples.length === 0) {
      return { id: input.id, score: 0, count: 0, positiveCount: 0, negativeCount: 0, totalWeight: 0 };
    }

    const totalWeight = samples.reduce((sum, sample) => sum + sample.weight, 0);
    const weightedTotal = samples.reduce((sum, sample) => sum + sample.value * sample.weight, 0);
    return {
      id: input.id,
      score: Math.max(-1, Math.min(1, weightedTotal / (totalWeight + safePriorWeight))),
      count: samples.length,
      positiveCount: samples.filter((sample) => sample.value > 0).length,
      negativeCount: samples.filter((sample) => sample.value < 0).length,
      totalWeight
    };
  });
}

export function calculateRobustWeightedSuccessRates(
  inputs: RobustWeightedRateInput[],
  priorWeight = 3,
  domainMax = ROBUST_RELATIVE_UPSET_DOMAIN_MAX
): RobustWeightedRateResult[] {
  const safeDomainMax = Number.isFinite(domainMax) && domainMax > 0 ? domainMax : ROBUST_RELATIVE_UPSET_DOMAIN_MAX;
  const samplesById = new Map(inputs.map((input) => [input.id, weightedRateSamples(input.samples, safeDomainMax)]));
  const allWeights = [...samplesById.values()].flat().map((sample) => sample.weight);
  if (allWeights.length === 0) {
    return inputs.map((input) => ({
      id: input.id,
      score: 0,
      count: 0,
      successCount: 0,
      failureCount: 0,
      totalWeight: 0,
      successWeight: 0,
      failureWeight: 0
    }));
  }

  const capStats = robustUpperStats(allWeights, safeDomainMax);
  const compressionScale = Math.max(0.75, capStats.scaledMad);
  const safePriorWeight = Number.isFinite(priorWeight) && priorWeight > 0 ? priorWeight : 0;
  const adjustedById = new Map(
    [...samplesById.entries()].map(([id, samples]) => [
      id,
      samples.map((sample) => ({
        success: sample.success,
        weight: softCompressAboveCap(sample.weight, capStats.cap, safeDomainMax, compressionScale)
      }))
    ])
  );
  const allAdjusted = [...adjustedById.values()].flat();
  const globalTotalWeight = allAdjusted.reduce((sum, sample) => sum + sample.weight, 0);
  const globalSuccessWeight = allAdjusted.reduce((sum, sample) => sum + (sample.success ? sample.weight : 0), 0);
  const globalMean = globalTotalWeight > 0 ? globalSuccessWeight / globalTotalWeight : 0;

  return inputs.map((input) => {
    const samples = adjustedById.get(input.id) ?? [];
    if (samples.length === 0) {
      return {
        id: input.id,
        score: 0,
        count: 0,
        successCount: 0,
        failureCount: 0,
        totalWeight: 0,
        successWeight: 0,
        failureWeight: 0
      };
    }

    const successCount = samples.filter((sample) => sample.success).length;
    const failureCount = samples.length - successCount;
    const totalWeight = samples.reduce((sum, sample) => sum + sample.weight, 0);
    const successWeight = samples.reduce((sum, sample) => sum + (sample.success ? sample.weight : 0), 0);
    const failureWeight = totalWeight - successWeight;

    return {
      id: input.id,
      score: Math.max(0, Math.min(1, (successWeight + safePriorWeight * globalMean) / (totalWeight + safePriorWeight))),
      count: samples.length,
      successCount,
      failureCount,
      totalWeight,
      successWeight,
      failureWeight
    };
  });
}
