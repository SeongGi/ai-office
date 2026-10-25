// OpenAI Codex CLI -> Agent Floor events.
//
// Codex calls the program configured as `notify` in ~/.codex/config.toml with one
// JSON argument when a turn completes. Newer Codex builds can also run hooks that
// pass a Claude-style payload ({ hook_event_name, ... }) on stdin; those are routed
// through the Claude mapper with source "codex".
import { fromClaude } from './claude.mjs';
import { shortId, teamFromCwd } from './common.mjs';

export function fromCodex(input) {
  if (!input || typeof input !== 'object') return [];
  if (input.hook_event_name) return fromClaude(input, { source: 'codex', name: 'Codex' });

  const thread = input['thread-id'] || input.thread_id || input.session_id;
  const base = {
    agent: `codex:${shortId(thread)}`,
    team: teamFromCwd(input.cwd),
    source: 'codex',
    name: process.env.AGENT_FLOOR_NAME || 'Codex',
    role: 'Lead',
  };

  switch (input.type) {
    case 'agent-turn-complete': {
      const asked = Array.isArray(input['input-messages']) ? input['input-messages'].at(-1) : undefined;
      const answer = input['last-assistant-message'];
      const events = [];
      if (asked) events.push({ type: 'status', ...base, status: 'thinking', activity: `물어봤어요: ${asked}` });
      events.push({ type: 'status', ...base, status: 'idle', activity: answer ? `답했어요: ${answer}` : '차례를 마쳤어요' });
      return events;
    }
    case 'approval-requested':
      return [{ type: 'status', ...base, status: 'waiting', activity: '승인이 필요해요' }];
    default:
      return [{ type: 'status', ...base, status: 'idle', activity: input.type ? String(input.type) : '소식이 있어요' }];
  }
}
