import type { NavigationIconKind } from '../navigation.tsx';
import type { PlayerFactionId } from '../../domain/profile/types.ts';
import type { HeaderIconKind, HeaderZoneId } from './types.ts';
import { NavigationIcon as LegacyNavigationIcon } from './HeaderIcons';
import metalIcon from '../../assets/ui/header-icons/metal.png';
import mineralIcon from '../../assets/ui/header-icons/mineral.png';
import gasIcon from '../../assets/ui/header-icons/gas.png';
import energyIcon from '../../assets/ui/header-icons/energy.png';
import populationIcon from '../../assets/ui/header-icons/population.png';
import resourceZoneIcon from '../../assets/ui/header-icons/zone-resource.png';
import industryZoneIcon from '../../assets/ui/header-icons/zone-industry.png';
import militaryZoneIcon from '../../assets/ui/header-icons/zone-military.png';
import planetIcon from '../../assets/ui/header-icons/planet.png';
import universeIcon from '../../assets/ui/header-icons/universe.png';
import fleetsIcon from '../../assets/ui/header-icons/fleets.png';
import operationsIcon from '../../assets/ui/header-icons/operations.png';
import commandIcon from '../../assets/ui/header-icons/command.png';
import reportsIcon from '../../assets/ui/header-icons/reports.png';
import settingsIcon from '../../assets/ui/header-icons/settings.png';
import ratingIcon from '../../assets/ui/header-icons/rating.png';
import scienceIcon from '../../assets/ui/header-icons/science.png';

const GLOBAL_GAME_ICON_ASSETS = {
  metal: metalIcon,
  mineral: mineralIcon,
  gas: gasIcon,
  energy: energyIcon,
  population: populationIcon,
  resource: resourceZoneIcon,
  industry: industryZoneIcon,
  military: militaryZoneIcon,
} satisfies Record<HeaderIconKind, string>;

const AEGIS_NAVIGATION_ICON_ASSETS = {
  planet: planetIcon,
  universe: universeIcon,
  fleets: fleetsIcon,
  operations: operationsIcon,
  command: commandIcon,
  reports: reportsIcon,
  settings: settingsIcon,
  rating: ratingIcon,
  science: scienceIcon,
} satisfies Record<NavigationIconKind, string>;

function AssetIcon({ src }: { src: string }) {
  return <img className="asterion-header-icon" src={src} alt="" aria-hidden="true" draggable={false} />;
}

/** Global resource and zone icons used by the approved header only. */
export function HeaderGameIcon({ kind }: { kind: HeaderIconKind }) {
  return <AssetIcon src={GLOBAL_GAME_ICON_ASSETS[kind]} />;
}

/** Approved transparent zone assets for the large planet scene. */
export function ApprovedZoneIcon({ kind }: { kind: HeaderZoneId }) {
  return <img className="asterion-zone-icon" src={GLOBAL_GAME_ICON_ASSETS[kind]} alt="" aria-hidden="true" draggable={false} />;
}

/** Aegis header pack; other factions keep their existing vector icons for now. */
export function HeaderNavigationIcon({ kind, factionId = 'aegis' }: { kind: NavigationIconKind; factionId?: PlayerFactionId }) {
  if (factionId === 'aegis') return <AssetIcon src={AEGIS_NAVIGATION_ICON_ASSETS[kind]} />;
  return <LegacyNavigationIcon kind={kind} />;
}
