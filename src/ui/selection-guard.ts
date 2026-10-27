// The game is an interface, not a document: Ctrl+A or a mouse sweep must not
// paint selection over buttons, headings and panels, and decorative art must
// not be dragged out as a ghost image. Fields stay editable, and text the
// player may want to copy (coordinates, nicknames, report and message bodies)
// stays selectable. Keep SELECTABLE_REGIONS in sync with the matching block in
// `src/ui/ui-polish.css`.
export const SELECTABLE_REGIONS = [
  '.ut-selectable',
  '.reports-preview-scroll',
  '.command-journal__list',
  '.command-dialog-body',
  '.cmdA-dossier-body',
  '.cmdA-desc',
  '.uw-coord',
  '.uw-owner-copy h3',
].join(',');

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement) return !target.readOnly && !target.disabled;
  if (target instanceof HTMLInputElement) {
    return !['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'color', 'file', 'image'].includes(target.type);
  }
  return false;
}

function selectionRegion(): Element | null {
  const node = window.getSelection()?.anchorNode;
  const element = node instanceof Element ? node : node?.parentElement;
  return element?.closest(SELECTABLE_REGIONS) ?? null;
}

export function installSelectionGuard(): void {
  // Ctrl+A in a field keeps its default. Inside a selectable region it selects
  // that region only; anywhere else it selects nothing.
  window.addEventListener('keydown', (event) => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.code !== 'KeyA') return;
    if (isEditable(event.target)) return;
    event.preventDefault();
    const region = selectionRegion();
    const selection = window.getSelection();
    if (!region || !selection) return;
    const range = document.createRange();
    range.selectNodeContents(region);
    selection.removeAllRanges();
    selection.addRange(range);
  }, { capture: true });

  // Images and links are never dragged out of the interface. Real drag and
  // drop (combat priority) uses explicitly draggable elements and is untouched.
  window.addEventListener('dragstart', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest('[draggable="true"]')) return;
    event.preventDefault();
  }, { capture: true });
}
