import assert from 'node:assert/strict';
import test from 'node:test';

import { createAttackLaunchSnapshot } from './attack.ts';
import {
  createInitialSaveState,
  createPersistenceFacade,
  type StorageLike,
} from './persistence.ts';
import { getFactionCombatEntity } from '../domain/combat/faction-catalog.ts';
import { createFlightRecord } from '../domain/flights/runtime.ts';
import {
  migrateFleetProductionState,
  type FleetProductionOrder,
} from '../domain/fleet/production.ts';
import {
  createEmptyFleetState,
  resolveSavedFleetState,
} from '../domain/fleet/runtime.ts';
import { migrateRepairWorkshopState } from '../domain/repair/workshop.ts';

class MemoryStorage implements StorageLike {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

function queuedShip(
  id: string,
  itemId: 'cruiser' | 'defender',
  enqueuedAt: number,
  startedAt: number,
  effectiveDurationMs: number,
): FleetProductionOrder {
  return {
    id,
    queueKind: 'ships',
    itemId,
    quantity: 1,
    completedQuantity: 0,
    enqueuedAt,
    startedAt,
    finishAt: startedAt + effectiveDurationMs,
    effectiveDurationMs,
    cost: { metal: 2_900, minerals: 2_400, gas: 0 },
    refundEligible: true,
  };
}

test('old Veyra ship IDs survive save reload and resolve with the selected Veyra catalog mechanics', () => {
  const storage = new MemoryStorage();
  const now = 10_000;
  const persistence = createPersistenceFacade({ mode: 'production', storage, now: () => now });
  const initial = createInitialSaveState('production', now);
  const oldFleet = createEmptyFleetState();
  oldFleet.ships.cruiser = 2;
  oldFleet.ships.defender = 1;

  const cruiserOrder = queuedShip('old-cruiser-order', 'cruiser', 15_000, 20_000, 5_000_000);
  const defenderOrder = queuedShip('old-defender-order', 'defender', 16_000, 5_030_000, 5_000_000);
  const oldPlanet = initial.planets['helion-01'];
  const oldRepair = {
    ...oldPlanet.repair,
    ships: { ...oldPlanet.repair.ships, cruiser: 4, defender: 3 },
  };
  const oldSave = {
    ...initial,
    // This reflects the faction stored by an old Veyra save. The production
    // loader currently pins the active player profile to Aegis; see assertion below.
    profile: { ...initial.profile, factionId: 'veyra' as const },
    planets: {
      ...initial.planets,
      'helion-01': {
        ...oldPlanet,
        fleet: oldFleet,
        fleetProduction: {
          shipQueue: [cruiserOrder, defenderOrder],
          defenseQueue: [],
          commanderQueue: [],
        },
        repair: oldRepair,
      },
    },
  };
  const attackSnapshot = createAttackLaunchSnapshot(oldSave, 'helion-01', 8, {});
  const oldFlight = createFlightRecord({
    requestId: 'old-veyra-cruiser-attack',
    missionId: 'attack',
    originPlanetId: 'helion-01',
    originCoordinate: { galaxy: 1, system: 1, position: 1 },
    destination: {
      kind: 'planet',
      planetId: 'enemy-planet',
      coordinate: { galaxy: 1, system: 2, position: 1 },
    },
    destinationPlanetId: 'enemy-planet',
    destinationOwnerId: 'enemy-player',
    targetKind: 'player',
    targetRelation: 'enemy',
    selectedShips: { cruiser: 1, defender: 1 },
    populationReserved: 5,
    departedAt: 25_000,
    factionId: 'veyra',
    attackSnapshot,
  });
  const saveWithFlight = {
    ...oldSave,
    flights: {
      records: [oldFlight],
      requestIndex: { [oldFlight.requestId]: oldFlight.id },
    },
  };

  assert.deepEqual(persistence.write(saveWithFlight), { ok: true });
  const loaded = persistence.read();
  const loadedPlanet = loaded.planets['helion-01'];

  // The application persistence boundary preserves the stable ship keys and
  // saved queue/repair/flight records across JSON serialization and reload.
  assert.equal(loaded.planets['helion-01'].fleet.ships.cruiser, 2);
  assert.equal(loaded.planets['helion-01'].fleet.ships.defender, 1);
  assert.deepEqual(
    loadedPlanet.fleetProduction.shipQueue.map(({ itemId, effectiveDurationMs, enqueuedAt, startedAt }) => ({
      itemId,
      effectiveDurationMs,
      enqueuedAt,
      startedAt,
    })),
    [
      { itemId: 'cruiser', effectiveDurationMs: 5_000_000, enqueuedAt: 15_000, startedAt: 20_000 },
      { itemId: 'defender', effectiveDurationMs: 5_000_000, enqueuedAt: 16_000, startedAt: 5_030_000 },
    ],
  );
  assert.equal(loadedPlanet.repair.ships.cruiser, 4);
  assert.equal(loadedPlanet.repair.ships.defender, 3);
  assert.equal(loaded.profile.factionId, 'aegis');

  const loadedFlight = loaded.flights.records.find(({ id }) => id === oldFlight.id);
  assert.ok(loadedFlight, 'the in-flight record remains present after reload');
  assert.equal(loadedFlight.phase, 'outbound');
  assert.equal(loadedFlight.departedAt, oldFlight.departedAt);
  assert.deepEqual(loadedFlight.selectedShips, { cruiser: 1, defender: 1 });
  assert.deepEqual(loadedFlight.attackSnapshot, attackSnapshot);

  // Exercise the faction-aware domain migration explicitly: the persisted
  // player profile is currently pinned to Aegis, so this proves Veyra's stable
  // IDs at the Veyra migration boundary without claiming the profile survives.
  const veyraFleet = resolveSavedFleetState(oldFleet, 'veyra');
  assert.equal(veyraFleet.ships.cruiser, 2);
  assert.equal(veyraFleet.ships.defender, 1);
  const veyraProduction = migrateFleetProductionState({
    shipQueue: [cruiserOrder, defenderOrder],
    defenseQueue: [],
    commanderQueue: [],
  }, { factionId: 'veyra', fleet: veyraFleet, enforceCapacity: false });
  assert.deepEqual(
    veyraProduction.shipQueue.map(({ itemId, effectiveDurationMs, enqueuedAt, startedAt }) => ({
      itemId,
      effectiveDurationMs,
      enqueuedAt,
      startedAt,
    })),
    [
      { itemId: 'cruiser', effectiveDurationMs: 5_000_000, enqueuedAt: 15_000, startedAt: 20_000 },
      { itemId: 'defender', effectiveDurationMs: 5_000_000, enqueuedAt: 16_000, startedAt: 5_030_000 },
    ],
  );
  const veyraRepair = migrateRepairWorkshopState(oldRepair);
  assert.equal(veyraRepair.ships.cruiser, 4);
  assert.equal(veyraRepair.ships.defender, 3);

  const resolvedCruiser = getFactionCombatEntity('veyra', 'cruiser');
  const resolvedDefender = getFactionCombatEntity('veyra', 'defender');
  assert.equal(resolvedCruiser.name, 'Стрекоза');
  assert.equal(resolvedCruiser.population, 2);
  assert.equal(resolvedCruiser.combat.attack, 880);
  assert.equal(resolvedCruiser.combat.life, 2_600);
  assert.equal(resolvedDefender.name, 'Панцирник');
  assert.equal(resolvedDefender.population, 3);
  assert.equal(resolvedDefender.combat.attack, 1_380);
  assert.equal(resolvedDefender.combat.life, 4_100);
});
