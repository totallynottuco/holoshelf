import { useState } from "react";
import { convertBracketPopularity } from "../../shared/bracketPopularity";
import type { HololiveBracketPopularity } from "../../shared/contracts";

interface Props {
  value: HololiveBracketPopularity | undefined;
  poolCount: number | undefined;
  disabled: boolean;
  onChange: (value: HololiveBracketPopularity | undefined) => void;
}

export function HololiveBracketPopularityControl({ value, poolCount, disabled, onChange }: Props) {
  const [numberDraft, setNumberDraft] = useState<string | null>(null);
  const percent = value?.unit !== "songs";
  const min = percent ? 0.01 : 1;
  const max = percent ? 100 : Math.max(1, poolCount ?? value?.amount ?? 1);
  const step = percent ? 0.01 : 1;
  const amount = Math.min(value?.amount ?? 25, max);
  const cutoffDisabled = disabled || (!percent && !poolCount);

  function updateAmount(next: number) {
    if (!value || !Number.isFinite(next)) return;
    const bounded = Math.min(max, Math.max(min, next));
    const normalized = percent ? Math.round(bounded * 100) / 100 : Math.round(bounded);
    if (normalized !== value.amount) onChange({ ...value, amount: normalized });
  }

  return (
    <div className="lobby-popularity">
      <div className="lobby-popularity-head">
        <select aria-label="Popularity" value={value?.direction ?? ""} disabled={disabled}
          onChange={event => {
            const direction = event.target.value;
            onChange(direction === "most" || direction === "least"
              ? { unit: "percent", amount: 25, ...value, direction }
              : undefined);
          }}>
          <option value="">Any</option>
          <option value="most">Most viewed</option>
          <option value="least">Least viewed</option>
        </select>
        {value && <div className="lobby-segments lobby-popularity-units" role="group" aria-label="Popularity unit">
          <button type="button" aria-label="Percentage" aria-pressed={percent} disabled={disabled || poolCount === undefined}
            onClick={() => onChange(convertBracketPopularity(value, "percent", poolCount ?? 0))}>%</button>
          <button type="button" aria-pressed={!percent} disabled={disabled || poolCount === undefined}
            onClick={() => onChange(convertBracketPopularity(value, "songs", poolCount ?? 0))}>Songs</button>
        </div>}
      </div>
      {value && <div className="lobby-popularity-cutoff">
        <input type="range" aria-label="Popularity cutoff" aria-valuetext={`${amount}${percent ? "%" : " songs"}`}
          min={min} max={max} step={step} value={amount} disabled={cutoffDisabled} onChange={event => updateAmount(event.target.valueAsNumber)} />
        <input type="number" aria-label="Popularity amount" min={min} max={max} step={step}
          value={numberDraft ?? amount} disabled={cutoffDisabled}
          onChange={event => {
            setNumberDraft(event.target.value);
            updateAmount(event.target.valueAsNumber);
          }}
          onBlur={() => setNumberDraft(null)} />
      </div>}
    </div>
  );
}
