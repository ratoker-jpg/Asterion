import type { CSSProperties } from 'react';

import { MAX_FLIGHT_SPEED_PERCENT, MIN_FLIGHT_SPEED_PERCENT } from '../../domain/flights/speed.ts';
import { AmountSlider } from '../AmountSlider.tsx';
import './flight-speed.css';

/**
 * «Скорость полёта»: 100% by default, down to 10% in 1% steps. Lower speed,
 * longer flight. `flown` is the speed the fleet will really fly at when the
 * wave order slows it below the chosen one (shown next to the choice).
 * `duration` is the flight time at that speed, already formatted.
 */
export function FlightSpeedControl({ value, onChange, flown, duration, label = 'Скорость полёта', qa, compact = false }: {
  value: number;
  onChange: (value: number) => void;
  flown?: number;
  duration?: string | null;
  label?: string;
  qa?: string;
  compact?: boolean;
}) {
  const slowed = flown !== undefined && flown < value;
  const fill = ((value - MIN_FLIGHT_SPEED_PERCENT) / (MAX_FLIGHT_SPEED_PERCENT - MIN_FLIGHT_SPEED_PERCENT)) * 100;
  return (
    <div className={`flight-speed${compact ? ' flight-speed--compact' : ''}${value < MAX_FLIGHT_SPEED_PERCENT || slowed ? ' is-slow' : ''}`}
      style={{ '--flight-speed-fill': `${fill}%` } as CSSProperties} data-qa-flight-speed={qa ?? ''} data-qa-flight-speed-value={flown ?? value}>
      <small>{label}</small>
      <AmountSlider compact value={value} min={MIN_FLIGHT_SPEED_PERCENT} max={MAX_FLIGHT_SPEED_PERCENT} onChange={onChange} label={label} />
      <b className="flight-speed__value" key={slowed ? `w${flown}` : `c${value}`}>
        {slowed ? <><s>{value}%</s> {flown}%</> : `${value}%`}
      </b>
      {duration ? <span className="flight-speed__time">{slowed ? 'с учётом волн · ' : ''}{duration}</span> : null}
    </div>
  );
}
