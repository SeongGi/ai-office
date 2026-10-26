import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanLine, makeChat, topicOf } from '../shared/chatter.js';

const cat = (id, status, extra = {}) => ({ id, name: id.toUpperCase(), status, ...extra });
const seq = (...v) => {
  let i = 0;
  return () => v[i++ % v.length];
};

test('cleanLine strips markdown and newlines but keeps user_id and PR #12', () => {
  assert.equal(cleanLine('# 제목을 확인해요\n- **굵게** 읽는 중'), '제목을 확인해요');
  assert.equal(cleanLine('> 인용 `code` 확인 중'), '인용 code 확인 중');
  assert.equal(cleanLine('1. user_id 와 PR #12 고치는 중'), 'user_id 와 PR #12 고치는 중');
  assert.equal(cleanLine('*기울임* 그리고 __굵게__ 처리'), '기울임 그리고 굵게 처리');
  assert.equal(cleanLine('a  b\n\n c'), 'a b c');
});

test('cleanLine keeps the first sentence, or two when the first is very short', () => {
  assert.equal(cleanLine('테스트를 돌렸어요. 전부 통과했어요.'), '테스트를 돌렸어요.');
  assert.equal(cleanLine('네. 테스트를 돌렸어요. 통과했어요.'), '네. 테스트를 돌렸어요.');
  assert.equal(cleanLine('첫 줄이에요\n둘째 줄이에요'), '첫 줄이에요');
});

test('cleanLine cuts by code points with an ellipsis', () => {
  const out = cleanLine('가'.repeat(60));
  assert.equal([...out].length, 40);
  assert.ok(out.endsWith('…'));
  assert.equal(cleanLine('😀'.repeat(50), 10), '😀'.repeat(9) + '…');
  assert.equal(cleanLine('가나다', 3), '가나다');
});

test('cleanLine returns an empty string for empty or non-string input', () => {
  for (const v of ['', '   ', null, undefined, 42, {}, '```']) assert.equal(cleanLine(v), '');
});

test('topicOf follows the priority table', () => {
  const base = { activity: '빌드 중', lastReply: '끝났어요' };
  assert.deepEqual(topicOf(cat('a', 'error', base), '팀'), { kind: 'error', text: '빌드 중' });
  assert.deepEqual(topicOf(cat('a', 'waiting', base), '팀'), { kind: 'waiting', text: '빌드 중' });
  assert.deepEqual(topicOf(cat('a', 'working', base), '팀'), { kind: 'busy', text: '빌드 중' });
  assert.deepEqual(topicOf(cat('a', 'thinking', base), '팀'), { kind: 'busy', text: '빌드 중' });
  assert.deepEqual(topicOf(cat('a', 'idle', base), '팀'), { kind: 'done', text: '끝났어요' });
  assert.deepEqual(topicOf(cat('a', 'done', base), '팀'), { kind: 'done', text: '끝났어요' });
  assert.deepEqual(topicOf(cat('a', 'idle'), '결제 개편'), { kind: 'task', text: '결제 개편' });
  assert.deepEqual(topicOf(cat('a', 'offline'), undefined), { kind: 'none', text: '' });
});

test('topicOf falls through when the cleaned text is empty', () => {
  assert.deepEqual(topicOf(cat('a', 'working', { activity: '```' }), '팀 작업'), { kind: 'task', text: '팀 작업' });
  assert.deepEqual(topicOf(cat('a', 'idle', { lastReply: '  ' }), ''), { kind: 'none', text: '' });
});

test('makeChat returns null when neither cat has anything to say', () => {
  assert.equal(makeChat(cat('a', 'idle'), cat('b', 'idle'), { rnd: () => 0 }), null);
});

test('makeChat gives two lines with swapped from/to and the real activity', () => {
  const a = cat('a', 'working', { activity: '결제 API 고치는 중' });
  const b = cat('b', 'thinking', { activity: '테스트 읽는 중' });
  for (const r of [0, 0.4, 0.99]) {
    const [l1, l2] = makeChat(a, b, { rnd: () => r, where: 'desk' });
    assert.deepEqual([l1.from, l1.to, l2.from, l2.to], ['a', 'b', 'b', 'a']);
    assert.ok(l1.text.includes('결제 API 고치는 중'), l1.text);
    assert.ok(l2.text.includes('테스트 읽는 중'), l2.text);
  }
});

test('makeChat opens with a question when a has nothing to say', () => {
  const a = cat('a', 'idle');
  const b = cat('b', 'working', { activity: '문서 쓰는 중' });
  const [l1, l2] = makeChat(a, b, { rnd: () => 0 });
  assert.ok(l1.text.startsWith('B,'), l1.text);
  assert.ok(l1.text.endsWith('?'), l1.text);
  assert.ok(l2.text.includes('문서 쓰는 중'), l2.text);
});

test('makeChat keeps every line within 50 characters in a break room', () => {
  const long = '아주 긴 작업 설명이 계속 이어지는 경우를 가정해서 길게 쓴 문장이에요';
  const a = cat('a', 'working', { name: 'Longname', activity: long });
  const b = cat('b', 'error', { activity: long });
  for (const r of [0, 0.2, 0.49, 0.7, 0.99]) {
    for (const line of makeChat(a, b, { rnd: () => r, where: 'break' })) assert.ok([...line.text].length <= 50, line.text);
  }
  const prefixed = makeChat(a, b, { rnd: () => 0, where: 'break' })[0].text;
  assert.ok(prefixed.startsWith('커피 마시면서'), prefixed);
});

test('makeChat is deterministic for a fixed rnd', () => {
  const a = cat('a', 'working', { activity: '코드 읽는 중' });
  const b = cat('b', 'idle', { lastReply: '정리했어요' });
  const r = [0.3, 0.6, 0.1, 0.9];
  assert.deepEqual(makeChat(a, b, { rnd: seq(...r), where: 'break' }), makeChat(a, b, { rnd: seq(...r), where: 'break' }));
});

test('two idle cats with only a lastReply still chat in a break room', () => {
  const a = cat('a', 'idle', { lastReply: '리팩터링을 끝냈어요. 테스트도 통과했어요.' });
  const b = cat('b', 'done', { lastReply: '문서를 갱신했어요.' });
  const chat = makeChat(a, b, { rnd: () => 0.7, where: 'break' });
  assert.ok(chat);
  assert.ok(chat[0].text.includes('리팩터링을 끝냈어요.'), chat[0].text);
  assert.ok(chat[1].text.includes('문서를 갱신했어요.'), chat[1].text);
});
