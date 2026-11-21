import { useState, type CSSProperties } from 'react';
import { REPORT_ICONS, SCORE_ICONS } from '../ui-icons.ts';
import { RATING_BACKDROP } from '../ui-art.ts';
import './achievements-view.css';

export type AchievementStatus = 'earned' | 'in-progress' | 'not-started';
export type AchievementStatusFilter = 'all' | AchievementStatus;
export type AchievementRarityKey = 'bronze' | 'silver' | 'gold' | 'legend';

export interface AchievementViewItem {
  id: string;
  title: string;
  condition: string;
  group: { id: string; label: string };
  typeLabel?: string | null;
  status: AchievementStatus;
  progress?: {
    current: number;
    target: number;
    currentLabel: string;
    targetLabel: string;
  } | null;
  points: number;
  rarity?: { key: AchievementRarityKey; label: string } | null;
  iconSrc?: string | null;
  earnedLabel?: string | null;
}

export interface AchievementsViewProps {
  summary: {
    points: number;
    rank: {
      name: string;
      thresholdStart: number;
      next: { name: string; threshold: number } | null;
    };
  };
  achievements: readonly AchievementViewItem[];
}

const numberFormat = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });

const statusNames: Record<AchievementStatus, string> = {
  earned: 'Получено',
  'in-progress': 'В процессе',
  'not-started': 'Не начато',
};

const filterNames: Record<AchievementStatusFilter, string> = {
  all: 'Все',
  earned: 'Получены',
  'in-progress': 'В процессе',
  'not-started': 'Не начаты',
};

function formatNumber(value: number): string {
  return numberFormat.format(value);
}

function progressPercent(item: AchievementViewItem): number | null {
  const progress = item.progress;
  if (!progress || !Number.isFinite(progress.current) || !Number.isFinite(progress.target) || progress.target <= 0) return null;
  return Math.max(0, Math.min(100, (progress.current / progress.target) * 100));
}

function rankProgress(points: number, rank: AchievementsViewProps['summary']['rank']): number {
  if (!rank.next) return 100;
  const span = rank.next.threshold - rank.thresholdStart;
  if (span <= 0) return 100;
  return Math.max(0, Math.min(100, ((points - rank.thresholdStart) / span) * 100));
}

function visibleItems(
  achievements: readonly AchievementViewItem[],
  groupFilter: string,
  statusFilter: AchievementStatusFilter,
): AchievementViewItem[] {
  return achievements.filter((achievement) =>
    (groupFilter === 'all' || achievement.group.id === groupFilter)
    && (statusFilter === 'all' || achievement.status === statusFilter));
}

export function AchievementsView({ summary, achievements }: AchievementsViewProps) {
  const [groupFilter, setGroupFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<AchievementStatusFilter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(() => achievements[0]?.id ?? null);

  const groups = Array.from(new Map(achievements.map(({ group }) => [group.id, group])).values());
  const filtered = visibleItems(achievements, groupFilter, statusFilter);
  const selected = filtered.find((achievement) => achievement.id === selectedId) ?? filtered[0] ?? null;
  const earnedCount = achievements.filter((achievement) => achievement.status === 'earned').length;
  const hasActiveFilters = groupFilter !== 'all' || statusFilter !== 'all';
  const rankPct = rankProgress(summary.points, summary.rank);
  const rankRemaining = summary.rank.next ? Math.max(0, summary.rank.next.threshold - summary.points) : null;
  const rankDescription = summary.rank.next
    ? `${formatNumber(summary.points)} очков · ещё ${formatNumber(rankRemaining ?? 0)} до ранга «${summary.rank.next.name}»`
    : `Максимальный ранг «${summary.rank.name}»`;

  const chooseGroup = (nextGroup: string) => {
    setGroupFilter(nextGroup);
    setSelectedId(visibleItems(achievements, nextGroup, statusFilter)[0]?.id ?? null);
  };

  const chooseStatus = (nextStatus: AchievementStatusFilter) => {
    setStatusFilter(nextStatus);
    setSelectedId(visibleItems(achievements, groupFilter, nextStatus)[0]?.id ?? null);
  };

  const resetFilters = () => {
    setGroupFilter('all');
    setStatusFilter('all');
    setSelectedId(achievements[0]?.id ?? null);
  };

  return (
    <div className="achievement-screen" data-qa-achievements-view>
      <section className="achievement-workspace" aria-label="Список достижений">
        <header
          className="achievement-summary"
          data-qa-achievement-summary
          data-achievement-points={summary.points}
          data-achievement-rank={summary.rank.name}
          style={{ backgroundImage: `linear-gradient(90deg, rgba(10,16,22,.98) 0, rgba(10,16,22,.92) 58%, rgba(10,16,22,.78)), url("${RATING_BACKDROP}")` } as CSSProperties}
        >
          <div className="achievement-summary__profile">
            <span className="achievement-summary__medal">
              <img src={SCORE_ICONS.totalPoints} alt="" aria-hidden="true" draggable={false} />
            </span>
            <div className="achievement-summary__copy">
              <h1 className="achievement-summary__eyebrow">Летопись командира</h1>
              <strong className="achievement-summary__points">{formatNumber(summary.points)}</strong>
              <span className="achievement-summary__meta">
                {formatNumber(earnedCount)} из {formatNumber(achievements.length)} · ранг <b>{summary.rank.name}</b>
              </span>
            </div>
          </div>

          <div className="achievement-rank">
            <div className="achievement-rank__heading">
              <span>
                {summary.rank.next
                  ? <>Ранг <b>{summary.rank.name}</b> · до «{summary.rank.next.name}»</>
                  : <>Максимальный ранг <b>{summary.rank.name}</b></>}
              </span>
              <strong>{rankRemaining === null ? 'максимум' : `ещё ${formatNumber(rankRemaining)}`}</strong>
            </div>
            <div
              className="achievement-rank__track"
              role="progressbar"
              aria-label={summary.rank.next ? 'Прогресс до следующего ранга' : `Достигнут максимальный ранг: ${summary.rank.name}`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(rankPct)}
              aria-valuetext={rankDescription}
              data-qa-achievement-rank-progress
            >
              <span style={{ width: `${rankPct}%` }} />
            </div>
          </div>
        </header>

        <div className="achievement-filters">
          <div className="achievement-filter-row" role="group" aria-label="Фильтр по разделу" data-qa-achievement-group-filters>
            <button
              type="button"
              className="achievement-filter"
              aria-pressed={groupFilter === 'all'}
              data-qa-achievement-group-filter="all"
              onClick={() => chooseGroup('all')}
            >
              Все разделы
            </button>
            {groups.map((group) => {
              const itemsInGroup = achievements.filter((achievement) => achievement.group.id === group.id);
              const earnedInGroup = itemsInGroup.filter((achievement) => achievement.status === 'earned').length;
              return (
                <button
                  key={group.id}
                  type="button"
                  className="achievement-filter"
                  aria-pressed={groupFilter === group.id}
                  data-qa-achievement-group-filter={group.id}
                  onClick={() => chooseGroup(group.id)}
                >
                  {group.label} <span>{formatNumber(earnedInGroup)}/{formatNumber(itemsInGroup.length)}</span>
                </button>
              );
            })}
          </div>
          <div className="achievement-filter-row achievement-filter-row--status" role="group" aria-label="Фильтр по статусу" data-qa-achievement-status-filters>
            {(Object.keys(filterNames) as AchievementStatusFilter[]).map((status) => (
              <button
                key={status}
                type="button"
                className="achievement-filter"
                aria-pressed={statusFilter === status}
                data-qa-achievement-status-filter={status}
                onClick={() => chooseStatus(status)}
              >
                {filterNames[status]}
              </button>
            ))}
          </div>
        </div>

        <div className="achievement-list" data-qa-achievement-list>
          {filtered.length === 0 ? (
            <div className="achievement-empty" data-qa-achievement-empty role="status">
              <img src={REPORT_ICONS.achievements} alt="" aria-hidden="true" draggable={false} />
              <strong>{hasActiveFilters ? 'По этим фильтрам ничего нет' : 'Список достижений пуст'}</strong>
              {hasActiveFilters ? (
                <button type="button" className="achievement-reset" data-qa-achievement-filter-reset onClick={resetFilters}>
                  Сбросить фильтры
                </button>
              ) : null}
            </div>
          ) : (
            groups
              .filter((group) => groupFilter === 'all' || group.id === groupFilter)
              .map((group) => {
                const groupItems = filtered.filter((achievement) => achievement.group.id === group.id);
                if (groupItems.length === 0) return null;
                const allGroupItems = achievements.filter((achievement) => achievement.group.id === group.id);
                const groupEarned = allGroupItems.filter((achievement) => achievement.status === 'earned').length;
                return (
                  <section className="achievement-group" key={group.id} aria-label={group.label}>
                    <header className="achievement-group__heading">
                      <h2>{group.label}</h2>
                      <span>{formatNumber(groupEarned)} из {formatNumber(allGroupItems.length)}</span>
                    </header>
                    <ul className="achievement-group__list">
                      {groupItems.map((achievement) => {
                        const selectedRow = selected?.id === achievement.id;
                        const pct = progressPercent(achievement);
                        const progressText = achievement.progress
                          ? `${achievement.progress.currentLabel} из ${achievement.progress.targetLabel}`
                          : null;
                        const earnedText = achievement.earnedLabel
                          ? `${statusNames.earned} · ${achievement.earnedLabel}`
                          : statusNames.earned;
                        return (
                          <li key={achievement.id}>
                            <button
                              type="button"
                              className={`achievement-row ${selectedRow ? 'is-selected' : ''} ${achievement.status === 'earned' ? 'is-earned' : 'is-unearned'}`}
                              aria-pressed={selectedRow}
                              data-qa-achievement-row={achievement.id}
                              data-achievement-status={achievement.status}
                              onClick={() => setSelectedId(achievement.id)}
                            >
                              <span className={`achievement-medal achievement-medal--${achievement.rarity?.key ?? 'plain'}`} aria-hidden="true">
                                <img src={achievement.iconSrc || REPORT_ICONS.achievements} alt="" draggable={false} />
                              </span>
                              <span className="achievement-row__name">
                                <strong>{achievement.title}</strong>
                                <span>{achievement.condition}</span>
                              </span>
                              <span className={`achievement-row__progress achievement-row__progress--${achievement.status}`}>
                                {achievement.status === 'earned' ? (
                                  <span className="achievement-row__earned">{earnedText}</span>
                                ) : (
                                  <>
                                    {pct !== null ? (
                                      <span
                                        className="achievement-row__track"
                                        role="progressbar"
                                        aria-label={`Прогресс: ${achievement.title}`}
                                        aria-valuemin={0}
                                        aria-valuemax={100}
                                        aria-valuenow={Math.round(pct)}
                                        aria-valuetext={progressText ?? statusNames[achievement.status]}
                                        data-qa-achievement-progress={achievement.id}
                                      >
                                        <span style={{ width: `${pct}%` }} />
                                      </span>
                                    ) : null}
                                    <span className="achievement-row__progress-copy">
                                      <b>{statusNames[achievement.status]}</b>
                                      {progressText ? <span>{progressText}</span> : null}
                                    </span>
                                  </>
                                )}
                              </span>
                              <span className="achievement-row__points">
                                <strong>+{formatNumber(achievement.points)}</strong>
                                {achievement.rarity ? <span className={`achievement-rarity achievement-rarity--${achievement.rarity.key}`}>{achievement.rarity.label}</span> : null}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                );
              })
          )}
        </div>
      </section>

      <aside className="achievement-detail" aria-label="Подробности достижения" data-qa-achievement-detail data-qa-achievement-selected={selected?.id ?? ''}>
        {selected ? (
          <>
            <div className="achievement-detail__content">
              <span className={`achievement-detail__medal achievement-detail__medal--${selected.rarity?.key ?? 'plain'}`} aria-hidden="true">
                <img src={selected.iconSrc || REPORT_ICONS.achievements} alt="" draggable={false} />
              </span>
              <span className="achievement-detail__kind">
                {[selected.rarity?.label, selected.typeLabel].filter(Boolean).join(' · ') || selected.group.label}
              </span>
              <h2>{selected.title}</h2>
              <p className="achievement-detail__condition">{selected.condition}</p>
              <div className="achievement-detail__points">
                +{formatNumber(selected.points)} <span>очков в летопись</span>
              </div>

              <div className={`achievement-detail__status achievement-detail__status--${selected.status}`}>
                <strong>{statusNames[selected.status]}</strong>
                {selected.status === 'earned' && selected.earnedLabel ? <span>{selected.earnedLabel}</span> : null}
                {selected.status !== 'earned' && selected.progress ? (
                  <>
                    {progressPercent(selected) !== null ? (
                      <span
                        className="achievement-detail__track"
                        role="progressbar"
                        aria-label={`Прогресс: ${selected.title}`}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={Math.round(progressPercent(selected) ?? 0)}
                        aria-valuetext={`${selected.progress.currentLabel} из ${selected.progress.targetLabel}`}
                        data-qa-achievement-detail-progress
                      >
                        <span style={{ width: `${progressPercent(selected)}%` }} />
                      </span>
                    ) : null}
                    <span>{selected.progress.currentLabel} из {selected.progress.targetLabel}</span>
                  </>
                ) : null}
              </div>

              <dl className="achievement-detail__facts">
                <div>
                  <dt>Раздел</dt>
                  <dd>{selected.group.label}</dd>
                </div>
                {selected.typeLabel ? (
                  <div>
                    <dt>Тип</dt>
                    <dd>{selected.typeLabel}</dd>
                  </div>
                ) : null}
              </dl>
            </div>
          </>
        ) : (
          <div className="achievement-detail__empty">
            <img src={REPORT_ICONS.achievements} alt="" aria-hidden="true" draggable={false} />
            <strong>{achievements.length === 0 ? 'Нет достижений' : 'Выберите достижение'}</strong>
            <span>{achievements.length === 0 ? 'Список достижений пуст.' : 'Подробности появятся после выбора записи.'}</span>
          </div>
        )}
      </aside>
    </div>
  );
}
