import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_LINE, NPC_SCRIPTS } from '../shared/npcScripts.js';

const all = Object.entries(NPC_SCRIPTS).flatMap(([place, list]) => list.map((s, i) => ({ place, i, s })));
const TAGS = new Set(['nod', 'hop', 'sip', 'stretch', 'cheer']);

test('at least 40 scenarios and 8 per place', () => {
  assert.ok(all.length >= 40, `got ${all.length}`);
  for (const place of ['interview', 'info', 'lounge', 'banter']) assert.ok(NPC_SCRIPTS[place].length >= 8, place);
});

test('every scenario has 3 to 8 lines with a known speaker and tag', () => {
  for (const { place, i, s } of all) {
    assert.ok(s.length >= 3 && s.length <= 8, `${place}#${i} has ${s.length} lines`);
    for (const [slot, , tag] of s) {
      assert.ok(slot === 0 || slot === 1, `${place}#${i} slot`);
      if (tag) assert.ok(TAGS.has(tag), `${place}#${i} tag ${tag}`);
    }
  }
});

test('lines are short and use no forbidden characters', () => {
  const bad = /[·—一-鿿]|[A-Za-z]/;
  for (const { place, i, s } of all) {
    for (const [, text] of s) {
      assert.ok(text.length > 0 && text.length <= MAX_LINE, `${place}#${i} "${text}" is ${text.length} long`);
      assert.ok(!bad.test(text), `${place}#${i} "${text}" has a forbidden character`);
    }
  }
});

test('no line is repeated inside one place', () => {
  for (const [place, list] of Object.entries(NPC_SCRIPTS)) {
    const seen = new Set();
    for (const s of list) for (const [, text] of s) {
      assert.ok(!seen.has(text), `${place} repeats "${text}"`);
      seen.add(text);
    }
  }
});
