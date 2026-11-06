'use strict';
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const packaged = process.env.CODEX_QUOTA_SMOKE_EXECUTABLE;
const out = path.resolve(__dirname, '..', 'test-results', packaged ? 'packaged' : '.');
fs.mkdirSync(out, { recursive: true });
const resultPath = path.join(out, 'result.json');
fs.rmSync(resultPath, { force: true });
const env = { ...process.env, CODEX_QUOTA_TEST_DIR: out };
delete env.ELECTRON_RUN_AS_NODE;
const args = packaged ? ['--smoke-test'] : [path.resolve(__dirname, '..'), '--smoke-test'];
const child = spawn(packaged || require('electron'), args, { env, windowsHide: true, stdio: 'inherit' });
const timeout = setTimeout(() => { child.kill(); console.error('Smoke test timed out'); process.exitCode = 1; }, 45000);
child.on('error', error => { clearTimeout(timeout); console.error(error.message); process.exitCode = 1; });
child.on('exit', code => {
  clearTimeout(timeout);
  if (code || !fs.existsSync(resultPath)) { console.error(`Smoke test failed. Inspect ${path.join(out, 'failure.txt')}.`); process.exitCode = 1; return; }
  console.log(fs.readFileSync(resultPath, 'utf8'));
});
