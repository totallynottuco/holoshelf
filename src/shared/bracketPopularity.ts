import type { HololiveBracketPopularity } from "./contracts";

export function bracketPopularitySongCount(popularity: HololiveBracketPopularity, total: number): number {
  if (!total) return 0;
  return popularity.unit === "songs"
    ? Math.min(popularity.amount, total)
    : Math.ceil(total * popularity.amount / 100 - 1e-9);
}

export function convertBracketPopularity(
  popularity: HololiveBracketPopularity,
  unit: HololiveBracketPopularity["unit"],
  total: number
): HololiveBracketPopularity {
  if (unit === popularity.unit) return popularity;
  const count = bracketPopularitySongCount(popularity, total);
  const amount = unit === "songs" ? Math.max(1, count)
    : total ? Math.max(0.01, Math.floor(count * 10_000 / total + 1e-9) / 100) : 25;
  return { ...popularity, unit, amount };
}
