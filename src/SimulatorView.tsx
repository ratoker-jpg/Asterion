import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject, type SetStateAction } from 'react';
import { createPortal } from 'react-dom';

import { calculateAttackDebris, calculateAttackLoot } from './application/attack.ts';
import type { SaveState } from './application/contracts.ts';
import { createSimulatorScenarioFromSpyReport, simulatorSideFromPlanet, simulatorSpyReports } from './application/simulator-handoff.ts';
import { BattleReportModal } from './BattleReportsView';
import { COMMANDER_COMBAT_CATALOG, type CatalogEntity } from './domain/combat/catalog.ts';
import { getCombatEntityForStack } from './domain/combat/side-entity.ts';
import { COMMANDER_ABILITIES, type CommanderId } from './domain/combat/commanders.ts';
import { SOLAR_SATELLITE_ID } from './domain/combat/ids.ts';
import { getFactionDefenseCatalog, getFactionShipCatalog } from './domain/combat/faction-catalog.ts';
import {
  COMBAT_FACTIONS,
  getCombatFactionName,
  normalizeCombatFactionId,
  type CombatFactionId,
} from './domain/combat/factions.ts';
import { createDefaultCombatPriority } from './domain/combat/priority.ts';
import { calculateCombatStackPreview, resolveCombat, type CombatStackPreview } from './domain/combat/resolver.ts';
import {
  deleteSimulatorPreset,
  createDefaultSimulatorState,
  persistSimulatorState,
  readSavedCombatTechnologyProfiles,
  readSimulatorState,
  upsertSimulatorPreset,
  withLastScenario,
  type SimulatorState,
} from './domain/combat/simulator-repository.ts';
import { ACTIVE_RUNTIME_MODE, RUNTIME_RESET_EVENT } from './domain/runtime/mode.ts';
import {
  COMBAT_ENTITY_LEVEL_LIMITS,
  SIMULATOR_POPULATION_LIMITS,
} from './domain/combat/config.ts';
import {
  calculateScenarioPopulation,
  createEmptySimulatorScenario,
  scenarioToCombatInput,
  setScenarioFaction,
  SIMULATOR_MAX_ROUNDS,
  validateCombatInput,
  type CombatStackInput,
  type SimulatorScenario,
} from './domain/combat/simulator.ts';
import {
  COMBAT_TECHNOLOGIES,
  normalizeCombatTechnologies,
  normalizeTechnologyLevel,
  type CombatTechnologyId,
  type CombatTechnologyLevels,
} from './domain/combat/technologies.ts';
import type { BattleReport, BattleStackSnapshot } from './domain/combat/report.ts';
import { GameSelect, type GameSelectOption } from './ui/GameSelect';
import { ResourceIcon } from './ui/resources/ResourceIcon';
import criticalHitArt from '../assets/source/New assets/technologies/technology.shared.critical-hit.png';
import heavyArmorArt from '../assets/source/New assets/technologies/technology.shared.heavy-armor.png';
import ionScienceArt from '../assets/source/New assets/technologies/technology.shared.ion-science.png';
import laserScienceArt from '../assets/source/New assets/technologies/technology.shared.laser-science.png';
import lightArmorArt from '../assets/source/New assets/technologies/technology.shared.light-armor.png';
import maneuverDefenseArt from '../assets/source/New assets/technologies/technology.shared.maneuver-defense.png';
import mediumArmorArt from '../assets/source/New assets/technologies/technology.shared.medium-armor.png';
import piercingAttackArt from '../assets/source/New assets/technologies/technology.shared.piercing-attack.png';
import plasmaScienceArt from '../assets/source/New assets/technologies/technology.shared.plasma-science.png';
import shipArmorArt from '../assets/source/New assets/technologies/technology.shared.ship-armor.png';

let identityCounter = 0;

function nextIdentity(prefix: string) {
  identityCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${identityCounter.toString(36)}`;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value);
}

type ScenarioSide = 'attacker' | 'defender';
type ScenarioCategory = 'ships' | 'commanders' | 'defenses';

/** The planet a spy report filled the defender from: only then the loot has real figures. */
type LootTarget = { name: string; resources: { metal: number; minerals: number; gas: number } };

function activeTechnologies(levels?: CombatTechnologyLevels) {
  const normalized = normalizeCombatTechnologies(levels);
  return COMBAT_TECHNOLOGIES.filter((technology) => normalized[technology.id] > 0).length;
}

function getStacks(scenario: SimulatorScenario, side: ScenarioSide, category: ScenarioCategory): CombatStackInput[] {
  if (side === 'attacker') {
    if (category === 'defenses') return [];
    if (category === 'commanders' && scenario.attacker.commanders.length) return scenario.attacker.commanders;
    if (category === 'commanders' && scenario.attacker.commander !== undefined) return scenario.attacker.commander ? [scenario.attacker.commander] : [];
    return scenario.attacker[category];
  }
  if (category === 'commanders' && scenario.defender.commanders.length) return scenario.defender.commanders;
  if (category === 'commanders' && scenario.defender.commander !== undefined) return scenario.defender.commander ? [scenario.defender.commander] : [];
  return scenario.defender[category];
}

function getCount(scenario: SimulatorScenario, side: ScenarioSide, category: ScenarioCategory, entityId: string) {
  return getStacks(scenario, side, category).find((stack) => stack.entityId === entityId)?.count ?? 0;
}

const UNIQUE_DEFENSE_IDS = new Set(['tower-shield', 'planetary-shield']);

function selectedCommanders(scenario: SimulatorScenario, side: ScenarioSide) {
  return getStacks(scenario, side, 'commanders').filter((stack) => stack.count > 0);
}

function replaceStackCount(
  scenario: SimulatorScenario,
  side: ScenarioSide,
  category: ScenarioCategory,
  entityId: CombatStackInput['entityId'],
  count: number,
): SimulatorScenario {
  const nextCount = Math.max(0, Math.floor(Number.isFinite(count) ? count : 0));
  const current = getStacks(scenario, side, category);
  const existing = current.find((stack) => stack.entityId === entityId);
  const nextStack = { entityId, count: nextCount, level: existing?.level ?? 0 };
  const next = current.filter((stack) => stack.entityId !== entityId);
  if (nextCount > 0) next.push(nextStack);
  const currentActive = scenario[side].activeCommanderId;
  const activeId = category === 'commanders'
    ? (next.some((stack) => stack.entityId === currentActive && stack.count > 0)
      ? currentActive
      : (next[0]?.entityId as CommanderId | undefined) ?? null)
    : undefined;

  if (side === 'attacker') {
    if (category === 'defenses') return scenario;
    return {
      ...scenario,
      attacker: {
        ...scenario.attacker,
        [category]: next,
        ...(category === 'commanders' ? {
          commander: next.find((stack) => stack.entityId === activeId) ?? null,
          activeCommanderId: activeId,
        } : {}),
      },
    };
  }

  return {
    ...scenario,
    defender: {
      ...scenario.defender,
      [category]: next,
      ...(category === 'commanders' ? {
        commander: next.find((stack) => stack.entityId === activeId) ?? null,
        activeCommanderId: activeId,
      } : {}),
    },
  };
}

function replaceStackLevel(
  scenario: SimulatorScenario,
  side: ScenarioSide,
  category: ScenarioCategory,
  entityId: CombatStackInput['entityId'],
  level: number,
): SimulatorScenario {
  const current = getStacks(scenario, side, category);
  if (category === 'defenses') return scenario;
  const entity = getCombatEntityForStack(entityId);
  const levelMax = COMBAT_ENTITY_LEVEL_LIMITS[entity.kind];
  const next = current.map((stack) => stack.entityId === entityId
    ? { ...stack, level: Math.min(levelMax, Math.max(0, Math.floor(Number.isFinite(level) ? level : 0))) }
    : stack);
  if (side === 'attacker') {
    return {
      ...scenario,
      attacker: {
        ...scenario.attacker,
        [category]: next,
        ...(category === 'commanders' ? { commander: next.find((stack) => stack.entityId === scenario.attacker.activeCommanderId) ?? next[0] ?? null } : {}),
      },
    };
  }
  return {
    ...scenario,
    defender: {
      ...scenario.defender,
      [category]: next,
      ...(category === 'commanders' ? { commander: next.find((stack) => stack.entityId === scenario.defender.activeCommanderId) ?? next[0] ?? null } : {}),
    },
  };
}

function categoryPopulation(scenario: SimulatorScenario, side: ScenarioSide, category: ScenarioCategory) {
  const factionId = normalizeCombatFactionId(side === 'attacker' ? scenario.attackerFactionId : scenario.defenderFactionId);
  const catalog = category === 'ships'
    ? getFactionShipCatalog(factionId)
    : category === 'commanders'
      ? COMMANDER_COMBAT_CATALOG
      : getFactionDefenseCatalog(factionId);
  return getStacks(scenario, side, category).reduce((total, stack) => {
    const entity = catalog.find((item) => item.id === stack.entityId);
    return total + (entity ? entity.population * stack.count : 0);
  }, 0);
}

function maxForEntity(
  scenario: SimulatorScenario,
  side: ScenarioSide,
  category: ScenarioCategory,
  entity: CatalogEntity,
) {
  const currentCount = getCount(scenario, side, category, entity.id);
  const currentContribution = currentCount * entity.population;
  const used = category === 'defenses'
    ? categoryPopulation(scenario, 'defender', 'defenses')
    : side === 'attacker'
      ? categoryPopulation(scenario, 'attacker', 'ships') + categoryPopulation(scenario, 'attacker', 'commanders')
      : categoryPopulation(scenario, 'defender', 'ships') + categoryPopulation(scenario, 'defender', 'commanders');
  const budgetWithoutCurrent = Math.max(0, used - currentContribution);
  const limit = category === 'defenses'
    ? SIMULATOR_POPULATION_LIMITS.defenderDefense
    : side === 'attacker'
      ? SIMULATOR_POPULATION_LIMITS.attackerFleet
      : SIMULATOR_POPULATION_LIMITS.defenderFleet;
  const populationMax = Math.max(0, Math.floor((limit - budgetWithoutCurrent) / Math.max(1, entity.population)));
  const ownedMax = entity.maxOwned
    ?? (category === 'defenses' && UNIQUE_DEFENSE_IDS.has(entity.id)
      ? 1
      : Number.MAX_SAFE_INTEGER);
  return Math.min(ownedMax, populationMax);
}

/** Long stats on a one-line row: tens of millions read better shortened. */
function formatShort(value: number) {
  if (Math.abs(value) >= 1_000_000_000) return `${formatNumber(Math.round(value / 100_000_000) / 10)} млрд`;
  if (Math.abs(value) >= 1_000_000) return `${formatNumber(Math.round(value / 100_000) / 10)} млн`;
  return formatNumber(Math.round(value));
}

/**
 * A number field with small arrows. Emptying it or typing 0 stays a draft while
 * the field has focus, so a row that disappears at 0 does not vanish mid-typing.
 */
function NumberStepper({
  value,
  min,
  max,
  label,
  invalid,
  errorId,
  inputRef,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  label: string;
  invalid?: boolean;
  errorId?: string;
  inputRef?: RefObject<HTMLInputElement | null>;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  useEffect(() => setDraft(null), [value]);
  const update = (next: number) => onChange(Math.min(max, Math.max(min, Math.floor(next))));
  return (
    <span className="simx-num">
      <input
        ref={inputRef}
        type="number"
        min={min}
        max={max}
        value={draft ?? value}
        aria-label={label}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={invalid ? errorId : undefined}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (event.target.value === '' || !Number.isFinite(next) || next <= 0) {
            setDraft(event.target.value);
            return;
          }
          setDraft(null);
          update(next);
        }}
        onBlur={() => {
          if (draft === null) return;
          setDraft(null);
          update(min);
        }}
      />
      <span className="simx-num__arrows">
        <button type="button" aria-label={`Увеличить: ${label}`} disabled={value >= max} onClick={() => update(value + 1)}><i aria-hidden="true" /></button>
        <button type="button" aria-label={`Уменьшить: ${label}`} disabled={value <= min} onClick={() => update(value - 1)}><i aria-hidden="true" /></button>
      </span>
    </span>
  );
}

const prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/** Numbers of the result run up from zero. Timers, not frames: a covered window still ends on the true value. */
function CountUp({ value, duration = 760 }: { value: number; duration?: number }) {
  const [shown, setShown] = useState(() => (prefersReducedMotion() ? value : 0));
  useEffect(() => {
    if (prefersReducedMotion() || value === 0) {
      setShown(value);
      return;
    }
    const started = performance.now();
    const timer = window.setInterval(() => {
      const progress = Math.min(1, (performance.now() - started) / duration);
      setShown(Math.round(value * (1 - (1 - progress) ** 3)));
      if (progress >= 1) window.clearInterval(timer);
    }, 32);
    return () => window.clearInterval(timer);
  }, [value, duration]);
  return <>{formatNumber(shown)}</>;
}

/**
 * A game tooltip. It lives in document.body at window coordinates: the fleet lists
 * scroll on their own and would cut anything hanging out of a row.
 */
function HoverTip({ className, tip, children }: { className: string; tip: ReactNode; children: ReactNode }) {
  const [place, setPlace] = useState<{ left: number; top?: number; bottom?: number } | null>(null);
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const hide = () => {
    window.clearTimeout(timer.current);
    setPlace(null);
  };
  return (
    <div
      className={className}
      onPointerEnter={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setPlace({
          left: Math.min(rect.left, window.innerWidth - 320),
          ...(rect.top > 130 ? { bottom: window.innerHeight - rect.top + 6 } : { top: rect.bottom + 6 }),
        }), 220);
      }}
      onPointerLeave={hide}
      onWheel={hide}
    >
      {children}
      {place ? createPortal(<div className="simx-tip" role="tooltip" style={place}>{tip}</div>, document.body) : null}
    </div>
  );
}

function PopulationMeter({ label, value, max }: { label: string; value: number; max: number }) {
  return (
    <div className={`simx-meter${value > max ? ' is-over' : ''}`}>
      <span>{label}</span>
      <i aria-hidden="true"><b style={{ transform: `scaleX(${Math.min(1, value / Math.max(1, max))})` }} /></i>
      <strong>{formatNumber(value)} / {formatNumber(max)}</strong>
    </div>
  );
}

function stackOutcome(report: BattleReport | null, side: ScenarioSide, entityId: string) {
  if (!report) return null;
  const force = side === 'attacker' ? report.attackerForce : report.defenderForce;
  return [...force.stacks, ...(force.defenses ?? [])].find((stack) => stack.entityId === entityId) ?? null;
}

function UnitRow({
  entity,
  side,
  count,
  max,
  level,
  levelMax,
  showLevel,
  preview,
  ability,
  outcome,
  invalid,
  errorId,
  autoFocus,
  onChange,
  onLevelChange,
}: {
  entity: CatalogEntity;
  side: ScenarioSide;
  count: number;
  max: number;
  level: number;
  levelMax: number;
  showLevel: boolean;
  preview?: CombatStackPreview;
  ability?: string;
  outcome: BattleStackSnapshot | null;
  invalid?: boolean;
  errorId?: string;
  autoFocus: boolean;
  onChange: (count: number) => void;
  onLevelChange: (level: number) => void;
}) {
  const countRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (!autoFocus) return;
    countRef.current?.focus();
    countRef.current?.select();
  }, [autoFocus]);
  return (
    <div className={`simx-row${outcome && outcome.destroyed > 0 ? ' has-losses' : ''}`} data-qa-simulator-unit={entity.id}>
      <HoverTip
        className="simx-row__who"
        tip={(
          <>
            <b>{entity.role}</b>
            <span>Население {formatNumber(entity.population)} · Оружие: {entity.combat.weaponType} · Броня: {entity.combat.armorType}</span>
            {ability ? <span>Способность: {ability}</span> : null}
          </>
        )}
      >
        <img src={entity.art} alt="" draggable={false} />
        <div className="simx-row__name">
          <strong>{entity.name}</strong>
          {outcome ? (
            <small className="simx-row__outcome">
              {outcome.destroyed > 0 ? <><em>−{formatShort(outcome.destroyed)}</em> осталось {formatShort(outcome.countAfter)}</> : 'без потерь'}
            </small>
          ) : preview ? (
            <small>Атака {formatShort(preview.totalAttack)} · Жизнь {formatShort(preview.hpPool)}</small>
          ) : <small>{entity.role}</small>}
        </div>
      </HoverTip>
      <NumberStepper value={count} min={0} max={max} label={`Количество ${entity.name}`} invalid={invalid} errorId={errorId} inputRef={countRef} onChange={onChange} />
      {showLevel ? (
        <div className="simx-row__level" data-qa-sim-level>
          <NumberStepper value={level} min={0} max={levelMax} label={`Уровень ${entity.name}`} invalid={invalid} errorId={errorId} onChange={onLevelChange} />
        </div>
      ) : <span />}
      <button type="button" className="simx-row__remove" aria-label={`Убрать: ${entity.name}, ${side === 'attacker' ? 'атакующий' : 'защитник'}`} onClick={() => onChange(0)}><i aria-hidden="true" /></button>
    </div>
  );
}

function UnitGroup({
  id,
  title,
  meter,
  entities,
  scenario,
  side,
  category,
  technologies,
  report,
  invalid,
  errorId,
  onScenario,
}: {
  id: string;
  title: string;
  meter: { label: string; value: number; max: number };
  entities: readonly CatalogEntity[];
  scenario: SimulatorScenario;
  side: ScenarioSide;
  category: ScenarioCategory;
  technologies?: CombatTechnologyLevels;
  report: BattleReport | null;
  invalid?: boolean;
  errorId?: string;
  onScenario: (scenario: SimulatorScenario) => void;
}) {
  const [justAdded, setJustAdded] = useState<string | null>(null);
  const stacks = getStacks(scenario, side, category);
  const previewStacks = [
    ...getStacks(scenario, side, 'ships'),
    ...getStacks(scenario, side, 'commanders'),
    ...getStacks(scenario, side, 'defenses'),
  ];
  const activeCommanderId = scenario[side].activeCommanderId ?? null;
  const factionId = normalizeCombatFactionId(side === 'attacker' ? scenario.attackerFactionId : scenario.defenderFactionId);
  // Rows keep the catalogue order, so a row added in the middle does not shuffle the others.
  const inBattle = entities.filter((entity) => getCount(scenario, side, category, entity.id) > 0);
  const waiting = entities.filter((entity) => getCount(scenario, side, category, entity.id) <= 0);
  return (
    <section id={id} className="simx-group">
      <header className="simx-group__head">
        <h4>{title}</h4>
        <PopulationMeter {...meter} />
      </header>
      {inBattle.length ? (
        <div className="simx-rows">
          {inBattle.map((entity) => {
            const stack = stacks.find((item) => item.entityId === entity.id);
            const max = maxForEntity(scenario, side, category, entity);
            const preview = stack && technologies
              ? calculateCombatStackPreview(stack, factionId, technologies, 'production', previewStacks, activeCommanderId) ?? undefined
              : undefined;
            return (
              <UnitRow
                key={entity.id}
                entity={entity}
                side={side}
                count={stack?.count ?? 0}
                max={max}
                level={stack?.level ?? 0}
                levelMax={COMBAT_ENTITY_LEVEL_LIMITS[entity.kind]}
                showLevel={entity.kind !== 'defense'}
                preview={preview}
                ability={entity.kind === 'commander' ? COMMANDER_ABILITIES[entity.id as CommanderId].ability : undefined}
                outcome={stackOutcome(report, side, entity.id)}
                invalid={invalid}
                errorId={errorId}
                autoFocus={justAdded === entity.id}
                onChange={(next) => onScenario(replaceStackCount(scenario, side, category, entity.id, Math.min(max, next)))}
                onLevelChange={(next) => onScenario(replaceStackLevel(scenario, side, category, entity.id, next))}
              />
            );
          })}
        </div>
      ) : null}
      {waiting.length ? (
        <div className="simx-shelf">
          {waiting.map((entity) => (
            <button
              key={entity.id}
              type="button"
              className="simx-tile"
              data-qa-simulator-add={entity.id}
              aria-label={`Добавить: ${entity.name}`}
              disabled={maxForEntity(scenario, side, category, entity) < 1}
              onClick={() => {
                setJustAdded(entity.id);
                onScenario(replaceStackCount(scenario, side, category, entity.id, 1));
              }}
            >
              <img src={entity.art} alt="" draggable={false} />
              <span>{entity.name}</span>
              <i aria-hidden="true" />
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}

const COMBAT_TECHNOLOGY_ART: Record<CombatTechnologyId, string> = {
  laserScience: laserScienceArt,
  ionScience: ionScienceArt,
  plasmaScience: plasmaScienceArt,
  piercingAttack: piercingAttackArt,
  lightArmor: lightArmorArt,
  mediumArmor: mediumArmorArt,
  heavyArmor: heavyArmorArt,
  shipArmor: shipArmorArt,
  maneuverDefense: maneuverDefenseArt,
  criticalHit: criticalHitArt,
};

function TechnologyPanel({
  id,
  open,
  levels,
  invalid,
  errorId,
  onCopy,
  onChange,
}: {
  id: string;
  open: boolean;
  levels?: CombatTechnologyLevels;
  invalid?: boolean;
  errorId?: string;
  onCopy?: () => void;
  onChange: (levels: CombatTechnologyLevels) => void;
}) {
  const normalized = useMemo(() => normalizeCombatTechnologies(levels), [levels]);

  const updateLevel = (technologyId: CombatTechnologyId, nextValue: number) => {
    const nextLevel = normalizeTechnologyLevel(technologyId, nextValue);
    const exclusiveIds: readonly CombatTechnologyId[] = ['piercingAttack', 'maneuverDefense', 'criticalHit'];
    const nextLevels = { ...normalized, [technologyId]: nextLevel };
    if (nextLevel > 0 && exclusiveIds.includes(technologyId)) {
      exclusiveIds.forEach((other) => {
        if (other !== technologyId) nextLevels[other] = 0;
      });
    }
    onChange({ ...nextLevels });
  };

  return (
    <div id={id} className="simx-techs" hidden={!open}>
      {open ? COMBAT_TECHNOLOGIES.map((technology) => (
        <div className="simx-tech" key={technology.id} data-qa-simulator-technology={technology.id}>
          <HoverTip className="simx-tech__who" tip={technology.effect}>
            <img src={COMBAT_TECHNOLOGY_ART[technology.id]} alt="" draggable={false} />
            <strong>{technology.name}</strong>
          </HoverTip>
          <NumberStepper value={normalized[technology.id]} min={0} max={technology.maxLevel} label={`${technology.name}, уровень`} invalid={invalid} errorId={errorId} onChange={(next) => updateLevel(technology.id, next)} />
        </div>
      )) : null}
      {open && onCopy ? <button type="button" className="simx-ghost simx-techs__copy" data-qa-sim-copy-tech onClick={onCopy}>Скопировать науки атакующего</button> : null}
    </div>
  );
}

function SideStrip({
  side,
  scenario,
  factionId,
  technologyCount,
  technologyId,
  technologiesOpen,
  onFaction,
  onCommander,
  onToggleTechnologies,
}: {
  side: ScenarioSide;
  scenario: SimulatorScenario;
  factionId: CombatFactionId;
  technologyCount: number;
  technologyId: string;
  technologiesOpen: boolean;
  onFaction: (factionId: CombatFactionId) => void;
  onCommander: (commanderId: CommanderId | null) => void;
  onToggleTechnologies: () => void;
}) {
  const sideName = side === 'attacker' ? 'атакующего' : 'защитника';
  const commanderOptions: GameSelectOption[] = selectedCommanders(scenario, side).flatMap((stack) => {
    const entity = COMMANDER_COMBAT_CATALOG.find((item) => item.id === stack.entityId);
    return entity ? [{ value: entity.id, label: entity.name }] : [];
  });
  return (
    <div className="simx-strip">
      <div className="simx-field">
        <span>Раса</span>
        <GameSelect
          label={`Раса ${sideName}`}
          value={factionId}
          options={COMBAT_FACTIONS.map((faction) => ({ value: faction.id, label: faction.name }))}
          selectProps={{ id: `sim-${side}-race` }}
          onChange={(value) => onFaction(value as CombatFactionId)}
        />
      </div>
      <div className="simx-field">
        <span>Ведущий командир</span>
        <GameSelect
          label={`Ведущий командир ${sideName}`}
          value={scenario[side].activeCommanderId ?? ''}
          options={commanderOptions.length ? [{ value: '', label: 'Без ведущего' }, ...commanderOptions] : []}
          placeholder={commanderOptions.length ? 'Без ведущего' : 'Нет командира'}
          disabled={!commanderOptions.length}
          selectProps={{ id: `sim-leading-commander-${side}`, 'data-qa-simulator-leading-commander': side }}
          onChange={(value) => onCommander(value ? value as CommanderId : null)}
        />
      </div>
      <button type="button" className={`simx-tech-toggle${technologiesOpen ? ' is-open' : ''}`} aria-expanded={technologiesOpen} aria-controls={technologyId} onClick={onToggleTechnologies}>
        <span>Технологии</span>
        <strong>{technologyCount ? `Активно: ${technologyCount}` : 'Все уровни 0'}</strong>
        <i aria-hidden="true" />
      </button>
    </div>
  );
}

const WINNER_TITLE: Record<BattleReport['winner'], string> = {
  attacker: 'Победа атакующего',
  defender: 'Победа защитника',
  draw: 'Ничья',
};

function destroyedUnits(force: BattleReport['attackerForce']) {
  return [...force.stacks, ...(force.defenses ?? [])].reduce((total, stack) => total + stack.destroyed, 0);
}

function ForceOutcome({ name, tone, force }: { name: string; tone: ScenarioSide; force: BattleReport['attackerForce'] }) {
  const left = force.populationBefore > 0 ? Math.max(0, force.populationAfter / force.populationBefore) : 0;
  const lost = destroyedUnits(force);
  return (
    <div className={`simx-force is-${tone}`} data-qa-sim-force={tone}>
      <span>{name}</span>
      <strong className={lost > 0 ? 'is-loss' : ''}>{lost > 0 ? '−' : ''}<CountUp value={lost} /></strong>
      <i aria-hidden="true"><b style={{ transform: `scaleX(${left})` }} /></i>
      <small>{lost > 0 ? `Уцелело ${Math.round(left * 100)}% состава` : 'Без потерь'}</small>
    </div>
  );
}

function BattleOutcome({
  report,
  maxRounds,
  attackerFactionId,
  defenderFactionId,
  target,
  onDetails,
}: {
  report: BattleReport;
  maxRounds: number;
  attackerFactionId: CombatFactionId;
  defenderFactionId: CombatFactionId;
  target: LootTarget | null;
  onDetails: () => void;
}) {
  const debris = useMemo(() => calculateAttackDebris(report, attackerFactionId, defenderFactionId), [report, attackerFactionId, defenderFactionId]);
  // No planet behind a hand-built defender: a bottomless target shows what the survivors' holds can carry.
  const hold = useMemo(() => calculateAttackLoot(report, { metal: Number.MAX_SAFE_INTEGER, minerals: 0, gas: 0 }, attackerFactionId).metal, [report, attackerFactionId]);
  const loot = useMemo(() => (target ? calculateAttackLoot(report, target.resources, attackerFactionId) : null), [report, target, attackerFactionId]);
  return (
    <div className="simx-outcome" data-qa-sim-result data-qa-sim-winner={report.winner}>
      <div className={`simx-verdict is-${report.winner}`} role="status">
        <small>Итог боя</small>
        <strong>{WINNER_TITLE[report.winner]}</strong>
        <span data-qa-sim-rounds>Раунд {report.roundCount} из {maxRounds}</span>
      </div>
      <ForceOutcome name="Атакующий" tone="attacker" force={report.attackerForce} />
      <ForceOutcome name="Защитник" tone="defender" force={report.defenderForce} />
      <div className="simx-gain" data-qa-sim-debris>
        <span className="simx-gain__title">Обломки</span>
        <span className="simx-gain__line"><ResourceIcon kind="debris" /><strong><CountUp value={debris} /></strong></span>
      </div>
      <div className="simx-gain" data-qa-sim-loot>
        <span className="simx-gain__title">{target ? `Добыча: ${target.name}` : 'Добыча'}</span>
        {report.winner !== 'attacker' ? <small>Только при победе атакующего</small> : loot ? (['metal', 'minerals', 'gas'] as const).map((kind) => (
          <span className="simx-gain__line" key={kind}><ResourceIcon kind={kind} /><strong><CountUp value={loot[kind]} /></strong></span>
        )) : <><span className="simx-gain__line"><strong><CountUp value={hold} /></strong></span><small>столько увезут трюмы уцелевших</small></>}
      </div>
      <button type="button" className="simx-ghost simx-outcome__more" data-qa-sim-details onClick={onDetails}>Подробный отчёт по раундам</button>
    </div>
  );
}

export function SimulatorView({ planetId, planetName, coords, saveState, onBack, initialScenario }: { planetId: string; planetName: string; coords: string; saveState: SaveState; onBack: () => void; initialScenario?: SimulatorScenario | null }) {
  const initialPersistence = useMemo(() => readSimulatorState(undefined, ACTIVE_RUNTIME_MODE), []);
  const [scenario, setScenario] = useState<SimulatorScenario>(() => {
    if (initialScenario) return initialScenario;
    if (initialPersistence.lastScenario) return initialPersistence.lastScenario;
    const savedTechnologyProfiles = readSavedCombatTechnologyProfiles(undefined, ACTIVE_RUNTIME_MODE);
    const empty = createEmptySimulatorScenario();
    return {
      ...empty,
      attackerTechnologies: savedTechnologyProfiles.attacker,
      defenderTechnologies: savedTechnologyProfiles.defender,
    };
  });
  const [simulatorState, setSimulatorState] = useState<SimulatorState>(initialPersistence);
  const [technologiesOpen, setTechnologiesOpen] = useState<Record<ScenarioSide, boolean>>({ attacker: false, defender: false });
  const [presetName, setPresetName] = useState('');
  const [selectedPresetId, setSelectedPresetId] = useState('');
  const [result, setResult] = useState<BattleReport | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [lootTarget, setLootTarget] = useState<LootTarget | null>(null);
  const [notice, setNotice] = useState('Готов к расчёту.');
  const resetRevision = useRef(0);
  const closeDetails = useCallback(() => setDetailsOpen(false), []);
  const spyReports = useMemo(() => simulatorSpyReports(saveState), [saveState.espionage?.reports, saveState.profile.playerId]);

  const updateScenario = (next: SetStateAction<SimulatorScenario>) => {
    setScenario(next);
    setResult(null);
  };

  const attackerFactionId = normalizeCombatFactionId(scenario.attackerFactionId);
  const defenderFactionId = normalizeCombatFactionId(scenario.defenderFactionId);
  // Satellites never fly: as in a real attack they can only stand on the defending side (SAT-01).
  const attackerShips = useMemo(() => getFactionShipCatalog(attackerFactionId).filter((entity) => entity.id !== SOLAR_SATELLITE_ID), [attackerFactionId]);
  const defenderShips = useMemo(() => getFactionShipCatalog(defenderFactionId), [defenderFactionId]);
  const defenderDefenses = useMemo(() => getFactionDefenseCatalog(defenderFactionId), [defenderFactionId]);
  const population = useMemo(() => calculateScenarioPopulation(scenario), [scenario]);

  const validationInput = useMemo(() => scenarioToCombatInput({ ...scenario, executionMode: 'production' }, {
    scenarioId: 'simulator-validation',
    timestamp: '2026-01-01T00:00:00.000Z',
    attacker: { playerId: 'sim-attacker', playerName: 'Атакующий', planetName, coordinates: coords, side: 'attacker' },
    defender: { playerId: 'sim-defender', playerName: 'Защитник', planetName: 'Цель симулятора', coordinates: '[SIM]', side: 'defender' },
    priority: createDefaultCombatPriority(),
  }), [scenario, planetName, coords, attackerFactionId, defenderFactionId]);
  const validation = useMemo(() => validateCombatInput(validationInput), [validationInput]);
  const validationErrorId = 'sim-validation-errors';
  const hasValidationError = (path: string) => validation.errors.some((error) => error.path === path || error.path.startsWith(`${path}.`) || error.path.startsWith(`${path}[`));
  const hasSideCategoryError = (side: ScenarioSide, category: ScenarioCategory) => {
    const path = category === 'commanders' ? `${side}.commander` : `${side}.${category}`;
    return hasValidationError(side) || hasValidationError(path);
  };

  useEffect(() => {
    const onRuntimeReset = () => {
      resetRevision.current += 1;
      // Reset is dispatched before App replaces the envelope. Do not read the
      // old simulator payload from storage during that invalidation window.
      const next = createDefaultSimulatorState();
      setSimulatorState(next);
      setScenario(next.lastScenario ?? createEmptySimulatorScenario());
      setResult(null);
      setSelectedPresetId('');
      setNotice('Симулятор сброшен.');
    };
    window.addEventListener(RUNTIME_RESET_EVENT, onRuntimeReset);
    return () => window.removeEventListener(RUNTIME_RESET_EVENT, onRuntimeReset);
  }, []);

  useEffect(() => {
    const revision = resetRevision.current;
    const timer = window.setTimeout(() => {
      if (revision !== resetRevision.current) return;
      const next = withLastScenario(readSimulatorState(undefined, ACTIVE_RUNTIME_MODE), scenario);
      const persisted = persistSimulatorState(next, undefined, ACTIVE_RUNTIME_MODE);
      if (persisted.ok) setSimulatorState(persisted.value);
    }, 140);
    return () => window.clearTimeout(timer);
  }, [scenario]);

  // The whole screen fits the window and only the fleet lists scroll, so the outcome
  // cannot leave the screen. Sticky cannot do this here: the stage is scaled by a
  // transform, and a sticky element drifts away at any scale but 1.
  const arenaRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const measure = () => {
      const arena = arenaRef.current;
      if (!arena) return;
      const rect = arena.getBoundingClientRect();
      const scale = rect.width / Math.max(1, arena.offsetWidth);
      const free = (window.innerHeight - rect.top - window.scrollY) / scale - 44;
      arena.style.setProperty('--simx-height', `${Math.max(440, Math.floor(free))}px`);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  const toggleTechnologies = (side: ScenarioSide) => setTechnologiesOpen((current) => ({ ...current, [side]: !current[side] }));

  const clearSide = (side: ScenarioSide) => {
    if (side === 'defender') setLootTarget(null);
    updateScenario((current) => side === 'attacker'
      ? {
          ...current,
          attacker: {
            ...current.attacker,
            ships: [],
            commanders: [],
            commander: null,
            activeCommanderId: null,
          },
        }
      : {
          ...current,
          defender: {
            ...current.defender,
            ships: [],
            commanders: [],
            commander: null,
            defenses: [],
            activeCommanderId: null,
          },
        });
    setNotice(side === 'attacker' ? 'Атакующая сторона очищена.' : 'Защищающаяся сторона очищена.');
  };

  const fillFromPlanet = (side: ScenarioSide) => {
    const filled = simulatorSideFromPlanet(saveState, planetId, side === 'defender');
    if (!filled.ships.length && !filled.commanders.length && !filled.defenses.length) {
      setNotice(`На планете ${planetName} сейчас нет кораблей${side === 'defender' ? ' и обороны' : ''}.`);
      return;
    }
    const { factionId, technologies, ...units } = filled;
    updateScenario((current) => {
      const raced = setScenarioFaction(current, side, factionId);
      return side === 'attacker'
        ? { ...raced, attackerTechnologies: technologies, technologyMode: 'independent', executionMode: 'production', attacker: { ...raced.attacker, ships: units.ships, commanders: units.commanders, commander: units.commander, activeCommanderId: units.activeCommanderId } }
        : { ...raced, defenderTechnologies: technologies, technologyMode: 'independent', executionMode: 'production', defender: { ...raced.defender, ...units } };
    });
    if (side === 'defender') setLootTarget(null);
    setNotice(`${side === 'attacker' ? 'Атакующий' : 'Защитник'}: состав, уровни и науки взяты с планеты ${planetName}.`);
  };

  const fillFromReport = (reportId: string) => {
    const report = spyReports.find((item) => item.id === reportId);
    if (!report) return;
    const filled = createSimulatorScenarioFromSpyReport(saveState, report);
    updateScenario((current) => ({
      ...current,
      defenderFactionId: filled.defenderFactionId,
      defenderTechnologies: filled.defenderTechnologies,
      technologyMode: 'independent',
      executionMode: 'production',
      defender: filled.defender,
    }));
    setLootTarget({ name: report.targetPlanetName, resources: report.resources });
    setNotice(`Защитник собран по отчёту разведки: ${report.targetPlanetName}.`);
  };

  const changeFaction = (side: ScenarioSide, factionId: CombatFactionId) => {
    if (side === 'defender') setLootTarget(null);
    updateScenario((current) => setScenarioFaction(current, side, factionId));
    const sideLabel = side === 'attacker' ? 'атакующего' : 'защитника';
    setNotice(`Раса ${sideLabel} изменена на «${getCombatFactionName(factionId)}». Показан её набор кораблей${side === 'defender' ? ' и обороны' : ''}; состав стороны очищен.`);
  };

  const changeTechnologies = (side: ScenarioSide, levels: CombatTechnologyLevels) => {
    updateScenario((current) => side === 'attacker'
      ? { ...current, attackerTechnologies: levels, technologyMode: 'independent', executionMode: 'production' }
      : { ...current, defenderTechnologies: levels, technologyMode: 'independent', executionMode: 'production' });
    setNotice(`Технологии ${side === 'attacker' ? 'атакующего' : 'защитника'} изменены.`);
  };

  const copyAttackerTechnologies = () => {
    const copied = normalizeCombatTechnologies(scenario.attackerTechnologies);
    updateScenario((current) => ({
      ...current,
      defenderTechnologies: { ...copied },
      technologyMode: 'shared',
      executionMode: 'production',
    }));
    setNotice('Технологии атакующего скопированы защитнику для этого расчёта.');
  };

  const clearAll = () => {
    setLootTarget(null);
    updateScenario(createEmptySimulatorScenario());
    setNotice('Сценарий очищен. Обе стороны возвращены к расе «Астеры», технологии — к уровню 0.');
  };

  const runSimulation = () => {
    const timestamp = new Date().toISOString();
    const combatInput = scenarioToCombatInput({
      ...scenario,
      executionMode: 'production',
      seed: scenario.seed?.trim() || undefined,
    }, {
      scenarioId: nextIdentity('scenario'),
      timestamp,
      attacker: { playerId: 'sim-attacker', playerName: 'Атакующий', planetName, coordinates: coords, side: 'attacker' },
      defender: { playerId: 'sim-defender', playerName: 'Защитник', planetName: 'Цель симулятора', coordinates: '[SIM]', side: 'defender' },
      priority: createDefaultCombatPriority(),
    });
    const checked = validateCombatInput(combatInput);
    if (!checked.ok) {
      setNotice(checked.errors[0]?.message ?? 'Сценарий не прошёл валидацию.');
      return;
    }
    const report = resolveCombat(checked.value, { reportId: nextIdentity('simulation') });
    setResult(report);
    setDetailsOpen(false);
    setNotice(`Расчёт завершён: ${report.roundCount} раунд(ов), результат — ${report.winner === 'draw' ? 'ничья' : report.winner === 'attacker' ? 'победа атакующего' : 'победа защитника'}.`);
  };

  const savePreset = () => {
    const name = presetName.trim() || `Сценарий ${simulatorState.presets.length + 1}`;
    const preset = { id: nextIdentity('preset'), name, createdAt: new Date().toISOString(), input: scenario };
    const next = upsertSimulatorPreset(readSimulatorState(undefined, ACTIVE_RUNTIME_MODE), preset);
    const persisted = persistSimulatorState(next, undefined, ACTIVE_RUNTIME_MODE);
    if (persisted.ok) {
      setSimulatorState(persisted.value);
      setSelectedPresetId(preset.id);
      setPresetName('');
      setNotice(`Сценарий «${preset.name}» сохранён.`);
    } else setNotice(`Ошибка: ${persisted.error}`);
  };

  const loadPreset = () => {
    const preset = simulatorState.presets.find((item) => item.id === selectedPresetId);
    if (!preset) return;
    setLootTarget(null);
    updateScenario(preset.input);
    setNotice(`Сценарий «${preset.name}» загружен.`);
  };

  const deletePreset = () => {
    if (!selectedPresetId) return;
    const preset = simulatorState.presets.find((item) => item.id === selectedPresetId);
    const next = deleteSimulatorPreset(readSimulatorState(undefined, ACTIVE_RUNTIME_MODE), selectedPresetId);
    const persisted = persistSimulatorState(next, undefined, ACTIVE_RUNTIME_MODE);
    if (persisted.ok) {
      setSimulatorState(persisted.value);
      setSelectedPresetId('');
      setNotice(preset ? `Сценарий «${preset.name}» удалён.` : 'Сценарий удалён.');
    } else setNotice(`Ошибка: ${persisted.error}`);
  };

  const changeActiveCommander = (side: ScenarioSide, commanderId: CommanderId | null) => {
    updateScenario((current) => {
      const currentCommanders = getStacks(current, side, 'commanders');
      const selected = commanderId
        ? currentCommanders.find((stack) => stack.entityId === commanderId && stack.count > 0) ?? null
        : null;
      if (commanderId && !selected) return current;
      return side === 'attacker'
        ? { ...current, attacker: { ...current.attacker, commander: selected, activeCommanderId: commanderId } }
        : { ...current, defender: { ...current.defender, commander: selected, activeCommanderId: commanderId } };
    });
    setNotice(commanderId ? 'Ведущий командир выбран. Остальные командирские корабли остаются в составе.' : 'Ведущий командир снят. Командирские корабли остаются в составе.');
  };

  return (
    <section className="simulator-view-v1 simx">
      <header className="simx-head">
        <div className="simx-head__title">
          <h2>Симулятор</h2>
          <p>{planetName} {coords}</p>
        </div>
        <div className="simx-scenarios" aria-label="Сценарии симулятора" role="group">
          <GameSelect
            className="simx-scenarios__list"
            label="Сохранённые сценарии"
            value={selectedPresetId}
            options={simulatorState.presets.map((preset) => ({ value: preset.id, label: preset.name }))}
            placeholder={simulatorState.presets.length ? 'Выбрать сценарий' : 'Сохранённых сценариев нет'}
            disabled={!simulatorState.presets.length}
            selectProps={{ id: 'sim-preset-select' }}
            onChange={setSelectedPresetId}
          />
          <button type="button" className="simx-ghost" data-qa-sim-load disabled={!selectedPresetId} onClick={loadPreset}>Загрузить</button>
          <button type="button" className="simx-ghost" data-qa-sim-delete disabled={!selectedPresetId} onClick={deletePreset}>Удалить</button>
          <input id="sim-preset-name" aria-label="Имя сценария" value={presetName} maxLength={48} placeholder="Имя нового сценария" onChange={(event) => setPresetName(event.target.value)} />
          <button type="button" className="simx-ghost" data-qa-sim-save onClick={savePreset}>Сохранить</button>
        </div>
        <button type="button" className="simx-ghost" data-qa-sim-clear-all onClick={clearAll}>Очистить всё</button>
        <button type="button" className="simx-close" aria-label="Закрыть симулятор" data-asterion-close onClick={onBack}><i aria-hidden="true" /></button>
      </header>

      <div className="simx-arena" ref={arenaRef}>
        <section className="simx-side is-attacker" data-qa-sim-side="attacker">
          <header className="simx-side__head">
            <h3>Атакующий</h3>
            <div className="simx-side__fill">
              <button type="button" className="simx-ghost" data-qa-sim-fill-planet="attacker" onClick={() => fillFromPlanet('attacker')}>Флот с планеты</button>
              <button type="button" className="simx-ghost" data-qa-sim-clear="attacker" onClick={() => clearSide('attacker')}>Очистить</button>
            </div>
          </header>
          <SideStrip side="attacker" scenario={scenario} factionId={attackerFactionId} technologyCount={activeTechnologies(scenario.attackerTechnologies)} technologyId="sim-attacker-technologies" technologiesOpen={technologiesOpen.attacker} onFaction={(factionId) => changeFaction('attacker', factionId)} onCommander={(commanderId) => changeActiveCommander('attacker', commanderId)} onToggleTechnologies={() => toggleTechnologies('attacker')} />
          <div className="simx-side__list">
          <TechnologyPanel id="sim-attacker-technologies" open={technologiesOpen.attacker} levels={scenario.attackerTechnologies} invalid={hasValidationError('attackerTechnologies')} errorId={validationErrorId} onChange={(levels) => changeTechnologies('attacker', levels)} />
          <UnitGroup id="sim-attacker-ships" title={`Корабли · ${getCombatFactionName(attackerFactionId)}`} meter={{ label: 'Флот', value: population.attackerFleet, max: SIMULATOR_POPULATION_LIMITS.attackerFleet }} entities={attackerShips} scenario={scenario} side="attacker" category="ships" technologies={scenario.attackerTechnologies} report={result} invalid={hasSideCategoryError('attacker', 'ships')} errorId={validationErrorId} onScenario={updateScenario} />
          <UnitGroup id="sim-attacker-commanders" title="Командирские" meter={{ label: 'В лимите флота', value: population.attackerCommander, max: SIMULATOR_POPULATION_LIMITS.attackerFleet }} entities={COMMANDER_COMBAT_CATALOG} scenario={scenario} side="attacker" category="commanders" technologies={scenario.attackerTechnologies} report={result} invalid={hasSideCategoryError('attacker', 'commanders')} errorId={validationErrorId} onScenario={updateScenario} />
          </div>
        </section>

        <aside className="simx-core">
          <div className="simx-rounds" role="group" aria-label="Максимум раундов">
            <span>Раундов не больше</span>
            <div>
              {SIMULATOR_MAX_ROUNDS.map((rounds) => (
                <button key={rounds} type="button" className={scenario.maxRounds === rounds ? 'is-on' : ''} aria-pressed={scenario.maxRounds === rounds} onClick={() => updateScenario((current) => ({ ...current, maxRounds: rounds }))}>{rounds}</button>
              ))}
            </div>
          </div>
          <button type="button" className="sim-run-v1 simx-run" disabled={!validation.ok} onClick={runSimulation}>{result ? 'Рассчитать ещё раз' : 'Рассчитать бой'}</button>
          {result ? (
            <BattleOutcome key={result.id} report={result} maxRounds={scenario.maxRounds} attackerFactionId={attackerFactionId} defenderFactionId={defenderFactionId} target={lootTarget} onDetails={() => setDetailsOpen(true)} />
          ) : validation.ok ? (
            <p className="simx-idle">Обе стороны готовы. Итог появится здесь: победитель, потери, обломки и добыча.</p>
          ) : (
            <ul id={validationErrorId} className="simx-errors">
              {[...new Set(validation.errors.map((error) => error.message))].slice(0, 4).map((message) => <li key={message}>{message}</li>)}
            </ul>
          )}
          {result ? null : <p className="simx-notice" aria-live="polite">{notice}</p>}
        </aside>

        <section className="simx-side is-defender" data-qa-sim-side="defender">
          <header className="simx-side__head">
            <h3>Защитник</h3>
            <div className="simx-side__fill">
              <GameSelect
                className="simx-side__report"
                label="Защитник из отчёта разведки"
                value=""
                options={spyReports.map((report) => ({ value: report.id, label: report.targetPlanetName, hint: `[${report.targetCoordinate.galaxy}:${report.targetCoordinate.system}:${report.targetCoordinate.position}] · ${report.targetOwnerName}` }))}
                placeholder={spyReports.length ? 'Из отчёта разведки' : 'Отчётов разведки нет'}
                disabled={!spyReports.length}
                selectProps={{ 'data-qa-sim-fill-report': true }}
                onChange={fillFromReport}
              />
              <button type="button" className="simx-ghost" data-qa-sim-fill-planet="defender" onClick={() => fillFromPlanet('defender')}>С планеты</button>
              <button type="button" className="simx-ghost" data-qa-sim-clear="defender" onClick={() => clearSide('defender')}>Очистить</button>
            </div>
          </header>
          <SideStrip side="defender" scenario={scenario} factionId={defenderFactionId} technologyCount={activeTechnologies(scenario.defenderTechnologies)} technologyId="sim-defender-technologies" technologiesOpen={technologiesOpen.defender} onFaction={(factionId) => changeFaction('defender', factionId)} onCommander={(commanderId) => changeActiveCommander('defender', commanderId)} onToggleTechnologies={() => toggleTechnologies('defender')} />
          <div className="simx-side__list">
          <TechnologyPanel id="sim-defender-technologies" open={technologiesOpen.defender} levels={scenario.defenderTechnologies} invalid={hasValidationError('defenderTechnologies')} errorId={validationErrorId} onCopy={copyAttackerTechnologies} onChange={(levels) => changeTechnologies('defender', levels)} />
          <UnitGroup id="sim-defender-ships" title={`Корабли · ${getCombatFactionName(defenderFactionId)}`} meter={{ label: 'Флот', value: population.defenderFleet, max: SIMULATOR_POPULATION_LIMITS.defenderFleet }} entities={defenderShips} scenario={scenario} side="defender" category="ships" technologies={scenario.defenderTechnologies} report={result} invalid={hasSideCategoryError('defender', 'ships')} errorId={validationErrorId} onScenario={updateScenario} />
          <UnitGroup id="sim-defender-commanders" title="Командирские" meter={{ label: 'В лимите флота', value: population.defenderCommander, max: SIMULATOR_POPULATION_LIMITS.defenderFleet }} entities={COMMANDER_COMBAT_CATALOG} scenario={scenario} side="defender" category="commanders" technologies={scenario.defenderTechnologies} report={result} invalid={hasSideCategoryError('defender', 'commanders')} errorId={validationErrorId} onScenario={updateScenario} />
          <UnitGroup id="sim-defender-defenses" title={`Оборона · ${getCombatFactionName(defenderFactionId)}`} meter={{ label: 'Оборона', value: population.defenderDefense, max: SIMULATOR_POPULATION_LIMITS.defenderDefense }} entities={defenderDefenses} scenario={scenario} side="defender" category="defenses" technologies={scenario.defenderTechnologies} report={result} invalid={hasSideCategoryError('defender', 'defenses')} errorId={validationErrorId} onScenario={updateScenario} />
          </div>
        </section>
      </div>

      {result && detailsOpen ? <BattleReportModal report={result} context="simulation" onClose={closeDetails} /> : null}
    </section>
  );
}
