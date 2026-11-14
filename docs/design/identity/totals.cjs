// Подсчёт экономики очков и магазина по каталогу: node docs/design/identity/totals.cjs
// Модель игроков — допущение концепции, цифры попадают в IDENTITY-AND-ACHIEVEMENTS.md.
require('vm').runInThisContext(require('fs').readFileSync(require('path').join(__dirname, 'catalog.js'), 'utf8'));
const { LIST, RANKS, CATS, SHOP, KINDS } = globalThis.ACH;

const by = (key) => LIST.reduce((acc, a) => ((acc[a[key]] = (acc[a[key]] || 0) + 1), acc), {});
const sum = (list) => list.reduce((s, a) => s + a.points, 0);
const ids = (list) => list.map((id) => LIST.find((a) => a.id === id) || (() => { throw new Error(id); })());

console.log('Всего достижений:', LIST.length, by('kind'), by('tier'));
console.log('По разделам:', CATS.map((c) => `${c.name} ${LIST.filter((a) => a.cat === c.id).length}`).join(', '));
console.log('Вехи (один раз), сумма:', sum(LIST.filter((a) => a.kind === 'milestone')));
console.log('Подвиги раунда, максимум за один раунд:', sum(LIST.filter((a) => a.kind === 'round')));
console.log('Летопись, сумма:', sum(LIST.filter((a) => a.kind === 'chronicle')));

// Магазин: сколько обликов и сколько стоит всё, что продаётся (для одной расы игрока).
const sale = SHOP.filter((g) => typeof g.unlock === 'number');
const total = (list) => list.reduce((s, g) => s + g.count * g.unlock, 0);
console.log('\nМагазин (для одной расы):');
for (const [k, n] of Object.entries(KINDS)) {
  const g = SHOP.filter((x) => x.kind === k);
  const cnt = (f) => g.filter(f).reduce((s, x) => s + x.count, 0);
  console.log(`  ${n}: всего ${cnt(() => true)}, бесплатно ${cnt((x) => x.unlock === 'free')}, продаётся ${cnt((x) => typeof x.unlock === 'number')} на ${total(g.filter((x) => typeof x.unlock === 'number'))} очков, не продаётся ${cnt((x) => ['ach', 'win', 'lead'].includes(x.unlock))}`);
}
console.log('  Итого продаётся:', sale.reduce((s, g) => s + g.count, 0), 'обликов на', total(sale), 'очков');
const prices = sale.flatMap((g) => Array(g.count).fill(g.unlock)).sort((a, b) => a - b);
const median = prices[Math.floor(prices.length / 2)];
console.log('  Цены: от', prices[0], 'до', prices[prices.length - 1], '· медиана', median);

// Кто что берёт за раунд (допущения).
const avg = {
  1: ['first-stone', 'builder', 'scholar', 'colonist', 'power-grid', 'first-blood', 'stone-wall', 'eyes', 'probe-unique', 'pirate-hunter',
    'scavenger', 'gas-baron', 'discoverer', 'shoulder', 'joint-strike', 'to-the-sun', 'founder', 'trader', 'seven-worlds', 'to-the-end'],
  2: ['architect', 'fleet-lord', 'repairman', 'not-welcome', 'peacemaker', 'seven-worlds', 'to-the-end', 'fortress-round'],
  3: ['bridge', 'clean-win', 'seven-worlds', 'to-the-end', 'veteran', 'seven-x3', 'helper-round'],
  later: ['seven-worlds', 'to-the-end', 'fortress-round', 'scout-round'],
  laterMilestones: 45, // ещё две-три вехи за раунд (вех 44, средний берёт их годами)
};
const strong = {
  1: [...avg[1], 'architect', 'fleet-lord', 'clean-win', 'david', 'world-breaker', 'bridge', 'crystal', 'gate-builder', 'leader-30',
    'top-ten', 'best-fighter', 'untouchable', 'round-winner', 'raid-season', 'sun-round'],
  2: ['empire-architect', 'academic', 'full-dozen', 'shadow', 'silent', 'not-welcome', 'repairman', 'crystal-keeper', 'sun-defender', 'full-roster',
    'seven-worlds', 'to-the-end', 'top-ten', 'best-fighter', 'untouchable', 'raid-season', 'sun-round', 'fortress-round'],
  3: ['armada', 'hundred-wins', 'pirate-bane', 'pillar', 'seven-worlds', 'to-the-end', 'top-ten', 'first-place', 'round-winner', 'veteran', 'seven-x3', 'two-crowns', 'raid-season', 'sun-round'],
  later: ['seven-worlds', 'to-the-end', 'top-ten', 'untouchable', 'raid-season', 'sun-round', 'helper-round'],
  laterMilestones: 40,
  laterWinEvery: 3, // выигрывает примерно каждый третий раунд
};

function run(model, rounds, extraWin) {
  let all = 0; const out = [];
  for (let r = 1; r <= rounds; r += 1) {
    let pts = model[r] ? sum(ids(model[r])) : sum(ids(model.later)) + model.laterMilestones;
    if (!model[r] && extraWin && r % extraWin === 0) pts += 150;
    all += pts; out.push([r, pts, all]);
  }
  return out;
}
const rankAt = (p) => RANKS.filter((r) => r.at <= p).pop().name;
for (const [name, model, win] of [['Средний', avg, 0], ['Сильный', strong, strong.laterWinEvery]]) {
  console.log(`\n${name} игрок: раунд | за раунд | всего | ранг | покупок за раунд по медиане ${median}`);
  for (const [r, pts, all] of run(model, 10, win)) console.log(`  ${r} | ${pts} | ${all} | ${rankAt(all)} | ${(pts / median).toFixed(1)}`);
}
