import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { ACTION_ART } from '../actions/action-art.ts';
import { SUN_RAID_MISSION_ICON } from '../sun-raid/sun-raid-assets.ts';
import './quick-actions.css';

export type SunQuickRaid = { allianceTag: string; arrivesAt: number };

export type SunQuickMenuProps = {
  galaxy: number;
  system: number;
  efficiency: number;
  /** Incoming raids on this Sun the player may defend against. */
  raids: readonly SunQuickRaid[];
  now: number;
  anchor: HTMLElement;
  /** Whether «Рейд на Солнце» opens the alliance operation; the reason when it does not. */
  raidAccess: { enabled: boolean; reason?: string };
  onClose: () => void;
  onDefend: () => void;
  onRaid: () => void;
  onDetails: () => void;
};

function countdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1_000));
  const hours = Math.floor(total / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const seconds = total % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  return hours ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

type Item = { id: 'defend' | 'raid' | 'details'; label: string; art: string; enabled: boolean; note: string; hostile?: boolean; run: () => void };

/**
 * Right mouse button on a system's Sun: the same circles as on planets
 * (PR #176). «Защитить» opens the quick defence window for every planet,
 * «Рейд на Солнце» the alliance operation, «Подробнее» the Sun card.
 */
export function SunQuickMenu({ galaxy, system, efficiency, raids, now, anchor, raidAccess, onClose, onDefend, onRaid, onDetails }: SunQuickMenuProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<{ left: number; top: number; side: 'right' | 'left' } | null>(null);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const rect = anchor.getBoundingClientRect();
    const width = root.offsetWidth;
    const height = root.offsetHeight;
    const right = rect.right + 18;
    const side = right + width <= window.innerWidth - 8 ? 'right' as const : 'left' as const;
    const left = side === 'right' ? right : Math.max(8, rect.left - 18 - width);
    const top = Math.min(Math.max(8, rect.top + rect.height / 2 - height / 2), window.innerHeight - height - 92);
    setPlacement((current) => (current && current.left === left && current.top === top ? current : { left, top: Math.max(8, top), side }));
  });

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) onClose(); };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);
  useEffect(() => {
    const first = rootRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? rootRef.current?.querySelector<HTMLElement>('[role="menuitem"]');
    first?.focus({ preventScroll: true });
    return () => { if (anchor.isConnected) anchor.focus({ preventScroll: true }); };
  }, [anchor]);

  const next = raids[0];
  const items: Item[] = [
    {
      id: 'defend', label: 'Защитить', art: ACTION_ART['sun-support'], enabled: raids.length > 0,
      note: next ? `[${next.allianceTag}] · удар через ${countdown(next.arrivesAt - now)}` : 'Сейчас на это Солнце никто не нападает.',
      run: onDefend,
    },
    { id: 'raid', label: 'Рейд на Солнце', art: SUN_RAID_MISSION_ICON, enabled: raidAccess.enabled, hostile: true, note: raidAccess.enabled ? 'Операция союза' : raidAccess.reason ?? 'Недоступно.', run: onRaid },
    { id: 'details', label: 'Подробнее', art: ACTION_ART['object-card'], enabled: true, note: 'Яркость, рейды, кристаллы', run: onDetails },
  ];
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const list = Array.from(rootRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const index = list.indexOf(document.activeElement as HTMLElement);
    list[(index + (event.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length]?.focus();
  };
  const tone = { '--qa-k': raids.length ? '#f0445e' : '#ffb36b' } as CSSProperties;

  return createPortal(
    <div ref={rootRef} className={`quick-pop quick-pop--${placement?.side ?? 'right'} is-menu quick-pop--sun`} role="menu" aria-label={`Быстрые действия: Солнце ${galaxy}:${system}`}
      style={{ ...(placement ? { left: placement.left, top: placement.top } : { left: -9999, top: 0 }), ...tone }} data-qa-quick-menu="sun" data-qa-quick-target={`sun:${galaxy}:${system}`} onKeyDown={onKeyDown}>
      <header className="quick-pop__head">
        <b><span>Солнце</span> <em>[{galaxy}:{String(system).padStart(2, '0')}]</em></b>
        <small>{raids.length ? `Под атакой · ${raids.length > 1 ? `рейдов: ${raids.length}` : `[${next!.allianceTag}]`}` : `Эффективность ${efficiency}%`}</small>
      </header>
      {items.map((item, index) => (
        <button key={item.id} type="button" role="menuitem" aria-disabled={!item.enabled}
          className={`quick-pop__item ${item.enabled ? '' : 'is-off'} ${item.hostile ? 'is-hostile' : ''}`} style={{ '--qa-i': index } as CSSProperties}
          data-qa-quick-action={`sun-${item.id}`} data-qa-quick-enabled={item.enabled ? 'true' : 'false'}
          onClick={() => { if (!item.enabled) return; onClose(); item.run(); }}>
          <img src={item.art} alt="" draggable={false} />
          <span>
            <b>{item.label}</b>
            <small className={item.enabled ? 'quick-pop__time' : 'quick-pop__reason'}>{item.note}</small>
          </span>
        </button>
      ))}
    </div>,
    document.body,
  );
}
