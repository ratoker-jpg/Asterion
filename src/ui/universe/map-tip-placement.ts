export type TipRect = { left: number; top: number; right: number; bottom: number };

const EDGE_MARGIN = 8;
const ANCHOR_GAP = 8;

function clamp(value: number, min: number, max: number): number {
  // A tip larger than the map keeps its top left corner, the text start stays readable.
  return Math.max(min, Math.min(value, max));
}

function overlapArea(a: TipRect, b: TipRect): number {
  const width = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const height = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return width > 0 && height > 0 ? width * height : 0;
}

/**
 * Where a planet's reason goes, in screen pixels: fully inside the map, off the
 * panels lying over it (they would hide it) and off the planet itself. Above the
 * planet when that is free, then below, right and left; when nothing is free
 * (a very small window) the place that hides the least.
 */
export function chooseMapTipPlace(
  anchor: TipRect,
  tip: { width: number; height: number },
  bounds: TipRect,
  panels: readonly TipRect[],
): { left: number; top: number } {
  const centerX = (anchor.left + anchor.right) / 2 - tip.width / 2;
  const centerY = (anchor.top + anchor.bottom) / 2 - tip.height / 2;
  const wanted = [
    { left: centerX, top: anchor.top - ANCHOR_GAP - tip.height },
    { left: centerX, top: anchor.bottom + ANCHOR_GAP },
    { left: anchor.right + ANCHOR_GAP, top: centerY },
    { left: anchor.left - ANCHOR_GAP - tip.width, top: centerY },
  ];
  let best = { left: bounds.left + EDGE_MARGIN, top: bounds.top + EDGE_MARGIN };
  let bestCost = Number.POSITIVE_INFINITY;
  for (const place of wanted) {
    const left = clamp(place.left, bounds.left + EDGE_MARGIN, bounds.right - EDGE_MARGIN - tip.width);
    const top = clamp(place.top, bounds.top + EDGE_MARGIN, bounds.bottom - EDGE_MARGIN - tip.height);
    const box = { left: Math.max(left, bounds.left + EDGE_MARGIN), top: Math.max(top, bounds.top + EDGE_MARGIN), right: 0, bottom: 0 };
    box.right = box.left + tip.width;
    box.bottom = box.top + tip.height;
    const cost = panels.reduce((sum, panel) => sum + overlapArea(box, panel) * 10, overlapArea(box, anchor));
    if (cost < bestCost) {
      bestCost = cost;
      best = { left: box.left, top: box.top };
    }
    if (cost === 0) break;
  }
  return best;
}

const PANELS = '.universe-radar__crumb, .universe-radar__list, .universe-radar__nav, .universe-radar__rail, .universe-radar__dock';

/** Measures only when the pointer or focus arrives on a planet, so idle frames pay nothing. */
export function placeMapTip(planet: HTMLElement): void {
  const tip = planet.querySelector<HTMLElement>('[data-map-status-tip]');
  const scene = planet.closest('[data-qa-universe-scene]');
  if (!tip || !scene) return;
  const own = planet.getBoundingClientRect();
  const scale = planet.offsetWidth > 0 ? own.width / planet.offsetWidth : 1;
  const parts = [own, ...[...planet.querySelectorAll('.planet-name, .universe-map-occupancy')].map((part) => part.getBoundingClientRect())];
  const anchor = {
    left: Math.min(...parts.map((part) => part.left)),
    top: Math.min(...parts.map((part) => part.top)),
    right: Math.max(...parts.map((part) => part.right)),
    bottom: Math.max(...parts.map((part) => part.bottom)),
  };
  const size = tip.getBoundingClientRect();
  const panels = [...(planet.closest('.universe-radar')?.querySelectorAll(PANELS) ?? [])].map((panel) => panel.getBoundingClientRect());
  const place = chooseMapTipPlace(anchor, { width: tip.offsetWidth * scale || size.width, height: tip.offsetHeight * scale || size.height }, scene.getBoundingClientRect(), panels);
  tip.style.left = `${(place.left - own.left) / scale}px`;
  tip.style.top = `${(place.top - own.top) / scale}px`;
}
