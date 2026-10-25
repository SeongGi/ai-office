// Claude Code hooks -> Agent Floor events.
// Receives the JSON object Claude Code writes to a hook's stdin.
// https://docs.claude.com/en/docs/claude-code/hooks
import { describeTool, deviceName, pretty, shortId, shortToolName, slugKey, teamFromCwd } from './common.mjs';
import { clipText, readTranscriptTail, readTranscriptTitle, shortTitle } from './transcript.mjs';

const SPAWN_TOOLS = new Set(['Task', 'Agent']);
const TITLE_HOOKS = new Set(['SessionStart', 'UserPromptSubmit', 'Stop']);

/**
 * @param {Record<string, any>} input hook payload
 * @param {{ source?: string, name?: string }} [opts]
 * @returns {import('../shared/protocol.js').InboundEvent[]}
 */
export function fromClaude(input, opts = {}) {
  if (!input || typeof input !== 'object') return [];
  const source = opts.source || 'claude-code';
  const lead = `${source}:${shortId(input.session_id)}`;
  const team = teamFromCwd(input.cwd);
  // 세션 제목은 기록 끝을 읽어야 하므로 시작, 질문, 멈춤 훅에서만 읽는다. 서브에이전트에는 쓰지 않는다.
  // 다른 훅은 기본 이름을 보내고, 서버가 기본 이름으로 구체적인 이름을 덮지 않게 막는다.
  const isSub = input.agent_id || input.agent_type;
  const titled = !isSub && TITLE_HOOKS.has(input.hook_event_name) && typeof input.transcript_path === 'string';
  const title = titled ? shortTitle(readTranscriptTitle(input.transcript_path)) : undefined;
  const base = {
    agent: lead,
    team,
    source,
    name: process.env.AGENT_FLOOR_NAME || opts.name || title || (source === 'codex' ? 'Codex' : 'Claude'),
    role: 'Lead',
    ...(input.model ? { model: String(input.model) } : {}),
    ...(input.cwd ? { cwd: String(input.cwd) } : {}),
    // Orca 터미널 핸들. 퇴사 버튼이 이 세션을 닫을 때 서버가 쓴다(서버 메모리에만 둔다).
    ...(process.env.ORCA_TERMINAL_HANDLE ? { terminal: process.env.ORCA_TERMINAL_HANDLE } : {}),
    // 어느 기기 세션인지. 서버가 닫기 요청을 그 기기로 보낼 때 쓴다(서버 메모리에만 둔다).
    ...(deviceName() ? { device: deviceName() } : {}),
    // 권한 모드(default, plan, bypassPermissions 등). 지시 보내기 안전장치가 쓴다.
    ...(input.permission_mode ? { permission: clipText(input.permission_mode, 24) } : {}),
  };
  // Inside a subagent, newer Claude Code versions add agent_id / agent_type.
  const sub = input.agent_id || input.agent_type ? { key: input.agent_id, type: input.agent_type } : undefined;
  const actor = sub ? { agent: lead, team, source, subagent: sub } : base;

  const tool = input.tool_name;
  const toolInput = input.tool_input || {};

  switch (input.hook_event_name) {
    case 'SessionStart':
      return [{ type: 'join', ...base, status: 'idle', activity: '준비됐어요' }];

    case 'UserPromptSubmit':
      return [
        {
          type: 'status',
          ...base,
          status: 'thinking',
          activity: `물어봤어요: ${input.prompt ?? ''}`,
          ...(clipText(input.prompt, 300) ? { lastPrompt: clipText(input.prompt, 300) } : {}),
        },
      ];

    case 'PreToolUse': {
      if (SPAWN_TOOLS.has(tool)) {
        const type = toolInput.subagent_type || 'general-purpose';
        const key = input.tool_use_id || slugKey(toolInput.description || type);
        return [
          { type: 'tool', ...actor, tool, activity: describeTool(tool, toolInput) },
          {
            type: 'join',
            agent: `${lead}:${shortId(key, 12)}`,
            parent: lead,
            team,
            source,
            name: pretty(type),
            role: type,
            status: 'thinking',
            activity: toolInput.description || '시작하는 중',
            text: toolInput.description || toolInput.prompt,
          },
        ];
      }
      const events = [{ type: 'tool', ...actor, tool: shortToolName(tool), activity: describeTool(tool, toolInput) }];
      if (tool === 'TodoWrite' && Array.isArray(toolInput.todos)) {
        const current =
          toolInput.todos.find((t) => t.status === 'in_progress') || toolInput.todos.find((t) => t.status === 'pending');
        if (current) events.push({ type: 'task', ...actor, task: current.activeForm || current.content });
      }
      return events;
    }

    case 'PostToolUse': {
      if (SPAWN_TOOLS.has(tool)) {
        const key = input.tool_use_id || slugKey(toolInput.description || toolInput.subagent_type || 'general-purpose');
        const child = `${lead}:${shortId(key, 12)}`;
        return [
          { type: 'message', agent: child, parent: lead, team, source, to: lead, text: '보고서 준비됐어요', status: 'done' },
          { type: 'status', agent: child, status: 'done', activity: '결과를 넘겼어요' },
          { type: 'status', ...base, status: 'thinking', activity: `${pretty(toolInput.subagent_type || '도우미')}의 보고서 살펴보는 중` },
        ];
      }
      return [{ type: 'status', ...actor, status: 'thinking', activity: `마쳤어요: ${describeTool(tool, toolInput)}` }];
    }

    case 'Notification':
      return [{ type: 'status', ...base, status: 'waiting', activity: input.message || '답을 기다려요' }];

    case 'Stop': {
      // Claude Code가 마지막 답을 주면 그대로 쓰고, 없으면 세션 기록 끝에서 찾는다.
      const lastReply =
        clipText(input.last_assistant_message, 600) ??
        (typeof input.transcript_path === 'string' ? readTranscriptTail(input.transcript_path).lastReply : undefined);
      return [{ type: 'status', ...base, status: 'idle', activity: '기다리는 중', ...(lastReply ? { lastReply } : {}) }];
    }

    case 'SubagentStop':
      if (!sub) return [];
      return [{ type: 'status', ...actor, status: 'done', activity: '끝냈어요' }];

    case 'PreCompact':
      return [{ type: 'status', ...base, status: 'thinking', activity: '기억 정리하는 중' }];

    case 'SessionEnd':
      return [{ type: 'leave', ...base, activity: '세션이 끝났어요' }];

    default:
      return [];
  }
}
