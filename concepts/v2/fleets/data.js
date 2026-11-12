/* Shared worst-case data for the «Флоты → рейсы и миссии» concepts. ?state=empty clears it. */
const R = '../../../';
const ICON = (n) => `${R}src/assets/ui/actions/${n}.webp`;
const BANNER = (n) => `${R}src/assets/ui/missions/banner-${n}.webp`;
const SHIP = (n) => `${R}assets/source/faction-delivery-v1/ships/${n}_ship.png`;
const PLANET = (k) => `${R}assets/source/universe-navigation/planets/planet.variant-${String(k).padStart(2, '0')}.png`;
const HICON = (n) => `${R}src/assets/ui/header-icons/${n}.png`;

const MISSION = {
  'attack':     { label: 'Атака',        icon: 'attack',      banner: 'attack',      group: 'war' },
  'incoming':   { label: 'Атака на вас', icon: 'attack',      banner: 'attack',      group: 'threat' },
  'pirate-raid':{ label: 'Набег пиратов',icon: 'pirate-raid', banner: 'pirate-elimination', group: 'threat' },
  'transport':  { label: 'Транспорт',    icon: 'transport',   banner: 'transport',   group: 'move' },
  'espionage':  { label: 'Шпионаж',      icon: 'espionage',   banner: 'espionage',   group: 'intel' },
  'recycle':    { label: 'Переработка',  icon: 'recycle',     banner: 'recycle',     group: 'mine' },
  'gas':        { label: 'Добыча газа',  icon: 'gas',         banner: 'gas',         group: 'mine' },
  'expedition': { label: 'Экспедиция',   icon: 'expedition',  banner: 'expedition',  group: 'mine' },
  'deployment': { label: 'Дислокация',   icon: 'deployment',  banner: 'deployment',  group: 'move' },
  'colonize':   { label: 'Колонизация',  icon: 'colonize',    banner: 'colonize',    group: 'move' },
  'aid':        { label: 'Помощь союзу', icon: 'aid',         banner: 'aid',         group: 'move' },
  'space-flight':{label: 'Космический рейс', icon: 'space-flight', banner: 'space-flight', group: 'intel' },
};

const GROUP_COLOR = { threat: '#ff4d5e', war: '#ffb547', move: '#56d9f2', mine: '#7ee0a8', intel: '#b79cff' };

/* my planets */
const HOME = {
  h1: { name: 'Helion 01', c: '1:12:3', p: 3 },
  h2: { name: 'Helion 02', c: '1:12:8', p: 7 },
  h3: { name: 'Helion 03', c: '1:40:2', p: 10 },
  h4: { name: 'Северный Предел Звездоплавателя-Командора', c: '2:301:11', p: 5 },
};

/* phase: out = летит к цели, work = на месте (добывает), back = возвращается.
   t = seconds to the next event, T = full length of the current leg. */
const FLIGHTS_FULL = [
  { id: 1, m: 'incoming', hostile: true, phase: 'out', t: 252, T: 3600,
    from: { name: 'Звездоплаватель-Командор Северного Предела', c: '1:14:9', p: 12, owner: 'Звездоплаватель-Командор Северного Предела' },
    home: 'h1', ships: [['veyra_titan', 1240567], ['veyra_goliath', 88210], ['veyra_bomber', 12044], ['veyra_fighter', 900311]] },
  { id: 2, m: 'pirate-raid', hostile: true, phase: 'out', t: 700, T: 2400,
    from: { name: 'Пиратская база Чёрного Ветра', c: '1:41:15', p: 9 },
    home: 'h3', ships: [['synod_interceptor', 4200], ['synod_frigate', 610]] },
  { id: 3, m: 'espionage', phase: 'out', t: 48, T: 300, home: 'h1',
    to: { name: 'Звездоплаватель-Командор Северного Предела', c: '1:14:9', p: 12 }, ships: [['aegis_scout', 12]] },
  { id: 4, m: 'transport', phase: 'out', t: 151, T: 1200, home: 'h1',
    to: { name: 'Helion 02', c: '1:12:8', p: 7, own: true }, ships: [['aegis_large_cargo', 31800]], cargo: [['metal', 987654321000], ['mineral', 120500300], ['gas', 4500]] },
  { id: 5, m: 'attack', phase: 'out', t: 1085, T: 5400, home: 'h2',
    to: { name: 'Крепость Северного Предела-Прайм', c: '3:77:4', p: 2 }, ships: [['aegis_titan', 1240567], ['aegis_goliath', 22000], ['aegis_bomber', 98000], ['aegis_frigate', 410000], ['aegis_recycler', 3000]] },
  { id: 6, m: 'recycle', phase: 'out', t: 1630, T: 3000, home: 'h2',
    to: { name: 'Обломки', c: '3:214:7', p: 0 }, ships: [['aegis_recycler', 5400]] },
  { id: 7, m: 'gas', phase: 'work', t: 4320, T: 7200, home: 'h3',
    to: { name: 'Астероид Кассиопея-7', c: '2:88:4', p: 0 }, ships: [['aegis_cargo', 900], ['aegis_large_cargo', 120]], cargo: [['gas', 34500000]] },
  { id: 8, m: 'expedition', phase: 'work', t: 9600, T: 14400, home: 'h4',
    to: { name: 'Туманность Кассиопея-Прайм', c: '4:12:1', p: 0 }, ships: [['aegis_frigate', 3200], ['aegis_cargo', 1500]] },
  { id: 9, m: 'deployment', phase: 'out', t: 2480, T: 4000, home: 'h1',
    to: { name: 'Северный Предел Звездоплавателя-Командора', c: '2:301:11', p: 5, own: true }, ships: [['aegis_goliath', 640], ['aegis_shield_bot', 2000]], cargo: [['metal', 5000000]] },
  { id: 10, m: 'attack', phase: 'back', t: 3123, T: 5400, home: 'h2',
    to: { name: 'Ноктюрн-9', c: '1:90:6', p: 8 }, ships: [['aegis_bomber', 77000], ['aegis_large_cargo', 9000]], cargo: [['metal', 987654321000], ['mineral', 45000000000], ['gas', 3000000]] },
  { id: 11, m: 'transport', phase: 'back', t: 3944, T: 5000, home: 'h3',
    to: { name: 'Helion 01', c: '1:12:3', p: 3, own: true }, ships: [['aegis_cargo', 300]] },
  { id: 12, m: 'colonize', phase: 'out', t: 7080, T: 9000, home: 'h4',
    to: { name: 'Свободная планета', c: '5:301:12', p: 11 }, ships: [['aegis_colony', 1], ['aegis_frigate', 40]] },
  { id: 13, m: 'aid', phase: 'out', t: 195, T: 900, home: 'h2',
    to: { name: 'Орден Синей Звезды', c: '1:15:2', p: 6, ally: true }, ships: [['aegis_large_cargo', 400]], cargo: [['mineral', 25000000]] },
  { id: 14, m: 'space-flight', phase: 'back', t: 14530, T: 21600, home: 'h1',
    to: { name: 'Глубокий космос', c: '—', p: 0 }, ships: [['aegis_interceptor', 600]] },
];

const EMPTY = new URLSearchParams(location.search).get('state') === 'empty';
const FLIGHTS = EMPTY ? [] : FLIGHTS_FULL;

const nf = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
/* short count for big fleets: 1 240 567 → 1,24 млн */
const nshort = (n) => n >= 1e9 ? (n / 1e9).toFixed(n >= 1e10 ? 0 : 1).replace('.', ',') + ' млрд' : n >= 1e6 ? (n / 1e6).toFixed(2).replace('.', ',') + ' млн' : n >= 1e4 ? Math.round(n / 1e3) + ' тыс' : nf(n);
const tf = (s) => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`; };
const shipCount = (f) => f.ships.reduce((a, [, n]) => a + n, 0);
const target = (f) => f.hostile ? HOME[f.home] : f.to;
const origin = (f) => f.hostile ? f.from : HOME[f.home];
const planetImg = (o) => o.p ? PLANET(o.p) : null;
const phaseWord = (f) => f.hostile ? 'до удара' : f.phase === 'out' ? 'до прибытия' : f.phase === 'work' ? 'на месте ещё' : 'до возврата';

/* tick: every second all timers go down; consumers call onTick(cb) */
const tickers = [];
const onTick = (cb) => tickers.push(cb);
setInterval(() => { FLIGHTS.forEach((f) => { f.t = Math.max(0, f.t - 1); }); tickers.forEach((cb) => cb()); }, 1000);

/* Detail block used on selection by every concept (layout of the screen differs, details are the same facts). */
function detailHTML(f) {
  const M = MISSION[f.m], col = GROUP_COLOR[M.group];
  const [a, b] = f.phase === 'back' ? [target(f), origin(f)] : [origin(f), target(f)];
  const orb = (o, fallbackIcon) => o.p ? `<img src="${PLANET(o.p)}" alt="">` : `<img class="ico" src="${ICON(fallbackIcon)}" alt="">`;
  const ships = f.ships.slice(0, 4).map(([s, n]) => `<div class="d-ship"><img src="${SHIP(s)}" alt=""><b>${nshort(n)}</b></div>`).join('')
    + (f.ships.length > 4 ? `<div class="d-ship more"><span>+${f.ships.length - 4}</span></div>` : '');
  const cargo = f.cargo ? `<div class="d-cargo">${f.cargo.map(([r, n]) => `<div><img src="${HICON(r)}" alt=""><b>${nf(n)}</b></div>`).join('')}</div>` : '';
  const acts = f.hostile
    ? `<button class="btn danger">Ответный удар</button><button class="btn">Увести флот</button>`
    : `${f.phase !== 'back' ? '<button class="btn">Отозвать</button>' : ''}<button class="btn primary">Повторить</button>`;
  return `<div class="d-banner" style="background-image:linear-gradient(90deg,var(--bg) 0,transparent 55%),url('${BANNER(M.banner)}')"></div>
  <div class="d-head"><span class="d-kicker" style="color:${col}">${M.label}</span>
    <strong class="d-time" style="color:${f.hostile ? 'var(--red)' : '#fff'}" data-t="${f.id}">${tf(f.t)}</strong><small>${phaseWord(f)}</small></div>
  <div class="d-route"><div class="d-orb">${orb(a, 'profile')}<span>${a.name}</span></div>
    <div class="d-path" style="--c:${col}"><i></i></div>
    <div class="d-orb">${orb(b, f.m)}<span>${b.name}</span></div></div>
  <div class="d-ships">${ships}</div>${cargo}
  <div class="d-acts">${acts}</div>`;
}

function tabsHTML() {
  const n = FLIGHTS.length;
  return `<nav class="tabs"><a>Отправка</a><a class="on">Рейсы и миссии${n ? `<em>${n}</em>` : ''}</a><a>Симулятор</a></nav>`;
}

function emptyHTML(text) {
  return `<div class="empty"><img src="${R}src/assets/ui/empty/empty-flights.webp" alt=""><strong>${text || 'В небе тихо'}</strong><button class="btn primary">Отправить флот</button></div>`;
}

const frac = (f) => Math.min(1, Math.max(0, 1 - f.t / f.T));
/* picture circle with a progress ring; size in px */
function pcHTML(f, size, extra = '') {
  const M = MISSION[f.m], col = GROUP_COLOR[M.group], r = size / 2 + 3, c = 2 * Math.PI * r, s = size + 14;
  return `<div class="pc${f.hostile ? ' hot' : ''} ${extra}" style="width:${size}px;height:${size}px" data-id="${f.id}">
    <img src="${ICON(M.icon)}" alt=""><svg viewBox="0 0 ${s} ${s}"><circle class="trk" cx="${s / 2}" cy="${s / 2}" r="${r}"/>
    <circle class="val" data-ring="${f.id}" cx="${s / 2}" cy="${s / 2}" r="${r}" stroke="${col}" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - frac(f))}"/></svg></div>`;
}
const SEL0 = Number(new URLSearchParams(location.search).get('sel')) || 1;
/* live update of every [data-t] timer and [data-ring] ring */
onTick(() => {
  document.querySelectorAll('[data-t]').forEach((el) => { const f = FLIGHTS.find((x) => x.id == el.dataset.t); if (f) el.textContent = tf(f.t); });
  document.querySelectorAll('[data-ring]').forEach((el) => { const f = FLIGHTS.find((x) => x.id == el.dataset.ring); if (!f) return;
    const c = +el.getAttribute('stroke-dasharray'); el.setAttribute('stroke-dashoffset', c * (1 - frac(f))); });
});
