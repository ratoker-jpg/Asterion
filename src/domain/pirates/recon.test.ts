import assert from 'node:assert/strict';
import test from 'node:test';
import { createPirateProfile } from './profile.ts';
import {
  canDispatchPirateRecon,
  createPirateReconMissionSnapshot,
  normalizePirateReconMissionSnapshot,
  pirateReconCooldownKey,
  pirateReconOutcomeForMission,
  PIRATE_RECON_COOLDOWN_MS,
} from './recon.ts';
import {
  createPirateReconReport,
  normalizePirateReconReport,
  pirateReconReportToReportItem,
  upsertPirateReconReport,
} from './recon-report.ts';

const COORDINATE = Object.freeze({ galaxy: 2, system: 14, position: 8 });
const CYCLE_A = 'pirate-cycle-v1:2:14:5:1000';
const CYCLE_B = 'pirate-cycle-v1:2:14:6:2000';

function mission(missionId: string, cycleKey = CYCLE_A, ownerId = 'owner-1', dispatchedAt = 10_000) {
  return createPirateReconMissionSnapshot({ missionId, ownerId, contactCycleKey: cycleKey, dispatchedAt });
}

function profile(ownerId = 'owner-1', cycleKey = CYCLE_A) {
  const resourcePoints = 800_000;
  const battlePoints = 200_000;
  return createPirateProfile({
    ownerId,
    contactCycleKey: cycleKey,
    score: { resourcePoints, battlePoints, totalPoints: resourcePoints + battlePoints },
  });
}

function findMissionForOutcome(outcome: 'success' | 'failure', cycleKey = CYCLE_A) {
  for (let index = 0; index < 100; index += 1) {
    const candidate = mission(`mission-${outcome}-${index}`, cycleKey);
    if (pirateReconOutcomeForMission(candidate) === outcome) return candidate;
  }
  throw new Error(`No deterministic ${outcome} seed found in bounded search.`);
}

function wilson95(successes: number, total: number) {
  const z = 1.96;
  const p = successes / total;
  const denominator = 1 + z * z / total;
  const center = (p + z * z / (2 * total)) / denominator;
  const margin = z * Math.sqrt((p * (1 - p) + z * z / (4 * total)) / total) / denominator;
  return { low: center - margin, high: center + margin };
}

test('pirate recon produces a deterministic persisted draw with 70/30 success and failure rates', (t) => {
  const total = 10_000;
  let successes = 0;
  for (let index = 0; index < total; index += 1) {
    const first = mission(`ci-seed-${index}`);
    const replay = mission(`ci-seed-${index}`);
    assert.equal(replay.roll, first.roll);
    assert.equal(normalizePirateReconMissionSnapshot(first)?.roll, first.roll);
    successes += pirateReconOutcomeForMission(first) === 'success' ? 1 : 0;
  }
  const interval = wilson95(successes, total);
  t.diagnostic(`seeded recon sample: ${successes}/${total} successful; 95% Wilson CI ${(interval.low * 100).toFixed(2)}%–${(interval.high * 100).toFixed(2)}%`);
  assert.ok(interval.low <= 0.7 && interval.high >= 0.7, 'the expected 70% success rate must lie in the sample 95% interval');
  assert.ok(successes / total >= 0.69 && successes / total <= 0.71, 'seeded rate must remain within one percentage point of 70%');
  assert.equal(normalizePirateReconMissionSnapshot({ ...mission('tampered'), roll: 0.99 }), null);
});

test('cooldown is per owner and exact contact cycle, with one outbound probe at a time', () => {
  assert.equal(PIRATE_RECON_COOLDOWN_MS, 120_000);
  assert.equal(pirateReconCooldownKey('owner', CYCLE_A), pirateReconCooldownKey('owner', CYCLE_A));
  assert.notEqual(pirateReconCooldownKey('owner', CYCLE_A), pirateReconCooldownKey('owner', CYCLE_B));
  assert.notEqual(pirateReconCooldownKey('owner', CYCLE_A), pirateReconCooldownKey('other-owner', CYCLE_A));

  const dispatchAt = 50_000;
  assert.deepEqual(canDispatchPirateRecon({
    ownerId: 'owner', contactCycleKey: CYCLE_A, now: dispatchAt + 119_999,
    lastDispatchAt: dispatchAt, inFlight: false,
  }), { allowed: false, reason: 'cooldown', availableAt: dispatchAt + 120_000 });
  assert.deepEqual(canDispatchPirateRecon({
    ownerId: 'owner', contactCycleKey: CYCLE_A, now: dispatchAt + 120_000,
    lastDispatchAt: dispatchAt, inFlight: false,
  }), { allowed: true });
  assert.deepEqual(canDispatchPirateRecon({
    ownerId: 'owner', contactCycleKey: CYCLE_A, now: dispatchAt + 120_000,
    lastDispatchAt: dispatchAt, inFlight: true,
  }), { allowed: false, reason: 'in-flight' });
  assert.deepEqual(canDispatchPirateRecon({
    ownerId: 'owner', contactCycleKey: CYCLE_B, now: dispatchAt,
    inFlight: false,
  }), { allowed: true });
  assert.deepEqual(canDispatchPirateRecon({
    ownerId: 'other-owner', contactCycleKey: CYCLE_A, now: dispatchAt,
    inFlight: false,
  }), { allowed: true });
  assert.deepEqual(canDispatchPirateRecon({
    ownerId: 'owner', contactCycleKey: CYCLE_A, now: dispatchAt,
    lastDispatchAt: Number.MAX_SAFE_INTEGER, inFlight: false,
  }), { allowed: true });
});

test('success report contains only the allowed ship composition and ship level', () => {
  const selectedMission = findMissionForOutcome('success');
  const report = createPirateReconReport({
    mission: selectedMission,
    coordinate: COORDINATE,
    arrivedAt: selectedMission.dispatchedAt + 40_000,
    profile: profile(),
    currentContactCycleKey: CYCLE_A,
  });
  assert.equal(report.outcome, 'success');
  assert.ok(report.intel);
  assert.equal(report.intel.ships.reduce((sum, ship) => sum + ship.populationPercent, 0), 100);
  assert.deepEqual(report.intel.ships.map((ship) => ship.name), report.intel.ships.map((ship) => ship.name).filter((name) => [
    'Гончий', 'Налётчик', 'Капер', 'Палач', 'Потрошитель', 'Громила',
  ].includes(name)));
  assert.ok(report.intel.ships.every((ship) => ship.populationPercent > 0));
  assert.deepEqual(Object.keys(report.intel).sort(), ['shipLevel', 'ships']);
  assert.equal(JSON.stringify(report).includes('Погибель'), false);
  assert.equal(JSON.stringify(report).includes('tier'), false);
  assert.equal(JSON.stringify(report).includes('count'), false);
  assert.equal(JSON.stringify(report).toLowerCase().includes('технолог'), false);
  assert.equal(normalizePirateReconReport(report)?.id, report.id);
  const item = pirateReconReportToReportItem(report);
  assert.equal(item.source, 'pirate-recon');
  assert.equal(item.pirateReconReport.id, report.id);
  assert.equal(JSON.stringify(item).toLowerCase().includes('технолог'), false);
  assert.ok(item.details.some(({ label }) => label === 'Уровень кораблей'));
  assert.ok(!item.details.some(({ label }) => label.toLowerCase().includes('технолог')));

  const legacyReportWithTechnologies = {
    ...report,
    intel: { ...report.intel, technologyLevel: 8, appliedTechnologies: [{ name: 'Лазерная наука', level: 8 }] },
  };
  const normalizedLegacy = normalizePirateReconReport(legacyReportWithTechnologies);
  assert.ok(normalizedLegacy?.intel);
  assert.deepEqual(Object.keys(normalizedLegacy.intel).sort(), ['shipLevel', 'ships']);
  assert.equal(JSON.stringify(normalizedLegacy).toLowerCase().includes('технолог'), false);
  assert.equal(JSON.stringify(normalizedLegacy).includes('Лазерная наука'), false);
});

test('failure and stale-cycle reports reveal no profile data and remain readable as history', () => {
  const failedMission = findMissionForOutcome('failure');
  const failed = createPirateReconReport({
    mission: failedMission,
    coordinate: COORDINATE,
    arrivedAt: failedMission.dispatchedAt + 40_000,
    profile: profile(),
    currentContactCycleKey: CYCLE_A,
  });
  assert.equal(failed.outcome, 'failure');
  assert.equal('intel' in failed, false);
  assert.equal(normalizePirateReconReport(failed)?.outcome, 'failure');

  const successfulMission = findMissionForOutcome('success');
  const noTarget = createPirateReconReport({
    mission: successfulMission,
    coordinate: COORDINATE,
    arrivedAt: successfulMission.dispatchedAt + 40_000,
    profile: profile(),
    currentContactCycleKey: CYCLE_B,
  });
  assert.equal(noTarget.outcome, 'no-target');
  assert.equal('intel' in noTarget, false);
  const reloadedHistory = normalizePirateReconReport(JSON.parse(JSON.stringify(noTarget)));
  assert.equal(reloadedHistory?.contactCycleKey, CYCLE_A);
  assert.equal(reloadedHistory?.outcome, 'no-target');
  assert.equal(pirateReconReportToReportItem(noTarget).body.includes('По указанным координатам планеты пиратов не обнаружено'), true);

  const leakingFailure = { ...failed, intel: { ships: [], shipLevel: 0 } };
  assert.equal(normalizePirateReconReport(leakingFailure), null);
  const invalidPercent = {
    ...noTarget,
    outcome: 'success',
    intel: { ships: [{ name: 'Погибель', populationPercent: 100 }], shipLevel: 1 },
  };
  assert.equal(normalizePirateReconReport(invalidPercent), null);
});

test('report upsert is mission-idempotent and retains reports from earlier cycles', () => {
  const oldMission = findMissionForOutcome('success', CYCLE_A);
  const oldReport = createPirateReconReport({
    mission: oldMission, coordinate: COORDINATE, arrivedAt: oldMission.dispatchedAt + 40_000,
    profile: profile(), currentContactCycleKey: CYCLE_A,
  });
  const nextCycleMission = findMissionForOutcome('failure', CYCLE_B);
  const nextCycleReport = createPirateReconReport({
    mission: nextCycleMission, coordinate: COORDINATE, arrivedAt: nextCycleMission.dispatchedAt + 40_000,
    currentContactCycleKey: CYCLE_B,
  });
  const first = upsertPirateReconReport([], oldReport);
  const duplicate = upsertPirateReconReport(first, { ...oldReport, arrivedAt: oldReport.arrivedAt + 1 });
  const retained = upsertPirateReconReport(duplicate, nextCycleReport);
  assert.equal(duplicate.length, 1);
  assert.equal(duplicate[0]?.arrivedAt, oldReport.arrivedAt + 1);
  assert.deepEqual(retained.map((report) => report.contactCycleKey), [CYCLE_A, CYCLE_B]);
  assert.equal(normalizePirateReconReport(oldReport)?.contactCycleKey, CYCLE_A);
});

test('report normalization requires nonempty identities and a canonical coordinate-matched cycle', () => {
  const selectedMission = findMissionForOutcome('success');
  const valid = createPirateReconReport({
    mission: selectedMission,
    coordinate: COORDINATE,
    arrivedAt: selectedMission.dispatchedAt + 40_000,
    profile: profile(),
    currentContactCycleKey: CYCLE_A,
  });
  assert.equal(normalizePirateReconReport(valid)?.id, valid.id);

  assert.equal(normalizePirateReconReport({ ...valid, missionId: '', id: 'pirate-recon:' }), null);
  assert.equal(normalizePirateReconReport({ ...valid, ownerId: '  ' }), null);
  assert.equal(normalizePirateReconReport({ ...valid, contactCycleKey: 'cycle-5' }), null);
  assert.equal(normalizePirateReconReport({
    ...valid,
    coordinate: { ...COORDINATE, galaxy: 3 },
  }), null);
  assert.equal(normalizePirateReconReport({
    ...valid,
    coordinate: { ...COORDINATE, system: 41 },
  }), null);
  assert.equal(normalizePirateReconReport({
    ...valid,
    coordinate: { ...COORDINATE, position: 25 },
  }), null);
});
