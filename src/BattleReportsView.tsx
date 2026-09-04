import { useMemo, useState } from 'react';

import { COMMANDER_ABILITIES } from './domain/combat/commanders.ts';
import { getCombatEntity } from './domain/combat/catalog.ts';
import {
  persistBattleHistory,
  readBattleHistory,
  setBattleReportSaved,
  type BattleHistoryState,
} from './domain/combat/battle-repository.ts';
import {
  calculatePopulationLoss,
  createBattleSummary,
  filterBattleReports,
  getBattleResultForPlayer,
  type BattleListMode,
  type BattleReport,
  type BattleStackSnapshot,
  type CombatEvent,
} from './domain/combat/report.ts';
import './battle-reports.css';

const LOCAL_PLAYER_ID = 'player-aster';

type SaveNotice = { kind: 'saved' | 'error'; message: string };

function formatNumber(value: number) {
  return new Intl.NumberFormat('ru-RU').format(value);
}

function formatBattleDate(timestamp: string, withYear = true) {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    ...(withYear ? { year: 'numeric' as const } : {}),
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

function participantLabel(report: BattleReport, side: 'attacker' | 'defender') {
  const participant = side === 'attacker' ? report.attacker : report.defender;
  const title = participant.planetName ?? participant.playerName;
  return `${title}${participant.coordinates ? ` ${participant.coordinates}` : ''}`;
}

function resultLabel(report: BattleReport) {
  const result = getBattleResultForPlayer(report, LOCAL_PLAYER_ID);
  if (result === 'draw') return { label: 'НИЧЬЯ', tone: 'draw' } as const;
  if (result === 'victory') return { label: 'ПОБЕДА', tone: 'victory' } as const;
  if (result === 'defeat') return { label: 'ПОРАЖЕНИЕ', tone: 'defeat' } as const;
  return report.winner === 'attacker'
    ? { label: 'ПОБЕДА АТАКУЮЩЕГО', tone: 'victory' } as const
    : { label: 'ПОБЕДА ЗАЩИТНИКА', tone: 'defeat' } as const;
}

function winnerSummary(report: BattleReport) {
  if (report.winner === 'draw') return 'НИЧЬЯ';
  return report.winner === 'attacker' ? 'ПОБЕДА АТАКУЮЩЕГО' : 'ПОБЕДА ЗАЩИТНИКА';
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

function BattleCard({
  report,
  saved,
  onToggleSaved,
  onOpen,
}: {
  report: BattleReport;
  saved: boolean;
  onToggleSaved: () => void;
  onOpen: () => void;
}) {
  const summary = createBattleSummary(report, saved ? [report.id] : []);
  const result = resultLabel(report);
  return (
    <article className="battle-card-v1">
      <header className="battle-card-head-v1">
        <strong className={`battle-result-v1 ${result.tone}`}>{result.label}</strong>
        <time dateTime={report.timestamp}>{formatBattleDate(report.timestamp)}</time>
      </header>

      <div className="battle-route-v1">
        <strong>{participantLabel(report, 'attacker')}</strong>
        <span aria-hidden="true">→</span>
        <strong>{participantLabel(report, 'defender')}</strong>
      </div>

      <div className="battle-card-sides-v1">
        <div>
          <small>АТАКУЮЩИЙ</small>
          <span><b>{formatNumber(summary.attackerPopulationBefore)}</b> населения</span>
          <span>Осталось <b>{formatNumber(summary.attackerPopulationAfter)}</b></span>
        </div>
        <div>
          <small>ЗАЩИТНИК</small>
          <span><b>{formatNumber(summary.defenderPopulationBefore)}</b> населения</span>
          <span>Осталось <b>{formatNumber(summary.defenderPopulationAfter)}</b></span>
        </div>
      </div>

      <footer className="battle-card-footer-v1">
        <span>Раундов: <b>{summary.rounds}</b></span>
        <div>
          <SaveButton saved={saved} onToggle={onToggleSaved} reportId={report.id} />
          <button type="button" className="battle-open-v1" onClick={onOpen}>ОТКРЫТЬ ОТЧЁТ</button>
        </div>
      </footer>
    </article>
  );
}

function PopulationPanel({ report }: { report: BattleReport }) {
  const attackerLoss = calculatePopulationLoss(report.attackerForce.populationBefore, report.attackerForce.populationAfter);
  const defenderLoss = calculatePopulationLoss(report.defenderForce.populationBefore, report.defenderForce.populationAfter);
  return (
    <section className="battle-summary-v1">
      <header><small>РЕЗУЛЬТАТ БОЯ</small><h3>{winnerSummary(report)}</h3><span>{report.roundCount} РАУНДОВ</span></header>
      <div className="battle-summary-grid-v1">
        <div>
          <strong>АТАКУЮЩИЙ</strong>
          <dl>
            <div><dt>Было</dt><dd>{formatNumber(report.attackerForce.populationBefore)}</dd></div>
            <div><dt>Осталось</dt><dd>{formatNumber(report.attackerForce.populationAfter)}</dd></div>
            <div><dt>Потери</dt><dd>{formatNumber(attackerLoss)}</dd></div>
          </dl>
        </div>
        <div>
          <strong>ЗАЩИТНИК</strong>
          <dl>
            <div><dt>Было</dt><dd>{formatNumber(report.defenderForce.populationBefore)}</dd></div>
            <div><dt>Осталось</dt><dd>{formatNumber(report.defenderForce.populationAfter)}</dd></div>
            <div><dt>Потери</dt><dd>{formatNumber(defenderLoss)}</dd></div>
          </dl>
        </div>
      </div>
    </section>
  );
}

function StackRow({ stack }: { stack: BattleStackSnapshot }) {
  const entity = getCombatEntity(stack.entityId);
  return (
    <div className="battle-stack-row-v1">
      <span className="battle-stack-art-v1"><img src={entity.art} alt="" draggable={false} /></span>
      <span className="battle-stack-name-v1"><strong>{entity.name}</strong><small>{entity.category}</small></span>
      <span><small>БЫЛО</small><b>{formatNumber(stack.countBefore)}</b></span>
      <span><small>ОСТАЛОСЬ</small><b>{formatNumber(stack.countAfter)}</b></span>
      <span><small>УНИЧТОЖЕНО</small><b>{formatNumber(stack.destroyed)}</b></span>
    </div>
  );
}

function BattleComposition({ report }: { report: BattleReport }) {
  return (
    <section className="battle-section-v1">
      <header className="battle-section-head-v1"><div><small>СОСТАВ БОЯ</small><h3>ДО / ПОСЛЕ</h3></div></header>
      <div className="battle-composition-grid-v1">
        <section>
          <h4>АТАКУЮЩИЙ</h4>
          <div className="battle-stack-list-v1">{report.attackerForce.stacks.map((stack) => <StackRow key={`a-${stack.entityId}`} stack={stack} />)}</div>
        </section>
        <section>
          <h4>ЗАЩИТНИК</h4>
          <div className="battle-stack-list-v1">{report.defenderForce.stacks.map((stack) => <StackRow key={`d-${stack.entityId}`} stack={stack} />)}</div>
          {(report.defenderForce.defenses?.length ?? 0) > 0 ? (
            <div className="battle-defense-v1">
              <h4>ОБОРОНА</h4>
              <div className="battle-stack-list-v1">{report.defenderForce.defenses?.map((stack) => <StackRow key={`def-${stack.entityId}`} stack={stack} />)}</div>
            </div>
          ) : null}
        </section>
      </div>
    </section>
  );
}

function CommanderSnapshot({ report }: { report: BattleReport }) {
  const rows = [
    report.attackerForce.activeCommanderId ? { side: 'АТАКУЮЩИЙ', id: report.attackerForce.activeCommanderId } : null,
    report.defenderForce.activeCommanderId ? { side: 'ЗАЩИТНИК', id: report.defenderForce.activeCommanderId } : null,
  ].filter(Boolean) as Array<{ side: string; id: NonNullable<typeof report.attackerForce.activeCommanderId> }>;
  if (!rows.length) return null;

  return (
    <section className="battle-section-v1">
      <header className="battle-section-head-v1"><div><small>КОМАНДИРСКИЙ SNAPSHOT</small><h3>ВЕДУЩИЙ КОМАНДИР</h3></div></header>
      <div className="battle-commanders-v1">
        {rows.map(({ side, id }) => {
          const entity = getCombatEntity(id);
          const ability = COMMANDER_ABILITIES[id];
          return (
            <article key={`${side}-${id}`}>
              <img src={entity.art} alt="" draggable={false} />
              <div><small>{side}</small><strong>{entity.name}</strong><span>Способность: {ability.ability}</span><em>Эффект не пересчитывается в отчёте.</em></div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function OptionalMetric({ label, before, after }: { label: string; before?: number; after?: number }) {
  if (before == null && after == null) return null;
  return <span><small>{label}</small><b>{before != null ? formatNumber(before) : '—'}{after != null ? ` → ${formatNumber(after)}` : ''}</b></span>;
}

function EventCard({ event }: { event: CombatEvent }) {
  const actor = getCombatEntity(event.actorEntityId);
  const target = getCombatEntity(event.targetEntityId);
  return (
    <article className="battle-event-v1">
      <div className="battle-event-route-v1">
        <span><img src={actor.art} alt="" /><strong>{actor.name}{event.actorCount != null ? ` × ${formatNumber(event.actorCount)}` : ''}</strong></span>
        <i aria-hidden="true">→</i>
        <span><img src={target.art} alt="" /><strong>{target.name}{event.targetCount != null ? ` × ${formatNumber(event.targetCount)}` : ''}</strong></span>
      </div>
      <div className="battle-event-metrics-v1">
        {event.attackValue != null ? <span><small>АТАКА</small><b>{formatNumber(event.attackValue)}</b></span> : null}
        {event.damage != null ? <span><small>УРОН</small><b>{formatNumber(event.damage)}</b></span> : null}
        {event.destroyedCount != null ? <span><small>УНИЧТОЖЕНО</small><b>{formatNumber(event.destroyedCount)}</b></span> : null}
        <OptionalMetric label="ЩИТ" before={event.shieldBefore} after={event.shieldAfter} />
        <OptionalMetric label="БРОНЯ" before={event.armorBefore} after={event.armorAfter} />
        <OptionalMetric label="ЖИЗНЬ" before={event.lifeBefore} after={event.lifeAfter} />
      </div>
      {event.commanderAbilityId ? <div className="battle-event-ability-v1">◆ {COMMANDER_ABILITIES[event.commanderAbilityId].ability}</div> : null}
      {event.note ? <p>{event.note}</p> : null}
    </article>
  );
}

function RoundLog({
  report,
  openRounds,
  onToggle,
}: {
  report: BattleReport;
  openRounds: Set<number>;
  onToggle: (round: number) => void;
}) {
  return (
    <section className="battle-section-v1 battle-rounds-v1">
      <header className="battle-section-head-v1"><div><small>ХОД БОЯ</small><h3>РАУНДОВЫЙ ЛОГ</h3></div><span>{report.roundCount} РАУНДОВ</span></header>
      <div className="battle-round-list-v1">
        {report.rounds.map((round) => {
          const open = openRounds.has(round.index);
          return (
            <section key={round.index} className={`battle-round-v1 ${open ? 'open' : ''}`}>
              <button
                type="button"
                aria-expanded={open}
                aria-controls={`battle-round-${report.id}-${round.index}`}
                onClick={() => onToggle(round.index)}
              >
                <span><small>РАУНД</small><strong>{String(round.index).padStart(2, '0')}</strong></span>
                <em>{round.events.length} СОБЫТИЙ</em>
                <b aria-hidden="true">{open ? '−' : '+'}</b>
              </button>
              {open ? (
                <div id={`battle-round-${report.id}-${round.index}`} className="battle-round-body-v1">
                  {round.events.length ? round.events.map((event) => <EventCard key={`${round.index}-${event.sequence}`} event={event} />) : <p>В этом раунде нет зафиксированных событий.</p>}
                </div>
              ) : null}
            </section>
          );
        })}
      </div>
    </section>
  );
}

function BattleOutcome({ report }: { report: BattleReport }) {
  const resourceEntries = report.resources
    ? ([['Металл', report.resources.metal], ['Минералы', report.resources.minerals], ['Газ', report.resources.gas]] as const).filter(([, value]) => value != null)
    : [];
  if (report.experience == null && report.debris == null && !resourceEntries.length) return null;
  return (
    <section className="battle-section-v1 battle-outcome-v1">
      <header className="battle-section-head-v1"><div><small>ИТОГ</small><h3>РЕЗУЛЬТАТЫ ОПЕРАЦИИ</h3></div></header>
      <div>
        {report.experience != null ? <span><small>БОЕВОЙ ОПЫТ</small><strong>{formatNumber(report.experience)}</strong></span> : null}
        {report.debris != null ? <span><small>ОБЛОМКИ</small><strong>{formatNumber(report.debris)}</strong></span> : null}
        {resourceEntries.map(([label, value]) => <span key={label}><small>{label.toUpperCase()}</small><strong>{formatNumber(value!)}</strong></span>)}
      </div>
    </section>
  );
}

export function BattleReportsView({
  planetName,
  coords,
  onBack,
}: {
  planetName: string;
  coords: string;
  onBack: () => void;
}) {
  const [history, setHistory] = useState<BattleHistoryState>(() => readBattleHistory());
  const [mode, setMode] = useState<BattleListMode>('recent');
  const [openReportId, setOpenReportId] = useState<string | null>(null);
  const [openRounds, setOpenRounds] = useState<Set<number>>(new Set());
  const [saveNotice, setSaveNotice] = useState<SaveNotice>({ kind: 'saved', message: '✓ Автосохранение активно' });

  const visibleReports = useMemo(
    () => filterBattleReports(history.reports, history.savedReportIds, mode),
    [history, mode],
  );
  const openReport = openReportId ? history.reports.find((report) => report.id === openReportId) ?? null : null;

  const toggleSaved = (reportId: string) => {
    const currentlySaved = history.savedReportIds.includes(reportId);
    const next = setBattleReportSaved(history, reportId, !currentlySaved);
    const result = persistBattleHistory(next);
    setHistory(result.value);
    setSaveNotice(result.ok
      ? { kind: 'saved', message: '✓ Сохранено' }
      : { kind: 'error', message: `⚠ ${result.error}` });
  };

  const openReportDetails = (reportId: string) => {
    const report = history.reports.find((item) => item.id === reportId);
    setOpenReportId(reportId);
    setOpenRounds(new Set(report?.rounds[0] ? [report.rounds[0].index] : []));
  };

  const closeReportDetails = () => {
    setOpenReportId(null);
    setOpenRounds(new Set());
  };

  const toggleRound = (roundIndex: number) => {
    setOpenRounds((current) => {
      const next = new Set(current);
      if (next.has(roundIndex)) next.delete(roundIndex);
      else next.add(roundIndex);
      return next;
    });
  };

  if (openReport) {
    const saved = history.savedReportIds.includes(openReport.id);
    return (
      <section className="battle-view-v1 battle-report-detail-v1">
        <header className="battle-page-head-v1">
          <div>
            <small>БОЕВОЙ ОТЧЁТ · {planetName} {coords}</small>
            <h2>БОЕВОЙ ОТЧЁТ</h2>
            <p><time dateTime={openReport.timestamp}>{formatBattleDate(openReport.timestamp)}</time> · {participantLabel(openReport, 'attacker')} → {participantLabel(openReport, 'defender')}</p>
          </div>
          <div className="battle-page-actions-v1">
            <button type="button" className="battle-list-back-v1" onClick={closeReportDetails}>← К СПИСКУ БИТВ</button>
            <SaveButton saved={saved} onToggle={() => toggleSaved(openReport.id)} reportId={openReport.id} />
          </div>
        </header>
        <div className={`battle-save-notice-v1 ${saveNotice.kind}`} role="status" aria-live="polite">{saveNotice.message}</div>
        <PopulationPanel report={openReport} />
        <BattleComposition report={openReport} />
        <CommanderSnapshot report={openReport} />
        <RoundLog report={openReport} openRounds={openRounds} onToggle={toggleRound} />
        <BattleOutcome report={openReport} />
      </section>
    );
  }

  return (
    <section className="battle-view-v1">
      <header className="battle-page-head-v1">
        <div><small>УПРАВЛЕНИЕ ФЛОТОМ · {planetName} {coords}</small><h2>БИТВЫ</h2><p>Боевые отчёты флота</p></div>
        <div className="battle-page-actions-v1"><span className={`battle-save-notice-v1 ${saveNotice.kind}`} role="status" aria-live="polite">{saveNotice.message}</span><button type="button" className="battle-back-v1" onClick={onBack}>← К ФЛОТАМ</button></div>
      </header>

      <div className="battle-tabs-v1" role="tablist" aria-label="Фильтр боевых отчётов">
        <button type="button" role="tab" aria-selected={mode === 'recent'} className={mode === 'recent' ? 'active' : ''} onClick={() => setMode('recent')}>ПОСЛЕДНИЕ <b>{history.reports.length}</b></button>
        <button type="button" role="tab" aria-selected={mode === 'saved'} className={mode === 'saved' ? 'active' : ''} onClick={() => setMode('saved')}>СОХРАНЁННЫЕ <b>{history.savedReportIds.length}</b></button>
      </div>

      <div className="battle-list-v1">
        {visibleReports.length ? visibleReports.map((report) => (
          <BattleCard
            key={report.id}
            report={report}
            saved={history.savedReportIds.includes(report.id)}
            onToggleSaved={() => toggleSaved(report.id)}
            onOpen={() => openReportDetails(report.id)}
          />
        )) : (
          <div className="battle-empty-v1"><span>◇</span><strong>{mode === 'recent' ? 'Боевых отчётов пока нет.' : 'Нет сохранённых боевых отчётов.'}</strong><p>{mode === 'saved' ? 'Отметь нужный отчёт звездой во вкладке «Последние».' : 'Новые результаты появятся здесь после появления настоящего боевого pipeline.'}</p></div>
        )}
      </div>
    </section>
  );
}
