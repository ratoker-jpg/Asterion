import { createPortal } from 'react-dom';
import { SunReportStrip } from './ui/sun-raid/SunReportStrip.tsx';
import { EMPTY_ART } from './ui/ui-art.ts';
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

import { COMMANDER_ABILITIES, getCommanderCombatEffect, isCommanderId } from './domain/combat/commanders.ts';
import {
  BATTLE_HISTORY_CHANGED_EVENT,
  persistBattleHistory,
  readBattleHistory,
  setBattleReportSaved,
  type BattleHistoryState,
} from './domain/combat/battle-repository.ts';
import {
  filterBattleReports,
  isAsterionLocalPlayerId,
  type BattleListMode,
  type BattleReport,
} from './domain/combat/report.ts';
import {
  BATTLE_MISSING_DATA,
  createBattleReportViewModel,
  getBattlePointAwardDisplay,
  noCombatVerdict,
  type BattleEntityKind,
  type BattleEventViewModel,
  type BattleParticipantViewModel,
  type BattleReportViewModel,
  type BattleRoundViewModel,
  type BattleSiegeViewModel,
  type BattleSideViewModel,
  type BattleStackViewModel,
  type BattleTechnologyViewModel,
} from './domain/combat/battle-report-view-model.ts';
import { getFactionGeneralAsset } from './domain/profile/faction-assets.ts';
import { createPersistenceFacade } from './application/persistence.ts';
import { selectRecordedBattlePointAwards } from './domain/rating/scoring.ts';
import { ACTIVE_RUNTIME_MODE, RUNTIME_RESET_EVENT, RUNTIME_STATE_CHANGED_EVENT } from './domain/runtime/mode.ts';
import { ResourceIcon } from './ui/resources/ResourceIcon';
import { FactionGeneralPortrait } from './ui/FactionGeneralPortrait.tsx';
import { asterionAssetIntegrationAssets } from './assets/generated/asterionAssetIntegrationManifest.generated.ts';
import { battleFactionArtIdFor } from './ui/battle-report-faction-art.ts';
import criticalHitArt from '../assets/source/New assets/technologies/technology.shared.critical-hit.png';
import heavyArmorArt from '../assets/source/New assets/technologies/technology.shared.heavy-armor.png';
import ionScienceArt from '../assets/source/New assets/technologies/technology.shared.ion-science.png';
import laserScienceArt from '../assets/source/New assets/technologies/technology.shared.laser-science.png';
import lightArmorArt from '../assets/source/New assets/technologies/technology.shared.light-armor.png';
import maneuverDefenseArt from '../assets/source/New assets/technologies/technology.shared.maneuver-defense.png';
import mediumArmorArt from '../assets/source/New assets/technologies/technology.shared.medium-armor.png';
import piercingAttackArt from '../assets/source/New assets/technologies/technology.shared.piercing-attack.png';
import plasmaScienceArt from '../assets/source/New assets/technologies/technology.shared.plasma-science.png';
import shipArmorArt from '../assets/source/New assets/technologies/technology.shared.ship-armor.png';
import pirateWarlordArt from '../assets/source/characters/pirates/pirate_warlord.png';
import battlePlanet from '../assets/source/battle-report-v2/battle-planet-transparent-v1.png';
import battleSpaceBackground from '../assets/source/battle-report-v2/battle-space-background-v1.png';
import './battle-reports.css';
import './reports-comic-v6.css';

type SaveNotice = { kind: 'saved' | 'error'; message: string };
type ScrollRef = { current: HTMLElement | null };
type BattleCelestialMode = 'planet';

function formatNumber(value: number | null | undefined) {
  return value == null ? BATTLE_MISSING_DATA : new Intl.NumberFormat('ru-RU').format(value);
}

function formatResourcePoints(value: number) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(value);
}

function formatKnownNumber(value: number | null | undefined) {
  return value == null ? '—' : formatNumber(value);
}

function formatBps(value: number) {
  return `${(value / 100).toFixed(2)}%`;
}

function siegeReasonLabel(reason: string | null) {
  return {
    NO_SURVIVING_PLANET_DESTROYER: 'нет уцелевшего Планетолома',
    BATTLE_RESULT_INELIGIBLE: 'исход боя не даёт права на осаду',
    LAST_COLONY_PROTECTED: 'последняя колония защищена',
    ZERO_FINAL_CHANCE: 'итоговый шанс равен нулю',
  }[reason ?? ''] ?? 'не выполнено';
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
  const title = participant.playerName || participant.planetName || BATTLE_MISSING_DATA;
  return `${title}${participant.coordinates ? ` ${participant.coordinates}` : ''}`;
}

type BattleResultTone = 'victory' | 'defeat' | 'draw';

function resultIcon(tone: BattleResultTone) {
  return tone === 'victory' ? '✓' : tone === 'defeat' ? '×' : '=';
}

function resultLabel(viewModel: BattleReportViewModel) {
  const noCombat = noCombatVerdict(viewModel.roundCount, viewModel.winner, viewModel.missionType, viewModel.resources);
  const label = baseResultLabel(viewModel);
  return noCombat ? { ...label, label: noCombat.label } : label;
}

function roundsOrNoCombat(viewModel: BattleReportViewModel) {
  return viewModel.roundCount
    ? roundsLabel(viewModel.roundCount)
    : noCombatVerdict(viewModel.roundCount, viewModel.winner, viewModel.missionType, viewModel.resources)!.summary;
}

function baseResultLabel(viewModel: BattleReportViewModel) {
  const localSide = isAsterionLocalPlayerId(viewModel.attacker.participant.playerId)
    ? 'attacker'
    : isAsterionLocalPlayerId(viewModel.defender.participant.playerId)
      ? 'defender'
      : null;
  if (viewModel.winner === 'draw') return { label: 'НИЧЬЯ', tone: 'draw' } as const;
  if (localSide) {
    const suffix = viewModel.missionType === 'attack' ? (localSide === 'attacker' ? ' ПРИ АТАКЕ' : ' ПРИ ОБОРОНЕ') : '';
    return viewModel.winner === localSide
      ? { label: `ПОБЕДА${suffix}`, tone: 'victory' } as const
      : { label: `ПОРАЖЕНИЕ${suffix}`, tone: 'defeat' } as const;
  }
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
    'pirate-elimination': 'УНИЧТОЖЕНИЕ ПИРАТОВ',
    'pirate-raid': 'ПИРАТСКИЙ НАЛЁТ',
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

type BattleCardMetric = {
  id: 'population' | 'ships' | 'defense';
  label: string;
  unit: string;
  before: number | null;
  after: number | null;
  lost: number | null;
};

function battleCardMetrics(side: BattleSideViewModel): BattleCardMetric[] {
  return [
    { id: 'population', label: 'Население', unit: 'населения', before: side.populationBefore, after: side.populationAfter, lost: side.losses.population },
    { id: 'ships', label: 'Корабли · население', unit: '', before: side.fleet.populationBefore, after: side.fleet.populationAfter, lost: populationLoss(side.fleet.populationBefore, side.fleet.populationAfter) },
    { id: 'defense', label: 'Оборона · население', unit: '', before: side.defense.populationBefore, after: side.defense.populationAfter, lost: populationLoss(side.defense.populationBefore, side.defense.populationAfter) },
  ];
}

function populationLoss(before: number | null, after: number | null) {
  return before != null && after != null ? Math.max(0, before - after) : null;
}

function battleCardSideName(side: BattleSideViewModel) {
  return side.participant.playerName || side.participant.planetName || BATTLE_MISSING_DATA;
}

function battleCardSideMeta(side: BattleSideViewModel) {
  return [side.participant.coordinates, side.participant.race].filter(Boolean).join(' · ') || 'Данные участника не зафиксированы';
}

function battleCardPoints(viewModel: BattleReportViewModel, side: BattleSideViewModel) {
  return side.participant.side === 'attacker'
    ? viewModel.awardedBattlePoints?.attacker ?? null
    : viewModel.awardedBattlePoints?.defender ?? null;
}

function battleCardResourcePointsLost(viewModel: BattleReportViewModel, side: BattleSideViewModel) {
  return side.participant.side === 'attacker'
    ? viewModel.battlePoints.attackerResourcePointsLost
    : viewModel.battlePoints.defenderResourcePointsLost;
}

function CardSiegeSummary({ siege }: { siege: BattleSiegeViewModel }) {
  const demolitionResult = siege.demolition.blockedReason
    ? siegeReasonLabel(siege.demolition.blockedReason)
    : `снесено уровней: ${formatNumber(siege.demolition.destroyedBuildingLevels)}`;
  const destructionResult = siege.planetDestroyed
    ? 'ПЛАНЕТА УНИЧТОЖЕНА'
    : siege.destruction.blockedReason
      ? siegeReasonLabel(siege.destruction.blockedReason)
      : 'планета сохранена';
  return (
    <section className="battle-card-siege-v1" data-qa-siege-summary>
      <header><small>ОСАДНЫЕ ЭФФЕКТЫ</small><strong>ПЛАНЕТОЛОМ</strong></header>
      <div className="battle-card-siege-grid-v1">
        <span><small>СНОС ЗДАНИЙ · ШАНС</small><b>{formatBps(Math.min(10_000, siege.demolition.baseChanceBps + siege.demolition.annihilatorBonusBps))}</b></span>
        <span><small>ОЧКИ · СЫРЫЕ → ПОСЛЕ ОБОРОНЫ</small><b>{formatNumber(siege.demolition.rawPoints)} → {formatNumber(siege.demolition.finalPoints)}</b></span>
        <span><small>ЗДАНИЯ / УРОВНИ</small><b>{formatNumber(siege.demolition.destroyedBuildingLevels)} / {formatNumber(siege.demolition.selectedBuildingCount)}</b></span>
        <span><small>УНИЧТОЖЕНИЕ ПЛАНЕТЫ · ШАНС</small><b>{formatBps(siege.destruction.finalChanceBps)}</b></span>
      </div>
      <p><strong>{demolitionResult}</strong><span className={siege.planetDestroyed ? 'siege-planet-destroyed' : 'siege-planet-saved'}>{destructionResult}</span></p>
    </section>
  );
}

type BattleCardBodyProps = {
  viewModel: BattleReportViewModel;
  saved: boolean;
  onToggleSaved: () => void;
  onOpen: () => void;
};

/** Pirate participants carry no faction id; detect them from the participant record (same rule as «Сообщения»). */
function isPirateSide(side: BattleSideViewModel) {
  const participant = side.participant as { race?: string; playerName?: string; playerId?: string };
  return /pirat|пират/i.test([participant.race, participant.playerId, participant.playerName, String(side.factionId)].join(' '));
}

function BattleSideHero({ side, outcome }: { side: BattleSideViewModel; outcome: 'winner' | 'loser' | 'draw' }) {
  const winner = outcome === 'winner';
  const before = side.populationBefore;
  const after = side.populationAfter;
  const share = before != null && before > 0 && after != null ? Math.max(0, Math.min(100, (after / before) * 100)) : null;
  const meta = [isPirateSide(side) ? 'Пираты' : side.participant.race, side.participant.coordinates].filter(Boolean).join(' · ');
  return (
    <div className={`bcard-side bcard-side--${side.participant.side} is-${outcome}`}>
      <div className="bcard-side__art">
        {isPirateSide(side)
          ? <span className="faction-general-portrait" data-faction="pirates"><img src={pirateWarlordArt} alt="" /></span>
          : <FactionGeneralPortrait factionId={side.factionId} />}
      </div>
      <div className="bcard-side__copy">
        <small>{side.participant.side === 'attacker' ? 'АТАКУЮЩИЙ' : 'ЗАЩИТНИК'}{winner ? <em>ПОБЕДИТЕЛЬ</em> : outcome === 'loser' ? <em>ПРОИГРАВШИЙ</em> : null}</small>
        <strong>{battleCardSideName(side)}</strong>
        <span>{meta || battleCardSideMeta(side)}</span>
      </div>
      <div className="bcard-side__pop">
        <small>НАСЕЛЕНИЕ</small>
        <span><b>{formatKnownNumber(before)}</b><i aria-hidden="true">→</i><b className={after === 0 ? 'is-zero' : ''}>{formatKnownNumber(after)}</b></span>
        {share != null ? <i className="bcard-side__bar" role="meter" aria-label="Оставшееся население" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share)}><i style={{ width: `${share}%` }} /></i> : null}
      </div>
    </div>
  );
}

function BattleSideLedger({ viewModel, side }: { viewModel: BattleReportViewModel; side: BattleSideViewModel }) {
  const metrics = battleCardMetrics(side);
  const awardDisplay = getBattlePointAwardDisplay(viewModel.missionType, battleCardPoints(viewModel, side));
  const battleValue = awardDisplay.state === 'not-awarded' ? 'не начисляются' : awardDisplay.points == null ? 'не зафиксировано' : `+${formatNumber(awardDisplay.points)}`;
  return (
    <section className={`bcard-ledger bcard-ledger--${side.participant.side}`}>
      <header><small>{side.participant.side === 'attacker' ? 'АТАКУЮЩИЙ' : 'ЗАЩИТНИК'}</small><strong>{battleCardSideName(side)}</strong></header>
      <div className="battle-card-losses-v1 bcard-ledger__losses" data-qa-battle-losses={side.participant.side}>
        {metrics.map((metric) => (
          <span key={metric.id} className={metric.lost ? 'is-loss' : ''}>
            <small>{metric.id === 'population' ? 'Население' : metric.id === 'ships' ? 'Корабли' : 'Оборона'}</small>
            <b>{metric.lost == null ? '—' : metric.lost > 0 ? `−${formatNumber(metric.lost)}` : '0'}</b>
            <em>{metric.after == null ? 'нет данных' : `осталось ${formatNumber(metric.after)}`}</em>
          </span>
        ))}
      </div>
      <div className="battle-card-points-v1 bcard-ledger__points" data-qa-battle-award-state={awardDisplay.state}>
        <span className={awardDisplay.state === 'not-awarded' || awardDisplay.points == null ? 'is-off' : 'is-good'}>
          <img src={asterionAssetIntegrationAssets.scoreIcons.battlePoints} alt="" aria-hidden="true" draggable={false} />
          <small>Боевые очки</small><b>{battleValue}</b>
        </span>
        <span className="is-bad">
          <img src={asterionAssetIntegrationAssets.scoreIcons.resourcePoints} alt="" aria-hidden="true" draggable={false} />
          <small>Ресурсные очки · потеряно</small><b>−{formatResourcePoints(battleCardResourcePointsLost(viewModel, side))}</b>
        </span>
      </div>
    </section>
  );
}

function roundsLabel(count: number) {
  return `${formatNumber(count)} ${count === 1 ? 'раунд' : count > 1 && count < 5 ? 'раунда' : 'раундов'}`;
}

function BattleCardSummaryBody({ viewModel, saved, onToggleSaved, onOpen }: BattleCardBodyProps) {
  const result = resultLabel(viewModel);
  return (
    <div className="battle-card-body-v1 bcard">
      <div className="battle-card-versus-grid-v1 bcard-versus">
        <div className="battle-card-versus-column-v1"><BattleSideHero side={viewModel.attacker} outcome={viewModel.winner === 'draw' ? 'draw' : viewModel.winner === 'attacker' ? 'winner' : 'loser'} /></div>
        <div className="battle-card-versus-center-v1 bcard-versus__vs" aria-hidden="true"><b>VS</b></div>
        <div className="battle-card-versus-column-v1"><BattleSideHero side={viewModel.defender} outcome={viewModel.winner === 'draw' ? 'draw' : viewModel.winner === 'defender' ? 'winner' : 'loser'} /></div>
      </div>
      <section className={`bcard-verdict ${result.tone}`} aria-label="Итог боя">
        <div>
          <small>ИТОГ БОЯ · {missionLabel(viewModel.missionType)}</small>
          <strong>{result.label}</strong>
          <span>{roundsOrNoCombat(viewModel)}</span>
        </div>
        <div className="bcard-verdict__actions">
          <SaveButton saved={saved} onToggle={onToggleSaved} reportId={viewModel.id} />
          <button type="button" className="battle-open-v1" data-qa-battle-open={viewModel.id} onClick={onOpen}>ПОЛНЫЙ БОЕВОЙ ОТЧЁТ</button>
        </div>
      </section>
      <div className="bcard-ledgers">
        <BattleSideLedger viewModel={viewModel} side={viewModel.attacker} />
        <BattleSideLedger viewModel={viewModel} side={viewModel.defender} />
      </div>
      {viewModel.resources.length || viewModel.debrisOnOrbit != null ? (
        <section className="bcard-loot">
          <small>ДОБЫЧА И ОБЛОМКИ</small>
          <div>
            {viewModel.resources.map((resource) => <span className="battle-card-reward-item-v1" key={resource.kind}><ResourceIcon kind={resource.kind} /><b>{formatNumber(resource.value)}</b><em>{resource.label.toLowerCase()} · доставлено</em></span>)}
            {viewModel.debrisOnOrbit != null ? <span className="battle-card-reward-item-v1 is-debris" data-qa-debris-orbit><ResourceIcon kind="debris" /><b>{formatNumber(viewModel.debrisOnOrbit)}</b><em>обломков на орбите</em></span> : null}
          </div>
        </section>
      ) : null}
      {viewModel.siege ? <CardSiegeSummary siege={viewModel.siege} /> : null}
    </div>
  );
}

/** Unsaved reports leave «Последние» after this window; starred ones stay in «Сохранённые». */
export const BATTLE_RECENT_RETENTION_MS = 8 * 60 * 60 * 1_000;

/** Test-mode demo fixtures (QA samples) are not real battles and never expire. */
function isDemoBattleReport(reportId: string) {
  return reportId.startsWith('battle-demo-');
}

function retentionLabel(msLeft: number) {
  const minutes = Math.max(0, Math.ceil(msLeft / 60_000));
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours} ч ${String(minutes % 60).padStart(2, '0')} мин` : `${minutes} мин`;
}

export function BattleCard({
  viewModel,
  saved,
  onToggleSaved,
  onOpen,
  expiresInMs,
}: {
  viewModel: BattleReportViewModel;
  saved: boolean;
  onToggleSaved: () => void;
  onOpen: () => void;
  expiresInMs?: number | null;
}) {
  const result = resultLabel(viewModel);
  return (
    <details className={`battle-card-v1 ${result.tone}`} data-qa-battle-card={viewModel.id}>
      <summary className="battle-card-summary-v1">
        <span className={`battle-result-badge-v1 ${result.tone}`}>
          <span className="battle-result-icon-v1" aria-hidden="true">{resultIcon(result.tone)}</span>
          <strong>{result.label}</strong>
        </span>
        <span className="battle-card-summary-route-v1">
          <strong>{participantLabel(viewModel.attacker.participant)}</strong>
          <span aria-hidden="true">→</span>
          <strong>{participantLabel(viewModel.defender.participant)}</strong>
        </span>
        {saved ? <span className="bcard-keep is-saved" title="Сохранённый отчёт не удаляется">★ сохранён</span>
          : expiresInMs != null ? <span className="bcard-keep" title="Несохранённые отчёты хранятся 8 часов">удалится через {retentionLabel(expiresInMs)}</span> : null}
        <time dateTime={viewModel.timestamp}>{formatBattleDate(viewModel.timestamp)}</time>
        <span className="battle-card-expand-v1" aria-hidden="true">⌄</span>
      </summary>
      <BattleCardSummaryBody viewModel={viewModel} saved={saved} onToggleSaved={onToggleSaved} onOpen={onOpen} />
    </details>
  );
}

function sideTitle(side: BattleSideViewModel) {
  return side.participant.side === 'attacker' ? 'АТАКУЮЩИЙ' : 'ЗАЩИТНИК';
}

type BattleTechnologyId = BattleTechnologyViewModel['id'];

const BATTLE_TECHNOLOGY_ART: Record<BattleTechnologyId, string> = {
  laserScience: laserScienceArt,
  ionScience: ionScienceArt,
  plasmaScience: plasmaScienceArt,
  piercingAttack: piercingAttackArt,
  lightArmor: lightArmorArt,
  mediumArmor: mediumArmorArt,
  heavyArmor: heavyArmorArt,
  shipArmor: shipArmorArt,
  maneuverDefense: maneuverDefenseArt,
  criticalHit: criticalHitArt,
};

const BATTLE_BONUS_GROUPS: readonly { id: string; label: string; technologyIds: readonly BattleTechnologyId[] }[] = [
  { id: 'laserDamage', label: 'Повреждения Лазером', technologyIds: ['laserScience', 'piercingAttack'] },
  { id: 'ionDamage', label: 'Повреждения Ионом', technologyIds: ['ionScience', 'piercingAttack'] },
  { id: 'plasmaDamage', label: 'Повреждения Плазмой', technologyIds: ['plasmaScience', 'piercingAttack'] },
  { id: 'lightArmor', label: 'Лёгкая Броня', technologyIds: ['lightArmor'] },
  { id: 'mediumArmor', label: 'Средняя Броня', technologyIds: ['mediumArmor'] },
  { id: 'heavyArmor', label: 'Тяжёлая Броня', technologyIds: ['heavyArmor'] },
  { id: 'shipLife', label: 'Жизни Кораблей', technologyIds: ['shipArmor', 'maneuverDefense'] },
  { id: 'criticalHit', label: 'Критический удар', technologyIds: ['criticalHit'] },
];

function battleSideInitials(side: BattleSideViewModel) {
  const initials = side.participant.playerName
    .split(/\s+/)
    .map((part) => part[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return initials || (side.participant.side === 'attacker' ? 'АТ' : 'ЗА');
}

function UnitSummaryTable({ side }: { side: BattleSideViewModel }) {
  return (
    <div className="battle-unit-table-v1" data-qa-battle-unit-table={side.participant.side}>
      <div className="battle-unit-table-head-v1"><span>ЕДИНИЦЫ · НАСЕЛЕНИЕ</span><span>БЫЛО</span><span>СТАЛО</span></div>
      <div className="battle-unit-table-row-v1">
        <strong>Население</strong>
        <b>{formatKnownNumber(side.populationBefore)}</b>
        <b>{formatKnownNumber(side.populationAfter)}</b>
      </div>
      <div className="battle-unit-table-row-v1">
        <strong>Корабли</strong>
        <b>{formatKnownNumber(side.fleet.populationBefore)}</b>
        <b>{formatKnownNumber(side.fleet.populationAfter)}</b>
      </div>
      <div className="battle-unit-table-row-v1">
        <strong>Оборона</strong>
        <b>{formatKnownNumber(side.defense.populationBefore)}</b>
        <b>{formatKnownNumber(side.defense.populationAfter)}</b>
      </div>
    </div>
  );
}

function TechnologyBonusTooltip({ technologies }: { technologies: readonly BattleTechnologyViewModel[] }) {
  return (
    <div className="battle-tech-tooltip-v1" role="tooltip">
      {technologies.map((technology) => (
        <span className="battle-tech-tooltip-row-v1" key={technology.id}>
          <img src={BATTLE_TECHNOLOGY_ART[technology.id]} alt="" draggable={false} />
          <span>
            <strong>{technology.name}:</strong>
            <small>{formatNumber(technology.level)} из {formatNumber(technology.maxLevel)} уровня · <b>{technology.effect}</b></small>
          </span>
        </span>
      ))}
    </div>
  );
}

function TechnologyBonusTable({ side }: { side: BattleSideViewModel }) {
  const hasSnapshot = side.technologies.length > 0;
  return (
    <div className="battle-tech-table-v1" data-qa-battle-technologies={side.participant.side}>
      <div className="battle-tech-table-head-v1"><span>ТЕХНОЛОГИИ</span><span>БОНУС</span></div>
      {hasSnapshot ? side.technologies.map((technology) => {
        const bonusText = `+${formatNumber(technology.bonusPercent)}%`;
        return (
          <div
            className="battle-tech-table-row-v1"
            key={technology.id}
            tabIndex={0}
            aria-label={`${technology.name}: уровень ${technology.level} из ${technology.maxLevel}. ${technology.effect}. ${bonusText}.`}
          >
            <span><strong>{technology.name}</strong></span>
            <b>{bonusText}</b>
            <TechnologyBonusTooltip technologies={[technology]} />
          </div>
        );
      }) : <p className="battle-tech-empty-v1">Технологии не зафиксированы.</p>}
    </div>
  );
}

function BattleHeaderSide({ side }: { side: BattleSideViewModel }) {
  const avatar = getFactionGeneralAsset(side.factionId);
  const battleFactionArtId = battleFactionArtIdFor(side.participant.race, side.factionId);
  const battleIcon = asterionAssetIntegrationAssets.battleFactionIcons[battleFactionArtId];
  const participantMeta = [side.participant.coordinates, side.participant.race].filter(Boolean).join(' · ') || 'Идентификатор не зафиксирован';
  return (
    <article className={`battle-header-side-v1 ${side.participant.side}`} data-qa-battle-header-side={side.participant.side}>
      <header className="battle-header-side-head-v1">
        <div className="battle-side-identity-v1">
          <span className="battle-side-avatar-v1" data-qa-battle-side-avatar aria-hidden="true">
            {battleIcon ? <img className="battle-faction-icon" src={battleIcon} alt="" data-qa-battle-faction-icon={battleFactionArtId} draggable={false} /> : avatar ? <FactionGeneralPortrait factionId={side.factionId} /> : <b>{battleSideInitials(side)}</b>}
          </span>
          <div className="battle-side-copy-v1">
            <small>{sideTitle(side)}</small>
            <strong>{side.participant.playerName}</strong>
            <span>{participantMeta}</span>
          </div>
        </div>
        <span className="battle-header-side-mark-v1" aria-hidden="true">{side.participant.side === 'attacker' ? '→' : '◆'}</span>
      </header>
      <UnitSummaryTable side={side} />
      <TechnologyBonusTable side={side} />
    </article>
  );
}

function PopulationPanel({ viewModel }: { viewModel: BattleReportViewModel }) {
  return (
    <section className="battle-summary-v1" data-qa-battle-summary>
      <div className="battle-header-sides-v1">
        <BattleHeaderSide side={viewModel.attacker} />
        <BattleHeaderSide side={viewModel.defender} />
      </div>
    </section>
  );
}

function commanderEffectText(effect: ReturnType<typeof getCommanderCombatEffect>, effectValue: number | null) {
  if (!effect || effectValue == null) return null;
  const value = formatNumber(effectValue);
  if (effect.kind === 'attack-bonus') return `Увеличивает атаку флота на ${value}%.`;
  if (effect.kind === 'life-bonus') return `Увеличивает жизнь флота на ${value}%.`;
  if (effect.kind === 'armor-debuff') return `Снижает броню противника на ${value} процентных пунктов.`;
  if (effect.kind === 'critical') return `Увеличивает шанс критического удара на ${value}%.`;
  if (effect.kind === 'paralyze') return `Увеличивает шанс парализовать ближайшую атаку противника на ${value}%.`;
  if (effect.kind === 'cancel-attack') return `Даёт ${value}% шанс отменить ближайшую атаку противника.`;
  if (effect.kind === 'reanimator') return `Даёт ${value}% шанс восстановить до ${formatNumber(effect.cap)} кораблей.`;
  return null;
}

function CommanderSnapshot({ viewModel }: { viewModel: BattleReportViewModel }) {
  const commanderRows = [viewModel.attacker, viewModel.defender].map((side) => ({ side, commander: side.activeCommander }));

  return (
    <section className="battle-section-v1" data-qa-battle-commanders>
      <header className="battle-section-head-v1"><div><small>КОМАНДИРЫ</small><h3>КОМАНДИРЫ И БОНУСЫ</h3></div></header>
      {commanderRows.length ? (
        <div className="battle-commanders-v1">
          {commanderRows.map(({ side, commander }) => {
            const ability = commander && isCommanderId(commander.entityId) ? COMMANDER_ABILITIES[commander.entityId] : null;
            const effect = commander && isCommanderId(commander.entityId) ? getCommanderCombatEffect(commander.entityId) : null;
            const level = commander?.tooltip.level ?? null;
            const effectValue = effect && level != null ? effect.ratePerLevel * level * 100 : null;
            const effectText = commanderEffectText(effect, effectValue);
            return (
              <article key={`${side.participant.side}-${commander?.entityId ?? 'none'}`}>
                {commander ? <img src={commander.art} alt="" draggable={false} /> : <span className="battle-commander-empty-v1" aria-hidden="true">—</span>}
                <div>
                  <small>{side.participant.side === 'attacker' ? 'АТАКУЮЩИЙ' : 'ЗАЩИТНИК'}</small>
                  <strong>{commander?.name ?? 'Командир не выбран'}</strong>
                  {commander ? <span>Уровень {formatNumber(level)}</span> : null}
                  {ability ? <span>{ability.ability}</span> : null}
                  <em>{effectText ?? ability?.description ?? (commander ? 'Эффект этого командира не указан.' : 'Командир не выбран.')}</em>
                </div>
              </article>
            );
          })}
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
  const actionLabel = {
    attack: 'АТАКА',
    ability: 'СПОСОБНОСТЬ',
    shield: 'ЩИТ',
    status: 'СТАТУС',
    destroyed: 'УНИЧТОЖЕНИЕ',
    'special-bonus': 'БОНУС ГРУППЫ',
  }[event.actionType];
  const eventNote = event.note
    ?.replace(/Нейтральный модификатор пары/g, 'Обычное взаимодействие')
    .replace(/Модификатор пары/g, 'Бонус взаимодействия')
    .replace(/Следующая живая цель выбирается заново\./g, 'Следующая цель выбирается автоматически.')
    .replace(/combat-eligible стеки/g, 'боевые группы')
    .replace(/живых юнитов/g, 'живых кораблей')
    .replace(/rate /g, 'коэффициент ')
    .replace(/cap unknown/g, 'без верхнего ограничения')
    .replace(/cap /g, 'предел ')
    .replace(/итог /g, 'результат ');

  return (
    <article className="battle-event-v1" data-qa-battle-event={event.sequence} data-qa-battle-event-action={event.actionType}>
      <header className="battle-event-head-v1">
        <small>СОБЫТИЕ {formatNumber(event.sequence)}</small>
        <b>{actionLabel}</b>
      </header>
      <div className={`battle-event-route-v1 ${event.targetEntityId ? '' : 'no-target'}`}>
        <span><img src={event.actor.art} alt="" /><strong>{event.actor.name}{countSuffix(event.actorCount)}</strong></span>
        {event.targetEntityId ? <><i aria-hidden="true">→</i><span><img src={event.target.art} alt="" /><strong>{event.target.name}{countSuffix(event.targetCount)}</strong></span></> : <span className="battle-event-no-target-v1">{event.actionType === 'special-bonus' ? 'СОЮЗНЫЕ СТЕКИ' : 'ЦЕЛЬ НЕ НАЙДЕНА'}</span>}
      </div>
      <div className="battle-event-metrics-v1">
        {event.attackPerUnit != null ? <span><small>АТАКА · 1 КОРАБЛЬ</small><b>{formatNumber(event.attackPerUnit)}</b></span> : null}
        {event.attackValue != null ? <span><small>АТАКА · ГРУППА</small><b>{formatNumber(event.attackValue)}</b></span> : null}
        {event.baseAttack != null && event.baseAttack !== event.attackValue ? <span><small>БАЗОВАЯ АТАКА ГРУППЫ</small><b>{formatNumber(event.baseAttack)}</b></span> : null}
        {event.damage != null ? <span><small>УРОН</small><b>{formatNumber(event.damage)}</b></span> : null}
        {event.rawDamageBeforeArmor != null ? <span><small>УРОН ДО БРОНИ</small><b>{formatNumber(event.rawDamageBeforeArmor)}</b></span> : null}
        {event.rawDamage != null && event.rawDamage !== event.rawDamageBeforeArmor ? <span><small>УРОН ПОСЛЕ КРИТА</small><b>{formatNumber(event.rawDamage)}</b></span> : null}
        {event.effectiveDamage != null ? <span><small>ПОСЛЕ БРОНИ</small><b>{formatNumber(event.effectiveDamage)}</b></span> : null}
        {event.mitigation != null ? <span><small>СНИЖЕНО БРОНЁЙ</small><b>{formatNumber(event.mitigation)}</b></span> : null}
        {event.matchupMultiplier != null ? <span><small>ВЗАИМОДЕЙСТВИЕ ТИПОВ</small><b>×{event.matchupMultiplier.toFixed(2)}</b></span> : null}
        {event.reportedBonus != null && event.reportedBonus !== 0 ? <span><small>ДОПОЛНИТЕЛЬНЫЙ УРОН</small><b>{event.reportedBonus > 0 ? '+' : ''}{formatNumber(event.reportedBonus)}</b></span> : null}
        {event.destroyedCount != null ? <span><small>УНИЧТОЖЕНО</small><b>{formatNumber(event.destroyedCount)}</b></span> : null}
        {event.criticalChance != null ? <span><small>КРИТИЧЕСКИЙ УДАР</small><b>{formatNumber(event.criticalChance * 100)}%{event.criticalMultiplier && event.criticalMultiplier > 1 ? ' · ×2' : ''}</b></span> : null}
        {event.abilityChance != null ? <span><small>СРАБАТЫВАНИЕ СПОСОБНОСТИ</small><b>{formatNumber(event.abilityChance * 100)}%</b></span> : null}
        {event.abilityBonus != null ? <span><small>ДОЛЯ ВОССТАНОВЛЕНИЯ</small><b>{formatNumber(event.abilityBonus * 100)}%</b></span> : null}
        {event.repairedCount != null ? <span><small>ВОССТАНОВЛЕНО</small><b>{formatNumber(event.repairedCount)}{event.repairLimit != null ? ` / ${formatNumber(event.repairLimit)}` : ''}</b></span> : null}
        {event.specialBonusAmount != null ? <span><small>БОНУС НАЧАЛА РАУНДА</small><b>{formatNumber(event.specialBonusAmount * 100)}{event.specialBonusKind === 'armor' ? ' п.п.' : '%'}</b></span> : null}
        <OptionalMetric label="ЩИТ" before={event.shieldBefore} after={event.shieldAfter} />
        <OptionalMetric label="БРОНЯ" before={event.armorBefore} after={event.armorAfter} />
        <OptionalMetric label="ЖИЗНЬ" before={event.lifeBefore} after={event.lifeAfter} />
      </div>
      {event.commanderAbility ? <div className="battle-event-ability-v1">◆ {event.commanderAbility}</div> : null}
      {event.shipAbility ? <div className="battle-event-ability-v1">◆ {event.shipAbility}</div> : null}
      {eventNote ? <p>{eventNote}</p> : null}
    </article>
  );
}

function OperationOutcome({ report }: { report: BattleReport }) {
  const resourceEntries = report.resources
    ? ([['metal', 'Металл', report.resources.metal], ['minerals', 'Минералы', report.resources.minerals], ['gas', 'Газ', report.resources.gas]] as const).filter(([, , value]) => value != null)
    : [];
  if (report.experience == null && report.debris == null && !resourceEntries.length) return null;
  return (
    <section className="battle-section-v1 battle-outcome-v1">
      <header className="battle-section-head-v1"><div><small>ИТОГ</small><h3>РЕЗУЛЬТАТЫ ОПЕРАЦИИ</h3></div></header>
      <div>
        {report.experience != null ? <span><small>БОЕВОЙ ОПЫТ</small><strong>{formatNumber(report.experience)}</strong></span> : null}
        {resourceEntries.map(([kind, label, value]) => <span className="battle-outcome-resource" key={label} data-qa-resource-kind={kind}><span className="battle-outcome-resource-icon"><ResourceIcon kind={kind} /></span><small>{label.toUpperCase()}</small><strong>{formatNumber(value!)}</strong></span>)}
      </div>
      {report.debris != null ? <div className="battle-detail-orbit-debris-v1" data-qa-debris-orbit><span className="battle-outcome-resource-icon"><ResourceIcon kind="debris" /></span><span><small>ОСТАЛИСЬ НА ОРБИТЕ</small><strong>ОБЛОМКИ НА ОРБИТЕ · {formatNumber(report.debris)}</strong><em>Не доставлены атакующим флотом.</em></span></div> : null}
    </section>
  );
}

function scrollTargetFor(details: HTMLDetailsElement, preferred?: ScrollRef) {
  if (preferred?.current) return preferred.current;
  return details.closest<HTMLElement>('.battle-report-modal-scroll-v1, .fleet-main-v1') ?? document.documentElement;
}

function RoundAnalysis({ round, scrollRef }: { round: BattleRoundViewModel; scrollRef?: ScrollRef }) {
  const savedScrollTop = useRef(0);
  const [open, setOpen] = useState(false);
  const eventsId = `battle-round-events-${round.index}-${round.events[0]?.sequence ?? 'empty'}`;
  const rememberScroll = (event: MouseEvent<HTMLDetailsElement>) => {
    savedScrollTop.current = scrollTargetFor(event.currentTarget, scrollRef).scrollTop;
  };
  const restoreScroll = (event: SyntheticEvent<HTMLDetailsElement>) => {
    const target = scrollTargetFor(event.currentTarget, scrollRef);
    requestAnimationFrame(() => { target.scrollTop = savedScrollTop.current; });
  };
  const handleToggle = (event: SyntheticEvent<HTMLDetailsElement>) => {
    setOpen(event.currentTarget.open);
    restoreScroll(event);
  };

  return (
    <details className="battle-round-analysis-v1" data-qa-battle-round-analysis={round.index} open={open} onClick={rememberScroll} onToggle={handleToggle}>
      <summary aria-expanded={open} aria-controls={eventsId}>АНАЛИЗ РАУНДА <span>{round.events.length} СОБЫТИЙ</span></summary>
      {round.events.length ? (
        <div id={eventsId} className="battle-event-list-v1" data-qa-battle-events={round.events.length}>
          {round.events.map((event) => <EventCard key={`${round.index}-${event.sequence}`} event={event} />)}
        </div>
      ) : round.analysis.length ? (
        <ul id={eventsId}>{round.analysis.map((line, index) => <li key={`${round.index}-${index}`}>{line}</li>)}</ul>
      ) : (
        <p id={eventsId}>Подробности событий для этого отчёта отсутствуют.</p>
      )}
    </details>
  );
}

function entityKindLabel(kind: BattleEntityKind) {
  if (kind === 'commander') return 'командирский корабль';
  if (kind === 'defense') return 'оборона';
  if (kind === 'ship') return 'корабль';
  return BATTLE_MISSING_DATA;
}

function tooltipAriaLabel(stack: BattleStackViewModel) {
  return `${stack.name}, ${entityKindLabel(stack.kind)}, количество до действий ${formatNumber(stack.countBefore)}`;
}

function sceneCount(stack: BattleStackViewModel) {
  return stack.countBefore ?? stack.countAfter;
}

function SceneStack({ stack, side, roundIndex }: { stack: BattleStackViewModel; side: 'attacker' | 'defender'; roundIndex: number }) {
  const tooltipId = `battle-tooltip-${roundIndex}-${side}-${stack.key.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  const isDefense = stack.kind === 'defense';
  const count = sceneCount(stack);
  return (
    <button
      type="button"
      className={`battle-scene-stack-v1 ${side} ${isDefense ? 'defense' : ''}`}
      data-qa-battle-stack={stack.entityId}
      data-qa-battle-stack-kind={stack.kind}
      data-qa-battle-stack-count={count == null ? '' : count}
      data-qa-battle-stack-count-after={stack.countAfter == null ? '' : stack.countAfter}
      aria-label={tooltipAriaLabel(stack)}
      aria-describedby={tooltipId}
      onClick={(event) => event.preventDefault()}
    >
      <span className="battle-scene-sprite-v1">
        <img src={stack.art} alt="" draggable={false} />
        <span className="battle-scene-count-v1">{formatNumber(count)}</span>
      </span>
      <span id={tooltipId} className="battle-scene-tooltip-v1" role="tooltip">
        <strong>{stack.tooltip.name}</strong>
        <span>{stack.tooltip.type}</span>
        {!isDefense ? <span>Уровень: <b>{formatNumber(stack.tooltip.level)}</b></span> : null}
        <span>Атака 1 корабля: <b>{formatNumber(stack.attackPerUnit)}</b></span>
        <span>Атака всей группы: <b>{formatNumber(stack.totalAttack)}</b></span>
        <span>Жизнь 1 корабля: <b>{formatNumber(stack.lifePerUnit)}</b></span>
        <span>Жизнь всей группы: <b>{formatNumber(stack.hpPool)}</b></span>
        <span>Броня: <b>{formatNumber(stack.tooltip.armor)}</b></span>
      </span>
    </button>
  );
}

function isSceneVisible(stack: BattleStackViewModel) {
  const count = sceneCount(stack);
  return count == null || count > 0;
}

function SceneSide({ stacks, side, roundIndex }: { stacks: BattleStackViewModel[]; side: 'attacker' | 'defender'; roundIndex: number }) {
  const visible = stacks.filter(isSceneVisible);
  const regular = visible.filter((stack) => stack.kind !== 'commander');
  const commanders = visible.filter((stack) => stack.kind === 'commander');
  return (
    <div className={`battle-scene-side-v1 ${side}`} aria-label={side === 'attacker' ? 'Корабли атакующего' : 'Корабли защитника'}>
      <div className="battle-scene-zone-v1">
        {regular.map((stack) => <SceneStack key={stack.key} stack={stack} side={side} roundIndex={roundIndex} />)}
      </div>
      {commanders.length ? (
        <div className="battle-scene-commander-zone-v1" aria-label="Командирские корабли">
          {commanders.map((stack) => <SceneStack key={stack.key} stack={stack} side={side} roundIndex={roundIndex} />)}
        </div>
      ) : null}
    </div>
  );
}

function BattleVisualReport({ viewModel, scrollRef, celestialMode = 'planet' }: { viewModel: BattleReportViewModel; scrollRef?: ScrollRef; celestialMode?: BattleCelestialMode }) {
  return (
    <section className="battle-section-v1 battle-visual-report-v1" data-qa-battle-visual-report>
      <header className="battle-section-head-v1">
        <div><small>ВИЗУАЛ БОЯ</small><h3>РАУНДЫ</h3></div>
        <span>{formatNumber(viewModel.roundCount)} РАУНДОВ</span>
      </header>
      <div className="battle-scene-list-v1">
        {viewModel.rounds.length ? viewModel.rounds.map((round) => {
          const attackerStacks = round.attackerSnapshot?.stacks ?? [];
          const defenderStacks = round.defenderSnapshot?.stacks ?? [];
          const defenses = (round.defenderSnapshot?.defenses ?? []).filter(isSceneVisible);
          return (
            <article className="battle-round-report-v1" key={`${viewModel.id}-${round.index}`} data-qa-battle-visual-round={round.index}>
              <div className="battle-round-report-head-v1"><div><strong>РАУНД {round.index}</strong><small>СОСТАВ НА НАЧАЛО РАУНДА</small></div><span>КОРАБЛИ И ОБОРОНА</span></div>
              <div
                className="battle-scene-v1"
                data-qa-battle-scene={round.index}
                data-qa-battle-cell-size="100px"
                data-qa-battle-celestial-mode={celestialMode}
                style={{
                  '--battle-space-image': `url("${battleSpaceBackground}")`,
                  '--battle-celestial-planet-image': `url("${battlePlanet}")`,
                  '--battle-fleet-rows': round.fleetRows,
                } as CSSProperties}
              >
                <div className="battle-scene-space-layer-v1" aria-hidden="true" />
                <div className="battle-scene-fleet-field-v1">
                  <div className="battle-scene-side-label-v1 attacker"><span>АТАКУЮЩИЙ</span><strong>{participantLabel(viewModel.attacker.participant)}</strong></div>
                  <div className="battle-scene-side-label-v1 defender"><span>ЗАЩИТНИК</span><strong>{participantLabel(viewModel.defender.participant)}</strong></div>
                  <div className="battle-scene-fleet-grid-v1">
                    <SceneSide stacks={attackerStacks} side="attacker" roundIndex={round.index} />
                    <SceneSide stacks={defenderStacks} side="defender" roundIndex={round.index} />
                  </div>
                </div>
                <div className="battle-scene-celestial-layer-v2" data-qa-battle-celestial-layer>
                  <div className="battle-scene-celestial-object-v2" data-qa-battle-celestial-object aria-hidden="true" />
                  {defenses.length ? (
                    <div className="battle-scene-defense-zone-v1" data-qa-battle-defense-zone aria-label="Оборона защитника">
                      {defenses.map((stack) => <SceneStack key={stack.key} stack={stack} side="defender" roundIndex={round.index} />)}
                    </div>
                  ) : null}
                </div>
              </div>
              <p className="battle-round-state-v1">{roundStateLine(round)}</p>
              <p className="battle-round-action-v1">{roundActionLine(round)}</p>
              <RoundAnalysis round={round} scrollRef={scrollRef} />
            </article>
          );
        }) : <p className="battle-empty-inline-v1">Визуальные данные раундов отсутствуют.</p>}
      </div>
    </section>
  );
}

function roundStateLine(round: BattleRoundViewModel) {
  const attacker = round.attackerSnapshot;
  const defender = round.defenderSnapshot;
  if (!attacker && !defender) return 'Состояние сторон для этого раунда не зафиксировано.';
  const parts = [
    `До действий: флот атакующего — ${formatKnownNumber(attacker?.fleetPopulationBefore)} населения, защитника — ${formatKnownNumber(defender?.fleetPopulationBefore)} населения`,
    `после действий: флот атакующего — ${formatKnownNumber(attacker?.fleetPopulationAfter)} населения, защитника — ${formatKnownNumber(defender?.fleetPopulationAfter)} населения`,
  ];
  if (defender?.defensePopulationBefore != null || defender?.defensePopulationAfter != null) {
    parts.push(`оборона защитника: ${formatKnownNumber(defender.defensePopulationBefore)} → ${formatKnownNumber(defender.defensePopulationAfter)} населения`);
  }
  return parts.join(' · ');
}

function roundActionLine(round: BattleRoundViewModel) {
  const snapshotPopulation = (snapshot: BattleRoundViewModel['attackerSnapshot'], includeDefense = false) => {
    if (!snapshot || snapshot.fleetPopulationAfter == null) return null;
    if (!includeDefense || snapshot.defensePopulationAfter == null) return snapshot.fleetPopulationAfter;
    return snapshot.fleetPopulationAfter + snapshot.defensePopulationAfter;
  };
  const summary = round.summary ?? (() => {
    const knownDamage = round.events.map((event) => event.damage).filter((damage): damage is number => damage != null);
    const destroyedEvents = round.events.filter((event) => event.destroyedCount != null);
    const knownDestroyedPopulation = destroyedEvents.map((event) => event.target.populationPerUnit != null && event.destroyedCount != null
      ? event.target.populationPerUnit * event.destroyedCount
      : null);
    const knownRepairs = round.events.map((event) => event.repairedCount).filter((repairs): repairs is number => repairs != null);
    return {
      attackerDamage: knownDamage.length ? round.events.reduce((total, event) => total + (event.actorSide === 'attacker' ? event.damage ?? 0 : 0), 0) : null,
      defenderDamage: knownDamage.length ? round.events.reduce((total, event) => total + (event.actorSide === 'defender' ? event.damage ?? 0 : 0), 0) : null,
      destroyedUnits: destroyedEvents.length ? destroyedEvents.reduce((total, event) => total + (event.destroyedCount ?? 0), 0) : null,
      destroyedPopulation: knownDestroyedPopulation.length && knownDestroyedPopulation.every((population): population is number => population != null)
        ? knownDestroyedPopulation.reduce((total, population) => total + population, 0)
        : null,
      procs: round.events.filter((event) => event.actionType === 'ability').length,
      repairs: knownRepairs.length ? knownRepairs.reduce((total, repairs) => total + repairs, 0) : 0,
      survivingPopulation: {
        attacker: snapshotPopulation(round.attackerSnapshot),
        defender: snapshotPopulation(round.defenderSnapshot, true),
      },
      survivingDefensePopulation: round.defenderSnapshot?.defensePopulationAfter ?? null,
    };
  })();
  const parts: string[] = [];
  if (summary.attackerDamage != null || summary.defenderDamage != null) {
    parts.push(`урон: атакующий ${formatKnownNumber(summary.attackerDamage)}, защитник ${formatKnownNumber(summary.defenderDamage)}`);
  }
  if (summary.destroyedPopulation != null || summary.destroyedUnits != null) {
    parts.push(`потери: ${formatKnownNumber(summary.destroyedPopulation ?? summary.destroyedUnits)}${summary.destroyedPopulation != null ? ' населения' : ' кораблей'}${summary.destroyedUnits != null ? ` (${formatKnownNumber(summary.destroyedUnits)} кораблей/сооружений)` : ''}`);
  }
  if (summary.procs != null || summary.repairs != null) {
    parts.push(`способности: ${formatKnownNumber(summary.procs)}, восстановлено ${formatKnownNumber(summary.repairs)}`);
  }
  if (summary.survivingPopulation.attacker != null || summary.survivingPopulation.defender != null) {
    parts.push(`остаток населения: атакующий ${formatKnownNumber(summary.survivingPopulation.attacker)}, защитник ${formatKnownNumber(summary.survivingPopulation.defender)}`);
  }
  if (summary.survivingDefensePopulation != null) parts.push(`оборона: ${formatKnownNumber(summary.survivingDefensePopulation)} населения`);
  return parts.length ? parts.join(' · ') : 'В этом раунде числовых изменений не зафиксировано.';
}

type BattleOutcomeStat = {
  id: 'population' | 'ships' | 'defense';
  label: string;
  unit: string;
  before: number | null;
  after: number | null;
};

function outcomeStats(side: BattleSideViewModel): BattleOutcomeStat[] {
  return [
    { id: 'population', label: 'Население', unit: 'населения', before: side.populationBefore, after: side.populationAfter },
    { id: 'ships', label: 'Корабли · население', unit: '', before: side.fleet.populationBefore, after: side.fleet.populationAfter },
    { id: 'defense', label: 'Оборона · население', unit: '', before: side.defense.populationBefore, after: side.defense.populationAfter },
  ];
}

function formatOutcomeWithUnit(value: number | null, unit: string) {
  return value == null ? '—' : unit ? `${formatNumber(value)} ${unit}` : formatNumber(value);
}

function OutcomeIntro({
  viewModel,
  result,
  winnerName,
  className = '',
}: {
  viewModel: BattleReportViewModel;
  result: ReturnType<typeof resultLabel>;
  winnerName: string | null;
  className?: string;
}) {
  return (
    <header className={`battle-outcome-option-head-v1 ${className}`}>
      <div>
        <small>ИТОГ БОЯ</small>
        <div className={`battle-outcome-title-v1 ${result.tone}`}><span aria-hidden="true">{resultIcon(result.tone)}</span><h3>{result.label}</h3></div>
        <p>{winnerName ? `${winnerName} — победитель боя.` : 'Победитель не определён: достигнут лимит раундов.'}</p>
      </div>
      <span>{formatNumber(viewModel.roundCount)} РАУНДОВ</span>
    </header>
  );
}

function OutcomeSideHeader({ side, winner }: { side: BattleSideViewModel; winner: boolean }) {
  const sideLabel = side.participant.side === 'attacker' ? 'АТАКУЮЩИЙ' : 'ЗАЩИТНИК';
  const participantMeta = [side.participant.coordinates, side.participant.race].filter(Boolean).join(' · ') || 'Данные участника не зафиксированы';
  return (
    <header className="battle-outcome-side-head-v1">
      <small>{sideLabel}{winner ? ' · ПОБЕДИТЕЛЬ' : ''}</small>
      <strong>{side.participant.playerName}</strong>
      <span>{participantMeta}</span>
    </header>
  );
}

function OutcomeMiniStateTable({ side, className = '' }: { side: BattleSideViewModel; className?: string }) {
  return (
    <div className={`battle-outcome-mini-table-v1 ${className}`}>
      <div className="battle-outcome-mini-table-head-v1"><span>ПАРАМЕТР</span><span>БЫЛО</span><span>ОСТАЛОСЬ</span></div>
      {outcomeStats(side).map((stat) => (
        <div className="battle-outcome-mini-table-row-v1" key={stat.id}>
          <strong>{stat.label}</strong>
          <b>{formatOutcomeWithUnit(stat.before, stat.unit)}</b>
          <b>{formatOutcomeWithUnit(stat.after, stat.unit)}</b>
        </div>
      ))}
    </div>
  );
}

function OutcomePointsPanel({
  sideLabel,
  missionType,
  points,
  resourcePointsLost,
  winner,
  className = '',
}: {
  sideLabel: string;
  missionType: BattleReportViewModel['missionType'];
  points: number | null;
  resourcePointsLost: number;
  winner: boolean;
  className?: string;
}) {
  const awardDisplay = getBattlePointAwardDisplay(missionType, points);
  return (
    <div className={`battle-outcome-points-panel-v1 ${winner ? 'winner' : ''} ${className}`} data-qa-battle-points data-qa-battle-award-state={awardDisplay.state}>
      <div><small>{sideLabel} · {awardDisplay.label}</small><strong>{awardDisplay.state === 'not-awarded' ? '—' : awardDisplay.points == null ? 'Не зафиксировано' : formatNumber(awardDisplay.points)}</strong></div>
      <div><small>РЕСУРСНЫЕ ОЧКИ · ПОТЕРЯНО</small><b>−{formatResourcePoints(resourcePointsLost)}</b><span>очков</span></div>
    </div>
  );
}

function OutcomeRewardStrip({ viewModel, className = '' }: { viewModel: BattleReportViewModel; className?: string }) {
  const hasRewards = viewModel.experience != null || viewModel.resources.length > 0;
  return (
    <section className={`battle-outcome-reward-strip-v1 ${className}`}>
      <header><small>НАГРАДЫ И ДОБЫЧА</small><span>ПОЛУЧЕНО ПОСЛЕ БОЯ</span></header>
      {hasRewards ? (
        <div className="battle-outcome-reward-grid-v1">
          <div><small>БОЕВОЙ ОПЫТ</small><strong>{formatKnownNumber(viewModel.experience)}</strong></div>
          {viewModel.resources.map((resource) => <div className="battle-outcome-reward-resource-v1" key={resource.kind} data-qa-resource-kind={resource.kind}><span><ResourceIcon kind={resource.kind} /></span><small>{resource.label.toUpperCase()}</small><strong>{formatNumber(resource.value)}</strong></div>)}
        </div>
      ) : <p className="battle-empty-inline-v1">Награды и ресурсы не зафиксированы в этом отчёте.</p>}
    </section>
  );
}

function BattleOutcomeSummary({ viewModel, result, winnerName }: { viewModel: BattleReportViewModel; result: ReturnType<typeof resultLabel>; winnerName: string | null }) {
  const sides = [
    { side: viewModel.attacker, label: 'АТАКУЮЩИЙ', points: viewModel.awardedBattlePoints?.attacker ?? null, resourcePointsLost: viewModel.battlePoints.attackerResourcePointsLost },
    { side: viewModel.defender, label: 'ЗАЩИТНИК', points: viewModel.awardedBattlePoints?.defender ?? null, resourcePointsLost: viewModel.battlePoints.defenderResourcePointsLost },
  ];
  return (
    <div className="battle-outcome-duel-v1">
      <OutcomeIntro viewModel={viewModel} result={result} winnerName={winnerName} />
      <div className="battle-outcome-duel-grid-v1">
        {sides.map(({ side, label, points, resourcePointsLost }) => (
          <article className={`battle-outcome-duel-side-v1 ${side.participant.side} ${viewModel.winner === side.participant.side ? 'winner' : ''}`} key={side.participant.side}>
            <OutcomeSideHeader side={side} winner={viewModel.winner === side.participant.side} />
            <OutcomeMiniStateTable side={side} />
            <OutcomePointsPanel sideLabel={label} missionType={viewModel.missionType} points={points} resourcePointsLost={resourcePointsLost} winner={viewModel.winner === side.participant.side || (viewModel.winner === 'draw' && points === Math.max(viewModel.battlePoints.attacker, viewModel.battlePoints.defender))} />
          </article>
        ))}
      </div>
      <OutcomeRewardStrip viewModel={viewModel} />
      {viewModel.debrisOnOrbit != null ? <div className="battle-detail-orbit-debris-v1" data-qa-debris-orbit><span className="battle-outcome-resource-icon"><ResourceIcon kind="debris" /></span><span><small>ОСТАЛИСЬ НА ОРБИТЕ</small><strong>ОБЛОМКИ НА ОРБИТЕ · {formatNumber(viewModel.debrisOnOrbit)}</strong><em>Не доставлены атакующим флотом.</em></span></div> : null}
    </div>
  );
}

function BattleOutcome({ viewModel }: { viewModel: BattleReportViewModel }) {
  const result = resultLabel(viewModel);
  const winnerSide = viewModel.winner === 'draw' ? null : viewModel.winner === 'attacker' ? viewModel.attacker : viewModel.defender;
  const winnerName = winnerSide ? participantLabel(winnerSide.participant) : null;
  return (
    <section className="battle-section-v1 battle-outcome-v1" data-qa-battle-outcome>
      <BattleOutcomeSummary viewModel={viewModel} result={result} winnerName={winnerName} />
    </section>
  );
}

function SiegeDestroyerList({ label, destroyers }: { label: string; destroyers: BattleSiegeViewModel['attackerDestroyers'] }) {
  return (
    <div className="battle-siege-contribution-v1">
      <header><small>{label}</small><strong>ПРОФИЛИ ПЛАНЕТОЛОМОВ</strong></header>
      {destroyers.length ? destroyers.map((destroyer, index) => (
        <div className="battle-siege-contribution-row-v1" key={`${destroyer.factionId ?? 'unknown'}-${index}`}>
          <span><b>{destroyer.factionId ?? BATTLE_MISSING_DATA}</b><em>уровень {formatNumber(destroyer.level)} · выжило {formatNumber(destroyer.survivors)}</em></span>
          <span><small>ОЧКИ / ШАНС</small><strong>{formatNumber(destroyer.scaledDemolitionPoints)} / {formatBps(destroyer.scaledDestructionChanceBps)}</strong></span>
          <span><small>АТАКА / ЖИЗНЬ · БАЗА</small><strong>{formatNumber(destroyer.baseAttack)} / {formatNumber(destroyer.baseLife)}</strong></span>
        </div>
      )) : <p className="battle-siege-empty-v1">Планетоломы не зафиксированы.</p>}
    </div>
  );
}

function BattleSiegeDetail({ viewModel }: { viewModel: BattleReportViewModel }) {
  const siege = viewModel.siege;
  if (!siege) return null;
  const demolition = siege.demolition;
  const destruction = siege.destruction;
  return (
    <section className="battle-section-v1 battle-siege-detail-v1" data-qa-siege-detail>
      <header className="battle-section-head-v1"><div><small>ПОСЛЕ БОЯ</small><h3>ОСАДА ПЛАНЕТЫ</h3></div><span>{siege.targetCoordinate ?? BATTLE_MISSING_DATA}</span></header>
      <div className="battle-siege-contributions-v1">
        <SiegeDestroyerList label="АТАКУЮЩИЙ" destroyers={siege.attackerDestroyers} />
        <SiegeDestroyerList label="ЗАЩИТНИК" destroyers={siege.defenderDestroyers} />
      </div>
      <div className="battle-siege-ledger-v1">
        <article>
          <header><small>ДЕМОЛИЦИЯ</small><strong>РАЗРУШЕНИЕ ЗДАНИЙ</strong></header>
          <div className="battle-siege-metrics-v1">
            <span><small>СЫРЫЕ ОЧКИ</small><b>{formatNumber(demolition.rawPoints)}</b></span>
            <span><small>СНИЖЕНО ОБОРОНОЙ</small><b>−{formatNumber(demolition.defenseReductionPoints)}</b></span>
            <span><small>ИТОГОВЫЕ ОЧКИ</small><b>{formatNumber(demolition.finalPoints)}</b></span>
            <span><small>ШАНС / ANNIHILATOR</small><b>{formatBps(demolition.baseChanceBps)} / +{formatBps(demolition.annihilatorBonusBps)}</b></span>
          </div>
          <div className="battle-siege-table-v1">
            <div className="battle-siege-table-head-v1"><span>ЗДАНИЕ</span><span>УРОВЕНЬ</span><span>ШАНС / БРОСОК</span><span>РЕЗУЛЬТАТ</span></div>
            {demolition.rolls.length ? demolition.rolls.map((roll) => (
              <div className="battle-siege-table-row-v1" key={roll.buildingId}>
                <strong>{roll.buildingName}</strong>
                <span>{formatNumber(roll.beforeLevel)} → {formatNumber(roll.afterLevel)}</span>
                <span>{formatBps(roll.chanceBps)} / {(roll.roll * 100).toFixed(2)}%</span>
                <b className={roll.success ? 'success' : 'fail'}>{roll.success ? 'СНЕСЕНО' : 'СОХРАНЕНО'}</b>
              </div>
            )) : <p className="battle-siege-empty-v1">Броски по зданиям не проводились.</p>}
          </div>
          <p className="battle-siege-status-v1">{demolition.blockedReason ? siegeReasonLabel(demolition.blockedReason) : `Выбрано зданий: ${formatNumber(demolition.selectedBuildingCount)} · затронуто уровней: ${formatNumber(demolition.destroyedBuildingLevels)}.`}</p>
        </article>
        <article>
          <header><small>РАЗРУШЕНИЕ ПЛАНЕТЫ</small><strong>{siege.planetDestroyed ? 'ПЛАНЕТА УНИЧТОЖЕНА' : 'ПЛАНЕТА СОХРАНЕНА'}</strong></header>
          <div className="battle-siege-metrics-v1">
            <span><small>СЫРОЙ ШАНС</small><b>{formatBps(destruction.rawChanceBps)}</b></span>
            <span><small>СНИЖЕНО ОБОРОНОЙ</small><b>−{formatBps(destruction.defenseReductionBps)}</b></span>
            <span><small>СНИЖЕНО ПЛАНЕТОЛОМАМИ</small><b>−{formatBps(destruction.defenderDestroyerReductionBps)}</b></span>
            <span><small>POLIAS</small><b>−{formatBps(destruction.poliasReductionBps)}</b></span>
            <span><small>ИТОГОВЫЙ ШАНС</small><b>{formatBps(destruction.finalChanceBps)}</b></span>
            <span><small>БРОСОК</small><b>{destruction.roll == null ? '—' : `${(destruction.roll * 100).toFixed(2)}%`}</b></span>
          </div>
          <p className="battle-siege-status-v1">{destruction.blockedReason ? siegeReasonLabel(destruction.blockedReason) : destruction.success ? 'Бросок успешен: цель удалена из авторитетного реестра.' : 'Бросок не достиг итогового шанса: цель сохранена.'}</p>
          <p className="battle-siege-orbit-note-v1">Обычные обломки боя остаются на орбите и не превращаются в дополнительную награду за уничтожение планеты.</p>
        </article>
      </div>
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
      <BattleOutcome viewModel={viewModel} />
      <BattleSiegeDetail viewModel={viewModel} />
      <PopulationPanel viewModel={viewModel} />
      <CommanderSnapshot viewModel={viewModel} />
      <BattleVisualReport viewModel={viewModel} scrollRef={scrollRef} />
    </>
  );
}

const FOCUSABLE_SELECTOR = 'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex]:not([tabindex="-1"])';

export function BattleReportModal({
  report,
  viewModel: providedViewModel,
  saved = false,
  onToggleSaved,
  onClose,
  context = 'battle',
}: {
  report: BattleReport;
  viewModel?: BattleReportViewModel;
  saved?: boolean;
  onToggleSaved?: () => void;
  onClose: () => void;
  context?: 'battle' | 'simulation';
}) {
  const viewModel = providedViewModel ?? createBattleReportViewModel(report);
  const modalRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const titleId = `battle-report-modal-title-${viewModel.id}`;
  const result = resultLabel(viewModel);

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
      className="battle-report-overlay-v1 ops6"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section ref={modalRef} className="battle-report-modal-v1" role="dialog" aria-modal="true" aria-labelledby={titleId} data-qa-battle-report-modal={viewModel.id} data-qa-battle-report-source={context}>
        <header className="battle-report-modal-head-v1">
          <div>
            <small>БОЕВОЙ ОТЧЁТ · {missionLabel(viewModel.missionType)}</small>
            <div className={`battle-report-modal-result-v1 ${result.tone}`}>
              <span className="battle-report-modal-result-icon-v1" aria-hidden="true">{resultIcon(result.tone)}</span>
              <h2 id={titleId}>{result.label}</h2>
            </div>
            <p><time dateTime={viewModel.timestamp}>{formatBattleDate(viewModel.timestamp)}</time> · {participantLabel(viewModel.attacker.participant)} → {participantLabel(viewModel.defender.participant)}</p>
          </div>
          <div className="battle-report-modal-actions-v1">
            {context === 'battle' && onToggleSaved ? <SaveButton saved={saved} onToggle={onToggleSaved} reportId={viewModel.id} /> : null}
            <button ref={closeRef} type="button" className="battle-report-modal-close-v1" data-asterion-close onClick={onClose} aria-label="Закрыть боевой отчёт">×</button>
          </div>
        </header>
        <SunReportStrip report={report} />
        <div ref={scrollRef} className="battle-report-modal-scroll-v1">
          <BattleReportDetailBody report={report} viewModel={viewModel} scrollRef={scrollRef} />
          <button type="button" className="battle-list-back-v1 battle-modal-back-v1" onClick={onClose}>{context === 'simulation' ? '← К СИМУЛЯТОРУ' : '← К СПИСКУ БИТВ'}</button>
        </div>
      </section>
    </div>,
    document.body,
  );
}

export function BattleReportsView({ planetName, coords, onBack }: { planetName: string; coords: string; onBack: () => void }) {
  const [history, setHistory] = useState<BattleHistoryState>(() => readBattleHistory(undefined, ACTIVE_RUNTIME_MODE));
  const [saveState, setSaveState] = useState(() => createPersistenceFacade({ mode: ACTIVE_RUNTIME_MODE }).read());
  const [mode, setMode] = useState<BattleListMode>('recent');
  const [openReportId, setOpenReportId] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<SaveNotice>({ kind: 'saved', message: '✓ Автосохранение активно' });
  const closeReport = useCallback(() => setOpenReportId(null), []);

  useEffect(() => {
    const sync = () => {
      setHistory(readBattleHistory(undefined, ACTIVE_RUNTIME_MODE));
      setSaveState(createPersistenceFacade({ mode: ACTIVE_RUNTIME_MODE }).read());
    };
    const onRuntimeReset = () => {
      setOpenReportId(null);
      setMode('recent');
      setSaveNotice({ kind: 'saved', message: '✓ Автосохранение активно' });
      window.setTimeout(sync, 0);
    };
    window.addEventListener(BATTLE_HISTORY_CHANGED_EVENT, sync);
    window.addEventListener(RUNTIME_STATE_CHANGED_EVENT, sync);
    window.addEventListener(RUNTIME_RESET_EVENT, onRuntimeReset);
    return () => {
      window.removeEventListener(BATTLE_HISTORY_CHANGED_EVENT, sync);
      window.removeEventListener(RUNTIME_STATE_CHANGED_EVENT, sync);
      window.removeEventListener(RUNTIME_RESET_EVENT, onRuntimeReset);
    };
  }, []);

  const viewModels = useMemo(
    () => new Map(history.reports.filter((report) => !saveState.npc?.profiles[report.attacker.playerId ?? '']
      || !saveState.npc?.profiles[report.defender.playerId ?? '']).map((report) => [report.id, createBattleReportViewModel(report, {
      awardedBattlePoints: selectRecordedBattlePointAwards(saveState.rating, report, saveState.profile.playerId),
    })])),
    [history.reports, saveState],
  );
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const recentReports = useMemo(
    () => history.reports.filter((report) => isDemoBattleReport(report.id) || nowMs - Date.parse(report.timestamp) < BATTLE_RECENT_RETENTION_MS),
    [history.reports, nowMs],
  );
  const visibleReports = useMemo(
    () => filterBattleReports(mode === 'recent' ? recentReports : history.reports, history.savedReportIds, mode)
      .map((report) => viewModels.get(report.id))
      .filter((viewModel): viewModel is BattleReportViewModel => Boolean(viewModel)),
    [history, mode, recentReports, viewModels],
  );
  const openReport = openReportId ? history.reports.find((report) => report.id === openReportId) ?? null : null;
  const openViewModel = openReport ? viewModels.get(openReport.id) ?? null : null;

  const toggleSaved = (reportId: string) => {
    const currentlySaved = history.savedReportIds.includes(reportId);
    const next = setBattleReportSaved(history, reportId, !currentlySaved, ACTIVE_RUNTIME_MODE);
    const result = persistBattleHistory(next, undefined, ACTIVE_RUNTIME_MODE);
    setHistory(result.value);
    setSaveNotice(result.ok
      ? { kind: 'saved', message: '✓ Сохранено' }
      : { kind: 'error', message: `Ошибка: ${result.error}` });
  };

  return (
    <section className="battle-view-v1 ops6 fleet-page-shell-v1">
      <header className="battle-page-head-v1 fleet-page-head-v1">
        <div><small>УПРАВЛЕНИЕ ФЛОТОМ · {planetName} {coords}</small><h2>БИТВЫ</h2><p>Боевые отчёты флота</p></div>
        <div className="battle-page-actions-v1 fleet-page-actions-v1"><span className={`battle-save-notice-v1 ${saveNotice.kind}`} role="status" aria-live="polite">{saveNotice.message}</span><button type="button" className="battle-back-v1 fleet-page-back-v1" onClick={onBack}>← К ФЛОТАМ</button></div>
      </header>

      <div className="battle-tabs-v1" role="tablist" aria-label="Фильтр боевых отчётов">
        <button type="button" role="tab" aria-selected={mode === 'recent'} className={mode === 'recent' ? 'active' : ''} onClick={() => setMode('recent')}>ПОСЛЕДНИЕ <b>{recentReports.length}</b></button>
        <button type="button" role="tab" aria-selected={mode === 'saved'} className={mode === 'saved' ? 'active' : ''} onClick={() => setMode('saved')}>СОХРАНЁННЫЕ <b>{history.savedReportIds.length}</b></button>
        <span className="battle-tabs-v1__note">Отчёты хранятся 8 часов · отмеченные ★ — бессрочно</span>
      </div>

      <div className="battle-list-v1">
        {visibleReports.length ? visibleReports.map((viewModel) => (
          <BattleCard
            key={viewModel.id}
            viewModel={viewModel}
            saved={history.savedReportIds.includes(viewModel.id)}
            onToggleSaved={() => toggleSaved(viewModel.id)}
            onOpen={() => setOpenReportId(viewModel.id)}
            expiresInMs={mode === 'recent' && !isDemoBattleReport(viewModel.id) ? Date.parse(viewModel.timestamp) + BATTLE_RECENT_RETENTION_MS - nowMs : null}
          />
        )) : (
          <div className="battle-empty-v1"><img className="ui-empty-art" src={EMPTY_ART.battles} alt="" draggable={false} /><strong>{mode === 'recent' ? 'За последние 8 часов боёв не было.' : 'Нет сохранённых боевых отчётов.'}</strong><p>{mode === 'saved' ? 'Отметь нужный отчёт звездой во вкладке «Последние».' : 'Здесь появляются бои за последние 8 часов. Отметь отчёт звездой, чтобы сохранить его навсегда.'}</p></div>
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
