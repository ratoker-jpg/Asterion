const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed', () => {});

const ROOT = path.join(__dirname, '..');
const OUTPUT = path.join(ROOT, 'visual-qa');
const SAVE_KEY = 'asterion.vertical-slice.v1';
const VIEWPORTS = [[1920,1080],[1600,900],[1280,720],[2560,1440]];
const RESOURCE_QA_VIEWPORTS = new Set(['1920x1080','1600x900','1280x720']);
const SCREENS = [
  ['settings','Настройки','settings-view-v2'],
  ['rating','Рейтинг','rating-view-v2'],
  ['science','Наука','science-view-v2'],
];
const RESOURCE_ROLES = [
  'metal-production-1',
  'metal-production-2',
  'metal-production-3',
  'mineral-production-1',
  'mineral-production-2',
  'gas-production-1',
  'gas-production-2',
  'basic-energy',
  'advanced-energy',
  'hangar',
];
const RESOURCE_NAMES = {
  'metal-production-1': 'Металлическая шахта I',
  'metal-production-2': 'Металлическая шахта II',
  'metal-production-3': 'Металлическая шахта III',
  'mineral-production-1': 'Минеральная шахта I',
  'mineral-production-2': 'Минеральная шахта II',
  'gas-production-1': 'Газовая скважина I',
  'gas-production-2': 'Газовая скважина II',
  'basic-energy': 'Солнечная электростанция',
  'advanced-energy': 'Ядерный реактор',
  hangar: 'Ангар',
};
const INITIAL_STATUS = {
  'metal-production-1': 'available',
  'metal-production-2': 'requirements-unmet',
  'metal-production-3': 'requirements-unmet',
  'mineral-production-1': 'available',
  'mineral-production-2': 'available',
  'gas-production-1': 'available',
  'gas-production-2': 'available',
  'basic-energy': 'available',
  'advanced-energy': 'requirements-unmet',
  hangar: 'available',
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(win, expression, timeoutMs = 6000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await win.webContents.executeJavaScript(`Boolean(${expression})`)) return;
    await sleep(50);
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}

async function settle(win) {
  await win.webContents.executeJavaScript('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  await sleep(60);
}

async function reload(win) {
  const done = new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
  win.webContents.reload();
  await done;
  await waitFor(win, `document.querySelector('.utility-navigation')`);
  await win.webContents.executeJavaScript('document.fonts?.ready');
  await settle(win);
}

async function activateScreen(win, label, expectedClass) {
  const encoded = JSON.stringify(label);
  const clicked = await win.webContents.executeJavaScript(`(() => {
    const button = Array.from(document.querySelectorAll('.utility-navigation button')).find((item) => item.getAttribute('aria-label') === ${encoded});
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`Utility navigation button not found: ${label}`);
  await waitFor(win, `document.querySelector('.utility-screen-host[data-utility-screen="${label}"] .${expectedClass}')`);
  await settle(win);
}

async function activateMainScreen(win, label, expectedSelector) {
  const encoded = JSON.stringify(label);
  const clicked = await win.webContents.executeJavaScript(`(() => {
    const button = Array.from(document.querySelectorAll('.primary-navigation button')).find((item) => item.textContent?.trim() === ${encoded});
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`Primary navigation button not found: ${label}`);
  await waitFor(win, `document.querySelector(${JSON.stringify(expectedSelector)}) && !document.querySelector('.utility-screen-host')`);
  await settle(win);
}

async function activateResourceZone(win) {
  const clicked = await win.webContents.executeJavaScript(`(() => {
    const button=document.querySelector('.header-zone--resource');
    if(!button)return false;
    button.click();
    return true;
  })()`);
  if (!clicked) throw new Error('Resource zone header button not found');
  await waitFor(win, `document.querySelector('[data-qa-resource-zone]')`);
  await waitFor(win, `(() => {
    const terrain=document.querySelector('[data-qa-zone-terrain]');
    const images=Array.from(document.querySelectorAll('[data-resource-building-role] img'));
    return terrain?.complete && terrain.naturalWidth>0 && images.length===10 && images.every((image)=>image.complete && image.naturalWidth>0);
  })()`);
  await settle(win);
}

async function openResourceBuilding(win, role) {
  const encoded = JSON.stringify(role);
  const clicked = await win.webContents.executeJavaScript(`(() => {
    const button=document.querySelector('[data-resource-building-role="'+${encoded}+'"]');
    if(!button)return false;
    button.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`Resource building button not found: ${role}`);
  await waitFor(win, `document.querySelector('[data-qa-building-dialog="${role}"]')`);
  await settle(win);
}

async function closeResourceBuilding(win) {
  const clicked = await win.webContents.executeJavaScript(`(() => {
    const button=document.querySelector('.resource-building-dialog-close');
    if(!button)return false;
    button.click();
    return true;
  })()`);
  if (!clicked) throw new Error('Resource building dialog close button not found');
  await waitFor(win, `!document.querySelector('.resource-building-dialog')`);
  await settle(win);
}

async function enqueueResourceBuilding(win, role) {
  await openResourceBuilding(win, role);
  const clicked = await win.webContents.executeJavaScript(`(() => {
    const button=document.querySelector('[data-qa-build-button]');
    if(!button || button.disabled)return false;
    button.click();
    return true;
  })()`);
  if(!clicked) throw new Error(`Build button did not activate for ${role}`);
  await waitFor(win, `!document.querySelector('.resource-building-dialog')`);
  await settle(win);
}

async function metrics(win, screen) {
  return win.webContents.executeJavaScript(`(() => {
    const root=document.documentElement, body=document.body;
    const stage=document.querySelector('.stage'), workspace=document.querySelector('.workspace'), host=document.querySelector('.utility-screen-host');
    const scienceCatalog=document.querySelector('[data-qa-scroll="science-catalog"]');
    const settingsContent=document.querySelector('[data-qa-scroll="settings-content"]');
    const ratingTable=document.querySelector('.rating-table-v2');
    const ratingPinnedCurrent=document.querySelector('.rating-table-v2--players .rating-row-v2.pinned-current.current');
    const ratingSelfSeparator=document.querySelector('.rating-table-v2--players .rating-self-separator-v2');
    const rect=(element)=>element?(()=>{const r=element.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};})():null;
    return {
      screen:${JSON.stringify(screen)},
      viewport:{width:window.innerWidth,height:window.innerHeight},
      document:{scrollHeight:Math.max(root.scrollHeight,body.scrollHeight),clientHeight:window.innerHeight,verticalScroll:Math.max(root.scrollHeight,body.scrollHeight)>window.innerHeight+2,longPageClass:root.classList.contains('asterion-long-page')},
      stage:rect(stage),workspace:rect(workspace),utilityHost:rect(host),
      utilityViewClass:host?.firstElementChild?.className ?? '',
      scienceCatalog:scienceCatalog?{clientHeight:scienceCatalog.clientHeight,scrollHeight:scienceCatalog.scrollHeight,overflowY:getComputedStyle(scienceCatalog).overflowY}:null,
      settingsContent:settingsContent?{clientHeight:settingsContent.clientHeight,scrollHeight:settingsContent.scrollHeight,overflowY:getComputedStyle(settingsContent).overflowY}:null,
      ratingTable:ratingTable?{clientHeight:ratingTable.clientHeight,scrollHeight:ratingTable.scrollHeight,overflowY:getComputedStyle(ratingTable).overflowY}:null,
      ratingPinnedCurrent:Boolean(ratingPinnedCurrent),
      ratingSelfSeparator:Boolean(ratingSelfSeparator),
      typography:{hud:getComputedStyle(root).getPropertyValue('--text-scale-hud').trim(),helper:getComputedStyle(root).getPropertyValue('--text-scale-helper').trim()},
    };
  })()`);
}

async function fontSnapshot(win, selector) {
  return win.webContents.executeJavaScript(`(() => {
    const element=document.querySelector(${JSON.stringify(selector)});
    if(!element)return null;
    return {
      size:Number.parseFloat(getComputedStyle(element).fontSize),
      category:element.getAttribute('data-asterion-typography'),
      base:element.style.getPropertyValue('--asterion-base-font-size') || null,
      text:element.textContent?.trim() ?? '',
    };
  })()`);
}

async function typographyCoverage(win) {
  return win.webContents.executeJavaScript(`(() => {
    const managed=Array.from(document.querySelectorAll('[data-asterion-typography]'));
    const counts={};
    for(const element of managed){
      const key=element.getAttribute('data-asterion-typography');
      counts[key]=(counts[key]||0)+1;
    }
    return { total:managed.length, counts };
  })()`);
}

async function clickTypography(win, labelPart, count) {
  const encoded=JSON.stringify(labelPart);
  for (let index=0; index<count; index+=1) {
    const clicked=await win.webContents.executeJavaScript(`(() => {
      const button=Array.from(document.querySelectorAll('button[aria-label]')).find((item)=>item.getAttribute('aria-label')?.includes(${encoded}) && item.getAttribute('aria-label')?.startsWith('Увеличить'));
      if(!button)return false; button.click(); return true;
    })()`);
    if(!clicked) throw new Error(`Typography increment not found: ${labelPart}`);
  }
  await settle(win);
}

async function resetTypography(win, labelPart) {
  const encoded=JSON.stringify(labelPart);
  const clicked=await win.webContents.executeJavaScript(`(() => {
    const row=Array.from(document.querySelectorAll('.typography-row-v2')).find((item)=>item.textContent?.includes(${encoded}));
    const button=row?.querySelector('.typography-reset-v2');
    if(!button)return false; button.click(); return true;
  })()`);
  if(!clicked) throw new Error(`Typography reset not found: ${labelPart}`);
  await settle(win);
}

async function capture(win, directory, name) {
  const result=await win.webContents.debugger.sendCommand('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false});
  fs.writeFileSync(path.join(directory,`${name}.png`),Buffer.from(result.data,'base64'));
}

function ownsNestedVerticalScroll(item) {
  return item && (item.overflowY === 'auto' || item.overflowY === 'scroll');
}

function approximately(actual, expected, tolerance = 0.08) {
  return Number.isFinite(actual) && Math.abs(actual - expected) <= Math.max(0.5, expected * tolerance);
}

async function verifyCommon(item, label, name, width, height) {
  if(item.viewport.width!==width || item.viewport.height!==height) throw new Error(`${label}/${name}: viewport mismatch ${item.viewport.width}x${item.viewport.height}`);
  if(item.document.verticalScroll && !item.document.longPageClass) throw new Error(`${label}/${name}: document scroll is not owned by GlobalPageScrollController`);
  if(name==='science' && ownsNestedVerticalScroll(item.scienceCatalog)) throw new Error(`${label}/${name}: science still owns a nested vertical scrollbar`);
  if(name==='settings' && ownsNestedVerticalScroll(item.settingsContent)) throw new Error(`${label}/${name}: settings still owns a nested vertical scrollbar`);
  if(name==='rating' && ownsNestedVerticalScroll(item.ratingTable)) throw new Error(`${label}/${name}: rating table still owns a nested vertical scrollbar`);
  if(name==='rating' && (!item.ratingPinnedCurrent || !item.ratingSelfSeparator)) throw new Error(`${label}/${name}: current player is not pinned below the visible page like Nemexia`);
}

async function commandScrollSnapshot(win) {
  return win.webContents.executeJavaScript(`(() => {
    const root=document.documentElement;
    const workspace=document.querySelector('.workspace');
    const command=document.querySelector('.command-view');
    const rect=(element)=>element?element.getBoundingClientRect():null;
    return {
      longPage:root.classList.contains('asterion-long-page'),
      documentHeight:Math.max(root.scrollHeight,document.body.scrollHeight),
      workspaceHeight:rect(workspace)?.height ?? 0,
      commandHeight:rect(command)?.height ?? 0,
    };
  })()`);
}

async function verifyCommandScrollStability(win, directory, label) {
  await activateMainScreen(win,'Командование','.command-view');
  const before=await commandScrollSnapshot(win);
  await sleep(180);
  await settle(win);
  const after=await commandScrollSnapshot(win);
  const stable=(left,right)=>Math.abs(left-right)<=2;
  if(!stable(before.documentHeight,after.documentHeight)||!stable(before.workspaceHeight,after.workspaceHeight)||!stable(before.commandHeight,after.commandHeight)){
    throw new Error(`${label}/command: page geometry keeps growing: ${JSON.stringify({before,after})}`);
  }
  await capture(win,directory,'command');

  await activateMainScreen(win,'Планета','.planet-page-v3 .scene-title h1');
  await sleep(180);
  await settle(win);
  const reset=await commandScrollSnapshot(win);
  if(reset.longPage) throw new Error(`${label}/command: long-page state leaked after leaving Command: ${JSON.stringify(reset)}`);
}

async function verifyResourceZoneFlow(win, directory) {
  await win.webContents.executeJavaScript(`localStorage.removeItem(${JSON.stringify(SAVE_KEY)})`);
  await reload(win);

  await activateMainScreen(win,'Планета','.planet-page-v3 .scene-title h1');
  const hotspotOpened = await win.webContents.executeJavaScript(`(() => {
    const button=document.querySelector('.zone-hotspot--resource');
    if(!button)return false;
    button.click();
    return true;
  })()`);
  if(!hotspotOpened) throw new Error('Resource zone hotspot not found');
  await waitFor(win, `document.querySelector('[data-qa-resource-zone]')`);
  await settle(win);

  await activateMainScreen(win,'Планета','.planet-page-v3 .scene-title h1');
  await activateResourceZone(win);

  const terrain = await win.webContents.executeJavaScript(`(() => {
    const item=document.querySelector('[data-qa-zone-terrain]');
    return item ? {
      zone:item.getAttribute('data-zone'),
      source:item.getAttribute('data-terrain-source'),
      src:item.currentSrc||item.src||'',
      naturalWidth:item.naturalWidth,
      naturalHeight:item.naturalHeight,
      hasGrid:Boolean(document.querySelector('.resource-zone-grid-lines')),
      hasHorizon:Boolean(document.querySelector('.resource-zone-horizon')),
    } : null;
  })()`);
  if(!terrain || terrain.zone!=='resource' || terrain.source!=='resource-terrain.png' || !terrain.src.includes('resource-terrain') || terrain.naturalWidth<=0 || terrain.naturalHeight<=0 || terrain.hasGrid || terrain.hasHorizon){
    throw new Error(`Resource terrain contract failed: ${JSON.stringify(terrain)}`);
  }

  const sceneLayout = await win.webContents.executeJavaScript(`(() => {
    const scene=document.querySelector('.resource-zone-scene');
    const title=document.querySelector('.resource-zone-scene-copy');
    const nodes=Array.from(document.querySelectorAll('[data-resource-building-role]'));
    const shadows=Array.from(document.querySelectorAll('.resource-building-ground-shadow'));
    if(!scene||!title)return null;
    const sr=scene.getBoundingClientRect(), tr=title.getBoundingClientRect();
    const rect=(el)=>{const r=el.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
    const entries=nodes.map((node)=>({role:node.getAttribute('data-resource-building-role'),node:rect(node),caption:rect(node.querySelector('.resource-building-caption'))}));
    const inside=entries.every(({node})=>node.x>=sr.x-2&&node.right<=sr.right+2&&node.y>=sr.y-2&&node.bottom<=sr.bottom+2);
    const titleClear=entries.every(({node})=>node.bottom<=tr.y||node.y>=tr.bottom||node.right<=tr.x||node.x>=tr.right);
    const shadowSizes=shadows.map((shadow)=>rect(shadow));
    return {inside,titleClear,shadowCount:shadows.length,shadowSizes,scene:rect(scene),title:rect(title),entries};
  })()`);
  if(!sceneLayout || !sceneLayout.inside || !sceneLayout.titleClear || sceneLayout.shadowCount!==10 || sceneLayout.shadowSizes.some((item)=>item.width<20||item.height<5)){
    throw new Error(`Resource scene layout contract failed: ${JSON.stringify(sceneLayout)}`);
  }

  const visibleRoles = await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[data-resource-building-role]')).map((item)=>item.getAttribute('data-resource-building-role'))`);
  if(JSON.stringify(visibleRoles)!==JSON.stringify(RESOURCE_ROLES)) throw new Error(`Resource role set mismatch: ${JSON.stringify(visibleRoles)}`);
  const selector = await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[data-resource-selector-role]')).map((item)=>({role:item.getAttribute('data-resource-selector-role'),name:item.querySelector('strong')?.textContent?.trim()??'',aria:item.getAttribute('aria-label')??''}))`);
  if(JSON.stringify(selector.map((item)=>item.role))!==JSON.stringify(RESOURCE_ROLES)) throw new Error(`Resource selector role set mismatch: ${JSON.stringify(selector)}`);
  for(const item of selector){
    if(item.name!==RESOURCE_NAMES[item.role] || !item.aria.includes(RESOURCE_NAMES[item.role])) throw new Error(`Canonical selector name mismatch: ${JSON.stringify(item)}`);
  }

  await capture(win,directory,'resource-zone');

  const dialogSnapshots=[];
  for(const role of RESOURCE_ROLES){
    await openResourceBuilding(win,role);
    const snapshot=await win.webContents.executeJavaScript(`(() => {
      const dialog=document.querySelector('.resource-building-dialog');
      const button=dialog?.querySelector('[data-qa-build-button]');
      const requirements=dialog?.querySelector('[data-qa-requirements]')?.textContent?.replace(/\s+/g,' ').trim()??'';
      return {title:dialog?.querySelector('h2')?.textContent?.trim()??'',status:dialog?.querySelector('[data-qa-build-status]')?.getAttribute('data-qa-build-status')??'',disabled:Boolean(button?.disabled),requirements};
    })()`);
    if(snapshot.title!==RESOURCE_NAMES[role] || snapshot.status!==INITIAL_STATUS[role]) throw new Error(`Unexpected initial dialog state for ${role}: ${JSON.stringify(snapshot)}`);
    if((snapshot.status==='available' && snapshot.disabled)||(snapshot.status!=='available' && !snapshot.disabled)) throw new Error(`Unexpected build button state for ${role}: ${JSON.stringify(snapshot)}`);
    dialogSnapshots.push({role,...snapshot});
    if(role==='metal-production-1') await capture(win,directory,'resource-zone-selected');
    if(role==='metal-production-2'){
      // The canonical starting fixture includes Metal Mine I at level 1;
      // Metal Mine II requires level 10, so the dialog must report current 1.
      if(!snapshot.requirements.includes('Металлическая шахта I') || !snapshot.requirements.includes('сейчас 1')) throw new Error(`Metal II requirements missing: ${JSON.stringify(snapshot)}`);
      await capture(win,directory,'resource-zone-requirements');
    }
    await closeResourceBuilding(win);
  }

  await win.webContents.executeJavaScript(`(() => {
    const save=JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)})||'{}');
    save.metal=0;
    localStorage.setItem(${JSON.stringify(SAVE_KEY)},JSON.stringify(save));
  })()`);
  await reload(win);
  await activateResourceZone(win);
  await openResourceBuilding(win,'metal-production-1');
  await waitFor(win, `document.querySelector('[data-qa-build-status="insufficient-resource"]')`);
  const insufficient=await win.webContents.executeJavaScript(`(() => {
    const status=document.querySelector('[data-qa-build-status]');
    const button=document.querySelector('[data-qa-build-button]');
    return {status:status?.getAttribute('data-qa-build-status')??'',disabled:Boolean(button?.disabled),text:status?.textContent?.trim()??''};
  })()`);
  if(insufficient.status!=='insufficient-resource' || !insufficient.disabled) throw new Error(`Insufficient-resource dialog failed: ${JSON.stringify(insufficient)}`);
  await capture(win,directory,'resource-zone-insufficient');

  await win.webContents.executeJavaScript(`localStorage.removeItem(${JSON.stringify(SAVE_KEY)})`);
  await reload(win);
  await activateResourceZone(win);

  for(const role of ['basic-energy','gas-production-1','hangar']) await enqueueResourceBuilding(win,role);
  await waitFor(win, `(() => { try { const q=JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)})||'{}').queues?.['helion-01']; return Array.isArray(q)&&q.length===3; } catch { return false; } })()`);
  await waitFor(win, `document.querySelectorAll('[data-qa-queue-role]').length===3 && document.querySelector('[data-qa-queue-full]')`);
  await settle(win);

  const queued=await win.webContents.executeJavaScript(`(() => {
    const save=JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)})||'{}');
    const q=save.queues?.['helion-01'];
    return {
      roles:Array.isArray(q)?q.map((item)=>item.assetRole):null,
      metal:save.metal,
      energy:save.planets?.['helion-01']?.energy??null,
      slots:Array.from(document.querySelectorAll('[data-qa-queue-role]')).map((item)=>({role:item.getAttribute('data-qa-queue-role'),text:item.textContent?.replace(/\s+/g,' ').trim()??''})),
      full:Boolean(document.querySelector('[data-qa-queue-full]')),
    };
  })()`);
  if(JSON.stringify(queued.roles)!==JSON.stringify(['basic-energy','gas-production-1','hangar']) || queued.metal!==12280 || queued.energy!==140 || !queued.full || !queued.slots[0]?.text.includes('Осталось')) throw new Error(`Three-slot queue state failed: ${JSON.stringify(queued)}`);
  await capture(win,directory,'resource-zone-queue-3');

  await openResourceBuilding(win,'gas-production-2');
  const fullDialog=await win.webContents.executeJavaScript(`(() => ({status:document.querySelector('[data-qa-build-status]')?.getAttribute('data-qa-build-status')??'',disabled:Boolean(document.querySelector('[data-qa-build-button]')?.disabled),text:document.querySelector('[data-qa-build-status]')?.textContent?.replace(/\s+/g,' ').trim()??''}))()`);
  if(fullDialog.status!=='queue-full' || !fullDialog.disabled || !fullDialog.text.includes('Очередь заполнена')) throw new Error(`Queue-full dialog failed: ${JSON.stringify(fullDialog)}`);
  await closeResourceBuilding(win);

  await win.webContents.executeJavaScript(`(() => {
    const save=JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)})||'{}');
    const q=save.queues['helion-01'];
    const now=Date.now();
    q[0].startedAt=now-50000;
    q[0].finishAt=now-10;
    q[1].startedAt=q[0].finishAt;
    q[1].finishAt=q[1].startedAt+45000;
    q[2].startedAt=q[1].finishAt;
    q[2].finishAt=q[2].startedAt+45000;
    localStorage.setItem(${JSON.stringify(SAVE_KEY)},JSON.stringify(save));
  })()`);
  await reload(win);
  await waitFor(win, `(() => { try { const save=JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)})||'{}'); const q=save.queues?.['helion-01']; return Array.isArray(q)&&q.length===2&&q[0]?.assetRole==='gas-production-1'&&save.planets?.['helion-01']?.buildings?.['basic-energy']===1&&save.planets?.['helion-01']?.energy===165; } catch { return false; } })()`,8000);
  await activateResourceZone(win);
  await waitFor(win, `document.querySelector('[data-qa-queue-slot="1"]')?.getAttribute('data-qa-queue-role')==='gas-production-1'`);
  const fifo=await win.webContents.executeJavaScript(`(() => {
    const save=JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)})||'{}');
    const first=document.querySelector('[data-qa-queue-slot="1"]');
    return {queue:save.queues?.['helion-01']?.map((item)=>item.assetRole)??null,level:save.planets?.['helion-01']?.buildings?.['basic-energy']??null,energy:save.planets?.['helion-01']?.energy??null,activeRole:first?.getAttribute('data-qa-queue-role')??null,activeText:first?.textContent?.replace(/\s+/g,' ').trim()??''};
  })()`);
  if(JSON.stringify(fifo.queue)!==JSON.stringify(['gas-production-1','hangar']) || fifo.activeRole!=='gas-production-1' || fifo.level!==1 || fifo.energy!==165 || !fifo.activeText.includes('Осталось')) throw new Error(`FIFO transition failed: ${JSON.stringify(fifo)}`);
  await capture(win,directory,'resource-zone-fifo-next');

  await reload(win);
  await activateResourceZone(win);
  const persisted=await win.webContents.executeJavaScript(`(() => {
    const save=JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)})||'{}');
    const q=save.queues?.['helion-01'];
    return {queue:Array.isArray(q)?q.map((item)=>item.assetRole):null,level:save.planets?.['helion-01']?.buildings?.['basic-energy']??null,energy:save.planets?.['helion-01']?.energy??null};
  })()`);
  if(JSON.stringify(persisted.queue)!==JSON.stringify(['gas-production-1','hangar']) || persisted.level!==1 || persisted.energy!==165) throw new Error(`Reload persistence failed: ${JSON.stringify(persisted)}`);

  const result={
    screen:'resource-zone-flow',
    openings:{hotspot:true,header:true},
    terrain,
    sceneLayout,
    roles:visibleRoles,
    selector,
    dialogs:dialogSnapshots,
    insufficient,
    queued,
    fifo,
    persisted,
  };
  console.log(`Resource zone QA passed: terrain, canonical names, requirements, three-slot FIFO queue, completion transition and reload persistence.`);

  await win.webContents.executeJavaScript(`localStorage.removeItem(${JSON.stringify(SAVE_KEY)})`);
  await reload(win);
  return result;
}

app.whenReady().then(async()=>{
  let win;
  try {
    fs.rmSync(OUTPUT,{recursive:true,force:true}); fs.mkdirSync(OUTPUT,{recursive:true});
    win=new BrowserWindow({width:1000,height:700,show:false,backgroundColor:'#02050a',webPreferences:{offscreen:true,contextIsolation:true,nodeIntegration:false,sandbox:true,partition:'qa-utility'}});
    await win.loadFile(path.join(ROOT,'dist','index.html'));
    win.webContents.debugger.attach('1.3');

    for(const [width,height] of VIEWPORTS){
      const label=`${width}x${height}`, directory=path.join(OUTPUT,label); fs.mkdirSync(directory,{recursive:true});
      await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false,screenWidth:width,screenHeight:height});
      await win.webContents.executeJavaScript("localStorage.removeItem('asterion.preferences.v2')");
      await reload(win);
      const results=[];
      for(const [name,screenLabel,expectedClass] of SCREENS){
        await activateScreen(win,screenLabel,expectedClass);
        const item=await metrics(win,name); await verifyCommon(item,label,name,width,height); results.push(item); await capture(win,directory,name);
        if(name==='rating'){
          await win.webContents.executeJavaScript('window.scrollTo(0, document.documentElement.scrollHeight)');
          await settle(win);
          await capture(win,directory,'rating-bottom');
          await win.webContents.executeJavaScript('window.scrollTo(0, 0)');
          await settle(win);
        }
      }
      await verifyCommandScrollStability(win,directory,label);
      if(width===1920 && height===1080){
        await activateScreen(win,'Настройки','settings-view-v2');
        await clickTypography(win,'Подсказки и пояснения',16);
        const helper180=await metrics(win,'settings-helper-180');
        if(helper180.typography.helper!=='1.8'||helper180.typography.hud!=='1') throw new Error(`Typography isolation failed: ${JSON.stringify(helper180.typography)}`);
        await verifyCommon(helper180,label,'settings-helper-180',width,height); results.push(helper180); await capture(win,directory,'settings-helper-180');
        await resetTypography(win,'Подсказки и пояснения');

        const hudBefore=await fontSnapshot(win,'.asterion-header .resource-chip strong');
        await clickTypography(win,'HUD / верхняя панель',6);
        const hudAfter=await fontSnapshot(win,'.asterion-header .resource-chip strong');
        const hud130=await metrics(win,'settings-hud-130');
        if(hud130.typography.hud!=='1.3'||hud130.typography.helper!=='1') throw new Error(`Typography isolation failed: ${JSON.stringify(hud130.typography)}`);
        if(!hudBefore||!hudAfter||!approximately(hudAfter.size,hudBefore.size*1.3)) throw new Error(`HUD typography did not reach the global header: ${JSON.stringify({hudBefore,hudAfter})}`);
        await verifyCommon(hud130,label,'settings-hud-130',width,height); results.push({...hud130,hudFont:{before:hudBefore,after:hudAfter}}); await capture(win,directory,'settings-hud-130');
        await resetTypography(win,'HUD / верхняя панель');

        await activateMainScreen(win,'Планета','.planet-page-v3 .scene-title h1');
        const legacyTitleBefore=await fontSnapshot(win,'.planet-page-v3 .scene-title h1');
        const coverageBefore=await typographyCoverage(win);
        if(!legacyTitleBefore||legacyTitleBefore.category!=='pageTitle'||coverageBefore.total<12) throw new Error(`Legacy typography controller did not classify the game screen: ${JSON.stringify({legacyTitleBefore,coverageBefore})}`);

        await activateScreen(win,'Настройки','settings-view-v2');
        await clickTypography(win,'Заголовки экранов',6);
        await activateMainScreen(win,'Планета','.planet-page-v3 .scene-title h1');
        const legacyTitleAfter=await fontSnapshot(win,'.planet-page-v3 .scene-title h1');
        if(!legacyTitleAfter||legacyTitleAfter.category!=='pageTitle'||!approximately(legacyTitleAfter.size,legacyTitleBefore.size*1.3)) throw new Error(`Page-title typography did not reach the existing game screen: ${JSON.stringify({legacyTitleBefore,legacyTitleAfter})}`);
        results.push({screen:'legacy-typography-global',coverage:coverageBefore,pageTitle:{before:legacyTitleBefore,after:legacyTitleAfter}});
        await capture(win,directory,'planet-page-title-130');
      }
      if(RESOURCE_QA_VIEWPORTS.has(label)){
        results.push(await verifyResourceZoneFlow(win,directory));
      }
      fs.writeFileSync(path.join(directory,'metrics.json'),JSON.stringify(results,null,2));
    }
    win.webContents.debugger.detach(); win.destroy(); app.exit(0);
  } catch(error){
    console.error(error);
    try{if(win?.webContents.debugger.isAttached())win.webContents.debugger.detach();}catch{}
    win?.destroy(); app.exit(1);
  }
});
