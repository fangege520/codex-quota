'use strict';
const fs = require('node:fs');
const path = require('node:path');

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

module.exports = { executable, macAppBundle, bundledCodex, isMacCodexApp };
