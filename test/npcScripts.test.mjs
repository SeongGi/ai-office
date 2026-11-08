import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_LINE, NPC_SCRIPTS, OFFICE_FALLBACK, fillOffice } from '../shared/npcScripts.js';
import { DEFAULT_OFFICE_NAME, OFFICE_NAME_MAX } from '../shared/officeName.js';

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
    for (const [, raw] of s) {
      // {office} 자리는 한글 이름으로 채워 검사한다(영문 이름은 사용자가 정하는 값이라 대상이 아니다).
      const text = fillOffice(raw, '성기 주식회사');
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

test('fillOffice: 짧은 이름은 바꾸고, 길면 이름 없는 대체 문장을 쓰며, 모든 결과가 MAX_LINE 이하다', () => {
  assert.equal(fillOffice('어서 오세요!', '아무개'), '어서 오세요!', '자리표시자가 없으면 그대로');
  assert.equal(fillOffice('{office}입니다', '성기 주식회사'), '성기 주식회사입니다');
  assert.equal(fillOffice('{office}입니다', DEFAULT_OFFICE_NAME), 'AI Office입니다');
  assert.equal(fillOffice('{office}입니다', '아주아주아주 긴 사무실 이름입니다'), '우리 회사입니다');
  assert.equal(fillOffice('여보세요? {office}요', '아주아주아주 긴 사무실 이름입니다'), '여보세요? 회사입니다');
  const names = ['가', '성기 주식회사', DEFAULT_OFFICE_NAME, 'a'.repeat(OFFICE_NAME_MAX), '😀'.repeat(OFFICE_NAME_MAX), '긴'.repeat(OFFICE_NAME_MAX)];
  const templated = Object.values(NPC_SCRIPTS).flat().flat().map((l) => l[1]).filter((t) => t.includes('{office}'));
  assert.ok(templated.length >= 2);
  for (const t of templated) {
    assert.ok(OFFICE_FALLBACK[t], `${t}에 대체 문장이 있다`);
    for (const name of names) assert.ok([...fillOffice(t, name)].length <= MAX_LINE, `${t} / ${name}`);
    assert.ok(!OFFICE_FALLBACK[t].includes('{office}') && [...OFFICE_FALLBACK[t]].length <= MAX_LINE);
  }
});
