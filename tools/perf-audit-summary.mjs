// Turns the JSON of electron/perf-audit-trace.cjs into a markdown table per screen and checks it against the
// frame gate of the 120 FPS program (docs/PERF_MEASUREMENT.md).
//
//   node tools/perf-audit-summary.mjs artifacts/perf-audit/perf-audit-trace-motion.json [--enforce] >> $GITHUB_STEP_SUMMARY
//
// The gate is REPORT-ONLY for now: the numbers are the "before" of PRs 2-9. Tighten the constants below (and set
// ENFORCE_BY_DEFAULT) once a PR has earned it; the exit code is non-zero only when the gate is enforced.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

/** One frame at 120 Hz. */
export const FRAME_MS = 8.33;

/**
 * The gate, per screen. Today's values are deliberately loose: they only exist to be tightened, one PR at a time.
 * The end goal (audit, section 8) is maxTaskMs < 8 and tasksOver8ms = 0.
 */
export const GATE = {
  /** The longest UI-thread task in the 5 s window of a screen (ms). */
  maxTaskMs: 1_000,
  /** Tasks longer than one 120 Hz frame in that window. */
  tasksOver8ms: 1_000,
  /** The longest task in the autosave window (ms). */
  autosaveMaxTaskMs: 1_000,
};
export const ENFORCE_BY_DEFAULT = false;

const num = (value, digits = 1) => (typeof value === 'number' && Number.isFinite(value) ? String(Math.round(value * 10 ** digits) / 10 ** digits).replace('.', ',') : '-');

/** One row per screen from a result file. */
export function screenRows(result) {
  const seconds = result.secondsPerScreen || 5;
  return Object.entries(result.screens ?? {}).map(([name, screen]) => {
    if (screen.error || !screen.trace || screen.trace.error) return { name, error: screen.error ?? screen.trace?.error ?? 'no trace' };
    const tasks = screen.trace.tasks;
    return {
      name,
      longTasksPerSecond: tasks.over50ms / seconds,
      tasksOver8ms: tasks.over8ms,
      tasksOver16ms: tasks.over16ms,
      worstTaskMs: tasks.max,
      framesOver8msPerSecond: tasks.over8ms / seconds,
      droppedFramesPerSecond: screen.trace.framesPerSecond?.DroppedFrame ?? null,
      reactCommitsPerSecond: screen.reactCommitsPerSecond,
      majorGc: screen.trace.byEvent?.MajorGC?.count ?? 0,
      heapMb: screen.page?.heap?.usedMb ?? null,
    };
  });
}

/** Messages for the screens (and the autosave window) that break the gate. */
export function gateFailures(result, gate = GATE) {
  const failures = [];
  for (const row of screenRows(result)) {
    if (row.error) { failures.push(`${row.name}: no measurement (${String(row.error).split('\n')[0]})`); continue; }
    if (row.worstTaskMs > gate.maxTaskMs) failures.push(`${row.name}: worst task ${row.worstTaskMs} ms > ${gate.maxTaskMs} ms`);
    if (row.tasksOver8ms > gate.tasksOver8ms) failures.push(`${row.name}: ${row.tasksOver8ms} tasks over ${FRAME_MS} ms > ${gate.tasksOver8ms}`);
  }
  const autosave = result.autosaveWindow?.trace?.tasks?.max;
  if (typeof autosave === 'number' && autosave > gate.autosaveMaxTaskMs) failures.push(`autosave window: worst task ${autosave} ms > ${gate.autosaveMaxTaskMs} ms`);
  return failures;
}

export function markdown(result, gate = GATE, enforced = false) {
  const rows = screenRows(result);
  const lines = [
    `### Кадры на тяжёлом мире (${result.fixture}, ${result.speed}, ${result.frameRate} Гц, анимации ${result.motion ? 'включены' : 'как у системы'})`,
    '',
    `Мир: ${result.world?.playerPlanets ?? '?'} планет игрока, ${result.world?.npcProfiles ?? '?'} ботов, ${result.world?.flights ?? '?'} полётов. Загрузка ${num((result.loadMs ?? 0) / 1000, 0)} с. Рендер: ${result.rendering}. Раннер: ${result.cpu}.`,
    '',
    '| Экран | Долгих задач/с (>50 мс) | Задач > 8,3 мс | Задач > 16,7 мс | Худшая задача, мс | Сбросов кадра/с | Коммитов React/с | Больших GC | Куча, МБ |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|',
  ];
  for (const row of rows) {
    if (row.error) { lines.push(`| ${row.name} | ошибка: ${String(row.error).split('\n')[0].slice(0, 80)} | | | | | | | |`); continue; }
    lines.push(`| ${row.name} | ${num(row.longTasksPerSecond, 2)} | ${row.tasksOver8ms} | ${row.tasksOver16ms} | ${num(row.worstTaskMs)} | ${num(row.droppedFramesPerSecond, 2)} | ${num(row.reactCommitsPerSecond, 2)} | ${row.majorGc} | ${num(row.heapMb, 0)} |`);
  }
  const autosave = result.autosaveWindow;
  if (autosave?.trace?.tasks) {
    lines.push('', `Окно автосейва (${autosave.seconds} с, экран планеты): худшая задача **${num(autosave.trace.tasks.max)} мс**, задач > 8,3 мс: ${autosave.trace.tasks.over8ms}, > 50 мс: ${autosave.trace.tasks.over50ms}.`);
  } else if (autosave?.error) {
    lines.push('', `Окно автосейва: ошибка ${String(autosave.error).split('\n')[0]}`);
  }
  const failures = gateFailures(result, gate);
  lines.push('', `Порог (${enforced ? 'проверяется' : 'только отчёт'}): худшая задача ≤ ${gate.maxTaskMs} мс, задач > 8,3 мс на экран ≤ ${gate.tasksOver8ms}, автосейв ≤ ${gate.autosaveMaxTaskMs} мс. ${failures.length ? `Нарушений: ${failures.length}.` : 'Нарушений нет.'}`);
  for (const failure of failures) lines.push(`- ${failure}`);
  return lines.join('\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const file = process.argv.slice(2).find((arg) => !arg.startsWith('--'));
  if (!file) { console.error('usage: node tools/perf-audit-summary.mjs <perf-audit-trace*.json> [--enforce]'); process.exit(2); }
  const enforce = process.argv.includes('--enforce') || ENFORCE_BY_DEFAULT;
  const result = JSON.parse(fs.readFileSync(file, 'utf8'));
  console.log(markdown(result, GATE, enforce));
  if (enforce && gateFailures(result).length) process.exit(1);
}
