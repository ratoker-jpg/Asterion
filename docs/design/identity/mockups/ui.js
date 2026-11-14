// Общие помощники макетов. Только картинки, без логики игры.
(() => {
  const s = document.querySelector('.stage');
  const fit = () => s && s.style.setProperty('--k', Math.min(innerWidth / 1920, innerHeight / 1080));
  fit(); addEventListener('resize', fit);

  const R = '../../../../';
  const q = new URLSearchParams(location.search);
  const fmt = (n) => new Intl.NumberFormat('ru-RU').format(n).replace(/ /g, ' ');
  const A = {
    report: (n) => `${R}public/assets/generated/asterion/ui/report-icons/${n}.webp`,
    score: (n) => `${R}public/assets/generated/asterion/ui/score-icons/${n}.webp`,
    mission: (n) => `${R}src/assets/ui/mission-icons/${n}.webp`,
    head: (n) => `${R}src/assets/ui/header-icons/${n}.webp`,
    banner: (n) => `${R}src/assets/ui/missions/banner-${n}.webp`,
    medalRank: (n) => `${R}src/assets/ui/rating/medal-${n}.webp`,
    general: (f) => `${R}assets/source/generated-factions-v1/factions/${f}_general.png`,
    factionBg: (f) => `${R}assets/source/generated-factions-v1/factions/${f}_card_bg.png`,
    factionHero: (f) => `${R}assets/source/generated-factions-v1/factions/${f}_hero.png`,
    face: (f) => `${R}public/assets/generated/asterion/factions/battle-icons/${f}.webp`,
    ship: (race, k) => `${R}assets/source/faction-delivery-v1/ships/${race}_${k}_ship.png`,
    commander: (id) => `${R}assets/source/New%20assets/comander_ship/commander-ship.${id}.png`,
    starter: (n) => `${R}assets/source/starter/planets/planet_${n}.png`,
    skin: (n) => `${R}assets/source/planets/skins/${String(n).startsWith('skin-') ? n : 'planet-' + n}.png`,
    sun: (n) => `${R}public/assets/generated/sun-raid/${n}.webp`,
    heraldry: (n) => `${R}src/assets/command/orbital-heraldry/${n}`,
    battleBg: `${R}src/assets/battle-report/battle-bg-approved-candidate.png`,
    space: `${R}assets/source/battle-report-v2/battle-space-background-v1.png`,
    bigPlanet: `${R}assets/source/battle-report-v2/battle-planet-transparent-v1.png`,
  };
  const CAT_ICON = {
    growth: A.head('zone-industry'), war: A.mission('attack'), intel: A.mission('espionage'), space: A.mission('pirate-elimination'),
    ally: A.mission('aid'), sun: A.mission('sun-support'), round: A.head('rating'), chronicle: A.mission('gate'),
  };
  // Своя картинка у достижения, где в игре уже есть подходящая иконка; иначе — значок раздела.
  const act = (n) => `${R}src/assets/ui/actions/${n}.webp`;
  const ICON = {
    'first-stone': A.head('zone-resource'), builder: A.head('zone-industry'), architect: A.head('zone-industry'), 'empire-architect': A.head('planet'),
    scholar: A.head('science'), academic: A.head('science'), colonist: A.mission('colonize'), 'power-grid': A.head('energy'), trader: A.head('metal'),
    'stone-wall': A.head('zone-military'), 'fleet-lord': A.head('fleets'), armada: A.head('fleets'), 'world-breaker': act('object-attack'), 'five-ruins': act('object-attack'),
    david: A.score('battle'), bridge: A.head('command'), 'full-dozen': A.head('command'), repairman: A.head('operations'),
    eyes: A.mission('espionage'), shadow: act('probe-explore'), silent: act('pirate-scout'), 'probe-unique': act('object-card'),
    'pirate-hunter': A.mission('pirate-elimination'), 'pirate-bane': act('pirate-raid'), 'not-welcome': act('pirate-report'), scavenger: A.mission('recycle'),
    'gas-baron': A.mission('gas'), discoverer: A.mission('expedition'), 'unique-keeper': act('object-card'),
    founder: A.head('command'), shoulder: A.mission('aid'), pillar: A.mission('transport'), 'leader-30': A.head('rating'), 'full-roster': A.head('population'),
    'joint-strike': A.mission('attack'), peacemaker: A.mission('deployment'),
    'to-the-sun': A.mission('sun-support'), crystal: A.sun('crystal-1'), 'crystal-keeper': A.sun('crystal-3'), 'sun-defender': A.head('zone-military'),
    'gate-builder': A.mission('gate'), 'round-winner': A.sun('campaign-victory'), 'winner-leader': A.sun('campaign-victory'),
    'seven-worlds': A.head('universe'), 'top-ten': A.score('overall-star'), 'first-place': A.medalRank(1), 'best-fighter': A.score('battle'),
    'best-keeper': A.score('resource-crystal'), 'to-the-end': A.head('alerts'), generous: A.mission('aid'), untouchable: A.head('zone-military'),
    veteran: A.score('achievement-trophy'), 'old-timer': A.score('achievement-trophy'), 'seven-x3': A.head('universe'), 'seven-x5': A.head('universe'),
    'two-crowns': A.medalRank(2), dynasty: A.medalRank(1), 'three-in-row': A.medalRank(1), 'eternal-leader': A.head('rating'),
    untaken: A.head('planet'), 'age-breaker': act('object-attack'), comeback: A.head('reports'), 'three-races': A.score('overall-star'),
  };
  const medal = (a, size = 64, off = false) => `<div class="medal ${a.tier} ${off ? 'off' : ''}" style="--m:${size}px"><img src="${ICON[a.id] || CAT_ICON[a.cat]}"></div>`;
  const title = (a) => a ? `<span class="title ${a.tier}">${a.name}</span>` : '';
  const byId = (id) => ACH.LIST.find((a) => a.id === id);

  // Герб: поле под маской рамки, знак в безопасном круге, рамка сверху (как renderer.ts).
  const FRAMES = { orbital: [0.5, 0.4896, 0.3947], aegis: [0.5, 0.453, 0.3418], hex: [0.5, 0.492, 0.3386], pennant: [0.5096, 0.3884, 0.2641], diamond: [0.5, 0.4944, 0.2728], octagon: [0.5, 0.4952, 0.3589] };
  const crest = (c, size = 96) => {
    const [px, py, r] = FRAMES[c.frame];
    const side = r * (c.scale || 0.64) / 0.614 * size;
    const mask = `url('${A.heraldry('mask-' + c.frame + '.png')}')`;
    return `<div class="crest" style="width:${size}px;height:${size}px">
      <img class="fld" src="${A.heraldry('field-' + c.field + '.webp')}" style="-webkit-mask-image:${mask};mask-image:${mask}">
      <img class="gl" src="${A.heraldry('glyph-' + c.glyph + '-' + c.color + '.webp')}" style="width:${side}px;height:${side}px;left:${px * size - side / 2}px;top:${py * size - side / 2}px">
      <img src="${A.heraldry('frame-' + c.frame + '.webp')}"></div>`;
  };

  // Разделы «Сообщений»; «Облик» — новый раздел под профилем.
  const nav = (active) => {
    const S = [['profile', 'Профиль', A.report('profile'), 0], ['ach', 'Достижения', A.report('achievements'), 3],
      ['system', 'Система', A.report('system'), 1], ['battle', 'Бои', A.report('arena'), 7], ['flights', 'Полёты', A.report('flights'), 99]];
    const quiet = [['letters', 'Личные', A.report('alliances')], ['command', 'Командные', A.report('command-reports')], ['arena', 'Арена', A.report('arena')], ['ally', 'Союзы', A.report('alliances')]];
    return `<div class="pan secs"><h3>Сообщения</h3>${S.map(([id, n, ic, c]) => `<div class="s ${id === active ? 'on' : ''}"><img src="${ic}"><span>${n}</span>${c === 'new' ? '<em class="new">новое</em>' : c ? `<em>${c > 98 ? '99+' : c}</em>` : ''}</div>`).join('')}
      <div class="sep">ПУСТО</div>${quiet.map(([, n, ic]) => `<div class="s quiet"><img src="${ic}"><span>${n}</span></div>`).join('')}</div>`;
  };

  // Игрок и NPC: у каждого бота свой стиль по характеру (npc-identity.ts → npcNamingStyle).
  const STYLE = {
    military: { color: 'crimson', field: 'crimson', frame: 'octagon', glyph: 'blades', planet: A.starter('volcanic'), word: 'военный' },
    trade: { color: 'amber', field: 'bronze', frame: 'hex', glyph: 'anvil', planet: A.starter('desert'), word: 'торговец' },
    science: { color: 'violet', field: 'royal', frame: 'diamond', glyph: 'nexus', planet: A.skin('015'), word: 'учёный' },
    frontier: { color: 'emerald', field: 'forest', frame: 'pennant', glyph: 'compass', planet: A.starter('ice'), word: 'первопроходец' },
    mythic: { color: 'silver', field: 'navy', frame: 'orbital', glyph: 'eye', planet: A.skin('026'), word: 'мистик' },
  };
  const PLAYER = { name: 'Dendrilion', race: 'aegis', raceName: 'Астеры', tag: 'HLN', alliance: 'Содружество Гелион', points: 1235, title: 'world-breaker',
    crest: { frame: 'aegis', field: 'navy', glyph: 'phoenix', color: 'cyan' }, wins: 1 };
  const NPC = [
    { name: 'Ор Кровавый', race: 'veyra', style: 'military', tag: 'NOX', points: 2140, title: 'two-crowns', wins: 2 },
    { name: 'Лорд-протектор Орбитальных Верфей', race: 'aegis', style: 'trade', tag: 'GLD', points: 980, title: 'pillar', wins: 0 },
    { name: 'Сигма-7', race: 'synod', style: 'science', tag: '', points: 610, title: 'academic', wins: 0 },
    { name: 'Вольный Предел', race: 'aegis', style: 'frontier', tag: 'FRN', points: 455, title: 'seven-x3', wins: 0 },
    { name: 'Селеста', race: 'synod', style: 'mythic', tag: 'NOX', points: 3020, title: 'dynasty', wins: 3 },
    { name: 'Тавр', race: 'veyra', style: 'military', tag: '', points: 320, title: 'pirate-hunter', wins: 0 },
    { name: 'Кальдера', race: 'synod', style: 'trade', tag: 'GLD', points: 170, title: 'gas-baron', wins: 0 },
  ];
  const npcCrest = (n) => { const st = STYLE[n.style]; return { frame: st.frame, field: st.field, glyph: st.glyph, color: st.color }; };
  const rankOf = (p) => { const list = ACH.RANKS; let i = 0; while (i + 1 < list.length && list[i + 1].at <= p) i += 1; return { cur: list[i], next: list[i + 1] }; };

  window.UI = { R, q, fmt, A, CAT_ICON, medal, title, byId, crest, nav, STYLE, PLAYER, NPC, npcCrest, rankOf };
})();
