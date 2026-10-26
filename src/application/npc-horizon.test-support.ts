// Test-only switch for long NPC replay horizons. Pull requests replay up to
// seven game days; ASTERION_NPC_LONG_HORIZON=1 (CI on main and nightly) adds
// the 30-day horizons, which cost several minutes of CPU each.
export const NPC_LONG_HORIZON = process.env.ASTERION_NPC_LONG_HORIZON === '1';

export const NPC_LONG_HORIZON_ONLY = NPC_LONG_HORIZON ? false : '30-day horizon runs on main and nightly (ASTERION_NPC_LONG_HORIZON=1)';

/** Replay horizons in days: the long ones only when NPC_LONG_HORIZON is set. */
export function npcReplayDays(days: readonly number[]): number[] {
  return NPC_LONG_HORIZON ? [...days] : days.filter((day) => day <= 7);
}
