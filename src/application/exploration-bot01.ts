import type { ShipId } from '../domain/combat/ids.ts';
import type { FlightRecord } from '../domain/flights/types.ts';
import { getFactionShipCatalog } from '../domain/combat/faction-catalog.ts';
import { getEspionageTargets } from '../domain/espionage/runtime.ts';
import { UNIVERSE_NPC_OWNER_ID } from '../domain/universe/runtime.ts';
import { calculateRouteDistance } from '../domain/flights/distance.ts';
import { calculateEffectiveFleetSpeed, calculateOneWayDurationMs } from '../domain/flights/speed.ts';
import { scaleRuntimeDuration, type TestTimeScale } from '../domain/runtime/mode.ts';
import type { UniversePlanetNode } from '../domain/universe/types.ts';
import { selectOwnerScores } from '../domain/rating/scoring.ts';
import type { SaveState } from './contracts.ts';
import { getExplorationTarget } from './exploration.ts';
import { materializeExplorationAtDispatch } from './exploration-flight.ts';
import { explorationRookieProtected } from '../domain/exploration/model.ts';
import type { RuntimeMode } from '../domain/runtime/mode.ts';
import { createBot01IncomingAttackSnapshot } from './attack.ts';

/** Test-only Bot 01 expedition: reserves a finite snapshot from the existing NPC
 * planet, flies a real route, and resolves occupation on actual arrival. No
 * virtual defenders, combat outcomes, or free ship credits. */
export function dispatchBot01Exploration(state: SaveState, selected: UniversePlanetNode, at: number,
  testTimeScale?: TestTimeScale, mode: RuntimeMode = 'test'):
  { ok: true; state: SaveState; flight: FlightRecord; notice: string } |
  { ok: false; state: SaveState; notice: string } {
  const node = getExplorationTarget(state,selected.id,at,mode);
  const occupant = node ? state.exploration?.contacts[node.id]?.claim : undefined;
  if (!node || (mode === 'test' && occupant))
    return {ok:false,state,notice:'Объект исчез или уже занят. Выберите доступную аномалию/уникальный объект.'};
  if(mode==='production' && occupant && occupant.ownerId!==state.profile.playerId)
    return {ok:false,state,notice:'Объект занят другим NPC — повторный рейс не нужен.'};
  const attack=Boolean(mode==='production'&&occupant);
  const requestId=(mode==='test'?'bot01-exploration:':'npc-exploration:')+node.id+(mode==='production'?':'+at:'');
  const existing=state.flights.records.find(record=>record.requestId===requestId);
  if(existing) return {ok:true,state,flight:existing,notice:'Bot 01 уже отправил экспедицию к этому объекту.'};
  const eligible=Object.values(getEspionageTargets(state.espionage))
    .filter(p=>p.ownerId!==state.profile.playerId && (mode==='test' ? p.ownerId===UNIVERSE_NPC_OWNER_ID : p.ownerId!==UNIVERSE_NPC_OWNER_ID)
      && p.coordinate.galaxy===node.coordinate.galaxy);
  // Only actual NPC colonies; no synthetic fleet source or long-distance cross-galaxy fallback.
  const sources=eligible.sort((left,right)=>Math.abs(left.coordinate.system-node.coordinate.system)
    -Math.abs(right.coordinate.system-node.coordinate.system)||left.id.localeCompare(right.id));
  let prepared: {source:typeof sources[number];selectedShips: Partial<Record<ShipId,number>>;speed:number;duration:number;distance:number}|undefined;
  for(const source of sources){
    if(attack && explorationRookieProtected(
      state.exploration?.highestScoresByOwner[state.profile.playerId] ??
        selectOwnerScores(state)[state.profile.playerId]?.resourcePoints ?? 0,
      state.exploration?.highestScoresByOwner[source.ownerId] ??
        selectOwnerScores(state)[source.ownerId]?.resourcePoints ?? 0))continue;
    const catalog=new Set(getFactionShipCatalog(source.raceId).map(s=>s.id));
    // These are already-existing hangar ships, capped to a small test encounter.
    // A planetolom can fight but does not become a fabricated mining hull.
    const selectedShips=Object.fromEntries(Object.entries(source.fleet.ships)
      .filter(([id,n])=>id!=='solar-satellite' && id!=='spy-probe' && id!=='colonizer'
        && catalog.has(id as ShipId) && typeof n==='number' && n>0)
      .map(([id,n])=>[id,Math.min(id==='death-star'?1:6,Math.floor(n!))])) as Partial<Record<ShipId,number>>;
    if(!Object.values(selectedShips).some(n=>n && n>0))continue;
    const speed=calculateEffectiveFleetSpeed(source.raceId,selectedShips);
    const distance=calculateRouteDistance(source.coordinate,node.coordinate);
    if(distance<=0)continue;
    const duration=scaleRuntimeDuration(calculateOneWayDurationMs(source.coordinate,node.coordinate,speed),mode,testTimeScale);
    if(at+duration+30_000>=node.special!.expiresAt)continue;
    prepared={source,selectedShips,speed,duration,distance};break;
  }
  if(!prepared) return {ok:false,state,notice:'Нет доступного реального флота Bot 01 или объект исчезнет раньше прибытия.'};
  const {source,selectedShips,speed,duration,distance}=prepared;
  const flight:FlightRecord={
    id:'flight-'+requestId,requestId,ownerSide:mode==='test'?'bot01':'npc',
    missionId:attack?'attack':'expedition',
    ...(attack?{explorationAttack:true}:{}),
    operationId:node.id,originPlanetId:source.id,originCoordinate:{...source.coordinate},
    destination:{kind:'coordinate',coordinate:{...node.coordinate}},destinationCoordinate:{...node.coordinate},
    targetKind:node.kind,targetRelation:'neutral',targetPlanetName:node.name,
    destinationOwnerId:occupant?.ownerId ?? state.profile.playerId,
    explorationFactionId:source.raceId,selectedShips,populationReserved:0,
    attackSnapshot:createBot01IncomingAttackSnapshot(source,
      source.ownerProfile ?? state.espionage?.bot01Profile ?? {scienceLevels:{},shipLevels:{},commanderLevels:{}}),
    routeDistance:distance,effectiveSpeed:speed,oneWayDurationMs:duration,
    departedAt:at,arrivalAt:at+duration,gasCost:0,phase:'outbound',
    explorationLaunchResourcePoints:selectOwnerScores(state)[source.ownerId]?.resourcePoints??1000,
  };
  const targets={...getEspionageTargets(state.espionage)};
  const remaining={...source.fleet.ships};
  for(const [id,count] of Object.entries(selectedShips) as [ShipId,number][])
    remaining[id]=Math.max(0,(remaining[id]??0)-count);
  targets[source.id]={...source,fleet:{...source.fleet,ships:remaining}};
  let updated:SaveState={...state,espionage:{
    ...state.espionage!,targets,...(state.espionage?.bot01Planets?{bot01Planets:targets}:{}),
  },flights:{...state.flights,records:[...state.flights.records,flight]}};
  updated=materializeExplorationAtDispatch(updated,node.id,at,mode);
  return {ok:true,state:updated,flight,notice:mode==='test'
    ? 'Bot 01 отправил настоящий флот к объекту. После прибытия можно атаковать его через «Операции» → «Атака».'
    : attack?'NPC отправил настоящий флот атаковать вашу экспедицию.':'NPC отправил реальную экспедицию к свободному объекту.'};
}

/** On returning, restore only surviving Bot 01 ships to their real source planet.
 * This is called on one canonical return transition, never during UI rendering. */
export function creditBot01ExplorationSurvivors(state:SaveState,flight:FlightRecord):SaveState{
  if((flight.ownerSide!=='bot01' && flight.ownerSide!=='npc')
    || (flight.missionId!=='expedition' && !flight.explorationAttack))return state;
  const source=getEspionageTargets(state.espionage)[flight.originPlanetId];
  if(!source)return state;
  const ships={...source.fleet.ships};
  for(const [id,count] of Object.entries(flight.selectedShips) as [ShipId,number][])
    if(Number.isSafeInteger(count)&&count>0) ships[id]=(ships[id]??0)+count;
  const targets={...getEspionageTargets(state.espionage),[source.id]:{
    ...source,fleet:{...source.fleet,ships},
  }};
  return {...state,espionage:{...state.espionage!,targets,
    ...(state.espionage?.bot01Planets?{bot01Planets:targets}:{})}};
}
