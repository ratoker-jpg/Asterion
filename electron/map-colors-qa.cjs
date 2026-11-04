// The colour language of the system map («Вселенная»): every relation in one
// system, a system full of own planets, an empty system, long names, debris and
// marker overlays. Worlds are seeded into the test save with exact points, so
// the attack rule decides each planet's look. Screenshots go to
// visual-qa/map-colors/<viewport>/<stage> (ASTERION_QA_OUTPUT overrides;
// ASTERION_SKIP_SCREENSHOTS=1 keeps the checks only).
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const { editSaveIdle } = require('./qa-save-edit.cjs');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed', () => {});

const ROOT = path.join(__dirname, '..');
const OUTPUT = process.env.ASTERION_QA_OUTPUT || path.join(ROOT, 'visual-qa', 'map-colors');
const STAGE = process.env.ASTERION_QA_STAGE || 'after';
const SAVE_KEY = 'asterion.vertical-slice.test.v1';
const VIEWPORTS = [[1920, 1080], [1280, 720]];
const skipScreenshots = process.env.ASTERION_SKIP_SCREENSHOTS === '1';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const js = (win, source) => win.webContents.executeJavaScript(source);

async function waitFor(win, expression, timeoutMs = 10_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await js(win, `Boolean(${expression})`)) return;
    await sleep(60);
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}

async function capture(win, directory, name) {
  if (skipScreenshots) return;
  await sleep(420);
  const { data } = await win.webContents.debugger.sendCommand('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const file = path.join(directory, STAGE, `${name}.png`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(data, 'base64'));
}

async function openUniverse(win) {
  await js(win, `document.querySelector('[data-qa-route="universe"]')?.click()`);
  await waitFor(win, `document.querySelector('[data-qa-universe]')`);
  await sleep(1_400); // the scene's entrance animation
}

async function selectSystem(win, system) {
  await js(win, `(() => {
    const element = document.querySelector('.universe-jump select');
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    setter.call(element, ${JSON.stringify(String(system))});
    element.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await waitFor(win, `document.querySelector('[data-qa-universe]')?.getAttribute('data-qa-universe-system') === ${JSON.stringify(String(system))}`);
  await sleep(150);
}

async function hover(win, selector) {
  const point = await js(win, `(() => {
    const element = document.querySelector(${JSON.stringify(selector)} + ' img');
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
  })()`);
  if (!point) throw new Error(`Map object not found: ${selector}`);
  await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y });
  await sleep(260);
}

async function clearHover(win) {
  await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 4, y: 4 });
  await sleep(120);
}

/** What each system holds: chooses the worlds from the map itself, whatever the seed placed. */
async function scanSystems(win) {
  const systems = [];
  const total = await js(win, `document.querySelectorAll('.universe-jump select option').length`);
  for (let system = 1; system <= total; system += 1) {
    await selectSystem(win, system);
    systems.push({
      system,
      objects: await js(win, `[...document.querySelectorAll('.system-scene [data-qa-universe-kind]')]
        .filter((node) => node.getAttribute('data-qa-universe-kind') !== 'asteroid')
        .map((node) => ({ kind: node.getAttribute('data-qa-universe-kind'), position: Number((node.getAttribute('aria-label') || '').split(':').pop().match(/\\d+/)?.[0] ?? 0) }))`),
    });
  }
  return systems;
}

const specials = (entry) => new Set(entry.objects.map((object) => object.kind).filter((kind) => ['unique', 'anomaly', 'pirate'].includes(kind))).size;
const empties = (entry) => entry.objects.filter((object) => object.kind === 'empty').map((object) => object.position).filter((position) => position > 0);
const inhabited = (entry) => entry.objects.filter((object) => ['player', 'npc', 'unique', 'anomaly', 'pirate'].includes(object.kind)).length;

function planWorlds(systems) {
  const home = systems.find((entry) => entry.objects.some((object) => object.kind === 'player')) ?? systems[0];
  const free = systems.filter((entry) => entry !== home);
  const relations = [...free].sort((a, b) => specials(b) - specials(a) || empties(b).length - empties(a).length).find((entry) => empties(entry).length >= 9);
  const rest = free.filter((entry) => entry !== relations);
  const crowded = [...rest].sort((a, b) => empties(b).length - empties(a).length)[0];
  const empty = rest.filter((entry) => entry !== crowded).sort((a, b) => inhabited(a) - inhabited(b))[0];
  return { home, relations, crowded, empty };
}

const LONG = 'Звездоплаватель-Командор';
/** The cast of the map: exact points through the cost ledger put each owner on a known side of the rule. */
const RELATION_CAST = [
  { id: 'ally', name: 'Союзник Рэй', alliance: 'mine', points: 60_000 },
  { id: 'ally-long', name: `${LONG}-С`, alliance: 'mine', points: 900_000 },
  { id: 'enemy', name: 'Враг Ксенон', alliance: 'war', points: 60_000, debris: 240_000 },
  { id: 'enemy-truce', name: 'Перемирие Икс', alliance: 'truce', points: 60_000 },
  { id: 'enemy-far', name: 'Враг Титан', alliance: 'war', points: 1_000_000 },
  { id: 'range', name: 'Сосед Орин', points: 60_000 },
  { id: 'range-long', name: LONG, points: 70_000, debris: 12_000 },
  { id: 'far', name: 'Гигант Кронос', points: 1_000_000 },
  { id: 'weak', name: 'Малыш Пип', points: 4_000, bare: true },
  { id: 'newbie', name: 'Новичок', bare: true },
];

async function seed(win, worlds) {
  const crowdedCast = empties(worlds.crowded).slice(0, 20).map((position, index) => {
    const base = RELATION_CAST[index % RELATION_CAST.length];
    return { ...base, id: `crowd-${index}`, name: LONG.slice(0, 18 + (index % 7)), debris: index % 2 ? 90_000 + index : 0, position, system: worlds.crowded.system };
  });
  const relationPositions = empties(worlds.relations);
  const relationCast = RELATION_CAST.map((entry, index) => ({ ...entry, position: relationPositions[index], system: worlds.relations.system }));
  const cast = [...relationCast, ...crowdedCast].filter((entry) => entry.position !== undefined);
  const colonies = empties(worlds.home).slice(0, 6);
  const ownOnRelations = relationPositions[RELATION_CAST.length] ?? null;
  return editSaveIdle(win, `(() => {
    const cast = ${JSON.stringify(cast)};
    const colonies = ${JSON.stringify(colonies)};
    const save = JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || '{}');
    const playerId = save.profile.playerId;
    const home = save.planets['helion-01'] ?? Object.values(save.planets)[0];
    colonies.forEach((position, index) => {
      save.planets['qa-own-' + index] = { ...JSON.parse(JSON.stringify(home)), name: index === 2 ? 'Новая Александрия Прима' : 'Колония ' + (index + 1), universeGalaxy: 1, universeSystem: ${worlds.home.system}, universePosition: position };
    });
    const ownOnRelations = ${JSON.stringify(ownOnRelations)};
    // One own planet among the others, as on the owner's own map.
    if (ownOnRelations !== null) save.planets['qa-own-relations'] = { ...JSON.parse(JSON.stringify(home)), name: 'Тверь', universeGalaxy: 1, universeSystem: ${worlds.relations.system}, universePosition: ownOnRelations };

    // Alliances: the player's, one at war, one at war with a truce offer on the table.
    const member = (ownerId, displayName) => ({ ownerId, displayName, joinedAt: 1, lastActiveAt: 1, deliveredUnits: 0, jointOperationCount: 0, tieBreaker: 0.5 });
    const alliance = (id, name, tag, members) => ({ id, name, tag, motto: '', description: '', emblem: { glyph: 'blades', accent: 'crimson', shape: 'hex', field: 'rays', fieldColor: 'crimson' }, createdAt: 1, leaderOwnerId: members[0].ownerId, deputyOwnerId: null, leaderSince: 1, members });
    const ownerOf = (entry) => 'qa-owner-' + entry.id;
    const memberIn = (key) => cast.filter((entry) => entry.alliance === key).map((entry) => member(ownerOf(entry), entry.name));
    const command = save.command;
    command.alliances = command.alliances.filter((item) => !item.members.some((candidate) => candidate.ownerId === playerId));
    command.alliances.push(
      alliance('qa-all-mine', 'Звёздный дом', 'МОИ', [member(playerId, save.profile.displayName), ...memberIn('mine')]),
      alliance('qa-all-war', 'Орда Ксенона', 'ВРАГ', memberIn('war')),
      alliance('qa-all-truce', 'Лига Икс', 'МИР', memberIn('truce')),
    );
    const war = (ownerAllianceId, id, tag, name, extra = {}) => ({ id, allianceName: name, tag, status: 'war', ownerAllianceId, since: 1, declaredByAllianceId: 'qa-all-mine', truce: null, truceRejectedAt: null, ...extra });
    const truce = { truce: { byAllianceId: 'qa-all-mine', at: 2 } };
    command.diplomacy = [
      war('qa-all-mine', 'qa-all-war', 'ВРАГ', 'Орда Ксенона'), war('qa-all-war', 'qa-all-mine', 'МОИ', 'Звёздный дом'),
      war('qa-all-mine', 'qa-all-truce', 'МИР', 'Лига Икс', truce), war('qa-all-truce', 'qa-all-mine', 'МОИ', 'Звёздный дом', truce),
    ];

    // Planets of the cast, cloned from a real target, and exact points.
    const targets = save.espionage.targets ?? save.espionage.bot01Planets;
    const template = Object.values(targets)[0];
    const zeroed = (value) => (typeof value === 'number' ? 0 : Array.isArray(value) ? value.map(zeroed) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, zeroed(item)])) : value);
    save.rating.unrecoveredCostsByOwnerId = save.rating.unrecoveredCostsByOwnerId ?? {};
    save.rating.unrecoveredCostsByOwnerId[playerId] = { metal: 100000000, minerals: 0, gas: 0 };
    for (const entry of cast) {
      const clone = JSON.parse(JSON.stringify(template));
      delete clone.ownerProfile; delete clone.fleetProduction; delete clone.repair;
      const id = 'qa-target-' + entry.id;
      targets[id] = {
        ...clone, id, name: entry.name, kind: 'npc', ownerId: ownerOf(entry), ownerName: entry.name, alliance: null,
        coordinate: { galaxy: 1, system: entry.system, position: entry.position },
        // A bare owner has only the points given below: the cloned bot's own would lift it into range.
        buildings: entry.bare ? {} : clone.buildings,
        fleet: entry.bare ? zeroed(clone.fleet) : clone.fleet,
        defense: entry.bare ? zeroed(clone.defense) : clone.defense,
        commanders: entry.bare ? {} : clone.commanders,
        resources: { ...clone.resources, debris: entry.debris ?? 0 },
      };
      if (entry.points) save.rating.unrecoveredCostsByOwnerId[ownerOf(entry)] = { metal: entry.points * 1000, minerals: 0, gas: 0 };
    }
    localStorage.setItem(${JSON.stringify(SAVE_KEY)}, JSON.stringify(save));
    return cast.length;
  })()`, {
    label: 'map colours world',
    held: `(() => { const save = JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || '{}'); return Boolean((save.espionage?.targets ?? save.espionage?.bot01Planets ?? {})['qa-target-range']) && save.command?.alliances?.some((item) => item.id === 'qa-all-war'); })()`,
  });
}

/** Each planet's look on the map, what its hover says, and what the attack rule was seeded to answer. */
const EXPECTED = {
  'qa-target-ally': ['ally', null],
  'qa-target-ally-long': ['ally', null],
  'qa-target-enemy': ['enemy', 'true'],
  'qa-target-enemy-truce': ['enemy', 'true'],
  'qa-target-enemy-far': ['enemy', 'false'],
  'qa-target-range': ['range', 'true'],
  'qa-target-range-long': ['range', 'true'],
  'qa-target-far': ['neutral', 'false'],
  'qa-target-weak': ['neutral', 'false'],
  'qa-target-newbie': ['neutral', 'false'],
  'qa-own-relations': ['self', null],
};

async function checkRelations(win, label) {
  const seen = await js(win, `Object.fromEntries([...document.querySelectorAll('.system-planet[data-qa-universe-object]')].map((node) => [node.getAttribute('data-qa-universe-object'), [node.getAttribute('data-qa-map-tone'), node.getAttribute('data-qa-map-attackable')]]))`);
  for (const [id, expected] of Object.entries(EXPECTED)) {
    if (JSON.stringify(seen[id]) !== JSON.stringify(expected)) throw new Error(`${label}: ${id} reads ${JSON.stringify(seen[id])}, expected ${JSON.stringify(expected)}`);
  }
  const tones = new Set(Object.values(seen).map((entry) => entry[0]));
  if (tones.has(null)) throw new Error(`${label}: a planet without a tone ${JSON.stringify(seen)}`);
  // Nothing on the map falls back to the white system tooltip.
  const titled = await js(win, `document.querySelectorAll('.system-planet[title]').length`);
  if (titled) throw new Error(`${label}: ${titled} planets still use a system tooltip`);
  // The filter dock holds every chip inside the window.
  const dock = await js(win, `(() => { const box = document.querySelector('.universe-radar__dock').getBoundingClientRect(); const chips = [...document.querySelectorAll('.universe-radar__dock button')].map((node) => node.getBoundingClientRect()); return { left: box.left, right: box.right, inner: innerWidth, clipped: chips.filter((chip) => chip.right > box.right + 1 || chip.left < box.left - 1).length, labels: [...document.querySelectorAll('.universe-map-legend span:not(.map-mark)')].map((node) => node.textContent) }; })()`);
  if (dock.left < 0 || dock.right > dock.inner || dock.clipped) throw new Error(`${label}: filter dock overflows ${JSON.stringify(dock)}`);
  if (!dock.labels.includes('В диапазоне атаки')) throw new Error(`${label}: no range filter ${JSON.stringify(dock.labels)}`);
}

/** The reason a hover shows must be readable: fully inside the scene, not clipped by it. */
async function checkTip(win, label, selector, expectedTitle) {
  const tip = await js(win, `(() => {
    const node = document.querySelector(${JSON.stringify(selector)} + ' [data-qa-map-status-tip]');
    const style = getComputedStyle(node);
    const box = node.getBoundingClientRect();
    const scene = document.querySelector('[data-qa-universe-scene]').getBoundingClientRect();
    return { text: node.textContent, visible: style.visibility === 'visible' && Number(style.opacity) > 0.9, inside: box.top >= scene.top && box.left >= scene.left && box.right <= scene.right && box.bottom <= scene.bottom };
  })()`);
  if (!tip.visible || !tip.inside || !tip.text.includes(expectedTitle)) throw new Error(`${label}: hover reason ${JSON.stringify(tip)}, expected «${expectedTitle}»`);
}

/** Rendering pace on a crowded system: printed for the PR, CI renders on the CPU. */
async function framePace(win) {
  return js(win, `new Promise((resolve) => { let frames = 0; const start = performance.now(); const step = () => { frames += 1; if (performance.now() - start < 2000) requestAnimationFrame(step); else resolve(Math.round(frames / ((performance.now() - start) / 1000))); }; requestAnimationFrame(step); })`);
}

async function runViewport(width, height) {
  const label = `${width}x${height}`;
  const directory = path.join(OUTPUT, label);
  const win = new BrowserWindow({
    width, height, useContentSize: true, show: false, backgroundColor: '#02050a',
    webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false, sandbox: true, partition: `qa-map-colors-${label}` },
  });
  try {
    await win.loadURL('about:blank');
    win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Page.enable');
    await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false, screenWidth: width, screenHeight: height });
    await win.loadFile(path.join(ROOT, 'dist', 'index.html'), { search: '?mode=test' });
    await waitFor(win, `document.querySelector('[data-qa-navigation="utility"]')`, 60_000);
    await waitFor(win, `localStorage.getItem(${JSON.stringify(SAVE_KEY)})`, 30_000);
    await openUniverse(win);
    const worlds = planWorlds(await scanSystems(win));
    console.log(`${label}: home ${worlds.home.system}, relations ${worlds.relations.system}, crowded ${worlds.crowded.system}, empty ${worlds.empty.system}`);
    await seed(win, worlds);
    await openUniverse(win);

    await selectSystem(win, worlds.relations.system);
    await capture(win, directory, 'all-relations');
    await checkRelations(win, label);
    await hover(win, '[data-qa-universe-object="qa-target-range"]');
    await checkTip(win, label, '[data-qa-universe-object="qa-target-range"]', 'В диапазоне атаки');
    await capture(win, directory, 'hover-in-range');
    await hover(win, '[data-qa-universe-object="qa-target-enemy-far"]');
    await checkTip(win, label, '[data-qa-universe-object="qa-target-enemy-far"]', 'Враг · вне диапазона атаки');
    await capture(win, directory, 'hover-enemy-out-of-range');
    await hover(win, '[data-qa-universe-object="qa-target-newbie"]');
    await checkTip(win, label, '[data-qa-universe-object="qa-target-newbie"]', 'Защита новичка');
    await capture(win, directory, 'hover-newbie');
    await clearHover(win);
    // The filter hides exactly the soft red planets.
    await js(win, `document.querySelector('.universe-map-legend .legend-range').click()`);
    await waitFor(win, `document.querySelector('[data-qa-universe-object="qa-target-range"]').classList.contains('is-filtered') && !document.querySelector('[data-qa-universe-object="qa-target-enemy"]').classList.contains('is-filtered')`);
    await capture(win, directory, 'filter-range-hidden');
    await js(win, `document.querySelector('.universe-map-legend .legend-range').click()`);
    await js(win, `document.querySelector('[data-qa-universe-object="qa-target-far"]').click()`);
    await waitFor(win, `document.querySelector('[data-qa-universe-inspector]')`);
    // The card agrees with the map: the reason is there and the attack button is off.
    const card = await js(win, `(() => ({ tone: document.querySelector('[data-qa-universe-map-status]')?.getAttribute('data-qa-universe-map-status'), why: document.querySelector('.uw-foot-why')?.textContent || '', attackOff: Boolean(document.querySelector('[data-qa-universe-inspector] [data-qa-universe-action="attack"]')?.disabled) }))()`);
    if (card.tone !== 'neutral' || !card.why.includes('вне диапазона') || !card.attackOff) throw new Error(`${label}: out-of-range card ${JSON.stringify(card)}`);
    await capture(win, directory, 'card-out-of-range');
    await js(win, `document.querySelector('[data-qa-universe-inspector] [data-asterion-close]').click()`);
    await waitFor(win, `!document.querySelector('[data-qa-universe-inspector]')`);

    await selectSystem(win, worlds.home.system);
    const own = await js(win, `document.querySelectorAll('.system-planet[data-qa-map-tone="self"]').length`);
    if (own < 7) throw new Error(`${label}: expected all 7 own planets in the system, got ${own}`);
    await capture(win, directory, 'all-own');
    await selectSystem(win, worlds.empty.system);
    await capture(win, directory, 'empty-system');
    await selectSystem(win, worlds.crowded.system);
    await capture(win, directory, 'crowded-long-names-debris');
    console.log(`${label}: frames per second on the crowded system: ${await framePace(win)}`);
  } finally {
    win.destroy();
  }
}

(async () => {
  await app.whenReady();
  for (const [width, height] of VIEWPORTS) await runViewport(width, height);
  console.log('Map colours QA passed.');
  app.exit(0);
})().catch((error) => {
  console.error(error);
  app.exit(1);
});
