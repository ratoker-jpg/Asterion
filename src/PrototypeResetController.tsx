import { useEffect } from 'react';

import { FLEET_ROOT_REQUEST_EVENT } from './FleetRootNavigationController';

function normalizeText(value: string | null | undefined) {
  return value?.replace(/\s+/g, ' ').trim() ?? '';
}

export function PrototypeResetController() {
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const element = event.target instanceof Element ? event.target : null;
      const button = element?.closest<HTMLButtonElement>('.shell-notice button');
      if (!button || normalizeText(button.textContent) !== 'СБРОСИТЬ ПРОТОТИП') return;

      // App clears the persisted save in its own click handler. Returning FleetWorkspace
      // to its root unmounts any subpage-local state (including BattleReportsView), so a
      // subsequent open always reads the freshly reset save instead of resurrecting stale IDs.
      window.setTimeout(() => window.dispatchEvent(new Event(FLEET_ROOT_REQUEST_EVENT)), 0);
    };

    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);

  return null;
}
