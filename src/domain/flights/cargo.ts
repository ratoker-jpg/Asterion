import type { ShipId } from '../combat/ids.ts';
import { creditResources, type CappedResourceKey, type CreditWalletInput, type ResourceCapacitiesInput } from '../resources/credit.ts';

export const TRANSPORT_CARGO_KEYS = ['metal', 'minerals', 'gas', 'debris'] as const;

export type TransportCargoKey = (typeof TRANSPORT_CARGO_KEYS)[number];
export type TransportCargo = Record<TransportCargoKey, number>;
export type CargoCapacity = { used: number; total: number; free: number };
export type CargoShipTraits = Readonly<{ cargo: unknown }>;
export type CargoShipCatalog = Readonly<Partial<Record<ShipId, CargoShipTraits | undefined>>>;
export type TransportResourceWallet = Readonly<Partial<Record<CappedResourceKey, unknown>>>;

export type CappedCargoDelivery = {
  resources: Record<CappedResourceKey, number>;
  accepted: Record<CappedResourceKey, number>;
  burned: Record<CappedResourceKey, number>;
};

export type TransportCargoCredit = CappedCargoDelivery & {
  debris: number;
  acceptedDebris: number;
  burnedDebris: number;
};

const CAPPED_CARGO_KEYS = ['metal', 'minerals', 'gas'] as const satisfies readonly CappedResourceKey[];

export function normalizeCargoAmount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0;
  return Math.min(Number.MAX_SAFE_INTEGER, Math.floor(value));
}

export function emptyTransportCargo(): TransportCargo {
  return { metal: 0, minerals: 0, gas: 0, debris: 0 };
}

/** Normalizes untrusted persisted or draft cargo without retaining unknown keys. */
export function normalizeTransportCargo(value: unknown): TransportCargo {
  const candidate = value !== null && typeof value === 'object'
    ? value as Partial<Record<TransportCargoKey, unknown>>
    : {};
  return {
    metal: normalizeCargoAmount(candidate.metal),
    minerals: normalizeCargoAmount(candidate.minerals),
    gas: normalizeCargoAmount(candidate.gas),
    debris: normalizeCargoAmount(candidate.debris),
  };
}

/** Returns undefined for an absent persisted snapshot, preserving old non-transport records. */
export function normalizePersistedTransportCargo(value: unknown): TransportCargo | undefined {
  return value === undefined || value === null ? undefined : normalizeTransportCargo(value);
}

export function getCargoUsed(cargo: unknown): number {
  const normalized = normalizeTransportCargo(cargo);
  return TRANSPORT_CARGO_KEYS.reduce((total, key) => total + normalized[key], 0);
}

/** Sums caller-supplied canonical ship cargo traits; it intentionally does not own a faction catalog. */
export function getFleetCargoCapacity(
  selectedShips: Readonly<Partial<Record<ShipId, unknown>>>,
  shipCatalog: CargoShipCatalog,
): number {
  let total = 0;
  for (const [id, quantity] of Object.entries(selectedShips) as [ShipId, unknown][]) {
    total += normalizeCargoAmount(quantity) * normalizeCargoAmount(shipCatalog[id]?.cargo);
  }
  return Math.min(Number.MAX_SAFE_INTEGER, total);
}

export function getCargoCapacity(cargo: unknown, totalCapacity: unknown): CargoCapacity {
  const used = getCargoUsed(cargo);
  const total = normalizeCargoAmount(totalCapacity);
  return { used, total, free: Math.max(0, total - used) };
}

/** Clamps draft cargo in stable resource order to source balances and shared fleet capacity. */
export function clampCargoToSourceAndCapacity(
  requested: unknown,
  sourceResources: TransportResourceWallet,
  sourceDebris: unknown,
  capacity: unknown,
): TransportCargo {
  const normalized = normalizeTransportCargo(requested);
  let free = normalizeCargoAmount(capacity);
  const result = emptyTransportCargo();
  for (const key of CAPPED_CARGO_KEYS) {
    const amount = Math.min(normalized[key], normalizeCargoAmount(sourceResources[key]), free);
    result[key] = amount;
    free -= amount;
  }
  result.debris = Math.min(normalized.debris, normalizeCargoAmount(sourceDebris), free);
  return result;
}

export function getCappedDelivery(
  resources: CreditWalletInput,
  storageCaps: ResourceCapacitiesInput | undefined,
  cargo: unknown,
): CappedCargoDelivery {
  const normalized = normalizeTransportCargo(cargo);
  const result = creditResources(resources, storageCaps, normalized);
  return {
    resources: Object.fromEntries(CAPPED_CARGO_KEYS.map((key) => [key, result.wallet[key]])) as Record<CappedResourceKey, number>,
    accepted: Object.fromEntries(CAPPED_CARGO_KEYS.map((key) => [key, result.accepted[key]])) as Record<CappedResourceKey, number>,
    burned: Object.fromEntries(CAPPED_CARGO_KEYS.map((key) => [key, result.burned[key]])) as Record<CappedResourceKey, number>,
  };
}

/** Debris has no storage capacity, but malformed values remain harmless. */
export function addDebris(current: unknown, amount: unknown): number {
  return Math.min(Number.MAX_SAFE_INTEGER, normalizeCargoAmount(current) + normalizeCargoAmount(amount));
}

/** Pure arrival/recall credit result: capped resources burn overflow; debris never does. */
export function creditTransportCargo(
  resources: CreditWalletInput,
  storageCaps: ResourceCapacitiesInput | undefined,
  debris: unknown,
  cargo: unknown,
): TransportCargoCredit {
  const capped = getCappedDelivery(resources, storageCaps, cargo);
  const normalized = normalizeTransportCargo(cargo);
  return {
    ...capped,
    debris: addDebris(debris, normalized.debris),
    acceptedDebris: normalized.debris,
    burnedDebris: 0,
  };
}

export function getOverflowWarning(
  cargo: unknown,
  destinationResources: CreditWalletInput,
  _destinationDebris: unknown,
  caps: ResourceCapacitiesInput | undefined,
): boolean {
  const delivery = getCappedDelivery(destinationResources, caps, cargo);
  return CAPPED_CARGO_KEYS.some((key) => delivery.burned[key] > 0);
}
