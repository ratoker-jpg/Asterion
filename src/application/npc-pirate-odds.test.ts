import assert from 'node:assert/strict';
import test from 'node:test';
import { technologiesFromScience } from './attack.ts';
import { estimateNpcPirateOdds, NPC_PIRATE_MIN_POWER_RATIO, npcPirateGarrisonPowerPerPopulation } from './npc-pirate-odds.ts';
import type { PirateReconReport } from '../domain/pirates/recon-report.ts';

const report = (shipLevel = 3): PirateReconReport => ({
  id: 'pirate-recon:test', missionId: 'm', ownerId: 'o', contactCycleKey: 'pirate-cycle-v1:1:2:0:1', dispatchedAt: 0, arrivedAt: 1,
  coordinate: { galaxy: 1, system: 2, position: 1 }, outcome: 'success',
  intel: { shipLevel, ships: [
    { name: 'Гончий', populationPercent: 30 }, { name: 'Налётчик', populationPercent: 60 },
    { name: 'Палач', populationPercent: 5 }, { name: 'Громила', populationPercent: 5 }] },
} as PirateReconReport);

const base = {
  raceId: 'aegis' as const, technologies: technologiesFromScience({}), report: report(), resourcePoints: 0,
  shipLevels: { battleship: 10, cruiser: 2 },
};

test('a recon without intel gives no odds', () => {
  assert.equal(npcPirateGarrisonPowerPerPopulation({ ...report(), outcome: 'no-target', intel: undefined } as PirateReconReport, 0), null);
  assert.equal(estimateNpcPirateOdds({ ...base, free: { battleship: 5 }, report: { ...report(), intel: undefined } as PirateReconReport }), null);
});

test('odds follow the ship mix, not the size of the fleet', () => {
  const small = estimateNpcPirateOdds({ ...base, free: { battleship: 3 } })!;
  const large = estimateNpcPirateOdds({ ...base, free: { battleship: 300 } })!;
  assert.ok(Math.abs(small.ratio - large.ratio) / small.ratio < 0.02, `the garrison grows with the fleet: ${small.ratio} vs ${large.ratio}`);
  assert.equal(small.ready, large.ready);
});

test('ships that only enlarge the garrison stay at home', () => {
  const odds = estimateNpcPirateOdds({ ...base, shipLevels: { battleship: 10 }, free: { cruiser: 60, battleship: 3 } })!;
  assert.equal(odds.ready, true);
  assert.equal(odds.ships.battleship, 3);
  assert.ok((odds.ships.cruiser ?? 0) < 60, 'the dead weight of the cruisers does not all go');
  assert.ok(odds.fullRatio < NPC_PIRATE_MIN_POWER_RATIO, 'the whole fleet would have lost on paper');
  assert.ok(odds.ratio >= NPC_PIRATE_MIN_POWER_RATIO);
});

test('a fleet that loses to the scouted garrison is not ready', () => {
  const weak = estimateNpcPirateOdds({ ...base, shipLevels: {}, free: { cruiser: 40 } })!;
  assert.equal(weak.ready, false);
  assert.ok(weak.ratio < NPC_PIRATE_MIN_POWER_RATIO);
});

test('stronger pirates (higher ship level, more points) lower the odds', () => {
  const easy = estimateNpcPirateOdds({ ...base, free: { battleship: 10 } })!;
  const hard = estimateNpcPirateOdds({ ...base, free: { battleship: 10 }, report: report(8), resourcePoints: 3_000_000 })!;
  assert.ok(hard.ratio < easy.ratio);
});
