import type { ReactNode } from 'react';

/** The heading of a settings section: title, one line on what it does, an optional action on the right. */
export function SettingsHead({ title, text, aside }: { title: string; text: string; aside?: ReactNode }) {
  return (
    <header className="set-head">
      <div>
        <h2>{title}</h2>
        <p>{text}</p>
      </div>
      {aside ? <div className="set-head-aside">{aside}</div> : null}
    </header>
  );
}

/** On / off as one switch; the state is written next to it. */
export function SettingsSwitch({ on, onChange, label, qa, onText = 'Включён', offText = 'Выключен', ...rest }: {
  on: boolean;
  onChange: (next: boolean) => void;
  label: string;
  qa?: string;
  onText?: string;
  offText?: string;
} & Readonly<Record<`data-${string}`, string | boolean | undefined>>) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} className={`set-switch${on ? ' is-on' : ''}`} onClick={() => onChange(!on)} data-qa-settings-switch={qa} {...rest}>
      <i aria-hidden="true" />
      <span>{on ? onText : offText}</span>
    </button>
  );
}
