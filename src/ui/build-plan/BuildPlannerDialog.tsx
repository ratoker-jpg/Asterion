import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { BUILDING_ROLES, type BuildingRole } from '../../domain/buildings/balance-v1.ts';
import { removeBuildTarget, setBuildPlanPaused, setBuildTarget, type BuildPlan } from '../../domain/buildings/build-plan.ts';
import { getBuildingDefinition } from '../../domain/buildings/resource-zone.ts';
import type { BuildingFaction } from '../../domain/buildings/balance-v1.ts';
import { formatUniverseCoordinate } from '../../domain/universe/runtime.ts';
import type { RuntimeMode, TestTimeScale } from '../../domain/runtime/mode.ts';
import type { SaveState } from '../../application/contracts.ts';
import { buildBuildPlanView, type BuildPlanLine, type BuildPlanView } from '../../application/build-plan.ts';
import { compactAmount, formatNumber } from '../empire/empire-format.ts';
import '../fleet-plan/fleet-planner.css';
import './build-planner.css';

/** Presets: one click sets many targets. Levels come from how the owner really played (journal 05.11). */
const COST_LABEL = { metal: 'мет.', minerals: 'мин.', gas: 'газ', energy: 'эн.' } as const;
const PRESET_LEVELS = [10, 15, 20, 25] as const;
const PRESET_GROUPS: { label: string; roles: readonly BuildingRole[] }[] = [
  { label: 'Добыча и энергия', roles: ['metal-production-1', 'metal-production-2', 'metal-production-3', 'mineral-production-1', 'mineral-production-2', 'gas-production-1', 'gas-production-2', 'basic-energy'] },
  { label: 'Склады', roles: ['metal-storage', 'mineral-storage', 'gas-storage'] },
];

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
  const planned = new Set(view.lines.filter((line) => !line.implied).map((line) => line.role));
  const shelf = BUILDING_ROLES.filter((role) => !planned.has(role) && (planet.buildings[role] ?? 0) < getBuildingDefinition(role).maxLevel);

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
  const copySources = planets.filter((other) => other.id !== planetId && !other.empty);
  const copyFrom = (sourceId: string) => {
    const source = state.fleetUi?.buildPlans?.[sourceId];
    if (source) save({ targets: { ...source.targets }, ...(view.paused ? { paused: true } : {}) });
    setCopyOpen(false);
  };

  const presets = (
    <div className="bplan-presets" data-qa-build-plan-presets>
      {PRESET_GROUPS.map((group) => (
        <div key={group.label}>
          <span>{group.label} до ур.</span>
          {PRESET_LEVELS.map((level) => (
            <button key={level} type="button" onClick={() => applyPreset(group.roles, level)} data-qa-build-plan-preset={`${group.roles[0]}:${level}`}>{level}</button>
          ))}
        </div>
      ))}
    </div>
  );

  return createPortal(
    <div className="fplan-veil" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="fplan fplan--build" role="dialog" aria-modal="true" aria-label={`Планировщик стройки: ${planet.name}`} data-qa-build-planner={planetId}>
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
                    : other.left > 0 ? <small className="is-warn">ещё {other.left}</small> : <small className="is-ok">всё есть</small>}
              </button>
            ))}
          </nav>
          <button type="button" className="fplan__close" onClick={onClose} aria-label="Закрыть" data-qa-build-planner-close>✕</button>
        </header>

        <Status view={view} />

        {view.empty ? (
          <div className="fplan-empty" data-qa-build-plan-empty>
            <div className="fplan-empty__lead">
              <h3>До каких уровней довести здания?</h3>
              <p>Выберите здания и уровни. Пока вы в игре, она сама начнёт следующее улучшение, как только хватит ресурсов и освободится очередь. Если не хватает энергии, сначала построит самый выгодный источник.</p>
              {presets}
              <div>
                <button type="button" className="fplan__btn" onClick={fromCurrent} disabled={!hasBuildings} data-qa-build-plan-from-current>Взять то, что уже есть</button>
                <button type="button" className="fplan__btn" onClick={() => setCopyOpen((was) => !was)} disabled={!copySources.length} data-qa-build-plan-copy>Взять план с планеты</button>
              </div>
            </div>
            <div className="fplan-empty__grid">
              {shelf.map((role, index) => {
                const definition = getBuildingDefinition(role, factionId);
                return (
                  <button key={role} type="button" style={{ '--i': index } as CSSProperties} onClick={() => add(role)} data-qa-build-plan-add={role}>
                    <img src={definition.art} alt="" draggable={false} />
                    <b>{definition.name}</b>
                    <small>{levelOf(role) > 0 ? `ур. ${levelOf(role)}` : 'нет'}</small>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <>
            {presets}
            <ol className="fplan__lanes bplan-lanes" data-qa-build-plan-lanes>
              {view.lines.map((line, index) => (
                <Lane key={line.role} line={line} index={index} autoFocus={focusRole === line.role}
                  onTarget={(level) => save(setBuildTarget(view.plan, line.role, level))}
                  onRemove={() => save(removeBuildTarget(view.plan, line.role))}
                  onBuild={() => onBuild(planetId, line.role)} />
              ))}
            </ol>
            {shelf.length ? (
              <div className="fplan__shelf" data-qa-build-plan-shelf>
                <span>Добавить</span>
                <div>
                  {shelf.map((role) => (
                    <button key={role} type="button" onClick={() => add(role)} data-qa-build-plan-add={role}>
                      <img src={getBuildingDefinition(role, factionId).art} alt="" draggable={false} />
                      <b>{getBuildingDefinition(role, factionId).name}</b>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </>
        )}

        <footer className="fplan__dock" data-toast-guard>
          <div className="fplan__summary" aria-live="polite">
            <div className="fplan__report" key={view.headline} data-qa-build-plan-headline>
              <b>{view.headline}</b>
              <small>Работает, пока игра открыта и окно активно. В фоне, офлайн и на сервере ничего не строится.</small>
            </div>
          </div>
          <div className="fplan__actions">
            {!view.empty ? (
              <button type="button" className="fplan__btn" onClick={() => setCopyOpen((was) => !was)} disabled={!copySources.length} aria-expanded={copyOpen} data-qa-build-plan-copy>
                Взять план с планеты
              </button>
            ) : null}
            {!view.empty ? (
              <button type="button" className="fplan__btn" onClick={() => save(setBuildPlanPaused(view.plan, !view.paused))} aria-pressed={!view.paused} data-qa-build-plan-toggle data-sfx="none">
                {view.paused ? 'Включить автостарт' : 'Выключить автостарт'}
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
                {copySources.map((other) => (
                  <li key={other.id}>
                    <button type="button" onClick={() => copyFrom(other.id)} data-qa-build-plan-copy-from={other.id}>
                      {planetArt[other.id] ? <img src={planetArt[other.id]} alt="" draggable={false} /> : null}
                      <span><b>{other.name}</b><small>{Object.keys(state.fleetUi?.buildPlans?.[other.id]?.targets ?? {}).length} зданий в плане</small></span>
                    </button>
                  </li>
                ))}
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
  return (
    <div className="bplan-status" data-qa-build-plan-status>
      <p><span>Очередь стройки</span> <b>{view.queueUsed} из {view.queueCapacity}</b></p>
      <p><span>Энергия</span> <b>{formatNumber(view.energy)}</b></p>
      {view.next ? <p className="is-next"><span>Дальше</span> <b>{view.next.name} → ур. {view.next.level}</b></p> : null}
    </div>
  );
}

function Lane({ line, index, autoFocus, onTarget, onRemove, onBuild }: {
  line: BuildPlanLine; index: number; autoFocus: boolean; onTarget: (level: number) => void; onRemove: () => void; onBuild: () => void;
}) {
  const max = getBuildingDefinition(line.role).maxLevel;
  const scale = Math.max(line.target, 1);
  const state = line.status;
  return (
    <li className={`fplan-lane bplan-lane is-${state === 'done' ? 'done' : state}`} style={{ '--i': index } as CSSProperties}
      data-qa-build-plan-line={line.role} data-qa-build-plan-line-state={state} data-qa-build-plan-line-target={line.target} data-qa-build-plan-line-current={line.current}>
      <div className="fplan-lane__art"><img src={line.art} alt="" draggable={false} /></div>
      <div className="fplan-lane__name">
        <b>{line.name}</b>
        <small>{line.implied ? 'нужно для другого здания' : `сейчас ур. ${line.current}${line.queued ? `, строится ещё ${line.queued}` : ''}`}</small>
      </div>
      <div className="fplan-lane__track">
        <div className="fplan-lane__bar" aria-hidden="true">
          <i className="is-queued" style={{ '--from': line.current / scale, '--share': line.queued / scale } as CSSProperties} />
          <i className="is-here" style={{ '--from': 0, '--share': Math.min(line.current, scale) / scale } as CSSProperties} />
        </div>
        <small className="fplan-lane__parts"><span>ур. <b>{line.current}</b> из <b>{line.target}</b></span>
          {line.cost ? <span data-qa-build-plan-cost>след. уровень: {(['metal', 'minerals', 'gas', 'energy'] as const).filter((key) => line.cost![key] > 0).map((key) => `${compactAmount(line.cost![key])} ${COST_LABEL[key]}`).join(', ')}</span> : null}</small>
      </div>
      <div className="bplan-lane__target">
        <button type="button" onClick={() => onTarget(line.target - 1)} disabled={line.implied || line.target <= 1} aria-label={`Уровень ниже: ${line.name}`}>−</button>
        <TargetInput value={line.target} name={line.name} max={max} autoFocus={autoFocus} disabled={line.implied} onCommit={onTarget} qa={line.role} />
        <button type="button" onClick={() => onTarget(line.target + 1)} disabled={line.implied || line.target >= max} aria-label={`Уровень выше: ${line.name}`}>+</button>
        <button type="button" className="bplan-lane__max" onClick={() => onTarget(max)} disabled={line.implied || line.target >= max} data-qa-build-plan-max={line.role}>макс</button>
      </div>
      <div className="fplan-lane__action">
        {state === 'done' ? <p className="fplan-lane__done">Готово</p>
          : state === 'building' ? <p className="fplan-lane__hint bplan-lane__building">Строится</p>
            : state === 'next' ? (
              <>
                <button type="button" className="fplan-lane__go" onClick={onBuild} data-qa-build-plan-build={line.role}><span>Построить сейчас</span></button>
                <small className="fplan-lane__hint">идёт следующей</small>
              </>
            ) : <p className={`bplan-lane__wait is-${line.wait?.kind ?? 'order'}`} data-qa-build-plan-wait={line.wait?.kind}>{line.wait?.text}</p>}
      </div>
      <button type="button" className="fplan-lane__remove" onClick={onRemove} disabled={line.implied} aria-label={`Убрать из плана: ${line.name}`} data-qa-build-plan-remove={line.role}>✕</button>
    </li>
  );
}

function TargetInput({ value, name, max, autoFocus, disabled, onCommit, qa }: { value: number; name: string; max: number; autoFocus: boolean; disabled: boolean; onCommit: (level: number) => void; qa: string }) {
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
      className="fplan-lane__input"
      type="text"
      inputMode="numeric"
      autoComplete="off"
      disabled={disabled}
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
