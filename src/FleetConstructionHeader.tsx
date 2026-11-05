import type { BuildingPresentation } from './domain/buildings/balance-v1.ts';

type FleetConstructionHeaderProps = {
  viewId: string;
  shipyardPresentation: Pick<BuildingPresentation, 'art' | 'name'>;
  title: string;
  detail: string;
  /** The planet has no shipyard yet: say so once instead of on every locked row. */
  noShipyard: boolean;
  populationLabel: string;
  population: number;
  capacity: number;
  free: number;
};

const formatNumber = (value: number) => new Intl.NumberFormat('ru-RU').format(value);

export function FleetConstructionHeader({
  viewId,
  shipyardPresentation,
  title,
  detail,
  noShipyard,
  populationLabel,
  population,
  capacity,
  free,
}: FleetConstructionHeaderProps) {
  return (
    <header className="fc-head" data-qa-construction-header={viewId}>
      <img src={shipyardPresentation.art} alt="" aria-hidden="true" draggable={false} />
      <div className="fc-head__title">
        <h2>{title}</h2>
        <p>{detail}</p>
      </div>
      {noShipyard ? (
        <p className="fc-head__warning" role="status" data-qa-no-shipyard>
          На этой планете нет верфи: строить нельзя, пока она не построена.
        </p>
      ) : null}
      <div className="fc-head__pool" data-qa-population-scope={populationLabel.toUpperCase()}>
        <small>{populationLabel}</small>
        <strong>{formatNumber(population)} / {formatNumber(capacity)}</strong>
        <span>свободно {formatNumber(free)}</span>
      </div>
    </header>
  );
}
