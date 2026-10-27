import { migrateBuildingLevels } from '../domain/buildings/resource-zone.ts';
import {
  createDefaultSpaceportUpgradeState,
  enqueueSpaceportUpgrade,
  getSpaceportUpgradeCatalog,
  previewSpaceportUpgrade,
  type SpaceportUpgradeContext,
  type SpaceportUpgradePreview,
  type SpaceportUpgradeState,
  type SpaceportUpgradeTrack,
} from '../domain/buildings/spaceport-upgrades.ts';
import type { CommanderId } from '../domain/combat/commanders.ts';
import { syncSpyTargetCommanderCounts } from '../domain/espionage/runtime.ts';
import type { ShipId } from '../domain/combat/ids.ts';
import type { SpyTargetState } from '../domain/espionage/types.ts';
import { ACTIVE_RUNTIME_MODE } from '../domain/runtime/mode.ts';
import type { ScienceLevels } from '../domain/science/runtime.ts';

/**
 * Ship upgrades in the Spaceport for autonomous NPC owners, through the
 * player's own catalog, prices, requirements and queue. Upgrade levels are
 * owner-wide: a finished upgrade raises the ship on every planet of its owner.
 */

function spaceportLevelOf(target: SpyTargetState): number {
  return Math.max(0, Math.floor(migrateBuildingLevels(target.buildings).spaceport ?? 0));
}

/** The planet's upgrade queue over the owner's authoritative levels. */
function stateOf(target: SpyTargetState): SpaceportUpgradeState {
  const base = target.spaceportUpgrades ?? createDefaultSpaceportUpgradeState();
  // One level map for both tracks, as the player's: ships and commanders by id.
  return { ...base, commanderQueue: base.commanderQueue ?? [],
    shipLevels: { ...base.shipLevels, ...(target.ownerProfile?.shipLevels ?? {}), ...(target.ownerProfile?.commanderLevels ?? {}) } };
}

function contextOf(target: SpyTargetState, scienceLevels: ScienceLevels, timeScale: number): SpaceportUpgradeContext {
  return {
    state: stateOf(target),
    wallet: { metal: target.resources.metal, minerals: target.resources.minerals, gas: target.resources.gas },
    buildings: migrateBuildingLevels(target.buildings),
    scienceLevels,
    spaceportLevel: spaceportLevelOf(target),
    factionId: target.raceId,
    mode: ACTIVE_RUNTIME_MODE,
    testTimeScale: timeScale,
  };
}

/** Ship upgrades this planet could start now (only hulls the owner flies). */
export function getNpcSpaceportCandidates(target: SpyTargetState, scienceLevels: ScienceLevels, timeScale: number,
  ownedShips: Readonly<Partial<Record<string, number>>>): SpaceportUpgradePreview[] {
  if (spaceportLevelOf(target) <= 0) return [];
  const context = contextOf(target, scienceLevels, timeScale);
  return getSpaceportUpgradeCatalog('ships', target.raceId)
    .filter((entity) => (ownedShips[entity.id] ?? 0) > 0)
    .map((entity) => previewSpaceportUpgrade(context, 'ships', entity.id))
    .filter((preview) => preview.canStart);
}

/** Commander upgrades this planet could start now (only commanders the owner has). */
export function getNpcSpaceportCommanderCandidates(target: SpyTargetState, scienceLevels: ScienceLevels, timeScale: number,
  ownedCommanders: Readonly<Partial<Record<string, number>>>): SpaceportUpgradePreview[] {
  if (spaceportLevelOf(target) <= 0) return [];
  const context = contextOf(target, scienceLevels, timeScale);
  return getSpaceportUpgradeCatalog('commanders', target.raceId)
    .filter((entity) => (ownedCommanders[entity.id] ?? 0) > 0)
    .map((entity) => previewSpaceportUpgrade(context, 'commanders', entity.id))
    .filter((preview) => preview.canStart);
}

export function startNpcSpaceportUpgrade(target: SpyTargetState, shipId: ShipId | CommanderId, scienceLevels: ScienceLevels, at: number,
  timeScale: number, key: string, track: SpaceportUpgradeTrack = 'ships'): { ok: boolean; target: SpyTargetState; reason: string | null } {
  if (target.economyAppliedActionIds?.includes(key)) return { ok: false, target, reason: 'duplicate-action' };
  const transition = enqueueSpaceportUpgrade(contextOf(target, scienceLevels, timeScale), track, shipId, at, key);
  if (!transition.ok) return { ok: false, target, reason: transition.reason };
  return {
    ok: true,
    reason: null,
    target: {
      ...target,
      spaceportUpgrades: transition.state,
      resources: { ...target.resources, ...transition.wallet },
      economyAppliedActionIds: [...(target.economyAppliedActionIds ?? []), key].slice(-256),
    },
  };
}

export function getNextNpcSpaceportCheckpoint(target: SpyTargetState, at: number): number | null {
  const due = [target.spaceportUpgrades?.shipQueue[0]?.finishAt, target.spaceportUpgrades?.commanderQueue?.[0]?.finishAt]
    .filter((finishAt): finishAt is number => typeof finishAt === 'number' && finishAt >= at);
  return due.length ? Math.min(...due) : null;
}

/** Finished upgrades raise the ship's level; the owner-wide copy is synced by `syncNpcOwnerShipLevels`. */
export function settleNpcSpaceport(target: SpyTargetState, at: number): SpyTargetState {
  const state = target.spaceportUpgrades;
  const commanderQueue = state?.commanderQueue ?? [];
  if (!state || (!state.shipQueue.some((task) => task.finishAt <= at) && !commanderQueue.some((task) => task.finishAt <= at))) return target;
  const shipLevels = { ...(target.ownerProfile?.shipLevels ?? {}) } as Partial<Record<ShipId, number>>;
  for (const task of state.shipQueue.filter((item) => item.finishAt <= at)) shipLevels[task.shipId as ShipId] = Math.max(shipLevels[task.shipId as ShipId] ?? 0, task.toLevel);
  const commanderLevels = { ...(target.ownerProfile?.commanderLevels ?? {}) } as Partial<Record<CommanderId, number>>;
  for (const task of commanderQueue.filter((item) => item.finishAt <= at)) {
    commanderLevels[task.shipId as CommanderId] = Math.max(commanderLevels[task.shipId as CommanderId] ?? 0, task.toLevel);
  }
  const ownerProfile = { scienceLevels: {}, ...(target.ownerProfile ?? {}), shipLevels, commanderLevels };
  const settled: SpyTargetState = {
    ...target,
    spaceportUpgrades: { ...state, shipLevels: { ...state.shipLevels, ...shipLevels, ...commanderLevels },
      shipQueue: state.shipQueue.filter((task) => task.finishAt > at), commanderQueue: commanderQueue.filter((task) => task.finishAt > at) },
    ownerProfile,
  };
  // Commanders on the planet fight at their new level.
  return syncSpyTargetCommanderCounts(settled, settled.fleet, ownerProfile);
}

/** One owner flies one set of upgrade levels on all of its planets: the highest each ship has reached. */
export function syncNpcOwnerShipLevels(targets: Record<string, SpyTargetState>, ownerIds: ReadonlySet<string>): boolean {
  let changed = false;
  for (const ownerId of ownerIds) {
    const owned = Object.entries(targets).filter(([, target]) => target.kind === 'npc' && target.ownerId === ownerId);
    if (owned.length < 2) continue;
    const best: Partial<Record<ShipId, number>> = {};
    const bestCommanders: Partial<Record<CommanderId, number>> = {};
    for (const [, target] of owned) {
      for (const [id, level] of Object.entries(target.ownerProfile?.shipLevels ?? {}) as [ShipId, number][]) {
        if ((level ?? 0) > (best[id] ?? 0)) best[id] = level;
      }
      for (const [id, level] of Object.entries(target.ownerProfile?.commanderLevels ?? {}) as [CommanderId, number][]) {
        if ((level ?? 0) > (bestCommanders[id] ?? 0)) bestCommanders[id] = level;
      }
    }
    for (const [id, target] of owned) {
      const levels = target.ownerProfile?.shipLevels ?? {};
      const commanderLevels = target.ownerProfile?.commanderLevels ?? {};
      if (Object.entries(best).every(([ship, level]) => (levels[ship as ShipId] ?? 0) >= (level ?? 0))
        && Object.entries(bestCommanders).every(([commander, level]) => (commanderLevels[commander as CommanderId] ?? 0) >= (level ?? 0))) continue;
      const ownerProfile = { scienceLevels: {}, ...(target.ownerProfile ?? {}), shipLevels: { ...levels, ...best },
        commanderLevels: { ...commanderLevels, ...bestCommanders } };
      targets[id] = syncSpyTargetCommanderCounts({ ...target, ownerProfile }, target.fleet, ownerProfile);
      changed = true;
    }
  }
  return changed;
}
