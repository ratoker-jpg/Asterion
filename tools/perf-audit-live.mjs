// Measurement tool of the 120 FPS program (audit PERF-AUDIT-2026-11-10, docs/PERF_MEASUREMENT.md). Never run on the owner's PC: GitHub Actions only.
// A live late world at the game's real cadence (one tick per second): what the worker spends,
// what it posts (patch size by section), what the UI thread spends on taking it (clone, apply,
// the selectors App runs on every new world) and what a save costs.
//   node $LAB_NODE tools/perf-audit-live.mjs --fixture=F [--time-scale=2] [--seconds=90]
import fs from 'node:fs';
import { reconcileRuntime } from '../src/application/reconcile.ts';
import { applyWorldPatch, describePatch, diffWorld } from '../src/application/world-diff.ts';
import { loadSavedState, serializeSaveForStorage } from '../src/application/persistence.ts';
import { setCampaignTimeScale } from '../src/domain/runtime/mode.ts';
import { applyCampaignRuntimeForCatchup } from '../src/application/npc-catchup-runner.ts';
import { getFleetBuildBudget, getFleetSummaryForState, getOutgoingFleetSummaryForState, getPlanetPopulationForState } from '../src/application/fleet.ts';
import { getPendingInboundPopulation } from '../src/application/flights.ts';
import { getPlanetOverpopulationSummary } from '../src/application/overpopulation.ts';
import { selectGateContext, selectIncomingSunAlerts } from '../src/application/sun-raid.ts';
import { selectGateBeacons } from '../src/application/sun-gate-watch.ts';
import { selectHeaderAlerts } from '../src/ui/header/header-alerts.ts';
import { buildReportsFeed, dropExpiredReportItems, getReportUnreadCounts } from '../src/domain/reports/adapters.ts';
import { reportRetentionCutoff } from '../src/application/history-retention.ts';
import { diffPlayerActions } from '../src/application/player-journal.ts';
import { selectOwnerPresence } from '../src/application/owner-presence.ts';
import { selectOwnerScores } from '../src/domain/rating/scoring.ts';
import { selectRatedAlliances, selectRatedOwners } from '../src/application/runtime.ts';
import { createScienceSnapshot } from '../src/application/science.ts';
import { isHostileFlightIncomingToPlayer } from '../src/application/flight-visibility.ts';

const option = (name, fallback) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const ms = (task) => { const started = performance.now(); const value = task(); return [performance.now() - started, value]; };
const size = (value) => { try { return JSON.stringify(value)?.length ?? 0; } catch { return -1; } };
const out = { fixture: option('fixture') };
const raw = fs.readFileSync(option('fixture'), 'utf8');
out.fixtureChars = raw.length;
const at0 = JSON.parse(raw).npcReplay.processedThroughAt;
let [took, loaded] = ms(() => loadSavedState({ mode: 'production', storage: { getItem: () => raw, setItem() {}, removeItem() {} }, saveKey: 'k', now: () => at0 }));
out.loadSavedStateMs = Math.round(took);
let world = loaded.state;
applyCampaignRuntimeForCatchup(world, at0);
const scale = Number(option('time-scale', '1'));
setCampaignTimeScale(scale);
out.timeScale = scale;
out.counts = { flights: world.flights.records.length, spyTargets: Object.keys(world.espionage?.targets ?? {}).length, spyReports: world.espionage?.reports?.length,
  combatReports: world.combat.reports.length, npcProfiles: Object.keys(world.npc?.profiles ?? {}).length };
out.sectionMb = Object.fromEntries(Object.entries(world).map(([key, value]) => [key, +(size(value) / 1e6).toFixed(2)]).filter(([, mb]) => mb >= 0.2));
[took] = ms(() => structuredClone(world)); out.structuredCloneWorldMs = Math.round(took);
let text; [took, text] = ms(() => serializeSaveForStorage(world, 'production')); out.serializeFirstMs = Math.round(took); out.saveChars = text.length;
[took] = ms(() => structuredClone(text)); out.cloneSaveTextMs = +took.toFixed(1);

const selectors = (state, now) => ({
  getFleetSummaryForState: () => getFleetSummaryForState(state),
  getOutgoingFleetSummaryForState: () => getOutgoingFleetSummaryForState(state),
  getFleetBuildBudget: () => getFleetBuildBudget(state),
  getPlanetPopulationForState: () => getPlanetPopulationForState(state),
  getPendingInboundPopulation: () => getPendingInboundPopulation(state, state.currentPlanetId),
  getPlanetOverpopulationSummary: () => getPlanetOverpopulationSummary(state, state.currentPlanetId),
  incomingAttackCount: () => state.flights.records.filter((flight) => isHostileFlightIncomingToPlayer(flight, state.profile.playerId)).length,
  selectIncomingSunAlerts: () => selectIncomingSunAlerts(state, now),
  selectHeaderAlerts: () => selectHeaderAlerts(state, selectIncomingSunAlerts(state, now), now),
  selectGateContext: () => selectGateContext(state, now),
  selectGateBeacons: () => selectGateBeacons(state, now),
  reportsUnread: () => getReportUnreadCounts(dropExpiredReportItems(buildReportsFeed(state.combat.reports, state.operations, state.command, state.espionage,
    state.reports.overpopulationReports, state.reports.recyclerArrivalReports, state.reports.gasExtractionArrivalReports, state.pirate?.reconReports, state.flights.records,
    state.exploration, state.profile.playerId), reportRetentionCutoff(state.npcReplay.processedThroughAt), state.combat.savedReportIds), state.reports),
  selectOwnerPresence: () => selectOwnerPresence(state),
  selectOwnerScores: () => selectOwnerScores(state),
  selectRatedOwners: () => selectRatedOwners(state),
  selectRatedAlliances: () => selectRatedAlliances(state),
  createScienceSnapshot: () => createScienceSnapshot(state, { planetId: state.currentPlanetId, now, mode: 'production', testTimeScale: 1 }),
});

const seconds = Number(option('seconds', '90'));
let mirror = world;
const rows = [];
const bySection = {};
const selectorMs = {};
for (let tick = 1; tick <= seconds; tick += 1) {
  const now = at0 + tick * 1000;
  const t0 = performance.now();
  const next = reconcileRuntime(world, { planetId: world.currentPlanetId, now, mode: 'production', testTimeScale: 1 }).state;
  const t1 = performance.now();
  const patch = diffWorld(world, next);
  const t2 = performance.now();
  const posted = structuredClone(patch);
  const t3 = performance.now();
  const before = mirror;
  mirror = applyWorldPatch(mirror, posted);
  const t4 = performance.now();
  // What App runs on the UI thread for every new world, each once (as its useMemo/effects do).
  let selectorsTotal = 0;
  for (const [name, task] of Object.entries(selectors(mirror, now))) {
    const started = performance.now();
    try { task(); } catch (error) { selectorMs[name] = `ERR ${String(error.message).slice(0, 120)}`; continue; }
    const spent = performance.now() - started;
    selectorsTotal += spent;
    if (typeof selectorMs[name] !== 'string') (selectorMs[name] ??= []).push(spent);
  }
  const t5 = performance.now();
  diffPlayerActions(before, mirror, now);
  const t6 = performance.now();
  let patchChars = 0;
  for (const op of patch) {
    const chars = size(op);
    patchChars += chars;
    const key = op.p.slice(0, 2).map((part) => (typeof part === 'number' ? '#' : /^npc-|^bot-/.test(String(part)) ? '<owner>' : part)).join('.');
    const entry = bySection[key] ??= { ops: 0, kb: 0 };
    entry.ops += 1; entry.kb += chars / 1e3;
  }
  rows.push({ tick: t1 - t0, diff: t2 - t1, clone: t3 - t2, apply: t4 - t3, selectors: selectorsTotal, journal: t6 - t5, patchKb: patchChars / 1e3, ...describePatch(patch) });
  world = next;
}
const pick = (values) => { const sorted = [...values].sort((a, b) => a - b); const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  return { median: +q(0.5).toFixed(2), p95: +q(0.95).toFixed(2), max: +sorted.at(-1).toFixed(2) }; };
out.perTick = Object.fromEntries(Object.keys(rows[0]).map((key) => [key, pick(rows.map((row) => row[key]))]));
out.uiThreadPerTickMs = pick(rows.map((row) => row.clone / 2 + row.apply + row.selectors + row.journal));
out.selectorsMs = Object.fromEntries(Object.entries(selectorMs).map(([name, values]) => [name, typeof values === 'string' ? values : pick(values)]));
out.patchBySectionPerTick = Object.fromEntries(Object.entries(bySection).sort((a, b) => b[1].kb - a[1].kb).slice(0, 16)
  .map(([key, value]) => [key, { ops: Math.round(value.ops / seconds), kb: +(value.kb / seconds).toFixed(1) }]));
[took, text] = ms(() => serializeSaveForStorage(world, 'production')); out.serializeAfterTicksMs = Math.round(took);
[took] = ms(() => JSON.stringify(world)); out.plainStringifyMs = Math.round(took);
out.equal = JSON.stringify(mirror) === JSON.stringify(world);
const memory = process.memoryUsage();
out.rssMb = Math.round(memory.rss / 1048576); out.heapMb = Math.round(memory.heapUsed / 1048576);
console.log(JSON.stringify(out, null, 1));
