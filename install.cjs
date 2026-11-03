#!/usr/bin/env node
'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const { discoverCodex } = require('./plugins/codex-quota/lib/codex.cjs');
const [nodeMajor, nodeMinor] = process.versions.node.split('.').map(Number);
if (nodeMajor < 22 || nodeMajor === 22 && nodeMinor < 12) {
  console.error('Node.js 22.12+ is required. Use an existing modern Node runtime, including the Codex bundled runtime.');
  process.exit(1);
}
if (!['win32', 'darwin'].includes(process.platform)) {
  console.error('The desktop overlay currently supports Windows and macOS.'); process.exit(1);
}
const run = (file, args, options = {}) => {
  const env = { ...process.env };
  const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path') || 'PATH';
  env[pathKey] = path.dirname(process.execPath) + path.delimiter + (env[pathKey] || '');
  const result = spawnSync(file, args, { stdio: 'inherit', windowsHide: true, env, ...options });
  if (result.error || result.status !== 0) throw new Error('Installation step failed. ' + (result.error?.message || `Exit ${result.status}`));
  return result;
};
try {
  const codex = discoverCodex();
  run(codex, ['plugin', 'marketplace', 'add', __dirname]);
  const installed = run(codex, ['plugin', 'add', 'codex-quota@codex-quota-marketplace', '--json'], { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' });
  const { installedPath } = JSON.parse(installed.stdout);
  if (typeof installedPath !== 'string' || !path.isAbsolute(installedPath) || !fs.existsSync(path.join(installedPath, 'scripts', 'manage.cjs'))) throw new Error('Codex returned an invalid plugin install location.');
  // All shell arguments are fixed literals. The repository path is only passed as cwd.
  run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ci'], {
    cwd: installedPath, shell: process.platform === 'win32'
  });
  console.log('\nPlugin installed. Restart Codex if it is not listed yet.');
  console.log(`Installed plugin directory: ${installedPath}`);
  run(process.execPath, [path.join(installedPath, 'scripts', 'manage.cjs'), 'check']);
  if (!process.argv.includes('--no-start')) run(process.execPath, [path.join(installedPath, 'scripts', 'manage.cjs'), 'start']);
} catch (error) { console.error(error.message); process.exitCode = 1; }
