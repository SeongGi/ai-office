import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FAREWELL_SCRIPTS, GOODBYES, MAX_LINE, NAME_MAX, fillName, pickFarewell } from '../shared/farewellScripts.js';

const bad = /[·—一-鿿]|\p{Extended_Pictographic}|[A-Za-z]/u;
const LONG = '가나다라마바사아자차카';

test('at least 24 scenarios with 2 to 4 speakers', () => {
  assert.ok(FAREWELL_SCRIPTS.length >= 24);
  for (const [i, s] of FAREWELL_SCRIPTS.entries()) {
    assert.ok(s.length >= 3 && s.length <= 6, `#${i} has ${s.length} lines`);
    const speakers = new Set(s.map(([slot]) => slot));
    assert.ok(speakers.size >= 2 && speakers.size <= 4, `#${i} has ${speakers.size} speakers`);
    for (const slot of speakers) assert.ok([0, 1, 2, 3].includes(slot), `#${i} slot ${slot}`);
  }
});

test('every line is 18 characters or fewer, even with a long name filled in', () => {
  const all = [...FAREWELL_SCRIPTS.flatMap((s) => s.map(([, t]) => t)), ...GOODBYES];
  for (const t of all) {
    for (const name of ['', '가', LONG, 'abcdefghijkl']) {
      const out = fillName(t, name);
      assert.ok(out.length > 0 && out.length <= MAX_LINE, `"${out}" is ${out.length}`);
      assert.ok(!out.includes('{'), `"${out}" kept a placeholder`);
    }
  }
});

test('name is clipped to 8 characters and a blank name gets a fallback', () => {
  assert.equal(fillName('{name} 님', LONG), `${LONG.slice(0, NAME_MAX)} 님`);
  assert.equal(fillName('{name} 님', '  '), '친구 님');
  assert.equal(fillName('수고했어요', LONG), '수고했어요');
  assert.ok(FAREWELL_SCRIPTS.some((s) => s.some(([, t]) => t.includes('{name}'))));
  assert.ok(FAREWELL_SCRIPTS.some((s) => s.every(([, t]) => !t.includes('{name}'))));
});

test('no banned characters (emoji, middle dot, em dash, hanja, latin)', () => {
  for (const s of FAREWELL_SCRIPTS) for (const [, t] of s) assert.ok(!bad.test(t.replaceAll('{name}', '')), `"${t}"`);
  for (const t of GOODBYES) assert.ok(!bad.test(t), `"${t}"`);
});

test('no scenario repeats within 5 picks', () => {
  let seed = 7;
  const rng = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const hist = [];
  for (let n = 0; n < 500; n++) {
    const { id, lines } = pickFarewell(rng, hist);
    assert.ok(!hist.slice(-5).includes(id), `pick ${n} repeated ${id}`);
    assert.equal(lines, FAREWELL_SCRIPTS[id]);
    hist.push(id);
  }
});

test('no line text repeats across scenarios', () => {
  const seen = new Set();
  for (const s of FAREWELL_SCRIPTS) for (const [, t] of s) {
    assert.ok(!seen.has(t), `repeated "${t}"`);
    seen.add(t);
  }
});
