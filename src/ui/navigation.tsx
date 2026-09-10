import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

export const APP_ROUTE_IDS = [
  'planet',
  'universe',
  'fleets',
  'operations',
  'command',
  'reports',
  'settings',
  'rating',
  'science',
] as const;

export type AppRoute = (typeof APP_ROUTE_IDS)[number];

export type NavigationIconKind =
  | 'planet'
  | 'universe'
  | 'fleets'
  | 'operations'
  | 'command'
  | 'reports'
  | 'settings'
  | 'rating'
  | 'science';

export const APP_ROUTE_LABELS = {
  planet: 'Планета',
  universe: 'Вселенная',
  fleets: 'Флоты',
  operations: 'Операции',
  command: 'Командование',
  reports: 'Отчёты',
  settings: 'Настройки',
  rating: 'Рейтинг',
  science: 'Наука',
} as const satisfies Record<AppRoute, string>;

export type AppNavigationItem = {
  id: AppRoute;
  label: (typeof APP_ROUTE_LABELS)[AppRoute];
  icon: NavigationIconKind;
};

export const PRIMARY_NAVIGATION = [
  { id: 'planet', label: APP_ROUTE_LABELS.planet, icon: 'planet' },
  { id: 'universe', label: APP_ROUTE_LABELS.universe, icon: 'universe' },
  { id: 'fleets', label: APP_ROUTE_LABELS.fleets, icon: 'fleets' },
  { id: 'operations', label: APP_ROUTE_LABELS.operations, icon: 'operations' },
  { id: 'command', label: APP_ROUTE_LABELS.command, icon: 'command' },
  { id: 'reports', label: APP_ROUTE_LABELS.reports, icon: 'reports' },
] as const satisfies readonly AppNavigationItem[];

export const UTILITY_NAVIGATION = [
  { id: 'settings', label: APP_ROUTE_LABELS.settings, icon: 'settings' },
  { id: 'rating', label: APP_ROUTE_LABELS.rating, icon: 'rating' },
  { id: 'science', label: APP_ROUTE_LABELS.science, icon: 'science' },
] as const satisfies readonly AppNavigationItem[];

export type FleetSectionId =
  | 'ships'
  | 'defense'
  | 'commander-ships'
  | 'repair'
  | 'combat-priority'
  | 'battles'
  | 'simulator';

export type FleetSectionItem = {
  id: FleetSectionId;
  label: string;
};

export const FLEET_SECTION_LABELS: Record<FleetSectionId, string> = {
  ships: 'Корабли',
  defense: 'Оборона',
  'commander-ships': 'Командирские корабли',
  repair: 'Ремонтная мастерская',
  'combat-priority': 'Боевой приоритет',
  battles: 'Битвы',
  simulator: 'Симулятор',
};

export const FLEET_CONSTRUCTION_NAVIGATION: readonly FleetSectionItem[] = [
  { id: 'ships', label: FLEET_SECTION_LABELS.ships },
  { id: 'defense', label: FLEET_SECTION_LABELS.defense },
  { id: 'commander-ships', label: FLEET_SECTION_LABELS['commander-ships'] },
  { id: 'repair', label: FLEET_SECTION_LABELS.repair },
];

export const FLEET_MANAGEMENT_NAVIGATION: readonly FleetSectionItem[] = [
  { id: 'combat-priority', label: FLEET_SECTION_LABELS['combat-priority'] },
  { id: 'battles', label: FLEET_SECTION_LABELS.battles },
  { id: 'simulator', label: FLEET_SECTION_LABELS.simulator },
];

type NavigationContextValue = {
  route: AppRoute;
  fleetSection: FleetSectionId;
  navigate: (route: AppRoute) => void;
  setFleetSection: (section: FleetSectionId) => void;
};

const NavigationContext = createContext<NavigationContextValue | null>(null);

export function NavigationProvider({ children }: { children: ReactNode }) {
  const [route, setRoute] = useState<AppRoute>('planet');
  const [fleetSection, setFleetSection] = useState<FleetSectionId>('ships');
  const value = useMemo<NavigationContextValue>(() => ({
    route,
    fleetSection,
    navigate: setRoute,
    setFleetSection,
  }), [fleetSection, route]);

  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>;
}

export function useNavigation() {
  const context = useContext(NavigationContext);
  if (!context) throw new Error('useNavigation must be used inside NavigationProvider');
  return context;
}

export function isUtilityRoute(route: AppRoute): route is 'settings' | 'rating' | 'science' {
  return route === 'settings' || route === 'rating' || route === 'science';
}

