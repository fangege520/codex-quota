'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');

function executable(file) {
  try { fs.accessSync(file, process.platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK); return fs.statSync(file).isFile(); }
  catch { return false; }
}

function discoverCodex(override, env = process.env) {
  const requested = override || env.CODEX_QUOTA_CODEX_BIN;
  if (requested) {
    if (!executable(requested)) throw new Error('CODEX_PATH_INVALID');
    return requested;
  }
  const candidates = [];
  const paths = (env.PATH || env.Path || '').split(path.delimiter).filter(Boolean);
  for (const dir of paths) candidates.push(path.join(dir, process.platform === 'win32' ? 'codex.exe' : 'codex'));
  if (process.platform === 'win32') {
    const base = path.join(env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'OpenAI', 'Codex', 'bin');
    try {
      const versions = fs.readdirSync(base).map(v => ({ file: path.join(base, v, 'codex.exe'), modified: fs.statSync(path.join(base, v)).mtimeMs })).sort((a, b) => b.modified - a.modified);
      candidates.push(...versions.map(v => v.file));
    } catch {}
    // Native binaries inside common npm CLI installations (avoid executing .cmd through a shell).
    const npmRoots = [path.join(env.APPDATA || '', 'npm', 'node_modules'), ...paths.map(d => path.join(d, 'node_modules'))];
    for (const root of npmRoots) for (const arch of ['x86_64', 'aarch64']) {
      candidates.push(path.join(root, '@openai', 'codex', 'vendor', `${arch}-pc-windows-msvc`, 'codex', 'codex.exe'));
      candidates.push(path.join(root, '@openai', `codex-win32-${arch === 'x86_64' ? 'x64' : 'arm64'}`, 'vendor', `${arch}-pc-windows-msvc`, 'codex', 'codex.exe'));
    }
  } else {
    for (const app of ['Codex', 'ChatGPT']) for (const root of ['/Applications', path.join(os.homedir(), 'Applications')]) {
      candidates.push(path.join(root, `${app}.app`, 'Contents', 'Resources', 'codex'));
      candidates.push(path.join(root, `${app}.app`, 'Contents', 'Resources', 'bin', 'codex'));
    }
    candidates.push('/opt/homebrew/bin/codex', '/usr/local/bin/codex', path.join(os.homedir(), '.local', 'bin', 'codex'));
  }
  const found = candidates.find(executable);
  if (!found) throw new Error('CODEX_NOT_FOUND');
  return found;
}

class CodexClient {
  constructor(binary, args = ['app-server']) { this.binary = binary; this.args = args; this.pending = new Map(); this.seq = 0; this.child = null; this.starting = null; }

  async connect() {
    if (this.starting) return this.starting;
    if (this.child) return;
    this.starting = this.start();
    try { await this.starting; } finally { this.starting = null; }
  }

  async start() {
    // Query methods only; never start a thread or inference turn.
    const child = spawn(this.binary, this.args, {
      windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: process.env
    });
    this.child = child;
    child.stderr.resume(); // No credential-bearing server logs are persisted or displayed.
    child.stdin.on('error', () => {});
    createInterface({ input: child.stdout }).on('line', line => {
      let message;
      try { message = JSON.parse(line); } catch { return; }
      const request = this.pending.get(message.id);
      if (!request) return;
      clearTimeout(request.timer); this.pending.delete(message.id);
      // Do not pass raw server errors or account details into the renderer.
      message.error ? request.reject(new Error('CODEX_REQUEST_FAILED')) : request.resolve(message.result);
    });
    const failed = () => {
      if (this.child !== child) return;
      this.child = null;
      for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(new Error('CODEX_DISCONNECTED')); }
      this.pending.clear();
    };
    child.on('error', failed); child.on('exit', failed);
    try {
      await this.rpc('initialize', { clientInfo: { name: 'codex_quota_overlay', title: 'Codex Quota', version: '0.1.0' } });
      this.send({ method: 'initialized' });
    } catch (error) { this.close(); throw error; }
  }

  send(message) {
    if (!this.child || this.child.stdin.destroyed) throw new Error('CODEX_DISCONNECTED');
    this.child.stdin.write(JSON.stringify(message) + '\n');
  }

  rpc(method, params) {
    return new Promise((resolve, reject) => {
      const id = ++this.seq;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('CODEX_TIMEOUT')); this.close(); }, 20000);
      this.pending.set(id, { resolve, reject, timer });
      try { this.send({ id, method, ...(params !== undefined ? { params } : {}) }); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }

  async readQuota() {
    await this.connect();
    const auth = await this.rpc('account/read', { refreshToken: false });
    if (!auth?.account || !['chatgpt', 'chatgptAuthTokens'].includes(auth.account.type)) throw new Error('CHATGPT_LOGIN_REQUIRED');
    return this.rpc('account/rateLimits/read');
  }

  close() {
    const child = this.child; this.child = null;
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(new Error('CODEX_DISCONNECTED')); }
    this.pending.clear();
    if (child) { child.stdin.destroy(); child.kill(); }
  }
}

module.exports = { discoverCodex, CodexClient };
