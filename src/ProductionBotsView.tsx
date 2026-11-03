import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { getBuildingDefinition } from './domain/buildings/resource-zone.ts';
import type { BuildingFaction } from './domain/buildings/balance-v1.ts';
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
  factionId: BuildingFaction;
  planetName: string;
  buildingLevel: number;
  availableBots: number;
  appliedAssignment: BotAssignment;
  onApply: (assignment: BotAssignment) => void;
  onBack: () => void;
};


export function ProductionBotsView({
  buildingRole,
  factionId,
  planetName,
  buildingLevel,
  availableBots,
  appliedAssignment,
  onApply,
  onBack,
}: ProductionBotsViewProps) {
  const building = getBuildingDefinition(buildingRole, factionId);
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
      <header className="pbots-header">
        <div>
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
          Назад: {building.name}
        </button>
      </header>

      <section className="pbots-panel" aria-label="Распределение производственных роботов">
        <aside className="pbots-building">
          <img src={building.art} alt={building.name} draggable={false} />
          <h2>{building.name}</h2>
          <span className="pbots-building__level">Уровень {buildingLevel}</span>
          <p className="pbots-building__total">Роботов на планете: <strong data-qa-bots-available={availableBots}>{availableBots}</strong></p>
          <p>Каждый робот ускоряет добычу выбранного ресурса. На один ресурс — до {MAX_PRODUCTION_BOTS_PER_RESOURCE} роботов.</p>
        </aside>

        <div className="pbots-allocation">
          <div className="pbots-columns" aria-hidden="true">
            <span>Ресурс</span>
            <span>Роботы</span>
            <span>Бонус</span>
          </div>

          <div className="pbots-rows">
            {PRODUCTION_BOT_BONUSES.map((definition) => {
              const assigned = draft[definition.resource];
              const draftBonus = getProductionBotBonusPercent(draft, definition.resource);
              const appliedBonus = getProductionBotBonusPercent(appliedAssignment, definition.resource);
              const reachable = Math.min(MAX_PRODUCTION_BOTS_PER_RESOURCE, assigned + draftFree);
              const canDecrease = assigned > 0;
              const canIncrease = assigned < MAX_PRODUCTION_BOTS_PER_RESOURCE && draftTotal < availableBots;

              return (
                <div
                  className={`pbots-row pbots-row--${definition.resource}`}
                  key={definition.resource}
                  data-qa-production-bot-resource={definition.resource}
                >
                  <div className="pbots-row__resource">
                    <ResourceIcon kind={definition.resource} />
                    <strong>{definition.label}</strong>
                  </div>

                  <div className="pbots-row__control">
                    <button
                      type="button"
                      className="pbots-step"
                      aria-label={`Уменьшить: ${definition.label}`}
                      data-qa-bot-minus={definition.resource}
                      disabled={!canDecrease}
                      onClick={() => changeDraft(definition.resource, assigned - 1)}
                    >−</button>

                    <BotPips
                      resource={definition.resource}
                      label={definition.label}
                      value={assigned}
                      reachable={reachable}
                      onChange={(value) => changeDraft(definition.resource, value)}
                    />

                    <button
                      type="button"
                      className="pbots-step"
                      aria-label={`Увеличить: ${definition.label}`}
                      data-qa-bot-plus={definition.resource}
                      disabled={!canIncrease}
                      onClick={() => changeDraft(definition.resource, assigned + 1)}
                    >+</button>

                    <strong className="pbots-row__count" data-qa-bot-draft={definition.resource}>{assigned}</strong>
                  </div>

                  <div className="pbots-row__bonus">
                    <strong data-qa-bot-draft-effect={definition.resource}>+{draftBonus}%</strong>
                    <small className={draftBonus === appliedBonus ? '' : 'is-changed'}>сейчас <b data-qa-bot-current-bonus={definition.resource}>+{appliedBonus}%</b></small>
                  </div>
                </div>
              );
            })}
          </div>

          <footer className="pbots-footer">
            <p data-qa-bots-draft-total={draftTotal}>
              Свободно <strong data-qa-bots-draft-free={draftFree}>{draftFree}</strong> из {availableBots}
            </p>
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
        </div>
      </section>

      <div className={`production-bots-toast ${toastVisible ? 'visible' : ''}`} aria-live="polite" aria-atomic="true" data-qa-production-bots-toast>
        {toastVisible ? <span><b aria-hidden="true">✓</b> Роботы перераспределены</span> : null}
      </div>
    </main>
  );
}

// Ten pips over a native range input: the input keeps keyboard control
// (arrows, Home/End) and the accessible value; a click or drag on the pips
// picks the pip under the pointer exactly.
function BotPips({
  resource,
  label,
  value,
  reachable,
  onChange,
}: {
  resource: BotResource;
  label: string;
  value: number;
  reachable: number;
  onChange: (value: number) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const pick = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / rect.width;
    onChange(Math.max(0, Math.min(MAX_PRODUCTION_BOTS_PER_RESOURCE, Math.ceil(ratio * MAX_PRODUCTION_BOTS_PER_RESOURCE))));
  };

  return (
    <div
      className="pbots-pips"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        inputRef.current?.focus({ preventScroll: true });
        pick(event);
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) pick(event);
      }}
    >
      <span className="pbots-pips__track" aria-hidden="true">
        {Array.from({ length: MAX_PRODUCTION_BOTS_PER_RESOURCE }, (_, index) => (
          <i key={index} className={index < value ? 'is-on' : index < reachable ? 'is-open' : 'is-closed'} />
        ))}
      </span>
      <input
        ref={inputRef}
        type="range"
        min={0}
        max={MAX_PRODUCTION_BOTS_PER_RESOURCE}
        step={1}
        value={value}
        aria-label={`Роботы: ${label}`}
        aria-valuetext={`${value} из ${MAX_PRODUCTION_BOTS_PER_RESOURCE}`}
        data-qa-bot-slider={resource}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  );
}
