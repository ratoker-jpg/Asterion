import assert from 'node:assert/strict';
import test from 'node:test';

import { chooseMapTipPlace, type TipRect } from './map-tip-placement.ts';

const MAP: TipRect = { left: 100, top: 100, right: 1100, bottom: 700 };
const TIP = { width: 270, height: 90 };
const rect = (left: number, top: number, width: number, height: number): TipRect => ({ left, top, right: left + width, bottom: top + height });
const boxOf = (place: { left: number; top: number }, size = TIP): TipRect => rect(place.left, place.top, size.width, size.height);
const hits = (a: TipRect, b: TipRect) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

function assertInside(box: TipRect, label: string) {
  assert.ok(box.left >= MAP.left && box.top >= MAP.top && box.right <= MAP.right && box.bottom <= MAP.bottom, `${label}: ${JSON.stringify(box)}`);
}

test('in open space the reason sits right above the planet, centred', () => {
  const place = chooseMapTipPlace(rect(500, 400, 130, 116), TIP, MAP, []);
  assert.deepEqual(place, { left: 430, top: 302 });
});

test('a planet at any edge keeps the reason fully inside the map', () => {
  for (const [label, anchor] of Object.entries({
    left: rect(100, 400, 130, 116),
    right: rect(970, 400, 130, 116),
    top: rect(500, 100, 130, 116),
    bottom: rect(500, 584, 130, 116),
    corner: rect(100, 100, 130, 116),
  })) {
    const box = boxOf(chooseMapTipPlace(anchor, TIP, MAP, []));
    assertInside(box, label);
    assert.equal(hits(box, anchor), false, `${label}: covers its own planet`);
  }
});

test('the left planet under a panel: the reason moves off the panel, not behind it', () => {
  const panel = rect(110, 180, 280, 60);
  const anchor = rect(160, 260, 130, 116);
  const box = boxOf(chooseMapTipPlace(anchor, TIP, MAP, [panel]));
  assertInside(box, 'under the panel');
  assert.equal(hits(box, panel), false);
  assert.equal(hits(box, anchor), false);
});

test('a window too small for a free place still shows the start of the text inside the map', () => {
  const tiny: TipRect = { left: 0, top: 0, right: 200, bottom: 100 };
  const place = chooseMapTipPlace(rect(40, 20, 130, 60), TIP, tiny, [rect(0, 0, 200, 30)]);
  assert.ok(place.left >= 8 && place.top >= 8);
});
