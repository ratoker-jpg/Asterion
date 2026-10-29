import type { PirateContactDefeatRecord } from '../domain/pirates/contact-schedule.ts';
import { getFactionShipCatalog, getFactionDefenseCatalog } from '../domain/combat/faction-catalog.ts';
import type { CombatFactionId } from '../domain/combat/factions.ts';
import { getHangarCapacity } from '../domain/buildings/balance-v1.ts';
import { calculateFleetPopulation } from '../domain/fleet/runtime.ts';
import { calculateDefensePopulation } from '../domain/fleet/production.ts';
import { calculateRouteDistance } from '../domain/flights/distance.ts';
import { calculateOneWayDurationMs } from '../domain/flights/speed.ts';
import { getEspionageTargets } from '../domain/espionage/runtime.ts';
import { getPirateContactCyclesBetween } from '../domain/universe/runtime.ts';
import { createPirateContactCycleKey } from '../domain/pirates/contact-schedule.ts';
import { planPirateRaidFleet, type RaidDefenseComposition } from '../domain/pirates/raid.ts';
import { createPirateProfile } from '../domain/pirates/profile.ts';
import { createDefaultPirateState, type PirateState } from '../domain/pirates/mission.ts';
import { advancePirateThreat, isOwnerProtectedFromPirates, pirateCounterFleetChance, pirateRaidChance, pirateSeededDraw } from '../domain/pirates/threat.ts';
import { PIRATE_CATALOG_BY_ID } from '../domain/pirates/catalog.ts';
import { selectOwnerScore } from '../domain/rating/scoring.ts';
import { scaleRuntimeDuration, type RuntimeMode, type TestTimeScale } from '../domain/runtime/mode.ts';
import type { FlightRecord } from '../domain/flights/types.ts';
import type { UniverseCoordinate } from '../domain/universe/types.ts';
import type { SaveState } from './contracts.ts';
import { getCurrentPirateContact } from './pirates.ts';

type RaidTarget = Readonly<{
  id: string;
  ownerId: string;
  name: string;
  coordinate: UniverseCoordinate;
  factionId: CombatFactionId;
  resources: Readonly<{ metal: number; minerals: number; gas: number }>;
  population: number;
  hangarLevel: number;
  defensiveClasses: RaidDefenseComposition;
}>;

const safe = (value: number) => Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
/** Raid targets grouped by owner and system; `onlyOwnerId` keeps one owner's entries in the same order. */
function targetsByOwner(state: SaveState, onlyOwnerId?: string): ReadonlyMap<string, ReadonlyMap<string, RaidTarget[]>> {
  const all = new Map<string, Map<string, RaidTarget[]>>();
  const add = (target: RaidTarget) => {
    const systems = all.get(target.ownerId) ?? new Map<string, RaidTarget[]>();
    all.set(target.ownerId, systems);
    const key = `${target.coordinate.galaxy}:${target.coordinate.system}`;
    systems.set(key, [...(systems.get(key) ?? []), target]);
  };
  const playerFaction = state.profile.factionId as CombatFactionId;
  const describe = (
    faction: CombatFactionId, ships: Record<string, number>, defenses: Record<string, number>,
  ): RaidDefenseComposition => [
    ...getFactionShipCatalog(faction).flatMap((ship) => {
      const count = safe(ships[ship.id] ?? 0);
      return count > 0 && ship.ordinaryClass
        ? [{ kind: 'ship' as const, ordinaryClass: ship.ordinaryClass,
          population: count * ship.population, armorStrength: ship.combat.armorStrength }]
        : [];
    }),
    // Defense installations have no ordinary matchup class in production:
    // against them the resolver uses neutral x1 and the real armor value.
    ...getFactionDefenseCatalog(faction).flatMap((defense) => {
      const count = safe(defenses[defense.id] ?? 0);
      return count > 0
        ? [{ kind: 'defense' as const, population: count * defense.population,
          armorStrength: defense.combat.armorStrength }]
        : [];
    }),
  ];
  if (onlyOwnerId === undefined || onlyOwnerId === state.profile.playerId) for (const [id, planet] of Object.entries(state.planets)) {
    add({
      id, ownerId: state.profile.playerId, name: planet.name,
      coordinate: { galaxy: planet.universeGalaxy ?? 1, system: planet.universeSystem ?? 1,
        position: planet.universePosition ?? 1 },
      factionId: playerFaction,
      resources: planet.resources ?? { metal:0,minerals:0,gas:0 },
      population: calculateFleetPopulation(planet.fleet, playerFaction)
        + calculateDefensePopulation(planet.defense, playerFaction),
      hangarLevel: safe(planet.buildings.hangar ?? 0),
      defensiveClasses: describe(playerFaction, planet.fleet.ships, planet.defense.defenses),
    });
  }
  for (const target of Object.values(getEspionageTargets(state.espionage))) {
    if (target.ownerId === state.profile.playerId) continue;
    if (onlyOwnerId !== undefined && target.ownerId !== onlyOwnerId) continue;
    add({
      id: target.id, ownerId: target.ownerId, name: target.name,
      coordinate: { ...target.coordinate }, factionId: target.raceId,
      resources: target.resources,
      population: calculateFleetPopulation(target.fleet, target.raceId)
        + calculateDefensePopulation(target.defense, target.raceId),
      hangarLevel: safe(target.buildings.hangar ?? 0),
      defensiveClasses: describe(target.raceId, target.fleet.ships, target.defense.defenses),
    });
  }
  return all;
}

export type PirateDueRoll = Readonly<{
  at: number;
  ownerId: string;
  contactCycleKey: string;
  galaxy: number;
  system: number;
}>;

export function selectDuePirateRolls(
  state: SaveState, after: number, until: number,
  mode: RuntimeMode = 'production', testTimeScale?: TestTimeScale,
): readonly PirateDueRoll[] {
  const delay = scaleRuntimeDuration(15 * 60_000, mode, testTimeScale);
  const targets = targetsByOwner(state);
  // Each system's defeats once, in save order (the schedule reads only its own),
  // and each system's due cycles once for all owners in it.
  const defeatsBySystem = new Map<string, PirateContactDefeatRecord[]>();
  for (const record of Object.values(state.pirate?.contact.defeatedCycles ?? {})) {
    const key = `${record.galaxy}:${record.system}`;
    const bucket = defeatsBySystem.get(key);
    if (bucket) bucket.push(record);
    else defeatsBySystem.set(key, [record]);
  }
  const cyclesBySystem = new Map<string, ReturnType<typeof getPirateContactCyclesBetween>>();
  const result: PirateDueRoll[] = [];
  for (const [ownerId, systems] of targets) {
    for (const key of systems.keys()) {
      const [galaxy, system] = key.split(':').map(Number);
      const systemKey = `${galaxy}:${system}`;
      let cycles = cyclesBySystem.get(systemKey);
      if (!cycles) cyclesBySystem.set(systemKey, cycles = getPirateContactCyclesBetween(galaxy!, system!, after, until, defeatsBySystem.get(systemKey) ?? [], delay));
      for (const cycle of cycles) {
        result.push({
          at: cycle.startAt + delay, ownerId, galaxy: galaxy!, system: system!,
          contactCycleKey: createPirateContactCycleKey({
            galaxy: galaxy!, system: system!, cycleIndex: cycle.cycleIndex, startAt: cycle.startAt,
          }),
        });
      }
    }
  }
  return result.sort((a,b)=>a.at-b.at || a.contactCycleKey.localeCompare(b.contactCycleKey)
    || a.ownerId.localeCompare(b.ownerId));
}

type RaidRollLedger = Record<string, NonNullable<PirateState['raidRolls']>[string]>;

/**
 * Lets one catch-up pass record many rolls without copying the whole,
 * ever-growing roll ledger per roll. The pass copies the ledger on its first
 * roll and afterwards appends to that private copy, which no earlier state
 * shares; the resulting ledger equals the one per-roll copies would build.
 */
export type PirateRollWriteScope = { raidRolls?: RaidRollLedger };

/** Exactly once per owner/contact, irrespective of how many owned colonies share the system. */
export function resolveDuePirateRoll(
  state: SaveState,
  event: PirateDueRoll,
  mode: RuntimeMode = 'production',
  testTimeScale?: TestTimeScale,
  writeScope?: PirateRollWriteScope,
): SaveState {
  const pirate: PirateState = state.pirate ?? createDefaultPirateState();
  const rollKey = JSON.stringify([event.ownerId, event.contactCycleKey]);
  if (pirate.raidRolls?.[rollKey]) return state;
  const seed = `pirate-raid-v1:${event.ownerId}:${event.contactCycleKey}`;
  const current = pirate.ownerThreats?.[event.ownerId] ?? {
    version: 1 as const, ageHours: 0, integratedAt: pirate.raidProcessedAt ?? event.at,
  };
  const points = selectOwnerScore(state, event.ownerId);
  const resourcePoints = safe(points?.resourcePoints ?? 0);
  const battlePoints = safe(points?.battlePoints ?? 0);
  const protectedOwner = isOwnerProtectedFromPirates(resourcePoints, battlePoints);
  // A protected owner's threat clock moves on without ageing, so crossing the
  // threshold later starts from the threat they already had, not a backlog.
  const threat = protectedOwner
    ? (event.at > current.integratedAt ? { ...current, integratedAt: event.at } : current)
    : advancePirateThreat(current, event.at);
  const chance = protectedOwner ? 0 : pirateRaidChance(resourcePoints, battlePoints, threat.ageHours);
  const qualified = pirateSeededDraw(seed) < chance;
  const allTargets = targetsByOwner(state, event.ownerId);
  const candidates = allTargets.get(event.ownerId)?.get(`${event.galaxy}:${event.system}`) ?? [];
  const selected = candidates.length ? [...candidates].sort((a,b)=>a.id.localeCompare(b.id))[
    Math.floor(pirateSeededDraw(`${seed}:target`) * candidates.length)
  ] : undefined;
  const contact = getCurrentPirateContact(state, {
    galaxy: event.galaxy, system: event.system, position: 1,
  }, event.at, mode);
  let flight: FlightRecord | undefined;
  if (qualified && selected && contact?.contactCycleKey === event.contactCycleKey) {
    const counter = pirateSeededDraw(`${seed}:counter`) < pirateCounterFleetChance(resourcePoints, battlePoints, chance);
    const profile = createPirateProfile({
      ownerId: event.ownerId,
      contactCycleKey: event.contactCycleKey,
      score: { resourcePoints, battlePoints, totalPoints: Math.min(Number.MAX_SAFE_INTEGER, resourcePoints+battlePoints) },
    });
    const maxLevel = Math.max(pirate.ownerMaxHangarLevel?.[event.ownerId] ?? 0,
      ...[...allTargets.get(event.ownerId)?.values() ?? []].flatMap((entries)=>entries.map(x=>x.hangarLevel)));
    const historicalCapacity = getHangarCapacity(maxLevel);
    const fleet = planPirateRaidFleet({
      seed, defendingPopulation: selected.population,
      possibleLoot: Math.floor(safe(selected.resources.metal)*0.75)
        + Math.floor(safe(selected.resources.minerals)*0.75)
        + Math.floor(safe(selected.resources.gas)*0.75),
      historicalHangarCapacity: historicalCapacity,
      profile, counterFleet: counter, defense: selected.defensiveClasses,
    });
    if (fleet.population > 0) {
      const routeDistance = calculateRouteDistance(contact.coordinate, selected.coordinate);
      const speed = Math.min(...Object.entries(fleet.ships)
        .filter(([,count])=>count>0)
        .map(([shipId]) => PIRATE_CATALOG_BY_ID[shipId as keyof typeof PIRATE_CATALOG_BY_ID].flightSpeed));
      if (Number.isFinite(speed) && speed > 0 && routeDistance > 0) {
        const duration = scaleRuntimeDuration(
          calculateOneWayDurationMs(contact.coordinate,selected.coordinate,speed),mode,testTimeScale);
        const requestId = `pirate-raid:${event.ownerId}:${event.contactCycleKey}`;
        flight = {
          id: `flight-${requestId}`, requestId,
          ownerSide: 'pirate', missionId: 'pirate-raid',
          originPlanetId: `pirate-contact-${event.contactCycleKey}`,
          originCoordinate: { ...contact.coordinate },
          destination: { kind:'planet',planetId:selected.id,coordinate:{...selected.coordinate} },
          destinationPlanetId: selected.id, destinationOwnerId:event.ownerId,
          targetKind: event.ownerId === state.profile.playerId ? 'player' : 'npc',
          targetRelation: 'enemy', targetPlanetName: selected.name,
          destinationCoordinate: {...selected.coordinate}, selectedShips: {},
          pirateRaidSnapshot: {
            version: 1, ownerId: event.ownerId, contactCycleKey:event.contactCycleKey,
            targetPlanetId:selected.id,checkAt:event.at, maxRounds:12, counterFleet:counter,
            composition: {...fleet.ships},profile,
          },
          populationReserved:fleet.population,
          routeDistance,effectiveSpeed:speed,oneWayDurationMs:duration,
          departedAt:event.at,arrivalAt:event.at+duration,gasCost:0,
          phase:'outbound',
        };
      }
    }
  }
  return {
    ...state,
    pirate: {
      ...pirate,
      ownerMaxHangarLevel: {...pirate.ownerMaxHangarLevel,
        [event.ownerId]:Math.max(pirate.ownerMaxHangarLevel?.[event.ownerId]??0,
          ...[...allTargets.get(event.ownerId)?.values() ?? []].flatMap((entries)=>entries.map(x=>x.hangarLevel)))},
      ownerThreats: {...pirate.ownerThreats,[event.ownerId]:threat},
      raidRolls: appendRaidRoll(pirate.raidRolls, rollKey, {checkAt:event.at,seed,...(flight?{flightId:flight.id}:{})}, writeScope),
    },
    ...(flight ? {
      flights: {
        records:[...state.flights.records,flight],
        requestIndex:{...state.flights.requestIndex,[flight.requestId]:flight.id},
      },
    } : {}),
  };
}

function appendRaidRoll(
  current: PirateState['raidRolls'],
  rollKey: string,
  roll: RaidRollLedger[string],
  writeScope?: PirateRollWriteScope,
): RaidRollLedger {
  if (!writeScope) return { ...current, [rollKey]: roll };
  // Only the scope's own copy is ever written; any other ledger (the caller's
  // input, a migrated or replaced one) is copied first.
  if (writeScope.raidRolls === undefined || writeScope.raidRolls !== current) writeScope.raidRolls = { ...current };
  writeScope.raidRolls[rollKey] = roll;
  return writeScope.raidRolls;
}
