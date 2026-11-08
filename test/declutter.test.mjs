// 이름표 겹침 해소(declutter)와 HUD 도우미를 DOM 없이 검증한다. rolldown으로 실제 TypeScript를 번들한다.
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
  dir = mkdtempSync(join(tmpdir(), 'ai-office-declutter-'));
  const out = join(dir, 'declutter.mjs');
  const bundle = await rolldown({ input: join(root, 'test/support/declutter.entry.ts'), platform: 'node', logLevel: 'silent' });
  await bundle.write({ file: out, format: 'esm' });
  M = await import(pathToFileURL(out).href);
});

after(() => dir && rmSync(dir, { recursive: true, force: true }));

const tag = (ax, ay, over = {}) => ({ hot: false, ax, ay, s: 1, w: 100, h: 40, vh: 40, tx: 0, ty: 0, ox: 0, oy: 0, shown: false, ...over });
const box = (t) => ({ x0: t.ax - t.w / 2 + t.tx, y0: t.ay - t.h + t.ty, x1: t.ax + t.w / 2 + t.tx, y1: t.ay - t.h + t.ty + t.vh });
const overlap = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

test('declutter: 떨어져 있는 태그는 움직이지 않는다', () => {
  const list = [tag(100, 300), tag(500, 300)];
  M.declutter(list, 1 / 60, [], 1000);
  for (const t of list) assert.deepEqual([t.tx, t.ty], [0, 0]);
});

test('declutter: 겹치는 태그는 서로 겹치지 않는 위치로 옮긴다', () => {
  const list = [tag(300, 300), tag(310, 300), tag(320, 305), tag(290, 295)];
  M.declutter(list, 1 / 60, [], 1000);
  const boxes = list.map(box);
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) assert.ok(!overlap(boxes[i], boxes[j]), `${i}와 ${j}가 겹친다`);
});

test('declutter: 호버나 선택된 태그가 먼저 위치를 정한다', () => {
  const list = [tag(300, 300), tag(305, 300, { hot: true })];
  M.declutter(list, 1 / 60, [], 1000);
  assert.deepEqual([list[0].hot, list[0].tx, list[0].ty], [true, 0, 0], '정렬 뒤 첫 태그는 hot이고 그대로 있다');
  assert.ok(list[1].tx !== 0 || list[1].ty !== 0, '나머지가 비켜 난다');
});

test('declutter: 첫 프레임은 바로 위치를 정하고 이후에는 부드럽게 따라간다', () => {
  const list = [tag(300, 300), tag(305, 300)];
  M.declutter(list, 1 / 60, [], 1000);
  const moved = list.find((t) => t.tx !== 0 || t.ty !== 0);
  assert.equal(moved.shown, true);
  assert.deepEqual([moved.ox, moved.oy], [moved.tx, moved.ty]);
  moved.ox = 0;
  moved.oy = 0;
  M.declutter(list, 1 / 60, [], 1000);
  const m2 = list.find((t) => t.tx !== 0 || t.ty !== 0);
  assert.ok(Math.abs(m2.ox) < Math.abs(m2.tx) || Math.abs(m2.oy) < Math.abs(m2.ty), '한 번에 목표까지 가지 않는다');
});

test('declutter: 화면 안쪽 위치를 먼저 찾는다', () => {
  const list = [tag(50, 200, { w: 90 }), tag(60, 200, { w: 90 })];
  M.declutter(list, 1 / 60, [], 400);
  const b = list.map(box);
  assert.ok(b.every((x) => x.x0 >= 4 && x.x1 <= 396 && x.y0 >= 4), '가장자리를 넘지 않는다');
});

test('dom: esc는 HTML 특수문자를 막고 ago는 시간을 한글로 쓴다', () => {
  assert.equal(M.esc(`<a href="x">&'</a>`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  const now = Date.now();
  assert.equal(M.ago(now), '방금');
  assert.equal(M.ago(now - 30_000), '30초 전');
  assert.equal(M.ago(now - 5 * 60_000), '5분 전');
  assert.equal(M.ago(now - 3 * 3600_000), '3시간 전');
});
