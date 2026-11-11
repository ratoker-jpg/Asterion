import assert from 'node:assert/strict';
import test from 'node:test';

import { createDefaultNewGameConfig } from '../domain/world/config.ts';
import { getUniverseTimedObjectSchedule } from '../domain/universe/runtime.ts';
import { selectOwnerScores, selectOwnerScoresCached } from '../domain/rating/scoring.ts';
import { getRuntimeStateSnapshot } from '../domain/runtime/state-store.ts';
import { formatHeaderNumber } from '../ui/header/format-number.ts';
import type { FlightRecord } from '../domain/flights/types.ts';
import type { SaveState } from './contracts.ts';
import { createInitialSaveState } from './persistence.ts';
import { publishApplicationRuntimeSnapshot, selectRatedAlliances, selectRatedOwners } from './runtime.ts';
import { getCurrentPirateContact } from './pirates.ts';
import { reconBlockInputs, reconLaunchPreview, selectPirateContacts } from './pirate-presentation.ts';
import { ownerOutboundHostileFlights } from './shield.ts';
import { diffPlayerActions } from './player-journal.ts';
import { createRefMemo, slowBucket } from './ref-memo.ts';

const START = Date.UTC(2026, 9, 23, 12);

function world(): SaveState {
  const base = createDefaultNewGameConfig({ seed: 'perf-selectors', factionId: 'aegis', playerName: 'Perf QA' });
  return createInitialSaveState('production', START, { ...base, world: { ...base.world, npcCount: 6 } });
}

test('cached owner scores equal selectOwnerScores and are reused for the same world only', () => {
  const state = world();
  const fresh = selectOwnerScores(state);
  const cached = selectOwnerScoresCached(state);
  assert.deepEqual(cached, fresh);
  assert.equal(selectOwnerScoresCached(state), cached);
  const next = { ...state, profile: { ...state.profile } };
  assert.notEqual(selectOwnerScoresCached(next), cached);
  assert.deepEqual(selectOwnerScoresCached(next), selectOwnerScores(next));
});

test('the published snapshot reads the same scores, owners and alliances as the selectors, lazily', () => {
  const state = world();
  const target = new EventTarget();
  publishApplicationRuntimeSnapshot(state, { planetId: state.currentPlanetId, now: START, mode: 'production', testTimeScale: 1 }, target);
  const snapshot = getRuntimeStateSnapshot();
  assert.ok(snapshot);
  assert.deepEqual(snapshot.ownerScores, selectOwnerScores(state));
  assert.deepEqual(snapshot.owners, selectRatedOwners(state));
  assert.deepEqual(snapshot.alliances, selectRatedAlliances(state));
  assert.equal(snapshot.ownerScores, snapshot.ownerScores, 'one object per world, so the rating screen props stay stable');
  assert.equal(snapshot.currentPlayerId, state.profile.playerId);
});

function hostile(id: string, overrides: Partial<FlightRecord>): FlightRecord {
  return { id, missionId: 'attack', phase: 'outbound', arrivalAt: START + 60_000, ...overrides } as unknown as FlightRecord;
}

test('outbound hostile flights match the plain filter for every time and owner', () => {
  const state = world();
  const playerId = state.profile.playerId;
  const records = [
    hostile('a', {}),
    hostile('b', { ownerSide: 'player' }),
    hostile('c', { ownerSide: 'npc', ownerId: 'npc-1' } as Partial<FlightRecord>),
    hostile('d', { phase: 'returning' }),
    hostile('e', { missionId: 'transport' }),
    hostile('f', { missionId: 'sun-attack', phase: 'arrived', arrivalAt: START - 1 }),
    hostile('g', { arrivalAt: START - 5 }),
    hostile('h', { missionId: 'pirate-elimination', ownerSide: 'player' }),
  ];
  const withFlights = { ...state, flights: { ...state.flights, records } };
  const plain = (owner: string, at: number) => records.filter((flight) => {
    if (!['attack', 'sun-support', 'sun-attack', 'pirate-elimination'].includes(flight.missionId)) return false;
    const flightOwner = flight.ownerSide === 'npc' ? (flight as unknown as { ownerId: string }).ownerId
      : flight.ownerSide === 'player' || flight.ownerSide === undefined ? playerId : undefined;
    if (flightOwner !== owner) return false;
    if (flight.missionId === 'sun-support' || flight.missionId === 'sun-attack') return flight.phase === 'outbound' || flight.phase === 'arrived';
    return flight.phase === 'outbound' && flight.arrivalAt > at;
  });
  for (const owner of [playerId, 'npc-1', 'nobody']) {
    for (const at of [START - 10, START, START + 59_999, START + 60_000, START + 120_000]) {
      assert.deepEqual(ownerOutboundHostileFlights(withFlights, owner, at).map((flight) => flight.id), plain(owner, at).map((flight) => flight.id), `${owner} @${at}`);
    }
  }
  // A new flights array is read afresh, and another player id does not reuse the old answer.
  const added = { ...withFlights, flights: { ...withFlights.flights, records: [...records, hostile('i', {})] } };
  assert.ok(ownerOutboundHostileFlights(added, playerId, START).some((flight) => flight.id === 'i'));
  const renamed = { ...withFlights, profile: { ...withFlights.profile, playerId: 'someone-else' } };
  assert.deepEqual(ownerOutboundHostileFlights(renamed, playerId, START), []);
});

test('the journal diff is empty for the same sections and unchanged for a real change', () => {
  const before = world();
  const same = { ...before, rating: { ...before.rating }, espionage: { ...before.espionage! } };
  assert.deepEqual(diffPlayerActions(before, same, START), []);
  const planetId = Object.keys(before.planets)[0]!;
  const after = { ...before, queues: { ...before.queues, [planetId]: [{ id: 'q-new', assetRole: 'metal-mine', targetLevel: 2, cost: { metal: 1, minerals: 1, gas: 0 }, durationMs: 1_000 } as never] } };
  const entries = diffPlayerActions(before, after, START);
  assert.equal(entries.length, 1);
  assert.equal(entries[0]!.k, 'build');
  const newAlliance = { ...before, command: { ...before.command, alliances: [...before.command.alliances] } };
  assert.deepEqual(diffPlayerActions(before, newAlliance, START), []);
});

function pirateFixture() {
  for (let system = 2; system < 40; system += 1) {
    for (let cycleIndex = 0; cycleIndex < 80; cycleIndex += 1) {
      const schedule = getUniverseTimedObjectSchedule('pirate', 1, system, cycleIndex);
      if (!schedule.present) continue;
      const now = schedule.startAt + 1;
      const state = createInitialSaveState('production', now);
      const contact = getCurrentPirateContact(state, { galaxy: 1, system, position: 1 }, now, 'production');
      if (contact) return { state, contact, now, system };
    }
  }
  throw new Error('no deterministic pirate contact');
}

test('recon availability from the cache equals the dry-run dispatch, and refreshes when its inputs change', () => {
  const { state, contact, now, system } = pirateFixture();
  const present = (s: SaveState, at: number) => selectPirateContacts(s, at, { galaxy: 1, system }).find((item) => item.contactCycleKey === contact.contactCycleKey)!;
  const expected = (s: SaveState, at: number) => {
    const preview = reconLaunchPreview(s, contact, at);
    return preview.ok ? null : preview.error.message;
  };
  const viewed = present(state, now);
  const reason = expected(state, now);
  assert.equal(viewed.recon.enabled, reason === null);
  if (reason) assert.equal(viewed.recon.disabledReason, reason);

  // Sections the answer does not read are replaced every second: still the answer of the dry run.
  const churn = { ...state, espionage: { ...state.espionage! }, npc: { ...state.npc! }, asteroidSimulation: state.asteroidSimulation ? { ...state.asteroidSimulation } : state.asteroidSimulation, rating: { ...state.rating } };
  assert.deepEqual(reconBlockInputs(churn, now), reconBlockInputs(state, now));
  assert.equal(present(churn, now + 1_000).recon.disabledReason, expected(churn, now + 1_000));

  // Fleet changes on the planets show at once.
  const homeId = state.currentPlanetId;
  const home = state.planets[homeId]!;
  const noProbe = { ...state, planets: { ...state.planets, [homeId]: { ...home, fleet: { ...home.fleet, ships: { ...home.fleet.ships, 'spy-probe': 0 } } } } };
  assert.notDeepEqual(reconBlockInputs(noProbe, now), reconBlockInputs(state, now));
  assert.equal(present(noProbe, now).recon.disabledReason, expected(noProbe, now));
  assert.equal(present(noProbe, now).recon.enabled, false);
  const restored = { ...noProbe, planets: { ...noProbe.planets, [homeId]: { ...home, fleet: { ...home.fleet, ships: { ...home.fleet.ships, 'spy-probe': 3 } } } } };
  assert.equal(present(restored, now).recon.disabledReason, expected(restored, now));

  // The bucket moves on every 5 s.
  assert.equal(slowBucket(now), slowBucket(now + 1));
  assert.notEqual(slowBucket(5_000), slowBucket(10_000));
});

test('ref memo recomputes only when an input object is replaced', () => {
  const memo = createRefMemo<number>();
  const a = {}; const b = {};
  let calls = 0;
  const compute = () => { calls += 1; return calls; };
  assert.equal(memo([a, b], compute), 1);
  assert.equal(memo([a, b], compute), 1);
  assert.equal(memo([a, {}], compute), 2);
  assert.equal(calls, 2);
});

test('header numbers format as before with the shared formatters', () => {
  const old = (value: number) => {
    const plain = (v: number) => new Intl.NumberFormat('ru-RU').format(v);
    const short = (divider: number, unit: string) => `${(value / divider).toLocaleString('ru-RU', { maximumFractionDigits: value / divider >= 100 ? 0 : 2 })} ${unit}`;
    if (Math.abs(value) >= 1e12) return short(1e12, 'трлн');
    if (Math.abs(value) >= 1e9) return short(1e9, 'млрд');
    return plain(value);
  };
  for (const value of [0, 7, 999_999, 1_234_567, 999_999_999, 1_250_000_000, 123_456_789_012, 1_234_567_890_123, 250e12, -4_500_000_000, 12.5]) {
    assert.equal(formatHeaderNumber(value), old(value), String(value));
  }
});
