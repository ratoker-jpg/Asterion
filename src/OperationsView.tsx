import { useEffect, useMemo, useState } from 'react';

import { OPERATION_MODIFIER_LABELS, OPERATION_SOURCE_LABELS } from './domain/operations/catalog.ts';
import type {
  OperationCategory,
  OperationId,
  OperationInstance,
  OperationLocation,
  OperationState,
  OperationThreatTier,
  OperationsState,
} from './domain/operations/types.ts';
import { ResourceIcon } from './ui/resources/ResourceIcon';
import type { ResourceIconKind } from './ui/resources/resource-assets.ts';
import type { PirateContactPresentation } from './pirate-ui.ts';
import { isPirateOperationId, pirateContactOperation, pirateCycleOperation, pirateOperationId } from './application/pirate-presentation.ts';
import { getUniverseSlotPoint } from './domain/universe/runtime.ts';
import { PIRATE_CONTACT_QUIET_MS } from './domain/pirates/contact-schedule.ts';
import { getPiratePlanetArt } from './pirate-planet-art.ts';
import './operations.css';

type OperationsViewProps = {
  state: OperationsState;
  onAccept: (operationId: OperationId) => void;
  onCancel: (operationId: OperationId) => void;
  onReveal: (operationId: OperationId) => void;
  onOpenFleets: () => void;
  pirateContacts?: readonly PirateContactPresentation[];
  quietPirateSystems?: readonly QuietPirateCycle[];
  pirateCycleTimers?: readonly PirateCycleTimer[];
  completedPirateOperations?: readonly CompletedPirateOperation[];
  onPirateBattleReport?: (reportId: string) => void;
  onPirateAccept?: (contact: PirateContactPresentation) => void;
  onPirateCancel?: (contact: PirateContactPresentation) => void;
  nowMs?: number;
  onPirateRecon?: (contact: PirateContactPresentation) => void;
  onPirateAttack?: (contact: PirateContactPresentation) => void;
  onPirateReport?: (reportId: string) => void;
  onPirateUniverse?: (contact: PirateContactPresentation) => void;
};

type OperationsTab = Extract<OperationState, 'available' | 'active' | 'completed'>;
type QuietPirateCycle = { galaxy: number; system: number; nextEligibleAt: number; contactCycleKey: string; coordinate: PirateContactPresentation['coordinate'] };
type PirateCycleTimer = { galaxy: number; system: number; active: boolean; quietStartsAt: number; nextRollAt: number; cycleIndex: number };
type CompletedPirateOperation = { cycleKey: string; coordinate: PirateContactPresentation['coordinate']; reportId: string; defeatedAt: number; rounds: number; debris: number };
type OperationRow = { operation: OperationInstance; contact?: PirateContactPresentation; quiet?: QuietPirateCycle; completed?: CompletedPirateOperation; battleReportId?: string };

const TAB_LABELS: Record<OperationsTab, string> = {
  available: 'ДОСТУПНЫЕ',
  active: 'АКТИВНЫЕ',
  completed: 'ЗАВЕРШЁННЫЕ',
};

const CATEGORY_LABELS: Record<OperationCategory, string> = {
  combat: 'БОЕВАЯ ОПЕРАЦИЯ',
  discovery: 'НЕИЗВЕСТНЫЙ КОНТАКТ',
  exploration: 'ИССЛЕДОВАНИЕ',
  science: 'НАУЧНАЯ ОПЕРАЦИЯ',
};

const ROMAN_THREAT: Record<OperationThreatTier, string> = {
  1: 'I',
  2: 'II',
  3: 'III',
  4: 'IV',
  5: 'V',
  6: 'VI',
};

const number = new Intl.NumberFormat('ru-RU');

function formatLocation(location: OperationLocation) {
  if (location.kind === 'system') return `Галактика ${location.galaxy} · Система ${String(location.system).padStart(2, '0')}`;
  if (location.kind === 'coordinates') return location.coordinates;
  return location.label;
}

function formatLocationClass(location: OperationLocation) {
  if (location.kind === 'system') return 'Системный контакт';
  if (location.kind === 'coordinates') return 'Координатный контакт';
  return location.label;
}

function threatText(operation: OperationInstance) {
  const prefix = operation.category === 'combat' ? 'УГРОЗА' : 'РИСК';
  if (operation.threat) return `${prefix} ${ROMAN_THREAT[operation.threat]}`;
  if (operation.threatRange) return `${prefix} ${ROMAN_THREAT[operation.threatRange[0]]}–${ROMAN_THREAT[operation.threatRange[1]]}`;
  return `${prefix} НЕИЗВЕСТЕН`;
}

function threatTier(operation: OperationInstance) {
  if (operation.threat) return ROMAN_THREAT[operation.threat];
  return '?';
}

function IntelPips({ level }: { level: OperationInstance['intel'] }) {
  return (
    <span className="operations-intel-pips-v2" aria-label={`Разведданные ${level} из 3`}>
      {[1, 2, 3].map((step) => <i key={step} className={step <= level ? 'filled' : ''} />)}
    </span>
  );
}

function OperationGlyph({ category }: { category: OperationCategory }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  if (category === 'combat') return <svg viewBox="0 0 40 40" aria-hidden="true"><circle {...common} cx="20" cy="20" r="12"/><circle {...common} cx="20" cy="20" r="4"/><path {...common} d="M20 4v8M20 28v8M4 20h8M28 20h8"/></svg>;
  if (category === 'science') return <svg viewBox="0 0 40 40" aria-hidden="true"><path {...common} d="M16 5h8M17 5v10L9 31c-1 2 .1 4 3 4h16c2.9 0 4-2 3-4l-8-16V5"/><path {...common} d="M13 27h14M16 21h8"/></svg>;
  if (category === 'exploration') return <svg viewBox="0 0 40 40" aria-hidden="true"><path {...common} d="m20 5 8 25-8-6-8 6 8-25Z"/><circle {...common} cx="20" cy="19" r="3"/></svg>;
  return <svg viewBox="0 0 40 40" aria-hidden="true"><path {...common} d="M7 30c4-8 10-12 18-12M11 34c3-6 7-9 14-9M25 18c4 0 7 3 7 7"/><circle {...common} cx="27" cy="12" r="4"/><path {...common} d="M27 4v4M35 12h-4"/></svg>;
}

function rewardEntries(operation: OperationInstance) {
  return [
    ['МЕТАЛЛ', operation.rewardPreview.metal, 'metal'],
    ['МИНЕРАЛЫ', operation.rewardPreview.minerals, 'minerals'],
    ['ГАЗ', operation.rewardPreview.gas, 'gas'],
  ].filter((entry): entry is [string, number, ResourceIconKind] => typeof entry[1] === 'number');
}

function RewardPreview({ operation, compact = false }: { operation: OperationInstance; compact?: boolean }) {
  const entries = rewardEntries(operation);
  if (!entries.length && !operation.rewardPreview.labels?.length) {
    return <span className="operations-reward-unknown-v2">НАГРАДА НЕИЗВЕСТНА</span>;
  }

  return (
    <div className={compact ? 'operations-reward-compact-v2' : 'operations-reward-v2'}>
      {entries.map(([label, value, glyph]) => (
        <span key={label}>
          <i><ResourceIcon kind={glyph} /></i>
          {!compact ? <small>{label}</small> : null}
          <strong>{number.format(value)}</strong>
        </span>
      ))}
      {!compact ? operation.rewardPreview.labels?.map((label) => <em key={label}>{label}</em>) : null}
    </div>
  );
}

function TacticalScope({ operation, contact }: { operation: OperationInstance; contact?: PirateContactPresentation }) {
  // Project the exact same orbital slot as UniverseView into the sensor SVG.
  // Both screens share getUniverseSlotPoint; no independent slot-angle formula.
  const slot = contact?.coordinate.position ?? 1;
  const universePoint = getUniverseSlotPoint(slot);
  const markerX = 240 + (universePoint.x - 50) * 4.8;
  const markerY = 120 + (universePoint.y - 52) * 2.4;
  const unknown = operation.intel === 0;
  const isCombat = operation.category === 'combat' && !isPirateOperationId(operation.id);
  const isScience = operation.category === 'science';
  const isDerelict = operation.category === 'exploration';

  return (
    <div className={`operations-scope-v2 operations-scope-v2--${operation.category} ${unknown ? 'is-unknown' : ''}`}>
      <svg viewBox="0 0 480 240" aria-hidden="true">
        <path className="scope-grid" d="M20 120h440M240 16v208M84 45l312 150M84 195 396 45" />
        {contact ? (
          <>
            <ellipse className="scope-ring ring-inner" cx="240" cy="120" rx="91.2" ry="52.8" />
            <ellipse className="scope-ring ring-mid" cx="240" cy="120" rx="134.4" ry="64.8" />
            <ellipse className="scope-ring ring-outer" cx="240" cy="120" rx="172.8" ry="76.8" />
            <ellipse className="scope-ring ring-outer" cx="240" cy="120" rx="211.2" ry="88.8" />
          </>
        ) : (
          <>
            <circle className="scope-ring ring-outer" cx="240" cy="120" r="92" />
            <circle className="scope-ring ring-mid" cx="240" cy="120" r="61" />
            <circle className="scope-ring ring-inner" cx="240" cy="120" r="30" />
          </>
        )}
        <path className="scope-sweep" d="M240 120 392 76A160 160 0 0 1 400 120Z" />

        {contact ? (
          <g className="scope-hostiles" data-qa-pirate-scope-position={slot} data-qa-pirate-scope-x={markerX.toFixed(2)} data-qa-pirate-scope-y={markerY.toFixed(2)}>
            <circle cx={markerX} cy={markerY} r="7" />
            <circle cx={markerX} cy={markerY} r="17" fill="none" strokeDasharray="3 4" opacity=".7"/>
            <path d={`M${markerX - 12} ${markerY}h24M${markerX} ${markerY - 12}v24`} />
          </g>
        ) : isCombat ? (
          <g className="scope-hostiles">
            <circle cx="324" cy="82" r="5" />
            <circle cx="350" cy="135" r="4" />
            <circle cx="292" cy="158" r="4" />
            <path d="m324 67 15 15-15 15-15-15 15-15Z" />
          </g>
        ) : null}

        {unknown ? (
          <g className="scope-unknown-contact">
            <circle cx="282" cy="99" r="9" />
            <circle cx="282" cy="99" r="22" />
            <path d="M270 99h24M282 87v24" />
          </g>
        ) : null}

        {isDerelict ? (
          <g className="scope-derelict">
            <path d="m292 92 42 13-19 10 19 11-42 14-29-24 29-24Z" />
            <path d="m306 101-8 30M320 107l-8 17" />
          </g>
        ) : null}

        {isScience ? (
          <g className="scope-anomaly">
            <path d="M279 61c44 13 62 58 40 94s-76 43-109 15-32-76-1-106 68-30 97-10" />
            <path d="M274 85c28 8 39 37 25 60s-48 27-69 9-20-48 0-67 43-19 61-6" />
          </g>
        ) : null}
      </svg>
      <div className="operations-scope-caption-v2">
        <span>{contact ? `ЦЕЛЬ · ПОЗИЦИЯ ${slot}/24` : isPirateOperationId(operation.id) ? 'ПИРАТСКАЯ БАЗА · ИСТОРИЯ ЦИКЛА' : unknown ? 'СИГНАТУРА НЕ КЛАССИФИЦИРОВАНА' : isCombat ? 'ТАКТИЧЕСКИЙ КОНТАКТ' : isScience ? 'ПОЛЕ ИСКАЖЕНИЯ' : 'ОБЪЕКТ ОБНАРУЖЕН'}</span>
        <small>{contact ? formatLocation(operation.location) : unknown ? 'ОЖИДАНИЕ ГЛУБОКОГО СКАНА' : `INTEL ${operation.intel}/3`}</small>
      </div>
    </div>
  );
}

function OperationCard({ operation, selected, onSelect, contact, quiet, nowMs }: {
  operation: OperationInstance;
  selected: boolean;
  onSelect: () => void;
  contact?: PirateContactPresentation;
  quiet?: QuietPirateCycle;
  nowMs: number;
}) {
  const intelZero = operation.intel === 0;
  const firstReward = rewardEntries(operation)[0];
  const pirate = isPirateOperationId(operation.id);
  const pirateCycle = pirate ? (contact?.contactCycleKey ?? quiet?.contactCycleKey ?? operation.id.slice('pirate:'.length)).split(':') : [];
  const pirateArt = pirate ? getPiratePlanetArt(Number(pirateCycle[2]), Number(pirateCycle[3])) : null;

  return (
    <button
      type="button"
      className={`operation-feed-card-v2 operation-feed-card-v2--${operation.category} ${selected ? 'selected' : ''}`}
      data-threat={operation.threat ?? 'unknown'}
      data-qa-pirate-contact={contact?.contactCycleKey ?? quiet?.contactCycleKey}
      onClick={onSelect}
    >
      {pirateArt
        ? <span className="operation-feed-threat-v2 operation-feed-pirate-art-v2" aria-label="Пиратская планета">
          <img src={pirateArt} alt="" loading="lazy" draggable={false} />
          <small>{contact ? 'ПИРАТЫ' : 'АРХИВ'}</small>
        </span>
        : <span className="operation-feed-threat-v2"><b>{threatTier(operation)}</b><small>{intelZero ? 'UNKNOWN' : operation.category === 'combat' ? 'THREAT' : 'RISK'}</small></span>}
      <span className="operation-feed-copy-v2">
        <small>{CATEGORY_LABELS[operation.category]}</small>
        <strong>{operation.title}</strong>
        <em>{contact ? `Пиратский контакт · осталось ${pirateRemainingLabel(contact.expiresAt, nowMs)}` : quiet ? 'База уничтожена · ожидание нового цикла' : isPirateOperationId(operation.id) ? 'Контакт завершён' : intelZero ? 'Сигнатура требует классификации' : operation.objective.label}</em>
        <span className="operation-feed-meta-v2">
          <i>{isPirateOperationId(operation.id) ? formatLocation(operation.location) : intelZero ? formatLocationClass(operation.location) : formatLocation(operation.location)}</i>
          {isPirateOperationId(operation.id)
            ? <b className="operations-pirate-debris-label"><ResourceIcon kind="debris" /> ОБЛОМКИ · от 60%</b>
            : <><IntelPips level={operation.intel} />{firstReward ? <b><ResourceIcon kind={firstReward[2]} /> {number.format(firstReward[1])}</b> : <b>НАГРАДА ?</b>}</>}
        </span>
      </span>
      <span className="operation-feed-arrow-v2">›</span>
    </button>
  );
}

function EmptyState({ tab }: { tab: OperationsTab }) {
  const copy = tab === 'active'
    ? ['АКТИВНЫХ ОПЕРАЦИЙ НЕТ', 'Примите операцию из списка доступных.']
    : tab === 'completed'
      ? ['ВЫПОЛНЕННЫХ ОПЕРАЦИЙ НЕТ', 'Здесь появляются только операции с подтверждённым результатом боя.']
      : ['КОНТАКТОВ НЕТ', 'Новых операций сейчас не обнаружено.'];

  return <div className="operations-empty-v2"><span>◇</span><strong>{copy[0]}</strong><p>{copy[1]}</p></div>;
}

function pirateCoordinateLabel(contact: PirateContactPresentation) {
  const { galaxy, system, position } = contact.coordinate;
  return `Галактика ${galaxy} · Система ${String(system).padStart(2, '0')} · Позиция ${position}`;
}

function pirateRemainingLabel(expiresAt: number, nowMs: number) {
  const seconds = Math.max(0, Math.ceil((expiresAt - nowMs) / 1_000));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes ? `${minutes} мин ${String(remainder).padStart(2, '0')} с` : `${remainder} с`;
}

/** The persisted defeat timestamp determines the start; a full bar means eligibility, not a guaranteed spawn. */
function QuietPirateProgress({ nextEligibleAt, nowMs }: { nextEligibleAt: number; nowMs: number }) {
  const elapsedMs = Math.max(0, Math.min(PIRATE_CONTACT_QUIET_MS, nowMs - (nextEligibleAt - PIRATE_CONTACT_QUIET_MS)));
  const percent = Math.round((elapsedMs / PIRATE_CONTACT_QUIET_MS) * 100);
  const remaining = Math.max(0, nextEligibleAt - nowMs);
  return (
    <div className="operations-pirate-cooldown" role="group" aria-label="Пауза после уничтожения пиратской базы">
      <div className="operations-pirate-cooldown-heading">
        <span>ДО СЛЕДУЮЩЕГО ВОЗМОЖНОГО ПОЯВЛЕНИЯ</span>
        <strong role="timer">{pirateRemainingLabel(nextEligibleAt, nowMs)}</strong>
      </div>
      <div className="operations-pirate-cooldown-track" role="progressbar"
        aria-label="Прошедшая часть 15-минутной паузы" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
        <span className="operations-pirate-cooldown-mask" style={{ width: `${100 - percent}%` }} />
      </div>
      <small>{remaining === 0 ? 'Пауза закончилась. Следующее появление зависит от игрового расписания.' : `${percent}% паузы прошло · повторное появление не гарантировано`}</small>
    </div>
  );
}

function OperationDossier({ operation, pirateContact, quiet, battleReportId, completed, nowMs, onAccept, onCancel, onReveal, onOpenFleets, onPirateRecon, onPirateAttack, onPirateReport, onPirateBattleReport, onPirateUniverse }: {
  operation: OperationInstance | null;
  pirateContact?: PirateContactPresentation;
  quiet?: QuietPirateCycle;
  battleReportId?: string;
  completed?: CompletedPirateOperation;
  nowMs: number;
  onPirateBattleReport?: (reportId: string) => void;
  onPirateRecon?: (contact: PirateContactPresentation) => void;
  onPirateAttack?: (contact: PirateContactPresentation) => void;
  onPirateReport?: (reportId: string) => void;
  onPirateUniverse?: (contact: PirateContactPresentation) => void;
  onAccept: (id: OperationId) => void;
  onCancel: (id: OperationId) => void;
  onReveal: (id: OperationId) => void;
  onOpenFleets: () => void;
}) {
  if (!operation) {
    return (
      <aside className="operations-dossier-v2 operations-dossier-v2--empty">
        <span>SELECT // OPERATION</span>
        <strong>ВЫБЕРИТЕ КОНТАКТ</strong>
        <p>Операционный брифинг появится здесь.</p>
      </aside>
    );
  }

  const pirate = isPirateOperationId(operation.id);
  const intelZero = operation.intel === 0 && !pirate;
  const modifierLabels = operation.modifiers.map((modifier) => OPERATION_MODIFIER_LABELS[modifier]);
  const reconLabel = pirateContact?.latestReportOutcome === 'success' ? 'Разведданные получены'
    : pirateContact?.latestReportOutcome === 'failure' ? 'Разведка не удалась'
      : pirateContact?.statusLabel === 'Зонд в пути' ? 'Зонд в пути' : 'Нет разведданных';

  if (pirate && completed) {
    return (
      <aside className="operations-dossier-v2 operations-dossier-v2--pirate operations-completed-report-v2" data-threat="unknown">
        <header className="operations-dossier-head-v2">
          <div className="operations-dossier-title-v2">
            <span className="operations-dossier-glyph-v2"><OperationGlyph category="combat" /></span>
            <div><small>РЕЗУЛЬТАТ БОЕВОЙ ОПЕРАЦИИ</small><h2>ПИРАТСКАЯ БАЗА УНИЧТОЖЕНА</h2>
              <p>{formatLocation(operation.location)}</p></div>
          </div>
        </header>
        <section className="operations-completed-report-body-v2">
          <h3>БОЕВОЙ ОТЧЁТ</h3>
          <p>Победа подтверждена боевым расчётом. Результат сохранён в разделе «Доклады».</p>
          <div className="operations-completed-report-facts-v2">
            <div><small>ИСХОД</small><strong>ПОБЕДА</strong></div>
            <div><small>РАУНДОВ</small><strong>{completed.rounds}</strong></div>
            <div><small>ОБЛОМКИ НА ОРБИТЕ</small><strong><ResourceIcon kind="debris" /> {number.format(completed.debris)}</strong></div>
            <div><small>ЗАВЕРШЕНО</small><strong>{new Date(completed.defeatedAt).toLocaleString('ru-RU')}</strong></div>
          </div>
          <button type="button" className="operations-primary-v2" onClick={() => onPirateBattleReport?.(completed.reportId)}>ОТКРЫТЬ ПОЛНЫЙ БОЕВОЙ ОТЧЁТ</button>
        </section>
      </aside>
    );
  }

  return (
    <aside className={`operations-dossier-v2 operations-dossier-v2--${operation.category} ${pirate ? 'operations-dossier-v2--pirate' : ''}`} data-threat={operation.threat ?? 'unknown'}>
      <header className="operations-dossier-head-v2">
        <div className="operations-dossier-title-v2">
          <span className="operations-dossier-glyph-v2"><OperationGlyph category={operation.category} /></span>
          <div>
            <small>{pirate ? `БОЕВАЯ ОПЕРАЦИЯ · ${pirateContact ? 'ДЕЙСТВУЮЩАЯ ЦЕЛЬ' : 'АРХИВ КОНТАКТА'}` : `${CATEGORY_LABELS[operation.category]} · ${operation.id.toUpperCase()}`}</small>
            <h2>{operation.title}</h2>
            <p>{intelZero ? formatLocationClass(operation.location) : formatLocation(operation.location)} <i /> {OPERATION_SOURCE_LABELS[operation.source]}</p>
          </div>
        </div>
        <div className="operations-dossier-threat-v2">
          <small>{pirate ? 'СТАТУС КОНТАКТА' : operation.category === 'combat' ? 'УРОВЕНЬ УГРОЗЫ' : 'УРОВЕНЬ РИСКА'}</small>
          <strong>{pirate ? (pirateContact ? '●' : '—') : threatTier(operation)}</strong>
          <span>{pirate ? (pirateContact ? 'ОБНАРУЖЕН' : quiet ? 'УНИЧТОЖЕН' : 'ИСТЁК') : threatText(operation)}</span>
        </div>
      </header>

      <section className="operations-dossier-hero-v2">
        <TacticalScope operation={operation} contact={pirateContact} />
        <div className="operations-briefing-v2">
          <small>ОПЕРАТИВНАЯ СВОДКА</small>
          <h3>{pirate ? pirateContact ? 'ПИРАТСКАЯ БАЗА ОБНАРУЖЕНА' : quiet ? 'ПИРАТСКАЯ БАЗА УНИЧТОЖЕНА' : 'КОНТАКТ ЗАВЕРШЁН' : intelZero ? 'ДАННЫХ НЕДОСТАТОЧНО' : 'КОНТАКТ КЛАССИФИЦИРОВАН'}</h3>
          <p>{pirate ? pirateContact ? `Действующая база в системе вашей колонии. Координаты: ${pirateCoordinateLabel(pirateContact)}.` : quiet ? 'Пиратская база разгромлена. Начался период до следующего возможного появления контакта.' : 'Цикл закончился или цель исчезла. На прежние координаты рейд не отправляется.' : intelZero ? 'Сенсоры фиксируют нестабильный источник неизвестного происхождения. До глубокого сканирования тип объекта, точная угроза и возможная награда скрыты.' : operation.briefing}</p>
          <div className="operations-intel-line-v2">
            <span>{pirate ? 'РАЗВЕДКА' : 'РАЗВЕДДАННЫЕ'}</span>
            {pirate ? <b>{pirateContact ? reconLabel : 'Контакт завершён'}</b> : <><IntelPips level={operation.intel} /><b>{operation.intel} / 3</b></>}
          </div>
          {pirateContact ? <div className="operations-pirate-lifecycle-v2">
            <div className="operations-pirate-live-timer" role="timer">До исчезновения: <strong>{pirateRemainingLabel(pirateContact.expiresAt, nowMs)}</strong></div>
            <small>Затем — 15-минутная пауза до нового ролла появления базы.</small>
          </div> : quiet ? <QuietPirateProgress nextEligibleAt={quiet.nextEligibleAt} nowMs={nowMs} /> : null}
        </div>
      </section>

      {intelZero ? (
        <section className="operations-unknown-brief-v2">
          <div><small>КЛАСС КОНТАКТА</small><strong>НЕИЗВЕСТЕН</strong></div>
          <div><small>ВОЗМОЖНЫЙ РИСК</small><strong>{operation.threatRange ? `${ROMAN_THREAT[operation.threatRange[0]]}–${ROMAN_THREAT[operation.threatRange[1]]}` : '?'}</strong></div>
          <p>Сканирование классифицирует сигнал и заменит его конкретной операцией. Результат фиксирован и сохраняется в текущем save.</p>
        </section>
      ) : (
        <>
          <section className="operations-objective-v2">
            <small>ОСНОВНАЯ ЦЕЛЬ</small>
            <strong>{operation.objective.label}</strong>
          </section>

          <div className="operations-dossier-lower-v2">
            {pirate ? <>
              <section className="operations-conditions-v2">
                <small>РАЗВЕДДАННЫЕ</small>
                <strong>{pirateContact ? reconLabel : 'Цикл завершён'}</strong>
                <p>{pirateContact?.latestReportOutcome === 'success' ? 'Состав флота доступен в разведотчёте.' : pirateContact?.latestReportOutcome === 'failure' ? 'Зонд не получил данные.' : pirateContact ? 'Отправь разведзонд, чтобы узнать состав противника.' : 'Разведка завершена.'}</p>
                {pirateContact?.latestReportId && onPirateReport
                  ? <button type="button" className="operations-intel-report-button-v2" onClick={() => onPirateReport(pirateContact.latestReportId!)}>ОТКРЫТЬ РАЗВЕДОТЧЁТ <span aria-hidden="true">↗</span></button>
                  : null}
              </section>
              <section className="operations-rewards-panel-v2">
                <small>ПОТЕНЦИАЛЬНЫЕ ОБЛОМКИ</small>
                <div className="operations-pirate-debris-reward"><ResourceIcon kind="debris" label="Обломки" /><strong>От 60% стоимости уничтоженных пиратских кораблей</strong></div>
                <p>Обломки остаются на орбите после боя — для получения отправь переработчиков.</p>
              </section>
            </> : <>
              <section className="operations-conditions-v2">
                <small>УСЛОВИЯ КОНТАКТА</small>
                <div>{modifierLabels.length ? modifierLabels.map((label) => <span key={label}>⚠ {label}</span>) : <span>Без особых условий</span>}</div>
                <p>Показаны только подтверждённые данные текущего уровня разведки.</p>
              </section>
              <section className="operations-rewards-panel-v2">
                <small>НАГРАДА · ПРЕДПРОСМОТР</small>
                <RewardPreview operation={operation} />
                <p>Начисление награды появится вместе с реальным выполнением операций.</p>
              </section>
            </>}
          </div>
        </>
      )}

      <footer className="operations-command-v2">
        <div>
          <small>СТАТУС</small>
          <strong>{pirate ? operation.state === 'completed' ? quiet ? 'БАЗА УНИЧТОЖЕНА' : 'КОНТАКТ ЗАВЕРШЁН' : operation.state === 'active' ? 'ОПЕРАЦИЯ ПРИНЯТА' : 'ДОСТУПНА К ПРИНЯТИЮ' : operation.state === 'active' ? 'ОПЕРАЦИЯ ПРИНЯТА' : operation.state === 'completed' ? 'ОПЕРАЦИЯ ЗАВЕРШЕНА' : intelZero ? 'ТРЕБУЕТСЯ СКАНИРОВАНИЕ' : 'ГОТОВА К ПРИНЯТИЮ'}</strong>
          <span>{pirate ? quiet ? 'Пауза перед возможным новым появлением базы — не таймер атаки на игрока.' : operation.state === 'active' ? 'Выбери действие для этого действующего контакта.' : operation.state === 'available' ? 'Прими операцию, чтобы открыть действия.' : 'Прошлый цикл больше не активен.' : operation.state === 'active' ? 'Подготовьте флот в разделе «Флоты».' : intelZero ? 'Классифицируйте контакт перед принятием решения.' : 'Принятие фиксирует операцию как активную.'}</span>
        </div>
        <div className="operations-command-actions-v2">
          {pirate && operation.state === 'completed' && battleReportId && onPirateBattleReport ? <button type="button" className="operations-primary-v2" onClick={() => onPirateBattleReport(battleReportId)}>ОТКРЫТЬ БОЕВОЙ ОТЧЁТ</button> : null}
          {pirate ? pirateContact && operation.state === 'available'
            ? <button type="button" className="operations-primary-v2" onClick={() => onAccept(operation.id)}>ПРИНЯТЬ ОПЕРАЦИЮ</button>
            : pirateContact && operation.state === 'active' ? <div className="operations-pirate-actions">
              <button type="button" className="operations-primary-v2" disabled={!pirateContact.recon.enabled || !onPirateRecon} title={pirateContact.recon.disabledReason ?? ''} onClick={() => onPirateRecon?.(pirateContact)}>РАЗВЕДАТЬ</button>
              <button type="button" className="operations-secondary-v2" disabled={!pirateContact.elimination.enabled || !onPirateAttack} onClick={() => onPirateAttack?.(pirateContact)}>ПОДГОТОВИТЬ ПИРАТСКИЙ РЕЙД</button>
              
              <button type="button" className="operations-secondary-v2" disabled={!onPirateUniverse} onClick={() => onPirateUniverse?.(pirateContact)}>ПОКАЗАТЬ ВО ВСЕЛЕННОЙ</button>
              <button type="button" className="operations-pirate-cancel" onClick={() => onCancel(operation.id)}>Отменить операцию</button>
            </div> : null
          : <>
            {intelZero ? <button type="button" className="operations-primary-v2" onClick={() => onReveal(operation.id)}>ПРОСКАНИРОВАТЬ</button> : null}
            {!intelZero && operation.state === 'available' ? <button type="button" className="operations-primary-v2" onClick={() => onAccept(operation.id)}>ПРИНЯТЬ ОПЕРАЦИЮ</button> : null}
            {operation.state === 'active' ? <button type="button" className="operations-primary-v2" onClick={onOpenFleets}>К ФЛОТАМ</button> : null}
            {operation.state === 'active' ? <button type="button" className="operations-secondary-v2" onClick={() => onCancel(operation.id)}>ОТМЕНИТЬ</button> : null}
          </>}
        </div>
      </footer>
    </aside>
  );
}

export function OperationsView({ state, onAccept, onCancel, onReveal, onOpenFleets, pirateContacts = [], quietPirateSystems = [], pirateCycleTimers = [], completedPirateOperations = [], nowMs = Date.now(), onPirateAccept, onPirateCancel, onPirateRecon, onPirateAttack, onPirateReport, onPirateBattleReport, onPirateUniverse }: OperationsViewProps) {
  const [tab, setTab] = useState<OperationsTab>('available');
  const [selectedId, setSelectedId] = useState<OperationId | null>(null);

  const operationRows = useMemo((): OperationRow[] => {
    // Demo placeholders are not playable pirate targets. Keep them in Test save for
    // backwards compatibility, but render only authoritative live contacts.
    const demoIds = new Set(['op-pirate-patrol-01', 'op-pirate-outpost-01']);
    const normal: OperationRow[] = state.items
      .filter((item) => !demoIds.has(item.id) && !isPirateOperationId(item.id))
      .map((operation) => ({ operation }));
    const acceptedIds = new Set(state.items.filter((item) => isPirateOperationId(item.id) && item.state === 'active').map((item) => item.id));
    const live: OperationRow[] = pirateContacts.map((contact) => ({
      operation: pirateContactOperation(contact, acceptedIds.has(pirateOperationId(contact.contactCycleKey)) ? 'active' : 'available'),
      contact,
    }));
    const completed: OperationRow[] = completedPirateOperations.map((entry) => ({
      operation: pirateCycleOperation(entry.cycleKey, entry.coordinate, 'completed'),
      battleReportId: entry.reportId,
      completed: entry,
    }));
    return [...live, ...completed, ...normal];
  }, [state.items, pirateContacts, completedPirateOperations]);

  const visibleRows = useMemo(() => operationRows.filter(({ operation }) => operation.state === tab), [operationRows, tab]);
  const selectedRow = visibleRows.find(({ operation }) => operation.id === selectedId) ?? null;
  // Every owned system has its own authoritative roll timestamp, even when a base lives.
  const nextCycles = [...pirateCycleTimers].sort((a, b) => a.nextRollAt - b.nextRollAt);

  useEffect(() => {
    if (selectedRow) return;
    setSelectedId(visibleRows[0]?.operation.id ?? null);
  }, [selectedRow, visibleRows]);

  const chooseTab = (next: OperationsTab) => {
    setTab(next);
    setSelectedId(null);
  };

  const accept = (operationId: OperationId) => {
    const row = operationRows.find(({ operation }) => operation.id === operationId);
    if (row?.contact) onPirateAccept?.(row.contact);
    else onAccept(operationId);
    setTab('active');
    setSelectedId(operationId);
  };

  const cancel = (operationId: OperationId) => {
    const row = operationRows.find(({ operation }) => operation.id === operationId);
    if (row?.contact) onPirateCancel?.(row.contact);
    else onCancel(operationId);
    setTab('available');
    setSelectedId(operationId);
  };

  return (
    <main className="operations-shell-v2">
      <header className="operations-topbar-v2">
        <div className="operations-heading-v2">
          <small>ОПЕРАЦИОННЫЙ ЦЕНТР</small>
          <h1>ОПЕРАЦИИ</h1>
          <p>Действующие PvE-цели в системах твоих колоний.</p>
        </div>
        <nav className="operations-tabs-v2" role="tablist" aria-label="Состояние операций">
          {(Object.keys(TAB_LABELS) as OperationsTab[]).map((entry) => (
            <button key={entry} type="button" role="tab" aria-selected={tab === entry} className={tab === entry ? 'active' : ''} onClick={() => chooseTab(entry)}>
              <span>{TAB_LABELS[entry]}</span><b>{operationRows.filter(({ operation }) => operation.state === entry).length}</b>
            </button>
          ))}
        </nav>
        <div className="operations-slots-v2"><small>ПИРАТСКИЕ БАЗЫ</small><strong>{pirateContacts.length}</strong><span>активны</span></div>
      </header>
      {nextCycles.length ? <section className="operations-quiet-banner-v2" data-qa-operations-quiet-banner>
        <div className="operations-quiet-banner-intro-v2">
          <strong>СЛЕДУЮЩИЕ ПРОВЕРКИ ПОЯВЛЕНИЯ ПИРАТОВ</strong>
          <span>Отдельный таймер для каждой системы с колонией · это не таймер нападения</span>
        </div>
        <div className="operations-cycle-timer-list-v2">
          {nextCycles.map((cycle) => <div key={`${cycle.galaxy}:${cycle.system}`} className="operations-cycle-timer-item-v2" data-qa-pirate-roll-system={`${cycle.galaxy}:${cycle.system}`}>
            <strong>[{cycle.galaxy}:{String(cycle.system).padStart(2, '0')}]</strong>
            <div>
              <span>{cycle.active ? 'База действует · до следующей проверки' : '15-минутная пауза · до проверки появления'}</span>
              <b role="timer">{pirateRemainingLabel(cycle.nextRollAt, nowMs)}</b>
              <div className="operations-pirate-cooldown-track" role="progressbar" aria-label={`Ход 15-минутной паузы системы ${cycle.system}`}
                aria-valuemin={0} aria-valuemax={100}
                aria-valuenow={cycle.active ? 0 : Math.round(Math.max(0, Math.min(1, (nowMs - cycle.quietStartsAt) / PIRATE_CONTACT_QUIET_MS)) * 100)}>
                <span className="operations-pirate-cooldown-mask" style={{ width: `${cycle.active ? 100 : 100 - Math.round(Math.max(0, Math.min(1, (nowMs - cycle.quietStartsAt) / PIRATE_CONTACT_QUIET_MS)) * 100)}%` }} />
              </div>
            </div>
          </div>)}
        </div>
      </section> : null}
      <div className="operations-layout-v2">
        <section className="operations-feed-v2" aria-label={TAB_LABELS[tab]}>
          <header><div><small>КАНАЛ // {TAB_LABELS[tab]}</small><strong>{tab === 'available' ? 'ВХОДЯЩИЕ КОНТАКТЫ' : tab === 'active' ? 'ТЕКУЩИЕ ЗАДАЧИ' : 'АРХИВ ОПЕРАЦИЙ'}</strong></div><span>{visibleRows.length}</span></header>
          <div className="operations-feed-scroll-v2">
            {visibleRows.length ? <div className="operations-feed-list-v2">
              {visibleRows.map((row) => <OperationCard
                key={row.operation.id}
                operation={row.operation}
                contact={row.contact}
                quiet={row.quiet}
                nowMs={nowMs}
                selected={row.operation.id === selectedRow?.operation.id}
                onSelect={() => setSelectedId(row.operation.id)}
              />)}
            </div> : <EmptyState tab={tab} />}
          </div>
        </section>
        <OperationDossier
          operation={selectedRow?.operation ?? null}
          pirateContact={selectedRow?.contact}
          quiet={selectedRow?.quiet}
          battleReportId={selectedRow?.battleReportId}
          completed={selectedRow?.completed}
          nowMs={nowMs}
          onAccept={accept}
          onCancel={cancel}
          onReveal={onReveal}
          onOpenFleets={onOpenFleets}
          onPirateRecon={onPirateRecon}
          onPirateAttack={onPirateAttack}
          onPirateReport={onPirateReport}
          onPirateBattleReport={onPirateBattleReport}
          onPirateUniverse={onPirateUniverse}
        />
      </div>
    </main>
  );
}
