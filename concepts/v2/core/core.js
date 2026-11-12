// SVG helpers for the ring language: a mechanical dial = thick dark band + tick marks + fine edge lines.
const D2R = Math.PI / 180;
const pt = (cx, cy, r, a, sy = 1) => [cx + Math.cos(a * D2R) * r, cy + Math.sin(a * D2R) * r * sy];
function dial(cx, cy, r, { w = 18, ticks = 120, major = 10, sy = 1, tone = 'rgba(150,185,230,', glow = false } = {}) {
  let s = '';
  s += `<ellipse cx="${cx}" cy="${cy}" rx="${r}" ry="${r * sy}" fill="none" stroke="${tone}.07)" stroke-width="${w}"/>`;
  s += `<ellipse cx="${cx}" cy="${cy}" rx="${r - w / 2}" ry="${(r - w / 2) * sy}" fill="none" stroke="${tone}.28)" stroke-width="1"/>`;
  s += `<ellipse cx="${cx}" cy="${cy}" rx="${r + w / 2}" ry="${(r + w / 2) * sy}" fill="none" stroke="${tone}.18)" stroke-width="1"/>`;
  for (let i = 0; i < ticks; i++) { const a = i * 360 / ticks - 90; const m = i % major === 0; const [x1, y1] = pt(cx, cy, r - w / 2 + (m ? 2 : 6), a, sy); const [x2, y2] = pt(cx, cy, r + w / 2 - (m ? 2 : 6), a, sy);
    s += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${tone}${m ? .55 : .22})" stroke-width="${m ? 2 : 1}"/>`; }
  if (glow) s += `<ellipse cx="${cx}" cy="${cy}" rx="${r}" ry="${r * sy}" fill="none" stroke="${tone}.12)" stroke-width="${w * 3}" filter="url(#soft)"/>`;
  return s;
}
function arc(cx, cy, r, a0, a1, color, w = 4, sy = 1) {
  const [x0, y0] = pt(cx, cy, r, a0, sy), [x1, y1] = pt(cx, cy, r, a1, sy); const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
  return `<path d="M${x0} ${y0} A${r} ${r * sy} 0 ${large} 1 ${x1} ${y1}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round"/>`;
}
const DEFS = '<defs><filter id="soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="8"/></filter></defs>';
function el(cls, html, css) { const d = document.createElement('div'); d.className = cls; if (html) d.innerHTML = html; if (css) d.style.cssText = css; document.querySelector('.area').appendChild(d); return d; }
