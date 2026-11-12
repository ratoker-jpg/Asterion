import { memo, useRef, type ComponentType } from 'react';
import { propValuesEqual } from './prop-equal.ts';

/**
 * A screen that renders again only when its data changed. App builds most props inline (arrays, objects,
 * closures), which defeats memo(); here data is compared by value and every function prop becomes a stable
 * wrapper that calls the newest closure, so a handler is never stale and never the reason to render.
 * A prop that changes every second (a `now`) still renders the screen: pass such a screen the clock through
 * useClockNow() instead.
 */
export function memoScreen<P extends object>(Screen: ComponentType<P>, name = Screen.displayName || Screen.name || 'Screen'): ComponentType<P> {
  const Frozen = memo(Screen, (previous, next) => propValuesEqual(previous, next)) as ComponentType<P>;
  function MemoScreen(props: P) {
    const latest = useRef(props);
    latest.current = props;
    const wrappers = useRef<Record<string, (...args: unknown[]) => unknown>>({});
    const stable: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(props)) {
      if (typeof value === 'function') {
        wrappers.current[key] ??= (...args: unknown[]) => (latest.current as Record<string, (...rest: unknown[]) => unknown>)[key]?.(...args);
        stable[key] = wrappers.current[key];
      } else {
        stable[key] = value;
      }
    }
    return <Frozen {...(stable as P)} />;
  }
  MemoScreen.displayName = `MemoScreen(${name})`;
  return MemoScreen;
}
