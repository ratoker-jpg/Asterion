import { updateStatusText, useGameUpdates } from './updates.ts';
import './updates.css';

/**
 * Version line with «Проверить обновления» / «Перезапустить и обновить» in the
 * main menu and the pause menu. Nothing installs without the player's click;
 * errors stay a quiet line of text. Renders nothing in the browser build.
 */
export function GameUpdateRow({ variant }: { variant: 'menu' | 'pause' }) {
  const { state, installing, check, install } = useGameUpdates();
  if (!state) return null;
  const button = variant === 'menu' ? 'menu-btn menu-btn--small' : 'igo-btn game-update__btn';
  const primary = variant === 'menu' ? 'menu-btn menu-btn--small menu-btn--primary' : 'igo-btn igo-btn--primary game-update__btn';
  const busy = state.status === 'checking' || state.status === 'available' || state.status === 'downloading';
  const text = updateStatusText(state);
  return (
    <div className={`game-update game-update--${variant}`} data-qa-game-update={state.status} data-qa-game-version={state.currentVersion}>
      <div className="game-update__copy">
        <b>Версия {state.currentVersion}</b>
        {text ? <span className={`game-update__status is-${state.status}`} role="status">{text}</span> : null}
        {state.status === 'downloading' ? (
          <i className="game-update__bar" aria-hidden="true"><i style={{ width: `${state.percent ?? 0}%` }} /></i>
        ) : null}
      </div>
      {!state.enabled ? null : state.status === 'downloaded' ? (
        <button type="button" className={primary} onClick={install} disabled={installing} data-qa-game-update-install>
          {installing ? 'СОХРАНЕНИЕ И ПЕРЕЗАПУСК…' : 'ПЕРЕЗАПУСТИТЬ И ОБНОВИТЬ'}
        </button>
      ) : (
        <button type="button" className={button} onClick={check} disabled={busy} data-qa-game-update-check>ПРОВЕРИТЬ ОБНОВЛЕНИЯ</button>
      )}
    </div>
  );
}
