const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeQuota, normalizeWindow, clampBounds } = require('../lib/quota.cjs');

test('converts used percentages to remaining and preserves reset times', () => {
  const q = normalizeQuota({ rateLimits: { primary: { usedPercent: 1, windowDurationMins: 300, resetsAt: 1700000000 }, secondary: { usedPercent: 72, windowDurationMins: 10080 } } }, 123);
  assert.equal(q.short.remaining, 99); assert.equal(q.weekly.remaining, 28);
  assert.equal(q.short.resetsAt, 1700000000000); assert.equal(q.fetchedAt, 123);
});
test('prefers the codex bucket and does not average separate model limits', () => {
  const q = normalizeQuota({ rateLimits: { primary: { usedPercent: 100, windowDurationMins: 300 } }, rateLimitsByLimitId: { codex: { primary: { usedPercent: 12, windowDurationMins: 300 } }, other: { primary: { usedPercent: 99, windowDurationMins: 300 } } } });
  assert.equal(q.short.remaining, 88);
});
test('missing or non-finite usage is unavailable rather than full', () => {
  for (const input of [null, undefined, { usedPercent: null }, { usedPercent: NaN }, { usedPercent: Infinity }]) assert.equal(normalizeWindow(input), null);
  assert.throws(() => normalizeQuota({ rateLimits: { primary: { usedPercent: null } } }), /QUOTA_UNAVAILABLE/);
  const q = normalizeQuota({ rateLimits: { secondary: { usedPercent: 100, windowDurationMins: 10080 } } });
  assert.equal(q.short, null); assert.equal(q.weekly.remaining, 0);
});
test('unusual windows are not mislabeled as five hours', () => {
  const q = normalizeQuota({ rateLimits: { primary: { usedPercent: 25, windowDurationMins: 15 } } });
  assert.equal(q.short, null); assert.equal(q.otherWindows[0].remaining, 75);
});
test('percentages clamp, and expired reset time never refills quota locally', () => {
  assert.equal(normalizeWindow({ usedPercent: 150 }).remaining, 0);
  assert.equal(normalizeWindow({ usedPercent: -10 }).remaining, 100);
  const q = normalizeQuota({ rateLimits: { primary: { usedPercent: 100, windowDurationMins: 300, resetsAt: 1 } } }, 9999999);
  assert.equal(q.short.remaining, 0);
});
test('restores negative-coordinate monitors and recovers removed/offscreen displays', () => {
  const displays = [{ x: 0, y: 0, width: 1920, height: 1040 }, { x: -1920, y: 0, width: 1920, height: 1080 }];
  assert.equal(clampBounds({ x: -1000, y: 100 }, displays, 336, 254).x, -1000);
  assert.deepEqual(clampBounds({ x: 1900, y: 900 }, displays, 336, 254), { x: 1564, y: 20, width: 336, height: 254 });
});
