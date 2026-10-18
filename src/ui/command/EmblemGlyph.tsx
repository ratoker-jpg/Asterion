import { useId, type CSSProperties, type ReactNode } from 'react';

import type {
  AllianceAccent,
  AllianceEmblem,
  AllianceEmblemField,
  AllianceEmblemFieldColor,
  AllianceEmblemGlyph,
  AllianceEmblemShape,
} from '../../domain/command/types.ts';
import { OrbitalCrest } from './crest/OrbitalCrest';

export const ACCENT_COLORS: Record<AllianceAccent, string> = {
  cyan: '#56d9f2',
  amber: '#e6ad50',
  violet: '#a98cff',
  crimson: '#ff5f6f',
  emerald: '#35e58a',
  silver: '#d6e2ea',
};

export const ACCENT_LABELS: Record<AllianceAccent, string> = {
  cyan: 'Голубой',
  amber: 'Янтарный',
  violet: 'Фиолетовый',
  crimson: 'Алый',
  emerald: 'Изумрудный',
  silver: 'Серебряный',
};

export const FIELD_COLORS: Record<AllianceEmblemFieldColor, string> = {
  abyss: '#0b2431',
  navy: '#13325e',
  crimson: '#4d1322',
  forest: '#123f2b',
  royal: '#2f1b55',
  bronze: '#4d3413',
};

export const FIELD_COLOR_LABELS: Record<AllianceEmblemFieldColor, string> = {
  abyss: 'Бездна', navy: 'Ночное небо', crimson: 'Багрянец', forest: 'Хвоя', royal: 'Пурпур', bronze: 'Бронза',
};

export const SHAPE_LABELS: Record<AllianceEmblemShape, string> = { shield: 'Щит', round: 'Круг', hex: 'Грань', banner: 'Флаг' };
export const FIELD_LABELS: Record<AllianceEmblemField, string> = { solid: 'Гладь', split: 'Надвое', chevron: 'Шеврон', rays: 'Лучи', stars: 'Звёзды' };
export const GLYPH_LABELS: Record<AllianceEmblemGlyph, string> = {
  starforge: 'Звезда', orbit: 'Орбита', vanguard: 'Авангард', crown: 'Корона', wings: 'Крылья', planet: 'Планета', blades: 'Клинки', comet: 'Комета',
};

const SHAPE_PATHS: Record<AllianceEmblemShape, string> = {
  shield: 'M40 4 70 16v29c0 22-12 36-30 47C22 81 10 67 10 45V16L40 4Z',
  round: 'M40 14a34 34 0 1 1 0 68a34 34 0 1 1 0-68Z',
  hex: 'M40 6 72 24v44L40 90 8 68V24Z',
  banner: 'M12 6h56v76L40 66 12 82Z',
};

function Glyph({ glyph }: { glyph: AllianceEmblemGlyph }): ReactNode {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.55, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (glyph) {
    case 'starforge':
      return <g><path {...common} d="m40 22 7 14 16 2-12 11 3 16-14-8-14 8 3-16-12-11 16-2 7-14Z" /><circle {...common} cx="40" cy="45" r="8" /></g>;
    case 'orbit':
      return <g><circle {...common} cx="40" cy="45" r="10" /><ellipse {...common} cx="40" cy="45" rx="25" ry="11" transform="rotate(24 40 45)" /><ellipse {...common} cx="40" cy="45" rx="25" ry="11" transform="rotate(-32 40 45)" /></g>;
    case 'vanguard':
      return <g><path {...common} d="m40 18 10 23-10 9-10-9 10-23Z" /><path {...common} d="M18 58 40 46l22 12M23 68l17-10 17 10" /></g>;
    case 'crown':
      return <g><path {...common} d="M23 58h34l3-24-11 9-9-15-9 15-11-9 3 24Z" /><path {...common} d="M23 64h34" /><circle {...common} cx="40" cy="50" r="3" /></g>;
    case 'wings':
      return <g><path {...common} d="M40 32v32" /><path {...common} d="M40 44c-7-11-17-13-25-10 4 9 13 15 25 15" /><path {...common} d="M40 44c7-11 17-13 25-10-4 9-13 15-25 15" /><path {...common} d="M40 54c-5 2-9 6-11 10M40 54c5 2 9 6 11 10" /></g>;
    case 'planet':
      return <g><circle {...common} cx="40" cy="46" r="12" /><ellipse {...common} cx="40" cy="46" rx="25" ry="7" transform="rotate(-18 40 46)" /><circle cx="58" cy="30" r="2" fill="currentColor" /></g>;
    case 'blades':
      return <g><path {...common} d="M27 28l26 34M53 28 27 62" /><path {...common} d="M22 33l9-9M58 33l-9-9M29 58l-5 7M51 58l5 7" /></g>;
    case 'comet':
      return <g><circle {...common} cx="49" cy="38" r="7" /><path {...common} d="M44 43 21 66M47 46 31 66M42 41 19 55" /></g>;
    default:
      return null;
  }
}

function Field({ field, accent }: { field: AllianceEmblemField; accent: string }): ReactNode {
  switch (field) {
    case 'split':
      return <rect x="40" y="0" width="40" height="96" fill={accent} opacity=".2" />;
    case 'chevron':
      return <path d="M0 64 40 40l40 24v16L40 56 0 80Z" fill={accent} opacity=".28" />;
    case 'rays':
      return <g fill={accent} opacity=".16">{[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => <path key={angle} d="M40 46 34 -10h12Z" transform={`rotate(${angle} 40 46)`} />)}</g>;
    case 'stars':
      return <g fill={accent} opacity=".55">{[[18, 24], [62, 22], [16, 62], [64, 64], [40, 82], [28, 40], [54, 44]].map(([x, y]) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.6" />)}</g>;
    default:
      return null;
  }
}

/**
 * Alliance coat of arms. An Orbital Houses crest wins when present; otherwise
 * the legacy SVG renders, and an emblem without constructor parts looks exactly
 * like the original PR 1 shield (Rating, Universe and Reports depend on it).
 */
export function EmblemGlyph({ emblem, compact = false }: { emblem: AllianceEmblem; compact?: boolean }) {
  const clipId = useId();
  const accent = ACCENT_COLORS[emblem.accent] ?? ACCENT_COLORS.cyan;
  const style = { '--command-emblem': accent } as CSSProperties;
  const constructed = Boolean(emblem.shape || emblem.field || emblem.fieldColor);
  const shapePath = SHAPE_PATHS[emblem.shape ?? 'shield'];
  if (emblem.crest) {
    return (
      <span className={`command-emblem command-emblem--crest ${compact ? 'command-emblem--compact' : ''}`} style={{ '--command-emblem': ACCENT_COLORS[emblem.crest.color] ?? accent } as CSSProperties}>
        <OrbitalCrest crest={emblem.crest} />
      </span>
    );
  }
  return (
    <span className={`command-emblem command-emblem--${emblem.glyph} ${compact ? 'command-emblem--compact' : ''}`} style={style}>
      <svg viewBox="0 0 80 96" aria-hidden="true">
        {constructed ? (
          <>
            <defs><clipPath id={clipId}><path d={shapePath} /></clipPath></defs>
            <g clipPath={`url(#${clipId})`}>
              <rect width="80" height="96" fill={FIELD_COLORS[emblem.fieldColor ?? 'abyss']} />
              <Field field={emblem.field ?? 'solid'} accent={accent} />
            </g>
            <path d={shapePath} fill="none" stroke="currentColor" strokeWidth="1.6" />
          </>
        ) : (
          <path className="command-emblem-shield" d={shapePath} />
        )}
        <Glyph glyph={emblem.glyph} />
      </svg>
    </span>
  );
}

/** Small shape-only preview for the constructor's shape buttons. */
export function ShapeSwatch({ shape, accent, fieldColor }: { shape: AllianceEmblemShape; accent: string; fieldColor: string }) {
  return <svg viewBox="0 0 80 96" aria-hidden="true" className="cmdA-swatch-svg"><path d={SHAPE_PATHS[shape]} fill={fieldColor} stroke={accent} strokeWidth="3" /></svg>;
}

/** Small field-pattern preview for the constructor's field buttons. */
export function FieldSwatch({ field, accent, fieldColor }: { field: AllianceEmblemField; accent: string; fieldColor: string }) {
  const clipId = useId();
  return (
    <svg viewBox="0 0 80 96" aria-hidden="true" className="cmdA-swatch-svg">
      <defs><clipPath id={clipId}><rect x="6" y="6" width="68" height="84" rx="14" /></clipPath></defs>
      <g clipPath={`url(#${clipId})`}><rect width="80" height="96" fill={fieldColor} /><Field field={field} accent={accent} /></g>
      <rect x="6" y="6" width="68" height="84" rx="14" fill="none" stroke={accent} strokeOpacity=".6" strokeWidth="2" />
    </svg>
  );
}
