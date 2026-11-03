import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialSaveState } from './persistence.ts';
import { dispatchFlight, reconcileFlights } from './flights.ts';
import { replacePlanetState, replacePlanetResources, getPlanetResources } from './contracts.ts';
import type { SaveState } from './contracts.ts';
import { selectExplorationTargets } from './exploration.ts';
import { explorationMailboxReports } from '../domain/exploration/report-items.ts';
import { getEspionageTargets } from '../domain/espionage/runtime.ts';

const MINUTE = 60_000;
const baseTime = 1_790_000_000_000;
const OPTIONS = { mode: 'test' as const, testTimeScale: 15 as const };

function fixture(occupantLevel: number, observerLevel: number) {
  let state = createInitialSaveState('test', baseTime);
  const planet = state.planets['helion-01'];
  state = replacePlanetState(state, 'helion-01', {
    ...planet, fleet: { ...planet.fleet, ships: { ...planet.fleet.ships, transporter: 10, recycler: 10, 'spy-probe': 40 } },
  });
  state = replacePlanetResources(state, 'helion-01', { ...getPlanetResources(state, 'helion-01'), gas: 1_000_000 });
  let now = baseTime; let target;
  for (let offset = 0; offset < 480 && !target; offset++) {
    now = baseTime + offset * MINUTE;
    target = selectExplorationTargets(state, now, 'test').find(node => node.special && node.special.expiresAt - now > 8 * MINUTE);
  }
  if (!target) throw new Error('no exploration contact');
  const sent = dispatchFlight(state, {
    requestId: 'occupant-holder', missionId: 'expedition', contactCycleKey: target.id, originPlanetId: 'helion-01',
    destination: { kind: 'coordinate', coordinate: target.coordinate }, targetKind: target.kind,
    selectedShips: { transporter: 5, recycler: 5 }, departedAt: now,
  }, { now, ...OPTIONS });
  assert.ok(sent.ok);
  if (!sent.ok) throw new Error('holder not sent');
  const reached = reconcileFlights(sent.state, sent.flight.arrivalAt, undefined, OPTIONS);
  const contact = reached.state.exploration!.contacts[target.id]!;
  assert.ok(contact.claim);
  const template = Object.values(getEspionageTargets(reached.state.espionage))[0]!;
  const occupied: SaveState = {
    ...reached.state,
    science: { ...reached.state.science, levels: { ...reached.state.science.levels, 5: observerLevel } },
    espionage: { ...reached.state.espionage!, targets: {
      ...getEspionageTargets(reached.state.espionage),
      'helion-01': { ...template, id: 'helion-01', ownerId: 'qa-foreign-owner', ownerName: 'Чужой Командор',
        ownerProfile: { scienceLevels: { 5: occupantLevel }, shipLevels: { transporter: 3 }, commanderLevels: {} } },
    } },
    exploration: { ...reached.state.exploration!, contacts: { ...reached.state.exploration!.contacts,
      [target.id]: { ...contact, claim: { ...contact.claim!, ownerId: 'qa-foreign-owner' } } } },
  };
  return { state: occupied, target, at: sent.flight.arrivalAt + MINUTE, holder: sent.flight };
}

function probe(state: SaveState, targetId: string, coordinate: any, kind: any, requestId: string, at: number) {
  const sent = dispatchFlight(state, {
    requestId, missionId: 'exploration-recon', contactCycleKey: targetId, selectedShips: { 'spy-probe': 1 },
    originPlanetId: 'helion-01', destination: { kind: 'coordinate', coordinate }, targetKind: kind, departedAt: at,
  }, { now: at, ...OPTIONS });
  assert.ok(sent.ok, sent.ok ? '' : sent.error.message);
  if (!sent.ok) throw new Error('probe not sent');
  return { sent, arrived: reconcileFlights(sent.state, sent.flight.arrivalAt, undefined, OPTIONS) };
}

test('free object: recon carries no occupant block', () => {
  const f = fixture(0, 0);
  const free = { ...f.state, exploration: { ...f.state.exploration!, contacts: { ...f.state.exploration!.contacts,
    [f.target.id]: { ...f.state.exploration!.contacts[f.target.id]!, claim: undefined } } } };
  const { arrived, sent } = probe(free, f.target.id, f.target.coordinate, f.target.kind, 'free-probe', f.at);
  const record = arrived.state.exploration!.reconReports!.find(r => r.flightId === sent.flight.id)!;
  assert.equal(record.occupant, undefined);
});

test('occupied object, espionage far below the occupant: basic tier names the occupant but hides the fleet', () => {
  const f = fixture(20, 0);
  for (const id of ['a', 'b', 'c', 'd', 'e']) {
    const { arrived, sent } = probe(f.state, f.target.id, f.target.coordinate, f.target.kind, 'low-' + id, f.at);
    const record = arrived.state.exploration!.reconReports!.find(r => r.flightId === sent.flight.id)!;
    assert.equal(record.occupant?.quality, 'basic');
    assert.equal(record.occupant?.ownerId, 'qa-foreign-owner');
    assert.equal(record.occupant?.ownerName, 'Чужой Командор');
    assert.equal(record.occupant?.fleet, undefined);
    const letter = explorationMailboxReports(arrived.state.exploration, arrived.state.flights.records).find(i => i.id === 'exploration-recon:' + sent.flight.id)!;
    assert.equal(letter.occupantRecon?.quality, 'basic');
  }
});

test('occupied object, espionage far above the occupant: full tier reveals the real fleet and levels', () => {
  const f = fixture(0, 20);
  const tiers = new Set<string>();
  for (let i = 0; i < 12; i++) {
    const { arrived, sent } = probe(f.state, f.target.id, f.target.coordinate, f.target.kind, 'high-' + i, f.at);
    const record = arrived.state.exploration!.reconReports!.find(r => r.flightId === sent.flight.id)!;
    tiers.add(record.occupant!.quality);
    assert.notEqual(record.occupant!.quality, 'basic');
    if (record.occupant!.quality === 'full') {
      assert.deepEqual(record.occupant!.fleet, { transporter: 5, recycler: 5 });
      assert.deepEqual(Object.keys(record.occupant!.fleetLevels ?? {}).sort(), ['recycler', 'transporter']);
    } else assert.equal(record.occupant!.fleet, undefined);
  }
  assert.ok(tiers.has('full'));
});

test('a repeat look at the same occupant costs the probe on the canonical loss roll, deterministically', () => {
  const f = fixture(0, 20);
  const first = probe(f.state, f.target.id, f.target.coordinate, f.target.kind, 'loss-first', f.at);
  assert.equal(first.arrived.state.exploration!.reconReports![0]!.occupant?.firstReport, true);
  let lost = 0; let kept = 0;
  const home = reconcileFlights(first.arrived.state, first.sent.flight.arrivalAt + first.sent.flight.oneWayDurationMs + 1, undefined, OPTIONS).state;
  const secondAt = first.sent.flight.arrivalAt + first.sent.flight.oneWayDurationMs + 125_000;
  for (let i = 0; i < 20; i++) {
    const again = probe(home, f.target.id, f.target.coordinate, f.target.kind, 'loss-' + i, secondAt);
    const flight = again.arrived.state.flights.records.find(r => r.id === again.sent.flight.id)!;
    const probesBefore = again.sent.state.planets['helion-01'].fleet.ships['spy-probe'] ?? 0;
    const replay = probe(home, f.target.id, f.target.coordinate, f.target.kind, 'loss-' + i, secondAt);
    assert.deepEqual(replay.arrived.state.flights.records.find(r => r.id === replay.sent.flight.id)?.completionReason, flight.completionReason);
    if (flight.completionReason === 'spy-destroyed' && flight.phase === 'completed') {
      lost++;
      assert.equal(again.arrived.state.planets['helion-01'].fleet.ships['spy-probe'], probesBefore - 1);
      assert.equal(again.arrived.state.exploration!.reconReports!.length, 1, 'a lost probe brings no new report');
    } else {
      kept++;
      assert.equal(flight.phase, 'returning');
      assert.equal(again.arrived.state.exploration!.reconReports!.at(-1)!.occupant?.firstReport, false);
    }
  }
  assert.ok(lost > 0 && kept > 0, `lost=${lost} kept=${kept}`);
});
