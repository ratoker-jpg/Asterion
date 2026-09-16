import { useCallback, useEffect, useMemo, useState, type SetStateAction } from 'react';

import { BattleReportModal } from './BattleReportsView';
import { COMMANDER_COMBAT_CATALOG, DEFENSE_COMBAT_CATALOG, SHIP_COMBAT_CATALOG, type CatalogEntity } from './domain/combat/catalog.ts';
import { COMMANDER_ABILITIES, type CommanderId } from './domain/combat/commanders.ts';
import { getFactionDefenseCatalog, getFactionShipCatalog } from './domain/combat/faction-catalog.ts';
import {
  COMBAT_FACTIONS,
  getCombatFactionName,
  normalizeCombatFactionId,
  type CombatFactionId,
} from './domain/combat/factions.ts';
import { readCombatPriority, selectActiveCommander } from './domain/combat/priority.ts';
import { resolveCombat } from './domain/combat/resolver.ts';
import {
  deleteSimulatorPreset,
  persistSimulatorState,
  readSavedCombatTechnologies,
  readSimulatorState,
  upsertSimulatorPreset,
  withLastScenario,
  type SimulatorState,
} from './domain/combat/simulator-repository.ts';
import {
  COMBAT_ENTITY_LEVEL_LIMITS,
  DEFAULT_COMBAT_TARGET_PRIORITY,
  SIMULATOR_POPULATION_LIMITS,
  type CombatTargetPriority,
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
import './simulator.css';

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
    if (category === 'commanders' && scenario.attacker.commander !== undefined) {
      return scenario.attacker.commander ? [scenario.attacker.commander] : [];
    }
    return scenario.attacker[category];
  }
  if (category === 'commanders' && scenario.defender.commander !== undefined) {
    return scenario.defender.commander ? [scenario.defender.commander] : [];
  }
  return scenario.defender[category];
}

function getCount(scenario: SimulatorScenario, side: ScenarioSide, category: ScenarioCategory, entityId: string) {
  return getStacks(scenario, side, category).find((stack) => stack.entityId === entityId)?.count ?? 0;
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
  const next = category === 'commanders'
    ? (nextCount > 0 ? [nextStack] : [])
    : current.filter((stack) => stack.entityId !== entityId);
  if (category !== 'commanders' && nextCount > 0) next.push(nextStack);

  if (side === 'attacker') {
    if (category === 'defenses') return scenario;
    return {
      ...scenario,
      attacker: {
        ...scenario.attacker,
        [category]: next,
        ...(category === 'commanders' ? { commander: next[0] ?? null } : {}),
      },
    };
  }

  return {
    ...scenario,
    defender: {
      ...scenario.defender,
      [category]: next,
      ...(category === 'commanders' ? { commander: next[0] ?? null } : {}),
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
  const next = current.map((stack) => stack.entityId === entityId
    ? { ...stack, level: Math.max(0, Math.floor(Number.isFinite(level) ? level : 0)) }
    : stack);
  if (side === 'attacker') {
    if (category === 'defenses') return scenario;
    return {
      ...scenario,
      attacker: {
        ...scenario.attacker,
        [category]: next,
        ...(category === 'commanders' ? { commander: next[0] ?? null } : {}),
      },
    };
  }
  return {
    ...scenario,
    defender: {
      ...scenario.defender,
      [category]: next,
      ...(category === 'commanders' ? { commander: next[0] ?? null } : {}),
    },
  };
}

function categoryPopulation(scenario: SimulatorScenario, side: ScenarioSide, category: ScenarioCategory) {
  return getStacks(scenario, side, category).reduce((total, stack) => {
    const catalog = category === 'ships'
      ? SHIP_COMBAT_CATALOG
      : category === 'commanders'
        ? COMMANDER_COMBAT_CATALOG
        : DEFENSE_COMBAT_CATALOG;
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
  if (category === 'commanders') {
    return currentCount > 0 || !getStacks(scenario, side, category).some((stack) => stack.count > 0) ? 1 : 0;
  }
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
  return Math.max(0, Math.floor((limit - budgetWithoutCurrent) / Math.max(1, entity.population)));
}

function UnitRow({
  entity,
  count,
  max,
  level,
  levelMax,
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
  ability?: string;
  invalid?: boolean;
  errorId?: string;
  onChange: (count: number) => void;
  onLevelChange: (level: number) => void;
}) {
  return (
    <div className="sim-unit-row-v1">
      <img src={entity.art} alt="" draggable={false} />
      <div className="sim-unit-copy-v1">
        <strong>{entity.name}</strong>
        <span>{entity.role}</span>
        <small>Население: {entity.population} · Оружие: {entity.combat.weaponType} · Броня: {entity.combat.armorType}</small>
        {ability ? <em>Способность: {ability}</em> : null}
      </div>
      <div className="sim-unit-controls-v1">
        <button type="button" aria-label={`Уменьшить ${entity.name}`} disabled={count <= 0} onClick={() => onChange(count - 1)}>−</button>
        <input
          type="number"
          min="0"
          max={max}
          value={count}
          aria-label={`Количество ${entity.name}`}
          aria-invalid={invalid ? true : undefined}
          aria-describedby={invalid ? errorId : undefined}
          onChange={(event) => onChange(Math.min(max, Math.max(0, Number(event.target.value))))}
        />
        <button type="button" aria-label={`Увеличить ${entity.name}`} disabled={count >= max} onClick={() => onChange(Math.min(max, count + 1))}>+</button>
        <button type="button" className="sim-max-v1" aria-label={`Максимум ${entity.name}`} disabled={max <= 0 || count >= max} onClick={() => onChange(max)}>МАКС.</button>
        <label className="sim-level-control-v1">
          <span>УР.</span>
          <input
            type="number"
            min="0"
            max={levelMax}
            value={level}
            aria-label={`Уровень ${entity.name}`}
            aria-invalid={invalid ? true : undefined}
            aria-describedby={invalid ? errorId : undefined}
            disabled={levelMax === 0}
            onChange={(event) => onLevelChange(Number(event.target.value))}
          />
          <small>/ {levelMax}</small>
        </label>
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
  invalid?: boolean;
  errorId?: string;
  onToggle: () => void;
  onScenario: (scenario: SimulatorScenario) => void;
}) {
  const selected = getStacks(scenario, side, category).reduce((total, stack) => total + stack.count, 0);
  return (
    <section className={`sim-unit-section-v1 ${open ? 'open' : ''}`}>
      <button type="button" className="sim-section-toggle-v1" aria-expanded={open} aria-controls={id} onClick={onToggle}>
        <span><strong>{title}</strong><small>{selected ? `Выбрано: ${formatNumber(selected)}` : 'Не выбрано'}</small></span>
        <b aria-hidden="true">{open ? '−' : '+'}</b>
      </button>
      <div id={id} className="sim-unit-list-v1" hidden={!open}>
        {entities.map((entity) => {
          const count = getCount(scenario, side, category, entity.id);
          return (
            <UnitRow
              key={entity.id}
              entity={entity}
              count={count}
              max={maxForEntity(scenario, side, category, entity)}
              level={getStacks(scenario, side, category).find((stack) => stack.entityId === entity.id)?.level ?? 0}
              levelMax={COMBAT_ENTITY_LEVEL_LIMITS[entity.kind]}
              ability={entity.kind === 'commander' ? COMMANDER_ABILITIES[entity.id as CommanderId].ability : undefined}
              invalid={invalid}
              errorId={errorId}
              onChange={(next) => onScenario(replaceStackCount(scenario, side, category, entity.id, next))}
              onLevelChange={(next) => onScenario(replaceStackLevel(scenario, side, category, entity.id, next))}
            />
          );
        })}
      </div>
    </section>
  );
}

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
  const normalized = normalizeCombatTechnologies(levels);
  const activeCount = COMBAT_TECHNOLOGIES.filter((technology) => normalized[technology.id] > 0).length;

  const updateLevel = (technologyId: CombatTechnologyId, nextValue: number) => {
    onChange({
      ...normalized,
      [technologyId]: normalizeTechnologyLevel(technologyId, nextValue),
    });
  };

  return (
    <section className={`sim-unit-section-v1 sim-tech-section-v1 ${open ? 'open' : ''}`}>
      <button type="button" className="sim-section-toggle-v1" aria-expanded={open} aria-controls={id} onClick={onToggle}>
        <span><strong>ТЕХНОЛОГИИ</strong><small>{activeCount ? `Активно: ${activeCount}` : 'Все уровни 0'}</small></span>
        <b aria-hidden="true">{open ? '−' : '+'}</b>
      </button>
      <div id={id} className="sim-tech-list-v1" hidden={!open}>
        {COMBAT_TECHNOLOGIES.map((technology) => {
          const level = normalized[technology.id];
          return (
            <div className="sim-tech-row-v1" key={technology.id}>
              <div>
                <strong>{technology.name}</strong>
                <small>{technology.effect} · {technology.effectStatus === 'unknown' ? 'НЕ КАЛИБРОВАНО' : technology.effectStatus.toUpperCase()}</small>
              </div>
              <div className="sim-tech-controls-v1">
                <button type="button" aria-label={`Уменьшить уровень ${technology.name}`} disabled={level <= 0} onClick={() => updateLevel(technology.id, level - 1)}>−</button>
                <input
                  type="number"
                  min="0"
                  max={technology.maxLevel}
                  value={level}
                  aria-label={`${technology.name}, уровень`}
                  aria-invalid={invalid ? true : undefined}
                  aria-describedby={invalid ? errorId : undefined}
                  onChange={(event) => updateLevel(technology.id, Number(event.target.value))}
                />
                <span>/ {technology.maxLevel}</span>
                <button type="button" aria-label={`Увеличить уровень ${technology.name}`} disabled={level >= technology.maxLevel} onClick={() => updateLevel(technology.id, level + 1)}>+</button>
                <button type="button" className="sim-max-v1" disabled={level >= technology.maxLevel} onClick={() => updateLevel(technology.id, technology.maxLevel)}>МАКС.</button>
              </div>
            </div>
          );
        })}
        <p className="sim-tech-note-v1">
          Кривые с пометкой INFERRED используются только в режиме CALIBRATION. Неизвестные коэффициенты и способности остаются нейтральными и отмечаются в отчёте.
        </p>
      </div>
    </section>
  );
}

function PopulationMeter({ label, value, max }: { label: string; value: number; max: number }) {
  const overflow = value > max;
  return (
    <div className={`sim-population-v1 ${overflow ? 'error' : ''}`}>
      <span>{label}</span>
      <strong>{formatNumber(value)} / {formatNumber(max)}</strong>
    </div>
  );
}

function TargetPrioritySelect({ side, value, invalid, errorId, onChange }: { side: ScenarioSide; value: CombatTargetPriority; invalid?: boolean; errorId?: string; onChange: (value: CombatTargetPriority) => void }) {
  const label = side === 'attacker' ? 'АТАКУЮЩЕГО' : 'ЗАЩИТНИКА';
  return (
    <label className="sim-target-priority-v1" htmlFor={`sim-target-priority-${side}`}>
      <span>ПРИОРИТЕТ ЦЕЛИ · {label}</span>
      <select
        id={`sim-target-priority-${side}`}
        value={value}
        onChange={(event) => onChange(event.target.value as CombatTargetPriority)}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={invalid && errorId ? `sim-target-priority-help-${side} ${errorId}` : `sim-target-priority-help-${side}`}
      >
        <option value="threat">УГРОЗА → НАСЕЛЕНИЕ → КАТАЛОГ</option>
        <option value="population">НАСЕЛЕНИЕ → УГРОЗА → КАТАЛОГ</option>
        <option value="catalog">КАТАЛОГ → УГРОЗА → НАСЕЛЕНИЕ</option>
      </select>
      <small id={`sim-target-priority-help-${side}`}>Fallback-эвристика, not-calibrated.</small>
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

export function SimulatorView({ planetName, coords, onBack }: { planetName: string; coords: string; onBack: () => void }) {
  const initialPersistence = useMemo(() => readSimulatorState(), []);
  const [scenario, setScenario] = useState<SimulatorScenario>(() => {
    if (initialPersistence.lastScenario) return initialPersistence.lastScenario;
    const savedTechnologies = readSavedCombatTechnologies();
    const empty = createEmptySimulatorScenario();
    return { ...empty, attackerTechnologies: savedTechnologies, defenderTechnologies: { ...savedTechnologies } };
  });
  const [simulatorState, setSimulatorState] = useState<SimulatorState>(initialPersistence);
  const [expanded, setExpanded] = useState<ExpandedState>(DEFAULT_EXPANDED);
  const [presetName, setPresetName] = useState('');
  const [selectedPresetId, setSelectedPresetId] = useState('');
  const [result, setResult] = useState<BattleReport | null>(null);
  const [notice, setNotice] = useState('Готов к расчёту. Неизвестные боевые механики отключены.');
  const closeResult = useCallback(() => {
    setResult(null);
    setNotice('Результат закрыт. Сценарий сохранён.');
  }, []);

  const updateScenario = (next: SetStateAction<SimulatorScenario>) => {
    setScenario(next);
    setResult(null);
  };

  const attackerFactionId = normalizeCombatFactionId(scenario.attackerFactionId);
  const defenderFactionId = normalizeCombatFactionId(scenario.defenderFactionId);
  const attackerShips = useMemo(() => getFactionShipCatalog(attackerFactionId), [attackerFactionId]);
  const defenderShips = useMemo(() => getFactionShipCatalog(defenderFactionId), [defenderFactionId]);
  const defenderDefenses = useMemo(() => getFactionDefenseCatalog(defenderFactionId), [defenderFactionId]);
  const population = useMemo(() => calculateScenarioPopulation(scenario), [scenario]);

  const validationInput = useMemo(() => scenarioToCombatInput(scenario, {
    scenarioId: 'simulator-validation',
    timestamp: '2026-01-01T00:00:00.000Z',
    attacker: { playerId: 'sim-attacker', playerName: 'Атакующий', planetName, coordinates: coords, side: 'attacker' },
    defender: { playerId: 'sim-defender', playerName: 'Защитник', planetName: 'Цель симулятора', coordinates: '[SIM]', side: 'defender' },
    priority: readCombatPriority(),
  }), [scenario, planetName, coords, attackerFactionId, defenderFactionId]);
  const validation = useMemo(() => validateCombatInput(validationInput), [validationInput]);
  const validationErrorId = 'sim-validation-errors';
  const hasValidationError = (path: string) => validation.errors.some((error) => error.path === path || error.path.startsWith(`${path}.`) || error.path.startsWith(`${path}[`));
  const hasSideCategoryError = (side: ScenarioSide, category: ScenarioCategory) => {
    const path = category === 'commanders' ? `${side}.commander` : `${side}.${category}`;
    return hasValidationError(side) || hasValidationError(path);
  };

  const activeCommanders = useMemo(() => {
    const priority = readCombatPriority();
    const attackerIds = getStacks(scenario, 'attacker', 'commanders').filter((stack) => stack.count > 0).map((stack) => stack.entityId as CommanderId);
    const defenderIds = getStacks(scenario, 'defender', 'commanders').filter((stack) => stack.count > 0).map((stack) => stack.entityId as CommanderId);
    return {
      attacker: selectActiveCommander(priority.attack, attackerIds),
      defender: selectActiveCommander(priority.defense, defenderIds),
    };
  }, [scenario]);

  useEffect(() => {
    const next = withLastScenario(readSimulatorState(), scenario);
    const persisted = persistSimulatorState(next);
    if (persisted.ok) setSimulatorState(persisted.value);
  }, [scenario]);

  const toggleExpanded = (key: keyof ExpandedState) => setExpanded((current) => ({ ...current, [key]: !current[key] }));

  const clearSide = (side: ScenarioSide) => {
    updateScenario((current) => side === 'attacker'
      ? { ...current, attacker: { ships: [], commanders: [], commander: null } }
      : { ...current, defender: { ships: [], commanders: [], commander: null, defenses: [] } });
    setNotice(side === 'attacker' ? 'Атакующая сторона очищена.' : 'Защищающаяся сторона очищена.');
  };

  const changeFaction = (side: ScenarioSide, factionId: CombatFactionId) => {
    updateScenario((current) => setScenarioFaction(current, side, factionId));
    const sideLabel = side === 'attacker' ? 'атакующего' : 'защитника';
    setNotice(`Раса ${sideLabel} изменена на «${getCombatFactionName(factionId)}». Показан её набор кораблей${side === 'defender' ? ' и обороны' : ''}; состав стороны очищен.`);
  };

  const changeTechnologies = (side: ScenarioSide, levels: CombatTechnologyLevels) => {
    updateScenario((current) => side === 'attacker'
      ? { ...current, attackerTechnologies: levels, technologyMode: 'independent' }
      : { ...current, defenderTechnologies: levels, technologyMode: 'independent' });
    setNotice(`Технологии ${side === 'attacker' ? 'атакующего' : 'защитника'} изменены. Предыдущий результат сброшен.`);
  };

  const changeTargetPriority = (side: ScenarioSide, value: CombatTargetPriority) => {
    updateScenario((current) => side === 'attacker'
      ? { ...current, attackerTargetPriority: value }
      : { ...current, defenderTargetPriority: value });
    setNotice(`Тактический приоритет цели ${side === 'attacker' ? 'атакующего' : 'защитника'} изменён. Правило помечено как not-calibrated.`);
  };

  const copyAttackerTechnologies = () => {
    const copied = normalizeCombatTechnologies(scenario.attackerTechnologies);
    updateScenario((current) => ({
      ...current,
      defenderTechnologies: { ...copied },
      technologyMode: 'shared',
      executionMode: 'calibration',
    }));
    setNotice('Технологии атакующего применены к защитнику в текущем сценарии.');
  };

  const clearAll = () => {
    updateScenario(createEmptySimulatorScenario());
    setNotice('Сценарий очищен. Обе стороны возвращены к расе «Астеры», технологии — к уровню 0.');
  };

  const runSimulation = () => {
    const timestamp = new Date().toISOString();
    const combatInput = scenarioToCombatInput({
      ...scenario,
      seed: scenario.seed?.trim() || undefined,
    }, {
      scenarioId: nextIdentity('scenario'),
      timestamp,
      attacker: { playerId: 'sim-attacker', playerName: 'Атакующий', planetName, coordinates: coords, side: 'attacker' },
      defender: { playerId: 'sim-defender', playerName: 'Защитник', planetName: 'Цель симулятора', coordinates: '[SIM]', side: 'defender' },
      priority: readCombatPriority(),
    });
    const checked = validateCombatInput(combatInput);
    if (!checked.ok) {
      setNotice(checked.errors[0]?.message ?? 'Сценарий не прошёл валидацию.');
      return;
    }
    const report = resolveCombat(checked.value, { reportId: nextIdentity('simulation') });
    setResult(report);
    setNotice(`Расчёт завершён: ${report.roundCount} раунд(ов), результат — ${report.winner === 'draw' ? 'ничья' : report.winner === 'attacker' ? 'победа атакующего' : 'победа защитника'}.`);
  };

  const savePreset = () => {
    const name = presetName.trim() || `Сценарий ${simulatorState.presets.length + 1}`;
    const preset = { id: nextIdentity('preset'), name, createdAt: new Date().toISOString(), input: scenario };
    const next = upsertSimulatorPreset(readSimulatorState(), preset);
    const persisted = persistSimulatorState(next);
    if (persisted.ok) {
      setSimulatorState(persisted.value);
      setSelectedPresetId(preset.id);
      setPresetName('');
      setNotice(`Preset «${preset.name}» сохранён.`);
    } else setNotice(`⚠ ${persisted.error}`);
  };

  const loadPreset = () => {
    const preset = simulatorState.presets.find((item) => item.id === selectedPresetId);
    if (!preset) return;
    updateScenario(preset.input);
    setNotice(`Preset «${preset.name}» загружен.`);
  };

  const deletePreset = () => {
    if (!selectedPresetId) return;
    const preset = simulatorState.presets.find((item) => item.id === selectedPresetId);
    const next = deleteSimulatorPreset(readSimulatorState(), selectedPresetId);
    const persisted = persistSimulatorState(next);
    if (persisted.ok) {
      setSimulatorState(persisted.value);
      setSelectedPresetId('');
      setNotice(preset ? `Preset «${preset.name}» удалён.` : 'Preset удалён.');
    } else setNotice(`⚠ ${persisted.error}`);
  };

  const activeCommanderLabel = (id: CommanderId | null) => id
    ? `${COMMANDER_ABILITIES[id].commanderName} · ${COMMANDER_ABILITIES[id].ability}`
    : 'не выбран';

  return (
    <section className="simulator-view-v1 fleet-page-shell-v1">
      <header className="fleet-page-head-v1">
          <div><small>УПРАВЛЕНИЕ ФЛОТОМ · {planetName} {coords}</small><h2>СИМУЛЯТОР</h2><p>Боевой runtime v2 с provenance и безопасными неизвестными механиками.</p></div>
        <button type="button" className="fleet-page-back-v1" onClick={onBack}>← К ФЛОТАМ</button>
      </header>

      <section className="simulator-toolbar-v1">
        <div className="sim-rounds-v1" role="group" aria-label="Максимум раундов">
          <span>МАКС. РАУНДОВ</span>
          {SIMULATOR_MAX_ROUNDS.map((rounds) => (
            <button key={rounds} type="button" className={scenario.maxRounds === rounds ? 'active' : ''} aria-pressed={scenario.maxRounds === rounds} onClick={() => updateScenario((current) => ({ ...current, maxRounds: rounds }))}>{rounds}</button>
          ))}
        </div>
        <label className="sim-execution-v1" htmlFor="sim-execution-mode">
          <span>РЕЖИМ</span>
          <select id="sim-execution-mode" value={scenario.executionMode ?? 'calibration'} onChange={(event) => updateScenario((current) => ({ ...current, executionMode: event.target.value === 'production' ? 'production' : 'calibration' }))}>
            <option value="calibration">CALIBRATION</option>
            <option value="production">PRODUCTION</option>
          </select>
        </label>
        <label className="sim-seed-v1" htmlFor="sim-seed">
          <span>SEED</span>
          <input id="sim-seed" value={scenario.seed ?? ''} placeholder="не задан" onChange={(event) => updateScenario((current) => ({ ...current, seed: event.target.value || undefined }))} />
        </label>
        <button type="button" className="sim-clear-v1" onClick={clearAll}>ОЧИСТИТЬ ВСЁ</button>
      </section>

      <section className="sim-presets-v1" aria-label="Presets симулятора">
        <div><label htmlFor="sim-preset-name">НАЗВАНИЕ PRESET</label><input id="sim-preset-name" value={presetName} maxLength={48} placeholder="Например: Линкоры против матриц" onChange={(event) => setPresetName(event.target.value)} /><button type="button" onClick={savePreset}>СОХРАНИТЬ СЦЕНАРИЙ</button></div>
        <div><label htmlFor="sim-preset-select">СОХРАНЁННЫЕ</label><select id="sim-preset-select" value={selectedPresetId} onChange={(event) => setSelectedPresetId(event.target.value)}><option value="">Выбери preset</option>{simulatorState.presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}</select><button type="button" disabled={!selectedPresetId} onClick={loadPreset}>ЗАГРУЗИТЬ</button><button type="button" disabled={!selectedPresetId} onClick={deletePreset}>УДАЛИТЬ</button></div>
      </section>

      <div className="sim-sides-v1">
        <section className="sim-side-v1">
          <header><div><small>СТОРОНА 01</small><h3>АТАКУЮЩИЙ</h3></div><button type="button" onClick={() => clearSide('attacker')}>ОЧИСТИТЬ СТОРОНУ</button></header>
          <RaceSelector id="sim-attacker-race" label="РАСА АТАКУЮЩЕГО" value={attackerFactionId} onChange={(factionId) => changeFaction('attacker', factionId)} />
          <PopulationMeter label="ФЛОТ АТАКУЮЩЕГО" value={population.attackerFleet} max={SIMULATOR_POPULATION_LIMITS.attackerFleet} />
          <TargetPrioritySelect side="attacker" value={scenario.attackerTargetPriority ?? DEFAULT_COMBAT_TARGET_PRIORITY} invalid={hasValidationError('attackerTargetPriority')} errorId={validationErrorId} onChange={(value) => changeTargetPriority('attacker', value)} />
          <div className="sim-active-commander-v1"><span>Ведущий командир</span><strong>{activeCommanderLabel(activeCommanders.attacker)}</strong></div>
          <TechnologySection id="sim-attacker-technologies" open={expanded.attackerTechnologies} levels={scenario.attackerTechnologies} invalid={hasValidationError('attackerTechnologies')} errorId={validationErrorId} onToggle={() => toggleExpanded('attackerTechnologies')} onChange={(levels) => changeTechnologies('attacker', levels)} />
          <UnitSection id="sim-attacker-ships" title={`КОРАБЛИ · ${getCombatFactionName(attackerFactionId).toUpperCase()}`} open={expanded.attackerShips} entities={attackerShips} scenario={scenario} side="attacker" category="ships" invalid={hasSideCategoryError('attacker', 'ships')} errorId={validationErrorId} onToggle={() => toggleExpanded('attackerShips')} onScenario={updateScenario} />
          <UnitSection id="sim-attacker-commanders" title="КОМАНДИРСКИЕ" open={expanded.attackerCommanders} entities={COMMANDER_COMBAT_CATALOG} scenario={scenario} side="attacker" category="commanders" invalid={hasSideCategoryError('attacker', 'commanders')} errorId={validationErrorId} onToggle={() => toggleExpanded('attackerCommanders')} onScenario={updateScenario} />
        </section>

        <section className="sim-side-v1">
          <header><div><small>СТОРОНА 02</small><h3>ЗАЩИТНИК</h3></div><button type="button" onClick={() => clearSide('defender')}>ОЧИСТИТЬ СТОРОНУ</button></header>
          <RaceSelector id="sim-defender-race" label="РАСА ЗАЩИТНИКА" value={defenderFactionId} onChange={(factionId) => changeFaction('defender', factionId)} />
          <PopulationMeter label="ФЛОТ ЗАЩИТНИКА" value={population.defenderFleet} max={SIMULATOR_POPULATION_LIMITS.defenderFleet} />
          <PopulationMeter label="ОБОРОНА ЗАЩИТНИКА" value={population.defenderDefense} max={SIMULATOR_POPULATION_LIMITS.defenderDefense} />
          <TargetPrioritySelect side="defender" value={scenario.defenderTargetPriority ?? DEFAULT_COMBAT_TARGET_PRIORITY} invalid={hasValidationError('defenderTargetPriority')} errorId={validationErrorId} onChange={(value) => changeTargetPriority('defender', value)} />
          <div className="sim-active-commander-v1"><span>Ведущий командир</span><strong>{activeCommanderLabel(activeCommanders.defender)}</strong></div>
          <TechnologySection id="sim-defender-technologies" open={expanded.defenderTechnologies} levels={scenario.defenderTechnologies} invalid={hasValidationError('defenderTechnologies')} errorId={validationErrorId} onToggle={() => toggleExpanded('defenderTechnologies')} onChange={(levels) => changeTechnologies('defender', levels)} />
          <button type="button" className="sim-copy-tech-v1" onClick={copyAttackerTechnologies}>ПРИМЕНИТЬ ТЕХНОЛОГИИ АТАКУЮЩЕГО К ЗАЩИТНИКУ</button>
          <UnitSection id="sim-defender-ships" title={`КОРАБЛИ · ${getCombatFactionName(defenderFactionId).toUpperCase()}`} open={expanded.defenderShips} entities={defenderShips} scenario={scenario} side="defender" category="ships" invalid={hasSideCategoryError('defender', 'ships')} errorId={validationErrorId} onToggle={() => toggleExpanded('defenderShips')} onScenario={updateScenario} />
          <UnitSection id="sim-defender-commanders" title="КОМАНДИРСКИЕ" open={expanded.defenderCommanders} entities={COMMANDER_COMBAT_CATALOG} scenario={scenario} side="defender" category="commanders" invalid={hasSideCategoryError('defender', 'commanders')} errorId={validationErrorId} onToggle={() => toggleExpanded('defenderCommanders')} onScenario={updateScenario} />
          <UnitSection id="sim-defender-defenses" title={`ОБОРОНА · ${getCombatFactionName(defenderFactionId).toUpperCase()}`} open={expanded.defenderDefenses} entities={defenderDefenses} scenario={scenario} side="defender" category="defenses" invalid={hasSideCategoryError('defender', 'defenses')} errorId={validationErrorId} onToggle={() => toggleExpanded('defenderDefenses')} onScenario={updateScenario} />
        </section>
      </div>

      <section className="sim-race-mechanics-note-v1"><strong>РАСЫ И МЕХАНИКА</strong><span>Выбор расы теперь меняет набор и арт кораблей/обороны. Пока отдельные проверенные таблицы базовых статов Иларов и Роя не найдены, combat engine использует канонический механический эквивалент роли и не выдумывает расовые коэффициенты.</span></section>

      <section className={`sim-validation-v1 ${validation.ok ? 'ok' : 'error'}`} aria-live="polite">
        <div><strong>{validation.ok ? 'СЦЕНАРИЙ ГОТОВ' : 'НУЖНО ИСПРАВИТЬ СЦЕНАРИЙ'}</strong><span>{notice}</span></div>
        {!validation.ok ? <ul id={validationErrorId}>{validation.errors.slice(0, 5).map((error, index) => <li key={`${error.path}-${index}`}>{error.message}</li>)}</ul> : null}
        <button type="button" className="sim-run-v1" disabled={!validation.ok} onClick={runSimulation}>СИМУЛИРОВАТЬ БОЙ</button>
      </section>

      {result ? <BattleReportModal report={result} context="simulation" onClose={closeResult} /> : null}
    </section>
  );
}
