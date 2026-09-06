const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed', () => {});

const ROOT = path.join(__dirname, '..');
const OUTPUT = path.join(ROOT, 'visual-qa');
const VIEWPORTS = [[1920,1080],[1600,900],[1280,720],[2560,1440]];
const SCREENS = [
  ['settings','Настройки','settings-view-v2'],
  ['rating','Рейтинг','rating-view-v2'],
  ['science','Наука','science-view-v2'],
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

async function verifyCommon(item, label, name, width, height) {
  if(item.viewport.width!==width || item.viewport.height!==height) throw new Error(`${label}/${name}: viewport mismatch ${item.viewport.width}x${item.viewport.height}`);
  if(item.document.verticalScroll && !item.document.longPageClass) throw new Error(`${label}/${name}: document scroll is not owned by GlobalPageScrollController`);
  if(name==='science' && ownsNestedVerticalScroll(item.scienceCatalog)) throw new Error(`${label}/${name}: science still owns a nested vertical scrollbar`);
  if(name==='settings' && ownsNestedVerticalScroll(item.settingsContent)) throw new Error(`${label}/${name}: settings still owns a nested vertical scrollbar`);
  if(name==='rating' && ownsNestedVerticalScroll(item.ratingTable)) throw new Error(`${label}/${name}: rating table still owns a nested vertical scrollbar`);
  if(name==='rating' && (!item.ratingPinnedCurrent || !item.ratingSelfSeparator)) throw new Error(`${label}/${name}: current player is not pinned below the visible page like Nemexia`);
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
        await clickTypography(win,'HUD / верхняя панель',6);
        const hud130=await metrics(win,'settings-hud-130');
        if(hud130.typography.hud!=='1.3'||hud130.typography.helper!=='1') throw new Error(`Typography isolation failed: ${JSON.stringify(hud130.typography)}`);
        await verifyCommon(hud130,label,'settings-hud-130',width,height); results.push(hud130); await capture(win,directory,'settings-hud-130');
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