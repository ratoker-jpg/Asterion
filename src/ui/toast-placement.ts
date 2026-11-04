/**
 * Where the runtime toast stack may sit without covering a control or a
 * screen title. No fixed corner is free on every screen (top-left covered
 * «Центр сообщений», bottom-left «Добыча за 1 час»), so the stack tries a few
 * spots and takes the first one whose area holds nothing the player reads or
 * clicks. The probe looks at what is under sample points, so it follows
 * whatever screen, dialog or panel is open.
 */
const CONTROLS = [
  'button', 'a[href]', 'input', 'select', 'textarea', 'summary', 'label',
  '[role="button"]', '[role="tab"]', '[role="slider"]', '[role="checkbox"]', '[role="radio"]', '[role="menuitem"]',
].join(',');
const TITLES = [
  'h1', 'h2', 'h3', 'header', '[role="dialog"] header',
  '[class*="title"]', '[class*="heading"]', '[class*="kicker"]', '[data-toast-guard]',
].join(',');
/** Covering one control point costs as much as covering ten caption points. */
const CONTROL_WEIGHT = 10;

export type ToastSpot = { left?: number; right?: number; top?: number; bottom?: number };
export type ToastPick = { spot: ToastSpot; clear: boolean };

type Box = { x: number; y: number; width: number; height: number };

type Rect = { left: number; top: number; right: number; bottom: number };

/**
 * Boxes of everything a toast must not cover, taken once per probe (one layout
 * read). A point outside all of them has no control or title under it, so only
 * the points inside need the far dearer hit test below.
 */
function blockerRects(stack: HTMLElement | null): Rect[] {
  const rects: Rect[] = [];
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  for (const element of document.querySelectorAll<HTMLElement>(`${CONTROLS},${TITLES}`)) {
    if (stack?.contains(element)) continue;
    const box = element.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0 || box.right < 0 || box.bottom < 0 || box.left > vw || box.top > vh) continue;
    rects.push({ left: box.left, top: box.top, right: box.right, bottom: box.bottom });
  }
  return rects;
}

/**
 * Weighted count of sample points with a control or a title under them. Stops
 * counting past `limit`: a spot that already covers as much as the best one so
 * far cannot win, and on a busy screen (a table full of buttons) that is most of
 * the probe.
 */
function covers(box: Box, stack: HTMLElement | null, blockers: readonly Rect[], limit: number): number {
  let hits = 0;
  // Dense enough that a 30 px button cannot slip between two points.
  const columns = Math.max(2, Math.ceil(box.width / 20) + 1);
  const rows = Math.max(2, Math.ceil(box.height / 16) + 1);
  for (let c = 0; c < columns; c += 1) {
    for (let r = 0; r < rows; r += 1) {
      // From 4 px outside the edges: a control that only touches the toast counts too.
      const x = box.x - 4 + (box.width + 8) * (c / (columns - 1));
      const y = box.y - 4 + (box.height + 8) * (r / (rows - 1));
      if (!blockers.some((rect) => x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom)) continue;
      for (const element of document.elementsFromPoint(x, y)) {
        if (stack?.contains(element)) continue;
        if (element.closest(CONTROLS)) { hits += CONTROL_WEIGHT; break; }
        if (element.closest(TITLES)) { hits += 1; break; }
      }
      if (hits >= limit) return hits;
    }
  }
  return hits;
}

/**
 * The spot for a stack of `width`×`height` px. `headerBottom` is the lowest
 * pixel of the game header (the stack never goes over it). `clear` is false
 * when every spot covers something; the spot is then the least harmful one.
 * `prefer` (the spot the stack has now) wins while it is still clear, so a
 * visible toast moves only when something opens under it.
 */
export function pickToastSpot(width: number, height: number, headerBottom: number, stack: HTMLElement | null, prefer?: ToastSpot | null): ToastPick {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const gap = Math.max(12, Math.round(vw * 0.012));
  const top = Math.round(headerBottom + gap);
  const candidates: { spot: ToastSpot; box: Box }[] = [
    { spot: { right: gap, top }, box: { x: vw - gap - width, y: top, width, height } },
    { spot: { right: gap, bottom: gap }, box: { x: vw - gap - width, y: vh - gap - height, width, height } },
    { spot: { left: gap, bottom: gap }, box: { x: gap, y: vh - gap - height, width, height } },
    { spot: { left: Math.round((vw - width) / 2), top }, box: { x: (vw - width) / 2, y: top, width, height } },
    { spot: { left: gap, top }, box: { x: gap, y: top, width, height } },
    { spot: { left: Math.round((vw - width) / 2), bottom: gap }, box: { x: (vw - width) / 2, y: vh - gap - height, width, height } },
    { spot: { right: gap, top: Math.round((top + vh - height) / 2) }, box: { x: vw - gap - width, y: (top + vh - height) / 2, width, height } },
    { spot: { left: gap, top: Math.round((top + vh - height) / 2) }, box: { x: gap, y: (top + vh - height) / 2, width, height } },
  ];
  // Then slide along the bottom and top edges in quarter-width steps.
  for (let x = gap; x + width <= vw - gap; x += Math.max(40, Math.round(width / 4))) {
    candidates.push({ spot: { left: x, bottom: gap }, box: { x, y: vh - gap - height, width, height } });
    candidates.push({ spot: { left: x, top }, box: { x, y: top, width, height } });
  }
  const same = (a: ToastSpot, b: ToastSpot) => a.left === b.left && a.right === b.right && a.top === b.top && a.bottom === b.bottom;
  if (prefer) {
    const index = candidates.findIndex((candidate) => same(candidate.spot, prefer));
    if (index > 0) candidates.unshift(...candidates.splice(index, 1));
  }
  const blockers = blockerRects(stack);
  let best = candidates[0]!;
  let bestHits = Infinity;
  for (const candidate of candidates) {
    const hits = covers(candidate.box, stack, blockers, bestHits);
    if (hits === 0) return { spot: candidate.spot, clear: true };
    if (hits < bestHits) { best = candidate; bestHits = hits; }
  }
  return { spot: best.spot, clear: false };
}
