import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyEvent, createState, normalizeEvent, sweep } from '../shared/protocol.js';
import { fromClaude } from '../adapters/claude.mjs';
import { fromCodex } from '../adapters/codex.mjs';
import { fromCursor, cursorResponse } from '../adapters/cursor.mjs';

const run = (state, raw) => applyEvent(state, normalizeEvent(raw));

test('any event creates its agent and team', () => {
  const s = createState();
  run(s, { type: 'status', agent: 'a1', team: 'Checkout', status: 'working', activity: 'Editing' });
  assert.equal(s.agents.a1.team, 'checkout');
  assert.equal(s.teams.checkout.name, 'Checkout');
  assert.equal(s.agents.a1.status, 'working');
});

test('rejects junk', () => {
  assert.equal(normalizeEvent({ type: 'nope', agent: 'x' }), null);
  assert.equal(normalizeEvent({ type: 'status' }), null);
  assert.equal(normalizeEvent('hi'), null);
});

test('message emits an effect and creates unknown recipients in the same team', () => {
  const s = createState();
  run(s, { type: 'join', agent: 'lead', team: 't' });
  const { effects } = run(s, { type: 'message', agent: 'lead', to: 'helper', text: 'hi' });
  assert.ok(effects.some((e) => e.kind === 'message' && e.from === 'lead' && e.to === 'helper'));
  assert.equal(s.agents.helper.team, 't');
});

test('helpers inherit their parent team', () => {
  const s = createState();
  run(s, { type: 'join', agent: 'lead', team: 'auth' });
  run(s, { type: 'join', agent: 'kid', parent: 'lead' });
  assert.equal(s.agents.kid.team, 'auth');
});

test('subagent hints bind to the spawned desk', () => {
  const s = createState();
  for (const ev of fromClaude({ hook_event_name: 'PreToolUse', session_id: 'sess1234', cwd: '/x/shop', tool_name: 'Task', tool_use_id: 'tu_1', tool_input: { subagent_type: 'code-reviewer', description: 'Review diff' } }))
    run(s, ev);
  const ids = Object.keys(s.agents);
  assert.equal(ids.length, 2);
  for (const ev of fromClaude({ hook_event_name: 'PreToolUse', session_id: 'sess1234', cwd: '/x/shop', agent_id: 'ag_9', agent_type: 'code-reviewer', tool_name: 'Read', tool_input: { file_path: '/x/shop/a.ts' } }))
    run(s, ev);
  assert.equal(Object.keys(s.agents).length, 2, 'no extra desk');
  const child = Object.values(s.agents).find((a) => a.parent);
  assert.equal(child.activity, 'a.ts 읽는 중');
  assert.equal(child.boundKey, 'ag_9');
});

test('claude adapter maps the main lifecycle', () => {
  const base = { session_id: 'abcdef123', cwd: '/home/me/storefront' };
  assert.equal(fromClaude({ ...base, hook_event_name: 'SessionStart' })[0].type, 'join');
  const tool = fromClaude({ ...base, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'npm test' } })[0];
  assert.equal(tool.activity, '실행 중: npm test');
  assert.equal(tool.team, 'storefront');
  const todo = fromClaude({ ...base, hook_event_name: 'PreToolUse', tool_name: 'TodoWrite', tool_input: { todos: [{ content: 'Fix cart', activeForm: 'Fixing cart', status: 'in_progress' }] } });
  assert.equal(todo[1].task, 'Fixing cart');
  assert.equal(fromClaude({ ...base, hook_event_name: 'Stop' })[0].status, 'idle');
  assert.deepEqual(fromClaude(null), []);
});

test('codex notify payload', () => {
  const evs = fromCodex({ type: 'agent-turn-complete', 'thread-id': 't-1', cwd: '/a/api', 'input-messages': ['fix it'], 'last-assistant-message': 'Fixed' });
  assert.equal(evs.at(-1).status, 'idle');
  assert.equal(evs[0].team, 'api');
});

test('cursor adapter only answers beforeSubmitPrompt', () => {
  const evs = fromCursor({ hook_event_name: 'afterFileEdit', conversation_id: 'c1', workspace_roots: ['/w/site'], file_path: '/w/site/a.md' });
  assert.equal(evs[0].activity, 'a.md 고쳤어요');
  assert.equal(cursorResponse('afterFileEdit'), '');
  assert.deepEqual(JSON.parse(cursorResponse('beforeSubmitPrompt')), { continue: true });
});

test('sweep removes departed agents and empty teams', () => {
  const s = createState();
  run(s, { type: 'join', agent: 'a', team: 'x', ts: 1000 });
  run(s, { type: 'leave', agent: 'a', ts: 1000 });
  assert.deepEqual(sweep(s, 1000 + 60_000), ['a']);
  assert.equal(Object.keys(s.teams).length, 0);
});

test('model and cwd pass through and persist across later events', () => {
  const s = createState();
  run(s, { type: 'join', agent: 'm1', team: 't', model: 'claude-x', cwd: '/w/p' });
  run(s, { type: 'status', agent: 'm1', status: 'working' });
  assert.equal(s.agents.m1.model, 'claude-x');
  assert.equal(s.agents.m1.cwd, '/w/p');
  const [ev] = fromClaude({ hook_event_name: 'SessionStart', session_id: 'abcdef123456', cwd: '/w/p', model: 'claude-y' });
  assert.equal(ev.model, 'claude-y');
});

test('late non-join events are ignored right after leave, join revives', () => {
  const s = createState();
  const t = 1_000_000;
  applyEvent(s, normalizeEvent({ type: 'join', agent: 'l1', team: 't', ts: t }));
  applyEvent(s, normalizeEvent({ type: 'leave', agent: 'l1', ts: t + 1 }));
  applyEvent(s, normalizeEvent({ type: 'status', agent: 'l1', status: 'working', ts: t + 2000 }));
  assert.equal(s.agents.l1.status, 'offline');
  applyEvent(s, normalizeEvent({ type: 'join', agent: 'l1', team: 't', ts: t + 3000 }));
  assert.equal(s.agents.l1.status, 'idle');
});

test('meeting without an agent starts for everyone and creates no agent or team', () => {
  const s = createState();
  const ev = normalizeEvent({ type: 'meeting', meeting: 'start', text: '시험' }, 1000);
  assert.equal(ev.agent, 'system');
  const { effects } = applyEvent(s, ev);
  assert.deepEqual(s.meeting, { team: '*', topic: '시험', startedAt: 1000, endsAt: 1000 + 10 * 60_000 });
  assert.deepEqual(effects, [{ kind: 'meeting', on: true, topic: '시험' }]);
  assert.deepEqual(s.agents, {});
  assert.deepEqual(s.teams, {});
});

test('meeting by an agent is scoped to its team unless all is set', () => {
  const s = createState();
  run(s, { type: 'join', agent: 'a', team: 'Auth' });
  run(s, { type: 'meeting', agent: 'a', meeting: 'start' });
  assert.equal(s.meeting.team, 'auth');
  assert.equal(s.meeting.by, 'a');
  run(s, { type: 'meeting', agent: 'a', meeting: 'start', all: true });
  assert.equal(s.meeting.team, '*');
});

test('meeting end clears it, expiry is swept, bad meeting events are rejected', () => {
  const s = createState();
  run(s, { type: 'meeting', meeting: 'start', ts: 5000 });
  const { effects } = run(s, { type: 'meeting', meeting: 'end' });
  assert.equal(s.meeting, undefined);
  assert.deepEqual(effects, [{ kind: 'meeting', on: false }]);
  run(s, { type: 'meeting', meeting: 'start', ts: 5000 });
  assert.deepEqual(sweep(s, 5000 + 10 * 60_000 - 1), []);
  assert.ok(s.meeting);
  assert.deepEqual(sweep(s, 5000 + 10 * 60_000), []);
  assert.equal(s.meeting, undefined);
  assert.equal(normalizeEvent({ type: 'meeting' }), null);
});

test('rename: 있는 직원 이름만 바꾸고, 없는 직원은 만들지 않으며, 기록과 상태를 건드리지 않는다', () => {
  const s = createState();
  run(s, { type: 'join', agent: 'a', team: 't', name: '제목' });
  const before = { ...s.agents.a, history: [...s.agents.a.history] };
  const { effects } = run(s, { type: 'rename', agent: 'a', name: '  새   이름 ' });
  assert.equal(s.agents.a.name, '새 이름');
  assert.deepEqual(effects, []);
  assert.deepEqual(s.agents.a.history, before.history);
  assert.equal(s.agents.a.status, before.status);
  assert.equal(s.agents.a.lastSeen, before.lastSeen);
  run(s, { type: 'rename', agent: 'ghost', name: '없는 직원' });
  assert.equal(s.agents.ghost, undefined);
  assert.equal(Object.keys(s.teams).length, 1);
  // 기본 이름 규칙을 거치지 않으므로 Claude로도 바꿀 수 있다. 이후 훅의 Claude는 여전히 덮지 못한다.
  run(s, { type: 'rename', agent: 'a', name: 'Claude' });
  assert.equal(s.agents.a.name, 'Claude');
  run(s, { type: 'rename', agent: 'a', name: 'x'.repeat(60) });
  assert.equal(s.agents.a.name.length, 40);
  assert.equal(normalizeEvent({ type: 'rename', agent: 'a', name: '   ' }), null);
  assert.equal(normalizeEvent({ type: 'rename', agent: 'a' }), null);
});

test('statusSince moves only when the status really changes', () => {
  const s = createState();
  run(s, { type: 'join', agent: 'a', team: 't', ts: 1000 });
  assert.equal(s.agents.a.statusSince, s.agents.a.joinedAt);
  const joined = s.agents.a.statusSince;
  s.agents.a.statusSince = joined - 5000;
  run(s, { type: 'status', agent: 'a', status: 'idle' });
  assert.equal(s.agents.a.statusSince, joined - 5000);
  run(s, { type: 'status', agent: 'a', status: 'working' });
  assert.ok(s.agents.a.statusSince >= joined);
  assert.equal(s.agents.a.status, 'working');
});

test('PostToolUseFailure: becomes an error status naming the tool, and the next tool event clears it', () => {
  const base = { session_id: 'sess1234', cwd: '/x/shop' };
  const [fail] = fromClaude({ ...base, hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', tool_input: { command: 'false' }, error: 'exit 1' });
  assert.equal(fail.type, 'status');
  assert.equal(fail.status, 'error');
  assert.equal(fail.activity, '실패했어요: Bash');
  const [mcp] = fromClaude({ ...base, hook_event_name: 'PostToolUseFailure', tool_name: 'mcp__github__list_prs' });
  assert.equal(mcp.activity, '실패했어요: MCP');
  const sub = fromClaude({ ...base, hook_event_name: 'PostToolUseFailure', tool_name: 'Read', agent_id: 'ag_1', agent_type: 'Explore' })[0];
  assert.deepEqual(sub.subagent, { key: 'ag_1', type: 'Explore' });

  const state = createState();
  for (const raw of [...fromClaude({ ...base, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'false' } }), fail]) applyEvent(state, normalizeEvent(raw, 1000));
  const agent = Object.values(state.agents)[0];
  assert.equal(agent.status, 'error');
  assert.equal(agent.lastTool, 'Bash');
  assert.equal(agent.toolAt, 1000);
  for (const raw of fromClaude({ ...base, hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: '/x/a.ts' } })) applyEvent(state, normalizeEvent(raw, 2000));
  assert.equal(agent.status, 'working');
  for (const raw of fromClaude({ ...base, hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: {} })) applyEvent(state, normalizeEvent(raw, 5000));
  assert.equal(agent.status, 'thinking');
  assert.equal(agent.lastTool, 'Read');
  assert.equal(agent.toolAt, 2000);
  assert.equal(agent.toolEndAt, 5000);
});

test('the hook installer lists PostToolUseFailure with a matcher', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../bin/agent-floor.mjs', import.meta.url), 'utf8');
  assert.match(src, /'PostToolUseFailure'/);
  assert.match(src, /e === 'PostToolUseFailure'/);
});
