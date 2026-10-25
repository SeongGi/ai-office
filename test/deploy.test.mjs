import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../server/index.mjs';
import { closeOrcaTerminal } from '../adapters/orca-close.mjs';
import { fromClaude } from '../adapters/claude.mjs';
import { seedEvents } from '../adapters/seed.mjs';

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const TERM = 'term_abcdef123456';

async function withServer(opts, fn) {
  const floor = await startServer({ port: 0, log: () => {}, seed: false, ...opts });
  const base = `http://127.0.0.1:${floor.server.address().port}`;
  try {
    await fn(base, floor);
  } finally {
    await floor.close();
  }
}

/** orca를 흉내 내는 execFile. 보낸 명령을 calls에 쌓는다. */
function fakeOrca(terminals, calls = []) {
  const impl = (cmd, args, opts, cb) => {
    calls.push([cmd, ...args]);
    if (args[1] === 'list') cb(null, JSON.stringify({ result: { terminals } }));
    else cb(null, '{}');
  };
  impl.calls = calls;
  return impl;
}

const post = (base, body, headers = {}) =>
  fetch(`${base}/events`, { method: 'POST', headers: { ...JSON_HEADERS, ...headers }, body: JSON.stringify(body) });

test('token auth: 토큰이 없으면 열려 있다', async () => {
  await withServer({ token: '' }, async (base) => {
    assert.equal((await fetch(`${base}/state`)).status, 200);
  });
});

test('token auth: 401, bearer, cookie, ?token= 리다이렉트, /health 열림', async () => {
  await withServer({ token: 'secret-t' }, async (base) => {
    assert.equal((await fetch(`${base}/state`)).status, 401);
    assert.equal((await post(base, [{ type: 'join', agent: 'a', team: 'T' }])).status, 401, 'non-GET은 JSON 401');
    assert.equal((await fetch(`${base}/health`)).status, 200);
    assert.equal((await fetch(`${base}/state`, { headers: { Authorization: 'Bearer wrong' } })).status, 401);
    assert.equal((await fetch(`${base}/state`, { headers: { Authorization: 'Bearer x' } })).status, 401, '길이가 달라도 터지지 않는다');
    assert.equal((await fetch(`${base}/state`, { headers: { Authorization: 'Bearer secret-t' } })).status, 200);
    assert.equal((await post(base, [{ type: 'join', agent: 'a', team: 'T' }], { Authorization: 'Bearer secret-t' })).status, 202);
    assert.equal((await fetch(`${base}/state`, { headers: { Cookie: 'af_token=secret-t' } })).status, 200);
    assert.equal((await fetch(`${base}/state`, { headers: { Cookie: 'af_token=nope' } })).status, 401);

    const page = await fetch(`${base}/`, { headers: { Accept: 'text/html' } });
    assert.equal(page.status, 401);
    const html = await page.text();
    assert.ok(html.includes('성기 주식회사') && html.includes('접속 토큰을 입력하세요') && html.includes('name="token"'));

    const bad = await fetch(`${base}/?token=wrong`, { redirect: 'manual', headers: { Accept: 'text/html' } });
    assert.equal(bad.status, 401);

    const ok = await fetch(`${base}/?token=secret-t&x=1`, { redirect: 'manual', headers: { 'x-forwarded-proto': 'https' } });
    assert.equal(ok.status, 302);
    assert.equal(ok.headers.get('location'), '/?x=1');
    const cookie = ok.headers.get('set-cookie');
    assert.match(cookie, /^af_token=secret-t;/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
    assert.match(cookie, /Max-Age=31536000/);
    assert.match(cookie, /Secure/);
    const plain = await fetch(`${base}/?token=secret-t`, { redirect: 'manual' });
    assert.doesNotMatch(plain.headers.get('set-cookie'), /Secure/);
    assert.equal(plain.headers.get('location'), '/');
  });
});

test('token auth: 토큰 없이 외부 주소로는 시작하지 않는다', async () => {
  await assert.rejects(startServer({ port: 0, host: '0.0.0.0', token: '', log: () => {}, seed: false }), /AGENT_FLOOR_TOKEN/);
});

test('device prefix: 팀 이름과 id에 기기 이름이 붙고 한글 slug가 남는다', async () => {
  const prev = process.env.AGENT_FLOOR_DEVICE;
  const prevTeam = process.env.AGENT_FLOOR_TEAM;
  delete process.env.AGENT_FLOOR_TEAM;
  process.env.AGENT_FLOOR_DEVICE = '서버기기';
  try {
    const events = fromClaude({ hook_event_name: 'SessionStart', session_id: 's1', cwd: '/x/ra-portal' });
    assert.equal(events[0].team, '서버기기 ra-portal');
    assert.equal(events[0].device, '서버기기');
    const seeded = seedEvents({ root: '/nonexistent' });
    assert.deepEqual(seeded, []);
    await withServer({}, async (base, floor) => {
      for (let i = 0; i < 6; i++) {
        const ev = fromClaude({ hook_event_name: 'SessionStart', session_id: `sess${i}aaaa`, cwd: '/x/ra-portal' })[0];
        assert.ok(floor.ingest(ev));
      }
      const { teams } = await (await fetch(`${base}/state`)).json();
      assert.equal(teams['서버기기-ra-portal'].name, '서버기기 ra-portal');
      assert.ok(teams['서버기기-ra-portal-2'], '5명이 넘으면 둘째 방이 열린다');
      assert.equal(teams['서버기기-ra-portal-2'].name, '서버기기 ra-portal 2');
    });
  } finally {
    if (prev === undefined) delete process.env.AGENT_FLOOR_DEVICE;
    else process.env.AGENT_FLOOR_DEVICE = prev;
    if (prevTeam !== undefined) process.env.AGENT_FLOOR_TEAM = prevTeam;
  }
});

test('orca-close: 가드와 전송', async () => {
  const calls = [];
  assert.deepEqual(await closeOrcaTerminal(TERM, fakeOrca([{ handle: TERM, agentIdentity: 'claude' }], calls)), { closed: true });
  assert.deepEqual(calls[1], ['orca', 'terminal', 'send', '--terminal', TERM, '--text', '/exit', '--enter']);

  const other = fakeOrca([{ handle: TERM, agentIdentity: 'shell' }]);
  assert.equal((await closeOrcaTerminal(TERM, other)).closed, false);
  assert.equal(other.calls.length, 1, 'Claude가 아니면 send를 부르지 않는다');

  const gone = fakeOrca([]);
  assert.match((await closeOrcaTerminal(TERM, gone)).reason, /이미 없어요/);
  assert.equal(gone.calls.length, 1);

  const boom = (cmd, args, opts, cb) => cb(new Error('orca missing'));
  assert.match((await closeOrcaTerminal(TERM, boom)).reason, /orca 호출 실패/);
  assert.equal((await closeOrcaTerminal('', boom)).closed, false);
});

test('close: 같은 기기는 바로 닫고, 다른 기기는 큐로 간다', async () => {
  const orca = fakeOrca([{ handle: TERM, agentIdentity: 'claude' }]);
  await withServer({ device: '서버기기', execFileImpl: orca }, async (base) => {
    const join = (agent, device, extra = {}) =>
      post(base, [{ type: 'join', agent, team: 'T', status: 'idle', terminal: TERM, ...(device ? { device } : {}), ...extra }]);
    const close = async (agent) => (await fetch(`${base}/close`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ agent }) })).json();

    await join('own', '서버기기');
    await join('lap', '맥북');
    await join('busy', '맥북', { status: 'working' });
    await join('child', '맥북', { parent: 'lap' });

    assert.deepEqual(await close('own'), { closed: true });
    assert.equal(orca.calls.length, 2);
    assert.match((await close('busy')).reason, /일하는 중/);
    assert.match((await close('child')).reason, /서브에이전트/);
    assert.equal(orca.calls.length, 2, '큐 경로와 거절 경로는 orca를 부르지 않는다');

    assert.deepEqual(await close('lap'), { closed: 'queued' });
    const other = await (await fetch(`${base}/close-queue?device=서버기기`)).json();
    assert.deepEqual(other.items, [], '다른 기기 큐는 비어 있다');
    const mine = await (await fetch(`${base}/close-queue?device=${encodeURIComponent('맥북')}`)).json();
    assert.equal(mine.items.length, 1);
    assert.equal(mine.items[0].agent, 'lap');
    assert.equal(mine.items[0].terminal, TERM);
    assert.equal(mine.items[0].device, '맥북');
    const again = await (await fetch(`${base}/close-queue?device=${encodeURIComponent('맥북')}`)).json();
    assert.deepEqual(again.items, [], '가져가면 사라진다');
  });
});

test('close-queue: 60초 지난 항목은 버리고, 토큰을 요구한다', async () => {
  await withServer({ device: '', token: 'tt', execFileImpl: fakeOrca([]) }, async (base) => {
    const auth = { Authorization: 'Bearer tt' };
    await post(base, [{ type: 'join', agent: 'old', team: 'T', status: 'idle', terminal: TERM, device: '맥북' }], auth);
    assert.equal((await fetch(`${base}/close-queue?device=x`)).status, 401);
    const realNow = Date.now;
    try {
      await fetch(`${base}/close`, { method: 'POST', headers: { ...JSON_HEADERS, ...auth }, body: JSON.stringify({ agent: 'old' }) });
      Date.now = () => realNow() + 61_000;
      const res = await (await fetch(`${base}/close-queue?device=${encodeURIComponent('맥북')}`, { headers: auth })).json();
      assert.deepEqual(res.items, []);
    } finally {
      Date.now = realNow;
    }
  });
});
