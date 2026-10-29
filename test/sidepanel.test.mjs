import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRoster, buildRows, clipText, createTally, GUIDE_PLACES, liveRoomCounts, observeTools, relTime, ROOM_INFO, toolClass, toolTag } from '../shared/sidepanel.js';

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

const mk = (id, extra) => ({ id, name: id, role: 'Lead', team: 't1', source: 'claude-code', status: 'idle', history: [], lastSeen: 0, joinedAt: 0, ...extra });

test('buildRoster: 순서, 서브 묶기, 퇴근 제외, moreSubs', () => {
  const agents = {
    idle1: mk('idle1', { team: 't1' }),
    work2: mk('work2', { team: 't2', status: 'working' }),
    work1: mk('work1', { team: 't1', status: 'thinking' }),
    gone: mk('gone', { status: 'offline' }),
    done1: mk('done1', { status: 'done', team: 't2' }),
  };
  for (let i = 0; i < 10; i++) agents[`s${i}`] = mk(`s${i}`, { parent: 'work1', role: 'Explore', name: `s${i}`, status: i === 9 ? 'working' : 'idle', joinedAt: i });
  agents.sGone = mk('sGone', { parent: 'work1', status: 'offline' });
  const state = { agents, teams: { t1: { id: 't1', hue: 10, order: 0 }, t2: { id: 't2', hue: 20, order: 1 } } };
  const r = buildRoster(state, 1000);
  assert.deepEqual(r.map((x) => x.id), ['work1', 'work2', 'idle1', 'done1']);
  assert.equal(r[0].subs.length, 8);
  assert.equal(r[0].moreSubs, 2);
  assert.equal(r[0].subs[0].id, 's9');
  assert.equal(r[0].subs[0].name, 'work1-s9');
  assert.equal(r[0].hue, 10);
  assert.ok(r[0].role && r[0].rel);
  assert.equal(r[1].subs.length, 0);
  assert.equal(r[1].moreSubs, 0);
});

test('직원 목록은 다음 지시를 기다리는 세션에 idleWait 표시를 붙인다', () => {
  const state = { teams: { t1: { id: 't1', name: 't1', order: 0 } }, agents: { a: mk('a', { status: 'waiting', waitKind: 'idle' }), b: mk('b', { status: 'waiting', waitKind: 'permission' }) } };
  const roster = buildRoster(state, 0);
  assert.equal(roster.find((r) => r.id === 'a').idleWait, true);
  assert.equal(roster.find((r) => r.id === 'b').idleWait, false);
});
