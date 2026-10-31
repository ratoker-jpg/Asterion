import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { SaveState } from './application/contracts.ts';
import { selectWorldSummaryLeaders, type WorldSummaryLeader } from './application/world-catchup-summary.ts';
import type { NpcReplayState } from './domain/npc/replay-state.ts';
import type { WorldCatchupSummary } from './domain/npc/world-catchup-summary.ts';
import { useNpcCatchupProgress } from './ui/npc-catchup-progress-store.ts';
import { localSaveChars, recordLocalCatchupRate } from './ui/menu/cloud.ts';
import './npc-catchup-banner.css';

/** Pending catch-ups shorter than this finish before the window would be read. */
const SHOW_AFTER_MS = 500;
const numberFormat = new Intl.NumberFormat('ru-RU');

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
 * progress bar, and commands wait until it ends. Audit 26.10 M4: the progress
 * is a central modal over the whole interface, and when the world has caught
 * up it turns into a summary of what happened in the world meanwhile.
 * The command gate itself stays in App; this window only reports.
 */
export function NpcCatchupBanner({ replay: savedReplay, state, slot, onDismissSummary, onOpenMenu }: {
  replay: NpcReplayState | undefined;
  state: SaveState;
  /** The campaign's slot: this computer's replay speed is remembered for the cloud wait window. */
  slot?: { id: string; storageKey: string } | null;
  onDismissSummary: () => void;
  onOpenMenu: () => void;
}) {
  // A catch-up in the worker reports its cursor here; the save stays frozen until it ends.
  const live = useNpcCatchupProgress();
  const replay = live && savedReplay ? { ...savedReplay, ...live } : savedReplay;
  const pending = Boolean(replay && replay.targetAt > replay.processedThroughAt);
  // Baseline of the current catch-up: where it started and when, in wall time.
  const baseline = useRef<{ targetAt: number; from: number; startedAt: number } | null>(null);
  const [visible, setVisible] = useState(false);
  // Whether the progress window was on screen for this catch-up: only then is its summary worth showing.
  const announced = useRef(false);

  if (pending && replay && baseline.current?.targetAt !== replay.targetAt) {
    baseline.current = { targetAt: replay.targetAt, from: replay.processedThroughAt, startedAt: performance.now() };
  }
  // The catch-up that just ended: how fast this computer replays this world (ServerWaitWindow compares it with the server).
  const finishedRun = useRef<{ gameMs: number; wallMs: number } | null>(null);
  if (!pending && baseline.current) {
    finishedRun.current = { gameMs: baseline.current.targetAt - baseline.current.from, wallMs: performance.now() - baseline.current.startedAt };
  }
  if (!pending) baseline.current = null;
  useEffect(() => {
    const run = finishedRun.current;
    if (pending || !run || !slot) return;
    finishedRun.current = null;
    recordLocalCatchupRate(slot.id, run.gameMs, run.wallMs, localSaveChars(slot));
  }, [pending, slot]);

  // While the world catches up, decorative loops (motion.css) pause: with software
  // rendering every animated layer repaints each frame and steals time from the replay.
  useEffect(() => {
    document.documentElement.classList.toggle('npc-catchup-active', pending);
    return () => document.documentElement.classList.remove('npc-catchup-active');
  }, [pending]);

  useEffect(() => {
    if (!pending) { setVisible(false); return; }
    const timer = window.setTimeout(() => { announced.current = true; setVisible(true); }, SHOW_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [pending]);

  const summary = replay?.summary;
  const finished = !pending && summary?.finishedAt !== undefined;
  // A catch-up too short to be seen leaves no window behind it. A finished
  // summary loaded from a save was announced before the game closed.
  const loadedFinished = useRef(finished);
  useEffect(() => {
    if (finished && !announced.current && !loadedFinished.current) onDismissSummary();
  }, [finished, onDismissSummary]);

  if (finished && summary && (announced.current || loadedFinished.current)) {
    return createPortal(<CatchupSummary summary={summary} state={state} onClose={() => {
      announced.current = false;
      loadedFinished.current = false;
      onDismissSummary();
    }} />, document.body);
  }
  if (!pending || !visible || !replay || !baseline.current) return null;
  const { from, startedAt } = baseline.current;
  const total = Math.max(1, replay.targetAt - from);
  const done = Math.min(total, Math.max(0, replay.processedThroughAt - from));
  const percent = Math.floor((done / total) * 100);
  const remaining = replay.targetAt - replay.processedThroughAt;
  const elapsedWall = performance.now() - startedAt;
  // Later game time replays slower than early time, so this is a rough guide.
  const eta = done > 0 && elapsedWall > 2_000 ? (remaining * elapsedWall) / done : null;

  return createPortal(
    <div className="npc-catchup-backdrop" data-qa-npc-catchup="progress">
      <section className="npc-catchup-window" role="dialog" aria-modal="true" aria-labelledby="npc-catchup-title" aria-describedby="npc-catchup-lock">
        <header className="npc-catchup-window__head">
          <small>ПРОГОН МИРА</small>
          <h2 id="npc-catchup-title">Мир догоняет время вашего отсутствия</h2>
        </header>
        <div className="npc-catchup-window__progress" role="status" aria-live="polite">
          <div className="npc-catchup-window__percent" data-qa-npc-catchup-percent={percent}>{percent}%</div>
          <div className="npc-catchup-window__track" role="progressbar" aria-label="Прогон мира"
            aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
            <div className="npc-catchup-window__fill" style={{ transform: `scaleX(${done / total})` }} />
          </div>
        </div>
        <dl className="npc-catchup-window__facts">
          <div><dt>Осталось игрового времени</dt><dd>{formatGameSpan(remaining)}</dd></div>
          <div><dt>Примерное ожидание</dt><dd>{eta === null ? 'Оцениваем…' : formatWait(eta)}</dd></div>
          {summary ? <div><dt>Уже рассчитано боёв</dt><dd>{numberFormat.format(summary.battles)}</dd></div> : null}
        </dl>
        <p className="npc-catchup-window__lock" id="npc-catchup-lock">
          Приказы заблокированы до конца прогона: мир рассчитывает бои, полёты и стройки по порядку. Итоги появятся здесь.
        </p>
        <footer className="npc-catchup-window__actions">
          <button type="button" className="npc-catchup-window__secondary" onClick={onOpenMenu}>Меню игры</button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

function SummaryTile({ label, value, note }: { label: string; value: number; note?: string }) {
  return (
    <div className="npc-catchup-tile">
      <span>{label}</span>
      <strong>{numberFormat.format(value)}</strong>
      {note ? <small>{note}</small> : null}
    </div>
  );
}

function LeaderList({ title, rows, growth }: { title: string; rows: WorldSummaryLeader[]; growth?: boolean }) {
  return (
    <section className="npc-catchup-leaders" aria-label={title}>
      <h3>{title}</h3>
      {rows.length ? <ol>{rows.map((row) => (
        <li key={row.ownerId} className={row.isPlayer ? 'is-player' : undefined}>
          <span>{row.name}{row.isPlayer ? ' (вы)' : ''}</span>
          <b>{growth ? `+${numberFormat.format(row.growth)}` : numberFormat.format(row.points)}</b>
        </li>
      ))}</ol> : <p>Рейтинг не изменился.</p>}
    </section>
  );
}

function CatchupSummary({ summary, state, onClose }: { summary: WorldCatchupSummary; state: SaveState; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  // Ratings as they stood when the world caught up; later ticks do not reshuffle the list.
  const [{ leaders, climbers, totalGrowth }] = useState(() => selectWorldSummaryLeaders(state, summary));
  useEffect(() => { closeRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const span = (summary.finishedAt ?? summary.fromAt) - summary.fromAt;
  const quiet = summary.battles + summary.colonies + summary.alliancesFounded + summary.alliancesDissolved
    + summary.warsDeclared + summary.truces + summary.pacts + summary.sunRaids + summary.crystalsTaken === 0;

  return (
    <div className="npc-catchup-backdrop" data-qa-npc-catchup="summary">
      <section className="npc-catchup-window npc-catchup-window--summary" role="dialog" aria-modal="true" aria-labelledby="npc-catchup-summary-title">
        <header className="npc-catchup-window__head">
          <small>ИТОГИ ПРОГОНА · {formatGameSpan(span)}</small>
          <h2 id="npc-catchup-summary-title">Мир за время вашего отсутствия</h2>
        </header>
        {quiet ? <p className="npc-catchup-window__quiet">В мире было спокойно: ни боёв, ни новых колоний, ни перемен в союзах.</p> : null}
        <div className="npc-catchup-tiles" data-qa-npc-catchup-stats>
          <SummaryTile label="Бои" value={summary.battles}
            note={`Атака победила ${numberFormat.format(summary.attackerWins)} · оборона устояла ${numberFormat.format(summary.defenderWins)} · ничьих ${numberFormat.format(summary.draws)}`} />
          <SummaryTile label="Ваши бои" value={summary.playerBattles} note="Подробности — в боевых докладах" />
          <SummaryTile label="Новые колонии" value={summary.colonies} />
          <SummaryTile label="Планет уничтожено" value={summary.planetsDestroyed} />
          <SummaryTile label="Пиратские налёты" value={summary.pirateRaids} />
          <SummaryTile label="Союзы" value={summary.alliancesFounded}
            note={`Создано ${numberFormat.format(summary.alliancesFounded)} · распалось ${numberFormat.format(summary.alliancesDissolved)}`} />
          <SummaryTile label="Войны" value={summary.warsDeclared}
            note={`Перемирий ${numberFormat.format(summary.truces)} · пактов ${numberFormat.format(summary.pacts)}`} />
          <SummaryTile label="Рейды на Солнца" value={summary.sunRaids} note={`Успешных ${numberFormat.format(summary.sunRaidsWon)}`} />
          <SummaryTile label="Кристаллы получены" value={summary.crystalsTaken} />
        </div>
        <div className="npc-catchup-columns">
          <LeaderList title="Лидеры рейтинга" rows={leaders} />
          <LeaderList title={`Больше всех выросли · мир +${numberFormat.format(totalGrowth)}`} rows={climbers} growth />
        </div>
        {summary.complete ? null : (
          <p className="npc-catchup-window__partial">Начало этого прогона рассчитала прежняя версия игры: его события в сводку не попали.</p>
        )}
        <footer className="npc-catchup-window__actions">
          <button ref={closeRef} type="button" className="npc-catchup-window__primary" data-qa-npc-catchup-close onClick={onClose}>Продолжить</button>
        </footer>
      </section>
    </div>
  );
}
