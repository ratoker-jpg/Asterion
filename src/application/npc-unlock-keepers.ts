import type { CombatFactionId } from '../domain/combat/factions.ts';
import { getFactionShipCatalog } from '../domain/combat/faction-catalog.ts';
import { getFleetProductionEntity } from '../domain/fleet/production.ts';
import { evaluateProductionRequirements } from '../domain/fleet/requirements.ts';

/**
 * Hulls a planet must hold for its race to build others (race balance
 * 31.10.2026): the Swarm builds a «Стрекоза» only with one «Жало» on the
 * planet, a «Скарабей» with three, a «Шмель» or «Спороносец» only with a
 * «Стрекоза» there. Bots used to send these out with every attack and rarely
 * built «Жало» at all (the cheapest, weakest hull), so the Swarm's stronger
 * hulls were blocked. The owner keeps them at home and builds them when short.
 * Read from the race catalog's own requirements; other races keep only what
 * their requirements name (a transporter for a mega-transporter, and so on).
 */
const keepersByRace = new Map<string, Readonly<Record<string, number>>>();

export function npcUnlockKeepers(raceId: string): Readonly<Record<string, number>> {
  let keepers = keepersByRace.get(raceId);
  if (keepers) return keepers;
  const found: Record<string, number> = {};
  const sciences = Object.fromEntries(Array.from({ length: 40 }, (_, index) => [index + 1, 99]));
  for (const ship of getFactionShipCatalog(raceId as CombatFactionId)) {
    const entity = getFleetProductionEntity('ships', ship.id, raceId as CombatFactionId);
    if (!entity) continue;
    const evaluation = evaluateProductionRequirements(entity, { scienceLevels: sciences as never, shipyardLevel: 99, hangarLevel: 99,
      advancedFactoryLevel: 99, factionId: raceId as CombatFactionId, fleet: { ships: {}, commanders: {} } });
    for (const missing of evaluation.missing) {
      // Probes are spent on espionage; the flagship's twenty are the flagship doctrine's concern.
      if (missing.kind !== 'ship-quantity' || !missing.shipId || missing.shipId === 'spy-probe') continue;
      found[missing.shipId] = Math.max(found[missing.shipId] ?? 0, missing.requiredQuantity ?? 1);
    }
  }
  keepers = Object.freeze(found);
  keepersByRace.set(raceId, keepers);
  return keepers;
}

/** How many of `shipId` a planet of `raceId` holding `ships` still lacks to unlock its race's hulls. */
export function npcUnlockShortfall(raceId: string, ships: Readonly<Partial<Record<string, number>>>, shipId: string): number {
  const wanted = npcUnlockKeepers(raceId)[shipId] ?? 0;
  return Math.max(0, wanted - Math.max(0, ships[shipId] ?? 0));
}
