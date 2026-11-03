#!/usr/bin/env node
'use strict';
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { discoverCodex, CodexClient } = require('../lib/codex.cjs');
const { normalizeQuota } = require('../lib/quota.cjs');
const fs = require('node:fs');
const { runtimeFile } = require('../lib/desktop-app.cjs');

async function main() {
  const action = process.argv[2] || 'start';
  if (action === 'composer-status') {
    try {
      const status = JSON.parse(fs.readFileSync(runtimeFile(), 'utf8'));
      // A killed companion cannot remove its status file. Never report that
      // stale connection as a live widget.
      if (!Number.isInteger(status.pid) || status.composer?.phase !== 'disabled' && Date.now() - status.updatedAt > 15000) throw new Error('STALE_STATUS');
      process.kill(status.pid, 0);
      console.log(JSON.stringify({ ...status, running: true }));
    }
    catch { console.log(JSON.stringify({ running: false, composer: { phase: 'unknown' } })); }
    return;
  }
  if (action === 'check') {
    const client = new CodexClient(discoverCodex());
    try {
      const quota = normalizeQuota(await client.readQuota());
      // No account IDs, emails, tokens, credits, or raw server output.
      console.log(JSON.stringify({ ok: true, plan: quota.plan, short: quota.short, weekly: quota.weekly }, null, 2));
    } finally { client.close(); }
    return;
  }
  if (!['start', 'show', 'hide', 'toggle', 'stop', 'composer-on', 'composer-off', 'system-bar-on', 'system-bar-off', 'snapshot', 'launch-codex'].includes(action)) throw new Error('Usage: node scripts/manage.cjs start|show|hide|toggle|stop|check|composer-on|composer-off|composer-status|system-bar-on|system-bar-off|snapshot|launch-codex');
  const runtime = require('../lib/runtime.cjs').prepareRuntime(path.resolve(__dirname, '..'));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const flags = { start: [], show: ['--show'], hide: ['--hide'], toggle: ['--toggle'], stop: ['--quit'], 'composer-on': ['--composer-on'], 'composer-off': ['--composer-off'], 'system-bar-on': ['--system-bar-on'], 'system-bar-off': ['--system-bar-off'], snapshot: ['--save-previews'], 'launch-codex': ['--launch-codex'] }[action];
  if (process.platform === 'win32') {
    const launch = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(runtime.app, 'lib', 'start-windows-runtime.ps1'), '-Executable', runtime.electron, '-Runtime', runtime.app, '-Action', action], { encoding: 'utf8', windowsHide: true, timeout: 20000, env });
    if (launch.status !== 0) throw new Error(`COMPANION_LAUNCH_FAILED: ${(launch.stderr || launch.error?.message || '').trim().slice(0, 400)}`);
    console.log(`Overlay ${action} requested. Restore with Ctrl/Command+Shift+Q or the tray menu.`);
    return;
  }
  const child = spawn(runtime.electron, [runtime.app, ...flags], {
    detached: true, windowsHide: true, stdio: 'ignore', env
  });
  await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
  child.unref();
  console.log(action === 'stop' ? 'Quit requested.' : action === 'hide' ? 'Hide requested.' : `Overlay ${action} requested. Restore with Ctrl/Command+Shift+Q or the tray menu.`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
