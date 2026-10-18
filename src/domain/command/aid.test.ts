import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AID_BASE_MAX_REQUEST,
  AID_INTRO_CHARGE_MS,
  AID_MIN_REQUEST,
  MAX_AID_CHARGES,
  MAX_OPEN_REQUESTS,
  applyAidRegime,
  cancelResourceRequest,
  chargeDurationMs,
  closeOrphanedRequests,
  createResourceRequest,
  creditAidDelivery,
  isAidPairValid,
  markRequestHelpStarted,
  maxRequestAmount,
  projectAidLedger,
  requestOpenRemainder,
  selectActiveAidLedger,
  selectAidLedger,
  selectRequestById,
  settleAidLedger,
} from './aid.ts';
import { acceptApplication, applyToAlliance, createAlliance, kickMember, leaveAlliance } from './membership.ts';
import { createDefaultCommandState, migrateCommandState } from './repository.ts';
import type { CommandState, ResourceRequest } from './types.ts';

const MIN = 60_000;
const HOUR = 60 * MIN;
const settings = { name: 'Альфа Союз', tag: 'ALF', motto: '', description: '', emblem: { glyph: 'orbit' as const, accent: 'cyan' as const } };
const planet = { id: 'helion-01', name: 'Гелион', coordinate: { galaxy: 1, system: 1, position: 1 } };

/** Player founds an alliance at t0; `bob` joins it. Both start from an empty stock. */
function scene(): { state: CommandState; allianceId: string } {
  const created = createAlliance(createDefaultCommandState('production'), { ownerId: 'alice', displayName: 'Алиса', settings }, { now: 0, random: () => 0.5 });
  assert.ok(created.ok);
  const applied = applyToAlliance(created.state, { ownerId: 'bob', displayName: 'Боб', allianceId: created.allianceId }, { now: 0 });
  assert.ok(applied.ok);
  const accepted = acceptApplication(applied.state, 'alice', applied.applicationId, { now: 0, random: () => 0.4 });
  assert.ok(accepted.ok);
  return { state: accepted.state, allianceId: created.allianceId };
}

/** Points the owner's ledger at an open Hall of the given level from `at` on. */
function withHall(state: CommandState, ownerId: string, hallLevel: number, at: number, timeScale = 1): CommandState {
  return applyAidRegime(state, ownerId, { hallLevel, timeScale }, at);
}

function request(state: CommandState, ownerId: string, amount: number, now: number, resourcePoints = 0) {
  return createResourceRequest(state, {
    ownerId, authorName: ownerId, planet, resource: 'metal', amount, resourcePoints, hallLevel: 1,
  }, now);
}

test('request size limit: 0 -> 50 000, 1 000 000 -> 3 500 000, linear and uncapped above', () => {
  assert.equal(maxRequestAmount(0), 50_000);
  assert.equal(maxRequestAmount(1_000_000), 3_500_000);
  assert.ok(maxRequestAmount(1_000_001) > 3_500_000);
  assert.equal(maxRequestAmount(1_000_001), 3_500_003);
  assert.equal(maxRequestAmount(20_000_000), 50_000 + 69_000_000);
  assert.equal(maxRequestAmount(100_000_000_000), 50_000 + 345_000_000_000);
  // small points still grow: no rounding that flattens the start of the curve
  assert.equal(maxRequestAmount(1), 50_003);
  assert.equal(maxRequestAmount(20), 50_069);
  assert.equal(maxRequestAmount(-5), AID_BASE_MAX_REQUEST);
  assert.equal(maxRequestAmount(Number.NaN), AID_BASE_MAX_REQUEST);
  // strictly non-decreasing over a dense range
  let previous = -1;
  for (let points = 0; points <= 5_000; points += 1) {
    const value = maxRequestAmount(points);
    assert.ok(value >= previous);
    previous = value;
  }
});

test('request validation uses resource points only and rejects out-of-range amounts', () => {
  const { state } = scene();
  const open = withHall(state, 'alice', 1, 0);
  const ready = settleAidLedger(selectActiveAidLedger(open, 'alice')!, 15 * MIN);
  assert.equal(ready.charges, 1);
  assert.equal(request(open, 'alice', AID_MIN_REQUEST - 1, 15 * MIN, 1_000_000).ok, false);
  assert.equal(request(open, 'alice', 50_001, 15 * MIN, 0).ok, false, 'a newcomer is capped at 50 000');
  assert.equal(request(open, 'alice', 50_000, 15 * MIN, 0).ok, true);
  assert.equal(request(open, 'alice', 3_500_001, 15 * MIN, 1_000_000).ok, false);
  assert.equal(request(open, 'alice', 3_500_000, 15 * MIN, 1_000_000).ok, true);
  const fractional = request(open, 'alice', 60_000.5, 15 * MIN, 1_000_000);
  assert.equal(fractional.ok, false);
  const hallClosed = createResourceRequest(open, {
    ownerId: 'alice', authorName: 'a', planet, resource: 'metal', amount: 50_000, resourcePoints: 0, hallLevel: 0,
  }, 15 * MIN);
  assert.ok(!hallClosed.ok && hallClosed.code === 'hall_required');
  const energy = createResourceRequest(open, {
    ownerId: 'alice', authorName: 'a', planet, resource: 'energy' as never, amount: 50_000, resourcePoints: 0, hallLevel: 1,
  }, 15 * MIN);
  assert.ok(!energy.ok && energy.code === 'invalid_resource');
  const stranger = request(open, 'nobody', 50_000, 15 * MIN);
  assert.ok(!stranger.ok && stranger.code === 'not_member');
});

test('charge duration: 60 min at Hall 1, 30 min at Hall 10, 200 s less per level, closed at 0', () => {
  const minutes = Array.from({ length: 10 }, (_, index) => chargeDurationMs(index + 1)! / MIN);
  assert.deepEqual(minutes.map((value) => Math.round(value * 3) / 3), [60, 56 + 2 / 3, 53 + 1 / 3, 50, 46 + 2 / 3, 43 + 1 / 3, 40, 36 + 2 / 3, 33 + 1 / 3, 30].map((value) => Math.round(value * 3) / 3));
  assert.equal(chargeDurationMs(1), 60 * MIN);
  assert.equal(chargeDurationMs(10), 30 * MIN);
  assert.equal(chargeDurationMs(0), null);
  assert.equal(chargeDurationMs(Number.NaN), null);
  assert.equal(chargeDurationMs(25), 30 * MIN, 'levels above 10 clamp');
  for (let level = 2; level <= 10; level += 1) assert.ok(chargeDurationMs(level)! < chargeDurationMs(level - 1)!);
});

test('first membership: 0/3, one charge after 15 minutes, then the normal Hall clock', () => {
  const { state } = scene();
  const open = withHall(state, 'alice', 1, 0);
  assert.equal(projectAidLedger(selectActiveAidLedger(open, 'alice')!, 14 * MIN + 59_999).charges, 0);
  const atIntro = projectAidLedger(selectActiveAidLedger(open, 'alice')!, AID_INTRO_CHARGE_MS);
  assert.equal(atIntro.charges, 1);
  assert.equal(atIntro.intro, false);
  assert.equal(atIntro.remainingMs, 60 * MIN, 'the second charge takes the full Hall-1 hour');
  assert.equal(projectAidLedger(selectActiveAidLedger(open, 'alice')!, 15 * MIN + 60 * MIN).charges, 2);
  assert.equal(projectAidLedger(selectActiveAidLedger(open, 'alice')!, 15 * MIN + 120 * MIN).charges, MAX_AID_CHARGES);
  const capped = projectAidLedger(selectActiveAidLedger(open, 'alice')!, 100 * HOUR);
  assert.equal(capped.charges, MAX_AID_CHARGES, '3/3 never becomes 4/3');
  assert.equal(capped.remainingMs, null);
  assert.equal(capped.progress, 0);
});

test('re-joining or joining another alliance never repeats the 15-minute start', () => {
  const { state, allianceId } = scene();
  // bob leaves alliance A and later returns: empty stock, no intro
  const earned = settleAidLedger(withHall(state, 'bob', 1, 0).aidLedgers.find((ledger) => ledger.ownerId === 'bob')!, 3 * HOUR);
  assert.equal(earned.charges, 3);
  const left = leaveAlliance(state, 'bob', 4 * HOUR);
  assert.ok(left.ok);
  assert.equal(selectAidLedger(left.state, 'bob', allianceId)?.ownerId, 'bob', 'the ledger outlives membership');
  const after = 4 * HOUR + 2 * HOUR + MIN;
  const reapplied = applyToAlliance(left.state, { ownerId: 'bob', displayName: 'Боб', allianceId }, { now: after });
  assert.ok(reapplied.ok);
  const back = acceptApplication(reapplied.state, 'alice', reapplied.applicationId, { now: after });
  assert.ok(back.ok);
  const ledger = selectAidLedger(back.state, 'bob', allianceId)!;
  assert.equal(ledger.charges, 0);
  assert.equal(ledger.intro, false);
  const open = withHall(back.state, 'bob', 1, after);
  assert.equal(projectAidLedger(selectActiveAidLedger(open, 'bob')!, after + 15 * MIN).charges, 0, 'no 15-minute bonus on return');
  assert.equal(projectAidLedger(selectActiveAidLedger(open, 'bob')!, after + 60 * MIN).charges, 1);

  // founding another alliance is a first membership there: a fresh intro
  const other = createAlliance(left.state, { ownerId: 'bob', displayName: 'Боб', settings: { ...settings, name: 'Бета Союз', tag: 'BET' } }, { now: after });
  assert.ok(other.ok);
  assert.equal(selectAidLedger(other.state, 'bob', other.allianceId)?.intro, true);
});

test('a zero Hall pauses restoration and a level change keeps the finished share', () => {
  const { state } = scene();
  let current = withHall(state, 'alice', 1, 0);
  // 7.5 min of the 15-minute intro done, then the last Hall is lost
  current = withHall(current, 'alice', 0, 7.5 * MIN);
  let ledger = selectActiveAidLedger(current, 'alice')!;
  assert.equal(ledger.progress, 0.5);
  assert.equal(projectAidLedger(ledger, 10 * HOUR).charges, 0, 'paused for ten hours');
  assert.equal(projectAidLedger(ledger, 10 * HOUR).paused, true);
  assert.equal(projectAidLedger(ledger, 10 * HOUR).progress, 0.5, 'progress is kept, not reset');
  // the Hall comes back after the pause: the remaining half of the intro charge resumes
  current = withHall(current, 'alice', 1, 10 * HOUR);
  ledger = selectActiveAidLedger(current, 'alice')!;
  assert.equal(projectAidLedger(ledger, 10 * HOUR + 7.5 * MIN - 1).charges, 0);
  assert.equal(projectAidLedger(ledger, 10 * HOUR + 7.5 * MIN).charges, 1);

  // normal clock: halfway through a Hall-1 hour, the Hall rises to 10 -> only half of 30 min remains
  const { state: fresh } = scene();
  let live = withHall(fresh, 'alice', 1, 0);
  live = withHall(live, 'alice', 1, 0);
  const afterIntro = AID_INTRO_CHARGE_MS;
  live = withHall(live, 'alice', 1, afterIntro + 30 * MIN);
  live = withHall(live, 'alice', 10, afterIntro + 30 * MIN);
  const upgraded = selectActiveAidLedger(live, 'alice')!;
  assert.equal(projectAidLedger(upgraded, afterIntro + 30 * MIN).charges, 1);
  assert.equal(projectAidLedger(upgraded, afterIntro + 30 * MIN).progress, 0.5);
  assert.equal(projectAidLedger(upgraded, afterIntro + 45 * MIN - 1).charges, 1);
  assert.equal(projectAidLedger(upgraded, afterIntro + 45 * MIN).charges, 2, 'half of 30 minutes = 15');
});

test('splitting a settle into many steps never gives or withholds a charge', () => {
  const { state } = scene();
  const open = withHall(state, 'alice', 3, 0);
  let stepped = selectActiveAidLedger(open, 'alice')!;
  for (let at = 1; at <= 900; at += 1) stepped = settleAidLedger(stepped, at * 1_000);
  assert.equal(stepped.charges, 1, 'exactly 15 minutes in 900 one-second steps');
  const once = settleAidLedger(selectActiveAidLedger(open, 'alice')!, 900_000);
  assert.equal(once.charges, 1);
  let long = selectActiveAidLedger(open, 'alice')!;
  for (let at = 1; at <= 4_000; at += 1) long = settleAidLedger(long, at * 60_000);
  assert.deepEqual([long.charges, settleAidLedger(selectActiveAidLedger(open, 'alice')!, 4_000 * 60_000).charges], [3, 3]);
});

test('the test time scale shortens the wait; a scale change is a new regime', () => {
  const { state } = scene();
  const fast = withHall(state, 'alice', 1, 0, 15);
  assert.equal(projectAidLedger(selectActiveAidLedger(fast, 'alice')!, MIN - 1).charges, 0);
  assert.equal(projectAidLedger(selectActiveAidLedger(fast, 'alice')!, MIN).charges, 1, '15 min / 15 = 1 min');
  // dropping back to real time after half the scaled intro keeps the finished half
  const half = withHall(fast, 'alice', 1, 30_000);
  const slowed = applyAidRegime(half, 'alice', { hallLevel: 1, timeScale: 1 }, 30_000);
  assert.equal(selectActiveAidLedger(slowed, 'alice')!.progress, 0.5);
});

test('applying the same regime twice does not rewrite the state', () => {
  const { state } = scene();
  const once = withHall(state, 'alice', 2, 100);
  assert.equal(withHall(once, 'alice', 2, 200), once);
  assert.equal(withHall(once, 'nobody', 2, 200), once);
});

test('creating a request spends one charge and enforces three open requests', () => {
  const { state } = scene();
  let current = withHall(state, 'alice', 1, 0);
  // full stock: 15 + 60 + 60 minutes
  const now = AID_INTRO_CHARGE_MS + 2 * HOUR;
  assert.equal(projectAidLedger(selectActiveAidLedger(current, 'alice')!, now).charges, 3);
  const ids: string[] = [];
  for (let index = 0; index < MAX_OPEN_REQUESTS; index += 1) {
    const created = request(current, 'alice', 50_000, now);
    assert.ok(created.ok);
    ids.push(created.requestId);
    current = created.state;
  }
  assert.equal(new Set(ids).size, 3, 'stable, unique ids');
  assert.equal(projectAidLedger(selectActiveAidLedger(current, 'alice')!, now).charges, 0);
  const noCharge = request(current, 'alice', 50_000, now);
  assert.ok(!noCharge.ok);
  // restoring a charge does not lift the open-request limit
  const later = now + 5 * HOUR;
  const limited = request(current, 'alice', 50_000, later);
  assert.ok(!limited.ok && limited.code === 'request_limit');
  // spending from a full stock starts the clock at that moment
  const afterSpend = selectActiveAidLedger(current, 'alice')!;
  assert.equal(projectAidLedger(afterSpend, now + 59 * MIN).charges, 0);
  assert.equal(projectAidLedger(afterSpend, now + 60 * MIN).charges, 1);
});

test('cancel before any help refunds the charge (never above 3); after help it is locked', () => {
  const { state } = scene();
  let current = withHall(state, 'alice', 1, 0);
  const now = AID_INTRO_CHARGE_MS + 2 * HOUR;
  const first = request(current, 'alice', 50_000, now);
  assert.ok(first.ok);
  current = first.state;
  assert.equal(projectAidLedger(selectActiveAidLedger(current, 'alice')!, now).charges, 2);
  const cancelled = cancelResourceRequest(current, 'alice', first.requestId, now);
  assert.ok(cancelled.ok);
  assert.equal(projectAidLedger(selectActiveAidLedger(cancelled.state, 'alice')!, now).charges, 3);
  assert.equal(selectRequestById(cancelled.state, first.requestId)?.status, 'cancelled');
  // refund cannot push the stock over 3 when it has been restored meanwhile
  const spent = request(current, 'alice', 50_000, now);
  assert.ok(spent.ok);
  const restored = cancelResourceRequest(spent.state, 'alice', spent.requestId, now + 10 * HOUR);
  assert.ok(restored.ok);
  assert.equal(projectAidLedger(selectActiveAidLedger(restored.state, 'alice')!, now + 10 * HOUR).charges, 3);
  // only the author, only while open, never twice
  assert.ok(!cancelResourceRequest(current, 'bob', first.requestId, now).ok);
  assert.ok(!cancelResourceRequest(cancelled.state, 'alice', first.requestId, now).ok);
  // once help started - even if the flight later turned back - there is no cancel
  const helped = markRequestHelpStarted(current, first.requestId, 'flight-1', 'bob', 10_000, now);
  const locked = cancelResourceRequest(helped, 'alice', first.requestId, now);
  assert.ok(!locked.ok && locked.code === 'cancel_locked');
  assert.equal(projectAidLedger(selectActiveAidLedger(locked.state, 'alice')!, now).charges, 2, 'no refund');
});

test('delivery credit is idempotent per flight and caps at the request', () => {
  const { state } = scene();
  let current = withHall(state, 'alice', 1, 0);
  const now = AID_INTRO_CHARGE_MS;
  const created = request(current, 'alice', 100_000 > 50_000 ? 50_000 : 50_000, now);
  assert.ok(created.ok);
  current = created.state;
  const partial = creditAidDelivery(current, { requestId: created.requestId, flightId: 'flight-a', senderOwnerId: 'bob', units: 30_000 }, now + 1);
  const again = creditAidDelivery(partial, { requestId: created.requestId, flightId: 'flight-a', senderOwnerId: 'bob', units: 30_000 }, now + 2);
  assert.equal(again, partial, 'a repeated handler changes nothing');
  assert.equal(selectRequestById(partial, created.requestId)?.delivered, 30_000);
  assert.equal(partial.alliances[0].members.find((member) => member.ownerId === 'bob')?.deliveredUnits, 30_000);
  const done = creditAidDelivery(partial, { requestId: created.requestId, flightId: 'flight-b', senderOwnerId: 'bob', units: 999_999 }, now + 3);
  const finished = selectRequestById(done, created.requestId)!;
  assert.equal(finished.delivered, 50_000, 'never above the requested amount');
  assert.equal(finished.status, 'completed');
  assert.equal(done.alliances[0].members.find((member) => member.ownerId === 'bob')?.deliveredUnits, 50_000, 'contribution is the accepted units only');
  // a late flight after completion adds nothing
  const late = creditAidDelivery(done, { requestId: created.requestId, flightId: 'flight-c', senderOwnerId: 'bob', units: 5_000 }, now + 4);
  assert.equal(selectRequestById(late, created.requestId)?.delivered, 50_000);
  assert.equal(late.alliances[0].members.find((member) => member.ownerId === 'bob')?.deliveredUnits, 50_000);
  assert.equal(requestOpenRemainder(finished, 0), 0);
});

test('leaving, being kicked or disbanding closes open requests without refunding a charge', () => {
  const { state, allianceId } = scene();
  const open = withHall(withHall(state, 'bob', 1, 0), 'alice', 1, 0);
  const now = AID_INTRO_CHARGE_MS + 2 * HOUR;
  const made = createResourceRequest(open, { ownerId: 'bob', authorName: 'Боб', planet, resource: 'gas', amount: 50_000, resourcePoints: 0, hallLevel: 1 }, now);
  assert.ok(made.ok);

  const kicked = kickMember(made.state, 'alice', 'bob', now + 1);
  assert.ok(kicked.ok);
  const closed = selectRequestById(kicked.state, made.requestId)!;
  assert.equal(closed.status, 'closed');
  assert.equal(closed.closeReason, 'author_left');
  assert.equal(projectAidLedger(selectAidLedger(kicked.state, 'bob', allianceId)!, now + 1).charges, 2, 'the spent charge stays spent');

  const left = leaveAlliance(made.state, 'bob', now + 1);
  assert.ok(left.ok);
  assert.equal(selectRequestById(left.state, made.requestId)?.closeReason, 'author_left');

  const second = createResourceRequest(open, { ownerId: 'alice', authorName: 'Алиса', planet, resource: 'metal', amount: 50_000, resourcePoints: 0, hallLevel: 1 }, now);
  assert.ok(second.ok);
  const solo = leaveAlliance(kickMember(second.state, 'alice', 'bob', now).state, 'alice', now + 5);
  assert.ok(solo.ok && solo.disbanded);
  assert.equal(selectRequestById(solo.state, second.requestId)?.closeReason, 'alliance_disbanded');
  assert.equal(solo.state.aidLedgers.length, 0, 'a gone alliance leaves no ledgers behind');
});

test('pair validity requires both owners in the request alliance and never self-help', () => {
  const { state, allianceId } = scene();
  assert.equal(isAidPairValid(state, { allianceId, senderOwnerId: 'bob', recipientOwnerId: 'alice' }), true);
  assert.equal(isAidPairValid(state, { allianceId, senderOwnerId: 'alice', recipientOwnerId: 'alice' }), false);
  assert.equal(isAidPairValid(state, { allianceId, senderOwnerId: 'carol', recipientOwnerId: 'alice' }), false);
  assert.equal(isAidPairValid(state, { allianceId: 'alliance-99', senderOwnerId: 'bob', recipientOwnerId: 'alice' }), false);
});

test('orphan sweep closes requests whose author is not a member any more (idempotent)', () => {
  const { state, allianceId } = scene();
  const orphan: ResourceRequest = {
    id: 'request-9', allianceId, authorOwnerId: 'ghost', authorName: 'Призрак', planetId: 'p', planetName: 'P',
    coordinate: { galaxy: 1, system: 1, position: 1 }, resource: 'metal', requested: 50_000, delivered: 0,
    helpStarted: false, status: 'open', closeReason: null, createdAt: 0, closedAt: null,
  };
  const dirty: CommandState = { ...state, requests: [orphan] };
  const clean = closeOrphanedRequests(dirty, 5);
  assert.equal(clean.requests[0].closeReason, 'author_left');
  assert.equal(closeOrphanedRequests(clean, 6), clean);
});

test('events carry stable ids and are recorded once', () => {
  const { state } = scene();
  const open = withHall(state, 'alice', 1, 0);
  const now = AID_INTRO_CHARGE_MS;
  const made = request(open, 'alice', 50_000, now);
  assert.ok(made.ok);
  const launched = markRequestHelpStarted(made.state, made.requestId, 'flight-1', 'bob', 50_000, now);
  const twice = markRequestHelpStarted(launched, made.requestId, 'flight-1', 'bob', 50_000, now);
  assert.deepEqual(launched.aidEvents.map((event) => event.id), [`request_created:${made.requestId}`, 'aid_launched:flight-1']);
  assert.equal(twice.aidEvents.length, 2);
  for (const event of twice.aidEvents) assert.equal(event.audience, 'alliance');
});

test('persistence: v2 saves migrate, ledgers/requests round-trip, damaged data never fabricates', () => {
  const { state } = scene();
  const open = withHall(state, 'alice', 4, 100);
  const now = AID_INTRO_CHARGE_MS + 100;
  const made = request(open, 'alice', 50_000, now);
  assert.ok(made.ok);
  const roundTrip = migrateCommandState(JSON.parse(JSON.stringify(made.state)), 'production');
  assert.deepEqual(roundTrip, made.state);

  // a v2 save (no aid fields): every member gets a first-join ledger, nothing is invented
  const v2 = JSON.parse(JSON.stringify({ ...state, version: 2 }));
  delete v2.requests; delete v2.aidLedgers; delete v2.aidEvents;
  const migrated = migrateCommandState(v2, 'production');
  assert.equal(migrated.version, 3);
  assert.deepEqual(migrated.requests, []);
  assert.equal(migrated.aidLedgers.length, 2);
  assert.ok(migrated.aidLedgers.every((ledger) => ledger.intro && ledger.charges === 0 && ledger.hallLevel === 0));

  const hostile = migrateCommandState({
    ...JSON.parse(JSON.stringify(made.state)),
    requests: [
      { id: 'request-3', allianceId: made.state.alliances[0].id, authorOwnerId: 'alice', planetId: 'helion-01', resource: 'energy', requested: 50_000 },
      { id: 'request-4', allianceId: made.state.alliances[0].id, authorOwnerId: 'alice', planetId: 'helion-01', resource: 'gas', requested: 50_000, delivered: 9e9, status: 'open' },
      { id: 'request-5', allianceId: 'alliance-404', authorOwnerId: 'alice', planetId: 'p', resource: 'metal', requested: 50_000, status: 'open' },
      { id: 'request-6', allianceId: made.state.alliances[0].id, authorOwnerId: 'ghost', planetId: 'p', resource: 'metal', requested: 60_000, status: 'open' },
      'garbage', null,
    ],
    aidLedgers: [
      { ownerId: 'alice', allianceId: made.state.alliances[0].id, charges: 99, progress: 7, settledAt: 5, hallLevel: 99, timeScale: -3, intro: false },
      { ownerId: 'alice', allianceId: made.state.alliances[0].id, charges: 1 },
      { ownerId: 'x', allianceId: 'alliance-404' },
    ],
  }, 'production');
  const byId = new Map(hostile.requests.map((item) => [item.id, item]));
  assert.equal(byId.has('request-3'), false, 'energy is not a requestable resource');
  assert.equal(byId.get('request-4')?.status, 'completed', 'a satisfied request is never left open');
  assert.equal(byId.get('request-4')?.delivered, 50_000);
  assert.equal(byId.get('request-5')?.status, 'closed');
  assert.equal(byId.get('request-6')?.closeReason, 'author_left');
  const ledger = hostile.aidLedgers.find((item) => item.ownerId === 'alice')!;
  assert.equal(ledger.charges, 3);
  assert.equal(ledger.progress, 0);
  assert.equal(ledger.hallLevel, 10);
  assert.equal(ledger.timeScale, 1);
  assert.equal(hostile.aidLedgers.filter((item) => item.ownerId === 'alice').length, 1, 'one ledger per owner and alliance');
  assert.equal(hostile.aidLedgers.some((item) => item.allianceId === 'alliance-404'), false);
  assert.ok(hostile.nextSerial > 6, 'ids of dropped requests are never reused');
});

test('Test Mode seed gives the player, Ira and Bot 01 first-join ledgers; production has none', () => {
  const test = createDefaultCommandState('test', { playerId: 'player-current', playerDisplayName: 'Д', now: 1000 });
  assert.equal(test.aidLedgers.length, 3);
  assert.ok(test.aidLedgers.every((ledger) => ledger.intro && ledger.settledAt === 1000 && ledger.hallLevel === 0));
  assert.deepEqual(createDefaultCommandState('production').aidLedgers, []);
});

test('accepting an applicant registers their ledger; offline gaps are credited once', () => {
  const { state } = scene();
  const open = withHall(state, 'alice', 1, 0);
  // 5 hours offline are applied in one settle and again on reload: same result, no double grant
  const ledger = selectActiveAidLedger(open, 'alice')!;
  const first = settleAidLedger(ledger, 5 * HOUR);
  const reload = settleAidLedger(JSON.parse(JSON.stringify(first)), 5 * HOUR);
  assert.deepEqual(reload, first);
  assert.equal(first.charges, 3);
});
