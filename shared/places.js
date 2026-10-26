// Where an agent should be: 'desk' (its team room), 'meeting', a tool room ('library', 'server', 'search')
// or a break spot ('lounge', 'games', 'kitchen').
// Pure on purpose so it can be tested without a browser.

export const LOUNGE_AFTER_MS = 12_000;

/** Idle agents spread over the break rooms; a stable pick per agent. */
export function breakPlace(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return ['lounge', 'games', 'kitchen', 'games', 'lounge', 'kitchen'][h % 6];
}

const GONE = new Set(['done', 'offline']);

/** An agent with a live helper (a subagent that is not done or offline) goes to the meeting room. */
export function hasLiveHelper(agent, agents) {
  for (const other of Object.values(agents)) {
    if (other.parent === agent.id && !GONE.has(other.status)) return true;
  }
  return false;
}

/** True when an active meeting covers this agent ('*' = everyone, else the agent's team). */
export function meetingCovers(meeting, agent) {
  if (!meeting) return false;
  return meeting.team === '*' || meeting.team === agent.team;
}

// ---------------------------------------------------------------- tool rooms

/** Which tool room a tool belongs to, or null when the cat stays at its desk (Edit, Write, TodoWrite and the rest). */
export function toolRoom(tool) {
  if (typeof tool !== 'string' || !tool) return null;
  if (LIBRARY_TOOLS.has(tool)) return 'library';
  if (SERVER_TOOLS.has(tool)) return 'server';
  if (SEARCH_TOOLS.has(tool) || tool.toLowerCase().startsWith('mcp')) return 'search';
  return null;
}
const LIBRARY_TOOLS = new Set(['Read', 'Glob', 'Grep', 'LS', 'NotebookRead']);
const SERVER_TOOLS = new Set(['Bash', 'BashOutput', 'KillShell']);
const SEARCH_TOOLS = new Set(['WebSearch', 'WebFetch', 'MCP']);

// Tools change every second, so a cat must not run around. These numbers keep it calm.
/** A cat goes to a tool room when the same room class is used again within this time ... */
export const TOOL_REPEAT_MS = 6_000;
/** ... or when one tool call lasts longer than this. */
export const TOOL_LONG_CALL_MS = 2_500;
/** Once there it stays at least this long; room to room hops wait for it too. */
export const TOOL_MIN_STAY_MS = 8_000;
/** It heads back to the desk this long after the last matching tool event (never sooner than the minimum stay). */
export const TOOL_LEAVE_MS = 6_000;
/** On page load a cat whose last matching tool event is younger than this is already in the room. */
export const TOOL_FRESH_MS = 8_000;

/** Per cat memory for the dwell rules. Plain data. */
export function createToolState() {
  return { room: null, since: 0, cand: null, candAt: 0, seenAt: null, lastRoom: null, lastAt: 0 };
}

/**
 * Advance one cat's tool room state and return the room it should be in ('library' | 'server' | 'search') or null.
 * Reads the server's `lastTool`, `toolAt` (when the last tool started) and `toolEndAt` (when it ended).
 * `nowMs` must be in the same clock as those (server time, on a client: Date.now()).
 */
export function stepToolRoom(st, agent, nowMs) {
  if (agent.parent || agent.status === 'idle' || agent.status === 'done' || agent.status === 'offline') {
    st.room = null;
    st.cand = null;
    return null;
  }
  const at = agent.toolAt;
  const room = toolRoom(agent.lastTool ?? agent.tool);
  if (at != null && room) {
    if (at !== st.seenAt) {
      // A new tool call of a room class. The second one of the same class within TOOL_REPEAT_MS earns the trip.
      if (st.lastRoom === room && at - st.lastAt <= TOOL_REPEAT_MS) {
        st.cand = room;
        st.candAt = at;
      } else if (st.cand === room) st.candAt = at;
      st.lastRoom = room;
      st.lastAt = at;
    }
    // A long call earns the trip by itself, and a running one keeps the cat there.
    const ended = agent.toolEndAt != null && agent.toolEndAt >= at;
    const running = !ended && agent.status === 'working' && Boolean(agent.tool);
    const dur = ended ? agent.toolEndAt - at : running ? nowMs - at : 0;
    if (dur > TOOL_LONG_CALL_MS) {
      const last = running ? nowMs : agent.toolEndAt;
      if (nowMs - last <= TOOL_LEAVE_MS) {
        st.cand = room;
        st.candAt = Math.max(st.candAt, last);
      }
    }
  }
  if (at != null) st.seenAt = at;
  if (st.cand && nowMs - st.candAt > TOOL_LEAVE_MS) st.cand = null;

  // Only a cat that is working or thinking may walk in; one already inside may stay through waiting or an error.
  let want = st.cand;
  if (st.room === null && agent.status !== 'working' && agent.status !== 'thinking') want = null;
  if (want === st.room) return st.room;
  if (st.room === null || nowMs - st.since >= TOOL_MIN_STAY_MS) {
    st.room = want;
    st.since = nowMs;
  }
  return st.room;
}

/** Dwell state for a cat first seen on page load: already in the room when its last matching tool event is fresh. */
export function initialToolState(agent, nowMs) {
  const st = createToolState();
  st.seenAt = agent.toolAt ?? null;
  if (agent.parent || (agent.status !== 'working' && agent.status !== 'thinking')) return st;
  const room = toolRoom(agent.lastTool ?? agent.tool);
  if (room && agent.toolAt != null && nowMs - agent.toolAt < TOOL_FRESH_MS) {
    st.room = st.cand = st.lastRoom = room;
    st.candAt = st.lastAt = agent.toolAt;
    st.since = nowMs;
  }
  return st;
}

// ---------------------------------------------------------------- bubbles

/** A failed tool shows as 'error' with this activity prefix; the renderers treat it as a short red bubble, not a lasting error. */
export const TOOL_FAIL_PREFIX = '실패했어요';
export const TOOL_FAIL_SHOW_MS = 4_000;

export function isToolFailure(agent) {
  return agent.status === 'error' && typeof agent.activity === 'string' && agent.activity.startsWith(TOOL_FAIL_PREFIX);
}

/** The status to draw: a tool failure turns back into 'thinking' after TOOL_FAIL_SHOW_MS even if no event follows. */
export function effectiveStatus(agent, nowMs) {
  if (isToolFailure(agent)) {
    const since = agent.lastSeen ?? agent.statusSince; // the failure event itself, also a second failure in a row
    if (since != null && nowMs - since > TOOL_FAIL_SHOW_MS) return 'thinking';
  }
  return agent.status;
}

/** The tool name inside a failure activity ('실패했어요: Bash' gives 'Bash'), or ''. */
export function failureTool(agent) {
  const m = /^[^:]*:\s*(.*)$/.exec(agent.activity ?? '');
  return m ? m[1].trim() : '';
}

/** Short text for a thinking bubble: the activity cut to 16 characters, or '생각 중'. */
export function thinkingText(activity) {
  const t = String(activity ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return '생각 중';
  const chars = [...t];
  return chars.length > 16 ? chars.slice(0, 16).join('') + '…' : t;
}

/**
 * Priority: offline (desk) > covering meeting > helper meeting > tool room > lounge > desk.
 * `idleSinceMs` is when the agent's status became idle (null when it is not idle).
 * `tool` is the room from stepToolRoom (null at the desk); a subagent never gets one.
 */
export function desiredPlace(agent, agents, idleSinceMs, nowMs, meeting, tool = null) {
  if (agent.status === 'offline') return 'desk';
  if (meetingCovers(meeting, agent)) return 'meeting';
  if (hasLiveHelper(agent, agents)) return 'meeting';
  if (tool && !agent.parent && (agent.status === 'working' || agent.status === 'thinking' || agent.status === 'error' || agent.status === 'waiting')) return tool;
  if (agent.status === 'idle' && idleSinceMs != null && nowMs - idleSinceMs >= LOUNGE_AFTER_MS) return breakPlace(agent.id);
  return 'desk';
}

/**
 * Where a cat belongs the moment the page opens, from server state alone.
 * "Idle for how long" comes from the server's `statusSince` (older saved states: `lastSeen`), not from page load.
 */
export function initialPlace(agent, agents, nowMs, meeting) {
  const since = agent.status === 'idle' ? (agent.statusSince ?? agent.lastSeen ?? null) : null;
  return desiredPlace(agent, agents, since, nowMs, meeting, initialToolState(agent, nowMs).room);
}

/** How long (ms) the agent has been idle by server time, 0 when it is not idle or the time is unknown. */
export function idleAgeMs(agent, nowMs) {
  if (agent.status !== 'idle') return 0;
  const since = agent.statusSince ?? agent.lastSeen;
  return since == null ? 0 : Math.max(0, nowMs - since);
}
