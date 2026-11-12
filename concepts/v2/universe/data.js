// Shared mock data for the Universe concepts (v2). Worst case on purpose:
// long names, 12-digit numbers, a full system; ?state=empty shows an empty system.
const R = '../../../';
const ART = {
  planet: (n) => `${R}assets/source/universe-navigation/planets/planet.variant-${String(n).padStart(2, '0')}.png`,
  asteroid: (n) => `${R}assets/source/universe-navigation/asteroids/asteroid.variant-${String(n).padStart(2, '0')}.png`,
  pirate: (n) => `${R}public/assets/generated/asterion/universe/pirate-planets/pirate-planet-${String(n).padStart(2, '0')}.webp`,
  unique: (n) => `${R}public/assets/generated/asterion/universe/unique-objects/unique-variant-${String(n).padStart(2, '0')}.webp`,
  anomaly: (n) => `${R}public/assets/generated/asterion/universe/anomalies/anomaly-${String(n).padStart(2, '0')}.webp`,
  sun: (n) => `${R}assets/source/universe-navigation/active-suns/active-sun.variant-${String(n).padStart(2, '0')}.png`,
  nebula: (n) => `${R}assets/source/universe-navigation/galaxies/galaxy.nebula-${String(n).padStart(2, '0')}.png`,
  debris: (n) => `${R}assets/source/universe-navigation/debris/debris.variant-${String(n).padStart(2, '0')}.png`,
  emblem: (race) => `${R}assets/source/generated-factions-v1/factions/${race}_emblem.png`,
  general: (race) => `${R}assets/source/generated-factions-v1/factions/${race}_general.png`,
  action: (k) => `${R}src/assets/ui/actions/${k}.webp`,
  icon: (k) => `${R}src/assets/ui/header-icons/${k}.png`,
  crest: (glyph) => `${R}src/assets/command/orbital-heraldry/glyph-${glyph}.webp`,
  score: (k) => `${R}public/assets/generated/asterion/ui/score-icons/${k}.webp`,
};

const fmt = (n) => new Intl.NumberFormat('ru-RU').format(n).replace(/ /g, ' ');
const short = (n) => n >= 1e9 ? `${(n / 1e9).toFixed(n >= 1e11 ? 0 : 1).replace('.', ',')} млрд` : n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e8 ? 0 : 1).replace('.', ',')} млн` : n >= 1e3 ? `${Math.round(n / 1e3)} тыс` : String(n);

const RACE = { aegis: 'Эгида', synod: 'Синод', veyra: 'Вейра' };
const TONE = {
  self: { word: 'Ваша планета', color: '#5aa9ff' },
  ally: { word: 'Союзник', color: '#4fd18b' },
  enemy: { word: 'Вражеский союз', color: '#ff3b4e' },
  range: { word: 'В диапазоне атаки', color: '#ff8f98' },
  neutral: { word: 'Вне диапазона', color: '#8d99ab' },
  protected: { word: 'Под защитой новичка', color: '#8d99ab' },
  unique: { word: 'Уникальный объект', color: '#f2c14e' },
  pirate: { word: 'Пиратская база', color: '#ff8a3d' },
  anomaly: { word: 'Аномалия', color: '#b48cff' },
  asteroid: { word: 'Астероид', color: '#d6a77a' },
  uninhabited: { word: 'Необитаемая', color: '#5f6b7c' },
  empty: { word: 'Свободно', color: '#3d4757' },
};

const ALLIANCES = {
  dark: { tag: 'ТЬМА', name: 'Тёмный Альянс Северных Рубежей и Дальних Окраин', glyph: 'phoenix-crimson' },
  light: { tag: 'СВЕТ', name: 'Светлый Предел', glyph: 'trident-emerald' },
  trade: { tag: 'КУПЦЫ', name: 'Гильдия Вольных Купцов', glyph: 'nova-silver' },
  mine: { tag: 'HLN', name: 'Содружество Гелиона', glyph: 'trident-cyan' },
};

const LONG = 'Звездоплаватель-Командор Северного Предела';

// 24 positions of system 1:3. `art` is a function index into ART.
const FULL = [
  { pos: 1, tone: 'self', kind: 'planet', name: 'Helion 01', owner: 'Вы', race: 'aegis', ally: 'mine', art: ART.planet(3), points: 4_512_330 },
  { pos: 2, tone: 'ally', kind: 'planet', name: 'Ира Вель', owner: 'Ира Вель', race: 'synod', ally: 'light', art: ART.planet(5), points: 2_904_118, online: 'в игре' },
  { pos: 3, tone: 'enemy', kind: 'planet', name: LONG, owner: LONG, race: 'veyra', ally: 'dark', art: ART.planet(9), points: 987_654_321_000, debris: 987_654_321_000, spy: '14 мин назад', online: '2 ч назад' },
  { pos: 4, tone: 'empty', kind: 'empty' },
  { pos: 5, tone: 'uninhabited', kind: 'planet', name: 'Необитаемая', art: ART.planet(7) },
  { pos: 6, tone: 'range', kind: 'planet', name: 'Гигант Кронос', owner: 'Гигант Кронос', race: 'aegis', art: ART.planet(11), points: 1_138_151, spy: '3 дн назад' },
  { pos: 7, tone: 'neutral', kind: 'planet', name: 'Старый Порт Тау-Кита', owner: 'Тау-Кит', race: 'synod', ally: 'trade', art: ART.planet(2), points: 98_765_432 },
  { pos: 8, tone: 'asteroid', kind: 'asteroid', name: 'Астероид', art: ART.asteroid(2), gas: 48_210, debris: 3_400_000, moves: '2 ч 10 мин' },
  { pos: 9, tone: 'unique', kind: 'unique', name: 'Кристальный архипелаг Древних Пределов Окраины', art: ART.unique(4), occupant: LONG, timer: '54 мин' },
  { pos: 10, tone: 'protected', kind: 'planet', name: 'Новичок_1999', owner: 'Новичок_1999', race: 'veyra', art: ART.planet(4), points: 12_400, shield: 'новичок' },
  { pos: 11, tone: 'ally', kind: 'planet', name: 'Северная Гавань', owner: 'Ира Вель', race: 'synod', ally: 'light', art: ART.planet(6), points: 2_904_118 },
  { pos: 12, tone: 'enemy', kind: 'planet', name: 'Цитадель Багрового Рассвета', owner: 'Багровый Рассвет', race: 'veyra', ally: 'dark', art: ART.planet(10), points: 456_789_012, shield: '2 ч 13 мин' },
  { pos: 13, tone: 'empty', kind: 'empty', debris: 120_000 },
  { pos: 14, tone: 'pirate', kind: 'pirate', name: 'Отступник', art: ART.pirate(3), timer: '41 с', debris: 12_345_678_901 },
  { pos: 15, tone: 'anomaly', kind: 'anomaly', name: 'Разлом Эха', art: ART.anomaly(2), mine: 'ваш флот добывает' },
  { pos: 16, tone: 'uninhabited', kind: 'planet', name: 'Необитаемая', art: ART.planet(8) },
  { pos: 17, tone: 'range', kind: 'planet', name: 'Механика', owner: 'Бот 01', race: 'aegis', art: ART.planet(12), points: 3_210_000, shield: '2 ч 13 мин' },
  { pos: 18, tone: 'self', kind: 'planet', name: 'Helion 02 — Северная Верфь Первого Пояса', owner: 'Вы', race: 'aegis', ally: 'mine', art: ART.planet(1), points: 4_512_330 },
  { pos: 19, tone: 'empty', kind: 'empty' },
  { pos: 20, tone: 'neutral', kind: 'planet', name: 'Тихая Пристань', owner: 'Странник', race: 'synod', art: ART.planet(6), points: 77_000_000 },
  { pos: 21, tone: 'uninhabited', kind: 'planet', name: 'Необитаемая', art: ART.planet(7) },
  { pos: 22, tone: 'enemy', kind: 'planet', name: `${LONG} II`, owner: LONG, race: 'veyra', ally: 'dark', art: ART.planet(11), points: 987_654_321_000, spy: '1 ч назад' },
  { pos: 23, tone: 'empty', kind: 'empty' },
  { pos: 24, tone: 'asteroid', kind: 'asteroid', name: 'Астероид', art: ART.asteroid(5), gas: 9_120 },
];

const EMPTY = Array.from({ length: 24 }, (_, i) => ([5, 11, 19].includes(i + 1)
  ? { pos: i + 1, tone: 'uninhabited', kind: 'planet', name: 'Необитаемая', art: ART.planet([7, 8, 2][[5, 11, 19].indexOf(i + 1)]) }
  : { pos: i + 1, tone: 'empty', kind: 'empty' }));

const isEmpty = new URLSearchParams(location.search).get('state') === 'empty';

// The selected target and its full card (atlas + object card merged).
const TARGET = {
  pos: 3, coord: '[1:3:3]', name: LONG, owner: LONG, race: 'veyra', ally: ALLIANCES.dark, tone: 'enemy',
  status: 'Вражеский союз · в диапазоне атаки', online: 'был 2 ч назад',
  points: [
    { key: 'overall-star', label: 'Общие', v: 987_654_321_000 },
    { key: 'resource-crystal', label: 'Ресурсные', v: 912_345_678_901 },
    { key: 'battle', label: 'Боевые', v: 75_308_642_099 },
    { key: 'achievement-trophy', label: 'Достижения', v: 1_240 },
  ],
  spy: { ago: '14 мин назад', metal: 123_456_789_012, mineral: 98_765_432_109, gas: 45_678_901_234, fleet: 1_240_567, defence: 3_400 },
  debris: 987_654_321_000,
  actions: [
    { k: 'espionage', label: 'Шпионаж', time: '00:02:14' },
    { k: 'attack', label: 'Атака', time: '00:12:48', main: true },
    { k: 'recycle', label: 'Собрать обломки', time: '00:08:41' },
    { k: 'transport', label: 'Транспорт', time: '', off: 'только своим и союзу' },
  ],
  planets: [
    { name: LONG, coord: '[1:3:3]', art: ART.planet(9), debris: 987_654_321_000, here: true },
    { name: `${LONG} II`, coord: '[1:3:22]', art: ART.planet(11) },
    { name: 'Багровый Бастион Последней Линии Обороны', coord: '[1:7:14]', art: ART.planet(10), gate: 'Врата · 2 ч 13 мин' },
    { name: 'Ледяной Шпиль', coord: '[1:12:2]', art: ART.planet(4) },
    { name: 'Северный Рубеж', coord: '[1:21:9]', art: ART.planet(2), debris: 45_000 },
    { name: 'Окраина-7', coord: '[1:33:18]', art: ART.planet(8), shield: true },
    { name: 'Последняя Застава Тёмного Предела', coord: '[1:40:24]', art: ART.planet(12) },
  ],
};

const EMPTY_TARGET = {
  pos: 7, coord: '[1:37:7]', name: 'Свободная позиция', tone: 'empty', status: 'Можно занять колонизатором',
  actions: [
    { k: 'colonize', label: 'Колонизировать', time: '', off: 'нет колонизатора' },
    { k: 'recycle', label: 'Собрать обломки', time: '00:31:05', note: 'заранее' },
    { k: 'expedition', label: 'Экспедиция', time: '00:44:10' },
  ],
};

// 40 systems of the galaxy, deterministic pseudo-random content for the navigator.
function rnd(seed) { let s = seed; return () => (s = (s * 9301 + 49297) % 233280) / 233280; }
const r = rnd(7);
const SYSTEMS = Array.from({ length: 40 }, (_, i) => {
  const n = i + 1;
  const self = [1, 3, 9, 22, 30].includes(n) ? (n === 3 ? 2 : 1) : 0;
  const empty = isEmpty && n === 37;
  return {
    n,
    self: empty ? 0 : self,
    ally: empty ? 0 : Math.floor(r() * 3) + (n === 3 ? 1 : 0),
    enemy: empty ? 0 : (r() < 0.35 ? Math.floor(r() * 4) + 1 : 0) + (n === 3 ? 3 : 0),
    range: empty ? 0 : Math.floor(r() * 5),
    debris: empty ? 0 : (r() < 0.3 ? Math.floor(r() * 9e11) : 0) + (n === 3 ? 988_000_000_000 : 0),
    pirate: !empty && r() < 0.2,
    unique: !empty && r() < 0.15,
    gas: empty ? 0 : Math.floor(r() * 3),
    sun: n === 18 ? 'raid' : n === 27 ? 'frozen' : 'ok',
    gate: n === 7 || n === 40,
    filled: empty ? 3 : 10 + Math.floor(r() * 14),
  };
});

const CURRENT_SYSTEM = isEmpty ? 37 : 3;
const SYSTEM = isEmpty ? EMPTY : FULL;
const SELECTED = isEmpty ? EMPTY_TARGET : TARGET;
const HEADER = { metal: 450_100_000_000, mineral: 300_100_000_000, gas: 189_382_930_000, energy: 999_999_999, planet: 'Helion 02 — Северная Верфь Первого Пояса' };

function headerHTML() {
  return `<header class="hud">
    <div class="hud-res"><img src="${ART.icon('metal')}"><span><small>Металл</small><b>${fmt(HEADER.metal)}</b></span></div>
    <div class="hud-res"><img src="${ART.icon('mineral')}"><span><small>Минералы</small><b>${fmt(HEADER.mineral)}</b></span></div>
    <div class="hud-res"><img src="${ART.icon('gas')}"><span><small>Газ</small><b>${fmt(HEADER.gas)}</b></span></div>
    <nav class="hud-nav"><span>Планета</span><span class="on">Вселенная</span><span>Флоты</span><span>Операции</span><span>Командование</span><span>Сообщения</span></nav>
    <div class="hud-note">шапка игры упрощена</div>
  </header>`;
}
