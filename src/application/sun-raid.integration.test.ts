import assert from 'node:assert/strict';
import test from 'node:test';

import { TEST_ALLY_OWNER_ID, TEST_BOT_OWNER_ID } from '../domain/command/catalog.ts';
import { leaveAlliance } from '../domain/command/membership.ts';
import { selectOwnerMembership } from '../domain/command/selectors.ts';
import { getSunEfficiencyPercent } from '../domain/energy/runtime.ts';
import { SOLAR_CRYSTAL_IDS } from '../domain/sun-raid/config.ts';
import { addCrystal, projectSun, readSun } from '../domain/sun-raid/rules.ts';
import type { ShipId } from '../domain/combat/ids.ts';
import { replacePlanetState, type SaveState } from './contracts.ts';
import { startBot01GateAssault } from './flights.ts';
import { createInitialSaveState, createPersistenceFacade } from './persistence.ts';
import { reconcileRuntime } from './reconcile.ts';
import {
  currentSunRaidState,
  launchSunRaid,
  previewSunLaunch,
  reconcileSunRaids,
  selectGateContext,
  selectIncomingSunAlerts,
  sendSunSupport,
  startGateConstruction,
  testBot01DefendSun,
  testBot01RaidSun,
  testGrantCrystal,
  testIraJoinRaid,
  testIraSupportSun,
} from './sun-raid.ts';

const HOUR = 60 * 60 * 1000;
const T0 = Date.UTC(2026, 9, 1, 12);
const options = (now: number) => ({ now, mode: 'test' as const, testTimeScale: 1 as const });

function memoryStorage() {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
}

function armed(state: SaveState, ships: Partial<Record<ShipId, number>> = { cruiser: 400, battleship: 120 }): SaveState {
  const planet = state.planets['helion-01']!;
  // A big hangar keeps the test fleet out of the overpopulation burn.
  return replacePlanetState(state, 'helion-01', {
    ...planet,
    buildings: { ...planet.buildings, hangar: Math.max(planet.buildings.hangar ?? 0, 40) },
    fleet: { ...planet.fleet, ships: { ...planet.fleet.ships, ...ships } },
  });
}

function tick(state: SaveState, now: number): SaveState {
  return reconcileRuntime(state, { planetId: state.currentPlanetId, now, mode: 'test', testTimeScale: 1 }).state;
}

function ok<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
  if (!result.ok) assert.fail(`expected ok: ${JSON.stringify((result as { error?: unknown }).error)}`);
  return result as Extract<T, { ok: true }>;
}

test('Bot 01 raids the home Sun: the galaxy is warned, the player defends and gets a report', () => {
  let state = armed(createInitialSaveState('test', T0));
  state = ok(testBot01RaidSun(state, 1, 1, options(T0))).state;
  const raid = currentSunRaidState(state).raids[0]!;
  assert.equal(raid.allianceId, selectOwnerMembership(state.command, TEST_BOT_OWNER_ID)!.alliance.id);
  assert.equal(raid.arrivesAt, T0 + 3 * HOUR, 'raids always take 3 h');
  assert.equal(selectIncomingSunAlerts(state, T0 + HOUR).length, 1);

  const preview = previewSunLaunch(state, { kind: 'support', galaxy: 1, system: 1, raidId: raid.id, originPlanetId: 'helion-01', ships: { cruiser: 400, battleship: 120 } }, options(T0 + HOUR));
  assert.equal(preview.error, null);
  assert.ok(preview.population > 0 && preview.population <= preview.remaining);
  state = ok(sendSunSupport(state, { raidId: raid.id, originPlanetId: 'helion-01', ships: { cruiser: 400, battleship: 120 }, requestId: 'support-1' }, options(T0 + HOUR))).state;
  state = ok(testIraSupportSun(state, raid.id, options(T0 + HOUR))).state;

  // Reload while everyone is in the air: the flights and raid survive unchanged.
  const storage = memoryStorage();
  const facade = createPersistenceFacade({ mode: 'test', storage, now: () => T0 + 2 * HOUR, testTimeScale: 1 });
  assert.equal(facade.write(state).ok, true);
  const reloaded = facade.read();
  assert.equal(reloaded.flights.records.filter((flight) => flight.missionId === 'sun-support').length, 2);
  assert.equal(reloaded.flights.records.filter((flight) => flight.missionId === 'sun-attack').length, 1);
  assert.deepEqual(currentSunRaidState(reloaded).raids, currentSunRaidState(state).raids);

  const resolvedA = tick(reloaded, T0 + 3 * HOUR + 1);
  const resolvedB = tick(state, T0 + 3 * HOUR + 1);
  const resultA = currentSunRaidState(resolvedA).raids[0]!.result!;
  assert.deepEqual(resultA, currentSunRaidState(resolvedB).raids[0]!.result, 'reload never changes the outcome');
  assert.equal(resultA.defenders, 2);
  const report = resolvedA.combat.reports.find((item) => item.id === resultA.reportId)! as unknown as { sunRaid: { brightnessBefore: number }; attacker: { playerName: string } };
  assert.ok(report, 'the defending player receives the battle report');
  assert.equal(report.sunRaid.brightnessBefore, 70);
  if (resultA.winner === 'attacker') assert.equal(resultA.brightnessAfter, 65);
  else assert.equal(resultA.brightnessAfter, 70);
  assert.ok(resolvedA.flights.records.filter((flight) => flight.missionId === 'sun-support').every((flight) => flight.phase === 'returning' || flight.phase === 'completed'));
});

test('the player alliance raids an undefended Sun: automatic victory, -5 brightness, deterministic crystal, one raid at a time', () => {
  let state = armed(createInitialSaveState('test', T0));
  const ships = { cruiser: 100 };
  state = ok(launchSunRaid(state, { galaxy: 1, system: 20, originPlanetId: 'helion-01', ships, requestId: 'raid-1' }, options(T0))).state;
  const blocked = launchSunRaid(state, { galaxy: 1, system: 21, originPlanetId: 'helion-01', ships, requestId: 'raid-2' }, options(T0 + 1));
  assert.equal(blocked.ok, false, 'one alliance, one raid');

  state = tick(state, T0 + 3 * HOUR);
  const raid = currentSunRaidState(state).raids[0]!;
  assert.equal(raid.result?.winner, 'attacker');
  assert.equal(raid.result?.brightnessBefore, 100);
  assert.equal(raid.result?.brightnessAfter, 95);
  assert.equal(getSunEfficiencyPercent(20, 1), 95, 'energy now reads the dimmed Sun');
  assert.equal(launchSunRaid(state, { galaxy: 1, system: 21, originPlanetId: 'helion-01', ships, requestId: 'raid-2' }, options(T0 + 4 * HOUR)).ok, false, 'fleet still flying home');
  state = tick(state, T0 + 6 * HOUR);
  assert.ok(currentSunRaidState(state).raids[0]!.closedAt);
  assert.equal(launchSunRaid(state, { galaxy: 1, system: 21, originPlanetId: 'helion-01', ships, requestId: 'raid-2' }, options(T0 + 6 * HOUR)).ok, true);
  const roll = raid.result?.crystalRoll;
  assert.ok(roll && roll.chance === 0.7);
  const holderKey = `alliance:${selectOwnerMembership(state.command, state.profile.playerId)!.alliance.id}`;
  assert.deepEqual(currentSunRaidState(state).crystals[holderKey] ?? [], roll.success ? [roll.crystal] : []);
});

test('nine wins freeze a Sun at 25%, attacks are refused, recovery returns it to base', () => {
  let state = armed(createInitialSaveState('test', T0));
  let now = T0;
  for (let index = 0; index < 9; index += 1) {
    state = ok(launchSunRaid(state, { galaxy: 1, system: 3, originPlanetId: 'helion-01', ships: { cruiser: 50 }, requestId: `freeze-${index}` }, options(now))).state;
    now += 6 * HOUR;
    state = tick(state, now);
  }
  const frozenAt = now - 3 * HOUR;
  const last = currentSunRaidState(state).raids.at(-1)!.result!;
  assert.equal(last.brightnessAfter, 25);
  assert.equal(last.frozen, true);
  assert.equal(currentSunRaidState(state).raids.filter((raid) => raid.result?.winner === 'attacker').length, 9);
  // Reconciled right at the freeze, another alliance is refused…
  const fresh = createInitialSaveState('test', frozenAt);
  const frozenState = { ...fresh, sunRaid: { ...currentSunRaidState(fresh), suns: { '1:3': { ...readSun(currentSunRaidState(state), 1, 3), brightness: 25, recoveryStartedAt: frozenAt, recoveryStepMs: 2 * HOUR } } } };
  assert.equal(testBot01RaidSun(frozenState, 1, 3, options(frozenAt + 1)).ok, false);
  // …and may attack again once the first +5 step lands.
  assert.equal(projectSun(readSun(currentSunRaidState(frozenState), 1, 3), frozenAt + 2 * HOUR).brightness, 30);
  const thawed = testBot01RaidSun(frozenState, 1, 3, options(frozenAt + 2 * HOUR));
  assert.equal(thawed.ok, true, thawed.ok ? '' : thawed.error);
  const later = tick(state, frozenAt + 9 * 2 * HOUR);
  assert.equal(projectSun(readSun(currentSunRaidState(later), 1, 3), frozenAt + 9 * 2 * HOUR).brightness, 70, 'back to the base efficiency');
});

test('Ira joins the raid, Bot 01 defends: one battle, both sides merged, max technologies', () => {
  let state = armed(createInitialSaveState('test', T0));
  state = ok(launchSunRaid(state, { galaxy: 1, system: 5, originPlanetId: 'helion-01', ships: { cruiser: 200 }, requestId: 'joint' }, options(T0))).state;
  const raid = currentSunRaidState(state).raids[0]!;
  state = ok(testIraJoinRaid(state, raid.id, options(T0 + 10))).state;
  state = ok(testBot01DefendSun(state, raid.id, options(T0 + 20))).state;
  const attackers = state.flights.records.filter((flight) => flight.sunRaid?.raidId === raid.id && flight.sunRaid.side === 'attacker');
  assert.equal(attackers.length, 2);
  assert.ok(attackers.every((flight) => flight.arrivalAt === raid.arrivesAt), 'joiners share the rally departure');
  state = tick(state, raid.arrivesAt);
  const result = currentSunRaidState(state).raids[0]!.result!;
  assert.equal(result.defenders, 1);
  const report = state.combat.reports.find((item) => item.id === result.reportId)!;
  assert.match(report.attacker.playerName, /\+1/);
  // Bot 01's ships came off its planet; survivors are restored when they fly home.
  const after = tick(state, raid.arrivesAt + 12 * HOUR);
  assert.ok(after.flights.records.filter((flight) => flight.sunRaid?.raidId === raid.id).every((flight) => flight.phase === 'completed'));
  assert.ok(selectOwnerMembership(after.command, TEST_ALLY_OWNER_ID));
});

test('four crystals → Gate (12 h) → campaign victory, which survives a reload', () => {
  let state = createInitialSaveState('test', T0);
  for (let index = 0; index < 4; index += 1) state = ok(testGrantCrystal(state, options(T0))).state;
  assert.equal(selectGateContext(state, T0).canStart, true);
  state = ok(startGateConstruction(state, 'helion-01', options(T0))).state;
  const gate = currentSunRaidState(state).gates[0]!;
  assert.equal(gate.completesAt - gate.startedAt, 12 * HOUR);
  state = tick(state, T0 + 6 * HOUR);
  assert.deepEqual(currentSunRaidState(state).gates[0]!.announcedMilestones, [25, 50]);
  assert.equal(currentSunRaidState(state).campaignResult, undefined);
  state = tick(state, T0 + 12 * HOUR);
  const result = currentSunRaidState(state).campaignResult!;
  assert.equal(result.playerWon, true);
  const storage = memoryStorage();
  const facade = createPersistenceFacade({ mode: 'test', storage, now: () => T0 + 13 * HOUR, testTimeScale: 1 });
  facade.write(state);
  assert.deepEqual(currentSunRaidState(facade.read()).campaignResult, result);
  assert.equal(launchSunRaid(armed(state), { galaxy: 1, system: 9, originPlanetId: 'helion-01', ships: { cruiser: 10 }, requestId: 'late' }, options(T0 + 13 * HOUR)).ok, false);
});

test('the Gate follows the alliance leader: the leader leaves, the successor carries on', () => {
  let state = createInitialSaveState('test', T0);
  for (let index = 0; index < 4; index += 1) state = ok(testGrantCrystal(state, options(T0))).state;
  state = ok(startGateConstruction(state, 'helion-01', options(T0))).state;
  const left = leaveAlliance(state.command, state.profile.playerId, T0 + HOUR, { successorOwnerId: TEST_ALLY_OWNER_ID });
  assert.equal(left.ok, true);
  state = tick({ ...state, command: left.state }, T0 + HOUR);
  const gate = currentSunRaidState(state).gates[0]!;
  assert.equal(gate.status, 'building');
  assert.equal(gate.hostOwnerId, TEST_ALLY_OWNER_ID);
  assert.ok(currentSunRaidState(state).history.some((event) => event.kind === 'gate-transferred'));
  state = tick(state, T0 + 12 * HOUR);
  assert.equal(currentSunRaidState(state).campaignResult?.playerWon, false, 'the player left the winning alliance');
});

test('a won assault on the Gate host destroys the Gate and hands one crystal to the attacker', () => {
  let state = createInitialSaveState('test', T0);
  for (let index = 0; index < 4; index += 1) state = ok(testGrantCrystal(state, options(T0))).state;
  state = ok(startGateConstruction(state, 'helion-01', options(T0))).state;
  const assault = startBot01GateAssault(state, 'helion-01', options(T0 + HOUR));
  assert.equal(assault.ok, true);
  state = assault.ok ? assault.state : state;
  const launched = state.flights.records.find((item) => item.requestId.startsWith('bot01-gate-assault-'))!;
  state = tick(state, launched.arrivalAt + 1);
  const flight = state.flights.records.find((item) => item.id === launched.id)!;
  const sunRaid = currentSunRaidState(state);
  const gate = sunRaid.gates[0]!;
  const report = state.combat.reports.find((item) => item.id === flight.attackResolution?.reportId);
  if (report?.winner === 'attacker') {
    assert.equal(gate.status, 'destroyed');
    const playerHolder = `alliance:${selectOwnerMembership(state.command, state.profile.playerId)!.alliance.id}`;
    const botHolder = `alliance:${selectOwnerMembership(state.command, TEST_BOT_OWNER_ID)!.alliance.id}`;
    assert.equal((sunRaid.crystals[playerHolder] ?? []).length, 3);
    assert.equal((sunRaid.crystals[botHolder] ?? []).length, 1);
    assert.ok(sunRaid.gateCooldowns[playerHolder]! > flight.arrivalAt);
    assert.equal(selectGateContext(state, flight.arrivalAt + 2).canStart, false);
  } else {
    assert.equal(gate.status, 'building', 'a repelled assault leaves the Gate standing');
  }
});

test('raid rules refuse a solo owner and a Sun already under attack', () => {
  let state = armed(createInitialSaveState('test', T0));
  const solo = { ...state, command: { ...state.command, alliances: state.command.alliances.filter((alliance) => !alliance.members.some((member) => member.ownerId === state.profile.playerId)) } };
  const refused = launchSunRaid(solo, { galaxy: 1, system: 2, originPlanetId: 'helion-01', ships: { cruiser: 10 }, requestId: 'solo' }, options(T0));
  assert.equal(refused.ok, false);
  assert.match(refused.ok ? '' : refused.error, /союз/);
  state = ok(testBot01RaidSun(state, 1, 2, options(T0))).state;
  assert.equal(launchSunRaid(state, { galaxy: 1, system: 2, originPlanetId: 'helion-01', ships: { cruiser: 10 }, requestId: 'dup' }, options(T0)).ok, false);
});

test('a support fleet that would arrive after the attackers is refused', () => {
  let state = armed(createInitialSaveState('test', T0));
  state = ok(testBot01RaidSun(state, 1, 1, options(T0))).state;
  const raid = currentSunRaidState(state).raids[0]!;
  const late = sendSunSupport(state, { raidId: raid.id, originPlanetId: 'helion-01', ships: { cruiser: 10 }, requestId: 'late' }, options(raid.arrivesAt - 1));
  assert.equal(late.ok, false);
});

test('reconcile is idempotent', () => {
  let state = armed(createInitialSaveState('test', T0));
  state = ok(launchSunRaid(state, { galaxy: 1, system: 30, originPlanetId: 'helion-01', ships: { cruiser: 30 }, requestId: 'idem' }, options(T0))).state;
  const once = reconcileSunRaids(state, options(T0 + 3 * HOUR)).state;
  const twice = reconcileSunRaids(once, options(T0 + 3 * HOUR));
  assert.equal(twice.changed, false);
  assert.equal(currentSunRaidState(once).raids[0]!.status, 'resolved');
  void addCrystal; void SOLAR_CRYSTAL_IDS;
});

test('«Поддержка солнца» from Fleets: no alliance needed, civil hulls refused, commander leads, debris drift at [G:S:0] and recyclers collect them', async () => {
  const { dispatchFlight } = await import('./flights.ts');
  const { getSunDebris, sunDebrisLedgerKey } = await import('./sun-raid.ts');
  let state = armed(createInitialSaveState('test', T0), { cruiser: 400, battleship: 120, recycler: 40, transporter: 5 });
  const planet = state.planets['helion-01']!;
  state = replacePlanetState(state, 'helion-01', { ...planet, fleet: { ...planet.fleet, commanders: { ...planet.fleet.commanders, corsair: 1 } } });
  // A solo owner: the player leaves every alliance.
  state = { ...state, command: { ...state.command, alliances: state.command.alliances.filter((alliance) => !alliance.members.some((member) => member.ownerId === state.profile.playerId)) } };
  state = ok(testBot01RaidSun(state, 1, 1, options(T0))).state;
  const raid = currentSunRaidState(state).raids[0]!;
  const destination = { kind: 'operation' as const, operationId: `sun:1:1`, coordinate: { galaxy: 1, system: 1, position: 1 } };

  const civil = dispatchFlight(state, { requestId: 'civil', missionId: 'sun-support', originPlanetId: 'helion-01', destination, operationId: 'sun:1:1', selectedShips: { cruiser: 10, transporter: 5 } }, options(T0 + HOUR));
  assert.equal(civil.ok, false);
  assert.match(civil.ok ? '' : civil.error.message, /боевые/);

  const sent = dispatchFlight(state, {
    requestId: 'fleet-support', missionId: 'sun-support', originPlanetId: 'helion-01', destination, operationId: 'sun:1:1',
    selectedShips: { cruiser: 400, battleship: 120 }, selectedCommanders: { corsair: 1 },
  }, options(T0 + HOUR));
  assert.ok(sent.ok, sent.ok ? '' : sent.error.message);
  state = sent.state;
  const flight = state.flights.records.find((item) => item.requestId === 'fleet-support')!;
  assert.equal(flight.missionId, 'sun-support');
  assert.equal(flight.sunRaid?.raidId, raid.id);
  assert.deepEqual(flight.selectedCommanders, { corsair: 1 });

  // Survives a reload with the commander aboard.
  const storage = memoryStorage();
  const facade = createPersistenceFacade({ mode: 'test', storage, now: () => T0 + 2 * HOUR, testTimeScale: 1 });
  assert.equal(facade.write(state).ok, true);
  assert.deepEqual(facade.read().flights.records.find((item) => item.requestId === 'fleet-support')?.selectedCommanders, { corsair: 1 });

  state = tick(state, T0 + 3 * HOUR + 1);
  const result = currentSunRaidState(state).raids[0]!.result!;
  const report = state.combat.reports.find((item) => item.id === result.reportId)!;
  assert.ok(report, 'the solo defender receives the report');
  const debris = getSunDebris(state, 1, 1);
  assert.equal(debris, Math.floor(report.debris ?? 0));
  assert.ok(debris > 0, 'a Sun battle leaves debris');
  assert.deepEqual(state.espionage!.orbitalDebris![sunDebrisLedgerKey(1, 1)]!.targetCoordinate, { galaxy: 1, system: 1, position: 0 });

  const recycle = dispatchFlight(state, {
    requestId: 'sun-recycle', missionId: 'recycle', originPlanetId: 'helion-01', targetKind: 'empty',
    destination, operationId: 'sun:1:1', selectedShips: { recycler: 40 },
  }, options(T0 + 3 * HOUR + 2));
  assert.ok(recycle.ok, recycle.ok ? '' : recycle.error.message);
  state = recycle.state;
  const reloaded = (() => {
    const store = createPersistenceFacade({ mode: 'test', storage: memoryStorage(), now: () => T0 + 3 * HOUR + 3, testTimeScale: 1 });
    assert.equal(store.write(state).ok, true);
    return store.read();
  })();
  assert.ok(reloaded.flights.records.some((item) => item.requestId === 'sun-recycle'), 'a Sun recycle flight survives a reload');
  state = tick(state, T0 + 6 * HOUR);
  assert.ok(getSunDebris(state, 1, 1) < debris, 'recyclers took Sun debris');
  const arrival = state.reports.recyclerArrivalReports?.find((item) => item.collectedDebris > 0);
  assert.deepEqual(arrival?.coordinate, { galaxy: 1, system: 1, position: 0 });
});
