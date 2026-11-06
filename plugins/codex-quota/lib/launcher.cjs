'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function run(file, args) {
  const result = spawnSync(file, args, { encoding: 'utf8', windowsHide: true, timeout: 15000 });
  if (result.status !== 0) throw new Error((result.stderr || result.error?.message || `Exit ${result.status}`).trim());
  return result.stdout.trim();
}

function plist(contents) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
${contents}
</dict></plist>
`;
}

function xmlString(value) {
  return '<string>' + value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;') + '</string>';
}

function shellQuote(value) {
  return "'" + value.replaceAll("'", "'\\''") + "'";
}

function configureMacLauncher(runtime) {
  const home = os.homedir();
  const id = 'io.github.fangege520.codex-quota.launcher';
  const domain = `gui/${process.getuid()}`;
  const service = `${domain}/${id}`;
  const agent = path.join(home, 'Library', 'LaunchAgents', id + '.plist');
  const app = path.join(home, 'Applications', 'Codex Quota.app');
  const contents = path.join(app, 'Contents');
  const info = path.join(contents, 'Info.plist');
  const hasLauncher = fs.existsSync(app);
  if (hasLauncher && (fs.lstatSync(app).isSymbolicLink() || !fs.existsSync(info) ||
      !fs.readFileSync(info, 'utf8').includes('<key>CFBundleIdentifier</key>' + xmlString(id)))) {
    throw new Error(`Another application already exists at ${app}`);
  }

  const loaded = spawnSync('/bin/launchctl', ['print', service], { stdio: 'ignore', timeout: 5000 });
  if (loaded.error) throw loaded.error;
  if (!runtime) {
    if (loaded.status === 0) run('/bin/launchctl', ['bootout', service]);
    fs.rmSync(agent, { force: true });
    if (hasLauncher) fs.rmSync(app, { recursive: true });
    return;
  }

  const electronApp = path.resolve(runtime.electron, '../../..');
  const launcher = path.join(contents, 'MacOS', 'codex-quota');
  fs.mkdirSync(path.dirname(launcher), { recursive: true });
  fs.writeFileSync(info, plist(`  <key>CFBundleIdentifier</key>${xmlString(id)}
  <key>CFBundleName</key><string>Codex Quota</string>
  <key>CFBundleExecutable</key><string>codex-quota</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>LSUIElement</key><true/>`));
  fs.writeFileSync(launcher, `#!/bin/sh
unset ELECTRON_RUN_AS_NODE
exec /usr/bin/open -g -n -a ${shellQuote(electronApp)} --args ${shellQuote(runtime.app)} --launch-codex
`, { mode: 0o755 });
  fs.mkdirSync(path.dirname(agent), { recursive: true });
  const args = ['/usr/bin/osascript', '-l', 'JavaScript', path.join(runtime.app, 'lib', 'watch-mac-launch.js'), electronApp, runtime.app];
  fs.writeFileSync(agent, plist(`  <key>Label</key>${xmlString(id)}
  <key>ProgramArguments</key>
  <array>
    ${args.map(xmlString).join('\n    ')}
  </array>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Background</string>`));
  run('/usr/bin/plutil', ['-lint', info, agent]);
  if (loaded.status === 0) run('/bin/launchctl', ['bootout', service]);
  run('/bin/launchctl', ['enable', service]);
  run('/bin/launchctl', ['bootstrap', domain, agent]);
  return { shortcuts: [app], startupAgent: agent };
}

function configureLauncher(runtime) {
  if (process.platform === 'darwin') return configureMacLauncher(runtime);
  if (process.platform !== 'win32') throw new Error('Desktop launchers support Windows and macOS.');
  const args = ['-ShortcutName', 'Codex（用量助手）'];
  if (runtime) args.push('-Executable', runtime.electron, '-Runtime', runtime.app);
  else args.push('-Remove');
  return JSON.parse(run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', path.join(__dirname, 'create-windows-launcher.ps1'), ...args]));
}

module.exports = { configureLauncher };
