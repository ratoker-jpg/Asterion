import {
  getBuildingEnergyIncomePerHour,
  getBuildingResourceIncomePerHour,
  getStorageCapacities,
  type ResourceKey,
} from '../domain/buildings/resource-zone.ts';
import { getProductionBotIncomePerHour } from '../domain/buildings/production-bots.ts';
import { creditResources, type ResourceCreditResult } from '../domain/resources/credit.ts';
import { normalizeTestTimeScale, type RuntimeMode, type TestTimeScale } from '../domain/runtime/mode.ts';
import type { ResourceClock, SaveState } from './contracts.ts';

const RESOURCE_KEYS = ['metal', 'minerals', 'gas', 'energy'] as const satisfies readonly ResourceKey[];
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

function finiteNonNegative(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : fallback;
}

function normalizeClock(clock: ResourceClock | undefined, now: number): ResourceClock {
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
      energy: remainder('energy'),
    },
  };
}

function clocksEqual(left: ResourceClock, right: ResourceClock): boolean {
  return left.lastReconciledAt === right.lastReconciledAt
    && RESOURCE_KEYS.every((key) => left.remainder[key] === right.remainder[key]);
}

function resourcesEqual(left: SaveState, right: SaveState): boolean {
  return left.metal === right.metal
    && left.minerals === right.minerals
    && left.gas === right.gas
    && left.planets[left.currentPlanetId]?.energy === right.planets[right.currentPlanetId]?.energy;
}

function withResourceValues(state: SaveState, planetId: SaveState['currentPlanetId'], wallet: Record<ResourceKey, number>): SaveState {
  const planet = state.planets[planetId];
  return {
    ...state,
    metal: wallet.metal,
    minerals: wallet.minerals,
    gas: wallet.gas,
    planets: {
      ...state.planets,
      [planetId]: { ...planet, energy: wallet.energy },
    },
  };
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
  if (!planet) return { changed: false, state, credit: { wallet: { metal: state.metal, minerals: state.minerals, gas: state.gas, energy: 0 }, accepted: { metal: 0, minerals: 0, gas: 0, energy: 0 }, burned: { metal: 0, minerals: 0, gas: 0, energy: 0 } } };

  const clock = normalizeClock(state.resourceClock, now);
  if (now < clock.lastReconciledAt) {
    return {
      changed: !clocksEqual(clock, state.resourceClock),
      state: clocksEqual(clock, state.resourceClock) ? state : { ...state, resourceClock: clock },
      credit: { wallet: { metal: state.metal, minerals: state.minerals, gas: state.gas, energy: planet.energy }, accepted: { metal: 0, minerals: 0, gas: 0, energy: 0 }, burned: { metal: 0, minerals: 0, gas: 0, energy: 0 } },
    };
  }

  const elapsedMs = now - clock.lastReconciledAt;
  const elapsedMultiplier = context.mode === 'test' ? normalizeTestTimeScale(context.testTimeScale) : 1;
  const elapsedHours = (elapsedMs * elapsedMultiplier) / HOUR_MS;
  const baseIncome = getBuildingResourceIncomePerHour(planet.buildings, state.science.levels);
  const income = getProductionBotIncomePerHour(baseIncome, planet.productionBots);
  const hourly = {
    metal: finiteNonNegative(income.metal),
    minerals: finiteNonNegative(income.minerals),
    gas: finiteNonNegative(income.gas),
    energy: finiteNonNegative(getBuildingEnergyIncomePerHour(planet.buildings, state.science.levels)),
  };
  const capacities = getStorageCapacities(planet.buildings);
  const rawCredits = {
    metal: hourly.metal * elapsedHours + clock.remainder.metal,
    minerals: hourly.minerals * elapsedHours + clock.remainder.minerals,
    gas: hourly.gas * elapsedHours + clock.remainder.gas,
    energy: hourly.energy * elapsedHours + clock.remainder.energy,
  };
  const wholeCredits = Object.fromEntries(
    RESOURCE_KEYS.map((key) => [key, Number.isFinite(rawCredits[key]) ? Math.floor(Math.max(0, rawCredits[key])) : 0]),
  ) as Record<ResourceKey, number>;
  const wallet = { metal: state.metal, minerals: state.minerals, gas: state.gas, energy: planet.energy };
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

  const nextClock: ResourceClock = { lastReconciledAt: now, remainder };
  const next = withResourceValues({ ...state, resourceClock: nextClock }, context.planetId, credit.wallet);
  const changed = !resourcesEqual(state, next) || !clocksEqual(clock, nextClock);
  return { changed, state: changed ? next : state, credit };
}
