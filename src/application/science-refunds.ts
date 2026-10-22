import { getStorageCapacities } from '../domain/buildings/resource-zone.ts';
import { creditResources } from '../domain/resources/credit.ts';
import type { ScienceTaskRefund } from '../domain/science/runtime.ts';
import { getPlanetResources, replacePlanetResources, type PlanetId, type SaveState } from './contracts.ts';

type Amounts = { metal: number; minerals: number; gas: number };

/** What one paying planet actually received from a science refund. */
export type SciencePayerCredit = {
  planetId: PlanetId;
  /** The payer no longer exists (destroyed): its refund is lost, never sent elsewhere. */
  payerMissing: boolean;
  nominal: Amounts;
  accepted: Amounts;
  burned: Amounts;
};

const zero = (): Amounts => ({ metal: 0, minerals: 0, gas: 0 });

/**
 * Credits each canceled task's refund to the planet that paid it, against that
 * planet's own storage caps (overflow burns). A task without a saved payer
 * (pre-origin saves) keeps the old behaviour and credits `fallbackPlanetId`.
 * Science never refunds energy.
 */
export function creditScienceRefundsToPayers(
  state: SaveState,
  taskRefunds: readonly ScienceTaskRefund[],
  fallbackPlanetId: PlanetId,
): { state: SaveState; credits: SciencePayerCredit[] } {
  const byPayer = new Map<PlanetId, Amounts>();
  for (const { task, refund } of taskRefunds) {
    const payer = task.planetId ?? fallbackPlanetId;
    const total = byPayer.get(payer) ?? zero();
    byPayer.set(payer, { metal: total.metal + refund.metal, minerals: total.minerals + refund.minerals, gas: total.gas + refund.gas });
  }
  let next = state;
  const credits: SciencePayerCredit[] = [];
  for (const [planetId, nominal] of byPayer) {
    const planet = next.planets[planetId];
    if (!planet) {
      credits.push({ planetId, payerMissing: true, nominal, accepted: zero(), burned: { ...nominal } });
      continue;
    }
    const wallet = getPlanetResources(next, planetId);
    const credit = creditResources({ ...wallet, energy: 0 }, getStorageCapacities(planet.buildings), { ...nominal, energy: 0 });
    next = replacePlanetResources(next, planetId, { metal: credit.wallet.metal, minerals: credit.wallet.minerals, gas: credit.wallet.gas });
    credits.push({
      planetId,
      payerMissing: false,
      nominal,
      accepted: { metal: credit.accepted.metal, minerals: credit.accepted.minerals, gas: credit.accepted.gas },
      burned: { metal: credit.burned.metal, minerals: credit.burned.minerals, gas: credit.burned.gas },
    });
  }
  return { state: next, credits };
}
