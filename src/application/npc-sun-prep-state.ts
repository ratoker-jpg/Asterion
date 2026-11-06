import { selectOwnerMembership } from '../domain/command/selectors.ts';
import type { ShipId } from '../domain/combat/ids.ts';
import { getFactionShipCatalog } from '../domain/combat/faction-catalog.ts';
import { calculateFleetPopulation, createEmptyFleetState } from '../domain/fleet/runtime.ts';
import type { CombatFactionId } from '../domain/combat/factions.ts';
import type { NpcStrategyState } from '../domain/npc/strategy.ts';
import type { NpcSunRaidPrepPlan, NpcSunRsvp } from '../domain/npc/sun-prep.ts';
import { SUN_RAID_CONFIG } from '../domain/sun-raid/config.ts';
import type { SaveState } from './contracts.ts';

/**
 * What the rest of the NPC code reads of an alliance's Sun plan: which plan is
 * running, what it holds back and when a member looks again. Kept apart from
 * the planning code (npc-sun-prep.ts) because missions and replay read it.
 */

export const NPC_SUN_PREP_BALANCE = Object.freeze({
  /** How far ahead a leader sets the gathering (real hours: visits do not speed up with the campaign). Two hours leave time to answer and to rally; a longer wait costs raids. */
  minLeadHours: 2,
  maxLeadHours: 12,
  /** A moved gathering stays at least this far ahead of the moment it is moved. */
  postponeLeadHours: 2,
  /** Owner rule for this plan: at most two moves, then a cancellation with its reason. */
  maxPostpones: 2,
  /** Real hours between a leader's thoughts about a new plan, and the pause after a cancelled one. */
  checkHours: 0.25,
  cancelCooldownHours: 6,
  /** From this long before T the leader checks the promises (and members promise only what they have). */
  recheckLeadMinutes: 60,
  /** From this long before T a promised force stays out of other missions (as long as a plan's lead: from the answer on)… */
  holdLeadHours: 12,
  /** …and members bring their planets' shares together. */
  rallyLeadHours: 4,
  /** A share smaller than this part of the promise is not worth a flight of its own. */
  rallyMinShare: 0.05,
  /** Share of a planet's stores one order for the raid may spend (the rest stays for defence and building). */
  budgetShare: 0.6,
  /** Orders one promise may place: a shortfall that two orders cannot close is told to the leader, not paid for look after look. */
  maxOrders: 2,
  /** From this long before T a member short of gas for its share stops other spending: the flight is paid at the gathering. */
  saveGasLeadHours: 2,
  /** Before the recheck a member counts on its gas store being this full by T (income is still to come). */
  gasStoreShare: 0.6,
  /** A cautious owner just hit (threat above this) keeps back part of its force. */
  cautionThreat: 0.3,
  cautionShare: 0.85,
  /** Below this share of the participant's cap the member answers «не смогу». */
  minPromiseShare: 0.1,
  /** A member online during the gathering, nothing pledged yet, looks at least this often (real ms). */
  waitingLookMs: 30_000,
  /** A leader starts a plan when members like itself would bring this share of the side. */
  selfJudgeShare: 0.7,
  /** The leader asks for this multiple of the side's cap, strongest force first: the surplus covers a member that cannot fly its share. */
  allotmentMargin: 1.2,
  /** An allotment smaller than this share of the participant's cap is not worth a flight: that member keeps its fleet home. */
  allotmentMinShare: 0.05,
});

const HOUR = 3_600_000;

/** Per immutable plans object: each alliance's running plan. */
const activePlanIndex = new WeakMap<object, Map<string, NpcSunRaidPrepPlan>>();

function activePlansByAlliance(strategy: NpcStrategyState): Map<string, NpcSunRaidPrepPlan> {
  let index = activePlanIndex.get(strategy.plans);
  if (index) return index;
  index = new Map();
  for (const owner of Object.keys(strategy.plans).sort()) {
    for (const plan of strategy.plans[owner]!) if (plan.template === 'sun-raid-prep' && plan.status === 'active') index.set(plan.allianceId, plan);
  }
  activePlanIndex.set(strategy.plans, index);
  return index;
}

export function activeNpcSunPrep(state: SaveState, allianceId: string): NpcSunRaidPrepPlan | null {
  return state.npcStrategy ? activePlansByAlliance(state.npcStrategy).get(allianceId) ?? null : null;
}

/** The running plan of the owner's alliance and the owner's answer to it. */
export function npcSunPrepOfOwner(state: SaveState, ownerId: string): { plan: NpcSunRaidPrepPlan; rsvp: NpcSunRsvp | undefined } | null {
  if (!state.npcStrategy || !activePlansByAlliance(state.npcStrategy).size) return null;
  const membership = selectOwnerMembership(state.command, ownerId);
  const plan = membership ? activeNpcSunPrep(state, membership.alliance.id) : null;
  return plan ? { plan, rsvp: plan.rsvps[ownerId] } : null;
}

function isCombatHull(raceId: CombatFactionId, id: string): boolean {
  return getFactionShipCatalog(raceId).some((entity) => entity.id === id && entity.category === 'Боевой корабль')
    && !['spy-probe', 'colonizer', 'transporter', 'mega-transporter', 'recycler', 'solar-satellite'].includes(id);
}

/**
 * Combat hulls this planet holds back for a promise: the promise is laid over
 * the owner's planets in id order, the rest of the fleet stays free. A choice
 * of the owner, not a rule: the fleet still defends, and threat and repair see
 * the real ships; only its own other missions leave them alone.
 */
export function withoutNpcSunPrepHold<T extends Readonly<Partial<Record<string, number>>>>(state: SaveState, ownerId: string, planetId: string, available: T, at: number): T {
  const entry = npcSunPrepOfOwner(state, ownerId);
  if (!entry?.rsvp || entry.rsvp.population <= 0 || entry.rsvp.pledged !== undefined) return available;
  if (entry.plan.phase === 'flying' || at < entry.plan.gatherAt - NPC_SUN_PREP_BALANCE.holdLeadHours * HOUR) return available;
  const planets = Object.values(state.espionage?.targets ?? {}).filter((target) => target.kind === 'npc' && target.ownerId === ownerId)
    .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  let left = entry.rsvp.population;
  const empty = createEmptyFleetState();
  for (const planet of planets) {
    const combat: Record<string, number> = {};
    for (const [id, count] of Object.entries(planet.fleet.ships)) if ((count ?? 0) > 0 && isCombatHull(planet.raceId, id)) combat[id] = count!;
    const population = calculateFleetPopulation({ ships: { ...empty.ships, ...combat }, commanders: empty.commanders }, planet.raceId);
    const held = Math.min(left, population);
    left -= held;
    if (planet.id !== planetId) continue;
    if (held <= 0) return available;
    const free = 1 - held / population;
    const result: Record<string, number> = { ...available } as Record<string, number>;
    for (const id of Object.keys(combat) as ShipId[]) if (result[id] !== undefined) result[id] = Math.min(result[id]!, Math.floor(combat[id]! * free));
    return result as T;
  }
  return available;
}

/**
 * The next moment the plan asks this owner to look: the recheck and T for a
 * promise it gave (it knows the time), and every half minute while it waits for
 * the gathering to open or stands in it with its share not yet pledged.
 */
export function npcSunPrepNextMoment(state: SaveState, ownerId: string, at: number): number | null {
  const entry = npcSunPrepOfOwner(state, ownerId);
  if (!entry) return null;
  const { plan, rsvp } = entry;
  const leader = plan.ownerId === ownerId;
  if (!leader && (!rsvp || rsvp.population <= 0 || rsvp.pledged !== undefined)) return null;
  if (plan.phase === 'flying' || (plan.phase === 'gathering' && leader)) return null;
  const recheckAt = plan.gatherAt - NPC_SUN_PREP_BALANCE.recheckLeadMinutes * 60_000;
  if (leader && at < recheckAt) return recheckAt;
  if (at < plan.gatherAt) return plan.gatherAt;
  return at < plan.gatherAt + SUN_RAID_CONFIG.raidGatherMs ? at + NPC_SUN_PREP_BALANCE.waitingLookMs : null;
}
