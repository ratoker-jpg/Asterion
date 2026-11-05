const q=new URLSearchParams(location.search),V=q.get('v')||'a',S=q.get('s')||'main',HUGE=q.get('huge')==='1';
const u=p=>encodeURI(p);
const ICON=k=>u(`/src/assets/ui/header-icons/${k}.png`);
const SH={
 satellite:{n:'Спутник',f:'solar-satellite',h:1240,pop:1,cargo:0,speed:0,fuel:0,atk:1,life:2200,cost:[500,2000,500],t:'00:00:01',civ:1,role:'Солнечный спутник'},
 probe:{n:'Зонд',f:'spy-probe',h:240,pop:1,cargo:1,speed:2e8,fuel:1,atk:1,life:1,cost:[0,1000,0],t:'00:00:01',civ:1,role:'Шпионский зонд'},
 transporter:{n:'Транспорт',f:'transporter',h:1250,pop:1,cargo:5000,speed:24000,fuel:12,atk:10,life:2000,cost:[2400,1400,0],t:'00:00:03',civ:1,role:'Перевозит ресурсы'},
 mega:{n:'Мегатранспорт',f:'mega-transporter',h:320,pop:3,cargo:20000,speed:19000,fuel:45,atk:10,life:7800,cost:[6400,5000,0],t:'00:00:05',civ:1,role:'Большой трюм'},
 colonizer:{n:'Колонизатор',f:'colonizer',h:3,pop:12,cargo:7500,speed:5000,fuel:1500,atk:600,life:2400,cost:[12500,25000,10600],t:'00:00:14',civ:1,role:'Занимает новую планету'},
 recycler:{n:'Переработчик',f:'recycler',h:77,pop:5,cargo:40000,speed:7000,fuel:120,atk:50,life:2200,cost:[10500,5300,1800],t:'00:00:10',civ:1,role:'Собирает обломки'},
 scout:{n:'Скаут',f:'scout',h:94,pop:2,cargo:250,speed:28000,fuel:25,atk:800,life:2400,cost:[2400,1600,0],t:'00:00:05',role:'Лёгкий боевой разведчик'},
 cruiser:{n:'Крейсер',f:'cruiser',h:500,pop:7,cargo:800,speed:32000,fuel:315,atk:3080,life:9200,cost:[10200,8400,0],t:'00:00:06',role:'Быстрый и лёгкий'},
 defender:{n:'Защитник',f:'defender',h:40,pop:6,cargo:1500,speed:20000,fuel:280,atk:2760,life:8300,cost:[5300,15900,0],t:'00:00:09',role:'Прикрывает флот'},
 battleship:{n:'Линкор',f:'battleship',h:430,pop:15,cargo:1500,speed:20000,fuel:480,atk:9000,life:27000,cost:[49400,21200,0],t:'00:00:14',role:'Основа боевого флота'},
 destroyer:{n:'Разрушитель',f:'destroyer',h:167,pop:30,cargo:2000,speed:13000,fuel:900,atk:19500,life:58500,cost:[93900,84500,9400],t:'00:00:20',role:'Тяжёлый ударный корабль'},
 bomber:{n:'Бомбардировщик',f:'bomber',h:2,pop:22,cargo:500,speed:20000,fuel:800,atk:13200,life:39600,cost:[44000,55000,11000],t:'00:00:14',role:'Бьёт по обороне'},
 death:{n:'Планетолом',f:'death-star',h:0,pop:700,cargo:1e6,speed:200,fuel:60000,atk:7e5,life:21e5,cost:[2327500,1862000,465500],t:'00:44:10',role:'Самый большой корабль'},
};
if(HUGE) for(const k in SH){ if(SH[k].h) SH[k].h=SH[k].h*2719+k.length*37; }
const FLY=['probe','transporter','mega','colonizer','recycler','scout','cruiser','defender','battleship','destroyer','bomber','death'];
const ART=id=>u(`/assets/source/New assets/ship/aegis/ship.aegis.${SH[id].f}.png`);
const n=x=>String(Math.round(x)).replace(/\B(?=(\d{3})+(?!\d))/g,' ');
const MI={
 transport:{n:'Транспортировка',s:'Транспорт',d:'Перевозка ресурсов на свою или чужую планету.',g:'Хозяйство'},
 espionage:{n:'Шпионаж',s:'Шпионаж',d:'Зонд летит к цели и приносит отчёт.',g:'Разведка'},
 attack:{n:'Атака',s:'Атака',d:'Бой с флотом и обороной цели. Победитель забирает ресурсы.',g:'Война'},
 'pirate-elimination':{n:'Пиратский рейд',s:'Пиратский рейд',d:'Удар по пиратской планете ради добычи.',g:'Война'},
 expedition:{n:'Экспедиция',s:'Экспедиция',d:'Вылет на поиски находок в космосе.',g:'Разведка'},
 deployment:{n:'Дислокация',s:'Дислокация',d:'Перевести флот на другую свою планету вместе с грузом.',g:'Хозяйство'},
 colonize:{n:'Колонизация',s:'Колонизация',d:'Занять свободную позицию новой планетой.',g:'Хозяйство'},
 recycle:{n:'Переработка',s:'Переработка',d:'Собрать обломки на любой координате.',g:'Хозяйство'},
 gas:{n:'Добыча газа',s:'Добыча газа',d:'Собрать газ в поясе астероидов.',g:'Хозяйство'},
 'sun-support':{n:'Поддержка солнца',s:'Поддержка солнца',d:'Отправить флот на защиту солнца.',g:'Союз'},
 aid:{n:'Помощь союзу',s:'Помощь союзу',d:'Флот и ресурсы союзнику.',g:'Союз'},
 'space-flight':{n:'Космический рейс',s:'Космический рейс',d:'Полёт без цели и возврат в назначенное время.',g:'Разведка'},
};
const BAN=m=>u(`/src/assets/ui/missions/banner-${m}.webp`);
const PL=i=>u(`/assets/source/universe-navigation/planets/planet.variant-0${i}.png`);
const GAL=i=>u(`/src/assets/ui/atlas/galaxy-0${i}.webp`);
const HOME=PL(5);
const ORI={name:HUGE?'Новая Александрия-на-Орбите':'Москва',gen:HUGE?'Новой Александрии-на-Орбите':'Москвы',c:[1,17,17],art:HOME};
const coord=c=>`[${c.join(':')}]`;
const RES=[['metal','Металл',15468832],['mineral','Минералы',20055258],['gas','Газ',13908963]].map(r=>HUGE?[r[0],r[1],r[2]*97+13]:r);
const posD=(a,b)=>{const R=p=>Math.floor((p-1)/6),Z=p=>(p-1)%6;const s=Math.abs(Z(a)-Z(b));return 6*Math.abs(R(a)-R(b))+Math.min(s,6-s)};
const SCI=1.3,CHEM=.8;
function flight(ships,tc){const ids=Object.keys(ships);let cargo=0,pop=0,atk=0,life=0,bf=0,cnt=0,sp=1e12;
 for(const i of ids){const s=SH[i],x=ships[i];cargo+=s.cargo*x;pop+=s.pop*x;atk+=s.atk*x;life+=s.life*x;bf+=s.fuel*x;cnt+=x;sp=Math.min(sp,s.speed)}
 const r={cargo,pop,atk,life,cnt,speed:sp*SCI};if(!tc)return r;
 const g=Math.abs(tc[0]-ORI.c[0]),y=Math.abs(tc[1]-ORI.c[1]),p=posD(tc[2],ORI.c[2]);
 r.dist=1000+16505*g+385*y+5*p;const base=3+6*g+.08*y+.02*p;
 const recon=ids.length===1&&ids[0]==='probe';
 r.sec=Math.round(Math.max(recon?3:180,base*(20000/r.speed)**.25/1.5*60));
 r.gas=Math.max(1,Math.ceil(bf*r.dist/12000*CHEM));return r}
const NOW=21*3600+27*60+39;
const hms=s=>[s/3600|0,(s%3600)/60|0,s%60].map(v=>String(v).padStart(2,'0')).join(':');
const at=s=>hms((NOW+s)%86400);
const kS=HUGE?2719:1;
const SC={
 transport:{m:'transport',ships:{transporter:400*kS,mega:60*kS},tgt:{name:HUGE?'Верхний Предел Колонии Тау':'Самара',acc:HUGE?'Верхний Предел Колонии Тау':'Самару',c:[2,8,11],who:'Своя планета',art:PL(2)},cargo:[1800000*kS,900000*kS,200000*kS]},
 attack:{m:'attack',ships:{cruiser:500*kS,battleship:430*kS,destroyer:167*kS,scout:94*kS},tgt:{name:'Вершина',acc:'Вершину',c:[3,23,10],who:'Игрок Тарок',art:PL(7)}},
 spy:{m:'espionage',ships:{probe:12},tgt:{name:'Вершина',acc:'Вершину',c:[3,23,10],who:'Игрок Тарок',art:PL(7)}},
 none:{m:'transport',ships:{transporter:400*kS,mega:60*kS},tgt:null,cargo:[1800000*kS,900000*kS,200000*kS]},
};
const NEAR=[['Самара','своя',[2,8,11],PL(2)],['Тверь','своя',[1,17,9],PL(6)],['Новосибирск','своя',[1,17,4],PL(8)],['Вершина','недавняя цель',[3,23,10],PL(7)]];
const REP={metal:4120556,mineral:2388104,gas:961230,fleet:1020,def:340,ago:'12 мин назад'};
const SIM={a:{cruiser:[500,118],battleship:[430,42],destroyer:[167,6],scout:[94,31]},d:{cruiser:[300,300],battleship:[260,260],defender:[120,120],destroyer:[80,80]},round:4,rounds:8,verdict:'Победа атакующего',debris:14148674};
const X='<div class="x"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M5 5l14 14M19 5L5 19"/></svg></div>';
function hud(act='Флоты'){const ri=(i,l,v)=>`<div class="it"><img src="${ICON(i)}"><div><small>${l}</small><b>${v}</b></div></div>`;
 const na=(i,l)=>`<div class="${l===act?'on':''}"><img src="${ICON(i)}"><span>${l}</span></div>`;
 return `<div class="top"><div class="it" style="width:44px;justify-content:center;color:var(--ac)">≡</div>${RES.map(r=>ri(r[0],r[1],n(r[2]))).join('')}
 <div class="it" style="width:${HUGE?300:210}px"><img src="${HOME}"><div style="flex:1"><b class="ell" style="display:block;font-size:15px">${ORI.name}</b><small>${coord(ORI.c)} · 1 из 7</small></div></div>
 <div style="flex:1;max-width:150px"></div>${ri('energy','Энергия',n(HUGE?1999104:3104))}${ri('debris','Обломки',n(HUGE?30586467800:305864678))}${ri('population','Население',n(HUGE?49782311:18308))}<div class="it"><b>21:27:39</b></div></div>
 <div class="nav">${na('planet','Планета')}${na('universe','Вселенная')}${na('fleets','Флоты')}<div></div>${na('operations','Операции')}${na('command','Командование')}${na('reports','Сообщения')}</div>
 <div class="orb"><img src="${HOME}"></div><div class="ob" style="left:835px;top:70px"><img src="${ICON('zone-resource')}"></div><div class="ob" style="left:1035px;top:70px"><img src="${ICON('zone-industry')}"></div>`}
const TABS=[['main','Отправка флота'],['ships','Корабли'],['','Оборона'],['','Командирские']];const TABS2=[['','Мастерская'],['','Приоритет'],['','Битвы'],['sim','Симулятор']];
function tabs(cur){const f=t=>`<span class="${t[0]===cur?'on':''}">${t[1]}</span>`;return `<div class="tabs"><div>${TABS.map(f).join('')}</div><i></i><div>${TABS2.map(f).join('')}</div></div>`}
function cargoFor(sc,f){return sc.cargo?sc.cargo.reduce((a,b)=>a+b,0):0}
const VIEWS={};
function go(){const z=document.getElementById('z'),k=innerWidth/1920;z.style.transform=`scale(${k})`;
 document.getElementById('app').innerHTML=VIEWS[V](S);}
