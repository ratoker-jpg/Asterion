import type { PlayerFactionId } from '../../domain/profile/types.ts';
import type { SolarCrystalId } from '../../domain/sun-raid/config.ts';

/**
 * Runtime art of the Sun raid, Gates, debris and menu: WebP derivatives built by
 * `node tools/sun-raid-assets.mjs` from the Codex ImageGen sources in
 * assets/source (docs/notes/sun-raid-imagegen-delivery.md).
 */
const BASE = './assets/generated/sun-raid/';
const url = (file: string) => `${BASE}${file}`;

export const CRYSTAL_ART: Readonly<Record<SolarCrystalId, { lit: string; empty: string }>> = {
  'crystal-1': { lit: url('crystal-1.webp'), empty: url('crystal-1-empty.webp') },
  'crystal-2': { lit: url('crystal-2.webp'), empty: url('crystal-2-empty.webp') },
  'crystal-3': { lit: url('crystal-3.webp'), empty: url('crystal-3-empty.webp') },
  'crystal-4': { lit: url('crystal-4.webp'), empty: url('crystal-4-empty.webp') },
};

export const SUN_ART = { bright: url('sun-bright.webp'), dimmed: url('sun-dimmed.webp'), frozen: url('sun-frozen.webp') } as const;

export type GateStage = 'built' | 'construction' | 'ruined';
export function gateArt(factionId: PlayerFactionId, stage: GateStage = 'built'): string {
  return url(`gates-${factionId}-${stage}.webp`);
}

export const SUN_RAID_MISSION_ICON = url('mission-sun-raid.webp');
export const DEBRIS_FINDER_ICON = url('debris-finder.webp');
export const SUN_DEBRIS_ART = url('sun-debris.webp');

export function menuBackground(factionId?: PlayerFactionId | null): string {
  return url(factionId ? `menu-background-${factionId}.webp` : 'menu-background.webp');
}

export const CAMPAIGN_RESULT_ART = { victory: url('campaign-victory.webp'), defeat: url('campaign-defeat.webp') } as const;
