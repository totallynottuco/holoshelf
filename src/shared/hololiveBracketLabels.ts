export const HOLOLIVE_QUARTER_FINAL_LABEL = "Quarter Final";
export const HOLOLIVE_SEMI_FINAL_LABEL = "Semi Final";

const SAVED_ROUND_LABEL_REPLACEMENTS: Record<string, string> = {
  "quarter final": HOLOLIVE_QUARTER_FINAL_LABEL,
  "quarter finals": HOLOLIVE_QUARTER_FINAL_LABEL,
  quarterfinal: HOLOLIVE_QUARTER_FINAL_LABEL,
  quarterfinals: HOLOLIVE_QUARTER_FINAL_LABEL,
  "round of 8": HOLOLIVE_QUARTER_FINAL_LABEL,
  "ro 8": HOLOLIVE_QUARTER_FINAL_LABEL,
  ro8: HOLOLIVE_QUARTER_FINAL_LABEL,
  "semi final": HOLOLIVE_SEMI_FINAL_LABEL,
  "semi finals": HOLOLIVE_SEMI_FINAL_LABEL,
  semifinal: HOLOLIVE_SEMI_FINAL_LABEL,
  semifinals: HOLOLIVE_SEMI_FINAL_LABEL
};

export function displayHololiveBracketRoundLabel(label: string): string {
  const normalized = label.trim().toLowerCase().replace(/\s+/g, " ");
  return SAVED_ROUND_LABEL_REPLACEMENTS[normalized] ?? label;
}

export function hololiveBracketRoundLabel(sizeCount: number, roundIndex: number): string {
  const entrants = sizeCount / 2 ** roundIndex;
  if (entrants === 2) {
    return "Final";
  }
  if (entrants === 4) {
    return HOLOLIVE_SEMI_FINAL_LABEL;
  }
  if (entrants === 8) {
    return HOLOLIVE_QUARTER_FINAL_LABEL;
  }
  return `Round of ${entrants}`;
}
