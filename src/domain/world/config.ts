import type { CampaignSpeed } from '../runtime/mode.ts';
import type { PlayerFactionId } from '../profile/types.ts';
import { createCampaignSeed } from './random.ts';

export type WorldDensity = 'sparse' | 'standard' | 'dense';

/**
 * «Новая игра» configuration, stored inside the save (`SaveState.worldConfig`).
 * A save without it is a legacy campaign: one galaxy, the player at [1:1:1],
 * standard speed — exactly the world that existed before the wizard.
 */
export type NewGameConfig = {
  version: 1;
  /** Visible campaign seed; the whole world is derived from it. */
  seed: string;
  factionId: PlayerFactionId;
  playerName: string;
  campaignName: string;
  world: {
    galaxyCount: number;
    systemsPerGalaxy: 40;
    /** NPC = one owner with one stub planet; no behaviour at all. */
    npcCount: number;
    maxNpcPerSystem: 1 | 2 | 3;
    density: WorldDensity;
    campaignSpeed: CampaignSpeed;
    randomPlayerStart: boolean;
  };
  npcFactions: 'random';
  /** Set on configs reconstructed for a save that predates the wizard. */
  legacy?: true;
};

export const WORLD_LIMITS = Object.freeze({
  galaxyMin: 1,
  galaxyMax: 10,
  systemsPerGalaxy: 40,
  positionsPerSystem: 24,
  npcMin: 0,
  npcMax: 100,
  playerNameMin: 3,
  playerNameMax: 24,
  campaignNameMax: 40,
});

export const DEFAULT_NPC_COUNT = 7;
export const DEFAULT_MAX_NPC_PER_SYSTEM = 2;

/**
 * Density decides how NPC stubs spread over the systems. The weight is read
 * for a candidate system that already hosts `count` NPCs.
 */
export const WORLD_DENSITY_RULES: Readonly<Record<WorldDensity, { label: string; hint: string; weight: (count: number) => number }>> = Object.freeze({
  sparse: { label: 'Редкая', hint: 'NPC разбросаны по разным системам', weight: (count: number) => (count === 0 ? 6 : 1) },
  standard: { label: 'Обычная', hint: 'Равномерное распределение', weight: () => 1 },
  dense: { label: 'Плотная', hint: 'NPC собираются в скопления', weight: (count: number) => 1 + count * 4 },
});

export const CAMPAIGN_SPEED_LABELS: Readonly<Record<CampaignSpeed, { label: string; hint: string }>> = Object.freeze({
  slow: { label: 'Медленная', hint: 'Все таймеры ×0.5 — вдвое дольше' },
  standard: { label: 'Стандартная', hint: 'Текущий темп игры' },
  fast: { label: 'Быстрая', hint: 'Все таймеры ×2 — вдвое быстрее' },
});

const FACTIONS: readonly PlayerFactionId[] = ['aegis', 'synod', 'veyra'];
const SPEEDS: readonly CampaignSpeed[] = ['slow', 'standard', 'fast'];
const DENSITIES: readonly WorldDensity[] = ['sparse', 'standard', 'dense'];

function cleanText(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : '';
}

function integerIn(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? Math.min(max, Math.max(min, Math.round(numeric))) : fallback;
}

export function createDefaultNewGameConfig(input: Partial<Pick<NewGameConfig, 'factionId' | 'playerName' | 'seed' | 'campaignName'>> = {}): NewGameConfig {
  return {
    version: 1,
    seed: input.seed ?? createCampaignSeed(),
    factionId: input.factionId ?? 'aegis',
    playerName: input.playerName ?? 'Dendrilion',
    campaignName: input.campaignName ?? 'Новая кампания',
    world: {
      galaxyCount: 1,
      systemsPerGalaxy: 40,
      npcCount: DEFAULT_NPC_COUNT,
      maxNpcPerSystem: DEFAULT_MAX_NPC_PER_SYSTEM,
      density: 'standard',
      campaignSpeed: 'standard',
      randomPlayerStart: true,
    },
    npcFactions: 'random',
  };
}

/** The world of a save written before «Новая игра» existed. */
export function createLegacyWorldConfig(factionId: PlayerFactionId = 'aegis', playerName = 'Dendrilion'): NewGameConfig {
  return {
    version: 1,
    seed: 'LEGACY01',
    factionId,
    playerName,
    campaignName: 'Прежнее сохранение',
    world: {
      galaxyCount: 1,
      systemsPerGalaxy: 40,
      npcCount: 0,
      maxNpcPerSystem: DEFAULT_MAX_NPC_PER_SYSTEM,
      density: 'standard',
      campaignSpeed: 'standard',
      randomPlayerStart: false,
    },
    npcFactions: 'random',
    legacy: true,
  };
}

/** NPC capacity of a world: every system hosts at most `maxNpcPerSystem` stubs. */
export function getWorldNpcCapacity(world: Pick<NewGameConfig['world'], 'galaxyCount' | 'maxNpcPerSystem'>): number {
  return world.galaxyCount * WORLD_LIMITS.systemsPerGalaxy * world.maxNpcPerSystem;
}

export type WorldConfigIssue = { field: 'playerName' | 'campaignName' | 'npcCount' | 'seed'; message: string };

/** Inline wizard validation; an empty list means «Далее» is allowed. */
export function validateNewGameConfig(config: NewGameConfig): WorldConfigIssue[] {
  const issues: WorldConfigIssue[] = [];
  const name = config.playerName.trim();
  if (name.length < WORLD_LIMITS.playerNameMin || name.length > WORLD_LIMITS.playerNameMax) {
    issues.push({ field: 'playerName', message: `Имя командира: ${WORLD_LIMITS.playerNameMin}–${WORLD_LIMITS.playerNameMax} символа.` });
  }
  if (!config.campaignName.trim()) issues.push({ field: 'campaignName', message: 'Введите название кампании.' });
  if (!/^[A-Za-z0-9]{4,16}$/.test(config.seed)) issues.push({ field: 'seed', message: 'Сид: 4–16 латинских букв и цифр.' });
  const capacity = getWorldNpcCapacity(config.world);
  if (config.world.npcCount > capacity) {
    issues.push({ field: 'npcCount', message: `В мире помещается не больше ${capacity} NPC: увеличьте число галактик или лимит NPC на систему.` });
  }
  return issues;
}

/** Normalizes a persisted/imported config; unknown shapes fall back to the legacy world. */
export function normalizeNewGameConfig(value: unknown, fallback: NewGameConfig): NewGameConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback;
  const source = value as Record<string, unknown>;
  const world = (source.world && typeof source.world === 'object' ? source.world : {}) as Record<string, unknown>;
  const maxNpc = integerIn(world.maxNpcPerSystem, 1, 3, fallback.world.maxNpcPerSystem) as 1 | 2 | 3;
  const galaxyCount = integerIn(world.galaxyCount, WORLD_LIMITS.galaxyMin, WORLD_LIMITS.galaxyMax, fallback.world.galaxyCount);
  const capacity = galaxyCount * WORLD_LIMITS.systemsPerGalaxy * maxNpc;
  const seed = cleanText(source.seed, 16);
  return {
    version: 1,
    seed: /^[A-Za-z0-9]{4,16}$/.test(seed) ? seed : fallback.seed,
    factionId: FACTIONS.includes(source.factionId as PlayerFactionId) ? source.factionId as PlayerFactionId : fallback.factionId,
    playerName: cleanText(source.playerName, WORLD_LIMITS.playerNameMax) || fallback.playerName,
    campaignName: cleanText(source.campaignName, WORLD_LIMITS.campaignNameMax) || fallback.campaignName,
    world: {
      galaxyCount,
      systemsPerGalaxy: 40,
      npcCount: Math.min(capacity, integerIn(world.npcCount, WORLD_LIMITS.npcMin, WORLD_LIMITS.npcMax, fallback.world.npcCount)),
      maxNpcPerSystem: maxNpc,
      density: DENSITIES.includes(world.density as WorldDensity) ? world.density as WorldDensity : fallback.world.density,
      campaignSpeed: SPEEDS.includes(world.campaignSpeed as CampaignSpeed) ? world.campaignSpeed as CampaignSpeed : fallback.world.campaignSpeed,
      randomPlayerStart: typeof world.randomPlayerStart === 'boolean' ? world.randomPlayerStart : fallback.world.randomPlayerStart,
    },
    npcFactions: 'random',
    ...(source.legacy === true ? { legacy: true as const } : {}),
  };
}
