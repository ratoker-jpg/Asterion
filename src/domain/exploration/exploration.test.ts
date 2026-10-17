import assert from 'node:assert/strict';
import test from 'node:test';
import type { UniversePlanetNode } from '../universe/types.ts';
import {
  EXPLORATION_PROFILES, EXPLORATION_RULES, explorationContactId, explorationNodeId,
  explorationProfile, profileVariantForArt, visibleExplorationContacts,
  explorationStage, explorationCatchup, explorationBaseRate, explorationMiningRates,
  emptyExplorationCargo, accumulateExplorationCargo, explorationRareProbability,
  explorationRareWon, captureExplorationCargo, explorationDefenderBonusEligible,
  explorationNpcAttempt, explorationRookieProtected,
} from './model.ts';
import {
  createExplorationState, getOrMaterializeExplorationContact, occupyExplorationContact,
  reconcileExplorationContact, prepareExplorationRecall, isExplorationRecallReady,
  releaseExplorationClaim, completeExplorationReturn, settleExplorationContest, resolveExplorationRecon,
  migrateExplorationState, recordHighestExplorationScore, launchExplorationScore,
} from './ledger.ts';

const start = 1_800_000_000_000;
const minute = 60_000;
function makeNode(kind: 'unique' | 'anomaly', system = 5, cycle = 2): UniversePlanetNode {
  const coordinate = { galaxy: 1, system, position: 20 };
  const id = explorationContactId({ kind, coordinate, cycleIndex: cycle, startAt: start });
  return {
    id, kind, coordinate, art: 'existing-asset.webp', name: 'Реальный объект',
    statusLabel: 'Исследование', description: 'Тест', known: true,
    special: { startAt: start, cycleIndex: cycle, expiresAt: start + 18 * minute,
      respawnAt: start + 63 * minute, lifetimeMs: 18 * minute, spawnChance: .25,
      contactCycleKey: id, profileVariant: 1 },
  };
}

const arrival = (at = start + minute, flightId = 'flight-1') => ({
  claimId: flightId + ':claim', ownerId: 'player', originPlanetId: 'home',
  flightId, arrivedAt: at, capacity: { all: 5000, transporters: 5000, recyclers: 0 },
  resourcePointsLaunch: 1000, catchupMultiplier: 1,
});

test('exactly 16 unique and 10 anomaly economy variants; all weights sum to 100', () => {
  assert.equal(EXPLORATION_PROFILES.unique.length, 16);
  assert.equal(EXPLORATION_PROFILES.anomaly.length, 10);
  for (const kind of ['unique', 'anomaly'] as const) {
    for (const profile of EXPLORATION_PROFILES[kind]) {
      assert.equal(Object.values(profile.weights).reduce((sum, weight) => sum + weight, 0), 100);
      assert.ok(profile.q > 0 && profile.risk >= 1 && profile.risk <= 5);
      assert.ok(profile.tokenP12 > 0 && profile.tokenP12 < 1);
    }
  }
  assert.equal(explorationProfile('anomaly', 10).tokenP12, .18);
  assert.equal(explorationProfile('unique', 16).q, 1.5);
  assert.throws(() => explorationProfile('unique', 17));
});

test('asset mapping retains 3 original unique images and maps generated indices 3..18 to variants 1..16', () => {
  assert.deepEqual([0, 1, 2].map(i => profileVariantForArt('unique', i)), [5, 12, 8]);
  for (let index = 3; index < 19; index++) assert.equal(profileVariantForArt('unique', index), index - 2);
  for (let index = 0; index < 10; index++) assert.equal(profileVariantForArt('anomaly', index), index + 1);
});

test('canonical ID changes between repeated cycles and location visibility respects multiple colonies and boundaries', () => {
  const a = makeNode('unique', 6, 1), b = makeNode('unique', 6, 2);
  assert.notEqual(a.id, b.id);
  assert.equal(explorationNodeId(a), a.id);
  const nodes = [makeNode('unique', 1), makeNode('anomaly', 6), makeNode('unique', 7),
    makeNode('anomaly', 35), makeNode('unique', 40)];
  const multi = visibleExplorationContacts([...nodes, nodes[0]!], [
    { galaxy: 1, system: 1, position: 1 }, { galaxy: 1, system: 40, position: 2 },
  ], start + minute);
  assert.equal(multi.length, 4);
  assert.equal(new Set(multi.map(x => x.id)).size, multi.length);
  assert.equal(visibleExplorationContacts(nodes, [{ galaxy: 2, system: 1, position: 1 }], start + minute).length, 0);
  assert.equal(visibleExplorationContacts(nodes, [{ galaxy: 1, system: 1, position: 1 }], start + 18 * minute).length, 0);
  assert.equal(visibleExplorationContacts(nodes, [{ galaxy: 1, system: 1, position: 1 }], start + minute, 1).length, 1);
});

test('resource points, honest median, and historical high score do not invent phantom accounts', () => {
  assert.equal(explorationStage(100_000), 1);
  assert.equal(explorationCatchup(1000, [300_000, 350_000]).multiplier, 1);
  assert.equal(explorationCatchup(1000, [300_000, 350_000]).median, undefined);
  assert.equal(explorationCatchup(1000, [300_000, 350_000, 400_000, 450_000, 500_000]).multiplier, 1.5);
  assert.ok(explorationBaseRate(3_000_000, explorationProfile('unique', 16)) >
    explorationBaseRate(10_000, explorationProfile('unique', 16)));
  const original = createExplorationState();
  const updated = recordHighestExplorationScore(original, 'player', 4_000_000);
  assert.equal(launchExplorationScore(updated, 'player', 1000), 4_000_000);
  assert.equal(launchExplorationScore(updated, 'other', 1000), 1000);
});

test('single transporter cannot mine infinite resources and recycler is required for debris', () => {
  const ordinary = explorationMiningRates(1000, explorationProfile('unique', 1),
    { all: 5000, transporters: 5000, recyclers: 0 });
  assert.ok(ordinary.metal <= 500);
  const debris = explorationMiningRates(3_000_000, explorationProfile('unique', 13),
    { all: 200_000, transporters: 200_000, recyclers: 0 });
  assert.equal(debris.debris, 0);
  const capable = explorationMiningRates(3_000_000, explorationProfile('unique', 13),
    { all: 300_000, transporters: 0, recyclers: 100_000 });
  assert.ok(capable.debris > 0);
  const combat = explorationMiningRates(3_000_000, explorationProfile('unique', 1),
    { all: 100_000_000, transporters: 0, recyclers: 0 });
  assert.ok(combat.metal <= explorationBaseRate(3_000_000, explorationProfile('unique', 1)) * .05);
});

test('micro-accumulation exactly matches split reconciliation and obeys finite supply / cargo cap', () => {
  const initial = emptyExplorationCargo(), reserve = { ...initial, metal: 10_000 };
  const rate = { ...initial, metal: 333 };
  const whole = accumulateExplorationCargo(initial, reserve, rate, 301_313, initial, 1800);
  let pieces = { cargo: initial, reserve, remainder: initial };
  for (const delta of [713, 51_001, 99_999, 149_600]) {
    pieces = accumulateExplorationCargo(pieces.cargo, pieces.reserve, rate, delta, pieces.remainder, 1800);
  }
  assert.deepEqual(pieces, whole);
  assert.ok(whole.cargo.metal <= 1800);
  const large = accumulateExplorationCargo(initial, reserve, rate, 50_000_000, initial, 1800);
  assert.equal(large.cargo.metal, 1800);
  assert.equal(large.reserve.metal, 8200);
});

test('one shared finite reserve survives ownership change and no later reissue on same cycle', () => {
  const contact = getOrMaterializeExplorationContact(createExplorationState(), makeNode('unique'), 100_000).contact;
  const reloaded = getOrMaterializeExplorationContact({ ...createExplorationState(), contacts: { [contact.id]: contact } },
    makeNode('unique'), 6_000_000).contact;
  assert.equal(contact.initialReserve.metal, reloaded.initialReserve.metal);
  let occupied = occupyExplorationContact(contact, arrival());
  occupied = reconcileExplorationContact(occupied, start + 4 * minute);
  assert.ok(occupied.claim!.cargo.metal > 0);
  assert.equal(occupied.resourceReserve.metal + occupied.extractedByType.metal, contact.initialReserve.metal);
  const attacker = { ...arrival(start + 5 * minute, 'enemy-flight'), ownerId: 'enemy' };
  const { contact: captured, captured: loot, destroyed } = settleExplorationContest(
    occupied, start + 5 * minute, 'attacker', attacker, 1200,
    { all: 0, transporters: 0, recyclers: 0 }, false, { attacker: true, defender: true });
  assert.equal(captured.claim!.ownerId, 'enemy');
  assert.equal(captured.claim!.cargo.metal, loot.metal);
  assert.ok(loot.metal <= 1200);
  assert.equal(loot.metal + destroyed.metal, reconcileExplorationContact(occupied, start + 5 * minute).claim!.cargo.metal);
  assert.equal(captured.resourceReserve.metal + captured.extractedByType.metal, contact.initialReserve.metal);
});

test('30-second recall preparation freezes production and expiry immediately releases', () => {
  let contact = occupyExplorationContact(getOrMaterializeExplorationContact(
    createExplorationState(), makeNode('unique'), 100_000).contact, arrival());
  contact = prepareExplorationRecall(contact, 'player', start + 3 * minute);
  const amount = contact.claim!.cargo.metal;
  contact = reconcileExplorationContact(contact, start + 3 * minute + 29_000);
  assert.equal(contact.claim!.cargo.metal, amount);
  assert.equal(isExplorationRecallReady(contact, start + 3 * minute + 29_000), false);
  assert.equal(isExplorationRecallReady(contact, start + 3 * minute + 30_000), true);
  contact = releaseExplorationClaim(contact, start + 3 * minute + 30_000);
  assert.equal(contact.claim, undefined);
  assert.equal(contact.events.at(-1)!.kind, 'recalled');
  assert.deepEqual(contact.events.at(-1)!.cargo!.metal, amount);
  assert.throws(() => releaseExplorationClaim(contact, start + 4 * minute));

  let expiring = occupyExplorationContact(getOrMaterializeExplorationContact(
    createExplorationState(), makeNode('anomaly'), 100_000).contact, arrival(start + 17 * minute));
  expiring = prepareExplorationRecall(expiring, start + 17 * minute + 55_000 > 0 ? 'player' : 'bad', start + 17 * minute + 55_000);
  const released = releaseExplorationClaim(expiring, start + 18 * minute);
  assert.equal(released.events.at(-1)!.kind, 'expired');
});

test('defense boost only once; draws do not award a bonus', () => {
  let contact = occupyExplorationContact(getOrMaterializeExplorationContact(
    createExplorationState(), makeNode('unique'), 100_000).contact, arrival());
  const attack = { ...arrival(start + 2 * minute, 'attacker-1'), ownerId: 'enemy' };
  const first = settleExplorationContest(contact, attack.arrivedAt, 'defender', attack, 0,
    { all: 5000, transporters: 5000, recyclers: 0 }, true, { attacker: true, defender: true }).contact;
  assert.equal(first.claim!.boostedUntilAt, start + 4 * minute);
  const second = settleExplorationContest(first, start + 3 * minute, 'defender',
    { ...attack, flightId: 'attacker-2' }, 0, { all: 5000, transporters: 5000, recyclers: 0 }, true,
    { attacker: true, defender: true }).contact;
  assert.equal(second.claim!.boostedUntilAt, first.claim!.boostedUntilAt);
  assert.equal(explorationDefenderBonusEligible(1, 9999, 300, 200), false);
  const draw = settleExplorationContest(contact, start + 2 * minute, 'draw', attack, 0,
    { all: 5000, transporters: 5000, recyclers: 0 }, true, { attacker: true, defender: true }).contact;
  assert.equal(draw.claim!.boostedUntilAt, undefined);
});

test('rare roll scales with time, deterministic, no payout at under one minute', () => {
  const profile = explorationProfile('anomaly', 10);
  assert.equal(explorationRareProbability(profile, 59_999), 0);
  assert.ok(explorationRareProbability(profile, 6 * minute) < profile.tokenP12);
  assert.equal(explorationRareProbability(profile, 12 * minute), .18);
  const first = explorationRareWon(profile, 12 * minute, 'contact', 'owner', 'claim');
  assert.equal(first, explorationRareWon(profile, 12 * minute, 'contact', 'owner', 'claim'));
  assert.equal(EXPLORATION_RULES.reconSuccess, .7);
  assert.equal(EXPLORATION_RULES.reconCooldownMs, 120_000);
});

test('completed return persists deterministic token and empty-token rewards exactly once', () => {
  const node = makeNode('anomaly');
  node.special!.profileVariant = 10;
  const baseline = getOrMaterializeExplorationContact(createExplorationState(), node, 100_000).contact;
  const profile = explorationProfile('anomaly', 10);
  const heldMs = 12 * minute + 30_000;
  const findClaim = (won: boolean) => {
    for (let index = 0; index < 2_000; index += 1) {
      const flightId = `rare-return-${index}`;
      const claimId = `${flightId}:claim`;
      if (explorationRareWon(profile, heldMs, baseline.id, 'player', claimId) === won) return flightId;
    }
    throw new Error(`Could not find a deterministic ${won ? 'token' : 'empty-token'} return seed`);
  };
  const finishReturn = (flightId: string) => {
    const occupied = occupyExplorationContact(baseline, { ...arrival(start + minute, flightId), claimId: flightId + ':claim' });
    const prepared = prepareExplorationRecall(occupied, 'player', start + 13 * minute);
    const released = releaseExplorationClaim(prepared, start + 13 * minute + 30_000);
    return completeExplorationReturn(released, flightId, start + 13 * minute + 31_000, true);
  };
  const awarded = finishReturn(findClaim(true));
  assert.equal(awarded.payout?.repairTokens, 1);
  assert.equal(awarded.contact.events.at(-1)?.repairTokens, 1);
  const empty = finishReturn(findClaim(false));
  assert.equal(empty.payout?.repairTokens, 0);
  assert.equal(empty.contact.events.at(-1)?.repairTokens, 0);
  const completedId = empty.contact.events.at(-1)!.id;
  const flightId = completedId.slice(0, -':completed'.length);
  assert.equal(completeExplorationReturn(empty.contact, flightId, start + 14 * minute, true).payout, null,
    'replaying the return cannot award a second token or cargo credit');
});

test('recon seeded, cooldown persists if caller stores reports, cannot inspect foreign ship counts', () => {
  const contact = getOrMaterializeExplorationContact(createExplorationState(), makeNode('unique'), 100_000).contact;
  const first = resolveExplorationRecon(contact, 'player', 'probe-1', start + 2 * minute, []);
  assert.equal(resolveExplorationRecon(contact, 'player', 'probe-1', start + 2 * minute, [first]).success, first.success);
  assert.throws(() => resolveExplorationRecon(contact, 'player', 'probe-2', start + 3 * minute, [first]));
  const next = resolveExplorationRecon(contact, 'player', 'probe-2', start + 4 * minute, [first]);
  assert.equal(typeof next.success, 'boolean');
  assert.equal(Object.hasOwn(next, 'enemyShips'), false);
});

test('capture total is exactly floor(30%) bounded by free cargo, with deterministic resource proportion', () => {
  const cargo = { metal: 100, minerals: 100, gas: 100, debris: 100 };
  const rich = captureExplorationCargo(cargo, 200);
  assert.equal(Object.values(rich.captured).reduce((sum, n) => sum + n, 0), 120);
  assert.equal(Object.values(rich.destroyed).reduce((sum, n) => sum + n, 0), 280);
  const small = captureExplorationCargo(cargo, 11);
  assert.equal(Object.values(small.captured).reduce((sum, n) => sum + n, 0), 11);
  assert.deepEqual(small, captureExplorationCargo(cargo, 11));
});

test('NPC chance is seeded per slot, not rerolled on render; rookie threshold is bounded', () => {
  assert.equal(explorationNpcAttempt(5, 'contact-id', 1), explorationNpcAttempt(5, 'contact-id', 1));
  assert.equal(explorationRookieProtected(90_000, 270_001), true);
  assert.equal(explorationRookieProtected(90_000, 270_000), false);
  assert.equal(explorationRookieProtected(100_000, 3_000_000), false);
});

test('save migration accepts legitimate contact; rejects forged stockpiles and keeps empty legacy save safe', () => {
  const state = getOrMaterializeExplorationContact(createExplorationState(), makeNode('unique'), 100_000).state;
  assert.deepEqual(migrateExplorationState(undefined), createExplorationState());
  const migrated = migrateExplorationState(state);
  assert.equal(Object.keys(migrated.contacts).length, 1);
  const id = Object.keys(migrated.contacts)[0]!;
  const forged = structuredClone(state);
  forged.contacts[id]!.resourceReserve.metal += 100_000;
  assert.equal(Object.keys(migrateExplorationState(forged).contacts).length, 0);
  const npcCursor = 1_800_000_000_000;
  const npcOverflow = migrateExplorationState({
    ...createExplorationState(), npcProcessedAt: npcCursor,
    npcLastSkippedInterval: { afterExclusive: npcCursor - 48 * 60 * 60_000, throughInclusive: npcCursor - 24 * 60 * 60_000 },
  });
  assert.equal(npcOverflow.npcProcessedAt, npcCursor);
  assert.deepEqual(npcOverflow.npcLastSkippedInterval, {
    afterExclusive: npcCursor - 48 * 60 * 60_000, throughInclusive: npcCursor - 24 * 60 * 60_000,
  });
  assert.equal(migrateExplorationState({ ...npcOverflow, npcLastSkippedInterval: { afterExclusive: 8, throughInclusive: 7 } })
    .npcLastSkippedInterval, undefined);
});

test('successful return pays once from origin, never on cancelled/missing origin or repeated reload', () => {
  const baseline = getOrMaterializeExplorationContact(createExplorationState(), makeNode('anomaly'), 100_000).contact;
  let active = occupyExplorationContact(baseline, arrival());
  active = prepareExplorationRecall(active, 'player', start + 14 * minute);
  active = releaseExplorationClaim(active, start + 14 * minute + 30_000);
  const settled = completeExplorationReturn(active, 'flight-1', start + 18 * minute + 30_000, true);
  assert.equal(settled.payout?.originPlanetId, 'home');
  assert.ok(settled.payout!.cargo.gas > 0);
  assert.equal(settled.contact.events.at(-1)!.kind, 'returned');
  assert.deepEqual(completeExplorationReturn(settled.contact, 'flight-1', start + 19 * minute, true).payout, null);
  assert.throws(() => completeExplorationReturn(baseline, 'unknown', start + 19 * minute, true));
  const destroyedOrigin = completeExplorationReturn(active, 'flight-1', start + 18 * minute + 30_000, false);
  assert.equal(destroyedOrigin.payout, null);
  assert.equal(destroyedOrigin.contact.events.at(-1)!.kind, 'origin-destroyed');
});

test('arrival after object expiry cannot occupy and contest closes exactly after 30 seconds', () => {
  const contact = getOrMaterializeExplorationContact(createExplorationState(), makeNode('unique'), 100_000).contact;
  assert.throws(() => occupyExplorationContact(contact, arrival(start + 18 * minute)));
  let active = occupyExplorationContact(contact, arrival());
  active = prepareExplorationRecall(active, 'player', start + 3 * minute);
  const attacker = { ...arrival(start + 3 * minute + 29_000, 'attack-29'), ownerId: 'enemy' };
  assert.doesNotThrow(() => settleExplorationContest(active, start + 3 * minute + 29_000,
    'defender', attacker, 0, { all: 5000, transporters: 5000, recyclers: 0 }, false,
    { attacker: true, defender: true }));
  assert.throws(() => settleExplorationContest(active, start + 3 * minute + 30_000,
    'defender', { ...attacker, flightId: 'attack-30' }, 0,
    { all: 5000, transporters: 5000, recyclers: 0 }, false, { attacker: true, defender: true }));
});


test('anomaly risk hazards are bounded material losses and replay/split deterministic', () => {
  const node = makeNode('anomaly');
  const contact = getOrMaterializeExplorationContact(createExplorationState(),node,100_000).contact;
  const active = occupyExplorationContact(contact, arrival(start+minute));
  const finalAt=start+15*minute;
  const whole=reconcileExplorationContact(active,finalAt);
  let split=active;
  for(let time=start+minute+30_000;time<=finalAt;time+=30_000)
    split=reconcileExplorationContact(split,time);
  assert.deepEqual(split,whole,'offline catch-up and ticking must settle identical hazard slots');
  assert.deepEqual(reconcileExplorationContact(whole,finalAt),whole,'same timestamp must not reroll hazards');
  const events=whole.events.filter(e=>e.kind==='hazard');
  assert.equal(new Set(events.map(e=>e.id)).size,events.length);
  for(const e of events) assert.ok(Object.values(e.lostCargo ?? {}).every(n=>n>=0));
  for(const key of ['metal','minerals','gas','debris'] as const)
    assert.ok(whole.resourceReserve[key]>=0 && whole.resourceReserve[key]<=contact.initialReserve[key]);
});


test('finite shared world stock is identical for rich and poor first visitors and remains frozen after capture', () => {
  const node=makeNode('unique');
  const poor=getOrMaterializeExplorationContact(createExplorationState(),node,1).contact;
  const rich=getOrMaterializeExplorationContact(createExplorationState(),node,50_000_000).contact;
  assert.deepEqual(poor.initialReserve,rich.initialReserve);
  assert.equal(poor.worldScoreAtAppearance,EXPLORATION_RULES.resourcePointsBase);
  assert.equal(rich.worldScoreAtAppearance,EXPLORATION_RULES.resourcePointsBase);
  const occupied=occupyExplorationContact(poor,arrival());
  const taken=settleExplorationContest(occupied,start+2*minute,'attacker',
    {...arrival(start+2*minute,'other-flight'),ownerId:'other'},5000,
    {all:5000,transporters:5000,recyclers:0},true,{attacker:true,defender:true}).contact;
  assert.deepEqual(taken.initialReserve,poor.initialReserve);
  assert.equal(taken.resourceReserve.metal+taken.extractedByType.metal,poor.initialReserve.metal);
});

test('three deterministic territory outcomes: attacker capture, defender holds and draw never gives bonus', () => {
  const node=makeNode('unique');
  const defender=occupyExplorationContact(
    getOrMaterializeExplorationContact(createExplorationState(),node,100_000).contact,arrival());
  const attack={...arrival(start+2*minute,'foreign-attack'),ownerId:'foreign'};
  const capacity={all:5000,transporters:5000,recyclers:0};
  const win=settleExplorationContest(defender,start+2*minute,'attacker',attack,5000,capacity,true,{attacker:true,defender:true});
  const hold=settleExplorationContest(defender,start+2*minute,'defender',attack,5000,capacity,true,{attacker:true,defender:true});
  const draw=settleExplorationContest(defender,start+2*minute,'draw',attack,5000,capacity,true,{attacker:true,defender:true});
  assert.equal(win.contact.claim?.ownerId,'foreign');
  assert.equal(hold.contact.claim?.ownerId,'player');
  assert.equal(draw.contact.claim?.ownerId,'player');
  assert.equal(hold.contact.claim?.boostedUntilAt,start+4*minute);
  assert.equal(draw.contact.claim?.boostedUntilAt,undefined);
  assert.deepEqual(win.contact.initialReserve,hold.contact.initialReserve);
  assert.equal(win.contact.events.filter(e=>e.kind==='captured').length,1);
  const captured=Object.values(win.captured).reduce((a,b)=>a+b,0);
  const enemy=reconcileExplorationContact(defender,start+2*minute).claim!.cargo;
  assert.equal(captured,Math.min(Math.floor(Object.values(enemy).reduce((a,b)=>a+b,0)*.30),5000));
});

test('zero surviving combatants release the contact while a surviving commander holds it without mining capacity', () => {
  const node = makeNode('unique');
  const occupied = occupyExplorationContact(
    getOrMaterializeExplorationContact(createExplorationState(), node, 100_000).contact, arrival());
  const attack = { ...arrival(start + 5 * minute, 'empty-field-attack'), ownerId: 'enemy' };
  const zeroCapacity = { all: 0, transporters: 0, recyclers: 0 };
  const accrued = reconcileExplorationContact(occupied, start + 5 * minute).claim!.cargo;

  const cleared = settleExplorationContest(occupied, start + 5 * minute, 'draw', attack, 0,
    zeroCapacity, false, { attacker: false, defender: false });
  assert.equal(cleared.contact.claim, undefined, 'a field with no surviving ships or commanders becomes available');
  assert.deepEqual(cleared.captured, { metal: 0, minerals: 0, gas: 0, debris: 0 });
  assert.deepEqual(cleared.destroyed, accrued, 'all undelivered defender cargo is destroyed');
  assert.deepEqual(cleared.contact.events.at(-1)?.lostCargo, accrued);

  const held = settleExplorationContest(occupied, start + 5 * minute, 'draw', attack, 0,
    zeroCapacity, false, { attacker: false, defender: true });
  assert.equal(held.contact.claim?.ownerId, 'player', 'a surviving commander retains the claim');
  assert.deepEqual(held.contact.claim?.capacity, zeroCapacity);
  assert.deepEqual(held.contact.claim?.cargo, { metal: 0, minerals: 0, gas: 0, debris: 0 });
});
