/**
 * World news gathered while the game catches up an absence (audit 26.10 M4).
 * Public, world-level counts only: never a copy of anyone's private mail.
 * It is accumulated slice by slice and persisted with the replay cursor, so a
 * long catch-up split into parts, or resumed after a restart, keeps every event.
 */
export type WorldCatchupSummary = {
  version: 1;
  /** Game time the absence started from. */
  fromAt: number;
  /** Set once the catch-up reached its target. */
  finishedAt?: number;
  /**
   * False when a save resumed a catch-up that began before summaries existed:
   * the part replayed by the older version is not in these counts.
   */
  complete: boolean;
  battles: number;
  attackerWins: number;
  defenderWins: number;
  draws: number;
  /** Battles where the player fought: counted here, detailed in the player's own mail. */
  playerBattles: number;
  pirateRaids: number;
  planetsDestroyed: number;
  colonies: number;
  alliancesFounded: number;
  alliancesDissolved: number;
  warsDeclared: number;
  truces: number;
  pacts: number;
  sunRaids: number;
  sunRaidsWon: number;
  crystalsTaken: number;
  /** Total rating points per owner when the catch-up started. */
  startScores: Record<string, number>;
};

export const WORLD_SUMMARY_COUNTERS = [
  'battles', 'attackerWins', 'defenderWins', 'draws', 'playerBattles', 'pirateRaids', 'planetsDestroyed',
  'colonies', 'alliancesFounded', 'alliancesDissolved', 'warsDeclared', 'truces', 'pacts',
  'sunRaids', 'sunRaidsWon', 'crystalsTaken',
] as const satisfies readonly (keyof WorldCatchupSummary)[];

export type WorldSummaryCounter = (typeof WORLD_SUMMARY_COUNTERS)[number];

export function createWorldCatchupSummary(fromAt: number, startScores: Record<string, number>, complete = true): WorldCatchupSummary {
  const summary = { version: 1, fromAt, complete, startScores: { ...startScores } } as WorldCatchupSummary;
  for (const key of WORLD_SUMMARY_COUNTERS) summary[key] = 0;
  return summary;
}

const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/** Untrusted persisted summary; anything malformed is dropped as a whole. */
export function normalizeWorldCatchupSummary(value: unknown): WorldCatchupSummary | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const item = value as Record<string, unknown>;
  if (item.version !== 1 || !isCount(item.fromAt) || typeof item.complete !== 'boolean') return undefined;
  if (item.finishedAt !== undefined && !isCount(item.finishedAt)) return undefined;
  if (!WORLD_SUMMARY_COUNTERS.every((key) => isCount(item[key]))) return undefined;
  const scores = item.startScores;
  if (!scores || typeof scores !== 'object' || Array.isArray(scores)) return undefined;
  const startScores: Record<string, number> = {};
  for (const [ownerId, points] of Object.entries(scores)) {
    if (typeof points !== 'number' || !Number.isFinite(points)) return undefined;
    startScores[ownerId] = points;
  }
  const summary = createWorldCatchupSummary(item.fromAt, startScores, item.complete);
  for (const key of WORLD_SUMMARY_COUNTERS) summary[key] = item[key] as number;
  return item.finishedAt === undefined ? summary : { ...summary, finishedAt: item.finishedAt };
}
