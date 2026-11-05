/* Быстрые действия по правой кнопке и три варианта Звёздного атласа */
(function(){
const CSS=`
.q-c{display:grid;grid-template-columns:84px 1fr;gap:14px;align-items:center;height:92px}
.q-c i{display:block;width:84px;height:84px;border-radius:50%;background-size:auto 180%;background-position:88% 50%;box-shadow:0 0 0 2px rgba(150,200,255,.4),0 6px 18px #000c}
.q-c b{display:block;font-size:22px;line-height:1.1;text-shadow:0 2px 8px #000}.q-c em{display:block;font-style:normal;color:var(--ac);font-weight:700;font-size:19px;text-shadow:0 2px 8px #000}
.q-c.off i{filter:grayscale(1) brightness(.5);box-shadow:0 0 0 2px rgba(255,255,255,.14)}.q-c.off b{color:#9fb0c2}.q-c.off em{color:var(--am);font-weight:600;font-size:17px;line-height:1.15}
.at-sky{position:absolute;inset:0;background-size:cover;background-position:center;opacity:.28}
.at-c{display:block;border-radius:50%;background-size:auto 180%;background-position:88% 50%;box-shadow:0 0 0 2px rgba(150,200,255,.4),0 4px 12px #000b;flex:none}
.at-c.off{filter:grayscale(1) brightness(.45);box-shadow:0 0 0 2px rgba(255,255,255,.12)}
.at-m{display:flex;align-items:center;gap:10px}.at-m img{width:68px;height:68px}.at-m small{display:block;font-size:17px;color:var(--mu);line-height:1.1}.at-m b{font-size:27px;line-height:1.15;white-space:nowrap}
`;
const st=`<style>${CSS}</style>`;
const AST=f=>u(`/assets/source/universe-navigation/${f}`);
const fmtT=s=>s<60?`${s} с`:hms(s);
/* правая кнопка мыши */
const OBJ={
 enemy:{t:'Нерида',c:'[1:34:6]',who:'Игрок Квелрок · Враг',col:'#ff6a78',art:PL(3),x:560,y:560,d:150,rows:[['espionage','Шпионаж','00:00:02'],['attack','Атака','00:00:36'],['transport','Транспорт','00:00:36'],['recycle','Собрать обломки','00:00:36']]},
 own:{t:'Самара',c:'[2:8:11]',who:'Своя планета',col:'#4fe3a0',art:PL(2),x:1000,y:470,d:150,rows:[['transport','Транспорт','00:06:13'],['deployment','Дислокация','00:06:13'],['recycle','Собрать обломки',null,'На орбите нет обломков']]},
 asteroid:{t:'Астероид',c:'[1:34:23]',who:'Газа в поясе 46 749',col:'#5fd4ff',art:AST('asteroids/asteroid.variant-02.png'),x:760,y:660,d:110,rows:[['gas','Отправить переработчика','00:03:00'],['colonize','Колонизировать',null,'Занято астероидом'],['recycle','Собрать обломки','00:03:00']]},
 pirate:{t:'Пираты',c:'[1:33:13]',who:'Логово пиратов · ур. 12',col:'#ffc14d',art:u('/assets/source/planets/pirate/pirate-planet-03.png'),x:420,y:470,d:150,rows:[['espionage','Разведать','00:00:02'],['pirate-elimination','Пиратский рейд',null,'Сначала разведка: состав логова неизвестен'],['space-flight','Открыть разведотчёт',null,'Разведотчёт ещё не сформирован']]},
};
function quick(k){const o=OBJ[k];const r=o.d/2;
 const orb=[640,560,480].map((R,i)=>`<ellipse cx="960" cy="610" rx="${R*1.25}" ry="${R*.72}" fill="none" stroke="#7fb4ff" stroke-opacity=".1"/>`).join('');
 const rows=o.rows.map(a=>`<div class="q-c ${a[2]?'':'off'}"><i style="background-image:url(${BAN(a[0])})"></i><div><b>${a[1]}</b><em>${a[2]||a[3]}</em></div></div>`).join('');
 const h=o.rows.length*92+104;const top=Math.max(150,o.y-h/2);
 return st+hud('Вселенная')+`<svg class="abs" style="left:0;top:0" width="1920" height="1080">${orb}</svg>
 <img class="abs" src="${AST('active-suns/active-sun.variant-01.png')}" style="left:1180px;top:700px;width:220px;height:220px;opacity:.9">
 <img class="abs" src="${PL(8)}" style="left:1500px;top:300px;width:100px;height:100px;opacity:.75"><img class="abs" src="${PL(6)}" style="left:1560px;top:760px;width:110px;height:110px;opacity:.75"><img class="abs" src="${AST('asteroids/asteroid.variant-04.png')}" style="left:220px;top:880px;width:60px;height:60px;opacity:.75">
 <img class="abs" src="${o.art}" style="left:${o.x-r}px;top:${o.y-r}px;width:${o.d}px;height:${o.d}px;filter:drop-shadow(0 0 22px ${o.col})">
 <div class="abs round" style="left:${o.x-r-9}px;top:${o.y-r-9}px;width:${o.d+18}px;height:${o.d+18}px;box-shadow:0 0 0 2px ${o.col}"></div>
 <div class="abs" style="left:${o.x+r+34}px;top:${top}px;width:520px"><div style="text-shadow:0 2px 8px #000"><b style="font-size:26px">${o.t}</b> <span class="ac" style="font-weight:700;font-size:20px">${o.c}</span></div><div class="mu" style="margin-bottom:8px;text-shadow:0 2px 8px #000">${o.who}</div>${rows}<div class="mu" style="margin:6px 0 0 98px;font-size:18px;font-weight:700;text-shadow:0 2px 8px #000">Карточка объекта</div></div>`}
/* данные атласа */
const OWNERS={
 '7':{name:'скаус',status:'В сети',rel:'Враг · в диапазоне атаки',reason:'У него 509 090 общих очков, тебе можно атаковать от 407 272 до 1 018 180.',pts:[412780,96310,509090,1240],ok:1,
  pl:[['Ксенон-4-2',[1,27,19],PL(8),1],['Цитадель Север',[1,25,8],PL(3),0,1240000],['Нерида',[1,34,6],PL(6)],['Фобос',[1,27,3],PL(1)],['Ярь',[2,8,14],PL(2)],['Кальдера',[2,11,21],PL(7),0,86400],['Новый Предел',[3,40,2],PL(5)]]},
 '2':{name:'скаус',status:'В сети',rel:'Враг · вне диапазона атаки · доступен шпионаж',reason:'У него 6 687 общих очков, тебе можно атаковать от 1 161 до 4 642.',pts:[6687,0,6687,0],ok:0,
  pl:[['Ксенон-4-2',[1,27,19],PL(8),1],['Цитадель Север',[1,25,8],PL(3)]]},
};
const MED=[['resource-crystal','Ресурсные'],['battle','Боевые'],['overall-star','Общие'],['achievement-trophy','Достижения']];
const medal=(o,i)=>`<div class="at-m"><img src="${u('/public/assets/generated/asterion/ui/score-icons/'+MED[i][0]+'.webp')}"><div><small>${MED[i][1]}</small><b>${n(o.pts[i])}</b></div></div>`;
const FB='/src/assets/command/orbital-heraldry/';
const crest=s=>`<div style="position:relative;width:${s}px;height:${s}px;flex:none"><img class="abs" src="${u(FB+'field-navy.webp')}" style="inset:${s*.1}px;width:${s*.8}px;height:${s*.8}px;clip-path:polygon(29% 0,71% 0,100% 29%,100% 71%,71% 100%,29% 100%,0 71%,0 29%)"><img class="abs" src="${u(FB+'glyph-blades-crimson.webp')}" style="inset:${s*.2}px;width:${s*.6}px;height:${s*.6}px"><img class="abs" src="${u(FB+'frame-octagon.webp')}" style="inset:0;width:${s}px;height:${s}px"></div>`;
const race=s=>`<img src="${u('/assets/source/generated-factions-v1/factions/veyra_emblem.png')}" style="width:${s}px;height:${s}px;flex:none;filter:drop-shadow(0 0 12px #ff5a6a88)">`;
const general=(h)=>`<img src="${u('/assets/source/generated-factions-v1/factions/veyra_general.png')}" style="height:${h}px;width:auto;flex:none;filter:drop-shadow(0 8px 30px #000)">`;
const ALLY=`Фениан Союз`;
const times=(p)=>{const sp=flight({probe:1},p[1]).sec,fl=flight({cruiser:500,battleship:430,destroyer:167},p[1]).sec;return [fmtT(sp),fmtT(fl)]};
const circ=(m,s,off)=>`<i class="at-c ${off?'off':''}" style="width:${s}px;height:${s}px;background-image:url(${BAN(m)})"></i>`;
const acts=(o,p,s)=>{const t=times(p);return [['espionage','Шпионаж',t[0],0],['attack','Атака',t[1],!o.ok],['transport','Транспорт',t[1],0]].concat(p[4]?[['recycle','Обломки',t[1],0]]:[])};
const bg=`<div class="at-sky" style="background-image:url(${GAL(2)})"></div><div class="abs" style="inset:0;background:radial-gradient(1200px 800px at 50% 40%,rgba(255,60,80,.1),transparent 70%)"></div>`;
const owner=(o,g)=>`<div style="display:flex;align-items:center;gap:18px">${race(g)}<div><div style="font-size:40px;font-weight:900;line-height:1.05">${o.name}</div><div style="font-size:20px;font-weight:700;color:#ff8a95">Рой</div><div class="gr" style="font-weight:700;font-size:18px">● ${o.status}</div><div class="ac" style="font-weight:700;font-size:18px">Профиль игрока</div></div></div>`;
const ally=s=>`<div style="display:flex;align-items:center;gap:14px">${crest(s)}<div><div class="mu" style="font-size:17px">Союз</div><div style="font-size:24px;font-weight:800;line-height:1.1;white-space:nowrap">${ALLY}</div><div class="ac" style="font-weight:700">[ФЕНИАН]</div></div></div>`;
const relation=o=>`<div style="color:${o.ok?'#ff8a95':'var(--am)'};font-size:22px;font-weight:800;line-height:1.15">${o.rel}</div><div class="mu" style="font-size:18px;margin-top:3px">${o.reason}</div>`;
/* 1: ряд планет */
function at1(k){const o=OWNERS[k],N=o.pl.length,big=N<=3;const w=big?440:252;
 const card=p=>{const on=p[3];const s=big?104:56;return `<div style="width:${w}px;text-align:center;position:relative;${on?'background:rgba(255,90,110,.1);box-shadow:inset 0 0 0 2px #ff6a7899;':''}border-radius:var(--r);padding:12px 4px 10px;height:${big?500:440}px">
 <img src="${p[2]}" style="width:${big?210:150}px;height:${big?210:150}px;margin:0 auto;${on?'filter:drop-shadow(0 0 24px #ff6a78aa)':''}"><div style="font-size:${big?26:21}px;font-weight:800;line-height:1.15;margin-top:6px;white-space:nowrap">${p[0]}</div><div class="ac" style="font-weight:700;font-size:18px">${coord(p[1])}</div>
 <div style="height:24px;font-size:17px;color:var(--am);font-weight:600;white-space:nowrap">${p[4]?'обломки '+n(p[4]):''}</div>
 <div style="display:flex;justify-content:center;gap:${big?22:7}px;margin-top:6px">${acts(o,p).slice(0,big?4:3).map(a=>`<div style="width:${s+(big?16:18)}px">${circ(a[0],s,a[3]).replace('class="at-c','style_x class="at-c').replace('style_x ','')}<div style="font-size:${big?18:17}px;font-weight:700;line-height:1.1;margin-top:4px;white-space:nowrap;margin-left:-8px;margin-right:-8px" class="${a[3]?'mu':'ac'}">${a[3]?'нельзя':a[2]}</div></div>`).join('')}</div></div>`};
 return st+`<div class="ov" style="background:#04080ff5">${bg}${X}
 <div class="abs" style="left:60px;top:44px;right:130px;display:grid;grid-template-columns:auto auto 1fr;gap:64px;align-items:center">${owner(o,150)}${ally(120)}<div style="display:grid;grid-template-columns:auto auto;gap:14px 50px;justify-content:end">${[0,1,2,3].map(i=>medal(o,i)).join('')}</div></div>
 <div class="abs" style="left:60px;right:60px;top:238px;display:flex;align-items:baseline;gap:18px"><span style="font-size:30px;font-weight:900">Планеты игрока</span><span class="mu" style="font-size:22px;font-weight:700">${N}</span><span class="mu" style="margin-left:auto">Шпионаж, атака и транспорт на любую планету в один клик</span></div>
 <div class="abs" style="left:60px;right:60px;top:${big?300:306}px;display:flex;justify-content:${big?'center':'space-between'};gap:${big?40:0}px">${o.pl.map(card).join('')}</div>
 <div class="abs" style="left:60px;right:60px;bottom:30px;display:flex;align-items:center;gap:30px"><div style="flex:1">${relation(o)}</div><span class="btn" style="height:60px;font-size:20px">Показать на карте</span></div></div>`}
/* 2: планета и список */
function at2(k){const o=OWNERS[k],p0=o.pl[0],few=o.pl.length<=3;const rh=few?150:96;
 const row=p=>{const on=p[3];const s=few?84:64;return `<div style="display:grid;grid-template-columns:${few?100:76}px 1fr repeat(4,108px);gap:8px;align-items:center;height:${rh}px;border-radius:var(--r);padding:0 8px;${on?'background:rgba(255,90,110,.1);box-shadow:inset 0 0 0 2px #ff6a7899':''}"><img src="${p[2]}" style="width:${few?96:72}px;height:${few?96:72}px"><div><div style="font-size:22px;font-weight:800;line-height:1.1;white-space:nowrap">${p[0]}</div><div><span class="ac" style="font-weight:700">${coord(p[1])}</span></div>${p[4]?`<div class="am" style="font-weight:600;font-size:17px;white-space:nowrap">обломки ${n(p[4])}</div>`:''}</div>${[0,1,2,3].map(i=>{const a=acts(o,p)[i];return a?`<div style="display:flex;flex-direction:column;align-items:center">${circ(a[0],few?72:56,a[3])}<div class="${a[3]?'mu':'ac'}" style="font-size:17px;font-weight:700;white-space:nowrap;margin-top:2px">${a[3]?'нельзя':a[2]}</div></div>`:'<span></span>'}).join('')}</div>`};
 return st+`<div class="ov" style="background:#04080ff5">${bg}${X}
 <img class="abs" src="${p0[2]}" style="left:120px;top:120px;width:500px;height:500px;filter:drop-shadow(0 0 60px #ff6a7877)">
 <div class="abs" style="left:60px;top:36px"><div class="k">Звёздный атлас</div><div style="font-size:44px;font-weight:900;line-height:1.1">${p0[0]} <span class="ac" style="font-size:24px;font-weight:700">${coord(p0[1])}</span></div></div>
 <div class="abs" style="left:60px;top:640px;width:690px">${owner(o,128)}<div style="margin-top:16px">${ally(96)}</div><div style="margin-top:18px">${relation(o)}</div></div>
 <div class="abs" style="left:810px;right:60px;top:${few?100:96}px;display:grid;grid-template-columns:repeat(4,auto);justify-content:space-between;padding-right:${few?0:0}px">${[0,1,2,3].map(i=>medal(o,i)).join('')}</div>
 <div class="abs" style="left:810px;right:60px;top:${few?210:186}px"><div style="display:flex;align-items:center;margin-bottom:6px"><span style="font-size:26px;font-weight:900">Планеты игрока · ${o.pl.length}</span><span style="margin-left:auto;display:grid;grid-template-columns:repeat(4,116px);text-align:center;font-size:17px;color:var(--mu);font-weight:700;padding-right:8px"><span>Шпионаж</span><span>Атака</span><span>Транспорт</span><span>Обломки</span></span></div>${o.pl.map(row).join('')}</div>
 <div class="abs" style="right:60px;bottom:30px"><span class="btn" style="height:60px;font-size:20px">Показать на карте</span></div></div>`}
/* 3: планеты на орбите вокруг выбранной */
function at3(k){const o=OWNERS[k],p0=o.pl[0],rest=o.pl.slice(1);const cx=1150,cy=560,Rx=490,Ry=395;
 const ANG=rest.length>2?[-150,-90,-30,30,90,150]:[-30,150];
 const tok=rest.map((p,i)=>{const a=ANG[i]*Math.PI/180,x=cx+Rx*Math.cos(a),y=cy+Ry*Math.sin(a);const ac=acts(o,p).slice(0,2);return `<div class="abs" style="left:${x-50}px;top:${y-58}px;width:300px;display:flex;gap:6px;align-items:flex-start"><div style="width:100px;flex:none;text-align:center;position:relative"><img src="${p[2]}" style="width:92px;height:92px;margin:0 auto"></div><div style="display:flex;gap:6px;padding-top:22px">${ac.map(c=>`<div style="text-align:center;width:60px">${circ(c[0],52,c[3]).replace('display:block','')}<div class="${c[3]?'mu':'ac'}" style="font-size:17px;font-weight:700;white-space:nowrap;margin:0 -10px">${c[3]?'нельзя':c[2]}</div></div>`).join('')}</div>
 <div class="abs" style="left:-50px;top:92px;width:200px;text-align:center;line-height:1.1"><div style="font-size:18px;font-weight:800;white-space:nowrap;text-shadow:0 2px 6px #000">${p[0]}</div><div class="ac" style="font-size:17px;font-weight:700">${coord(p[1])}</div>${p[4]?`<div class="am" style="font-size:17px;font-weight:600;white-space:nowrap">обломки ${n(p[4])}</div>`:''}</div></div>`}).join('');
 const main=acts(o,p0).map(a=>`<div class="q-c ${a[3]?'off':''}" style="height:84px;grid-template-columns:72px 1fr"><i style="width:72px;height:72px;background-image:url(${BAN(a[0])})"></i><div><b style="font-size:20px">${a[1]}</b><em>${a[3]?'вне диапазона':a[2]}</em></div></div>`).join('');
 return st+`<div class="ov" style="background:#04080ff5">${bg}${X}
 <svg class="abs" style="left:0;top:0" width="1920" height="1080"><ellipse cx="${cx}" cy="${cy}" rx="${Rx}" ry="${Ry}" fill="none" stroke="#ff8a95" stroke-opacity=".35" stroke-width="2" stroke-dasharray="3 10"/></svg>
 <div class="abs" style="left:60px;top:44px;width:470px">${owner(o,120)}<div style="margin-top:26px">${ally(96)}</div><div style="display:grid;grid-template-columns:1fr 1fr;gap:20px 12px;margin-top:30px">${[0,1,2,3].map(i=>medal(o,i)).join('')}</div><div style="margin-top:30px">${relation(o)}</div><span class="btn" style="height:56px;margin-top:24px;font-size:19px">Показать на карте</span></div>
 <img class="abs" src="${p0[2]}" style="left:${cx-280}px;top:${cy-170}px;width:300px;height:300px;filter:drop-shadow(0 0 50px #ff6a7899)">
 <div class="abs" style="left:${cx-300}px;top:${cy+132}px;width:340px;text-align:center"><div style="font-size:28px;font-weight:900;text-shadow:0 2px 8px #000">${p0[0]}</div><div class="ac" style="font-weight:700;font-size:20px">${coord(p0[1])}</div></div>
 <div class="abs" style="left:${cx+30}px;top:${cy-acts(o,p0).length*42}px;width:270px">${main}</div>${tok}</div>`}
VIEWS.q=quick;VIEWS.at1=at1;VIEWS.at2=at2;VIEWS.at3=at3;
})();
