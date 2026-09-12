export const CREDIT_RESOURCE_KEYS = ['metal', 'minerals', 'gas', 'energy'] as const;
export const CAPPED_RESOURCE_KEYS = ['metal', 'minerals', 'gas'] as const;

export type CreditResourceKey = (typeof CREDIT_RESOURCE_KEYS)[number];
export type CappedResourceKey = (typeof CAPPED_RESOURCE_KEYS)[number];

/** Structural input compatible with a SaveState-derived wallet without importing it. */
export type CreditWalletInput = Readonly<Partial<Record<CreditResourceKey, unknown>>>;
/** Structural input compatible with getStorageCapacities without importing balance-v1. */
export type ResourceCapacitiesInput = Readonly<Partial<Record<CappedResourceKey, unknown>>>;
export type ResourceCreditInput = Readonly<Partial<Record<CreditResourceKey, unknown>>>;
export type ResourceWallet = Record<CreditResourceKey, number>;

export type ResourceCreditResult = {
  wallet: ResourceWallet;
  accepted: ResourceWallet;
  burned: ResourceWallet;
};

function toNonNegativeFinite(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

function emptyWallet(): ResourceWallet {
  return { metal: 0, minerals: 0, gas: 0, energy: 0 };
}

/**
 * Applies a positive resource credit at the storage boundary.
 *
 * Stored resources are capped immediately, so a later spend cannot recover
 * credit that arrived while storage was full. Energy has no storage capacity.
 */
export function creditResources(
  wallet: CreditWalletInput,
  capacities: ResourceCapacitiesInput | undefined,
  credit: ResourceCreditInput,
): ResourceCreditResult {
  const nextWallet = emptyWallet();
  const accepted = emptyWallet();
  const burned = emptyWallet();

  for (const resource of CAPPED_RESOURCE_KEYS) {
    const capacity = toNonNegativeFinite(capacities?.[resource]);
    const current = Math.min(toNonNegativeFinite(wallet[resource]), capacity);
    const requested = toNonNegativeFinite(credit[resource]);
    const acceptedCredit = Math.min(requested, capacity - current);

    nextWallet[resource] = current + acceptedCredit;
    accepted[resource] = acceptedCredit;
    burned[resource] = requested - acceptedCredit;
  }

  const energyCredit = toNonNegativeFinite(credit.energy);
  const currentEnergy = toNonNegativeFinite(wallet.energy);
  const acceptedEnergy = Math.min(energyCredit, Number.MAX_VALUE - currentEnergy);
  nextWallet.energy = currentEnergy + acceptedEnergy;
  accepted.energy = acceptedEnergy;
  burned.energy = energyCredit - acceptedEnergy;

  return { wallet: nextWallet, accepted, burned };
}
