// 고양이들이 나누는 지어낸 대화의 대사를 만든다. 실제 작업 정보(activity, lastReply, 팀 작업)를 문장 틀에 끼운다.
// 난수는 인자로 받는 rnd만 쓴다. 브라우저 없이 시험할 수 있게 순수 함수로 둔다.

const MARKS = /^\s*(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+\.\s+)/;

/** 한 줄 대사로 쓸 수 있게 다듬는다: 마크다운과 줄바꿈을 지우고 첫 문장만 남겨 max자로 자른다. */
export function cleanLine(text, max = 40) {
  if (typeof text !== 'string' || !text.trim()) return '';
  const lines = text
    .replace(/```/g, '\n')
    .replace(/`/g, '')
    .split(/\r?\n/)
    .map((l) => l.replace(MARKS, '').trim())
    .filter(Boolean);
  const sentences = [];
  for (let line of lines) {
    line = line
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/__(.+?)__/g, '$1')
      .replace(/\*([^*\s](?:[^*]*[^*\s])?)\*/g, '$1');
    for (const s of line.split(/(?<=[.!?])\s+/)) if (s.trim()) sentences.push(s.trim());
  }
  if (!sentences.length) return '';
  let out = sentences[0];
  if ([...out].length < 6 && sentences[1]) out += ' ' + sentences[1];
  out = out.replace(/\s+/g, ' ').trim();
  const chars = [...out];
  if (chars.length > max) return chars.slice(0, max - 1).join('') + '…';
  return out;
}

/** 고양이 한 마리가 지금 이야기할 거리: { kind, text }. 정리 결과가 비면 다음 조건으로 넘어간다. */
export function topicOf(agent, teamTask) {
  const pick = (kind, raw) => {
    const text = cleanLine(raw);
    return text ? { kind, text } : null;
  };
  const s = agent.status;
  let hit = null;
  if (s === 'error') hit = pick('error', agent.activity);
  if (!hit && s === 'waiting') hit = pick('waiting', agent.activity);
  if (!hit && (s === 'working' || s === 'thinking')) hit = pick('busy', agent.activity);
  if (!hit && (s === 'idle' || s === 'done')) hit = pick('done', agent.lastReply);
  return hit || pick('task', teamTask) || { kind: 'none', text: '' };
}

const OPEN = {
  busy: ['{to}, 저 지금 {x}', '{to}, 저는 {x}', '{to}, 손이 바빠요. {x}'],
  done: ['방금 끝냈어요. {x}', '{to}, 하나 끝냈어요. {x}', '막 마무리했어요. {x}'],
  error: ['막혔어요… {x}', '{to}, 문제가 생겼어요. {x}', '으아, 에러가 났어요. {x}'],
  waiting: ['저 답 기다리는 중이에요. {x}', '{to}, 승인을 기다리고 있어요. {x}', '잠깐 멈춰 있어요. {x}'],
  task: ["요즘 '{x}' 하고 있어요", "{to}, 저는 '{x}' 쪽을 보고 있어요", "'{x}' 때문에 바빠요"],
  ask: ['{to}, 요즘 뭐 해요?', '{to}, 지금 뭐 하고 있어요?', '{to}, 요즘 어때요?'],
};

const REPLY = {
  busy: ['저는 {x}', '저는 지금 {x}', '저도 바빠요. {x}'],
  done: ['저도 방금 하나 끝냈어요. {x}', '저는 이걸 마무리했어요. {x}', '저도 한 건 끝냈어요. {x}'],
  error: ['저도 막혔어요. {x}', '저도 에러가 났어요. {x}', '저는 이런 문제가 있어요. {x}'],
  waiting: ['저는 승인 기다리는 중이에요', '저도 답을 기다려요', '저는 잠깐 멈춰 있어요'],
  task: ["저는 '{x}' 맡았어요", "저는 '{x}' 하고 있어요", "저는 '{x}' 쪽이에요"],
  none: ['오 좋네요!', '수고 많아요', '파이팅이에요!'],
};

const MOOD = ['커피 마시면서 하는 얘긴데,', '쉬다 보니 생각났는데,', '여기 앉은 김에 말인데,'];

const LINE_MAX = 50;
const MOOD_X_MAX = 30;

const pickOne = (list, rnd) => list[Math.min(list.length - 1, Math.floor(rnd() * list.length))];

function fill(tpl, to, x) {
  return tpl.replace('{to}', () => to).replace('{x}', () => x).replace(/\s+/g, ' ').trim();
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
  const open = build(pickOne(OPEN[openKind], rnd), b.name || b.id, ta.text, mood);
  const reply = build(pickOne(REPLY[tb.kind], rnd), a.name || a.id, tb.text, '');
  return [
    { from: a.id, to: b.id, text: open },
    { from: b.id, to: a.id, text: reply },
  ];
}
