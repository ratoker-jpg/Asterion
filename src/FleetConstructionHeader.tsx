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
    <header className="shipyard-page-head-v1" data-qa-construction-header={viewId}>
      <div className="shipyard-page-title-v1">
        <span className="shipyard-page-art-v1">
          <img src={shipyardPresentation.art} alt="" aria-hidden="true" draggable={false} />
        </span>
        <div>
          <small>{kicker}</small>
          <h2>{title}</h2>
          <p>{planetName} {coords} · {description}</p>
        </div>
      </div>
      <button type="button" onClick={onBack}>← К ФЛОТАМ</button>
    </header>
  );
}
