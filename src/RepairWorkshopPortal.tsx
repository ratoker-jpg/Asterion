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
      document.documentElement.classList.remove('asterion-repair-page', 'asterion-long-page');
      window.scrollTo(0, 0);
    };
  }, [active, target]);

  if (!active || !target) return null;

  const openShips = () => findFleetSectionButton('Корабли')?.click();

  return createPortal(
    <RepairWorkshopView planetName={planet.name} coords={planet.coords} onBack={openShips} />,
    target,
  );
}
