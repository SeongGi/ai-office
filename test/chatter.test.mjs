import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanLine, makeChat, topicOf } from '../shared/chatter.js';

const cat = (id, status, extra = {}) => ({ id, name: id.toUpperCase(), status, ...extra });
const seq = (...v) => {
  let i = 0;
  return () => v[i++ % v.length];
};

test('cleanLine strips markdown and newlines but keeps user_id and PR #12', () => {
  assert.equal(cleanLine('# 제목을 확인해요\n- **굵게** 읽는 중'), '굵게 읽는 중');
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
  assert.equal(l1.text, '요즘 뭐 해요?');
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

test('makeChat keeps $ patterns in the topic as plain text', () => {
  const a = cat('a', 'working', { activity: '실행 중: echo $1 $&' });
  const b = cat('b', 'idle', { lastReply: '가격은 $5예요.' });
  const chat = makeChat(a, b, { rnd: () => 0 });
  assert.ok(chat[0].text.includes('echo $1 $&'), chat[0].text);
  assert.ok(chat[1].text.includes('$5'), chat[1].text);
});

test('busy lines do not double up the trailing 중', () => {
  const a = cat('a', 'working', { activity: 'CheckoutForm.tsx 고치는 중' });
  const b = cat('b', 'thinking', { activity: '다음 단계 계획하는 중' });
  for (const r of [0, 0.4, 0.8, 0.99]) {
    const chat = makeChat(a, b, { rnd: () => r });
    for (const l of chat) assert.ok(!/중 하는 중/.test(l.text), l.text);
  }
});

test('cleanLine drops links, rules, tables, headings and checkbox marks', () => {
  assert.equal(cleanLine('[설계 문서](http://x.y/z) 읽는 중'), '설계 문서 읽는 중');
  assert.equal(cleanLine('---\n결과를 정리했어요'), '결과를 정리했어요');
  assert.equal(cleanLine('| a | b |\n|---|---|\n결과를 정리했어요'), '결과를 정리했어요');
  assert.equal(cleanLine('- [x] 테스트 추가했어요'), '테스트 추가했어요');
  assert.equal(cleanLine('[ ] 문서 고치기'), '문서 고치기');
  assert.equal(cleanLine('## 요약\n본문을 읽는 중이에요'), '본문을 읽는 중이에요');
});

test('cleanLine removes emphasis only at word boundaries', () => {
  assert.equal(cleanLine('**/*.ts 파일 찾는 중'), '**/*.ts 파일 찾는 중');
  assert.equal(cleanLine('__init__.py 고치는 중'), '__init__.py 고치는 중');
  assert.equal(cleanLine('2*3*4 계산하는 중'), '2*3*4 계산하는 중');
  assert.equal(cleanLine('user_id 확인하는 중'), 'user_id 확인하는 중');
  assert.equal(cleanLine('**주문 API** 고치는 중'), '주문 API 고치는 중');
  assert.equal(cleanLine('*정말* 끝났어요'), '정말 끝났어요');
});

test('cleanLine drops zero-width characters and lead-in sentences ending with a colon', () => {
  assert.equal(cleanLine('\u200B\uFEFF' + '테스트 통과했어요'), '테스트 통과했어요');
  assert.equal(cleanLine('변경 사항을 정리하면 다음과 같습니다:\n테스트를 추가했어요'), '테스트를 추가했어요');
  assert.equal(cleanLine('다음과 같습니다:'), '');
});

test('topicOf reads asked and finished activities and tidies the tail', () => {
  assert.deepEqual(topicOf(cat('a', 'thinking', { activity: '물어봤어요: 로그인 고쳐 줘' })), { kind: 'asked', text: '로그인 고쳐 줘' });
  assert.deepEqual(topicOf(cat('a', 'idle', { activity: '마쳤어요: README.md 읽는 중' })), { kind: 'done', text: 'README.md 읽기' });
  assert.deepEqual(topicOf(cat('a', 'idle'), '테스트 실행 중'), { kind: 'task', text: '테스트 실행' });
  assert.equal(topicOf(cat('a', 'working', { activity: '실행 중: npm test' })).text, '실행 중: npm test');
  const [l1] = makeChat(cat('a', 'idle', { activity: '마쳤어요: README.md 읽는 중' }), cat('b', 'idle'), { rnd: () => 0 });
  assert.equal(l1.text, '방금 끝냈어요. README.md 읽기');
});

test('a waiting cat with an English notification talks without a topic', () => {
  const a = cat('a', 'waiting', { activity: 'Claude needs your permission to use Bash' });
  assert.deepEqual(topicOf(a), { kind: 'waiting', text: '' });
  const chat = makeChat(a, cat('b', 'working', { activity: '코드 읽는 중' }), { rnd: () => 0 });
  assert.equal(chat[0].text, '저 답 기다리는 중이에요');
  assert.ok(!/Claude/.test(chat[0].text));
});

test('names never leak into lines and a name like {x} does not eat the topic', () => {
  const a = cat('a', 'working', { name: '{x}', activity: '코드 읽는 중' });
  const b = cat('b', 'working', { name: '{x}', activity: '문서 쓰는 중' });
  for (const r of [0, 0.4, 0.99]) {
    const chat = makeChat(a, b, { rnd: () => r });
    assert.ok(chat[0].text.includes('코드 읽는 중'), chat[0].text);
    assert.ok(chat[1].text.includes('문서 쓰는 중'), chat[1].text);
    for (const l of chat) assert.ok(!/\{x\}|\{to\}/.test(l.text), l.text);
  }
});

test('lines stay within 50 characters for 60-character names and emoji topics', () => {
  const a = cat('a', 'working', { name: 'N'.repeat(60), activity: '😀'.repeat(60) });
  const b = cat('b', 'error', { name: 'M'.repeat(60), activity: '😀'.repeat(60) });
  for (const where of ['desk', 'break']) {
    for (const r of [0, 0.3, 0.7, 0.99]) {
      for (const l of makeChat(a, b, { rnd: () => r, where })) assert.ok([...l.text].length <= 50, l.text);
    }
  }
});

test('no line starts with the other cat name and a comma', () => {
  const a = cat('a', 'working', { name: 'Pixel', activity: '코드 읽는 중' });
  const b = cat('b', 'idle', { name: 'Ledger' });
  for (const r of [0, 0.4, 0.99]) {
    const [l1, l2] = makeChat(a, b, { rnd: () => r });
    assert.ok(!l1.text.includes('Ledger,'), l1.text);
    assert.ok(!l2.text.includes('Pixel,'), l2.text);
    const [m1] = makeChat(b, a, { rnd: () => r });
    assert.ok(!m1.text.includes('Pixel,'), m1.text);
  }
});
