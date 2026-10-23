import type { CampaignSpeed } from '../runtime/mode.ts';
import type { PlayerFactionId } from '../profile/types.ts';
import { createCampaignSeed } from './random.ts';

export type WorldDensity = 'sparse' | 'standard' | 'dense';

/** Share of every race among NPC stubs, in whole percent (sums to 100). */
export type NpcFactionMix = Record<PlayerFactionId, number>;

/**
 * «Новая игра» configuration, stored inside the save (`SaveState.worldConfig`).
 * A save without it is a legacy campaign: one galaxy, the player at [1:1:1],
 * standard speed — exactly the world that existed before the wizard.
 */
export type NewGameConfig = {
  version: 1;
  /** Visible map seed. Private NPC identity is independently salted per campaign. */
  seed: string;
  factionId: PlayerFactionId;
  playerName: string;
  campaignName: string;
  world: {
    galaxyCount: number;
    systemsPerGalaxy: 40;
    /** Number of seeded autonomous owners, each beginning with one canonical planet. */
    npcCount: number;
    maxNpcPerSystem: 1 | 2 | 3;
    density: WorldDensity;
    campaignSpeed: CampaignSpeed;
    randomPlayerStart: boolean;
  };
  /** `random`: every stub rolls its race from the seed; a mix fixes the shares exactly. */
  npcFactions: 'random' | NpcFactionMix;
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
export const DEFAULT_NPC_FACTION_MIX: NpcFactionMix = Object.freeze({ aegis: 34, synod: 33, veyra: 33 }) as NpcFactionMix;

/** Clamps a mix to whole percents that sum to exactly 100 (largest remainder). */
export function normalizeNpcFactionMix(value: unknown): NpcFactionMix | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const raw = FACTIONS.map((id) => {
    const numeric = typeof source[id] === 'number' ? source[id] as number : Number(source[id]);
    return Number.isFinite(numeric) ? Math.max(0, numeric) : 0;
  });
  const total = raw.reduce((sum, item) => sum + item, 0);
  if (total <= 0) return null;
  const exact = raw.map((item) => (item / total) * 100);
  const floors = exact.map(Math.floor);
  let left = 100 - floors.reduce((sum, item) => sum + item, 0);
  const order = exact.map((item, index) => ({ index, remainder: item - Math.floor(item) })).sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (const entry of order) { if (left <= 0) break; floors[entry.index]! += 1; left -= 1; }
  return { aegis: floors[0]!, synod: floors[1]!, veyra: floors[2]! };
}

/**
 * Moves one race's share and spreads the difference over the other two in
 * proportion to their current shares, so the mix always stays at 100%.
 */
export function setNpcFactionShare(mix: NpcFactionMix, factionId: PlayerFactionId, value: number): NpcFactionMix {
  const target = Math.min(100, Math.max(0, Math.round(value)));
  const others = FACTIONS.filter((id) => id !== factionId);
  const otherTotal = others.reduce((sum, id) => sum + mix[id], 0);
  const rest = 100 - target;
  const next = { ...mix, [factionId]: target } as NpcFactionMix;
  others.forEach((id) => { next[id] = otherTotal > 0 ? (mix[id] / otherTotal) * rest : rest / others.length; });
  // Re-normalize without disturbing the edited race.
  const first = Math.round(next[others[0]!]);
  next[others[0]!] = Math.min(rest, Math.max(0, first));
  next[others[1]!] = rest - next[others[0]!];
  return next;
}

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
    npcFactions: source.npcFactions === 'random' ? 'random' : normalizeNpcFactionMix(source.npcFactions) ?? 'random',
    ...(source.legacy === true ? { legacy: true as const } : {}),
  };
}
