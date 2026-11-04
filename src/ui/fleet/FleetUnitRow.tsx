import type { ReactNode } from 'react';

import { ResourceIcon } from '../resources/ResourceIcon';

export type FleetUnitCost = { metal: number; minerals: number; gas: number; population: number };
export type FleetUnitWallet = { metal: number; minerals: number; gas: number; populationFree: number };

const formatNumber = (value: number) => new Intl.NumberFormat('ru-RU').format(value);

const COST_KINDS = ['metal', 'minerals', 'gas', 'population'] as const;
const COST_LABELS: Record<(typeof COST_KINDS)[number], string> = {
  metal: 'Металл',
  minerals: 'Минералы',
  gas: 'Газ',
  population: 'Население',
};

/**
 * One line of the Ships / Defence / Commander catalogue: art, name, stock, price,
 * time, amount and one action. No frames inside: the row is the only surface.
 *
 * The stock cell (`.fc-unit__stock`) is where the fleet planner adds its per-unit
 * target and «не хватает N»: it has room for one more line under the count.
 */
export function FleetUnitRow({
  id,
  name,
  role,
  art,
  owned,
  pending,
  levelNode,
  cost,
  wallet,
  effectiveTime,
  rawTime,
  quantity,
  max,
  locked,
  lockReason,
  requirements,
  dossier,
  onQuantity,
  onBuild,
}: {
  id: string;
  name: string;
  role: string;
  art: string;
  owned: number;
  pending: number;
  levelNode?: ReactNode;
  cost: FleetUnitCost;
  wallet: FleetUnitWallet;
  effectiveTime: string;
  rawTime: string;
  quantity: number;
  max: number;
  locked: boolean;
  lockReason: string | null;
  requirements: readonly string[];
  /** The stats card shown on hover; the info dialog reads its figures too. */
  dossier: ReactNode;
  onQuantity: (quantity: number) => void;
  onBuild: (quantity: number) => void;
}) {
  const walletOf = { metal: wallet.metal, minerals: wallet.minerals, gas: wallet.gas, population: wallet.populationFree };

  return (
    <article
      className={`fc-unit${locked ? ' is-locked' : ''}${quantity > 0 ? ' is-picked' : ''}`}
      data-qa-fleet-production-item={id}
      data-qa-production-requirements={locked ? 'unmet' : 'met'}
      data-qa-production-requirement-reason={lockReason ?? undefined}
    >
      <div className="fc-unit__art" aria-label={`Характеристики: ${name}`}>
        <img src={art} alt={name} draggable={false} />
        {dossier}
      </div>

      <div className="fc-unit__name">
        <h3>{name}</h3>
        <small>{role}</small>
        {levelNode}
      </div>

      <div className={`fc-unit__stock${owned > 0 ? ' has-units' : ''}`}>
        <small>Есть</small>
        <strong data-qa-unit-owned>{formatNumber(owned)}</strong>
        {pending > 0 ? <em data-qa-unit-pending>+{formatNumber(pending)} строится</em> : null}
      </div>

      <dl className="fc-unit__cost" aria-label="Цена за штуку">
        {COST_KINDS.map((kind) => (
          <div key={kind} className={!locked && cost[kind] > walletOf[kind] ? 'is-short' : ''}>
            <dt><ResourceIcon kind={kind} label={COST_LABELS[kind]} /></dt>
            <dd>{formatNumber(cost[kind])}</dd>
          </div>
        ))}
      </dl>

      <div className="fc-unit__time" data-qa-unit-time={id}>
        <small>за штуку</small>
        <b data-qa-unit-time-effective>{effectiveTime}</b>
        {rawTime !== effectiveTime ? <span data-qa-unit-time-raw>без бонусов {rawTime}</span> : null}
      </div>

      {locked ? (
        <div className="fc-unit__lock">
          <span aria-hidden="true" className="fc-unit__lock-mark" />
          <div>
            {lockReason ? <strong data-qa-production-requirement-error>{lockReason}</strong> : <strong>Пока нельзя построить</strong>}
            <small>{requirements.join(' · ')}</small>
          </div>
        </div>
      ) : (
        <>
          <div className="fc-unit__amount">
            <input
              type="number"
              min="0"
              max={max}
              value={quantity}
              aria-label={`Количество: ${name}`}
              onChange={(event) => onQuantity(Number(event.target.value))}
            />
            <button type="button" data-qa-unit-max onClick={() => onQuantity(max)} disabled={max <= 0}>МАКС.</button>
            <button type="button" data-qa-unit-min onClick={() => onQuantity(0)} disabled={quantity <= 0}>МИН.</button>
            <small data-qa-unit-can-build>{max > 0 ? `можно до ${formatNumber(max)}` : 'не хватает ресурсов'}</small>
          </div>
          <button className="fc-unit__build" type="button" data-qa-unit-build disabled={quantity <= 0 || max <= 0} onClick={() => onBuild(quantity)}>
            Построить
          </button>
        </>
      )}

      <button className="fc-unit__info" type="button" data-role={role} aria-label={`Информация: ${name}`}>i</button>
    </article>
  );
}
