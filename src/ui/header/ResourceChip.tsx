import type { CSSProperties } from 'react';
import { HeaderGameIcon } from './HeaderAssetIcons';
import { GameIcon } from './HeaderIcons';
import type { HeaderResourceModel } from './types.ts';

function formatNumber(value: number) {
  return new Intl.NumberFormat('ru-RU').format(value);
}

function formatStorageEta(current: number, capacity: number, hourlyGain: number) {
  if (current >= capacity) return 'склад заполнен';
  if (hourlyGain <= 0) return 'нет добычи';

  const minutes = Math.max(1, Math.ceil(((capacity - current) / hourlyGain) * 60));
  const days = Math.floor(minutes / (24 * 60));
  const hours = Math.floor((minutes % (24 * 60)) / 60);
  const remainingMinutes = minutes % 60;
  const parts = [];
  if (days) parts.push(`${days} д`);
  if (hours) parts.push(`${hours} ч`);
  if (!days && !hours) parts.push(`${remainingMinutes} мин`);
  return parts.join(' ');
}

export function ResourceChip({ kind, label, value, capacity, showCapacity = false, hourlyGain, description, debris, populationBreakdown }: HeaderResourceModel) {
  const fill = capacity ? Math.min(100, Math.max(0, (value / capacity) * 100)) : 0;
  const fillTone = fill <= 20
    ? 'normal'
    : fill <= 40
      ? 'positive'
      : fill <= 55
        ? 'watch'
        : fill <= 70
          ? 'warning'
          : fill <= 85
            ? 'danger'
            : 'critical';
  const hasFill = kind !== 'energy' && kind !== 'debris' && Boolean(capacity);
  const shouldPulse = (kind === 'metal' || kind === 'mineral' || kind === 'gas') && fill > 85;
  const tooltipId = `asterion-header-resource-tooltip-${kind}`;

  return (
    <div
      className={`asterion-header__resource asterion-header__resource--${kind}${shouldPulse ? ' is-pulsing' : ''}${kind === 'energy' && debris !== undefined ? ' is-energy-split' : ''}`}
      tabIndex={0}
      data-qa-resource-chip={kind}
      data-qa-resource-kind={kind}
      data-qa-resource-ratio={fill}
      data-qa-resource-tone={fillTone}
      data-qa-resource-pulse={shouldPulse}
      aria-describedby={tooltipId}
    >
      {kind === 'energy' && debris !== undefined ? <span className="asterion-header__resource-energy-split">
        <span className="asterion-header__resource-energy-half" data-qa-energy-header>
          <span className="asterion-header__resource-half-icon"><HeaderGameIcon kind="energy" /></span>
          <span className="asterion-header__resource-half-copy"><small>{label}</small><strong>{formatNumber(value)}</strong></span>
        </span>
        <span className="asterion-header__resource-energy-half asterion-header__resource-debris-half" data-qa-debris-header>
          <span className="asterion-header__resource-half-icon"><GameIcon kind="debris" /></span>
          <span className="asterion-header__resource-half-copy"><small>ОБЛОМКИ</small><strong data-qa-debris-header-value>{formatNumber(debris)}</strong></span>
        </span>
      </span> : <>
        <span className="asterion-header__resource-icon"><HeaderGameIcon kind={kind === 'debris' ? 'energy' : kind} /></span>
        <span className="asterion-header__resource-text">
          <small>{label}</small>
          <strong>{showCapacity && capacity ? `${formatNumber(value)} / ${formatNumber(capacity)}` : formatNumber(value)}</strong>
          {hasFill ? (
            <span
              className={`asterion-header__resource-fill asterion-header__resource-fill--${fillTone}${shouldPulse ? ' is-pulsing' : ''}`}
              data-qa-resource-fill={kind}
              data-qa-resource-kind={kind}
              data-qa-resource-ratio={fill}
              data-qa-resource-tone={fillTone}
              data-qa-resource-pulse={shouldPulse}
            >
              <i style={{ '--fill': `${fill}%` } as CSSProperties} />
            </span>
          ) : null}
        </span>
      </>}
      <span id={tooltipId} className="asterion-header__resource-tooltip" data-qa-resource-tooltip={kind} role="tooltip">
        <strong>{label}</strong>
        {capacity ? <span>{formatNumber(value)} / {formatNumber(capacity)}</span> : <span>{formatNumber(value)}</span>}
        {hourlyGain != null ? <span>Добыча: +{formatNumber(hourlyGain)}/ч</span> : null}
        {capacity && hourlyGain != null ? <span>Склад заполнится через: {formatStorageEta(value, capacity, hourlyGain)}</span> : null}
        {kind === 'population' && capacity ? <span>Заполнено: {fill.toFixed(1).replace('.', ',')}%</span> : null}
        {kind === 'population' && populationBreakdown ? (
          <div className="asterion-header__resource-population-breakdown" data-qa-population-breakdown>
            <span data-qa-population-breakdown-item="fleet"><small>Корабли</small><b>{formatNumber(populationBreakdown.fleet.value)} / {formatNumber(populationBreakdown.fleet.capacity)}</b></span>
            <span data-qa-population-breakdown-item="defense"><small>Оборона</small><b>{formatNumber(populationBreakdown.defense.value)} / {formatNumber(populationBreakdown.defense.capacity)}</b></span>
            {populationBreakdown.satellites != null ? <span data-qa-population-breakdown-item="satellites"><small>Спутники</small><b>{formatNumber(populationBreakdown.satellites)} · 1/ед.</b></span> : null}
          </div>
        ) : null}
        {description ? <span>{description}</span> : null}
        {kind === 'energy' && debris !== undefined ? <span data-qa-debris-header-tooltip>Обломки: {formatNumber(debris)}</span> : null}
      </span>
    </div>
  );
}

