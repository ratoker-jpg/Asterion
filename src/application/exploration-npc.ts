import type { RuntimeMode, TestTimeScale } from '../domain/runtime/mode.ts';
import { EXPLORATION_RULES, explorationNpcAttempt, explorationProfile } from '../domain/exploration/model.ts';
import { getEspionageTargets } from '../domain/espionage/runtime.ts';
import { UNIVERSE_NPC_OWNER_ID } from '../domain/universe/runtime.ts';
import type { SaveState } from './contracts.ts';
import { selectExplorationTargets, getExplorationTarget } from './exploration.ts';
import { dispatchBot01Exploration } from './exploration-bot01.ts';

export type ExplorationNpcRoll = Readonly<{at:number;contactId:string;slot:number}>;

/** Only real local NPC settlements can supply competition; never inspect a
 * player's hidden ship count to set raid force or decide whether to attack. */
export function selectDueExplorationNpcRolls(
  state:SaveState,after:number,until:number,mode:RuntimeMode,
):ExplorationNpcRoll[]{
  if(mode!=='production')return [];
  const sources=Object.values(getEspionageTargets(state.espionage))
    .filter(target=>target.ownerId!==state.profile.playerId && target.ownerId!==UNIVERSE_NPC_OWNER_ID);
  if(!sources.length||until<=after)return [];
  const nodes=selectExplorationTargets(state,until,mode,25);
  const result:ExplorationNpcRoll[]=[];
  for(const node of nodes){
    if(!node.special||node.special.startAt===undefined||node.kind!=='unique'&&node.kind!=='anomaly')continue;
    const startAt=node.special.startAt;
    if(!sources.some(source=>source.coordinate.galaxy===node.coordinate.galaxy))continue;
    const lastSlot=Math.floor((Math.min(until,node.special.expiresAt-1)-startAt)
      /EXPLORATION_RULES.riskSlotMs);
    for(let slot=1;slot<=lastSlot;slot++){
      const at=startAt+slot*EXPLORATION_RULES.riskSlotMs;
      if(at>after&&at<=until&&at<node.special.expiresAt)result.push({at,contactId:node.id,slot});
    }
  }
  return result.sort((a,b)=>a.at-b.at||a.contactId.localeCompare(b.contactId));
}

export function resolveDueExplorationNpcRoll(state:SaveState,roll:ExplorationNpcRoll,testTimeScale?:TestTimeScale):SaveState{
  const node=getExplorationTarget(state,roll.contactId,roll.at,'production');
  if(!node||(node.kind!=='unique'&&node.kind!=='anomaly'))return state;
  const risk=explorationProfile(node.kind,node.special?.profileVariant??1).risk;
  if(!explorationNpcAttempt(risk,node.id,roll.slot))return state;
  const contact=state.exploration?.contacts[node.id];
  if(contact?.claim?.ownerId&&contact.claim.ownerId!==state.profile.playerId)return state;
  if(state.flights.records.some(f=>f.operationId===node.id
    && f.ownerSide==='npc'&&(f.phase==='outbound'||f.phase==='arrived')))return state;
  const launched=dispatchBot01Exploration(state,node,roll.at,testTimeScale,'production');
  return launched.ok?launched.state:state;
}
