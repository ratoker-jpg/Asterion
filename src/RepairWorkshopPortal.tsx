import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { RepairWorkshopView } from './RepairWorkshopView';
import { FLEET_ROOT_REQUEST_EVENT } from './FleetRootNavigationController';
import { ACTIVE_RUNTIME_MODE, RUNTIME_STATE_CHANGED_EVENT } from './domain/runtime/mode.ts';
import { createPersistenceFacade } from './application/persistence.ts';
import { getRepairWorkshopSnapshot } from './application/repair.ts';
import type { SaveState } from './application/contracts.ts';
import { useNavigation } from './ui/navigation.tsx';

function readCurrentPlanet() {
  const selector = document.querySelector<HTMLElement>('[data-qa-current-planet]');
  return {
    name: selector?.dataset.planetName || 'Helion 01',
    coords: selector?.dataset.planetCoords || '[1:1:1]',
  };
}

export function RepairWorkshopPortal() {
  const { route, fleetSection, setFleetSection } = useNavigation();
  const [target, setTarget] = useState<Element | null>(null);
  const [planet, setPlanet] = useState({ name: 'Helion 01', coords: '[1:1:1]' });
  const persistence = useMemo(() => createPersistenceFacade({ mode: ACTIVE_RUNTIME_MODE }), []);
  const [state, setState] = useState<SaveState>(() => persistence.read());
  const active = route === 'fleets' && fleetSection === 'repair';

  useEffect(() => {
    const syncPlanet = () => {
      setTarget(document.querySelector('.fleet-main-v1'));
      setPlanet(readCurrentPlanet());
      setState(persistence.read());
    };

    const onRuntimeStateChanged = (event: Event) => {
      const next = (event as CustomEvent<SaveState>).detail;
      if (next && typeof next === 'object' && next.planets) setState(next);
      setTarget(document.querySelector('.fleet-main-v1'));
      setPlanet(readCurrentPlanet());
    };

    syncPlanet();
    window.addEventListener(RUNTIME_STATE_CHANGED_EVENT, onRuntimeStateChanged);
    window.addEventListener('storage', syncPlanet);
    return () => {
      window.removeEventListener(RUNTIME_STATE_CHANGED_EVENT, onRuntimeStateChanged);
      window.removeEventListener('storage', syncPlanet);
    };
  }, [fleetSection, persistence, route]);

  useEffect(() => {
    if (!active || !target) return;

    // Repair-specific styling is still local, but document scrolling is owned exclusively
    // by GlobalPageScrollController. Do not add/remove asterion-long-page here.
    document.documentElement.classList.add('asterion-repair-page');
    window.scrollTo(0, 0);

    return () => {
      document.documentElement.classList.remove('asterion-repair-page');
      window.scrollTo(0, 0);
    };
  }, [active, target]);

  if (!active || !target) return null;

  const snapshot = getRepairWorkshopSnapshot(state, state.currentPlanetId);

  return createPortal(
    <RepairWorkshopView
      planetName={planet.name}
      coords={planet.coords}
      snapshot={snapshot}
      onBack={() => {
        setFleetSection('ships');
        window.setTimeout(() => window.dispatchEvent(new Event(FLEET_ROOT_REQUEST_EVENT)), 0);
      }}
    />,
    target,
  );
}
