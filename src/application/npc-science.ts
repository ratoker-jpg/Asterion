import { SCIENCE_CATALOG } from '../domain/science/catalog.ts';
import { discardScienceTasksForPlanet, previewScience, reconcileScienceState, startScienceResearch,
  type ScienceState, type ScienceRuntimeContext } from '../domain/science/runtime.ts';
import type { ScienceId } from '../domain/science/types.ts';
import type { NpcScienceLedger } from '../domain/npc/science-state.ts';
import { consumeEnergy } from '../domain/energy/runtime.ts';
import { creditResources } from '../domain/resources/credit.ts';
import { getStorageCapacities } from '../domain/buildings/resource-zone.ts';
import { OVERPOPULATION_WINDOW_MS } from '../domain/fleet/overpopulation.ts';
import { createSeededRandom } from '../domain/world/random.ts';
import type { SpyTargetState } from '../domain/espionage/types.ts';
import type { SaveState } from './contracts.ts';
import { UNIVERSE_NPC_OWNER_ID } from '../domain/universe/runtime.ts';
import { isNpcPlanetBlocked, NPC_APPLIED_ID_LIMIT, projectNpcScience, targetEnergyLedger } from './npc-economy.ts';

function scienceContext(target: SpyTargetState, science: ScienceState, at: number, timeScale: number): ScienceRuntimeContext {
  return { state: science, wallet: { metal: target.resources.metal, minerals: target.resources.minerals,
    gas: target.resources.gas, energy: targetEnergyLedger(target).availableEnergy },
  planetId: target.id, laboratoryLevel: target.buildings.research ?? 0, now: at,
  mode: 'production', durationScale: timeScale };
}

export function getNpcScienceCandidates(target: SpyTargetState, science: ScienceState, at: number, timeScale: number) {
  if (isNpcPlanetBlocked(target) || science.queue.length >= 3 || !(target.buildings.research > 0)) return [];
  const context = scienceContext(target, science, at, timeScale);
  return SCIENCE_CATALOG.map(({ id }) => previewScience(context, id));
}

/** The saved decision cursor and the paid task ID jointly make replay idempotent. */
export function startNpcScience(target: SpyTargetState, science: ScienceState, scienceId: ScienceId,
  at: number, timeScale: number, idempotencyKey: string) {
  if (target.economyAppliedActionIds?.includes(idempotencyKey) || science.queue.some((task) => task.id === idempotencyKey)) {
    return { target, science, ok: true, reason: null };
  }
  if (isNpcPlanetBlocked(target)) return { target, science, ok: false, reason: 'Планета заблокирована из-за перенаселения.' };
  const transition = startScienceResearch(scienceContext(target, science, at, timeScale), scienceId, idempotencyKey);
  if (!transition.ok || !transition.task) return { target, science, ok: false, reason: transition.reason };
  const charged = consumeEnergy(targetEnergyLedger(target), transition.task.cost.energy, idempotencyKey);
  if (!charged.ok) return { target, science, ok: false, reason: charged.reason };
  return { ok: true, reason: null, science: transition.state, target: { ...target,
    resources: { ...target.resources, metal: transition.wallet.metal, minerals: transition.wallet.minerals,
      gas: transition.wallet.gas, developmentEnergy: Math.max(0, charged.ledger.availableEnergy) },
    energyLedger: charged.ledger,
    economyAppliedActionIds: [...(target.economyAppliedActionIds ?? []), idempotencyKey].slice(-NPC_APPLIED_ID_LIMIT) } };
}

export function projectNpcScienceLedger(state: SaveState): SaveState {
  if (!state.npcScience || !state.espionage) return state;
  let changed = false;
  const targets = { ...state.espionage.targets };
  for (const target of Object.values(targets)) {
    const science = target.kind === 'npc' && target.ownerId !== state.profile.playerId && target.ownerId !== UNIVERSE_NPC_OWNER_ID
      ? state.npcScience.owners[target.ownerId] : undefined;
    if (!science) continue;
    const projected = projectNpcScience(target, science.levels);
    if (projected !== target) { targets[target.id] = projected; changed = true; }
  }
  return changed ? { ...state, espionage: { ...state.espionage, targets } } : state;
}

/** Only head dates are inspected; no catalogue preview work occurs on combat checkpoints. */
export function getNextNpcScienceCheckpoint(state: SaveState, after: number, through: number): number | undefined {
  let earliest: number | undefined;
  for (const science of Object.values(state.npcScience?.owners ?? {})) {
    const task = science.queue[0];
    if (!task || task.finishAt <= after || task.finishAt > through) continue;
    const target = task.planetId ? state.espionage?.targets?.[task.planetId] : undefined;
    if (target?.overpopulation?.blocked && task.finishAt > target.overpopulation.episodeStartedAt) continue;
    earliest = Math.min(earliest ?? task.finishAt, task.finishAt);
  }
  return earliest;
}

/** Shift the FIFO once for each elapsed locked interval, before completing work. */
export function pauseNpcScienceForSettlement(ledger: NpcScienceLedger | undefined,
  before: Readonly<Record<string, SpyTargetState>>, settledOwnerIds: ReadonlySet<string>, at: number,
  after: Readonly<Record<string, SpyTargetState>> = before): NpcScienceLedger | undefined {
  if (!ledger) return ledger;
  let owners = ledger.owners;
  for (const ownerId of settledOwnerIds) {
    const science = owners[ownerId];
    if (!science?.queue.length) continue;
    let first = science.queue.length;
    let delta = 0;
    science.queue.forEach((task, index) => {
      const payer = task.planetId ? before[task.planetId] : undefined;
      if (!payer?.overpopulation?.blocked || task.finishAt <= payer.overpopulation.episodeStartedAt) return;
      const blockedAt = Math.max(payer.overpopulation.episodeStartedAt, task.startedAt);
      // Some fleets cannot burn eligible units. Their lock survives the nominal
      // window, so work stays paused until the actual settlement unlocks it.
      const nominalEnd = payer.overpopulation.episodeStartedAt + OVERPOPULATION_WINDOW_MS;
      const persistentLock = payer.overpopulation.lastResolutionReason === 'no-eligible-units'
        || (payer.resourceClock?.lastReconciledAt ?? 0) >= nominalEnd;
      const end = persistentLock || after[payer.id]?.overpopulation?.blocked ? at : Math.min(at, nominalEnd);
      const elapsed = Math.max(0, end - Math.max(blockedAt, payer.resourceClock?.lastReconciledAt ?? at));
      if (elapsed > 0) { first = Math.min(first, index); delta = Math.max(delta, elapsed); }
    });
    if (!delta) continue;
    owners = { ...owners, [ownerId]: { ...science, queue: science.queue.map((task, index) => index < first ? task
      : { ...task, startedAt: task.startedAt + delta, finishAt: task.finishAt + delta }) } };
  }
  return owners === ledger.owners ? ledger : { ...ledger, owners };
}

/** Economies must be settled to `at` under old levels before calling this. */
export function reconcileNpcScienceAt(state: SaveState, at: number, ownerIds?: ReadonlySet<string>): { state: SaveState; completed: { ownerId: string; scienceId: ScienceId; at: number }[] } {
  const completed: { ownerId: string; scienceId: ScienceId; at: number }[] = [];
  if (!state.npcScience || !state.espionage) return { state, completed };
  let owners = state.npcScience.owners;
  let targets = state.espionage.targets ?? {};
  const entries = ownerIds ? [...ownerIds].flatMap((id) => owners[id] ? [[id, owners[id]!] as const] : []) : Object.entries(owners);
  // Combat normally changes no payer ownership and no science timer. In that
  // common case avoid materializing every target/owner at every pirate roll.
  if (ownerIds && !entries.some(([ownerId, science]) => science.queue.some((task) =>
    task.finishAt <= at || !task.planetId || targets[task.planetId]?.ownerId !== ownerId))) return { state, completed };
  const planetsByOwner = new Map<string, SpyTargetState[]>();
  for (const target of Object.values(targets)) {
    if (target.kind !== 'npc' || target.ownerId === state.profile.playerId || target.ownerId === UNIVERSE_NPC_OWNER_ID) continue;
    const planets = planetsByOwner.get(target.ownerId) ?? [];
    planets.push(target);
    planetsByOwner.set(target.ownerId, planets);
  }
  for (const [ownerId, initialScience] of entries) {
    const planets = planetsByOwner.get(ownerId) ?? [];
    if (!planets.length) { owners = { ...owners }; delete owners[ownerId]; continue; }
    if (!initialScience.queue.length) continue;
    if (initialScience.queue[0]!.finishAt > at && initialScience.queue.every((task) =>
      task.planetId && targets[task.planetId]?.ownerId === ownerId)) continue;
    let science = initialScience;
    for (const payerId of new Set(science.queue.map((task) => task.planetId))) {
      if (!payerId || planets.some((target) => target.id === payerId)) continue;
      const discarded = discardScienceTasksForPlanet(science, payerId, at,
        createSeededRandom(JSON.stringify(['npc-science-destruction', ownerId, payerId, science.queue.map((task) => task.id)])));
      science = discarded.state;
      for (const { task, refund } of discarded.taskRefunds) {
        const payer = task.planetId ? targets[task.planetId] : undefined;
        if (!payer || payer.ownerId !== ownerId) continue;
        const credited = creditResources({ ...payer.resources, energy: payer.resources.developmentEnergy }, getStorageCapacities(payer.buildings), refund);
        targets = { ...targets, [payer.id]: { ...payer, resources: { ...payer.resources,
          metal: credited.wallet.metal, minerals: credited.wallet.minerals, gas: credited.wallet.gas } } };
      }
    }
    const blocked = new Set(planets.filter((target) => target.overpopulation?.blocked).map((target) => target.id));
    const blockedAt = new Map(planets.filter((target) => target.overpopulation?.blocked).map((target) => [target.id, target.overpopulation!.episodeStartedAt]));
    const result = reconcileScienceState(science, at, blocked, blockedAt);
    if (science !== initialScience || result.changed) owners = { ...owners, [ownerId]: result.changed ? result.state : science };
    for (const task of result.completed) completed.push({ ownerId, scienceId: task.scienceId, at: task.finishAt });
  }
  const next = owners !== state.npcScience.owners || targets !== state.espionage.targets
    ? { ...state, npcScience: { ...state.npcScience, owners }, espionage: { ...state.espionage, targets } } : state;
  return { state: next === state ? state : projectNpcScienceLedger(next), completed };
}
