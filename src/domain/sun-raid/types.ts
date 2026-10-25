import type { CombatFactionId } from '../combat/factions.ts';
import type { CombatTechnologyLevels } from '../combat/technologies.ts';
import type { ShipId } from '../combat/ids.ts';
import type { SolarCrystalId } from './config.ts';

export type { SolarCrystalId } from './config.ts';

/** Crystals belong to an alliance or to a solo owner; they are never a resource. */
export type CrystalHolder = { kind: 'alliance'; id: string } | { kind: 'owner'; id: string };

/**
 * Persisted state of one Sun. Created lazily on the first raid; a Sun without
 * a record shines at its base efficiency (70/85/100) and is never frozen.
 */
export type SunState = {
  galaxy: number;
  system: number;
  /** Maximum and recovery target: `SUN_EFFICIENCY_BY_SYSTEM`. */
  baseEfficiency: number;
  /** Stored brightness at `recoveryStartedAt` (or the current one when not recovering). */
  brightness: number;
  /** Set when the Sun froze; recovery steps are counted from here. */
  recoveryStartedAt?: number;
  /** Step length fixed when the freeze happened (campaign / Test Mode speed applied). */
  recoveryStepMs?: number;
  successfulRaids: number;
  lastRaidAt?: number;
};

export type SunProjection = {
  brightness: number;
  baseEfficiency: number;
  frozen: boolean;
  recovering: boolean;
  /** Next +5 step while recovering. */
  nextStepAt?: number;
  /** Moment the Sun becomes attackable again (first step above the freeze line). */
  unfreezesAt?: number;
  /** Moment recovery reaches the base efficiency. */
  fullAt?: number;
};

/** Frozen combat snapshot of one participant fleet, taken at launch. */
export type SunFlightSnapshot = {
  version: 1;
  raidId: string;
  side: 'attacker' | 'defender';
  ownerId: string;
  ownerName: string;
  factionId: CombatFactionId;
  allianceId: string | null;
  technologies: CombatTechnologyLevels;
  shipLevels: Partial<Record<ShipId, number>>;
  /** Upgrade levels of the commander ships sent with this fleet. */
  commanderLevels?: Partial<Record<import('../combat/commanders.ts').CommanderId, number>>;
  population: number;
};

export type SunRaidResult = {
  winner: 'attacker' | 'defender' | 'draw';
  resolvedAt: number;
  brightnessBefore: number;
  brightnessAfter: number;
  frozen: boolean;
  attackerPopulation: number;
  defenderPopulation: number;
  defenders: number;
  /** Absent when the attackers lost or the holder already owned all four crystals. */
  crystalRoll?: { chance: number; roll: number; success: boolean; crystal?: SolarCrystalId; skipped?: 'all-owned' };
  reportId?: string;
};

export type SunRaidRecord = {
  id: string;
  galaxy: number;
  system: number;
  allianceId: string;
  allianceName: string;
  allianceTag: string;
  initiatorOwnerId: string;
  initiatorName: string;
  launchedAt: number;
  /** Battle moment: the gathered fleet's arrival (provisional while gathering). */
  arrivesAt: number;
  /** 'gathering' waits for 225 000 population; 'disbanded' never flew. */
  status: 'gathering' | 'incoming' | 'resolved' | 'disbanded';
  /** End of the 30-minute gathering. */
  gatherEndsAt?: number;
  result?: SunRaidResult;
  /** When every attacker fleet of the raid is back home: the alliance may raid again. */
  closedAt?: number;
};

export type GateProject = {
  id: string;
  holder: CrystalHolder;
  holderName: string;
  hostOwnerId: string;
  hostOwnerName: string;
  hostPlanetId: string;
  hostPlanetName: string;
  startedAt: number;
  completesAt: number;
  status: 'building' | 'completed' | 'destroyed' | 'cancelled';
  /** Locked while building. */
  crystals: SolarCrystalId[];
  announcedMilestones: number[];
  endedAt?: number;
  /**
   * `crystal` is the stolen one (kept for old saves); `outcome` and
   * `lostCrystal` describe the breach under the 25.10.2026 rules.
   */
  destroyedBy?: { ownerId: string; ownerName: string; holder: CrystalHolder; crystal?: SolarCrystalId; reportId?: string;
    outcome?: 'kept' | 'stolen' | 'destroyed'; lostCrystal?: SolarCrystalId };
};

export type SunRaidEventKind =
  | 'raid-launched'
  | 'raid-defended'
  | 'raid-won'
  | 'sun-frozen'
  | 'crystal-found'
  | 'crystal-missed'
  | 'gate-started'
  | 'gate-progress'
  | 'gate-completed'
  | 'gate-destroyed'
  | 'gate-transferred'
  | 'gate-cancelled';

export type SunRaidEvent = {
  id: string;
  at: number;
  kind: SunRaidEventKind;
  text: string;
  galaxy?: number;
  system?: number;
};

export type CampaignResult = {
  version: 1;
  at: number;
  winner: CrystalHolder;
  winnerName: string;
  hostOwnerId: string;
  hostOwnerName: string;
  hostPlanetName: string;
  /** True when the local player's side built the Gate. */
  playerWon: boolean;
};

export type SunRaidState = {
  version: 1;
  suns: Record<string, SunState>;
  crystals: Record<string, SolarCrystalId[]>;
  raids: SunRaidRecord[];
  gates: GateProject[];
  /** Holder key → earliest restart time of a destroyed Gate. */
  gateCooldowns: Record<string, number>;
  history: SunRaidEvent[];
  campaignResult?: CampaignResult;
};
