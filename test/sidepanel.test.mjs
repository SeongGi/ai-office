import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRows, clipText, createTally, GUIDE_PLACES, liveRoomCounts, observeTools, relTime, ROOM_INFO, toolClass, toolTag } from '../shared/sidepanel.js';

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

test('toolTag joins tool and activity, drops the default text, and cuts to 14 characters', () => {
  assert.equal(toolTag('Grep', 'Using Grep'), 'Grep');
  assert.equal(toolTag('Grep', 'Grep'), 'Grep');
  assert.equal(toolTag('Grep', '로그인 함수 찾는 중'), 'Grep: 로그인 함수 …');
  assert.equal([...toolTag('Bash', 'npm run build now please')].length, 14);
  assert.equal(toolTag('Read', ''), 'Read');
  assert.equal(toolTag(undefined, 'x'), '');
});

test('every guide place has a name and plain text, and the tools match toolClass', () => {
  for (const p of GUIDE_PLACES) assert.ok(ROOM_INFO[p].name && ROOM_INFO[p].plain && ROOM_INFO[p].use && ROOM_INFO[p].tools);
  for (const room of ['library', 'server', 'search']) for (const t of ROOM_INFO[room].tools.split(', ')) assert.equal(toolClass(t), room);
  for (const t of ROOM_INFO.desk.tools.split(', ')) assert.equal(toolClass(t), 'other');
});

test('liveRoomCounts puts a fresh tool cat in its room, others at the desk, and skips subagents', () => {
  const now = 100_000;
  const agents = {
    a: { id: 'a', status: 'working', tool: 'Grep', lastTool: 'Grep', toolAt: now - 1000 },
    b: { id: 'b', status: 'working', tool: 'Edit', lastTool: 'Edit', toolAt: now - 1000 },
    c: { id: 'c', status: 'idle' },
    d: { id: 'd', status: 'working', parent: 'a', tool: 'Bash', lastTool: 'Bash', toolAt: now - 1000 },
  };
  const memo = new Map();
  assert.deepEqual(liveRoomCounts(memo, agents, now), { library: 1, server: 0, search: 0, desk: 1 });
  delete agents.a;
  liveRoomCounts(memo, agents, now);
  assert.equal(memo.has('a'), false);
});
