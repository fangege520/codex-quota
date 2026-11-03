'use strict';

function normalizeWindow(window) {
  if (!window || !Number.isFinite(window.usedPercent)) return null;
  return {
    remaining: Math.min(100, Math.max(0, 100 - window.usedPercent)),
    durationMins: Number.isFinite(window.windowDurationMins) ? window.windowDurationMins : null,
    resetsAt: Number.isFinite(window.resetsAt) ? window.resetsAt * 1000 : null
  };
}

function normalizeQuota(result, now = Date.now()) {
  const buckets = result?.rateLimitsByLimitId;
  // Never merge different metered model buckets into one percentage.
  const bucket = buckets?.codex ?? result?.rateLimits ?? null;
  if (!bucket) throw new Error('QUOTA_UNAVAILABLE');
  const windows = [normalizeWindow(bucket.primary), normalizeWindow(bucket.secondary)].filter(Boolean);
  const short = windows.find(w => w.durationMins === 300) ?? null;
  const weekly = windows.find(w => w.durationMins === 10080) ?? null;
  if (!windows.length) throw new Error('QUOTA_UNAVAILABLE');
  return {
    bucketId: bucket.limitId ?? 'codex',
    plan: typeof bucket.planType === 'string' ? bucket.planType : null,
    short,
    weekly,
    // Keep unusual windows separately rather than mislabeling them as 5h/7d.
    otherWindows: windows.filter(w => w !== short && w !== weekly),
    fetchedAt: now
  };
}

function clampBounds(saved, displays, width, height) {
  const fits = saved && Number.isFinite(saved.x) && Number.isFinite(saved.y) &&
    displays.some(d => saved.x >= d.x && saved.y >= d.y && saved.x + width <= d.x + d.width && saved.y + height <= d.y + d.height);
  const primary = displays[0];
  return fits ? { x: saved.x, y: saved.y, width, height } : {
    x: Math.round(primary.x + primary.width - width - 20),
    y: Math.round(primary.y + 20), width, height
  };
}

module.exports = { normalizeQuota, normalizeWindow, clampBounds };
