import { ZoneView, type ZoneViewProps } from './ZoneView.tsx';
import type { ResourceBuildingRole } from './domain/buildings/resource-zone.ts';

export type ResourceZoneViewProps = Omit<ZoneViewProps, 'zone' | 'onBuild'> & {
  onBuild: (assetRole: ResourceBuildingRole) => boolean;
};

export function ResourceZoneView({ onBuild, ...props }: ResourceZoneViewProps) {
  return (
    <ZoneView
      {...props}
      zone="resource"
      onBuild={(assetRole) => onBuild(assetRole as ResourceBuildingRole)}
    />
  );
}
