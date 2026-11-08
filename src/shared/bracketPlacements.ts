export interface BracketPlacement {
  /** Competition rank: one plus the number of entrants who finished above this tie. */
  rank: number;
  rankEnd?: number;
}

/** Accepts dense groups, legacy round bounds, or normalized ranks; idempotent. */
export function normalizeBracketPlacements<T extends BracketPlacement>(standings: readonly T[]): Array<T & { rankEnd: number }> {
  const counts = new Map<number, number>();
  for (const { rank } of standings) {
    if (!Number.isSafeInteger(rank) || rank < 1) throw new Error("Invalid bracket finishing rank");
    counts.set(rank, (counts.get(rank) ?? 0) + 1);
  }
  const ranges = new Map<number, { rank: number; rankEnd: number }>();
  let above = 0;
  for (const [group, count] of [...counts].sort(([left], [right]) => left - right)) {
    ranges.set(group, { rank: above + 1, rankEnd: above + count });
    above += count;
  }
  return standings.map(standing => ({ ...standing, ...ranges.get(standing.rank)! }));
}

/** Includes the whole tied group when a cutoff falls inside its placement range. */
export function isTopBracketPlacement(rank: number | null, cutoff: number): boolean {
  return rank !== null && Number.isSafeInteger(rank) && rank > 0 &&
    Number.isSafeInteger(cutoff) && cutoff > 0 && rank <= cutoff;
}
