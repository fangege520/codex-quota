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
  if (!windows.length && !bucket.credits && !result?.rateLimitResetCredits) throw new Error('QUOTA_UNAVAILABLE');
  const rawCredits = bucket.credits;
  const balance = typeof rawCredits?.balance === 'string' && /^-?\d+(?:\.\d+)?$/.test(rawCredits.balance) ? rawCredits.balance.slice(0, 32) : null;
  const credits = rawCredits ? { balance, unlimited: rawCredits.unlimited === true } : null;
  const rawResets = result.rateLimitResetCredits;
  const plan = [bucket.planType, result.accountPlan].find(value => typeof value === 'string' && value.length);
  const resets = Number.isSafeInteger(rawResets?.availableCount) && rawResets.availableCount >= 0 ? {
    count: rawResets.availableCount,
    cards: (Array.isArray(rawResets.credits) ? rawResets.credits : []).filter(card => card?.status === 'available').slice(0, 100)
      .map(card => ({ expiresAt: Number.isFinite(card.expiresAt) ? card.expiresAt * 1000 : null }))
      .sort((a, b) => (a.expiresAt ?? Infinity) - (b.expiresAt ?? Infinity))
  } : null;
  return {
    bucketId: bucket.limitId ?? 'codex',
    plan: plan?.slice(0, 32) ?? null,
    short,
    weekly,
    credits, resets,
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
