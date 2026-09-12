import { ProductionBotsView } from './ProductionBotsView';
import { RecyclingCenterView } from './RecyclingCenterView';
import { SpaceportUpgradeView } from './SpaceportUpgradeView';
import { TradeCenterView } from './TradeCenterView';
import { getBuildingDefinition, type BuildingLevels, type ScienceLevels } from './domain/buildings/resource-zone.ts';
import {
  getAvailableProductionBots,
  isProductionBotBuildingRole,
  type BotAssignment,
} from './domain/buildings/production-bots.ts';
import type { RecyclingState, ResourceAllocationPercent } from './domain/buildings/recycling.ts';
import type {
  SpaceportUpgradeState,
  SpaceportUpgradeTrack,
  SpaceportUpgradeWallet,
} from './domain/buildings/spaceport-upgrades.ts';
import type { TradeExecution, TradeRequest, TradeState, TradeWallet } from './domain/buildings/trade.ts';
import type { BuildingInteriorContext } from './building-interior-navigation.ts';
import type { PlayerFactionId } from './domain/profile/types.ts';
import './building-interiors.css';

type BuildingInteriorHostProps<PlanetId extends string> = {
  context: BuildingInteriorContext<PlanetId>;
  planetName: string;
  moduleTitle: string;
  factionId: PlayerFactionId;
  buildings: BuildingLevels;
  scienceLevels: ScienceLevels;
  productionBots: BotAssignment;
  recycling: RecyclingState;
  trade: TradeState;
  tradeWallet: TradeWallet;
  spaceportUpgrades: SpaceportUpgradeState;
  spaceportWallet: SpaceportUpgradeWallet;
  resourceRatingPoints: number;
  now: number;
  onProductionBotsApply: (assignment: BotAssignment) => void;
  onRecyclingStart: (debrisAmount: number, allocation: ResourceAllocationPercent) => boolean;
  onRecyclingCollect: (jobId: string) => boolean;
  onTrade: (request: TradeRequest) => TradeExecution;
  onSpaceportUpgrade: (track: SpaceportUpgradeTrack, shipId: string) => boolean;
  onSpaceportCancel: (taskId: string) => boolean;
  onBack: () => void;
};

export function BuildingInteriorHost<PlanetId extends string>({
  context,
  planetName,
  moduleTitle,
  factionId,
  buildings,
  scienceLevels,
  productionBots,
  recycling,
  trade,
  tradeWallet,
  spaceportUpgrades,
  spaceportWallet,
  resourceRatingPoints,
  now,
  onProductionBotsApply,
  onRecyclingStart,
  onRecyclingCollect,
  onTrade,
  onSpaceportUpgrade,
  onSpaceportCancel,
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

  if (context.buildingRole === 'trade-center') {
    return (
      <TradeCenterView
        planetName={planetName}
        buildingLevel={buildings['trade-center']}
        trade={trade}
        wallet={tradeWallet}
        resourceRatingPoints={resourceRatingPoints}
        now={now}
        onTrade={onTrade}
        onBack={onBack}
      />
    );
  }

  if (context.buildingRole === 'spaceport') {
    return (
      <SpaceportUpgradeView
        planetName={planetName}
        factionId={factionId}
        buildingLevel={buildings.spaceport}
        buildings={buildings}
        scienceLevels={scienceLevels}
        upgrades={spaceportUpgrades}
        wallet={spaceportWallet}
        now={now}
        onUpgrade={onSpaceportUpgrade}
        onCancel={onSpaceportCancel}
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

  const building = getBuildingDefinition(context.buildingRole, factionId);

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
