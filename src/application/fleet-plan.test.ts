import assert from 'node:assert/strict';
import test from 'node:test';

import type { ShipId } from '../domain/combat/ids.ts';
import { getFactionShipCatalog } from '../domain/combat/faction-catalog.ts';
import {
  calculateFleetPlan,
  migrateFleetPlans,
  setFleetPlanTarget,
  toggleFleetPlanFill,
  type FleetPlan,
  type FleetPlanUnit,
} from '../domain/fleet/fleet-plan.ts';
import { applyFleetUiUpdate, migrateFleetUiState } from '../domain/flights/fleet-ui.ts';
import { createDefaultNewGameConfig } from '../domain/world/config.ts';
import type { SaveState } from './contracts.ts';
import { getPlanetResources, replacePlanetResources } from './contracts.ts';
import { getFleetSummaryForState } from './fleet.ts';
import { buildFleetPlanView, fleetPlanGlance, startFleetPlanLines } from './fleet-plan.ts';
import { applyCampaignRuntimeForCatchup, runNpcCatchup } from './npc-catchup-runner.ts';
import { freezeNpcCatchupTarget } from './npc-catchup.ts';
import { campaign } from './npc-runtime.test-support.ts';
import { createInitialSaveState, createPersistenceFacade, serializeSaveForStorage } from './persistence.ts';
import { enqueueApplicationStateUpdate, runOutsideApplicationCommand } from './state.ts';

const NOW = 1_000_000;
const RUNTIME = { now: NOW, mode: 'production' as const, testTimeScale: 1 as const };
const PLANET = 'helion-01';
const context = (planetId = PLANET) => ({ planetId, now: NOW, mode: 'production' as const, testTimeScale: 1 as const });
const ROOMY = { metal: 1e12, minerals: 1e12, gas: 1e12 };

const unit = (id: ShipId, population: number, onPlanet = 0, queued = 0, away = 0): FleetPlanUnit => ({ id, population, onPlanet, queued, away });

/** A world where every ship is unlocked and the hangar is large, so the rule under test is the only limit. */
function world(plan?: FleetPlan, resources: { metal: number; minerals: number; gas: number } = ROOMY): SaveState {
  const config = createDefaultNewGameConfig({ seed: 'FLEET-PLAN-01', playerName: 'Owner' });
  const base = createInitialSaveState('production', NOW, config);
  const home = base.planets[PLANET]!;
  const science = Object.fromEntries(Object.keys(base.science.levels).map((id) => [id, 30]));
  const next: SaveState = {
    ...base,
    science: { ...base.science, levels: science as typeof base.science.levels },
    planets: {
      ...base.planets,
      [PLANET]: {
        ...home,
        buildings: { ...home.buildings, shipyard: 30, hangar: 30, 'advanced-factory': 30, research: 30, construction: 30, spaceport: 30 },
        fleet: { ...home.fleet, ships: Object.fromEntries(Object.keys(home.fleet.ships).map((id) => [id, 0])) as typeof home.fleet.ships },
        solarSatellites: 0,
      },
    },
    ...(plan ? { fleetUi: { favoriteTargets: [], plans: { [PLANET]: plan } } } : {}),
  };
  return replacePlanetResources(next, PLANET, { ...getPlanetResources(next, PLANET), ...resources });
}

test('missing = target minus ships on the planet, in the queue and coming back', () => {
  const result = calculateFleetPlan({ targets: { scout: 1300 } }, [unit('scout', 1, 900, 100, 50)], { used: 1050, capacity: 10_000 });
  assert.equal(result.lines[0]!.current, 1050);
  assert.equal(result.lines[0]!.missing, 250);
});

test('ships above the target are surplus, never negative missing', () => {
  const [line] = calculateFleetPlan({ targets: { scout: 10 } }, [unit('scout', 1, 25)], { used: 25, capacity: 100 }).lines;
  assert.equal(line!.missing, 0);
  assert.equal(line!.surplus, 15);
});

test('«на остаток» fills the room the other targets leave, whole ships only', () => {
  const plan: FleetPlan = { targets: { scout: 100 }, fillShipId: 'bomber' };
  const result = calculateFleetPlan(plan, [unit('scout', 2, 40), unit('bomber', 7, 3)], { used: 40 * 2 + 3 * 7, capacity: 1000 });
  const fill = result.lines.find((line) => line.isFill)!;
  // Room after the scouts: 1000 - (80 + 21) - 60 * 2 = 779; 779 / 7 = 111 ships more.
  assert.equal(fill.missing, 111);
  assert.equal(fill.target, 114);
  assert.equal(result.withPlan, 80 + 21 + 120 + 111 * 7);
  assert.equal(result.lines.at(-1)!.id, 'bomber', 'the fill line is always last');
});

test('the fill target does not move when lines are started', () => {
  const plan: FleetPlan = { targets: { scout: 100 }, fillShipId: 'bomber' };
  const before = calculateFleetPlan(plan, [unit('scout', 2, 40), unit('bomber', 7)], { used: 80, capacity: 1000 });
  const after = calculateFleetPlan(plan, [unit('scout', 2, 40, 60), unit('bomber', 7)], { used: 200, capacity: 1000 });
  assert.equal(before.lines.at(-1)!.target, after.lines.at(-1)!.target);
});

test('over capacity: reports by how much, the fill line stays at zero', () => {
  const plan: FleetPlan = { targets: { scout: 1000 }, fillShipId: 'bomber' };
  const result = calculateFleetPlan(plan, [unit('scout', 2), unit('bomber', 7)], { used: 0, capacity: 500 });
  assert.equal(result.overBy, 1500);
  assert.equal(result.lines.at(-1)!.missing, 0);
});

test('plan edits: one fill line at most, a line with its own number stops being the fill line', () => {
  let plan = toggleFleetPlanFill({ targets: { bomber: 5 } }, 'bomber');
  assert.deepEqual(plan, { targets: {}, fillShipId: 'bomber' });
  plan = toggleFleetPlanFill(plan, 'scout', 40);
  assert.deepEqual(plan, { targets: { bomber: 40 }, fillShipId: 'scout' }, 'the old fill line stays at the number it showed');
  plan = toggleFleetPlanFill(plan, 'scout', 25);
  assert.deepEqual(plan, { targets: { bomber: 40, scout: 25 } }, 'unmarking keeps the line');
  plan = toggleFleetPlanFill(plan, 'scout');
  plan = setFleetPlanTarget(plan, 'scout', 3);
  assert.deepEqual(plan, { targets: { bomber: 40, scout: 3 } });
  plan = setFleetPlanTarget(plan, 'scout', 0);
  assert.deepEqual(plan, { targets: { bomber: 40 } });
});

test('view uses the game hangar numbers, including ships on a mission and queued', () => {
  const state = world({ targets: { scout: 50 } });
  const started = startFleetPlanLines(state, context(), RUNTIME).state;
  const view = buildFleetPlanView(started, PLANET, RUNTIME);
  assert.deepEqual([view.hangar.used, view.hangar.capacity], [getFleetSummaryForState(started, PLANET).population, getFleetSummaryForState(started, PLANET).capacity]);
  assert.equal(view.lines[0]!.queued, 50);
  assert.equal(view.lines[0]!.missing, 0);
});

test('a fleet on a mission counts, an outbound deployment does not', () => {
  const state = world({ targets: { scout: 100 } });
  const home = state.planets[PLANET]!;
  const withShips: SaveState = { ...state, planets: { ...state.planets, [PLANET]: { ...home, fleet: { ...home.fleet, ships: { ...home.fleet.ships, scout: 60 } } } } };
  const flight = (id: string, missionId: string, phase: string) => ({ id, missionId, phase, originPlanetId: PLANET, ownerSide: 'player', selectedShips: { scout: 20 }, selectedCommanders: {} });
  const attack = { ...withShips, flights: { ...withShips.flights, records: [flight('a', 'attack', 'outbound')] } } as unknown as SaveState;
  const lineA = buildFleetPlanView(attack, PLANET, RUNTIME).lines[0]!;
  assert.deepEqual([lineA.onPlanet, lineA.away, lineA.missing], [40, 20, 40], 'attack is coming back');
  const deployment = { ...withShips, flights: { ...withShips.flights, records: [flight('d', 'deployment', 'outbound')] } } as unknown as SaveState;
  const lineD = buildFleetPlanView(deployment, PLANET, RUNTIME).lines[0]!;
  assert.deepEqual([lineD.onPlanet, lineD.away, lineD.missing], [40, 0, 60], 'deployment left for good');
});

test('one line starts exactly the missing amount', () => {
  const state = world({ targets: { scout: 130, defender: 40 } });
  const result = startFleetPlanLines(state, context(), RUNTIME, ['scout']);
  assert.equal(result.started, 130);
  const queue = result.state.planets[PLANET]!.fleetProduction.shipQueue;
  assert.deepEqual(queue.map((order) => [order.itemId, order.quantity]), [['scout', 130]]);
  const again = startFleetPlanLines(result.state, context(), RUNTIME, ['scout']);
  assert.equal(again.started, 0, 'a second click finds nothing missing');
  assert.equal(again.state, result.state);
});

test('start all: costs are those of the ordinary command, fill line last', () => {
  const plan: FleetPlan = { targets: { scout: 10, defender: 5 }, fillShipId: 'spy-probe' };
  const state = world(plan);
  const before = getPlanetResources(state, PLANET);
  const result = startFleetPlanLines(state, context(), RUNTIME);
  const orders = result.state.planets[PLANET]!.fleetProduction.shipQueue;
  assert.deepEqual(orders.slice(0, 2).map((order) => [order.itemId, order.quantity]), [['scout', 10], ['defender', 5]]);
  assert.equal(orders.at(-1)!.itemId, 'spy-probe');
  const catalog = getFactionShipCatalog(state.profile.factionId);
  const spent = orders.reduce((total, order) => total + catalog.find((entity) => entity.id === order.itemId)!.cost.metal * order.quantity, 0);
  assert.equal(before.metal - getPlanetResources(result.state, PLANET).metal, spent);
  const view = buildFleetPlanView(result.state, PLANET, RUNTIME);
  assert.equal(view.missing, 0, 'the whole hangar is spoken for');
  assert.ok(view.hangar.capacity - view.hangar.used < catalog.find((entity) => entity.id === 'spy-probe')!.population, 'the fill line reaches the hangar limit');
});

test('partial affordability: as many as the wallet allows, and says what is short', () => {
  const scout = getFactionShipCatalog('aegis').find((entity) => entity.id === 'scout')!;
  const state = world({ targets: { scout: 1000 } }, { metal: scout.cost.metal * 37, minerals: 1e12, gas: 1e12 });
  const view = buildFleetPlanView(state, PLANET, RUNTIME).lines[0]!;
  assert.equal(view.startable, 37);
  assert.equal(view.limitedBy, 'metal');
  assert.equal(view.short.metal, scout.cost.metal * (1000 - 37));
  const result = startFleetPlanLines(state, context(), RUNTIME);
  assert.equal(result.started, 37);
  assert.equal(result.outcomes[0]!.wanted, 1000);
});

test('no resources: nothing starts and the world does not change', () => {
  const state = world({ targets: { scout: 10 } }, { metal: 0, minerals: 0, gas: 0 });
  const result = startFleetPlanLines(state, context(), RUNTIME);
  assert.equal(result.started, 0);
  assert.equal(result.state, state);
  assert.equal(result.outcomes[0]!.started, 0);
});

test('a plan bigger than the hangar: starts what fits and names the hangar', () => {
  const state = world({ targets: { scout: 10_000_000 } });
  const view = buildFleetPlanView(state, PLANET, RUNTIME);
  assert.ok(view.hangar.overBy > 0);
  const line = view.lines[0]!;
  assert.equal(line.limitedBy, 'hangar');
  const result = startFleetPlanLines(state, context(), RUNTIME);
  assert.equal(result.started, line.startable);
  const crowded = world({ targets: { scout: 10_000_000, defender: 10_000_000 } });
  assert.equal(buildFleetPlanView(crowded, PLANET, RUNTIME).startable, startFleetPlanLines(crowded, context(), RUNTIME).started, 'the «start all» number is what really starts');
  const after = getFleetSummaryForState(result.state, PLANET);
  assert.ok(after.population <= after.capacity, 'the command never overfills the hangar');
});

test('requirements not met: the line carries the reason and no order is placed', () => {
  const base = world({ targets: { 'death-star': 1, scout: 2 } });
  const home = base.planets[PLANET]!;
  const state: SaveState = { ...base, planets: { ...base.planets, [PLANET]: { ...home, buildings: { ...home.buildings, shipyard: 0 } } } };
  const view = buildFleetPlanView(state, PLANET, RUNTIME);
  for (const line of view.lines) {
    assert.equal(line.item.unlocked, false);
    assert.ok(line.item.reason);
    assert.equal(line.startable, 0);
  }
  const result = startFleetPlanLines(state, context(), RUNTIME);
  assert.equal(result.started, 0);
  assert.equal(result.state.planets[PLANET]!.fleetProduction.shipQueue.length, 0);
  assert.ok(result.outcomes.every((outcome) => outcome.reason));
});

test('glance: planned planet with what is missing, no plan means nothing to show', () => {
  assert.equal(fleetPlanGlance(world(), PLANET, RUNTIME).planned, false);
  const glance = fleetPlanGlance(world({ targets: { scout: 7, defender: 3 } }), PLANET, RUNTIME);
  assert.deepEqual([glance.planned, glance.missing, glance.missingLines], [true, 10, 2]);
});

test('several lines started in a row through the command queue lose nothing, even when React renders nothing in between', () => {
  // The way App runs it: enqueueApplicationStateUpdate with a flush that is
  // synchronous, while a world tick lands between the commands.
  let held = world({ targets: { scout: 10, defender: 5, bomber: 3 } });
  const setState = (update: SaveState | ((current: SaveState) => SaveState)) => { held = typeof update === 'function' ? update(held) : update; };
  const stateRef = { current: held };
  const start = (shipId: ShipId) => enqueueApplicationStateUpdate(stateRef, setState, (current) => {
    const action = startFleetPlanLines(current, context(), RUNTIME, [shipId]);
    return { state: action.state, result: action };
  }, (work) => work());
  const tick = () => { held = { ...held }; };
  start('scout');
  tick();
  start('defender');
  tick();
  start('bomber');
  const queue = held.planets[PLANET]!.fleetProduction.shipQueue;
  assert.deepEqual(queue.map((order) => [order.itemId, order.quantity]), [['scout', 10], ['defender', 5], ['bomber', 3]]);
  assert.equal(new Set(queue.map((order) => order.id)).size, 3);
});

test('start all is one transition: a tick after it cannot split the orders', () => {
  let held = world({ targets: { scout: 10, defender: 5 } });
  const setState = (update: SaveState | ((current: SaveState) => SaveState)) => { held = typeof update === 'function' ? update(held) : update; };
  const stateRef = { current: held };
  const started = enqueueApplicationStateUpdate(stateRef, setState, (current) => {
    const action = startFleetPlanLines(current, context(), RUNTIME);
    return { state: action.state, result: action.started };
  }, (work) => work());
  assert.equal(started, 15);
  assert.equal(stateRef.current, held);
  assert.equal(held.planets[PLANET]!.fleetProduction.shipQueue.length, 2);
});

test('a tick effect firing inside the command flush cannot undo a started line (the PR #161 race)', async () => {
  let held = world({ targets: { scout: 10, defender: 5 } });
  const setState = (update: SaveState | ((current: SaveState) => SaveState)) => { held = typeof update === 'function' ? update(held) : update; };
  const stateRef = { current: held };
  // React runs the previous commit's effects first, inside the flush, while stateRef still lacks the command.
  const flush = (work: () => void) => {
    runOutsideApplicationCommand(() => setState(stateRef.current));
    work();
  };
  for (const shipId of ['scout', 'defender'] as const) {
    enqueueApplicationStateUpdate(stateRef, setState, (current) => {
      const action = startFleetPlanLines(current, context(), RUNTIME, [shipId]);
      return { state: action.state, result: action.started };
    }, flush);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.deepEqual(held.planets[PLANET]!.fleetProduction.shipQueue.map((order) => order.itemId), ['scout', 'defender']);
});

test('save and reload keeps the plan, in both save formats', () => {
  for (const mode of ['production', 'test'] as const) {
    const memory = new Map<string, string>();
    const storage = { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => void memory.set(key, value), removeItem: (key: string) => void memory.delete(key) };
    const persistence = createPersistenceFacade({ mode, storage, saveKey: 'plan-test' });
    const plan: FleetPlan = { targets: { scout: 1300, defender: 1300, destroyer: 200, battleship: 500 }, fillShipId: 'bomber' };
    const config = createDefaultNewGameConfig({ seed: 'FLEET-PLAN-02', playerName: 'Owner' });
    const state = createInitialSaveState(mode, NOW, config);
    const edited = { ...state, fleetUi: applyFleetUiUpdate(state.fleetUi, { kind: 'set-fleet-plan', planetId: PLANET, plan }) };
    assert.deepEqual(persistence.write(edited), { ok: true });
    const loaded = persistence.read();
    assert.deepEqual(loaded.fleetUi?.plans?.[PLANET], plan);
  }
});

test('old saves load without a plan and work', () => {
  const memory = new Map<string, string>();
  const storage = { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => void memory.set(key, value), removeItem: (key: string) => void memory.delete(key) };
  const persistence = createPersistenceFacade({ mode: 'test', storage, saveKey: 'old-save' });
  const config = createDefaultNewGameConfig({ seed: 'FLEET-PLAN-03', playerName: 'Owner' });
  const state = createInitialSaveState('test', NOW, config);
  const { fleetUi: _dropped, ...old } = state;
  persistence.write(old as SaveState);
  const loaded = persistence.read();
  assert.equal(loaded.fleetUi?.plans, undefined);
  const view = buildFleetPlanView(loaded, PLANET, { now: NOW, mode: 'test', testTimeScale: 1 });
  assert.equal(view.empty, true);
  assert.deepEqual(view.lines, []);
});

test('migration drops what it cannot read and keeps favourites', () => {
  assert.equal(migrateFleetPlans(null), undefined);
  assert.deepEqual(migrateFleetPlans({
    a: { targets: { scout: 12.7, nonsense: 5, defender: -1, bomber: 'x' }, fillShipId: 'scout' },
    b: { targets: {} },
    c: 7,
  }), { a: { targets: {}, fillShipId: 'scout' } });
  const ui = migrateFleetUiState({ favoriteTargets: [{ coordinate: { galaxy: 1, system: 2, position: 3 } }], plans: { a: { targets: { scout: 3 } } } });
  assert.equal(ui?.favoriteTargets.length, 1);
  assert.deepEqual(ui?.plans, { a: { targets: { scout: 3 } } });
});

test('removing the last line removes the planet entry; other data stays', () => {
  const ui = applyFleetUiUpdate({ favoriteTargets: [], plans: { a: { targets: { scout: 3 } } } }, { kind: 'set-fleet-plan', planetId: 'a', plan: { targets: {} } });
  assert.deepEqual(ui, { favoriteTargets: [] });
});

test('the world does not read the plan: a catch-up with and without it ends identically', async () => {
  const plain = campaign(12);
  const start = plain.npcReplay!.processedThroughAt;
  applyCampaignRuntimeForCatchup(plain, start);
  const now = start + 2 * 60 * 60 * 1000;
  const planned = structuredClone(plain);
  planned.fleetUi = applyFleetUiUpdate(planned.fleetUi, { kind: 'set-fleet-plan', planetId: PLANET, plan: { targets: { scout: 500 }, fillShipId: 'bomber' } });
  const left = await runNpcCatchup(freezeNpcCatchupTarget(structuredClone(plain), now), { now: () => now });
  const right = await runNpcCatchup(freezeNpcCatchupTarget(planned, now), { now: () => now });
  assert.ok(right.state.fleetUi?.plans?.[PLANET], 'the plan rides along');
  const { fleetUi: _a, ...leftWorld } = left.state;
  const { fleetUi: _b, ...rightWorld } = right.state;
  assert.equal(serializeSaveForStorage(leftWorld as SaveState, 'production'), serializeSaveForStorage(rightWorld as SaveState, 'production'));
});
