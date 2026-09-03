import { useEffect } from 'react';

function normalizeText(value: string | null | undefined) {
  return value?.replace(/\s+/g, ' ').trim() ?? '';
}

function returnToFleetRoot() {
  const repairBack = document.querySelector<HTMLButtonElement>('.repair-back-v1');
  if (repairBack) {
    repairBack.click();
    return;
  }

  const priorityBack = document.querySelector<HTMLButtonElement>('.combat-priority-back-v1');
  if (priorityBack) {
    priorityBack.click();
    return;
  }

  const catalogBack = document.querySelector<HTMLButtonElement>('.shipyard-page-head-v1 > button');
  catalogBack?.click();
}

export function FleetRootNavigationController() {
  useEffect(() => {
    const handlePrimaryNavigation = (event: MouseEvent) => {
      const element = event.target instanceof Element ? event.target : null;
      const button = element?.closest<HTMLButtonElement>('.primary-navigation button');
      if (!button) return;
      if (normalizeText(button.querySelector('span')?.textContent) !== 'Флоты') return;

      // The top-level Fleet tab is the global home action for the whole Fleet module.
      // When already inside a Fleet subpage, use that page's own back action so
      // FleetWorkspace remains the source of truth for returning to the Fleet root.
      window.setTimeout(returnToFleetRoot, 0);
    };

    document.addEventListener('click', handlePrimaryNavigation, true);
    return () => document.removeEventListener('click', handlePrimaryNavigation, true);
  }, []);

  return null;
}
