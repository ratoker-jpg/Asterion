import { ProductionBotsView } from './ProductionBotsView';
import { getBuildingDefinition } from './domain/buildings/resource-zone.ts';
import {
  isProductionBotBuildingRole,
  type ProductionBotBuildingRole,
} from './domain/buildings/production-bots.ts';
import type { BuildingInteriorContext } from './building-interior-navigation.ts';
import './building-interiors.css';

const SAVE_KEY = 'asterion.vertical-slice.v1';

type StoredProductionBotSave = {
  planets?: Record<string, {
    buildings?: Partial<Record<ProductionBotBuildingRole, unknown>>;
  }>;
};

type BuildingInteriorHostProps<PlanetId extends string> = {
  context: BuildingInteriorContext<PlanetId>;
  planetName: string;
  moduleTitle: string;
  onBack: () => void;
};

function readBuildingLevel(planetId: string, role: ProductionBotBuildingRole): number {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return 0;
    const parsed = JSON.parse(raw) as StoredProductionBotSave;
    const value = parsed.planets?.[planetId]?.buildings?.[role];
    return typeof value === 'number' && Number.isFinite(value)
      ? Math.max(0, Math.floor(value))
      : 0;
  } catch {
    return 0;
  }
}

export function BuildingInteriorHost<PlanetId extends string>({
  context,
  planetName,
  moduleTitle,
  onBack,
}: BuildingInteriorHostProps<PlanetId>) {
  if (isProductionBotBuildingRole(context.buildingRole)) {
    return (
      <ProductionBotsView
        buildingRole={context.buildingRole}
        planetName={planetName}
        buildingLevel={readBuildingLevel(context.planetId, context.buildingRole)}
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
