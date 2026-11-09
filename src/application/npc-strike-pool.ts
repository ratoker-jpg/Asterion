// One strong attack, not a trickle (owner rule 06.11.2026: no cap on attacks, but a bot hits with real force at once).
// When the planet that opens an attack cannot send a decisive force alone, the owner's other planets add the rest and
// their fleets land right behind it, so the defender meets one strike, not several small raids spread over minutes.
// Same rules as every flight: each companion is an ordinary NPC attack of its own, takes a flight slot and pays its gas.
import { getFactionShipCatalog } from '../domain/combat/faction-catalog.ts';
import type { ShipId } from '../domain/combat/ids.ts';
import type { FlightRecord } from '../domain/flights/types.ts';
import type { SpyReportSnapshot, SpyTargetState } from '../domain/espionage/types.ts';
import { estimateForcePower, type ForceStack } from '../domain/npc/utility.ts';
import type { SaveState } from './contracts.ts';
import { dispatchNpcMission, getNpcMissionAvailableFleet, type NpcMissionDispatchCommand } from './npc-missions.ts';
import { withoutNpcPlanReserve } from './npc-plan-reserve.ts';
import { withoutNpcSunPrepHold } from './npc-sun-prep-state.ts';
import { combatEfficiency, estimateReportedPower, npcDecisiveMargin, type NpcUtilityContext } from './npc-utility.ts';

const SECOND = 1_000;
/** A companion lands no sooner than the opening fleet and at most this long behind it. */
export const STRIKE_COMPANION_MAX_GAP_MS = 45 * SECOND;
/** The most companion fleets one strike asks for. */
const MAX_COMPANIONS = 3;

type Catalog = ReadonlyArray<{ id: string; category?: string; combat?: { attack: number; life: number }; cost?: { metal?: number; minerals?: number; gas?: number } }>;

function stacksOf(catalog: Catalog, counts: Readonly<Partial<Record<string, number>>>): ForceStack[] {
  return catalog.flatMap((entity) => {
    const count = counts[entity.id] ?? 0;
    return count > 0 && entity.combat ? [{ count, attack: entity.combat.attack, life: entity.combat.life }] : [];
  });
}

export type NpcStrikeCompanionResult = Readonly<{ state: SaveState; companions: number }>;

/**
 * After the opening fleet `main` has left for the planet the report describes: when it is short of the decisive force
 * the owner wants against that planet, other own planets send combat ships that land within the allowed gap behind it.
 * Returns the state with the companions dispatched (unchanged when the opening fleet is decisive already).
 */
export function dispatchNpcStrikeCompanions(state: SaveState, context: NpcUtilityContext, command: NpcMissionDispatchCommand, main: FlightRecord,
  report: SpyReportSnapshot, targetOnline: boolean, at: number, timeScale: number): NpcStrikeCompanionResult {
  const origin = state.espionage?.targets?.[command.originPlanetId];
  if (!origin) return { state, companions: 0 };
  const catalogOf = (planet: SpyTargetState) => getFactionShipCatalog(planet.raceId) as Catalog;
  const mainPower = estimateForcePower(stacksOf(catalogOf(origin), main.selectedShips as Readonly<Partial<Record<string, number>>>));
  const enemy = estimateReportedPower(context, report, mainPower);
  const decisive = npcDecisiveMargin(context.profile.traits, targetOnline) * enemy;
  if (!(mainPower < decisive)) return { state, companions: 0 };
  const owned = Object.values(state.espionage?.targets ?? {})
    .filter((planet) => planet.kind === 'npc' && planet.ownerId === command.ownerId && planet.id !== command.originPlanetId)
    .sort((left, right) => (left.id < right.id ? -1 : 1));
  let current = state;
  let power = mainPower;
  let companions = 0;
  for (const planet of owned) {
    if (companions >= MAX_COMPANIONS || power >= decisive) break;
    const free = withoutNpcPlanReserve(current, command.ownerId, planet.id,
      withoutNpcSunPrepHold(current, command.ownerId, planet.id, getNpcMissionAvailableFleet(current, command.ownerId, planet.id), at));
    if (!free) continue;
    const catalog = catalogOf(planet);
    const fighters = catalog
      .filter((entity) => entity.category === 'Боевой корабль' && (free[entity.id as ShipId] ?? 0) > 0)
      .sort((left, right) => combatEfficiency(right) - combatEfficiency(left) || (left.id < right.id ? -1 : 1));
    if (!fighters.length) continue;
    // Strongest per price first, one stack at a time, until the strike is decisive (or the planet has no more).
    const picked: Record<string, number> = {};
    let total = power;
    for (const entity of fighters) {
      const have = Math.max(0, Math.floor(free[entity.id as ShipId] ?? 0));
      let take = 0;
      while (take < have && total < decisive) {
        take = Math.min(have, Math.max(take + 1, Math.ceil(take * 1.25)));
        total = power + estimateForcePower(stacksOf(catalog, { ...picked, [entity.id]: take }));
      }
      if (take > 0) picked[entity.id] = take;
      if (total >= decisive) break;
    }
    if (!Object.keys(picked).length) continue;
    const cmd: NpcMissionDispatchCommand = { ...command, originPlanetId: planet.id, requestId: `${command.requestId}:strike:${planet.id}`,
      selectedShips: picked as Partial<Record<ShipId, number>>, selectedCommanders: undefined };
    const trial = dispatchNpcMission(current, cmd, at, timeScale);
    if (!trial.ok || !trial.flight) continue;
    const gap = trial.flight.arrivalAt - main.arrivalAt;
    if (gap < 0 || gap > STRIKE_COMPANION_MAX_GAP_MS) continue;
    current = trial.state;
    power = total;
    companions += 1;
  }
  return { state: current, companions };
}
