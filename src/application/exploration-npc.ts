import type { RuntimeMode, TestTimeScale } from '../domain/runtime/mode.ts';
import { EXPLORATION_RULES, explorationNpcAttempt, explorationProfile } from '../domain/exploration/model.ts';
import { getUniverseTimedObjectCyclesBetween, SYSTEM_COUNT, UNIVERSE_NPC_OWNER_ID } from '../domain/universe/runtime.ts';
import type { UniverseCoordinate } from '../domain/universe/types.ts';
import type { SaveState } from './contracts.ts';
import type { ExplorationState } from '../domain/exploration/ledger.ts';
import { selectExplorationTargetsInSystems, getExplorationTarget } from './exploration.ts';
import { dispatchBot01Exploration } from './exploration-bot01.ts';

export const EXPLORATION_NPC_MAX_CATCHUP_MS = 24 * 60 * 60_000;

export type ExplorationNpcSkippedInterval = Readonly<{
  afterExclusive: number;
  throughInclusive: number;
}>;

export type ExplorationNpcCatchupWindow = Readonly<{
  replayAfter: number;
  skippedInterval?: ExplorationNpcSkippedInterval;
}>;

export type ExplorationNpcRoll = Readonly<{at:number;contactId:string;slot:number}>;
export type ExplorationNpcSource = Readonly<{ownerId:string;coordinate:UniverseCoordinate}>;
export type ExplorationNpcSourceProvider = (state:SaveState)=>readonly ExplorationNpcSource[];

/**
 * Production competition is paused until persisted NPC settlements and fleets
 * exist. Test Mode Bot 01 continues to use its explicit fixture and manual
 * dispatch path. A future owner-backed source can be connected here without
 * changing the calendar, combat resolver, or return settlement.
 */
export const noProductionExplorationNpcSources: ExplorationNpcSourceProvider = () => [];

/** Replay at most the latest day. The omitted interval is persisted by the
 * reconcile layer so long offline gaps are an explicit, reviewable policy. */
export function getExplorationNpcCatchupWindow(after: number, until: number): ExplorationNpcCatchupWindow {
  if (!Number.isFinite(after) || !Number.isFinite(until) || until <= after) return { replayAfter: after };
  const replayAfter = Math.max(after, until - EXPLORATION_NPC_MAX_CATCHUP_MS);
  return replayAfter > after
    ? { replayAfter, skippedInterval: { afterExclusive: after, throughInclusive: replayAfter } }
    : { replayAfter };
}

/** Persist the production cursor and latest skipped interval exactly once. */
export function advanceExplorationNpcProgress(
  state: ExplorationState, after: number, until: number,
): ExplorationState {
  const skippedInterval = getExplorationNpcCatchupWindow(after, until).skippedInterval;
  const processedAt = Math.max(state.npcProcessedAt ?? 0, until);
  const changedSkippedInterval = skippedInterval !== undefined
    && (state.npcLastSkippedInterval?.afterExclusive !== skippedInterval.afterExclusive
      || state.npcLastSkippedInterval.throughInclusive !== skippedInterval.throughInclusive);
  if (state.npcProcessedAt === processedAt && !changedSkippedInterval) return state;
  return {
    ...state,
    npcProcessedAt: processedAt,
    ...(skippedInterval ? { npcLastSkippedInterval: skippedInterval } : {}),
  };
}

type ScheduledNpcCandidate = Readonly<{
  at: number;
  galaxy: number;
  system: number;
  kind: 'unique' | 'anomaly';
  cycleIndex: number;
  startAt: number;
  slot: number;
}>;

/** Only real local NPC settlements can supply competition; never inspect a
 * player's hidden ship count to set raid force or decide whether to attack. */
export function selectDueExplorationNpcRolls(
  state:SaveState,after:number,until:number,mode:RuntimeMode,
  sourceProvider:ExplorationNpcSourceProvider=noProductionExplorationNpcSources,
):ExplorationNpcRoll[]{
  if(mode!=='production'||until<=after)return [];
  const sources=sourceProvider(state)
    .filter(target=>target.ownerId!==state.profile.playerId&&target.ownerId!==UNIVERSE_NPC_OWNER_ID);
  if(!sources.length)return [];

  const sourceGalaxies=new Set(sources.map(source=>source.coordinate.galaxy));
  const visibleSystems=new Map<string,UniverseCoordinate>();
  for(const planet of Object.values(state.planets)){
    const galaxy=planet.universeGalaxy??1;
    const system=planet.universeSystem??1;
    if(!Number.isInteger(galaxy)||galaxy<1||!Number.isInteger(system)||system<1||system>SYSTEM_COUNT)continue;
    for(let visible=Math.max(1,system-5);visible<=Math.min(SYSTEM_COUNT,system+5);visible++){
      if(!sourceGalaxies.has(galaxy))continue;
      visibleSystems.set(`${galaxy}:${visible}`,{galaxy,system:visible,position:1});
    }
  }
  if(!visibleSystems.size)return [];

  const window=getExplorationNpcCatchupWindow(after,until);
  const candidatesByTime=new Map<number,ScheduledNpcCandidate[]>();
  for(const {galaxy,system} of visibleSystems.values()){
    for(const kind of ['unique','anomaly'] as const){
      for(const cycle of getUniverseTimedObjectCyclesBetween(kind,galaxy,system,window.replayAfter,until)){
        const lastSlot=Math.floor((cycle.expiresAt-1-cycle.startAt)/EXPLORATION_RULES.riskSlotMs);
        for(let slot=1;slot<=lastSlot;slot++){
          const at=cycle.startAt+slot*EXPLORATION_RULES.riskSlotMs;
          if(at<=window.replayAfter||at>until||at>=cycle.expiresAt)continue;
          const candidates=candidatesByTime.get(at)??[];
          candidates.push({at,galaxy,system,kind,cycleIndex:cycle.cycleIndex,startAt:cycle.startAt,slot});
          candidatesByTime.set(at,candidates);
        }
      }
    }
  }

  const result:ExplorationNpcRoll[]=[];
  for(const [at,candidates] of candidatesByTime){
    const systems=candidates.map(candidate=>({galaxy:candidate.galaxy,system:candidate.system}));
    const nodes=selectExplorationTargetsInSystems(state,at,systems,mode);
    for(const candidate of candidates){
      const node=nodes.find(item=>item.kind===candidate.kind
        &&item.coordinate.galaxy===candidate.galaxy&&item.coordinate.system===candidate.system
        &&item.special?.cycleIndex===candidate.cycleIndex&&item.special.startAt===candidate.startAt);
      if(node)result.push({at,contactId:node.id,slot:candidate.slot});
    }
  }
  return result.sort((a,b)=>a.at-b.at||a.contactId.localeCompare(b.contactId)||a.slot-b.slot);
}

export function resolveDueExplorationNpcRoll(state:SaveState,roll:ExplorationNpcRoll,testTimeScale?:TestTimeScale):SaveState{
  const node=getExplorationTarget(state,roll.contactId,roll.at,'production');
  if(!node||(node.kind!=='unique'&&node.kind!=='anomaly'))return state;
  const risk=explorationProfile(node.kind,node.special?.profileVariant??1).risk;
  if(!explorationNpcAttempt(risk,node.id,roll.slot))return state;
  const contact=state.exploration?.contacts[node.id];
  // Never treat a future occupation in an offline save as a past defender.
  if(contact?.claim && contact.claim.startedAt>roll.at)return state;
  if(contact?.claim?.ownerId&&contact.claim.ownerId!==state.profile.playerId)return state;
  if(state.flights.records.some(f=>f.operationId===node.id
    && f.ownerSide==='npc'&&(f.phase==='outbound'||f.phase==='arrived')))return state;
  const launched=dispatchBot01Exploration(state,node,roll.at,testTimeScale,'production');
  return launched.ok?launched.state:state;
}
