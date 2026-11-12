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
import { applyQuietBatch } from './quiet-fields.ts';
import { adoptPatch, hasProjection, projectWorld, rehydrateWorld } from './ui-projection.ts';
import type { SpyReportSnapshot } from '../domain/espionage/types.ts';

const PERSIST = { tickMaxIntervalMs: 60_000, tickCostFactor: 50, catchupIntervalMs: 15_000 };

/** App's side of the protocol, as App.tsx does it (messages copied the way postMessage copies them). */
class Ui {
  version = 0;
  nextVersion = 2;
  tickInFlight = false;
  received: LiveWorldResponse[] = [];
  saves: Extract<LiveWorldResponse, { type: 'save' }>[] = [];
  state: SaveState;
  /** The window holds the bots' spy reports as stubs. */
  projecting = false;
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
      // As App does: the quiet fields are written into the world in place.
      if (message.type === 'quiet') applyQuietBatch([this.state], message.batch);
      if (message.type !== 'ticked') continue;
      this.tickInFlight = false;
      if (message.from !== this.version) continue;
      this.state = applyWorldPatch(this.state, this.projecting ? adoptPatch(message.patch) : message.patch);
      this.version = message.to;
    }
  }
}

function setup(world: SaveState, now: () => number, projecting = false) {
  const timers: (() => void)[] = [];
  let ui: Ui;
  const engine = new LiveWorldEngine({
    post: (message) => ui.received.push(structuredClone(message)),
    now,
    yieldToMessages: () => new Promise((resolve) => setImmediate(resolve)),
    later: (task) => { timers.push(task); },
    clock: () => 0,
  });
  ui = new Ui(projecting ? projectWorld(structuredClone(world)) : structuredClone(world), (message) => engine.handle(message));
  ui.projecting = projecting;
  const runTimers = () => { for (const task of timers.splice(0)) task(); };
  return { engine, ui, runTimers, worker: () => (engine as unknown as { ui: SaveState }).ui };
}

const text = (state: SaveState) => serializeSaveForStorage(state, 'production');

test('ticks and commands racing them leave the mirror equal to the world in the worker', async () => {
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
  // The quiet fields (bot economies) come in batches: once more, now.
  await engine.handle({ type: 'quiet-now' });
  ui.receive();
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
  const world = campaign(12);
  const start = world.npcReplay!.processedThroughAt;
  applyCampaignRuntimeForCatchup(world, start);
  const now = start + 24 * 60 * 60 * 1_000;
  const { ui, engine, worker } = setup(world, () => now);
  await engine.handle(structuredClone({ type: 'init', version: 0, state: world, clockOffsetMs: 0, persist: PERSIST }));
  let ticked = false;
  const ticking = ui.tick(now).then(() => { ticked = true; });
  const planet = ui.state.planets[ui.state.currentPlanetId]!;
  const committing = ui.commit({ ...ui.state, planets: { ...ui.state.planets, [ui.state.currentPlanetId]: { ...planet, name: 'Renamed' } } });
  await committing;
  assert.equal(ticked, false, 'the catch-up yields between chunks');
  // App drops the freeze it never built on, and ticks again while the cancelled run still unwinds.
  ui.receive();
  await ui.tick(now);
  await ticking;
  // The worker started over from the renamed world on its own: the caught-up world is on its way.
  ui.receive();
  assert.equal(isNpcCatchupPending(ui.state), false);
  assert.equal(ui.state.planets[ui.state.currentPlanetId]!.name, 'Renamed');
  assert.ok(ui.state.npcReplay!.processedThroughAt >= now - 2_000, 'App has the caught-up world');
  // The worker learns App took the caught-up world from App's next message.
  await ui.tick(now);
  ui.receive();
  await engine.handle({ type: 'quiet-now' });
  ui.receive();
  assert.equal(text(worker()), text(ui.state));
});

test('a command is saved soon after, not after the pause a clock tick asked for', async () => {
  const world = campaign(12);
  const start = world.npcReplay!.processedThroughAt;
  applyCampaignRuntimeForCatchup(world, start);
  let wall = start;
  let cpu = 0;
  const timers: { task: () => void; delayMs: number }[] = [];
  let ui: Ui;
  // Every read of the clock costs a second, so a save "costs" a second and the next tick save waits 50 s.
  const engine = new LiveWorldEngine({
    post: (message) => ui.received.push(structuredClone(message)),
    now: () => wall,
    yieldToMessages: () => new Promise((resolve) => setImmediate(resolve)),
    later: (task, delayMs) => { timers.push({ task, delayMs }); },
    clock: () => (cpu += 1_000),
  });
  ui = new Ui(structuredClone(world), (message) => engine.handle(message));
  await engine.handle(structuredClone({ type: 'init', version: 0, state: world, clockOffsetMs: 0, persist: PERSIST }));
  const fire = () => { for (const { task } of timers.splice(0).sort((a, b) => a.delayMs - b.delayMs)) task(); };
  await ui.tick(wall);
  ui.receive();
  fire();
  ui.receive();
  const savedBefore = ui.saves.length;
  assert.ok(savedBefore > 0, 'the first tick was saved');
  wall += 1_000;
  await ui.tick(wall);
  ui.receive();
  assert.ok(timers.some((timer) => timer.delayMs > 10_000), 'the second tick asked for a long pause');
  const planet = ui.state.planets[ui.state.currentPlanetId]!;
  await ui.commit({ ...ui.state, planets: { ...ui.state.planets, [ui.state.currentPlanetId]: { ...planet, name: 'Closed' } } });
  const soonest = timers.reduce((best, timer) => (timer.delayMs < best.delayMs ? timer : best));
  assert.ok(soonest.delayMs <= 50, `the command asked for its own save at once (got ${soonest.delayMs} ms)`);
  // Only the soonest timer fires: the save it makes already holds the command.
  timers.splice(timers.indexOf(soonest), 1);
  soonest.task();
  ui.receive();
  const last = ui.saves.at(-1)!;
  assert.ok(ui.saves.length > savedBefore, 'a save was written for the command');
  assert.ok(last.text.includes('Closed'), 'the save holds the command');
  // The superseded long timer fires later and writes nothing more.
  const count = ui.saves.length;
  fire();
  ui.receive();
  assert.equal(ui.saves.length, count);
});

test('a large save goes to the port as UTF-8 bytes and never reaches the UI thread as text', async () => {
  const world = campaign(12);
  const start = world.npcReplay!.processedThroughAt;
  applyCampaignRuntimeForCatchup(world, start);
  const sent: { version: number; bytes: ArrayBuffer; chars: number }[] = [];
  const timers: (() => void)[] = [];
  const posted: LiveWorldResponse[] = [];
  const engine = new LiveWorldEngine({
    post: (message) => posted.push(structuredClone(message)),
    now: () => start,
    yieldToMessages: () => new Promise((resolve) => setImmediate(resolve)),
    later: (task) => { timers.push(task); },
    clock: () => 0,
    portMinChars: 0,
    sendSave: (version, bytes, chars) => { sent.push({ version, bytes, chars }); return true; },
  });
  await engine.handle(structuredClone({ type: 'init', version: 0, state: world, clockOffsetMs: 0, persist: PERSIST }));
  const planet = world.planets[world.currentPlanetId]!;
  const renamed = { ...world, planets: { ...world.planets, [world.currentPlanetId]: { ...planet, name: 'Порт Ω' } } };
  await engine.handle(structuredClone({ type: 'commit', from: 0, to: 2, patch: diffWorld(world, renamed), at: 0 }));
  for (const task of timers.splice(0)) task();
  assert.equal(posted.filter((message) => message.type === 'save').length, 0, 'no save text was posted');
  assert.equal(sent.length, 1);
  const expected = text(renamed);
  assert.equal(sent[0]!.version, 2);
  assert.equal(sent[0]!.chars, expected.length);
  assert.ok(Buffer.from(sent[0]!.bytes).equals(Buffer.from(expected, 'utf8')), 'the bytes are the UTF-8 of the save text');

  // The port failed: the same world goes to the UI thread as text.
  engine.savePortFailed();
  for (const task of timers.splice(0)) task();
  const fallback = posted.filter((message): message is Extract<LiveWorldResponse, { type: 'save' }> => message.type === 'save');
  assert.equal(fallback.length, 1);
  assert.equal(fallback[0]!.text, expected);
  assert.equal(sent.length, 1);
});

/** A bot's spy report of the shape a real one has (the fields beyond the four a lookup reads are payload). */
function botReport(owner: string, index: number): SpyReportSnapshot {
  return {
    id: `spy-report-${owner}-${index}`, missionId: `spy-${owner}-${index}`, ownerId: owner, createdAt: 1_000 + index,
    sourcePlanetId: 'npc-x', targetPlanetId: 'helion-01', targetPlanetName: 'Helion', targetOwnerId: 'player-current', targetOwnerName: 'Игрок',
    targetRaceId: 'helion', targetRelation: 'enemy', targetCoordinate: { galaxy: 1, system: 2, position: 3 }, spyLevel: 4, targetEspionageLevel: 2, delta: 2, roll: 0.25,
    quality: 'detailed', resources: { metal: 10.5, minerals: 20, gas: 0, debris: 0, developmentEnergy: 3 }, firstReport: index === 0,
    defense: {}, fleet: { ships: { 'light-fighter': index } }, fleetLevels: {}, commanders: {}, population: { total: 1, fleet: 1, defense: 0 },
  } as unknown as SpyReportSnapshot;
}

function withBotReports(world: SaveState, count: number): SaveState {
  const reports = [] as SpyReportSnapshot[];
  for (let index = 0; index < count; index += 1) {
    reports.push(botReport(`npc-gen-${index % 5}`, index));
    // The player's own report sits among them: it stays whole.
    if (index % 9 === 0) reports.push({ ...botReport(world.profile.playerId, index), id: `own-${index}` });
  }
  return { ...world, espionage: { ...world.espionage!, reports } };
}

test("the window holds the bots' spy reports as stubs and still writes the same save", () => {
  const world = withBotReports(campaign(12), 40);
  const mine = projectWorld(world);
  assert.ok(hasProjection(mine));
  assert.equal(mine.espionage!.reports.length, world.espionage!.reports.length);
  const own = mine.espionage!.reports.filter((report) => report.ownerId === world.profile.playerId);
  assert.ok(own.length > 0 && own.every((report) => 'resources' in report), "the player's own reports are whole");
  assert.equal(mine.espionage!.reports.find((report) => report.id === 'spy-report-npc-gen-1-1')!.createdAt, 1_001, 'a stub answers a lookup by id, owner, mission and time');
  assert.equal(projectWorld(world), mine, 'the same world gives the same projection');
  assert.equal(text(mine), text(world), 'production save');
  assert.equal(serializeSaveForStorage(mine, 'test'), serializeSaveForStorage(world, 'test'), 'plain JSON save');
  assert.equal(JSON.stringify(mine), JSON.stringify(world));
  const whole = rehydrateWorld(mine);
  assert.equal(hasProjection(whole), false);
  assert.equal(JSON.stringify(whole), JSON.stringify(world));
  assert.equal(rehydrateWorld(world), world);
});

test("ticks and commands racing them keep the window's world equal to the worker's while it holds stubs", async () => {
  const world = withBotReports(campaign(12), 60);
  const start = world.npcReplay!.processedThroughAt;
  applyCampaignRuntimeForCatchup(world, start);
  let clock = start;
  const { ui, engine, runTimers, worker } = setup(world, () => clock, true);
  assert.ok(hasProjection(ui.state));
  await engine.handle(structuredClone({ type: 'init', version: 0, state: world, clockOffsetMs: 0, persist: PERSIST, projectReports: true }));
  let added = 0;
  for (let second = 1; second <= 60; second += 1) {
    clock = start + second * 15_000;
    await ui.tick(clock);
    ui.receive();
    // The player's command appends a report of their own (a long list: a run; the patch must not carry stubs back as values).
    if (second % 11 === 0) {
      added += 1;
      const espionage = ui.state.espionage!;
      await ui.commit({ ...ui.state, espionage: { ...espionage, reports: [...espionage.reports, { ...botReport(ui.state.profile.playerId, 500 + added), id: `mine-${added}`, createdAt: clock }] } });
    }
    // ...and one drops the oldest reports, as a retention step would: the stubs around them stay stubs.
    if (second === 30) {
      const espionage = ui.state.espionage!;
      await ui.commit({ ...ui.state, espionage: { ...espionage, reports: espionage.reports.slice(5) } });
    }
    if (second % 20 === 0) runTimers();
  }
  await ui.tick(clock);
  ui.receive();
  await engine.handle({ type: 'quiet-now' });
  ui.receive();
  assert.ok(hasProjection(ui.state), 'the window still holds stubs');
  assert.equal(hasProjection(worker()), false, 'the worker holds the reports');
  for (const key of Object.keys(worker())) assert.ok(JSON.stringify((worker() as Record<string, unknown>)[key]) === JSON.stringify((ui.state as Record<string, unknown>)[key]), `section ${key} differs`);
  assert.equal(text(worker()), text(ui.state));
  assert.equal(JSON.stringify(rehydrateWorld(ui.state).espionage!.reports), JSON.stringify(worker().espionage!.reports));
  assert.ok(added > 0 && worker().espionage!.reports.some((report) => report.id.startsWith('mine-')), 'own reports are in both worlds');
});

test('a short list of reports sent whole by the window comes back as reports, not stubs', async () => {
  const base = campaign(12);
  const world = { ...base, espionage: { ...base.espionage!, reports: [botReport('npc-gen-1', 1), botReport('npc-gen-2', 2)] } };
  const start = world.npcReplay!.processedThroughAt;
  applyCampaignRuntimeForCatchup(world, start);
  const { ui, engine, worker } = setup(world, () => start, true);
  await engine.handle(structuredClone({ type: 'init', version: 0, state: world, clockOffsetMs: 0, persist: PERSIST, projectReports: true }));
  const espionage = ui.state.espionage!;
  assert.ok(hasProjection(ui.state));
  await ui.commit({ ...ui.state, espionage: { ...espionage, reports: [...espionage.reports, { ...botReport(ui.state.profile.playerId, 3), id: 'own-3' }] } });
  assert.equal(hasProjection(worker()), false);
  assert.equal(JSON.stringify(worker().espionage!.reports.map((report) => report.id)), JSON.stringify(['spy-report-npc-gen-1-1', 'spy-report-npc-gen-2-2', 'own-3']));
  assert.equal(JSON.stringify(worker().espionage!.reports[0]), JSON.stringify(botReport('npc-gen-1', 1)));
});
