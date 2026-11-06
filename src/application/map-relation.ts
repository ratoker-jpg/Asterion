import type { AttackEligibility, AttackEligibilityPoints } from '../domain/rating/attack-eligibility.ts';
import type { UniverseOwnerRelation } from '../domain/universe/runtime.ts';
import type { UniversePlanetNode } from '../domain/universe/types.ts';
import { formatShieldRemaining, shieldStatus, type ShieldRecord } from '../domain/shield/shield.ts';
import { evaluateOwnerAttackEligibility } from './attack-eligibility.ts';

/**
 * The colour language of the system map. `range` and `neutral` are one relation
 * split by the attack rule: a stranger you can reach reads soft red, one you
 * cannot reads grey.
 */
export type MapTone = 'self' | 'ally' | 'enemy' | 'range' | 'neutral' | 'wild' | 'unique' | 'pirate' | 'anomaly';

export type MapRelationStatus = {
  tone: MapTone;
  /**
   * Only for player and NPC planets: the very answer of the launch gate.
   * `null` for planets the rule does not speak about (own, allied, map objects).
   */
  attackable: boolean | null;
  /** The headline shown on hover and in the planet card, in the player's words. */
  title: string;
  /** Why, when there is more to say than the headline. */
  detail: string | null;
  /** Remaining shield time text («00:42») when the planet's owner is shielded; others see this mark too. */
  shieldLeft?: string;
};

const SPECIAL: Partial<Record<UniversePlanetNode['kind'], MapRelationStatus>> = {
  uninhabited: { tone: 'wild', attackable: null, title: 'Необитаемая планета', detail: null },
  unique: { tone: 'unique', attackable: null, title: 'Уникальный объект', detail: null },
  pirate: { tone: 'pirate', attackable: null, title: 'Отступник', detail: null },
  anomaly: { tone: 'anomaly', attackable: null, title: 'Аномалия', detail: null },
};

function blockedTitle(eligibility: Exclude<AttackEligibility, { allowed: true }>): string {
  if (eligibility.reason === 'defender-protected') return 'Защита новичка';
  if (eligibility.reason === 'attacker-protected') return 'Вам пока рано атаковать';
  return 'Вне диапазона атаки';
}

/**
 * The look and the plain-words reason of one map object. The attack answer is
 * the launch gate's own eligibility, so a colour cannot promise what the attack
 * command refuses.
 */
export function classifyMapNode(
  node: Pick<UniversePlanetNode, 'kind'>,
  relation: UniverseOwnerRelation | null,
  eligibility: AttackEligibility | null,
): MapRelationStatus {
  if (node.kind !== 'player' && node.kind !== 'npc') return SPECIAL[node.kind] ?? { tone: 'wild', attackable: null, title: 'Свободная позиция', detail: null };
  if (relation === 'self') return { tone: 'self', attackable: null, title: 'Ваша планета', detail: null };
  if (relation === 'ally') return { tone: 'ally', attackable: null, title: 'Союзная планета', detail: 'Союзников атаковать нельзя' };
  const enemy = relation === 'enemy';
  if (eligibility?.allowed) {
    return {
      tone: enemy ? 'enemy' : 'range',
      attackable: true,
      title: enemy ? 'Враг · в диапазоне атаки' : 'В диапазоне атаки',
      detail: null,
    };
  }
  const blocked = eligibility as Exclude<AttackEligibility, { allowed: true }> | null;
  const title = blocked ? blockedTitle(blocked) : 'Вне диапазона атаки';
  return {
    tone: enemy ? 'enemy' : 'neutral',
    attackable: false,
    title: enemy ? `Враг · ${title.toLowerCase()}` : title,
    detail: blocked?.message ?? null,
  };
}

/** The same, from the map's inputs: the owners' public points and their relation. */
export function classifyMapPlanet(
  node: Pick<UniversePlanetNode, 'kind' | 'ownerId'>,
  relation: UniverseOwnerRelation | null,
  attackerOwnerId: string,
  scoreOf: (ownerId: string) => AttackEligibilityPoints | undefined,
): MapRelationStatus {
  const foreign = (node.kind === 'player' || node.kind === 'npc') && (relation === 'enemy' || relation === 'neutral');
  return classifyMapNode(node, relation, foreign ? evaluateOwnerAttackEligibility(attackerOwnerId, node.ownerId ?? '', scoreOf) : null);
}

/**
 * Layers the planet shield over a map status: a shielded planet carries a mark
 * (everyone sees it) and cannot be attacked; a shielded attacker cannot attack.
 */
export function applyMapShield(
  status: MapRelationStatus,
  node: Pick<UniversePlanetNode, 'kind' | 'ownerId'>,
  attackerOwnerId: string,
  shields: Readonly<Record<string, ShieldRecord>> | undefined,
  at: number,
): MapRelationStatus {
  if (!shields || (node.kind !== 'player' && node.kind !== 'npc') || !node.ownerId) return status;
  // The screen clock can lag a tick behind the click that raised a shield.
  const seen = (record: ShieldRecord | undefined) => shieldStatus(record, Math.max(at, record?.activatedAt ?? 0));
  const theirs = seen(shields[node.ownerId]);
  const own = seen(shields[attackerOwnerId]);
  const shieldLeft = theirs.phase === 'active' ? formatShieldRemaining(theirs.remainingMs) : undefined;
  if (status.attackable !== true) return shieldLeft ? { ...status, shieldLeft } : status;
  if (shieldLeft) return { ...status, attackable: false, detail: `Под щитом, ещё ${shieldLeft}`, shieldLeft };
  if (own.phase === 'active') return { ...status, attackable: false, detail: `Ваш щит активен, ещё ${formatShieldRemaining(own.remainingMs)}: нападать нельзя` };
  return status;
}
