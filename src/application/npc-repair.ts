import { migrateBuildingLevels } from '../domain/buildings/resource-zone.ts';
import { SOLAR_SATELLITE_ID } from '../domain/combat/ids.ts';
import { getFactionDefenseCatalog, getFactionShipCatalog } from '../domain/combat/faction-catalog.ts';
import type { SpyTargetState } from '../domain/espionage/types.ts';
import { createDefaultFleetProductionState } from '../domain/fleet/production.ts';
import { getSolarSatelliteFleetCount, removeSolarSatellitesFromFleet } from '../domain/fleet/runtime.ts';
import {
  createDefaultRepairWorkshopState, repairForResources, type RepairCategory, type RepairTransitionContext,
} from '../domain/repair/workshop.ts';
import { isNpcPlanetBlocked } from './npc-economy.ts';
import { syncSpyTargetCommanderCounts } from '../domain/espionage/runtime.ts';

/**
 * The repair workshop for NPCs (owner request 27.10.2026). Ships and turrets
 * the planet lost while defending wait in the workshop; the owner restores
 * them by the player's rules: the same prices, paid from the planet's stores,
 * only within the hangar and defence room, and not during overpopulation.
 * Repair is immediate, as the player's: an owner that is at the game between
 * two attacks meets the second one with its fleet restored.
 *
 * Balance parameter (the owner may change it):
 */
export const NPC_REPAIR_BALANCE = {
  /** Without a visible attack the owner spends at most this share of each store on repairs in one go. */
  calmSpendShare: 0.5,
} as const;

function contextOf(target: SpyTargetState): RepairTransitionContext {
  return {
    repair: target.repair ?? createDefaultRepairWorkshopState(),
    fleet: removeSolarSatellitesFromFleet(target.fleet).fleet,
    defense: target.defense,
    fleetProduction: target.fleetProduction ?? createDefaultFleetProductionState(),
    wallet: { metal: target.resources.metal, minerals: target.resources.minerals, gas: target.resources.gas },
    factionId: target.raceId,
    hangarLevel: migrateBuildingLevels(target.buildings).hangar ?? 0,
    solarSatellites: Math.max(Math.max(0, Math.floor(target.solarSatellites ?? 0)), getSolarSatelliteFleetCount(target.fleet)),
  };
}

/** Units waiting in the workshop at their catalog price: what a repair can bring back. */
export function npcRepairPoolValue(target: SpyTargetState): number {
  const repair = target.repair;
  if (!repair) return 0;
  const price = (cost: { metal?: number; minerals?: number; gas?: number } | undefined) => (cost?.metal ?? 0) + (cost?.minerals ?? 0) + (cost?.gas ?? 0);
  const ships = getFactionShipCatalog(target.raceId).reduce((sum, entity) => sum + (repair.ships[entity.id as keyof typeof repair.ships] ?? 0) * price(entity.cost), 0);
  const defenses = getFactionDefenseCatalog(target.raceId).reduce((sum, entity) => sum + (repair.defenses[entity.id as keyof typeof repair.defenses] ?? 0) * price(entity.cost), 0);
  return ships + defenses;
}

/**
 * Repairs as much as the planet can: warships first (the dearest first), then
 * turrets; each order is the largest count that fits the room and the money
 * set aside (`spendShare` of each store). Returns the planet unchanged when
 * nothing can be repaired.
 */
export function repairNpcPlanet(target: SpyTargetState, spendShare = 1): { target: SpyTargetState; repaired: number } {
  const pool = target.repair;
  if (!pool || isNpcPlanetBlocked(target)) return { target, repaired: 0 };
  const context = contextOf(target);
  const reserve = {
    metal: Math.floor(context.wallet.metal * (1 - spendShare)),
    minerals: Math.floor(context.wallet.minerals * (1 - spendShare)),
    gas: Math.floor(context.wallet.gas * (1 - spendShare)),
  };
  let current: RepairTransitionContext = { ...context, wallet: {
    metal: context.wallet.metal - reserve.metal, minerals: context.wallet.minerals - reserve.minerals, gas: context.wallet.gas - reserve.gas } };
  let repaired = 0;
  const price = (cost: { metal?: number; minerals?: number; gas?: number } | undefined) => (cost?.metal ?? 0) + (cost?.minerals ?? 0) + (cost?.gas ?? 0);
  const order: { category: RepairCategory; id: string }[] = [
    ...getFactionShipCatalog(target.raceId).filter((entity) => entity.id !== SOLAR_SATELLITE_ID)
      .sort((left, right) => price(right.cost) - price(left.cost) || (left.id < right.id ? -1 : 1))
      .map((entity) => ({ category: 'ship' as const, id: entity.id })),
    ...[...getFactionDefenseCatalog(target.raceId)]
      .sort((left, right) => price(right.cost) - price(left.cost) || (left.id < right.id ? -1 : 1))
      .map((entity) => ({ category: 'defense' as const, id: entity.id })),
  ];
  for (const { category, id } of order) {
    let quantity = category === 'ship' ? current.repair.ships[id as keyof typeof current.repair.ships] ?? 0 : current.repair.defenses[id as keyof typeof current.repair.defenses] ?? 0;
    while (quantity > 0) {
      const transition = repairForResources(current, category, id, quantity);
      if (transition.ok) {
        current = { ...current, repair: transition.repair, fleet: transition.fleet, defense: transition.defense, wallet: transition.wallet };
        repaired += quantity;
        break;
      }
      quantity = Math.floor(quantity / 2);
    }
  }
  if (!repaired) return { target, repaired: 0 };
  // Satellites stay where the planet keeps them; the workshop never restores them here.
  const fleet = { ...current.fleet, ships: { ...current.fleet.ships, [SOLAR_SATELLITE_ID]: target.fleet.ships[SOLAR_SATELLITE_ID] ?? 0 } };
  const restored: SpyTargetState = {
    ...syncSpyTargetCommanderCounts(target, fleet, target.ownerProfile),
    defense: current.defense,
    repair: current.repair,
    resources: {
      ...target.resources,
      metal: current.wallet.metal + reserve.metal,
      minerals: current.wallet.minerals + reserve.minerals,
      gas: current.wallet.gas + reserve.gas,
    },
  };
  return { target: restored, repaired };
}
