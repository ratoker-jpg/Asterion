// Прогресс игрока Dendrilion для макетов: что получено (в каком раунде) и сколько набрано по остальным.
(() => {
  const done = {
    'first-stone': 1, builder: 1, architect: 2, scholar: 1, colonist: 1, 'power-grid': 1, trader: 2,
    'first-blood': 1, 'stone-wall': 1, 'fleet-lord': 2, 'clean-win': 2, david: 2, 'world-breaker': 2, bridge: 2, repairman: 2,
    eyes: 1, 'probe-unique': 1, 'pirate-hunter': 1, 'not-welcome': 2, scavenger: 1, 'gas-baron': 1, discoverer: 1,
    founder: 1, shoulder: 1, 'leader-30': 2, 'joint-strike': 1, peacemaker: 2,
    'to-the-sun': 1, crystal: 2, 'gate-builder': 2, 'round-winner': 2, 'winner-leader': 2,
    'seven-worlds': 2, 'top-ten': 2, 'to-the-end': 2, untouchable: 2,
  };
  // сколько набрано по неполученным: [имеется, нужно]
  const have = {
    'empire-architect': 214, academic: 0, 'hundred-wins': 63, armada: 2400000, 'five-ruins': 1, 'full-dozen': 9,
    shadow: 318, silent: 22, 'pirate-bane': 17, 'unique-keeper': 0, pillar: 3.1e9, 'full-roster': 0,
    'crystal-keeper': 2, 'sun-defender': 0, 'first-place': 0, 'best-fighter': 0, 'best-keeper': 0, generous: 0,
    veteran: 2, 'old-timer': 2, 'seven-x3': 2, 'seven-x5': 2, 'two-crowns': 1, dynasty: 1, 'three-in-row': 1,
    'eternal-leader': 1, untaken: 1, 'age-breaker': 1, comeback: 0, 'three-races': 1,
  };
  // доля командиров (игрок + 100 NPC), у кого это есть: показывает редкость
  const rarity = { 'first-stone': 100, builder: 96, architect: 61, 'world-breaker': 9, david: 7, 'two-crowns': 3, dynasty: 1, 'three-in-row': 0, 'seven-x3': 6 };
  const points = Object.keys(done).reduce((s, id) => s + ACH.LIST.find((a) => a.id === id).points, 0);
  window.PROG = { done, have, rarity, points };
})();
