import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import './game-select.css';

export type GameSelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
  /** A second, quieter line: why an option is locked, a countdown, a planet's fleet. */
  hint?: string;
  /** Spoken instead of the label when the visible text is shortened. */
  ariaLabel?: string;
  /** Extra data attributes for QA, carried by both the native and the visible option. */
  data?: Readonly<Record<string, string | boolean | undefined>>;
};

type GameSelectProps = {
  value: string;
  options: readonly GameSelectOption[];
  onChange: (value: string) => void;
  /** Shown when no option carries the current value (an empty «Выберите…» choice). */
  placeholder?: string;
  label: string;
  disabled?: boolean;
  className?: string;
  /** Extra attributes for the native select (data-qa-*). */
  selectProps?: Readonly<Record<string, string | boolean | undefined>>;
};

type PopupPlace = { left: number; width: number; top?: number; bottom?: number; maxHeight: number };

const POPUP_GAP = 6;
const POPUP_MARGIN = 12;
const POPUP_MAX_HEIGHT = 320;

/**
 * An in-game dropdown. The list lives in document.body at window coordinates, so
 * a scrolling dialog cannot clip it, and it opens upward when there is no room
 * below. A visually hidden native select keeps the value, the form semantics and
 * the option list that QA and assistive tools read; pointer and keyboard use go
 * through the visible button.
 */
export function GameSelect({ value, options, onChange, placeholder, label, disabled = false, className, selectProps }: GameSelectProps) {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<PopupPlace | null>(null);
  const [active, setActive] = useState(-1);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const selected = options.find((option) => option.value === value && option.value !== '');

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  };

  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const below = window.innerHeight - rect.bottom - POPUP_GAP - POPUP_MARGIN;
      const above = rect.top - POPUP_GAP - POPUP_MARGIN;
      const openUp = below < Math.min(POPUP_MAX_HEIGHT, 180) && above > below;
      setPlace({
        left: rect.left,
        width: rect.width,
        ...(openUp ? { bottom: window.innerHeight - rect.top + POPUP_GAP } : { top: rect.bottom + POPUP_GAP }),
        maxHeight: Math.min(POPUP_MAX_HEIGHT, openUp ? above : below),
      });
    };
    measure();
    window.addEventListener('resize', measure);
    // Scrolling the dialog underneath moves the trigger: follow it (capture sees every scroller).
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || listRef.current?.contains(target)) return;
      close(false);
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => window.removeEventListener('pointerdown', onPointerDown, true);
  }, [open]);

  useEffect(() => {
    if (open) listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [open, place === null]);

  const enabledIndexes = options.flatMap((option, index) => (option.disabled ? [] : [index]));

  const step = (direction: 1 | -1) => {
    if (!enabledIndexes.length) return;
    const position = enabledIndexes.indexOf(active);
    const next = position < 0
      ? (direction > 0 ? 0 : enabledIndexes.length - 1)
      : (position + direction + enabledIndexes.length) % enabledIndexes.length;
    setActive(enabledIndexes[next]);
  };

  const choose = (option: GameSelectOption) => {
    if (option.disabled) return;
    close(true);
    if (option.value !== value) onChange(option.value);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (event.key === 'Escape' && open) {
      // The dialog behind stays open: Escape closes only the list.
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        setActive(options.findIndex((option) => option.value === value));
        setOpen(true);
      } else step(event.key === 'ArrowDown' ? 1 : -1);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (!open) {
        setActive(options.findIndex((option) => option.value === value));
        setOpen(true);
      } else if (active >= 0 && options[active]) choose(options[active]);
    } else if (event.key === 'Tab' && open) {
      close(false);
    }
  };

  const shown: ReactNode = selected ? selected.label : placeholder ?? options.find((option) => option.value === '')?.label ?? '';

  return (
    <span className={`game-select${open ? ' is-open' : ''}${className ? ` ${className}` : ''}`}>
      <select
        className="game-select__native"
        tabIndex={-1}
        aria-hidden="true"
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        {...selectProps}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled} aria-label={option.ariaLabel} {...option.data}>{option.hint ? `${option.label} · ${option.hint}` : option.label}</option>
        ))}
      </select>
      <button
        ref={triggerRef}
        type="button"
        className="game-select__trigger"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={label}
        disabled={disabled}
        data-qa-game-select-trigger
        onClick={() => {
          setActive(options.findIndex((option) => option.value === value));
          setOpen((current) => !current);
        }}
        onKeyDown={onKeyDown}
      >
        <span className={selected ? '' : 'is-placeholder'}>{shown}</span>
        <i aria-hidden="true" />
      </button>
      {open && place ? createPortal(
        <div
          ref={listRef}
          id={listId}
          className="game-select__list"
          role="listbox"
          aria-label={label}
          data-qa-game-select-list
          style={{ left: place.left, width: place.width, top: place.top, bottom: place.bottom, maxHeight: place.maxHeight }}
        >
          {options.map((option, index) => (
            <button
              key={option.value}
              type="button"
              role="option"
              tabIndex={-1}
              aria-selected={option.value === value}
              disabled={option.disabled}
              className={index === active ? 'is-active' : ''}
              data-qa-game-select-option={option.value}
              onPointerEnter={() => setActive(index)}
              onClick={() => choose(option)}
            >
              <span>{option.label}</span>
              {option.hint ? <small>{option.hint}</small> : null}
            </button>
          ))}
        </div>,
        document.body,
      ) : null}
    </span>
  );
}
