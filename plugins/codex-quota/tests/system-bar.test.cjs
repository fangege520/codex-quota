const { test } = require('node:test');
const assert = require('node:assert/strict');
const { findFreeBounds, findTaskbarCardBounds, popoverBounds } = require('../lib/system-bar.cjs');
test('taskbar strip avoids icons and notification area when icon positions change', () => {
  const bar = { x: 0, y: 760, width: 1280, height: 40 };
  const icons = [{ x: 0, y: 760, width: 336, height: 40 }, { x: 933, y: 760, width: 347, height: 40 }];
  const first = findFreeBounds(bar, icons);
  assert.equal(first.x, 344); assert.equal(first.y, 764);
  const second = findFreeBounds(bar, [...icons, { x: 700, y: 760, width: 100, height: 40 }], 178, 32, first.x);
  assert.ok(second.x + second.width <= 692);
  assert.equal(findFreeBounds(bar, [{ ...bar }]), null);
});
test('battery, weather and legacy task buttons leave only a narrow safe slot', () => {
  const bar = { x: 0, y: 760, width: 1280, height: 40 };
  const occupied = [
    { x: 0, y: 760, width: 336, height: 40 },
    { x: 356.5, y: 760, width: 343, height: 40 },
    { x: 799, y: 765, width: 62, height: 30 },
    { x: 869.5, y: 760, width: 87.5, height: 40 },
    { x: 965, y: 760, width: 315, height: 40 }
  ];
  assert.equal(findFreeBounds(bar, occupied, 178, 36), null);
  const compact = findFreeBounds(bar, occupied, 80, 36);
  assert.ok(compact); assert.ok(compact.x >= 707.5); assert.ok(compact.x + compact.width <= 791);
  for (const r of occupied) assert.ok(compact.x + compact.width <= r.x || compact.x >= r.x + r.width);
  const moreTrayIcons = occupied.map(r => r.x >= 799 ? { ...r, x: r.x - 32 } : r);
  assert.equal(findFreeBounds(bar, moreTrayIcons, 80, 36), null);
  const tiny = findFreeBounds(bar, moreTrayIcons, 48, 36);
  assert.ok(tiny); assert.ok(tiny.x + tiny.width <= 759);
  const highDpi = [{ ...bar, width: 721 }, { ...bar, x: 769.5, width: 510.5 }];
  assert.equal(findFreeBounds(bar, highDpi, 48, 36), null);
  assert.deepEqual(findFreeBounds(bar, highDpi, 42, 36, undefined, 2), { x: 723, y: 762, width: 42, height: 36 });
  assert.equal(findTaskbarCardBounds(bar, highDpi).width, 42);
  const tight = [highDpi[0], { ...highDpi[1], x: 761 }];
  assert.equal(findTaskbarCardBounds(bar, tight).width, 36);
});
test('unsupported, hidden or cramped taskbars hide instead of covering controls', () => {
  for (const bar of [{ x: 0, y: 0, width: 40, height: 800 }, { x: 0, y: 799, width: 1280, height: 1 }, { x: 0, y: 0, width: 170, height: 40 }]) assert.equal(findFreeBounds(bar, []), null);
});
test('secondary displays with negative coordinates keep the strip within bounds', () => {
  const bar = { x: -1920, y: 1040, width: 1920, height: 40 };
  const result = findFreeBounds(bar, [{ x: -400, y: 1040, width: 400, height: 40 }]);
  assert.ok(result.x >= -1912); assert.ok(result.x + result.width <= -408);
});
test('details open above bottom taskbars and below top menu bars without leaving work area', () => {
  const area = { x: 0, y: 24, width: 1280, height: 736 };
  assert.deepEqual(popoverBounds({ x: 1200, y: 0, width: 80, height: 24 }, area, 380, 324), { x: 900, y: 29, width: 380, height: 324 });
  assert.deepEqual(popoverBounds({ x: 0, y: 760, width: 178, height: 40 }, area, 380, 324), { x: 0, y: 431, width: 380, height: 324 });
});
