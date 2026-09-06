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

  const visibleRoles = await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[data-resource-building-role]')).map((item)=>item.getAttribute('data-resource-building-role'))`);
  if(JSON.stringify(visibleRoles)!==JSON.stringify(RESOURCE_ROLES)) throw new Error(`Resource role set mismatch: ${JSON.stringify(visibleRoles)}`);
  const selectorRoles = await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[data-resource-selector-role]')).map((item)=>item.getAttribute('data-resource-selector-role'))`);
  if(JSON.stringify(selectorRoles)!==JSON.stringify(RESOURCE_ROLES)) throw new Error(`Resource selector role set mismatch: ${JSON.stringify(selectorRoles)}`);

  await capture(win,directory,'resource-zone');

  const dialogSnapshots=[];
  for(const role of RESOURCE_ROLES){
    await openResourceBuilding(win,role);
    const snapshot=await win.webContents.executeJavaScript(`(() => {
      const dialog=document.querySelector('.resource-building-dialog');
      const button=dialog?.querySelector('[data-qa-build-button]');
      return {title:dialog?.querySelector('h2')?.textContent?.trim()??'',status:dialog?.querySelector('[data-qa-build-status]')?.getAttribute('data-qa-build-status')??'',disabled:Boolean(button?.disabled)};
    })()`);
    if(!snapshot.title || snapshot.status!=='available' || snapshot.disabled) throw new Error(`Unexpected initial dialog state for ${role}: ${JSON.stringify(snapshot)}`);
    dialogSnapshots.push({role,...snapshot});
    if(role===RESOURCE_ROLES[0]) await capture(win,directory,'resource-zone-selected');
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
  await openResourceBuilding(win,'basic-energy');
  const buildClicked=await win.webContents.executeJavaScript(`(() => {
    const button=document.querySelector('[data-qa-build-button]');
    if(!button || button.disabled)return false;
    button.click();
    return true;
  })()`);
  if(!buildClicked) throw new Error('Basic-energy build button did not activate');
  await waitFor(win, `document.querySelector('.resource-zone-queue-card.busy')`);
  await waitFor(win, `(() => { try { return JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)})||'{}').queues?.['helion-01']?.assetRole==='basic-energy'; } catch { return false; } })()`);
  await settle(win);
  const queued=await win.webContents.executeJavaScript(`(() => {
    const card=document.querySelector('.resource-zone-queue-card.busy');
    const save=JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)})||'{}');
    return {text:card?.textContent?.replace(/\s+/g,' ').trim()??'',metal:save.metal,role:save.queues?.['helion-01']?.assetRole??null,energy:save.planets?.['helion-01']?.energy??null};
  })()`);
  if(queued.role!=='basic-energy' || queued.metal!==14680 || queued.energy!==140 || !queued.text.includes('Осталось')) throw new Error(`Active queue state failed: ${JSON.stringify(queued)}`);
  await capture(win,directory,'resource-zone-queue');

  await win.webContents.executeJavaScript(`(() => {
    const save=JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)})||'{}');
    save.queues['helion-01'].startedAt=Date.now()-1000;
    save.queues['helion-01'].finishAt=Date.now()-10;
    localStorage.setItem(${JSON.stringify(SAVE_KEY)},JSON.stringify(save));
  })()`);
  await reload(win);
  await waitFor(win, `(() => { try { const save=JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)})||'{}'); return save.queues?.['helion-01']===null && save.planets?.['helion-01']?.buildings?.['basic-energy']===1 && save.planets?.['helion-01']?.energy===165; } catch { return false; } })()`,8000);
  await activateResourceZone(win);
  await waitFor(win, `document.querySelector('[data-resource-building-role="basic-energy"]')?.getAttribute('aria-label')?.includes('Уровень 1')`);
  await capture(win,directory,'resource-zone-completed');

  await reload(win);
  await activateResourceZone(win);
  const persisted=await win.webContents.executeJavaScript(`(() => {
    const save=JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)})||'{}');
    const node=document.querySelector('[data-resource-building-role="basic-energy"]');
    const hasQueue=Object.prototype.hasOwnProperty.call(save.queues??{},'helion-01');
    return {level:save.planets?.['helion-01']?.buildings?.['basic-energy']??null,queue:hasQueue?save.queues['helion-01']:'missing',energy:save.planets?.['helion-01']?.energy??null,aria:node?.getAttribute('aria-label')??''};
  })()`);
  if(persisted.level!==1 || persisted.queue!==null || persisted.energy!==165 || !persisted.aria.includes('Уровень 1')) throw new Error(`Reload persistence failed: ${JSON.stringify(persisted)}`);

  const result={
    screen:'resource-zone-flow',
    openings:{hotspot:true,header:true},
    terrain,
    roles:visibleRoles,
    selectorRoles,
    dialogs:dialogSnapshots,
    insufficient,
    queued,
    completed:{level:1,energy:165,queue:null},
    persisted,
  };
  console.log(`Resource zone QA passed: terrain, ${RESOURCE_ROLES.length} buildings, selector, insufficient state, queue timer, completion and reload persistence.`);

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