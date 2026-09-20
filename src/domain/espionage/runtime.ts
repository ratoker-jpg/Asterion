import type { EspionageState, SpyMission, SpyReportQuality } from './types.ts';

export const SPY_REPORT_COOLDOWN_MS = 5_000;
export const SPY_HUNTER_RATE_PER_LEVEL_PERCENT = 1.75;

export function createDefaultEspionageState(): EspionageState {
  return { missions: [], reports: [], hunterNotices: [] };
}

export function getEspionageState(state: { espionage?: EspionageState }): EspionageState {
  return state.espionage ?? createDefaultEspionageState();
}

export function normalizeRngRoll(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(99, Math.max(0, Math.floor(value)));
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
