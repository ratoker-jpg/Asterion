import assert from 'node:assert/strict';
import test from 'node:test';

import { DEMO_BATTLE_REPORTS } from '../combat/battle-fixtures.ts';
import { getFactionCombatEntity, getFactionShipCatalog } from '../combat/faction-catalog.ts';
import type { BattleReport } from '../combat/report.ts';
import type { SpyReportSnapshot } from '../espionage/types.ts';
import { battleBalance, durationLabel, transportsLabel, formatShortAmount, formatSignedAmount, extractionYield, reportRowValue, spyRaid, timesLabel } from './headline.ts';
import { gasExtractionArrivalReportToReportItem } from './adapters.ts';
import type { ReportItem } from './types.ts';

const NBSP = '\u00a0';
const plain = (text: string) => text.replace(/[\u00a0\u202f]/g, ' ');

test('short amounts never break mid-digits and keep the unit glued', () => {
  assert.equal(plain(formatShortAmount(48_250)), '48 250');
  assert.equal(plain(formatShortAmount(780_000)), '780 тыс');
  assert.equal(plain(formatShortAmount(1_234_567)), '1,2 млн');
  assert.equal(plain(formatShortAmount(987_654_321_098)), '988 млрд');
  assert.equal(plain(formatShortAmount(999_999_999_999)), '1 000 млрд');
  assert.equal(plain(formatShortAmount(1_200_000_000_000)), '1,2 трлн');
  assert.equal(plain(formatSignedAmount(-47_000_000_000)), '−47 млрд');
  assert.equal(formatSignedAmount(0), '0');
  for (const value of [48_250, 780_000, 987_654_321_098, 12_345_678_901_234]) assert.doesNotMatch(formatShortAmount(value), / /, 'no breaking space');
  assert.ok(formatShortAmount(1_500_000).includes(NBSP));
});

test('«в N раз» is spelled for the risk plaque', () => {
  assert.equal(plain(timesLabel(2.4)), '2,4 раза');
  assert.equal(plain(timesLabel(2)), '2 раза');
  assert.equal(plain(timesLabel(5)), '5 раз');
  assert.equal(plain(timesLabel(12.3)), '12 раз');
  assert.equal(plain(timesLabel(40_123_555_511)), '40,1 млрд раз');
});

function cost(factionId: 'aegis' | 'synod' | 'veyra', id: string) {
  const unit = getFactionCombatEntity(factionId, id as never).cost;
  return unit.metal + unit.minerals + unit.gas;
}

test('battle profit = loot − the cost of own losses, from the player side', () => {
  const report = DEMO_BATTLE_REPORTS.find((item) => item.id === 'battle-demo-attacker-victory')!;
  const loot = (report.resources?.metal ?? 0) + (report.resources?.minerals ?? 0) + (report.resources?.gas ?? 0);
  const ownLoss = [...report.attackerForce.stacks, ...(report.attackerForce.defenses ?? [])]
    .reduce((total, stack) => total + stack.destroyed * cost('aegis', stack.entityId), 0);
  const asAttacker = battleBalance(report, (id) => id === report.attacker.playerId);
  assert.equal(asAttacker.side, 'attacker');
  assert.equal(asAttacker.loot, loot);
  assert.ok(ownLoss > 0, 'the fixture loses ships');
  assert.equal(asAttacker.ownLoss, ownLoss);
  assert.equal(asAttacker.profit, loot - ownLoss);

  // The defender lost the loot and its own units.
  const asDefender = battleBalance(report, (id) => id === report.defender.playerId);
  assert.equal(asDefender.side, 'defender');
  assert.equal(asDefender.profit, -loot - asDefender.ownLoss);

  const row = reportRowValue({ id: `battle:${report.id}` } as ReportItem, report, { isMine: (id) => id === report.attacker.playerId });
  assert.equal(row?.amount, loot - ownLoss);
  assert.equal(row?.tone, loot - ownLoss > 0 ? 'success' : loot - ownLoss < 0 ? 'danger' : 'neutral');
});

test('a battle with pirates counts no price for pirate ships', () => {
  const base = DEMO_BATTLE_REPORTS[0]!;
  const report: BattleReport = { ...base, attacker: { ...base.attacker, race: 'pirates', playerId: 'pirates' }, resources: { metal: 10, minerals: 0, gas: 0 } };
  const balance = battleBalance(report, (id) => id === base.defender.playerId);
  assert.equal(balance.side, 'defender');
  assert.equal(balance.enemyLoss, 0);
});

const spy = (overrides: Partial<SpyReportSnapshot> = {}): SpyReportSnapshot => ({
  id: 'spy-1', missionId: 'm', createdAt: 0, sourcePlanetId: 'helion-01', targetPlanetId: 'target', targetPlanetName: 'Тавр',
  targetOwnerId: 'npc', targetOwnerName: 'Адмирал', targetRaceId: 'synod', targetRelation: 'enemy',
  targetCoordinate: { galaxy: 1, system: 2, position: 3 }, spyLevel: 5, targetEspionageLevel: 1, delta: 4, roll: 0, quality: 'full',
  resources: { metal: 1_000_000, minerals: 400_000, gas: 0, debris: 0, developmentEnergy: 0 }, firstReport: false,
  ...overrides,
} as SpyReportSnapshot);

test('spy: what one raid may take, and how many of the biggest hold carry it', () => {
  const raid = spyRaid(spy(), { playerFactionId: 'aegis' });
  assert.equal(raid.lootable, 750_000 + 300_000);
  // The big transport, not a warship with a bigger hold.
  const hold = getFactionShipCatalog('aegis').find((ship) => ship.id === 'mega-transporter')!;
  assert.deepEqual(raid.transports, { count: Math.ceil(1_050_000 / hold.ship!.cargo), shipName: hold.name });
  // Protected stores: with buildings known, a small stock under the protected part stays (base storage protects 10 000).
  const small = spy({ resources: { metal: 5_000, minerals: 0, gas: 0, debris: 0, developmentEnergy: 0 } });
  assert.equal(spyRaid(small, { playerFactionId: 'aegis' }).lootable, 3_750);
  assert.equal(spyRaid(small, { playerFactionId: 'aegis', targetBuildings: () => ({}) }).lootable, 0);
});

test('spy risk: their fleet and defence against the player’s attack', () => {
  const report = spy({ fleet: { cruiser: 100 } as never, defense: {} });
  const attack = 100 * (getFactionCombatEntity('synod', 'cruiser').combat.attack);
  assert.equal(spyRaid(report, { ownFleetAttack: attack / 2 }).ratio, 2);
  assert.equal(spyRaid(spy({ quality: 'basic' }), { ownFleetAttack: 1 }).targetAttack, null);
  assert.equal(spyRaid(report, {}).ratio, null);
});

test('gas extraction: gas is the number, the scrap rides along', () => {
  const item = gasExtractionArrivalReportToReportItem({ id: 'gas-extraction-arrival:f', flightId: 'f', coordinate: { galaxy: 1, system: 2, position: 3 }, arrivalAt: 0, outcome: 'found', gasCollected: 48_250, scrapCollected: 1_200 });
  assert.deepEqual(extractionYield(item), { gas: 48_250, scrap: 1_200 });
  assert.equal(reportRowValue(item, null)?.amount, 48_250);
});

test('a letter waiting for an answer shows its deadline, an old one does not', () => {
  const deadlineAt = Date.UTC(2026, 10, 12, 15, 2);
  const item = { id: 'letter:x', letter: { deadlineAt } } as unknown as ReportItem;
  const live = reportRowValue(item, null, { now: deadlineAt - 60_000 });
  assert.equal(live?.tone, 'warning');
  assert.match(live?.text ?? '', /^до \d\d:\d\d$/);
  assert.equal(reportRowValue(item, null, { now: deadlineAt + 1 }), null);
});

test('transports read as a short number with the right plural', () => {
  assert.equal(plain(transportsLabel(1, 'Мегатранспорт')), 'нужно 1 транспорт «Мегатранспорт»');
  assert.equal(plain(transportsLabel(3, 'Мегатранспорт')), 'нужно 3 транспорта «Мегатранспорт»');
  assert.equal(plain(transportsLabel(24_600, 'Мегатранспорт')), 'нужно 24 600 транспортов «Мегатранспорт»');
  assert.equal(plain(transportsLabel(100_000_000, 'Мегатранспорт')), 'нужно 100 млн транспортов «Мегатранспорт»');
});

test('flight time for the nearest-fleet plaque', () => {
  assert.equal(plain(durationLabel(41 * 60_000)), '41 мин');
  assert.equal(plain(durationLabel(80 * 60_000)), '1 ч 20 мин');
  assert.equal(plain(durationLabel(120 * 60_000)), '2 ч');
});
