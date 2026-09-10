import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { RepairWorkshopView } from './RepairWorkshopView';
import { FLEET_ROOT_REQUEST_EVENT } from './FleetRootNavigationController';
import { RUNTIME_STATE_CHANGED_EVENT } from './domain/runtime/mode.ts';
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
  const active = route === 'fleets' && fleetSection === 'repair';

  useEffect(() => {
    const syncPlanet = () => {
      setTarget(document.querySelector('.fleet-main-v1'));
      setPlanet(readCurrentPlanet());
    };

    syncPlanet();
    window.addEventListener(RUNTIME_STATE_CHANGED_EVENT, syncPlanet);
    window.addEventListener('storage', syncPlanet);
    return () => {
      window.removeEventListener(RUNTIME_STATE_CHANGED_EVENT, syncPlanet);
      window.removeEventListener('storage', syncPlanet);
    };
  }, [fleetSection, route]);

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

  return createPortal(
    <RepairWorkshopView
      planetName={planet.name}
      coords={planet.coords}
      onBack={() => {
        setFleetSection('ships');
        window.setTimeout(() => window.dispatchEvent(new Event(FLEET_ROOT_REQUEST_EVENT)), 0);
      }}
    />,
    target,
  );
}
