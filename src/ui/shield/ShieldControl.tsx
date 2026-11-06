import { checkShieldActivation, ownerShieldStatus } from '../../application/shield.ts';
import type { SaveState } from '../../application/contracts.ts';
import { useState } from 'react';
import { formatShieldRemaining, shieldTiming } from '../../domain/shield/shield.ts';
import { ConfirmDialog } from '../menu/MenuApp.tsx';
import './shield.css';

export type ShieldControlProps = {
  state: SaveState;
  now: number;
  /** `compact` is its own field in the header, right of the planet selector; `full` is in the Empire console. */
  variant: 'compact' | 'full';
  onActivate: () => void;
};

/** One button for all planets: shows the time left, the cooldown, or why it cannot be raised. */
export function ShieldControl({ state, now, variant, onActivate }: ShieldControlProps) {
  const ownerId = state.profile.playerId;
  // The clock of the screen can lag a tick behind the click that raised the shield.
  const at = Math.max(now, state.shields?.[ownerId]?.activatedAt ?? 0);
  const status = ownerShieldStatus(state, ownerId, at);
  const check = status.phase === 'ready' ? checkShieldActivation(state, ownerId, at) : null;
  const blocked = check && !check.ok ? check.message : null;
  const label = status.phase === 'active'
    ? (variant === 'compact' ? formatShieldRemaining(status.remainingMs) : `Щит ${formatShieldRemaining(status.remainingMs)}`)
    : status.phase === 'cooldown' ? (variant === 'compact' ? formatShieldRemaining(status.remainingMs) : `Перезарядка ${formatShieldRemaining(status.remainingMs)}`) : (variant === 'compact' ? 'Щит' : 'Включить щит');
  const title = status.phase === 'active'
    ? `Щит закрывает все ваши планеты, ещё ${formatShieldRemaining(status.remainingMs)}. Нападать самому нельзя.`
    : status.phase === 'cooldown' ? `Щит можно включить снова через ${formatShieldRemaining(status.remainingMs)}`
      : blocked ?? 'Щит на все планеты: вас нельзя атаковать, но и вы не можете нападать. Шпионаж и перевозки разрешены.';
  const [confirming, setConfirming] = useState(false);
  const hours = shieldTiming(state.worldConfig?.world.campaignSpeed).durationMs / 3_600_000;
  const duration = hours >= 1 ? `${Number.isInteger(hours) ? hours : String(hours).replace('.', ',')} ч` : `${Math.round(hours * 60)} мин`;
  return (
    <>
    <button
      type="button"
      className={`shield-ctl shield-ctl--${variant} shield-ctl--${status.phase}`}
      disabled={status.phase !== 'ready' || Boolean(blocked)}
      title={variant === 'compact' ? undefined : title}
      aria-label={title}
      onClick={() => setConfirming(true)}
      data-qa-shield={status.phase}
    >
      <i aria-hidden="true" />
      <span>{label}</span>
      {status.phase === 'ready' && blocked ? <small>{blocked}</small> : null}
    </button>
    {confirming ? (
      <div className="menu-viewport shield-confirm-host">
      <ConfirmDialog
        title="Включить щит?"
        text={`Все ваши планеты будут защищены от атак на ${duration}. Пока щит включён, вы не сможете атаковать, участвовать в рейдах и в поддержке или атаке Солнца. Возить ресурсы можно.`}
        confirmLabel="Включить"
        cancelLabel="Отмена"
        onConfirm={() => { setConfirming(false); onActivate(); }}
        onCancel={() => setConfirming(false)}
      />
      </div>
    ) : null}
    </>
  );
}
