import { getFactionCombatEntity } from '../combat/faction-catalog.ts';
import { isCombatFactionId, type CombatFactionId } from '../combat/factions.ts';
import { entityPopulation, isCommanderEntity, isOrderEntity, typeShares, type SunOrderEntityId } from './order.ts';

/**
 * Sun battle log (owner rule 09.11.2026): every Sun battle leaves a compact
 * record in the save for the bots to learn from (the last SUN_BATTLE_LOG_LIMIT)
 * and the same record in the bot journal for the owner's loop
 * «journal → analyse → improve bots». Keys are short: it lives in every save.
 */

export const SUN_BATTLE_LOG_LIMIT = 50;

/** One row of a side: race, hull, level, hulls, population. */
export type SunBattleRow = { f: CombatFactionId; e: SunOrderEntityId; l: number; n: number; p: number };

export type SunBattleSide = {
  rows: SunBattleRow[];
  /** Owners on the side and combat groups they formed. */
  owners: number;
  groups: number;
  population: number;
  /** Population lost in the battle (before the defenders' half comes home). */
  lost: number;
  /** Special-bonus donors and commander ships present («defender», «battleship», «synod:destroyer», «cmd:viper»). */
  bonuses: string[];
};

export type SunBattleLogEntry = {
  id: string;
  at: number;
  g: number;
  s: number;
  allianceId: string;
  tag: string;
  /** The raid flew under a launcher's order. */
  ordered: boolean;
  winner: 'attacker' | 'defender' | 'draw';
  rounds: number;
  attack: SunBattleSide;
  defence: SunBattleSide;
};

const whole = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);

/** Rows of one side from its fleets (race, hulls, the owner's levels), merged by race + hull + level, sorted. */
export function sunBattleRows(fleets: readonly { factionId: CombatFactionId; ships: Partial<Record<string, number>>; levels: Partial<Record<string, number>> }[]): SunBattleRow[] {
  const merged = new Map<string, SunBattleRow>();
  for (const fleet of fleets) {
    for (const [id, raw] of Object.entries(fleet.ships)) {
      const count = whole(raw);
      if (!count || !isOrderEntity(id)) continue;
      const level = Math.max(0, Math.floor(fleet.levels[id] ?? 0));
      const key = `${fleet.factionId}:${id}:${level}`;
      const row = merged.get(key) ?? { f: fleet.factionId, e: id, l: level, n: 0, p: 0 };
      row.n += count;
      row.p += count * entityPopulation(fleet.factionId, id);
      merged.set(key, row);
    }
  }
  return [...merged.values()].sort((left, right) => (left.f < right.f ? -1 : left.f > right.f ? 1 : 0) || (left.e < right.e ? -1 : left.e > right.e ? 1 : 0) || left.l - right.l);
}

/** Special-bonus donors and commanders present in rows. */
export function sunBattleBonuses(rows: readonly SunBattleRow[]): string[] {
  const bonuses = new Set<string>();
  for (const row of rows) {
    if (isCommanderEntity(row.e)) { bonuses.add(`cmd:${row.e}`); continue; }
    const entity = getFactionCombatEntity(row.f, row.e) as { specialBonus?: unknown };
    if (entity.specialBonus) bonuses.add(`${row.f}:${row.e}`);
  }
  return [...bonuses].sort();
}

/** Average level of a side's rows, weighted by population. */
export function sunBattleAverageLevel(rows: readonly SunBattleRow[]): number {
  const population = rows.reduce((sum, row) => sum + row.p, 0);
  return population > 0 ? rows.reduce((sum, row) => sum + row.l * row.p, 0) / population : 0;
}

function migrateRow(value: unknown): SunBattleRow | null {
  const row = value && typeof value === 'object' ? value as Record<string, unknown> : null;
  if (!row || !isCombatFactionId(row.f) || typeof row.e !== 'string' || !isOrderEntity(row.e)) return null;
  const n = whole(row.n);
  if (!n) return null;
  return { f: row.f, e: row.e, l: Math.max(0, Math.floor(Number(row.l) || 0)), n, p: whole(row.p) || n * entityPopulation(row.f, row.e) };
}

function migrateSide(value: unknown): SunBattleSide | null {
  const side = value && typeof value === 'object' ? value as Record<string, unknown> : null;
  if (!side || !Array.isArray(side.rows)) return null;
  return {
    rows: side.rows.map(migrateRow).filter((row): row is SunBattleRow => Boolean(row)).slice(0, 64),
    owners: whole(side.owners),
    groups: whole(side.groups),
    population: whole(side.population),
    lost: whole(side.lost),
    bonuses: Array.isArray(side.bonuses) ? side.bonuses.filter((item): item is string => typeof item === 'string').slice(0, 32) : [],
  };
}

export function migrateSunBattleLog(value: unknown): SunBattleLogEntry[] {
  if (!Array.isArray(value)) return [];
  const out: SunBattleLogEntry[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    const entry = raw && typeof raw === 'object' ? raw as Record<string, unknown> : null;
    if (!entry || typeof entry.id !== 'string' || seen.has(entry.id) || typeof entry.at !== 'number' || !Number.isFinite(entry.at)) continue;
    const winner = entry.winner === 'attacker' || entry.winner === 'defender' || entry.winner === 'draw' ? entry.winner : null;
    const attack = migrateSide(entry.attack);
    const defence = migrateSide(entry.defence);
    if (!winner || !attack || !defence) continue;
    seen.add(entry.id);
    out.push({
      id: entry.id, at: entry.at, g: whole(entry.g), s: whole(entry.s),
      allianceId: typeof entry.allianceId === 'string' ? entry.allianceId : '',
      tag: typeof entry.tag === 'string' ? entry.tag.slice(0, 8) : '—',
      ordered: entry.ordered === true, winner, rounds: whole(entry.rounds), attack, defence,
    });
  }
  return out.slice(-SUN_BATTLE_LOG_LIMIT);
}

export function appendSunBattleLog(log: readonly SunBattleLogEntry[] | undefined, entry: SunBattleLogEntry): SunBattleLogEntry[] {
  return [...(log ?? []).filter((item) => item.id !== entry.id), entry].slice(-SUN_BATTLE_LOG_LIMIT);
}

/* ---------------------------------------------------------------- learning */

function cosine(left: Readonly<Record<string, number>>, right: Readonly<Record<string, number>>): number {
  let dot = 0;
  let a = 0;
  let b = 0;
  for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
    const x = left[key] ?? 0;
    const y = right[key] ?? 0;
    dot += x * y;
    a += x * x;
    b += y * y;
  }
  return a > 0 && b > 0 ? dot / Math.sqrt(a * b) : 0;
}

/** The defence a raid on this Sun should expect: the last one fought here, else the average of the log. */
export function expectedSunDefence(log: readonly SunBattleLogEntry[], galaxy: number, system: number): Record<string, number> {
  const here = [...log].reverse().find((entry) => entry.g === galaxy && entry.s === system && entry.defence.rows.length);
  if (here) return typeShares(here.defence.rows);
  const sum: Record<string, number> = {};
  let n = 0;
  for (const entry of log) {
    if (!entry.defence.rows.length) continue;
    n += 1;
    for (const [type, share] of Object.entries(typeShares(entry.defence.rows))) sum[type] = (sum[type] ?? 0) + share;
  }
  for (const type of Object.keys(sum)) sum[type]! /= Math.max(1, n);
  return sum;
}

export type SunExperience = {
  /** Hull type → value multiplier from past battles against similar defences (0.75–1.25). */
  multipliers: Record<string, number>;
  /** Battles that counted and how much (sum of similarities). */
  battles: number;
  weight: number;
};

/** Outcome of a past battle for the attackers: a win, a draw (nobody won) or a loss. */
const OUTCOME = { attacker: 1, draw: -0.25, defender: -1 } as const;
/** Battles less similar than this to the expected defence do not count. */
const SIMILARITY_FLOOR = 0.5;
const MULTIPLIER_SPAN = 0.25;

/**
 * Simple, deterministic learning: every logged battle against a defence like
 * the one expected adds its outcome to the hull types the attackers flew, in
 * proportion to their share and the similarity. Types that won get a higher
 * value in the next order, types that lost a lower one.
 */
export function sunExperience(log: readonly SunBattleLogEntry[], defence: Readonly<Record<string, number>>): SunExperience {
  const score: Record<string, number> = {};
  const norm: Record<string, number> = {};
  let battles = 0;
  let weight = 0;
  for (const entry of log) {
    if (!entry.attack.rows.length) continue;
    const similarity = Object.keys(defence).length ? cosine(typeShares(entry.defence.rows), defence) : 1;
    if (similarity < SIMILARITY_FLOOR) continue;
    battles += 1;
    weight += similarity;
    const outcome = OUTCOME[entry.winner];
    for (const [type, share] of Object.entries(typeShares(entry.attack.rows))) {
      score[type] = (score[type] ?? 0) + similarity * share * outcome;
      norm[type] = (norm[type] ?? 0) + similarity * share;
    }
  }
  const multipliers: Record<string, number> = {};
  for (const type of Object.keys(score).sort()) {
    const ratio = norm[type]! > 0 ? Math.max(-1, Math.min(1, score[type]! / norm[type]!)) : 0;
    multipliers[type] = Math.round((1 + MULTIPLIER_SPAN * ratio) * 1000) / 1000;
  }
  return { multipliers, battles, weight: Math.round(weight * 1000) / 1000 };
}
