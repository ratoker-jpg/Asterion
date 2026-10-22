import assert from 'node:assert/strict';
import test from 'node:test';

import { createInitialSaveState, createPersistenceFacade, type StorageLike } from './persistence.ts';
import { reconcileFlights, startBot01IncomingScenario } from './flights.ts';
import { resolveBot01IncomingAttack } from './attack.ts';
import { resolveDuePirateRoll, selectDuePirateRolls } from './pirate-raids.ts';
import { getCurrentPirateContact } from './pirates.ts';
import { getPlanetEnergyLedger } from './energy.ts';
import { createEmptyFleetState } from '../domain/fleet/runtime.ts';
import { getUniverseTimedObjectSchedule } from '../domain/universe/runtime.ts';
import { pirateSeededDraw } from '../domain/pirates/threat.ts';
import { selectOwnerScores } from '../domain/rating/scoring.ts';
import { SOLAR_SATELLITE_ID } from '../domain/combat/ids.ts';
import type { PlanetRuntime, SaveState } from './contracts.ts';
import type { BattleReport } from '../domain/combat/report.ts';

const SATELLITES = 400;

function memoryStorage(): StorageLike {
  const data = new Map<string, string>();
  return { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); }, removeItem: (key) => { data.delete(key); } };
}

/** An orbit of satellites only: no ships, no defenses, so every loss is a satellite. */
function satelliteOnlyPlanet(planet: PlanetRuntime): PlanetRuntime {
  return {
    ...planet,
    fleet: createEmptyFleetState(),
    defense: { defenses: Object.fromEntries(Object.keys(planet.defense.defenses).map((id) => [id, 0])) as typeof planet.defense.defenses },
    solarSatellites: SATELLITES,
    buildings: { ...planet.buildings, hangar: Math.max(planet.buildings.hangar ?? 0, 12) },
  };
}

function satelliteStack(report: BattleReport) {
  return report.defenderForce.stacks.find((stack) => stack.entityId === SOLAR_SATELLITE_ID);
}

function assertSatelliteLossesApplied(before: SaveState, after: SaveState, planetId: string, report: BattleReport) {
  const stack = satelliteStack(report);
  assert.ok(stack, 'satellites stand in the defending force');
  assert.equal(stack.countBefore, SATELLITES);
  assert.ok(report.attackerForce.stacks.every((attacker) => attacker.entityId !== SOLAR_SATELLITE_ID), 'never on the attacking side');
  assert.ok(stack.destroyed > 0, 'the seeded battle destroys satellites');
  const planet = after.planets[planetId]!;
  assert.equal(planet.solarSatellites, SATELLITES - stack.destroyed);
  assert.ok((planet.solarSatellites ?? 0) >= 0);
  // Energy from the orbit shrinks with it.
  const energyBefore = getPlanetEnergyLedger(before.planets[planetId]!, before.science.levels).producedEnergy;
  const energyAfter = getPlanetEnergyLedger(planet, after.science.levels).producedEnergy;
  assert.ok(energyAfter < energyBefore, `produced energy ${energyBefore} -> ${energyAfter}`);
  // Scrap includes destroyed satellites (ships, satellites included, leave debris).
  assert.ok((report.debris ?? 0) > 0);
  // Resource points follow the smaller orbit (3 points per satellite).
  const playerId = before.profile.playerId;
  assert.ok(selectOwnerScores(after)[playerId]!.resourcePoints < selectOwnerScores(before)[playerId]!.resourcePoints);
}

function assertPersistsAndNeverReapplies(after: SaveState, planetId: string, replay: (state: SaveState) => SaveState) {
  const storage = memoryStorage();
  const facade = createPersistenceFacade({ mode: 'test', storage, saveKey: 'asterion.test.satellites.v1' });
  assert.equal(facade.write(after).ok, true);
  const reloaded = facade.read();
  assert.equal(reloaded.planets[planetId]!.solarSatellites, after.planets[planetId]!.solarSatellites, 'save/load keeps the losses');
  const replayed = replay(reloaded);
  assert.equal(replayed.planets[planetId]!.solarSatellites, after.planets[planetId]!.solarSatellites, 'a replayed report applies nothing twice');
}

test('SAT-01: satellites defend against a Bot 01 attack, can be destroyed, and the losses persist', () => {
  const launched = startBot01IncomingScenario(createInitialSaveState('test', 1_000), { now: 1_000, mode: 'test', testTimeScale: 1 });
  assert.equal(launched.ok, true);
  if (!launched.ok) return;
  const planetId = launched.flight.destinationPlanetId!;
  const before = { ...launched.state, planets: { ...launched.state.planets, [planetId]: satelliteOnlyPlanet(launched.state.planets[planetId]!) } };

  const result = resolveBot01IncomingAttack(before, launched.flight, launched.flight.arrivalAt);
  assert.ok(result);
  assert.equal(result.resolution.planetDestroyed, false, 'the seeded siege leaves the planet standing');
  assertSatelliteLossesApplied(before, result.state, planetId, result.report);
  assertPersistsAndNeverReapplies(result.state, planetId, (state) => resolveBot01IncomingAttack(state, launched.flight, launched.flight.arrivalAt)!.state);
});

test('SAT-01: satellites defend against a pirate raid on the player planet (owner rule) and the losses persist', () => {
  let verified = false;
  for (let index = 0; index < 160 && !verified; index++) {
    const cycle = getUniverseTimedObjectSchedule('pirate', 1, 1, index);
    if (!cycle.present) continue;
    const baseline = createInitialSaveState('test', cycle.startAt);
    const seeded: SaveState = {
      ...baseline,
      planets: { ...baseline.planets, 'helion-01': satelliteOnlyPlanet(baseline.planets['helion-01']!) },
      pirate: {
        ...baseline.pirate!,
        raidProcessedAt: cycle.startAt,
        ownerThreats: { ...baseline.pirate!.ownerThreats, [baseline.profile.playerId]: { version: 1 as const, ageHours: 10_000, integratedAt: cycle.startAt } },
        ownerMaxHangarLevel: { ...baseline.pirate!.ownerMaxHangarLevel, [baseline.profile.playerId]: 12 },
      },
    };
    const at = cycle.startAt + 900_000;
    const contact = getCurrentPirateContact(seeded, { galaxy: 1, system: 1, position: 1 }, at, 'test');
    if (!contact || pirateSeededDraw(`pirate-raid-v1:${baseline.profile.playerId}:${contact.contactCycleKey}`) >= 0.30) continue;
    const event = selectDuePirateRolls(seeded, cycle.startAt, at, 'test', 1)
      .find((roll) => roll.ownerId === baseline.profile.playerId && roll.contactCycleKey === contact.contactCycleKey);
    if (!event) continue;
    const launched = resolveDuePirateRoll(seeded, event, 'test', 1);
    const flight = launched.flights.records.find((record) => record.ownerSide === 'pirate' && record.missionId === 'pirate-raid' && record.destinationPlanetId === 'helion-01');
    if (!flight) continue;
    const completed = reconcileFlights(launched, flight.arrivalAt, undefined, { mode: 'test', testTimeScale: 1 });
    const report = completed.state.combat.reports.find((record) => record.id === `battle-pirate-raid-${flight.id}`);
    if (!report || !(satelliteStack(report)?.destroyed)) continue;
    assertSatelliteLossesApplied(launched, completed.state, 'helion-01', report);
    assertPersistsAndNeverReapplies(completed.state, 'helion-01', (state) => reconcileFlights(state, flight.arrivalAt + 1, undefined, { mode: 'test', testTimeScale: 1 }).state);
    verified = true;
  }
  assert.equal(verified, true, 'a seeded raid that destroys satellites was found and verified');
});

test('SAT-01: a planet without satellites fights exactly as before (no empty satellite stack)', () => {
  const initial = createInitialSaveState('test', 1_000);
  const launched = startBot01IncomingScenario(initial, { now: 1_000, mode: 'test', testTimeScale: 1 });
  assert.equal(launched.ok, true);
  if (!launched.ok) return;
  const planetId = launched.flight.destinationPlanetId!;
  const state = { ...launched.state, planets: { ...launched.state.planets, [planetId]: { ...launched.state.planets[planetId]!, solarSatellites: 0 } } };
  const result = resolveBot01IncomingAttack(state, launched.flight, launched.flight.arrivalAt);
  assert.ok(result);
  assert.equal(satelliteStack(result.report), undefined);
});
