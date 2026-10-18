import assert from 'node:assert/strict';
import test from 'node:test';

import { appendAidEvent, createResourceRequest, grantAidChargesForTest, applyAidRegime, creditAidDelivery } from './aid.ts';
import { JOURNAL_DELAY_MS, JOURNAL_MAX_ROWS, journalEntryKey, selectAllianceJournal, type JournalView } from './journal.ts';
import { acceptApplication, applyToAlliance, createAlliance, kickMember, leaveAlliance } from './membership.ts';
import { createDefaultCommandState, migrateCommandState } from './repository.ts';
import type { CommandState } from './types.ts';

const MIN = 60_000;
const HOUR = 60 * MIN;
const settings = { name: 'Альфа Союз', tag: 'ALF', motto: '', description: '', emblem: { glyph: 'orbit' as const, accent: 'cyan' as const } };
const planet = { id: 'secret-planet-77', name: 'Тайная', coordinate: { galaxy: 9, system: 9, position: 9 } };
const JOIN = 10 * HOUR;

function join(state: CommandState, ownerId: string, allianceId: string, at: number): CommandState {
  const applied = applyToAlliance(state, { ownerId, displayName: ownerId, allianceId }, { now: at });
  assert.ok(applied.ok);
  const accepted = acceptApplication(applied.state, 'alice', applied.applicationId, { now: at, random: () => 0.4 });
  assert.ok(accepted.ok);
  return accepted.state;
}

/** alice founds at t=0; bob joins at JOIN. */
function scene() {
  const created = createAlliance(createDefaultCommandState('production'), { ownerId: 'alice', displayName: 'alice', settings }, { now: 0, random: () => 0.5 });
  assert.ok(created.ok);
  return { allianceId: created.allianceId, state: join(created.state, 'bob', created.allianceId, JOIN) };
}

function ev(state: CommandState, allianceId: string, kind: Parameters<typeof appendAidEvent>[1], subject: string, at: number, extra: Record<string, unknown> = {}) {
  return appendAidEvent(state, kind, subject, { at, allianceId, requestId: 'request-x', actorOwnerId: 'alice', ...extra });
}

function entries(view: JournalView) {
  assert.equal(view.state, 'open');
  return view.state === 'open' ? view.entries : [];
}

test('boundary: nothing before the 2 h mark, only strictly later events at and after it', () => {
  const { state, allianceId } = scene();
  let s = ev(state, allianceId, 'request_created', 'before', JOIN - 1);
  s = ev(s, allianceId, 'request_created', 'at-join', JOIN);
  s = ev(s, allianceId, 'request_created', 'after', JOIN + 1);
  for (const now of [JOIN - 1, JOIN, JOIN + JOURNAL_DELAY_MS - 1]) {
    const view = selectAllianceJournal(s, 'bob', now);
    assert.deepEqual(view, { state: 'locked', unlocksAt: JOIN + JOURNAL_DELAY_MS }, `locked at ${now}`);
  }
  for (const now of [JOIN + JOURNAL_DELAY_MS, JOIN + JOURNAL_DELAY_MS + 1]) {
    const rows = entries(selectAllianceJournal(s, 'bob', now));
    assert.deepEqual(rows.map((row) => row.id), [journalEntryKey('request_created:after')]);
  }
});

test('locked view carries no trace of the hidden events', () => {
  const { state, allianceId } = scene();
  const s = ev(state, allianceId, 'aid_delivered', 'SENTINEL-FLIGHT', JOIN + MIN, { units: 123_456, reason: 'SENTINEL-REASON', requestId: 'SENTINEL-REQ' });
  const view = selectAllianceJournal(s, 'bob', JOIN + MIN * 5);
  assert.equal(view.state, 'locked');
  assert.equal(JSON.stringify(view).includes('SENTINEL'), false);
  assert.equal(JSON.stringify(view).includes('123456'), false);
  assert.deepEqual(Object.keys(view).sort(), ['state', 'unlocksAt']);
});

test('no membership and other alliances yield nothing', () => {
  const { state, allianceId } = scene();
  const s = ev(state, allianceId, 'request_created', 'a', JOIN + MIN);
  assert.deepEqual(selectAllianceJournal(s, 'stranger', JOIN + 9 * HOUR), { state: 'no_membership' });
  // carol founds her own alliance: she must not read alice's events
  const created = createAlliance(s, { ownerId: 'carol', displayName: 'carol', settings: { ...settings, name: 'Бета', tag: 'BET' } }, { now: 0, random: () => 0.5 });
  assert.ok(created.ok);
  const carol = entries(selectAllianceJournal(created.state, 'carol', 20 * HOUR));
  assert.equal(carol.length, 0);
  const foreign = ev(created.state, allianceId, 'request_created', 'foreign', 5 * HOUR + HOUR * 20);
  assert.equal(entries(selectAllianceJournal(foreign, 'carol', 30 * HOUR)).length, 0);
});

test('leaving, being kicked and re-joining never reveals the previous stay', () => {
  const { state, allianceId } = scene();
  let s = ev(state, allianceId, 'request_created', 'first-stay', JOIN + HOUR);
  const left = leaveAlliance(s, 'bob', JOIN + 3 * HOUR);
  assert.ok(left.ok);
  assert.deepEqual(selectAllianceJournal(left.state, 'bob', JOIN + 4 * HOUR), { state: 'no_membership' });
  const rejoinAt = JOIN + 6 * HOUR;
  s = ev(left.state, allianceId, 'request_created', 'while-away', JOIN + 4 * HOUR);
  s = join(s, 'bob', allianceId, rejoinAt);
  assert.equal(selectAllianceJournal(s, 'bob', rejoinAt + HOUR).state, 'locked');
  assert.equal(entries(selectAllianceJournal(s, 'bob', rejoinAt + JOURNAL_DELAY_MS)).length, 0);
  s = ev(s, allianceId, 'request_created', 'second-stay', rejoinAt + 3 * HOUR);
  assert.deepEqual(entries(selectAllianceJournal(s, 'bob', rejoinAt + 4 * HOUR)).map((row) => row.id), [journalEntryKey('request_created:second-stay')]);
  // kicked and moved to another alliance
  const kicked = kickMember(s, 'alice', 'bob', rejoinAt + 5 * HOUR);
  assert.ok(kicked.ok);
  assert.deepEqual(selectAllianceJournal(kicked.state, 'bob', rejoinAt + 6 * HOUR), { state: 'no_membership' });
});

test('equal times sort by id, newest first; duplicate ids collapse', () => {
  const { state, allianceId } = scene();
  let s = state;
  s = ev(s, allianceId, 'request_created', 'b', JOIN + 5 * MIN);
  s = ev(s, allianceId, 'request_created', 'a', JOIN + 5 * MIN);
  s = ev(s, allianceId, 'request_created', 'c', JOIN + 9 * MIN);
  s = ev(s, allianceId, 'request_created', 'c', JOIN + 9 * MIN);
  // a corrupted save with a repeated id must still render once
  s = { ...s, aidEvents: [...s.aidEvents, s.aidEvents[0]!] };
  const rows = entries(selectAllianceJournal(s, 'bob', JOIN + 3 * HOUR));
  assert.deepEqual(rows.map((row) => row.id), ['request_created:c', ...['request_created:a', 'request_created:b'].map(journalEntryKey).sort().map(() => '')].slice(0, 1).map(journalEntryKey).concat(['request_created:a', 'request_created:b'].map(journalEntryKey).sort()));
});

test('output is bounded and keeps the newest rows', () => {
  const { state, allianceId } = scene();
  let s = state;
  for (let index = 0; index < 250; index += 1) s = ev(s, allianceId, 'request_created', `n${index}`, JOIN + MIN * (index + 1));
  const rows = entries(selectAllianceJournal(s, 'bob', JOIN + 40 * HOUR));
  assert.equal(rows.length, JOURNAL_MAX_ROWS);
  assert.equal(rows[0]!.id, journalEntryKey('request_created:n249'));
});

test('rows hold only public data: no planet, coordinates, flight or request ids', () => {
  const made = scene();
  let s = applyAidRegime(made.state, 'alice', { hallLevel: 1, timeScale: 1 }, JOIN);
  s = grantAidChargesForTest(s, 'alice', 3, JOIN);
  const created = createResourceRequest(s, { ownerId: 'alice', authorName: 'alice', planet, resource: 'gas', amount: 50_000, resourcePoints: 0, hallLevel: 1 }, JOIN + MIN);
  assert.ok(created.ok);
  s = creditAidDelivery(created.state, { requestId: created.requestId, flightId: 'flight-SECRET', senderOwnerId: 'bob', units: 20_000 }, JOIN + 2 * MIN);
  const rows = entries(selectAllianceJournal(s, 'bob', JOIN + 5 * HOUR));
  assert.equal(rows.length, 2);
  const text = JSON.stringify(rows);
  for (const secret of ['secret-planet-77', 'Тайная', 'flight-SECRET', created.requestId, '"galaxy"']) assert.equal(text.includes(secret), false, secret);
  const delivered = rows.find((row) => row.kind === 'aid_delivered')!;
  assert.equal(delivered.units, 20_000);
  assert.equal(delivered.resource, 'gas');
  assert.equal(delivered.actorName, 'bob');
});

test('missing request card, left actor and unknown reason degrade to neutral values', () => {
  const { state, allianceId } = scene();
  let s = ev(state, allianceId, 'request_closed', 'gone', JOIN + MIN, { requestId: 'request-deleted', actorOwnerId: 'ghost', reason: 'made up' });
  s = ev(s, allianceId, 'request_closed', 'lost', JOIN + 2 * MIN, { requestId: 'request-deleted', reason: 'planet_destroyed' });
  s = ev(s, allianceId, 'aid_returned', 'junk', JOIN + 3 * MIN, { units: Number.NaN });
  const rows = entries(selectAllianceJournal(s, 'bob', JOIN + 3 * HOUR));
  const byId = Object.fromEntries(rows.map((row) => [row.id, row]));
  assert.deepEqual([byId[journalEntryKey('request_closed:gone')]!.actorName, byId[journalEntryKey('request_closed:gone')]!.resource, byId[journalEntryKey('request_closed:gone')]!.closeReason], [null, null, null]);
  assert.equal(byId[journalEntryKey('request_closed:lost')]!.closeReason, 'planet_destroyed');
  assert.equal(byId[journalEntryKey('aid_returned:junk')]!.units, null);
});

test('partial aid, return and completion each appear once; repeated credit adds no row', () => {
  const made = scene();
  let s = applyAidRegime(made.state, 'alice', { hallLevel: 1, timeScale: 1 }, JOIN);
  s = grantAidChargesForTest(s, 'alice', 3, JOIN);
  const created = createResourceRequest(s, { ownerId: 'alice', authorName: 'alice', planet, resource: 'metal', amount: 50_000, resourcePoints: 0, hallLevel: 1 }, JOIN + MIN);
  assert.ok(created.ok);
  s = created.state;
  const credit = (flight: string, units: number, at: number) => creditAidDelivery(s, { requestId: created.requestId, flightId: flight, senderOwnerId: 'bob', units }, at);
  s = credit('f1', 20_000, JOIN + 2 * MIN);
  s = credit('f1', 20_000, JOIN + 3 * MIN);
  s = ev(s, made.allianceId, 'aid_returned', 'f2', JOIN + 4 * MIN, { requestId: created.requestId, actorOwnerId: 'bob', units: 5_000 });
  s = credit('f3', 99_000, JOIN + 5 * MIN); // only 30 000 still fits
  const rows = entries(selectAllianceJournal(s, 'bob', JOIN + 3 * HOUR));
  assert.deepEqual(rows.map((row) => row.id).sort(), ['aid_delivered:f1', 'aid_delivered:f3', 'aid_returned:f2', 'request_created:' + created.requestId].map(journalEntryKey).sort());
  assert.equal(rows.find((row) => row.id === journalEntryKey('aid_delivered:f3'))!.units, 30_000);
  assert.equal(rows.find((row) => row.id === journalEntryKey('aid_returned:f2'))!.kind, 'aid_returned');
});

test('save round trip and v2 migration keep the journal readable and bounded', () => {
  const { state, allianceId } = scene();
  const s = ev(state, allianceId, 'request_created', 'kept', JOIN + MIN);
  const reloaded = migrateCommandState(JSON.parse(JSON.stringify(s)), 'production');
  assert.deepEqual(selectAllianceJournal(reloaded, 'bob', JOIN + 3 * HOUR), selectAllianceJournal(s, 'bob', JOIN + 3 * HOUR));
  const v2 = JSON.parse(JSON.stringify(s));
  v2.version = 2;
  delete v2.aidEvents;
  delete v2.requests;
  delete v2.aidLedgers;
  const migrated = migrateCommandState(v2, 'production');
  assert.deepEqual(entries(selectAllianceJournal(migrated, 'bob', JOIN + 3 * HOUR)), []);
  assert.doesNotThrow(() => selectAllianceJournal({ ...s, aidEvents: [] }, 'bob', JOIN + 3 * HOUR));
});

test('corrupted timestamps are dropped and never reach a Date', () => {
  const { state, allianceId } = scene();
  let s = ev(state, allianceId, 'request_created', 'good', JOIN + MIN);
  for (const [name, at] of [['huge', 1e20], ['edge', 8.64e15 + 1], ['inf', Number.POSITIVE_INFINITY], ['nan', Number.NaN], ['neg', -5]] as const) {
    s = ev(s, allianceId, 'request_created', name, at);
  }
  const rows = entries(selectAllianceJournal(s, 'bob', JOIN + 3 * HOUR));
  assert.deepEqual(rows.map((row) => row.id), [journalEntryKey('request_created:good')]);
  for (const row of rows) assert.doesNotThrow(() => new Date(row.at).toISOString());
});
