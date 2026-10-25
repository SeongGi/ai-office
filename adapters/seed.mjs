// 조용히 열려 있는 Claude Code 세션을 시작할 때 사무실에 앉히는 도구.
// 훅은 세션이 뭔가 해야 신호를 보내므로, 최근에 쓰인 세션 기록 파일을 읽어 대기 중인 직원으로 올린다.
import { closeSync, openSync, readSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { shortId, teamFromCwd } from './common.mjs';
import { readTranscriptTail } from './transcript.mjs';

const HEAD_BYTES = 64 * 1024;

function cwdOf(file) {
  const fd = openSync(file, 'r');
  try {
    const buf = Buffer.alloc(HEAD_BYTES);
    const n = readSync(fd, buf, 0, HEAD_BYTES, 0);
    const m = /"cwd":"((?:[^"\\]|\\.)*)"/.exec(buf.toString('utf8', 0, n));
    return m ? JSON.parse(`"${m[1]}"`) : null;
  } finally {
    closeSync(fd);
  }
}

function titleOf(file, size) {
  const fd = openSync(file, 'r');
  try {
    const len = Math.min(size, HEAD_BYTES);
    const buf = Buffer.alloc(len);
    const n = readSync(fd, buf, 0, len, size - len);
    const all = [...buf.toString('utf8', 0, n).matchAll(/"aiTitle":"((?:[^"\\]|\\.)*)"/g)];
    return all.length ? JSON.parse(`"${all[all.length - 1][1]}"`) : null;
  } finally {
    closeSync(fd);
  }
}

/** @returns {import('../shared/protocol.js').InboundEvent[]} */
export function seedEvents({ sinceMs = 2 * 60 * 60 * 1000, root = join(homedir(), '.claude', 'projects'), now = Date.now() } = {}) {
  const events = [];
  let dirs = [];
  try {
    dirs = readdirSync(root);
  } catch {
    return events;
  }
  for (const dir of dirs) {
    if (dir.startsWith('-private-tmp-') || dir.startsWith('-tmp-')) continue; // 임시 작업 폴더
    let files = [];
    try {
      files = readdirSync(join(root, dir)).filter((f) => f.endsWith('.jsonl'));
    } catch {
      continue;
    }
    for (const f of files) {
      const path = join(root, dir, f);
      try {
        const st = statSync(path);
        if (now - st.mtimeMs > sinceMs) continue;
        const cwd = cwdOf(path);
        if (!cwd) continue;
        const title = titleOf(path, st.size);
        const { lastPrompt, lastReply, permission } = readTranscriptTail(path, st.size); // 실패하면 빈 값
        events.push({
          type: 'join',
          agent: `claude-code:${shortId(f.replace(/\.jsonl$/, ''))}`,
          team: teamFromCwd(cwd),
          source: 'claude-code',
          name: title ? (title.length > 14 ? `${title.slice(0, 13)}…` : title) : 'Claude',
          role: 'Lead',
          cwd,
          status: 'idle',
          activity: '준비됐어요',
          ...(lastPrompt ? { lastPrompt } : {}),
          ...(lastReply ? { lastReply } : {}),
          ...(permission ? { permission } : {}),
        });
      } catch {
        // 읽을 수 없는 파일은 건너뛴다.
      }
    }
  }
  return events;
}
