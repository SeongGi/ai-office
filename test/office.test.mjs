import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../server/index.mjs';
import { DEFAULT_OFFICE_NAME, OFFICE_NAME_MAX, validateOfficeName } from '../shared/officeName.js';

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const ME = 'me@test.dev';
const asMe = { 'x-auth-request-email': ME };

/** 환경값에 기대지 않도록 옵션을 모두 직접 정한다(기본은 로컬 개발 모드, 파일은 임시 폴더). */
async function withServer(opts, fn) {
  const dir = opts.dir ?? (await mkdtemp(join(tmpdir(), 'af-office-')));
  const floor = await startServer({
    port: 0,
    log: () => {},
    seed: false,
    token: '',
    admins: '',
    trustProxyEmail: false,
    machinePort: null,
    auditPath: join(dir, 'audit.log'),
    namesPath: join(dir, 'names.json'),
    routesPath: join(dir, 'routes.json'),
    officePath: join(dir, 'office.json'),
    officeName: '',
    ...opts,
  });
  const base = `http://127.0.0.1:${floor.server.address().port}`;
  try {
    await fn(base, floor, dir);
  } finally {
    await floor.close();
  }
}

const postOffice = (base, body, headers = {}) =>
  fetch(`${base}/office`, { method: 'POST', headers: { ...JSON_HEADERS, ...headers }, body: JSON.stringify(body) });
const getOffice = async (base) => (await fetch(`${base}/office`)).json();
const ADMIN = { admins: ME, trustProxyEmail: true };

/** /stream을 열고 받은 SSE 틀을 모아 둔다. close()로 닫는다. */
async function openStream(base) {
  const ac = new AbortController();
  const res = await fetch(`${base}/stream`, { signal: ac.signal });
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const frames = [];
  let buf = '';
  let waiting = null;
  (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buf += decoder.decode(value, { stream: true });
        let at;
        while ((at = buf.indexOf('\n\n')) >= 0) {
          const raw = buf.slice(0, at);
          buf = buf.slice(at + 2);
          const event = /^event: (.+)$/m.exec(raw)?.[1];
          const data = /^data: (.+)$/m.exec(raw)?.[1];
          if (event) frames.push({ event, data: JSON.parse(data) });
          waiting?.();
        }
      }
    } catch {
      // 닫으면 읽기가 끊긴다.
    }
  })();
  return {
    frames,
    async next(event) {
      for (let i = 0; i < 100; i++) {
        const f = frames.find((x) => x.event === event && !x.seen);
        if (f) {
          f.seen = true;
          return f.data;
        }
        await new Promise((r) => {
          waiting = r;
          setTimeout(r, 50);
        });
      }
      throw new Error(`${event} 이벤트가 오지 않았어요`);
    },
    close: () => ac.abort(),
  };
}

test('office: 정하기 전에는 기본 이름과 configured false', async () => {
  await withServer({}, async (base) => {
    assert.deepEqual(await getOffice(base), { name: DEFAULT_OFFICE_NAME, configured: false, locked: false });
  });
});

test('office: POST 성공 뒤 GET과 파일에 반영되고 앞뒤 공백은 잘린다', async () => {
  await withServer({}, async (base, floor, dir) => {
    const res = await postOffice(base, { name: '  성기 주식회사  ' });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { name: '성기 주식회사', configured: true, locked: false });
    assert.deepEqual(await getOffice(base), { name: '성기 주식회사', configured: true, locked: false });
    assert.deepEqual(JSON.parse(await readFile(join(dir, 'office.json'), 'utf8')), { name: '성기 주식회사' });
  });
});

test('office: 서버를 다시 띄워도 이름이 남는다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'af-office-'));
  await withServer({ dir }, async (base) => {
    await postOffice(base, { name: '오래 가는 이름' });
  });
  await withServer({ dir }, async (base) => {
    assert.deepEqual(await getOffice(base), { name: '오래 가는 이름', configured: true, locked: false });
  });
});

test('office: 깨진 파일은 미설정으로 시작한다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'af-office-'));
  await writeFile(join(dir, 'office.json'), '{깨진');
  await withServer({ dir }, async (base) => {
    assert.equal((await getOffice(base)).configured, false);
  });
});

test('office: 검증 실패는 400이고 이름은 그대로, 24자는 되고 이모지도 코드 포인트로 센다', async () => {
  await withServer({}, async (base) => {
    const bad = [
      undefined,
      123,
      '',
      '   ',
      'a'.repeat(OFFICE_NAME_MAX + 1),
      '줄\n바꿈',
      '탭\t문자',
      'bidi\u202eevil',
      'iso\u2066late',
      '제로\u200b폭',
      'b\ufeffom',
      '\ufeff앞에 BOM',
      '뒤에 BOM\ufeff',
      '\u200d',
      '짝 없는\ud800서로게이트',
      '\u3164',
      '\u115f\u1160\uffa0',
      '\u2800\u2800',
      ' \u200b ',
    ];
    for (const name of bad) {
      assert.equal((await postOffice(base, { name })).status, 400, JSON.stringify(name));
    }
    assert.equal((await postOffice(base, {})).status, 400);
    assert.equal((await getOffice(base)).configured, false);
    assert.equal((await postOffice(base, { name: 'a'.repeat(OFFICE_NAME_MAX) })).status, 200);
    assert.equal((await postOffice(base, { name: '😀'.repeat(OFFICE_NAME_MAX) })).status, 200, '코드 포인트 기준으로 센다');
    assert.equal((await postOffice(base, { name: '😀'.repeat(OFFICE_NAME_MAX + 1) })).status, 400);
  });
});

test('office: 제어 권한이 없으면 403이고 이름은 그대로', async () => {
  await withServer(ADMIN, async (base) => {
    assert.equal((await postOffice(base, { name: '해킹' }, { 'x-auth-request-email': 'eve@test.dev' })).status, 403);
    assert.equal((await postOffice(base, { name: '해킹' })).status, 403);
    assert.equal((await getOffice(base)).configured, false);
    const ok = await postOffice(base, { name: '우리 사무실' }, asMe);
    assert.equal(ok.status, 200);
    assert.equal((await getOffice(base)).name, '우리 사무실');
  });
});

test('office: 환경변수로 고정하면 POST는 409, 파일보다 환경변수가 이긴다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'af-office-'));
  await writeFile(join(dir, 'office.json'), JSON.stringify({ name: '파일 이름' }));
  await withServer({ dir, officeName: '  고정 이름 ' }, async (base, floor, d) => {
    assert.deepEqual(await getOffice(base), { name: '고정 이름', configured: true, locked: true });
    assert.equal((await postOffice(base, { name: '바꾸기' })).status, 409);
    assert.deepEqual(await getOffice(base), { name: '고정 이름', configured: true, locked: true });
    assert.deepEqual(JSON.parse(await readFile(join(d, 'office.json'), 'utf8')), { name: '파일 이름' }, '파일은 건드리지 않는다');
  });
});

test('office: 환경변수 이름이 규칙을 어기면 쓰지 않는다', async () => {
  await withServer({ officeName: 'a'.repeat(OFFICE_NAME_MAX + 1) }, async (base) => {
    assert.deepEqual(await getOffice(base), { name: DEFAULT_OFFICE_NAME, configured: false, locked: false });
  });
});

test('office: 파일을 쓰지 못해도 요청은 성공한다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'af-office-'));
  await writeFile(join(dir, 'blocker'), 'x'); // 폴더 자리에 파일이 있어 mkdir이 실패한다
  await withServer({ dir, officePath: join(dir, 'blocker', 'office.json') }, async (base) => {
    assert.equal((await postOffice(base, { name: '메모리에만' })).status, 200);
    assert.equal((await getOffice(base)).name, '메모리에만');
  });
});

test('office: snapshot에 office가 실리고 바뀌면 모든 연결에 office 이벤트가 간다', async () => {
  await withServer({}, async (base) => {
    const a = await openStream(base);
    const b = await openStream(base);
    try {
      assert.deepEqual((await a.next('snapshot')).office, { name: DEFAULT_OFFICE_NAME, configured: false, locked: false });
      await b.next('snapshot');
      await postOffice(base, { name: '새 이름' });
      const want = { name: '새 이름', configured: true, locked: false };
      assert.deepEqual(await a.next('office'), want);
      assert.deepEqual(await b.next('office'), want);
      const late = await openStream(base); // 재연결해도 snapshot이 맞는 이름을 준다
      assert.deepEqual((await late.next('snapshot')).office, want);
      late.close();
    } finally {
      a.close();
      b.close();
    }
  });
});

test('office: 토큰 모드에서 GET /office는 인증이 필요하고, 로그인 페이지는 이름을 싣지 않는다', async () => {
  await withServer({ token: 'secret-t' }, async (base) => {
    const auth = { Authorization: 'Bearer secret-t' };
    assert.equal((await fetch(`${base}/office`)).status, 401);
    assert.equal((await postOffice(base, { name: '밖에서' })).status, 401);
    assert.equal((await postOffice(base, { name: '<b>이름</b>' }, auth)).status, 200);
    const page = await fetch(`${base}/`, { headers: { Accept: 'text/html' } });
    assert.equal(page.status, 401);
    const html = await page.text();
    assert.ok(html.includes('<title>AI Office</title>') && html.includes('<h1>AI Office</h1>'));
    assert.ok(!html.includes('이름</b>') && !html.includes('<b>'), '정한 이름은 인증 전 화면에 나오지 않는다');
  });
});

test('office: <script> 이름은 JSON으로만 나가고 로그인 페이지에 들어가지 않는다', async () => {
  const evil = '<script>alert(1)</script>';
  await withServer({ token: 'secret-t' }, async (base) => {
    const auth = { Authorization: 'Bearer secret-t' };
    assert.equal((await postOffice(base, { name: evil.slice(0, OFFICE_NAME_MAX) }, auth)).status, 200);
    const page = await (await fetch(`${base}/`, { headers: { Accept: 'text/html' } })).text();
    assert.ok(!page.includes('<script>'));
    const info = await (await fetch(`${base}/office`, { headers: auth })).json();
    assert.equal(info.name, evil.slice(0, OFFICE_NAME_MAX), '서버는 글자를 그대로 두고, 화면이 textContent로 넣는다');
  });
});

test('office: 감사 기록에 office-name이 남는다', async () => {
  await withServer(ADMIN, async (base, floor, dir) => {
    await postOffice(base, { name: '' }, asMe);
    await postOffice(base, { name: '기록' }, asMe);
    await postOffice(base, { name: '거부' });
    const rows = (await readFile(join(dir, 'audit.log'), 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
    assert.deepEqual(rows.map((r) => [r.kind, r.result.split(':')[0]]), [['office-name', 'refused'], ['office-name', 'ok'], ['office-name', 'denied']]);
    assert.equal(rows[1].text, '기록');
  });
});

test('validateOfficeName: 공백 자르기와 길이, 금지 문자', () => {
  assert.deepEqual(validateOfficeName('  가나  '), { ok: true, name: '가나' });
  assert.equal(validateOfficeName('').ok, false);
  assert.equal(validateOfficeName(null).ok, false);
  assert.equal(validateOfficeName('x'.repeat(25)).ok, false);
  for (const bad of ['\ufeffa', 'a\ufeff', '\u200ba', '\u202ea', '\ud800', 'a\udc00']) {
    assert.equal(validateOfficeName(bad).ok, false, `원문 검사: ${JSON.stringify(bad)}`);
  }
  for (const blank of ['\u3164', '\u115f', '\u1160', '\uffa0', '\u2800', ' \u3164\u2800 ', '\u00a0\u3000']) {
    assert.equal(validateOfficeName(blank).ok, false, `보이는 글자 없음: ${JSON.stringify(blank)}`);
  }
  assert.equal(validateOfficeName('\u3164a').ok, true, '보이는 글자가 하나라도 있으면 된다');
  assert.equal(validateOfficeName('😀').ok, true);
  for (const c of ['\u202a', '\u202e', '\u2066', '\u2069', '\u200b', '\u200f', '\ufeff', '\u0000', '\u007f', '\u2028']) {
    assert.equal(validateOfficeName(`a${c}b`).ok, false, JSON.stringify(c));
  }
});

test('office: 파일을 쓰지 못하면 log에 한 줄 남긴다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'af-office-'));
  await writeFile(join(dir, 'blocker'), 'x');
  const lines = [];
  await withServer({ dir, officePath: join(dir, 'blocker', 'office.json'), log: (l) => lines.push(String(l)) }, async (base) => {
    assert.equal((await postOffice(base, { name: '로그 확인' })).status, 200);
  });
  assert.ok(lines.some((l) => l.includes('저장하지 못했어요') && l.includes('로그 확인')), lines.join('\n'));
});

test('office: 기계용 포트에서는 /office가 404다', async () => {
  await withServer({ token: 'tt', machinePort: 0 }, async (_base, floor) => {
    const m = `http://127.0.0.1:${floor.machineServer.address().port}`;
    const auth = { Authorization: 'Bearer tt' };
    assert.equal((await fetch(`${m}/office`, { headers: auth })).status, 404);
    assert.equal((await postOffice(m, { name: '기계' }, auth)).status, 404);
  });
});

test('office: 동시에 두 번 POST해도 파일과 GET이 같은 이름을 가리킨다', async () => {
  await withServer({}, async (base, floor, dir) => {
    const results = await Promise.all([postOffice(base, { name: '첫째' }), postOffice(base, { name: '둘째' })]);
    assert.deepEqual(results.map((r) => r.status), [200, 200]);
    const got = (await getOffice(base)).name;
    assert.ok(['첫째', '둘째'].includes(got));
    assert.deepEqual(JSON.parse(await readFile(join(dir, 'office.json'), 'utf8')), { name: got });
  });
});
