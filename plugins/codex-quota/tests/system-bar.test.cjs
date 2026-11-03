const { test } = require('node:test');
const assert = require('node:assert/strict');
const { findFreeBounds, popoverBounds } = require('../lib/system-bar.cjs');
test('taskbar strip avoids icons and notification area when icon positions change', () => {
  const bar = { x: 0, y: 760, width: 1280, height: 40 };
  const icons = [{ x: 0, y: 760, width: 336, height: 40 }, { x: 933, y: 760, width: 347, height: 40 }];
  const first = findFreeBounds(bar, icons);
  assert.equal(first.x, 747); assert.equal(first.y, 764);
  const second = findFreeBounds(bar, [...icons, { x: 700, y: 760, width: 100, height: 40 }], 178, 32, first.x);
  assert.ok(second.x + second.width <= 692);
  assert.equal(findFreeBounds(bar, [{ ...bar }]), null);
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
