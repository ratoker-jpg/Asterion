import type { CombatFactionId } from '../combat/factions.ts';
import { getFactionDefenseCatalog, getFactionShipCatalog } from '../combat/faction-catalog.ts';
import type { DefenseId, ShipId } from '../combat/ids.ts';
import type { CommanderId } from '../combat/commanders.ts';
import { COMMANDER_COMBAT_CATALOG } from '../combat/catalog.ts';
import type { ResourceCost } from '../combat/types.ts';
import { getBuildingBalanceRow, BUILDING_ROLES, type BuildingRole, type BuildingQueueItem } from '../buildings/resource-zone.ts';
import { getFactionSpaceportUpgradeBalance } from '../buildings/spaceport-upgrade-balance-v1.ts';
import { getCommanderSpaceportUpgradeBalance } from '../buildings/commander-upgrade-balance-v1.ts';
import type { SpaceportUpgradeState } from '../buildings/spaceport-upgrades.ts';
import { SCIENCE_CATALOG } from '../science/catalog.ts';
import { calculateScienceCost } from '../science/runtime.ts';
import type { ScienceId, ScienceResourceCost } from '../science/types.ts';
import type { FleetProductionOrder, FleetProductionState } from '../fleet/production.ts';
import type { SaveState } from '../../application/contracts.ts';
import { getOwnerShipUpgradeLevels } from '../../application/contracts.ts';
import { isAsterionLocalPlayerId, type BattleReport } from '../combat/report.ts';
import { calculateBattlePoints } from '../combat/battle-points.ts';
import { getCombatFactionId, type CombatFactionId as FactionId } from '../combat/factions.ts';
import { UNIVERSE_NPC_OWNER_ID } from '../universe/runtime.ts';
import { CURRENT_PLAYER_ID, type RatingPrototypeState } from './fixtures.ts';
import type { OwnerScore } from './types.ts';

export type ScoreResourceCost = Pick<ResourceCost, 'metal' | 'minerals' | 'gas'>;

export type ResourceScorePlanet = {
  factionId: CombatFactionId;
  buildings: Partial<Record<BuildingRole, number>>;
  fleet: { ships: Partial<Record<ShipId, number>>; commanders?: Partial<Record<CommanderId, number>> };
  defense: { defenses: Partial<Record<DefenseId, number>> };
  solarSatellites?: number;
  buildingQueue?: readonly BuildingQueueItem[];
  fleetProduction?: FleetProductionState;
  spaceportUpgrades?: SpaceportUpgradeState;
};

export type ResourceScoreInput = {
  factionId: CombatFactionId;
  planets: readonly ResourceScorePlanet[];
  scienceLevels?: Partial<Record<ScienceId, number>>;
  shipUpgradeLevels?: Readonly<Record<string, number>>;
  queuedScience?: readonly { cost: ScienceResourceCost }[];
  inFlightShips?: Readonly<Record<string, number>>;
  inFlightCommanders?: Readonly<Record<string, number>>;
  unrecoveredCosts?: Partial<ScoreResourceCost>;
};

function safeCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function resourceValue(cost: Partial<ScoreResourceCost> | null | undefined): number {
  if (!cost) return 0;
  return (['metal', 'minerals', 'gas'] as const).reduce((sum, key) => {
    const value = cost[key];
    return sum + (typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0);
  }, 0);
}

function countCost(count: unknown, cost: Partial<ScoreResourceCost> | null | undefined): number {
  return safeCount(count) * resourceValue(cost);
}

function pendingProductionCost(order: FleetProductionOrder): number {
  const quantity = safeCount(order.quantity);
  const remaining = Math.max(0, quantity - safeCount(order.completedQuantity));
  if (!quantity || !remaining) return 0;
  return resourceValue(order.cost) * remaining / quantity;
}

function buildingLevelValue(role: BuildingRole, value: unknown): number {
  const level = safeCount(value);
  let total = 0;
  for (let targetLevel = 1; targetLevel <= level; targetLevel += 1) {
    total += resourceValue(getBuildingBalanceRow(role, targetLevel)?.cost);
  }
  return total;
}

function scienceLevelValue(scienceId: ScienceId, value: unknown): number {
  const science = SCIENCE_CATALOG.find((item) => item.id === scienceId);
  const level = Math.min(science?.maxLevel ?? 0, safeCount(value));
  if (!science) return 0;
  let total = 0;
  for (let fromLevel = 0; fromLevel < level; fromLevel += 1) {
    total += resourceValue(calculateScienceCost(science.baseCost, fromLevel));
  }
  return total;
}

function spaceportUpgradeLevelValue(factionId: CombatFactionId, shipId: string, value: unknown): number {
  const level = safeCount(value);
  const isCommander = COMMANDER_COMBAT_CATALOG.some((entity) => entity.id === shipId);
  let total = 0;
  for (let fromLevel = 0; fromLevel < level; fromLevel += 1) {
    const balance = isCommander
      ? getCommanderSpaceportUpgradeBalance(shipId as CommanderId, fromLevel)
      : getFactionSpaceportUpgradeBalance(factionId, shipId, fromLevel);
    if (balance) total += resourceValue(balance.cost);
  }
  return total;
}

/**
 * Returns the resource points represented by one owner's current development.
 * Wallet balances are deliberately absent. Active paid queues are counted by
 * their saved cost snapshots; after completion the resulting asset replaces
 * that queue contribution.
 */
export function calculateResourceScore(input: ResourceScoreInput): { resourcePoints: number; resourceTotal: number } {
  let resourceTotal = resourceValue(input.unrecoveredCosts);

  for (const planet of input.planets) {
    const factionId = planet.factionId ?? input.factionId;
    for (const role of BUILDING_ROLES) resourceTotal += buildingLevelValue(role, planet.buildings[role]);

    const ships = getFactionShipCatalog(factionId);
    for (const entity of ships) {
      const ownedCount = safeCount(planet.fleet.ships[entity.id as ShipId]);
      const satelliteCount = entity.id === 'solar-satellite' ? safeCount(planet.solarSatellites) : 0;
      resourceTotal += countCost(Math.max(ownedCount, satelliteCount), entity.cost);
    }
    for (const entity of COMMANDER_COMBAT_CATALOG) {
      resourceTotal += countCost(planet.fleet.commanders?.[entity.id as CommanderId], entity.cost);
    }
    for (const entity of getFactionDefenseCatalog(factionId)) {
      resourceTotal += countCost(planet.defense.defenses[entity.id as DefenseId], entity.cost);
    }

    for (const item of planet.buildingQueue ?? []) resourceTotal += resourceValue(item.cost);
    const production = planet.fleetProduction;
    for (const order of production?.shipQueue ?? []) resourceTotal += pendingProductionCost(order);
    for (const order of production?.defenseQueue ?? []) resourceTotal += pendingProductionCost(order);
    for (const order of production?.commanderQueue ?? []) resourceTotal += pendingProductionCost(order);
    for (const [shipId, level] of Object.entries(planet.spaceportUpgrades?.shipLevels ?? {})) {
      // Legacy per-planet levels are included only as a fallback; current saves
      // move these to the owner-wide map and clear the planet copies.
      if (input.shipUpgradeLevels?.[shipId] === undefined) {
        resourceTotal += spaceportUpgradeLevelValue(factionId, shipId, level);
      }
    }
    for (const task of planet.spaceportUpgrades?.shipQueue ?? []) resourceTotal += resourceValue(task.cost);
    for (const task of planet.spaceportUpgrades?.commanderQueue ?? []) resourceTotal += resourceValue(task.cost);
  }

  for (const science of SCIENCE_CATALOG) resourceTotal += scienceLevelValue(science.id, input.scienceLevels?.[science.id]);
  for (const [shipId, level] of Object.entries(input.shipUpgradeLevels ?? {})) {
    resourceTotal += spaceportUpgradeLevelValue(input.factionId, shipId, level);
  }
  for (const task of input.queuedScience ?? []) resourceTotal += resourceValue(task.cost);
  for (const entity of getFactionShipCatalog(input.factionId)) {
    resourceTotal += countCost(input.inFlightShips?.[entity.id], entity.cost);
  }
  for (const entity of COMMANDER_COMBAT_CATALOG) {
    resourceTotal += countCost(input.inFlightCommanders?.[entity.id], entity.cost);
  }

  return { resourcePoints: Math.max(0, Math.round(resourceTotal / 1_000)), resourceTotal };
}

function safeOwnedCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function battlePointTotals(rating: RatingPrototypeState): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const awards of Object.values(rating.battleAwardsByReportId)) {
    for (const [ownerId, points] of Object.entries(awards)) totals[ownerId] = (totals[ownerId] ?? 0) + safeOwnedCount(points);
  }
  return totals;
}

function reportBattlePoints(report: BattleReport) {
  const asStacks = (stacks: readonly { entityId: string; countBefore: number; countAfter: number }[] | undefined) => (stacks ?? []).map((stack) => ({
    entityId: stack.entityId,
    countBefore: stack.countBefore,
    countAfter: stack.countAfter,
  }));
  const base = calculateBattlePoints(
    report.winner,
    asStacks(report.attackerForce.stacks),
    asStacks(report.defenderForce.stacks),
    asStacks(report.attackerForce.defenses),
    asStacks(report.defenderForce.defenses),
    getCombatFactionId(report.attacker.race),
    getCombatFactionId(report.defender.race),
  );
  return calculateAwardedBattlePoints(report.winner, base);
}

export function calculateAwardedBattlePoints(
  winner: BattleReport['winner'],
  points: Pick<ReturnType<typeof calculateBattlePoints>, 'attacker' | 'defender'>,
) {
  return {
    attacker: points.attacker * (winner === 'attacker' ? 2 : 1),
    defender: points.defender * (winner === 'defender' ? 2 : 1),
  };
}

export function selectRecordedBattlePointAwards(
  rating: RatingPrototypeState,
  report: BattleReport,
  playerOwnerId: string,
): { attacker: number | null; defender: number | null } | null {
  const awards = rating.battleAwardsByReportId[report.id];
  if (!awards) return null;
  const ownerId = (value: string | undefined) => {
    if (!value) return null;
    return isAsterionLocalPlayerId(value) ? playerOwnerId : value;
  };
  const attackerId = ownerId(report.attacker.playerId);
  const defenderId = ownerId(report.defender.playerId);
  const recordedAward = (participantId: string | null) => participantId
    && Object.prototype.hasOwnProperty.call(awards, participantId)
    ? safeOwnedCount(awards[participantId])
    : null;
  return {
    attacker: recordedAward(attackerId),
    defender: recordedAward(defenderId),
  };
}

/** Stores both participants' awards under the unique real report ID. */
export function recordBattleScoreAward(
  rating: RatingPrototypeState,
  report: BattleReport,
  playerOwnerId: string,
): RatingPrototypeState {
  if (rating.battleAwardsByReportId[report.id]
    || report.missionType === 'simulation'
    || report.metadata?.source === 'demo-fixture'
    || !report.id) return rating;

  const base = reportBattlePoints(report);
  const ownerId = (value: string | undefined) => {
    if (!value) return null;
    return isAsterionLocalPlayerId(value) ? playerOwnerId : value;
  };
  const attackerId = ownerId(report.attacker.playerId);
  const defenderId = ownerId(report.defender.playerId);
  const awards: Record<string, number> = {};
  if (attackerId) awards[attackerId] = (awards[attackerId] ?? 0) + base.attacker;
  if (defenderId) awards[defenderId] = (awards[defenderId] ?? 0) + base.defender;
  return {
    ...rating,
    battleAwardsByReportId: { ...rating.battleAwardsByReportId, [report.id]: awards },
  };
}

/** Adds only the unrefunded portion of a canceled paid order to the owner ledger. */
export function addUnrecoveredResourceCost(
  rating: RatingPrototypeState,
  ownerId: string,
  paid: Partial<ScoreResourceCost> | null | undefined,
  refunded: Partial<ScoreResourceCost> | null | undefined,
): RatingPrototypeState {
  if (!ownerId || !paid) return rating;
  const previous = rating.unrecoveredCostsByOwnerId[ownerId] ?? { metal: 0, minerals: 0, gas: 0 };
  const next = { ...previous };
  for (const key of ['metal', 'minerals', 'gas'] as const) {
    const spent = paid[key];
    const returned = refunded?.[key];
    const net = Math.max(0, (typeof spent === 'number' && Number.isFinite(spent) ? spent : 0)
      - (typeof returned === 'number' && Number.isFinite(returned) ? returned : 0));
    next[key] += Math.floor(net);
  }
  return {
    ...rating,
    unrecoveredCostsByOwnerId: { ...rating.unrecoveredCostsByOwnerId, [ownerId]: next },
  };
}

type OwnerRegistration = {
  ownerId: string;
  factionId: FactionId;
  planets: ResourceScorePlanet[];
  scienceLevels?: Partial<Record<ScienceId, number>>;
  shipUpgradeLevels?: Record<string, number>;
  queuedScience?: { cost: ScienceResourceCost }[];
};

function flightShipCounts(state: SaveState, factionId: FactionId, ownerId: string) {
  const counts: Record<string, number> = {};
  const reports = new Map(state.combat.reports.map((report) => [report.id, report]));
  for (const flight of state.flights.records) {
    // Player dispatch reserves ships but keeps them in the source planet's
    // saved fleet until the mission applies its result. Bot 001 removes its
    // ships at launch, so only its in-flight fleet needs a separate score.
    if (flight.ownerSide !== 'bot01') continue;
    if (flight.phase !== 'outbound' && flight.phase !== 'returning' && flight.phase !== 'arrived') continue;
    const flightOwnerId = flight.ownerSide === 'bot01' ? UNIVERSE_NPC_OWNER_ID : state.profile.playerId;
    if (flightOwnerId !== ownerId) continue;
    const report = flight.attackResolution ? reports.get(flight.attackResolution.reportId) : undefined;
    const shipCounts = report
      ? Object.fromEntries(report.attackerForce.stacks.map((stack) => [stack.entityId, stack.countAfter]))
      : flight.selectedShips;
    for (const ship of getFactionShipCatalog(factionId)) {
      counts[ship.id] = (counts[ship.id] ?? 0) + safeOwnedCount(shipCounts[ship.id as ShipId]);
    }
  }
  return counts;
}

function flightCommanderCounts(state: SaveState, ownerId: string) {
  const counts: Record<string, number> = {};
  const reports = new Map(state.combat.reports.map((report) => [report.id, report]));
  for (const flight of state.flights.records) {
    if (flight.ownerSide !== 'bot01') continue;
    if (flight.phase !== 'outbound' && flight.phase !== 'returning' && flight.phase !== 'arrived') continue;
    if (ownerId !== UNIVERSE_NPC_OWNER_ID) continue;
    const report = flight.attackResolution ? reports.get(flight.attackResolution.reportId) : undefined;
    const commanderCounts = report
      ? Object.fromEntries(report.attackerForce.stacks
        .filter((stack) => COMMANDER_COMBAT_CATALOG.some((entity) => entity.id === stack.entityId))
        .map((stack) => [stack.entityId, stack.countAfter]))
      : flight.selectedCommanders ?? {};
    for (const entity of COMMANDER_COMBAT_CATALOG) {
      counts[entity.id] = (counts[entity.id] ?? 0) + safeOwnedCount(commanderCounts[entity.id as CommanderId]);
    }
  }
  return counts;
}

/** Calculates one authoritative score per owner represented in the save. */
export function selectOwnerScores(state: SaveState): Record<string, OwnerScore> {
  const owners = new Map<string, OwnerRegistration>();
  const playerOwnerId = state.profile.playerId || CURRENT_PLAYER_ID;
  const player: OwnerRegistration = {
    ownerId: playerOwnerId,
    factionId: state.profile.factionId,
    planets: [],
    scienceLevels: state.science.levels,
    shipUpgradeLevels: getOwnerShipUpgradeLevels(state),
    queuedScience: state.science.queue,
  };
  owners.set(playerOwnerId, player);

  for (const [planetId, planet] of Object.entries(state.planets)) {
    player.planets.push({
      factionId: player.factionId,
      buildings: planet.buildings,
      fleet: planet.fleet,
      defense: planet.defense,
      solarSatellites: planet.solarSatellites,
      buildingQueue: state.queues[planetId],
      fleetProduction: planet.fleetProduction,
      spaceportUpgrades: planet.spaceportUpgrades,
    });
  }

  for (const target of Object.values(state.espionage?.targets ?? state.espionage?.bot01Planets ?? {})) {
    if (!target.ownerId || target.ownerId === playerOwnerId || target.ownerId === 'player-aster') continue;
    const owner = owners.get(target.ownerId) ?? {
      ownerId: target.ownerId,
      factionId: target.raceId,
      planets: [],
      scienceLevels: target.ownerProfile?.scienceLevels,
      shipUpgradeLevels: target.ownerProfile?.shipLevels ? { ...target.ownerProfile.shipLevels } : undefined,
    };
    owner.planets.push({
      factionId: target.raceId,
      buildings: target.buildings as Partial<Record<BuildingRole, number>>,
      fleet: target.fleet,
      defense: target.defense,
      buildingQueue: target.buildingQueue,
    });
    const profile = target.ownerId === UNIVERSE_NPC_OWNER_ID ? state.espionage?.bot01Profile : target.ownerProfile;
    if (profile) {
      owner.scienceLevels = profile.scienceLevels;
      owner.shipUpgradeLevels = { ...profile.shipLevels, ...profile.commanderLevels };
    }
    owners.set(target.ownerId, owner);
  }

  const battlePoints = battlePointTotals(state.rating);
  for (const ownerId of Object.keys(battlePoints)) {
    if (!owners.has(ownerId)) owners.set(ownerId, { ownerId, factionId: state.profile.factionId, planets: [] });
  }

  const scores: Record<string, OwnerScore> = {};
  for (const [ownerId, owner] of owners) {
    const score = calculateResourceScore({
      factionId: owner.factionId,
      planets: owner.planets,
      scienceLevels: owner.scienceLevels,
      shipUpgradeLevels: owner.shipUpgradeLevels,
      queuedScience: owner.queuedScience,
      inFlightShips: flightShipCounts(state, owner.factionId, ownerId),
      inFlightCommanders: flightCommanderCounts(state, ownerId),
      unrecoveredCosts: state.rating.unrecoveredCostsByOwnerId[ownerId],
    });
    const ownerBattlePoints = battlePoints[ownerId] ?? 0;
    scores[ownerId] = {
      ownerId,
      resourcePoints: score.resourcePoints,
      battlePoints: ownerBattlePoints,
      totalPoints: score.resourcePoints + ownerBattlePoints,
      achievementPoints: 0,
    };
  }
  return scores;
}
