import assert from 'node:assert/strict';
import test from 'node:test';
import { NPC_FORTIFY_BALANCE } from '../../application/npc-plan-fortify.ts';
import { NPC_FORTRESS_BALANCE, npcBatteryStats } from '../../application/npc-utility.ts';
import { buildDoctrineTable } from './doctrine-table-build.ts';
import doctrineTable from './doctrine-table.v1.json' with { type: 'json' };
import { doctrineDefenceIndex, getNpcPolicy, NPC_POLICY_RANGES, setNpcPolicyOverride, validateNpcPolicy } from './policy.ts';

test('version 1 of the policy file equals the constants the code carried before it', () => {
  const policy = getNpcPolicy();
  assert.equal(policy.version >= 1, true);
  if (policy.version !== 1) return; // a later version moves the numbers on purpose
  assert.equal(NPC_FORTRESS_BALANCE.hoardDays, 0.25);
  assert.equal(NPC_FORTRESS_BALANCE.bottleneckDrive, 1.4);
  assert.deepEqual([...NPC_FORTRESS_BALANCE.scarcityRange], [0.2, 3]);
  assert.deepEqual([...NPC_FORTIFY_BALANCE.budgetDays], [0.5, 3]);
  assert.deepEqual([...NPC_FORTIFY_BALANCE.spendShare], [0.5, 0.85]);
  assert.equal(NPC_FORTIFY_BALANCE.reserveHours, 6);
  assert.deepEqual(NPC_FORTIFY_BALANCE.styleCap, NPC_FORTIFY_BALANCE.baseStyleCap);
  assert.equal(policy.params.tableWeight, 0);
});

test('a policy outside the allowed ranges, or missing a number, is rejected rather than clamped', () => {
  const good = { version: 2, params: Object.fromEntries(Object.entries(NPC_POLICY_RANGES).map(([key, [low]]) => [key, low])) };
  assert.equal(validateNpcPolicy(good).version, 2);
  assert.throws(() => validateNpcPolicy({ ...good, params: { ...good.params, hoardDays: 9 } }), /hoardDays/);
  assert.throws(() => validateNpcPolicy({ ...good, params: { ...good.params, reserveHours: Number.NaN } }), /reserveHours/);
  assert.throws(() => validateNpcPolicy({ version: 0, params: good.params }), /version/);
  const { tableWeight: _drop, ...missing } = good.params;
  assert.throws(() => validateNpcPolicy({ version: 1, params: missing }), /tableWeight/);
});

test('the lab override changes the numbers the game reads, and null restores the shipped file', () => {
  const shipped = getNpcPolicy();
  try {
    setNpcPolicyOverride({ version: 99, params: { ...shipped.params, scarcityHigh: 5, styleCapRaise: 0.5, tableWeight: 1 } });
    assert.equal(NPC_FORTRESS_BALANCE.scarcityRange[1], 5);
    assert.equal(NPC_FORTIFY_BALANCE.styleCap.raider, 8_000 + Math.round(0.5 * (25_000 - 8_000)));
    assert.equal(NPC_FORTIFY_BALANCE.styleCap.fortress, 25_000);
    assert.equal(NPC_FORTIFY_BALANCE.baseStyleCap.raider, 8_000);
  } finally {
    setNpcPolicyOverride(null);
  }
  assert.equal(getNpcPolicy().version, shipped.version);
});

test('the doctrine table counts in the battery ranking only when the policy says so', () => {
  const shipped = getNpcPolicy();
  const off = npcBatteryStats('aegis').map((row) => row.id);
  try {
    setNpcPolicyOverride({ version: 99, params: { ...shipped.params, tableWeight: 1 } });
    const on = npcBatteryStats('aegis');
    assert.equal(on.length, off.length);
    assert.equal(on[0]!.id, 'ion-plasma-battery');
    assert.equal(doctrineDefenceIndex('aegis', 'ion-plasma-battery'), 1);
    assert.equal(doctrineDefenceIndex('aegis', 'ballistic-turret'), 0);
    assert.equal(doctrineDefenceIndex('aegis', 'no-such-turret'), 1);
  } finally {
    setNpcPolicyOverride(null);
  }
  assert.deepEqual(npcBatteryStats('aegis').map((row) => row.id), off);
});

test('the shipped doctrine table is what the combat engine says today', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(buildDoctrineTable())), doctrineTable);
});
