const number = new Intl.NumberFormat('ru-RU');

export const formatNumber = (value: number) => number.format(value);

/** «12,4 млн» above a million, exact digits below it. */
export function compactAmount(value: number): string {
  const n = Math.max(0, Math.floor(value));
  if (n < 1_000_000) return number.format(n);
  const millions = n / 1_000_000;
  if (millions < 1_000) return `${millions.toLocaleString('ru-RU', { maximumFractionDigits: millions < 100 ? 1 : 0 })} млн`;
  return `${(millions / 1_000).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} млрд`;
}

/** Energy can go below zero: «−1 240», compact like the other amounts. */
export function signedAmount(value: number): string {
  return value < 0 ? `−${compactAmount(-value)}` : compactAmount(value);
}

/** Remaining time as a clock: 05:58, 1:12:40. */
export function countdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1_000));
  const h = Math.floor(total / 3_600);
  const m = Math.floor((total % 3_600) / 60);
  const s = total % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export { plural } from '../../domain/plural.ts';

/** 0..1 of a task with a start and a finish; a task still waiting its turn reads 0. */
export function taskProgress(now: number, startedAt: number, finishAt: number): number {
  return Math.min(1, Math.max(0, (now - startedAt) / Math.max(1, finishAt - startedAt)));
}
