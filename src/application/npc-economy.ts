import {
  completeBuildingProject,
  evaluateBuildingBuild,
  getBuildingResourceIncomePerHour,
  getStorageCapacities,
  migrateBuildingLevels,
  migrateBuildingQueue,
  startBuildingProject,
  type BuildAvailability,
  type BuildingEconomyState,
  type BuildingLevels,
  type BuildingRole,
} from '../domain/buildings/resource-zone.ts';
import {
  getProductionBotIncomePerHour,
  migrateProductionBotAssignment,
} from '../domain/buildings/production-bots.ts';
import { creditResources } from '../domain/resources/credit.ts';
import {
  calculateEnergySources,
  consumeEnergy,
  hydrateEnergyLedger,
  rebuildEnergyLedger,
  type EnergyLedger,
} from '../domain/energy/runtime.ts';
import { calculatePlanetCapacity, calculatePlanetPopulation, OVERPOPULATION_WINDOW_MS, reconcileOverpopulation } from '../domain/fleet/overpopulation.ts';
import { getSolarSatelliteFleetCount, removeSolarSatellitesFromFleet } from '../domain/fleet/runtime.ts';
import { NPC_ECONOMY_ROLES } from '../domain/npc/economy-policy.ts';
import { SCIENCE_ID_PHYSICS } from '../domain/buildings/balance-v1.ts';
import { accrueResourceCredits } from './resource-clock.ts';
import type { SpyTargetState } from '../domain/espionage/types.ts';

const RESOURCE_KEYS = ['metal', 'minerals', 'gas'] as const;

export type NpcEconomyContext = {
  /** Explicit campaign/test scale snapshot for deterministic historical replay. */
  timeScale: number;
};

export type NpcEconomySettleResult = {
  target: SpyTargetState;
  completedRoles: BuildingRole[];
  nextDueAt: number | null;
};

export type NpcBuildingStartResult = {
  target: SpyTargetState;
  ok: boolean;
  reason: string | null;
};

function finiteNonNegative(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : fallback;
}

function targetBuildingLevels(target: SpyTargetState): BuildingLevels {
  const source = target.buildings ?? {};
  return migrateBuildingLevels({
    ...source,
    'metal-production-1': source['metal-production-1'] ?? source['metal-mine'],
    'mineral-production-1': source['mineral-production-1'] ?? source['mineral-mine'],
    'gas-production-1': source['gas-production-1'] ?? source['gas-extractor'],
  });
}

function targetScience(target: SpyTargetState) {
  // NPCs only use their own saved knowledge. Missing science is level zero.
  return target.ownerProfile?.scienceLevels ?? {};
}

function targetSatelliteCount(target: SpyTargetState): number {
  return Math.max(
    Math.max(0, Math.floor(finiteNonNegative(target.solarSatellites))),
    getSolarSatelliteFleetCount(target.fleet),
  );
}

function energySources(target: SpyTargetState, buildings: BuildingLevels) {
  return calculateEnergySources({
    buildings,
    scienceLevels: targetScience(target),
    solarSatellites: targetSatelliteCount(target),
    galaxy: target.coordinate.galaxy,
    system: target.coordinate.system,
    position: target.coordinate.position,
  });
}

export function targetEnergyLedger(target: SpyTargetState, buildings = targetBuildingLevels(target)): EnergyLedger {
  return hydrateEnergyLedger(
    target.energyLedger,
    energySources(target, buildings),
    finiteNonNegative(target.resources.developmentEnergy),
  );
}

function targetQueue(target: SpyTargetState, buildings = targetBuildingLevels(target)) {
  return migrateBuildingQueue(target.buildingQueue ?? [], target.id, buildings, targetScience(target));
}

function economyFor(target: SpyTargetState, buildings = targetBuildingLevels(target)): BuildingEconomyState {
  return economyWithLedger(target, buildings).economy;
}

/** One snapshot of the derived economy; the ledger is reused by callers that also persist it. */
function economyWithLedger(target: SpyTargetState, buildings: BuildingLevels): { economy: BuildingEconomyState; ledger: EnergyLedger } {
  const ledger = targetEnergyLedger(target, buildings);
  return { ledger, economy: {
    resources: {
      metal: finiteNonNegative(target.resources.metal),
      minerals: finiteNonNegative(target.resources.minerals),
      gas: finiteNonNegative(target.resources.gas),
      energy: ledger.availableEnergy,
    },
    buildings,
    queue: targetQueue(target, buildings),
    scienceLevels: targetScience(target),
    capacities: getStorageCapacities(buildings),
  } };
}

function withEconomy(target: SpyTargetState, economy: BuildingEconomyState, energyLedger: EnergyLedger): SpyTargetState {
  return {
    ...target,
    resources: {
      ...target.resources,
      metal: economy.resources.metal,
      minerals: economy.resources.minerals,
      gas: economy.resources.gas,
      developmentEnergy: energyLedger.availableEnergy,
    },
    buildings: economy.buildings,
    buildingQueue: economy.queue,
    energyLedger,
  };
}

function incomeFor(target: SpyTargetState, timeScale: number, buildings = targetBuildingLevels(target)) {
  const base = getBuildingResourceIncomePerHour(buildings, targetScience(target));
  const bots = migrateProductionBotAssignment(target.productionBots, buildings);
  const income = getProductionBotIncomePerHour(base, bots);
  const multiplier = Number.isFinite(timeScale) ? Math.max(0, timeScale) : 1;
  return {
    metal: finiteNonNegative(income.metal) * multiplier,
    minerals: finiteNonNegative(income.minerals) * multiplier,
    gas: finiteNonNegative(income.gas) * multiplier,
  };
}

function accrueInterval(target: SpyTargetState, to: number, timeScale: number, derivedBuildings?: BuildingLevels): SpyTargetState {
  const clock = target.resourceClock ?? {
    lastReconciledAt: to,
    remainder: { metal: 0, minerals: 0, gas: 0 },
  };
  const finishAt = Math.max(clock.lastReconciledAt, Math.floor(to));
  const elapsed = finishAt - clock.lastReconciledAt;
  // Levels, ledger and queue are pure functions of this target; derive them once.
  const buildings = derivedBuildings ?? targetBuildingLevels(target);
  const income = incomeFor(target, timeScale, buildings);
  const accrued = Object.fromEntries(RESOURCE_KEYS.map((key) => [
    key,
    accrueResourceCredits(income[key], elapsed, clock.remainder[key]),
  ])) as Record<(typeof RESOURCE_KEYS)[number], { wholeCredits: number; remainder: number }>;
  const { economy, ledger } = economyWithLedger(target, buildings);
  const credited = creditResources(economy.resources, economy.capacities, {
    metal: accrued.metal.wholeCredits,
    minerals: accrued.minerals.wholeCredits,
    gas: accrued.gas.wholeCredits,
    energy: 0,
  });
  const nextRemainder = { ...clock.remainder };
  for (const key of RESOURCE_KEYS) {
    const cap = finiteNonNegative(economy.capacities?.[key], Number.MAX_SAFE_INTEGER);
    const wasFull = finiteNonNegative(economy.resources[key]) >= cap;
    const isFull = finiteNonNegative(credited.wallet[key]) >= cap;
    nextRemainder[key] = wasFull || isFull ? 0 : accrued[key].remainder;
  }
  return {
    ...withEconomy(target, { ...economy, resources: credited.wallet }, ledger),
    resourceClock: { lastReconciledAt: finishAt, remainder: nextRemainder },
  };
}

function shiftQueue(target: SpyTargetState, delta: number, blockedSince: number): SpyTargetState {
  if (delta <= 0 || !target.buildingQueue?.length) return target;
  return {
    ...target,
    buildingQueue: target.buildingQueue.map((item) => item.finishAt <= blockedSince ? item : ({
      ...item,
      enqueuedAt: item.enqueuedAt + delta,
      startedAt: item.startedAt + delta,
      finishAt: item.finishAt + delta,
    })),
  };
}

function settleOverpopulation(target: SpyTargetState, at: number): SpyTargetState {
  const buildings = targetBuildingLevels(target);
  const normalizedFleet = removeSolarSatellitesFromFleet(target.fleet);
  const satellites = targetSatelliteCount(target);
  const result = reconcileOverpopulation(
    normalizedFleet.fleet,
    satellites,
    buildings.hangar ?? 0,
    target.raceId,
    at,
    target.overpopulation,
  );
  if (!result.changed && !target.overpopulation && !result.blocked) return target;
  const fleetPopulation = calculatePlanetPopulation(result.fleet, result.solarSatellites, target.raceId);
  return {
    ...target,
    fleet: result.fleet,
    solarSatellites: result.solarSatellites,
    population: {
      ...target.population,
      fleet: fleetPopulation,
      total: fleetPopulation + finiteNonNegative(target.population.defense),
    },
    ...(result.state ? { overpopulation: result.state } : { overpopulation: undefined }),
  };
}

export function isNpcPlanetBlocked(target: SpyTargetState, buildings?: BuildingLevels): boolean {
  if (target.overpopulation?.blocked === true) return true;
  const normalizedFleet = removeSolarSatellitesFromFleet(target.fleet).fleet;
  const actualFleetPopulation = calculatePlanetPopulation(normalizedFleet, targetSatelliteCount(target), target.raceId);
  return actualFleetPopulation > calculatePlanetCapacity((buildings ?? targetBuildingLevels(target)).hangar ?? 0);
}

const isBlocked = isNpcPlanetBlocked;

/** Project owner knowledge and transition existing one-time sources without resetting consumption. */
export function projectNpcScience(target: SpyTargetState, levels: import('../domain/science/runtime.ts').ScienceLevels): SpyTargetState {
  const previous = target.ownerProfile?.scienceLevels ?? {};
  if (Object.keys(levels).every((id) => previous[Number(id) as keyof typeof levels] === levels[Number(id) as keyof typeof levels])
    && Object.keys(previous).every((id) => previous[Number(id) as keyof typeof levels] === levels[Number(id) as keyof typeof levels])) return target;
  const projected = { ...target, ownerProfile: { scienceLevels: levels,
    shipLevels: target.ownerProfile?.shipLevels ?? {}, commanderLevels: target.ownerProfile?.commanderLevels ?? {} } };
  // Most levels do not change energy. Preserve saved ledger bytes in that case.
  if ((previous[SCIENCE_ID_PHYSICS] ?? 0) === (levels[SCIENCE_ID_PHYSICS] ?? 0)) return projected;
  const ledger = targetEnergyLedger(target);
  const rebuilt = rebuildEnergyLedger(ledger, energySources(projected, targetBuildingLevels(projected)));
  return { ...projected, energyLedger: rebuilt,
    resources: { ...projected.resources, developmentEnergy: rebuilt.availableEnergy } };
}

function rebuildEnergyAfterCompletion(target: SpyTargetState, role: BuildingRole): SpyTargetState {
  if (role !== 'basic-energy' && role !== 'advanced-energy') return target;
  const buildings = targetBuildingLevels(target);
  const previousBuildings = { ...buildings, [role]: Math.max(0, (buildings[role] ?? 0) - 1) };
  const ledger = target.energyLedger ?? targetEnergyLedger(target, previousBuildings);
  const rebuilt = rebuildEnergyLedger(ledger, energySources(target, buildings), {
    sourceChanges: { [role === 'basic-energy' ? 'solar-station' : 'nuclear-reactor']: 'building' },
  });
  return {
    ...target,
    resources: { ...target.resources, developmentEnergy: rebuilt.availableEnergy },
    energyLedger: rebuilt,
  };
}

export function previewNpcBuilding(target: SpyTargetState, role: BuildingRole): BuildAvailability {
  const availability = evaluateBuildingBuild(economyFor(target), role);
  if (isBlocked(target)) return { ...availability, canBuild: false, reason: 'Планета заблокирована из-за перенаселения.' };
  if (!NPC_ECONOMY_ROLES.includes(role)) return { ...availability, canBuild: false, reason: 'Это здание вне доступных экономических решений NPC.' };
  return availability;
}

export function getNpcBuildingCandidates(target: SpyTargetState): Array<{ role: BuildingRole; availability: BuildAvailability }> {
  // Each candidate observes the same owner snapshot. Hydrate the persisted
  // ledger and queue once rather than once per catalogue role.
  const economy = economyFor(target);
  const blocked = isBlocked(target);
  return [...NPC_ECONOMY_ROLES].map((role) => ({
    role,
    availability: blocked
      ? { ...evaluateBuildingBuild(economy, role), canBuild: false, reason: 'Планета заблокирована из-за перенаселения.' }
      : evaluateBuildingBuild(economy, role),
  }));
}

export function startNpcBuilding(
  target: SpyTargetState,
  role: BuildingRole,
  at: number,
  context: NpcEconomyContext,
  idempotencyKey: string,
): NpcBuildingStartResult {
  if (target.economyAppliedActionIds?.includes(idempotencyKey)) return { target, ok: true, reason: null };
  if (isBlocked(target)) return { target, ok: false, reason: 'Планета заблокирована из-за перенаселения.' };
  if (!NPC_ECONOMY_ROLES.includes(role)) return { target, ok: false, reason: 'Это здание вне доступных экономических решений NPC.' };
  const economy = economyFor(target);
  const availability = evaluateBuildingBuild(economy, role);
  if (!availability.canBuild || availability.timeMs == null || !availability.cost) {
    return { target, ok: false, reason: availability.reason };
  }
  const energyLedger = targetEnergyLedger(target, economy.buildings);
  const duration = Math.max(1, Math.round(availability.timeMs / Math.max(0.000_001, context.timeScale)));
  const transition = startBuildingProject(economy, role, target.id, at, duration);
  if (!transition.ok) return { target, ok: false, reason: transition.reason };
  const chargedEnergy = consumeEnergy(energyLedger, availability.cost.energy, idempotencyKey);
  if (!chargedEnergy.ok) return { target, ok: false, reason: chargedEnergy.reason };
  const actionIds = [...(target.economyAppliedActionIds ?? []), idempotencyKey].slice(-256);
  const next = withEconomy(target, transition.state, chargedEnergy.ledger);
  return {
    target: {
      ...next,
      economyAppliedActionIds: actionIds,
      resourceClock: target.resourceClock ?? { lastReconciledAt: Math.floor(at), remainder: { metal: 0, minerals: 0, gas: 0 } },
    },
    ok: true,
    reason: null,
  };
}

export function getNextNpcEconomyCheckpoint(target: SpyTargetState, at: number): number | null {
  const due = [target.buildingQueue?.[0]?.finishAt]
    .filter((value): value is number => typeof value === 'number' && value >= at);
  if (target.overpopulation?.blocked) {
    const burnEnd = target.overpopulation.episodeStartedAt + OVERPOPULATION_WINDOW_MS;
    if (burnEnd >= at) due.push(burnEnd);
  }
  return due.length ? Math.min(...due) : null;
}

/**
 * Targets produced by the common-case settlement below, with the timestamp
 * they were settled at. Settling such a target again at that same timestamp
 * accrues nothing and re-derives equal levels, queue and ledger, so it is
 * returned as is (catch-up chunks settle every owner at both of their ends).
 */
const settledAt = new WeakMap<SpyTargetState, number>();

export function settleNpcPlanet(
  initialTarget: SpyTargetState,
  at: number,
  context: NpcEconomyContext,
): NpcEconomySettleResult {
  const safeAt = Math.max(0, Math.floor(at));
  let target = initialTarget;
  const completedRoles: BuildingRole[] = [];
  if (settledAt.get(target) === safeAt) return { target, completedRoles, nextDueAt: getNextNpcEconomyCheckpoint(target, safeAt) };
  // Common case: no overpopulation episode, under capacity and no completion
  // due. Overpopulation settlement is then the identity, so the general path
  // below reduces to one accrual; take it without re-deriving the target.
  if (!target.overpopulation) {
    const buildings = targetBuildingLevels(target);
    const active = targetQueue(target, buildings)[0];
    if ((!active || active.finishAt > safeAt) && !isBlocked(target, buildings)) {
      target = accrueInterval(target, safeAt, context.timeScale, buildings);
      settledAt.set(target, safeAt);
      return { target, completedRoles, nextDueAt: getNextNpcEconomyCheckpoint(target, safeAt) };
    }
  }
  const clockAtStart = target.resourceClock?.lastReconciledAt ?? safeAt;
  const startedBlocked = isBlocked(target);
  if (startedBlocked) {
    const burnEnd = (target.overpopulation?.episodeStartedAt ?? safeAt) + OVERPOPULATION_WINDOW_MS;
    const resumeAt = Math.min(safeAt, Math.max(clockAtStart, burnEnd));
    const blockedSince = target.overpopulation?.episodeStartedAt ?? safeAt;
    target = shiftQueue(target, Math.max(0, resumeAt - Math.max(clockAtStart, blockedSince)), blockedSince);
    target = {
      ...target,
      resourceClock: {
        lastReconciledAt: resumeAt,
        remainder: target.resourceClock?.remainder ?? { metal: 0, minerals: 0, gas: 0 },
      },
    };
    target = settleOverpopulation(target, resumeAt);
    if (isBlocked(target)) {
      target = shiftQueue(target, Math.max(0, safeAt - resumeAt), blockedSince);
      target = settleOverpopulation(target, safeAt);
      target = {
        ...target,
        resourceClock: {
          lastReconciledAt: safeAt,
          remainder: target.resourceClock?.remainder ?? { metal: 0, minerals: 0, gas: 0 },
        },
      };
      return { target, completedRoles, nextDueAt: getNextNpcEconomyCheckpoint(target, safeAt) };
    }
  }

  if (!startedBlocked) target = settleOverpopulation(target, safeAt);
  if (isBlocked(target)) {
    target = {
      ...target,
      resourceClock: { lastReconciledAt: safeAt, remainder: target.resourceClock?.remainder ?? { metal: 0, minerals: 0, gas: 0 } },
    };
    return { target, completedRoles, nextDueAt: getNextNpcEconomyCheckpoint(target, safeAt) };
  }

  // Apply each completion at its own timestamp so production uses the old rate
  // up to the boundary and the new rate after it.
  for (let count = 0; count < 64; count += 1) {
    const active = targetQueue(target)[0];
    if (!active || active.finishAt > safeAt) break;
    target = accrueInterval(target, active.finishAt, context.timeScale);
    const economy = economyFor(target);
    const completion = completeBuildingProject(economy, active.finishAt);
    if (!completion.completedRole) break;
    target = withEconomy(target, completion.state, targetEnergyLedger(target, economy.buildings));
    target = rebuildEnergyAfterCompletion(target, completion.completedRole);
    completedRoles.push(completion.completedRole);
  }
  target = accrueInterval(target, safeAt, context.timeScale);
  target = settleOverpopulation(target, safeAt);
  if (isBlocked(target)) {
    target = {
      ...target,
      resourceClock: { lastReconciledAt: safeAt, remainder: target.resourceClock?.remainder ?? { metal: 0, minerals: 0, gas: 0 } },
    };
  }
  return { target, completedRoles, nextDueAt: getNextNpcEconomyCheckpoint(target, safeAt) };
}
