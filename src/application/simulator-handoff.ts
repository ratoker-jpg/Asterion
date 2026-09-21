import { createDefaultCombatTechnologies, COMBAT_TECHNOLOGIES, normalizeCombatTechnologies } from '../domain/combat/technologies.ts';
import { createEmptySimulatorScenario, type CombatStackInput, type SimulatorScenario } from '../domain/combat/simulator.ts';
import type { SaveState } from './contracts.ts';
import type { SpyReportSnapshot } from '../domain/espionage/types.ts';
import type { CombatEntityId } from '../domain/combat/ids.ts';

export const SIMULATOR_HANDOFF_REQUEST_EVENT = 'asterion:simulator-handoff-request';

function stacksFromRecord(
  record: Record<string, number> | Partial<Record<string, number>>,
  excludedIds: readonly string[] = [],
  levels: Record<string, number> | Partial<Record<string, number>> = {},
): CombatStackInput[] {
  return Object.entries(record).flatMap(([entityId, count]) => typeof count === 'number' && Number.isInteger(count) && count > 0
    && !excludedIds.includes(entityId)
    ? [{
      entityId: entityId as CombatEntityId,
      count,
      level: Math.max(0, Math.floor(typeof levels[entityId] === 'number' && Number.isFinite(levels[entityId]) ? levels[entityId] : 0)),
    }]
    : []);
}

function commandersFromReport(report: SpyReportSnapshot): CombatStackInput[] {
  return Object.entries(report.commanders ?? {}).flatMap(([entityId, value]) => entityId === 'hunter' || !value || value.count <= 0
    ? []
    : [{ entityId: entityId as CombatEntityId, count: value.count, level: value.level }]);
}

function technologiesFromScience(state: SaveState) {
  return normalizeCombatTechnologies(Object.fromEntries(COMBAT_TECHNOLOGIES.map((technology) => [
    technology.id,
    Math.max(0, Math.floor(state.science.levels[technology.sourceScienceId] ?? 0)),
  ])));
}

function technologiesFromLevels(levels: Partial<Record<number, number>> | undefined) {
  return normalizeCombatTechnologies(Object.fromEntries(COMBAT_TECHNOLOGIES.map((technology) => [
    technology.id,
    Math.max(0, Math.floor(levels?.[technology.sourceScienceId] ?? 0)),
  ])));
}

export function createSimulatorScenarioFromSpyReport(state: SaveState, report: SpyReportSnapshot): SimulatorScenario {
  const scenario = createEmptySimulatorScenario();
  const currentPlanet = state.planets[state.currentPlanetId];
  const attackerShips = currentPlanet?.fleet.ships ?? {};
  const attackerCommanders = currentPlanet?.fleet.commanders ?? {};
  const attackerLevels = currentPlanet?.spaceportUpgrades.shipLevels ?? {};
  const attackerTech = technologiesFromScience(state);
  const defenderTech = state.espionage?.bot01Profile
    ? technologiesFromLevels(state.espionage.bot01Profile.scienceLevels)
    : createDefaultCombatTechnologies();
  const attackerCommanderStacks = stacksFromRecord(attackerCommanders, [], attackerLevels);
  const defenderCommanderStacks = commandersFromReport(report);
  return {
    ...scenario,
    attackerFactionId: state.profile.factionId,
    defenderFactionId: report.targetRaceId,
    attackerTechnologies: attackerTech,
    defenderTechnologies: defenderTech,
    attacker: {
      ...scenario.attacker,
      factionId: state.profile.factionId,
      ships: stacksFromRecord(attackerShips, [], attackerLevels),
      commanders: attackerCommanderStacks,
      commander: attackerCommanderStacks[0] ?? null,
      activeCommanderId: (attackerCommanderStacks[0]?.entityId as SimulatorScenario['attacker']['activeCommanderId']) ?? null,
    },
    defender: {
      ...scenario.defender,
      factionId: report.targetRaceId,
      ships: stacksFromRecord(report.fleet ?? {}, ['spy-probe'], report.fleetLevels ?? {}),
      commanders: defenderCommanderStacks,
      commander: defenderCommanderStacks[0] ?? null,
      activeCommanderId: (defenderCommanderStacks[0]?.entityId as SimulatorScenario['defender']['activeCommanderId']) ?? null,
      defenses: stacksFromRecord(report.defense ?? {}),
    },
  };
}

let pendingScenario: SimulatorScenario | null = null;

export function requestSimulatorHandoff(scenario: SimulatorScenario): void {
  pendingScenario = scenario;
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(SIMULATOR_HANDOFF_REQUEST_EVENT));
}

export function consumeSimulatorHandoff(): SimulatorScenario | null {
  const scenario = pendingScenario;
  pendingScenario = null;
  return scenario;
}
