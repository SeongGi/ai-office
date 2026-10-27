import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRows, clipText, createTally, observeTools, relTime, toolClass } from '../shared/sidepanel.js';

test('toolClass maps tools to room classes and other', () => {
  assert.equal(toolClass('Read'), 'library');
  assert.equal(toolClass('Bash'), 'server');
  assert.equal(toolClass('WebFetch'), 'search');
  assert.equal(toolClass('Edit'), 'other');
  assert.equal(toolClass(undefined), 'other');
});

test('observeTools primes on first sight, then counts each new toolAt', () => {
  const t = createTally();
  const ag = { a: { id: 'a', lastTool: 'Read', toolAt: 1 } };
  observeTools(t, ag);
  assert.equal(t.counts.library, 0);
  observeTools(t, ag);
  assert.equal(t.counts.library, 0);
  ag.a.toolAt = 2;
  ag.a.lastTool = 'Bash';
  observeTools(t, ag);
  assert.equal(t.counts.server, 1);
  ag.b = { id: 'b', lastTool: 'Edit', toolAt: 5 };
  observeTools(t, ag);
  assert.equal(t.counts.other, 1);
});

test('relTime', () => {
  assert.equal(relTime(1000, 2000), '방금');
  assert.equal(relTime(0, 30_000), '30초 전');
  assert.equal(relTime(0, 180_000), '3분 전');
  assert.equal(relTime(0, 2 * 3600_000), '2시간 전');
});

test('clipText clips and hides emails and secrets', () => {
  assert.equal(clipText('word '.repeat(20)).length, 40);
  assert.ok(!clipText('mail me at x@y.com now').includes('@'));
  assert.ok(!clipText('key sk-abcdefghijklmnop1234').includes('sk-'));
});

test('buildRows is newest first across agents and limited', () => {
  const state = {
    teams: { t: { hue: 120 } },
    agents: {
      a: { id: 'a', name: 'A', team: 't', history: [{ ts: 1, kind: 'task', text: 'one' }, { ts: 5, kind: 'tool', text: 'five' }] },
      b: { id: 'b', name: 'B', team: 't', history: [{ ts: 3, kind: 'message', text: 'three' }, { ts: 4, kind: 'tool', text: '' }] },
    },
  };
  const rows = buildRows(state, 10_000, 2);
  assert.deepEqual(rows.map((r) => r.text), ['five', 'three']);
  assert.equal(rows[0].agentId, 'a');
  assert.equal(rows[0].hue, 120);
});
