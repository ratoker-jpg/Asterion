import { COMMANDER_IDS, type CommanderId } from '../domain/combat/commanders.ts';
import { getCombatFactionName, type CombatFactionId } from '../domain/combat/factions.ts';
import { getFactionCombatEntity, getFactionDefenseCatalog, getFactionShipCatalog } from '../domain/combat/faction-catalog.ts';
import type { CombatEntityId, DefenseId, ShipId } from '../domain/combat/ids.ts';
import { DEFAULT_COMBAT_PRIORITY as DEFAULT_PRIORITY } from '../domain/combat/priority.ts';
import { resolveCombat } from '../domain/combat/resolver.ts';
import type { BattleReport } from '../domain/combat/report.ts';
import { COMBAT_TECHNOLOGIES, normalizeCombatTechnologies, type CombatTechnologyLevels } from '../domain/combat/technologies.ts';
import type { CombatInput, CombatStackInput, SimulatorMaxRounds } from '../domain/combat/simulator.ts';
import { getEspionageTargets } from '../domain/espionage/runtime.ts';
import type { SpyOwnerProfile, SpyTargetState } from '../domain/espionage/types.ts';
import { calculateDefensePopulation } from '../domain/fleet/production.ts';
import { calculateFleetPopulation, removeSolarSatellitesFromFleet, type OwnedFleetState } from '../domain/fleet/runtime.ts';
import { addDebris, getCappedDelivery, getFleetCargoCapacity, type TransportCargo } from '../domain/flights/cargo.ts';
import { getStorageCapacities } from '../domain/buildings/resource-zone.ts';
import { createDefaultRepairWorkshopState, claimDefensiveBattleRepair, annotateBattleReportRepair } from '../domain/repair/workshop.ts';
import type { FlightRecord } from '../domain/flights/types.ts';
import type { SaveState } from './contracts.ts';
import { getPlanetResources, replacePlanetResources, replacePlanetState } from './contracts.ts';
import { resolveSpyTarget } from './espionage-targets.ts';
import type { AttackLaunchSnapshot, AttackLoot, AttackResolution } from '../domain/attack/types.ts';
import { UNIVERSE_NPC_OWNER_ID } from '../domain/universe/runtime.ts';

const ATTACK_MAX_ROUNDS: readonly SimulatorMaxRounds[] = [5, 8, 12];
const ATTACK_REPORT_PREFIX = 'battle-attack-';
const ATTACK_UTILITY_SHIPS = new Set<ShipId>([
  'solar-satellite',
  'spy-probe',
  'transporter',
  'mega-transporter',
  'colonizer',
  'recycler',
]);

function safeCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function safeLevel(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function coordinateLabel(coordinate: FlightRecord['destinationCoordinate']): string {
  return `[${coordinate.galaxy}:${coordinate.system}:${coordinate.position}]`;
}

export function technologiesFromScience(levels: Partial<Record<number, number>> | undefined): CombatTechnologyLevels {
  const normalized = normalizeCombatTechnologies(Object.fromEntries(COMBAT_TECHNOLOGIES.map((technology) => [
    technology.id,
    safeLevel(levels?.[technology.sourceScienceId]),
  ])));
  // The canonical resolver models these three branches as mutually exclusive.
  // Preserve the strongest live branch in the production input while keeping
  // the full science-derived values in the surrounding save state.
  const exclusive = ['piercingAttack', 'maneuverDefense', 'criticalHit'] as const;
  const selected = exclusive.reduce((best, id) => normalized[id] > normalized[best] ? id : best, exclusive[0]);
  for (const id of exclusive) {
    if (id !== selected) normalized[id] = 0;
  }
  return normalized;
}

function commanderLevelsFromPlanet(state: SaveState, planetId: string, selected: Partial<Record<CommanderId, number>>) {
  const levels = state.planets[planetId]?.spaceportUpgrades.shipLevels ?? {};
  return Object.fromEntries(Object.keys(selected).map((id) => [id, safeLevel(levels[id])])) as Partial<Record<CommanderId, number>>;
}

export function normalizeAttackRounds(value: unknown): SimulatorMaxRounds {
  return ATTACK_MAX_ROUNDS.includes(value as SimulatorMaxRounds) ? value as SimulatorMaxRounds : 8;
}

export function createAttackLaunchSnapshot(
  state: SaveState,
  originPlanetId: string,
  maxRounds: SimulatorMaxRounds,
  selectedCommanders: Partial<Record<CommanderId, number>>,
): AttackLaunchSnapshot {
  const planet = state.planets[originPlanetId];
  const shipLevels = Object.fromEntries(
    Object.entries(planet?.spaceportUpgrades.shipLevels ?? {}).map(([id, level]) => [id, safeLevel(level)]),
  ) as Partial<Record<ShipId, number>>;
  const selectedCommanderIds = COMMANDER_IDS.filter((id) => safeCount(selectedCommanders[id]) > 0);
  return {
    version: 1,
    maxRounds: normalizeAttackRounds(maxRounds),
    attackerFactionId: state.profile.factionId as CombatFactionId,
    attackerTechnologies: technologiesFromScience(state.science.levels),
    attackerShipLevels: shipLevels,
    attackerCommanderLevels: commanderLevelsFromPlanet(state, originPlanetId, Object.fromEntries(selectedCommanderIds.map((id) => [id, 1]))),
    attackerPriority: [...(state.combatPriority?.attack ?? DEFAULT_PRIORITY.attack)],
  };
}

function selectedCommanderStacks(
  selected: Partial<Record<CommanderId, number>> | undefined,
  levels: Partial<Record<CommanderId, number>> | undefined,
  priority: readonly CommanderId[],
): CombatStackInput[] {
  const result = COMMANDER_IDS.flatMap((id) => {
    const count = safeCount(selected?.[id]);
    return count > 0 ? [{ entityId: id as CombatEntityId, count, level: safeLevel(levels?.[id]) }] : [];
  });
  return [...priority.filter((id) => result.some((stack) => stack.entityId === id)), ...result.map((stack) => stack.entityId as CommanderId)
    .filter((id, index, all) => all.indexOf(id) === index && !priority.includes(id))]
    .flatMap((id) => result.filter((stack) => stack.entityId === id));
}

function shipStacks(
  factionId: CombatFactionId,
  selected: Partial<Record<ShipId, number>>,
  levels: Partial<Record<ShipId, number>> | undefined,
  excludeUtility: boolean,
): CombatStackInput[] {
  const catalog = getFactionShipCatalog(factionId);
  return Object.entries(selected).flatMap(([rawId, rawCount]) => {
    const id = rawId as ShipId;
    const count = safeCount(rawCount);
    const entity = catalog.find((candidate) => candidate.id === id);
    if (!entity || count <= 0 || (excludeUtility && ATTACK_UTILITY_SHIPS.has(id))) return [];
    return [{ entityId: id as CombatEntityId, count, level: safeLevel(levels?.[id]) }];
  });
}

function targetOwnerProfile(state: SaveState, target: SpyTargetState): SpyOwnerProfile | undefined {
  return target.ownerProfile
    ?? (target.ownerId === UNIVERSE_NPC_OWNER_ID ? state.espionage?.bot01Profile : undefined);
}

function targetCommanderStacks(state: SaveState, target: SpyTargetState, priority: readonly CommanderId[]): CombatStackInput[] {
  const profile = targetOwnerProfile(state, target);
  const selected = Object.fromEntries(COMMANDER_IDS.map((id) => [id, target.fleet.commanders[id] ?? target.commanders?.[id]?.count ?? 0])) as Partial<Record<CommanderId, number>>;
  const levels = Object.fromEntries(COMMANDER_IDS.map((id) => [id, safeLevel(target.commanders?.[id]?.level ?? profile?.commanderLevels[id])])) as Partial<Record<CommanderId, number>>;
  return selectedCommanderStacks(selected, levels, priority);
}

function targetDefenseStacks(target: SpyTargetState): CombatStackInput[] {
  return Object.entries(target.defense.defenses).flatMap(([rawId, rawCount]) => {
    const id = rawId as DefenseId;
    const count = safeCount(rawCount);
    const isSingleCopyShield = id === 'tower-shield' || id === 'planetary-shield';
    return count > 0 && getFactionDefenseCatalog(target.raceId).some((entity) => entity.id === id)
      ? [{ entityId: id as CombatEntityId, count: isSingleCopyShield ? 1 : count, level: 0 }]
      : [];
  });
}

function targetShipStacksWithProfile(state: SaveState, target: SpyTargetState): CombatStackInput[] {
  return shipStacks(target.raceId, target.fleet.ships, targetOwnerProfile(state, target)?.shipLevels, false);
}

function reportDestroyedDebris(report: BattleReport, side: 'attacker' | 'defender', factionId: CombatFactionId): number {
  const force = side === 'attacker' ? report.attackerForce : report.defenderForce;
  let debris = 0;
  for (const stack of [...(force.stacks ?? []), ...(force.defenses ?? [])]) {
    const entity = getFactionCombatEntity(factionId, stack.entityId);
    if (entity.kind !== 'ship' && entity.kind !== 'defense') continue;
    const destroyed = safeCount(stack.destroyed);
    debris += Math.floor(entity.cost.metal * destroyed * 0.30)
      + Math.floor(entity.cost.minerals * destroyed * 0.30);
  }
  return debris;
}

export function calculateAttackDebris(report: BattleReport, attackerFactionId: CombatFactionId, defenderFactionId: CombatFactionId): number {
  return reportDestroyedDebris(report, 'attacker', attackerFactionId)
    + reportDestroyedDebris(report, 'defender', defenderFactionId);
}

function survivorsCargo(report: BattleReport, factionId: CombatFactionId) {
  const ships: Partial<Record<ShipId, number>> = {};
  for (const stack of report.attackerForce.stacks ?? []) {
    const id = stack.entityId as ShipId;
    const entity = getFactionCombatEntity(factionId, stack.entityId);
    if (entity.kind !== 'ship' || ATTACK_UTILITY_SHIPS.has(id)) continue;
    if (safeCount(stack.countAfter) > 0) ships[id] = safeCount(stack.countAfter);
  }
  const catalog = Object.fromEntries(getFactionShipCatalog(factionId).map((entity) => [entity.id, { cargo: entity.ship?.cargo ?? 0 }]));
  return { ships, capacity: getFleetCargoCapacity(ships, catalog) };
}

export function calculateAttackLoot(
  report: BattleReport,
  targetResources: { metal: number; minerals: number; gas: number },
  attackerFactionId: CombatFactionId,
): AttackLoot {
  const survivors = survivorsCargo(report, attackerFactionId);
  const survivorCount = Object.values(survivors.ships).reduce((total, count) => total + safeCount(count), 0);
  if (report.winner !== 'attacker' || survivorCount <= 0 || survivors.capacity <= 0) return { metal: 0, minerals: 0, gas: 0, debris: 0 };
  let free = survivors.capacity;
  const loot = { metal: 0, minerals: 0, gas: 0, debris: 0 };
  for (const key of ['metal', 'minerals', 'gas'] as const) {
    const maximum = Math.floor(Math.max(0, targetResources[key]) * 0.75);
    loot[key] = Math.min(maximum, free);
    free -= loot[key];
  }
  return loot;
}

function applyDestroyedToFleet(fleet: OwnedFleetState, reportForce: BattleReport['attackerForce'] | BattleReport['defenderForce'], factionId: CombatFactionId): OwnedFleetState {
  const next: OwnedFleetState = {
    ships: { ...fleet.ships },
    commanders: { ...fleet.commanders },
  };
  for (const stack of [...(reportForce.stacks ?? []), ...(reportForce.defenses ?? [])]) {
    const entity = getFactionCombatEntity(factionId, stack.entityId);
    const destroyed = safeCount(stack.destroyed);
    if (destroyed <= 0) continue;
    if (entity.kind === 'ship' && entity.id !== 'solar-satellite') {
      const id = entity.id as ShipId;
      next.ships[id] = Math.max(0, safeCount(next.ships[id]) - destroyed);
    } else if (entity.kind === 'commander') {
      const id = entity.id as CommanderId;
      next.commanders[id] = Math.max(0, safeCount(next.commanders[id]) - destroyed);
    }
  }
  return next;
}

function applyDestroyedToTarget(state: SaveState, target: SpyTargetState, report: BattleReport): SpyTargetState {
  const fleet = applyDestroyedToFleet(target.fleet, report.defenderForce, target.raceId);
  const defense = { defenses: { ...target.defense.defenses } };
  for (const stack of report.defenderForce.defenses ?? []) {
    const id = stack.entityId as DefenseId;
    defense.defenses[id] = Math.max(0, safeCount(defense.defenses[id]) - safeCount(stack.destroyed));
  }
  const commanders = Object.fromEntries(Object.entries(target.commanders ?? {}).map(([id, snapshot]) => [
    id,
    { ...snapshot, count: Math.max(0, safeCount(snapshot.count) - safeCount(report.defenderForce.stacks.find((stack) => stack.entityId === id)?.destroyed)) },
  ])) as SpyTargetState['commanders'];
  const fleetPopulation = calculateFleetPopulation(fleet, target.raceId);
  const defensePopulation = calculateDefensePopulation(defense, target.raceId);
  return {
    ...target,
    fleet,
    defense,
    commanders,
    population: { total: fleetPopulation + defensePopulation, fleet: fleetPopulation, defense: defensePopulation },
  };
}

function withTargetState(state: SaveState, target: SpyTargetState): SaveState {
  const espionage = state.espionage;
  if (!espionage) return state;
  const targets = { ...getEspionageTargets(espionage), [target.id]: target };
  return {
    ...state,
    espionage: {
      ...espionage,
      targets,
      ...(espionage.bot01Planets ? { bot01Planets: targets } : {}),
    },
  };
}

function addReport(state: SaveState, report: BattleReport): SaveState {
  return state.combat.reports.some((candidate) => candidate.id === report.id)
    ? state
    : { ...state, combat: { ...state.combat, reports: [...state.combat.reports, report] } };
}

function reportLoot(report: BattleReport): AttackLoot {
  return {
    metal: safeCount(report.resources?.metal),
    minerals: safeCount(report.resources?.minerals),
    gas: safeCount(report.resources?.gas),
    debris: safeCount(report.debris),
  };
}

function resolveTargetForFlight(state: SaveState, flight: FlightRecord): SpyTargetState | null {
  if (!flight.destinationPlanetId) return null;
  const resolved = resolveSpyTarget(state, flight.destinationPlanetId, { coordinate: flight.destinationCoordinate });
  return resolved?.target ?? null;
}

function createAttackInput(state: SaveState, flight: FlightRecord, target: SpyTargetState): CombatInput {
  const snapshot = flight.attackSnapshot!;
  const targetProfile = targetOwnerProfile(state, target);
  const defenderPriority = [...DEFAULT_PRIORITY.defense];
  const attackerShips = shipStacks(snapshot.attackerFactionId, flight.selectedShips, snapshot.attackerShipLevels, true);
  const attackerCommanders = selectedCommanderStacks(flight.selectedCommanders, snapshot.attackerCommanderLevels, snapshot.attackerPriority);
  const defenderShips = targetShipStacksWithProfile(state, target);
  const defenderCommanders = targetCommanderStacks(state, target, defenderPriority);
  const defenderTechnologies = technologiesFromScience(targetProfile?.scienceLevels);
  const origin = state.planets[flight.originPlanetId];
  return {
    scenarioId: flight.id,
    timestamp: new Date(flight.arrivalAt).toISOString(),
    attacker: {
      participant: {
        playerId: state.profile.playerId,
        playerName: state.profile.displayName,
        planetName: origin?.name,
        coordinates: coordinateLabel(flight.originCoordinate),
        race: getCombatFactionName(snapshot.attackerFactionId),
        side: 'attacker',
      },
      factionId: snapshot.attackerFactionId,
      ships: attackerShips,
      commanders: attackerCommanders,
      commander: attackerCommanders[0] ?? null,
      activeCommanderId: (snapshot.attackerPriority.find((id) => attackerCommanders.some((stack) => stack.entityId === id)) ?? null),
    },
    defender: {
      participant: {
        playerId: target.ownerId,
        playerName: target.ownerName,
        planetName: target.name,
        coordinates: coordinateLabel(target.coordinate),
        race: getCombatFactionName(target.raceId),
        side: 'defender',
      },
      factionId: target.raceId,
      ships: defenderShips,
      commanders: defenderCommanders,
      commander: defenderCommanders[0] ?? null,
      activeCommanderId: (defenderPriority.find((id) => defenderCommanders.some((stack) => stack.entityId === id)) ?? null),
      defenses: targetDefenseStacks(target),
    },
    maxRounds: normalizeAttackRounds(snapshot.maxRounds),
    attackerPriority: [...snapshot.attackerPriority],
    defenderPriority,
    attackerTechnologies: snapshot.attackerTechnologies,
    defenderTechnologies,
    technologyMode: 'independent',
    executionMode: 'production',
    seed: `attack:${flight.id}`,
    profileId: 'asterion-attack-v1',
  };
}

export type AttackResolutionResult = {
  state: SaveState;
  report: BattleReport;
  resolution: AttackResolution;
};

/** Resolves a live target exactly once and applies both sides atomically. */
export function resolveAttackAtTarget(state: SaveState, flight: FlightRecord, now: number): AttackResolutionResult | null {
  if (!flight.attackSnapshot || flight.missionId !== 'attack') return null;
  const target = resolveTargetForFlight(state, flight);
  if (!target) return null;
  const reportId = `${ATTACK_REPORT_PREFIX}${flight.id}`;
  const existing = state.combat.reports.find((candidate) => candidate.id === reportId);
  if (existing) {
    const resolution: AttackResolution = flight.attackResolution ?? {
      reportId,
      resolvedAt: safeCount(now),
      debris: safeCount(existing.debris),
      loot: reportLoot(existing),
    };
    return { state, report: existing, resolution };
  }

  const input = createAttackInput(state, flight, target);
  if (input.attacker.ships.length === 0 || (input.defender.ships.length === 0 && (input.defender.defenses?.length ?? 0) === 0)) return null;
  const rawReport = resolveCombat(input, { reportId, missionType: 'attack' });
  const debris = calculateAttackDebris(rawReport, input.attacker.factionId!, input.defender.factionId!);
  const loot = calculateAttackLoot(rawReport, target.resources, input.attacker.factionId!);
  const reportWithOutcome: BattleReport = {
    ...rawReport,
    debris,
    resources: { metal: loot.metal, minerals: loot.minerals, gas: loot.gas },
  };
  const repair = claimDefensiveBattleRepair(target.repair ?? createDefaultRepairWorkshopState(), reportWithOutcome, { allowAttackDefender: true });
  const report = annotateBattleReportRepair(reportWithOutcome, repair);
  const attackerPlanet = state.planets[flight.originPlanetId];
  if (!attackerPlanet) return null;
  const attackerFleet = applyDestroyedToFleet(removeSolarSatellitesFromFleet(attackerPlanet.fleet).fleet, report.attackerForce, input.attacker.factionId!);
  let next = replacePlanetState(state, flight.originPlanetId, { ...attackerPlanet, fleet: attackerFleet });
  const targetAfterLosses = applyDestroyedToTarget(next, { ...target, repair: repair.state }, report);
  const nextResources = {
    ...targetAfterLosses.resources,
    metal: Math.max(0, targetAfterLosses.resources.metal - loot.metal),
    minerals: Math.max(0, targetAfterLosses.resources.minerals - loot.minerals),
    gas: Math.max(0, targetAfterLosses.resources.gas - loot.gas),
    debris: addDebris(targetAfterLosses.resources.debris, debris),
  };
  const updatedTarget: SpyTargetState = {
    ...targetAfterLosses,
    resources: nextResources,
    debris: addDebris(targetAfterLosses.debris, debris),
  };
  next = withTargetState(next, updatedTarget);
  next = addReport(next, report);
  const resolution: AttackResolution = { reportId, resolvedAt: safeCount(now), debris, loot };
  return { state: next, report, resolution };
}

export type AttackLootCreditResult = {
  state: SaveState;
  flight: FlightRecord;
};

/** Credits the materialized loot only when the surviving fleet reaches home. */
export function creditAttackLoot(state: SaveState, flight: FlightRecord, now: number): AttackLootCreditResult {
  const resolution = flight.attackResolution;
  if (!resolution || resolution.lootCreditedAt !== undefined) return { state, flight };
  const origin = state.planets[flight.originPlanetId];
  if (!origin) return { state, flight: { ...flight, attackResolution: { ...resolution, lootCreditedAt: now } } };
  const cargo: TransportCargo = { ...resolution.loot };
  const credit = getCappedDelivery(getPlanetResources(state, flight.originPlanetId), getStorageCapacities(origin.buildings), cargo);
  const nextState = replacePlanetResources(state, flight.originPlanetId, credit.resources);
  const nextFlight: FlightRecord = {
    ...flight,
    attackResolution: { ...resolution, lootCreditedAt: now },
  };
  return { state: nextState, flight: nextFlight };
}

export function isAttackCombatShip(shipId: ShipId, factionId: CombatFactionId): boolean {
  const entity = getFactionShipCatalog(factionId).find((candidate) => candidate.id === shipId);
  return Boolean(entity?.ordinaryClass && !ATTACK_UTILITY_SHIPS.has(shipId));
}

export function getAttackCommanderSelection(state: SaveState, planetId: string): Partial<Record<CommanderId, number>> {
  const commanders = state.planets[planetId]?.fleet.commanders ?? {};
  const reserved: Partial<Record<CommanderId, number>> = {};
  for (const flight of state.flights.records) {
    if (flight.originPlanetId !== planetId || !flight.selectedCommanders || (flight.phase !== 'outbound' && flight.phase !== 'returning' && flight.phase !== 'arrived')) continue;
    for (const id of COMMANDER_IDS) reserved[id] = (reserved[id] ?? 0) + safeCount(flight.selectedCommanders[id]);
  }
  return Object.fromEntries(COMMANDER_IDS.flatMap((id) => {
    const available = Math.min(1, Math.max(0, safeCount(commanders[id]) - safeCount(reserved[id])));
    return available > 0 ? [[id, available]] : [];
  })) as Partial<Record<CommanderId, number>>;
}

export function createAttackPriority(): CommanderId[] {
  return [...DEFAULT_PRIORITY.attack];
}
