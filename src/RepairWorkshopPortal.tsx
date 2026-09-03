import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { RepairWorkshopView } from './RepairWorkshopView';

function normalizeText(value: string | null | undefined) {
  return value?.replace(/\s+/g, ' ').trim() ?? '';
}

function readCurrentPlanet() {
  const strong = document.querySelector('.current-planet-select strong');
  if (!strong) return { name: 'Helion 01', coords: '[1:1:1]' };

  const coords = strong.querySelector('em')?.textContent?.trim() || '[1:1:1]';
  const name = Array.from(strong.childNodes)
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => node.textContent ?? '')
    .join(' ')
    .trim() || 'Helion 01';

  return { name, coords };
}

function findFleetSectionButton(label: string) {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('.fleet-menu-group-v1 button')).find(
    (button) => normalizeText(button.querySelector('strong')?.textContent) === label,
  );
}

function activeFleetSection() {
  return normalizeText(document.querySelector('.fleet-menu-group-v1 button.active strong')?.textContent);
}

function destinationNeedsLongPage() {
  return ['Корабли', 'Оборона', 'Командирские корабли'].includes(activeFleetSection())
    || Boolean(document.querySelector('.shipyard-view-v1'));
}

function openFleetRoot() {
  const shipsButton = findFleetSectionButton('Корабли');
  if (!shipsButton) return;

  // Let FleetWorkspace own the state transition: enter shipyard, then use its existing back action.
  shipsButton.click();
  requestAnimationFrame(() => {
    document.querySelector<HTMLButtonElement>('.shipyard-page-head-v1 > button')?.click();
  });
}

export function RepairWorkshopPortal() {
  const [target, setTarget] = useState<Element | null>(null);
  const [active, setActive] = useState(false);
  const [planet, setPlanet] = useState({ name: 'Helion 01', coords: '[1:1:1]' });

  useEffect(() => {
    const sync = () => {
      const activeTab = normalizeText(document.querySelector('.primary-navigation button.active span')?.textContent);
      const activeFleetSection = Array.from(document.querySelectorAll('.fleet-menu-group-v1 button.active strong'))
        .some((node) => normalizeText(node.textContent) === 'Ремонтная мастерская');

      setActive(activeTab === 'Флоты' && activeFleetSection);
      setTarget(document.querySelector('.fleet-main-v1'));
      setPlanet(readCurrentPlanet());
    };

    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['class'],
    });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!active || !target) return;

    document.documentElement.classList.add('asterion-repair-page', 'asterion-long-page');
    window.scrollTo(0, 0);

    return () => {
      document.documentElement.classList.remove('asterion-repair-page');

      // Shipyard/defense/commander screens use the same long-page class for page scrolling.
      // Do not remove it during the transition, otherwise the destination loses its scrollbar.
      if (!destinationNeedsLongPage()) {
        document.documentElement.classList.remove('asterion-long-page');
      }
      window.scrollTo(0, 0);
    };
  }, [active, target]);

  if (!active || !target) return null;

  return createPortal(
    <RepairWorkshopView planetName={planet.name} coords={planet.coords} onBack={openFleetRoot} />,
    target,
  );
}
