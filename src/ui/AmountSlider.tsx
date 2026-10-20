import type { CSSProperties } from 'react';

import './amount-slider.css';

const number = new Intl.NumberFormat('ru-RU');

/**
 * Amount picker in the style of the Command aid requests: МИН · − · slider · + · МАКС
 * with the scale (min · value · max) underneath. `compact` drops the scale and the
 * text buttons for tight tiles.
 */
export function AmountSlider({ value, min = 0, max, step = 1, onChange, label, compact = false, qa }: {
  value: number;
  min?: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  label: string;
  compact?: boolean;
  qa?: string;
}) {
  const safeMax = Math.max(min, max);
  const clamped = Math.min(safeMax, Math.max(min, value));
  const fill = safeMax > min ? ((clamped - min) / (safeMax - min)) * 100 : 0;
  const set = (next: number) => onChange(Math.min(safeMax, Math.max(min, Math.round(next))));
  const nudge = Math.max(step, Math.round((safeMax - min) / 100));
  const disabled = safeMax <= min;
  return (
    <div className={`amount-slider${compact ? ' amount-slider--compact' : ''}`} data-qa-amount-slider={qa}>
      {compact ? null : <button type="button" onClick={() => set(min)} disabled={disabled || clamped === min}>МИН.</button>}
      <button type="button" aria-label={`Уменьшить: ${label}`} onClick={() => set(clamped - nudge)} disabled={disabled || clamped <= min}>−</button>
      <input
        type="range"
        min={min}
        max={safeMax}
        step={step}
        value={clamped}
        disabled={disabled}
        aria-label={label}
        style={{ '--amount-fill': `${fill}%` } as CSSProperties}
        onChange={(event) => set(Number(event.target.value))}
      />
      <button type="button" aria-label={`Увеличить: ${label}`} onClick={() => set(clamped + nudge)} disabled={disabled || clamped >= safeMax}>+</button>
      {compact ? null : <button type="button" onClick={() => set(safeMax)} disabled={disabled || clamped === safeMax}>МАКС.</button>}
      {compact ? null : <div className="amount-slider__scale"><span>{number.format(min)}</span><b>{number.format(clamped)}</b><span>{number.format(safeMax)}</span></div>}
    </div>
  );
}
