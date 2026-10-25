import { SOLAR_CRYSTAL_IDS, SUN_RAID_CONFIG, type SolarCrystalId } from './config.ts';
import { createDefaultSunRaidState, parseHolderKey, sunKey } from './rules.ts';
import type { CampaignResult, CrystalHolder, GateProject, SunRaidEvent, SunRaidRecord, SunRaidState, SunState } from './types.ts';

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function text(value: unknown, max = 160): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;
}

function crystalList(value: unknown): SolarCrystalId[] {
  if (!Array.isArray(value)) return [];
  return SOLAR_CRYSTAL_IDS.filter((id) => value.includes(id));
}

function holder(value: unknown): CrystalHolder | null {
  const source = record(value);
  const id = text(source?.id);
  if (!source || !id || (source.kind !== 'alliance' && source.kind !== 'owner')) return null;
  return { kind: source.kind, id };
}

function migrateSun(value: unknown): SunState | null {
  const source = record(value);
  if (!source) return null;
  const { galaxy, system, baseEfficiency, brightness } = source;
  if (![galaxy, system].every((item) => Number.isSafeInteger(item) && (item as number) >= 1)) return null;
  if (!finite(baseEfficiency) || !finite(brightness)) return null;
  const base = Math.min(100, Math.max(SUN_RAID_CONFIG.frozenThreshold, baseEfficiency));
  return {
    galaxy: galaxy as number,
    system: system as number,
    baseEfficiency: base,
    brightness: Math.min(base, Math.max(SUN_RAID_CONFIG.frozenThreshold, brightness)),
    successfulRaids: Number.isSafeInteger(source.successfulRaids) ? Math.max(0, source.successfulRaids as number) : 0,
    ...(finite(source.recoveryStartedAt) && finite(source.recoveryStepMs) && source.recoveryStepMs > 0
      ? { recoveryStartedAt: source.recoveryStartedAt, recoveryStepMs: source.recoveryStepMs }
      : {}),
    ...(finite(source.lastRaidAt) ? { lastRaidAt: source.lastRaidAt } : {}),
  };
}

function migrateCrystalRoll(value: unknown): NonNullable<SunRaidRecord['result']>['crystalRoll'] | undefined {
  const source = record(value);
  if (!source || !finite(source.chance) || !finite(source.roll)) return undefined;
  return {
    chance: source.chance,
    roll: source.roll,
    success: source.success === true,
    ...(SOLAR_CRYSTAL_IDS.includes(source.crystal as SolarCrystalId) ? { crystal: source.crystal as SolarCrystalId } : {}),
    ...(source.skipped === 'all-owned' ? { skipped: 'all-owned' as const } : {}),
  };
}

function migrateRaid(value: unknown): SunRaidRecord | null {
  const source = record(value);
  if (!source) return null;
  const id = text(source.id);
  const allianceId = text(source.allianceId);
  const initiatorOwnerId = text(source.initiatorOwnerId);
  if (!id || !allianceId || !initiatorOwnerId) return null;
  if (!Number.isSafeInteger(source.galaxy) || !Number.isSafeInteger(source.system)) return null;
  if (!finite(source.launchedAt) || !finite(source.arrivesAt) || source.arrivesAt < source.launchedAt) return null;
  if (source.status !== 'incoming' && source.status !== 'resolved' && source.status !== 'gathering' && source.status !== 'disbanded') return null;
  if (source.status === 'gathering' && !finite(source.gatherEndsAt)) return null;
  const result = record(source.result);
  const winner = result?.winner;
  const migratedResult = result && (winner === 'attacker' || winner === 'defender' || winner === 'draw') && finite(result.resolvedAt)
    && finite(result.brightnessBefore) && finite(result.brightnessAfter)
    ? {
      winner: winner as 'attacker' | 'defender' | 'draw',
      resolvedAt: result.resolvedAt,
      brightnessBefore: result.brightnessBefore,
      brightnessAfter: result.brightnessAfter,
      frozen: result.frozen === true,
      attackerPopulation: finite(result.attackerPopulation) ? result.attackerPopulation : 0,
      defenderPopulation: finite(result.defenderPopulation) ? result.defenderPopulation : 0,
      defenders: Number.isSafeInteger(result.defenders) ? result.defenders as number : 0,
      ...(migrateCrystalRoll(result.crystalRoll) ? { crystalRoll: migrateCrystalRoll(result.crystalRoll)! } : {}),
      ...(text(result.reportId) ? { reportId: text(result.reportId)! } : {}),
    }
    : undefined;
  if (source.status === 'resolved' && !migratedResult) return null;
  return {
    id,
    galaxy: source.galaxy as number,
    system: source.system as number,
    allianceId,
    allianceName: text(source.allianceName, 48) ?? 'Союз',
    allianceTag: text(source.allianceTag, 8) ?? '—',
    initiatorOwnerId,
    initiatorName: text(source.initiatorName, 48) ?? initiatorOwnerId,
    launchedAt: source.launchedAt,
    arrivesAt: source.arrivesAt,
    status: source.status,
    ...(finite(source.gatherEndsAt) ? { gatherEndsAt: source.gatherEndsAt } : {}),
    ...(migratedResult ? { result: migratedResult } : {}),
    ...(finite(source.closedAt) ? { closedAt: source.closedAt } : {}),
  };
}

function migrateGate(value: unknown): GateProject | null {
  const source = record(value);
  if (!source) return null;
  const id = text(source.id);
  const gateHolder = holder(source.holder);
  const hostOwnerId = text(source.hostOwnerId);
  const hostPlanetId = text(source.hostPlanetId);
  if (!id || !gateHolder || !hostOwnerId || !hostPlanetId) return null;
  if (!finite(source.startedAt) || !finite(source.completesAt) || source.completesAt <= source.startedAt) return null;
  if (!['building', 'completed', 'destroyed', 'cancelled'].includes(String(source.status))) return null;
  const destroyedBy = record(source.destroyedBy);
  const destroyer = destroyedBy ? holder(destroyedBy.holder) : null;
  return {
    id,
    holder: gateHolder,
    holderName: text(source.holderName, 48) ?? gateHolder.id,
    hostOwnerId,
    hostOwnerName: text(source.hostOwnerName, 48) ?? hostOwnerId,
    hostPlanetId,
    hostPlanetName: text(source.hostPlanetName, 48) ?? hostPlanetId,
    startedAt: source.startedAt,
    completesAt: source.completesAt,
    status: source.status as GateProject['status'],
    crystals: crystalList(source.crystals),
    announcedMilestones: Array.isArray(source.announcedMilestones)
      ? SUN_RAID_CONFIG.gateMilestones.filter((milestone) => (source.announcedMilestones as unknown[]).includes(milestone))
      : [],
    ...(finite(source.endedAt) ? { endedAt: source.endedAt } : {}),
    ...(destroyedBy && destroyer && text(destroyedBy.ownerId) ? {
      destroyedBy: {
        ownerId: text(destroyedBy.ownerId)!,
        ownerName: text(destroyedBy.ownerName, 48) ?? text(destroyedBy.ownerId)!,
        holder: destroyer,
        ...(SOLAR_CRYSTAL_IDS.includes(destroyedBy.crystal as SolarCrystalId) ? { crystal: destroyedBy.crystal as SolarCrystalId } : {}),
        ...(text(destroyedBy.reportId) ? { reportId: text(destroyedBy.reportId)! } : {}),
        ...(destroyedBy.outcome === 'kept' || destroyedBy.outcome === 'stolen' || destroyedBy.outcome === 'destroyed' ? { outcome: destroyedBy.outcome } : {}),
        ...(SOLAR_CRYSTAL_IDS.includes(destroyedBy.lostCrystal as SolarCrystalId) ? { lostCrystal: destroyedBy.lostCrystal as SolarCrystalId } : {}),
      },
    } : {}),
  };
}

function migrateEvent(value: unknown): SunRaidEvent | null {
  const source = record(value);
  const id = text(source?.id);
  const eventText = text(source?.text, 240);
  if (!source || !id || !eventText || !finite(source.at) || typeof source.kind !== 'string') return null;
  return {
    id,
    at: source.at,
    kind: source.kind as SunRaidEvent['kind'],
    text: eventText,
    ...(Number.isSafeInteger(source.galaxy) ? { galaxy: source.galaxy as number } : {}),
    ...(Number.isSafeInteger(source.system) ? { system: source.system as number } : {}),
  };
}

function migrateCampaignResult(value: unknown): CampaignResult | undefined {
  const source = record(value);
  const winner = holder(source?.winner);
  if (!source || !winner || !finite(source.at)) return undefined;
  return {
    version: 1,
    at: source.at,
    winner,
    winnerName: text(source.winnerName, 48) ?? winner.id,
    hostOwnerId: text(source.hostOwnerId) ?? winner.id,
    hostOwnerName: text(source.hostOwnerName, 48) ?? winner.id,
    hostPlanetName: text(source.hostPlanetName, 48) ?? '—',
    playerWon: source.playerWon === true,
  };
}

/** Validating migration; anything malformed is dropped instead of breaking the save. */
export function migrateSunRaidState(value: unknown): SunRaidState {
  const source = record(value);
  if (!source || source.version !== 1) return createDefaultSunRaidState();
  const suns: Record<string, SunState> = {};
  for (const candidate of Object.values(record(source.suns) ?? {})) {
    const sun = migrateSun(candidate);
    if (sun) suns[sunKey(sun.galaxy, sun.system)] = sun;
  }
  const crystals: Record<string, SolarCrystalId[]> = {};
  for (const [key, list] of Object.entries(record(source.crystals) ?? {})) {
    if (parseHolderKey(key)) crystals[key] = crystalList(list);
  }
  const gateCooldowns: Record<string, number> = {};
  for (const [key, at] of Object.entries(record(source.gateCooldowns) ?? {})) {
    if (parseHolderKey(key) && finite(at)) gateCooldowns[key] = at;
  }
  const seenRaids = new Set<string>();
  const raids = (Array.isArray(source.raids) ? source.raids : []).map(migrateRaid)
    .filter((raid): raid is SunRaidRecord => Boolean(raid) && !seenRaids.has(raid!.id) && Boolean(seenRaids.add(raid!.id)))
    .slice(-200);
  const seenGates = new Set<string>();
  const gates = (Array.isArray(source.gates) ? source.gates : []).map(migrateGate)
    .filter((gate): gate is GateProject => Boolean(gate) && !seenGates.has(gate!.id) && Boolean(seenGates.add(gate!.id)))
    .slice(-50);
  const history = (Array.isArray(source.history) ? source.history : []).map(migrateEvent)
    .filter((event): event is SunRaidEvent => Boolean(event))
    .slice(-SUN_RAID_CONFIG.historyLimit);
  const campaignResult = migrateCampaignResult(source.campaignResult);
  return { version: 1, suns, crystals, raids, gates, gateCooldowns, history, ...(campaignResult ? { campaignResult } : {}) };
}
