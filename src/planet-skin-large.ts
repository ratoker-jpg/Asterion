import { useEffect, useState } from 'react';

import { LARGE_PLANET_SCALE } from './planet-skin-large.generated.ts';

/**
 * 1024 px pictures of the planet looks, for the planet screen only.
 * Each file is fetched the first time its look is shown; the rest of the app
 * (grid, map, fleets, Empire) keeps the 512 / 192 px art. Built by
 * assets/source/planets/skins-v2/build-large.py.
 */
const loaders = import.meta.glob('./assets/art/planets/large/*.webp', {
  query: '?url',
  import: 'default',
}) as Record<string, () => Promise<string>>;

const requests = new Map<string, Promise<string | undefined>>();

/** QA only: the «before» screenshots switch the big picture off (localStorage flag set by electron/visual-planet-skins.cjs). */
function switchedOff(): boolean {
  try {
    return globalThis.localStorage?.getItem('asterion.qa.planet-large') === '0';
  } catch {
    return false;
  }
}

/** The big picture of a look, or undefined when it has none (the caller keeps its own art). */
export function largePlanetArt(skinId: string): Promise<string | undefined> {
  if (switchedOff()) return Promise.resolve(undefined);
  const cached = requests.get(skinId);
  if (cached) return cached;
  const load = loaders[`./assets/art/planets/large/${skinId}.webp`];
  const request = load ? load().catch(() => undefined) : Promise.resolve(undefined);
  requests.set(skinId, request);
  return request;
}

/**
 * CSS scale for the look's 1024 px picture, so the planet is as big on screen as the
 * look was before the 1024 px batch (see build-large.py). 1 for an unknown look.
 */
export function planetLargeScale(skinId: string | undefined): number {
  return (skinId && LARGE_PLANET_SCALE[skinId]) || 1;
}

/**
 * The look's big picture once it has loaded; until then (and for a look without one)
 * the given picture. Safe to call with no id.
 */
export function usePlanetLargeArt(skinId: string | undefined, fallback: string): string {
  const [loaded, setLoaded] = useState<{ id: string; url: string } | null>(null);
  useEffect(() => {
    if (!skinId) return;
    let alive = true;
    void largePlanetArt(skinId).then((url) => {
      if (alive && url) setLoaded({ id: skinId, url });
    });
    return () => {
      alive = false;
    };
  }, [skinId]);
  return loaded && loaded.id === skinId ? loaded.url : fallback;
}
