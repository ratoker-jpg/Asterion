/**
 * The Universe object card: a free position, an uninhabited planet, an
 * asteroid, a pirate base, a unique object or an anomaly (inhabited planets
 * open the «Звёздный атлас»). Old-screens redo, 11.11.2026.
 *
 * One window in the style of «Операции»: the object with its art and plain
 * words, the few facts that decide what to do, «Что дальше», and every action
 * one click away with its flight time (the same plan the right-click menu
 * makes). A blocked action says why above the buttons, not in a tooltip.
 */
import { type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode, type RefObject } from 'react';
import type { UniverseCoordinate, UniversePlanetNode } from '../../domain/universe/types.ts';
import { formatUniverseCoordinate } from '../../domain/universe/runtime.ts';
import type { PirateContactPresentation } from '../../pirate-ui.ts';
import type { QuickActionId, QuickTarget } from '../../application/quick-actions.ts';
import { ResourceIcon } from '../resources/ResourceIcon.tsx';
import { flightClock, useAtlasPlans, type AtlasCell } from './atlas-plans.ts';
import { OBJECT_KIND_LABEL, agoLabel, countdown, formatAmount, shortRefusal, type ExplorationIntel } from './object-card-model.ts';
import './object-card.css';

type ExplorationStatus = 'free' | 'self' | 'occupied';

export type ObjectCardProps = {
  node: UniversePlanetNode;
  /** For an asteroid: what sits at the position it flies over now. */
  underlyingNode?: UniversePlanetNode;
  nowMs: number;
  /** Free orbital debris at the coordinate. */
  orbitalDebris: number;
  asteroidHasDebris: boolean;
  pirateContact?: PirateContactPresentation;
  /** Unique objects and anomalies; undefined means out of expedition range. */
  explorationStatus?: ExplorationStatus;
  intel?: ExplorationIntel;
  closeRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  onColonize: (coordinate: UniverseCoordinate) => void;
  onAsteroidRecycler: (target: { spawnIndex: number; coordinate: UniverseCoordinate }) => void;
  onExpedition?: (node: UniversePlanetNode) => void;
  onExplorationRecon?: (node: UniversePlanetNode) => void;
  onExplorationAttack?: (node: UniversePlanetNode) => void;
  onPirateRecon?: (contact: PirateContactPresentation) => void;
  onPirateAttack?: (contact: PirateContactPresentation) => void;
  onPirateReport?: (reportId: string) => void;
  /** «Собрать обломки»: the right-click send panel for recyclers; absent when quick send is off. */
  onRecycle?: (target: QuickTarget, anchor: HTMLElement) => void;
  /** Test Mode screenshot route only: seeded objects are not in the live world, so their flight plans are seeded too. */
  plansOverride?: Partial<Record<QuickActionId, AtlasCell>>;
};

type Tone = 'good' | 'bad' | 'warn' | 'info';

type Fact = { key: string; label: string; value: ReactNode; note?: ReactNode; tone?: Tone; attrs?: Record<string, string> };

type CardAction = {
  /** data-qa-universe-special-action */
  qa: string;
  label: string;
  tip: string;
  enabled: boolean;
  reason?: string;
  primary?: boolean;
  quick?: QuickActionId;
  attrs?: Record<string, string | number>;
  onClick: (event: ReactMouseEvent<HTMLButtonElement>) => void;
};

const KIND_TONE: Partial<Record<UniversePlanetNode['kind'], string>> = {
  empty: '#8fd3e0', uninhabited: '#9fb6bf', asteroid: '#d6bd8a', pirate: '#ffa23a', unique: '#f2cc5b', anomaly: '#b58cff',
};

const ABOUT: Partial<Record<UniversePlanetNode['kind'], string>> = {
  empty: 'Свободная орбитальная позиция. Здесь можно основать колонию.',
  uninhabited: 'Необитаемая планета. Заселить её пока нельзя.',
  asteroid: 'Астероид кочует по системе. Переработчик соберёт с него газ, а потом обломки, если они есть. Сколько газа, станет видно после переработки.',
  pirate: 'Пиратская база в этой системе. Разведайте гарнизон зондом, соберите флот сильнее и отправьте рейд. После победы на орбите остаются обломки.',
  unique: 'Редкий мир с запасом ресурсов. Экспедиция добывает их, пока объект не исчез.',
  anomaly: 'Аномалия с запасом ресурсов. Экспедиция добывает их, пока аномалия не исчезла. Всплески сжигают часть груза.',
};

const OUT_OF_RANGE = 'зонд и экспедиция летят только к объектам в пределах пяти систем от ваших колоний';

function claimCopy(status: ExplorationStatus | undefined): { text: string; tone: Tone } {
  if (status === 'free') return { text: 'Свободен', tone: 'good' };
  if (status === 'self') return { text: 'Ваш флот добывает', tone: 'info' };
  if (status === 'occupied') return { text: 'Занят чужим флотом', tone: 'bad' };
  return { text: 'Далеко от ваших колоний', tone: 'warn' };
}

function ringOf(coordinate: UniverseCoordinate) {
  return Math.ceil(coordinate.position / 6);
}

export function ObjectCard(props: ObjectCardProps) {
  const {
    node, underlyingNode, nowMs, orbitalDebris, asteroidHasDebris, pirateContact, explorationStatus, intel, closeRef, onClose,
    onColonize, onAsteroidRecycler, onExpedition, onExplorationRecon, onExplorationAttack, onPirateRecon, onPirateAttack, onPirateReport, onRecycle, plansOverride,
  } = props;
  const kind = node.kind;
  const isAsteroid = kind === 'asteroid';
  const isPirate = kind === 'pirate';
  const isExploration = kind === 'unique' || kind === 'anomaly';
  const canColonize = kind === 'empty' || (isAsteroid && underlyingNode?.kind === 'empty');
  const coordinate = formatUniverseCoordinate(node.coordinate);
  const timed = node.pirate ?? node.special;
  const expiresAt = isPirate ? pirateContact?.expiresAt ?? timed?.expiresAt : timed?.expiresAt;
  const lifetime = timed?.expiresAt && timed?.startAt ? timed.expiresAt - timed.startAt : 0;
  const leftShare = lifetime > 0 && expiresAt ? Math.max(0, Math.min(1, (expiresAt - nowMs) / lifetime)) : undefined;
  const claim = claimCopy(explorationStatus);
  const reconOutcome = pirateContact?.latestReportOutcome;
  const probeOnWay = pirateContact?.statusLabel === 'Зонд в пути';

  // ---------- the target the right-click menu would see: flight times and the recycle panel ----------
  const target: QuickTarget = {
    node,
    orbitalDebris: isAsteroid ? 0 : orbitalDebris,
    ...(isAsteroid ? { underlyingKind: underlyingNode?.kind } : {}),
    ...(isExploration ? { explorationStatus } : {}),
    ...(isPirate && pirateContact ? { pirate: pirateContact } : {}),
  };

  // ---------- actions ----------
  const recycleAction: CardAction | null = isAsteroid ? null : {
    qa: 'recycle', quick: 'recycle', label: 'Собрать обломки',
    tip: orbitalDebris > 0 ? 'Переработчики заберут обломки с орбиты' : 'Обломков сейчас нет: переработчики прилетят заранее и пришлют доклад',
    enabled: Boolean(onRecycle),
    reason: 'быстрая отправка сейчас выключена',
    onClick: (event) => onRecycle?.(target, event.currentTarget),
  };
  const colonizeAction: CardAction | null = canColonize ? {
    qa: 'colonize', quick: 'colonize', label: 'Колонизировать', tip: 'Выбрать колонизатор и планету вылета',
    enabled: true, primary: !isAsteroid, attrs: { 'data-qa-universe-target-coordinate': coordinate },
    onClick: () => onColonize(node.coordinate),
  } : null;

  const actions: CardAction[] = [];
  if (isAsteroid) {
    if (colonizeAction) actions.push(colonizeAction);
    if (node.asteroid) {
      const asteroid = node.asteroid;
      actions.push({
        qa: 'asteroid-recycler', quick: 'gas', label: 'Отправить переработчика', tip: 'Переработчик сначала соберёт газ, затем обломки',
        enabled: true, primary: true,
        attrs: { 'data-qa-universe-target-coordinate': coordinate, 'data-qa-universe-asteroid-spawn-index': asteroid.spawnIndex },
        onClick: () => onAsteroidRecycler({ spawnIndex: asteroid.spawnIndex, coordinate: node.coordinate }),
      });
    }
  } else if (isPirate) {
    const cycle = { 'data-qa-universe-contact-cycle': pirateContact?.contactCycleKey ?? '' };
    const reportEnabled = Boolean(pirateContact?.latestReportId && onPirateReport);
    const reconEnabled = Boolean(pirateContact?.recon.enabled && onPirateRecon);
    const raidEnabled = Boolean(pirateContact?.elimination.enabled && onPirateAttack);
    if (pirateContact?.latestReportId) {
      actions.push({
        qa: 'pirate-report', label: 'Доклад разведки', tip: 'Гарнизон базы из последнего доклада', enabled: reportEnabled, attrs: cycle,
        reason: 'доклад сейчас не открыть',
        onClick: () => { if (pirateContact?.latestReportId) onPirateReport?.(pirateContact.latestReportId); },
      });
    }
    actions.push({
      qa: 'pirate-recon', quick: 'pirate-recon', label: reconOutcome === 'success' ? 'Разведать снова' : 'Отправить зонд',
      tip: 'Один шпионский зонд покажет гарнизон базы', enabled: reconEnabled, attrs: cycle,
      reason: pirateContact?.recon.disabledReason || (onPirateRecon ? 'разведка сейчас недоступна' : 'действие сейчас недоступно'),
      onClick: () => { if (pirateContact) onPirateRecon?.(pirateContact); },
    });
    if (recycleAction) actions.push(recycleAction);
    actions.push({
      qa: 'pirate-elimination', quick: 'pirate-elimination', label: 'Подготовить рейд', tip: 'Выбрать флот для рейда на базу',
      enabled: raidEnabled, primary: true, attrs: cycle,
      reason: pirateContact?.elimination.disabledReason || (onPirateAttack ? 'рейд сейчас недоступен' : 'подготовка флота сейчас недоступна'),
      onClick: () => { if (pirateContact) onPirateAttack?.(pirateContact); },
    });
  } else if (isExploration) {
    const inRange = Boolean(explorationStatus);
    actions.push({
      qa: 'exploration-recon', quick: 'exploration-recon', label: intel ? 'Разведать снова' : 'Исследовать зондом',
      tip: 'Зонд покажет, кто занял объект и какой у него флот', enabled: Boolean(onExplorationRecon && inRange),
      reason: inRange ? 'разведка сейчас недоступна' : OUT_OF_RANGE,
      onClick: () => onExplorationRecon?.(node),
    });
    if (recycleAction) actions.push(recycleAction);
    if (explorationStatus === 'occupied') {
      actions.push({
        qa: 'exploration-attack', quick: 'exploration-attack', label: 'Атаковать', tip: 'Выбрать флот и выбить чужой флот с объекта',
        enabled: Boolean(onExplorationAttack), primary: true, reason: 'атака сейчас недоступна',
        onClick: () => onExplorationAttack?.(node),
      });
    } else {
      actions.push({
        qa: 'expedition', quick: 'expedition', label: 'Подготовить экспедицию', tip: 'Экспедиция возможна до пяти систем от ваших колоний',
        enabled: Boolean(onExpedition && explorationStatus === 'free'), primary: true,
        reason: explorationStatus === 'self' ? 'ваш флот уже добывает здесь' : inRange ? 'экспедиция сейчас недоступна' : OUT_OF_RANGE,
        onClick: () => onExpedition?.(node),
      });
    }
  } else {
    if (recycleAction) actions.push(kind === 'uninhabited' ? { ...recycleAction, primary: true } : recycleAction);
    if (colonizeAction) actions.push(colonizeAction);
  }

  const planned = actions.filter((action) => action.enabled && action.quick).map((action) => action.quick!);
  const livePlans = useAtlasPlans(
    plansOverride ? [] : [{ rowId: node.id, target, actions: planned }],
    `${node.id}|${planned.join(',')}|${orbitalDebris}|${explorationStatus ?? ''}|${pirateContact?.recon.enabled ?? ''}|${pirateContact?.elimination.enabled ?? ''}|${Boolean(plansOverride)}`,
  );
  const plans: Partial<Record<QuickActionId, AtlasCell>> = plansOverride ?? livePlans[node.id] ?? {};

  // Why something cannot go: blocked actions first, then launches the runtime refused.
  const why = [
    ...actions.filter((action) => !action.enabled && action.reason).map((action) => `${action.label}: ${action.reason}`),
    ...actions.filter((action) => action.enabled && action.quick && plans[action.quick]?.kind === 'refused')
      .map((action) => `${action.label}: ${(plans[action.quick!] as { reason: string }).reason}`),
  ].filter((line, index, all) => all.indexOf(line) === index);

  // ---------- status, facts, next step ----------
  const status: { text: string; tone: Tone } = isAsteroid
    ? { text: `Сменит позицию через ${countdown(nowMs, node.asteroid?.nextMoveAt)}`, tone: 'info' }
    : isPirate
      ? { text: probeOnWay ? 'Зонд в пути' : reconOutcome === 'success' ? 'Гарнизон разведан' : 'Гарнизон неизвестен', tone: reconOutcome === 'success' ? 'good' : 'warn' }
      : isExploration ? claim
        : kind === 'uninhabited' ? { text: 'Заселить пока нельзя', tone: 'warn' }
          : { text: 'Свободна', tone: 'good' };

  const debrisFact: Fact = {
    key: 'debris', label: 'Обломки на орбите',
    value: orbitalDebris > 0 ? <><ResourceIcon kind="debris" />{formatAmount(orbitalDebris)}</> : 'нет',
    note: orbitalDebris > 0 ? 'заберут переработчики' : 'переработчики могут лететь заранее',
    tone: orbitalDebris > 0 ? 'good' : undefined,
    attrs: { 'data-qa-universe-orbital-debris': String(orbitalDebris) },
  };
  const positionFact: Fact = { key: 'position', label: 'Позиция', value: `${node.coordinate.position} из 24`, note: `кольцо ${ringOf(node.coordinate)}` };
  const nextCoordinate = node.asteroid?.nextCoordinate ? formatUniverseCoordinate(node.asteroid.nextCoordinate) : null;

  const facts: Fact[] = isAsteroid ? [
    { key: 'move', label: 'Сменит позицию', value: countdown(nowMs, node.asteroid?.nextMoveAt), note: nextCoordinate ? `дальше ${nextCoordinate}` : 'маршрут завершён', tone: 'info' },
    { key: 'gas', label: 'Газ', value: <><ResourceIcon kind="gas" />скрыт</>, note: 'станет виден после переработки', attrs: { 'data-qa-universe-asteroid-gas': 'hidden' } },
    { key: 'asteroid-debris', label: 'Обломки на астероиде', value: asteroidHasDebris ? 'есть' : 'нет', note: asteroidHasDebris ? 'заберёт переработчик после газа' : 'только газ', tone: asteroidHasDebris ? 'good' : undefined,
      attrs: { 'data-qa-universe-asteroid-debris': asteroidHasDebris ? 'present' : 'absent' } },
    { key: 'under', label: 'Сейчас над', value: underlyingNode?.kind === 'empty' ? 'свободной позицией' : underlyingNode ? OBJECT_KIND_LABEL[underlyingNode.kind].toLowerCase() : 'пустотой',
      note: underlyingNode?.kind === 'empty' ? 'там можно основать колонию' : `позиция ${node.coordinate.position}` },
  ] : isPirate ? [
    { key: 'expires', label: 'Исчезнет через', value: countdown(nowMs, expiresAt), note: 'потом 15 минут затишья', tone: 'warn' },
    { key: 'recon', label: 'Разведка', value: probeOnWay ? 'Зонд в пути' : reconOutcome === 'success' ? 'Гарнизон известен' : reconOutcome === 'failure' ? 'Не удалась' : 'Не было',
      note: reconOutcome === 'success' ? 'доклад в «Сообщениях»' : 'зонд покажет гарнизон', tone: reconOutcome === 'success' ? 'good' : reconOutcome === 'failure' ? 'bad' : undefined,
      attrs: { 'data-qa-universe-pirate-cycle': pirateContact?.contactCycleKey ?? node.pirate?.contactCycleKey ?? '' } },
    { key: 'reward', label: 'Награда', value: <><ResourceIcon kind="debris" />125–175%</>, note: 'прочности пиратов в обломках', tone: 'good' },
    debrisFact,
  ] : isExploration ? [
    { key: 'expires', label: 'Исчезнет через', value: countdown(nowMs, expiresAt), note: 'запас уходит вместе с объектом', tone: 'warn',
      attrs: { 'data-qa-universe-exploration-status': explorationStatus ?? 'out' } },
    intel ? {
      key: 'intel', label: 'Разведка', value: agoLabel(nowMs, intel.at),
      note: !intel.success ? 'зонд ничего не узнал' : intel.occupantName
        ? `${intel.occupantName}${intel.allianceTag ? ` [${intel.allianceTag}]` : ''} · ${intel.fleetKnown ? 'флот известен' : 'флот не раскрыт'}`
        : 'объект был свободен',
      tone: intel.success ? 'good' : 'bad',
    } : { key: 'intel', label: 'Разведка', value: 'Не было', note: 'зонд покажет хозяина и его флот' },
    debrisFact,
  ] : [positionFact, debrisFact];

  const next = isAsteroid
    ? 'Отправьте переработчика: он соберёт газ, а потом обломки.'
    : isPirate
      ? probeOnWay ? 'Зонд летит к базе. Когда он долетит, доклад придёт в «Сообщения».'
        : reconOutcome === 'success' ? 'Гарнизон известен. Соберите флот сильнее гарнизона и подготовьте рейд.'
          : reconOutcome === 'failure' ? 'Разведка не удалась. Отправьте зонд ещё раз.'
            : 'Сначала отправьте зонд: он покажет гарнизон базы.'
      : isExploration
        ? explorationStatus === 'free' ? 'Отправьте экспедицию: она добывает ресурсы, пока объект не исчез.'
          : explorationStatus === 'self' ? 'Ваш флот уже добывает здесь. Вернуть его можно в «Операциях».'
            : explorationStatus === 'occupied'
              ? intel?.occupantName ? `Объект держит ${intel.occupantName}. Атакуйте, чтобы занять его.` : 'Объект занят. Разведайте зондом, кто там и какой у него флот, потом атакуйте.'
              : 'Объект слишком далеко. Зонд и экспедиция летят только в пределах пяти систем от ваших колоний.'
        : kind === 'uninhabited' ? 'Здесь можно только собрать обломки: переработчики летят к любой позиции.'
          : orbitalDebris > 0 ? 'Отправьте колонизатор, чтобы основать колонию. Обломки на орбите заберут переработчики.'
            : 'Отправьте колонизатор, чтобы основать здесь колонию.';

  return (
    <div className="universe-modal-backdrop universe-object-backdrop" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside
        className={`universe-object-card oc--${kind}`}
        role="dialog"
        aria-modal="true"
        aria-label={`${OBJECT_KIND_LABEL[kind]}: ${node.name}`}
        data-qa-universe-inspector
        data-qa-inspector-kind={kind}
        style={{ '--oc-k': KIND_TONE[kind] ?? '#8fd3e0' } as CSSProperties}
      >
        <div className="oc-scroll" data-qa-universe-special={kind} data-qa-universe-underlying-kind={underlyingNode?.kind ?? (kind === 'empty' ? 'empty' : '')}>
          <header className="oc-head">
            <div className="oc-art" aria-hidden="true">
              {node.art ? <img src={node.art} alt="" draggable={false} /> : <span className="oc-art__empty" />}
            </div>
            <div className="oc-title">
              <div className="oc-chips">
                <span className="oc-chip oc-chip--kind">{OBJECT_KIND_LABEL[kind]}</span>
                <span className={`oc-chip is-${status.tone}`} data-qa-universe-special-status>{status.text}</span>
              </div>
              <h2>{node.name}</h2>
              <span className="oc-coord">{coordinate}</span>
              <p className="oc-about">{ABOUT[kind] ?? node.description}</p>
            </div>
          </header>

          {leftShare !== undefined ? (
            <div className="oc-timer" aria-hidden="true"><i style={{ width: `${leftShare * 100}%` }} /></div>
          ) : null}

          <dl className={`oc-facts is-n${facts.length}`}>
            {facts.map((fact) => (
              <div key={fact.key} className={`oc-fact ${fact.tone ? `is-${fact.tone}` : ''}`} {...fact.attrs}>
                <dt>{fact.label}</dt>
                <dd>{fact.value}</dd>
                {fact.note ? <dd className="oc-fact__note">{fact.note}</dd> : null}
              </div>
            ))}
          </dl>

          <section className="oc-next" aria-label="Что дальше">
            <small>Что дальше</small>
            <p>{next}</p>
          </section>
        </div>

        <footer className="oc-foot">
          {why.length ? <ul className="oc-why" data-qa-universe-card-why>{why.map((line) => <li key={line}>{line}</li>)}</ul> : null}
          <div className="oc-actions">
            {actions.map((action) => {
              const plan = action.quick && action.enabled ? plans[action.quick] : undefined;
              const caption = !action.enabled ? null
                : plan?.kind === 'ready' ? <small className="oc-eta">в пути {flightClock(plan.durationMs)}</small>
                  : plan?.kind === 'refused' ? <small className="oc-eta is-warn">{shortRefusal(plan.reason)}</small>
                    : action.quick ? <small className="oc-eta is-pending" aria-hidden="true">··:··:··</small> : null;
              return (
                <div key={action.qa} className="oc-action">
                  <button
                    type="button"
                    className={action.primary ? 'oc-btn primary' : 'oc-btn'}
                    disabled={!action.enabled}
                    data-tip={action.enabled ? action.tip : undefined}
                    aria-label={`${action.label}${action.enabled ? '' : `: ${action.reason ?? 'недоступно'}`}`}
                    data-qa-universe-special-action={action.qa}
                    data-qa-universe-special-reason={action.enabled ? action.tip : action.reason ?? ''}
                    {...action.attrs}
                    onClick={action.onClick}
                  >{action.label}</button>
                  {caption}
                </div>
              );
            })}
          </div>
        </footer>

        <button ref={closeRef} type="button" className="universe-inspector-close oc-close" data-asterion-close aria-label="Закрыть" onClick={onClose}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" /></svg>
        </button>
      </aside>
    </div>
  );
}
