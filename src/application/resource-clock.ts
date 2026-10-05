import {
  getBuildingResourceIncomePerHour,
  getStorageCapacities,
  type BuildingRole,
} from '../domain/buildings/resource-zone.ts';
import type { ProductionResource } from '../domain/buildings/balance-v1.ts';
import {
  getProductionBotIncomePerHour,
  type ProductionResourceIncome,
} from '../domain/buildings/production-bots.ts';
import { creditResources, type ResourceCreditResult } from '../domain/resources/credit.ts';
import { normalizeTestTimeScale, type RuntimeMode, type TestTimeScale } from '../domain/runtime/mode.ts';
import {
  getPlanetResources,
  replacePlanetResources,
  type ResourceClock,
  type ResourceClockEntry,
  type SaveState,
} from './contracts.ts';
import { createDefaultEspionageState, getEspionageTargets } from '../domain/espionage/runtime.ts';
import type { EspionageState, SpyTargetState } from '../domain/espionage/types.ts';
import { UNIVERSE_NPC_OWNER_ID } from '../domain/universe/runtime.ts';
import { isPlanetBlocked } from './overpopulation.ts';

const RESOURCE_KEYS = ['metal', 'minerals', 'gas'] as const satisfies readonly ProductionResource[];
const CAPPED_RESOURCE_KEYS = ['metal', 'minerals', 'gas'] as const;
const HOUR_MS = 60 * 60 * 1000;

export type ResourceClockContext = {
  planetId: SaveState['currentPlanetId'];
  now: number;
  mode: RuntimeMode;
  testTimeScale: TestTimeScale;
};

export type ResourceReconcileResult = {
  changed: boolean;
  state: SaveState;
  credit: ResourceCreditResult;
};

export type TestTargetResourceReconcileContext = {
  now: number;
  mode: RuntimeMode;
  testTimeScale: TestTimeScale;
};

function finiteNonNegative(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : fallback;
}

/**
 * Resolves the rate shown to players and credited by the runtime.
 * Production Mode always uses the canonical rate; Test Mode accelerates the
 * same rate by the selected test-time scale.
 */
export function getEffectiveResourceIncomePerHour(
  income: ProductionResourceIncome,
  mode: RuntimeMode,
  testTimeScale: TestTimeScale,
): ProductionResourceIncome {
  const multiplier = mode === 'test' ? normalizeTestTimeScale(testTimeScale) : 1;
  return {
    metal: finiteNonNegative(income.metal) * multiplier,
    minerals: finiteNonNegative(income.minerals) * multiplier,
    gas: finiteNonNegative(income.gas) * multiplier,
  };
}

function normalizeClock(clock: Partial<ResourceClockEntry> | undefined, now: number): ResourceClockEntry {
  const safeNow = finiteNonNegative(now, Date.now());
  const last = Math.min(safeNow, finiteNonNegative(clock?.lastReconciledAt, safeNow));
  const source = clock?.remainder;
  const remainder = (key: keyof ResourceClock['remainder']) => Math.min(
    0.999_999_999,
    finiteNonNegative(source?.[key]),
  );
  return {
    lastReconciledAt: last,
    remainder: {
      metal: remainder('metal'),
      minerals: remainder('minerals'),
      gas: remainder('gas'),
      // Kept in the persisted shape for backwards compatibility. Energy is
      // settled by the one-time ledger, never by this hourly clock.
      energy: 0,
    },
  };
}

function clocksEqual(left: ResourceClockEntry, right: ResourceClockEntry): boolean {
  return left.lastReconciledAt === right.lastReconciledAt
    && RESOURCE_KEYS.every((key) => left.remainder[key] === right.remainder[key]);
}

function resourcesEqual(left: SaveState, right: SaveState, planetId: SaveState['currentPlanetId']): boolean {
  const leftWallet = getPlanetResources(left, planetId);
  const rightWallet = getPlanetResources(right, planetId);
  return leftWallet.metal === rightWallet.metal
    && leftWallet.minerals === rightWallet.minerals
    && leftWallet.gas === rightWallet.gas;
}

function getClockForPlanet(state: SaveState, planetId: SaveState['currentPlanetId'], now: number): ResourceClockEntry {
  const stored = state.resourceClock?.byPlanet?.[planetId];
  if (stored) return normalizeClock(stored, now);

  // Fixtures and saves from before the per-planet clock migration only have a
  // meaningful clock for the legacy homeworld. Never apply that timestamp to
  // a colony that has no migrated entry.
  if (!state.resourceClock?.byPlanet && planetId === 'helion-01') {
    return normalizeClock(state.resourceClock, now);
  }
  return normalizeClock(undefined, now);
}

function withPlanetClock(state: SaveState, planetId: SaveState['currentPlanetId'], clock: ResourceClockEntry): SaveState {
  const byPlanet = {
    ...(state.resourceClock?.byPlanet ?? {}),
    [planetId]: clock,
  };
  const legacyAlias = planetId === state.currentPlanetId
    ? clock
    : {
      lastReconciledAt: state.resourceClock.lastReconciledAt,
      remainder: { ...state.resourceClock.remainder },
    };
  return {
    ...state,
    resourceClock: {
      ...state.resourceClock,
      ...legacyAlias,
      byPlanet,
    },
  };
}

/** Adds a newly-created planet clock without borrowing the homeworld's time. */
export function initializePlanetResourceClock(
  state: SaveState,
  planetId: SaveState['currentPlanetId'],
  now: number,
): SaveState {
  if (state.resourceClock.byPlanet?.[planetId]) return state;
  return withPlanetClock(state, planetId, normalizeClock(undefined, now));
}

/**
 * Credits one elapsed interval of derived building/science/bot income.
 * The saved clock is advanced even when no whole resource unit is produced,
 * while the fractional remainder preserves deterministic sub-unit income.
 */
export function reconcileResourceIncome(
  state: SaveState,
  context: ResourceClockContext,
): ResourceReconcileResult {
  const now = finiteNonNegative(context.now, Date.now());
  const planet = state.planets[context.planetId];
  if (!planet) {
    const resources = getPlanetResources(state, context.planetId);
    return { changed: false, state, credit: { wallet: { ...resources, energy: 0 }, accepted: { metal: 0, minerals: 0, gas: 0, energy: 0 }, burned: { metal: 0, minerals: 0, gas: 0, energy: 0 } } };
  }
  if (isPlanetBlocked(state, context.planetId)) {
    const wallet = getPlanetResources(state, context.planetId);
    return {
      changed: false,
      state,
      credit: { wallet: { ...wallet, energy: planet.energy }, accepted: { metal: 0, minerals: 0, gas: 0, energy: 0 }, burned: { metal: 0, minerals: 0, gas: 0, energy: 0 } },
    };
  }

  const storedClock = state.resourceClock.byPlanet?.[context.planetId];
  const clock = getClockForPlanet(state, context.planetId, now);
  const clockWasPersisted = Boolean(storedClock);
  if (now < clock.lastReconciledAt) {
    const normalizedState = clockWasPersisted ? state : withPlanetClock(state, context.planetId, clock);
    return {
      changed: !clockWasPersisted,
      state: normalizedState,
      credit: { wallet: { ...getPlanetResources(state, context.planetId), energy: planet.energy }, accepted: { metal: 0, minerals: 0, gas: 0, energy: 0 }, burned: { metal: 0, minerals: 0, gas: 0, energy: 0 } },
    };
  }

  const elapsedMs = now - clock.lastReconciledAt;
  const elapsedHours = elapsedMs / HOUR_MS;
  const baseIncome = getBuildingResourceIncomePerHour(planet.buildings, state.science.levels);
  const income = getProductionBotIncomePerHour(baseIncome, planet.productionBots);
  const hourly = getEffectiveResourceIncomePerHour(income, context.mode, context.testTimeScale);
  const capacities = getStorageCapacities(planet.buildings);
  const rawCredits = {
    metal: hourly.metal * elapsedHours + clock.remainder.metal,
    minerals: hourly.minerals * elapsedHours + clock.remainder.minerals,
    gas: hourly.gas * elapsedHours + clock.remainder.gas,
  };
  const wholeCredits = Object.fromEntries(
    RESOURCE_KEYS.map((key) => [key, Number.isFinite(rawCredits[key]) ? Math.floor(Math.max(0, rawCredits[key])) : 0]),
  ) as Record<ProductionResource, number>;
  const wallet = { ...getPlanetResources(state, context.planetId), energy: planet.energy };
  const credit = creditResources(wallet, capacities, wholeCredits);
  const remainder = { ...clock.remainder };

  for (const key of RESOURCE_KEYS) {
    const raw = rawCredits[key];
    const whole = wholeCredits[key];
    if (!Number.isFinite(raw)) {
      remainder[key] = 0;
      continue;
    }
    if ((CAPPED_RESOURCE_KEYS as readonly string[]).includes(key)) {
      const capacity = capacities[key as keyof typeof capacities];
      const wasFull = finiteNonNegative(wallet[key]) >= finiteNonNegative(capacity);
      const isFull = credit.wallet[key] >= finiteNonNegative(capacity);
      remainder[key] = wasFull || isFull ? 0 : Math.max(0, raw - whole);
    } else {
      remainder[key] = Math.max(0, raw - whole);
    }
  }

  const nextClock: ResourceClockEntry = { lastReconciledAt: now, remainder };
  const withClock = withPlanetClock({ ...state }, context.planetId, nextClock);
  const next = replacePlanetResources(
    withClock,
    context.planetId,
    credit.wallet,
  );
  const changed = !resourcesEqual(state, next, context.planetId) || !clockWasPersisted || !clocksEqual(clock, nextClock);
  return { changed, state: changed ? next : state, credit };
}

function targetClock(target: SpyTargetState, now: number) {
  const safeNow = finiteNonNegative(now, Date.now());
  const stored = target.resourceClock;
  const lastReconciledAt = Math.min(safeNow, finiteNonNegative(stored?.lastReconciledAt, safeNow));
  return {
    lastReconciledAt,
    remainder: {
      metal: Math.min(0.999_999_999, finiteNonNegative(stored?.remainder.metal)),
      minerals: Math.min(0.999_999_999, finiteNonNegative(stored?.remainder.minerals)),
      gas: Math.min(0.999_999_999, finiteNonNegative(stored?.remainder.gas)),
    },
  };
}

function targetBuildings(target: SpyTargetState): Partial<Record<BuildingRole, number>> {
  const source = target.buildings ?? {};
  return {
    ...(source as Partial<Record<BuildingRole, number>>),
    // These aliases keep old Bot 01 saves ticking while new fixtures use the
    // canonical resource-building roles.
    'metal-production-1': source['metal-production-1'] ?? source['metal-mine'] ?? 0,
    'mineral-production-1': source['mineral-production-1'] ?? source['mineral-mine'] ?? 0,
    'gas-production-1': source['gas-production-1'] ?? source['gas-extractor'] ?? 0,
  };
}

function updateTargetRegistry(state: SaveState, targets: Record<string, SpyTargetState>): SaveState {
  const current = state.espionage ?? createDefaultEspionageState();
  const nextEspionage: EspionageState = {
    ...current,
    targets,
    ...(current.bot01Planets ? { bot01Planets: targets } : {}),
  };
  return { ...state, espionage: nextEspionage };
}

/**
 * Settles the Test Mode Bot 01 economy on the same runtime clock as flights.
 * Target storage is intentionally uncapped: the fixture starts near 10M and
 * its purpose is to exercise attack loot, not the player's warehouse rules.
 */
export function reconcileTestEspionageTargetResources(
  state: SaveState,
  context: TestTargetResourceReconcileContext,
): SaveState {
  if (context.mode !== 'test') return state;
  const currentEspionage = state.espionage;
  if (!currentEspionage) return state;
  const targets = getEspionageTargets(currentEspionage);
  const profile = currentEspionage.bot01Profile;
  let changed = false;
  const nextTargets: Record<string, SpyTargetState> = { ...targets };
  const now = finiteNonNegative(context.now, Date.now());

  for (const [id, target] of Object.entries(targets)) {
    if (target.ownerId !== UNIVERSE_NPC_OWNER_ID) continue;
    const clock = targetClock(target, now);
    if (now < clock.lastReconciledAt) {
      if (target.resourceClock) continue;
      nextTargets[id] = { ...target, resourceClock: clock };
      changed = true;
      continue;
    }
    const elapsedHours = (now - clock.lastReconciledAt) / HOUR_MS;
    const baseIncome = getBuildingResourceIncomePerHour(
      targetBuildings(target),
      profile?.scienceLevels ?? target.ownerProfile?.scienceLevels,
    );
    const hourly = getEffectiveResourceIncomePerHour(baseIncome, context.mode, context.testTimeScale);
    const remainder = { ...clock.remainder };
    const resources = { ...target.resources };
    for (const key of RESOURCE_KEYS) {
      const raw = hourly[key] * elapsedHours + clock.remainder[key];
      const whole = Number.isFinite(raw) ? Math.floor(Math.max(0, raw)) : 0;
      resources[key] = finiteNonNegative(resources[key]) + whole;
      remainder[key] = Number.isFinite(raw) ? Math.max(0, raw - whole) : 0;
    }
    const nextTarget: SpyTargetState = {
      ...target,
      resources,
      resourceClock: { lastReconciledAt: now, remainder },
    };
    const nextClock = nextTarget.resourceClock!;
    if (nextClock.lastReconciledAt !== target.resourceClock?.lastReconciledAt
      || RESOURCE_KEYS.some((key) => nextTarget.resources[key] !== target.resources[key])
      || RESOURCE_KEYS.some((key) => nextClock.remainder[key] !== target.resourceClock?.remainder[key])) {
      nextTargets[id] = nextTarget;
      changed = true;
    }
  }
  return changed ? updateTargetRegistry(state, nextTargets) : state;
}
