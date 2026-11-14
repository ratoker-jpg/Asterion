/** Russian noun form for a count: plural(3, 'планета', 'планеты', 'планет'). */
export function plural(count: number, one: string, few: string, many: string): string {
  const tens = Math.abs(count) % 100;
  const units = tens % 10;
  if (tens >= 11 && tens <= 14) return many;
  if (units === 1) return one;
  return units >= 2 && units <= 4 ? few : many;
}
