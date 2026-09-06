import { ProductionBotsView } from './ProductionBotsView';
import { RecyclingCenterView } from './RecyclingCenterView';
import { getBuildingDefinition, type BuildingLevels } from './domain/buildings/resource-zone.ts';
import {
  getAvailableProductionBots,
  isProductionBotBuildingRole,
  type BotAssignment,
} from './domain/buildings/production-bots.ts';
import type { RecyclingState, ResourceAllocationPercent } from './domain/buildings/recycling.ts';
import type { BuildingInteriorContext } from './building-interior-navigation.ts';
import './building-interiors.css';

type BuildingInteriorHostProps<PlanetId extends string> = {
  context: BuildingInteriorContext<PlanetId>;
  planetName: string;
  moduleTitle: string;
  buildings: BuildingLevels;
  productionBots: BotAssignment;
  recycling: RecyclingState;
  now: number;
  onProductionBotsApply: (assignment: BotAssignment) => void;
  onRecyclingStart: (debrisAmount: number, allocation: ResourceAllocationPercent) => boolean;
  onRecyclingCollect: (jobId: string) => boolean;
  onBack: () => void;
};

export function BuildingInteriorHost<PlanetId extends string>({
  context,
  planetName,
  moduleTitle,
  buildings,
  productionBots,
  recycling,
  now,
  onProductionBotsApply,
  onRecyclingStart,
  onRecyclingCollect,
  onBack,
}: BuildingInteriorHostProps<PlanetId>) {
  if (context.buildingRole === 'recycling') {
    return (
      <RecyclingCenterView
        planetName={planetName}
        buildingLevel={buildings.recycling}
        recycling={recycling}
        now={now}
        onStart={onRecyclingStart}
        onCollect={onRecyclingCollect}
        onBack={onBack}
      />
    );
  }

  if (isProductionBotBuildingRole(context.buildingRole)) {
    return (
      <ProductionBotsView
        buildingRole={context.buildingRole}
        planetName={planetName}
        buildingLevel={buildings[context.buildingRole]}
        availableBots={getAvailableProductionBots(buildings)}
        appliedAssignment={productionBots}
        onApply={onProductionBotsApply}
        onBack={onBack}
      />
    );
  }

  const building = getBuildingDefinition(context.buildingRole);

  return (
    <main
      className="building-interior-host"
      data-qa-building-interior-host={context.buildingRole}
      data-qa-building-interior-zone={context.zone}
    >
      <header className="building-interior-header">
        <div>
          <small>ASTERION // ВНУТРЕННИЙ МОДУЛЬ</small>
          <h1>{moduleTitle}</h1>
        </div>
        <dl>
          <div><dt>ЗДАНИЕ</dt><dd>{building.name}</dd></div>
          <div><dt>ПЛАНЕТА</dt><dd>{planetName}</dd></div>
        </dl>
      </header>

      <section className="building-interior-empty" aria-live="polite">
        <span aria-hidden="true">◇</span>
        <strong>{building.name}</strong>
        <p>Модуль будет доступен в следующем обновлении</p>
      </section>

      <button
        className="building-interior-back"
        type="button"
        data-qa-building-interior-back
        onClick={onBack}
      >
        <span aria-hidden="true">←</span>
        Назад в {building.name}
      </button>
    </main>
  );
}
