import { getFactionDefenseCatalog, getFactionShipCatalog } from '../domain/combat/faction-catalog.ts';
import type { CombatFactionId } from '../domain/combat/factions.ts';
import type { BattleReport } from '../domain/combat/report.ts';
import { recordNpcGrievance } from '../domain/npc/grudges.ts';
import type { SaveState } from './contracts.ts';

function safeCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

/** What the defender lost in one battle: destroyed ships and turrets at catalog prices, plus the loot taken. */
export function defenderBattleLoss(report: BattleReport, raceId: CombatFactionId | undefined): number {
  const loot = safeCount(report.resources?.metal) + safeCount(report.resources?.minerals) + safeCount(report.resources?.gas);
  if (!raceId) return loot;
  const prices = new Map<string, number>([...getFactionShipCatalog(raceId), ...getFactionDefenseCatalog(raceId)]
    .map((entity) => [entity.id, safeCount(entity.cost?.metal) + safeCount(entity.cost?.minerals) + safeCount(entity.cost?.gas)]));
  const destroyed = [...report.defenderForce.stacks, ...(report.defenderForce.defenses ?? [])]
    .reduce((sum, stack) => sum + safeCount(stack.destroyed) * (prices.get(stack.entityId) ?? 0), 0);
  return destroyed + loot;
}

/** The battles that make an NPC defender remember its attacker; the same filter the battle hook uses. */
export function isGrievanceBattle(report: BattleReport): boolean {
  const offender = report.attacker.playerId;
  const defender = report.defender.playerId;
  return Boolean(offender && defender && offender !== defender) && (report.missionType === 'attack' || report.missionType === 'raid');
}

/**
 * Older saves have no memory of offenders: rebuild it once, at load, from the
 * battle reports the save still holds (history retention may have dropped
 * older ones). Profiles that already carry memory are left as they are.
 */
export function seedNpcGrudgesFromReports(state: SaveState): SaveState {
  if (!state.npc) return state;
  const pending = new Set(Object.values(state.npc.profiles).filter((profile) => profile.grudges === undefined).map((profile) => profile.ownerId));
  if (!pending.size) return state;
  const raceOf = new Map<string, CombatFactionId>();
  for (const target of Object.values(state.espionage?.targets ?? {})) if (!raceOf.has(target.ownerId)) raceOf.set(target.ownerId, target.raceId);
  const profiles = { ...state.npc.profiles };
  const reports = [...state.combat.reports].sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp)
    || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  let changed = false;
  for (const report of reports) {
    const defender = report.defender.playerId;
    if (!defender || !pending.has(defender) || !isGrievanceBattle(report)) continue;
    const at = Date.parse(report.timestamp);
    if (!Number.isSafeInteger(at) || at < 0) continue;
    profiles[defender] = recordNpcGrievance(profiles[defender]!, report.attacker.playerId!, defenderBattleLoss(report, raceOf.get(defender)), at, report.id);
    changed = true;
  }
  return changed ? { ...state, npc: { ...state.npc, profiles: Object.freeze(profiles) } } : state;
}
