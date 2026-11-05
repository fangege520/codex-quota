'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

function prepareRuntime(source, base) {
  const manifest = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'));
  if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) throw new Error('INVALID_RUNTIME_VERSION');
  const data = base || (process.platform === 'win32' ? process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming') : path.join(os.homedir(), 'Library', 'Application Support'));
  const target = path.join(data, 'codex-quota', 'runtime', manifest.version);
  const binary = path.join('node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'Electron.app/Contents/MacOS/Electron');
  if (!fs.existsSync(path.join(target, binary)) && !fs.existsSync(path.join(source, binary))) {
    // New Electron packages install their binary lazily on first require.
    try { require(path.join(source, 'node_modules', 'electron')); } catch {}
    if (!fs.existsSync(path.join(source, binary))) throw new Error('Dependencies missing. Run npm ci in the plugin directory first (Node.js 22+).');
  }
  fs.mkdirSync(target, { recursive: true });
  // Codex can replace its plugin cache at startup. Keep both the application
  // files and Electron outside that cache so the companion survives refreshes.
  for (const name of ['desktop', 'lib', 'assets', 'package.json', 'package-lock.json']) {
    fs.cpSync(path.join(source, name), path.join(target, name), { recursive: true, verbatimSymlinks: true });
  }
  if (!fs.existsSync(path.join(target, binary))) fs.cpSync(path.join(source, 'node_modules'), path.join(target, 'node_modules'), { recursive: true, verbatimSymlinks: true });
  return { app: target, electron: require(path.join(target, 'node_modules', 'electron')) };
}
module.exports = { prepareRuntime };
