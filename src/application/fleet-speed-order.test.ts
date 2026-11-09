import assert from 'node:assert/strict';
import test from 'node:test';

import { createInitialSaveState, loadSavedState, serializeSaveForStorage } from './persistence.ts';
import { createDefaultNewGameConfig } from '../domain/world/config.ts';
import { SHIP_IDS, type ShipId } from '../domain/combat/ids.ts';
import { applyFlightSpeedPercent, normalizeFlightSpeedPercent, slowestNeededSpeedPercent } from '../domain/flights/speed.ts';
import { createFlightRecord } from '../domain/flights/runtime.ts';
import { COMPUTER_SYSTEMS_SCIENCE_ID } from '../domain/flights/limit.ts';
import type { SaveState } from './contracts.ts';
import { applyPreviewSpeed, dispatchFlight, estimateFlightRoute, fullSpeedCommand, previewFlight, reconcileFlights } from './flights.ts';
import { createColonyPlanetRuntime } from './owned-planets.ts';
import { selectExplorationTargets } from './exploration.ts';
import {
  WAVE_GAP_MS,
  buildQuickCommand,
  defaultQuickFleet,
  defaultWaveOrder,
  planWaveSpeeds,
  prepareQuickState,
  previewQuickCommand,
  sendQuickLegs,
  type QuickTarget,
} from './quick-actions.ts';

const NOW = 1_000_000;
const RUNTIME = { now: NOW, mode: 'production' as const };
const hangar = (ships: Partial<Record<ShipId, number>>) => Object.fromEntries(SHIP_IDS.map((id) => [id, ships[id] ?? 0])) as Record<ShipId, number>;

function campaign(ships: Partial<Record<ShipId, number>> = {}): SaveState {
  const config = createDefaultNewGameConfig({ seed: 'AUDIT-WORLD001', playerName: 'Auditor' });
  const generated = createInitialSaveState('production', NOW, config);
  const home = generated.planets[generated.currentPlanetId]!;
  // «Компьютерные системы» high enough for four waves at once.
  return { ...generated, science: { ...generated.science, levels: { ...generated.science.levels, [COMPUTER_SYSTEMS_SCIENCE_ID]: 10 } },
    planets: { ...generated.planets, [generated.currentPlanetId]: { ...home, fleet: { ...home.fleet, ships: hangar(ships) } } } };
}

function withColony(state: SaveState, system: number, ships: Partial<Record<ShipId, number>>, id: string): SaveState {
  const home = state.planets[state.currentPlanetId]!;
  return { ...state, planets: { ...state.planets, [id]: { ...home, name: `Колония ${system}`, universeSystem: system, universePosition: 3, fleet: { ...home.fleet, ships: hangar(ships) } } } };
}

function homeTarget(state: SaveState): QuickTarget {
  const home = state.planets[state.currentPlanetId]!;
  return {
    node: { id: state.currentPlanetId, kind: 'player', name: home.name, art: '', statusLabel: '', description: '', ownerId: state.profile.playerId,
      coordinate: { galaxy: home.universeGalaxy ?? 1, system: home.universeSystem ?? 1, position: home.universePosition ?? 1 } },
    relation: 'self',
  };
}

test('speed percent: lower speed, longer flight; 10–100 in whole percents', () => {
  assert.equal(applyFlightSpeedPercent(60_000, 100), 60_000);
  assert.equal(applyFlightSpeedPercent(60_000, undefined), 60_000);
  assert.equal(applyFlightSpeedPercent(60_000, 50), 120_000);
  assert.equal(applyFlightSpeedPercent(60_000, 10), 600_000);
  assert.equal(applyFlightSpeedPercent(60_000, 99), 60_606);
  assert.equal(normalizeFlightSpeedPercent(3), 10);
  assert.equal(normalizeFlightSpeedPercent(250), 100);
  assert.equal(normalizeFlightSpeedPercent(Number.NaN), 100);
  // The fastest speed that still lasts at least 61 s.
  assert.equal(slowestNeededSpeedPercent(60_000, 61_000), 98);
  assert.equal(slowestNeededSpeedPercent(60_000, 30_000), 100);
  assert.equal(slowestNeededSpeedPercent(60_000, 30_000, 40), 40);
  assert.equal(slowestNeededSpeedPercent(60_000, 600_001), null);
});

test('the domain record keeps the chosen speed only when it is below 100%', () => {
  const base = {
    requestId: 'r1', missionId: 'deployment' as const, originPlanetId: 'a', originCoordinate: { galaxy: 1, system: 1, position: 1 },
    destination: { kind: 'planet' as const, planetId: 'b', coordinate: { galaxy: 1, system: 5, position: 3 } },
    selectedShips: { cruiser: 1 }, departedAt: NOW, factionId: 'aegis' as const,
  };
  assert.equal(createFlightRecord(base).speedPercent, undefined);
  assert.equal(createFlightRecord({ ...base, speedPercent: 100 }).speedPercent, undefined);
  assert.equal(createFlightRecord({ ...base, speedPercent: 37 }).speedPercent, 37);
});

test('a slowed flight: the time grows as chosen, the speed is saved and survives a reload; arrival is the stored moment', () => {
  const home = campaign({});
  const homeSystem = home.planets[home.currentPlanetId]!.universeSystem ?? 1;
  const state = withColony(home, homeSystem + 4, { cruiser: 3 }, 'colony-a');
  const target = homeTarget(state);
  const command = buildQuickCommand(state, 'deployment', target, 'colony-a', defaultQuickFleet(state, 'deployment', 'colony-a', target), RUNTIME)!;
  const prepared = prepareQuickState(state, command, RUNTIME);
  const full = dispatchFlight(prepared, command, RUNTIME);
  const slow = dispatchFlight(prepared, { ...command, speedPercent: 25 }, RUNTIME);
  assert.ok(full.ok && slow.ok, [full, slow].map((r) => (r.ok ? 'ok' : r.error.message)).join(' | '));
  assert.equal(full.flight.speedPercent, undefined);
  assert.equal(slow.flight.speedPercent, 25);
  assert.equal(slow.flight.oneWayDurationMs, full.flight.oneWayDurationMs * 4);
  assert.equal(slow.flight.arrivalAt, NOW + slow.flight.oneWayDurationMs);
  assert.equal(slow.flight.gasCost, full.flight.gasCost, 'fuel is not changed by speed');
  // The flight plan's estimate shows the same time.
  const estimate = estimateFlightRoute(state, 'colony-a', command.selectedShips, {}, target.node.coordinate, { ...RUNTIME, speedPercent: 25 });
  assert.equal(estimate?.oneWayDurationMs, slow.flight.oneWayDurationMs);

  const raw = serializeSaveForStorage(slow.state, 'production');
  const loaded = loadSavedState({ mode: 'production', storage: { getItem: () => raw, setItem: () => undefined, removeItem: () => undefined } });
  assert.equal(loaded.status, 'loaded');
  const reloaded = loaded.state;
  const saved = reloaded.flights.records.find((flight) => flight.id === slow.flight.id)!;
  assert.equal(saved.speedPercent, 25);
  assert.equal(saved.arrivalAt, slow.flight.arrivalAt);
  // Same world whatever the slicing: one millisecond early it is still flying; on the moment it lands.
  const early = reconcileFlights(reloaded, slow.flight.arrivalAt - 1).state;
  assert.equal(early.flights.records.find((flight) => flight.id === slow.flight.id)?.phase, 'outbound');
  const sliced = reconcileFlights(reconcileFlights(reloaded, NOW + 1_000).state, slow.flight.arrivalAt).state;
  const atOnce = reconcileFlights(reloaded, slow.flight.arrivalAt).state;
  assert.notEqual(atOnce.flights.records.find((flight) => flight.id === slow.flight.id)?.phase, 'outbound');
  assert.deepEqual(sliced.flights.records, atOnce.flights.records);
  assert.deepEqual(sliced.planets, atOnce.planets);
});

test('waves: four planets land in the chosen order, at least a second apart', () => {
  const home = campaign({ cruiser: 2 });
  const homeSystem = home.planets[home.currentPlanetId]!.universeSystem ?? 1;
  let state = withColony(home, homeSystem + 2, { cruiser: 2 }, 'colony-a');
  state = withColony(state, homeSystem + 6, { transporter: 4 }, 'colony-b');
  state = withColony(state, homeSystem + 12, { cruiser: 1, transporter: 1 }, 'colony-c');
  state = withColony(state, homeSystem + 20, { recycler: 3 }, 'colony-d');
  const target = homeTarget(state);
  const command = (origin: string) => buildQuickCommand(state, 'deployment', target, origin, defaultQuickFleet(state, 'deployment', origin, target), RUNTIME)!;
  // The player puts the nearest planet last and the farthest first.
  const order = ['colony-d', 'colony-c', 'colony-b', 'colony-a'];
  const plan = planWaveSpeeds(state, order.map(command), RUNTIME);
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.legs.map((leg) => leg.originPlanetId), order);
  assert.equal(plan.legs[0]!.speedPercent, 100, 'the first wave flies at its own speed');
  for (let i = 1; i < plan.legs.length; i += 1) {
    assert.ok(plan.legs[i]!.arrivalAt >= plan.legs[i - 1]!.arrivalAt + WAVE_GAP_MS, `wave ${i + 1} lands a second after wave ${i}`);
    assert.ok(plan.legs[i]!.speedPercent < 100, `wave ${i + 1} is slowed`);
  }
  const { state: next, outcomes } = sendQuickLegs(state, plan.legs.map((leg) => leg.command), RUNTIME, dispatchFlight);
  assert.ok(outcomes.every((outcome) => outcome.result.ok), outcomes.map((o) => (o.result.ok ? 'ok' : o.result.error.message)).join(' | '));
  const arrivals = order.map((origin) => next.flights.records.find((flight) => flight.originPlanetId === origin)!);
  for (let i = 1; i < arrivals.length; i += 1) {
    assert.ok(arrivals[i]!.arrivalAt - arrivals[i - 1]!.arrivalAt >= WAVE_GAP_MS);
    assert.equal(arrivals[i]!.speedPercent, plan.legs[i]!.speedPercent);
  }
});

test('waves: warships first by default; an order that cannot be kept is refused with a plain line', () => {
  const home = campaign({});
  const homeSystem = home.planets[home.currentPlanetId]!.universeSystem ?? 1;
  let state = withColony(home, homeSystem + 1, { transporter: 4 }, 'colony-cargo');
  state = withColony(state, homeSystem + 14, { cruiser: 2 }, 'colony-guns');
  const order = defaultWaveOrder(state, [
    { originPlanetId: 'colony-cargo', ships: { transporter: 4 }, arrivalAt: 1 },
    { originPlanetId: 'colony-guns', ships: { cruiser: 2 }, arrivalAt: 99 },
  ]);
  assert.deepEqual(order, ['colony-guns', 'colony-cargo']);
  const target = homeTarget(state);
  const command = (origin: string, speedPercent?: number) => ({
    ...buildQuickCommand(state, 'deployment', target, origin, defaultQuickFleet(state, 'deployment', origin, target), RUNTIME)!, speedPercent,
  });
  const kept = planWaveSpeeds(state, [command('colony-guns'), command('colony-cargo')], RUNTIME);
  assert.equal(kept.ok, true);
  assert.ok(kept.legs[1]!.arrivalAt >= kept.legs[0]!.arrivalAt + WAVE_GAP_MS);
  // The guns crawl at 10%: even at 10% the near cargo cannot come later.
  const broken = planWaveSpeeds(state, [command('colony-guns', 10), command('colony-cargo')], RUNTIME);
  assert.equal(broken.ok, false);
  if (!broken.ok) {
    assert.equal(broken.wave, 2);
    assert.match(broken.message, /Волна 2/);
  }
});

test('fleet plan: the slider lays any speed on a full-speed preview; back to 100% gives the original time (gas reconfirmation case)', () => {
  const home = campaign({});
  const homeSystem = home.planets[home.currentPlanetId]!.universeSystem ?? 1;
  const state = withColony(home, homeSystem + 4, { cruiser: 3 }, 'colony-a');
  const target = homeTarget(state);
  const slowed = { ...buildQuickCommand(state, 'deployment', target, 'colony-a', defaultQuickFleet(state, 'deployment', 'colony-a', target), RUNTIME)!, speedPercent: 40 };
  const prepared = prepareQuickState(state, slowed, RUNTIME);
  // The stored baseline is always previewed without the speed, even when the sent command had one.
  const baseline = previewFlight(prepared, fullSpeedCommand(slowed), RUNTIME);
  assert.ok(baseline.ok);
  if (!baseline.ok) return;
  assert.equal(baseline.flight.speedPercent, undefined);
  const real = previewFlight(prepared, slowed, RUNTIME);
  assert.ok(real.ok);
  if (!real.ok) return;
  const at40 = applyPreviewSpeed(baseline, 40);
  assert.ok(at40?.ok);
  if (!at40?.ok) return;
  assert.equal(at40.flight.oneWayDurationMs, real.flight.oneWayDurationMs, 'same time as the runtime at 40%');
  assert.equal(at40.flight.arrivalAt, real.flight.arrivalAt);
  // Moving the slider again (to 70%, then back to 100%) follows it instead of keeping the old 40% figures.
  const at70 = applyPreviewSpeed(baseline, 70);
  const real70 = previewFlight(prepared, { ...slowed, speedPercent: 70 }, RUNTIME);
  assert.ok(at70?.ok && real70.ok);
  if (at70?.ok && real70.ok) assert.equal(at70.flight.arrivalAt, real70.flight.arrivalAt);
  const at100 = applyPreviewSpeed(baseline, 100);
  assert.equal(at100, baseline);
  assert.equal(fullSpeedCommand(slowed).speedPercent, undefined);
});

test('waves: each wave is checked at its final slowed speed, so none leaves when a later one would miss a vanishing object', () => {
  const MINUTE = 60_000;
  const OPTIONS = { mode: 'test' as const, testTimeScale: 15 as const };
  const base = 1_790_000_000_000;
  let state = createInitialSaveState('test', base);
  const home = state.planets['helion-01']!;
  state = { ...state, science: { ...state.science, levels: { ...state.science.levels, [COMPUTER_SYSTEMS_SCIENCE_ID]: 10 } },
    planets: { ...state.planets, 'helion-01': { ...home, resources: { metal: 1e7, minerals: 1e7, gas: 1e7 },
      fleet: { ...home.fleet, ships: { ...home.fleet.ships, transporter: 10 } } } } };
  const colonySystem = (home.universeSystem ?? 1) + 5;
  const colony = createColonyPlanetRuntime(state, { galaxy: home.universeGalaxy ?? 1, system: colonySystem, position: 14 });
  state = { ...state, planets: { ...state.planets, 'colony-x': { ...colony, resources: { metal: 1e7, minerals: 1e7, gas: 1e7 },
    fleet: { ...colony.fleet, ships: { ...colony.fleet.ships, transporter: 10 } } } } };
  let at = base; let node;
  for (let offset = 0; offset < 480 && !node; offset++) {
    at = base + offset * MINUTE;
    node = selectExplorationTargets(state, at, 'test').find((item) => item.special && item.special.expiresAt - at > 8 * MINUTE);
  }
  assert.ok(node, 'a live exploration object');
  const target: QuickTarget = { node: { ...node!, ownerId: undefined }, relation: 'neutral' };
  const legOf = (origin: string, now: number) => buildQuickCommand(state, 'expedition', target, origin, { ships: { transporter: 5 } }, { now, ...OPTIONS })!;
  const duration = (origin: string) => {
    const preview = previewQuickCommand(state, legOf(origin, at), { now: at, ...OPTIONS });
    assert.ok(preview.ok, preview.ok ? '' : preview.error.message);
    return preview.ok ? preview.flight.oneWayDurationMs : 0;
  };
  const slow = duration('helion-01') >= duration('colony-x') ? 'helion-01' : 'colony-x';
  const fast = slow === 'helion-01' ? 'colony-x' : 'helion-01';
  // Leave so that the slower fleet lands half a second before the object vanishes: alone, both legs are fine.
  const now = node!.special!.expiresAt - duration(slow) - 500;
  const runtime = { now, ...OPTIONS };
  for (const origin of [slow, fast]) assert.ok(previewQuickCommand(state, legOf(origin, now), runtime).ok, `${origin} alone is accepted`);
  // As the second wave the fast leg must land a second after the slow one, i.e. after the object is gone.
  const plan = planWaveSpeeds(state, [legOf(slow, now), legOf(fast, now)], runtime);
  assert.equal(plan.ok, false, 'the wave plan is refused before anything leaves');
  if (!plan.ok) {
    assert.equal(plan.wave, 2);
    assert.equal(plan.originPlanetId, fast);
    assert.match(plan.message, /^Волна 2: /);
  }
});
