// Interactive system scene on the game's real 1920x1080 stage.
// Drag to rotate the system; planets keep their order on their orbits.
const Q = new URLSearchParams(location.search);
const MAP_TOP = 136;
const SIZE = { planet: 3.7, asteroid: 2.2, pirate: 3.9, unique: 3.7, anomaly: 3.5, empty: 1.6, uninhabited: 2.7 };
const BIG = { 3: 1.25, 6: 1.12, 9: 1.1, 12: 1.2, 18: 1.15, 22: 1.25, 20: 1.08 };

function plateInner(o) {
  if (o.tone === 'uninhabited') return { cls: 'muted', html: '<span class="nm">Необитаемая</span>' };
  let name = o.name, sub = '';
  if (o.kind === 'asteroid') { name = 'Астероид'; sub = `газ ${short(o.gas)}/ч`; }
  else if (o.kind === 'pirate') sub = `исчезнет через ${o.timer}`;
  else if (o.kind === 'unique') sub = o.occupant ? 'занят чужим флотом' : 'свободен';
  else if (o.kind === 'anomaly') sub = o.mine;
  else if (o.points) sub = `${o.ally ? `<i>[${ALLIANCES[o.ally].tag}]</i> ` : ''}${short(o.points)}${o.shield ? ' · щит' : ''}`;
  return { cls: `t-${o.tone}`, html: `<span class="nm">${name}</span>${sub ? `<small>${sub}</small>` : ''}` };
}

function makeOrrery(cfg) {
  const rem = 22;
  document.body.innerHTML = `<div class="stage ${cfg.cls || ''}">
    <canvas class="bg" width="1920" height="1080"></canvas><svg class="orb" viewBox="0 0 1920 1080"></svg>
    <div class="map"><div class="sun" style="--sun:${cfg.sunSize || 200}px;--sun-c:${cfg.sunColor || 'rgba(90,190,255,.32)'}"><i></i><img src="${ART.sun(cfg.sun || 2)}"></div></div>
    <img class="hdr" src="../assets/game-header.png">
    <div class="title"><small>Галактика 1</small><b>Система ${String(CURRENT_SYSTEM).padStart(2, '0')}</b></div>
    <div class="rail"><span>${String(CURRENT_SYSTEM - 1).padStart(2, '0')}</span><b>${String(CURRENT_SYSTEM).padStart(2, '0')}</b><span>${String(CURRENT_SYSTEM + 1).padStart(2, '0')}</span><small>/ 40</small></div>
    <div class="spin"><button data-r="-1" aria-label="Повернуть влево">&#8634;</button><button data-r="0" aria-label="Как было">&#9675;</button><button data-r="1" aria-label="Повернуть вправо">&#8635;</button></div>
  </div>`;
  const stage = document.querySelector('.stage');
  const fit = () => stage.style.setProperty('--k', Math.min(innerWidth / 1920, innerHeight / 1080));
  fit(); addEventListener('resize', fit);
  const map = stage.querySelector('.map'), svg = stage.querySelector('svg.orb'), cv = stage.querySelector('canvas.bg'), g = cv.getContext('2d');
  const sun = stage.querySelector('.sun');
  sun.style.left = `${cfg.cx}px`; sun.style.top = `${cfg.cy}px`;

  let selected = Q.get('quick') ? SELECTED.pos : (isEmpty ? 0 : SELECTED.pos);
  let hovered = Number(Q.get('hover') || 0);
  const items = SYSTEM.map((o) => {
    const el = document.createElement('div');
    const base = (o.tone === 'uninhabited' ? SIZE.uninhabited : SIZE[o.kind]) * (BIG[o.pos] || 1) * rem;
    el.className = `obj k-${o.kind} t-${o.tone} ${o.kind === 'empty' ? 'empty' : ''}`;
    el.style.setProperty('--c', TONE[o.tone].color); el.style.setProperty('--sz', `${base}px`);
    el.innerHTML = o.kind === 'empty'
      ? `<div class="body"><i class="em"></i><b class="en">${o.pos}</b>${o.debris ? `<img class="debris" src="${ART.debris(3)}" style="width:80%;left:10%;bottom:30%">` : ''}</div>`
      : `<div class="body">${o.shield ? '<i class="shield"></i>' : ''}<i class="halo"></i><img class="art" src="${o.art}"><b class="num">${o.pos}</b>${o.debris ? `<img class="debris" src="${ART.debris(o.debris > 1e9 ? 2 : 4)}">` : ''}</div>`;
    map.appendChild(el);
    let plate = null;
    if (o.kind !== 'empty') {
      const p = plateInner(o); plate = document.createElement('div');
      plate.className = `plate ${p.cls}`; plate.style.setProperty('--c', TONE[o.tone].color);
      plate.innerHTML = p.html + '<i class="stem"></i>'; map.appendChild(plate);
    }
    el.querySelector('.body').addEventListener('mouseenter', () => { hovered = o.pos; });
    el.querySelector('.body').addEventListener('mouseleave', () => { if (hovered === o.pos) hovered = 0; });
    el.querySelector('.body').addEventListener('click', (e) => { e.stopPropagation(); if (moved < 4) { selected = o.pos; showQuick(); } });
    return { o, el, plate, base, w: 0, h: 0 };
  });
  items.forEach((it) => { if (it.plate) { it.w = it.plate.offsetWidth; it.h = it.plate.offsetHeight; } });

  const quick = document.createElement('div'); quick.className = 'quick'; map.appendChild(quick);
  function showQuick() {
    items.forEach((it) => { it.el.classList.toggle('sel', it.o.pos === selected); it.plate?.classList.toggle('sel', it.o.pos === selected); });
    const show = Q.get('quick') || quickOpen;
    stage.classList.toggle('dim', !!(show && selected));
    if (!show || !selected) { quick.style.display = 'none'; return; }
    const o = SYSTEM[selected - 1];
    const isTarget = selected === SELECTED.pos && !isEmpty;
    const acts = isTarget ? [...SELECTED.actions.filter((a) => !a.off), { k: 'object-card', label: 'Карточка объекта' }]
      : o.kind === 'asteroid' ? [{ k: 'gas', label: 'Добыть газ', time: '00:06:30', main: true }, { k: 'recycle', label: 'Собрать обломки', time: '00:06:30' }, { k: 'object-card', label: 'Карточка объекта' }]
      : [{ k: 'espionage', label: 'Шпионаж', time: '00:02:40' }, { k: 'transport', label: 'Транспорт', time: '00:09:12' }, { k: 'object-card', label: 'Карточка объекта' }];
    quick.innerHTML = `${isTarget ? `<div class="q-head"><b>${SELECTED.name}</b><span><i>[${SELECTED.ally.tag}]</i> ${SELECTED.ally.name}</span><span>${RACE[SELECTED.race]} · ${short(SELECTED.points[0].v)} очков · разведка ${SELECTED.spy.ago}</span></div>` : ''}
      ${acts.map((a) => `<div class="q-act ${a.main ? 'main' : ''}"><img src="${ART.action(a.k)}"><div><b>${a.label}</b>${a.time ? `<span>${a.time}</span>` : ''}</div></div>`).join('')}`;
    quick.style.display = 'grid';
  }
  let quickOpen = false;
  map.addEventListener('contextmenu', (e) => { e.preventDefault(); quickOpen = !quickOpen; showQuick(); });
  map.addEventListener('click', () => { if (moved < 4 && quickOpen) { quickOpen = false; showQuick(); } });

  // rotation state
  let rot = Number(Q.get('rot') || 0), vel = 0, auto = false, dragging = false, lastX = 0, moved = 0, target = null;
  map.addEventListener('pointerdown', (e) => { dragging = true; moved = 0; lastX = e.clientX; target = null; map.classList.add('drag'); map.setPointerCapture(e.pointerId); });
  map.addEventListener('pointermove', (e) => { if (!dragging) return; const dx = e.clientX - lastX; lastX = e.clientX; moved += Math.abs(dx); const d = dx * 0.0055 / (+stage.style.getPropertyValue('--k') || 1); rot += d; vel = d; });
  map.addEventListener('pointerup', () => { dragging = false; map.classList.remove('drag'); });
  stage.querySelectorAll('.spin button').forEach((b) => b.addEventListener('click', () => {
    const r = b.dataset.r;
    if (r === 'auto') { auto = !auto; b.classList.toggle('on', auto); return; }
    target = r === '0' ? 0 : rot + Number(r) * Math.PI / 6;
  }));

  const stars = Array.from({ length: 520 }, (_, i) => { const a = Math.random() * 6.283, r = Math.sqrt(Math.random()) * 1250; return { a, r, z: Math.random(), s: Math.random() < 0.06 ? 1.6 : Math.random() * 0.9 + 0.3 }; });
  function drawBg(t) {
    g.clearRect(0, 0, 1920, 1080);
    const sky = g.createRadialGradient(cfg.cx, cfg.cy, 50, cfg.cx, cfg.cy, 1300);
    sky.addColorStop(0, cfg.skyIn || '#0a1424'); sky.addColorStop(1, cfg.skyOut || '#010207');
    g.fillStyle = sky; g.fillRect(0, 0, 1920, 1080);
    for (const s of stars) { // far stars turn a little with the system: depth without a picture behind the planets
      const a = s.a + rot * (0.04 + s.z * 0.06);
      const x = cfg.cx + Math.cos(a) * s.r * 1.5, y = cfg.cy + Math.sin(a) * s.r * 0.8;
      g.globalAlpha = 0.25 + s.z * 0.6; g.fillStyle = '#dfe9ff'; g.fillRect(x, y, s.s, s.s);
    }
    g.globalAlpha = 1;
    cfg.bg && cfg.bg(g, rot, t);
  }

  let last = performance.now();
  function frame(t) {
    const dt = Math.min(50, t - last); last = t;
    if (!dragging) {
      if (target !== null) { rot += (target - rot) * 0.12; if (Math.abs(target - rot) < 0.001) { rot = target; target = null; } }
      else { rot += vel; vel *= 0.93; if (auto) rot += 0.00012 * dt; }
    }
    drawBg(t);
    svg.innerHTML = cfg.orbits(rot);
    const P = items.map((it, i) => cfg.place(i, rot));
    // planets
    items.forEach((it, i) => {
      const p = P[i];
      it.el.style.transform = `translate(${p.x}px, ${p.y}px)`;
      it.el.style.zIndex = Math.round(p.y);
      it.el.querySelector('.body').style.setProperty('--s', p.s);
      it.el.style.setProperty('--lit', p.lit ?? 1);
    });
    sun.style.zIndex = Math.round(cfg.cy);
    // plates
    const boxes = [];
    const bodyBox = (p, it) => { const r = it.base * p.s / 2; return { l: p.x - r, r: p.x + r, t: p.y - r, b: p.y + r }; };
    const bodies = P.map((p, i) => bodyBox(p, items[i]));
    const hit = (a, b) => !(a.r < b.l || a.l > b.r || a.b < b.t || a.t > b.b);
    const order = items.map((it, i) => i).sort((a, b) => P[b].y - P[a].y);
    for (const i of order) {
      const it = items[i]; if (!it.plate) continue;
      const showIt = quick.style.display !== 'none' ? false : (!cfg.quiet || it.o.pos === hovered || it.o.pos === selected);
      it.plate.style.visibility = showIt ? 'visible' : 'hidden';
      if (!showIt) continue;
      const p = P[i], R = it.base * p.s / 2 + 8;
      let x, y, lift = 0;
      if (cfg.labels === 'pin') {
        const lifts = [14, 40, 66, 92, 118, -1];
        for (const L of lifts) {
          x = p.x - it.w / 2;
          if (L < 0) { y = p.y + R; lift = 0; break; } // no room above: plate under the planet
          y = p.y - R - L - it.h; lift = L;
          const box = { l: x, r: x + it.w, t: y, b: y + it.h + L };
          if (y < MAP_TOP + 10 || (x < 1080 && x + it.w > 840 && y < 230)) continue;
          if (!boxes.some((b) => hit(box, b)) && !bodies.some((b, j) => j !== i && hit({ l: x, r: x + it.w, t: y, b: y + it.h }, b))) break;
        }
      } else { // outward from the sun; if that spot is taken, the next free side
        const dx = p.x - cfg.cx, dy = (p.y - cfg.cy) / (cfg.tilt || 1);
        const ang = Math.atan2(dy, dx), sn = Math.sin(ang), cs = Math.cos(ang);
        const C = { below: [p.x - it.w / 2, p.y + R], above: [p.x - it.w / 2, p.y - R - it.h], right: [p.x + R, p.y - it.h / 2], left: [p.x - R - it.w, p.y - it.h / 2] };
        const first = sn > 0.55 ? 'below' : sn < -0.55 ? 'above' : cs > 0 ? 'right' : 'left';
        let best = 1e9;
        for (const k of [first, 'below', 'above', 'right', 'left']) {
          const [cx2, cy2] = C[k]; const box = { l: cx2, r: cx2 + it.w, t: cy2, b: cy2 + it.h };
          let sc = (box.l < 8 || box.r > 1912 || box.t < MAP_TOP || box.b > 1072) ? 50 : 0;
          boxes.forEach((b) => { if (hit(box, b)) sc += 10; }); bodies.forEach((b, j) => { if (j !== i && hit(box, b)) sc += 10; });
          if (sc < best) { best = sc; x = cx2; y = cy2; } if (sc === 0) break;
        }
      }
      x = Math.max(8, Math.min(1912 - it.w, x));
      it.plate.style.transform = `translate(${x}px, ${y}px)`;
      it.plate.style.setProperty('--lift', `${lift}px`);
      it.plate.style.zIndex = cfg.quiet ? 3500 : Math.round(p.y) + 1;
      it.plate.style.opacity = p.fade ?? 1;
      boxes.push({ l: x, r: x + it.w, t: y, b: y + it.h + lift });
    }
    if (quick.style.display !== 'none' && selected) {
      const p = P[selected - 1], R = items[selected - 1].base * p.s / 2;
      const right = p.x + R + 16 + 380 < 1880;
      const qx = right ? p.x + R + 16 : p.x - R - 16 - 380;
      const qy = Math.max(MAP_TOP + 20, Math.min(1080 - quick.offsetHeight - 20, p.y - quick.offsetHeight / 2));
      quick.style.transform = `translate(${qx}px, ${qy}px)`;
    }
    requestAnimationFrame(frame);
  }
  showQuick();
  if (isEmpty) { const n = document.createElement('div'); n.className = 'empty-note'; n.innerHTML = '<b>В системе нет игроков</b><span>Три необитаемые планеты и 21 свободная позиция. Колонизатор займёт любую из них, переработчики можно отправить заранее.</span>'; stage.appendChild(n); }
  requestAnimationFrame(frame);
}
