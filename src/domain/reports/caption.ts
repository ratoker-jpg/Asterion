/**
 * The one number format of a message row caption («Собрано 1 037 · осталось на орбите 99 999»):
 * digit groups and the gap after a label are non-breaking spaces, so a number never splits.
 */
const NBSP = ' ';
const whole = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });

export function captionNumber(value: number): string {
  return Number.isFinite(value) ? whole.format(value).replace(/\s/g, NBSP) : '—';
}

/** «Металл 380 000»: label and number glued together. */
export function captionFact(label: string, value: number | string): string {
  return `${label}${NBSP}${typeof value === 'number' ? captionNumber(value) : value}`;
}
