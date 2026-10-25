// Cursor agent hooks -> Agent Floor events.
// Cursor writes a JSON payload to the hook's stdin. We only subscribe to hooks
// that observe (after*, stop, beforeSubmitPrompt) so Agent Floor can never change
// a permission decision. See docs/integrations.md for the hooks.json snippet.
import { basename } from 'node:path';
import { shortId, teamFromCwd } from './common.mjs';

export function fromCursor(input) {
  if (!input || typeof input !== 'object') return [];
  const root = Array.isArray(input.workspace_roots) ? input.workspace_roots[0] : undefined;
  const base = {
    agent: `cursor:${shortId(input.conversation_id)}`,
    team: teamFromCwd(root),
    source: 'cursor',
    name: process.env.AGENT_FLOOR_NAME || 'Cursor',
    role: 'Lead',
  };
  const f = (p) => (p ? basename(String(p)) : '파일');

  switch (input.hook_event_name) {
    case 'beforeSubmitPrompt':
      return [{ type: 'status', ...base, status: 'thinking', activity: `물어봤어요: ${input.prompt ?? ''}` }];
    case 'afterAgentThought':
      return [{ type: 'status', ...base, status: 'thinking', activity: input.text || '생각 중' }];
    case 'afterFileEdit':
      return [{ type: 'tool', ...base, tool: 'Edit', activity: `${f(input.file_path)} 고쳤어요` }];
    case 'beforeReadFile':
      return [{ type: 'tool', ...base, tool: 'Read', activity: `${f(input.file_path)} 읽는 중` }];
    case 'beforeShellExecution':
    case 'afterShellExecution':
      return [{ type: 'tool', ...base, tool: 'Shell', activity: `실행 중: ${String(input.command ?? '').slice(0, 60)}` }];
    case 'beforeMCPExecution':
    case 'afterMCPExecution':
      return [{ type: 'tool', ...base, tool: 'MCP', activity: `MCP: ${input.tool_name ?? '도구'}` }];
    case 'afterAgentResponse':
      return [{ type: 'status', ...base, status: 'thinking', activity: `답했어요: ${input.text ?? ''}` }];
    case 'stop':
      return [
        {
          type: 'status',
          ...base,
          status: input.status === 'error' ? 'error' : 'idle',
          activity: input.status === 'error' ? '오류로 멈췄어요' : '기다리는 중',
        },
      ];
    default:
      return [];
  }
}

/** What each Cursor hook must print on stdout. Observing hooks print nothing. */
export function cursorResponse(hookName) {
  if (hookName === 'beforeSubmitPrompt') return JSON.stringify({ continue: true });
  return '';
}
