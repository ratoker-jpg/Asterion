import { getBuildingDefinition } from './domain/buildings/resource-zone.ts';
import {
  PRODUCTION_BOT_BONUSES,
  createEmptyBotAssignment,
  getProductionBotBonusPercent,
  type BotResource,
  type ProductionBotBuildingRole,
} from './domain/buildings/production-bots.ts';
import './production-bots.css';

type ProductionBotsViewProps = {
  buildingRole: ProductionBotBuildingRole;
  planetName: string;
  buildingLevel: number;
  onBack: () => void;
};

function BotResourceIcon({ resource }: { resource: BotResource }) {
  const common = {
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };

  if (resource === 'metal') {
    return <svg viewBox="0 0 32 32" aria-hidden="true"><path {...common} d="m7 8 9-4 9 4-9 5-9-5Z"/><path {...common} d="m7 8 9 5v14l-9-5V8Zm18 0-9 5v14l9-5V8Z"/><path {...common} d="m11 10 10-4M11 20l5 3 5-3"/></svg>;
  }
  if (resource === 'minerals') {
    return <svg viewBox="0 0 32 32" aria-hidden="true"><path {...common} d="m16 3 10 10-10 16L6 13 16 3Z"/><path {...common} d="M6 13h20M16 3v26M10 13l6 7 6-7"/></svg>;
  }
  return <svg viewBox="0 0 32 32" aria-hidden="true"><path {...common} d="M16 4c5.6 6.8 8 11 8 15a8 8 0 1 1-16 0c0-4 2.4-8.2 8-15Z"/><circle {...common} cx="13" cy="18" r="2.2"/><circle {...common} cx="19.5" cy="21" r="1.6"/><circle {...common} cx="19" cy="15" r="1"/></svg>;
}

function backLabel(role: ProductionBotBuildingRole) {
  return role === 'construction' ? 'Назад в Фабрику' : 'Назад в Промышленный комплекс';
}

export function ProductionBotsView({ buildingRole, planetName, buildingLevel, onBack }: ProductionBotsViewProps) {
  const building = getBuildingDefinition(buildingRole);
  const assignment = createEmptyBotAssignment();

  return (
    <main
      className="production-bots-view"
      data-qa-production-bots={buildingRole}
      data-qa-production-bots-building={buildingRole}
    >
      <header className="production-bots-header">
        <div className="production-bots-header__copy">
          <small>ASTERION // ПРОМЫШЛЕННЫЙ МОДУЛЬ</small>
          <h1>ПРОИЗВОДСТВЕННЫЕ БОТЫ</h1>
          <p>{building.name} · {planetName}</p>
        </div>
        <button
          className="production-bots-back"
          type="button"
          data-qa-building-interior-back
          data-qa-production-bots-back
          onClick={onBack}
        >
          <span aria-hidden="true">←</span>
          {backLabel(buildingRole)}
        </button>
      </header>

      <div className="production-bots-layout">
        <aside className="production-bots-building-panel">
          <div className="production-bots-building-art">
            <img src={building.art} alt={building.name} draggable={false} />
          </div>
          <div className="production-bots-building-copy">
            <small>ТЕКУЩИЙ КОНТЕКСТ</small>
            <h2>{building.name}</h2>
            <div className="production-bots-building-level">УРОВЕНЬ <strong>{buildingLevel}</strong></div>
            <p>{building.purpose}</p>
          </div>
          <div className="production-bots-building-state">
            <span aria-hidden="true">◇</span>
            <div><small>СОСТОЯНИЕ</small><strong>Боты пока не назначены</strong></div>
          </div>
        </aside>

        <section className="production-bots-cards" aria-label="Производственные боты по ресурсам">
          {PRODUCTION_BOT_BONUSES.map((definition) => {
            const assigned = assignment[definition.resource];
            const currentBonus = getProductionBotBonusPercent(assignment, definition.resource);
            return (
              <article
                className={`production-bot-card production-bot-card--${definition.resource}`}
                key={definition.resource}
                data-qa-production-bot-resource={definition.resource}
              >
                <header className="production-bot-card__header">
                  <span className="production-bot-card__icon"><BotResourceIcon resource={definition.resource} /></span>
                  <div><small>ПРОИЗВОДСТВЕННЫЙ БОТ</small><h2>{definition.label}</h2></div>
                </header>

                <div className="production-bot-card__stats">
                  <div><small>НАЗНАЧЕНО</small><strong data-qa-bot-assigned={definition.resource}>{assigned}</strong></div>
                  <div><small>ТЕКУЩИЙ БОНУС</small><strong data-qa-bot-current-bonus={definition.resource}>+{currentBonus}%</strong></div>
                  <div className="accent"><small>ЗА 1 БОТА</small><strong data-qa-bot-percent={definition.resource}>+{definition.percentPerBot}%</strong></div>
                </div>

                <div className="production-bot-card__empty">Боты пока не назначены</div>

                <dl className="production-bot-card__pending">
                  <div><dt>УСЛОВИЯ</dt><dd>Не утверждены</dd></div>
                  <div><dt>СТОИМОСТЬ</dt><dd>Не утверждена</dd></div>
                </dl>
              </article>
            );
          })}
        </section>
      </div>

      <section className="production-bots-note" data-qa-production-bots-economy-note>
        <span aria-hidden="true">i</span>
        <div>
          <strong>Модель назначения ещё не утверждена</strong>
          <p>После утверждения модели бонусы будут применяться к добыче ресурсов. Сейчас этот экран не меняет показатели /ч, не списывает ресурсы и не использует общую очередь строительства.</p>
        </div>
      </section>
    </main>
  );
}
