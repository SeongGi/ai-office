// Pure helpers for the side panel. No DOM, so node:test can import them.
import { describeJob, displayName } from './role.js';
import { initialToolState, isIdleWait, stepToolRoom, toolRoom } from './places.js';

export const TOOL_CLASSES = ['library', 'server', 'search', 'other'];
export const TIMELINE_MAX = 15;
export const TEXT_MAX = 40;

export function toolClass(tool) {
  return toolRoom(tool) ?? 'other';
}

export function createTally() {
  return { primed: false, seen: new Map(), counts: { library: 0, server: 0, search: 0, other: 0 } };
}

/** Count a tool call each time an agent's toolAt changes. The first call only records what was already there. */
export function observeTools(tally, agents) {
  for (const a of Object.values(agents)) {
    const at = a.toolAt;
    const tool = a.lastTool ?? a.tool;
    if (at == null || !tool) continue;
    const prev = tally.seen.get(a.id);
    if (prev !== at) {
      tally.seen.set(a.id, at);
      if (tally.primed || prev !== undefined) tally.counts[toolClass(tool)] += 1;
    }
  }
  tally.primed = true;
  return tally.counts;
}

export function relTime(ts, now) {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 5) return '방금';
  if (s < 60) return `${s}초 전`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}분 전`;
  return `${Math.round(m / 60)}시간 전`;
}

/** Shorten to max chars, and hide anything that looks like an email or a long secret-like string. */
export function clipText(text, max = TEXT_MAX) {
  const t = String(text ?? '')
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, '…')
    .replace(/\b(?:sk|ghp|gho|xox[a-z]|AKIA|eyJ)[-_A-Za-z0-9.]{8,}/g, '…')
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '…')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

/** Newest-first events from every agent's history. */
export function buildRows(state, now, limit = TIMELINE_MAX) {
  const rows = [];
  for (const a of Object.values(state.agents)) {
    const team = state.teams[a.team];
    for (const h of a.history ?? []) {
      if (!h.text) continue;
      rows.push({ agentId: a.id, name: displayName(a, state.agents), hue: team?.hue ?? 0, ts: h.ts, kind: h.kind, text: clipText(h.text) });
    }
  }
  rows.sort((x, y) => y.ts - x.ts);
  return rows.slice(0, limit).map((r) => ({ ...r, rel: relTime(r.ts, now) }));
}

/** What each place is for: the plaque in the room (use, tools) and the panel guide (plain). */
export const ROOM_INFO = {
  library: { name: '냥서재', use: '파일 읽기와 찾기', tools: 'Read, Grep, Glob', plain: '파일 읽기, 찾기' },
  server: { name: '냥서버실', use: '명령 실행, 빌드, 배포', tools: 'Bash', plain: '명령 실행, 빌드' },
  search: { name: '냥탐색실', use: '웹 검색, 자료 가져오기', tools: 'WebSearch, WebFetch, MCP', plain: '웹 검색, 자료 가져오기' },
  desk: { name: '냥작업대', use: '수정, 글쓰기 등', tools: 'Edit, Write', plain: '수정, 글쓰기 등' },
};
export const GUIDE_PLACES = ['library', 'server', 'search', 'desk'];
/** 방(place)과 도구 집계 분류(toolClass)의 짝. 책상만 이름이 다르다. */
export const PLACE_CLASS = { library: 'library', server: 'server', search: 'search', desk: 'other' };

/** Tiny tag for a cat in a tool room: 'Grep: 로그인 함수 찾는 중', the whole text cut to max characters. */
export function toolTag(tool, activity, max = 14) {
  const head = clipText(tool, 99).slice(0, 10);
  if (!head) return '';
  let rest = String(activity ?? '').replace(/^Using\s+\S+\s*/, '').trim();
  if (rest === tool) rest = '';
  if (!rest) return head;
  return clipText(`${head}: ${rest}`, max);
}

/**
 * Live head count per place for the panel, from the same dwell rules the renderers use.
 * `memo` (a Map) keeps each cat's dwell state between calls; call it about once a second.
 * desk = working cats that are not in a tool room. Subagents are not counted.
 */
export function liveRoomCounts(memo, agents, nowMs) {
  const out = { library: 0, server: 0, search: 0, desk: 0 };
  for (const a of Object.values(agents)) {
    if (a.parent) continue;
    let st = memo.get(a.id);
    if (!st) memo.set(a.id, (st = initialToolState(a, nowMs)));
    const room = stepToolRoom(st, a, nowMs);
    if (room) out[room] += 1;
    else if (a.status === 'working' || a.status === 'thinking' || a.status === 'waiting' || a.status === 'error') out.desk += 1;
  }
  for (const id of memo.keys()) if (!agents[id]) memo.delete(id);
  return out;
}

export const MAX_SUBS = 8;
const ACTIVE = new Set(['working', 'thinking', 'waiting']);

function entry(a, name, now) {
  const job = describeJob(a);
  return {
    id: a.id,
    name,
    hue: 0,
    status: a.status,
    idleWait: isIdleWait(a),
    role: job.role,
    doing: job.doing,
    kind: job.kind,
    rel: relTime(a.statusSince ?? a.lastSeen ?? now, now),
  };
}

/** 직원 목록: 메인 에이전트 순서(일하는 쪽 먼저, 퇴근은 뒤)와 그 밑의 서브에이전트. offline은 뺀다. */
export function buildRoster(state, now) {
  const agents = Object.values(state.agents);
  const teamOrder = (a) => state.teams[a.team]?.order ?? 0;
  const rank = (a) => (ACTIVE.has(a.status) ? 0 : 1);
  const subsOf = new Map();
  for (const a of agents) {
    if (!a.parent || a.status === 'offline') continue;
    if (!subsOf.has(a.parent)) subsOf.set(a.parent, []);
    subsOf.get(a.parent).push(a);
  }
  const mains = agents
    .filter((a) => !a.parent && a.status !== 'offline')
    .sort((x, y) => rank(x) - rank(y) || teamOrder(x) - teamOrder(y) || String(x.name).localeCompare(String(y.name)));
  return mains.map((m) => {
    const hue = state.teams[m.team]?.hue ?? 0;
    const all = (subsOf.get(m.id) ?? []).sort((x, y) => rank(x) - rank(y) || (x.joinedAt ?? 0) - (y.joinedAt ?? 0) || String(x.name).localeCompare(String(y.name)));
    const subs = all.slice(0, MAX_SUBS).map((s) => ({ ...entry(s, displayName(s, state.agents), now), hue }));
    return { ...entry(m, m.name, now), hue, subs, moreSubs: Math.max(0, all.length - MAX_SUBS) };
  });
}
