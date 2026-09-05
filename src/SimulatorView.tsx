import { useEffect, useMemo, useState } from 'react';

import { BattleReportDetailBody } from './BattleReportsView';
import {
  COMMANDER_COMBAT_CATALOG,
  DEFENSE_COMBAT_CATALOG,
  SHIP_COMBAT_CATALOG,
  type CatalogEntity,
} from './domain/combat/catalog.ts';
import { COMMANDER_ABILITIES, type CommanderId } from './domain/combat/commanders.ts';
import {
  COMBAT_FACTIONS,
  getCombatFactionName,
  type CombatFactionId,
} from './domain/combat/factions.ts';
import {
  addBattleReportSaved,
  persistBattleHistory,
  readBattleHistory,
} from './domain/combat/battle-repository.ts';
import { readCombatPriority, selectActiveCommander } from './domain/combat/priority.ts';
import { resolveCombat } from './domain/combat/resolver.ts';
import {
  createDefaultSimulatorState,
  deleteSimulatorPreset,
  persistSimulatorState,
  readSimulatorState,
  upsertSimulatorPreset,
  withLastScenario,
  type SimulatorState,
} from './domain/combat/simulator-repository.ts';
import {
  calculateScenarioPopulation,
  createEmptySimulatorScenario,
  scenarioToCombatInput,
  setScenarioFaction,
  SIMULATOR_MAX_ROUNDS,
  SIMULATOR_POPULATION_LIMIT,
  validateCombatInput,
  type CombatStackInput,
  type SimulatorScenario,
} from './domain/combat/simulator.ts';
import type { BattleReport } from './domain/combat/report.ts';
import './simulator.css';

let identityCounter = 0;

function nextIdentity(prefix: string) {
  identityCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${identityCounter.toString(36)}`;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('ru-RU').format(value);
}

type ScenarioSide = 'attacker' | 'defender';
type ScenarioCategory = 'ships' | 'commanders' | 'defenses';

type ExpandedState = {
  attackerShips: boolean;
  attackerCommanders: boolean;
  defenderShips: boolean;
  defenderCommanders: boolean;
  defenderDefenses: boolean;
};

const DEFAULT_EXPANDED: ExpandedState = {
  attackerShips: true,
  attackerCommanders: false,
  defenderShips: true,
  defenderCommanders: false,
  defenderDefenses: false,
};

function getStacks(scenario: SimulatorScenario, side: ScenarioSide, category: ScenarioCategory): CombatStackInput[] {
  if (side === 'attacker') {
    if (category === 'defenses') return [];
    return scenario.attacker[category];
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
  const next = current.filter((stack) => stack.entityId !== entityId);
  if (nextCount > 0) next.push({ entityId, count: nextCount });

  if (side === 'attacker') {
    if (category === 'defenses') return scenario;
    return {
      ...scenario,
      attacker: { ...scenario.attacker, [category]: next },
    };
  }

  return {
    ...scenario,
    defender: { ...scenario.defender, [category]: next },
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
  const currentContribution = currentCount * entity.population;
  const used = category === 'defenses'
    ? categoryPopulation(scenario, 'defender', 'defenses')
    : side === 'attacker'
      ? categoryPopulation(scenario, 'attacker', 'ships') + categoryPopulation(scenario, 'attacker', 'commanders')
      : categoryPopulation(scenario, 'defender', 'ships') + categoryPopulation(scenario, 'defender', 'commanders');
  const budgetWithoutCurrent = Math.max(0, used - currentContribution);
  return Math.max(0, Math.floor((SIMULATOR_POPULATION_LIMIT - budgetWithoutCurrent) / Math.max(1, entity.population)));
}

function UnitRow({
  entity,
  count,
  max,
  ability,
  onChange,
}: {
  entity: CatalogEntity;
  count: number;
  max: number;
  ability?: string;
  onChange: (count: number) => void;
}) {
  return (
    <div className="sim-unit-row-v1">
      <img src={entity.art} alt="" draggable={false} />
      <div className="sim-unit-copy-v1">
        <strong>{entity.name}</strong>
        <span>{entity.role}</span>
        <small>Население: {entity.population} · Оружие: {entity.combat.weaponType}</small>
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
          onChange={(event) => onChange(Math.min(max, Math.max(0, Number(event.target.value))))}
        />
        <button type="button" aria-label={`Увеличить ${entity.name}`} disabled={count >= max} onClick={() => onChange(Math.min(max, count + 1))}>+</button>
        <button type="button" className="sim-max-v1" aria-label={`Максимум ${entity.name}`} disabled={max <= 0 || count >= max} onClick={() => onChange(max)}>МАКС.</button>
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
      {open ? (
        <div id={id} className="sim-unit-list-v1">
          {entities.map((entity) => {
            const count = getCount(scenario, side, category, entity.id);
            return (
              <UnitRow
                key={entity.id}
                entity={entity}
                count={count}
                max={maxForEntity(scenario, side, category, entity)}
                ability={entity.kind === 'commander' ? COMMANDER_ABILITIES[entity.id as CommanderId].ability : undefined}
                onChange={(next) => onScenario(replaceStackCount(scenario, side, category, entity.id, next))}
              />
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

function PopulationMeter({ label, value }: { label: string; value: number }) {
  const overflow = value > SIMULATOR_POPULATION_LIMIT;
  return (
    <div className={`sim-population-v1 ${overflow ? 'error' : ''}`}>
      <span>{label}</span>
      <strong>{formatNumber(value)} / {formatNumber(SIMULATOR_POPULATION_LIMIT)}</strong>
    </div>
  );
}

function RaceSelector({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value?: CombatFactionId;
  onChange: (factionId: CombatFactionId) => void;
}) {
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
  const [scenario, setScenario] = useState<SimulatorScenario>(() => initialPersistence.lastScenario ?? createEmptySimulatorScenario());
  const [simulatorState, setSimulatorState] = useState<SimulatorState>(initialPersistence);
  const [expanded, setExpanded] = useState<ExpandedState>(DEFAULT_EXPANDED);
  const [presetName, setPresetName] = useState('');
  const [selectedPresetId, setSelectedPresetId] = useState('');
  const [result, setResult] = useState<BattleReport | null>(null);
  const [resultSaved, setResultSaved] = useState(false);
  const [notice, setNotice] = useState('Готов к расчёту. Combat Resolver v1 не использует RNG.');

  const population = useMemo(() => calculateScenarioPopulation(scenario), [scenario]);
  const validationInput = useMemo(() => scenarioToCombatInput(scenario, {
    scenarioId: 'simulator-validation',
    timestamp: '2026-01-01T00:00:00.000Z',
    attacker: {
      playerId: 'sim-attacker',
      playerName: getCombatFactionName(scenario.attackerFactionId),
      planetName,
      coordinates: coords,
      side: 'attacker',
    },
    defender: {
      playerId: 'sim-defender',
      playerName: getCombatFactionName(scenario.defenderFactionId),
      planetName: 'Цель симулятора',
      coordinates: '[SIM]',
      side: 'defender',
    },
    priority: readCombatPriority(),
  }), [scenario, planetName, coords]);
  const validation = useMemo(() => validateCombatInput(validationInput), [validationInput]);

  const activeCommanders = useMemo(() => {
    const priority = readCombatPriority();
    const attackerIds = scenario.attacker.commanders.filter((stack) => stack.count > 0).map((stack) => stack.entityId as CommanderId);
    const defenderIds = scenario.defender.commanders.filter((stack) => stack.count > 0).map((stack) => stack.entityId as CommanderId);
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

  const toggleExpanded = (key: keyof ExpandedState) => {
    setExpanded((current) => ({ ...current, [key]: !current[key] }));
  };

  const clearSide = (side: ScenarioSide) => {
    setScenario((current) => side === 'attacker'
      ? { ...current, attacker: { ships: [], commanders: [] } }
      : { ...current, defender: { ships: [], commanders: [], defenses: [] } });
    setResult(null);
    setResultSaved(false);
    setNotice(side === 'attacker' ? 'Атакующая сторона очищена.' : 'Защищающаяся сторона очищена.');
  };

  const changeFaction = (side: ScenarioSide, factionId: CombatFactionId) => {
    setScenario((current) => setScenarioFaction(current, side, factionId));
    setResult(null);
    setResultSaved(false);
    const sideLabel = side === 'attacker' ? 'атакующего' : 'защитника';
    setNotice(`Раса ${sideLabel} изменена на «${getCombatFactionName(factionId)}». Состав этой стороны очищен.`);
  };

  const clearAll = () => {
    setScenario(createEmptySimulatorScenario());
    setResult(null);
    setResultSaved(false);
    setNotice('Сценарий очищен. Обе стороны возвращены к расе «Астеры».');
  };

  const runSimulation = () => {
    const timestamp = new Date().toISOString();
    const combatInput = scenarioToCombatInput(scenario, {
      scenarioId: nextIdentity('scenario'),
      timestamp,
      attacker: {
        playerId: 'sim-attacker',
        playerName: getCombatFactionName(scenario.attackerFactionId),
        planetName,
        coordinates: coords,
        side: 'attacker',
      },
      defender: {
        playerId: 'sim-defender',
        playerName: getCombatFactionName(scenario.defenderFactionId),
        planetName: 'Цель симулятора',
        coordinates: '[SIM]',
        side: 'defender',
      },
      priority: readCombatPriority(),
    });
    const checked = validateCombatInput(combatInput);
    if (!checked.ok) {
      setNotice(checked.errors[0]?.message ?? 'Сценарий не прошёл валидацию.');
      return;
    }
    const report = resolveCombat(checked.value, { reportId: nextIdentity('simulation') });
    setResult(report);
    setResultSaved(false);
    setNotice(`Расчёт завершён: ${report.roundCount} раунд(ов), результат — ${report.winner === 'draw' ? 'ничья' : report.winner === 'attacker' ? 'победа атакующего' : 'победа защитника'}.`);
  };

  const saveResultToBattles = () => {
    if (!result) return;
    const next = addBattleReportSaved(readBattleHistory(), result);
    const persisted = persistBattleHistory(next);
    setResultSaved(persisted.ok && persisted.value.savedReportIds.includes(result.id));
    setNotice(persisted.ok ? '✓ Отчёт сохранён в Битвы' : `⚠ ${persisted.error}`);
  };

  const savePreset = () => {
    const name = presetName.trim() || `Сценарий ${simulatorState.presets.length + 1}`;
    const preset = {
      id: nextIdentity('preset'),
      name,
      createdAt: new Date().toISOString(),
      input: scenario,
    };
    const next = upsertSimulatorPreset(readSimulatorState(), preset);
    const persisted = persistSimulatorState(next);
    if (persisted.ok) {
      setSimulatorState(persisted.value);
      setSelectedPresetId(preset.id);
      setPresetName('');
      setNotice(`Preset «${preset.name}» сохранён.`);
    } else {
      setNotice(`⚠ ${persisted.error}`);
    }
  };

  const loadPreset = () => {
    const preset = simulatorState.presets.find((item) => item.id === selectedPresetId);
    if (!preset) return;
    setScenario(preset.input);
    setResult(null);
    setResultSaved(false);
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
    } else {
      setNotice(`⚠ ${persisted.error}`);
    }
  };

  const activeCommanderLabel = (id: CommanderId | null) => id
    ? `${COMMANDER_ABILITIES[id].commanderName} · ${COMMANDER_ABILITIES[id].ability}`
    : 'не выбран';

  return (
    <section className="simulator-view-v1 fleet-page-shell-v1">
      <header className="fleet-page-head-v1">
        <div>
          <small>УПРАВЛЕНИЕ ФЛОТОМ · {planetName} {coords}</small>
          <h2>СИМУЛЯТОР</h2>
          <p>Детерминированный расчёт по правилам Combat Resolver v1.</p>
        </div>
        <button type="button" className="fleet-page-back-v1" onClick={onBack}>← К ФЛОТАМ</button>
      </header>

      <section className="simulator-toolbar-v1">
        <div className="sim-rounds-v1" role="group" aria-label="Максимум раундов">
          <span>МАКС. РАУНДОВ</span>
          {SIMULATOR_MAX_ROUNDS.map((rounds) => (
            <button
              key={rounds}
              type="button"
              className={scenario.maxRounds === rounds ? 'active' : ''}
              aria-pressed={scenario.maxRounds === rounds}
              onClick={() => setScenario((current) => ({ ...current, maxRounds: rounds }))}
            >{rounds}</button>
          ))}
        </div>
        <button type="button" className="sim-clear-v1" onClick={clearAll}>ОЧИСТИТЬ ВСЁ</button>
      </section>

      <section className="sim-presets-v1" aria-label="Presets симулятора">
        <div>
          <label htmlFor="sim-preset-name">НАЗВАНИЕ PRESET</label>
          <input id="sim-preset-name" value={presetName} maxLength={48} placeholder="Например: Линкоры против матриц" onChange={(event) => setPresetName(event.target.value)} />
          <button type="button" onClick={savePreset}>СОХРАНИТЬ СЦЕНАРИЙ</button>
        </div>
        <div>
          <label htmlFor="sim-preset-select">СОХРАНЁННЫЕ</label>
          <select id="sim-preset-select" value={selectedPresetId} onChange={(event) => setSelectedPresetId(event.target.value)}>
            <option value="">Выбери preset</option>
            {simulatorState.presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
          </select>
          <button type="button" disabled={!selectedPresetId} onClick={loadPreset}>ЗАГРУЗИТЬ</button>
          <button type="button" disabled={!selectedPresetId} onClick={deletePreset}>УДАЛИТЬ</button>
        </div>
      </section>

      <div className="sim-sides-v1">
        <section className="sim-side-v1">
          <header><div><small>СТОРОНА 01</small><h3>АТАКУЮЩИЙ</h3></div><button type="button" onClick={() => clearSide('attacker')}>ОЧИСТИТЬ СТОРОНУ</button></header>
          <RaceSelector id="sim-attacker-race" label="РАСА АТАКУЮЩЕГО" value={scenario.attackerFactionId} onChange={(factionId) => changeFaction('attacker', factionId)} />
          <PopulationMeter label="ФЛОТ" value={population.attackerFleet} />
          <div className="sim-active-commander-v1"><span>Ведущий командир</span><strong>{activeCommanderLabel(activeCommanders.attacker)}</strong></div>
          <UnitSection id="sim-attacker-ships" title={`КОРАБЛИ · ${getCombatFactionName(scenario.attackerFactionId).toUpperCase()}`} open={expanded.attackerShips} entities={SHIP_COMBAT_CATALOG} scenario={scenario} side="attacker" category="ships" onToggle={() => toggleExpanded('attackerShips')} onScenario={setScenario} />
          <UnitSection id="sim-attacker-commanders" title="КОМАНДИРСКИЕ" open={expanded.attackerCommanders} entities={COMMANDER_COMBAT_CATALOG} scenario={scenario} side="attacker" category="commanders" onToggle={() => toggleExpanded('attackerCommanders')} onScenario={setScenario} />
        </section>

        <section className="sim-side-v1">
          <header><div><small>СТОРОНА 02</small><h3>ЗАЩИТНИК</h3></div><button type="button" onClick={() => clearSide('defender')}>ОЧИСТИТЬ СТОРОНУ</button></header>
          <RaceSelector id="sim-defender-race" label="РАСА ЗАЩИТНИКА" value={scenario.defenderFactionId} onChange={(factionId) => changeFaction('defender', factionId)} />
          <PopulationMeter label="ФЛОТ" value={population.defenderFleet} />
          <PopulationMeter label="ОБОРОНА" value={population.defenderDefense} />
          <div className="sim-active-commander-v1"><span>Ведущий командир</span><strong>{activeCommanderLabel(activeCommanders.defender)}</strong></div>
          <UnitSection id="sim-defender-ships" title={`КОРАБЛИ · ${getCombatFactionName(scenario.defenderFactionId).toUpperCase()}`} open={expanded.defenderShips} entities={SHIP_COMBAT_CATALOG} scenario={scenario} side="defender" category="ships" onToggle={() => toggleExpanded('defenderShips')} onScenario={setScenario} />
          <UnitSection id="sim-defender-commanders" title="КОМАНДИРСКИЕ" open={expanded.defenderCommanders} entities={COMMANDER_COMBAT_CATALOG} scenario={scenario} side="defender" category="commanders" onToggle={() => toggleExpanded('defenderCommanders')} onScenario={setScenario} />
          <UnitSection id="sim-defender-defenses" title={`ОБОРОНА · ${getCombatFactionName(scenario.defenderFactionId).toUpperCase()}`} open={expanded.defenderDefenses} entities={DEFENSE_COMBAT_CATALOG} scenario={scenario} side="defender" category="defenses" onToggle={() => toggleExpanded('defenderDefenses')} onScenario={setScenario} />
        </section>
      </div>

      <section className="sim-race-mechanics-note-v1">
        <strong>РАСЫ В СИМУЛЯТОРЕ</strong>
        <span>Атакующий и защитник выбираются независимо. В Combat Resolver v1 отдельные расовые коэффициенты не применяются: расчёт использует текущий общий combat catalog.</span>
      </section>

      <section className={`sim-validation-v1 ${validation.ok ? 'ok' : 'error'}`} aria-live="polite">
        <div><strong>{validation.ok ? 'СЦЕНАРИЙ ГОТОВ' : 'НУЖНО ИСПРАВИТЬ СЦЕНАРИЙ'}</strong><span>{notice}</span></div>
        {!validation.ok ? <ul>{validation.errors.slice(0, 5).map((error, index) => <li key={`${error.path}-${index}`}>{error.message}</li>)}</ul> : null}
        <button type="button" className="sim-run-v1" disabled={!validation.ok} onClick={runSimulation}>СИМУЛИРОВАТЬ БОЙ</button>
      </section>

      {result ? (
        <section className="sim-result-v1">
          <header className="sim-result-head-v1">
            <div><small>COMBAT RESOLVER V1</small><h3>РЕЗУЛЬТАТ СИМУЛЯЦИИ</h3><span>{result.metadata?.note}</span></div>
            <div>
              <button type="button" disabled={resultSaved} onClick={saveResultToBattles}>{resultSaved ? '✓ СОХРАНЕНО В БИТВЫ' : 'СОХРАНИТЬ В БИТВЫ'}</button>
              <button type="button" onClick={() => { setResult(null); setResultSaved(false); setNotice('Результат очищен. Сценарий сохранён.'); }}>ОЧИСТИТЬ РЕЗУЛЬТАТ</button>
            </div>
          </header>
          <BattleReportDetailBody report={result} />
        </section>
      ) : null}
    </section>
  );
}
