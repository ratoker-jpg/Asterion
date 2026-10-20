import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import {
  CAMPAIGN_SPEED_LABELS,
  WORLD_DENSITY_RULES,
  WORLD_LIMITS,
  createDefaultNewGameConfig,
  getWorldNpcCapacity,
  validateNewGameConfig,
  type NewGameConfig,
  type WorldDensity,
} from '../../domain/world/config.ts';
import { generateWorld, summarizeWorld } from '../../domain/world/generator.ts';
import { createCampaignSeed } from '../../domain/world/random.ts';
import type { CampaignSpeed } from '../../domain/runtime/mode.ts';
import type { PlayerFactionId } from '../../domain/profile/types.ts';
import type { SaveSlotMeta } from '../../domain/session/slots.ts';
import { createInitialSaveState } from '../../application/persistence.ts';
import { createSlot } from '../../application/slots.ts';
import { RACE_CARDS, raceCard, type RaceCard } from './race-catalog.ts';

type Step = 'race' | 'world' | 'confirm';
const STEPS: ReadonlyArray<{ id: Step; label: string }> = [
  { id: 'race', label: 'Раса' },
  { id: 'world', label: 'Мир' },
  { id: 'confirm', label: 'Подтверждение' },
];

const DEFAULT_CAMPAIGN_NAME: Record<PlayerFactionId, string> = { aegis: 'Кампания Астеров', synod: 'Кампания Иларов', veyra: 'Кампания Роя' };

type WizardProps = {
  onBack: () => void;
  onThemeChange: (factionId: PlayerFactionId) => void;
  onCreated: (slot: SaveSlotMeta) => void;
};

export function NewGameWizard({ onBack, onThemeChange, onCreated }: WizardProps) {
  const [step, setStep] = useState<Step>('race');
  const [config, setConfig] = useState<NewGameConfig>(() => createDefaultNewGameConfig({ campaignName: DEFAULT_CAMPAIGN_NAME.aegis }));
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const issues = useMemo(() => validateNewGameConfig(config), [config]);

  useEffect(() => { onThemeChange(config.factionId); }, [config.factionId, onThemeChange]);

  const chooseRace = (factionId: PlayerFactionId) => setConfig((current) => ({
    ...current,
    factionId,
    // Keep a name the player typed; only the untouched default follows the race.
    campaignName: current.campaignName === DEFAULT_CAMPAIGN_NAME[current.factionId] ? DEFAULT_CAMPAIGN_NAME[factionId] : current.campaignName,
  }));
  const patchWorld = (patch: Partial<NewGameConfig['world']>) => setConfig((current) => ({ ...current, world: { ...current.world, ...patch } }));

  const goBack = () => {
    if (step === 'race') onBack();
    else setStep(step === 'confirm' ? 'world' : 'race');
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || document.querySelector('.menu-modal')) return;
      event.preventDefault();
      goBack();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const start = () => {
    if (issues.length || starting) return;
    setStarting(true);
    const now = Date.now();
    const state = createInitialSaveState('production', now, config);
    const created = createSlot(state, config.campaignName, { now });
    if (!created.ok || !created.slot) {
      setError(created.ok ? 'Не удалось создать слот.' : created.error);
      setStarting(false);
      return;
    }
    onCreated(created.slot);
  };

  const stepIndex = STEPS.findIndex((item) => item.id === step);
  return (
    <main className="menu-screen menu-wizard" data-qa-wizard-step={step}>
      <header className="menu-screen-head">
        <button type="button" className="menu-back" onClick={goBack} data-qa-menu-back><span aria-hidden="true">←</span>{step === 'race' ? 'МЕНЮ' : 'НАЗАД'}</button>
        <div className="menu-screen-head__title"><small>КАМПАНИЯ · ШАГ {stepIndex + 1} ИЗ 3</small><h1>НОВАЯ ИГРА</h1></div>
        <ol className="menu-stepper" aria-label="Шаги">
          {STEPS.map((item, position) => (
            <li key={item.id} className={position < stepIndex ? 'is-done' : position === stepIndex ? 'is-current' : ''} aria-current={position === stepIndex ? 'step' : undefined}>
              <span>{position + 1}</span>{item.label}
            </li>
          ))}
        </ol>
      </header>

      {step === 'race' ? (
        <RaceStep selected={config.factionId} onSelect={chooseRace} onNext={() => setStep('world')} />
      ) : step === 'world' ? (
        <WorldStep config={config} issues={issues} onChange={setConfig} onWorld={patchWorld} onNext={() => setStep('confirm')} />
      ) : (
        <ConfirmStep config={config} error={error} starting={starting} disabledReason={issues[0]?.message ?? null} onStart={start} onEdit={setStep} />
      )}
    </main>
  );
}

/* ----------------------------------------------------------------- race */

function RaceStep({ selected, onSelect, onNext }: { selected: PlayerFactionId; onSelect: (id: PlayerFactionId) => void; onNext: () => void }) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const [hovered, setHovered] = useState<PlayerFactionId | null>(null);
  useEffect(() => { refs.current[RACE_CARDS.findIndex((card) => card.id === selected)]?.focus(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const onKey = (event: ReactKeyboardEvent<HTMLButtonElement>, position: number) => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      const next = (position + (event.key === 'ArrowRight' ? 1 : -1) + RACE_CARDS.length) % RACE_CARDS.length;
      onSelect(RACE_CARDS[next]!.id);
      refs.current[next]?.focus();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (RACE_CARDS[position]!.id === selected) onNext();
      else onSelect(RACE_CARDS[position]!.id);
    }
  };

  return (
    <section className="menu-race-step">
      <div className="menu-races" role="radiogroup" aria-label="Выбор расы" data-hovered={hovered ?? undefined}>
        {RACE_CARDS.map((card, position) => (
          <RaceColumn
            key={card.id}
            card={card}
            selected={card.id === selected}
            dimmed={hovered !== null && hovered !== card.id}
            buttonRef={(element) => { refs.current[position] = element; }}
            onSelect={() => onSelect(card.id)}
            onHover={(value) => setHovered(value ? card.id : null)}
            onKeyDown={(event) => onKey(event, position)}
          />
        ))}
      </div>
      <footer className="menu-actionbar">
        <p><b>{raceCard(selected).name}</b> · {raceCard(selected).tagline}</p>
        <button type="button" className="menu-btn menu-btn--primary menu-btn--large" onClick={onNext} data-qa-wizard-next>ДАЛЕЕ: НАСТРОЙКИ МИРА</button>
      </footer>
    </section>
  );
}

type RaceColumnProps = {
  card: RaceCard;
  selected: boolean;
  dimmed: boolean;
  buttonRef: (element: HTMLButtonElement | null) => void;
  onSelect: () => void;
  onHover: (value: boolean) => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) => void;
};

function RaceColumn({ card, selected, dimmed, buttonRef, onSelect, onHover, onKeyDown }: RaceColumnProps) {
  return (
    <button
      ref={buttonRef}
      type="button"
      role="radio"
      aria-checked={selected}
      className={`menu-race ${selected ? 'is-selected' : ''} ${dimmed ? 'is-dimmed' : ''}`}
      data-faction={card.id}
      style={{ '--card-accent': card.accent } as CSSProperties}
      onClick={onSelect}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      onFocus={() => onHover(false)}
      onKeyDown={onKeyDown}
      data-qa-race={card.id}
      aria-label={`${card.name}: ${card.tagline}`}
    >
      <img className="menu-race__bg" src={card.background} alt="" draggable={false} />
      <span className="menu-race__vignette" aria-hidden="true" />
      <img className="menu-race__general" src={card.general} alt="" draggable={false} />
      <span className="menu-race__badge" aria-hidden="true">{selected ? 'ВЫБРАНО' : 'ВЫБРАТЬ'}</span>
      <span className="menu-race__info">
        <span className="menu-race__title">
          <img src={card.emblem} alt="" draggable={false} />
          <span><b>{card.name}</b><small>{card.people}</small></span>
        </span>
        <span className="menu-race__tagline">{card.tagline}</span>
        <span className="menu-race__traits">
          {card.traits.map((trait) => <span key={trait}><i aria-hidden="true" />{trait}</span>)}
        </span>
        <span className="menu-race__ability"><small>СПОСОБНОСТЬ РАСЫ</small><b>{card.ability.name}</b><span>{card.ability.text}</span></span>
        <span className="menu-race__roster" aria-label="Стартовый флот">
          {card.roster.map((ship) => (
            <span key={ship.id} title={`${ship.name}: ${ship.count}`}>
              {ship.art ? <img src={ship.art} alt="" draggable={false} /> : null}
              <b>{ship.count}</b>
            </span>
          ))}
        </span>
      </span>
    </button>
  );
}

/* ---------------------------------------------------------------- world */

type WorldStepProps = {
  config: NewGameConfig;
  issues: ReturnType<typeof validateNewGameConfig>;
  onChange: (updater: (current: NewGameConfig) => NewGameConfig) => void;
  onWorld: (patch: Partial<NewGameConfig['world']>) => void;
  onNext: () => void;
};

function Segmented<T extends string | number>({ value, options, onChange, label }: { value: T; options: ReadonlyArray<{ value: T; label: string; hint?: string }>; onChange: (value: T) => void; label: string }) {
  return (
    <div className="menu-seg" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button key={String(option.value)} type="button" role="radio" aria-checked={value === option.value} className={value === option.value ? 'is-on' : ''} title={option.hint} onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

function RangeField({ label, value, min, max, step = 1, onChange, suffix, qa }: { label: string; value: number; min: number; max: number; step?: number; onChange: (value: number) => void; suffix?: string; qa: string }) {
  const percent = ((value - min) / Math.max(1, max - min)) * 100;
  return (
    <label className="menu-range">
      <span className="menu-range__head"><small>{label}</small><b>{value}{suffix ? ` ${suffix}` : ''}</b></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} style={{ '--range-p': `${percent}%` } as CSSProperties} data-qa-world={qa} />
      <span className="menu-range__scale"><span>{min}</span><span>{max}</span></span>
    </label>
  );
}

function WorldStep({ config, issues, onChange, onWorld, onNext }: WorldStepProps) {
  const summary = summarizeWorld(config);
  const issueFor = (field: string) => issues.find((issue) => issue.field === field)?.message;
  const capacity = getWorldNpcCapacity(config.world);
  return (
    <section className="menu-world-step">
      <div className="menu-panel menu-world-form">
        <h2>Командир и кампания</h2>
        <div className="menu-field-row">
          <label className="menu-field">
            <small>ИМЯ КОМАНДИРА</small>
            <input value={config.playerName} maxLength={WORLD_LIMITS.playerNameMax} onChange={(event) => onChange((current) => ({ ...current, playerName: event.target.value }))} aria-invalid={Boolean(issueFor('playerName'))} data-qa-world="player-name" />
            {issueFor('playerName') ? <em>{issueFor('playerName')}</em> : null}
          </label>
          <label className="menu-field">
            <small>НАЗВАНИЕ КАМПАНИИ</small>
            <input value={config.campaignName} maxLength={WORLD_LIMITS.campaignNameMax} onChange={(event) => onChange((current) => ({ ...current, campaignName: event.target.value }))} aria-invalid={Boolean(issueFor('campaignName'))} data-qa-world="campaign-name" />
            {issueFor('campaignName') ? <em>{issueFor('campaignName')}</em> : null}
          </label>
        </div>

        <h2>Вселенная</h2>
        <RangeField label="ГАЛАКТИКИ" value={config.world.galaxyCount} min={WORLD_LIMITS.galaxyMin} max={WORLD_LIMITS.galaxyMax} onChange={(value) => onWorld({ galaxyCount: value })} suffix={`× ${WORLD_LIMITS.systemsPerGalaxy} систем`} qa="galaxies" />
        <RangeField label="NPC-ВЛАДЕЛЬЦЫ" value={config.world.npcCount} min={WORLD_LIMITS.npcMin} max={WORLD_LIMITS.npcMax} onChange={(value) => onWorld({ npcCount: value })} suffix={`из ${capacity} мест`} qa="npc" />
        {issueFor('npcCount') ? <p className="menu-inline-error" role="alert">{issueFor('npcCount')}</p> : null}
        <div className="menu-field-row">
          <div className="menu-field">
            <small>NPC НА СИСТЕМУ</small>
            <Segmented label="NPC на систему" value={config.world.maxNpcPerSystem} onChange={(value) => onWorld({ maxNpcPerSystem: value })}
              options={[{ value: 1 as const, label: '1' }, { value: 2 as const, label: '2' }, { value: 3 as const, label: '3' }]} />
          </div>
          <div className="menu-field">
            <small>ПЛОТНОСТЬ</small>
            <Segmented<WorldDensity> label="Плотность" value={config.world.density} onChange={(value) => onWorld({ density: value })}
              options={(Object.keys(WORLD_DENSITY_RULES) as WorldDensity[]).map((value) => ({ value, label: WORLD_DENSITY_RULES[value].label, hint: WORLD_DENSITY_RULES[value].hint }))} />
          </div>
        </div>
        <div className="menu-field">
          <small>СКОРОСТЬ ПАРТИИ · ФИКСИРУЕТСЯ НА СТАРТЕ</small>
          <Segmented<CampaignSpeed> label="Скорость партии" value={config.world.campaignSpeed} onChange={(value) => onWorld({ campaignSpeed: value })}
            options={(Object.keys(CAMPAIGN_SPEED_LABELS) as CampaignSpeed[]).map((value) => ({ value, label: `${CAMPAIGN_SPEED_LABELS[value].label} ${value === 'slow' ? '×0.5' : value === 'fast' ? '×2' : '×1'}`, hint: CAMPAIGN_SPEED_LABELS[value].hint }))} />
          <em className="menu-field__hint">{CAMPAIGN_SPEED_LABELS[config.world.campaignSpeed].hint}</em>
        </div>
        <div className="menu-field-row">
          <label className="menu-field">
            <small>СИД МИРА</small>
            <span className="menu-seed">
              <input value={config.seed} maxLength={16} onChange={(event) => onChange((current) => ({ ...current, seed: event.target.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase() }))} aria-invalid={Boolean(issueFor('seed'))} data-qa-world="seed" />
              <button type="button" className="menu-btn menu-btn--small" onClick={() => onChange((current) => ({ ...current, seed: createCampaignSeed() }))} title="Новый случайный сид">↻</button>
            </span>
            {issueFor('seed') ? <em>{issueFor('seed')}</em> : null}
          </label>
          <label className="menu-toggle">
            <input type="checkbox" checked={config.world.randomPlayerStart} onChange={(event) => onWorld({ randomPlayerStart: event.target.checked })} />
            <span aria-hidden="true" />
            <span><b>Случайный старт</b><small>Система и позиция по сиду</small></span>
          </label>
        </div>
      </div>

      <div className="menu-panel menu-world-preview">
        <header><small>АТЛАС · ПРЕДПРОСМОТР ПО СИДУ</small><h2>{config.seed || '—'}</h2></header>
        <WorldAtlas config={config} />
        <dl className="menu-world-summary">
          <div><dt>Систем</dt><dd>{summary.systems}</dd></div>
          <div><dt>Солнц для рейдов</dt><dd>{summary.suns}</dd></div>
          <div><dt>Позиций планет</dt><dd>{summary.planetSlots.toLocaleString('ru-RU')}</dd></div>
          <div><dt>NPC</dt><dd>{summary.npcCount}</dd></div>
          <div><dt>Заполненность NPC</dt><dd>{summary.occupancyPercent}%</dd></div>
        </dl>
        <p className="menu-world-note">NPC — заглушки: одна планета, без флотов и атак. Видны на карте и доступны для шпионажа.</p>
      </div>

      <footer className="menu-actionbar">
        <p>{issues.length ? <span className="menu-inline-error">{issues[0]!.message}</span> : 'Мир готов. Одинаковый сид всегда создаёт одинаковую вселенную.'}</p>
        <button type="button" className="menu-btn menu-btn--primary menu-btn--large" disabled={issues.length > 0} onClick={onNext} title={issues[0]?.message} data-qa-wizard-next>ДАЛЕЕ: ПОДТВЕРЖДЕНИЕ</button>
      </footer>
    </section>
  );
}

const RACE_DOT: Record<PlayerFactionId, string> = { aegis: '#5f9bff', synod: '#3fdc86', veyra: '#ff5468' };

/** Procedural atlas: each galaxy is a spiral of 40 systems; NPC stubs and the start are drawn from the real generator. */
function WorldAtlas({ config }: { config: NewGameConfig }) {
  const world = useMemo(() => generateWorld(config, 0), [config.seed, config.world.galaxyCount, config.world.npcCount, config.world.maxNpcPerSystem, config.world.density, config.world.randomPlayerStart]); // eslint-disable-line react-hooks/exhaustive-deps
  const count = config.world.galaxyCount;
  const columns = count <= 1 ? 1 : count <= 4 ? 2 : count <= 6 ? 3 : 5;
  const rows = Math.ceil(count / columns);
  const cell = Math.min(820 / columns, 470 / rows);
  const systemPoint = (system: number) => {
    const t = (system - 1) / 39;
    const angle = t * Math.PI * 4.2;
    const radius = 0.08 + t * 0.4;
    return { x: 0.5 + Math.cos(angle) * radius, y: 0.5 + Math.sin(angle) * radius * 0.82 };
  };
  const npcBySystem = new Map<string, PlayerFactionId[]>();
  for (const planet of world.npcPlanets) {
    const key = `${planet.coordinate.galaxy}:${planet.coordinate.system}`;
    npcBySystem.set(key, [...(npcBySystem.get(key) ?? []), planet.raceId as PlayerFactionId]);
  }
  return (
    <svg className="menu-atlas" viewBox={`0 0 ${columns * cell} ${rows * cell}`} role="img" aria-label={`Атлас: ${count} галактик, ${world.npcPlanets.length} NPC`} data-qa-world-atlas>
      {Array.from({ length: count }, (_, index) => {
        const galaxy = index + 1;
        const ox = (index % columns) * cell;
        const oy = Math.floor(index / columns) * cell;
        return (
          <g key={galaxy} transform={`translate(${ox} ${oy})`}>
            <circle cx={cell / 2} cy={cell / 2} r={cell * 0.46} className="menu-atlas__disc" />
            <text x={cell / 2} y={cell * 0.97} className="menu-atlas__label" textAnchor="middle">ГАЛАКТИКА {String(galaxy).padStart(2, '0')}</text>
            {Array.from({ length: 40 }, (_, systemIndex) => {
              const system = systemIndex + 1;
              const point = systemPoint(system);
              const npcs = npcBySystem.get(`${galaxy}:${system}`) ?? [];
              const isStart = world.playerStart.galaxy === galaxy && world.playerStart.system === system;
              return (
                <g key={system}>
                  <circle cx={point.x * cell} cy={point.y * cell} r={Math.max(1.4, cell * 0.009)} className="menu-atlas__star" />
                  {npcs.map((race, position) => (
                    <circle key={position} cx={point.x * cell + (position - (npcs.length - 1) / 2) * cell * 0.022} cy={point.y * cell - cell * 0.02} r={Math.max(2, cell * 0.012)} fill={RACE_DOT[race]} className="menu-atlas__npc" />
                  ))}
                  {isStart ? (
                    <g className="menu-atlas__start" transform={`translate(${point.x * cell} ${point.y * cell})`}>
                      <circle r={Math.max(6, cell * 0.035)} />
                      <circle r={Math.max(3, cell * 0.016)} className="menu-atlas__start-core" />
                    </g>
                  ) : null}
                </g>
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}

/* -------------------------------------------------------------- confirm */

function ConfirmStep({ config, error, starting, disabledReason, onStart, onEdit }: { config: NewGameConfig; error: string | null; starting: boolean; disabledReason: string | null; onStart: () => void; onEdit: (step: Step) => void }) {
  const card = raceCard(config.factionId);
  const summary = summarizeWorld(config);
  const startRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { startRef.current?.focus(); }, []);
  return (
    <section className="menu-confirm-step">
      <article className="menu-confirm-hero" data-faction={card.id}>
        <img className="menu-confirm-hero__bg" src={card.background} alt="" draggable={false} />
        <img className="menu-confirm-hero__ship" src={card.flagship} alt="" draggable={false} />
        <img className="menu-confirm-hero__general" src={card.general} alt="" draggable={false} />
        <div className="menu-confirm-hero__copy">
          <small>ВАША СТОРОНА</small>
          <h2>{card.name}</h2>
          <p>{card.people} · {card.tagline}</p>
        </div>
      </article>
      <div className="menu-panel menu-confirm-summary">
        <small>СВОДКА КАМПАНИИ</small>
        <h2>{config.campaignName}</h2>
        <dl>
          <div><dt>Командир</dt><dd>{config.playerName}</dd><button type="button" onClick={() => onEdit('world')}>изменить</button></div>
          <div><dt>Раса</dt><dd>{card.name}</dd><button type="button" onClick={() => onEdit('race')}>изменить</button></div>
          <div><dt>Мир</dt><dd>{config.world.galaxyCount} гал. · {summary.systems} систем · {summary.npcCount} NPC</dd><button type="button" onClick={() => onEdit('world')}>изменить</button></div>
          <div><dt>Расселение NPC</dt><dd>{WORLD_DENSITY_RULES[config.world.density].label} · до {config.world.maxNpcPerSystem} на систему</dd></div>
          <div><dt>Скорость</dt><dd>{CAMPAIGN_SPEED_LABELS[config.world.campaignSpeed].label}</dd></div>
          <div><dt>Старт</dt><dd>{config.world.randomPlayerStart ? 'Случайная система по сиду' : 'Галактика 1 · система 1'}</dd></div>
          <div><dt>Сид</dt><dd className="menu-mono">{config.seed}</dd></div>
        </dl>
        <section className="menu-confirm-roster">
          <small>СТАРТОВЫЙ ФЛОТ · {card.name.toUpperCase()}</small>
          <div>
            {card.roster.map((ship) => (
              <span key={ship.id} title={ship.name}>
                {ship.art ? <img src={ship.art} alt="" draggable={false} /> : null}
                <b>{ship.count}</b>
                <em>{ship.name}</em>
              </span>
            ))}
          </div>
        </section>
        <section className="menu-goal">
          <small>ЦЕЛЬ КАМПАНИИ</small>
          <ol>
            <li>Постройте «Палату управления» и создайте союз в «Командовании».</li>
            <li>Водите командные рейды на Солнца из «Операций»: победа — шанс 70% на кристалл.</li>
            <li>Соберите 4 разных кристалла и достройте Звёздные Врата в военной зоне — это победа.</li>
          </ol>
        </section>
        {error ? <p className="menu-inline-error" role="alert">{error}</p> : null}
        <button ref={startRef} type="button" className="menu-btn menu-btn--primary menu-btn--start" disabled={Boolean(disabledReason) || starting} title={disabledReason ?? undefined} onClick={onStart} data-qa-wizard-start>
          {starting ? 'СОЗДАНИЕ МИРА…' : 'НАЧАТЬ ИГРУ'}
        </button>
      </div>
    </section>
  );
}
