import { useEffect } from 'react';
import type { TypographyKey } from './domain/settings/types.ts';

const CATEGORY_ATTR = 'data-asterion-typography';
const BASE_SIZE_PROPERTY = '--asterion-base-font-size';
const SKIP_SELECTOR = '.asterion-header, .utility-screen-host, script, style, svg, path, canvas';
const FORM_SELECTOR = 'input, select, textarea, option';

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

  if (element.closest('.footer-status, .shell-notice, .campaign-status, .campaign-module')) return 'hud';
  if (tag === 'h1' || /page-title|scene-title|screen-title|module-placeholder/.test(signature)) return 'pageTitle';
  if (element.closest('button, [role="button"], input, select, textarea') || tag === 'option') return 'control';
  if (element.closest('table, [role="table"], [role="row"]') || /table|score|rank|points|stat|metric|resource|cost|value|amount|counter|countdown|time/.test(signature)) return 'table';
  if (element.matches('.utility-helper') || /helper|hint|tooltip|description|caption|note/.test(signature)) return 'helper';
  if (tag === 'small' || tag === 'label' || tag === 'dt' || /secondary|meta|subtitle|eyebrow|coords|status/.test(signature)) return 'secondary';
  if (/^h[2-6]$/.test(tag) || tag === 'legend' || /section-title|panel-title|card-title|block-title|heading/.test(signature)) return 'sectionTitle';
  return 'body';
}

function isManagedTarget(element: HTMLElement) {
  if (element.matches(SKIP_SELECTOR) || element.closest('.asterion-header, .utility-screen-host')) return false;
  if (element.matches(FORM_SELECTOR)) return true;
  return hasDirectText(element);
}

function tagElement(element: HTMLElement) {
  if (!isManagedTarget(element)) return;
  if (element.hasAttribute(CATEGORY_ATTR)) return;

  const baseSize = Number.parseFloat(getComputedStyle(element).fontSize);
  if (!Number.isFinite(baseSize) || baseSize <= 0) return;

  element.style.setProperty(BASE_SIZE_PROPERTY, `${baseSize}px`);
  element.setAttribute(CATEGORY_ATTR, inferTypographyCategory(element));
}

function scan(root: ParentNode) {
  if (root instanceof HTMLElement) tagElement(root);
  root.querySelectorAll<HTMLElement>('*').forEach(tagElement);
}

export function GlobalTypographyController() {
  useEffect(() => {
    scan(document.body);

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node instanceof HTMLElement) scan(node);
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    return () => observer.disconnect();
  }, []);

  return null;
}
