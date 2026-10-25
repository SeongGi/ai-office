// Claude Code 세션 기록(jsonl) 끝에서 마지막 대화를 뽑는다. 훅(Stop)과 seed가 함께 쓴다.
// 실제 기록의 모양(2026-10 확인): 줄마다 {type:'user'|'assistant'|'permission-mode', ...}.
//   assistant: message.content는 블록 배열이고 한 줄에 블록 하나(text, thinking, tool_use)다.
//   user: message.content가 문자열(직접 입력)이거나 블록 배열(tool_result 또는 text)이다.
//   permission-mode 줄과 user 줄의 permissionMode: default, plan, acceptEdits, auto, dontAsk, bypassPermissions.
// 도구 결과와 파일 내용은 읽지 않는다. 글자 블록(text)만 쓴다.
import { closeSync, openSync, readSync, statSync } from 'node:fs';

export const TAIL_BYTES = 64 * 1024;

/** 줄바꿈과 공백을 한 칸으로 줄이고 max자에서 자른다(서버의 clip과 같은 규칙). */
export function clipText(text, max) {
  if (text == null) return undefined;
  const s = String(text).replace(/\s+/g, ' ').trim();
  if (!s) return undefined;
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n');
}

/**
 * jsonl 끝부분 글자에서 마지막 질문, 마지막 답, 권한 모드를 뽑는다. 못 찾은 것은 빠진다.
 * @param {string} tail
 * @returns {{ lastPrompt?: string, lastReply?: string, permission?: string }}
 */
export function parseTranscriptTail(tail) {
  const out = {};
  const lines = String(tail || '').split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line || line[0] !== '{') continue;
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue; // 잘린 첫 줄이나 깨진 줄
    }
    if (o.type === 'permission-mode' && out.permission === undefined && typeof o.permissionMode === 'string') {
      out.permission = o.permissionMode;
    } else if (o.type === 'assistant' && out.lastReply === undefined && !o.isSidechain) {
      const t = clipText(textOf(o.message?.content), 600);
      if (t) out.lastReply = t;
    } else if (o.type === 'user' && out.lastPrompt === undefined && !o.isSidechain && !o.isMeta) {
      const t = textOf(o.message?.content);
      // 도구 결과만 있는 줄은 글자가 없어 건너뛰고, <command-...> 같은 도구 덮개 글은 질문이 아니다.
      if (t && !t.trimStart().startsWith('<')) out.lastPrompt = clipText(t, 300);
    }
    if (o.type === 'user' && out.permission === undefined && typeof o.permissionMode === 'string') out.permission = o.permissionMode;
    if (out.lastPrompt !== undefined && out.lastReply !== undefined && out.permission !== undefined) break;
  }
  return out;
}

/** 파일 끝 64KB를 읽어 parseTranscriptTail에 넘긴다. 실패하면 빈 객체. */
export function readTranscriptTail(path, size) {
  try {
    const total = size ?? statSync(path).size;
    const len = Math.min(total, TAIL_BYTES);
    const fd = openSync(path, 'r');
    try {
      const buf = Buffer.alloc(len);
      const n = readSync(fd, buf, 0, len, total - len);
      return parseTranscriptTail(buf.toString('utf8', 0, n));
    } finally {
      closeSync(fd);
    }
  } catch {
    return {};
  }
}
