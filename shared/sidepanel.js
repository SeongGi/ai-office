// Pure helpers for the side panel. No DOM, so node:test can import them.
import { toolRoom } from './places.js';

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
      rows.push({ agentId: a.id, name: a.name, hue: team?.hue ?? 0, ts: h.ts, kind: h.kind, text: clipText(h.text) });
    }
  }
  rows.sort((x, y) => y.ts - x.ts);
  return rows.slice(0, limit).map((r) => ({ ...r, rel: relTime(r.ts, now) }));
}
