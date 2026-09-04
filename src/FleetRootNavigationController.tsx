import { useEffect } from 'react';

export const FLEET_ROOT_REQUEST_EVENT = 'asterion:fleet-root-request';

function normalizeText(value: string | null | undefined) {
  return value?.replace(/\s+/g, ' ').trim() ?? '';
}

export function FleetRootNavigationController() {
  useEffect(() => {
    const handlePrimaryNavigation = (event: MouseEvent) => {
      const element = event.target instanceof Element ? event.target : null;
      const button = element?.closest<HTMLButtonElement>('.primary-navigation button');
      if (!button) return;
      if (normalizeText(button.querySelector('span')?.textContent) !== 'Флоты') return;

      // FleetWorkspace owns the actual screen state. The global Fleet tab only asks it
      // to return home; it does not synthesize clicks into individual subpages.
      window.setTimeout(() => window.dispatchEvent(new Event(FLEET_ROOT_REQUEST_EVENT)), 0);
    };

    document.addEventListener('click', handlePrimaryNavigation, true);
    return () => document.removeEventListener('click', handlePrimaryNavigation, true);
  }, []);

  return null;
}
