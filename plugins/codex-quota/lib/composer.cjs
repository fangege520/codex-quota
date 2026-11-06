'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { THREAD_ID, normalizeEffort } = require('./usage.cjs');
const quotaDisplay = require('../desktop/display.js');

const DEFAULT_PORT = 9339;
const ACTION_BINDING = '__codexQuotaActionV2';
function validPort(value) { return Number.isInteger(value) && value >= 1024 && value <= 65535; }
function isWorkspaceTarget(target) {
  if (target?.type !== 'page' || typeof target.url !== 'string') return false;
  if (/avatar|composition|detached-window|pet-overlay/i.test(target.url)) return false;
  try {
    const url = new URL(target.url);
    return url.protocol === 'app:' && ['-', 'app'].includes(url.hostname) || url.protocol === 'file:' && /\/webview\/index\.html$/.test(url.pathname.replaceAll('\\', '/'));
  } catch { return false; }
}
function validSocket(url, port) {
  try { const u = new URL(url); return u.protocol === 'ws:' && u.hostname === '127.0.0.1' && Number(u.port) === port && /^\/devtools\/page\//.test(u.pathname) && !u.username && !u.password; }
  catch { return false; }
}
function listTargets(port) {
  if (!validPort(port)) return Promise.reject(new Error('INVALID_CDP_PORT'));
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: '127.0.0.1', port, path: '/json/list', timeout: 1800 }, res => {
      if (res.statusCode !== 200) { res.resume(); reject(new Error('CDP_UNAVAILABLE')); return; }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { data += chunk; if (data.length > 1024 * 1024) req.destroy(new Error('CDP_RESPONSE_TOO_LARGE')); });
      res.on('error', reject);
      res.on('end', () => { try { const targets = JSON.parse(data); if (!Array.isArray(targets)) throw new Error(); resolve(targets); } catch { reject(new Error('CDP_INVALID_RESPONSE')); } });
    });
    req.on('timeout', () => req.destroy(new Error('CDP_UNAVAILABLE')));
    req.on('error', () => reject(new Error('CDP_UNAVAILABLE')));
  });
}

class CdpConnection extends EventEmitter {
  constructor(url, port) {
    super();
    if (!validSocket(url, port)) throw new Error('INVALID_CDP_SOCKET');
    this.url = url; this.seq = 0; this.pending = new Map(); this.socket = null;
  }
  async open() {
    const socket = new WebSocket(this.url); this.socket = socket;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { socket.close(); reject(new Error('CDP_TIMEOUT')); }, 2500);
      socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('CDP_UNAVAILABLE')); }, { once: true });
    });
    socket.addEventListener('message', event => {
      let message; try { message = JSON.parse(event.data); } catch { return; }
      if (message.method === 'Runtime.bindingCalled') { this.emit('binding', message.params); return; }
      const task = this.pending.get(message.id); if (!task) return;
      clearTimeout(task.timer); this.pending.delete(message.id);
      message.error ? task.reject(new Error('CDP_REQUEST_FAILED')) : task.resolve(message.result);
    });
    socket.addEventListener('close', () => this.rejectAll());
  }
  call(method, params = {}) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error('CDP_DISCONNECTED'));
    return new Promise((resolve, reject) => {
      const id = ++this.seq;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('CDP_TIMEOUT')); }, 2500);
      this.pending.set(id, { resolve, reject, timer });
      try { this.socket.send(JSON.stringify({ id, method, params })); }
      catch { clearTimeout(timer); this.pending.delete(id); reject(new Error('CDP_DISCONNECTED')); }
    });
  }
  rejectAll() { for (const task of this.pending.values()) { clearTimeout(task.timer); task.reject(new Error('CDP_DISCONNECTED')); } this.pending.clear(); }
  close() { this.rejectAll(); this.socket?.close(); this.socket = null; }
}

function displayPayload(state) {
  const pick = value => value && Number.isFinite(value.remaining) ? {
    remaining: Math.max(0, Math.min(100, value.remaining)),
    resetsAt: Number.isFinite(value.resetsAt) ? value.resetsAt : null
  } : null;
  const credits = state.quota?.credits;
  return { short: pick(state.quota?.short), weekly: pick(state.quota?.weekly),
    fetchedAt: Number.isFinite(state.quota?.fetchedAt) ? state.quota.fetchedAt : null,
    error: !!state.error, language: state.settings?.language === 'en' ? 'en' : 'zh', demo: !!state.demo,
    theme: state.settings?.theme === 'light' || state.settings?.theme === 'dark' ? state.settings.theme : 'system',
    display: quotaDisplay.normalize(state.settings?.display),
    resetCount: Number.isSafeInteger(state.quota?.resets?.count) && state.quota.resets.count >= 0 ? state.quota.resets.count : null,
    credits: credits ? { balance: typeof credits.balance === 'string' && /^-?\d+(?:\.\d+)?$/.test(credits.balance) ? credits.balance.slice(0,32) : null, unlimited: credits.unlimited === true } : null };
}

function displayRailPayload(state) {
  const q = state.quota, raw = q?.resets;
  return {
    ...displayPayload(state),
    resets: Number.isSafeInteger(raw?.count) && raw.count >= 0 ? { count: raw.count, cards: (Array.isArray(raw.cards) ? raw.cards : []).slice(0,100).map(card => ({ expiresAt: Number.isFinite(card?.expiresAt) ? card.expiresAt : null })) } : null,
    plan: typeof q?.plan === 'string' ? q.plan.slice(0,32) : null
  };
}

class ComposerBridge extends EventEmitter {
  constructor({ port = DEFAULT_PORT, targetFilter = isWorkspaceTarget, source, threadUsage, turnUsage } = {}) {
    super(); if (!validPort(port)) throw new Error('INVALID_CDP_PORT');
    this.port = port; this.filter = targetFilter;
    this.source = source || '(() => {\n' + ['display.js', 'rail-widget.js', 'composer-widget.js'].map(file => fs.readFileSync(path.join(__dirname, '..', 'desktop', file), 'utf8')).join('\n') + '\n})();';
    this.threadUsage = threadUsage;
    this.turnUsage = turnUsage;
    this.sessions = new Map(); this.enabled = false; this.busy = false; this.timer = null; this.payload = displayPayload({});
    this.status = { phase: 'disabled', targets: 0, visible: 0, reasons: [] };
  }
  update(state) {
    this.payload = displayPayload(state);
    this.railPayload = displayRailPayload(state);
    this.showComposer = state.settings?.composerEnabled !== false;
  }
  preview(state) {
    this.update(state);
    const expression = `window.__codexQuotaComposerV1?.update(${JSON.stringify(this.payload)},${this.showComposer});window.__codexQuotaRailV1?.update(${JSON.stringify(this.railPayload)});`;
    for (const { connection } of this.sessions.values()) {
      connection.call('Runtime.evaluate', { expression, returnByValue: true }).catch(() => {});
    }
  }
  report(status) { this.status = status; this.emit('status', status); }
  start() { if (this.enabled) return; this.enabled = true; this.tick(); }
  waitForConnection(timeout = 20000) {
    // Wait for a fresh probe. The last status may belong to a client that just exited.
    return new Promise(resolve => {
      const finish = connected => {
        clearTimeout(timer);
        this.off('status', onStatus);
        resolve(connected);
      };
      const onStatus = ({ phase }) => {
        if (phase === 'connected' || phase === 'disabled') finish(phase === 'connected');
      };
      const timer = setTimeout(finish, timeout, false);
      this.on('status', onStatus);
    });
  }
  async focus() {
    let connection;
    try {
      const target = (await listTargets(this.port)).find(target => this.filter(target) && validSocket(target.webSocketDebuggerUrl, this.port));
      if (!target) return false;
      connection = new CdpConnection(target.webSocketDebuggerUrl, this.port);
      await connection.open();
      await connection.call('Page.bringToFront');
      return true;
    } catch { return false; } finally { connection?.close(); }
  }
  async detach(id) {
    const session = this.sessions.get(id); if (!session) return;
    this.sessions.delete(id);
    try {
      if (session.scriptId) await session.connection.call('Page.removeScriptToEvaluateOnNewDocument', { identifier: session.scriptId });
      await session.connection.call('Runtime.evaluate', { expression: 'window.__codexQuotaComposerV1?.remove();window.__codexQuotaRailV1?.remove()', returnByValue: true });
      await session.connection.call('Runtime.removeBinding', { name: ACTION_BINDING });
    } catch {} finally { session.connection.close(); }
  }
  async tick() {
    if (!this.enabled || this.busy) return;
    this.busy = true;
    try {
      const targets = (await listTargets(this.port)).filter(this.filter).filter(target => validSocket(target.webSocketDebuggerUrl, this.port));
      if (!this.enabled) return;
      const ids = new Set(targets.map(target => target.id));
      for (const id of this.sessions.keys()) if (!ids.has(id)) await this.detach(id);
      let visible = 0, sidebarVisible = 0; const reasons = [];
      for (const target of targets) {
        if (!this.enabled) break;
        try {
          let session = this.sessions.get(target.id);
          if (!session) {
            const connection = new CdpConnection(target.webSocketDebuggerUrl, this.port);
            session = { connection, scriptId: null }; this.sessions.set(target.id, session);
            await connection.open();
            connection.on('binding', async event => {
              if (!this.enabled || this.sessions.get(target.id) !== session || event?.name !== ACTION_BINDING || typeof event.payload !== 'string') return;
              if (event.payload === 'settings' || event.payload === 'official') {
                if (Date.now() - (this.lastActionAt || 0) < 500) return;
                this.lastActionAt = Date.now(); this.emit(event.payload); return;
              }
              if (event.payload.startsWith('turns:') && this.turnUsage && event.payload.length <= 1500) {
                const ids = [...new Set(event.payload.slice(6).split(','))];
                if (!ids.every(id => THREAD_ID.test(id)) || Date.now() - (session.lastTurnsAt || 0) < 500) return;
                session.lastTurnsAt = Date.now();
                try {
                  const result = await this.turnUsage(ids);
                  if (!this.enabled || this.sessions.get(target.id) !== session) return;
                  const values = Object.fromEntries(ids.map(id => {
                    const turn = result?.[id];
                    const total = turn?.total;
                    return [id, { total: Number.isSafeInteger(total) && total >= 0 ? total : null, effort: normalizeEffort(turn?.effort) }];
                  }));
                  await connection.call('Runtime.evaluate', { expression: 'window.__codexQuotaRailV1?.setTurnUsage(' + JSON.stringify(values) + ')', returnByValue: true });
                } catch {}
                return;
              }
              const id = event.payload.startsWith('thread:') ? event.payload.slice(7) : '';
              if (!THREAD_ID.test(id) || !this.threadUsage || Date.now() - (session.lastThreadAt || 0) < 150) return;
              session.lastThreadAt = Date.now();
              try {
                const result = await this.threadUsage(id);
                if (!this.enabled || this.sessions.get(target.id) !== session) return;
                const usage = result ? { ...Object.fromEntries(['total','input','cached','output','reasoning'].map(k => [k, Number.isSafeInteger(result[k]) && result[k] >= 0 ? result[k] : null])), estimated: result.estimated === true } : null;
                await connection.call('Runtime.evaluate', { expression: 'window.__codexQuotaRailV1?.setThreadUsage(' + JSON.stringify(id) + ',' + JSON.stringify(usage) + ')', returnByValue: true });
              } catch {}
            });
            await connection.call('Runtime.enable');
            await connection.call('Runtime.addBinding', { name: ACTION_BINDING });
            const script = await connection.call('Page.addScriptToEvaluateOnNewDocument', { source: this.source });
            session.scriptId = script.identifier;
            await connection.call('Runtime.evaluate', { expression: this.source, returnByValue: true });
          }
          const result = await session.connection.call('Runtime.evaluate', {
            expression: `${this.source}\n;window.__codexQuotaComposerV1?.update(${JSON.stringify(this.payload)},${this.showComposer !== false});window.__codexQuotaRailV1?.update(${JSON.stringify(this.railPayload || this.payload)});({composer:window.__codexQuotaComposerV1?.status(),rail:window.__codexQuotaRailV1?.status()})`, returnByValue: true
          });
          if (result.exceptionDetails) throw new Error('CDP_WIDGET_FAILED');
          const value = result.result?.value;
          if (value?.composer?.visible) visible++;
          if (value?.rail?.visible) sidebarVisible++;
          if (typeof value?.composer?.reason === 'string') reasons.push(value.composer.reason);
        } catch { await this.detach(target.id); reasons.push('connection-failed'); }
      }
      const phase = this.sessions.size ? 'connected' : targets.length ? 'attach-failed' : 'no-workspace';
      if (this.enabled) this.report({ phase, targets: targets.length, visible, sidebarVisible, reasons });
    } catch {
      for (const id of [...this.sessions.keys()]) await this.detach(id);
      if (this.enabled) this.report({ phase: 'waiting', targets: 0, visible: 0, reasons: ['debug-port-unavailable'] });
    } finally {
      this.busy = false;
      if (this.enabled) this.timer = setTimeout(() => this.tick(), 3000);
    }
  }
  async stop() {
    this.enabled = false; clearTimeout(this.timer);
    // Allow an in-flight tick to finish before removing its registered scripts.
    while (this.busy) await new Promise(resolve => setTimeout(resolve, 25));
    await Promise.all([...this.sessions.keys()].map(id => this.detach(id)));
    this.report({ phase: 'disabled', targets: 0, visible: 0, reasons: [] });
  }
}
module.exports = { DEFAULT_PORT, ACTION_BINDING, validPort, isWorkspaceTarget, validSocket, listTargets, displayPayload, displayRailPayload, CdpConnection, ComposerBridge };
