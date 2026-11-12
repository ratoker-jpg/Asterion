// Shared worst-case mock data for the «Сообщения» concepts (pictures only, no game logic).
(() => {
  const R = '../../../';
  const A = {
    icon: (n) => `${R}public/assets/generated/asterion/ui/report-icons/${n}.webp`,
    face: (f) => `${R}public/assets/generated/asterion/factions/battle-icons/${f}.webp`,
    ship: (race, s) => `${R}assets/source/faction-delivery-v1/ships/${race}_${s}_ship.png`,
    planet: (i) => `${R}assets/source/universe-navigation/planets/planet.variant-${String(i).padStart(2, '0')}.png`,
    res: (n) => `${R}src/assets/ui/header-icons/${n}.png`,
    spaceBg: `${R}assets/source/battle-report-v2/battle-space-background-v1.png`,
    battleBg: `${R}src/assets/battle-report/battle-bg-approved-candidate.png`,
    bigPlanet: `${R}assets/source/battle-report-v2/battle-planet-transparent-v1.png`,
    sun: `${R}assets/source/battle-report-v2/battle-sun-transparent-v1.png`,
    empty: `${R}src/assets/ui/empty/empty-reports.webp`,
  };
  const fmt = (n) => new Intl.NumberFormat('ru-RU').format(Math.abs(n)).replace(/ /g, ' ');
  const sign = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + fmt(n);
  const short = (n) => {
    const a = Math.abs(n);
    const u = (d, w) => { const v = a / d; return (v >= 100 ? Math.round(v) : Math.round(v * 10) / 10).toString() + ' ' + w; };
    const s = a >= 999.5e9 ? u(1e12, 'трлн') : a >= 999.5e6 ? u(1e9, 'млрд') : a >= 999.5e3 ? u(1e6, 'млн') : a >= 1e4 ? u(1e3, 'тыс') : fmt(a);
    return (n < 0 ? '−' : n > 0 ? '+' : '') + s.replace('.', ',');
  };

  // kind → category, picture, tone
  const KIND = {
    win:     { cat: 'battle', label: 'Победа', tone: 'ok', icon: 'reports' },
    loss:    { cat: 'battle', label: 'Поражение', tone: 'bad', icon: 'reports' },
    defence: { cat: 'battle', label: 'На вас напали', tone: 'bad', icon: 'reports' },
    pirate:  { cat: 'battle', label: 'Пираты', tone: 'bad', icon: 'reports' },
    spy:     { cat: 'intel', label: 'Разведка', tone: 'info', icon: 'system' },
    spied:   { cat: 'intel', label: 'Вас просканировали', tone: 'warn', icon: 'system' },
    recycle: { cat: 'fleet', label: 'Переработка', tone: 'ok', icon: 'flights' },
    gas:     { cat: 'fleet', label: 'Добыча газа', tone: 'ok', icon: 'flights' },
    cargo:   { cat: 'fleet', label: 'Доставка', tone: 'info', icon: 'flights' },
    ally:    { cat: 'ally', label: 'Союз', tone: 'info', icon: 'alliances' },
    letter:  { cat: 'ally', label: 'Письмо', tone: 'info', icon: 'profile' },
    sun:     { cat: 'battle', label: 'Солнце', tone: 'warn', icon: 'command-reports' },
    system:  { cat: 'system', label: 'Система', tone: 'neutral', icon: 'achievements' },
  };
  const CATS = [
    { id: 'all', label: 'Все', icon: 'reports' },
    { id: 'battle', label: 'Бои', icon: 'arena' },
    { id: 'intel', label: 'Разведка', icon: 'system' },
    { id: 'fleet', label: 'Флоты', icon: 'flights' },
    { id: 'ally', label: 'Союз и письма', icon: 'alliances' },
    { id: 'system', label: 'Система', icon: 'achievements' },
  ];
  const NAMES = [
    ['Звездоплаватель-Командор Северного Предела', 'synod'], ['Пиратский флот Чёрной Туманности', 'pirates'],
    ['Владыка Великой Северной Империи Астеров', 'aegis'], ['Рой Кассиопеи', 'veyra'], ['Бот 01', 'veyra'],
    ['Тавр', 'synod'], ['Мицелия', 'veyra'], ['Кальдера', 'aegis'], ['Аурелия', 'synod'], ['Хранитель Южных Рубежей', 'aegis'],
  ];
  const KIND_ORDER = ['win', 'defence', 'spy', 'recycle', 'loss', 'spied', 'pirate', 'gas', 'letter', 'win', 'ally', 'cargo', 'spy', 'system', 'sun', 'win', 'recycle', 'defence'];
  const VAL = { win: 312_408_119_000, loss: -98_765_432_100, defence: -987_654_321_000, pirate: -45_230_000, spy: 987_654_321_000, spied: 0, recycle: 18_400_550, gas: 2_340_000, cargo: 120_000_000, ally: 0, letter: 0, sun: 7_500_000_000, system: 0 };
  const TITLE = {
    win: 'Атака', loss: 'Атака', defence: 'Оборона', pirate: 'Налёт пиратов', spy: 'Шпионаж', spied: 'Зонд над планетой',
    recycle: 'Обломки собраны', gas: 'Газ добыт', cargo: 'Груз доставлен', ally: 'Заявка в союз', letter: 'Личное письмо', sun: 'Атака на Солнце', system: 'Новое обновление',
  };
  const items = [];
  for (let i = 0; i < 46; i++) {
    const kind = KIND_ORDER[i % KIND_ORDER.length];
    const [who, fac] = NAMES[(i * 3) % NAMES.length];
    const k = KIND[kind];
    const h = 23 - Math.floor(i * 1.3) % 24, m = (i * 17) % 60;
    items.push({
      id: i, kind, ...k, who: kind === 'system' ? 'Штаб Астериона' : kind === 'pirate' ? 'Пиратский флот Чёрной Туманности' : who,
      fac: kind === 'pirate' ? 'pirates' : fac, title: TITLE[kind],
      planet: (i % 12) + 1, coord: `${1 + (i % 4)}:${10 + i}:${1 + (i % 9)}`,
      day: i < 14 ? 'Сегодня' : i < 30 ? 'Вчера' : '9 ноября', time: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`,
      unread: i < 22 || i % 5 === 0, saved: i % 9 === 3, value: VAL[kind] * (1 - (i % 5) * 0.13),
      ships: [1_240_567, 3, 88_000, 12, 640_211][i % 5],
    });
  }
  items.forEach((x) => (x.value = Math.round(x.value)));

  // The opened battle report (worst case).
  const battle = {
    title: 'Атака', verdict: 'Победа', rounds: 6, time: '12.11 · 23:41',
    me: { name: 'Звездоплаватель-Командор Северного Предела', fac: 'synod', race: 'synod', coord: '1:117:7', before: 1_240_567, after: 1_031_902 },
    foe: { name: 'Владыка Великой Северной Империи Астеров', fac: 'aegis', race: 'aegis', coord: '1:140:24', planet: 'Кассиопея Восточный Рубеж Обороны', before: 987_412, after: 0 },
    loot: { metal: 305_864_678_000, mineral: 19_657_583_000, gas: 13_704_441 },
    lostValue: 12_830_600_000, debris: 987_654_321_000,
    profit: 312_408_119_000,
    myShips: [['titan', 'Титан', 12_000, 1_600], ['frigate', 'Фрегат', 640_211, 120_400], ['fighter', 'Истребитель', 588_356, 88_665], ['recycler', 'Переработчик', 0, 0]],
    foeShips: [['titan', 'Титан', 9_000, 9_000], ['goliath', 'Голиаф', 137_412, 137_412], ['interceptor', 'Перехватчик', 841_000, 841_000]],
  };
  const spy = {
    who: 'Хранитель Южных Рубежей', fac: 'aegis', race: 'aegis', planet: 'Новая Кассиопея Северная', coord: '2:204:9', planetImg: 9,
    res: { metal: 987_654_321_000, mineral: 888_888_888_888, gas: 777_777_777_777 }, canCarry: 1_240_000_000_000,
    fleet: [['titan', 99], ['goliath', 12_000], ['frigate', 999_999_999], ['interceptor', 404_000]], defence: 1_240_567, defenceTypes: 9, buildings: 34,
    risk: 'high',
  };
  const empty = new URLSearchParams(location.search).get('state') === 'empty';
  window.MSG = { A, fmt, sign, short, KIND, CATS, items: empty ? [] : items, battle, spy, empty };
  if (empty) document.documentElement.classList.add('is-empty');
})();
