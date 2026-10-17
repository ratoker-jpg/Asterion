import type { CombatFactionId } from '../domain/combat/factions.ts';
import { getCombatFactionName } from '../domain/combat/factions.ts';
import { getFactionShipCatalog, getFactionCombatEntity } from '../domain/combat/faction-catalog.ts';
import { COMMANDER_IDS, type CommanderId } from '../domain/combat/commanders.ts';
import type { ShipId } from '../domain/combat/ids.ts';
import { DEFAULT_COMBAT_PRIORITY } from '../domain/combat/priority.ts';
import { createDefaultCombatTechnologies } from '../domain/combat/technologies.ts';
import { resolveCombat } from '../domain/combat/resolver.ts';
import type { CombatInput, CombatStackInput } from '../domain/combat/simulator.ts';
import type { BattleReport, BattleForceSnapshot } from '../domain/combat/report.ts';
import type { FlightRecord } from '../domain/flights/types.ts';
import { emptyExplorationCargo, explorationDefenderBonusEligible, explorationProfile } from '../domain/exploration/model.ts';
import { UNIVERSE_NPC_OWNER_ID } from '../domain/universe/runtime.ts';
import { settleExplorationContest, type ExplorationArrival } from '../domain/exploration/ledger.ts';
import { recordBattleScoreAward } from '../domain/rating/scoring.ts';
import { getOwnerShipUpgradeLevels, replacePlanetState, type SaveState } from './contracts.ts';
import { calculateAttackDebris } from './attack.ts';
import { expeditionMiningCapacity, updateExpeditionContact } from './exploration-flight.ts';
import { addDebris } from '../domain/flights/cargo.ts';

const validCount = (value: number | undefined) => Number.isSafeInteger(value) && (value ?? 0) > 0 ? value! : 0;
function surviving(ships: FlightRecord['selectedShips'], force: BattleForceSnapshot): FlightRecord['selectedShips'] {
  const result = { ...ships };
  for (const stack of force.stacks) {
    const id = stack.entityId as ShipId;
    if (id in result) result[id] = Math.max(0, validCount(result[id]) - validCount(stack.destroyed));
  }
  return Object.fromEntries(Object.entries(result).filter(([, count]) => validCount(count) > 0));
}
function survivingCommanders(
  commanders: FlightRecord['selectedCommanders'],
  force: BattleForceSnapshot,
): FlightRecord['selectedCommanders'] {
  const result: NonNullable<FlightRecord['selectedCommanders']> = {};
  const losses = new Map(force.stacks.map(stack => [stack.entityId, validCount(stack.destroyed)]));
  for (const commanderId of COMMANDER_IDS) {
    const selected = Math.min(1, validCount(commanders?.[commanderId]));
    const count = Math.max(0, selected - (losses.get(commanderId) ?? 0));
    if (count > 0) result[commanderId] = count;
  }
  return result;
}
function hasSurvivingCombatants(
  ships: FlightRecord['selectedShips'], commanders: FlightRecord['selectedCommanders'],
): boolean {
  return Object.values(ships).some(count => validCount(count) > 0)
    || Object.values(commanders ?? {}).some(count => validCount(count) > 0);
}
function changeHomeFleet(state: SaveState, flight: FlightRecord, force: BattleForceSnapshot): SaveState {
  const planet = state.planets[flight.originPlanetId];
  if (!planet) return state;
  const next = { ...planet.fleet.ships };
  const commanders = { ...planet.fleet.commanders };
  for (const stack of force.stacks) {
    const id = stack.entityId as ShipId;
    const n = validCount(stack.destroyed);
    if (n && id in next) next[id] = Math.max(0, validCount(next[id]) - n);
    else if (n && id in commanders) commanders[id as keyof typeof commanders] =
      Math.max(0,validCount(commanders[id as keyof typeof commanders])-n);
  }
  return replacePlanetState(state, flight.originPlanetId, { ...planet, fleet: { ...planet.fleet, ships: next, commanders } });
}
function stacks(flight: FlightRecord, faction: CombatFactionId, levels: Partial<Record<ShipId,number>> = {}): CombatStackInput[] {
  const valid = new Set(getFactionShipCatalog(faction).map(item => item.id));
  return Object.entries(flight.selectedShips).flatMap(([id, n]) =>
    valid.has(id as ShipId) && id !== 'solar-satellite' && validCount(n) > 0
      ? [{ entityId: id as ShipId, count: validCount(n), level: Math.max(0,Math.floor(levels[id as ShipId] ?? 0)) }] : []);
}
function commanderStacks(
  flight: FlightRecord,
  levels: Partial<Record<CommanderId, number>> = {},
): CombatStackInput[] {
  return COMMANDER_IDS.flatMap(commanderId => {
    const count = Math.min(1, validCount(flight.selectedCommanders?.[commanderId]));
    return count > 0
      ? [{ entityId: commanderId, count, level: Math.max(0, Math.floor(levels[commanderId] ?? 0)) }]
      : [];
  });
}
function fleetValues(flight: FlightRecord, faction: CombatFactionId): {population:number;cost:number} {
  let population=0,cost=0;
  for (const [id,count] of Object.entries(flight.selectedShips)) {
    if (!validCount(count)) continue;
    const entity = getFactionCombatEntity(faction,id as ShipId);
    if (entity.kind !== 'ship') continue;
    population += (entity.population ?? 0) * validCount(count);
    cost += (entity.cost.metal + entity.cost.minerals + entity.cost.gas) * validCount(count);
  }
  return {population,cost};
}
/** Resolve a contested live field through the SAME production combat resolver as Attack.
 * Both sides are actual dispatched flight records; no synthetic success roll.
 * A report ID and the ledger capture event make offline replays idempotent.
 */
export function resolveExplorationAttackAtTarget(state: SaveState, flight: FlightRecord, at: number):
  {state: SaveState; report: BattleReport; captured: ReturnType<typeof emptyExplorationCargo>; attackerOccupied: boolean} | null {
  if (!flight.explorationAttack || !flight.attackSnapshot || !flight.operationId) return null;
  const contact = state.exploration?.contacts[flight.operationId];
  const claimant = contact?.claim;
  const npcSource=(flight.ownerSide==='npc'||flight.ownerSide==='bot01')
    ? state.espionage?.targets?.[flight.originPlanetId] : undefined;
  if((flight.ownerSide==='npc'||flight.ownerSide==='bot01')&&!npcSource)return null;
  const attackerOwnerId=npcSource?.ownerId??state.profile.playerId;
  if (!contact || !claimant || at >= contact.expiresAt || at < contact.appearedAt
      || claimant.ownerId === attackerOwnerId
      || claimant.pendingRecallAt !== undefined && at >= claimant.pendingRecallAt + 30_000) return null;
  const defenderFlight = state.flights.records.find(item => item.id === claimant.flightId && item.phase === 'arrived');
  if (!defenderFlight || defenderFlight.missionId !== 'expedition' && !defenderFlight.explorationAttack) return null;
  const existingReport = state.combat.reports.find(item => item.id === 'battle-exploration-' + flight.id);
  if (existingReport) return {
    state, report: existingReport,
    captured: contact.events.find(e=>e.id===flight.id+':capture')?.cargo ?? emptyExplorationCargo(),
    attackerOccupied: contact.events.some(event => event.id === flight.id + ':capture'),
  };
  const attackerFaction = flight.attackSnapshot.attackerFactionId;
  const defenderSnapshot = defenderFlight.attackSnapshot;
  const defenderFaction = defenderSnapshot?.attackerFactionId ?? defenderFlight.explorationFactionId ?? state.profile.factionId as CombatFactionId;
  const defenderCommanderLevels = defenderSnapshot?.attackerCommanderLevels
    ?? defenderFlight.selectedCommanderLevels ?? {};
  const attackerStacks = stacks(flight, attackerFaction, flight.attackSnapshot.attackerShipLevels);
  const defenderStacks = stacks(defenderFlight, defenderFaction, defenderSnapshot?.attackerShipLevels);
  const attackerCommanders = commanderStacks(flight, flight.attackSnapshot.attackerCommanderLevels);
  const defenderCommanders = commanderStacks(defenderFlight, defenderCommanderLevels);
  if ((attackerStacks.length === 0 && attackerCommanders.length === 0)
    || (defenderStacks.length === 0 && defenderCommanders.length === 0)) return null;
  // A legacy flight has no launch-time combat data. Keep it loadable and resolve
  // that one historical encounter at the old unupgraded baseline; never borrow
  // technologies or upgrades from the player's later live save.
  const legacyDefenderTechnologies = createDefaultCombatTechnologies();
  const input: CombatInput = {
    scenarioId: 'exploration:' + flight.id,
    timestamp: new Date(at).toISOString(),
    seed: 'exploration-contest:' + flight.id + ':' + claimant.claimId,
    profileId: 'asterion-attack-v1',
    maxRounds: flight.attackSnapshot.maxRounds,
    attackerPriority: [...flight.attackSnapshot.attackerPriority],
    defenderPriority: [...(defenderSnapshot?.defenderPriority ?? DEFAULT_COMBAT_PRIORITY.defense)],
    attackerTechnologies: flight.attackSnapshot.attackerTechnologies,
    defenderTechnologies: defenderSnapshot?.attackerTechnologies ?? legacyDefenderTechnologies,
    technologyMode: 'independent',
    executionMode: 'production',
    attacker: {
      commanders:attackerCommanders,
      participant: {side:'attacker',playerId:attackerOwnerId,playerName:npcSource?.ownerName??state.profile.displayName,
        coordinates:'['+[flight.originCoordinate.galaxy,flight.originCoordinate.system,flight.originCoordinate.position].join(':')+']',
        race:getCombatFactionName(attackerFaction)},
      factionId:attackerFaction,ships:attackerStacks,
    },
    defender: {
      commanders:defenderCommanders,
      participant: {side:'defender',playerId:claimant.ownerId,playerName:claimant.ownerId === state.profile.playerId ? state.profile.displayName : claimant.ownerId === UNIVERSE_NPC_OWNER_ID ? 'Bot 01' : state.espionage?.targets?.[defenderFlight.originPlanetId]?.ownerName??claimant.ownerId,
        planetName:explorationProfile(contact.kind,contact.variant).name,coordinates:'['+[contact.coordinate.galaxy,contact.coordinate.system,contact.coordinate.position].join(':')+']',
        race:getCombatFactionName(defenderFaction)},
      factionId:defenderFaction,ships:defenderStacks,
    },
  };
  const raw = resolveCombat(input, {reportId:'battle-exploration-'+flight.id,missionType:'attack'});
  const newAttackerShips = surviving(flight.selectedShips,raw.attackerForce);
  const newDefenderShips = surviving(defenderFlight.selectedShips,raw.defenderForce);
  const newAttackerCommanders = survivingCommanders(flight.selectedCommanders, raw.attackerForce);
  const newDefenderCommanders = survivingCommanders(defenderFlight.selectedCommanders, raw.defenderForce);
  const attackerSurvivor: FlightRecord = {
    ...flight, selectedShips:newAttackerShips, selectedCommanders:newAttackerCommanders,
  };
  const defenderSurvivor: FlightRecord = {
    ...defenderFlight, selectedShips:newDefenderShips, selectedCommanders:newDefenderCommanders,
  };
  const attackerCapacity = expeditionMiningCapacity(state, attackerSurvivor);
  const defenderCapacity = expeditionMiningCapacity(state, defenderSurvivor);
  const attackerValues = fleetValues(flight,attackerFaction);
  const defenderValues = fleetValues(defenderFlight,defenderFaction);
  const eligible = explorationDefenderBonusEligible(attackerValues.population,attackerValues.cost,
    defenderValues.population,defenderValues.cost);
  const arrival: ExplorationArrival = {
    claimId:flight.id+':claim',flightId:flight.id,ownerId:attackerOwnerId,
    originPlanetId:flight.originPlanetId,arrivedAt:at,
    capacity:attackerCapacity,resourcePointsLaunch:flight.explorationLaunchResourcePoints ?? 1000,
    catchupMultiplier:1,
  };
  const outcome = settleExplorationContest(contact,at,raw.winner,arrival,
    attackerCapacity.all,defenderCapacity,eligible,{
      attacker:hasSurvivingCombatants(newAttackerShips,newAttackerCommanders),
      defender:hasSurvivingCombatants(newDefenderShips,newDefenderCommanders),
    });
  const report: BattleReport = {...raw,
    debris:calculateAttackDebris(raw,attackerFaction,defenderFaction),
    resources:{metal:outcome.captured.metal,minerals:outcome.captured.minerals,gas:outcome.captured.gas}};
  let next = attackerOwnerId === state.profile.playerId ? changeHomeFleet(state,flight,raw.attackerForce) : state;
  if (claimant.ownerId === state.profile.playerId) next = changeHomeFleet(next,defenderFlight,raw.defenderForce);
  let settled = outcome.contact;
  // The displaced owner returns with surviving ships but ZERO escrow cargo:
  // precisely 30% may be captured; everything else was destroyed by contest.
  const attackerOccupied = outcome.contact.claim?.flightId === flight.id;
  if (attackerOccupied) {
    settled = {...settled,events:[...settled.events,{
      id:defenderFlight.id+':release',kind:'recalled' as const,at,
      ownerId:claimant.ownerId,flightId:defenderFlight.id,
      originPlanetId:defenderFlight.originPlanetId,claimId:claimant.claimId,
      cargo:emptyExplorationCargo(),heldMs:0,
    }].slice(-100)};
  }
  next = updateExpeditionContact(next,settled);
  // Canonical persistent coordinate ledger, shared with recycle missions.
  // Battle reports are metadata; the orbital stock is credited exactly once
  // because an already resolved battle exits before applying this mutation.
  const generatedDebris=Math.max(0,Math.floor(report.debris??0));
  if(generatedDebris>0){
    const ledgerKey='exploration-debris-'+contact.id;
    const previous=next.espionage?.orbitalDebris?.[ledgerKey];
    if(next.espionage) {
      next={...next,espionage:{...next.espionage,orbitalDebris:{
        ...(next.espionage.orbitalDebris??{}),
        [ledgerKey]:{
          id:previous?.id??'orbital-debris-'+ledgerKey,
          targetPlanetId:ledgerKey,
          targetPlanetName:explorationProfile(contact.kind,contact.variant).name,
          targetOwnerId:'neutral',
          targetCoordinate:{...contact.coordinate},
          debris:addDebris(previous?.debris??0,generatedDebris),
          createdAt:previous?.createdAt??at,
          reportId:report.id,
        },
      }}};
    }
  }
  next = {...next,
    combat:{...next.combat,reports:[...next.combat.reports,report]},
    rating:recordBattleScoreAward(next.rating,report,state.profile.playerId),
    flights:{...next.flights,records:next.flights.records.map(item => {
      if(item.id === flight.id) return attackerSurvivor;
      if(item.id === defenderFlight.id) {
        const defenderSurvives = hasSurvivingCombatants(newDefenderShips,newDefenderCommanders);
        if(attackerOccupied && defenderSurvives)
          return {...defenderSurvivor,phase:'returning' as const,returnAt:at+defenderFlight.oneWayDurationMs,completionReason:'normal-return' as const};
        if(!defenderSurvives)
          return {...defenderSurvivor,phase:'completed' as const,completedAt:at,completionReason:'mission-failed' as const};
        return defenderSurvivor;
      }
      return item;
    })},
  };
  return {state:next,report,captured:outcome.captured,attackerOccupied};
}
