import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { createInitialSaveState } from '../src/application/persistence.ts';
import { selectDuePirateRolls, resolveDuePirateRoll } from '../src/application/pirate-raids.ts';
import { getPirateContactCyclesBetween } from '../src/domain/universe/runtime.ts';
import { createEmptyFleetState } from '../src/domain/fleet/runtime.ts';

// Synthetic regression input through the real raid generator; never a user save.
const output = process.argv[2];
assert.ok(output, 'Output JSON path required');
const now = Date.now();
let fixture;
for (const cycle of [...getPirateContactCyclesBetween(1, 1, now - 7 * 86_400_000, now, [], 900_000)].reverse()) {
  const state = createInitialSaveState('test', cycle.startAt);
  const home = state.planets['helion-01'];
  home.buildings.hangar = 20;
  home.fleet = createEmptyFleetState();
  home.fleet.ships.scout = 12_500;
  home.defense.defenses['ballistic-turret'] = 12_500;
  state.pirate = { ...state.pirate,
    ownerThreats: { ...state.pirate.ownerThreats,
      [state.profile.playerId]: { version: 1, ageHours: 10_000, integratedAt: cycle.startAt } },
    ownerMaxHangarLevel: { ...state.pirate.ownerMaxHangarLevel, [state.profile.playerId]: 20 },
  };
  const at = cycle.startAt + 900_000;
  const event = selectDuePirateRolls(state, cycle.startAt, at, 'test', 1)
    .find((entry) => entry.ownerId === state.profile.playerId);
  if (!event) continue;
  const launched = resolveDuePirateRoll(state, event, 'test', 1);
  const raid = launched.flights.records.find((entry) => entry.missionId === 'pirate-raid');
  if (!raid || raid.populationReserved <= 35_000 || raid.arrivalAt > now) continue;
  // Isolate the already due historical raid from future automatic checks.
  launched.pirate = { ...launched.pirate, raidProcessedAt: now };
  launched.exploration = { ...launched.exploration, npcProcessedAt: now };
  fixture = launched;
  console.log(JSON.stringify({ population: raid.populationReserved, flightId: raid.id, arrivalAt: raid.arrivalAt }));
  break;
}
assert.ok(fixture, 'A recent generated raid over 35,000 population must exist');
await writeFile(output, JSON.stringify(fixture));
