// The second wave of a raid (owner report 05.11.2026): his pattern is a battle fleet first and, a minute behind it,
// the transports and recyclers from another planet that carry the stores off. The combat ships alone hold only a little,
// so a raid that wins still leaves most of the planet behind. Same rules as every flight: the cargo goes as an ordinary
// attack of non-combat hulls, takes a flight slot, pays its gas and flies at its own speed; it is sent only when it
// lands just behind the combat wave (never before it: a hold with no escort dies to what is left of the defence).
import { getFactionShipCatalog } from '../domain/combat/faction-catalog.ts';
import type { ShipId } from '../domain/combat/ids.ts';
import { getFleetCargoCapacity } from '../domain/flights/cargo.ts';
import type { FlightRecord } from '../domain/flights/types.ts';
import type { SpyReportSnapshot, SpyTargetState } from '../domain/espionage/types.ts';
import type { SaveState } from './contracts.ts';
import { dispatchNpcMission, getNpcMissionAvailableFleet, type NpcMissionDispatchCommand } from './npc-missions.ts';
import { npcLootableResources } from './npc-utility.ts';
import { withoutNpcPlanReserve } from './npc-plan-reserve.ts';
import { withoutNpcSunPrepHold } from './npc-sun-prep-state.ts';

const SECOND = 1_000;
/** The cargo wave lands no sooner than the combat wave. On the same millisecond the battle fleet is resolved first (its flight id sorts first), so a near target, where every flight takes the minimum time, still works. */
export const LOOT_WAVE_MIN_GAP_MS = 0;
/** How long behind the combat wave the cargo may land: a planet whose owner is looking is emptied fast, so the gap is short then. */
export const LOOT_WAVE_MAX_GAP_ONLINE_MS = 2 * 60 * SECOND;
export const LOOT_WAVE_MAX_GAP_AWAY_MS = 8 * 60 * SECOND;
/** The most waves from other planets one raid asks for. */
const MAX_WAVES = 3;
/** The share of the stores a battle can carry off (the game's loot rule). */
const LOOTABLE_SHARE = 0.75;
/** Survivors carry less than the sent holds: some of them fall. */
const SURVIVING_HOLD_SHARE = 0.7;

type Catalog = ReadonlyArray<{ id: string; category?: string; ship?: { cargo?: number } }>;

/** Non-combat hulls with a hold, biggest hold first: what a cargo wave is made of. */
function holdIds(raceId: SpyTargetState['raceId']): string[] {
  return (getFactionShipCatalog(raceId) as Catalog)
    .filter((entity) => entity.category !== 'Боевой корабль' && (entity.ship?.cargo ?? 0) > 0 && entity.id !== 'colonizer' && entity.id !== 'spy-probe')
    .sort((left, right) => (right.ship?.cargo ?? 0) - (left.ship?.cargo ?? 0) || (left.id < right.id ? -1 : 1))
    .map((entity) => entity.id);
}

function holdCapacity(raceId: SpyTargetState['raceId'], ships: Readonly<Partial<Record<string, number>>>): number {
  const catalog = Object.fromEntries(getFactionShipCatalog(raceId).map((entity) => [entity.id, { cargo: entity.ship?.cargo ?? 0 }]));
  return getFleetCargoCapacity(ships as Partial<Record<ShipId, number>>, catalog);
}

/** Holds, biggest first, until `need` is covered or the planet has no more. */
function holdsFor(raceId: SpyTargetState['raceId'], free: Readonly<Partial<Record<string, number>>>, need: number): Record<string, number> {
  const catalog = getFactionShipCatalog(raceId) as Catalog;
  const picked: Record<string, number> = {};
  let left = need;
  for (const id of holdIds(raceId)) {
    if (left <= 0) break;
    const cargo = catalog.find((entity) => entity.id === id)?.ship?.cargo ?? 0;
    const count = Math.min(Math.max(0, Math.floor(free[id] ?? 0)), Math.ceil(left / cargo));
    if (count > 0) { picked[id] = count; left -= count * cargo; }
  }
  return picked;
}

export type NpcLootWaveResult = Readonly<{ state: SaveState; waves: number; carried: number }>;

/**
 * After the combat wave `combat` has left for the planet the report describes: sends cargo from the owner's planets
 * (any of them, the combat planet included) that lands within the allowed gap behind it. `targetOnline` is what the
 * map shows of the target's owner. Returns the state with the waves dispatched.
 */
export function dispatchNpcLootWaves(state: SaveState, command: NpcMissionDispatchCommand, combat: FlightRecord, report: SpyReportSnapshot,
  targetOnline: boolean, at: number, timeScale: number): NpcLootWaveResult {
  const origin = state.espionage?.targets?.[command.originPlanetId];
  if (!origin) return { state, waves: 0, carried: 0 };
  // Only what a raid may take is worth a hold: the protected share of each store stays where it is.
  const lootable = npcLootableResources(report.resources);
  const stores = lootable.metal + lootable.minerals + lootable.gas;
  let need = Math.floor(LOOTABLE_SHARE * stores) - Math.floor(SURVIVING_HOLD_SHARE * holdCapacity(origin.raceId, combat.selectedShips));
  const smallestHold = Math.min(...holdIds(origin.raceId).map((id) => holdCapacity(origin.raceId, { [id]: 1 })).filter((cargo) => cargo > 0), Infinity);
  if (!(need >= smallestHold) || !Number.isFinite(smallestHold)) return { state, waves: 0, carried: 0 };
  const maxGap = targetOnline ? LOOT_WAVE_MAX_GAP_ONLINE_MS : LOOT_WAVE_MAX_GAP_AWAY_MS;
  const owned = Object.values(state.espionage?.targets ?? {})
    .filter((planet) => planet.kind === 'npc' && planet.ownerId === command.ownerId)
    .sort((left, right) => (left.id < right.id ? -1 : 1));
  let current = state;
  const used = new Set<string>();
  let waves = 0;
  let carried = 0;
  while (waves < MAX_WAVES && need >= smallestHold) {
    let best: { cmd: NpcMissionDispatchCommand; gap: number; cargo: number } | null = null;
    for (const planet of owned) {
      if (used.has(planet.id)) continue;
      const free = withoutNpcPlanReserve(current, command.ownerId, planet.id,
        withoutNpcSunPrepHold(current, command.ownerId, planet.id, getNpcMissionAvailableFleet(current, command.ownerId, planet.id), at));
      const picked = holdsFor(planet.raceId, free, need);
      const cargo = holdCapacity(planet.raceId, picked);
      if (cargo <= 0) continue;
      const cmd: NpcMissionDispatchCommand = { ...command, originPlanetId: planet.id, requestId: `${command.requestId}:wave:${planet.id}`,
        selectedShips: picked as Partial<Record<ShipId, number>>, selectedCommanders: undefined, attackPriority: undefined };
      const trial = dispatchNpcMission(current, cmd, at, timeScale);
      if (!trial.ok || !trial.flight) continue;
      const gap = trial.flight.arrivalAt - combat.arrivalAt;
      if (gap < LOOT_WAVE_MIN_GAP_MS || gap > maxGap) continue;
      // Lands soon after the opening, but the bigger hold wins a tie: the closest fit to half a minute behind.
      const distance = Math.abs(gap - 30 * SECOND) - cargo / 1e9;
      if (!best || distance < Math.abs(best.gap - 30 * SECOND) - best.cargo / 1e9) best = { cmd, gap, cargo };
    }
    if (!best) break;
    const sent = dispatchNpcMission(current, best.cmd, at, timeScale);
    if (!sent.ok) break;
    current = sent.state;
    used.add(best.cmd.originPlanetId);
    need -= best.cargo;
    carried += best.cargo;
    waves += 1;
  }
  return { state: current, waves, carried };
}
