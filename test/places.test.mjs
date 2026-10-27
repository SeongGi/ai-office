import { test } from 'node:test';
import assert from 'node:assert/strict';
import { breakPlace, CELEBRATE_GAP_MS, createCelebrateState, desiredPlace, idleAgeMs, initialPlace, LOUNGE_AFTER_MS, shouldCelebrate } from '../shared/places.js';

const a = (id, status, parent) => ({ id, status, parent });
const world = (...list) => Object.fromEntries(list.map((x) => [x.id, x]));

test('live helper sends the parent to the meeting room, the helper stays at its desk', () => {
  const agents = world(a('p', 'working'), a('h', 'working', 'p'));
  assert.equal(desiredPlace(agents.p, agents, null, 0), 'meeting');
  assert.equal(desiredPlace(agents.h, agents, null, 0), 'desk');
});

test('done or offline helpers do not count', () => {
  const agents = world(a('p', 'working'), a('h', 'done', 'p'), a('g', 'offline', 'p'));
  assert.equal(desiredPlace(agents.p, agents, null, 0), 'desk');
  agents.g.status = 'thinking';
  assert.equal(desiredPlace(agents.p, agents, null, 0), 'meeting');
});

test('idle for a while goes to a break room, not before', () => {
  const agents = world(a('p', 'idle'));
  assert.equal(desiredPlace(agents.p, agents, 1000, 1000 + LOUNGE_AFTER_MS - 1), 'desk');
  assert.equal(desiredPlace(agents.p, agents, 1000, 1000 + LOUNGE_AFTER_MS), breakPlace('p'));
  assert.ok(['lounge', 'games', 'kitchen'].includes(breakPlace('p')));
  assert.equal(desiredPlace(agents.p, agents, null, 999999), 'desk');
});

test('non-idle status never goes to the lounge; done and offline stay put', () => {
  for (const status of ['working', 'thinking', 'waiting', 'error', 'done', 'offline']) {
    const agents = world(a('p', status));
    assert.equal(desiredPlace(agents.p, agents, 0, 10 * LOUNGE_AFTER_MS), 'desk', status);
  }
});

test('meeting wins over lounge', () => {
  const agents = world(a('p', 'idle'), a('h', 'working', 'p'));
  assert.equal(desiredPlace(agents.p, agents, 0, 10 * LOUNGE_AFTER_MS), 'meeting');
});

test('meeting covers: whole floor or one team, done agents too, offline stays at desk', () => {
  const x = { id: 'x', status: 'working', team: 't1' };
  const y = { id: 'y', status: 'done', team: 't2' };
  const z = { id: 'z', status: 'offline', team: 't1' };
  const agents = world(x, y, z);
  const all = { team: '*', startedAt: 0, endsAt: 1 };
  assert.equal(desiredPlace(x, agents, null, 0, all), 'meeting');
  assert.equal(desiredPlace(y, agents, null, 0, all), 'meeting');
  assert.equal(desiredPlace(z, agents, null, 0, all), 'desk');
  const t1 = { team: 't1', startedAt: 0, endsAt: 1 };
  assert.equal(desiredPlace(x, agents, null, 0, t1), 'meeting');
  assert.equal(desiredPlace(y, agents, null, 0, t1), 'desk');
  assert.equal(desiredPlace(x, agents, null, 0, undefined), 'desk');
});

test('first load: idle long enough by server time goes straight to its break room', () => {
  const now = 1_000_000;
  const agents = world({ id: 'p', status: 'idle', statusSince: now - LOUNGE_AFTER_MS - 1 });
  assert.equal(initialPlace(agents.p, agents, now), breakPlace('p'));
  agents.p.statusSince = now - LOUNGE_AFTER_MS + 1;
  assert.equal(initialPlace(agents.p, agents, now), 'desk');
});

test('first load: older saved states without statusSince fall back to lastSeen', () => {
  const now = 1_000_000;
  const agents = world({ id: 'p', status: 'idle', lastSeen: now - 60_000 });
  assert.equal(initialPlace(agents.p, agents, now), breakPlace('p'));
  assert.equal(idleAgeMs(agents.p, now), 60_000);
});

test('first load: meeting, helper and offline follow the same rules', () => {
  const now = 1_000_000;
  const agents = world({ id: 'p', status: 'working', team: 't' }, { id: 'h', status: 'working', parent: 'p', team: 't' }, { id: 'o', status: 'offline', team: 't' });
  assert.equal(initialPlace(agents.p, agents, now), 'meeting');
  assert.equal(initialPlace(agents.h, agents, now), 'desk');
  const all = { team: '*', startedAt: 0, endsAt: 1 };
  assert.equal(initialPlace(agents.h, agents, now, all), 'meeting');
  assert.equal(initialPlace(agents.o, agents, now, all), 'desk');
});

test('idleAgeMs is 0 for a busy agent', () => {
  assert.equal(idleAgeMs({ status: 'working', statusSince: 0 }, 99999), 0);
});

// ---------------------------------------------------------------- tool rooms

import {
  bubbleLines,
  createToolState,
  effectiveStatus,
  failureTool,
  initialToolState,
  stepToolRoom,
  thinkingText,
  toolRoom,
  TOOL_FAIL_SHOW_MS,
  TOOL_FRESH_MS,
  TOOL_LEAVE_MS,
  TOOL_MIN_STAY_MS,
} from '../shared/places.js';

test('toolRoom maps tools to rooms; editing and unknown tools stay at the desk', () => {
  for (const t of ['Read', 'Glob', 'Grep', 'LS', 'NotebookRead']) assert.equal(toolRoom(t), 'library', t);
  for (const t of ['Bash', 'BashOutput', 'KillShell']) assert.equal(toolRoom(t), 'server', t);
  for (const t of ['WebSearch', 'WebFetch', 'MCP', 'mcp__github__list', 'mcp_x']) assert.equal(toolRoom(t), 'search', t);
  for (const t of ['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'TodoWrite', 'Task', '', undefined, null]) assert.equal(toolRoom(t), null, String(t));
});

// A cat that ran `tool` at server time `at`.
// Defaults: a quick call that already ended (a call still running for more than 2.5 s counts as long, see below).
const cat = (over) => ({ id: 'c', status: 'thinking', tool: undefined, lastTool: 'Read', toolAt: 0, toolEndAt: 0, ...over });
const ev = (a, at) => Object.assign(a, { toolAt: at, toolEndAt: at + 200 });

test('anti-flapping: one tool call does not move the cat, a repeat within 6 s does', () => {
  const st = createToolState();
  const a = ev(cat(), 1000);
  assert.equal(stepToolRoom(st, a, 1000), null);
  assert.equal(stepToolRoom(st, a, 4000), null);
  // second Read 5 s after the first
  assert.equal(stepToolRoom(st, ev(a, 6000), 6000), 'library');
});

test('anti-flapping: a repeat after more than 6 s does not count', () => {
  const st = createToolState();
  const a = ev(cat(), 1000);
  stepToolRoom(st, a, 1000);
  assert.equal(stepToolRoom(st, ev(a, 7100), 7100), null);
});

test('anti-flapping: a long tool call earns the trip, a short finished one does not', () => {
  const st = createToolState();
  const a = cat({ lastTool: 'Bash', tool: 'Bash', status: 'working', toolAt: 1000, toolEndAt: undefined });
  assert.equal(stepToolRoom(st, a, 3000), null); // 2.0 s so far
  assert.equal(stepToolRoom(st, a, 3600), 'server'); // 2.6 s and still running
  const st2 = createToolState();
  const b = cat({ lastTool: 'Bash', toolAt: 1000, toolEndAt: 3000 });
  assert.equal(stepToolRoom(st2, b, 3100), null);
  const st3 = createToolState();
  const c = cat({ lastTool: 'Bash', toolAt: 1000, toolEndAt: 4000 });
  assert.equal(stepToolRoom(st3, c, 4100), 'server');
});

function enterLibrary() {
  const st = createToolState();
  const a = ev(cat(), 1000);
  stepToolRoom(st, a, 1000);
  assert.equal(stepToolRoom(st, ev(a, 3000), 3000), 'library');
  return { st, a };
}

test('dwell: stays at least 8 s, returns to the desk once 6 s passed without a matching tool', () => {
  const { st, a } = enterLibrary();
  // 6 s after the last event the candidate expires, but the 8 s minimum stay still holds
  assert.equal(stepToolRoom(st, a, 3000 + TOOL_LEAVE_MS + 100), 'library');
  assert.equal(stepToolRoom(st, a, 3000 + TOOL_MIN_STAY_MS - 1), 'library');
  assert.equal(stepToolRoom(st, a, 3000 + TOOL_MIN_STAY_MS), null);
});

test('dwell: editing in between does not send the cat home early or keep it forever', () => {
  const { st, a } = enterLibrary();
  Object.assign(ev(a, 5000), { lastTool: 'Edit' });
  assert.equal(stepToolRoom(st, a, 5000), 'library');
  assert.equal(stepToolRoom(st, a, 3000 + TOOL_LEAVE_MS + TOOL_MIN_STAY_MS), null);
});

test('dwell: a Read keeps refreshing the stay', () => {
  const { st, a } = enterLibrary();
  for (let t = 5000; t <= 30000; t += 4000) {
    assert.equal(stepToolRoom(st, ev(a, t), t), 'library', String(t));
  }
});

test('dwell: room to room hop only after the minimum stay', () => {
  const { st, a } = enterLibrary();
  Object.assign(ev(a, 4000), { lastTool: 'Bash' });
  assert.equal(stepToolRoom(st, a, 4000), 'library');
  ev(a, 6000); // second Bash within 6 s: qualifies, but the cat has been in the library only 3 s
  assert.equal(stepToolRoom(st, a, 6000), 'library');
  ev(a, 9000);
  assert.equal(stepToolRoom(st, a, 3000 + TOOL_MIN_STAY_MS), 'server');
});

test('idle, done and offline leave the room at once; subagents never go', () => {
  const { st, a } = enterLibrary();
  a.status = 'idle';
  assert.equal(stepToolRoom(st, a, 3500), null);
  const sub = ev(cat({ parent: 'p' }), 1000);
  const s2 = createToolState();
  stepToolRoom(s2, sub, 1000);
  assert.equal(stepToolRoom(s2, ev(sub, 2000), 2000), null);
});

test('a waiting or errored cat outside a room does not walk in', () => {
  const st = createToolState();
  const a = ev(cat(), 1000);
  stepToolRoom(st, a, 1000);
  a.status = 'waiting';
  assert.equal(stepToolRoom(st, ev(a, 2000), 2000), null);
});

test('desiredPlace priority: meeting beats tool room beats lounge; tool room needs an active cat', () => {
  const agents = world(a('p', 'working'));
  assert.equal(desiredPlace(agents.p, agents, null, 0, undefined, 'server'), 'server');
  const all = { team: '*', startedAt: 0, endsAt: 1 };
  assert.equal(desiredPlace(agents.p, agents, null, 0, all, 'server'), 'meeting');
  const withHelper = world(a('p', 'working'), a('h', 'working', 'p'));
  assert.equal(desiredPlace(withHelper.p, withHelper, null, 0, undefined, 'server'), 'meeting');
  const idle = world(a('i', 'idle'));
  assert.equal(desiredPlace(idle.i, idle, 0, 10 * LOUNGE_AFTER_MS, undefined, 'library'), breakPlace('i'));
  const off = world(a('o', 'offline'));
  assert.equal(desiredPlace(off.o, off, null, 0, undefined, 'library'), 'desk');
  const sub = world(a('s', 'working', 'x'));
  assert.equal(desiredPlace(sub.s, sub, null, 0, undefined, 'library'), 'desk');
});

test('first load: a fresh matching tool puts the cat straight into the room, an old one does not', () => {
  const now = 1_000_000;
  const fresh = { id: 'f', status: 'working', tool: 'WebSearch', lastTool: 'WebSearch', toolAt: now - TOOL_FRESH_MS + 1 };
  const agents = world(fresh);
  assert.equal(initialPlace(fresh, agents, now), 'search');
  assert.equal(initialToolState(fresh, now).room, 'search');
  const old = { ...fresh, id: 'o', toolAt: now - TOOL_FRESH_MS };
  assert.equal(initialPlace(old, world(old), now), 'desk');
  const edit = { ...fresh, id: 'e', tool: 'Edit', lastTool: 'Edit' };
  assert.equal(initialPlace(edit, world(edit), now), 'desk');
  const sub = { ...fresh, id: 's', parent: 'f' };
  assert.equal(initialPlace(sub, world(fresh, sub), now), 'desk');
  const thinking = { ...fresh, id: 't', status: 'thinking', tool: undefined };
  assert.equal(initialPlace(thinking, world(thinking), now), 'search');
  const idle = { ...fresh, id: 'i', status: 'idle' };
  assert.equal(initialPlace(idle, world(idle), now), 'desk');
});

test('first load state then steps: the cat stays for the minimum stay, then goes home', () => {
  const now = 1_000_000;
  const f = { id: 'f', status: 'thinking', lastTool: 'Grep', toolAt: now - 7000, toolEndAt: now - 6900 };
  const st = initialToolState(f, now);
  assert.equal(stepToolRoom(st, f, now + 1000), 'library');
  assert.equal(stepToolRoom(st, f, now + TOOL_MIN_STAY_MS), null);
});

test('effectiveStatus: a tool failure turns back to thinking after 4 s, other errors stay', () => {
  const f = { status: 'error', activity: '실패했어요: Bash', lastSeen: 10_000, statusSince: 1 };
  assert.equal(effectiveStatus(f, 10_000 + TOOL_FAIL_SHOW_MS), 'error');
  assert.equal(effectiveStatus(f, 10_000 + TOOL_FAIL_SHOW_MS + 1), 'thinking');
  assert.equal(effectiveStatus({ status: 'error', activity: '오류로 멈췄어요', lastSeen: 0 }, 99_999), 'error');
  assert.equal(failureTool(f), 'Bash');
});

test('thinkingText: 16 characters with an ellipsis, 생각 중 when empty', () => {
  assert.equal(thinkingText(''), '생각 중');
  assert.equal(thinkingText(undefined), '생각 중');
  assert.equal(thinkingText('짧은 말'), '짧은 말');
  assert.equal(thinkingText('가'.repeat(16)), '가'.repeat(16));
  assert.equal(thinkingText('가'.repeat(17)), '가'.repeat(16) + '…');
});

test('bubbleLines: short text stays on one line, long text breaks at a space or after 9 characters', () => {
  assert.deepEqual(bubbleLines('생각 중'), ['생각 중', '']);
  assert.deepEqual(bubbleLines('코드 구조를 살펴보는 중입니다…'), ['코드 구조를 살펴보는', '중입니다…']);
  assert.deepEqual(bubbleLines('가'.repeat(16) + '…'), ['가'.repeat(9), '가'.repeat(7) + '…']);
});

test('celebration: only a busy to idle or done change counts', () => {
  const st = createCelebrateState();
  assert.equal(shouldCelebrate(st, 'idle', 'done', 0), false, 'first status of a cat that loaded with the page');
  assert.equal(shouldCelebrate(st, 'idle', 'working', 0), false);
  assert.equal(shouldCelebrate(st, 'waiting', 'idle', 0), false);
  assert.equal(shouldCelebrate(st, 'error', 'done', 0), false);
  assert.equal(shouldCelebrate(st, 'working', 'thinking', 0), false);
  assert.equal(shouldCelebrate(st, 'working', 'offline', 0), false);
  assert.equal(shouldCelebrate(st, 'working', 'idle', 0), true);
});

test('celebration: at most one per cat in CELEBRATE_GAP_MS, cats are independent', () => {
  const a = createCelebrateState();
  const b = createCelebrateState();
  assert.equal(shouldCelebrate(a, 'thinking', 'done', 5000), true);
  assert.equal(shouldCelebrate(a, 'working', 'idle', 5000 + CELEBRATE_GAP_MS - 1), false);
  assert.equal(shouldCelebrate(b, 'working', 'idle', 5001), true);
  assert.equal(shouldCelebrate(a, 'working', 'idle', 5000 + CELEBRATE_GAP_MS), true);
});
