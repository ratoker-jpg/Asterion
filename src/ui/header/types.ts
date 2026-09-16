export const HEADER_ZONE_IDS = ['resource', 'industry', 'military'] as const;

export type HeaderZoneId = (typeof HEADER_ZONE_IDS)[number];
export type HeaderResourceKind = 'metal' | 'mineral' | 'gas' | 'energy' | 'population';
export type HeaderIconKind = HeaderResourceKind | HeaderZoneId;

export type HeaderPopulationBreakdown = {
  fleet: {
    value: number;
    capacity: number;
  };
  defense: {
    value: number;
    capacity: number;
  };
};

export type HeaderResourceModel = {
  kind: HeaderResourceKind;
  label: string;
  value: number;
  capacity?: number;
  showCapacity?: boolean;
  hourlyGain?: number;
  description?: string;
  populationBreakdown?: HeaderPopulationBreakdown;
};

export type HeaderPlanetModel = {
  id: string;
  name: string;
  coords: string;
  status: string;
  art: string;
};

export type HeaderZoneMeta = {
  title: string;
  subtitle: string;
  accent: string;
};
