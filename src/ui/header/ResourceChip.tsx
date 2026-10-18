import type { CSSProperties } from 'react';
import { HeaderGameIcon } from './HeaderAssetIcons';
import { GameIcon } from './HeaderIcons';
import type { HeaderResourceModel } from './types.ts';

function formatNumber(value: number) {
  return new Intl.NumberFormat('ru-RU').format(value);
}

/** Header cells are sized for «999 999 999»; larger values switch to «1,25 млрд». The tooltip keeps the exact number. */
export function formatHeaderNumber(value: number) {
  const short = (divider: number, unit: string) => `${(value / divider).toLocaleString('ru-RU', { maximumFractionDigits: value / divider >= 100 ? 0 : 2 })} ${unit}`;
  if (Math.abs(value) >= 1e12) return short(1e12, 'трлн');
  if (Math.abs(value) >= 1e9) return short(1e9, 'млрд');
  return formatNumber(value);
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

const LABELS: Record<string, string> = {
  metal: 'Металл',
  mineral: 'Минералы',
  gas: 'Газ',
  energy: 'Энергия',
  population: 'Население',
};

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
  const shownLabel = kind === 'population' && label !== 'НАСЕЛЕНИЕ' ? 'Население обороны' : LABELS[kind] ?? label;

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
      {kind === 'energy' && debris !== undefined ? <>
        <span className="hdr-cell" data-qa-energy-header>
          <span className="hdr-cell__icon"><HeaderGameIcon kind="energy" /></span>
          <span className="hdr-cell__copy"><small>{shownLabel}</small><strong>{formatHeaderNumber(value)}</strong></span>
        </span>
        <span className="hdr-cell hdr-cell--debris" data-qa-debris-header>
          <span className="hdr-cell__icon"><GameIcon kind="debris" /></span>
          <span className="hdr-cell__copy"><small>Обломки</small><strong data-qa-debris-header-value>{formatHeaderNumber(debris)}</strong></span>
        </span>
      </> : (
        <span className="hdr-cell">
          <span className="hdr-cell__icon"><HeaderGameIcon kind={kind === 'debris' ? 'energy' : kind} /></span>
          <span className="hdr-cell__copy">
            <small>{shownLabel}</small>
            <strong>
              {showCapacity && capacity ? <>{formatHeaderNumber(value)}<em> / {formatHeaderNumber(capacity)}</em></> : formatHeaderNumber(value)}
              {kind === 'population' && populationBreakdown?.pendingInbound ? <span className="asterion-header__resource-pending-inbound" data-qa-pending-inbound-population> +{formatNumber(populationBreakdown.pendingInbound)}</span> : null}
            </strong>
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
        </span>
      )}
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
            {populationBreakdown.pendingInbound ? <span data-qa-population-breakdown-item="pending-inbound"><small>В пути</small><b className="asterion-header__resource-pending-inbound">+{formatNumber(populationBreakdown.pendingInbound)}</b></span> : null}
          </div>
        ) : null}
        {description ? <span>{description}</span> : null}
        {kind === 'energy' && debris !== undefined ? <span data-qa-debris-header-tooltip>Обломки: {formatNumber(debris)}</span> : null}
      </span>
    </div>
  );
}
