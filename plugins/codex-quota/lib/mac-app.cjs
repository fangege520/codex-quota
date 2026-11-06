'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const childProcess = require('node:child_process');
const macDesktopScript = path.join(__dirname, 'mac-desktop-app.js').replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2');

function executable(file) {
  try {
    fs.accessSync(file, process.platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK);
    return fs.statSync(file).isFile();
  } catch { return false; }
}

function macAppBundle(file) {
  if (typeof file !== 'string' || !path.isAbsolute(file)) return null;
  for (let entry = path.resolve(file); entry !== path.dirname(entry); entry = path.dirname(entry)) {
    if (/\.app$/i.test(entry)) return entry;
  }
  return null;
}

function bundledCodex(bundle) {
  const resources = path.join(bundle, 'Contents', 'Resources');
  return [path.join(resources, 'codex'), path.join(resources, 'bin', 'codex')].find(executable);
}

function isMacCodexApp(bundle) {
  return !!bundle && fs.existsSync(path.join(bundle, 'Contents', 'Resources', 'app.asar')) && !!bundledCodex(bundle);
}

function findMacCodexApp() {
  const result = childProcess.spawnSync('/usr/bin/osascript', ['-l', 'JavaScript', macDesktopScript, 'discover'], { encoding: 'utf8', timeout: 5000 });
  let registered = {};
  if (result.status === 0) {
    try { registered = JSON.parse(result.stdout) || {}; } catch {}
  }
  const standard = ['ChatGPT.app', 'Codex.app'].flatMap(name => [path.join('/Applications', name), path.join(os.homedir(), 'Applications', name)]);
  const running = Array.isArray(registered.running) ? registered.running : [];
  const installed = Array.isArray(registered.installed) ? registered.installed : [];
  return [...running, ...standard, ...installed].map(macAppBundle).find(isMacCodexApp);
}

function macOverrides({ codexPath, desktopAppPath }) {
  const cliBundle = macAppBundle(codexPath);
  const validCliBundle = isMacCodexApp(cliBundle) ? cliBundle : undefined;
  const desktopBundle = macAppBundle(desktopAppPath);
  return {
    codex: validCliBundle || (!cliBundle && codexPath && executable(codexPath) ? codexPath : undefined),
    desktop: isMacCodexApp(desktopBundle) ? desktopBundle : validCliBundle
  };
}

module.exports = { executable, macAppBundle, bundledCodex, isMacCodexApp, findMacCodexApp, macOverrides, macDesktopScript };
