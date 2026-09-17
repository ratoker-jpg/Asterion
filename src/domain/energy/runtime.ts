import { SCIENCE_ID_PHYSICS, type BuildingRole } from '../buildings/balance-v1.ts';
import { getBuildingEnergyBaseContribution } from './balance-adapter.ts';

/**
 * Energy is a one-time planetary stock.  The ledger deliberately keeps the
 * current source snapshots separate from the amount that has already been
 * consumed so that source changes never silently refund a prior expense.
 */

export const ENERGY_SOURCE_ORDER = [
  'solar-satellite',
  'solar-station',
  'nuclear-reactor',
] as const;

export type EnergySourceId = (typeof ENERGY_SOURCE_ORDER)[number];
export type EnergySourceChangeKind = 'building' | 'satellite' | 'environment';

export const SOLAR_SATELLITE_BASE_ENERGY = 55;
export const ENERGY_SYSTEM_COUNT = 40;
export const ENERGY_POSITION_COUNT = 24;

// Keep this as an explicit, stable table.  It is intentionally independent
// of seeded map decoration and is shared by the runtime, simulator, and UI.
export const SUN_EFFICIENCY_BY_SYSTEM: Readonly<Record<number, number>> = Object.freeze({
  1: 70, 2: 70, 3: 70, 4: 70, 5: 70, 6: 70, 7: 70, 8: 70, 9: 70, 10: 70,
  11: 70, 12: 70, 13: 70, 14: 70,
  15: 85, 16: 85, 17: 85, 18: 85,
  19: 100, 20: 100, 21: 100,
  22: 85, 23: 85, 24: 85, 25: 85,
  26: 70, 27: 70, 28: 70, 29: 70, 30: 70, 31: 70, 32: 70, 33: 70, 34: 70, 35: 70,
  36: 70, 37: 70, 38: 70, 39: 70, 40: 70,
});

// Position coefficients are intentionally listed one by one.  Do not
// replace this with an inferred distance formula: the balance is asymmetric.
export const POSITION_COEFFICIENT_BY_POSITION: Readonly<Record<number, number>> = Object.freeze({
  1: 120, 2: 120, 3: 130, 4: 125, 5: 125, 6: 130,
  7: 110, 8: 115, 9: 115, 10: 110, 11: 115, 12: 115,
  13: 95, 14: 100, 15: 105, 16: 95, 17: 100, 18: 105,
  19: 80, 20: 85, 21: 85, 22: 75, 23: 90, 24: 85,
});

export type EnergySourceSnapshot = {
  id: EnergySourceId;
  kind: EnergySourceId;
  buildingRole?: 'basic-energy' | 'advanced-energy';
  level: number;
  count: number;
  /** Raw table value before Physics and environmental multipliers. */
  baseValue: number;
  /** Raw value multiplied by count for the satellite source. */
  baseContribution: number;
  physicsMultiplier: number;
  sunMultiplier: number;
  positionMultiplier: number;
  fullContribution: number;
  consumedContribution: number;
  unusedContribution: number;
};

export type EnergyLedger = {
  producedEnergy: number;
  consumedEnergy: number;
  availableEnergy: number;
  sources: EnergySourceSnapshot[];
  /** Consumption attributed to currently active source generations. */
  consumedBySource: Partial<Record<EnergySourceId, number>>;
  /** Consumption retained after a source generation was removed. */
  retiredConsumedBySource: Partial<Record<EnergySourceId, number>>;
  /** Opening balances and legacy debt which have no active source owner. */
  unattributedConsumedEnergy: number;
  /** Idempotency keys for application transactions. */
  appliedTransactionIds: string[];
  debtCause: 'source-removal' | null;
};

export type EnergyOperationResult = {
  ok: boolean;
  ledger: EnergyLedger;
  amount: number;
  reason: string | null;
};

export type EnergySourceBuildInput = {
  buildings?: Readonly<Partial<Record<BuildingRole, number>>>;
  physicsLevel?: number;
  scienceLevels?: Readonly<Partial<Record<number, number>>>;
  solarSatellites?: number;
  system?: number;
  position?: number;
};

export type EnergyRebuildOptions = {
  legacyAvailableEnergy?: number;
  sourceChanges?: Partial<Record<EnergySourceId, EnergySourceChangeKind>>;
};

function finiteNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function safeInteger(value: unknown, fallback = 0): number {
  return Math.max(0, Math.floor(finiteNumber(value, fallback)));
}

/** One deterministic rounding rule for every source and every saved value. */
export function roundEnergy(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

export function getPhysicsMultiplier(level: number): number {
  const safeLevel = Math.min(10, safeInteger(level));
  return 1 + safeLevel * 0.05;
}

export function getSunEfficiencyPercent(system: number): number {
  const safeSystem = safeInteger(system);
  return SUN_EFFICIENCY_BY_SYSTEM[safeSystem] ?? SUN_EFFICIENCY_BY_SYSTEM[1];
}

export function getSunMultiplier(system: number): number {
  return getSunEfficiencyPercent(system) / 100;
}

export function getPositionCoefficientPercent(position: number): number {
  const safePosition = safeInteger(position);
  return POSITION_COEFFICIENT_BY_POSITION[safePosition] ?? POSITION_COEFFICIENT_BY_POSITION[1];
}

export function getPositionMultiplier(position: number): number {
  return getPositionCoefficientPercent(position) / 100;
}

function tableValue(role: 'basic-energy' | 'advanced-energy', level: number): number {
  return roundEnergy(getBuildingEnergyBaseContribution(role, level));
}

function normalizePhysicsLevel(input: EnergySourceBuildInput): number {
  return input.physicsLevel ?? input.scienceLevels?.[SCIENCE_ID_PHYSICS] ?? 0;
}

export function calculateSolarStationContribution(
  level: number,
  physicsLevel = 0,
  system = 1,
  position = 1,
): number {
  return roundEnergy(
    tableValue('basic-energy', level)
    * getPhysicsMultiplier(physicsLevel)
    * getSunMultiplier(system)
    * getPositionMultiplier(position),
  );
}

export function calculateNuclearReactorContribution(level: number, physicsLevel = 0): number {
  return roundEnergy(tableValue('advanced-energy', level) * getPhysicsMultiplier(physicsLevel));
}

export function calculateSolarSatelliteContribution(
  count: number,
  physicsLevel = 0,
  system = 1,
  position = 1,
): number {
  return roundEnergy(
    safeInteger(count)
    * SOLAR_SATELLITE_BASE_ENERGY
    * getPhysicsMultiplier(physicsLevel)
    * getSunMultiplier(system)
    * getPositionMultiplier(position),
  );
}

function snapshot(
  id: EnergySourceId,
  baseValue: number,
  baseContribution: number,
  fullContribution: number,
  factors: Pick<EnergySourceSnapshot, 'physicsMultiplier' | 'sunMultiplier' | 'positionMultiplier'>,
  level: number,
  count: number,
  buildingRole?: 'basic-energy' | 'advanced-energy',
): EnergySourceSnapshot {
  return {
    id,
    kind: id,
    ...(buildingRole ? { buildingRole } : {}),
    level,
    count,
    baseValue,
    baseContribution,
    ...factors,
    fullContribution: roundEnergy(fullContribution),
    consumedContribution: 0,
    unusedContribution: roundEnergy(fullContribution),
  };
}

/** Calculates all active sources from one shared set of coefficients. */
export function calculateEnergySources(input: EnergySourceBuildInput = {}): EnergySourceSnapshot[] {
  const buildings = input.buildings ?? {};
  const physicsLevel = normalizePhysicsLevel(input);
  const physicsMultiplier = getPhysicsMultiplier(physicsLevel);
  const sunMultiplier = getSunMultiplier(input.system ?? 1);
  const positionMultiplier = getPositionMultiplier(input.position ?? 1);
  const sources: EnergySourceSnapshot[] = [];
  const solarLevel = safeInteger(buildings['basic-energy']);
  const reactorLevel = safeInteger(buildings['advanced-energy']);
  const satelliteCount = safeInteger(input.solarSatellites);

  if (solarLevel > 0) {
    const baseValue = tableValue('basic-energy', solarLevel);
    sources.push(snapshot(
      'solar-station',
      baseValue,
      baseValue,
      baseValue * physicsMultiplier * sunMultiplier * positionMultiplier,
      { physicsMultiplier, sunMultiplier, positionMultiplier },
      solarLevel,
      1,
      'basic-energy',
    ));
  }
  if (reactorLevel > 0) {
    const baseValue = tableValue('advanced-energy', reactorLevel);
    sources.push(snapshot(
      'nuclear-reactor',
      baseValue,
      baseValue,
      baseValue * physicsMultiplier,
      { physicsMultiplier, sunMultiplier: 1, positionMultiplier: 1 },
      reactorLevel,
      1,
      'advanced-energy',
    ));
  }
  if (satelliteCount > 0) {
    sources.push(snapshot(
      'solar-satellite',
      SOLAR_SATELLITE_BASE_ENERGY,
      satelliteCount * SOLAR_SATELLITE_BASE_ENERGY,
      satelliteCount * SOLAR_SATELLITE_BASE_ENERGY * physicsMultiplier * sunMultiplier * positionMultiplier,
      { physicsMultiplier, sunMultiplier, positionMultiplier },
      0,
      satelliteCount,
    ));
  }

  return sources.sort((left, right) => ENERGY_SOURCE_ORDER.indexOf(left.id) - ENERGY_SOURCE_ORDER.indexOf(right.id));
}

function cloneSources(sources: readonly EnergySourceSnapshot[]): EnergySourceSnapshot[] {
  return sources.map((source) => ({ ...source }));
}

function cloneLedger(ledger: EnergyLedger): EnergyLedger {
  return {
    ...ledger,
    sources: cloneSources(ledger.sources ?? []),
    consumedBySource: { ...(ledger.consumedBySource ?? {}) },
    retiredConsumedBySource: { ...(ledger.retiredConsumedBySource ?? {}) },
    appliedTransactionIds: [...(ledger.appliedTransactionIds ?? [])],
  };
}

function sourceMap(sources: readonly EnergySourceSnapshot[]): Map<EnergySourceId, EnergySourceSnapshot> {
  return new Map(sources.map((source) => [source.id, source]));
}

function attributionValue(value: unknown): number {
  return Math.max(0, finiteNumber(value));
}

function sumAttribution(values: Partial<Record<EnergySourceId, number>>): number {
  return ENERGY_SOURCE_ORDER.reduce((total, id) => total + attributionValue(values[id]), 0);
}

function normalizeSource(source: EnergySourceSnapshot): EnergySourceSnapshot {
  const fullContribution = roundEnergy(source.fullContribution);
  const consumedContribution = Math.min(fullContribution, attributionValue(source.consumedContribution));
  return {
    ...source,
    level: safeInteger(source.level),
    count: safeInteger(source.count),
    baseValue: roundEnergy(source.baseValue),
    baseContribution: roundEnergy(source.baseContribution),
    physicsMultiplier: Math.max(0, finiteNumber(source.physicsMultiplier, 1)),
    sunMultiplier: Math.max(0, finiteNumber(source.sunMultiplier, 1)),
    positionMultiplier: Math.max(0, finiteNumber(source.positionMultiplier, 1)),
    fullContribution,
    consumedContribution,
    unusedContribution: Math.max(0, fullContribution - consumedContribution),
  };
}

function withUsage(
  sources: readonly EnergySourceSnapshot[],
  consumedBySource: Partial<Record<EnergySourceId, number>>,
): EnergySourceSnapshot[] {
  return sources.map((raw) => {
    const source = normalizeSource(raw);
    const consumedContribution = Math.min(source.fullContribution, attributionValue(consumedBySource[source.id]));
    return {
      ...source,
      consumedContribution,
      unusedContribution: Math.max(0, source.fullContribution - consumedContribution),
    };
  });
}

function markTransaction(ledger: EnergyLedger, transactionId?: string): boolean {
  if (!transactionId) return false;
  if (ledger.appliedTransactionIds.includes(transactionId)) return true;
  ledger.appliedTransactionIds.push(transactionId);
  if (ledger.appliedTransactionIds.length > 256) ledger.appliedTransactionIds.splice(0, ledger.appliedTransactionIds.length - 256);
  return false;
}

function finalizeLedger(
  ledger: EnergyLedger,
  sources: readonly EnergySourceSnapshot[],
  debtCause: EnergyLedger['debtCause'] = ledger.debtCause,
): EnergyLedger {
  const next = cloneLedger(ledger);
  next.sources = withUsage(sources, next.consumedBySource);
  next.producedEnergy = finiteNumber(next.producedEnergy);
  next.consumedEnergy = Math.max(0, finiteNumber(next.consumedEnergy));
  next.unattributedConsumedEnergy = Math.max(0, finiteNumber(next.unattributedConsumedEnergy));
  next.availableEnergy = next.producedEnergy - next.consumedEnergy;
  next.debtCause = next.availableEnergy < 0 ? debtCause : null;
  return next;
}

export function createEnergyLedger(
  sources: readonly EnergySourceSnapshot[] = [],
  availableEnergy?: number,
): EnergyLedger {
  const normalizedSources = cloneSources(sources).map(normalizeSource);
  const sourceTotal = normalizedSources.reduce((total, source) => total + source.fullContribution, 0);
  const legacyAvailable = availableEnergy == null ? sourceTotal : finiteNumber(availableEnergy, sourceTotal);
  const producedEnergy = Math.max(sourceTotal, legacyAvailable);
  const consumedEnergy = Math.max(0, producedEnergy - legacyAvailable);
  const ledger: EnergyLedger = {
    producedEnergy,
    consumedEnergy,
    availableEnergy: producedEnergy - consumedEnergy,
    sources: normalizedSources,
    consumedBySource: {},
    retiredConsumedBySource: {},
    unattributedConsumedEnergy: 0,
    appliedTransactionIds: [],
    debtCause: producedEnergy - consumedEnergy < 0 ? 'source-removal' : null,
  };
  let remaining = consumedEnergy;
  for (const id of ENERGY_SOURCE_ORDER) {
    const source = normalizedSources.find((candidate) => candidate.id === id);
    if (!source || remaining <= 0) continue;
    const attributed = Math.min(source.fullContribution, remaining);
    ledger.consumedBySource[id] = attributed;
    remaining -= attributed;
  }
  ledger.unattributedConsumedEnergy = remaining;
  return finalizeLedger(ledger, normalizedSources);
}

/**
 * Rebuilds active source snapshots after a building, science, location, or
 * satellite change while preserving consumption attribution and debt.
 */
export function rebuildEnergyLedger(
  previous: EnergyLedger | undefined,
  nextSources: readonly EnergySourceSnapshot[],
  options: EnergyRebuildOptions = {},
): EnergyLedger {
  if (!previous) return createEnergyLedger(nextSources, options.legacyAvailableEnergy);

  const prior = cloneLedger(previous);
  const priorSources = prior.sources.map(normalizeSource);
  const next = nextSources.map(normalizeSource);
  const priorById = sourceMap(priorSources);
  const nextById = sourceMap(next);
  const sourceChanges = options.sourceChanges ?? {};
  let producedEnergy = finiteNumber(prior.producedEnergy, priorSources.reduce((sum, source) => sum + source.fullContribution, 0));
  const consumedBySource = { ...prior.consumedBySource };
  const retiredConsumedBySource = { ...prior.retiredConsumedBySource };

  for (const id of ENERGY_SOURCE_ORDER) {
    const oldSource = priorById.get(id);
    const newSource = nextById.get(id);
    const changeKind = sourceChanges[id];

    if (!oldSource && newSource) {
      producedEnergy += newSource.fullContribution;
      consumedBySource[id] = 0;
      continue;
    }
    if (oldSource && !newSource) {
      const oldUnused = Math.max(0, oldSource.unusedContribution);
      producedEnergy -= changeKind === 'building' ? oldSource.fullContribution : oldUnused;
      const activeConsumed = attributionValue(consumedBySource[id] ?? oldSource.consumedContribution);
      if (activeConsumed > 0) retiredConsumedBySource[id] = attributionValue(retiredConsumedBySource[id]) + activeConsumed;
      consumedBySource[id] = 0;
      continue;
    }
    if (!oldSource || !newSource) continue;

    const delta = newSource.fullContribution - oldSource.fullContribution;
    if (delta >= 0) {
      // Positive changes are retroactive against the full original source.
      producedEnergy += delta;
    } else if (changeKind === 'building') {
      // A downgrade is an explicit source reduction and may create debt.
      producedEnergy += delta;
    } else {
      // Environment changes and satellite dismantling remove only unused
      // energy; spent energy is retained and cannot turn into a new debt.
      producedEnergy -= Math.min(-delta, Math.max(0, oldSource.unusedContribution));
    }

    const activeConsumed = attributionValue(consumedBySource[id] ?? oldSource.consumedContribution);
    const nextActiveConsumed = Math.min(newSource.fullContribution, activeConsumed);
    if (activeConsumed > nextActiveConsumed) {
      retiredConsumedBySource[id] = attributionValue(retiredConsumedBySource[id]) + activeConsumed - nextActiveConsumed;
    }
    consumedBySource[id] = nextActiveConsumed;
  }

  const consumedEnergy = Math.max(0, finiteNumber(prior.consumedEnergy, sumAttribution(consumedBySource) + sumAttribution(retiredConsumedBySource) + finiteNumber(prior.unattributedConsumedEnergy)));
  const debtCause: EnergyLedger['debtCause'] = producedEnergy - consumedEnergy < 0
    ? (Object.values(sourceChanges).includes('building') ? 'source-removal' : prior.debtCause)
    : null;
  return finalizeLedger({
    ...prior,
    producedEnergy,
    consumedEnergy,
    consumedBySource,
    retiredConsumedBySource,
    debtCause,
  }, next, debtCause);
}

export function consumeEnergy(ledger: EnergyLedger, amount: number, transactionId?: string): EnergyOperationResult {
  const next = cloneLedger(ledger);
  if (markTransaction(next, transactionId)) return { ok: true, ledger: next, amount: 0, reason: null };
  const requested = roundEnergy(amount);
  if (requested <= 0) return { ok: true, ledger: finalizeLedger(next, next.sources), amount: 0, reason: null };
  if (next.availableEnergy < requested) {
    return { ok: false, ledger: finalizeLedger(next, next.sources), amount: 0, reason: 'Недостаточно доступной энергии.' };
  }

  let remaining = requested;
  const consumedBySource = { ...next.consumedBySource };
  for (const id of ENERGY_SOURCE_ORDER) {
    const source = next.sources.find((candidate) => candidate.id === id);
    if (!source || remaining <= 0) continue;
    const alreadyConsumed = attributionValue(consumedBySource[id]);
    const unused = Math.max(0, source.fullContribution - alreadyConsumed);
    const attributed = Math.min(unused, remaining);
    consumedBySource[id] = alreadyConsumed + attributed;
    remaining -= attributed;
  }
  if (remaining > 0) next.unattributedConsumedEnergy += remaining;
  next.consumedBySource = consumedBySource;
  next.consumedEnergy += requested;
  return { ok: true, ledger: finalizeLedger(next, next.sources), amount: requested, reason: null };
}

/** Refunds only an explicitly refundable ordinary cost; science never calls this. */
export function refundEnergy(ledger: EnergyLedger, amount: number, transactionId?: string): EnergyOperationResult {
  const next = cloneLedger(ledger);
  if (markTransaction(next, transactionId)) return { ok: true, ledger: next, amount: 0, reason: null };
  const requested = roundEnergy(amount);
  const refunded = Math.min(requested, next.consumedEnergy);
  let remaining = refunded;
  const consumedBySource = { ...next.consumedBySource };
  const retiredConsumedBySource = { ...next.retiredConsumedBySource };
  for (const id of [...ENERGY_SOURCE_ORDER].reverse()) {
    if (remaining <= 0) break;
    const active = Math.min(attributionValue(consumedBySource[id]), remaining);
    consumedBySource[id] = attributionValue(consumedBySource[id]) - active;
    remaining -= active;
    if (remaining <= 0) break;
    const retired = Math.min(attributionValue(retiredConsumedBySource[id]), remaining);
    retiredConsumedBySource[id] = attributionValue(retiredConsumedBySource[id]) - retired;
    remaining -= retired;
  }
  const unattributed = Math.min(Math.max(0, next.unattributedConsumedEnergy), remaining);
  next.unattributedConsumedEnergy -= unattributed;
  remaining -= unattributed;
  next.consumedBySource = consumedBySource;
  next.retiredConsumedBySource = retiredConsumedBySource;
  next.consumedEnergy -= refunded - remaining;
  return { ok: true, ledger: finalizeLedger(next, next.sources), amount: refunded - remaining, reason: null };
}

export function removeEnergySource(
  ledger: EnergyLedger,
  sourceId: EnergySourceId,
  changeKind: EnergySourceChangeKind = sourceId === 'solar-satellite' ? 'satellite' : 'building',
  transactionId?: string,
): EnergyOperationResult {
  const next = cloneLedger(ledger);
  if (markTransaction(next, transactionId)) return { ok: true, ledger: next, amount: 0, reason: null };
  const source = next.sources.find((candidate) => candidate.id === sourceId);
  if (!source) return { ok: true, ledger: finalizeLedger(next, next.sources), amount: 0, reason: null };
  const removed = changeKind === 'building' ? source.fullContribution : source.unusedContribution;
  const rebuilt = rebuildEnergyLedger(next, next.sources.filter((candidate) => candidate.id !== sourceId), {
    sourceChanges: { [sourceId]: changeKind },
  });
  rebuilt.appliedTransactionIds = next.appliedTransactionIds;
  if (changeKind === 'building') rebuilt.debtCause = rebuilt.availableEnergy < 0 ? 'source-removal' : null;
  return { ok: true, ledger: rebuilt, amount: removed, reason: null };
}

/** Coerces old or partially written save data into the current ledger shape. */
export function hydrateEnergyLedger(
  value: unknown,
  nextSources: readonly EnergySourceSnapshot[],
  legacyAvailableEnergy: number,
): EnergyLedger {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return createEnergyLedger(nextSources, legacyAvailableEnergy);
  }
  const raw = value as Record<string, unknown>;
  const rawSources = Array.isArray(raw.sources)
    ? raw.sources.filter((source): source is EnergySourceSnapshot => Boolean(source && typeof source === 'object'))
    : [];
  if (typeof raw.producedEnergy !== 'number' && typeof raw.consumedEnergy !== 'number' && rawSources.length === 0) {
    return createEnergyLedger(nextSources, legacyAvailableEnergy);
  }
  const previous: EnergyLedger = {
    producedEnergy: finiteNumber(raw.producedEnergy, legacyAvailableEnergy),
    consumedEnergy: Math.max(0, finiteNumber(raw.consumedEnergy)),
    availableEnergy: finiteNumber(raw.availableEnergy, legacyAvailableEnergy),
    sources: rawSources.map(normalizeSource),
    consumedBySource: raw.consumedBySource && typeof raw.consumedBySource === 'object'
      ? raw.consumedBySource as Partial<Record<EnergySourceId, number>>
      : {},
    retiredConsumedBySource: raw.retiredConsumedBySource && typeof raw.retiredConsumedBySource === 'object'
      ? raw.retiredConsumedBySource as Partial<Record<EnergySourceId, number>>
      : {},
    unattributedConsumedEnergy: Math.max(0, finiteNumber(raw.unattributedConsumedEnergy)),
    appliedTransactionIds: Array.isArray(raw.appliedTransactionIds)
      ? raw.appliedTransactionIds.filter((id): id is string => typeof id === 'string').slice(-256)
      : [],
    debtCause: raw.debtCause === 'source-removal' ? 'source-removal' : null,
  };
  return rebuildEnergyLedger(previous, nextSources);
}
