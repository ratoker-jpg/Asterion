import { COMMANDER_IDS, type CommanderId } from '../domain/combat/commanders.ts';
import { getCombatFactionName, type CombatFactionId } from '../domain/combat/factions.ts';
import { getFactionCombatEntity, getFactionDefenseCatalog, getFactionShipCatalog } from '../domain/combat/faction-catalog.ts';
import { SOLAR_SATELLITE_ID, type CombatEntityId, type DefenseId, type ShipId } from '../domain/combat/ids.ts';
import { DEFAULT_COMBAT_PRIORITY as DEFAULT_PRIORITY } from '../domain/combat/priority.ts';
import { resolveCombat } from '../domain/combat/resolver.ts';
import { resolvePlanetSiege } from '../domain/combat/planet-siege.ts';
import type { BattleReport } from '../domain/combat/report.ts';
import { COMBAT_TECHNOLOGIES, normalizeCombatTechnologies, type CombatTechnologyLevels } from '../domain/combat/technologies.ts';
import type { CombatInput, CombatStackInput, SimulatorMaxRounds } from '../domain/combat/simulator.ts';
import { getEspionageTargets } from '../domain/espionage/runtime.ts';
import type { SpyTargetState } from '../domain/espionage/types.ts';
import { resolveSpyOwnerProfile } from '../domain/espionage/owner-profile.ts';
import { calculateDefensePopulation } from '../domain/fleet/production.ts';
import { calculateFleetPopulation, removeSolarSatellitesFromFleet, resolveSavedFleetState, type OwnedFleetState } from '../domain/fleet/runtime.ts';
import { addDebris, getCappedDelivery, getFleetCargoCapacity, type TransportCargo } from '../domain/flights/cargo.ts';
import { getStorageCapacities } from '../domain/buildings/resource-zone.ts';
import { createDefaultRepairWorkshopState, claimDefensiveBattleRepair, annotateBattleReportRepair } from '../domain/repair/workshop.ts';
import type { FlightRecord } from '../domain/flights/types.ts';
import { getOwnerShipUpgradeLevel, getOwnerShipUpgradeLevels, type PlanetRuntime, type SaveState } from './contracts.ts';
import { getPlanetResources, replacePlanetResources, replacePlanetState } from './contracts.ts';
import { destroyOwnedPlanet, preserveOwnedPlanetOrbitalDebris } from './owned-planets.ts';
import { UNIVERSE_NPC_OWNER_ID } from '../domain/universe/runtime.ts';
import { resolveSpyTarget } from './espionage-targets.ts';
import type { AttackLaunchSnapshot, AttackLoot, AttackResolution } from '../domain/attack/types.ts';

const ATTACK_MAX_ROUNDS: readonly SimulatorMaxRounds[] = [5, 8, 12];
const ATTACK_REPORT_PREFIX = 'battle-attack-';
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
  void planetId;
  return Object.fromEntries(Object.keys(selected).map((id) => [id, getOwnerShipUpgradeLevel(state, id)])) as Partial<Record<CommanderId, number>>;
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
  const shipLevels = Object.fromEntries(
    Object.entries(getOwnerShipUpgradeLevels(state)).map(([id, level]) => [id, safeLevel(level)]),
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
    const count = Math.min(1, safeCount(selected?.[id]));
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
): CombatStackInput[] {
  const catalog = getFactionShipCatalog(factionId);
  return Object.entries(selected).flatMap(([rawId, rawCount]) => {
    const id = rawId as ShipId;
    const count = safeCount(rawCount);
    const entity = catalog.find((candidate) => candidate.id === id);
    if (!entity || count <= 0 || id === SOLAR_SATELLITE_ID) return [];
    return [{ entityId: id as CombatEntityId, count, level: safeLevel(levels?.[id]) }];
  });
}

function targetCommanderStacks(state: SaveState, target: SpyTargetState, priority: readonly CommanderId[]): CombatStackInput[] {
  const profile = resolveSpyOwnerProfile(target, state.espionage?.bot01Profile);
  const selected = Object.fromEntries(COMMANDER_IDS.map((id) => [id, target.fleet.commanders[id] ?? target.commanders?.[id]?.count ?? 0])) as Partial<Record<CommanderId, number>>;
  const levels = Object.fromEntries(COMMANDER_IDS.map((id) => [id, safeLevel(target.commanders?.[id]?.level ?? profile?.commanderLevels[id])])) as Partial<Record<CommanderId, number>>;
  return selectedCommanderStacks(selected, levels, priority);
}

function targetDefenseStacks(target: SpyTargetState): CombatStackInput[] {
  return defenseStacks(target.raceId, target.defense.defenses);
}

function defenseStacks(factionId: CombatFactionId, defenses: Record<string, number>): CombatStackInput[] {
  return Object.entries(defenses).flatMap(([rawId, rawCount]) => {
    const id = rawId as DefenseId;
    const count = safeCount(rawCount);
    const isSingleCopyShield = id === 'tower-shield' || id === 'planetary-shield';
    return count > 0 && getFactionDefenseCatalog(factionId).some((entity) => entity.id === id)
      ? [{ entityId: id as CombatEntityId, count: isSingleCopyShield ? 1 : count, level: 0 }]
      : [];
  });
}

function targetShipStacksWithProfile(state: SaveState, target: SpyTargetState): CombatStackInput[] {
  return shipStacks(target.raceId, target.fleet.ships, resolveSpyOwnerProfile(target, state.espionage?.bot01Profile)?.shipLevels);
}

function reportDestroyedDebris(report: BattleReport, side: 'attacker' | 'defender', factionId: CombatFactionId): number {
  const force = side === 'attacker' ? report.attackerForce : report.defenderForce;
  let debris = 0;
  for (const stack of [...(force.stacks ?? []), ...(force.defenses ?? [])]) {
    const entity = getFactionCombatEntity(factionId, stack.entityId);
    // Commanders are combat ships in the same construction catalog. Their
    // destroyed hulls therefore contribute to orbit debris just like regular
    // ships and defensive installations.
    if (entity.kind !== 'ship' && entity.kind !== 'commander' && entity.kind !== 'defense') continue;
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
    if (entity.kind !== 'ship' || id === SOLAR_SATELLITE_ID) continue;
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

function preserveOrbitalDebris(
  state: SaveState,
  target: SpyTargetState,
  debris: number,
  reportId: string,
  now: number,
): SaveState {
  if (debris <= 0 || !state.espionage) return state;
  const previous = state.espionage.orbitalDebris?.[target.id];
  const record = {
    id: previous?.id ?? `orbital-debris-${target.id}`,
    targetPlanetId: target.id,
    targetPlanetName: target.name,
    targetOwnerId: target.ownerId,
    targetCoordinate: { ...target.coordinate },
    debris: Math.max(previous?.debris ?? 0, safeCount(debris)),
    createdAt: previous?.createdAt ?? safeCount(now),
    reportId: previous?.reportId ?? reportId,
  };
  return {
    ...state,
    espionage: {
      ...state.espionage,
      orbitalDebris: { ...(state.espionage.orbitalDebris ?? {}), [target.id]: record },
    },
  };
}

function removeTargetState(state: SaveState, targetId: string, now: number): SaveState {
  const espionage = state.espionage;
  if (!espionage) return state;
  const targets = { ...getEspionageTargets(espionage) };
  delete targets[targetId];
  return {
    ...state,
    espionage: {
      ...espionage,
      targets,
      ...(espionage.bot01Planets ? { bot01Planets: targets } : {}),
      missions: espionage.missions.map((mission) => mission.targetPlanetId === targetId
        && mission.status !== 'returned'
        && mission.status !== 'destroyed'
        && mission.status !== 'target-destroyed'
        ? { ...mission, status: 'target-destroyed', destroyedAt: now, targetDestroyedAt: now, nextReportAt: undefined }
        : mission),
    },
  };
}

function lastCombatEventSequence(report: BattleReport) {
  return report.rounds.reduce((last, round) => round.events.reduce((roundLast, event) => Math.max(roundLast, event.sequence), last), 0);
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
  const targetProfile = resolveSpyOwnerProfile(target, state.espionage?.bot01Profile);
  const defenderPriority = [...DEFAULT_PRIORITY.defense];
  const attackerShips = shipStacks(snapshot.attackerFactionId, flight.selectedShips, snapshot.attackerShipLevels);
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
  const reportId = `${ATTACK_REPORT_PREFIX}${flight.id}`;
  const existing = state.combat.reports.find((candidate) => candidate.id === reportId);
  if (existing) {
    const resolution: AttackResolution = flight.attackResolution ?? {
      reportId,
      resolvedAt: safeCount(now),
      debris: safeCount(existing.debris),
      loot: reportLoot(existing),
      planetDestroyed: existing.siege?.planetDestroyed === true,
    };
    return { state, report: existing, resolution };
  }
  const target = resolveTargetForFlight(state, flight);
  if (!target) return null;

  const input = createAttackInput(state, flight, target);
  if (input.attacker.ships.length === 0) return null;
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
  const { debris: _legacyDebris, ...targetWithoutLegacyDebris } = targetAfterLosses;
  const targetWithLoot: SpyTargetState = {
    ...targetWithoutLegacyDebris,
    resources: nextResources,
  };
  const ownerPlanetCount = Object.values(getEspionageTargets(next.espionage))
    .filter((candidate) => candidate.ownerId === target.ownerId)
    .length;
  const siege = resolvePlanetSiege(report, targetWithLoot, {
    seed: input.seed ?? `attack:${flight.id}`,
    reportId,
    attackerFleetId: flight.id,
    attackerFactionId: input.attacker.factionId!,
    defenderFactionId: input.defender.factionId!,
    targetOwnerPlanetCount: ownerPlanetCount,
    eventSequence: lastCombatEventSequence(report),
  });
  const reportWithSiege: BattleReport = { ...report, siege: siege.report };
  next = siege.planetDestroyed
    ? removeTargetState(
      preserveOrbitalDebris(next, target, targetWithLoot.resources.debris, reportId, now),
      target.id,
      now,
    )
    : withTargetState(next, siege.target);
  next = addReport(next, reportWithSiege);
  const resolution: AttackResolution = { reportId, resolvedAt: safeCount(now), debris, loot, planetDestroyed: siege.planetDestroyed };
  return { state: next, report: reportWithSiege, resolution };
}

/** Captures Bot 01's existing profile for the single persisted incoming test attack. */
export function createBot01IncomingAttackSnapshot(
  source: SpyTargetState,
  profile: { scienceLevels: Partial<Record<number, number>>; shipLevels: Partial<Record<ShipId, number>>; commanderLevels: Partial<Record<CommanderId, number>> },
): AttackLaunchSnapshot {
  return {
    version: 1,
    maxRounds: 8,
    attackerFactionId: source.raceId,
    attackerTechnologies: technologiesFromScience(profile.scienceLevels),
    attackerShipLevels: Object.fromEntries(Object.entries(profile.shipLevels).map(([id, level]) => [id, safeLevel(level)])),
    attackerCommanderLevels: Object.fromEntries(Object.entries(profile.commanderLevels).map(([id, level]) => [id, safeLevel(level)])),
    attackerPriority: [...DEFAULT_PRIORITY.attack],
  };
}

function availableOwnedFleetForCombat(state: SaveState, planetId: string, planet: PlanetRuntime): OwnedFleetState {
  const available = removeSolarSatellitesFromFleet(resolveSavedFleetState(planet.fleet, state.profile.factionId)).fleet;
  const ships = { ...available.ships };
  const commanders = { ...available.commanders };
  for (const flight of state.flights.records) {
    if ((flight.ownerSide === 'bot01')
      || flight.originPlanetId !== planetId
      || !['outbound', 'returning', 'arrived'].includes(flight.phase)) continue;
    for (const [shipId, quantity] of Object.entries(flight.selectedShips) as [ShipId, number][]) {
      ships[shipId] = Math.max(0, safeCount(ships[shipId]) - safeCount(quantity));
    }
    for (const [commanderId, quantity] of Object.entries(flight.selectedCommanders ?? {}) as [CommanderId, number][]) {
      commanders[commanderId] = Math.max(0, safeCount(commanders[commanderId]) - safeCount(quantity));
    }
  }
  return { ships, commanders };
}

function createBot01IncomingAttackInput(
  state: SaveState,
  flight: FlightRecord,
  source: SpyTargetState,
  target: PlanetRuntime,
): CombatInput {
  const snapshot = flight.attackSnapshot!;
  const defenderPriority = [...DEFAULT_PRIORITY.defense];
  const defenderFleet = availableOwnedFleetForCombat(state, flight.destinationPlanetId!, target);
  const defenderCommanderLevels = Object.fromEntries(COMMANDER_IDS.map((id) => [id, getOwnerShipUpgradeLevel(state, id)])) as Partial<Record<CommanderId, number>>;
  const defenderShips = shipStacks(state.profile.factionId as CombatFactionId, defenderFleet.ships, getOwnerShipUpgradeLevels(state) as Partial<Record<ShipId, number>>);
  const defenderCommanders = selectedCommanderStacks(defenderFleet.commanders, defenderCommanderLevels, defenderPriority);
  const attackerShips = shipStacks(snapshot.attackerFactionId, flight.selectedShips, snapshot.attackerShipLevels);
  const attackerCommanders = selectedCommanderStacks(flight.selectedCommanders, snapshot.attackerCommanderLevels, snapshot.attackerPriority);
  const coordinate = {
    galaxy: target.universeGalaxy ?? 1,
    system: target.universeSystem ?? 1,
    position: target.universePosition ?? 1,
  };
  const targetCoordinates = coordinateLabel(coordinate);
  const attackerCoordinates = coordinateLabel(flight.originCoordinate);
  return {
    scenarioId: flight.id,
    timestamp: new Date(flight.arrivalAt).toISOString(),
    attacker: {
      participant: {
        playerId: source.ownerId,
        playerName: source.ownerName,
        planetName: source.name,
        coordinates: attackerCoordinates,
        race: getCombatFactionName(snapshot.attackerFactionId),
        side: 'attacker',
      },
      factionId: snapshot.attackerFactionId,
      ships: attackerShips,
      commanders: attackerCommanders,
      commander: attackerCommanders[0] ?? null,
      activeCommanderId: snapshot.attackerPriority.find((id) => attackerCommanders.some((stack) => stack.entityId === id)) ?? null,
    },
    defender: {
      participant: {
        playerId: state.profile.playerId,
        playerName: state.profile.displayName,
        planetName: target.name,
        coordinates: targetCoordinates,
        race: getCombatFactionName(state.profile.factionId as CombatFactionId),
        side: 'defender',
      },
      factionId: state.profile.factionId as CombatFactionId,
      ships: defenderShips,
      commanders: defenderCommanders,
      commander: defenderCommanders[0] ?? null,
      activeCommanderId: defenderPriority.find((id) => defenderCommanders.some((stack) => stack.entityId === id)) ?? null,
      defenses: defenseStacks(state.profile.factionId as CombatFactionId, target.defense.defenses),
    },
    maxRounds: normalizeAttackRounds(snapshot.maxRounds),
    attackerPriority: [...snapshot.attackerPriority],
    defenderPriority,
    attackerTechnologies: snapshot.attackerTechnologies,
    defenderTechnologies: technologiesFromScience(state.science.levels),
    technologyMode: 'independent',
    executionMode: 'production',
    seed: `bot01-incoming:${flight.id}`,
    profileId: 'asterion-attack-v1',
  };
}

/** Resolves the Bot 01 demonstration against an actual owned PlanetRuntime. */
export function resolveBot01IncomingAttack(state: SaveState, flight: FlightRecord, now: number): AttackResolutionResult | null {
  if (flight.ownerSide !== 'bot01' || flight.missionId !== 'attack' || !flight.attackSnapshot || !flight.destinationPlanetId) return null;
  const reportId = `battle-bot01-incoming-${flight.id}`;
  const existing = state.combat.reports.find((candidate) => candidate.id === reportId);
  if (existing) {
    const resolution: AttackResolution = flight.attackResolution ?? {
      reportId,
      resolvedAt: safeCount(existing.timestamp ? Date.parse(existing.timestamp) : now),
      debris: safeCount(existing.debris),
      loot: reportLoot(existing),
      planetDestroyed: existing.siege?.planetDestroyed === true,
    };
    return { state, report: existing, resolution };
  }
  const espionage = state.espionage;
  const source = espionage ? getEspionageTargets(espionage)[flight.originPlanetId] : undefined;
  const target = state.planets[flight.destinationPlanetId];
  if (!source || source.ownerId !== UNIVERSE_NPC_OWNER_ID || !target) return null;

  const input = createBot01IncomingAttackInput(state, flight, source, target);
  if (input.attacker.ships.length === 0) return null;
  const rawReport = resolveCombat(input, { reportId, missionType: 'attack' });
  const debris = calculateAttackDebris(rawReport, input.attacker.factionId!, input.defender.factionId!);
  const targetResources = getPlanetResources(state, flight.destinationPlanetId);
  const loot = calculateAttackLoot(rawReport, targetResources, input.attacker.factionId!);
  const reportWithOutcome: BattleReport = {
    ...rawReport,
    debris,
    resources: { metal: loot.metal, minerals: loot.minerals, gas: loot.gas },
  };
  const repair = claimDefensiveBattleRepair(target.repair ?? createDefaultRepairWorkshopState(), reportWithOutcome, { allowAttackDefender: true });
  const report = annotateBattleReportRepair(reportWithOutcome, repair);
  const defenses = { defenses: { ...target.defense.defenses } };
  for (const stack of report.defenderForce.defenses ?? []) {
    const id = stack.entityId as DefenseId;
    defenses.defenses[id] = Math.max(0, safeCount(defenses.defenses[id]) - safeCount(stack.destroyed));
  }
  const targetAfterLosses = {
    ...target,
    fleet: applyDestroyedToFleet(target.fleet, report.defenderForce, state.profile.factionId as CombatFactionId),
    defense: defenses,
    repair: repair.state,
  };
  const resourcesAfterLoot = {
    metal: Math.max(0, targetResources.metal - loot.metal),
    minerals: Math.max(0, targetResources.minerals - loot.minerals),
    gas: Math.max(0, targetResources.gas - loot.gas),
  };
  const siegeTarget = {
    id: flight.destinationPlanetId,
    name: target.name,
    coordinate: { galaxy: target.universeGalaxy ?? 1, system: target.universeSystem ?? 1, position: target.universePosition ?? 1 },
    buildings: target.buildings,
    buildingQueue: state.queues[flight.destinationPlanetId] ?? [],
  };
  const siege = resolvePlanetSiege(report, siegeTarget, {
    seed: input.seed ?? `bot01-incoming:${flight.id}`,
    reportId,
    attackerFleetId: flight.id,
    attackerFactionId: input.attacker.factionId!,
    defenderFactionId: input.defender.factionId!,
    targetOwnerPlanetCount: Object.keys(state.planets).length,
    eventSequence: lastCombatEventSequence(report),
  });
  const reportWithSiege: BattleReport = { ...report, siege: siege.report };
  let next = replacePlanetResources(state, flight.destinationPlanetId, resourcesAfterLoot);
  next = replacePlanetState(next, flight.destinationPlanetId, {
    ...targetAfterLosses,
    buildings: siege.target.buildings,
    resources: resourcesAfterLoot,
  });
  next = {
    ...next,
    queues: { ...next.queues, [flight.destinationPlanetId]: siege.target.buildingQueue ?? [] },
  };
  next = preserveOwnedPlanetOrbitalDebris(next, flight.destinationPlanetId, debris, reportId, now);
  if (siege.planetDestroyed) {
    const destroyed = destroyOwnedPlanet(next, flight.destinationPlanetId, now);
    if (destroyed.destroyed) next = destroyed.state;
  }
  next = addReport(next, reportWithSiege);
  const resolution: AttackResolution = { reportId, resolvedAt: safeCount(now), debris, loot, planetDestroyed: siege.planetDestroyed };
  return { state: next, report: reportWithSiege, resolution };
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

/** Returns a Bot 01 attack fleet to its NPC source once when the persisted flight completes. */
export function creditBot01AttackReturn(state: SaveState, flight: FlightRecord, now: number): AttackLootCreditResult {
  if (flight.ownerSide !== 'bot01' || flight.missionId !== 'attack' || flight.bot01ReturnCreditedAt !== undefined) {
    return { state, flight };
  }
  const espionage = state.espionage;
  const source = espionage ? getEspionageTargets(espionage)[flight.originPlanetId] : undefined;
  const completedFlight: FlightRecord = { ...flight, bot01ReturnCreditedAt: now };
  if (!source) return { state, flight: completedFlight };

  const reportId = flight.attackResolution?.reportId;
  const report = reportId ? state.combat.reports.find((candidate) => candidate.id === reportId) : undefined;
  const fleet: OwnedFleetState = {
    ships: { ...source.fleet.ships },
    commanders: { ...source.fleet.commanders },
  };
  if (report) {
    for (const stack of report.attackerForce.stacks ?? []) {
      const survivors = safeCount(stack.countAfter);
      if (survivors <= 0) continue;
      const entity = getFactionCombatEntity(source.raceId, stack.entityId);
      if (entity.kind === 'ship' && entity.id !== SOLAR_SATELLITE_ID) {
        const id = entity.id as ShipId;
        fleet.ships[id] = safeCount(fleet.ships[id]) + survivors;
      } else if (entity.kind === 'commander') {
        const id = entity.id as CommanderId;
        fleet.commanders[id] = safeCount(fleet.commanders[id]) + survivors;
      }
    }
  } else {
    for (const [rawId, quantity] of Object.entries(flight.selectedShips)) {
      const id = rawId as ShipId;
      fleet.ships[id] = safeCount(fleet.ships[id]) + safeCount(quantity);
    }
    for (const [rawId, quantity] of Object.entries(flight.selectedCommanders ?? {})) {
      const id = rawId as CommanderId;
      fleet.commanders[id] = safeCount(fleet.commanders[id]) + safeCount(quantity);
    }
  }

  const loot = flight.attackResolution?.loot;
  const nextSource: SpyTargetState = {
    ...source,
    fleet,
    population: {
      total: calculateFleetPopulation(fleet, source.raceId) + calculateDefensePopulation(source.defense, source.raceId),
      fleet: calculateFleetPopulation(fleet, source.raceId),
      defense: calculateDefensePopulation(source.defense, source.raceId),
    },
    ...(loot ? { resources: {
      ...source.resources,
      metal: safeCount(source.resources.metal + loot.metal),
      minerals: safeCount(source.resources.minerals + loot.minerals),
      gas: safeCount(source.resources.gas + loot.gas),
    } } : {}),
  };
  const targets = { ...getEspionageTargets(espionage!), [source.id]: nextSource };
  return {
    state: {
      ...state,
      espionage: {
        ...espionage!,
        targets,
        ...(espionage!.bot01Planets ? { bot01Planets: targets } : {}),
      },
    },
    flight: completedFlight,
  };
}

export function isAttackCombatShip(shipId: ShipId, factionId: CombatFactionId): boolean {
  const entity = getFactionShipCatalog(factionId).find((candidate) => candidate.id === shipId);
  // Every dispatched ship participates, including civilian/service hulls.
  // Solar satellites are orbital state, not an outgoing fleet unit.
  return Boolean(entity && shipId !== SOLAR_SATELLITE_ID);
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
