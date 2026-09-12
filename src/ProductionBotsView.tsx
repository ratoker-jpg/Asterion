import { useEffect, useMemo, useState } from 'react';
import { getBuildingDefinition } from './domain/buildings/resource-zone.ts';
import {
  MAX_PRODUCTION_BOTS_PER_RESOURCE,
  PRODUCTION_BOT_BONUSES,
  getProductionBotAssignmentTotal,
  getProductionBotBonusPercent,
  getProductionBotFreeCount,
  isProductionBotAssignmentValid,
  productionBotAssignmentsEqual,
  setProductionBotDraftResource,
  type BotAssignment,
  type BotResource,
  type ProductionBotBuildingRole,
} from './domain/buildings/production-bots.ts';
import { ResourceIcon } from './ui/resources/ResourceIcon';
import './production-bots.css';

type ProductionBotsViewProps = {
  buildingRole: ProductionBotBuildingRole;
  planetName: string;
  buildingLevel: number;
  availableBots: number;
  appliedAssignment: BotAssignment;
  onApply: (assignment: BotAssignment) => void;
  onBack: () => void;
};

function backLabel(role: ProductionBotBuildingRole) {
  return role === 'construction' ? 'Назад в Фабрику' : 'Назад в Промышленный комплекс';
}

export function ProductionBotsView({
  buildingRole,
  planetName,
  buildingLevel,
  availableBots,
  appliedAssignment,
  onApply,
  onBack,
}: ProductionBotsViewProps) {
  const building = getBuildingDefinition(buildingRole);
  const [draft, setDraft] = useState<BotAssignment>(() => ({ ...appliedAssignment }));
  const [toastVisible, setToastVisible] = useState(false);

  useEffect(() => {
    setDraft({ ...appliedAssignment });
  }, [appliedAssignment]);

  useEffect(() => {
    if (!toastVisible) return;
    const timer = window.setTimeout(() => setToastVisible(false), 2400);
    return () => window.clearTimeout(timer);
  }, [toastVisible]);

  const appliedTotal = useMemo(() => getProductionBotAssignmentTotal(appliedAssignment), [appliedAssignment]);
  const appliedFree = useMemo(() => getProductionBotFreeCount(appliedAssignment, availableBots), [appliedAssignment, availableBots]);
  const draftTotal = useMemo(() => getProductionBotAssignmentTotal(draft), [draft]);
  const draftFree = useMemo(() => getProductionBotFreeCount(draft, availableBots), [draft, availableBots]);
  const draftValid = useMemo(() => isProductionBotAssignmentValid(draft, availableBots), [draft, availableBots]);
  const hasChanges = useMemo(() => !productionBotAssignmentsEqual(draft, appliedAssignment), [draft, appliedAssignment]);
  const canApply = draftValid && hasChanges;

  const changeDraft = (resource: BotResource, requestedValue: number) => {
    setDraft((current) => setProductionBotDraftResource(current, resource, requestedValue, availableBots));
  };

  const distribute = () => {
    if (!canApply) return;
    onApply({ ...draft });
    setToastVisible(false);
    window.requestAnimationFrame(() => setToastVisible(true));
  };

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
          </div>

          <section className="production-bots-pool" aria-label="Применённое распределение производственных роботов">
            <div><small>ДОСТУПНО РОБОТОВ</small><strong data-qa-bots-available={availableBots}>{availableBots}</strong></div>
            <div><small>РАСПРЕДЕЛЕНО</small><strong data-qa-bots-applied-total>{appliedTotal} / {availableBots}</strong></div>
            <div><small>СВОБОДНО</small><strong data-qa-bots-applied-free>{appliedFree}</strong></div>
          </section>

          <section className="production-bots-applied" aria-label="Применённый бонус от роботов">
            <div className="production-bots-section-label">БОНУС ОТ РОБОТОВ <span>ПРИМЕНЕНО</span></div>
            {PRODUCTION_BOT_BONUSES.map((definition) => (
              <div className="production-bots-applied-row" key={definition.resource}>
                <span>{definition.label}</span>
                <strong data-qa-bot-current-bonus={definition.resource}>+{getProductionBotBonusPercent(appliedAssignment, definition.resource)}%</strong>
              </div>
            ))}
          </section>
        </aside>

        <section className="production-bots-targets" aria-label="Целевые ресурсы">
          <header className="production-bots-targets-header">
            <div>
              <small>РАСПРЕДЕЛЕНИЕ РОБОТОВ</small>
              <h2>ЦЕЛЕВЫЕ РЕСУРСЫ</h2>
            </div>
            <span data-qa-bots-draft-total={draftTotal}>ЧЕРНОВИК {draftTotal} / {availableBots} · ДО 10 НА РЕСУРС</span>
          </header>

          <div className="production-bots-target-list">
            {PRODUCTION_BOT_BONUSES.map((definition) => {
              const assigned = draft[definition.resource];
              const draftBonus = getProductionBotBonusPercent(draft, definition.resource);
              const canDecrease = assigned > 0;
              const canIncrease = assigned < MAX_PRODUCTION_BOTS_PER_RESOURCE && draftTotal < availableBots;

              return (
                <div
                  className={`production-bot-target production-bot-target--${definition.resource}`}
                  key={definition.resource}
                  data-qa-production-bot-resource={definition.resource}
                >
                  <div className="production-bot-target__resource">
                    <span className="production-bot-target__icon"><ResourceIcon kind={definition.resource} /></span>
                    <span><small>РЕСУРС</small><strong>{definition.label}</strong></span>
                  </div>

                  <button
                    type="button"
                    className="production-bot-step"
                    aria-label={`Уменьшить: ${definition.label}`}
                    data-qa-bot-minus={definition.resource}
                    disabled={!canDecrease}
                    onClick={() => changeDraft(definition.resource, assigned - 1)}
                  >−</button>

                  <input
                    className="production-bot-range"
                    type="range"
                    min={0}
                    max={MAX_PRODUCTION_BOTS_PER_RESOURCE}
                    step={1}
                    value={assigned}
                    aria-label={`Роботы: ${definition.label}`}
                    aria-valuetext={`${assigned} из ${MAX_PRODUCTION_BOTS_PER_RESOURCE}`}
                    data-qa-bot-slider={definition.resource}
                    onChange={(event) => changeDraft(definition.resource, Number(event.target.value))}
                  />

                  <button
                    type="button"
                    className="production-bot-step"
                    aria-label={`Увеличить: ${definition.label}`}
                    data-qa-bot-plus={definition.resource}
                    disabled={!canIncrease}
                    onClick={() => changeDraft(definition.resource, assigned + 1)}
                  >+</button>

                  <strong className="production-bot-target__count" data-qa-bot-draft={definition.resource}>{assigned}</strong>

                  <div className="production-bot-target__effect" data-qa-bot-draft-effect={definition.resource}>
                    {assigned} {assigned === 1 ? 'бот' : assigned >= 2 && assigned <= 4 ? 'бота' : 'ботов'} · +{draftBonus}%
                  </div>
                </div>
              );
            })}
          </div>

          <footer className="production-bots-targets-footer">
            <div>
              <small>СВОБОДНО В ЧЕРНОВИКЕ</small>
              <strong data-qa-bots-draft-free={draftFree}>{draftFree}</strong>
            </div>
            <button
              type="button"
              className="production-bots-distribute"
              data-qa-production-bots-distribute
              disabled={!canApply}
              onClick={distribute}
            >
              РАСПРЕДЕЛИТЬ
            </button>
          </footer>
        </section>
      </div>

      <div className={`production-bots-toast ${toastVisible ? 'visible' : ''}`} aria-live="polite" aria-atomic="true" data-qa-production-bots-toast>
        {toastVisible ? <span><b aria-hidden="true">✓</b> Роботы перераспределены</span> : null}
      </div>
    </main>
  );
}
