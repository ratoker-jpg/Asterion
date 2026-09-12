import type { BuildingPresentation } from './domain/buildings/balance-v1.ts';

type FleetConstructionHeaderProps = {
  viewId: string;
  shipyardPresentation: Pick<BuildingPresentation, 'art' | 'name'>;
  kicker: string;
  title: string;
  description: string;
  planetName: string;
  coords: string;
  onBack: () => void;
};

export function FleetConstructionHeader({
  viewId,
  shipyardPresentation,
  kicker,
  title,
  description,
  planetName,
  coords,
  onBack,
}: FleetConstructionHeaderProps) {
  return (
    <header className="building-card-v2 fleet-construction-card-v1" data-qa-construction-header={viewId}>
      <img src={shipyardPresentation.art} alt="" aria-hidden="true" draggable={false} />
      <div>
        <small>{kicker}</small>
        <strong>{title}</strong>
        <p>{planetName} {coords} · {description}</p>
      </div>
      <button type="button" onClick={onBack}>← К ФЛОТАМ</button>
    </header>
  );
}
