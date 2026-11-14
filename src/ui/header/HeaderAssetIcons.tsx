import type { NavigationIconKind } from '../navigation.tsx';
import type { PlayerFactionId } from '../../domain/profile/types.ts';
import type { HeaderIconKind, HeaderZoneId } from './types.ts';
import {
  RESOURCE_ICON_ASSETS,
  RESOURCE_ICON_OPTICAL_SCALES,
  type ResourceIconKind,
} from '../resources/resource-assets.ts';
import '../resources/resource-icons.css';
import resourceZoneIcon from '../../assets/ui/header-icons/zone-resource.webp';
import industryZoneIcon from '../../assets/ui/header-icons/zone-industry.webp';
import militaryZoneIcon from '../../assets/ui/header-icons/zone-military.webp';
import planetIcon from '../../assets/ui/header-icons/planet.webp';
import universeIcon from '../../assets/ui/header-icons/universe.webp';
import fleetsIcon from '../../assets/ui/header-icons/fleets.webp';
import operationsIcon from '../../assets/ui/header-icons/operations.webp';
import commandIcon from '../../assets/ui/header-icons/command.webp';
import reportsIcon from '../../assets/ui/header-icons/reports.webp';
import ratingIcon from '../../assets/ui/header-icons/rating.webp';
import scienceIcon from '../../assets/ui/header-icons/science.webp';
import alertsIcon from '../../assets/ui/header-icons/alerts.webp';

const GLOBAL_GAME_ICON_ASSETS = {
  metal: RESOURCE_ICON_ASSETS.metal,
  mineral: RESOURCE_ICON_ASSETS.minerals,
  gas: RESOURCE_ICON_ASSETS.gas,
  energy: RESOURCE_ICON_ASSETS.energy,
  population: RESOURCE_ICON_ASSETS.population,
  resource: resourceZoneIcon,
  industry: industryZoneIcon,
  military: militaryZoneIcon,
} satisfies Record<HeaderIconKind, string>;

/** «Настройки» has no picture: the header opens them from the menu, never with a navigation icon. */
const AEGIS_NAVIGATION_ICON_ASSETS: Partial<Record<NavigationIconKind, string>> = {
  planet: planetIcon,
  universe: universeIcon,
  fleets: fleetsIcon,
  operations: operationsIcon,
  command: commandIcon,
  reports: reportsIcon,
  rating: ratingIcon,
  science: scienceIcon,
};

const NAVIGATION_ICON_ASSETS: Partial<Record<PlayerFactionId, Partial<Record<NavigationIconKind, string>>>> = {
  aegis: AEGIS_NAVIGATION_ICON_ASSETS,
};

function AssetIcon({ src, resourceKind }: { src: string; resourceKind?: ResourceIconKind }) {
  const resourceClasses = resourceKind
    ? ['asterion-resource-icon', `asterion-resource-icon--${resourceKind}`]
    : [];

  return (
    <img
      className={['asterion-header-icon', ...resourceClasses].join(' ')}
      src={src}
      alt=""
      aria-hidden="true"
      data-qa-resource-kind={resourceKind}
      data-qa-resource-asset={resourceKind ? src : undefined}
      data-qa-resource-optical-scale={resourceKind ? RESOURCE_ICON_OPTICAL_SCALES[resourceKind] : undefined}
      draggable={false}
    />
  );
}

/** Global resource and zone icons used by the approved header only. */
export function HeaderGameIcon({ kind }: { kind: HeaderIconKind }) {
  const resourceKind: ResourceIconKind | undefined = kind === 'mineral' ? 'minerals' : kind === 'metal' || kind === 'gas' || kind === 'energy' || kind === 'population' ? kind : undefined;
  return <AssetIcon src={GLOBAL_GAME_ICON_ASSETS[kind]} resourceKind={resourceKind} />;
}

/** Approved transparent zone assets for the large planet scene. */
export function ApprovedZoneIcon({ kind }: { kind: HeaderZoneId }) {
  return <img className="asterion-zone-icon" src={GLOBAL_GAME_ICON_ASSETS[kind]} alt="" aria-hidden="true" draggable={false} />;
}

/**
 * Header navigation icons. Every faction uses the painted pack until faction-specific packs exist;
 * the faction colour comes from the header theme (docs/ui/race-accent.md), not from the icon.
 */
export function HeaderNavigationIcon({ kind, factionId = 'aegis' }: { kind: NavigationIconKind; factionId?: PlayerFactionId }) {
  const src = NAVIGATION_ICON_ASSETS[factionId]?.[kind] ?? AEGIS_NAVIGATION_ICON_ASSETS[kind];
  return src ? <AssetIcon src={src} /> : null;
}

/** «Сигналы» bell, painted in the same pack as the navigation icons. */
export function HeaderAlertsIcon() {
  return <AssetIcon src={alertsIcon} />;
}
