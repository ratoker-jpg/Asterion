import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import {
  BUILDING_ROLES,
  SCIENCE_ID_PHYSICS,
  formatBalanceEffect,
  getBuildingEffectWithScience,
  getBuildingPresentation,
  type BuildingRole,
} from '../../domain/buildings/balance-v1.ts';
import { putBuildPriorityFirst, removeBuildTarget, setBuildPlanPaused, setBuildTarget, swapBuildPriority, type BuildPlan } from '../../domain/buildings/build-plan.ts';
import { calculateNuclearReactorContribution, calculateSolarStationContribution } from '../../domain/energy/runtime.ts';
import { getPlanetEnergyCoordinates } from '../../application/energy.ts';
import { getBuildingDefinition } from '../../domain/buildings/resource-zone.ts';
import type { BuildingFaction } from '../../domain/buildings/balance-v1.ts';
import { formatUniverseCoordinate } from '../../domain/universe/runtime.ts';
import type { RuntimeMode, TestTimeScale } from '../../domain/runtime/mode.ts';
import { getPlanetResources, type SaveState } from '../../application/contracts.ts';
import { buildBuildPlanView, type BuildPlanLine, type BuildPlanView, type BuildWaitKind } from '../../application/build-plan.ts';
import { compactAmount, formatNumber, plural } from '../empire/empire-format.ts';
import { ResourceIcon } from '../resources/ResourceIcon.tsx';
import '../fleet-plan/fleet-planner.css';
import './build-planner.css';

/** Presets: one click sets many targets. Levels come from how the owner really played (journal 05.11). */
const PRESET_LEVELS = [10, 15, 20, 25] as const;
const PRESET_GROUPS: { label: string; roles: readonly BuildingRole[] }[] = [
  { label: 'Добыча и энергия', roles: ['metal-production-1', 'metal-production-2', 'metal-production-3', 'mineral-production-1', 'mineral-production-2', 'gas-production-1', 'gas-production-2', 'basic-energy'] },
  { label: 'Склады', roles: ['metal-storage', 'mineral-storage', 'gas-storage'] },
];
const COST_KEYS = ['metal', 'minerals', 'gas', 'energy'] as const;
/** The planet's own zones, as the building screens group them. */
const ZONES = [
  { id: 'resource', title: 'Ресурсная зона' },
  { id: 'industry', title: 'Промышленная зона' },
  { id: 'military', title: 'Военная зона' },
] as const;
type CostKey = (typeof COST_KEYS)[number];
/** What a waiting tile is held by, in two words; the full sentence sits under it. */
const WAIT_TITLE: Record<BuildWaitKind, string> = {
  resources: 'Копит ресурсы',
  energy: 'Мало энергии',
  queue: 'Очередь занята',
  requirement: 'Нужно другое здание',
  science: 'Нужна наука',
  blocked: 'Планета заблокирована',
  order: 'Ждёт своей очереди',
};

/** What a building gives at a level, in the player's words. */
function effectAt(state: SaveState, planetId: string, role: BuildingRole, level: number): string {
  if (level <= 0) return 'Не построено';
  const planet = state.planets[planetId]!;
  if (role === 'basic-energy' || role === 'advanced-energy') {
    const where = getPlanetEnergyCoordinates(planet);
    const physics = state.science.levels[SCIENCE_ID_PHYSICS] ?? 0;
    const value = role === 'basic-energy'
      ? calculateSolarStationContribution(level, physics, where.system, where.position, where.galaxy)
      : calculateNuclearReactorContribution(level, physics);
    return `Энергия: ${formatNumber(value)}`;
  }
  const effect = getBuildingEffectWithScience(role, level, state.science.levels);
  if (effect.kind === 'storage-capacity') return `Вместимость склада: ${formatNumber(effect.capacity)}`;
  if (effect.kind === 'construction-time-factor') return `Стройка и производство идут за ${effect.factorPercent}% обычного времени`;
  if (effect.kind === 'production-time-factor' || effect.kind === 'unit-production-time-factor') return `${effect.label}: ${effect.factorPercent}% обычного`;
  return formatBalanceEffect(effect);
}

/** «81», «8 400», «252 тыс», «1,2 млн»: short enough for a tile. */
function short(value: number): string {
  const n = Math.max(0, Math.ceil(value));
  if (n >= 1_000_000) return compactAmount(n);
  if (n >= 10_000) return `${Math.round(n / 1_000).toLocaleString('ru-RU')} тыс`;
  return formatNumber(n);
}

export type BuildPlannerDialogProps = {
  state: SaveState;
  now: number;
  mode: RuntimeMode;
  testTimeScale: TestTimeScale;
  planetId: string;
  planetArt: Record<string, string>;
  onPlanet: (planetId: string) => void;
  onClose: () => void;
  onSavePlan: (planetId: string, plan: BuildPlan) => boolean;
  /** One ordinary «Построить» order on that planet. */
  onBuild: (planetId: string, role: BuildingRole) => boolean;
  /** «Запустить сейчас»: starts what the plan allows right now. */
  onRun: (planetId: string) => number;
};

/**
 * «Планировщик стройки»: the levels a planet's buildings should reach. The game
 * starts the upgrades itself, only while the player is in the game. Every
 * number comes from `buildBuildPlanView`; no rule lives here.
 */
export function BuildPlannerDialog({ state, now, mode, testTimeScale, planetId, planetArt, onPlanet, onClose, onSavePlan, onBuild, onRun }: BuildPlannerDialogProps) {
  const factionId = state.profile.factionId as BuildingFaction;
  const runtime = useMemo(() => ({ now, mode, testTimeScale }), [now, mode, testTimeScale]);
  const view = useMemo(() => buildBuildPlanView(state, planetId, runtime), [state, planetId, runtime]);
  const planets = useMemo(() => Object.keys(state.planets).sort((a, b) => Number(b === 'helion-01') - Number(a === 'helion-01')).map((id) => {
    const other = buildBuildPlanView(state, id, runtime);
    return { id, name: state.planets[id]!.name, empty: other.empty, paused: other.paused, left: other.lines.reduce((sum, line) => sum + line.levelsLeft, 0) };
  }), [state, runtime]);
  const [focusRole, setFocusRole] = useState<BuildingRole | null>(null);
  const [copyOpen, setCopyOpen] = useState(false);
  const planet = state.planets[planetId]!;
  const stored = getPlanetResources(state, planetId);
  const wallet: Record<CostKey, number> = { metal: stored.metal, minerals: stored.minerals, gas: stored.gas, energy: view.energy };
  const planned = new Set(view.lines.filter((line) => !line.implied).map((line) => line.role));
  const shelf = BUILDING_ROLES.filter((role) => !planned.has(role) && !view.lines.some((line) => line.role === role) && (planet.buildings[role] ?? 0) < getBuildingDefinition(role).maxLevel);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (copyOpen) setCopyOpen(false);
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [copyOpen, onClose]);
  useEffect(() => { setCopyOpen(false); setFocusRole(null); }, [planetId]);

  const save = (plan: BuildPlan) => onSavePlan(planetId, plan);
  const levelOf = (role: BuildingRole) => planet.buildings[role] ?? 0;
  const add = (role: BuildingRole) => {
    if (save(setBuildTarget(view.plan, role, levelOf(role) + 1))) setFocusRole(role);
  };
  const applyPreset = (roles: readonly BuildingRole[], level: number) => {
    let plan = view.plan;
    for (const role of roles) {
      const capped = Math.min(level, getBuildingDefinition(role).maxLevel);
      if (levelOf(role) < capped) plan = setBuildTarget(plan, role, capped);
    }
    save(plan);
  };
  const fromCurrent = () => {
    let plan = view.plan;
    for (const role of BUILDING_ROLES) if (levelOf(role) > 0) plan = setBuildTarget(plan, role, levelOf(role));
    save(plan);
  };
  const hasBuildings = BUILDING_ROLES.some((role) => levelOf(role) > 0);
  let tileIndex = 0;
  /** The hover hint: what the building does, and what it gives (at the planned level when there is one). */
  const hintFor = (role: BuildingRole, goal: number | null): HintText => {
    const level = goal ?? levelOf(role);
    return {
      what: getBuildingPresentation(role, factionId).purpose,
      gives: level > 0 ? `${goal ? `На ур. ${goal}` : `Сейчас, ур. ${level}`}: ${effectAt(state, planetId, role, level)}` : null,
    };
  };
  const copySources = planets.filter((other) => other.id !== planetId && !other.empty);
  const copyFrom = (sourceId: string) => {
    const source = state.fleetUi?.buildPlans?.[sourceId];
    if (source) save({ targets: { ...source.targets }, ...(view.paused ? { paused: true } : {}) });
    setCopyOpen(false);
  };

  return createPortal(
    <div className="fplan-veil" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className={`fplan fplan--build ${view.paused ? 'is-paused' : ''}`} role="dialog" aria-modal="true" aria-label={`Планировщик стройки: ${planet.name}`} data-qa-build-planner={planetId}>
        <header className="fplan__head" data-toast-guard>
          <div className="fplan__title">
            <h2>Планировщик стройки</h2>
            <small>{formatUniverseCoordinate({ galaxy: planet.universeGalaxy ?? 1, system: planet.universeSystem ?? 1, position: planet.universePosition ?? 1 })} · {planet.name}</small>
          </div>
          <nav className="fplan__planets" aria-label="Планеты">
            {planets.map((other) => (
              <button key={other.id} type="button" className={other.id === planetId ? 'is-on' : ''} aria-pressed={other.id === planetId} onClick={() => onPlanet(other.id)} data-qa-build-plan-planet={other.id}>
                {planetArt[other.id] ? <img src={planetArt[other.id]} alt="" draggable={false} /> : null}
                <span>{other.name}</span>
                {other.empty ? <small className="is-none">нет плана</small>
                  : other.paused ? <small className="is-none">выключен</small>
                    : other.left > 0 ? <small className="is-warn">ещё {other.left} ур.</small> : <small className="is-ok">всё готово</small>}
              </button>
            ))}
          </nav>
          <button type="button" className="fplan__close" onClick={onClose} aria-label="Закрыть" data-qa-build-planner-close>✕</button>
        </header>

        <div className="bplan-body">
          <aside className="bplan-lead">
            <h3>{view.empty ? 'До каких уровней довести здания?' : 'Здания растут сами'}</h3>
            <p>{view.empty
              ? 'Выберите здания или готовый набор. Пока вы в игре, она сама начнёт следующее улучшение.'
              : 'Пока вы в игре, следующее улучшение начнётся само, как только хватит ресурсов и места в очереди.'}</p>
            {!view.empty ? <Status view={view} /> : null}
            <div className="bplan-presets" data-qa-build-plan-presets>
              {PRESET_GROUPS.map((group) => (
                <div key={group.label}>
                  <span>{group.label} до ур.</span>
                  <p>
                    {/* A level no building of the group can reach is not offered (storages stop at 20). */}
                    {PRESET_LEVELS.filter((level) => group.roles.some((role) => getBuildingDefinition(role).maxLevel >= level)).map((level) => (
                      <button key={level} type="button" onClick={() => applyPreset(group.roles, level)} data-qa-build-plan-preset={`${group.roles[0]}:${level}`}>{level}</button>
                    ))}
                  </p>
                </div>
              ))}
            </div>
            {view.empty ? (
              <div className="bplan-lead__starts">
                <button type="button" className="fplan__btn" onClick={fromCurrent} disabled={!hasBuildings} data-qa-build-plan-from-current>Взять то, что уже есть</button>
              </div>
            ) : null}
          </aside>

          <div className="bplan-grid" data-qa-build-plan-lanes={view.empty ? undefined : ''} data-qa-build-plan-empty={view.empty ? '' : undefined}>
            {ZONES.map((zone) => {
              const lines = view.lines.filter((line) => getBuildingDefinition(line.role).zone === zone.id);
              const free = shelf.filter((role) => getBuildingDefinition(role).zone === zone.id);
              if (!lines.length && !free.length) return null;
              // The arrows trade places with the neighbour planned in the same zone.
              const own = lines.filter((line) => !line.implied);
              return (
                <section key={zone.id} className="bplan-zone" data-qa-build-plan-zone={zone.id}>
                  <h4>{zone.title}{own.length ? <small>{own.length} в плане</small> : null}</h4>
                  {lines.map((line) => {
                    const at = own.indexOf(line);
                    return (
                      <Tile key={line.role} line={line} index={tileIndex++} wallet={wallet} autoFocus={focusRole === line.role}
                        hint={hintFor(line.role, line.target > line.current ? line.target : null)}
                        before={at > 0 ? own[at - 1]!.role : null} after={at >= 0 && at < own.length - 1 ? own[at + 1]!.role : null}
                        onSwap={(other) => save(swapBuildPriority(view.plan, line.role, other))}
                        onFirst={() => save(putBuildPriorityFirst(view.plan, line.role))}
                        onTarget={(level) => save(setBuildTarget(view.plan, line.role, level))}
                        onRemove={() => save(removeBuildTarget(view.plan, line.role))}
                        onBuild={() => onBuild(planetId, line.role)} />
                    );
                  })}
                  {free.map((role) => {
                    const definition = getBuildingDefinition(role, factionId);
                    return (
                      <button key={role} type="button" className={`bplan-add ${view.empty ? 'is-big' : ''}`} style={{ '--i': tileIndex++ } as CSSProperties} onClick={() => add(role)} data-qa-build-plan-add={role}>
                        <img src={definition.art} alt="" draggable={false} />
                        <b>{definition.name}</b>
                        <small>{levelOf(role) > 0 ? `сейчас ур. ${levelOf(role)}` : 'не построено'}</small>
                        <i aria-hidden="true">+</i>
                        <Hint {...hintFor(role, null)} />
                      </button>
                    );
                  })}
                </section>
              );
            })}
          </div>
        </div>

        <footer className="fplan__dock" data-toast-guard>
          <div className="fplan__summary" aria-live="polite">
            <div className="fplan__report bplan-report" key={view.headline} data-qa-build-plan-headline>
              <b>{view.headline}</b>
              <small>Строит само, только пока игра открыта и активна.</small>
            </div>
          </div>
          <div className="fplan__actions">
            <button type="button" className="fplan__btn" onClick={() => setCopyOpen((was) => !was)} disabled={!copySources.length} aria-expanded={copyOpen} data-qa-build-plan-copy>
              Взять план с планеты
            </button>
            {!view.empty ? (
              <button type="button" className={`fplan__btn bplan-toggle ${view.paused ? '' : 'is-on'}`} onClick={() => save(setBuildPlanPaused(view.plan, !view.paused))} aria-pressed={!view.paused} data-qa-build-plan-toggle data-sfx="none">
                <i aria-hidden="true" />{view.paused ? 'Автостарт выключен' : 'Автостарт включён'}
              </button>
            ) : null}
            <button type="button" className="fplan__btn fplan__btn--pri" disabled={!view.next} onClick={() => onRun(planetId)} data-qa-build-plan-start-all data-sfx="none">
              Запустить всё
            </button>
          </div>
          {copyOpen ? (
            <div className="fplan__copy" role="dialog" aria-label="Взять план с планеты" data-qa-build-plan-copy-list>
              <header><b>Взять план с планеты</b>{!view.empty ? <small>Текущий план {planet.name} заменится</small> : null}</header>
              <ul>
                {copySources.map((other) => {
                  const count = Object.keys(state.fleetUi?.buildPlans?.[other.id]?.targets ?? {}).length;
                  return (
                    <li key={other.id}>
                      <button type="button" onClick={() => copyFrom(other.id)} data-qa-build-plan-copy-from={other.id}>
                        {planetArt[other.id] ? <img src={planetArt[other.id]} alt="" draggable={false} /> : null}
                        <span><b>{other.name}</b><small>{count} {plural(count, 'здание', 'здания', 'зданий')} в плане</small></span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </footer>
      </section>
    </div>,
    document.body,
  );
}

function Status({ view }: { view: BuildPlanView }) {
  const full = view.queueUsed >= view.queueCapacity;
  return (
    <div className="bplan-status" data-qa-build-plan-status>
      <p className={full ? 'is-full' : ''}>
        <span>Очередь</span>
        <b>{view.queueUsed} из {view.queueCapacity}</b>
        <i aria-hidden="true">{Array.from({ length: view.queueCapacity }, (_, slot) => <em key={slot} className={slot < view.queueUsed ? 'is-used' : ''} />)}</i>
      </p>
      <p><span>Энергия</span> <b className="bplan-status__energy"><ResourceIcon kind="energy" />{short(view.energy)}</b></p>
      {view.next ? <p className="is-next"><span>Дальше</span> <b>{view.next.name} → ур. {view.next.level}</b></p> : null}
    </div>
  );
}

type HintText = { what: string; gives: string | null };

/** A short hint in the game's own style, shown on hover or keyboard focus; never a system tooltip. */
function Hint({ what, gives }: HintText) {
  return (
    <span className="bplan-hint" role="tooltip" data-qa-build-plan-hint>
      <b>{what}</b>
      {gives ? <small>{gives}</small> : null}
    </span>
  );
}

function Tile({ line, index, wallet, autoFocus, hint, before, after, onSwap, onFirst, onTarget, onRemove, onBuild }: {
  line: BuildPlanLine; index: number; wallet: Record<CostKey, number>; autoFocus: boolean; hint: HintText;
  before: BuildingRole | null; after: BuildingRole | null;
  onSwap: (other: BuildingRole) => void; onFirst: () => void; onTarget: (level: number) => void; onRemove: () => void; onBuild: () => void;
}) {
  const max = getBuildingDefinition(line.role).maxLevel;
  const state = line.status;
  const projected = line.current + line.queued;
  // A target the building already passed reads as «already higher», never «20 of 5».
  const passed = line.target < line.current;
  const goal = Math.max(line.target, projected);
  const scale = Math.max(goal, 1);
  const costs = line.cost ? COST_KEYS.filter((key) => line.cost![key] > 0) : [];
  return (
    <article className={`bplan-tile is-${state} ${line.implied ? 'is-implied' : ''}`} style={{ '--i': index } as CSSProperties}
      data-qa-build-plan-line={line.role} data-qa-build-plan-line-state={state} data-qa-build-plan-line-target={line.target} data-qa-build-plan-line-current={line.current}>
      {!line.implied ? (
        <button type="button" className="bplan-tile__remove" onClick={onRemove} aria-label={`Убрать из плана: ${line.name}`} data-qa-build-plan-remove={line.role}>✕</button>
      ) : null}
      {!line.implied ? (
        <div className="bplan-tile__rank" data-qa-build-plan-priority={line.priority}>
          <button type="button" onClick={() => before && onSwap(before)} disabled={!before} aria-label={`Раньше: ${line.name}`} data-qa-build-plan-up={line.role}>‹</button>
          <button type="button" className={`bplan-tile__first ${line.priority === 1 ? 'is-first' : ''}`} onClick={onFirst} disabled={line.priority === 1} aria-label={`Строить первым: ${line.name}`} data-qa-build-plan-first={line.role}>
            <b>{line.priority}</b>
          </button>
          <button type="button" onClick={() => after && onSwap(after)} disabled={!after} aria-label={`Позже: ${line.name}`} data-qa-build-plan-down={line.role}>›</button>
        </div>
      ) : null}
      <div className="bplan-tile__about" tabIndex={0} aria-label={`${line.name}: ${hint.what}`} data-qa-build-plan-info={line.role}>
        <span className="bplan-tile__art"><img src={line.art} alt="" draggable={false} /></span>
        <b className="bplan-tile__name">{line.name}</b>
        <Hint {...hint} />
      </div>

      <div className="bplan-tile__levels" data-qa-build-plan-levels>
        {passed ? (
          <span className="is-passed">уже ур. <b>{line.current}</b></span>
        ) : (
          <span>ур. <b>{line.current}</b>{line.queued ? <em> +{line.queued}</em> : null}<i aria-hidden="true">→</i><strong key={line.target}>{line.target}</strong></span>
        )}
      </div>
      <div className="bplan-tile__bar" aria-hidden="true">
        <i className="is-queued" style={{ '--from': Math.min(line.current, scale) / scale, '--share': Math.min(line.queued, scale) / scale } as CSSProperties} />
        <i className="is-here" style={{ '--from': 0, '--share': Math.min(line.current, scale) / scale } as CSSProperties} />
      </div>

      {line.implied ? (
        <div className="bplan-tile__implied">
          <small>Нужно для другого здания</small>
          <button type="button" onClick={() => onTarget(line.target)} data-qa-build-plan-adopt={line.role}>Взять в план</button>
        </div>
      ) : (
        <div className="bplan-tile__target">
          <button type="button" onClick={() => onTarget(Math.max(1, line.target - 1))} disabled={line.target <= 1} aria-label={`Уровень ниже: ${line.name}`}>−</button>
          <TargetInput value={line.target} name={line.name} max={max} autoFocus={autoFocus} onCommit={onTarget} qa={line.role} />
          <button type="button" onClick={() => onTarget(Math.min(max, Math.max(line.target, projected) + 1))} disabled={Math.max(line.target, projected) >= max} aria-label={`Уровень выше: ${line.name}`}>+</button>
          <button type="button" className="bplan-tile__max" onClick={() => onTarget(max)} disabled={line.target >= max} data-qa-build-plan-max={line.role}>макс</button>
        </div>
      )}

      <div className="bplan-tile__foot">
        {costs.length ? (
          <p className="bplan-tile__cost" data-qa-build-plan-cost>
            {costs.map((key) => (
              <span key={key} className={line.cost![key] > wallet[key] ? 'is-short' : ''}><ResourceIcon kind={key} />{short(line.cost![key])}</span>
            ))}
          </p>
        ) : null}
        {state === 'done' ? (
          <p className="bplan-tile__done">{passed ? 'Цель пройдена' : 'Готово'}</p>
        ) : state === 'building' ? (
          <p className="bplan-tile__building">Строится до ур. {projected}</p>
        ) : state === 'next' ? (
          <button type="button" className="bplan-tile__go" onClick={onBuild} data-qa-build-plan-build={line.role}>Построить сейчас</button>
        ) : (
          <p className={`bplan-tile__wait is-${line.wait?.kind ?? 'order'}`} data-qa-build-plan-wait={line.wait?.kind}>
            <b>{WAIT_TITLE[line.wait?.kind ?? 'order']}</b>
            {line.wait && line.wait.kind !== 'order' && line.wait.kind !== 'queue' ? <small>{line.wait.text}</small> : null}
          </p>
        )}
      </div>
    </article>
  );
}

function TargetInput({ value, name, max, autoFocus, onCommit, qa }: { value: number; name: string; max: number; autoFocus: boolean; onCommit: (level: number) => void; qa: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!autoFocus) return;
    ref.current?.focus();
    ref.current?.select();
  }, [autoFocus]);
  return (
    <input
      ref={ref}
      className="bplan-tile__input"
      type="text"
      inputMode="numeric"
      autoComplete="off"
      aria-label={`До какого уровня: ${name}`}
      data-qa-build-plan-target={qa}
      value={draft ?? String(value)}
      onFocus={(event) => { setDraft(String(value)); requestAnimationFrame(() => event.target.select()); }}
      onChange={(event) => {
        const digits = event.target.value.replace(/\D/g, '').slice(0, 3);
        setDraft(digits);
        const parsed = Math.min(max, Number(digits));
        if (parsed > 0) onCommit(parsed);
      }}
      onBlur={() => setDraft(null)}
      onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }}
    />
  );
}

