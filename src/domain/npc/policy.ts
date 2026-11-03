import policyFile from './npc-policy.v1.json' with { type: 'json' };
import tableFile from './doctrine-table.v1.json' with { type: 'json' };

/**
 * The versioned policy of the NPC strategy (ADR stage H). One data file holds
 * the handful of numbers the lab league tunes; the game reads it, the same for
 * every client and server, and nothing learns inside a running campaign. A new
 * version is a new file chosen offline (tools/league.mjs) on training seeds and
 * checked on held-out ones. Only the lab may override it for a whole process.
 */
export type NpcPolicyParams = Readonly<{
  /** Days of its income share a planet's stores may hold before they count as idle. */
  hoardDays: number;
  /** How hard idle stores push the shipyard, factories and construction. */
  bottleneckDrive: number;
  /** Highest worth of a scarce resource's mine output (the lowest stays 0.2). */
  scarcityHigh: number;
  /** 0..1: how far the defence caps of the non-fortress styles move toward the full fortress. */
  styleCapRaise: number;
  /** Days of income the fortify targets may take at ambition 1. */
  budgetDaysHigh: number;
  /** Share of the stores above the reserve one fortify order may spend at ambition 1. */
  spendShareHigh: number;
  /** Hours of a planet's own income kept per resource. */
  reserveHours: number;
  /** 0..1: how much the doctrine table (combat engine, offline) counts next to the battery heuristic. */
  tableWeight: number;
}>;

export type NpcPolicy = Readonly<{ version: number; params: NpcPolicyParams }>;

/** Allowed range of every number: a file outside it is rejected, not clamped, so a typo cannot ship. */
export const NPC_POLICY_RANGES: Readonly<Record<keyof NpcPolicyParams, readonly [number, number]>> = Object.freeze({
  hoardDays: [0.05, 2], bottleneckDrive: [0.4, 2.4], scarcityHigh: [1, 6], styleCapRaise: [0, 1],
  budgetDaysHigh: [0.5, 8], spendShareHigh: [0.3, 0.95], reserveHours: [1, 24], tableWeight: [0, 1],
});

export function validateNpcPolicy(value: unknown): NpcPolicy {
  const candidate = value as { version?: unknown; params?: Record<string, unknown> } | null;
  if (!candidate || !Number.isInteger(candidate.version) || (candidate.version as number) < 1 || !candidate.params) throw new Error('NPC policy: version and params are required');
  const params: Record<string, number> = {};
  for (const [key, [low, high]] of Object.entries(NPC_POLICY_RANGES)) {
    const number = candidate.params[key];
    if (typeof number !== 'number' || !Number.isFinite(number) || number < low || number > high) throw new Error(`NPC policy: ${key} must be a number in ${low}..${high}`);
    params[key] = number;
  }
  return Object.freeze({ version: candidate.version as number, params: Object.freeze(params) as unknown as NpcPolicyParams });
}

const shipped = validateNpcPolicy(policyFile);
let active: NpcPolicy = shipped;

/** The policy in force. */
export function getNpcPolicy(): NpcPolicy {
  return active;
}

/** Lab only: runs a whole process under another policy (null = the shipped file). Never called by the game. */
export function setNpcPolicyOverride(policy: unknown | null): NpcPolicy {
  active = policy === null ? shipped : validateNpcPolicy(policy);
  return active;
}

type DoctrineRow = Readonly<{ id: string; held: number; exchange: number }>;
type DoctrineTable = Readonly<{ version: number; engine: string; races: Readonly<Record<string, Readonly<{ defence: readonly DoctrineRow[] }>>> }>;
const table = tableFile as unknown as DoctrineTable;
export const NPC_DOCTRINE_TABLE_VERSION = table.version;

const defenceIndex = new Map<string, number>();
for (const [race, entry] of Object.entries(table.races)) {
  // Held share (how often the battery stands against equal-budget fleets) leads, the exchange of losses breaks ties; both are in the table.
  const best = Math.max(0.001, ...entry.defence.map((row) => row.held * (1 + Math.log10(1 + row.exchange))));
  for (const row of entry.defence) defenceIndex.set(`${race}:${row.id}`, (row.held * (1 + Math.log10(1 + row.exchange))) / best);
}

/** 0..1: how well a battery of this race held in the offline combat table, 1 for the race's best; 1 for an unknown one (the table says nothing). */
export function doctrineDefenceIndex(raceId: string, defenseId: string): number {
  return defenceIndex.get(`${raceId}:${defenseId}`) ?? 1;
}
