import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../server/index.mjs';
import { sendOrcaPrompt } from '../adapters/orca-send.mjs';
import { fromClaude } from '../adapters/claude.mjs';
import { parseTranscriptTail } from '../adapters/transcript.mjs';
import { applyEvent, createState, normalizeEvent } from '../shared/protocol.js';

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const TERM = 'term_abcdef123456';
const ME = 'me@test.dev';

/** 환경값에 기대지 않도록 제어 관련 옵션을 모두 직접 정한다(기본은 로컬 개발 모드). */
async function withServer(opts, fn) {
  const auditDir = await mkdtemp(join(tmpdir(), 'af-audit-'));
  const auditPath = join(auditDir, 'audit.log');
  const floor = await startServer({
    port: 0,
    log: () => {},
    seed: false,
    token: '',
    admins: '',
    trustProxyEmail: false,
    allowBypassSend: false,
    machinePort: null,
    auditPath,
    ...opts,
  });
  const base = `http://127.0.0.1:${floor.server.address().port}`;
  try {
    await fn(base, floor, auditPath);
  } finally {
    await floor.close();
  }
}

function fakeOrca(terminals, calls = []) {
  const impl = (cmd, args, opts, cb) => {
    calls.push([cmd, ...args]);
    if (args[1] === 'list') cb(null, JSON.stringify({ result: { terminals } }));
    else cb(null, '{}');
  };
  impl.calls = calls;
  return impl;
}

const joinAgent = (base, agent, extra = {}, headers = {}) =>
  fetch(`${base}/events`, {
    method: 'POST',
    headers: { ...JSON_HEADERS, ...headers },
    body: JSON.stringify([{ type: 'join', agent, team: 'T', status: 'idle', terminal: TERM, device: '맥북', ...extra }]),
  });
const postJson = (base, path, body, headers = {}) =>
  fetch(`${base}${path}`, { method: 'POST', headers: { ...JSON_HEADERS, ...headers }, body: JSON.stringify(body) });
const asMe = { 'x-auth-request-email': ME };

test('machine listener: 길 셋만 답하고 Bearer 토큰이 필수다', async () => {
  await withServer({ token: 'tt', machinePort: 0 }, async (base, floor) => {
    const m = `http://127.0.0.1:${floor.machineServer.address().port}`;
    const auth = { Authorization: 'Bearer tt' };
    for (const [method, path] of [['GET', '/state'], ['GET', '/stream'], ['GET', '/'], ['POST', '/send'], ['POST', '/close'], ['GET', '/whoami'], ['POST', '/reset'], ['GET', '/events']]) {
      const res = await fetch(`${m}${path}`, { method, headers: { ...JSON_HEADERS, ...auth }, body: method === 'POST' ? '{}' : undefined });
      assert.equal(res.status, 404, `${method} ${path}`);
    }
    assert.equal((await postJson(m, '/events', [{ type: 'join', agent: 'a' }])).status, 401, '토큰 없음');
    assert.equal((await postJson(m, '/events', [{ type: 'join', agent: 'a' }], { Authorization: 'Bearer no' })).status, 401);
    assert.equal((await fetch(`${m}/events`, { method: 'POST', headers: { Cookie: 'af_token=tt', ...JSON_HEADERS }, body: '[]' })).status, 401, '쿠키는 안 된다');
    assert.equal((await fetch(`${m}/close-queue?device=x`)).status, 401);
    assert.equal((await postJson(m, '/events', [{ type: 'join', agent: 'a', team: 'T' }], auth)).status, 202);
    assert.equal((await fetch(`${m}/close-queue?device=x`, { headers: auth })).status, 200);
    const health = await fetch(`${m}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { ok: true }, '기계용 /health는 아무것도 새지 않는다');
    assert.equal((await fetch(`${m}/?token=tt`, { redirect: 'manual' })).status, 404, '로그인 화면도 쿠키 발급도 없다');
    assert.equal(floor.state.agents.a.id, 'a', '기계용 포트로 올린 이벤트가 화면에 들어간다');
  });
  await assert.rejects(startServer({ port: 0, machinePort: 0, token: '', log: () => {}, seed: false }), /AGENT_FLOOR_TOKEN/);
});

test('control: whoami와 닫기, 보내기 권한 표', async () => {
  const orca = fakeOrca([{ handle: TERM, agentIdentity: 'claude' }]);
  const cases = [
    // [이름, 서버 옵션, 헤더, 기대 control, 기대 email]
    ['관리자 + 신뢰', { admins: `${ME},other@test.dev`, trustProxyEmail: true }, asMe, true, ME],
    ['대소문자 무시', { admins: ME, trustProxyEmail: true }, { 'x-auth-request-email': 'ME@Test.DEV' }, true, ME],
    ['x-forwarded-email도 받는다', { admins: ME, trustProxyEmail: true }, { 'x-forwarded-email': ME }, true, ME],
    ['목록에 없는 이메일', { admins: ME, trustProxyEmail: true }, { 'x-auth-request-email': 'eve@test.dev' }, false, 'eve@test.dev'],
    ['헤더 없음', { admins: ME, trustProxyEmail: true }, {}, false, undefined],
    ['신뢰를 안 켜면 위조 헤더는 무시', { admins: ME, trustProxyEmail: false }, asMe, false, undefined],
    ['로컬 개발 모드(루프백, 설정 없음)', {}, {}, true, undefined],
    ['로컬 모드에서 신뢰만 켜면 이메일이 필요하다', { trustProxyEmail: true }, {}, false, undefined],
  ];
  for (const [name, opts, headers, control, email] of cases) {
    await withServer({ device: '서버기기', execFileImpl: orca, ...opts }, async (base) => {
      const who = await (await fetch(`${base}/whoami`, { headers })).json();
      assert.equal(who.control, control, name);
      assert.equal(who.email, email, name);
      await joinAgent(base, 'lap');
      const send = await postJson(base, '/send', { agent: 'lap', text: 'hi' }, headers);
      const close = await postJson(base, '/close', { agent: 'lap' }, headers);
      assert.equal(send.status, control ? 200 : 403, `${name}: send`);
      assert.equal(close.status, control ? 200 : 403, `${name}: close`);
      if (!control) assert.ok((await send.json()).error, `${name}: 403 본문에 error`);
    });
  }
  // 호스트가 루프백이 아니면(설정 없이 밖으로 열린 모드) 제어 권한이 없다.
  await withServer({ host: '0.0.0.0', token: 'tt' }, async (base) => {
    const who = await (await fetch(`${base}/whoami`, { headers: { Authorization: 'Bearer tt' } })).json();
    assert.equal(who.control, false);
  });
});

test('proxy gate: 프록시 신뢰와 관리자 목록이 있으면 메인 포트가 토큰을 묻지 않는다', async () => {
  await withServer({ host: '0.0.0.0', token: 'tt', admins: ME, trustProxyEmail: true }, async (base) => {
    assert.equal((await fetch(`${base}/state`)).status, 200);
  });
  // 신뢰만 있고 관리자가 없으면 토큰을 계속 요구한다.
  await withServer({ host: '0.0.0.0', token: 'tt', trustProxyEmail: true }, async (base) => {
    assert.equal((await fetch(`${base}/state`)).status, 401);
  });
});

test('send: 가드(일하는 중, 서브에이전트, 터미널 없음, 권한 우회, 글자 수)', async () => {
  const orca = fakeOrca([{ handle: TERM, agentIdentity: 'claude' }]);
  const admin = { admins: ME, trustProxyEmail: true, device: '서버기기', execFileImpl: orca };
  const send = (base, agent, text) => postJson(base, '/send', { agent, text }, asMe);
  await withServer(admin, async (base) => {
    await joinAgent(base, 'busy', { status: 'working' });
    await joinAgent(base, 'wait', { status: 'waiting' });
    await joinAgent(base, 'lead');
    await joinAgent(base, 'child', { parent: 'lead' });
    await joinAgent(base, 'noterm', { terminal: undefined });
    await joinAgent(base, 'bypass', { permission: 'bypassPermissions', device: '서버기기' });

    assert.match((await (await send(base, 'busy', 'hi')).json()).reason, /일하는 중/);
    assert.match((await (await send(base, 'wait', 'hi')).json()).reason, /일하는 중/);
    assert.match((await (await send(base, 'child', 'hi')).json()).reason, /서브에이전트/);
    assert.match((await (await send(base, 'noterm', 'hi')).json()).reason, /연결 전이에요/);
    assert.match((await (await send(base, 'ghost', 'hi')).json()).reason, /찾지 못했어요/);
    const blocked = await (await send(base, 'bypass', 'hi')).json();
    assert.deepEqual(blocked, { sent: false, reason: '권한 확인 없이 도는 세션이라 막았어요' });
    assert.equal(orca.calls.length, 0, '거절된 요청은 orca를 부르지 않는다');
  });
  // 시도는 모두 속도 제한에 걸리므로(1분 6번) 글자 수 검사는 새 서버에서 한다.
  await withServer(admin, async (base) => {
    await joinAgent(base, 'lead');
    const empty = await send(base, 'lead', '   ');
    assert.equal(empty.status, 400);
    assert.equal((await empty.json()).sent, false);
    assert.equal((await send(base, 'lead', 'x'.repeat(2001))).status, 400);
    assert.equal((await send(base, 'lead', 'x'.repeat(2000))).status, 200, '2000자는 통과');
    assert.equal(orca.calls.length, 0, '다른 기기(맥북) 세션이라 큐로 갔다');
  });
  await withServer({ ...admin, allowBypassSend: true, execFileImpl: fakeOrca([{ handle: TERM, agentIdentity: 'claude' }], orca.calls) }, async (base) => {
    await joinAgent(base, 'bypass', { permission: 'bypassPermissions', device: '서버기기' });
    assert.deepEqual(await (await send(base, 'bypass', '  hi  ')).json(), { sent: true });
    assert.deepEqual(orca.calls[1], ['orca', 'terminal', 'send', '--terminal', TERM, '--text', 'hi', '--enter'], '글은 다듬어서 배열 인자로 간다');
  });
});

test('send: 같은 기기는 바로 보내고, 다른 기기는 prompt 항목으로 큐에 가며 60초 뒤 사라진다', async () => {
  const orca = fakeOrca([{ handle: TERM, agentIdentity: 'claude' }]);
  await withServer({ admins: ME, trustProxyEmail: true, device: '서버기기', execFileImpl: orca }, async (base) => {
    await joinAgent(base, 'own', { device: '서버기기' });
    await joinAgent(base, 'lap');
    await joinAgent(base, 'old');
    const send = async (agent, text) => (await postJson(base, '/send', { agent, text }, asMe)).json();
    assert.deepEqual(await send('own', '바로'), { sent: true });
    assert.equal(orca.calls.length, 2);
    assert.deepEqual(await send('lap', '첫째'), { sent: 'queued' });
    assert.deepEqual(await send('lap', '둘째'), { sent: 'queued' });
    await postJson(base, '/close', { agent: 'lap' }, asMe);
    assert.equal(orca.calls.length, 2, '큐 경로는 orca를 부르지 않는다');

    assert.deepEqual((await (await fetch(`${base}/close-queue?device=${encodeURIComponent('서버기기')}`)).json()).items, []);
    const { items } = await (await fetch(`${base}/close-queue?device=${encodeURIComponent('맥북')}`)).json();
    assert.deepEqual(items.map((i) => [i.kind, i.text]), [['prompt', '첫째'], ['prompt', '둘째'], ['close', undefined]]);
    assert.equal(items[0].agent, 'lap');
    assert.equal(items[0].terminal, TERM);
    assert.equal(items[0].device, '맥북');
    assert.ok(Number.isFinite(items[0].ts));

    const realNow = Date.now;
    try {
      await send('old', '곧 사라져요');
      Date.now = () => realNow() + 61_000;
      const late = await (await fetch(`${base}/close-queue?device=${encodeURIComponent('맥북')}`)).json();
      assert.deepEqual(late.items, []);
    } finally {
      Date.now = realNow;
    }
  });
});

test('send: 같은 이메일은 1분에 6번까지, 일곱 번째는 429', async () => {
  await withServer({ admins: ME, trustProxyEmail: true, device: '서버기기' }, async (base) => {
    await joinAgent(base, 'lap');
    const codes = [];
    for (let i = 0; i < 7; i++) codes.push((await postJson(base, '/send', { agent: 'lap', text: `n${i}` }, asMe)).status);
    assert.deepEqual(codes, [200, 200, 200, 200, 200, 200, 429]);
  });
});

test('audit: 보내기와 닫기 시도가 한 줄씩 남고, 쓰지 못해도 요청은 산다', async () => {
  await withServer({ admins: ME, trustProxyEmail: true, device: '서버기기' }, async (base, floor, auditPath) => {
    await joinAgent(base, 'lap', { name: '맥북 직원' });
    await postJson(base, '/send', { agent: 'lap', text: 'z'.repeat(900) }, asMe);
    await postJson(base, '/send', { agent: 'lap', text: '몰래' }, { 'x-auth-request-email': 'eve@test.dev' });
    await postJson(base, '/close', { agent: 'lap' }, asMe);
    const lines = (await readFile(auditPath, 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(lines.length, 3);
    assert.equal(lines[0].email, ME);
    assert.equal(lines[0].agent, 'lap');
    assert.equal(lines[0].name, '맥북 직원');
    assert.equal(lines[0].device, '맥북');
    assert.equal(lines[0].kind, 'prompt');
    assert.equal(lines[0].result, 'queued');
    assert.equal(lines[0].text.length, 500, '글은 500자까지');
    assert.ok(Date.parse(lines[0].ts) > 0);
    assert.deepEqual([lines[1].email, lines[1].result], ['eve@test.dev', 'denied']);
    assert.deepEqual([lines[2].kind, lines[2].result], ['close', 'queued']);
    assert.equal(lines[2].text, undefined);
  });
  const dir = await mkdtemp(join(tmpdir(), 'af-audit-'));
  const plainFile = join(dir, 'file');
  await writeFile(plainFile, 'x');
  await withServer({ admins: ME, trustProxyEmail: true, device: '서버기기', auditPath: join(plainFile, 'sub', 'audit.log') }, async (base) => {
    await joinAgent(base, 'lap');
    const res = await postJson(base, '/send', { agent: 'lap', text: 'hi' }, asMe);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { sent: 'queued' });
  });
});

test('transcript: 끝부분에서 마지막 질문, 답, 권한 모드를 뽑는다', () => {
  const line = (o) => JSON.stringify(o);
  const tail = [
    '{"type":"assistant","message":{"content":[{"type":"te', // 잘린 첫 줄
    line({ type: 'permission-mode', permissionMode: 'plan', sessionId: 's' }),
    line({ type: 'user', permissionMode: 'plan', message: { role: 'user', content: '옛 질문' } }),
    line({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: '옛 답' }] } }),
    line({ type: 'permission-mode', permissionMode: 'bypassPermissions', sessionId: 's' }),
    line({ type: 'user', permissionMode: 'bypassPermissions', message: { role: 'user', content: [{ type: 'text', text: '마지막   질문\n둘째 줄' }] } }),
    line({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'thinking', thinking: '비밀 생각' }] } }),
    line({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: '마지막 답' }] } }),
    line({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't', name: 'Bash', input: { command: 'cat secret' } }] } }),
    line({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: '파일 내용 SECRET' }] } }),
    line({ type: 'user', isMeta: true, message: { role: 'user', content: '메타' } }),
    line({ type: 'assistant', isSidechain: true, message: { role: 'assistant', content: [{ type: 'text', text: '서브 에이전트 답' }] } }),
    '깨진 줄 {',
  ].join('\n');
  const got = parseTranscriptTail(tail);
  assert.deepEqual(got, { lastPrompt: '마지막 질문 둘째 줄', lastReply: '마지막 답', permission: 'bypassPermissions' });
  assert.ok(!JSON.stringify(got).includes('SECRET'), '도구 결과는 읽지 않는다');

  const long = parseTranscriptTail(line({ type: 'assistant', message: { content: [{ type: 'text', text: 'a'.repeat(900) }] } }));
  assert.equal(long.lastReply.length, 600);
  assert.deepEqual(parseTranscriptTail(''), {});
  assert.deepEqual(parseTranscriptTail('not json\n'), {});
});

test('claude 어댑터: 마지막 질문, 답, 권한 모드가 이벤트에 실린다', async () => {
  const base = { session_id: 'sess12345678', cwd: '/x/proj', permission_mode: 'bypassPermissions' };
  const [prompt] = fromClaude({ ...base, hook_event_name: 'UserPromptSubmit', prompt: 'p'.repeat(500) });
  assert.equal(prompt.lastPrompt.length, 300);
  assert.equal(prompt.permission, 'bypassPermissions');
  const [stop] = fromClaude({ ...base, hook_event_name: 'Stop', last_assistant_message: '끝났어요\n정말로' });
  assert.equal(stop.lastReply, '끝났어요 정말로');

  const dir = await mkdtemp(join(tmpdir(), 'af-tr-'));
  const path = join(dir, 's.jsonl');
  await writeFile(path, JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: '기록에서 읽은 답' }] } }) + '\n');
  const [fromFile] = fromClaude({ ...base, hook_event_name: 'Stop', transcript_path: path });
  assert.equal(fromFile.lastReply, '기록에서 읽은 답');
  const [none] = fromClaude({ ...base, hook_event_name: 'Stop', transcript_path: join(dir, 'missing.jsonl') });
  assert.equal(none.lastReply, undefined, '기록을 못 읽어도 조용히 넘어간다');
  assert.equal(none.status, 'idle');
  // 서브에이전트 이벤트에는 대화 글이 실리지 않는다.
  const [sub] = fromClaude({ ...base, hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: {}, agent_id: 'a1', agent_type: 'Explore' });
  assert.equal(sub.lastPrompt, undefined);
  assert.equal(sub.permission, undefined);
});

test('protocol: lastPrompt, lastReply, permission은 메인 세션에만 적용된다', () => {
  const state = createState();
  const apply = (raw) => applyEvent(state, normalizeEvent(raw));
  apply({ type: 'join', agent: 'lead', team: 'T', lastPrompt: '질문', lastReply: '답', permission: 'default' });
  apply({ type: 'join', agent: 'lead:sub', parent: 'lead', team: 'T', lastPrompt: '서브 질문', permission: 'bypassPermissions' });
  assert.deepEqual(
    [state.agents.lead.lastPrompt, state.agents.lead.lastReply, state.agents.lead.permission],
    ['질문', '답', 'default'],
  );
  assert.equal(state.agents['lead:sub'].lastPrompt, undefined);
  assert.equal(state.agents['lead:sub'].permission, undefined);
  assert.equal(normalizeEvent({ type: 'join', agent: 'x', permission: 'p'.repeat(40) }).permission.length, 24);
});

test('orca-send: 가드와 배열 인자 전송', async () => {
  const calls = [];
  assert.deepEqual(await sendOrcaPrompt(TERM, '테스트 해줘; rm -rf /', fakeOrca([{ handle: TERM, agentIdentity: 'claude' }], calls)), { sent: true });
  assert.deepEqual(calls[0], ['orca', 'terminal', 'list', '--json']);
  assert.deepEqual(calls[1], ['orca', 'terminal', 'send', '--terminal', TERM, '--text', '테스트 해줘; rm -rf /', '--enter']);

  const other = fakeOrca([{ handle: TERM, agentIdentity: 'shell' }]);
  assert.match((await sendOrcaPrompt(TERM, 'hi', other)).reason, /Claude 상태가 아니에요/);
  assert.equal(other.calls.length, 1, 'Claude가 아니면 send를 부르지 않는다');
  const gone = fakeOrca([]);
  assert.match((await sendOrcaPrompt(TERM, 'hi', gone)).reason, /이미 없어요/);
  assert.equal((await sendOrcaPrompt('', 'hi', gone)).sent, false);
  assert.equal((await sendOrcaPrompt(TERM, '  ', gone)).sent, false);
  const boom = (cmd, args, opts, cb) => cb(new Error('orca missing'));
  assert.match((await sendOrcaPrompt(TERM, 'hi', boom)).reason, /orca 호출 실패/);
});

// ---- 이름 고치기

const ADMIN = { admins: ME, trustProxyEmail: true };
const lead = (base, agent = 'claude-code:aaaa1111', extra = {}) =>
  postJson(base, '/events', [{ type: 'join', agent, team: 'T', role: 'Lead', name: '결제 버그', status: 'idle', ...extra }]);
const hook = (base, agent, extra = {}) =>
  postJson(base, '/events', [{ type: 'status', agent, team: 'T', role: 'Lead', status: 'thinking', ...extra }]);
const readAudit = async (path) => (await readFile(path, 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
const AG = 'claude-code:aaaa1111';

test('rename: 관리자가 고치면 훅 제목이 덮지 못하고, 감사 기록이 남는다', async () => {
  await withServer(ADMIN, async (base, floor, auditPath) => {
    await lead(base);
    assert.equal(floor.state.agents[AG].name, '결제 버그');
    const res = await postJson(base, '/rename', { agent: AG, name: '  내 이름  ' }, asMe);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, name: '내 이름' });
    assert.equal(floor.state.agents[AG].name, '내 이름');
    assert.equal(floor.state.agents[AG].history.length, 1, '기록에 남지 않는다');
    await hook(base, AG, { name: '새 제목' });
    await hook(base, AG, { name: 'Claude' });
    assert.equal(floor.state.agents[AG].name, '내 이름');
    const rows = await readAudit(auditPath);
    const last = rows[rows.length - 1];
    assert.equal(last.kind, 'rename');
    assert.equal(last.result, 'ok');
    assert.equal(last.text, '내 이름');
  });
});

test('rename: 권한 없으면 403과 denied 기록(시도한 이름 포함), 이름은 그대로', async () => {
  await withServer(ADMIN, async (base, floor, auditPath) => {
    await lead(base);
    const eve = { 'x-auth-request-email': 'eve@test.dev' };
    assert.equal((await postJson(base, '/rename', { agent: AG, name: '해킹' }, eve)).status, 403);
    assert.equal((await postJson(base, '/rename', { agent: AG, name: '해킹' })).status, 403);
    assert.equal(floor.state.agents[AG].name, '결제 버그');
    const rows = await readAudit(auditPath);
    assert.equal(rows.length, 2);
    assert.ok(rows.every((r) => r.kind === 'rename' && r.result === 'denied' && r.text === '해킹' && r.agent === AG));
  });
});

test('rename: 없는 직원 404, 41자와 글자 아닌 이름 400, 서브에이전트와 퇴사자는 거절하며 모두 기록', async () => {
  await withServer(ADMIN, async (base, floor, auditPath) => {
    await lead(base);
    await postJson(base, '/events', [{ type: 'join', agent: `${AG}:kid`, parent: AG, role: 'reviewer', name: '리뷰어' }]);
    await lead(base, 'claude-code:bbbb2222');
    await postJson(base, '/events', [{ type: 'leave', agent: 'claude-code:bbbb2222' }]);
    assert.equal((await postJson(base, '/rename', { agent: 'nobody', name: 'x' }, asMe)).status, 404);
    assert.equal((await postJson(base, '/rename', { agent: AG, name: 'a'.repeat(41) }, asMe)).status, 400);
    assert.equal((await postJson(base, '/rename', { agent: AG, name: 42 }, asMe)).status, 400);
    assert.equal((await postJson(base, '/rename', { agent: AG }, asMe)).status, 400);
    assert.equal((await postJson(base, '/rename', { agent: `${AG}:kid`, name: '새 이름' }, asMe)).status, 400);
    assert.equal((await postJson(base, '/rename', { agent: 'claude-code:bbbb2222', name: '새 이름' }, asMe)).status, 400);
    assert.equal((await postJson(base, '/rename', { agent: AG, name: 'a'.repeat(40) }, asMe)).status, 200, '40자는 된다');
    assert.equal(floor.state.agents[`${AG}:kid`].name, '리뷰어');
    const rows = await readAudit(auditPath);
    assert.deepEqual(rows.map((r) => r.result.split(':')[0]), ['refused', 'refused', 'refused', 'refused', 'refused', 'refused', 'ok']);
    assert.equal(rows[1].text, 'a'.repeat(41));
  });
});

test('rename: 빈 이름은 고친 이름을 지우고 훅 제목으로, 훅 제목이 없으면 Claude로 되돌린다', async () => {
  await withServer(ADMIN, async (base, floor) => {
    await lead(base);
    await postJson(base, '/rename', { agent: AG, name: '내 이름' }, asMe);
    await hook(base, AG, { name: '훅 제목' });
    const res = await postJson(base, '/rename', { agent: AG, name: '   ' }, asMe);
    assert.deepEqual(await res.json(), { ok: true, name: '훅 제목' });
    assert.equal(floor.state.agents[AG].name, '훅 제목');
    await hook(base, AG, { name: '다음 제목' });
    assert.equal(floor.state.agents[AG].name, '다음 제목', '지운 뒤에는 훅 제목이 다시 따라간다');
    // 훅 제목을 한 번도 받지 못한 직원(기본 이름만 보낸 세션)은 Claude로
    await lead(base, 'claude-code:cccc3333', { name: 'Claude' });
    await postJson(base, '/rename', { agent: 'claude-code:cccc3333', name: '임시' }, asMe);
    const back = await postJson(base, '/rename', { agent: 'claude-code:cccc3333', name: '' }, asMe);
    assert.deepEqual(await back.json(), { ok: true, name: 'Claude' });
  });
});

test('rename: 고친 이름은 파일에 남아 서버를 다시 띄워도 유지되고 seed보다 먼저 읽힌다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'af-names-'));
  const namesPath = join(dir, 'names.json');
  await withServer({ ...ADMIN, namesPath }, async (base) => {
    await lead(base);
    await postJson(base, '/rename', { agent: AG, name: '오래 가는 이름' }, asMe);
    assert.deepEqual(JSON.parse(await readFile(namesPath, 'utf8')), { [AG]: '오래 가는 이름' });
  });
  await withServer({ ...ADMIN, namesPath }, async (base, floor) => {
    await lead(base); // 새로 올라온 같은 id(seed나 훅)
    assert.equal(floor.state.agents[AG].name, '오래 가는 이름');
    await postJson(base, '/events', [{ type: 'reset' }]);
    await lead(base);
    assert.equal(floor.state.agents[AG].name, '오래 가는 이름', 'reset 뒤에도 남는다');
    // 같은 id가 퇴사했다가 다시 join해도 고친 이름이 적용된다
    await postJson(base, '/events', [{ type: 'leave', agent: AG }]);
    await lead(base, AG, { name: '다른 제목' });
    assert.equal(floor.state.agents[AG].name, '오래 가는 이름');
    // 서버를 다시 띄운 직후 빈 이름으로 지우면 Claude로
    const res = await postJson(base, '/rename', { agent: AG, name: '' }, asMe);
    assert.equal((await res.json()).name, '다른 제목');
  });
  await withServer({ ...ADMIN, namesPath }, async (base, floor) => {
    await lead(base, AG, { name: 'Claude' });
    const res = await postJson(base, '/rename', { agent: AG, name: '' }, asMe);
    assert.equal((await res.json()).name, 'Claude');
    assert.deepEqual(JSON.parse(await readFile(namesPath, 'utf8')), {}, '지우면 파일에서도 빠진다');
    assert.equal(floor.state.agents[AG].name, 'Claude');
  });
});

test('rename: 깨진 파일은 빈 이름표로 시작하고, 500개를 넘으면 오래된 것부터 지운다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'af-names-'));
  const namesPath = join(dir, 'names.json');
  await writeFile(namesPath, '{깨진');
  await withServer({ ...ADMIN, namesPath }, async (base, floor) => {
    await lead(base);
    assert.equal(floor.state.agents[AG].name, '결제 버그');
  });
  const many = Object.fromEntries(Array.from({ length: 502 }, (_, i) => [`id${i}`, `이름${i}`]));
  await writeFile(namesPath, JSON.stringify(many));
  await withServer({ ...ADMIN, namesPath }, async (base, floor) => {
    await lead(base, 'id0', { name: '훅' });
    await lead(base, 'id501', { name: '훅' });
    assert.equal(floor.state.agents.id0.name, '훅', '가장 오래된 둘은 밀려났다');
    assert.equal(floor.state.agents.id501.name, '이름501');
    await postJson(base, '/rename', { agent: 'id501', name: '갱신' }, asMe);
    const saved = JSON.parse(await readFile(namesPath, 'utf8'));
    assert.equal(Object.keys(saved).length, 500);
    assert.equal(Object.keys(saved).pop(), 'id501', '다시 저장하면 순서가 맨 뒤로 간다');
  });
});

test('rename: 저장 파일을 쓰지 못해도 이름 고치기는 된다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'af-names-'));
  await writeFile(join(dir, 'blocker'), 'x');
  await withServer({ ...ADMIN, namesPath: join(dir, 'blocker', 'names.json') }, async (base, floor) => {
    await lead(base);
    const res = await postJson(base, '/rename', { agent: AG, name: '써지지 않는 이름' }, asMe);
    assert.equal(res.status, 200);
    assert.equal(floor.state.agents[AG].name, '써지지 않는 이름');
  });
});

test('rename: /events로 들어온 rename은 메인 포트와 기계용 포트 모두 거절하고 이름은 그대로', async () => {
  await withServer({ token: 'tt', machinePort: 0 }, async (base, floor) => {
    const m = `http://127.0.0.1:${floor.machineServer.address().port}`;
    const auth = { Authorization: 'Bearer tt' };
    await postJson(base, '/events', [{ type: 'join', agent: AG, team: 'T', role: 'Lead', name: '결제 버그' }], auth);
    const evil = [{ type: 'rename', agent: AG, name: '위조' }];
    const viaMain = await postJson(base, '/events', evil, auth);
    assert.equal(viaMain.status, 400);
    assert.deepEqual(await viaMain.json(), { accepted: 0, rejected: 1 });
    assert.equal((await postJson(m, '/events', evil, auth)).status, 400);
    assert.equal(floor.ingest({ type: 'rename', agent: AG, name: '위조' }), false);
    assert.equal(floor.state.agents[AG].name, '결제 버그');
    assert.equal((await postJson(m, '/rename', { agent: AG, name: 'x' }, auth)).status, 404, '기계용 포트에는 길이 없다');
  });
});

test('guard: waiting은 이유로 가른다(idle 허용, permission 거절, 모르면 15분 뒤 허용)', async () => {
  const orca = fakeOrca([{ handle: TERM, agentIdentity: 'claude' }]);
  const admin = { admins: ME, trustProxyEmail: true, device: '서버기기', execFileImpl: orca };
  const close = async (base, agent) => (await postJson(base, '/close', { agent }, asMe)).json();
  const old = Date.now() - 20 * 60_000;
  await withServer(admin, async (base) => {
    await joinAgent(base, 'idleWait', { status: 'waiting', waitKind: 'idle' });
    await joinAgent(base, 'permWait', { status: 'waiting', waitKind: 'permission' });
    await joinAgent(base, 'permOld', { status: 'waiting', waitKind: 'permission', ts: old });
    await joinAgent(base, 'newUnknown', { status: 'waiting' });
    await joinAgent(base, 'oldUnknown', { status: 'waiting', ts: old });
    await joinAgent(base, 'busy', { status: 'thinking' });
    assert.deepEqual(await close(base, 'idleWait'), { closed: 'queued' });
    assert.equal((await close(base, 'permWait')).reason, '권한 확인을 기다리는 중이라 닫지 않았어요');
    assert.match((await close(base, 'permOld')).reason, /권한 확인/, '권한 확인은 오래돼도 막는다');
    assert.match((await close(base, 'newUnknown')).reason, /일하는 중/);
    assert.deepEqual(await close(base, 'oldUnknown'), { closed: 'queued' });
    assert.match((await close(base, 'busy')).reason, /일하는 중/);
    // 지시 보내기도 같은 검사를 쓴다. 권한 우회 세션 규칙은 그대로다.
    const send = async (agent) => (await postJson(base, '/send', { agent, text: 'hi' }, asMe)).json();
    assert.deepEqual(await send('idleWait'), { sent: 'queued' });
    assert.match((await send('permWait')).reason, /권한 확인/);
    await joinAgent(base, 'bypassIdle', { status: 'waiting', waitKind: 'idle', permission: 'bypassPermissions' });
    assert.match((await send('bypassIdle')).reason, /권한 확인 없이/);
  });
});

test('waitKind: 알림 훅이 알리고 waiting을 벗어나면 지워진다', () => {
  const hook = (extra) => fromClaude({ hook_event_name: 'Notification', session_id: 'sess1234', cwd: '/x/shop', ...extra })[0];
  assert.equal(hook({ notification_type: 'idle_prompt' }).waitKind, 'idle');
  assert.equal(hook({ notification_type: 'permission_prompt' }).waitKind, 'permission');
  assert.equal(hook({ notification_type: 'elicitation_dialog' }).waitKind, 'permission');
  assert.equal(hook({ type: 'idle_prompt' }).waitKind, 'idle', 'type 필드도 본다');
  assert.equal('waitKind' in hook({ notification_type: 'auth_success' }), false);
  assert.equal('waitKind' in hook({}), false);
  const state = createState();
  const send = (ev) => applyEvent(state, normalizeEvent({ agent: 'a', team: 't', ...ev }));
  send({ type: 'status', status: 'waiting', waitKind: 'idle' });
  assert.equal(state.agents.a.waitKind, 'idle');
  send({ type: 'status', status: 'waiting', waitKind: 'bogus' });
  assert.equal(state.agents.a.waitKind, undefined, '새 알림이 이유를 모르면 비운다');
  send({ type: 'status', status: 'waiting', waitKind: 'permission' });
  send({ type: 'status', status: 'thinking' });
  assert.equal(state.agents.a.waitKind, undefined);
});

test('routes: 터미널과 기기 연결은 파일에 남아 서버를 다시 띄워도 쉬는 세션에 닿는다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'af-routes-'));
  const routesPath = join(dir, 'routes.json');
  const orca = fakeOrca([{ handle: TERM, agentIdentity: 'claude' }]);
  const opts = { ...ADMIN, device: '서버기기', routesPath, execFileImpl: orca };
  await withServer(opts, async (base) => {
    await joinAgent(base, 'lap', { device: '서버기기' });
    for (let i = 0; i < 50 && !(await readFile(routesPath).catch(() => null)); i++) await new Promise((r) => setTimeout(r, 20));
  });
  assert.deepEqual(JSON.parse(await readFile(routesPath, 'utf8')), { terminals: { lap: TERM }, devices: { lap: '서버기기' } });
  // 다시 뜬 서버는 세션이 훅 없이 seed로만 올라와도 터미널을 안다.
  await withServer(opts, async (base) => {
    await joinAgent(base, 'lap', { terminal: undefined, device: undefined });
    const res = await postJson(base, '/send', { agent: 'lap', text: 'hi' }, asMe);
    assert.deepEqual(await res.json(), { sent: true });
  });
  // 깨진 파일은 빈 채로 시작한다.
  await writeFile(routesPath, '{깨진');
  await withServer(opts, async (base) => {
    await joinAgent(base, 'lap', { terminal: undefined, device: undefined });
    assert.match((await (await postJson(base, '/send', { agent: 'lap', text: 'hi' }, asMe)).json()).reason, /연결 전이에요/);
  });
});
