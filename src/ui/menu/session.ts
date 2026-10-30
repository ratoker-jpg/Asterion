import { CAMPAIGN_SPEED_SCALE, setActiveProductionSaveKey, setCampaignTimeScale, type CampaignSpeed } from '../../domain/runtime/mode.ts';
import { setActiveGalaxyCount } from '../../domain/universe/runtime.ts';
import type { SaveSlotMeta } from '../../domain/session/slots.ts';
import { setActiveSlot } from '../../application/slots.ts';

/** sessionStorage key: which menu screen a reload should open (the game itself reloads into the menu). */
const NEXT_SCREEN_KEY = 'asterion.session.next-screen.v1';

export type MenuScreen = 'main' | 'load' | 'new' | 'settings';

export type ActiveSession = {
  slotId: string;
  slotName: string;
  factionId: SaveSlotMeta['factionId'];
  /** What the cloud relay did on entry (src/ui/menu/cloud.ts), shown once the game is up. */
  entryNotice?: { text: string; tone: 'info' | 'success' | 'error' };
};

/** Points every repository at the slot and applies its fixed campaign parameters. */
export function applySlotRuntime(slot: Pick<SaveSlotMeta, 'id' | 'storageKey' | 'campaignSpeed' | 'summary'>): void {
  setActiveProductionSaveKey(slot.storageKey);
  setCampaignTimeScale(CAMPAIGN_SPEED_SCALE[slot.campaignSpeed as CampaignSpeed] ?? 1);
  setActiveGalaxyCount(slot.summary.galaxyCount);
  setActiveSlot(slot.id);
}

/** Leaves the running campaign through a clean page reload (no stale module caches survive). */
export function reloadToMenu(screen: MenuScreen = 'main'): void {
  try { window.sessionStorage.setItem(NEXT_SCREEN_KEY, screen); } catch { /* reload still opens the main menu */ }
  window.location.reload();
}

export function consumeNextScreen(): MenuScreen | null {
  try {
    const value = window.sessionStorage.getItem(NEXT_SCREEN_KEY);
    window.sessionStorage.removeItem(NEXT_SCREEN_KEY);
    return value === 'main' || value === 'load' || value === 'new' || value === 'settings' ? value : null;
  } catch {
    return null;
  }
}

/** `?autostart=continue` opens the last slot directly (Electron QA scripts, desktop shortcuts). */
export function wantsAutostart(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('autostart') === 'continue';
}

export function isDesktopShell(): boolean {
  return typeof navigator !== 'undefined' && navigator.userAgent.includes('Electron');
}

export function quitDesktopApp(): void {
  const bridge = (window as unknown as { asterionDesktop?: { quit?: () => void } }).asterionDesktop;
  bridge?.quit?.();
}
