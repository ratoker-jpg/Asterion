import { useEffect } from 'react';
import type { TypographyKey } from './domain/settings/types.ts';

const CATEGORY_ATTR = 'data-asterion-typography';
const BASE_SIZE_PROPERTY = '--asterion-base-font-size';
const SKIP_SELECTOR = '.asterion-header, .utility-screen-host, script, style, svg, path, canvas';
const FORM_SELECTOR = 'input, select, textarea, option';

// Legacy screens still contain local 6–10px declarations. Keep the preference
// multiplier useful, but never let the default 100% scale turn readable copy
// back into the micro-labels that caused the visual defects.
const MIN_BASE_FONT_SIZE: Record<TypographyKey, number> = {
  hud: 12,
  pageTitle: 18,
  sectionTitle: 14,
  body: 12,
  table: 12,
  control: 12,
  secondary: 11,
  helper: 11,
};

function hasDirectText(element: HTMLElement) {
  return Array.from(element.childNodes).some((node) => node.nodeType === Node.TEXT_NODE && Boolean(node.textContent?.trim()));
}

function classSignature(element: HTMLElement) {
  const parts: string[] = [];
  let current: HTMLElement | null = element;
  for (let depth = 0; current && depth < 4; depth += 1, current = current.parentElement) {
    if (typeof current.className === 'string') parts.push(current.className.toLowerCase());
  }
  return parts.join(' ');
}

export function inferTypographyCategory(element: HTMLElement): TypographyKey {
  const tag = element.tagName.toLowerCase();
  const signature = classSignature(element);

  if (element.closest('.footer-status, .shell-notice, .asterion-header__campaign-status, .asterion-header__campaign')) return 'hud';
  if (tag === 'h1' || /page-title|scene-title|screen-title/.test(signature)) return 'pageTitle';
  if (element.closest('button, [role="button"], input, select, textarea') || tag === 'option') return 'control';
  if (element.closest('table, [role="table"], [role="row"]') || /table|score|rank|points|stat|metric|resource|cost|value|amount|counter|countdown|time/.test(signature)) return 'table';
  if (element.matches('.utility-helper') || /helper|hint|tooltip|description|caption|note/.test(signature)) return 'helper';
  if (tag === 'small' || tag === 'label' || tag === 'dt' || tag === 'em' || /secondary|meta|subtitle|eyebrow|coords|status/.test(signature)) return 'secondary';
  if (/^h[2-6]$/.test(tag) || tag === 'legend' || /section-title|panel-title|card-title|block-title|heading/.test(signature)) return 'sectionTitle';
  return 'body';
}

function isManagedTarget(element: HTMLElement) {
  if (element.matches(SKIP_SELECTOR) || element.closest('.asterion-header, .utility-screen-host')) return false;
  if (element.matches(FORM_SELECTOR)) return true;
  return hasDirectText(element);
}

/** Elements under `root` (and `root`) that still need a category, in document order. */
function collectTargets(root: ParentNode): HTMLElement[] {
  const targets: HTMLElement[] = [];
  const consider = (element: HTMLElement) => {
    if (isManagedTarget(element) && !element.hasAttribute(CATEGORY_ATTR)) targets.push(element);
  };
  if (root instanceof HTMLElement) consider(root);
  root.querySelectorAll<HTMLElement>('*').forEach(consider);
  return targets;
}

// Two passes over everything added at once: all reads (the computed size), then all writes (the
// CSS variable, which is inherited and would dirty the style of the whole subtree). Reading after
// each write forced a style recalculation per node (audit 13.11, 4.4).
function tagElements(elements: HTMLElement[]) {
  const sizes = elements.map((element) => {
    const category = inferTypographyCategory(element);
    const declaredSize = Number.parseFloat(getComputedStyle(element).fontSize);
    return { element, category, baseSize: Math.max(declaredSize, MIN_BASE_FONT_SIZE[category]) };
  });
  for (const { element, category, baseSize } of sizes) {
    if (!Number.isFinite(baseSize) || baseSize <= 0) continue;
    element.style.setProperty(BASE_SIZE_PROPERTY, `${baseSize}px`);
    element.setAttribute(CATEGORY_ATTR, category);
  }
}

function scan(roots: ParentNode[]) {
  const targets = new Set<HTMLElement>();
  for (const root of roots) for (const element of collectTargets(root)) targets.add(element);
  tagElements([...targets]);
}

export function GlobalTypographyController() {
  useEffect(() => {
    scan([document.body]);

    const observer = new MutationObserver((mutations) => {
      const added: HTMLElement[] = [];
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node instanceof HTMLElement) added.push(node);
        }
      }
      if (added.length) scan(added);
    });
    observer.observe(document.body, { childList: true, subtree: true });

    return () => observer.disconnect();
  }, []);

  return null;
}
