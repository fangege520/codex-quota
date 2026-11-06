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
    bridge = new ComposerBridge({
      port, targetFilter: t => t.type === 'page' && t.url.includes('codex-quota-fixture.html'),
      threadUsage: async id => id.endsWith('0001') ? { total:58910193,input:58638547,output:271646,cached:57459968,reasoning:113638 } : null,
      turnUsage: async ids => Object.fromEntries(ids.filter(id => id.endsWith('0002')).map(id => [id, { total: 217360, effort: 'high', model: 'gpt-6.1-sol' }]))
    });
    let settingsOpened = 0, officialOpened = 0; bridge.on('settings', () => settingsOpened++); bridge.on('official', () => officialOpened++);
    const state = { demo: true, settings: { language: 'zh' }, quota: { plan:'plus', credits:{balance:'120.5'}, resets:{count:2,cards:[{expiresAt:Date.now()+86400000},{expiresAt:Date.now()+172800000}]}, fetchedAt: Date.now(), short: { remaining: 86, resetsAt: Date.now() + 12000000 }, weekly: { remaining: 26, resetsAt: Date.now() + 170000000 } } };
    bridge.update(state); bridge.start();
    await until(() => bridge.status.visible === 1, 'CDP widget injection');
    assert.equal(bridge.status.targets, 1); checks.push('only the intended workspace target receives the strip');
    const values = await evaluate("[...document.querySelector('#codex-quota-composer-v1').shadowRoot.querySelectorAll('.value')].map(n=>n.textContent)");
    assert.deepEqual(values, ['86%', '26%']); checks.push('real CDP evaluates the owned widget and displays live payload');
    const composer = "document.querySelector('#codex-quota-composer-v1').shadowRoot";
    assert.equal(await evaluate(composer + ".querySelectorAll('.ring').length"), 2);
    assert.equal(await evaluate(composer + ".querySelector('.resets b').textContent"), '2');
    assert.equal(await evaluate(composer + ".querySelector('.credits b').textContent"), '120');
    const rail = "document.querySelector('#codex-quota-rail-v1').shadowRoot";
    const readRail = () => evaluate(`(() => {
      const root = ${rail}, stack = root.querySelector('.stack');
      return {
        scheme: getComputedStyle(stack).colorScheme,
        surface: getComputedStyle(stack).backgroundColor,
        rings: [...root.querySelectorAll('.limit')].map(button => {
          const fill = button.querySelector('.ring-fill');
          return {
            text: button.querySelector('b').textContent,
            stroke: getComputedStyle(fill).stroke,
            dash: fill.getAttribute('stroke-dasharray'),
            visibility: getComputedStyle(fill).visibility
          };
        })
      };
    })()`);
    await until(() => bridge.status.sidebarVisible === 1, 'sidebar quota injection');
    assert.equal(await evaluate(rail+".querySelector('.plan').textContent"), 'Plus');
    state.quota.plan = 'prolite';
    bridge.preview(state);
    await until(async () => (await evaluate(rail+".querySelector('.plan').textContent")) === 'Pro Lite', 'Pro Lite plan label');
    assert.equal(await evaluate(`(() => {
      const plan = ${rail}.querySelector('.plan'), range = document.createRange();
      range.selectNodeContents(plan);
      const bounds = plan.getBoundingClientRect();
      return [...range.getClientRects()].every(rect => rect.left >= bounds.left && rect.right <= bounds.right);
    })()`), true);
    checks.push('Pro Lite label fits in the sidebar next to settings');
    assert.equal(await evaluate(rail+".querySelector('.resets b').textContent"), '2');
    state.settings.display = { weekly: false, credits: false };
    bridge.preview(state);
    await until(async () => (await evaluate(composer + ".querySelector('.weekly').closest('.window').hidden")) === true, 'hide weekly quota independently');
    assert.equal(await evaluate(composer + ".querySelector('.short').closest('.window').hidden"), false);
    assert.equal(await evaluate(composer + ".querySelector('.credits').hidden"), true);
    await until(async () => (await evaluate(`${rail}.querySelector('.weekly').hidden && ${rail}.querySelector('.credits').hidden`)) === true, 'hide sidebar weekly quota and credits');
    delete state.settings.display; bridge.preview(state);
    await until(async () => (await evaluate(rail + ".querySelector('.weekly').hidden")) === false, 'restore weekly quota');
    assert.match(await evaluate(rail+".querySelector('.short .reset').textContent"), /^\d{2}:\d{2}$/);
    assert.deepEqual(await evaluate("[..."+rail+".querySelectorAll('.weekly .reset span')].map(node=>node.textContent)"), [
      new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit' }).format(state.quota.weekly.resetsAt),
      new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(state.quota.weekly.resetsAt)
    ]);
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
    const turnBadge = rail + ".querySelector('.turn-badge:not([hidden])')";
    await until(async () => (await evaluate(turnBadge + '?.textContent')) === '≈21.7万 Token · gpt-6.1-sol · 推理 高', 'turn usage, model and effort are anchored to the duration row');
    assert.match(await evaluate(turnBadge + '.title'), /217,360 Token\n本轮模型 · gpt-6\.1-sol\n推理强度 · high/);
    assert.equal(await evaluate(`(() => {
      const badge = ${rail}.querySelector('.turn-badge');
      const button = document.querySelector('[data-turn-key] button');
      const gap = badge.getBoundingClientRect().left - button.getBoundingClientRect().right;
      return gap >= 8 && gap < 9;
    })()`), true);
    await evaluate(`(() => {
      const thread = document.querySelector('.demo-thread'), r = thread.getBoundingClientRect();
      const tooltip = document.createElement('div'); tooltip.id = 'native-tooltip'; tooltip.setAttribute('role', 'tooltip');
      tooltip.style.cssText = 'position:fixed;width:280px;height:65px;left:' + (r.right + 4) + 'px;top:' + (r.top - 40) + 'px;';
      document.body.append(tooltip);
      thread.dispatchEvent(new PointerEvent('pointerover', {bubbles:true}));
    })()`);
    await until(async () => (await evaluate(rail+".querySelector('.panel .big')?.textContent")) === '≈5891万', 'thread tokens on hover');
    assert.match(await evaluate(rail+".querySelector('.panel .exact').textContent"), /58,910,193/);
    assert.equal(await evaluate(`(() => {
      const p = ${rail}.querySelector('.panel'), a = p.getBoundingClientRect(), b = document.querySelector('#native-tooltip').getBoundingClientRect();
      return getComputedStyle(p).visibility === 'visible' && (a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
    })()`), true);
    await evaluate("document.querySelector('.demo-thread').dispatchEvent(new PointerEvent('pointerout',{bubbles:true}))");
    await until(async () => (await evaluate(rail+".querySelector('.panel').hidden")) === true, 'thread hover dismissed');
    await evaluate("document.querySelector('#native-tooltip').remove()");
    checks.push('thread hover avoids the native tooltip and the duration row shows its token usage, model and reasoning effort');
    const layout = await evaluate("(()=>{const strip=document.querySelector('#codex-quota-composer-v1').getBoundingClientRect(),anchor=document.querySelector('[data-codex-intelligence-trigger]').getBoundingClientRect(),left=document.querySelector('#permissions').getBoundingClientRect();return {left:strip.left,right:strip.right,modelLeft:anchor.left,permissionRight:left.right}})()");
    assert(layout.right < layout.modelLeft); assert(layout.left > layout.permissionRight); checks.push('strip fits in empty space left of model picker without covering controls');
    assert.equal(await evaluate("document.querySelector('#prompt').textContent"), original);
    await evaluate("document.querySelector('#send').click()"); assert.equal(await evaluate('window.sentCount'), 1);
    checks.push('editor content and native send action remain functional');
    // A hidden CI window may not deliver a compositor frame. Only the previews are optional.
    const preview = async name => {
      try {
        const screenshot = await inspector.call('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(out, name + '.png'), Buffer.from(screenshot.data, 'base64'));
      } catch (error) {
        if (error.message !== 'CDP_TIMEOUT') throw error;
        console.warn('Fixture preview frame timed out; continuing functional checks.');
      }
    };
    await inspector.call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
    await evaluate("document.documentElement.dataset.theme = 'dark'");
    await until(async () => (await readRail()).scheme === 'dark', 'follow Codex dark appearance despite light OS');
    state.quota.short.remaining = 100; state.quota.weekly.remaining = 50; bridge.update(state);
    const dark = await until(async () => { const r = await readRail(); return r.rings[0].text === '100%' && r; }, 'dark status rings');
    assert.equal(dark.surface, 'rgb(37, 38, 41)');
    assert.deepEqual(dark.rings, [
      { text: '100%', stroke: 'rgb(0, 200, 150)', dash: null, visibility: 'visible' },
      { text: '50%', stroke: 'rgb(241, 199, 91)', dash: '50 100', visibility: 'visible' }
    ]);
    await preview('composer-preview-dark');
    state.settings.theme = 'light'; state.quota.short.remaining = 20; state.quota.weekly = null; bridge.update(state);
    const light = await until(async () => { const r = await readRail(); return r.scheme === 'light' && r.rings[0].text === '20%' && r; }, 'explicit light appearance overrides Codex dark');
    assert.equal(light.surface, 'rgb(242, 243, 245)');
    assert.deepEqual(light.rings, [
      { text: '20%', stroke: 'rgb(194, 50, 66)', dash: '20 100', visibility: 'visible' },
      { text: '—', stroke: 'rgb(84, 92, 102)', dash: null, visibility: 'hidden' }
    ]);
    const weeklyTrack = () => evaluate("getComputedStyle("+rail+".querySelector('.weekly .ring-track')).stroke");
    const unknownTrack = await weeklyTrack();
    await preview('composer-preview');
    state.settings.display = { accent: 'blue' };
    bridge.preview(state);
    await until(async () => (await evaluate("getComputedStyle("+rail+".querySelector('.turn-badge')).color")) === 'rgb(36, 84, 198)', 'turn label follows the selected theme');
    delete state.settings.display;
    delete state.settings.theme;
    await evaluate('delete document.documentElement.dataset.theme');
    checks.push('theme controls turn text and healthy quota colors while warning and unavailable colors remain distinct');
    // A second install and repeated heartbeats must not create duplicate widgets.
    state.quota.short.remaining = 71; state.quota.weekly = { remaining: 0, resetsAt: Date.now() + 170000000 }; bridge.update(state);
    await until(async () => (await evaluate("document.querySelector('#codex-quota-composer-v1')?.shadowRoot.querySelector('.weekly').textContent")) === '0%', 'quota refresh');
    assert.deepEqual((await readRail()).rings[1], { text: '0%', stroke: 'rgb(194, 50, 66)', dash: null, visibility: 'hidden' });
    assert.notEqual(await weeklyTrack(), unknownTrack);
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
    const railStatus = 'window.__codexQuotaRailV1.status()';
    for (const [height, mode] of [[245, 'compact'], [150, 'gear-only']]) {
      await inspector.call('Emulation.setDeviceMetricsOverride', { width: 1440, height, deviceScaleFactor: 1, mobile: false });
      await until(async () => (await evaluate(railStatus)).mode === 'stack ' + mode, 'sidebar ' + mode);
      assert.equal(await evaluate(`(() => { const r = ${railStatus}.bounds; return r.y > document.querySelector('#native-home').getBoundingClientRect().bottom && r.y + r.height < document.querySelector('#native-profile').getBoundingClientRect().top; })()`), true);
    }
    await inspector.call('Emulation.clearDeviceMetricsOverride');
    await until(async () => (await evaluate(railStatus)).mode === 'stack full', 'restore full sidebar');
    checks.push('short windows use compact rings or keep only settings without covering navigation');
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
