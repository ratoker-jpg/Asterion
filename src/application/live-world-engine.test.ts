import assert from 'node:assert/strict';
import test from 'node:test';
import type { SaveState } from './contracts.ts';
import { LiveWorldEngine } from './live-world-engine.ts';
import type { LiveWorldRequest, LiveWorldResponse } from './live-world-protocol.ts';
import { applyWorldPatch, diffWorld } from './world-diff.ts';
import { applyCampaignRuntimeForCatchup, runNpcCatchup } from './npc-catchup-runner.ts';
import { freezeNpcCatchupTarget, isNpcCatchupPending } from './npc-catchup.ts';
import { serializeSaveForStorage } from './persistence.ts';
import { campaign } from './npc-runtime.test-support.ts';

const PERSIST = { tickMaxIntervalMs: 60_000, tickCostFactor: 50, catchupIntervalMs: 15_000 };

/** App's side of the protocol, as App.tsx does it (messages copied the way postMessage copies them). */
class Ui {
  version = 0;
  nextVersion = 2;
  tickInFlight = false;
  received: LiveWorldResponse[] = [];
  saves: Extract<LiveWorldResponse, { type: 'save' }>[] = [];
  state: SaveState;
  private readonly send: (message: LiveWorldRequest) => Promise<void>;
  constructor(state: SaveState, send: (message: LiveWorldRequest) => Promise<void>) {
    this.state = state;
    this.send = send;
  }

  commit(next: SaveState): Promise<void> {
    const to = this.nextVersion;
    this.nextVersion += 2;
    const patch = diffWorld(this.state, next);
    const from = this.version;
    this.state = next;
    this.version = to;
    return this.send(structuredClone({ type: 'commit', from, to, patch, at: 0 }));
  }

  tick(now: number): Promise<void> {
    if (this.tickInFlight) return Promise.resolve();
    this.tickInFlight = true;
    return this.send({ type: 'tick', from: this.version, now, testTimeScale: 1 });
  }

  /** Takes the messages the worker posted so far. */
  receive(): void {
    for (const message of this.received.splice(0)) {
      if (message.type === 'save') this.saves.push(message);
      if (message.type === 'error') throw new Error(message.message);
      if (message.type !== 'ticked') continue;
      this.tickInFlight = false;
      if (message.from !== this.version) continue;
      this.state = applyWorldPatch(this.state, message.patch);
      this.version = message.to;
    }
  }
}

function setup(world: SaveState, now: () => number) {
  const timers: (() => void)[] = [];
  let ui: Ui;
  const engine = new LiveWorldEngine({
    post: (message) => ui.received.push(structuredClone(message)),
    now,
    yieldToMessages: () => new Promise((resolve) => setImmediate(resolve)),
    later: (task) => { timers.push(task); },
    clock: () => 0,
  });
  ui = new Ui(structuredClone(world), (message) => engine.handle(message));
  const runTimers = () => { for (const task of timers.splice(0)) task(); };
  return { engine, ui, runTimers, worker: () => (engine as unknown as { ui: SaveState }).ui };
}

const text = (state: SaveState) => serializeSaveForStorage(state, 'production');

test('ticks and commands racing them leave the mirror equal to the worker's world', async () => {
  const world = campaign(12);
  const start = world.npcReplay!.processedThroughAt;
  applyCampaignRuntimeForCatchup(world, start);
  let clock = start;
  const { ui, engine, runTimers, worker } = setup(world, () => clock);
  await engine.handle(structuredClone({ type: 'init', version: 0, state: world, clockOffsetMs: 0, persist: PERSIST }));
  for (let second = 1; second <= 240; second += 1) {
    clock = start + second * 15_000;
    await ui.tick(clock);
    // Every seventh tick the player renames the planet before the tick reaches App: the tick is dropped on both sides.
    if (second % 7 === 0) {
      const planet = ui.state.planets[ui.state.currentPlanetId]!;
      await ui.commit({ ...ui.state, planets: { ...ui.state.planets, [ui.state.currentPlanetId]: { ...planet, name: `P${second}` } } });
    }
    ui.receive();
    if (second % 40 === 0) runTimers();
  }
  // One more tick settles both on the same version.
  await ui.tick(clock);
  ui.receive();
  await ui.commit({ ...ui.state, currentPlanetId: ui.state.currentPlanetId });
  assert.equal(text(worker()), text(ui.state));
  assert.equal(ui.state.planets[ui.state.currentPlanetId]!.name, 'P238');
  assert.ok(ui.saves.length > 0, 'the worker wrote saves');
  assert.ok(ui.state.npcReplay!.processedThroughAt > start, 'the world moved');
});

test('a long absence is caught up in the worker exactly as the runner does it on one thread', async () => {
  const world = campaign(12);
  const start = world.npcReplay!.processedThroughAt;
  applyCampaignRuntimeForCatchup(world, start);
  const now = start + 3 * 60 * 60 * 1_000;
  const { ui, engine } = setup(world, () => now);
  await engine.handle(structuredClone({ type: 'init', version: 0, state: world, clockOffsetMs: 0, persist: PERSIST }));
  // App does not look at its messages until the catch-up is over: the freeze and the result arrive together.
  await ui.tick(now);
  assert.ok(ui.received.some((message) => message.type === 'progress'));
  ui.receive();
  assert.equal(isNpcCatchupPending(ui.state), false);
  const alone = await runNpcCatchup(freezeNpcCatchupTarget(structuredClone(world), now), { now: () => now });
  assert.equal(text(ui.state), text(alone.state));
  // App, at the caught-up world, goes on ticking.
  await ui.tick(now + 1_000);
  ui.receive();
  assert.ok(ui.saves.some((save) => save.version >= 0), 'the caught-up world was saved');
});

test('a command made on the world before the freeze reached App cancels the catch-up, which starts over from it', async () => {
  const world = campaign(8);
  const start = world.npcReplay!.processedThroughAt;
  applyCampaignRuntimeForCatchup(world, start);
  const now = start + 60 * 60 * 1_000;
  const { ui, engine, worker } = setup(world, () => now);
  await engine.handle(structuredClone({ type: 'init', version: 0, state: world, clockOffsetMs: 0, persist: PERSIST }));
  const ticking = ui.tick(now);
  const planet = ui.state.planets[ui.state.currentPlanetId]!;
  const committing = ui.commit({ ...ui.state, planets: { ...ui.state.planets, [ui.state.currentPlanetId]: { ...planet, name: 'Renamed' } } });
  await Promise.all([ticking, committing]);
  ui.receive();
  // App left the frozen world unseen; the next tick runs the whole catch-up from the renamed world.
  await ui.tick(now);
  ui.receive();
  assert.equal(isNpcCatchupPending(ui.state), false);
  assert.equal(ui.state.planets[ui.state.currentPlanetId]!.name, 'Renamed');
  // The worker learns App took the caught-up world from App's next message.
  await ui.tick(now);
  ui.receive();
  assert.equal(text(worker()), text(ui.state));
});
