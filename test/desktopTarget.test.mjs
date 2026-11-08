// 데스크톱 앱이 창에 띄울 서버를 정하는 규칙(desktop/target.cjs)을 확인한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { resolveTarget, remoteOrigin, allowInWindow } = createRequire(import.meta.url)('../desktop/target.cjs');

/** 상태 폴더를 임시 폴더로 둔 환경을 만든다. */
function envWith(vars = {}) {
  const home = mkdtempSync(join(tmpdir(), 'ai-office-desktop-'));
  return { home, source: { AI_OFFICE_HOME: home, ...vars } };
}

test('원격 주소가 없으면 로컬 서버를 연다', () => {
  const { home, source } = envWith({ AI_OFFICE_PORT: '4395' });
  const t = resolveTarget(source);
  assert.equal(t.remote, false);
  assert.equal(t.url, 'http://127.0.0.1:4395/?app=1');
  assert.equal(t.port, 4395);
  assert.equal(existsSync(join(home, 'desktop.json')), false);
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
