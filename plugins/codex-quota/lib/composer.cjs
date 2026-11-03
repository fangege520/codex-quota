'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const DEFAULT_PORT = 9339;
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

class CdpConnection {
  constructor(url, port) {
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
  return { short: pick(state.quota?.short), weekly: pick(state.quota?.weekly),
    fetchedAt: Number.isFinite(state.quota?.fetchedAt) ? state.quota.fetchedAt : null,
    error: !!state.error, language: state.settings?.language === 'en' ? 'en' : 'zh', demo: !!state.demo };
}

class ComposerBridge extends EventEmitter {
  constructor({ port = DEFAULT_PORT, targetFilter = isWorkspaceTarget, source } = {}) {
    super(); if (!validPort(port)) throw new Error('INVALID_CDP_PORT');
    this.port = port; this.filter = targetFilter; this.source = source || fs.readFileSync(path.join(__dirname, '..', 'desktop', 'composer-widget.js'), 'utf8');
    this.sessions = new Map(); this.enabled = false; this.busy = false; this.timer = null; this.payload = displayPayload({});
    this.status = { phase: 'disabled', targets: 0, visible: 0, reasons: [] };
  }
  update(state) { this.payload = displayPayload(state); }
  report(status) { this.status = status; this.emit('status', status); }
  start() { if (this.enabled) return; this.enabled = true; this.tick(); }
  async detach(id) {
    const session = this.sessions.get(id); if (!session) return;
    this.sessions.delete(id);
    try {
      if (session.scriptId) await session.connection.call('Page.removeScriptToEvaluateOnNewDocument', { identifier: session.scriptId });
      await session.connection.call('Runtime.evaluate', { expression: 'window.__codexQuotaComposerV1?.remove()', returnByValue: true });
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
      let visible = 0; const reasons = [];
      for (const target of targets) {
        if (!this.enabled) break;
        try {
          let session = this.sessions.get(target.id);
          if (!session) {
            const connection = new CdpConnection(target.webSocketDebuggerUrl, this.port);
            session = { connection, scriptId: null }; this.sessions.set(target.id, session);
            await connection.open();
            const script = await connection.call('Page.addScriptToEvaluateOnNewDocument', { source: this.source });
            session.scriptId = script.identifier;
            await connection.call('Runtime.evaluate', { expression: this.source, returnByValue: true });
          }
          const result = await session.connection.call('Runtime.evaluate', {
            expression: `${this.source}\n;window.__codexQuotaComposerV1?.update(${JSON.stringify(this.payload)});window.__codexQuotaComposerV1?.status()`, returnByValue: true
          });
          if (result.exceptionDetails) throw new Error('CDP_WIDGET_FAILED');
          const value = result.result?.value;
          if (value?.visible) visible++;
          if (typeof value?.reason === 'string') reasons.push(value.reason);
        } catch { await this.detach(target.id); reasons.push('connection-failed'); }
      }
      if (this.enabled) this.report({ phase: targets.length ? 'connected' : 'no-workspace', targets: targets.length, visible, reasons });
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
module.exports = { DEFAULT_PORT, validPort, isWorkspaceTarget, validSocket, listTargets, displayPayload, CdpConnection, ComposerBridge };
