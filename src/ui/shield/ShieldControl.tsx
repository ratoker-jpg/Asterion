import { checkShieldActivation, ownerShieldStatus } from '../../application/shield.ts';
import type { SaveState } from '../../application/contracts.ts';
import { formatShieldRemaining } from '../../domain/shield/shield.ts';
import './shield.css';

export type ShieldControlProps = {
  state: SaveState;
  now: number;
  /** `compact` sits in the header next to the planet name; `full` in the Empire console. */
  variant: 'compact' | 'full';
  onActivate: () => void;
};

/** One button for all planets: shows the time left, the cooldown, or why it cannot be raised. */
export function ShieldControl({ state, now, variant, onActivate }: ShieldControlProps) {
  const ownerId = state.profile.playerId;
  const status = ownerShieldStatus(state, ownerId, now);
  const check = status.phase === 'ready' ? checkShieldActivation(state, ownerId, now) : null;
  const blocked = check && !check.ok ? check.message : null;
  const label = status.phase === 'active'
    ? `Щит ${formatShieldRemaining(status.remainingMs)}`
    : status.phase === 'cooldown' ? `Перезарядка ${formatShieldRemaining(status.remainingMs)}` : 'Включить щит';
  const title = status.phase === 'active'
    ? `Щит закрывает все ваши планеты, ещё ${formatShieldRemaining(status.remainingMs)}. Нападать самому нельзя.`
    : status.phase === 'cooldown' ? `Щит можно включить снова через ${formatShieldRemaining(status.remainingMs)}`
      : blocked ?? 'Щит на все планеты: вас нельзя атаковать, но и вы не можете нападать. Шпионаж и перевозки разрешены.';
  return (
    <button
      type="button"
      className={`shield-ctl shield-ctl--${variant} shield-ctl--${status.phase}`}
      disabled={status.phase !== 'ready' || Boolean(blocked)}
      title={title}
      aria-label={title}
      onClick={onActivate}
      data-qa-shield={status.phase}
    >
      <i aria-hidden="true" />
      <span>{label}</span>
      {status.phase === 'ready' && blocked ? <small>{blocked}</small> : null}
    </button>
  );
}
