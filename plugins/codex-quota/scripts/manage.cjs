#!/usr/bin/env node
'use strict';
const path = require('node:path');
const { spawn } = require('node:child_process');
const { discoverCodex, CodexClient } = require('../lib/codex.cjs');
const { normalizeQuota } = require('../lib/quota.cjs');
const fs = require('node:fs');
const { runtimeFile } = require('../lib/desktop-app.cjs');

async function main() {
  const action = process.argv[2] || 'start';
  if (action === 'composer-status') {
    try { console.log(fs.readFileSync(runtimeFile(), 'utf8')); }
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
  if (!['start', 'show', 'hide', 'toggle', 'stop', 'composer-on', 'composer-off', 'launch-codex'].includes(action)) throw new Error('Usage: node scripts/manage.cjs start|show|hide|toggle|stop|check|composer-on|composer-off|composer-status|launch-codex');
  let electron;
  try { electron = require('electron'); }
  catch { throw new Error('Dependencies missing. Run npm ci in the plugin directory first (Node.js 22+).'); }
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const flags = { start: [], show: [], hide: ['--hide'], toggle: ['--toggle'], stop: ['--quit'], 'composer-on': ['--composer-on'], 'composer-off': ['--composer-off'], 'launch-codex': ['--launch-codex'] }[action];
  const child = spawn(electron, [path.resolve(__dirname, '..'), ...flags], {
    detached: true, windowsHide: true, stdio: 'ignore', env
  });
  await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
  child.unref();
  console.log(action === 'stop' ? 'Quit requested.' : action === 'hide' ? 'Hide requested.' : `Overlay ${action} requested. Restore with Ctrl/Command+Shift+Q or the tray menu.`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
