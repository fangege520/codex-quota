'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const THREAD_ID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const DAY = 86400000;
const counts = { total: 'total_tokens', input: 'input_tokens', cached: 'cached_input_tokens', output: 'output_tokens', reasoning: 'reasoning_output_tokens' };
const hourKey = date => `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}/${date.getHours()}`;
const normalizeEffort = value => typeof value === 'string' && /^[a-z][a-z0-9_-]{0,23}$/.test(value) ? value : null;

function record(index, line, now) {
  // Ignore conversation lines without parsing or retaining their contents.
  if (!/"type"\s*:\s*"(?:session_meta|turn_context|token_count|token_usage_record|task_started|task_complete|turn_aborted)"/.test(line)) return;
  let event; try { event = JSON.parse(line); } catch { return; }
  if (event.type === 'session_meta') {
    const id = event.payload?.id;
    if (typeof id === 'string' && THREAD_ID.test(id)) index.id = id.toLowerCase();
    const started = Date.parse(event.payload?.timestamp || event.timestamp);
    if (Number.isFinite(started)) index.started = started;
    return;
  }
  const payload = event.payload;
  const turnId = typeof payload?.turn_id === 'string' && THREAD_ID.test(payload.turn_id) ? payload.turn_id.toLowerCase() : null;
  if (event.type === 'turn_context') {
    const id = turnId || (payload?.turn_id == null ? index.turn?.id : null);
    const effort = normalizeEffort(payload?.effort);
    if (id && effort) index.turns.set(id, { ...index.turns.get(id), effort });
    return;
  }
  if (event.type === 'token_usage_record') {
    const total = payload?.turn_token_usage?.total_tokens;
    if (turnId && Number.isSafeInteger(total) && total >= 0) index.turns.set(turnId, { ...index.turns.get(turnId), total, direct: true });
    return;
  }
  if (event.type !== 'event_msg') return;
  if (payload?.type === 'task_started') {
    index.turn = turnId ? { id: turnId, baseline: index.last?.total } : null;
    return;
  }
  if (payload?.type === 'task_complete' || payload?.type === 'turn_aborted') {
    if (turnId === index.turn?.id) index.turn = null;
    return;
  }
  if (payload?.type !== 'token_count') return;
  const raw = event.payload.info?.total_token_usage;
  const at = Date.parse(event.timestamp);
  if (!Number.isSafeInteger(raw?.total_tokens) || raw.total_tokens < 0 || !Number.isFinite(at)) return;
  const value = Object.fromEntries(Object.entries(counts).map(([k, name]) => [k, Number.isSafeInteger(raw[name]) && raw[name] >= 0 ? raw[name] : 0]));
  // Snapshot totals are cumulative; repeated events do not add usage. A
  // replayed fork prefix predates its session start and is only a baseline.
  const delta = value.total - (index.last?.total || 0);
  if (delta < 0 || at < (index.lastAt || 0)) return;
  index.last = value; index.lastAt = at;
  const turn = index.turn;
  if (turn?.baseline != null && value.total >= turn.baseline && !index.turns.get(turn.id)?.direct) {
    index.turns.set(turn.id, { ...index.turns.get(turn.id), total: value.total - turn.baseline, direct: false });
  }
  if (at < (index.started || 0)) index.baseline = value;
  if (at >= now - 40 * DAY && at <= now + 60000 && at >= (index.started || 0) && delta > 0) {
    const key = hourKey(new Date(at));
    const previous = index.hours.get(key);
    index.hours.set(key, { at, total: (previous?.total || 0) + delta });
  }
}

async function filesBelow(dir, depth = 0) {
  if (depth > 5) return [];
  const entries = await fs.promises.readdir(dir, { withFileTypes: true }).catch(() => []);
  const files = [];
  for (const entry of entries) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await filesBelow(file, depth + 1));
    else if (entry.isFile() && /^rollout-.*\.jsonl$/i.test(entry.name)) files.push(file);
  }
  return files;
}

class UsageIndex {
  constructor(home = process.env.CODEX_HOME || path.join(os.homedir(), '.codex')) { this.home = home; this.files = new Map(); this.updatedAt = 0; }
  async refresh(now = Date.now()) {
    if (this.pending) return this.pending;
    if (now - this.updatedAt < 12000) return;
    this.pending = this.scan(now);
    try { await this.pending; this.updatedAt = now; } finally { this.pending = null; }
  }
  async scan(now) {
    const roots = await Promise.all(['sessions', 'archived_sessions'].map(dir => filesBelow(path.join(this.home, dir))));
    const files = roots.flat(); const present = new Set(files);
    for (const key of this.files.keys()) if (!present.has(key)) this.files.delete(key);
    for (const file of files) {
      try {
        const stat = await fs.promises.stat(file);
        let row = this.files.get(file);
        if (!row || row.offset > stat.size || row.birth !== stat.birthtimeMs || (row.offset === stat.size && row.mtime !== stat.mtimeMs)) {
          row = { birth: stat.birthtimeMs, offset: 0, partial: '', skip: false, hours: new Map(), turns: new Map() }; this.files.set(file, row);
        }
        for (const [key, value] of row.hours) if (value.at < now - 40 * DAY) row.hours.delete(key);
        if (stat.size === row.offset) { row.mtime = stat.mtimeMs; continue; }
        for await (const chunk of fs.createReadStream(file, { start: row.offset, end: stat.size - 1 })) {
          // Token records are small. Skip large tool-output lines even when
          // split across chunks, and keep only a bounded unfinished tail.
          const parts = chunk.toString('utf8').split('\n');
          for (let i = 0; i < parts.length; i++) {
            if (!row.skip) {
              if (row.partial.length + parts[i].length > 256 * 1024) { row.partial = ''; row.skip = true; }
              else row.partial += parts[i];
            }
            if (i < parts.length - 1) { if (!row.skip) record(row, row.partial, now); row.partial = ''; row.skip = false; }
          }
          row.offset += chunk.length;
        }
        row.mtime = stat.mtimeMs;
      } catch { /* A session can move to the archive during a read. */ }
    }
  }
  threads() {
    const latest = new Map();
    for (const row of this.files.values()) if (row.id && row.last && (!latest.has(row.id) || latest.get(row.id).lastAt < row.lastAt)) latest.set(row.id, row);
    return latest;
  }
  get(id) {
    const row = this.threads().get(id.toLowerCase());
    if (!row) return null;
    return Object.fromEntries(Object.keys(counts).map(key => [key, Math.max(0, row.last[key] - (row.baseline?.[key] || 0))]));
  }
  getTurns(ids) {
    const requested = new Set(ids);
    const matches = new Map();
    for (const row of this.files.values()) {
      for (const id of requested) {
        const value = row.turns.get(id);
        if (!value) continue;
        const match = matches.get(id) || {};
        if (value.total != null && (match.total == null || value.direct)) match.total = value.total;
        if (value.effort) match.effort = value.effort;
        matches.set(id, match);
      }
    }
    return Object.fromEntries([...matches].map(([id, { total = null, effort = null }]) => [id, { total, effort }]));
  }
  chart(now = new Date()) {
    const hours = new Map();
    const threads = this.threads();
    for (const row of threads.values()) for (const [key, v] of row.hours) hours.set(key, (hours.get(key) || 0) + v.total);
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const daily = day => Array.from({ length: 24 }, (_, h) => hours.get(`${day.getFullYear()}-${day.getMonth() + 1}-${day.getDate()}/${h}`) || 0).reduce((a, b) => a + b, 0);
    const date = (month, day) => new Date(now.getFullYear(), month, day);
    return {
      sessions: threads.size,
      today: Array.from({ length: 24 }, (_, h) => ({ label: `${String(h).padStart(2, '0')}:00`, tokens: hours.get(`${start.getFullYear()}-${start.getMonth() + 1}-${start.getDate()}/${h}`) || 0 })),
      week: Array.from({ length: 7 }, (_, i) => date(now.getMonth(), now.getDate() - (now.getDay() + 6) % 7 + i)).map(d => ({ label: `${d.getMonth() + 1}/${d.getDate()}`, tokens: daily(d) })),
      month: Array.from({ length: date(now.getMonth() + 1, 0).getDate() }, (_, i) => ({ label: `${now.getMonth() + 1}/${i + 1}`, tokens: daily(date(now.getMonth(), i + 1)) }))
    };
  }
}
module.exports = { UsageIndex, THREAD_ID, normalizeEffort };
