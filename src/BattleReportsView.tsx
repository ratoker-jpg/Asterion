import { createPortal } from 'react-dom';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type SyntheticEvent,
} from 'react';

import { COMMANDER_ABILITIES, isCommanderId } from './domain/combat/commanders.ts';
import {
  BATTLE_HISTORY_CHANGED_EVENT,
  persistBattleHistory,
  readBattleHistory,
  setBattleReportSaved,
  type BattleHistoryState,
} from './domain/combat/battle-repository.ts';
import {
  ASTERION_LOCAL_PLAYER_ID,
  filterBattleReports,
  type BattleListMode,
  type BattleReport,
} from './domain/combat/report.ts';
import {
  BATTLE_MISSING_DATA,
  createBattleReportViewModel,
  type BattleEntityKind,
  type BattleEventViewModel,
  type BattleParticipantViewModel,
  type BattleReportViewModel,
  type BattleRoundViewModel,
  type BattleSideViewModel,
  type BattleStackViewModel,
} from './domain/combat/battle-report-view-model.ts';
import { ResourceIcon } from './ui/resources/ResourceIcon';
import battleBackground from './assets/battle-report/battle-bg-approved-candidate.png';
import './battle-reports.css';

type SaveNotice = { kind: 'saved' | 'error'; message: string };
type ScrollRef = { current: HTMLElement | null };

function formatNumber(value: number | null | undefined) {
  return value == null ? BATTLE_MISSING_DATA : new Intl.NumberFormat('ru-RU').format(value);
}

function formatBattleDate(timestamp: string, withYear = true) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return BATTLE_MISSING_DATA;
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    ...(withYear ? { year: 'numeric' as const } : {}),
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function participantLabel(participant: BattleParticipantViewModel) {
  const title = participant.planetName ?? participant.playerName;
  return `${title}${participant.coordinates ? ` ${participant.coordinates}` : ''}`;
}

function resultLabel(viewModel: BattleReportViewModel) {
  const localSide = viewModel.attacker.participant.playerId === ASTERION_LOCAL_PLAYER_ID
    ? 'attacker'
    : viewModel.defender.participant.playerId === ASTERION_LOCAL_PLAYER_ID
      ? 'defender'
      : null;
  if (viewModel.winner === 'draw') return { label: 'НИЧЬЯ', tone: 'draw' } as const;
  if (localSide) return viewModel.winner === localSide
    ? { label: 'ПОБЕДА', tone: 'victory' } as const
    : { label: 'ПОРАЖЕНИЕ', tone: 'defeat' } as const;
  return viewModel.winner === 'attacker'
    ? { label: 'ПОБЕДА АТАКУЮЩЕГО', tone: 'victory' } as const
    : { label: 'ПОБЕДА ЗАЩИТНИКА', tone: 'defeat' } as const;
}

function missionLabel(missionType: BattleReportViewModel['missionType']) {
  return {
    attack: 'АТАКА',
    raid: 'РЕЙД',
    defense: 'ОБОРОНА',
    arena: 'АРЕНА',
    simulation: 'СИМУЛЯЦИЯ',
  }[missionType];
}

function countSuffix(value: number | null) {
  return value == null ? '' : ` × ${formatNumber(value)}`;
}

function SaveButton({ saved, onToggle, reportId }: { saved: boolean; onToggle: () => void; reportId: string }) {
  return (
    <button
      type="button"
      className={`battle-save-v1 ${saved ? 'saved' : ''}`}
      aria-label={saved ? `Убрать отчёт ${reportId} из сохранённых` : `Сохранить отчёт ${reportId}`}
      aria-pressed={saved}
      title={saved ? 'Убрать из сохранённых' : 'Сохранить отчёт'}
      onClick={onToggle}
    >
      <span aria-hidden="true">{saved ? '★' : '☆'}</span>
    </button>
  );
}

function LossSummary({ side }: { side: BattleSideViewModel }) {
  return (
    <div className="battle-card-losses-v1" data-qa-battle-losses={side.participant.side}>
      <span>Потери <b>{formatNumber(side.losses.population)}</b> населения</span>
      {side.losses.ships != null ? <span>Корабли <b>{formatNumber(side.losses.ships)}</b></span> : null}
      {side.losses.defenses != null ? <span>Оборона <b>{formatNumber(side.losses.defenses)}</b></span> : null}
    </div>
  );
}

function BattleCard({
  viewModel,
  saved,
  onToggleSaved,
  onOpen,
}: {
  viewModel: BattleReportViewModel;
  saved: boolean;
  onToggleSaved: () => void;
  onOpen: () => void;
}) {
  const result = resultLabel(viewModel);
  const optionalRewards = viewModel.debris != null || viewModel.resources.length > 0;
  return (
    <article className="battle-card-v1" data-qa-battle-card={viewModel.id}>
      <header className="battle-card-head-v1">
        <strong className={`battle-result-v1 ${result.tone}`}>{result.label}</strong>
        <time dateTime={viewModel.timestamp}>{formatBattleDate(viewModel.timestamp)}</time>
      </header>

      <div className="battle-route-v1">
        <strong>{participantLabel(viewModel.attacker.participant)}</strong>
        <span aria-hidden="true">→</span>
        <strong>{participantLabel(viewModel.defender.participant)}</strong>
      </div>

      <div className="battle-card-sides-v1">
        {[viewModel.attacker, viewModel.defender].map((side) => (
          <div key={side.participant.side} data-qa-battle-side={side.participant.side}>
            <small>{side.participant.side === 'attacker' ? 'АТАКУЮЩИЙ' : 'ЗАЩИТНИК'}</small>
            <span>Население <b>{formatNumber(side.populationBefore)}</b> → <b>{formatNumber(side.populationAfter)}</b></span>
            <LossSummary side={side} />
          </div>
        ))}
      </div>

      {optionalRewards ? (
        <div className="battle-card-rewards-v1">
          {viewModel.debris != null ? <span>Обломки <b>{formatNumber(viewModel.debris)}</b></span> : null}
          {viewModel.resources.map((resource) => <span key={resource.kind}>{resource.label} <b>{formatNumber(resource.value)}</b></span>)}
        </div>
      ) : null}

      <footer className="battle-card-footer-v1">
        <span>Раундов: <b>{formatNumber(viewModel.roundCount)}</b></span>
        <div>
          <SaveButton saved={saved} onToggle={onToggleSaved} reportId={viewModel.id} />
          <button type="button" className="battle-open-v1" data-qa-battle-open={viewModel.id} onClick={onOpen}>ПОСМОТРЕТЬ БОЕВОЙ ДОКЛАД</button>
        </div>
      </footer>
    </article>
  );
}

function PopulationPanel({ viewModel }: { viewModel: BattleReportViewModel }) {
  const result = resultLabel(viewModel);
  return (
    <section className="battle-summary-v1" data-qa-battle-summary>
      <header>
        <div><small>РЕЗУЛЬТАТ БОЯ · {missionLabel(viewModel.missionType)}</small><h3>{result.label}</h3></div>
        <span>{formatNumber(viewModel.roundCount)} РАУНДОВ</span>
      </header>
      <div className="battle-summary-grid-v1">
        {[viewModel.attacker, viewModel.defender].map((side) => (
          <div key={side.participant.side} data-qa-battle-summary-side={side.participant.side}>
            <strong>{side.participant.side === 'attacker' ? 'АТАКУЮЩИЙ' : 'ЗАЩИТНИК'}</strong>
            <p className="battle-summary-participant-v1">{participantLabel(side.participant)}</p>
            <dl>
              <div><dt>Население</dt><dd>{formatNumber(side.populationBefore)} → {formatNumber(side.populationAfter)}</dd></div>
              <div><dt>Потери</dt><dd>{formatNumber(side.losses.population)}</dd></div>
              <div><dt>Потери флота</dt><dd>{formatNumber(side.losses.ships)}</dd></div>
              <div><dt>Осталось флота</dt><dd>{formatNumber(side.remainingShips)}</dd></div>
              {side.participant.side === 'defender' ? (
                <>
                  <div><dt>Потери обороны</dt><dd>{formatNumber(side.losses.defenses)}</dd></div>
                  <div><dt>Осталось обороны</dt><dd>{formatNumber(side.remainingDefenses)}</dd></div>
                </>
              ) : null}
            </dl>
          </div>
        ))}
      </div>
    </section>
  );
}

function StackRow({ stack }: { stack: BattleStackViewModel }) {
  return (
    <div className="battle-stack-row-v1" data-qa-battle-composition-stack={stack.entityId}>
      <span className="battle-stack-art-v1"><img src={stack.art} alt="" draggable={false} /></span>
      <span className="battle-stack-name-v1"><strong>{stack.name}</strong><small>{stack.category}</small></span>
      <span><small>БЫЛО</small><b>{formatNumber(stack.countBefore)}</b></span>
      <span><small>ОСТАЛОСЬ</small><b>{formatNumber(stack.countAfter)}</b></span>
      <span><small>УНИЧТОЖЕНО</small><b>{formatNumber(stack.destroyed)}</b></span>
    </div>
  );
}

function StackList({ stacks, emptyLabel = 'Состав недоступен для этого отчёта.' }: { stacks: BattleStackViewModel[]; emptyLabel?: string }) {
  return stacks.length
    ? <div className="battle-stack-list-v1">{stacks.map((stack) => <StackRow key={stack.key} stack={stack} />)}</div>
    : <p className="battle-empty-inline-v1">{emptyLabel}</p>;
}

function CompositionSide({ side }: { side: BattleSideViewModel }) {
  return (
    <section>
      <h4>{side.participant.side === 'attacker' ? 'АТАКУЮЩИЙ' : 'ЗАЩИТНИК'}</h4>
      <StackList stacks={side.ships} />
      {side.commanders.length ? (
        <div className="battle-composition-subgroup-v1">
          <h5>КОМАНДИРЫ</h5>
          <StackList stacks={side.commanders} />
        </div>
      ) : null}
      {side.participant.side === 'defender' ? (
        <div className="battle-defense-v1">
          <h4>ОБОРОНА</h4>
          <StackList stacks={side.defenses} emptyLabel="Оборона не зафиксирована в этом отчёте." />
        </div>
      ) : null}
    </section>
  );
}

function BattleComposition({ viewModel }: { viewModel: BattleReportViewModel }) {
  return (
    <section className="battle-section-v1" data-qa-battle-composition>
      <header className="battle-section-head-v1"><div><small>СОСТАВ БОЯ</small><h3>ДО / ПОСЛЕ</h3></div></header>
      <div className="battle-composition-grid-v1">
        <CompositionSide side={viewModel.attacker} />
        <CompositionSide side={viewModel.defender} />
      </div>
    </section>
  );
}

function CommanderSnapshot({ viewModel }: { viewModel: BattleReportViewModel }) {
  const commanderRows = [viewModel.attacker, viewModel.defender]
    .filter((side) => side.activeCommander)
    .map((side) => ({ side, commander: side.activeCommander! }));
  const modifierRows = [viewModel.attacker, viewModel.defender].filter((side) => side.modifiers.length);
  if (!commanderRows.length && !modifierRows.length) return null;

  return (
      <section className="battle-section-v1" data-qa-battle-commanders>
        <header className="battle-section-head-v1"><div><small>КОМАНДИРСКИЙ SNAPSHOT</small><h3>КОМАНДИР И БОНУСЫ</h3></div></header>
      {commanderRows.length ? (
        <div className="battle-commanders-v1">
          {commanderRows.map(({ side, commander }) => {
            const ability = isCommanderId(commander.entityId) ? COMMANDER_ABILITIES[commander.entityId] : null;
            return (
              <article key={`${side.participant.side}-${commander.entityId}`}>
                <img src={commander.art} alt="" draggable={false} />
                <div>
                  <small>{side.participant.side === 'attacker' ? 'АТАКУЮЩИЙ' : 'ЗАЩИТНИК'}</small>
                  <strong>{commander.name}</strong>
                  <span>Уровень: {formatNumber(commander.tooltip.level)}</span>
                  <span>Способность: {ability?.ability ?? BATTLE_MISSING_DATA}</span>
                  <em>Эффект не пересчитывается в отчёте.</em>
                </div>
              </article>
            );
          })}
        </div>
      ) : null}
      {modifierRows.length ? (
        <div className="battle-command-bonuses-v1" data-qa-battle-bonuses>
          <small>ЗАФИКСИРОВАННЫЕ БОНУСЫ И МОДИФИКАТОРЫ</small>
          {modifierRows.map((side) => (
            <div key={side.participant.side}>
              <strong>{side.participant.side === 'attacker' ? 'АТАКУЮЩИЙ' : 'ЗАЩИТНИК'}</strong>
              {side.modifiers.map((modifier) => <span key={modifier.key}>{modifier.label}: <b>{modifier.value}</b></span>)}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function OptionalMetric({ label, before, after }: { label: string; before: number | null; after: number | null }) {
  if (before == null && after == null) return null;
  return <span><small>{label}</small><b>{formatNumber(before)}{after != null ? ` → ${formatNumber(after)}` : ''}</b></span>;
}

function EventCard({ event }: { event: BattleEventViewModel }) {
  return (
    <article className="battle-event-v1">
      <div className="battle-event-route-v1">
        <span><img src={event.actor.art} alt="" /><strong>{event.actor.name}{countSuffix(event.actorCount)}</strong></span>
        <i aria-hidden="true">→</i>
        <span><img src={event.target.art} alt="" /><strong>{event.target.name}{countSuffix(event.targetCount)}</strong></span>
      </div>
      <div className="battle-event-metrics-v1">
        {event.attackValue != null ? <span><small>АТАКА</small><b>{formatNumber(event.attackValue)}</b></span> : null}
        {event.damage != null ? <span><small>УРОН</small><b>{formatNumber(event.damage)}</b></span> : null}
        {event.destroyedCount != null ? <span><small>УНИЧТОЖЕНО</small><b>{formatNumber(event.destroyedCount)}</b></span> : null}
        <OptionalMetric label="ЩИТ" before={event.shieldBefore} after={event.shieldAfter} />
        <OptionalMetric label="БРОНЯ" before={event.armorBefore} after={event.armorAfter} />
        <OptionalMetric label="ЖИЗНЬ" before={event.lifeBefore} after={event.lifeAfter} />
      </div>
      {event.commanderAbility ? <div className="battle-event-ability-v1">◆ {event.commanderAbility}</div> : null}
      {event.note ? <p>{event.note}</p> : null}
    </article>
  );
}

function scrollTargetFor(details: HTMLDetailsElement, preferred?: ScrollRef) {
  if (preferred?.current) return preferred.current;
  return details.closest<HTMLElement>('.battle-report-modal-scroll-v1, .fleet-main-v1') ?? document.documentElement;
}

function RoundAnalysis({ round, scrollRef }: { round: BattleRoundViewModel; scrollRef?: ScrollRef }) {
  const savedScrollTop = useRef(0);
  const rememberScroll = (event: MouseEvent<HTMLDetailsElement>) => {
    savedScrollTop.current = scrollTargetFor(event.currentTarget, scrollRef).scrollTop;
  };
  const restoreScroll = (event: SyntheticEvent<HTMLDetailsElement>) => {
    const target = scrollTargetFor(event.currentTarget, scrollRef);
    requestAnimationFrame(() => { target.scrollTop = savedScrollTop.current; });
  };

  return (
    <details className="battle-round-analysis-v1" data-qa-battle-round-analysis={round.index} onClick={rememberScroll} onToggle={restoreScroll}>
      <summary>АНАЛИЗ РАУНДА <span>{round.events.length} СОБЫТИЙ</span></summary>
      {round.analysis.length ? (
        <ul>{round.analysis.map((line, index) => <li key={`${round.index}-${index}`}>{line}</li>)}</ul>
      ) : (
        <p>Анализ недоступен для этого demo-отчёта.</p>
      )}
    </details>
  );
}

function entityKindLabel(kind: BattleEntityKind) {
  if (kind === 'commander') return 'Командирский корабль';
  if (kind === 'defense') return 'Оборона';
  if (kind === 'ship') return 'Корабль';
  return BATTLE_MISSING_DATA;
}

function tooltipAriaLabel(stack: BattleStackViewModel) {
  return `${stack.name}, ${entityKindLabel(stack.kind)}, количество ${formatNumber(stack.tooltip.count)}`;
}

function SceneStack({ stack, side, roundIndex }: { stack: BattleStackViewModel; side: 'attacker' | 'defender'; roundIndex: number }) {
  const tooltipId = `battle-tooltip-${roundIndex}-${side}-${stack.key.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  const isDefense = stack.kind === 'defense';
  return (
    <button
      type="button"
      className={`battle-scene-stack-v1 ${side} ${isDefense ? 'defense' : ''}`}
      data-qa-battle-stack={stack.entityId}
      data-qa-battle-stack-kind={stack.kind}
      data-qa-battle-stack-count={stack.countAfter == null ? '' : stack.countAfter}
      aria-label={tooltipAriaLabel(stack)}
      aria-describedby={tooltipId}
      onClick={(event) => event.preventDefault()}
    >
      <span className="battle-scene-sprite-v1">
        <img src={stack.art} alt="" draggable={false} />
        <span className="battle-scene-count-v1">{formatNumber(stack.tooltip.count)}</span>
      </span>
      <span id={tooltipId} className="battle-scene-tooltip-v1" role="tooltip">
        <strong>{stack.tooltip.name}</strong>
        <span>{stack.tooltip.type}</span>
        {!isDefense ? <span>Уровень: <b>{formatNumber(stack.tooltip.level)}</b></span> : null}
        <span>Атака: <b>{formatNumber(stack.tooltip.attack)}</b></span>
        <span>Жизнь: <b>{formatNumber(stack.tooltip.life)}</b></span>
        <span>Броня: <b>{formatNumber(stack.tooltip.armor)}</b></span>
        <span>Количество: <b>{formatNumber(stack.tooltip.count)}</b></span>
      </span>
    </button>
  );
}

function isSceneVisible(stack: BattleStackViewModel) {
  return stack.countAfter == null || stack.countAfter > 0;
}

function visualReportAnchorId(viewModel: BattleReportViewModel) {
  return `battle-report-visual-${viewModel.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
}

function SceneSide({ stacks, side, roundIndex }: { stacks: BattleStackViewModel[]; side: 'attacker' | 'defender'; roundIndex: number }) {
  const visible = stacks.filter(isSceneVisible);
  const regular = visible.filter((stack) => stack.kind !== 'commander');
  const commanders = visible.filter((stack) => stack.kind === 'commander');
  return (
    <div className={`battle-scene-side-v1 ${side}`} aria-label={side === 'attacker' ? 'Корабли атакующего' : 'Корабли защитника'}>
      <div className="battle-scene-zone-v1">
        {regular.map((stack) => <SceneStack key={stack.key} stack={stack} side={side} roundIndex={roundIndex} />)}
        {!regular.length ? <span className="battle-scene-empty-v1">{BATTLE_MISSING_DATA}</span> : null}
      </div>
      {commanders.length ? (
        <div className="battle-scene-commander-zone-v1" aria-label="Командирские корабли">
          {commanders.map((stack) => <SceneStack key={stack.key} stack={stack} side={side} roundIndex={roundIndex} />)}
        </div>
      ) : null}
    </div>
  );
}

function BattleVisualReport({ viewModel, scrollRef }: { viewModel: BattleReportViewModel; scrollRef?: ScrollRef }) {
  return (
    <section id={visualReportAnchorId(viewModel)} className="battle-section-v1 battle-visual-report-v1" data-qa-battle-visual-report>
      <header className="battle-section-head-v1">
        <div><small>СТАТИЧНЫЙ ПРОСМОТР SNAPSHOT</small><h3>ВИЗУАЛЬНЫЙ БОЕВОЙ ДОКЛАД</h3></div>
        <span>CSS GRID · 100PX</span>
      </header>
      <div className="battle-scene-list-v1">
        {viewModel.rounds.length ? viewModel.rounds.map((round) => {
          const attackerStacks = round.attackerSnapshot?.stacks ?? [];
          const defenderStacks = round.defenderSnapshot?.stacks ?? [];
          const defenses = round.defenderSnapshot?.defenses ?? [];
          return (
            <article className="battle-round-report-v1" key={`${viewModel.id}-${round.index}`} data-qa-battle-round={round.index}>
              <div className="battle-round-report-head-v1"><strong>РАУНД {round.index} / {viewModel.roundCount}</strong><span>{round.attackerSnapshot && round.defenderSnapshot ? 'SNAPSHOT СОХРАНЁН' : 'SNAPSHOT НЕДОСТУПЕН'}</span></div>
              <div
                className="battle-scene-v1"
                data-qa-battle-scene={round.index}
                data-qa-battle-cell-size="100px"
                style={{
                  '--battle-background-image': `url("${battleBackground}")`,
                  '--battle-fleet-rows': round.fleetRows,
                } as CSSProperties}
              >
                <div className="battle-scene-fleet-field-v1">
                  <div className="battle-scene-side-label-v1 attacker"><span>АТАКУЮЩИЙ</span><strong>{participantLabel(viewModel.attacker.participant)}</strong></div>
                  <div className="battle-scene-side-label-v1 defender"><span>ЗАЩИТНИК</span><strong>{participantLabel(viewModel.defender.participant)}</strong></div>
                  <div className="battle-scene-fleet-grid-v1">
                    <SceneSide stacks={attackerStacks} side="attacker" roundIndex={round.index} />
                    <SceneSide stacks={defenderStacks} side="defender" roundIndex={round.index} />
                  </div>
                </div>
                <div className="battle-scene-planet-deck-v1">
                  <div className="battle-scene-defense-zone-v1" aria-label="Оборона защитника">
                    {defenses.filter(isSceneVisible).map((stack) => <SceneStack key={stack.key} stack={stack} side="defender" roundIndex={round.index} />)}
                    {!defenses.some(isSceneVisible) ? <span className="battle-scene-empty-v1">ОБОРОНА НЕ ЗАФИКСИРОВАНА</span> : null}
                  </div>
                </div>
              </div>
              <RoundAnalysis round={round} scrollRef={scrollRef} />
            </article>
          );
        }) : <p className="battle-empty-inline-v1">Сохранённые snapshots раундов отсутствуют.</p>}
      </div>
    </section>
  );
}

function BattleOutcome({ viewModel }: { viewModel: BattleReportViewModel }) {
  return (
    <section className="battle-section-v1 battle-outcome-v1" data-qa-battle-outcome>
      <header className="battle-section-head-v1"><div><small>ИТОГ БОЯ</small><h3>ФИНАЛЬНЫЕ ОСТАТКИ И НАГРАДЫ</h3></div></header>
      <div className="battle-outcome-survivors-v1">
        <div><small>АТАКУЮЩИЙ · ФЛОТ</small><strong>{formatNumber(viewModel.attacker.remainingShips)}</strong><span>Население: {formatNumber(viewModel.attacker.populationAfter)}</span></div>
        <div><small>ЗАЩИТНИК · ФЛОТ</small><strong>{formatNumber(viewModel.defender.remainingShips)}</strong><span>Население: {formatNumber(viewModel.defender.populationAfter)}</span></div>
        <div><small>ЗАЩИТНИК · ОБОРОНА</small><strong>{formatNumber(viewModel.defender.remainingDefenses)}</strong><span>Остаток сооружений</span></div>
      </div>
      <div className="battle-outcome-metrics-v1">
        {viewModel.experience != null ? <span><small>БОЕВОЙ ОПЫТ</small><strong>{formatNumber(viewModel.experience)}</strong></span> : null}
        {viewModel.debris != null ? <span className="battle-outcome-resource" data-qa-resource-kind="debris"><span className="battle-outcome-resource-icon"><ResourceIcon kind="debris" /></span><small>ОБЛОМКИ</small><strong>{formatNumber(viewModel.debris)}</strong></span> : null}
        {viewModel.resources.map((resource) => <span className="battle-outcome-resource" key={resource.kind} data-qa-resource-kind={resource.kind}><span className="battle-outcome-resource-icon"><ResourceIcon kind={resource.kind} /></span><small>{resource.label.toUpperCase()}</small><strong>{formatNumber(resource.value)}</strong></span>)}
      </div>
      {viewModel.experience == null && viewModel.debris == null && !viewModel.resources.length ? <p className="battle-empty-inline-v1">Награды и ресурсы не зафиксированы в этом отчёте.</p> : null}
    </section>
  );
}

export function BattleReportDetailBody({
  report,
  viewModel: providedViewModel,
  scrollRef,
}: {
  report: BattleReport;
  viewModel?: BattleReportViewModel;
  scrollRef?: ScrollRef;
}) {
  const viewModel = providedViewModel ?? createBattleReportViewModel(report);
  return (
    <>
      <PopulationPanel viewModel={viewModel} />
      <a className="battle-visual-anchor-v1" data-qa-battle-visual-anchor href={`#${visualReportAnchorId(viewModel)}`}>ВИЗУАЛЬНЫЙ БОЕВОЙ ДОКЛАД</a>
      <BattleVisualReport viewModel={viewModel} scrollRef={scrollRef} />
      <BattleComposition viewModel={viewModel} />
      <CommanderSnapshot viewModel={viewModel} />
      <BattleOutcome viewModel={viewModel} />
    </>
  );
}

const FOCUSABLE_SELECTOR = 'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex]:not([tabindex="-1"])';

function BattleReportModal({
  report,
  viewModel,
  saved,
  onToggleSaved,
  onClose,
}: {
  report: BattleReport;
  viewModel: BattleReportViewModel;
  saved: boolean;
  onToggleSaved: () => void;
  onClose: () => void;
}) {
  const modalRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const titleId = `battle-report-modal-title-${viewModel.id}`;

  useEffect(() => {
    const previousActiveElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    const stage = document.querySelector<HTMLElement>('.stage');
    const wasInert = stage?.inert ?? false;
    if (stage) stage.inert = true;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !modalRef.current) return;
      const focusable = Array.from(modalRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);

    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      if (stage) stage.inert = wasInert;
      document.body.style.overflow = previousOverflow;
      if (previousActiveElement?.isConnected) previousActiveElement.focus();
    };
  }, [onClose]);

  return createPortal(
    <div
      className="battle-report-overlay-v1"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section ref={modalRef} className="battle-report-modal-v1" role="dialog" aria-modal="true" aria-labelledby={titleId} data-qa-battle-report-modal={viewModel.id}>
        <header className="battle-report-modal-head-v1">
          <div>
            <small>БОЕВОЙ ОТЧЁТ · {missionLabel(viewModel.missionType)}</small>
            <h2 id={titleId}>{resultLabel(viewModel).label}</h2>
            <p><time dateTime={viewModel.timestamp}>{formatBattleDate(viewModel.timestamp)}</time> · {participantLabel(viewModel.attacker.participant)} → {participantLabel(viewModel.defender.participant)}</p>
          </div>
          <div className="battle-report-modal-actions-v1">
            <SaveButton saved={saved} onToggle={onToggleSaved} reportId={viewModel.id} />
            <button ref={closeRef} type="button" className="battle-report-modal-close-v1" onClick={onClose} aria-label="Закрыть боевой отчёт">×</button>
          </div>
        </header>
        <div ref={scrollRef} className="battle-report-modal-scroll-v1">
          <BattleReportDetailBody report={report} viewModel={viewModel} scrollRef={scrollRef} />
          <button type="button" className="battle-list-back-v1 battle-modal-back-v1" onClick={onClose}>← К СПИСКУ БИТВ</button>
        </div>
      </section>
    </div>,
    document.body,
  );
}

export function BattleReportsView({ planetName, coords, onBack }: { planetName: string; coords: string; onBack: () => void }) {
  const [history, setHistory] = useState<BattleHistoryState>(() => readBattleHistory());
  const [mode, setMode] = useState<BattleListMode>('recent');
  const [openReportId, setOpenReportId] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<SaveNotice>({ kind: 'saved', message: '✓ Автосохранение активно' });
  const closeReport = useCallback(() => setOpenReportId(null), []);

  useEffect(() => {
    const sync = () => setHistory(readBattleHistory());
    window.addEventListener(BATTLE_HISTORY_CHANGED_EVENT, sync);
    return () => window.removeEventListener(BATTLE_HISTORY_CHANGED_EVENT, sync);
  }, []);

  const viewModels = useMemo(
    () => new Map(history.reports.map((report) => [report.id, createBattleReportViewModel(report)])),
    [history.reports],
  );
  const visibleReports = useMemo(
    () => filterBattleReports(history.reports, history.savedReportIds, mode)
      .map((report) => viewModels.get(report.id))
      .filter((viewModel): viewModel is BattleReportViewModel => Boolean(viewModel)),
    [history, mode, viewModels],
  );
  const openReport = openReportId ? history.reports.find((report) => report.id === openReportId) ?? null : null;
  const openViewModel = openReport ? viewModels.get(openReport.id) ?? null : null;

  const toggleSaved = (reportId: string) => {
    const currentlySaved = history.savedReportIds.includes(reportId);
    const next = setBattleReportSaved(history, reportId, !currentlySaved);
    const result = persistBattleHistory(next);
    setHistory(result.value);
    setSaveNotice(result.ok
      ? { kind: 'saved', message: '✓ Сохранено' }
      : { kind: 'error', message: `⚠ ${result.error}` });
  };

  return (
    <section className="battle-view-v1 fleet-page-shell-v1">
      <header className="battle-page-head-v1 fleet-page-head-v1">
        <div><small>УПРАВЛЕНИЕ ФЛОТОМ · {planetName} {coords}</small><h2>БИТВЫ</h2><p>Боевые отчёты флота</p></div>
        <div className="battle-page-actions-v1 fleet-page-actions-v1"><span className={`battle-save-notice-v1 ${saveNotice.kind}`} role="status" aria-live="polite">{saveNotice.message}</span><button type="button" className="battle-back-v1 fleet-page-back-v1" onClick={onBack}>← К ФЛОТАМ</button></div>
      </header>

      <div className="battle-tabs-v1" role="tablist" aria-label="Фильтр боевых отчётов">
        <button type="button" role="tab" aria-selected={mode === 'recent'} className={mode === 'recent' ? 'active' : ''} onClick={() => setMode('recent')}>ПОСЛЕДНИЕ <b>{history.reports.length}</b></button>
        <button type="button" role="tab" aria-selected={mode === 'saved'} className={mode === 'saved' ? 'active' : ''} onClick={() => setMode('saved')}>СОХРАНЁННЫЕ <b>{history.savedReportIds.length}</b></button>
      </div>

      <div className="battle-list-v1">
        {visibleReports.length ? visibleReports.map((viewModel) => (
          <BattleCard
            key={viewModel.id}
            viewModel={viewModel}
            saved={history.savedReportIds.includes(viewModel.id)}
            onToggleSaved={() => toggleSaved(viewModel.id)}
            onOpen={() => setOpenReportId(viewModel.id)}
          />
        )) : (
          <div className="battle-empty-v1"><span>◇</span><strong>{mode === 'recent' ? 'Боевых отчётов пока нет.' : 'Нет сохранённых боевых отчётов.'}</strong><p>{mode === 'saved' ? 'Отметь нужный отчёт звездой во вкладке «Последние».' : 'Новые результаты появятся здесь после появления настоящего боевого pipeline.'}</p></div>
        )}
      </div>

      {openReport && openViewModel ? (
        <BattleReportModal
          report={openReport}
          viewModel={openViewModel}
          saved={history.savedReportIds.includes(openReport.id)}
          onToggleSaved={() => toggleSaved(openReport.id)}
          onClose={closeReport}
        />
      ) : null}
    </section>
  );
}
