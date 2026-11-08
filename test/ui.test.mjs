// 화면 코드 스모크 테스트: 캔버스 없이 돌아가는 스토어, 라벨, 색, 2D 카메라를 실제 모듈로 검증한다.
// walls.test.mjs와 같은 방식으로 rolldown이 TypeScript를 임시 파일로 번들한다.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { rolldown } from 'rolldown';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let M;
let dir;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'ai-office-ui-'));
  const out = join(dir, 'ui.mjs');
  const bundle = await rolldown({ input: join(root, 'test/support/ui.entry.ts'), platform: 'node', logLevel: 'silent' });
  await bundle.write({ file: out, format: 'esm' });
  M = await import(pathToFileURL(out).href);
});

after(() => dir && rmSync(dir, { recursive: true, force: true }));

const STATUSES = ['idle', 'thinking', 'working', 'waiting', 'done', 'error', 'offline'];

test('스토어: 로컬 이벤트가 상태와 구독자에게 반영된다', () => {
  const { store } = M;
  let notified = 0;
  const off = store.subscribe(() => notified++);
  store.applyLocal({ type: 'join', agent: 'a1', team: 'T' });
  assert.ok(store.state.agents.a1, '에이전트가 들어온다');
  assert.ok(notified >= 1, '구독자가 호출된다');
  store.applyLocal({ type: 'bogus' });
  assert.equal(Object.keys(store.state.agents).length, 1, '잘못된 이벤트는 무시한다');
  off();
});

test('스토어: select와 setMode는 값이 같으면 알리지 않는다', () => {
  const { store } = M;
  let notified = 0;
  const off = store.subscribe(() => notified++);
  store.select('a1');
  store.select('a1');
  store.setMode('demo');
  store.setMode('demo');
  assert.equal(notified, 2);
  off();
});

test('스토어: 에이전트를 지우면 빈 팀과 선택이 함께 정리된다', () => {
  const { store } = M;
  store.select('a1');
  store.remove(['a1']);
  assert.equal(store.state.agents.a1, undefined);
  assert.equal(store.selected, null);
  assert.equal(Object.keys(store.state.teams).length, 0);
});

test('라벨: 모든 상태에 한글 문구가 있다', () => {
  for (const s of STATUSES) {
    assert.ok(M.STATUS_LABEL_KO[s], `STATUS_LABEL_KO.${s}`);
    assert.ok(M.PILL_KO[s], `PILL_KO.${s}`);
  }
});

test('라벨: pillDetail은 공백을 접고 길면 말줄임표로 줄인다', () => {
  assert.equal(M.pillDetail(undefined), '');
  assert.equal(M.pillDetail('  a \n  b  '), 'a b');
  const out = M.pillDetail('가'.repeat(30), 18);
  assert.equal(out.length, 18);
  assert.ok(out.endsWith('…'));
});

test('색: mix와 hsl이 #rrggbb 형식을 지킨다', () => {
  assert.equal(M.mix('#000000', '#ffffff', 0.5), '#808080');
  assert.equal(M.mix('#fff', '#000', 0), '#ffffff', '3자리 표기를 풀어 쓴다');
  assert.equal(M.lighten('#000000', 1), '#ffffff');
  assert.equal(M.darken('#ffffff', 1), '#000000');
  assert.equal(M.rgba('#ff0000', 0.5), 'rgba(255,0,0,0.5)');
  assert.equal(M.hsl(0, 1, 0.5), '#ff0000');
  assert.match(M.hsl(200, 0.6, 0.4), /^#[0-9a-f]{6}$/);
});

test('카메라: toScreen과 toWorld는 서로 역변환이다', () => {
  const c = new M.Camera2D();
  c.w = 800;
  c.h = 600;
  c.x = 3;
  c.z = -2;
  c.zoom = 1.7;
  const [sx, sy] = c.toScreen(5, 4);
  const [wx, wz] = c.toWorld(sx, sy);
  assert.ok(Math.abs(wx - 5) < 1e-9 && Math.abs(wz - 4) < 1e-9);
});

test('카메라: zoomAt은 커서 아래 세계 좌표를 고정하고 배율 한계를 지킨다', () => {
  const c = new M.Camera2D();
  c.w = 800;
  c.h = 600;
  const before = c.toWorld(200, 150);
  c.zoomAt(200, 150, 2);
  const after = c.toWorld(200, 150);
  assert.ok(Math.abs(before[0] - after[0]) < 1e-9 && Math.abs(before[1] - after[1]) < 1e-9);
  c.zoomAt(200, 150, 1e6);
  assert.equal(c.zoom, M.MAX_ZOOM);
  c.zoomAt(200, 150, 1e-9);
  assert.equal(c.zoom, M.MIN_ZOOM);
});

test('카메라: flyTo는 목표에 수렴해서 멈추고, instant는 바로 이동한다', () => {
  const c = new M.Camera2D();
  c.w = 800;
  c.h = 600;
  c.flyTo(10, 5, 2);
  assert.equal(c.flying, true);
  let frames = 0;
  while (c.update(1 / 60) && frames++ < 1200);
  assert.equal(c.flying, false, '1200프레임 안에 도착한다');
  assert.deepEqual([c.x, c.z, c.zoom], [10, 5, 2]);
  c.flyTo(-4, 1, 1, true);
  assert.deepEqual([c.x, c.z, c.zoom, c.flying], [-4, 1, 1, false]);
});

test('카메라: grab하면 비행이 끊긴다', () => {
  const c = new M.Camera2D();
  c.flyTo(10, 5, 2);
  c.grab();
  assert.equal(c.flying, false);
  assert.equal(c.update(1 / 60), false);
});
