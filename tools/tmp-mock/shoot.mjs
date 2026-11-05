// Снимает статичные макеты в PNG и проверяет наложения текста. Запуск только в CI.
import http from 'node:http';import fs from 'node:fs';import path from 'node:path';
import { chromium } from 'playwright';
const ROOT=process.cwd(),OUT=process.env.OUT||'shots';
const types={'.html':'text/html;charset=utf-8','.js':'text/javascript;charset=utf-8','.css':'text/css;charset=utf-8','.png':'image/png','.webp':'image/webp','.ttf':'font/ttf'};
const srv=http.createServer((q,r)=>{const p=path.join(ROOT,decodeURI(q.url.split('?')[0]));fs.readFile(p,(e,d)=>{if(e){r.writeHead(404);r.end();console.log('404',q.url);return}r.writeHead(200,{'content-type':types[path.extname(p)]||'application/octet-stream'});r.end(d)})}).listen(5177);
const JOBS=[['pravaya-knopka','1-vrag','q','enemy'],['pravaya-knopka','2-svoya','q','own'],['pravaya-knopka','3-asteroid','q','asteroid'],['pravaya-knopka','4-piraty','q','pirate']];
for(const [i,nm] of [[1,'atlas-1-ryad-planet'],[2,'atlas-2-spisok'],[3,'atlas-3-orbita']])JOBS.push([nm,'7-planet','at'+i,'7'],[nm,'2-planety','at'+i,'2']);
const SIZES=[[1920,1080],[1280,720]];
const b=await chromium.launch({channel:'chrome'});const report=[];
const check=()=>{const leaf=[];const w=document.createTreeWalker(document.getElementById('app'),NodeFilter.SHOW_TEXT);
 while(w.nextNode()){const t=w.currentNode;if(!t.textContent.trim())continue;const el=t.parentElement;const cs=getComputedStyle(el);if(cs.visibility==='hidden'||cs.display==='none'||el.closest('style')||el.closest('.nav,.top'))continue;const g=document.createRange();g.selectNodeContents(t);const rs=[...g.getClientRects()].filter(x=>x.width>1);for(const x of rs)leaf.push({t:t.textContent.trim().slice(0,26),x:x.left,y:x.top,r:x.right,b:x.bottom,el})}
 const out=[];for(let i=0;i<leaf.length;i++){const a=leaf[i];if(a.r>innerWidth+1||a.b>innerHeight+1||a.x<-1||a.y<-1)out.push('за экраном: '+a.t);
  for(let j=i+1;j<leaf.length;j++){const c=leaf[j];const ox=Math.min(a.r,c.r)-Math.max(a.x,c.x),oy=Math.min(a.b,c.b)-Math.max(a.y,c.y);if(ox>2&&oy>3&&a.el!==c.el)out.push(`наложение: "${a.t}" × "${c.t}"`)}}
 return [...new Set(out)]};
for(const [W,H] of SIZES){const p=await b.newPage({viewport:{width:W,height:H}});p.on('pageerror',e=>report.push(`JS: ${e.message}`));
 for(const [dir,name,v,s] of JOBS){const d=path.join(OUT,dir,`${W}x${H}`);fs.mkdirSync(d,{recursive:true});await p.goto(`http://localhost:5177/tools/tmp-mock/mock.html?v=${v}&s=${s}`,{waitUntil:'networkidle'});await p.evaluate(()=>document.fonts.ready);await p.waitForTimeout(150);
  await p.screenshot({path:path.join(d,name+'.png')});
  if(W===1920){const res=await p.evaluate(check);if(res.length)report.push(`\n[${dir} ${name}]\n  `+res.join('\n  '))}}
 await p.close()}
await b.close();srv.close();fs.writeFileSync(path.join(OUT,'check.txt'),report.join('\n')||'чисто');console.log(report.join('\n')||'чисто');
