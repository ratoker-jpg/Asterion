// One formatter each: building an Intl.NumberFormat per cell per render cost milliseconds a second.
const NUMBER_FORMAT = new Intl.NumberFormat('ru-RU');
const SHORT_FORMAT_WHOLE = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
const SHORT_FORMAT_TWO = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });

export function formatNumber(value: number) {
  return NUMBER_FORMAT.format(value);
}

/** Header cells are sized for «999 999 999»; larger values switch to «1,25 млрд». The tooltip keeps the exact number. */
export function formatHeaderNumber(value: number) {
  const short = (divider: number, unit: string) => `${(value / divider >= 100 ? SHORT_FORMAT_WHOLE : SHORT_FORMAT_TWO).format(value / divider)} ${unit}`;
  if (Math.abs(value) >= 1e12) return short(1e12, 'трлн');
  if (Math.abs(value) >= 1e9) return short(1e9, 'млрд');
  return formatNumber(value);
}
