import { useEffect, useRef, useState } from 'react';
import './npc-catchup-banner.css';

type NpcReplayProgress = { processedThroughAt: number; targetAt: number } | undefined;

/** Pending catch-ups shorter than this finish before the banner would be read. */
const SHOW_AFTER_MS = 500;

function formatGameSpan(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  const days = Math.floor(minutes / 1_440);
  const hours = Math.floor((minutes % 1_440) / 60);
  const rest = minutes % 60;
  if (days > 0) return `${days} д ${hours} ч`;
  if (hours > 0) return `${hours} ч ${rest} мин`;
  return `${rest} мин`;
}

function formatWait(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1_000));
  if (seconds < 60) return `${seconds} с`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} мин`;
  return `${Math.floor(minutes / 60)} ч ${minutes % 60} мин`;
}

/**
 * Owner decision (25.10.2026): a long absence is caught up in full, with a
 * progress bar, and commands wait until it ends. The banner only reports
 * progress; the command gate itself lives in App.
 */
export function NpcCatchupBanner({ replay }: { replay: NpcReplayProgress }) {
  const pending = Boolean(replay && replay.targetAt > replay.processedThroughAt);
  // Baseline of the current catch-up: where it started and when, in wall time.
  const baseline = useRef<{ targetAt: number; from: number; startedAt: number } | null>(null);
  const [visible, setVisible] = useState(false);

  if (pending && replay && baseline.current?.targetAt !== replay.targetAt) {
    baseline.current = { targetAt: replay.targetAt, from: replay.processedThroughAt, startedAt: performance.now() };
  }
  if (!pending) baseline.current = null;

  // While the world catches up, decorative loops (motion.css) pause: with software
  // rendering every animated layer repaints each frame and steals time from the replay.
  useEffect(() => {
    document.documentElement.classList.toggle('npc-catchup-active', pending);
    return () => document.documentElement.classList.remove('npc-catchup-active');
  }, [pending]);

  useEffect(() => {
    if (!pending) { setVisible(false); return; }
    const timer = window.setTimeout(() => setVisible(true), SHOW_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [pending]);

  if (!pending || !visible || !replay || !baseline.current) return null;
  const { from, startedAt } = baseline.current;
  const total = Math.max(1, replay.targetAt - from);
  const done = Math.min(total, Math.max(0, replay.processedThroughAt - from));
  const percent = Math.floor((done / total) * 100);
  const remaining = replay.targetAt - replay.processedThroughAt;
  const elapsedWall = performance.now() - startedAt;
  // Later game time replays slower than early time, so this is a rough guide.
  const eta = done > 0 && elapsedWall > 2_000 ? (remaining * elapsedWall) / done : null;

  return (
    <div className="npc-catchup-banner" data-qa-npc-catchup role="status" aria-live="polite">
      <div className="npc-catchup-banner__head">
        <span className="npc-catchup-banner__title">Мир догоняет время вашего отсутствия</span>
        <span className="npc-catchup-banner__percent" data-qa-npc-catchup-percent={percent}>{percent}%</span>
      </div>
      <div className="npc-catchup-banner__track" role="progressbar" aria-label="Догонка мира"
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
        <div className="npc-catchup-banner__fill" style={{ transform: `scaleX(${done / total})` }} />
      </div>
      <div className="npc-catchup-banner__meta">
        <span>Осталось игрового времени: {formatGameSpan(remaining)}</span>
        <span>{eta === null ? 'Оцениваем время ожидания…' : `Примерно ${formatWait(eta)} ожидания`}</span>
      </div>
      <div className="npc-catchup-banner__hint">Приказы станут доступны, когда догонка завершится.</div>
    </div>
  );
}
