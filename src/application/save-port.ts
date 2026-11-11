import type { DesktopSaveStore } from './save-storage.ts';

/** The page message that carries the other end of a save port (electron/preload.cjs). */
const SAVE_PORT_MESSAGE = 'asterionSavePort';
const SAVE_PORT_WAIT_MS = 2_000;

/**
 * Asks the desktop shell for a port to the main process's save files (one end
 * stays there, this is the other). Null in the web build or when it does not
 * arrive: saves then travel as text, as before the port existed.
 */
export function requestSavePort(): Promise<MessagePort | null> {
  if (typeof window === 'undefined') return Promise.resolve(null);
  const store = (window as unknown as { asterionDesktop?: { saveStore?: DesktopSaveStore } }).asterionDesktop?.saveStore;
  if (!store?.openWritePort) return Promise.resolve(null);
  return new Promise((resolve) => {
    const finish = (port: MessagePort | null) => {
      window.removeEventListener('message', onMessage);
      window.clearTimeout(timer);
      resolve(port);
    };
    const onMessage = (event: MessageEvent) => {
      const data = event.data as Record<string, unknown> | null;
      if (event.source !== window || !data || data[SAVE_PORT_MESSAGE] !== true || !event.ports[0]) return;
      finish(event.ports[0]);
    };
    const timer = window.setTimeout(() => finish(null), SAVE_PORT_WAIT_MS);
    window.addEventListener('message', onMessage);
    try { store.openWritePort!(); } catch { finish(null); }
  });
}
