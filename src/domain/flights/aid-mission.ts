import type { UniverseOwnerRelation } from '../universe/runtime.ts';

/**
 * Alliance aid ("Помощь союзнику") mission: foundation only.
 *
 * The mission is registered (id, icon, requirements) so the catalog and UI do
 * not need reshaping later, but it is deliberately NOT connected to the flight
 * runtime: dispatch still answers `mission-not-supported`. The delivery
 * pipeline, reservation of requested amounts and contribution credit belong to
 * the resource-request stage (PR 2), which flips `AID_MISSION_ENABLED`.
 */
export const AID_MISSION_ENABLED = false;

export const AID_MISSION_DESCRIPTION = 'Отдельная миссия помощи союзнику: доступна только по союзной цели и при наличии свободных транспортировщиков. Появится вместе с запросами ресурсов.';

/** Only dedicated cargo hulls can carry aid; this is not a combat or espionage mission. */
export const AID_TRANSPORT_SHIP_IDS = ['transporter', 'mega-transporter'] as const;

export type AidRequirementFailure = 'target-not-ally' | 'no-free-transporters';

export type AidRequirementResult = { ok: true } | { ok: false; reason: AidRequirementFailure };

/** Pure rule check shared by the future UI preview and runtime: ally target + at least one free transporter. */
export function evaluateAidMissionRequirements(input: {
  targetRelation: UniverseOwnerRelation | 'empty' | undefined;
  freeShips: Readonly<Partial<Record<string, number>>>;
}): AidRequirementResult {
  if (input.targetRelation !== 'ally') return { ok: false, reason: 'target-not-ally' };
  const freeTransporters = AID_TRANSPORT_SHIP_IDS.reduce((sum, id) => {
    const count = input.freeShips[id];
    return sum + (typeof count === 'number' && Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0);
  }, 0);
  return freeTransporters > 0 ? { ok: true } : { ok: false, reason: 'no-free-transporters' };
}
