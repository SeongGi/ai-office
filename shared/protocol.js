// AI Office event protocol + reducer.
// Shared verbatim by the Node server and the browser, so both always agree on world state.
// Plain ESM JavaScript with zero dependencies. Types live in protocol.d.ts.

export const PROTOCOL_VERSION = 1;

export const STATUSES = ['idle', 'thinking', 'working', 'waiting', 'done', 'error', 'offline'];

export const EVENT_TYPES = ['join', 'status', 'tool', 'message', 'task', 'leave', 'reset', 'meeting', 'rename'];

export const WAIT_KINDS = ['idle', 'permission'];

export const MEETING_MS = 10 * 60_000;
const SYSTEM_AGENT = 'system';

const MAX_HISTORY = 24;
const MAX_TEXT = 280;
const LEFT_IGNORE_MS = 6 * 60 * 60_000;

export function createState() {
  return { teams: {}, agents: {}, seq: 0, updatedAt: 0 };
}

export function slug(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'default';
}

function clip(text, max = MAX_TEXT) {
  if (text == null) return undefined;
  const s = String(text).replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function titleCase(value) {
  return String(value)
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Validate and normalise anything a client posts. Unknown fields are dropped.
 * Returns null when the event is unusable.
 */
export function normalizeEvent(raw, now = Date.now()) {
  if (!raw || typeof raw !== 'object') return null;
  const type = EVENT_TYPES.includes(raw.type) ? raw.type : null;
  if (!type) return null;
  if (type === 'reset') return { type, ts: now };

  const agentRaw = typeof raw.agent === 'object' && raw.agent ? raw.agent : { id: raw.agent };
  let agentId = agentRaw.id != null ? String(agentRaw.id).slice(0, 128) : null;
  if (!agentId && type === 'meeting') agentId = SYSTEM_AGENT;
  if (!agentId) return null;
  if (type === 'meeting') {
    if (raw.meeting !== 'start' && raw.meeting !== 'end') return null;
    const ev = {
      type,
      ts: Number.isFinite(raw.ts) ? raw.ts : now,
      agent: agentId,
      meeting: raw.meeting,
      text: clip(raw.text, 80),
    };
    if (raw.all === true) ev.all = true;
    if (ev.text === undefined) delete ev.text;
    return ev;
  }

  if (type === 'rename') {
    // 관리자가 직원 이름을 고친 것. 서버 안에서만 만들고, 이름이 비면 쓸 수 없다.
    const name = clip(raw.name, 40);
    return name ? { type, ts: Number.isFinite(raw.ts) ? raw.ts : now, agent: agentId, name } : null;
  }

  const teamRaw = typeof raw.team === 'object' && raw.team ? raw.team : { name: raw.team };
  const teamName = clip(teamRaw.name ?? teamRaw.id, 48);

  const ev = {
    type,
    ts: Number.isFinite(raw.ts) ? raw.ts : now,
    agent: agentId,
    name: clip(raw.name ?? agentRaw.name, 40),
    role: clip(raw.role ?? agentRaw.role, 40),
    source: clip(raw.source ?? agentRaw.source, 32),
    parent: raw.parent != null ? String(raw.parent).slice(0, 128) : undefined,
    model: clip(raw.model, 64),
    cwd: clip(raw.cwd, 200),
    branch: clip(raw.branch, 80),
    team: teamName ? slug(teamRaw.id ?? teamName) : undefined,
    teamName,
    status: STATUSES.includes(raw.status) ? raw.status : undefined,
    activity: clip(raw.activity),
    tool: clip(raw.tool, 40),
    text: clip(raw.text),
    task: clip(raw.task, 120),
    // 마지막 질문과 답, 권한 모드. 메인 세션에만 적용된다(applyEvent).
    lastPrompt: clip(raw.lastPrompt, 300),
    lastReply: clip(raw.lastReply, 600),
    permission: clip(raw.permission, 24),
    // 기다리는 이유. 알림 훅이 알려 줄 때만 있다: idle(입력 대기) 또는 permission(권한 확인).
    waitKind: WAIT_KINDS.includes(raw.waitKind) ? raw.waitKind : undefined,
    to: undefined,
    subagent: undefined,
  };

  if (raw.to != null) {
    const list = Array.isArray(raw.to) ? raw.to : [raw.to];
    ev.to = list.filter((x) => x != null).map((x) => String(x).slice(0, 128)).slice(0, 16);
  }
  // Adapters that only know "a subagent of type X under session Y" pass a hint.
  // The reducer binds the hint to a concrete desk (see resolveSubagent).
  if (raw.subagent && typeof raw.subagent === 'object') {
    ev.subagent = {
      key: raw.subagent.key != null ? String(raw.subagent.key).slice(0, 128) : undefined,
      type: clip(raw.subagent.type, 40),
    };
  }
  for (const k of Object.keys(ev)) if (ev[k] === undefined) delete ev[k];
  return ev;
}

const TEAM_HUES = [212, 152, 28, 340, 262, 188, 96, 8];

function ensureTeam(state, id, name, now) {
  let team = state.teams[id];
  if (!team) {
    const order = Object.keys(state.teams).length;
    team = state.teams[id] = {
      id,
      name: name || titleCase(id),
      hue: TEAM_HUES[order % TEAM_HUES.length],
      order,
      task: undefined,
      createdAt: now,
    };
  } else if (name && team.name !== name) {
    team.name = name;
  }
  return team;
}

function ensureAgent(state, ev, now) {
  let agent = state.agents[ev.agent];
  const teamId = ev.team || agent?.team || (ev.parent && state.agents[ev.parent]?.team) || 'default';
  ensureTeam(state, teamId, ev.teamName, now);
  if (!agent) {
    agent = state.agents[ev.agent] = {
      id: ev.agent,
      name: ev.name || titleCase(ev.agent.split(/[:/]/).pop() || ev.agent),
      role: ev.role || 'Agent',
      team: teamId,
      source: ev.source || 'custom',
      parent: ev.parent,
      model: ev.model,
      cwd: ev.cwd,
      branch: ev.branch,
      status: 'idle',
      activity: undefined,
      tool: undefined,
      joinedAt: now,
      lastSeen: now,
      statusSince: now,
      history: [],
      boundKey: undefined,
    };
  } else {
    // 훅이 보내는 기본 이름(Claude, Codex)은 세션 제목처럼 구체적인 이름을 덮어쓰지 않는다.
    if (ev.name && !(agent.name && (ev.name === 'Claude' || ev.name === 'Codex'))) agent.name = ev.name;
    if (ev.role) agent.role = ev.role;
    if (ev.source) agent.source = ev.source;
    if (ev.parent) agent.parent = ev.parent;
    if (ev.model) agent.model = ev.model;
    if (ev.cwd) agent.cwd = ev.cwd;
    if (ev.branch) agent.branch = ev.branch;
    if (ev.team && ev.team !== agent.team) agent.team = ev.team;
    agent.lastSeen = now;
  }
  return agent;
}

/**
 * When an adapter reports work done inside a subagent it can only say
 * "subagent of type T (opaque key K) under parent P". Bind that to the oldest
 * unbound, still-active desk of the same type, or open a new desk.
 */
function resolveSubagent(state, ev) {
  if (!ev.subagent) return ev;
  const parentId = ev.agent;
  const { key, type } = ev.subagent;
  const children = Object.values(state.agents).filter((a) => a.parent === parentId);
  let match = key && children.find((a) => a.boundKey === key);
  if (!match && type) {
    match = children
      .filter((a) => !a.boundKey && a.role === type && a.status !== 'done' && a.status !== 'offline')
      .sort((a, b) => a.joinedAt - b.joinedAt)[0];
    if (match && key) match.boundKey = key;
  }
  const id = match ? match.id : `${parentId}:${key || slug(type || 'sub')}`;
  const next = { ...ev, agent: id, parent: parentId, role: ev.role || type };
  delete next.subagent;
  if (!match && key) {
    next.__bindKey = key;
  }
  return next;
}

function pushHistory(agent, entry) {
  agent.history.push(entry);
  if (agent.history.length > MAX_HISTORY) agent.history.splice(0, agent.history.length - MAX_HISTORY);
}

/**
 * Apply one normalised event. Mutates and returns state.
 * Also returns `effects`: transient things the renderer animates (messages, arrivals).
 */
export function applyEvent(state, rawEv) {
  const effects = [];
  if (!rawEv) return { state, effects };
  const now = rawEv.ts || Date.now();
  state.seq += 1;
  state.updatedAt = now;

  if (rawEv.type === 'reset') {
    state.teams = {};
    state.agents = {};
    state.left = {};
    effects.push({ kind: 'reset' });
    return { state, effects };
  }

  if (rawEv.type === 'meeting') {
    const who = state.agents[rawEv.agent];
    if (rawEv.meeting === 'end') {
      delete state.meeting;
      effects.push({ kind: 'meeting', on: false });
    } else {
      const team = who && !rawEv.all ? who.team : '*';
      state.meeting = { team, startedAt: now, endsAt: now + MEETING_MS };
      if (rawEv.text) state.meeting.topic = rawEv.text;
      if (who) state.meeting.by = who.id;
      effects.push({ kind: 'meeting', on: true, ...(rawEv.text ? { topic: rawEv.text } : {}) });
    }
    return { state, effects };
  }

  // 이름 고치기는 이미 있는 직원에게만 쓴다. 기본 이름 규칙을 거치지 않고, 기록과 상태와 lastSeen을 건드리지 않는다.
  if (rawEv.type === 'rename') {
    const who = state.agents[rawEv.agent];
    if (who && rawEv.name) who.name = rawEv.name;
    return { state, effects };
  }

  const ev = resolveSubagent(state, rawEv);
  // A dismissed agent ignores late non-join events for 30 s; a join brings it back.
  const leftAt = state.left?.[ev.agent];
  if (leftAt !== undefined) {
    if (ev.type !== 'join' && now - leftAt < LEFT_IGNORE_MS) return { state, effects };
    delete state.left[ev.agent];
  }
  const existed = Boolean(state.agents[ev.agent]);
  const agent = ensureAgent(state, ev, now);
  if (ev.__bindKey) agent.boundKey = ev.__bindKey;
  if (!agent.parent) {
    if (ev.lastPrompt) agent.lastPrompt = ev.lastPrompt;
    if (ev.lastReply) agent.lastReply = ev.lastReply;
    if (ev.permission) agent.permission = ev.permission;
  }
  if (!existed || agent.status === 'offline') effects.push({ kind: 'arrive', agent: agent.id });
  const statusBefore = agent.status;

  switch (ev.type) {
    case 'join': {
      agent.status = ev.status || 'idle';
      if (ev.activity) agent.activity = ev.activity;
      if (ev.parent) {
        // A spawned agent: the parent briefs it.
        effects.push({ kind: 'message', from: ev.parent, to: agent.id, text: ev.text || ev.activity || 'New task' });
      }
      pushHistory(agent, { ts: now, kind: 'join', text: ev.activity || 'Joined' });
      break;
    }
    case 'status': {
      if (ev.status) agent.status = ev.status;
      if (ev.activity !== undefined) agent.activity = ev.activity;
      if (ev.status && ev.status !== 'working') {
        if (agent.tool) agent.toolEndAt = now;
        agent.tool = undefined;
      }
      pushHistory(agent, { ts: now, kind: 'status', status: agent.status, text: ev.activity || agent.status });
      break;
    }
    case 'tool': {
      agent.status = ev.status || 'working';
      agent.tool = ev.tool;
      // lastTool/toolAt/toolEndAt outlive the status change; the renderers decide from them which tool room a cat uses.
      if (ev.tool) {
        agent.lastTool = ev.tool;
        agent.toolAt = now;
      }
      agent.activity = ev.activity || (ev.tool ? `Using ${ev.tool}` : agent.activity);
      pushHistory(agent, { ts: now, kind: 'tool', tool: ev.tool, text: agent.activity });
      break;
    }
    case 'message': {
      const targets = ev.to?.length ? ev.to : agent.parent ? [agent.parent] : [];
      for (const to of targets) {
        if (!state.agents[to]) {
          ensureAgent(state, { agent: to, team: agent.team }, now);
          effects.push({ kind: 'arrive', agent: to });
        }
        effects.push({ kind: 'message', from: agent.id, to, text: ev.text || '' });
      }
      if (ev.status) agent.status = ev.status;
      pushHistory(agent, { ts: now, kind: 'message', to: targets, text: ev.text || '' });
      break;
    }
    case 'task': {
      const team = state.teams[agent.team];
      if (team && ev.task) team.task = ev.task;
      if (ev.status) agent.status = ev.status;
      pushHistory(agent, { ts: now, kind: 'task', text: ev.task || '' });
      break;
    }
    case 'leave': {
      (state.left ||= {})[agent.id] = now;
      agent.status = 'offline';
      agent.tool = undefined;
      agent.activity = ev.activity || 'Left';
      effects.push({ kind: 'leave', agent: agent.id });
      pushHistory(agent, { ts: now, kind: 'leave', text: agent.activity });
      break;
    }
  }
  // 상태가 바뀐 때만 갱신한다. 같은 상태를 다시 알리는 이벤트는 lastSeen만 올린다.
  if (agent.status !== statusBefore) agent.statusSince = now;
  // 기다리는 이유는 waiting일 때만 갖는다. 새 waiting 알림은 이유를 새로 정한다(모르면 비운다).
  if (agent.status !== 'waiting') delete agent.waitKind;
  else if ((ev.type === 'status' || ev.type === 'join') && ev.status === 'waiting') {
    if (ev.waitKind) agent.waitKind = ev.waitKind;
    else delete agent.waitKind;
  }
  return { state, effects };
}

/**
 * Drop offline agents after a short grace period, finished helpers (agents with a
 * parent) after they have had time to celebrate, and anything silent for hours.
 */
export function sweep(
  state,
  now = Date.now(),
  { offlineMs = 6_000, doneHelperMs = 45_000, staleMs = 2 * 60 * 60_000 } = {},
) {
  const removed = [];
  if (state.meeting && now >= state.meeting.endsAt) delete state.meeting;
  for (const a of Object.values(state.agents)) {
    const age = now - a.lastSeen;
    if (
      (a.status === 'offline' && age > offlineMs) ||
      (a.status === 'done' && a.parent && age > doneHelperMs) ||
      age > staleMs
    ) {
      delete state.agents[a.id];
      removed.push(a.id);
    }
  }
  const used = new Set(Object.values(state.agents).map((a) => a.team));
  for (const id of Object.keys(state.teams)) if (!used.has(id)) delete state.teams[id];
  return removed;
}
