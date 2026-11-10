import { FrameMeter, formatFrameMeter } from './frame-meter.ts';
import './frame-meter.css';

/**
 * Frame meter overlay (perf PR 1). Plain DOM outside React on purpose: it must
 * not add renders to the thing it measures. While it is off nothing runs: no
 * requestAnimationFrame, no observer, no element. While it is on: one rAF
 * callback that writes into a ring buffer, and a DOM update four times a second.
 */
const STORAGE_KEY = 'asterion.frame-meter.v1';
const UPDATE_MS = 250;
const WINDOW_MS = 5_000;

let enabled = false;
const listeners = new Set<() => void>();
let stop: (() => void) | null = null;

function readStored(): boolean {
  try { return window.localStorage.getItem(STORAGE_KEY) === '1'; } catch { return false; }
}

function start(): () => void {
  const meter = new FrameMeter();
  let longTasks: number[] = [];
  let observer: PerformanceObserver | null = null;
  try {
    observer = new PerformanceObserver((list) => {
      const at = performance.now();
      for (let index = 0; index < list.getEntries().length; index += 1) longTasks.push(at);
    });
    observer.observe({ type: 'longtask', buffered: false });
  } catch { observer = null; }

  const root = document.createElement('div');
  root.className = 'frame-meter';
  root.setAttribute('data-qa-frame-meter', '');
  root.setAttribute('role', 'status');
  root.setAttribute('aria-label', 'Счётчик кадров');
  const rows: Record<string, HTMLElement> = {};
  const addRow = (key: string, label: string) => {
    const row = document.createElement('div');
    row.className = 'frame-meter-row';
    const name = document.createElement('span');
    name.textContent = label;
    const value = document.createElement('strong');
    value.textContent = '—';
    row.append(name, value);
    root.append(row);
    rows[key] = value;
  };
  addRow('fps', 'Кадров/с');
  addRow('worst', 'Худший кадр (5 с)');
  addRow('over8', 'Кадров > 8,3 мс');
  addRow('over16', 'Кадров > 16,7 мс');
  addRow('longTasks', 'Долгих задач (>50 мс)');
  const note = document.createElement('small');
  note.className = 'frame-meter-note';
  root.append(note);
  document.body.append(root);

  let frame = 0;
  const tick = (time: number) => {
    meter.record(time);
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  const timer = window.setInterval(() => {
    const now = performance.now();
    longTasks = longTasks.filter((at) => now - at <= WINDOW_MS);
    const text = formatFrameMeter(meter.snapshot(now, WINDOW_MS), longTasks.length);
    rows.fps.textContent = text.fps;
    rows.worst.textContent = text.worst;
    rows.over8.textContent = text.over8;
    rows.over16.textContent = text.over16;
    rows.longTasks.textContent = text.longTasks;
    note.textContent = text.hz60 ? 'Монитор на 60 Гц: кадры дольше 8,3 мс здесь норма.' : '';
  }, UPDATE_MS);

  return () => {
    cancelAnimationFrame(frame);
    window.clearInterval(timer);
    observer?.disconnect();
    root.remove();
  };
}

function apply(): void {
  if (enabled && !stop) stop = start();
  else if (!enabled && stop) { stop(); stop = null; }
}

export function isFrameMeterEnabled(): boolean {
  return enabled;
}

export function setFrameMeterEnabled(next: boolean): void {
  if (enabled === next) return;
  enabled = next;
  try { window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0'); } catch { /* private mode: the toggle still works for this session */ }
  apply();
  for (const listener of listeners) listener();
}

export function subscribeFrameMeter(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Call once at startup: restores the saved on/off choice. */
export function installFrameMeter(): void {
  enabled = readStored();
  apply();
}
