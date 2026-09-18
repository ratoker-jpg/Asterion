import { getBuildingEffect } from '../buildings/balance-v1.ts';

/**
 * Reads the historical balance row as the raw source value without changing
 * the balance table or treating the compatibility field as hourly income.
 */
export function getBuildingEnergyBaseContribution(
  role: 'basic-energy' | 'advanced-energy',
  level: number,
): number {
  const effect = getBuildingEffect(role, level);
  return effect.kind === 'energy-income' ? Math.max(0, Math.round(effect.amountPerHour)) : 0;
}
