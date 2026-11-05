import type { FleetPlanLimit, FleetPlanLine, FleetPlanResource, FleetPlanStartOutcome, FleetPlanStartResult } from '../../application/fleet-plan.ts';
import { compactAmount, formatNumber, plural } from '../empire/empire-format.ts';

const RESOURCE_GENITIVE: Record<FleetPlanResource, string> = { metal: 'металла', minerals: 'минералов', gas: 'газа' };
/** Exact digits while a number reads at a glance, compact above this. */
const EXACT_BELOW = 10_000_000;

export const planAmount = (value: number) => (value >= EXACT_BELOW ? compactAmount(value) : formatNumber(value));

export function fleetPlanLimitText(limit: FleetPlanLimit | null, short: FleetPlanLine['short']): string | null {
  if (limit === 'hangar') return 'нет места в ангаре';
  if (!limit) return null;
  const lacking = short[limit];
  return lacking ? `не хватает ${RESOURCE_GENITIVE[limit]} ${compactAmount(lacking)}` : null;
}

/** What one start did, in the player's words: what started, and what could not and why. */
export function fleetPlanReport(result: FleetPlanStartResult): { text: string; warn: string | null } {
  const started = result.outcomes.filter((outcome) => outcome.started > 0);
  const shortfall = result.outcomes.filter((outcome) => outcome.started < outcome.wanted);
  const why = (outcome: FleetPlanStartOutcome) => {
    const cause = outcome.reason ?? fleetPlanLimitText(outcome.limitedBy, outcome.short);
    return `${outcome.name}: ещё ${planAmount(outcome.wanted - outcome.started)}${cause ? `, ${cause}` : ''}`;
  };
  const text = started.length
    ? `Запущено ${planAmount(result.started)} ${plural(result.started, 'корабль', 'корабля', 'кораблей')}: ${started.map((outcome) => `${outcome.name} ${planAmount(outcome.started)}`).join(', ')}.`
    : 'Ничего не запущено.';
  return { text, warn: shortfall.length ? shortfall.map(why).join(' · ') : null };
}
