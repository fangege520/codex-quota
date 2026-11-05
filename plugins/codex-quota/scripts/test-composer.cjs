'use strict';
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { ComposerBridge, CdpConnection, listTargets } = require('../lib/composer.cjs');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const out = path.resolve(__dirname, '..', 'test-results', 'composer');
fs.mkdirSync(out, { recursive: true });
async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
}
async function until(test, label, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { try { const result = await test(); if (result) return result; } catch {} await pause(150); }
  throw new Error(`Timed out: ${label}`);
}
async function main() {
  const port = await freePort();
  const env = { ...process.env, CODEX_QUOTA_FIXTURE_DIR: out }; delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(require('electron'), [path.join(__dirname, '..', 'tests', 'fixtures', 'composer-app.cjs'), '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${port}`], { env, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  child.stderr.resume();
  const timeout = setTimeout(() => { child.kill(); console.error('Composer integration timed out'); process.exitCode = 1; }, 75000);
  let inspector, bridge;
  const checks = [];
  try {
    const target = await until(async () => (await listTargets(port)).find(t => t.url.includes('codex-quota-fixture.html')), 'fixture launch');
    inspector = new CdpConnection(target.webSocketDebuggerUrl, port); await inspector.open();
    const evaluate = async expression => {
      const result = await inspector.call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error('Fixture evaluation failed: ' + (result.exceptionDetails.exception?.description || result.exceptionDetails.text).slice(0, 800));
      return result.result?.value;
    };
    await until(async () => (await evaluate("document.readyState === 'complete' && !!document.querySelector('#prompt')")) === true, 'fixture DOM readiness');
    const original = await evaluate("document.querySelector('#prompt').textContent");
    bridge = new ComposerBridge({ port, targetFilter: t => t.type === 'page' && t.url.includes('codex-quota-fixture.html'), threadUsage: async id => id.endsWith('0001') ? { total:32100,input:30000,output:2100,cached:12000,reasoning:500 } : null });
    let settingsOpened = 0, officialOpened = 0; bridge.on('settings', () => settingsOpened++); bridge.on('official', () => officialOpened++);
    const state = { demo: true, settings: { language: 'zh' }, quota: { plan:'plus', credits:{balance:'120.5'}, resets:{count:2,cards:[{expiresAt:Date.now()+86400000},{expiresAt:Date.now()+172800000}]}, fetchedAt: Date.now(), short: { remaining: 86, resetsAt: Date.now() + 12000000 }, weekly: { remaining: 26, resetsAt: Date.now() + 170000000 } } };
    bridge.update(state); bridge.start();
    await until(() => bridge.status.visible === 1, 'CDP widget injection');
    assert.equal(bridge.status.targets, 1); checks.push('only the intended workspace target receives the strip');
    const values = await evaluate("[...document.querySelector('#codex-quota-composer-v1').shadowRoot.querySelectorAll('.value')].map(n=>n.textContent)");
    assert.deepEqual(values, ['86%', '26%']); checks.push('real CDP evaluates the owned widget and displays live payload');
    const rail = "document.querySelector('#codex-quota-rail-v1').shadowRoot";
    await until(() => bridge.status.sidebarVisible === 1, 'sidebar quota injection');
    assert.equal(await evaluate(rail+".querySelector('.plan').textContent"), 'Plus');
    assert.equal(await evaluate(rail+".querySelector('.resets b').textContent"), '2');
    assert.equal(await evaluate("(()=>{const r=window.__codexQuotaRailV1.status().bounds,n=document.querySelector('[data-app-navigation-rail]').getBoundingClientRect();return r.x+r.width<=n.right&&r.y+r.height<document.querySelector('#native-profile').getBoundingClientRect().top})()"), true);
    assert.equal(await evaluate("document.querySelector('#codex-quota-composer-v1').shadowRoot.querySelector('.settings')"), null);
    await evaluate("window.__codexQuotaActionV2('arbitrary-command')"); await pause(100);
    assert.equal(settingsOpened, 0);
    await evaluate(rail+".querySelector('.gear').click()");
    await until(() => settingsOpened === 1, 'settings button binding');
    checks.push('left rail avoids native navigation and owns the settings action');
    await evaluate(rail+".querySelector('.resets').dispatchEvent(new PointerEvent('pointerenter'))");
    assert.match(await evaluate(rail+".querySelector('.panel').textContent"), /到期/);
    await pause(550); await evaluate(rail+".querySelector('.official').click()");
    await until(() => officialOpened === 1, 'official reset page action');
    await evaluate("document.querySelector('.demo-thread').dispatchEvent(new PointerEvent('pointerover',{bubbles:true}))");
    await until(async () => (await evaluate(rail+".querySelector('.panel').textContent")).includes('32,100'), 'thread tokens on hover');
    await evaluate("document.querySelector('.demo-thread').dispatchEvent(new PointerEvent('pointerout',{bubbles:true}))");
    await until(async () => (await evaluate(rail+".querySelector('.panel').hidden")) === true, 'thread hover dismissed');
    checks.push('reset expiry list and local thread hover do not change native content');
    const layout = await evaluate("(()=>{const strip=document.querySelector('#codex-quota-composer-v1').getBoundingClientRect(),anchor=document.querySelector('[data-codex-intelligence-trigger]').getBoundingClientRect(),left=document.querySelector('#permissions').getBoundingClientRect();return {left:strip.left,right:strip.right,modelLeft:anchor.left,permissionRight:left.right}})()");
    assert(layout.right < layout.modelLeft); assert(layout.left > layout.permissionRight); checks.push('strip fits in empty space left of model picker without covering controls');
    assert.equal(await evaluate("document.querySelector('#prompt').textContent"), original);
    await evaluate("document.querySelector('#send').click()"); assert.equal(await evaluate('window.sentCount'), 1);
    checks.push('editor content and native send action remain functional');
    // Hidden Windows CI windows may not deliver a compositor frame. The
    // preview is optional; the geometry, interaction and reload checks are not.
    try {
      const screenshot = await inspector.call('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(out, 'composer-preview.png'), Buffer.from(screenshot.data, 'base64'));
    } catch (error) {
      if (error.message !== 'CDP_TIMEOUT') throw error;
      console.warn('Fixture preview frame timed out; continuing functional checks.');
    }
    // A second install and repeated heartbeats must not create duplicate widgets.
    state.quota.short.remaining = 71; state.quota.weekly.remaining = 0; bridge.update(state);
    await until(async () => (await evaluate("document.querySelector('#codex-quota-composer-v1')?.shadowRoot.querySelector('.weekly').textContent")) === '0%', 'quota refresh');
    assert.equal(await evaluate("document.querySelectorAll('#codex-quota-composer-v1').length"), 1);
    checks.push('refresh preserves zero quota and avoids duplicate widgets');
    const previousY = await evaluate('window.__codexQuotaComposerV1.status().bounds.y');
    await evaluate("(()=>{const f=document.querySelector('.footer');const next=f.cloneNode(true);next.style.transform='translateY(8px)';f.replaceWith(next)})()");
    await until(async () => (await evaluate('window.__codexQuotaComposerV1.status().bounds.y')) === previousY + 8, 'footer rerender');
    assert.equal(await evaluate("document.querySelector('#prompt').textContent"), original); checks.push('composer rerender reanchors the strip without editing the prompt');
    state.settings.composerEnabled = false; bridge.update(state);
    await until(() => bridge.status.visible === 0 && bridge.status.sidebarVisible === 1, 'sidebar without composer strip');
    state.settings.composerEnabled = true; bridge.update(state);
    await until(() => bridge.status.visible === 1, 'composer re-enabled');
    checks.push('composer switch never removes the sidebar settings entry');
    await inspector.call('Emulation.setDeviceMetricsOverride', { width: 480, height: 370, deviceScaleFactor: 1, mobile: false });
    await until(async () => (await evaluate('window.__codexQuotaComposerV1.status().reason')) === 'insufficient-space', 'narrow window fallback');
    checks.push('narrow windows hide the strip instead of overlapping native controls');
    await inspector.call('Emulation.clearDeviceMetricsOverride');
    await until(async () => (await evaluate('window.__codexQuotaComposerV1.status().visible')) === true, 'restore width');
    await inspector.call('Page.reload');
    await until(async () => (await evaluate('window.__codexQuotaComposerV1?.status().visible')) === true, 'page reload');
    assert.equal(await evaluate("document.querySelectorAll('#codex-quota-composer-v1').length"), 1); checks.push('page reload restores a single widget');
    await pause(600); // Keep this independent click outside the spam guard.
    assert.equal(await evaluate('typeof window.__codexQuotaActionV2'), 'function');
    await evaluate(rail+".querySelector('.gear').click()");
    await until(() => settingsOpened === 2, 'sidebar settings binding after reload');
    state.error = 'CONNECTION_FAILED'; bridge.update(state);
    await until(async () => (await evaluate("document.querySelector('#codex-quota-composer-v1')?.shadowRoot.querySelector('.strip').classList.contains('stale')")) === true, 'stale flag');
    checks.push('failed quota refresh is visibly marked as cached data');
    await bridge.stop();
    assert.equal(await evaluate("document.querySelector('#codex-quota-composer-v1') === null && !window.__codexQuotaComposerV1"), true);
    assert.equal(await evaluate("document.querySelector('#codex-quota-rail-v1') === null && !window.__codexQuotaRailV1"), true);
    await inspector.call('Page.reload'); await pause(500);
    assert.equal(await evaluate("document.querySelector('#codex-quota-composer-v1') === null && !window.__codexQuotaComposerV1"), true);
    checks.push('disable removes UI, observers and reload registration');
    fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ platform: process.platform, checks }, null, 2));
    console.log(JSON.stringify({ platform: process.platform, checks }, null, 2));
    await evaluate('window.fixture.quit()').catch(() => {});
  } finally {
    await bridge?.stop(); inspector?.close(); clearTimeout(timeout);
    if (child.exitCode == null) child.kill();
  }
}
main().catch(error => { fs.writeFileSync(path.join(out, 'failure.txt'), error.stack); console.error(error.stack); process.exitCode = 1; });
