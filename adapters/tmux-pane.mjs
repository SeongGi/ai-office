// tmux 창(pane) 하나에 글을 보낸다. orca-send와 orca-close가 핸들이 tmux:%N일 때 함께 쓴다.
// 그 창의 셸 아래에서 claude 프로세스가 돌 때만 보낸다(창의 현재 명령은 셸 래퍼 때문에 zsh로 보일 수 있다). 인자는 배열로 넘기고 셸을 거치지 않는다.

/** tmux 창 핸들에서 창 id(%N)를 꺼낸다. 형식이 아니면 빈 값. */
export function tmuxPaneOf(handle) {
  return /^tmux:(%\d{1,6})$/.exec(String(handle))?.[1] ?? '';
}

/** `ps -A -o pid=,ppid=,comm=` 출력에서 pid 아래(자기 자신 포함)에 claude 프로세스가 있는지. */
export function hasClaudeBelow(rootPid, psOut) {
  const kids = new Map();
  const comm = new Map();
  for (const line of String(psOut).split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(line);
    if (!m) continue;
    const [pid, ppid] = [Number(m[1]), Number(m[2])];
    comm.set(pid, m[3].split('/').pop());
    if (!kids.has(ppid)) kids.set(ppid, []);
    kids.get(ppid).push(pid);
  }
  const seen = new Set();
  const stack = [rootPid];
  while (stack.length) {
    const pid = stack.pop();
    if (seen.has(pid)) continue;
    seen.add(pid);
    if (comm.get(pid) === 'claude') return true;
    stack.push(...(kids.get(pid) ?? []));
  }
  return false;
}

function runPs(execFileImpl) {
  return new Promise((ok, fail) =>
    execFileImpl('ps', ['-A', '-o', 'pid=,ppid=,comm='], { timeout: 8000, maxBuffer: 4 * 1024 * 1024 }, (e, out) => (e ? fail(e) : ok(String(out ?? '')))),
  );
}

/**
 * @param {string} handle tmux 창 핸들(tmux:%N)
 * @param {string} text 보낼 글(Enter는 따로 보낸다)
 * @param {(cmd: string, args: string[], opts: object, cb: (e: Error|null, out?: string) => void) => void} execFileImpl
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
export async function sendToTmuxPane(handle, text, execFileImpl) {
  const run = (args) =>
    new Promise((ok, fail) =>
      execFileImpl('tmux', args, { timeout: 8000, maxBuffer: 1024 * 1024 }, (e, out) => (e ? fail(e) : ok(String(out ?? '')))),
    );
  const pane = tmuxPaneOf(handle);
  if (!pane) return { ok: false, reason: '터미널 정보가 올바르지 않아요' };
  if (typeof text !== 'string' || text.includes('\0')) return { ok: false, reason: '보낼 글에 쓸 수 없는 문자가 있어요' };
  try {
    const panePid = Number((await run(['display-message', '-p', '-t', pane, '#{pane_pid}'])).trim());
    if (!Number.isInteger(panePid) || panePid <= 0) return { ok: false, reason: '터미널을 찾지 못했어요' };
    if (!hasClaudeBelow(panePid, await runPs(execFileImpl))) return { ok: false, reason: '터미널이 Claude 상태가 아니에요' };
    await run(['send-keys', '-t', pane, '-l', '--', text]);
    await run(['send-keys', '-t', pane, 'Enter']);
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: `tmux 호출 실패: ${String(err.message).split('\n')[0]}` };
  }
}
