import { useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from 'react';

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
import type { BattleReport } from './domain/combat/report.ts';
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
import './simulator.css';
import { MISSION_BANNERS } from './ui/ui-art.ts';
import type { CSSProperties } from 'react';

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

type ExpandedState = {
  attackerShips: boolean;
  attackerCommanders: boolean;
  attackerTechnologies: boolean;
  defenderShips: boolean;
  defenderCommanders: boolean;
  defenderDefenses: boolean;
  defenderTechnologies: boolean;
};

const DEFAULT_EXPANDED: ExpandedState = {
  attackerShips: true,
  attackerCommanders: false,
  attackerTechnologies: false,
  defenderShips: true,
  defenderCommanders: false,
  defenderDefenses: false,
  defenderTechnologies: false,
};

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

function NumberStepper({
  value,
  min,
  max,
  label,
  invalid,
  errorId,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  label: string;
  invalid?: boolean;
  errorId?: string;
  onChange: (value: number) => void;
}) {
  const update = (next: number) => onChange(Math.min(max, Math.max(min, Math.floor(next))));
  return (
    <span className="sim-number-stepper-v1">
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        aria-label={label}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={invalid ? errorId : undefined}
        onChange={(event) => {
          const next = Number(event.target.value);
          update(Number.isFinite(next) ? next : min);
        }}
      />
      <span className="sim-number-stepper-arrows-v1">
        <button type="button" aria-label={`Увеличить: ${label}`} disabled={value >= max} onClick={() => update(value + 1)}>↑</button>
        <button type="button" aria-label={`Уменьшить: ${label}`} disabled={value <= min} onClick={() => update(value - 1)}>↓</button>
      </span>
    </span>
  );
}

function UnitRow({
  entity,
  count,
  max,
  level,
  levelMax,
  showLevel,
  preview,
  ability,
  invalid,
  errorId,
  onChange,
  onLevelChange,
}: {
  entity: CatalogEntity;
  count: number;
  max: number;
  level: number;
  levelMax: number;
  showLevel: boolean;
  preview?: CombatStackPreview;
  ability?: string;
  invalid?: boolean;
  errorId?: string;
  onChange: (count: number) => void;
  onLevelChange: (level: number) => void;
}) {
  return (
    <div className="sim-unit-row-v1" data-qa-simulator-unit={entity.id}>
      <img src={entity.art} alt="" draggable={false} />
      <div className="sim-unit-copy-v1">
        <strong>{entity.name}</strong>
        <span>{entity.role}</span>
        <small>Население: {entity.population} · Оружие: {entity.combat.weaponType} · Броня: {entity.combat.armorType}</small>
        {ability ? <em>Способность: {ability}</em> : null}
        {preview ? <em className="sim-unit-stats-v1">Атака группы: {formatNumber(preview.totalAttack)} · Жизнь группы: {formatNumber(preview.hpPool)}</em> : null}
      </div>
      <div className="sim-unit-controls-v1">
        <label className="sim-count-control-v1">
          <span>КОЛИЧЕСТВО</span>
          <NumberStepper value={count} min={0} max={max} label={`Количество ${entity.name}`} invalid={invalid} errorId={errorId} onChange={onChange} />
        </label>
        {showLevel ? (
          <label className="sim-level-control-v1">
            <span>УРОВЕНЬ</span>
            <NumberStepper value={level} min={0} max={levelMax} label={`Уровень ${entity.name}`} invalid={invalid} errorId={errorId} onChange={onLevelChange} />
          </label>
        ) : null}
      </div>
    </div>
  );
}

function UnitSection({
  id,
  title,
  open,
  entities,
  scenario,
  side,
  category,
  technologies,
  executionMode,
  invalid,
  errorId,
  onToggle,
  onScenario,
}: {
  id: string;
  title: string;
  open: boolean;
  entities: readonly CatalogEntity[];
  scenario: SimulatorScenario;
  side: ScenarioSide;
  category: ScenarioCategory;
  technologies?: CombatTechnologyLevels;
  executionMode?: 'production' | 'calibration';
  invalid?: boolean;
  errorId?: string;
  onToggle: () => void;
  onScenario: (scenario: SimulatorScenario) => void;
}) {
  const stacks = getStacks(scenario, side, category);
  const previewStacks = [
    ...getStacks(scenario, side, 'ships'),
    ...getStacks(scenario, side, 'commanders'),
    ...getStacks(scenario, side, 'defenses'),
  ];
  const selected = stacks.reduce((total, stack) => total + stack.count, 0);
  const activeCommanderId = scenario[side].activeCommanderId ?? null;
  return (
    <section className={`sim-unit-section-v1 ${open ? 'open' : ''}`}>
      <button type="button" className="sim-section-toggle-v1" aria-expanded={open} aria-controls={id} onClick={onToggle}>
        <span><strong>{title}</strong><small>{selected ? `Выбрано: ${formatNumber(selected)}` : 'Не выбрано'}</small></span>
        <b aria-hidden="true">{open ? '−' : '+'}</b>
      </button>
      <div id={id} className="sim-unit-list-v1" hidden={!open}>
        {open ? entities.map((entity) => {
          const count = getCount(scenario, side, category, entity.id);
          const previewStack = stacks.find((stack) => stack.entityId === entity.id);
          const preview = previewStack && technologies
            ? calculateCombatStackPreview(
                previewStack,
                normalizeCombatFactionId(side === 'attacker' ? scenario.attackerFactionId : scenario.defenderFactionId),
                technologies,
                executionMode ?? 'production',
                previewStacks,
                activeCommanderId,
              ) ?? undefined
            : undefined;
          return (
            <UnitRow
              key={entity.id}
              entity={entity}
              count={count}
              max={maxForEntity(scenario, side, category, entity)}
              level={getStacks(scenario, side, category).find((stack) => stack.entityId === entity.id)?.level ?? 0}
              levelMax={COMBAT_ENTITY_LEVEL_LIMITS[entity.kind]}
              showLevel={entity.kind !== 'defense'}
              preview={preview}
              ability={entity.kind === 'commander' ? COMMANDER_ABILITIES[entity.id as CommanderId].ability : undefined}
              invalid={invalid}
              errorId={errorId}
              onChange={(next) => onScenario(replaceStackCount(scenario, side, category, entity.id, Math.min(maxForEntity(scenario, side, category, entity), next)))}
              onLevelChange={(next) => onScenario(replaceStackLevel(scenario, side, category, entity.id, next))}
            />
          );
        }) : null}
      </div>
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

function TechnologySection({
  id,
  open,
  levels,
  invalid,
  errorId,
  onToggle,
  onChange,
}: {
  id: string;
  open: boolean;
  levels?: CombatTechnologyLevels;
  invalid?: boolean;
  errorId?: string;
  onToggle: () => void;
  onChange: (levels: CombatTechnologyLevels) => void;
}) {
  const normalized = useMemo(() => normalizeCombatTechnologies(levels), [levels]);
  const activeCount = COMBAT_TECHNOLOGIES.filter((technology) => normalized[technology.id] > 0).length;

  const updateLevel = (technologyId: CombatTechnologyId, nextValue: number) => {
    const nextLevel = normalizeTechnologyLevel(technologyId, nextValue);
    const exclusiveIds: readonly CombatTechnologyId[] = ['piercingAttack', 'maneuverDefense', 'criticalHit'];
    const nextLevels = { ...normalized, [technologyId]: nextLevel };
    if (nextLevel > 0 && exclusiveIds.includes(technologyId)) {
      exclusiveIds.forEach((id) => {
        if (id !== technologyId) nextLevels[id] = 0;
      });
    }
    onChange({
      ...nextLevels,
    });
  };

  return (
    <section className={`sim-unit-section-v1 sim-tech-section-v1 ${open ? 'open' : ''}`}>
      <button type="button" className="sim-section-toggle-v1" aria-expanded={open} aria-controls={id} onClick={onToggle}>
        <span><strong>ТЕХНОЛОГИИ</strong><small>{activeCount ? `Активно: ${activeCount}` : 'Все уровни 0'}</small></span>
        <b aria-hidden="true">{open ? '−' : '+'}</b>
      </button>
      <div id={id} className="sim-tech-list-v1" hidden={!open}>
        {open ? COMBAT_TECHNOLOGIES.map((technology) => {
          const level = normalized[technology.id];
          return (
            <div className="sim-tech-row-v1" key={technology.id} data-qa-simulator-technology={technology.id}>
              <img src={COMBAT_TECHNOLOGY_ART[technology.id]} alt="" draggable={false} />
              <div>
                <strong>{technology.name}</strong>
                <small>{technology.effect}</small>
              </div>
              <div className="sim-tech-controls-v1">
                <NumberStepper value={level} min={0} max={technology.maxLevel} label={`${technology.name}, уровень`} invalid={invalid} errorId={errorId} onChange={(next) => updateLevel(technology.id, next)} />
              </div>
            </div>
          );
        }) : null}
      </div>
    </section>
  );
}

function PopulationMeter({ label, value, max }: { label: string; value: number; max: number }) {
  const overflow = value > max;
  const available = Math.max(0, max - value);
  return (
    <div className={`sim-population-v1 ${overflow ? 'error' : ''}`}>
      <span>{label}</span>
      <div>
        <strong>{formatNumber(value)} / {formatNumber(max)}</strong>
        <small>Свободно: {formatNumber(available)}</small>
      </div>
    </div>
  );
}

function CommanderSelector({
  side,
  scenario,
  onChange,
}: {
  side: ScenarioSide;
  scenario: SimulatorScenario;
  onChange: (commanderId: CommanderId | null) => void;
}) {
  const selected = selectedCommanders(scenario, side);
  const active = scenario[side].activeCommanderId;
  const activeEntity = COMMANDER_COMBAT_CATALOG.find((entity) => entity.id === active);
  const selectedLabel = selected.length === 0
    ? 'Нет ведущего командира'
    : activeEntity
      ? `Ведущий: ${activeEntity.name}`
      : 'Выбери ведущего командира';
  return (
    <label className="sim-commander-select-v1" htmlFor={`sim-leading-commander-${side}`}>
      <span>ВЕДУЩИЙ КОМАНДИР</span>
      <select
        id={`sim-leading-commander-${side}`}
        data-qa-simulator-leading-commander={side}
        value={active ?? ''}
        onChange={(event) => onChange(event.target.value ? event.target.value as CommanderId : null)}
        aria-describedby={`sim-leading-commander-help-${side}`}
      >
        <option value="">{selectedLabel}</option>
        {selected.map((stack) => {
          const entity = COMMANDER_COMBAT_CATALOG.find((item) => item.id === stack.entityId);
          return entity ? <option key={entity.id} value={entity.id}>{entity.name}</option> : null;
        })}
      </select>
      <small id={`sim-leading-commander-help-${side}`}>Добавь по одному кораблю каждого типа в разделе «Командирские». Здесь выбери ведущего; остальные командирские корабли тоже участвуют в бою.</small>
    </label>
  );
}

function RaceSelector({ id, label, value, onChange }: { id: string; label: string; value?: CombatFactionId; onChange: (factionId: CombatFactionId) => void }) {
  return (
    <label className="sim-race-v1" htmlFor={id}>
      <span>{label}</span>
      <select id={id} value={value ?? 'aegis'} onChange={(event) => onChange(event.target.value as CombatFactionId)}>
        {COMBAT_FACTIONS.map((faction) => <option key={faction.id} value={faction.id}>{faction.name}</option>)}
      </select>
    </label>
  );
}

export function SimulatorView({ planetName, coords, onBack, initialScenario }: { planetName: string; coords: string; onBack: () => void; initialScenario?: SimulatorScenario | null }) {
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
  const [expanded, setExpanded] = useState<ExpandedState>(DEFAULT_EXPANDED);
  const [presetName, setPresetName] = useState('');
  const [selectedPresetId, setSelectedPresetId] = useState('');
  const [result, setResult] = useState<BattleReport | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  /** Variant A: each side shows its tiles; the full unit editor opens on «Изменить состав». */
  const [editing, setEditing] = useState<Record<ScenarioSide, boolean>>({ attacker: false, defender: false });
  const [notice, setNotice] = useState('Готов к расчёту.');
  const resetRevision = useRef(0);
  const closeResult = useCallback(() => {
    setDetailsOpen(false);
  }, []);

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

  const toggleExpanded = (key: keyof ExpandedState) => setExpanded((current) => ({ ...current, [key]: !current[key] }));

  const clearSide = (side: ScenarioSide) => {
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

  const changeFaction = (side: ScenarioSide, factionId: CombatFactionId) => {
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
    setEditing({ attacker: false, defender: false });
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

  const sideUnits = (side: ScenarioSide) => {
    const ships = side === 'attacker' ? attackerShips : defenderShips;
    const entityOf = (category: ScenarioCategory, id: string) => category === 'commanders'
      ? COMMANDER_COMBAT_CATALOG.find((entity) => entity.id === id)
      : category === 'defenses' ? defenderDefenses.find((entity) => entity.id === id) : ships.find((entity) => entity.id === id);
    const categories: ScenarioCategory[] = side === 'attacker' ? ['ships', 'commanders'] : ['ships', 'commanders', 'defenses'];
    const force = side === 'attacker' ? result?.attackerForce : result?.defenderForce;
    const after = [...(force?.stacks ?? []), ...(force?.defenses ?? [])];
    return categories.flatMap((category) => getStacks(scenario, side, category)
      .filter((stack) => stack.count > 0)
      .map((stack) => ({ stack, category, entity: entityOf(category, stack.entityId), outcome: after.find((item) => item.entityId === stack.entityId) })))
      .filter((unit) => unit.entity);
  };
  const technologyAverage = (levels: CombatTechnologyLevels | undefined) => {
    const values = Object.values(levels ?? {}).map((value) => Number(value) || 0);
    return values.length ? Math.round(values.reduce((total, value) => total + value, 0) / values.length) : 0;
  };
  const resultTitle = !result ? 'Симулятор боя'
    : result.winner === 'attacker' ? 'Победа атакующего'
      : result.winner === 'defender' ? 'Победа защитника' : 'Ничья';
  const resultTone = !result ? 'is-idle' : result.winner === 'attacker' ? 'is-attacker' : result.winner === 'defender' ? 'is-defender' : 'is-draw';
  const loot = result?.resources ? (result.resources.metal ?? 0) + (result.resources.minerals ?? 0) + (result.resources.gas ?? 0) : 0;
  // An empty side opens its editor and keeps it open while the player types: the first digit
  // must not swap the editor for tiles. «Готово» or a new calculation closes it.
  const attackerEmpty = sideUnits('attacker').length === 0;
  const defenderEmpty = sideUnits('defender').length === 0;
  useEffect(() => {
    if (!attackerEmpty && !defenderEmpty) return;
    setEditing((current) => ({
      attacker: current.attacker || attackerEmpty,
      defender: current.defender || defenderEmpty,
    }));
  }, [attackerEmpty, defenderEmpty]);

  const renderSide = (side: ScenarioSide) => {
    const units = sideUnits(side);
    const open = editing[side] || units.length === 0;
    const factionId = side === 'attacker' ? attackerFactionId : defenderFactionId;
    const technologiesKey = side === 'attacker' ? 'attackerTechnologies' : 'defenderTechnologies';
    return (
      <section className={`sim-side-v1 sim-a-side is-${side}`}>
        <header>
          <div><small>{side === 'attacker' ? 'СТОРОНА 01' : 'СТОРОНА 02'}</small><h3>{side === 'attacker' ? 'Атакующий' : 'Защитник'}</h3></div>
          <div className="sim-a-chips">
            <RaceSelector id={`sim-${side}-race`} label={side === 'attacker' ? 'РАСА АТАКУЮЩЕГО' : 'РАСА ЗАЩИТНИКА'} value={factionId} onChange={(next) => changeFaction(side, next)} />
            <CommanderSelector side={side} scenario={scenario} onChange={(commanderId) => changeActiveCommander(side, commanderId)} />
            <button type="button" className={`sim-a-chip${expanded[technologiesKey] ? ' is-on' : ''}`} aria-expanded={expanded[technologiesKey]} aria-controls={`sim-${side}-technologies`} onClick={() => toggleExpanded(technologiesKey)}>Науки {technologyAverage(side === 'attacker' ? scenario.attackerTechnologies : scenario.defenderTechnologies)}</button>
            <button type="button" className={`sim-a-chip${open ? ' is-on' : ''}`} aria-pressed={open} onClick={() => setEditing((current) => ({ ...current, [side]: !open }))}>{open && units.length ? 'Готово' : 'Изменить состав'}</button>
            <button type="button" className="sim-a-chip" onClick={() => clearSide(side)}>Очистить</button>
          </div>
        </header>
        <div className="sim-a-meters">
          {side === 'attacker' ? <>
            <PopulationMeter label="ФЛОТ АТАКУЮЩЕГО" value={population.attackerFleet} max={SIMULATOR_POPULATION_LIMITS.attackerFleet} />
            <PopulationMeter label="КОМАНДИР АТАКУЮЩЕГО · В ЛИМИТЕ ФЛОТА" value={population.attackerCommander} max={SIMULATOR_POPULATION_LIMITS.attackerFleet} />
          </> : <>
            <PopulationMeter label="ФЛОТ ЗАЩИТНИКА" value={population.defenderFleet} max={SIMULATOR_POPULATION_LIMITS.defenderFleet} />
            <PopulationMeter label="КОМАНДИР ЗАЩИТНИКА · В ЛИМИТЕ ФЛОТА" value={population.defenderCommander} max={SIMULATOR_POPULATION_LIMITS.defenderFleet} />
            <PopulationMeter label="ОБОРОНА ЗАЩИТНИКА" value={population.defenderDefense} max={SIMULATOR_POPULATION_LIMITS.defenderDefense} />
          </>}
        </div>
        <TechnologySection id={`sim-${side}-technologies`} open={expanded[technologiesKey]} levels={side === 'attacker' ? scenario.attackerTechnologies : scenario.defenderTechnologies} invalid={hasValidationError(technologiesKey)} errorId={validationErrorId} onToggle={() => toggleExpanded(technologiesKey)} onChange={(levels) => changeTechnologies(side, levels)} />
        {side === 'defender' && expanded.defenderTechnologies ? <button type="button" className="sim-copy-tech-v1" onClick={copyAttackerTechnologies}>Взять науки атакующего</button> : null}
        {units.length && !open ? <div className="sim-a-tiles" data-qa-simulator-tiles={side}>
          {units.map(({ stack, entity, outcome }, index) => {
            const lost = outcome ? outcome.destroyed : 0;
            const left = outcome ? outcome.countAfter : stack.count;
            return (
              <article key={`${stack.entityId}`} className={`sim-a-tile${outcome && left <= 0 ? ' is-gone' : ''}`} style={{ '--sim-i': index } as CSSProperties}>
                <img src={entity!.art} alt="" draggable={false} />
                <strong>{entity!.name}</strong>
                <b>{formatNumber(stack.count)}</b>
                {outcome ? <em>−{formatNumber(lost)} · осталось {formatNumber(left)}</em> : <small>{entity!.role}</small>}
              </article>
            );
          })}
        </div> : null}
        <div className="sim-a-editor" hidden={!open}>
          {side === 'attacker' ? <>
            <UnitSection id="sim-attacker-ships" title={`КОРАБЛИ · ${getCombatFactionName(attackerFactionId).toUpperCase()}`} open={expanded.attackerShips} entities={attackerShips} scenario={scenario} side="attacker" category="ships" technologies={scenario.attackerTechnologies} executionMode="production" invalid={hasSideCategoryError('attacker', 'ships')} errorId={validationErrorId} onToggle={() => toggleExpanded('attackerShips')} onScenario={updateScenario} />
            <UnitSection id="sim-attacker-commanders" title="КОМАНДИРСКИЕ" open={expanded.attackerCommanders} entities={COMMANDER_COMBAT_CATALOG} scenario={scenario} side="attacker" category="commanders" technologies={scenario.attackerTechnologies} executionMode="production" invalid={hasSideCategoryError('attacker', 'commanders')} errorId={validationErrorId} onToggle={() => toggleExpanded('attackerCommanders')} onScenario={updateScenario} />
          </> : <>
            <UnitSection id="sim-defender-ships" title={`КОРАБЛИ · ${getCombatFactionName(defenderFactionId).toUpperCase()}`} open={expanded.defenderShips} entities={defenderShips} scenario={scenario} side="defender" category="ships" technologies={scenario.defenderTechnologies} executionMode="production" invalid={hasSideCategoryError('defender', 'ships')} errorId={validationErrorId} onToggle={() => toggleExpanded('defenderShips')} onScenario={updateScenario} />
            <UnitSection id="sim-defender-commanders" title="КОМАНДИРСКИЕ" open={expanded.defenderCommanders} entities={COMMANDER_COMBAT_CATALOG} scenario={scenario} side="defender" category="commanders" technologies={scenario.defenderTechnologies} executionMode="production" invalid={hasSideCategoryError('defender', 'commanders')} errorId={validationErrorId} onToggle={() => toggleExpanded('defenderCommanders')} onScenario={updateScenario} />
            <UnitSection id="sim-defender-defenses" title={`ОБОРОНА · ${getCombatFactionName(defenderFactionId).toUpperCase()}`} open={expanded.defenderDefenses} entities={defenderDefenses} scenario={scenario} side="defender" category="defenses" technologies={scenario.defenderTechnologies} executionMode="production" invalid={hasSideCategoryError('defender', 'defenses')} errorId={validationErrorId} onToggle={() => toggleExpanded('defenderDefenses')} onScenario={updateScenario} />
          </>}
        </div>
      </section>
    );
  };

  return (
    <section className="simulator-view-v1 fleet-page-shell-v1 sim-a">
      <header className="fleet-page-head-v1">
          <div><small>УПРАВЛЕНИЕ ФЛОТОМ · {planetName} {coords}</small><h2>СИМУЛЯТОР</h2><p>Собери состав, выбери уровни и запусти расчёт.</p></div>
        <button type="button" className="fleet-page-back-v1" onClick={onBack}>← К ФЛОТАМ</button>
      </header>

      <section className={`sim-a-hero ${resultTone}`} style={{ '--sim-banner': `url("${MISSION_BANNERS.attack}")` } as CSSProperties} data-qa-simulator-result={result ? result.winner : 'none'}>
        <small className="sim-a-kicker">{result ? 'Итог боя' : 'Симулятор'}</small>
        <h2 key={result?.id ?? 'idle'}>{resultTitle}</h2>
        <p>{result ? <>Бой окончен на <b>{result.roundCount}-м</b> раунде из {scenario.maxRounds}</> : 'Собери обе стороны и рассчитай бой'}</p>
        <div className="sim-a-roundbar" aria-hidden="true">
          {Array.from({ length: scenario.maxRounds }, (_, index) => <i key={`${result?.id ?? 'idle'}-${index}`} className={result && index < result.roundCount ? 'is-on' : ''} style={{ '--sim-i': index } as CSSProperties} />)}
        </div>
        <div className="sim-a-go">
          <div className="sim-rounds-v1" role="group" aria-label="Максимум раундов">
            <span>Раундов:</span>
            {SIMULATOR_MAX_ROUNDS.map((rounds) => (
              <button key={rounds} type="button" className={scenario.maxRounds === rounds ? 'active' : ''} aria-pressed={scenario.maxRounds === rounds} onClick={() => updateScenario((current) => ({ ...current, maxRounds: rounds }))}>{rounds}</button>
            ))}
          </div>
          <button type="button" className="sim-run-v1" disabled={!validation.ok} onClick={runSimulation}>{result ? 'Рассчитать ещё раз' : 'Рассчитать бой'}</button>
        </div>
      </section>

      <section className={`sim-validation-v1 ${validation.ok ? 'ok' : 'error'}`} aria-live="polite">
        <div><strong>{validation.ok ? 'Сценарий готов' : 'Нужно исправить сценарий'}</strong><span className="sim-notice-v1">{notice}</span></div>
        {!validation.ok ? <ul id={validationErrorId}>{validation.errors.slice(0, 5).map((error, index) => <li key={`${error.path}-${index}`}>{error.message}</li>)}</ul> : null}
      </section>

      <div className="sim-sides-v1">
        {renderSide('attacker')}
        {renderSide('defender')}
      </div>

      <footer className="sim-a-foot">
        <div><small>Обломки</small><b>{result ? formatNumber(result.debris ?? 0) : '—'}</b></div>
        <div><small>Добыча</small><b>{result ? formatNumber(loot) : '—'}</b></div>
        <span className="sim-a-foot__gap" />
        <button type="button" className="sim-a-btn" disabled={!result} onClick={() => setDetailsOpen(true)} data-qa-simulator-details>Подробно по раундам</button>
        <button type="button" className="sim-a-btn" onClick={clearAll}>Очистить всё</button>
      </footer>

      <section className="sim-presets-v1" aria-label="Сценарии симулятора">
        <div><label htmlFor="sim-preset-name">Имя сценария</label><input id="sim-preset-name" value={presetName} maxLength={48} placeholder="Например: Линкоры против матриц" onChange={(event) => setPresetName(event.target.value)} /><button type="button" onClick={savePreset}>Сохранить сценарий</button></div>
        <div><label htmlFor="sim-preset-select">Сохранённые</label><select id="sim-preset-select" value={selectedPresetId} onChange={(event) => setSelectedPresetId(event.target.value)}><option value="">Выбери сценарий</option>{simulatorState.presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}</select><button type="button" disabled={!selectedPresetId} onClick={loadPreset}>Загрузить</button><button type="button" disabled={!selectedPresetId} onClick={deletePreset}>Удалить</button></div>
      </section>

      {result && detailsOpen ? <BattleReportModal report={result} context="simulation" onClose={closeResult} /> : null}
    </section>
  );
}
