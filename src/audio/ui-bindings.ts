import { audio } from './engine.ts';
import type { SoundId } from './sounds.ts';

/**
 * Interface sounds are wired once, globally, by delegation: no screen imports
 * the audio engine to make a click audible. Mapping, in order:
 *  1. `data-sfx="<id>"` on the control or an ancestor (`none` silences it);
 *  2. the selector tables below;
 *  3. any other button: `click`.
 * Dialogs, toasts and screen swaps are heard through one MutationObserver.
 * Game events that have no DOM shape (incoming attack, new report) call
 * `playSound` from the App.
 */

const CONTROL = 'button, [role="button"], [role="tab"], [role="radio"], a[href], summary';

const CLICK_RULES: ReadonlyArray<readonly [string, SoundId]> = [
  ['[data-qa-wizard-start], [data-qa-continue], [data-qa-slot-load], [data-qa-menu-action="continue"]', 'launch'],
  ['.menu-race', 'select'],
  ['.menu-back, .building-interior-return-overlay, [data-qa-building-interior-back], [data-qa-menu-back], .battle-list-back-v1, [aria-label^="Закрыть"], [aria-label^="Назад"]', 'back'],
  ['.menu-btn--danger, .utility-control.danger, [data-qa-slot-delete], .igo-btn--danger', 'heavy'],
  [[
    '.menu-btn--primary', '.igo-btn--primary', '.uw-btn--primary', '.opsA-btn--primary',
    '.resource-building-build-button', '.resource-building-enter-button', '.spaceport-upgrade-cta-v2',
    '[data-qa-science-action]', '[data-qa-flight-preview-open]', '[data-qa-flight-dispatch-confirm]',
    '[data-qa-sun-launch-confirm]', '[data-qa-gate-start]', '.shipyard-build-button-v1', '.srp-cta',
    '[data-qa-wizard-next]', '[data-qa-confirm-yes]',
  ].join(', '), 'confirm'],
  [[
    '[role="tab"]', '.hdr-route', '.hdr-zone', '.menu-seg button', '.fleet-menu-group-v1 button',
    '.science-sections-v2 button', '.spaceport-sections-v2 button', '.settings-nav-v2 nav button',
    '.command-tabs button', '.fleet-ship-filter-v2 button', '.universe-radar__seg button', '.menu-stepper button',
  ].join(', '), 'tab'],
];

const HOVER_RULES: ReadonlyArray<readonly [string, SoundId]> = [
  ['.menu-nav__item, .menu-race, .menu-slot, .menu-teaser__figure, .menu-showcase', 'hoverCard'],
  ['.hdr-route, .hdr-zone, .zone-hotspot, .system-planet, .system-star-button, .resource-building-node, .menu-btn, .menu-back, .igo-btn', 'hover'],
];

const DIALOGS = [
  '.menu-modal', '.igo-backdrop', '.resource-building-action-confirm-backdrop', '.resource-building-dialog-backdrop',
  '.universe-modal-backdrop', '.gate-backdrop', '.command-dialog-backdrop', '.skin-picker-backdrop', '.srp-modal',
  '.ship-info-modal-v1', '.battle-report-modal-v1',
].join(', ');

/** Containers whose direct child is "the screen": a new child means a new screen. */
const SCREEN_HOSTS = '.utility-screen-host, .fleet-main-v1, .building-interior-host, .menu-stage';
const SCREEN_CHILD_SKIP = '.menu-bg, .menu-stars, .menu-modal, .menu-launch';

const TOAST_SOUND: Record<string, SoundId> = {
  'runtime-toast--success': 'success',
  'runtime-toast--error': 'error',
};

function soundFromRules(element: Element, rules: ReadonlyArray<readonly [string, SoundId]>) {
  for (const [selector, sound] of rules) if (element.matches(selector)) return sound;
  return null;
}

function explicitSound(element: Element): SoundId | 'none' | null {
  const tagged = element.closest('[data-sfx]');
  const value = tagged?.getAttribute('data-sfx');
  return value ? (value as SoundId | 'none') : null;
}

function onClick(event: MouseEvent) {
  const target = event.target instanceof Element ? event.target : null;
  const control = target?.closest(CONTROL);
  if (!control || control.matches(':disabled, [aria-disabled="true"]')) return;
  const explicit = explicitSound(control);
  if (explicit === 'none') return;
  audio.play(explicit ?? soundFromRules(control, CLICK_RULES) ?? 'click');
}

let hovered: Element | null = null;
function onPointerOver(event: PointerEvent) {
  if (event.pointerType !== 'mouse') return;
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;
  for (const [selector, sound] of HOVER_RULES) {
    const element = target.closest(selector);
    if (!element) continue;
    if (element !== hovered && !element.matches(':disabled')) {
      hovered = element;
      audio.play(sound);
    }
    return;
  }
  hovered = null;
}

let lastTickValue = '';
function onInput(event: Event) {
  const target = event.target;
  if (target instanceof HTMLInputElement && target.type === 'range' && target.value !== lastTickValue) {
    lastTickValue = target.value;
    audio.play('tick');
  }
}

function onChange(event: Event) {
  const target = event.target;
  if (target instanceof HTMLInputElement && target.type === 'checkbox' && explicitSound(target) !== 'none') {
    audio.play(target.checked ? 'toggleOn' : 'toggleOff');
  }
}

function soundForAdded(element: Element): SoundId | null {
  if (element.matches(DIALOGS) || element.querySelector(DIALOGS)) return 'open';
  if (element.classList.contains('runtime-toast')) {
    for (const [className, sound] of Object.entries(TOAST_SOUND)) if (element.classList.contains(className)) return sound;
    return 'info';
  }
  // In the game workspace the keyed scan line marks a new screen; elsewhere a new host child does.
  if (element.classList.contains('route-sweep')) return 'screen';
  const parent = element.parentElement;
  if (parent?.matches(SCREEN_HOSTS) && !element.matches(SCREEN_CHILD_SKIP)) return 'screen';
  return null;
}

function observeMutations(records: MutationRecord[]) {
  let added: SoundId | null = null;
  let closed = false;
  for (const record of records) {
    for (const node of record.addedNodes) {
      if (!(node instanceof Element)) continue;
      const sound = soundForAdded(node);
      // One sound per batch, the most specific wins (a dialog over a screen swap).
      if (sound && (added === null || added === 'screen')) added = sound;
    }
    for (const node of record.removedNodes) {
      if (node instanceof Element && (node.matches(DIALOGS) || node.querySelector(DIALOGS))) closed = true;
    }
  }
  if (added) audio.play(added);
  else if (closed) audio.play('close');
}

let installed = false;

export function installUiSounds() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  const unlock = () => audio.unlock();
  window.addEventListener('pointerdown', unlock, true);
  window.addEventListener('keydown', unlock, true);
  window.addEventListener('click', onClick, true);
  window.addEventListener('pointerover', onPointerOver, true);
  window.addEventListener('input', onInput, true);
  window.addEventListener('change', onChange, true);
  const start = () => new MutationObserver(observeMutations).observe(document.body, { childList: true, subtree: true });
  if (document.body) start();
  else window.addEventListener('DOMContentLoaded', start, { once: true });
}
