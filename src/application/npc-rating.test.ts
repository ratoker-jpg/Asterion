import assert from 'node:assert/strict';
import test from 'node:test';
import { createDefaultNewGameConfig } from '../domain/world/config.ts';
import { selectOwnerScore } from '../domain/rating/scoring.ts';
import type { FlightRecord } from '../domain/flights/types.ts';
import { createInitialSaveState } from './persistence.ts';
import type { SaveState } from './contracts.ts';

const START = Date.UTC(2026, 9, 20, 12);

test('an NPC fleet in flight still counts in the rating', () => {
  const base = createDefaultNewGameConfig({ seed: 'NPC-RATING-FLIGHT', factionId: 'aegis', playerName: 'Rating' });
  const state = createInitialSaveState('production', START, { ...base, world: { ...base.world, galaxyCount: 1, npcCount: 2 } });
  const target = Object.values(state.espionage!.targets!).find((item) => item.kind === 'npc')!;
  const before = selectOwnerScore(state, target.ownerId)!.totalPoints;
  // Autonomous NPC launches take the ships off the planet, as the replay does.
  const launched = { ...target.fleet.ships };
  const flight = {
    id: 'npc-flight-rating', requestId: 'npc-autonomy:rating', missionId: 'attack', ownerSide: 'npc', ownerId: target.ownerId,
    originPlanetId: target.id, phase: 'outbound', selectedShips: launched,
  } as unknown as FlightRecord;
  const away: SaveState = {
    ...state,
    flights: { ...state.flights, records: [...state.flights.records, flight] },
    espionage: { ...state.espionage!, targets: { ...state.espionage!.targets, [target.id]: {
      ...target, fleet: { ...target.fleet, ships: Object.fromEntries(Object.keys(launched).map((id) => [id, 0])) as typeof launched },
    } } },
  };
  assert.equal(selectOwnerScore(away, target.ownerId)!.totalPoints, before);
});
