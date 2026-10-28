// 조용히 열려 있는 Claude Code 세션을 시작할 때 사무실에 앉히는 도구.
// 훅은 세션이 뭔가 해야 신호를 보내므로, 최근에 쓰인 세션 기록 파일을 읽어 대기 중인 직원으로 올린다.
import { execFileSync } from 'node:child_process';
import { closeSync, openSync, readFileSync, readSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { deviceName, shortId, teamFromCwd } from './common.mjs';
import { readTranscriptTail, readTranscriptTitle, shortTitle } from './transcript.mjs';

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

/** 프로세스의 환경에서 Orca 터미널 핸들을 읽는다. 읽지 못하면 빈 값. */
function handleOfPid(pid) {
  try {
    process.kill(pid, 0);
    const out = execFileSync('ps', ['eww', '-o', 'command=', '-p', String(pid)], { encoding: 'utf8', timeout: 3000 });
    return /\bORCA_TERMINAL_HANDLE=(term_[\w-]{8,64})/.exec(out)?.[1] ?? '';
  } catch {
    return '';
  }
}

/** 열려 있는 세션마다 세션 id -> 터미널 핸들. 훅이 한 번도 안 온 쉬는 세션도 지시와 퇴사가 닿게 한다. */
function terminalsBySession(dir, handleOf) {
  const map = new Map();
  let names = [];
  try {
    names = readdirSync(dir).filter((n) => /^\d+\.json$/.test(n));
  } catch {
    return map;
  }
  for (const n of names) {
    try {
      const { pid, sessionId } = JSON.parse(readFileSync(join(dir, n), 'utf8'));
      const handle = Number.isInteger(pid) && typeof sessionId === 'string' ? handleOf(pid) : '';
      if (handle) map.set(sessionId, handle);
    } catch {
      // 깨진 파일은 건너뛴다.
    }
  }
  return map;
}

/** @returns {import('../shared/protocol.js').InboundEvent[]} */
export function seedEvents({
  sinceMs = 2 * 60 * 60 * 1000,
  root = join(homedir(), '.claude', 'projects'),
  now = Date.now(),
  sessionsDir = join(homedir(), '.claude', 'sessions'),
  handleOf = handleOfPid,
} = {}) {
  const events = [];
  const handles = terminalsBySession(sessionsDir, handleOf);
  const device = deviceName();
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
        const title = shortTitle(readTranscriptTitle(path, st.size));
        const { lastPrompt, lastReply, permission } = readTranscriptTail(path, st.size); // 실패하면 빈 값
        const sessionId = f.replace(/\.jsonl$/, '');
        const terminal = handles.get(sessionId);
        events.push({
          type: 'join',
          agent: `claude-code:${shortId(sessionId)}`,
          team: teamFromCwd(cwd),
          source: 'claude-code',
          name: title || 'Claude',
          role: 'Lead',
          cwd,
          status: 'idle',
          activity: '준비됐어요',
          ...(lastPrompt ? { lastPrompt } : {}),
          ...(lastReply ? { lastReply } : {}),
          ...(permission ? { permission } : {}),
          ...(terminal ? { terminal } : {}),
          ...(device ? { device } : {}),
        });
      } catch {
        // 읽을 수 없는 파일은 건너뛴다.
      }
    }
  }
  return events;
}
