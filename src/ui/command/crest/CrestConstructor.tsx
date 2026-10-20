import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';

import {
  CREST_COLORS,
  CREST_FIELDS,
  CREST_FRAMES,
  CREST_GLYPH_SCALE,
  CREST_GLYPHS,
  CREST_OFFSET_LIMIT,
  CREST_PATTERNS,
  CREST_ROTATION_LIMIT,
  clampCrestOffset,
  crestLabel,
  crestPatternLayout,
  defaultPatternOpacity,
  DEFAULT_ALLIANCE_CREST,
} from '../../../domain/command/crest.ts';
import { ORBITAL_CREST_CATALOG } from '../../../domain/command/orbital-crest-catalog.generated.ts';
import type { AllianceCrest } from '../../../domain/command/types.ts';
import { OrbitalCrest } from './OrbitalCrest';
import { crestSafeCircle, warmCrestModules } from './renderer';
import './crest-constructor.css';

type Tab = 'glyph' | 'frame' | 'field' | 'pattern' | 'layout';

const TABS: { id: Tab; label: string }[] = [
  { id: 'glyph', label: 'Знак' },
  { id: 'frame', label: 'Рамка' },
  { id: 'field', label: 'Эмаль' },
  { id: 'pattern', label: 'Узор' },
  { id: 'layout', label: 'Положение' },
];

const COLOR_HEX = Object.fromEntries(ORBITAL_CREST_CATALOG.colors.map((item) => [item.id, item.hex])) as Record<AllianceCrest['color'], string>;
const FIELD_HEX = Object.fromEntries(ORBITAL_CREST_CATALOG.fields.map((item) => [item.id, item.hex])) as Record<AllianceCrest['field'], string>;

/** Example directions from the package concept (CONCEPT.md, «Как выбирать сочетания»). */
const PRESETS: { name: string; crest: Partial<AllianceCrest> }[] = [
  { name: 'Феникс на аметисте', crest: { glyph: 'phoenix', color: 'violet', field: 'royal', frame: 'orbital', pattern: 'none' } },
  { name: 'Цитадель на синем щите', crest: { glyph: 'citadel', color: 'cyan', field: 'navy', frame: 'aegis', pattern: 'per-pale', patternOpacity: 0.24 } },
  { name: 'Навигатор на кармине', crest: { glyph: 'compass', color: 'silver', field: 'crimson', frame: 'diamond', pattern: 'rays', patternOpacity: 0.24 } },
  { name: 'Кузня на бронзе', crest: { glyph: 'anvil', color: 'amber', field: 'bronze', frame: 'octagon', pattern: 'chevron', patternOpacity: 0.24 } },
  { name: 'Нексус в созвездии', crest: { glyph: 'nexus', color: 'cyan', field: 'abyss', frame: 'orbital', pattern: 'constellation', patternOpacity: 0.6 } },
];

const TRANSFORM_DEFAULTS = { glyphScale: CREST_GLYPH_SCALE.default, rotation: 0, mirrorX: false, offsetX: 0, offsetY: 0 } as const;

function pickRandom<T>(list: readonly T[]): T {
  return list[Math.floor(Math.random() * list.length)];
}

function Tile({ selected, label, onSelect, children, qa, className = '' }: { selected: boolean; label: string; onSelect: () => void; children: ReactNode; qa?: string; className?: string }) {
  return (
    <button type="button" className={`crest-tile ${selected ? 'is-selected' : ''} ${className}`} aria-pressed={selected} title={label} onClick={onSelect} data-qa-crest-option={qa}>
      {children}
      <span>{label}</span>
    </button>
  );
}

function Slider({ label, value, min, max, step, format, onChange, qa }: { label: string; value: number; min: number; max: number; step: number; format: (value: number) => string; onChange: (value: number) => void; qa: string }) {
  const fill = ((value - min) / (max - min)) * 100;
  return (
    <label className="crest-slider">
      <span><b>{label}</b><output>{format(value)}</output></span>
      <input type="range" min={min} max={max} step={step} value={value} style={{ '--crest-fill': `${fill}%` } as CSSProperties} onChange={(event) => onChange(Number(event.target.value))} data-qa-crest-slider={qa} />
    </label>
  );
}

/** A 2D pad for the sign offset: the circle is the whole allowed 0.12R range. */
function OffsetPad({ x, y, onChange }: { x: number; y: number; onChange: (x: number, y: number) => void }) {
  const padRef = useRef<HTMLDivElement>(null);
  const place = (event: PointerEvent<HTMLDivElement>) => {
    const rect = padRef.current?.getBoundingClientRect();
    if (!rect) return;
    const nx = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const ny = ((event.clientY - rect.top) / rect.height) * 2 - 1;
    onChange(nx * CREST_OFFSET_LIMIT, ny * CREST_OFFSET_LIMIT);
  };
  return (
    <div
      ref={padRef}
      className="crest-pad"
      role="presentation"
      onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); place(event); }}
      onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) place(event); }}
      data-qa-crest-pad
    >
      <i style={{ left: `${50 + (x / CREST_OFFSET_LIMIT) * 50}%`, top: `${50 + (y / CREST_OFFSET_LIMIT) * 50}%` }} />
    </div>
  );
}

/**
 * «Конструктор герба»: a full-window visual editor of the Orbital Houses crest.
 * Left — the live crest (drag the sign to move it inside the safe circle), its
 * real 64/48/32 px renders and ready-made looks; right — one tab per module.
 */
export function CrestConstructor({ initial, onApply, onBack }: { initial: AllianceCrest; onApply: (crest: AllianceCrest) => void; onBack: () => void }) {
  const [crest, setCrest] = useState<AllianceCrest>(initial);
  const [tab, setTab] = useState<Tab>('glyph');
  const [showSafe, setShowSafe] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; offsetX: number; offsetY: number; radius: number } | null>(null);

  const set = (patch: Partial<AllianceCrest>) => setCrest((current) => ({ ...current, ...patch }));
  const setPattern = (pattern: AllianceCrest['pattern']) => set({ pattern, patternOpacity: defaultPatternOpacity(pattern) });
  const setOffset = (offsetX: number, offsetY: number) => set(clampCrestOffset(offsetX, offsetY));

  // Option tiles always show the sign upright and centred, so the choice reads
  // the same whatever size, rotation or offset the main crest has.
  const base = useMemo(() => ({ ...crest, ...TRANSFORM_DEFAULTS }), [crest]);
  // Variants shown in the active tab: decode only what this tab needs.
  const variants = useMemo(() => {
    switch (tab) {
      case 'glyph': return [...CREST_GLYPHS.map((glyph) => ({ ...base, glyph })), ...CREST_COLORS.map((color) => ({ ...base, color }))];
      case 'frame': return CREST_FRAMES.map((frame) => ({ ...base, frame }));
      case 'field': return CREST_FIELDS.map((field) => ({ ...base, field }));
      case 'pattern': return (['none', ...CREST_PATTERNS] as const).map((pattern) => ({ ...base, pattern, patternOpacity: defaultPatternOpacity(pattern) }));
      default: return [];
    }
  }, [tab, base]);
  useEffect(() => { warmCrestModules(variants); }, [variants]);

  const safe = crestSafeCircle(crest.frame);
  const startDrag = (event: PointerEvent<HTMLDivElement>) => {
    const stage = stageRef.current;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    drag.current = { x: event.clientX, y: event.clientY, offsetX: crest.offsetX, offsetY: crest.offsetY, radius: Math.min(rect.width, rect.height) * safe.radius };
    stage.setPointerCapture(event.pointerId);
  };
  const moveDrag = (event: PointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    if (!start || start.radius <= 0) return;
    setOffset(start.offsetX + (event.clientX - start.x) / start.radius, start.offsetY + (event.clientY - start.y) / start.radius);
  };
  const stageKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 0.03 : 0.01;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    setOffset(crest.offsetX + move[0], crest.offsetY + move[1]);
  };

  const randomize = () => {
    const pattern = Math.random() < 0.3 ? 'none' : pickRandom(CREST_PATTERNS);
    setCrest({ ...DEFAULT_ALLIANCE_CREST, frame: pickRandom(CREST_FRAMES), field: pickRandom(CREST_FIELDS), glyph: pickRandom(CREST_GLYPHS), color: pickRandom(CREST_COLORS), pattern, patternOpacity: defaultPatternOpacity(pattern) });
  };

  const transformed = crest.glyphScale !== CREST_GLYPH_SCALE.default || crest.rotation !== 0 || crest.mirrorX || crest.offsetX !== 0 || crest.offsetY !== 0;
  const percent = (value: number) => `${Math.round(value * 100)}%`;

  return (
    <div className="crest-constructor" style={{ '--crest-color': COLOR_HEX[crest.color] } as CSSProperties} data-qa-crest-constructor>
      <aside className="crest-stage-panel">
        <div
          ref={stageRef}
          className={`crest-stage ${showSafe ? 'shows-safe' : ''}`}
          tabIndex={0}
          role="group"
          aria-label="Герб: перетащите знак или используйте стрелки, чтобы сместить его"
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={() => { drag.current = null; }}
          onPointerCancel={() => { drag.current = null; }}
          onKeyDown={stageKeys}
          data-qa-crest-stage
        >
          <OrbitalCrest crest={crest} label={`${crestLabel('glyphs', crest.glyph)} — ${crestLabel('frames', crest.frame)}`} />
          {showSafe ? (
            <svg className="crest-safe" viewBox="0 0 1 1" aria-hidden="true">
              <circle cx={safe.x} cy={safe.y} r={safe.radius} />
              <circle className="crest-safe-offset" cx={safe.x} cy={safe.y} r={safe.radius * CREST_OFFSET_LIMIT} />
            </svg>
          ) : null}
        </div>
        <div className="crest-stage-tools">
          <button type="button" className={showSafe ? 'is-on' : ''} aria-pressed={showSafe} onClick={() => setShowSafe((value) => !value)}>Зона знака</button>
          <button type="button" onClick={randomize} data-qa-crest-random>Случайный</button>
          <button type="button" onClick={() => setCrest(initial)} data-qa-crest-reset>Сбросить</button>
        </div>
        <div className="crest-sizes" aria-label="Фактические размеры">
          {[64, 48, 32].map((size) => (
            <figure key={size}><OrbitalCrest crest={crest} size={size} /><figcaption>{size} px</figcaption></figure>
          ))}
        </div>
        <div className="crest-presets">
          <small>ГОТОВЫЕ ОБРАЗЫ</small>
          <div>
            {PRESETS.map((preset) => {
              const presetCrest = { ...DEFAULT_ALLIANCE_CREST, ...preset.crest };
              return (
                <button key={preset.name} type="button" title={preset.name} aria-label={`Образ: ${preset.name}`} onClick={() => setCrest(presetCrest)} data-qa-crest-preset>
                  <OrbitalCrest crest={presetCrest} size={46} />
                </button>
              );
            })}
          </div>
        </div>
      </aside>

      <section className="crest-workbench">
        <div className="crest-tabs" role="tablist" aria-label="Модули герба">
          {TABS.map((item) => (
            <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} className={tab === item.id ? 'is-active' : ''} onClick={() => setTab(item.id)} data-qa-crest-tab={item.id}>
              {item.label}
              <small>{item.id === 'glyph' ? `${crestLabel('glyphs', crest.glyph)} · ${crestLabel('colors', crest.color)}`
                : item.id === 'frame' ? crestLabel('frames', crest.frame)
                  : item.id === 'field' ? crestLabel('fields', crest.field)
                    : item.id === 'pattern' ? crestLabel('patterns', crest.pattern)
                      : transformed ? 'Изменено' : 'По центру'}</small>
            </button>
          ))}
        </div>

        <div className="crest-panel" role="tabpanel">
          {tab === 'glyph' ? (
            <>
              <h5>Главная фигура <small>12 знаков</small></h5>
              <div className="crest-grid crest-grid--glyphs">
                {CREST_GLYPHS.map((glyph) => (
                  <Tile key={glyph} selected={crest.glyph === glyph} label={crestLabel('glyphs', glyph)} onSelect={() => set({ glyph })} qa={`glyph-${glyph}`}>
                    <OrbitalCrest crest={{ ...base, glyph }} />
                  </Tile>
                ))}
              </div>
              <h5>Цвет эмали знака</h5>
              <div className="crest-grid crest-grid--colors">
                {CREST_COLORS.map((color) => (
                  <Tile key={color} selected={crest.color === color} label={crestLabel('colors', color)} onSelect={() => set({ color })} qa={`color-${color}`} className="crest-tile--color">
                    <OrbitalCrest crest={{ ...base, color }} />
                    <i style={{ background: COLOR_HEX[color] }} aria-hidden="true" />
                  </Tile>
                ))}
              </div>
            </>
          ) : null}

          {tab === 'frame' ? (
            <>
              <h5>Силуэт обрамления <small>Металлическая рамка лежит поверх всех слоёв</small></h5>
              <div className="crest-grid crest-grid--large">
                {CREST_FRAMES.map((frame) => (
                  <Tile key={frame} selected={crest.frame === frame} label={crestLabel('frames', frame)} onSelect={() => set({ frame })} qa={`frame-${frame}`}>
                    <OrbitalCrest crest={{ ...base, frame }} />
                  </Tile>
                ))}
              </div>
            </>
          ) : null}

          {tab === 'field' ? (
            <>
              <h5>Эмаль поля <small>Тёмная основа, на которой читается знак</small></h5>
              <div className="crest-grid crest-grid--large">
                {CREST_FIELDS.map((field) => (
                  <Tile key={field} selected={crest.field === field} label={crestLabel('fields', field)} onSelect={() => set({ field })} qa={`field-${field}`} className="crest-tile--color">
                    <OrbitalCrest crest={{ ...base, field }} />
                    <i style={{ background: FIELD_HEX[field] }} aria-hidden="true" />
                  </Tile>
                ))}
              </div>
            </>
          ) : null}

          {tab === 'pattern' ? (
            <>
              <h5>Узор поля <small>Структура второго плана под знаком</small></h5>
              <div className="crest-grid crest-grid--patterns">
                {(['none', ...CREST_PATTERNS] as const).map((pattern) => (
                  <Tile key={pattern} selected={crest.pattern === pattern} label={crestLabel('patterns', pattern)} onSelect={() => setPattern(pattern)} qa={`pattern-${pattern}`}>
                    <OrbitalCrest crest={{ ...base, pattern, patternOpacity: defaultPatternOpacity(pattern) }} />
                  </Tile>
                ))}
              </div>
              <div className="crest-controls">
                {crest.pattern === 'none' ? <p className="crest-hint">Выберите узор, чтобы настроить его яркость.</p> : (
                  <Slider label={`Яркость узора${crestPatternLayout(crest.pattern) === 'halo' ? ' (созвездие)' : ''}`} value={crest.patternOpacity} min={0} max={1} step={0.02} format={percent} onChange={(patternOpacity) => set({ patternOpacity })} qa="pattern-opacity" />
                )}
              </div>
            </>
          ) : null}

          {tab === 'layout' ? (
            <>
              <h5>Положение знака <small>Знак не выходит за безопасную зону ни при каких настройках</small></h5>
              <div className="crest-layout">
                <div className="crest-controls">
                  <Slider label="Размер" value={crest.glyphScale} min={CREST_GLYPH_SCALE.min} max={CREST_GLYPH_SCALE.max} step={0.01} format={percent} onChange={(glyphScale) => set({ glyphScale })} qa="scale" />
                  <Slider label="Поворот" value={crest.rotation} min={-CREST_ROTATION_LIMIT} max={CREST_ROTATION_LIMIT} step={1} format={(value) => `${value}°`} onChange={(rotation) => set({ rotation })} qa="rotation" />
                  <div className="crest-chips" aria-label="Быстрый поворот">
                    {[-90, -45, 0, 45, 90, 180].map((angle) => (
                      <button key={angle} type="button" className={crest.rotation === angle ? 'is-on' : ''} onClick={() => set({ rotation: angle })}>{angle}°</button>
                    ))}
                  </div>
                  <Slider label="Смещение по горизонтали" value={crest.offsetX} min={-CREST_OFFSET_LIMIT} max={CREST_OFFSET_LIMIT} step={0.005} format={percent} onChange={(offsetX) => setOffset(offsetX, crest.offsetY)} qa="offset-x" />
                  <Slider label="Смещение по вертикали" value={crest.offsetY} min={-CREST_OFFSET_LIMIT} max={CREST_OFFSET_LIMIT} step={0.005} format={percent} onChange={(offsetY) => setOffset(crest.offsetX, offsetY)} qa="offset-y" />
                </div>
                <div className="crest-layout-side">
                  <button type="button" className={`crest-toggle ${crest.mirrorX ? 'is-on' : ''}`} aria-pressed={crest.mirrorX} onClick={() => set({ mirrorX: !crest.mirrorX })} data-qa-crest-mirror>
                    <span aria-hidden="true">⇋</span>Отразить знак
                  </button>
                  <button type="button" className="crest-toggle" onClick={() => set(TRANSFORM_DEFAULTS)} disabled={!transformed}>
                    <span aria-hidden="true">◎</span>Вернуть в центр
                  </button>
                  <OffsetPad x={crest.offsetX} y={crest.offsetY} onChange={setOffset} />
                  <p className="crest-hint">Ведите точку в круге или перетащите знак прямо на гербе слева. Стрелки сдвигают знак, с Shift — крупнее.</p>
                </div>
              </div>
            </>
          ) : null}
        </div>

        <div className="crest-footer">
          <p>{crestLabel('glyphs', crest.glyph)} · {crestLabel('colors', crest.color)} · {crestLabel('frames', crest.frame)} · {crestLabel('fields', crest.field)} · {crestLabel('patterns', crest.pattern)}</p>
          <button type="button" onClick={onBack} data-qa-crest-back>НАЗАД</button>
          <button type="button" className="primary" onClick={() => onApply(crest)} data-qa-crest-apply>ПРИМЕНИТЬ ГЕРБ</button>
        </div>
      </section>
    </div>
  );
}
