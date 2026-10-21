import type { CombatFactionId } from '../combat/factions.ts';
import { getFactionShipCatalog } from '../combat/faction-catalog.ts';
import type { ShipId } from '../combat/ids.ts';

export const PIRATE_ADAPTIVE_TARGET_WIN_RATE=0.55;
export const PIRATE_ADAPTIVE_STEP=0.12;
export const PIRATE_ADAPTIVE_MIN_WEIGHT=0.05;

/** Per-owner, persisted. None of these diagnostics are revealed in production UI. */
export type PirateOwnerAdaptation=Readonly<{
  version:1;
  q:number;
  wins:number;
  draws:number;
  losses:number;
  weightedWins:number;
  weightedBattles:number;
  processedFlights:Readonly<Record<string,1>>;
  lastRoll?:Readonly<{flightId:string;coefficient:number;sentPopulation:number;at:number}>;
}>;
export function defaultPirateOwnerAdaptation():PirateOwnerAdaptation {
  return Object.freeze({version:1,q:0,wins:0,draws:0,losses:0,
    weightedWins:0,weightedBattles:0,processedFlights:Object.freeze({})});
}
const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));
const sum=(cost:Readonly<{metal?:number;minerals?:number;gas?:number}>)=>
  Math.max(0,cost.metal??0)+Math.max(0,cost.minerals??0)+Math.max(0,cost.gas??0);

/** Lower/upper ratio only: no guaranteed 55% outcomes or secret forced losses. */
export function pirateAdaptiveInterval(q:number):Readonly<{min:number;max:number}>{
  const x=clamp(Number.isFinite(q)?q:0,0,1);
  return Object.freeze({min:(90+15*x)/100,max:(95+15*x)/100});
}
/** Normalized economic stake (destroyer hull cost per population as fixed race benchmark). */
export function pirateAdaptiveFleetWeight(
  faction:CombatFactionId,selectedShips:Readonly<Partial<Record<ShipId,number>>>,
  sentPopulation:number,historicalCapacity:number,
):number{
  if(!Number.isFinite(sentPopulation)||!Number.isFinite(historicalCapacity)
    ||sentPopulation<=0||historicalCapacity<=0)return 0;
  const catalog=getFactionShipCatalog(faction);
  const benchmark=catalog.find(ship=>ship.id==='destroyer');
  if(!benchmark||benchmark.population<=0)return 0;
  const reference=sum(benchmark.cost)/benchmark.population;
  if(reference<=0)return 0;
  const stake=Object.entries(selectedShips).reduce((acc,[id,quantity])=>{
    if(!Number.isSafeInteger(quantity)||quantity<=0)return acc;
    const ship=catalog.find(entry=>entry.id===id);
    return ship?acc+sum(ship.cost)*quantity:acc;
  },0);
  const fraction=clamp(sentPopulation/historicalCapacity,0,1);
  return clamp(fraction*fraction*clamp(stake/(sentPopulation*reference),0,1),0,1);
}
export function recordPirateAdaptiveOutcome(
  state:PirateOwnerAdaptation,flightId:string,weight:number,outcome:'win'|'draw'|'loss',
):PirateOwnerAdaptation{
  if(state.processedFlights[flightId]||!Number.isFinite(weight)||weight<PIRATE_ADAPTIVE_MIN_WEIGHT||weight>1)
    return state;
  const score=outcome==='win'?1:outcome==='draw'?0.5:0;
  return Object.freeze({...state,q:clamp(state.q+PIRATE_ADAPTIVE_STEP*weight*(score-PIRATE_ADAPTIVE_TARGET_WIN_RATE),0,1),
    wins:state.wins+(outcome==='win'?1:0),draws:state.draws+(outcome==='draw'?1:0),
    losses:state.losses+(outcome==='loss'?1:0),
    weightedWins:state.weightedWins+weight*score,
    weightedBattles:state.weightedBattles+weight,
    processedFlights:Object.freeze(Object.fromEntries(trimProcessedFlights(
      [...Object.entries(state.processedFlights),[flightId,1 as const]]))),
  });
}
/** Replay guard size. Oldest ids (insertion order) are dropped, never the whole record. */
export const PIRATE_ADAPTIVE_PROCESSED_FLIGHT_LIMIT=20_000;
function trimProcessedFlights<T>(entries:readonly T[]):T[]{
  return entries.length>PIRATE_ADAPTIVE_PROCESSED_FLIGHT_LIMIT
    ?entries.slice(entries.length-PIRATE_ADAPTIVE_PROCESSED_FLIGHT_LIMIT):[...entries];
}
export function normalizedPirateOwnerAdaptation(value:unknown):PirateOwnerAdaptation|null{
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const record=value as Record<string,unknown>;
  const numbers=['q','wins','draws','losses','weightedWins','weightedBattles'];
  if(record.version!==1||numbers.some(key=>typeof record[key]!=='number'||!Number.isFinite(record[key])
    ||(record[key] as number)<0)||Number(record.q)>1
    ||!['wins','draws','losses'].every(key=>Number.isSafeInteger(record[key]))
    ||Number(record.weightedWins)>Number(record.weightedBattles)+1e-9
    ||!record.processedFlights||typeof record.processedFlights!=='object'||Array.isArray(record.processedFlights))return null;
  const processed=trimProcessedFlights(Object.entries(record.processedFlights as Record<string,unknown>));
  if(processed.some(([id,flag])=>id.length>500||!id.startsWith('flight-')||flag!==1))return null;
  let last: PirateOwnerAdaptation['lastRoll'];
  if(record.lastRoll!==undefined){
    const v=record.lastRoll as Record<string,unknown>;
    if(!v||typeof v!=='object'||typeof v.flightId!=='string'||!v.flightId.startsWith('flight-')
      ||v.flightId.length>500||typeof v.coefficient!=='number'||!Number.isFinite(v.coefficient)
      ||v.coefficient<0.75||v.coefficient>1.10||!Number.isSafeInteger(v.sentPopulation)
      ||(v.sentPopulation as number)<0||!Number.isSafeInteger(v.at)||(v.at as number)<0)return null;
    last=Object.freeze({flightId:v.flightId,coefficient:v.coefficient,
      sentPopulation:v.sentPopulation as number,at:v.at as number});
  }
  return Object.freeze({version:1,q:record.q as number,wins:record.wins as number,
    draws:record.draws as number,losses:record.losses as number,
    weightedWins:record.weightedWins as number,weightedBattles:record.weightedBattles as number,
    processedFlights:Object.freeze(Object.fromEntries(processed) as Record<string,1>),
    ...(last?{lastRoll:last}:{})});
}
