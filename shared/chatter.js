// 고양이들이 나누는 지어낸 대화의 대사를 만든다. 실제 작업 정보(activity, lastReply, 팀 작업)를 문장 틀에 끼운다.
// 난수는 인자로 받는 rnd만 쓴다. 브라우저 없이 시험할 수 있게 순수 함수로 둔다.

const LEAD = /^\s*(?:(?:>\s?|[-*+]\s+|\d+\.\s+)\s*)?(?:\[[ xX]\](?!\()\s*)?/;
const RULE = /^\s*[-*_]{3,}\s*$/;
const TABLE = /^\s*\|/;
const HEADING = /^\s*#{1,6}\s/;
const ZERO_WIDTH = /[​-‍﻿]/g;

/** 한 줄 대사로 쓸 수 있게 다듬는다: 마크다운과 줄바꿈을 지우고 첫 내용 문장만 남겨 max자로 자른다. */
export function cleanLine(text, max = 40) {
  if (typeof text !== 'string' || !text.trim()) return '';
  const lines = text
    .replace(ZERO_WIDTH, '')
    .replace(/```/g, '\n')
    .replace(/`/g, '')
    .split(/\r?\n/)
    .filter((l) => !RULE.test(l) && !TABLE.test(l) && !HEADING.test(l))
    .map((l) => l.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(LEAD, '').trim())
    .filter(Boolean);
  const sentences = [];
  for (let line of lines) {
    line = line
      .replace(/(?<![\w*/])\*\*(?=\S)([^*/]+?)(?<=\S)\*\*(?![\w*])/g, '$1')
      .replace(/(?<![\w/])__(?=\S)([^_/]+?)(?<=\S)__(?![\w.])/g, '$1')
      .replace(/(?<![\w*/])\*(?=[^\s*])([^*/]*?)(?<=[^\s*])\*(?![\w*])/g, '$1');
    for (const s of line.split(/(?<=[.!?])\s+/)) {
      const t = s.trim();
      if (t && !/[:：]$/.test(t)) sentences.push(t);
    }
  }
  if (!sentences.length) return '';
  let out = sentences[0];
  if ([...out].length < 6 && sentences[1]) out += ' ' + sentences[1];
  out = out.replace(/\s+/g, ' ').trim();
  const chars = [...out];
  if (chars.length > max) return chars.slice(0, max - 1).join('') + '…';
  return out;
}

/** 끝의 '읽는 중'은 '읽기'로, 그 밖의 ' 중'은 지운다. 가운데의 '실행 중: npm test'는 건드리지 않는다. */
function tidyTail(x) {
  if (/는 중$/.test(x)) return x.replace(/는 중$/, '기');
  return x.replace(/\s*중$/, '');
}

/** 고양이 한 마리가 지금 이야기할 거리: { kind, text }. 정리 결과가 비면 다음 조건으로 넘어간다(waiting만 예외). */
export function topicOf(agent, teamTask) {
  const pick = (kind, raw, tidy) => {
    let text = cleanLine(raw, tidy ? 200 : 40);
    if (tidy) text = cleanLine(tidyTail(text));
    return text ? { kind, text } : null;
  };
  const s = agent.status;
  const act = typeof agent.activity === 'string' ? agent.activity.trim() : '';
  let hit = null;
  if (s === 'error') hit = pick('error', act);
  if (!hit && s === 'waiting') {
    const text = /^Claude\b/.test(act) ? '' : cleanLine(act);
    return { kind: 'waiting', text };
  }
  if (!hit) {
    const asked = /^물어봤어요:\s*([\s\S]*)$/.exec(act);
    if (asked) hit = pick('asked', asked[1]);
    const fin = /^마쳤어요:\s*([\s\S]*)$/.exec(act);
    if (!hit && fin) hit = pick('done', fin[1], true);
  }
  if (!hit && (s === 'working' || s === 'thinking')) hit = pick('busy', act);
  if (!hit && (s === 'idle' || s === 'done')) hit = pick('done', agent.lastReply);
  return hit || pick('task', teamTask, true) || { kind: 'none', text: '' };
}

const OPEN = {
  busy: ['저 지금 {x}', '저는 {x}', '손이 바빠요. {x}'],
  done: ['방금 끝냈어요. {x}', '하나 끝냈어요. {x}', '막 마무리했어요. {x}'],
  error: ['막혔어요… {x}', '문제가 생겼어요. {x}', '으아, 에러가 났어요. {x}'],
  waiting: ['저 답 기다리는 중이에요. {x}', '승인을 기다리고 있어요. {x}', '잠깐 멈춰 있어요. {x}'],
  asked: ["'{x}' 부탁받았어요", "'{x}' 해 달래요", '방금 일을 받았어요. {x}'],
  task: ["요즘 '{x}' 하고 있어요", "저는 '{x}' 쪽을 보고 있어요", "'{x}' 때문에 바빠요"],
  ask: ['요즘 뭐 해요?', '지금 뭐 하고 있어요?', '요즘 어때요?'],
};

const REPLY = {
  busy: ['저는 {x}', '저는 지금 {x}', '저도 바빠요. {x}'],
  done: ['저도 방금 하나 끝냈어요. {x}', '저는 이걸 마무리했어요. {x}', '저도 한 건 끝냈어요. {x}'],
  error: ['저도 막혔어요. {x}', '저도 에러가 났어요. {x}', '저는 이런 문제가 있어요. {x}'],
  waiting: ['저는 승인 기다리는 중이에요', '저도 답을 기다려요', '저는 잠깐 멈춰 있어요'],
  asked: ["저는 '{x}' 부탁받았어요", "저는 '{x}' 해 달래요", '저도 방금 일을 받았어요. {x}'],
  task: ["저는 '{x}' 맡았어요", "저는 '{x}' 하고 있어요", "저는 '{x}' 쪽이에요"],
  none: ['오 좋네요!', '수고 많아요', '파이팅이에요!'],
};

// 이야깃거리 없이 기다리기만 하는 고양이(영어 알림 등)가 쓰는 틀
const OPEN_PLAIN = { waiting: ['저 답 기다리는 중이에요', '사람 답을 기다리고 있어요', '잠깐 멈춰 있어요'] };

const MOOD = ['커피 마시면서 하는 얘긴데,', '쉬다 보니 생각났는데,', '여기 앉은 김에 말인데,'];

const LINE_MAX = 50;
const MOOD_X_MAX = 30;

const pickOne = (list, rnd) => list[Math.min(list.length - 1, Math.floor(rnd() * list.length))];

function fill(tpl, to, x) {
  return tpl.replace(/\{(to|x)\}/g, (_, k) => (k === 'to' ? to : x)).replace(/\s+/g, ' ').trim();
}

/** 틀을 채우되 한 줄이 LINE_MAX자를 넘으면 이야깃거리를 줄인다. */
function build(tpl, to, x, prefix) {
  const head = prefix ? prefix + ' ' : '';
  let text = head + fill(tpl, to, prefix ? cleanLine(x, MOOD_X_MAX) : x);
  const chars = [...text];
  if (chars.length > LINE_MAX && x) {
    const over = chars.length - LINE_MAX;
    const keep = Math.max(4, [...(prefix ? cleanLine(x, MOOD_X_MAX) : x)].length - over);
    text = head + fill(tpl, to, cleanLine(x, keep));
  }
  const out = [...text];
  return out.length > LINE_MAX ? out.slice(0, LINE_MAX - 1).join('') + '…' : text;
}

/**
 * a가 말을 걸고 b가 받는 두 줄 대화. 둘 다 할 말이 없으면 null.
 * opts: { rnd, teamTaskA, teamTaskB, where: 'desk' | 'break' }
 */
export function makeChat(a, b, opts = {}) {
  const rnd = opts.rnd || Math.random;
  const ta = topicOf(a, opts.teamTaskA);
  const tb = topicOf(b, opts.teamTaskB);
  if (ta.kind === 'none' && tb.kind === 'none') return null;
  const openKind = ta.kind === 'none' ? 'ask' : ta.kind;
  const mood = opts.where === 'break' && rnd() < 0.5 ? pickOne(MOOD, rnd) : '';
  const openList = !ta.text && OPEN_PLAIN[openKind] ? OPEN_PLAIN[openKind] : OPEN[openKind];
  const open = build(pickOne(openList, rnd), b.name || b.id, ta.text, mood);
  const reply = build(pickOne(REPLY[tb.kind], rnd), a.name || a.id, tb.text, '');
  return [
    { from: a.id, to: b.id, text: open },
    { from: b.id, to: a.id, text: reply },
  ];
}
