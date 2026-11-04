import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { WHATS_NEW_RELEASES } from 'virtual:asterion-whats-new';
import { readSlotIndex } from '../../application/slots.ts';
import { formatReleaseDate, isUnseenRelease, latestVersion, readSeenVersion, whatsNewStatus, writeSeenVersion, type WhatsNewItem } from './whats-new.ts';
import './whats-new.css';

function localStore(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** The «новое» mark and the dialog of one menu (main or pause). */
export function useWhatsNew() {
  const [status, setStatus] = useState(() => {
    const next = whatsNewStatus({ stored: readSeenVersion(localStore()), hasCampaigns: readSlotIndex().slots.length > 0, releases: WHATS_NEW_RELEASES });
    if (next.store) writeSeenVersion(localStore(), next.store);
    return next;
  });
  const [open, setOpen] = useState(false);
  // What was unseen when the dialog opened stays tagged while it is open.
  const [seenAtOpen, setSeenAtOpen] = useState<string | null>(null);
  const show = useCallback(() => {
    setSeenAtOpen(readSeenVersion(localStore()));
    setOpen(true);
    const latest = latestVersion(WHATS_NEW_RELEASES);
    if (latest) writeSeenVersion(localStore(), latest);
    setStatus((current) => ({ ...current, hasNew: false }));
  }, []);
  const close = useCallback(() => setOpen(false), []);
  return { hasNew: status.hasNew, available: WHATS_NEW_RELEASES.length > 0, open, seenAtOpen, show, close };
}

function versionLabel(version: string | null) {
  return version ?? 'Скоро';
}

function NewMark() {
  return <span className="whats-new-mark" data-qa-whats-new-mark>НОВОЕ</span>;
}

/** The menu entry: the newest headline is right there, so it invites a look. */
export function WhatsNewMenuEntry({ hasNew, onOpen }: { hasNew: boolean; onOpen: () => void }) {
  const newest = WHATS_NEW_RELEASES[0];
  if (!newest) return null;
  return (
    <button type="button" className={`whats-new-entry ${hasNew ? 'is-new' : ''}`} onClick={onOpen} data-qa-whats-new-open>
      <span className="whats-new-entry__copy">
        <b>ЧТО НОВОГО {hasNew ? <NewMark /> : null}</b>
        <small>{newest.headline}</small>
      </span>
      <span className="whats-new-entry__chevron" aria-hidden="true" />
    </button>
  );
}

/** Wider than this, a picture goes under the text instead of beside it. */
const WIDE_PICTURE = 2;

function ReleaseItem({ item, index }: { item: WhatsNewItem; index: number }) {
  const [wide, setWide] = useState(false);
  return (
    <li className={`whats-new__item ${item.image ? 'has-image' : ''} ${wide ? 'is-wide' : ''}`} style={{ '--whats-new-at': index } as CSSProperties} data-qa-whats-new-item={item.image ? 'image' : 'text'}>
      <div className="whats-new__copy">
        <h4>{item.title}</h4>
        <p>{item.text}</p>
        <p className="whats-new__where"><span>Где посмотреть</span><b>{item.where}</b></p>
      </div>
      {item.image ? <img src={item.image} alt={item.imageAlt ?? ''} draggable={false} decoding="async" onLoad={(event) => setWide(event.currentTarget.naturalWidth / event.currentTarget.naturalHeight > WIDE_PICTURE)} /> : null}
    </li>
  );
}

/** The five latest updates: versions on the left, the chosen one on the right. Never blocks: Esc, ×, a click outside. */
export function WhatsNewDialog({ seen, onClose }: { seen: string | null; onClose: () => void }) {
  const releases = WHATS_NEW_RELEASES;
  const [selected, setSelected] = useState(0);
  const dialogRef = useRef<HTMLElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    tabRefs.current[0]?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      // Focus stays inside the dialog.
      const stops = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button, [tabindex="0"]')).filter((element) => element.tabIndex >= 0);
      const first = stops[0];
      const last = stops[stops.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      opener?.focus();
    };
  }, [onClose]);

  useEffect(() => { scrollRef.current?.scrollTo({ top: 0 }); }, [selected]);

  const onTabKey = (event: ReactKeyboardEvent<HTMLButtonElement>, at: number) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const next = (at + (event.key === 'ArrowDown' ? 1 : -1) + releases.length) % releases.length;
    setSelected(next);
    tabRefs.current[next]?.focus();
  };

  const release = releases[selected];
  if (!release) return null;
  const date = formatReleaseDate(release.date);
  return createPortal(
    <div className="whats-new" onMouseDown={onClose} data-qa-whats-new>
      <section ref={dialogRef} className="whats-new__panel" role="dialog" aria-modal="true" aria-label="Что нового" onMouseDown={(event) => event.stopPropagation()}>
        <header className="whats-new__head">
          <div><small>ЖУРНАЛ ОБНОВЛЕНИЙ</small><h2>Что нового</h2></div>
          <button type="button" className="whats-new__close" onClick={onClose} aria-label="Закрыть" data-qa-whats-new-close>
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3l10 10M13 3L3 13" /></svg>
          </button>
        </header>
        <div className="whats-new__body">
          <div className="whats-new__rail" role="tablist" aria-orientation="vertical" aria-label="Версии игры">
            {releases.map((entry, at) => (
              <button
                key={entry.version ?? 'next'}
                ref={(element) => { tabRefs.current[at] = element; }}
                type="button"
                role="tab"
                aria-selected={at === selected}
                tabIndex={at === selected ? 0 : -1}
                className={`whats-new__tab ${at === selected ? 'is-on' : ''}`}
                onClick={() => setSelected(at)}
                onKeyDown={(event) => onTabKey(event, at)}
                data-qa-whats-new-tab={entry.version ?? 'next'}
              >
                <b>{versionLabel(entry.version)}{isUnseenRelease(entry, seen, releases) ? <NewMark /> : null}</b>
                <small>{formatReleaseDate(entry.date) || 'следующая версия'}</small>
              </button>
            ))}
          </div>
          <div ref={scrollRef} className="whats-new__content" role="tabpanel" tabIndex={0} aria-label={`Версия ${versionLabel(release.version)}`} data-qa-whats-new-content>
            <div key={release.version ?? 'next'} className="whats-new__release">
              <small>{release.version ? `ВЕРСИЯ ${release.version}` : 'СЛЕДУЮЩАЯ ВЕРСИЯ'}{date ? ` · ${date.toUpperCase()}` : ''}</small>
              <h3>{release.headline}</h3>
              <ul>{release.items.map((item, at) => <ReleaseItem key={item.title} item={item} index={at} />)}</ul>
            </div>
          </div>
        </div>
      </section>
    </div>,
    document.body,
  );
}
