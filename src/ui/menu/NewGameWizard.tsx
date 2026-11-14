import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import {
  CAMPAIGN_SPEED_LABELS,
  NPC_ACTIVITY_LABELS,
  npcActivityOf,
  maxNpcForSpeed,
  WORLD_DENSITY_RULES,
  WORLD_LIMITS,
  createDefaultNewGameConfig,
  DEFAULT_NPC_FACTION_MIX,
  setNpcFactionShare,
  getWorldNpcCapacity,
  validateNewGameConfig,
  type NewGameConfig,
  type WorldDensity,
} from '../../domain/world/config.ts';
import { generateWorld, summarizeWorld } from '../../domain/world/generator.ts';
import { createCampaignSeed } from '../../domain/world/random.ts';
import { CAMPAIGN_SPEED_SCALE, type CampaignSpeed } from '../../domain/runtime/mode.ts';
import type { PlayerFactionId } from '../../domain/profile/types.ts';
import type { SaveSlotMeta } from '../../domain/session/slots.ts';
import { createInitialSaveState } from '../../application/persistence.ts';
import { createSlot, retireSaveSlot } from '../../application/slots.ts';
import { NPC_ACTIVITY_LEVELS, type NpcActivityLevel } from '../../domain/npc/calendar.ts';
import { bindNewCampaignToSeries } from '../../application/npc-series.ts';
import { readPersonaRegistry, writePersonaRegistry } from '../../application/persona-store.ts';
import { findSeries, latestSeries, type PersonaRegistry, type PersonaSeries } from '../../domain/npc/persona-registry.ts';
import { AmountSlider } from '../AmountSlider.tsx';
import type { SeriesRoundRequest } from './session.ts';
import { RACE_CARDS, raceCard, type RaceCard } from './race-catalog.ts';
import { ATLAS_GALAXIES } from '../ui-art.ts';
import './wizard.css';

/*
 * «Новая игра» (old-screens redo, 14.11.2026): the «Настройки» scheme. A rail of
 * four steps on the left (each shows the current choice and an error mark), one
 * panel on the right with a one-line explanation and a single primary action.
 * «Сводка» is the only place «Начать игру» lives. Every option of the old wizard
 * stays; the campaign rules (speed, NPC activity) moved next to the names, where
 * the player decides how the campaign plays, the world shape stays with the atlas.
 */

type Step = 'race' | 'campaign' | 'world' | 'confirm';
const STEPS: ReadonlyArray<{ id: Step; label: string; next: string }> = [
  { id: 'race', label: 'Раса', next: 'Далее: кампания' },
  { id: 'campaign', label: 'Кампания', next: 'Далее: мир' },
  { id: 'world', label: 'Мир', next: 'Далее: сводка' },
  { id: 'confirm', label: 'Сводка', next: 'Начать игру' },
];

/** Which step holds the field an issue points at. */
const ISSUE_STEP: Record<string, Step> = { playerName: 'campaign', campaignName: 'campaign', seed: 'world', npcCount: 'world', galaxyCount: 'world' };

const DEFAULT_CAMPAIGN_NAME: Record<PlayerFactionId, string> = { aegis: 'Кампания Астеров', synod: 'Кампания Иларов', veyra: 'Кампания Роя' };

type WizardProps = {
  onBack: () => void;
  onThemeChange: (factionId: PlayerFactionId) => void;
  onCreated: (slot: SaveSlotMeta) => void;
  /** Came here by «Новый раунд»: the same commander and world settings, a new map. */
  seriesRound?: SeriesRoundRequest | null;
};

/** What the «continue the series» switch can offer right now. */
type SeriesOffer =
  | { kind: 'ready'; registry: PersonaRegistry; series: PersonaSeries }
  | { kind: 'none'; reason: string };

function readSeriesOffer(seriesId: string | null | undefined): SeriesOffer {
  const read = readPersonaRegistry();
  if (read.status === 'unavailable') return { kind: 'none', reason: 'Недоступно в браузере: опыт серии хранится только на ПК, в настольной версии игры.' };
  if (read.status === 'unreadable') return { kind: 'none', reason: `Недоступно: ${read.message} Файл не изменён.` };
  const series = (seriesId ? findSeries(read.registry, seriesId) : null) ?? latestSeries(read.registry);
  return series ? { kind: 'ready', registry: read.registry, series } : { kind: 'none', reason: 'Серии пока нет: она появится, когда в кампании будут достроены Врата.' };
}

function roundCampaignName(name: string, round: number): string {
  const ending = ` · раунд ${round}`;
  return `${name.replace(/ · раунд \d+$/, '').slice(0, WORLD_LIMITS.campaignNameMax - ending.length).trim()}${ending}`;
}

function initialConfig(seriesRound: SeriesRoundRequest | null | undefined, offer: SeriesOffer): NewGameConfig {
  const fresh = createDefaultNewGameConfig({ campaignName: DEFAULT_CAMPAIGN_NAME.aegis });
  if (!seriesRound) return fresh;
  // A new seed, so a new map; everything the player chose stays until they change it.
  const previous = seriesRound.config;
  return {
    ...previous,
    seed: fresh.seed,
    campaignName: offer.kind === 'ready' && offer.series.seriesId === seriesRound.seriesId ? roundCampaignName(previous.campaignName, offer.series.rounds + 1) : previous.campaignName,
  };
}

const number = new Intl.NumberFormat('ru-RU');

export function NewGameWizard({ onBack, onThemeChange, onCreated, seriesRound = null }: WizardProps) {
  const [step, setStep] = useState<Step>('race');
  const [offer] = useState<SeriesOffer>(() => readSeriesOffer(seriesRound?.seriesId));
  const [config, setConfig] = useState<NewGameConfig>(() => initialConfig(seriesRound, offer));
  // Off unless the player came by «Новый раунд»: a plain new game is a clean population.
  const [continueSeries, setContinueSeries] = useState(() => Boolean(seriesRound?.seriesId) && offer.kind === 'ready' && offer.series.seriesId === seriesRound?.seriesId);
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
  // «Супербыстрая» ×5 holds at most 75 NPC: a larger count drops to it (the wizard says why).
  const patchWorld = (patch: Partial<NewGameConfig['world']>) => setConfig((current) => {
    const world = { ...current.world, ...patch };
    return { ...current, world: { ...world, npcCount: Math.min(world.npcCount, maxNpcForSpeed(world.campaignSpeed)) } };
  });

  const stepIndex = STEPS.findIndex((item) => item.id === step);
  const issuesOf = (id: Step) => issues.filter((issue) => (ISSUE_STEP[issue.field] ?? 'world') === id);
  const stepIssues = issuesOf(step);
  const goBack = () => {
    if (stepIndex === 0) onBack();
    else setStep(STEPS[stepIndex - 1]!.id);
  };
  const goNext = () => {
    if (stepIssues.length) return;
    setStep(STEPS[Math.min(STEPS.length - 1, stepIndex + 1)]!.id);
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
    let state = createInitialSaveState('production', now, config);
    if (continueSeries && offer.kind === 'ready') {
      // The world starts only once the registry knows who plays in it.
      const bound = bindNewCampaignToSeries(offer.registry, offer.series.seriesId, state, now);
      const written = bound ? writePersonaRegistry(bound.registry) : { ok: false as const, error: 'Серия не найдена.' };
      if (!bound || !written.ok) {
        setError(`Не удалось продолжить серию: ${written.ok ? 'реестр недоступен.' : written.error}`);
        setStarting(false);
        return;
      }
      state = bound.state;
    }
    const created = createSlot(state, config.campaignName, { now });
    if (!created.ok || !created.slot) {
      setError(created.ok ? 'Не удалось создать слот.' : created.error);
      setStarting(false);
      return;
    }
    // One live campaign: the round just finished moves to «Прошлые раунды».
    if (seriesRound?.fromSlotId && seriesRound.fromSlotId !== created.slot.id) retireSaveSlot(seriesRound.fromSlotId);
    onCreated(created.slot);
  };

  const card = raceCard(config.factionId);
  const summary = summarizeWorld(config);
  const seriesLine = continueSeries && offer.kind === 'ready'
    ? `Серия продолжается · раунд ${offer.series.rounds + 1} · ${offer.series.personas.length} личностей с их опытом`
    : 'Новые личности, без чужого опыта';
  const railValue: Record<Step, string> = {
    race: `${card.name} · ${card.people}`,
    campaign: `${config.playerName || 'без имени'} · ${CAMPAIGN_SPEED_LABELS[config.world.campaignSpeed].label} ×${CAMPAIGN_SPEED_SCALE[config.world.campaignSpeed]}`,
    world: `${config.world.galaxyCount} гал. · ${summary.npcCount} NPC · сид ${config.seed || '—'}`,
    confirm: issues.length ? `Исправьте: ${issues.length}` : 'Всё готово к старту',
  };

  const head: Record<Step, { title: string; text: string }> = {
    race: { title: 'Выберите расу', text: 'Раса задаёт корабли, стартовый флот и особую способность. Её нельзя сменить в этой кампании.' },
    campaign: { title: 'Командир и правила партии', text: 'Имя видят другие игроки. Скорость и активность NPC фиксируются на старте и не меняются до конца кампании.' },
    world: { title: 'Вселенная', text: 'Размер галактики и соседи. Один и тот же сид всегда создаёт одну и ту же карту.' },
    confirm: { title: 'Сводка перед стартом', text: 'Проверьте выбор. Любой пункт можно поменять: нажмите «Изменить» или шаг слева.' },
  };

  const primary = step === 'confirm' ? (
    <button type="button" className="menu-btn menu-btn--primary menu-btn--large wz-primary" disabled={issues.length > 0 || starting} onClick={start} data-qa-wizard-start data-qa-primary-action>
      {starting ? 'Создание мира…' : 'Начать игру'}
    </button>
  ) : (
    <button type="button" className="menu-btn menu-btn--primary menu-btn--large wz-primary" disabled={stepIssues.length > 0} onClick={goNext} data-qa-wizard-next data-qa-primary-action>
      {STEPS[stepIndex]!.next}
    </button>
  );
  const footNote = step === 'confirm'
    ? (error ?? (issues.length ? issues[0]!.message : 'Мир создаётся за несколько секунд. Потом откроется ваша первая планета.'))
    : (stepIssues.length ? stepIssues[0]!.message : step === 'race' ? `Выбрано: ${card.name}. ${head.race.text}` : step === 'campaign' ? 'Имя и название можно поменять позже в «Загрузить игру».' : 'Мир готов. Одинаковый сид всегда создаёт одинаковую вселенную.');
  const footIsError = step === 'confirm' ? Boolean(error || issues.length) : stepIssues.length > 0;

  return (
    <main className="menu-screen menu-wizard wz" data-qa-wizard-step={step}>
      <header className="menu-screen-head wz-head">
        <button type="button" className="menu-back" onClick={goBack} data-qa-menu-back><span aria-hidden="true">←</span>{stepIndex === 0 ? 'Меню' : 'Назад'}</button>
        <div className="menu-screen-head__title"><small>Шаг {stepIndex + 1} из {STEPS.length}</small><h1>Новая игра</h1></div>
      </header>

      <div className="wz-body">
        <aside className="wz-rail" aria-label="Шаги новой игры">
          <ol className="wz-steps">
            {STEPS.map((item, position) => {
              const bad = item.id !== 'confirm' && issuesOf(item.id).length > 0;
              const state = item.id === step ? 'current' : position < stepIndex ? 'done' : 'next';
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    className={`wz-step is-${state}${bad ? ' is-bad' : ''}`}
                    aria-current={item.id === step ? 'step' : undefined}
                    onClick={() => setStep(item.id)}
                    data-qa-wizard-rail={item.id}
                  >
                    <span className="wz-step__num" aria-hidden="true">{bad ? '!' : position < stepIndex ? '✓' : position + 1}</span>
                    <span className="wz-step__copy">
                      <b>{item.label}</b>
                      <small>{railValue[item.id]}</small>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
          <div className="wz-rail__race" data-faction={card.id}>
            <img src={card.emblem} alt="" draggable={false} />
            <span><small>Ваша сторона</small><b>{card.name}</b></span>
          </div>
          <p className="wz-rail__note">Все настройки можно менять в любом порядке. Игра начнётся только из «Сводки».</p>
        </aside>

        <section className={`wz-panel wz-panel--${step}`} key={step} aria-label={head[step].title}>
          {/* «Раса»: the cards are the heading (A/B round 01: the portraits need the height); the line moves to the foot. */}
          {step === 'race' ? null : (
            <header className="wz-panel__head">
              <h2>{head[step].title}</h2>
              <p>{head[step].text}</p>
            </header>
          )}
          <div className="wz-panel__body" data-qa-scroll="wizard">
            {step === 'race' ? (
              <RaceStep selected={config.factionId} onSelect={chooseRace} onNext={goNext} />
            ) : step === 'campaign' ? (
              <CampaignStep config={config} issues={issues} onChange={setConfig} onWorld={patchWorld}
                series={<SeriesToggle offer={offer} checked={continueSeries} onChange={setContinueSeries} />} />
            ) : step === 'world' ? (
              <WorldStep config={config} issues={issues} onChange={setConfig} onWorld={patchWorld} />
            ) : (
              <ConfirmStep config={config} onEdit={setStep} seriesLine={seriesLine} />
            )}
          </div>
          <footer className="wz-foot">
            <p className={footIsError ? 'is-error' : ''} role={footIsError ? 'alert' : undefined}>{footNote}</p>
            {primary}
          </footer>
        </section>
      </div>
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
      <span className="menu-race__badge" aria-hidden="true">{selected ? 'Выбрано' : 'Выбрать'}</span>
      <span className="menu-race__info">
        <span className="menu-race__title">
          <img src={card.emblem} alt="" draggable={false} />
          <span><b>{card.name}</b><small>{card.people}</small></span>
        </span>
        <span className="menu-race__tagline">{card.tagline}</span>
        <span className="menu-race__traits">
          {card.traits.map((trait) => <span key={trait}><i aria-hidden="true" />{trait}</span>)}
        </span>
        <span className="menu-race__ability"><small>Способность расы</small><b>{card.ability.name}</b><span>{card.ability.text}</span></span>
        <span className="menu-race__roster" aria-label={`Стартовый флот: ${card.roster.map((ship) => `${ship.name} ${ship.count}`).join(', ')}`}>
          {card.roster.map((ship) => (
            <span key={ship.id}>
              {ship.art ? <img src={ship.art} alt="" draggable={false} /> : null}
              <b>{ship.count}</b>
            </span>
          ))}
        </span>
      </span>
    </button>
  );
}

/* --------------------------------------------------------------- series */

function SeriesToggle({ offer, checked, onChange }: { offer: SeriesOffer; checked: boolean; onChange: (value: boolean) => void }) {
  const ready = offer.kind === 'ready';
  return (
    <label className={`menu-toggle menu-series-toggle wz-tile ${ready ? '' : 'is-off'}`} data-qa-series={ready ? 'ready' : 'none'}>
      <input type="checkbox" checked={checked} disabled={!ready} onChange={(event) => onChange(event.target.checked)} data-qa-series-toggle />
      <span aria-hidden="true" />
      <span>
        <b>Продолжить серию</b>
        <small data-qa-series-note>{ready
          ? `Раунд ${offer.series.rounds + 1}: те же ${offer.series.personas.length} личностей NPC помнят опыт и отношения под новыми никами. Мир, флот, ресурсы и разведка — новые.`
          : offer.reason}</small>
      </span>
    </label>
  );
}

/* ------------------------------------------------------------- controls */

type Issues = ReturnType<typeof validateNewGameConfig>;
type ConfigUpdater = (updater: (current: NewGameConfig) => NewGameConfig) => void;
type WorldPatcher = (patch: Partial<NewGameConfig['world']>) => void;

/** Visible choices with their explanation under each one: no hover tooltips. */
function ChoiceCards<T extends string | number>({ value, options, onChange, label, qa, hintQa, columns }: {
  value: T;
  options: ReadonlyArray<{ value: T; label: string; badge?: string; hint: string }>;
  onChange: (value: T) => void;
  label: string;
  qa?: string;
  /** data-qa-world name put on the chosen option's explanation (QA reads the current hint). */
  hintQa?: string;
  columns?: number;
}) {
  return (
    <div className="wz-choices" role="radiogroup" aria-label={label} data-qa-world={qa} style={{ '--wz-cols': columns ?? options.length } as CSSProperties}>
      {options.map((option) => (
        <button key={String(option.value)} type="button" role="radio" aria-checked={value === option.value} className={`wz-choice${value === option.value ? ' is-on' : ''}`} onClick={() => onChange(option.value)}>
          <span className="wz-choice__top"><b>{option.label}</b>{option.badge ? <em>{option.badge}</em> : null}</span>
          <small data-qa-world={value === option.value ? hintQa : undefined}>{option.hint}</small>
        </button>
      ))}
    </div>
  );
}

function Segmented<T extends string | number>({ value, options, onChange, label }: { value: T; options: ReadonlyArray<{ value: T; label: string }>; onChange: (value: T) => void; label: string }) {
  return (
    <div className="menu-seg" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button key={String(option.value)} type="button" role="radio" aria-checked={value === option.value} className={value === option.value ? 'is-on' : ''} onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

function Field({ label, hint, error, children, wide = false }: { label: string; hint?: ReactNode; error?: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={`wz-field${wide ? ' wz-field--wide' : ''}`}>
      <span className="wz-field__label">{label}</span>
      {children}
      {error ? <em className="wz-field__error" role="alert">{error}</em> : hint ? <span className="wz-field__hint">{hint}</span> : null}
    </div>
  );
}

/* ------------------------------------------------------------- campaign */

function CampaignStep({ config, issues, onChange, onWorld, series }: { config: NewGameConfig; issues: Issues; onChange: ConfigUpdater; onWorld: WorldPatcher; series: ReactNode }) {
  const issueFor = (field: string) => issues.find((issue) => issue.field === field)?.message;
  return (
    <div className="wz-grid wz-grid--campaign">
      <section className="wz-group">
        <h3>Командир и кампания</h3>
        <Field label="Имя командира" hint={`${config.playerName.length} из ${WORLD_LIMITS.playerNameMax} символов · его видят другие игроки`} error={issueFor('playerName')}>
          <input className="wz-input" value={config.playerName} maxLength={WORLD_LIMITS.playerNameMax} onChange={(event) => onChange((current) => ({ ...current, playerName: event.target.value }))} aria-invalid={Boolean(issueFor('playerName'))} aria-label="Имя командира" data-qa-world="player-name" />
        </Field>
        <Field label="Название кампании" hint={`${config.campaignName.length} из ${WORLD_LIMITS.campaignNameMax} символов · так слот называется в сохранениях`} error={issueFor('campaignName')}>
          <input className="wz-input" value={config.campaignName} maxLength={WORLD_LIMITS.campaignNameMax} onChange={(event) => onChange((current) => ({ ...current, campaignName: event.target.value }))} aria-invalid={Boolean(issueFor('campaignName'))} aria-label="Название кампании" data-qa-world="campaign-name" />
        </Field>
        {series}
      </section>
      <section className="wz-group">
        <h3>Правила партии <span className="wz-lock">фиксируются на старте</span></h3>
        <Field label="Скорость партии" hint="Во сколько раз быстрее идут стройка, исследования и полёты.">
          <ChoiceCards<CampaignSpeed> label="Скорость партии" columns={2} value={config.world.campaignSpeed} onChange={(value) => onWorld({ campaignSpeed: value })} qa="speed"
            options={(Object.keys(CAMPAIGN_SPEED_LABELS) as CampaignSpeed[]).map((value) => ({ value, label: CAMPAIGN_SPEED_LABELS[value].label, badge: `×${CAMPAIGN_SPEED_SCALE[value]}`, hint: CAMPAIGN_SPEED_LABELS[value].hint }))} />
        </Field>
        <Field label="Активность NPC" hint="Как часто соседи-боты бывают в игре.">
          <ChoiceCards<NpcActivityLevel> label="Активность NPC" columns={1} value={npcActivityOf(config)} onChange={(value) => onWorld({ npcActivity: value })} qa="npc-activity" hintQa="npc-activity-hint"
            options={NPC_ACTIVITY_LEVELS.map((value) => ({ value, label: NPC_ACTIVITY_LABELS[value].label, hint: NPC_ACTIVITY_LABELS[value].hint }))} />
        </Field>
      </section>
    </div>
  );
}

/* ---------------------------------------------------------------- world */

function WorldStep({ config, issues, onChange, onWorld }: { config: NewGameConfig; issues: Issues; onChange: ConfigUpdater; onWorld: WorldPatcher }) {
  const summary = summarizeWorld(config);
  const issueFor = (field: string) => issues.find((issue) => issue.field === field)?.message;
  const capacity = getWorldNpcCapacity(config.world);
  const npcMax = maxNpcForSpeed(config.world.campaignSpeed);
  return (
    <div className="wz-grid wz-grid--world">
      <section className="wz-group wz-group--scroll">
        <h3>Размер и соседи</h3>
        <Field label={`Галактики · по ${WORLD_LIMITS.systemsPerGalaxy} систем в каждой`} hint={`${config.world.galaxyCount} гал. = ${number.format(summary.systems)} систем`}>
          <div data-qa-world="galaxies">
            <AmountSlider value={config.world.galaxyCount} min={WORLD_LIMITS.galaxyMin} max={WORLD_LIMITS.galaxyMax} label="Галактики" onChange={(value) => onWorld({ galaxyCount: value })} qa="world-galaxies" />
          </div>
        </Field>
        <Field label="NPC-владельцы" error={issueFor('npcCount')}
          hint={config.world.campaignSpeed === 'superfast'
            ? <span data-qa-world="superfast-npc-cap">При скорости «Супербыстрая» ×5 — не больше {WORLD_LIMITS.superfastNpcMax} NPC: так мир ×5 укладывается в память и нагрузку сервера.</span>
            : `${config.world.npcCount} из ${capacity} мест в этом мире`}>
          <div data-qa-world="npc">
            <AmountSlider value={config.world.npcCount} min={WORLD_LIMITS.npcMin} max={npcMax} label="NPC-владельцы" onChange={(value) => onWorld({ npcCount: value })} qa="world-npc" />
          </div>
        </Field>
        <div className="wz-pair">
          <Field label="NPC на систему" hint="Сколько NPC может жить в одной системе.">
            <Segmented label="NPC на систему" value={config.world.maxNpcPerSystem} onChange={(value) => onWorld({ maxNpcPerSystem: value })}
              options={[{ value: 1 as const, label: '1' }, { value: 2 as const, label: '2' }, { value: 3 as const, label: '3' }]} />
          </Field>
          <Field label="Плотность" hint={WORLD_DENSITY_RULES[config.world.density].hint}>
            <Segmented<WorldDensity> label="Плотность" value={config.world.density} onChange={(value) => onWorld({ density: value })}
              options={(Object.keys(WORLD_DENSITY_RULES) as WorldDensity[]).map((value) => ({ value, label: WORLD_DENSITY_RULES[value].label }))} />
          </Field>
        </div>
        <NpcRaceMix config={config} onChange={onChange} />
        <div className="wz-pair">
          <Field label="Сид мира" error={issueFor('seed')} hint="Буквы и цифры, до 16 знаков.">
            <span className="wz-seed">
              <input className="wz-input wz-input--mono" value={config.seed} maxLength={16} onChange={(event) => onChange((current) => ({ ...current, seed: event.target.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase() }))} aria-invalid={Boolean(issueFor('seed'))} aria-label="Сид мира" data-qa-world="seed" />
              <button type="button" className="menu-btn menu-btn--small" onClick={() => onChange((current) => ({ ...current, seed: createCampaignSeed() }))} aria-label="Новый случайный сид" data-qa-world="seed-new">Новый</button>
            </span>
          </Field>
          <label className="menu-toggle wz-tile wz-toggle-start">
            <input type="checkbox" checked={config.world.randomPlayerStart} onChange={(event) => onWorld({ randomPlayerStart: event.target.checked })} />
            <span aria-hidden="true" />
            <span><b>Случайный старт</b><small>{config.world.randomPlayerStart ? 'Система и позиция по сиду' : 'Галактика 1 · система 1'}</small></span>
          </label>
        </div>
      </section>

      <section className="wz-group wz-atlas-box">
        <header className="wz-atlas-head"><span><small>Атлас по сиду</small><b className="menu-mono">{config.seed || '—'}</b></span><span className="wz-atlas-legend"><i className="is-start" />старт <i className="is-npc" />NPC</span></header>
        <WorldAtlas config={config} />
        <dl className="wz-stats">
          <div><dt>Систем</dt><dd>{number.format(summary.systems)}</dd></div>
          <div><dt>Солнц для рейдов</dt><dd>{number.format(summary.suns)}</dd></div>
          <div><dt>Позиций планет</dt><dd>{number.format(summary.planetSlots)}</dd></div>
          <div><dt>NPC</dt><dd>{number.format(summary.npcCount)}</dd></div>
          <div><dt>Заполненность</dt><dd>{summary.occupancyPercent}%</dd></div>
        </dl>
        <p className="wz-note">NPC — самостоятельные игроки: стартуют как вы, строятся, исследуют, воюют, колонизируют и вступают в союзы по тем же правилам.</p>
      </section>
    </div>
  );
}

/** NPC race composition: seeded random or exact shares that always sum to 100%. */
function NpcRaceMix({ config, onChange }: { config: NewGameConfig; onChange: ConfigUpdater }) {
  const mix = config.npcFactions === 'random' ? null : config.npcFactions;
  const counts = useMemo(() => {
    const world = generateWorld(config, 0);
    return world.npcPlanets.reduce<Record<PlayerFactionId, number>>((acc, planet) => {
      acc[planet.raceId as PlayerFactionId] += 1;
      return acc;
    }, { aegis: 0, synod: 0, veyra: 0 });
  }, [config]);
  return (
    <div className="wz-field menu-race-mix" data-qa-npc-mix={mix ? 'mix' : 'random'}>
      <span className="wz-field__label">Расы NPC</span>
      <Segmented<'random' | 'mix'> label="Расы NPC" value={mix ? 'mix' : 'random'}
        onChange={(value) => onChange((current) => ({ ...current, npcFactions: value === 'random' ? 'random' : { ...DEFAULT_NPC_FACTION_MIX } }))}
        options={[{ value: 'random', label: 'Случайно по сиду' }, { value: 'mix', label: 'Задать соотношение' }]} />
      <div className="menu-race-mix__bar" aria-hidden="true">
        {RACE_CARDS.map((card) => {
          const share = mix ? mix[card.id] : config.world.npcCount ? (counts[card.id] / config.world.npcCount) * 100 : 0;
          return <i key={card.id} style={{ width: `${share}%`, background: RACE_DOT[card.id] }} />;
        })}
      </div>
      <div className="menu-race-mix__rows">
        {RACE_CARDS.map((card) => (
          <div key={card.id} className={`menu-race-mix__row${mix ? '' : ' is-random'}`} style={{ '--mix-color': RACE_DOT[card.id] } as CSSProperties} data-qa-npc-mix-race={card.id}>
            <span className="menu-race-mix__name"><img src={card.emblem} alt="" />{card.name}</span>
            {mix ? (
              <AmountSlider compact value={Math.round(mix[card.id])} min={0} max={100} label={`Доля расы ${card.name}`}
                onChange={(value) => onChange((current) => ({ ...current, npcFactions: setNpcFactionShare(current.npcFactions === 'random' ? { ...DEFAULT_NPC_FACTION_MIX } : current.npcFactions, card.id, value) }))} qa={`mix-${card.id}`} />
            ) : <span className="menu-race-mix__random">по сиду</span>}
            <b>{mix ? `${Math.round(mix[card.id])}% · ` : ''}{counts[card.id]} NPC</b>
          </div>
        ))}
      </div>
    </div>
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
  // The dotted guide follows the real system layout over the generated galaxy art.
  const armPath = Array.from({ length: 60 }, (_, step) => {
    const t = step / 59;
    const angle = t * Math.PI * 4.2;
    const radius = 0.05 + t * 0.43;
    return `${step ? 'L' : 'M'}${((0.5 + Math.cos(angle) * radius) * cell).toFixed(1)} ${((0.5 + Math.sin(angle) * radius * 0.82) * cell).toFixed(1)}`;
  }).join(' ');
  return (
    <svg className="menu-atlas" viewBox={`0 0 ${columns * cell} ${rows * cell}`} role="img" aria-label={`Атлас: ${count} галактик, ${world.npcPlanets.length} NPC`} data-qa-world-atlas>
      {Array.from({ length: count }, (_, index) => {
        const galaxy = index + 1;
        const ox = (index % columns) * cell;
        const oy = Math.floor(index / columns) * cell;
        return (
          <g key={galaxy} transform={`translate(${ox} ${oy})`} className="menu-atlas__galaxy">
            <circle cx={cell / 2} cy={cell / 2} r={cell * 0.46} className="menu-atlas__disc" />
            <image href={ATLAS_GALAXIES[(galaxy - 1) % ATLAS_GALAXIES.length]} x={cell * 0.03} y={cell * 0.03} width={cell * 0.94} height={cell * 0.94} preserveAspectRatio="xMidYMid meet" className="menu-atlas__art" />
            <path d={armPath} className="menu-atlas__arm-line" />
            <text x={cell / 2} y={cell * 0.97} className="menu-atlas__label" textAnchor="middle" style={{ fontSize: Math.max(11, cell * 0.05) }}>ГАЛАКТИКА {String(galaxy).padStart(2, '0')}</text>
            {Array.from({ length: 40 }, (_, systemIndex) => {
              const system = systemIndex + 1;
              const point = systemPoint(system);
              const npcs = npcBySystem.get(`${galaxy}:${system}`) ?? [];
              const isStart = world.playerStart.galaxy === galaxy && world.playerStart.system === system;
              return (
                <g key={system}>
                  {npcs.length ? <circle cx={point.x * cell} cy={point.y * cell} r={Math.max(5, cell * 0.03)} className="menu-atlas__halo" fill={RACE_DOT[npcs[0]!]} /> : null}
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

function ConfirmStep({ config, onEdit, seriesLine }: { config: NewGameConfig; onEdit: (step: Step) => void; seriesLine: string }) {
  const card = raceCard(config.factionId);
  const summary = summarizeWorld(config);
  const rows: Array<{ label: string; value: string; step: Step; mono?: boolean; qa?: string }> = [
    { label: 'Командир', value: config.playerName, step: 'campaign' },
    { label: 'Кампания', value: config.campaignName, step: 'campaign' },
    { label: 'Скорость', value: `${CAMPAIGN_SPEED_LABELS[config.world.campaignSpeed].label} ×${CAMPAIGN_SPEED_SCALE[config.world.campaignSpeed]}`, step: 'campaign' },
    { label: 'Активность NPC', value: NPC_ACTIVITY_LABELS[npcActivityOf(config)].label, step: 'campaign' },
    { label: 'Личности NPC', value: seriesLine, step: 'campaign', qa: 'series' },
    { label: 'Мир', value: `${config.world.galaxyCount} гал. · ${number.format(summary.systems)} систем · ${summary.npcCount} NPC`, step: 'world' },
    { label: 'Расселение NPC', value: `${WORLD_DENSITY_RULES[config.world.density].label} · до ${config.world.maxNpcPerSystem} на систему`, step: 'world' },
    { label: 'Расы NPC', value: config.npcFactions === 'random' ? 'Случайно по сиду' : `Астеры ${config.npcFactions.aegis}% · Илары ${config.npcFactions.synod}% · Рой ${config.npcFactions.veyra}%`, step: 'world' },
    { label: 'Старт', value: config.world.randomPlayerStart ? 'Случайная система по сиду' : 'Галактика 1 · система 1', step: 'world' },
    { label: 'Сид', value: config.seed, step: 'world', mono: true },
  ];
  return (
    <div className="wz-grid wz-grid--confirm">
      <article className="menu-confirm-hero wz-hero" data-faction={card.id}>
        <img className="menu-confirm-hero__bg" src={card.background} alt="" draggable={false} />
        <img className="menu-confirm-hero__ship" src={card.flagship} alt="" draggable={false} />
        <img className="menu-confirm-hero__general" src={card.general} alt="" draggable={false} />
        <div className="menu-confirm-hero__copy">
          <small>Ваша сторона</small>
          <h2>{card.name}</h2>
          <p>{card.people} · {card.ability.name}</p>
          <button type="button" className="wz-edit" onClick={() => onEdit('race')}>Изменить расу</button>
        </div>
      </article>
      <section className="wz-group wz-summary">
        <h3 className="wz-summary__name">{config.campaignName}</h3>
        <dl className="wz-summary__rows">
          {rows.map((row) => (
            <div key={row.label} data-qa-series-line={row.qa === 'series' ? '' : undefined}>
              <dt>{row.label}</dt>
              <dd className={row.mono ? 'menu-mono' : undefined}>{row.value}</dd>
              <button type="button" className="wz-edit" onClick={() => onEdit(row.step)} aria-label={`Изменить: ${row.label}`}>Изменить</button>
            </div>
          ))}
        </dl>
        <div className="wz-summary__bottom">
          <section className="menu-confirm-roster">
            <small>Стартовый флот</small>
            <div>
              {card.roster.map((ship) => (
                <span key={ship.id}>
                  {ship.art ? <img src={ship.art} alt="" draggable={false} /> : null}
                  <b>{ship.count}</b>
                  <em>{ship.name}</em>
                </span>
              ))}
            </div>
          </section>
          <section className="menu-goal">
            <small>Цель кампании</small>
            <ol>
              <li>Постройте «Палату управления» и создайте союз в «Командовании».</li>
              <li>Водите командные рейды на Солнца из «Командование → Операции»: победа — шанс 70% на кристалл.</li>
              <li>Соберите 4 разных кристалла и достройте Звёздные Врата в военной зоне — это победа.</li>
            </ol>
          </section>
        </div>
      </section>
    </div>
  );
}
