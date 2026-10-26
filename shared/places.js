// Where an agent should be: 'desk' (its team room), 'meeting', or a break spot ('lounge', 'games', 'kitchen').
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

/**
 * Priority: offline (desk) > covering meeting > helper meeting > lounge > desk.
 * `idleSinceMs` is when the agent's status became idle (null when it is not idle).
 */
export function desiredPlace(agent, agents, idleSinceMs, nowMs, meeting) {
  if (agent.status === 'offline') return 'desk';
  if (meetingCovers(meeting, agent)) return 'meeting';
  if (hasLiveHelper(agent, agents)) return 'meeting';
  if (agent.status === 'idle' && idleSinceMs != null && nowMs - idleSinceMs >= LOUNGE_AFTER_MS) return breakPlace(agent.id);
  return 'desk';
}

/**
 * Where a cat belongs the moment the page opens, from server state alone.
 * "Idle for how long" comes from the server's `statusSince` (older saved states: `lastSeen`), not from page load.
 */
export function initialPlace(agent, agents, nowMs, meeting) {
  const since = agent.status === 'idle' ? (agent.statusSince ?? agent.lastSeen ?? null) : null;
  return desiredPlace(agent, agents, since, nowMs, meeting);
}

/** How long (ms) the agent has been idle by server time, 0 when it is not idle or the time is unknown. */
export function idleAgeMs(agent, nowMs) {
  if (agent.status !== 'idle') return 0;
  const since = agent.statusSince ?? agent.lastSeen;
  return since == null ? 0 : Math.max(0, nowMs - since);
}
