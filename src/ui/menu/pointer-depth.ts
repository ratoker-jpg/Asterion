import { useEffect, type RefObject } from 'react';

/** Cards that light up under the pointer (menu.css «spotlight») and tilt their art toward it. */
const SPOTLIT = '.menu-race, .menu-nav__item, .menu-slot, .menu-showcase, .menu-teaser__figure';

/**
 * Feeds the menu's depth effects with the pointer position, once per frame:
 * `--px/--py` (−1…1 across the window) on the viewport drive the background
 * parallax; `--mx/--my` (percent) and `--rx/--ry` (−1…1) on the card under
 * the pointer drive its spotlight and art parallax. Pure CSS does the motion;
 * nothing re-renders. Skipped entirely under prefers-reduced-motion.
 */
export function usePointerDepth(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const root = ref.current;
    if (!root || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let frame = 0;
    let last: PointerEvent | null = null;
    const apply = () => {
      frame = 0;
      if (!last) return;
      const { clientX, clientY } = last;
      root.style.setProperty('--px', (clientX / window.innerWidth * 2 - 1).toFixed(3));
      root.style.setProperty('--py', (clientY / window.innerHeight * 2 - 1).toFixed(3));
      const card = last.target instanceof Element ? last.target.closest<HTMLElement>(SPOTLIT) : null;
      if (!card) return;
      const rect = card.getBoundingClientRect();
      const x = (clientX - rect.left) / rect.width;
      const y = (clientY - rect.top) / rect.height;
      card.style.setProperty('--mx', `${(x * 100).toFixed(1)}%`);
      card.style.setProperty('--my', `${(y * 100).toFixed(1)}%`);
      card.style.setProperty('--rx', (x * 2 - 1).toFixed(3));
      card.style.setProperty('--ry', (y * 2 - 1).toFixed(3));
    };
    const onMove = (event: PointerEvent) => {
      last = event;
      if (!frame) frame = requestAnimationFrame(apply);
    };
    root.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      root.removeEventListener('pointermove', onMove);
      cancelAnimationFrame(frame);
    };
  }, [ref]);
}
