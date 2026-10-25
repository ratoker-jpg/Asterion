import { COMBAT_TECHNOLOGY_IDS, createDefaultCombatTechnologies, type CombatTechnologyLevels } from '../combat/technologies.ts';
import type { ShipId } from '../combat/ids.ts';
import { getBaseSunEfficiencyPercent } from '../energy/runtime.ts';
import { createSeededRandom } from '../world/random.ts';
import { SOLAR_CRYSTAL_IDS, SUN_RAID_CONFIG, type SolarCrystalId } from './config.ts';
import type {
  CrystalHolder,
  GateProject,
  SunProjection,
  SunRaidEvent,
  SunRaidRecord,
  SunRaidState,
  SunState,
} from './types.ts';

export function createDefaultSunRaidState(): SunRaidState {
  return { version: 1, suns: {}, crystals: {}, raids: [], gates: [], gateCooldowns: {}, history: [] };
}

export function sunKey(galaxy: number, system: number): string {
  return `${galaxy}:${system}`;
}

export function holderKey(holder: CrystalHolder): string {
  return `${holder.kind}:${holder.id}`;
}

export function parseHolderKey(key: string): CrystalHolder | null {
  const separator = key.indexOf(':');
  if (separator <= 0) return null;
  const kind = key.slice(0, separator);
  const id = key.slice(separator + 1);
  if (!id || (kind !== 'alliance' && kind !== 'owner')) return null;
  return { kind, id };
}

export function sameHolder(left: CrystalHolder, right: CrystalHolder): boolean {
  return left.kind === right.kind && left.id === right.id;
}

/** Sun record for a coordinate; a Sun never attacked is materialized from its base efficiency. */
export function readSun(state: SunRaidState, galaxy: number, system: number): SunState {
  const stored = state.suns[sunKey(galaxy, system)];
  if (stored) return stored;
  const base = getBaseSunEfficiencyPercent(system);
  return { galaxy, system, baseEfficiency: base, brightness: base, successfulRaids: 0 };
}

/** Current brightness with the recovery steps that elapsed by `now`. */
export function projectSun(sun: SunState, now: number): SunProjection {
  const { frozenThreshold, recoverStepPercent } = SUN_RAID_CONFIG;
  if (sun.recoveryStartedAt === undefined || !sun.recoveryStepMs || sun.recoveryStepMs <= 0) {
    return { brightness: sun.brightness, baseEfficiency: sun.baseEfficiency, frozen: sun.brightness <= frozenThreshold, recovering: false };
  }
  const elapsed = Math.max(0, now - sun.recoveryStartedAt);
  const steps = Math.floor(elapsed / sun.recoveryStepMs);
  const brightness = Math.min(sun.baseEfficiency, sun.brightness + steps * recoverStepPercent);
  const recovering = brightness < sun.baseEfficiency;
  const stepsToUnfreeze = Math.max(0, Math.floor((frozenThreshold - sun.brightness) / recoverStepPercent) + 1);
  const stepsToFull = Math.max(0, Math.ceil((sun.baseEfficiency - sun.brightness) / recoverStepPercent));
  return {
    brightness,
    baseEfficiency: sun.baseEfficiency,
    frozen: brightness <= frozenThreshold,
    recovering,
    ...(recovering ? { nextStepAt: sun.recoveryStartedAt + (steps + 1) * sun.recoveryStepMs } : {}),
    ...(brightness <= frozenThreshold ? { unfreezesAt: sun.recoveryStartedAt + stepsToUnfreeze * sun.recoveryStepMs } : {}),
    ...(recovering ? { fullAt: sun.recoveryStartedAt + stepsToFull * sun.recoveryStepMs } : {}),
  };
}

/** Folds elapsed recovery steps into the stored record (the remainder of a step is kept). */
export function materializeSun(sun: SunState, now: number): SunState {
  if (sun.recoveryStartedAt === undefined || !sun.recoveryStepMs) return sun;
  const projection = projectSun(sun, now);
  if (!projection.recovering) {
    const { recoveryStartedAt: _start, recoveryStepMs: _step, ...rest } = sun;
    return { ...rest, brightness: sun.baseEfficiency };
  }
  const steps = Math.round((projection.brightness - sun.brightness) / SUN_RAID_CONFIG.recoverStepPercent);
  if (steps <= 0) return sun;
  return { ...sun, brightness: projection.brightness, recoveryStartedAt: sun.recoveryStartedAt + steps * sun.recoveryStepMs };
}

/**
 * A won raid dims the Sun by 5 points. Reaching the freeze line starts the
 * recovery clock (step length fixed now, so a later speed change cannot rewind it).
 */
export function applyRaidVictoryToSun(sun: SunState, at: number, recoveryStepMs: number): SunState {
  const current = materializeSun(sun, at);
  const brightness = Math.max(SUN_RAID_CONFIG.frozenThreshold, current.brightness - SUN_RAID_CONFIG.brightnessLossPerWin);
  const next: SunState = { ...current, brightness, successfulRaids: current.successfulRaids + 1, lastRaidAt: at };
  if (brightness <= SUN_RAID_CONFIG.frozenThreshold && next.recoveryStartedAt === undefined) {
    return { ...next, recoveryStartedAt: at, recoveryStepMs: Math.max(1, Math.round(recoveryStepMs)) };
  }
  return next;
}

export function getHolderCrystals(state: SunRaidState, holder: CrystalHolder): SolarCrystalId[] {
  return state.crystals[holderKey(holder)] ?? [];
}

export function missingCrystals(owned: readonly SolarCrystalId[]): SolarCrystalId[] {
  return SOLAR_CRYSTAL_IDS.filter((id) => !owned.includes(id));
}

export type CrystalRoll = { chance: number; roll: number; success: boolean; crystal?: SolarCrystalId; skipped?: 'all-owned' };

/**
 * 70% (config) roll after a won raid. Deterministic from the seed; the dropped
 * crystal is uniform among the ones the holder still lacks (never a repeat).
 */
export function rollCrystal(seed: string, owned: readonly SolarCrystalId[]): CrystalRoll {
  const chance = SUN_RAID_CONFIG.crystalChance;
  const missing = missingCrystals(owned);
  if (!missing.length) return { chance, roll: 1, success: false, skipped: 'all-owned' };
  const random = createSeededRandom(`crystal:${seed}`);
  const roll = random();
  if (roll >= chance) return { chance, roll, success: false };
  return { chance, roll, success: true, crystal: missing[Math.floor(random() * missing.length)] };
}

export function addCrystal(state: SunRaidState, holder: CrystalHolder, crystal: SolarCrystalId): SunRaidState {
  const key = holderKey(holder);
  const owned = state.crystals[key] ?? [];
  if (owned.includes(crystal)) return state;
  return { ...state, crystals: { ...state.crystals, [key]: SOLAR_CRYSTAL_IDS.filter((id) => id === crystal || owned.includes(id)) } };
}

export function removeCrystal(state: SunRaidState, holder: CrystalHolder, crystal: SolarCrystalId): SunRaidState {
  const key = holderKey(holder);
  const owned = state.crystals[key] ?? [];
  return { ...state, crystals: { ...state.crystals, [key]: owned.filter((id) => id !== crystal) } };
}

/** Crystal handed to the destroyer of a Gate: one the destroyer lacks, chosen deterministically. */
export function pickStolenCrystal(seed: string, ownerCrystals: readonly SolarCrystalId[], receiverCrystals: readonly SolarCrystalId[]): SolarCrystalId | null {
  const candidates = ownerCrystals.filter((id) => !receiverCrystals.includes(id));
  if (!candidates.length) return null;
  const random = createSeededRandom(`gate-steal:${seed}`);
  return candidates[Math.floor(random() * candidates.length)]!;
}

export type GateBreachOutcome =
  | { kind: 'kept' }
  | { kind: 'stolen'; crystal: SolarCrystalId }
  | { kind: 'destroyed'; crystal: SolarCrystalId };

/**
 * What a won assault on a Gate under construction does to the holder's
 * crystals (owner rules 25.10.2026). A solo holder keeps them all half the
 * time. Otherwise one crystal is lost: a solo attacker steals it (one he
 * lacks) 70% of the time and destroys it otherwise; an alliance attacker
 * always destroys it, so the alliance must raid Suns again.
 */
export function resolveGateBreach(seed: string, holder: CrystalHolder, holderCrystals: readonly SolarCrystalId[],
  attackerSolo: boolean, attackerCrystals: readonly SolarCrystalId[]): GateBreachOutcome {
  if (!holderCrystals.length) return { kind: 'kept' };
  const random = createSeededRandom(`gate-breach:${seed}`);
  if (holder.kind === 'owner' && random() < SUN_RAID_CONFIG.soloGateKeepChance) return { kind: 'kept' };
  const stealable = holderCrystals.filter((id) => !attackerCrystals.includes(id));
  if (attackerSolo && stealable.length && random() < SUN_RAID_CONFIG.soloStealChance) {
    return { kind: 'stolen', crystal: stealable[Math.floor(random() * stealable.length)]! };
  }
  return { kind: 'destroyed', crystal: holderCrystals[Math.floor(random() * holderCrystals.length)]! };
}

/** Highest level of every technology among one side's participants. */
export function mergeSideTechnologies(levels: readonly CombatTechnologyLevels[]): CombatTechnologyLevels {
  const merged = createDefaultCombatTechnologies();
  for (const id of COMBAT_TECHNOLOGY_IDS) {
    merged[id] = levels.reduce((max, item) => Math.max(max, Math.max(0, Math.floor(item?.[id] ?? 0))), merged[id] ?? 0);
  }
  return merged;
}

/** Highest upgrade level of every ship among one side's participants. */
export function mergeSideShipLevels(levels: readonly Partial<Record<ShipId, number>>[]): Partial<Record<ShipId, number>> {
  const merged: Partial<Record<ShipId, number>> = {};
  for (const entry of levels) {
    for (const [id, level] of Object.entries(entry ?? {}) as [ShipId, number][]) {
      const safe = Math.max(0, Math.floor(level ?? 0));
      if (safe > (merged[id] ?? 0)) merged[id] = safe;
    }
  }
  return merged;
}

export function activeRaidOfAlliance(state: SunRaidState, allianceId: string): SunRaidRecord | null {
  return state.raids.find((raid) => raid.allianceId === allianceId && raid.closedAt === undefined) ?? null;
}

export function incomingRaidsOnSun(state: SunRaidState, galaxy: number, system: number): SunRaidRecord[] {
  return state.raids.filter((raid) => raid.status === 'incoming' && raid.galaxy === galaxy && raid.system === system);
}

/** Raids gathering for or flying to one Sun: only one at a time. */
export function liveRaidsOnSun(state: SunRaidState, galaxy: number, system: number): SunRaidRecord[] {
  return state.raids.filter((raid) => (raid.status === 'incoming' || raid.status === 'gathering') && raid.galaxy === galaxy && raid.system === system);
}

export type RaidLaunchCheck =
  | { ok: true }
  | { ok: false; code: 'no-alliance' | 'not-leadership' | 'sun-frozen' | 'raid-active' | 'sun-under-attack' | 'population-cap' | 'no-ships' | 'campaign-finished'; message: string };

/**
 * Launch rules of a command raid. The raid is an alliance mission: only the
 * alliance leadership (leader or deputy) may start it from «Операции».
 */
export function checkRaidLaunch(input: {
  state: SunRaidState;
  allianceId: string | null;
  role: 'leader' | 'deputy' | 'member' | null;
  galaxy: number;
  system: number;
  population: number;
  now: number;
}): RaidLaunchCheck {
  const { state, allianceId, role, galaxy, system, population, now } = input;
  if (state.campaignResult) return { ok: false, code: 'campaign-finished', message: 'Кампания завершена: Врата уже построены.' };
  if (!allianceId) return { ok: false, code: 'no-alliance', message: 'Рейд на Солнце — командная операция: нужен союз (Командование → Союз).' };
  if (role !== 'leader' && role !== 'deputy') return { ok: false, code: 'not-leadership', message: 'Рейд объявляет лидер или заместитель союза.' };
  if (population <= 0) return { ok: false, code: 'no-ships', message: 'Выберите боевые корабли для рейда.' };
  if (population > SUN_RAID_CONFIG.participantPopulationCap) {
    return { ok: false, code: 'population-cap', message: `Один участник вносит не больше ${SUN_RAID_CONFIG.participantPopulationCap.toLocaleString('ru-RU')} населения: уберите ${(population - SUN_RAID_CONFIG.participantPopulationCap).toLocaleString('ru-RU')}.` };
  }
  const active = activeRaidOfAlliance(state, allianceId);
  if (active) return { ok: false, code: 'raid-active', message: `Союз уже ведёт рейд на Солнце [${active.galaxy}:${active.system}]. Новый — после возвращения флота.` };
  const projection = projectSun(readSun(state, galaxy, system), now);
  if (projection.frozen) return { ok: false, code: 'sun-frozen', message: 'Солнце заморожено и восстанавливается: атаковать нельзя.' };
  if (liveRaidsOnSun(state, galaxy, system).length) return { ok: false, code: 'sun-under-attack', message: 'На это Солнце уже собирается или летит другой рейд.' };
  return { ok: true };
}

export function activeGateOf(state: SunRaidState, holder: CrystalHolder): GateProject | null {
  return state.gates.find((gate) => gate.status === 'building' && sameHolder(gate.holder, holder)) ?? null;
}

export type GateStartCheck =
  | { ok: true }
  | { ok: false; message: string };

export function checkGateStart(input: { state: SunRaidState; holder: CrystalHolder; isLeaderOrSolo: boolean; now: number }): GateStartCheck {
  const { state, holder, isLeaderOrSolo, now } = input;
  if (state.campaignResult) return { ok: false, message: 'Кампания уже завершена.' };
  if (!isLeaderOrSolo) return { ok: false, message: 'Строительство Врат начинает только глава союза на своей планете.' };
  if (activeGateOf(state, holder)) return { ok: false, message: 'Врата уже строятся.' };
  const owned = getHolderCrystals(state, holder);
  if (missingCrystals(owned).length) return { ok: false, message: `Нужны все 4 разных кристалла: собрано ${owned.length} из 4.` };
  const cooldown = state.gateCooldowns[holderKey(holder)];
  if (cooldown !== undefined && now < cooldown) return { ok: false, message: 'Врата недавно разрушены: перезапуск после восстановления.' };
  return { ok: true };
}

export function gateProgressPercent(gate: Pick<GateProject, 'startedAt' | 'completesAt'>, now: number): number {
  const total = Math.max(1, gate.completesAt - gate.startedAt);
  return Math.min(100, Math.max(0, ((now - gate.startedAt) / total) * 100));
}

export function appendSunEvents(state: SunRaidState, events: readonly SunRaidEvent[]): SunRaidState {
  if (!events.length) return state;
  const known = new Set(state.history.map((event) => event.id));
  const fresh = events.filter((event) => !known.has(event.id));
  if (!fresh.length) return state;
  return { ...state, history: [...state.history, ...fresh].slice(-SUN_RAID_CONFIG.historyLimit) };
}
