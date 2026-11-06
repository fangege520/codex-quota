'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { UsageIndex } = require('../lib/usage.cjs');
const { normalizeQuota } = require('../lib/quota.cjs');
const { displayRailPayload } = require('../lib/composer.cjs');

test('hourly usage uses deltas, reads appended complete lines, and groups local calendar periods', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'quota-usage-test-'));
  const sessions = path.join(base,'sessions'); fs.mkdirSync(sessions);
  const file = path.join(sessions,'rollout-fixture.jsonl');
  const id = '00000000-0000-4000-8000-000000000001';
  const at = hour => new Date(2026,10,5,hour).toISOString();
  const row = (hour,total) => JSON.stringify({type:'event_msg',timestamp:at(hour),payload:{type:'token_count',info:{total_token_usage:{total_tokens:total,input_tokens:total-20,output_tokens:20}}}});
  const today = new Date(2026,10,5,18);
  const head = JSON.stringify({type:'session_meta',payload:{id,timestamp:at(0)}});
  fs.writeFileSync(file,[head,row(1,100),row(1,100),row(2,150)].join('\n')+'\n');
  try {
    const index = new UsageIndex(base); await index.refresh(+today);
    assert.equal(index.get(id).total,150);
    assert.deepEqual(index.chart(today).today.slice(1,3).map(x=>x.tokens),[100,50]);
    const next = row(3,205);
    fs.appendFileSync(file,next.slice(0,70)); await index.refresh(+today+13000);
    assert.equal(index.get(id).total,150);
    fs.appendFileSync(file,next.slice(70)+'\n'); await index.refresh(+today+26000);
    assert.equal(index.get(id).total,205);
    const charts=index.chart(today);
    assert.equal(charts.today[3].tokens,55);
    assert.equal(charts.week.length,7); assert.equal(charts.month.length,30);
    assert.equal(charts.week.find(x=>x.label==='11/5').tokens,205);
    assert.equal(charts.month.find(x=>x.label==='11/5').tokens,205);
  } finally { fs.unlinkSync(file); fs.rmdirSync(sessions); fs.rmdirSync(base); }
});

test('rail data retains real zero credits and expiration but strips account and reset identifiers', () => {
  const quota = normalizeQuota({accountId:'private',rateLimits:{planType:'go',credits:{balance:'0',unlimited:false},primary:{usedPercent:10,windowDurationMins:43200}},rateLimitResetCredits:{availableCount:1,credits:[{id:'secret',status:'available',expiresAt:1900000000},{id:'used',status:'consumed',expiresAt:1910000000}]}});
  assert.equal(quota.plan,'go'); assert.equal(quota.short,null); assert.equal(quota.weekly,null);
  quota.resets.cards[0].secret='not for renderer';
  const payload=displayRailPayload({quota});
  assert.deepEqual(payload.credits,{balance:'0',unlimited:false});
  assert.deepEqual(payload.resets,{count:1,cards:[{expiresAt:1900000000000}]});
  assert.ok(!JSON.stringify(payload).includes('secret'));
});

test('turn usage pairs recorded effort with scoped or cumulative token counts', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'quota-turn-test-'));
  const sessions = path.join(base, 'sessions'); fs.mkdirSync(sessions);
  const file = path.join(sessions, 'rollout-turns.jsonl');
  const [first, second, third, fourth] = [1, 2, 3, 4].map(i => '00000000-0000-4000-8000-00000000000' + i);
  const event = (type, turn_id) => ({ type: 'event_msg', payload: { type, turn_id } });
  const count = total_tokens => ({ type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { total_tokens } } } });
  const context = (turn_id, effort) => ({ type: 'turn_context', payload: { turn_id, effort } });
  fs.writeFileSync(file, [
    event('task_started', first), context(first, 'none'), count(100), event('task_complete', first),
    event('task_started', second), context(second, 'high'), count(155),
    { type: 'token_usage_record', payload: { turn_id: second, turn_token_usage: { total_tokens: 48 }, thread_token_usage: { total_tokens: 155 } } },
    count(160), context(second, 'unstructured text'), event('task_complete', second),
    event('task_started', third), count(165), count(175), count(175), event('task_complete', third), count(200),
    event('task_started', fourth), context(undefined, 'xhigh'), count(230), event('task_complete', fourth)
  ].map((row, i) => JSON.stringify({ ...row, timestamp: new Date(Date.now() + i).toISOString() })).join('\n') + '\n');
  try {
    const index = new UsageIndex(base); await index.refresh();
    assert.deepEqual(index.getTurns([first, second, third, fourth]), {
      [first]: { total: null, effort: 'none' },
      [second]: { total: 48, effort: 'high' },
      [third]: { total: 15, effort: null },
      [fourth]: { total: 30, effort: 'xhigh' }
    });
  } finally { fs.unlinkSync(file); fs.rmdirSync(sessions); fs.rmdirSync(base); }
});
