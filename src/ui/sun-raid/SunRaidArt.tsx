import type { CSSProperties } from 'react';
import { SOLAR_CRYSTALS, SOLAR_CRYSTAL_IDS, type SolarCrystalId } from '../../domain/sun-raid/config.ts';
import { CRYSTAL_ART, SUN_ART } from './sun-raid-assets.ts';
import './sun-raid-art.css';

/**
 * Sun raid art: generated crystals and Suns (src/ui/sun-raid/sun-raid-assets.ts),
 * procedural Gate ring and brightness meter.
 */

type CrystalGemProps = { id: SolarCrystalId; size?: number; owned?: boolean; locked?: boolean; title?: string };

/** One solar crystal. A missing crystal is its empty glass at 40% opacity. */
export function CrystalGem({ id, size = 40, owned = true, locked = false, title }: CrystalGemProps) {
  const crystal = SOLAR_CRYSTALS[id];
  return (
    <span
      className={`sr-gem ${owned ? 'is-owned' : 'is-missing'} ${locked ? 'is-locked' : ''}`}
      style={{ '--gem-color': crystal.color, '--gem-glow': crystal.glow, width: size, height: size * 1.3 } as CSSProperties}
      title={title ?? `${crystal.name}${owned ? '' : ' — не собран'}`}
      role="img"
      aria-label={`${crystal.name}: ${owned ? 'собран' : 'не собран'}`}
      data-qa-crystal={id}
      data-qa-crystal-owned={owned ? 'true' : 'false'}
    >
      <img src={owned ? CRYSTAL_ART[id].lit : CRYSTAL_ART[id].empty} alt="" draggable={false} decoding="async" />
    </span>
  );
}

/** The four crystals of a holder: collected ones glow, missing ones are sockets. */
export function CrystalSet({ owned, size = 34, locked = false }: { owned: readonly SolarCrystalId[]; size?: number; locked?: boolean }) {
  return (
    <span className="sr-gem-set" data-qa-crystal-set={owned.length}>
      {SOLAR_CRYSTAL_IDS.map((id) => <CrystalGem key={id} id={id} size={size} owned={owned.includes(id)} locked={locked} />)}
    </span>
  );
}

type SunOrbProps = { brightness: number; baseEfficiency: number; frozen?: boolean; size?: number; label?: string };

/** A star whose look follows its current efficiency: bright → scarred and dim → frozen in ice. */
export function SunOrb({ brightness, baseEfficiency, frozen = false, size = 220, label }: SunOrbProps) {
  const intensity = Math.max(0.2, Math.min(1, brightness / 100));
  const dimming = Math.max(0, Math.min(1, (baseEfficiency - brightness) / Math.max(1, baseEfficiency - 25)));
  return (
    <span
      className={`sr-sun ${frozen ? 'is-frozen' : ''}`}
      style={{ '--sun-size': `${size}px`, '--sun-intensity': intensity, '--sun-dim': dimming } as CSSProperties}
      role="img"
      aria-label={label ?? `Солнце: яркость ${brightness}%${frozen ? ', заморожено' : ''}`}
      data-qa-sun-orb={brightness}
    >
      <span className="sr-sun__halo" aria-hidden="true" />
      <img className="sr-sun__img" src={frozen ? SUN_ART.frozen : SUN_ART.dimmed} alt="" draggable={false} decoding="async" />
      {frozen ? null : <img className="sr-sun__img sr-sun__img--bright" src={SUN_ART.bright} alt="" draggable={false} decoding="async" />}
    </span>
  );
}

type GateArtProps = { crystals: readonly SolarCrystalId[]; progress?: number; status?: 'idle' | 'building' | 'completed' | 'destroyed'; size?: number };

/** Ring Gate with four crystal sockets; the vortex wakes up while building. */
export function GateArt({ crystals, progress = 0, status = 'idle', size = 240 }: GateArtProps) {
  const radius = 104;
  const circumference = 2 * Math.PI * radius;
  const sockets: Array<{ id: SolarCrystalId; x: number; y: number }> = [
    { id: 'crystal-1', x: 120, y: 18 },
    { id: 'crystal-2', x: 222, y: 120 },
    { id: 'crystal-3', x: 120, y: 222 },
    { id: 'crystal-4', x: 18, y: 120 },
  ];
  return (
    <span className={`sr-gate sr-gate--${status}`} style={{ '--gate-size': `${size}px` } as CSSProperties} data-qa-gate-art={status}>
      <svg viewBox="0 0 240 240" aria-hidden="true">
        <defs>
          <radialGradient id="sr-gate-vortex" cx="50%" cy="50%" r="50%">
            <stop offset="0" stopColor="#ffffff" stopOpacity=".95" />
            <stop offset=".25" stopColor="var(--race-accent)" stopOpacity=".8" />
            <stop offset=".7" stopColor="var(--race-accent-strong)" stopOpacity=".35" />
            <stop offset="1" stopColor="#05080c" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx="120" cy="120" r="118" className="sr-gate__plate" />
        <circle cx="120" cy="120" r={radius} className="sr-gate__ring" />
        <circle cx="120" cy="120" r={radius} className="sr-gate__ticks" />
        <circle
          cx="120" cy="120" r={radius}
          className="sr-gate__progress"
          strokeDasharray={`${(circumference * Math.max(0, Math.min(100, progress))) / 100} ${circumference}`}
          transform="rotate(-90 120 120)"
        />
        <g className="sr-gate__vortex">
          <circle cx="120" cy="120" r="78" fill="url(#sr-gate-vortex)" />
          <path d="M120 120 m-60 0 a60 60 0 1 1 60 60 a42 42 0 1 1 -42 -42 a26 26 0 1 1 26 26" fill="none" stroke="var(--race-accent)" strokeOpacity=".55" strokeWidth="2" />
          <path d="M120 120 m60 0 a60 60 0 1 1 -60 -60 a42 42 0 1 1 42 42" fill="none" stroke="#fff" strokeOpacity=".25" strokeWidth="1.4" />
        </g>
        {sockets.map((socket) => {
          const color = SOLAR_CRYSTALS[socket.id].color;
          const owned = crystals.includes(socket.id);
          return (
            <g key={socket.id} transform={`translate(${socket.x} ${socket.y})`} className={owned ? 'sr-gate__socket is-lit' : 'sr-gate__socket'}>
              <circle r="15" fill="#070b10" stroke={color} strokeOpacity={owned ? 0.95 : 0.35} strokeWidth="2" />
              <polygon points="0,-10 7,-3 5,7 0,11 -5,7 -7,-3" fill={owned ? color : 'none'} stroke={color} strokeOpacity={owned ? 1 : 0.5} strokeDasharray={owned ? undefined : '2 2'} />
            </g>
          );
        })}
      </svg>
    </span>
  );
}

export function SunBrightnessBar({ brightness, baseEfficiency }: { brightness: number; baseEfficiency: number }) {
  // Scale 25..100: the freeze line on the left, the Sun's own maximum marked.
  const toPercent = (value: number) => ((value - 25) / 75) * 100;
  const ticks = Array.from({ length: 16 }, (_, index) => 25 + index * 5);
  return (
    <div className="sr-bright" role="meter" aria-valuemin={25} aria-valuemax={baseEfficiency} aria-valuenow={brightness} aria-label={`Яркость ${brightness}% из ${baseEfficiency}%`}>
      <div className="sr-bright__track">
        <span className="sr-bright__cap" style={{ left: `${toPercent(baseEfficiency)}%` }} title={`Максимум этого Солнца: ${baseEfficiency}%`} />
        <span className="sr-bright__fill" style={{ width: `${Math.max(0, toPercent(brightness))}%` }} />
        {ticks.map((tick) => <i key={tick} className={tick <= brightness ? 'is-on' : ''} style={{ left: `${toPercent(tick)}%` }} />)}
      </div>
      <div className="sr-bright__scale"><span>25% · заморозка</span><span>{baseEfficiency}% · максимум</span><span>100%</span></div>
    </div>
  );
}
