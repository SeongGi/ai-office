// 데스크톱 앱이 창에 띄울 서버를 정하는 규칙(desktop/target.cjs)을 확인한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { resolveTarget, remoteOrigin, allowInWindow, saveChoice, currentChoice } = createRequire(import.meta.url)('../desktop/target.cjs');

/** 상태 폴더를 임시 폴더로 둔 환경을 만든다. */
function envWith(vars = {}) {
  const home = mkdtempSync(join(tmpdir(), 'ai-office-desktop-'));
  return { home, source: { AI_OFFICE_HOME: home, ...vars } };
}

test('저장된 것이 없으면 선택이 필요하고, 로컬 서버 값도 함께 담는다', () => {
  const { home, source } = envWith({ AI_OFFICE_PORT: '4395' });
  const t = resolveTarget(source);
  assert.equal(t.needsChoice, true);
  assert.equal(t.remote, false);
  assert.equal(t.origin, 'http://127.0.0.1:4395');
  assert.equal(t.url, 'http://127.0.0.1:4395/?app=1');
  assert.equal(t.port, 4395);
  assert.equal(existsSync(join(home, 'desktop.json')), false);
});

test('{mode:local}이 저장돼 있으면 선택 없이 로컬 서버를 연다', () => {
  const { home, source } = envWith({ AI_OFFICE_PORT: '4395' });
  writeFileSync(join(home, 'desktop.json'), JSON.stringify({ mode: 'local' }));
  const t = resolveTarget(source);
  assert.equal(t.remote, false);
  assert.equal(t.needsChoice, undefined);
  assert.equal(t.url, 'http://127.0.0.1:4395/?app=1');
  assert.equal(t.port, 4395);
});

test('로컬 주소를 AI_OFFICE_URL에 넣어도 로컬로 본다', () => {
  const { source } = envWith({ AI_OFFICE_URL: 'http://localhost:4317' });
  assert.equal(resolveTarget(source).remote, false);
});

test('원격 주소는 토큰을 주소에 싣지 않고, 파일에는 주소만 저장한다', () => {
  const { home, source } = envWith({ AI_OFFICE_URL: 'https://floor.example.com/', AI_OFFICE_TOKEN: 'a b&c' });
  const t = resolveTarget(source);
  assert.equal(t.remote, true);
  assert.equal(t.origin, 'https://floor.example.com');
  assert.equal(t.url, 'https://floor.example.com/?app=1');
  assert.equal(t.token, 'a b&c');
  assert.equal(t.url.includes('token'), false);
  const saved = readFileSync(join(home, 'desktop.json'), 'utf8');
  assert.deepEqual(JSON.parse(saved), { url: 'https://floor.example.com' });
  assert.equal(saved.includes('a b&c'), false);
});

test('옛 이름 AGENT_FLOOR_URL도 읽는다', () => {
  const { source } = envWith({ AGENT_FLOOR_URL: 'https://floor.example.com' });
  assert.equal(resolveTarget(source).origin, 'https://floor.example.com');
});

test('환경변수가 없으면 저장된 원격 주소를 열고, 토큰이 없으면 로그인 화면에 맡긴다', () => {
  const { home, source } = envWith();
  writeFileSync(join(home, 'desktop.json'), JSON.stringify({ url: 'https://floor.example.com' }));
  const t = resolveTarget(source);
  assert.equal(t.remote, true);
  assert.equal(t.url, 'https://floor.example.com/?app=1');
  assert.equal(t.token, '');
});

test('http(s)가 아니거나 잘못된 주소는 원격으로 보지 않는다', () => {
  assert.equal(remoteOrigin('file:///etc/passwd'), null);
  assert.equal(remoteOrigin('not a url'), null);
  assert.equal(remoteOrigin(''), null);
  const { home, source } = envWith();
  writeFileSync(join(home, 'desktop.json'), '{broken');
  assert.equal(resolveTarget(source).remote, false);
});

test('깨진 파일은 선택이 필요한 것으로 본다', () => {
  const { home, source } = envWith();
  writeFileSync(join(home, 'desktop.json'), '{broken');
  const t = resolveTarget(source);
  assert.equal(t.needsChoice, true);
  assert.equal(t.remote, false);
  assert.equal(currentChoice(source), null);
  writeFileSync(join(home, 'desktop.json'), 'null');
  assert.equal(resolveTarget(source).needsChoice, true);
});

test('환경변수의 원격 주소가 저장된 선택보다 우선한다', () => {
  const { home, source } = envWith({ AI_OFFICE_URL: 'https://env.example.com' });
  writeFileSync(join(home, 'desktop.json'), JSON.stringify({ mode: 'local' }));
  const t = resolveTarget(source);
  assert.equal(t.remote, true);
  assert.equal(t.origin, 'https://env.example.com');
  assert.equal(t.needsChoice, undefined);
  writeFileSync(join(home, 'desktop.json'), JSON.stringify({ url: 'https://saved.example.com' }));
  assert.equal(resolveTarget(source).origin, 'https://env.example.com');
});

test('saveChoice는 잘못된 주소를 거부하고 파일을 만들지 않는다', () => {
  const { home, source } = envWith();
  for (const bad of ['', 'not a url', 'file:///etc/passwd', 'http://localhost:4317', 'http://127.0.0.1:4317']) {
    const r = saveChoice({ url: bad }, source);
    assert.equal(r.ok, false, bad);
    assert.equal(typeof r.error, 'string');
  }
  assert.equal(saveChoice(null, source).ok, false);
  assert.equal(saveChoice({}, source).ok, false);
  assert.equal(saveChoice({ url: 42 }, source).ok, false);
  assert.equal(existsSync(join(home, 'desktop.json')), false);
});

test('saveChoice는 주소의 origin만 저장하고 토큰은 저장하지 않는다', () => {
  const { home, source } = envWith({ AI_OFFICE_TOKEN: 'secret-token' });
  assert.deepEqual(saveChoice({ url: ' https://floor.example.com/path?token=abc#x ', token: 'secret-token' }, source), { ok: true });
  const saved = readFileSync(join(home, 'desktop.json'), 'utf8');
  assert.deepEqual(JSON.parse(saved), { url: 'https://floor.example.com' });
  assert.equal(saved.includes('secret-token'), false);
  const t = resolveTarget(source);
  assert.equal(t.remote, true);
  assert.equal(t.origin, 'https://floor.example.com');
});

test('saveChoice는 로컬 선택을 저장하고 다시 읽는다', () => {
  const { home, source } = envWith();
  assert.deepEqual(saveChoice({ mode: 'local' }, source), { ok: true });
  assert.deepEqual(JSON.parse(readFileSync(join(home, 'desktop.json'), 'utf8')), { mode: 'local' });
  assert.equal(resolveTarget(source).needsChoice, undefined);
});

test('saveChoice는 저장하지 못하면 오류를 돌려준다', () => {
  const { home } = envWith();
  const blocker = join(home, 'file');
  writeFileSync(blocker, 'x');
  const r = saveChoice({ mode: 'local' }, { AI_OFFICE_HOME: join(blocker, 'sub') });
  assert.equal(r.ok, false);
  assert.equal(typeof r.error, 'string');
});

test('currentChoice는 저장된 선택을 돌려준다', () => {
  const { home, source } = envWith();
  assert.equal(currentChoice(source), null);
  writeFileSync(join(home, 'desktop.json'), JSON.stringify({ mode: 'local' }));
  assert.deepEqual(currentChoice(source), { mode: 'local' });
  writeFileSync(join(home, 'desktop.json'), JSON.stringify({ url: 'https://floor.example.com/' }));
  assert.deepEqual(currentChoice(source), { url: 'https://floor.example.com' });
  writeFileSync(join(home, 'desktop.json'), JSON.stringify({ url: 'http://localhost:4317' }));
  assert.equal(currentChoice(source), null);
});

test('원격 서버를 볼 때만 Google 로그인 이동을 창 안에서 허용한다', () => {
  const remote = { remote: true, origin: 'https://floor.example.com' };
  assert.equal(allowInWindow(remote, 'https://floor.example.com/oauth2/callback?code=x'), true);
  assert.equal(allowInWindow(remote, 'https://accounts.google.com/v3/signin/identifier'), true);
  assert.equal(allowInWindow(remote, 'https://github.com/SeongGi/ai-office'), false);
  assert.equal(allowInWindow(remote, 'https://google.com.evil.example/'), false);
  assert.equal(allowInWindow(remote, 'http://accounts.google.com/'), false);
  const local = { remote: false, origin: 'http://127.0.0.1:4317' };
  assert.equal(allowInWindow(local, 'http://127.0.0.1:4317/?app=1'), true);
  assert.equal(allowInWindow(local, 'https://accounts.google.com/'), false);
});
