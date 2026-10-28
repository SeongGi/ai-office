import { basename } from 'node:path';

export function shortId(value, n = 8) {
  return String(value || 'local').replace(/[^a-zA-Z0-9]/g, '').slice(0, n) || 'local';
}

export function slugKey(value) {
  return String(value || 'x').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24);
}

/** Orca 작업 폴더(.../orca/workspaces/<프로젝트>/<브랜치>)는 브랜치가 아니라 프로젝트 방으로 묶는다. */
const WORKSPACE_RE = /[\\/]orca[\\/]workspaces[\\/]([^\\/]+)(?:[\\/]|$)/;

/** 기기 이름(AGENT_FLOOR_DEVICE). 있으면 팀 이름 앞에 붙어 기기별로 방이 갈린다. */
export function deviceName() {
  return String(process.env.AGENT_FLOOR_DEVICE || '').trim();
}

export function teamFromCwd(cwd) {
  const name = process.env.AGENT_FLOOR_TEAM || (!cwd ? '작업실' : (WORKSPACE_RE.exec(String(cwd))?.[1] ?? basename(cwd)));
  const device = deviceName();
  return device ? `${device} ${name}` : name;
}

export function pretty(value) {
  return String(value || '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

function file(p) {
  return p ? basename(String(p)) : '파일';
}

function oneLine(s, max = 80) {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

/** Human-readable sentence for a tool call. Covers Claude Code, Codex and common MCP names. */
export function describeTool(name, input = {}) {
  const i = input || {};
  switch (name) {
    case 'Bash':
    case 'shell':
    case 'exec_command':
      return `실행 중: ${oneLine(i.command ?? i.cmd, 60)}`;
    case 'Edit':
    case 'MultiEdit':
    case 'apply_patch':
      return `${file(i.file_path ?? i.path)} 고치는 중`;
    case 'Write':
      return `${file(i.file_path ?? i.path)} 쓰는 중`;
    case 'Read':
      return `${file(i.file_path ?? i.path)} 읽는 중`;
    case 'NotebookEdit':
      return `${file(i.notebook_path)} 고치는 중`;
    case 'Grep':
      return `"${oneLine(i.pattern, 40)}" 찾는 중`;
    case 'Glob':
      return `${oneLine(i.pattern, 40)} 파일 찾는 중`;
    case 'WebFetch':
      try {
        return `${new URL(i.url).host} 읽는 중`;
      } catch {
        return '웹 페이지 읽는 중';
      }
    case 'WebSearch':
      return `웹에서 "${oneLine(i.query, 40)}" 검색 중`;
    case 'TodoWrite':
      return '계획 고치는 중';
    case 'Task':
    case 'Agent':
      return `${pretty(i.subagent_type || '도우미')}에게 설명하는 중`;
    default:
      if (typeof name === 'string' && name.startsWith('mcp__')) {
        const [, server, tool] = name.split('__');
        return `${pretty(server)}: ${pretty(tool)}`;
      }
      return `${name || '도구'} 쓰는 중`;
  }
}

export function shortToolName(name) {
  if (typeof name === 'string' && name.startsWith('mcp__')) return 'MCP';
  return name;
}

/** 지시와 퇴사가 닿는 터미널 핸들: Orca(term_...) 또는 tmux 창(tmux:%N). */
export const TERMINAL_HANDLE_RE = /^(term_[\w-]{8,64}|tmux:%\d{1,6})$/;
