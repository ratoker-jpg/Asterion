import { useEffect, useState } from 'react';

/**
 * One wall-clock source for the whole window. App no longer keeps `now` in its
 * state: it publishes the time in the same batch as the world tick's reply, so a
 * second costs one React commit. Only countdown components subscribe here.
 *
 * Subscribers hold the time in plain `useState` (not useSyncExternalStore): a store
 * change always renders in the sync lane, so it landed in a commit of its own, apart
 * from the tick's setState (default/transition lane) - the second commit per second.
 * A setState called by `publishClock` joins whatever lane the caller is in, so inside
 * App's tick transition everything renders together.
 */
const STALE_AFTER_MS = 1_500;

let value = 0;
let publishedAt = 0;
const listeners = new Set<(at: number) => void>();
let watchdog: number | null = null;

/** The last published time. */
export function getClockNow(): number {
  if (value === 0) {
    value = Date.now();
    publishedAt = value;
  }
  return value;
}

/** Sets the shared time and wakes the subscribers; call it next to the state update it belongs to. */
export function publishClock(at: number = Date.now()): void {
  value = at;
  publishedAt = Date.now();
  for (const listener of listeners) listener(at);
}

function subscribe(listener: (at: number) => void): () => void {
  listeners.add(listener);
  // Nobody drives the clock (a screen on its own, a stopped world): keep it moving once a second.
  if (Date.now() - publishedAt > STALE_AFTER_MS) {
    value = Date.now();
    publishedAt = value;
  }
  if (watchdog === null) {
    watchdog = window.setInterval(() => {
      if (Date.now() - publishedAt > STALE_AFTER_MS) publishClock(Date.now());
    }, 1_000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && watchdog !== null) {
      window.clearInterval(watchdog);
      watchdog = null;
    }
  };
}

/** Re-renders the caller on every published second. Use it only where a countdown is drawn. */
export function useClockNow(): number {
  const [now, setNow] = useState(getClockNow);
  useEffect(() => {
    const unsubscribe = subscribe(setNow);
    // Published between this render and the subscription.
    setNow(getClockNow());
    return unsubscribe;
  }, []);
  return now;
}
