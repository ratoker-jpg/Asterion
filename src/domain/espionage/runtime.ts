import type { EspionageState, SpyMission, SpyReportQuality, SpyTargetState } from './types.ts';
import { COMMANDER_IDS } from '../combat/commanders.ts';
import type { OwnedFleetState } from '../fleet/runtime.ts';
import type { SpyOwnerProfile } from './types.ts';

export const SPY_REPORT_COOLDOWN_MS = 5_000;
export const SPY_HUNTER_RATE_PER_LEVEL_PERCENT = 1.75;

export type EspionageRollKind = 'hunter' | 'report';

export function createDefaultEspionageState(): EspionageState {
  return { missions: [], reports: [], hunterNotices: [], orbitalDebris: {} };
}

export function getEspionageState(state: { espionage?: EspionageState }): EspionageState {
  return state.espionage ?? createDefaultEspionageState();
}

/**
 * Canonical target registry for espionage. `bot01Planets` is a compatibility
 * alias for old Test Mode saves only; runtime callers must use this resolver.
 */
export function getEspionageTargets(espionage?: EspionageState): Record<string, SpyTargetState> {
  return espionage?.targets ?? espionage?.bot01Planets ?? {};
}

/** Keeps the report-facing commander snapshot aligned with a target's live fleet. */
export function syncSpyTargetCommanderCounts(
  target: SpyTargetState,
  fleet: OwnedFleetState,
  ownerProfile?: SpyOwnerProfile,
): SpyTargetState {
  const commanders: SpyTargetState['commanders'] = {};
  for (const commanderId of COMMANDER_IDS) {
    const rawCount = fleet.commanders[commanderId] ?? 0;
    if (!Number.isFinite(rawCount)) continue;
    const count = Math.max(0, Math.floor(rawCount));
    if (count <= 0) continue;
    commanders[commanderId] = {
      level: ownerProfile?.commanderLevels[commanderId]
        ?? target.commanders[commanderId]?.level
        ?? 0,
      count,
    };
  }
  return { ...target, fleet, commanders };
}

export function normalizeRngRoll(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(99, Math.max(0, Math.floor(value)));
}

function hashEspionageSeed(seed: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0 || 1;
}

/**
 * Deterministic xorshift32 stream, the same algorithm family as the combat
 * resolver ('asterion-xorshift32-v1'). Espionage rolls must be replayable:
 * the same mission + attempt always yields the same canonical 0..99 roll.
 */
export function createSeededEspionageRng(seed: string): () => number {
  let state = hashEspionageSeed(seed);
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 4_294_967_296;
  };
}

/**
 * Roll seed contract: one stable seed per (mission, roll kind, attempt).
 * The attempt is the 1-based report index the roll belongs to, so replaying
 * a save or re-running reconcile never re-rolls a materialized outcome.
 */
export function espionageRollSeed(missionId: string, kind: EspionageRollKind, attempt: number): string {
  const normalizedAttempt = Math.max(1, Math.floor(Number.isFinite(attempt) ? attempt : 1));
  return `espionage:${missionId}:${kind}:${normalizedAttempt}`;
}

/**
 * Report quality uses one canonical 0..99 integer roll. The lower bound is
 * inclusive and the upper bound is exclusive, so 0..29, 30..59 and 60..99
 * are exactly 30%, 30% and 40% respectively.
 */
export function resolveSpyReportQuality(delta: number, roll?: number): SpyReportQuality {
  // The optional single-argument form is the zero-delta 30/30/40 rule.
  // Runtime callers pass the actual delta and the same canonical 0..99 roll.
  const effectiveDelta = roll === undefined ? 0 : delta;
  const normalized = normalizeRngRoll(roll === undefined ? delta : roll);
  const clampedDelta = Math.max(-4, Math.min(4, Math.floor(effectiveDelta)));
  const ranges: Record<number, readonly [number, number]> = {
    [-4]: [0, 0],
    [-3]: [0, 10],
    [-2]: [0, 20],
    [-1]: [20, 25],
    [0]: [30, 30],
    [1]: [40, 30],
    [2]: [65, 20],
    [3]: [75, 15],
    [4]: [90, 10],
  };
  const [fullPercent, detailedPercent] = ranges[clampedDelta];
  if (normalized < fullPercent) return 'full';
  if (normalized < fullPercent + detailedPercent) return 'detailed';
  return 'basic';
}

export function hunterDetectionChancePercent(hunterLevel: number): number {
  return Math.min(100, Math.max(0, Math.max(0, Math.floor(hunterLevel)) * SPY_HUNTER_RATE_PER_LEVEL_PERCENT));
}

/** Hunter checks use the same 0..99 RNG contract; e.g. 35% means 0..34. */
export function hunterDetects(hunterLevel: number, roll: number): boolean {
  return normalizeRngRoll(roll) < hunterDetectionChancePercent(hunterLevel);
}

export function activeSpyMissionForTarget(
  missions: readonly SpyMission[],
  ownerId: string,
  targetPlanetId: string,
): SpyMission | undefined {
  return missions.find((mission) => mission.ownerId === ownerId
    && mission.targetPlanetId === targetPlanetId
    && (mission.status === 'transit' || mission.status === 'orbiting' || mission.status === 'returning'));
}

export function canRequestSpyReport(mission: SpyMission, now: number): boolean {
  return mission.status === 'orbiting'
    && Number.isFinite(now)
    && (mission.nextReportAt === undefined || now >= mission.nextReportAt);
}
