import { useCallback, useEffect, useState } from 'react';
import { SAVE_FLUSH_EVENT } from '../../application/save-storage.ts';

/** What electron/updater.cjs reports (docs/RELEASES.md). */
export type GameUpdateState = {
  status: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error' | 'latest';
  currentVersion: string;
  /** False in dev runs and with ASTERION_DISABLE_UPDATES: the version is shown, nothing is checked. */
  enabled: boolean;
  version?: string;
  percent?: number;
  message?: string;
};

type UpdatesBridge = {
  get(): Promise<GameUpdateState>;
  check(): Promise<GameUpdateState>;
  install(): Promise<{ ok: boolean }>;
  onState(listener: (state: GameUpdateState) => void): () => void;
};

function updatesBridge(): UpdatesBridge | null {
  if (typeof window === 'undefined') return null;
  const bridge = (window as unknown as { asterionDesktop?: { updates?: Partial<UpdatesBridge> } }).asterionDesktop?.updates;
  return bridge && typeof bridge.get === 'function' && typeof bridge.onState === 'function' ? bridge as UpdatesBridge : null;
}

export function updateStatusText(state: GameUpdateState): string {
  if (!state.enabled) return 'Обновления проверяет установленная игра';
  switch (state.status) {
    case 'checking': return 'Проверка обновлений…';
    case 'available': return `Доступна версия ${state.version ?? ''} · загрузка`;
    case 'downloading': return `Скачивание ${state.version ?? 'обновления'} · ${state.percent ?? 0}%`;
    case 'downloaded': return `Версия ${state.version ?? ''} готова к установке`;
    case 'error': return `${state.message ?? 'Не удалось проверить обновления'} · попробуйте позже`;
    case 'latest': return 'Установлена последняя версия';
    default: return '';
  }
}

/** The desktop game's update state; null in the browser build. */
export function useGameUpdates() {
  const [state, setState] = useState<GameUpdateState | null>(null);
  const [installing, setInstalling] = useState(false);
  useEffect(() => {
    const bridge = updatesBridge();
    if (!bridge) return undefined;
    let alive = true;
    const off = bridge.onState((next) => { if (alive) setState(next); });
    bridge.get().then((next) => { if (alive) setState((current) => current ?? next); }, () => undefined);
    return () => { alive = false; off(); };
  }, []);
  const check = useCallback(() => {
    updatesBridge()?.check().then(setState, () => undefined);
  }, []);
  /**
   * Writes every save to disk synchronously (the running campaign's deferred
   * autosave and play time included, see App), then lets the installer restart the game.
   */
  const install = useCallback(() => {
    const bridge = updatesBridge();
    if (!bridge) return;
    setInstalling(true);
    window.dispatchEvent(new Event(SAVE_FLUSH_EVENT));
    bridge.install().then((result) => { if (!result.ok) setInstalling(false); }, () => setInstalling(false));
  }, []);
  return { state, installing, check, install };
}
