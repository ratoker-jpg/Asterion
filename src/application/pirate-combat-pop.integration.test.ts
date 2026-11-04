import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialSaveState } from './persistence.ts';
import { resolveDuePirateRoll, selectDuePirateRolls } from './pirate-raids.ts';
import { getCurrentPirateContact } from './pirates.ts';
import { calculateCombatFleetPopulation, calculateFleetPopulation, createEmptyFleetState } from '../domain/fleet/runtime.ts';
import { calculateDefensePopulation, createEmptyDefenseState } from '../domain/fleet/production.ts';
import { getUniverseTimedObjectSchedule } from '../domain/universe/runtime.ts';
import { PIRATE_PROTECTION_TOTAL_POINTS, pirateSeededDraw } from '../domain/pirates/threat.ts';

// Owner rule 04.11.2026: the raid is a percentage of COMBAT population (defence + combat ships
// + commanders). Civil ships (transports, recyclers, colonizers, probes) and satellites do not count.
const PINNED_START_MS = Date.UTC(2026, 9, 21, 12);
type State = ReturnType<typeof createInitialSaveState>;
type Setup = Readonly<{ ships?: Record<string, number>; defense?: Record<string, number>; loot?: number; commanders?: Record<string, number> }>;

function fixture() {
  for (let index = 0; index < 200; index++) {
    const schedule = getUniverseTimedObjectSchedule('pirate', 1, 1, index);
    if (!schedule.present) continue;
    const candidate = createInitialSaveState('production', schedule.startAt);
    const now = schedule.startAt + 900_000;
    const contact = getCurrentPirateContact(candidate, { galaxy: 1, system: 1, position: 1 }, now, 'production');
    if (!contact) continue;
    if (pirateSeededDraw(`pirate-raid-v1:${candidate.profile.playerId}:${contact.contactCycleKey}`) >= 0.30) continue;
    return { schedule, candidate, now, cycleKey: contact.contactCycleKey };
  }
  throw new Error('no seeded raid cycle');
}

function launch(setup: Setup) {
  const { schedule, candidate, now, cycleKey } = fixture();
  const owner = candidate.profile.playerId;
  const planet = candidate.planets['helion-01']!;
  const fleet = createEmptyFleetState();
  Object.assign(fleet.ships, setup.ships ?? {});
  Object.assign(fleet.commanders, setup.commanders ?? {});
  const defense = createEmptyDefenseState();
  Object.assign(defense.defenses, setup.defense ?? {});
  // Single planet so the raid target is always helion-01.
  const state: State = {
    ...candidate,
    planets: { 'helion-01': { ...planet, fleet, defense, buildings: { ...planet.buildings, hangar: 10 },
      resources: { metal: setup.loot ?? 0, minerals: 0, gas: 0 } } },
    rating: { ...candidate.rating, battleAwardsByReportId: { 'qa-veteran-awards': { [owner]: PIRATE_PROTECTION_TOTAL_POINTS } } },
    pirate: { ...candidate.pirate!, raidProcessedAt: schedule.startAt,
      ownerThreats: { ...candidate.pirate!.ownerThreats, [owner]: { version: 1 as const, ageHours: 10_000, integratedAt: schedule.startAt } } },
  };
  const event = selectDuePirateRolls(state, schedule.startAt, now, 'production')
    .find((item) => item.contactCycleKey === cycleKey && item.ownerId === owner);
  assert.ok(event, 'raid roll due');
  const launched = resolveDuePirateRoll(state, event!, 'production');
  const flight = launched.flights.records.find((item) => item.missionId === 'pirate-raid');
  return { flight, defensePop: calculateDefensePopulation(defense, state.profile.factionId as 'aegis'),
    fleetPop: calculateFleetPopulation(fleet, state.profile.factionId as 'aegis'),
    combatPop: calculateCombatFleetPopulation(fleet, state.profile.factionId as 'aegis') };
}

// Owner's case: ~16 000 defence population, 12 000 population of civil ships, no combat fleet.
const DEFENSE_ONLY = { defense: { 'ion-turret': 1 } };

test('combat population ignores civil ships and satellites, counts combat hulls and commanders', () => {
  const fleet = createEmptyFleetState();
  Object.assign(fleet.ships, { recycler: 2_000, transporter: 2_000, 'mega-transporter': 10, colonizer: 5, 'spy-probe': 50, 'solar-satellite': 100 });
  assert.equal(calculateCombatFleetPopulation(fleet), 0);
  assert.ok(calculateFleetPopulation(fleet) > 12_000, 'all-ships population still counts civil hulls elsewhere');
  fleet.ships.cruiser = 10; // 7 each
  fleet.ships['death-star'] = 1; // 700
  fleet.commanders.corsair = 2; // 10 each
  assert.equal(calculateCombatFleetPopulation(fleet), 70 + 700 + 20);
});

test('civil-heavy planet gets the same raid as the same planet without civil ships', () => {
  const unit = calculateDefensePopulation({ ...createEmptyDefenseState(), defenses: { ...createEmptyDefenseState().defenses, 'ion-turret': 1 } }, 'aegis');
  const count = Math.round(16_000 / unit);
  const defense = { 'ion-turret': count };
  const bare = launch({ defense });
  const heavy = launch({ defense, ships: { recycler: 2_000, transporter: 2_000 } });
  assert.ok(bare.flight && heavy.flight, 'both planets are raided');
  assert.ok(bare.defensePop > 15_000 && bare.defensePop < 17_000, `defence ~16 000 (${bare.defensePop})`);
  assert.equal(heavy.fleetPop, 12_000);
  assert.equal(heavy.combatPop, 0);
  assert.equal(heavy.flight!.populationReserved, bare.flight!.populationReserved);
  // 90–95 % of 16 000 defence, not of 28 000 as before.
  assert.ok(bare.flight!.populationReserved! <= Math.ceil(bare.defensePop * 0.95));
  assert.ok(bare.flight!.populationReserved! >= Math.floor(bare.defensePop * 0.90) - 30);
});

test('combat ships and defence both still count', () => {
  const base = launch({ defense: { 'ion-turret': 400 } });
  const withFleet = launch({ defense: { 'ion-turret': 400 }, ships: { destroyer: 300, cruiser: 100 } });
  assert.ok(withFleet.flight!.populationReserved! > base.flight!.populationReserved! + 8_000, 'combat ships add to the raid');
  assert.ok(withFleet.flight!.populationReserved! <= Math.ceil((withFleet.defensePop + withFleet.combatPop) * 0.95));
});

test('mixed planet: only the combat share drives the raid', () => {
  const mixed = launch({ defense: { 'ion-turret': 400 }, ships: { destroyer: 300, recycler: 3_000, transporter: 3_000 } });
  const pure = launch({ defense: { 'ion-turret': 400 }, ships: { destroyer: 300 } });
  assert.equal(mixed.flight!.populationReserved, pure.flight!.populationReserved);
});

test('zero-combat planet: the existing near-empty rule applies (cargo-sized raid or none), civil ships do not raise it', () => {
  const none = launch({});
  const civil = launch({ ships: { recycler: 4_000, transporter: 4_000 } });
  assert.equal(civil.flight?.populationReserved, none.flight?.populationReserved);
  assert.equal(none.flight, undefined, 'no combat population and no loot: nothing to raid with');
});

test('zero-combat planet with loot: raid is sized to carry the loot (cargo floor, capped by hangar), civil ships change nothing', () => {
  const rich = launch({ loot: 400_000 });
  const richCivil = launch({ loot: 400_000, ships: { recycler: 4_000, transporter: 4_000 } });
  assert.ok(rich.flight, 'a rich planet with no combat population is still raided by a small cargo raid');
  // The pirate mix follows the owner's score, so whole-ship rounding may differ by a hull or two.
  assert.ok(Math.abs(richCivil.flight!.populationReserved! - rich.flight!.populationReserved!) <= 20);
  assert.ok(rich.flight!.populationReserved! < 2_000, 'far smaller than a raid sized off civil ships');
});
