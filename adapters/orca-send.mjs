// Orca 터미널 하나에 지시(프롬프트)를 보낸다. 서버와 close-agent 도구가 함께 쓴다.
// 그 핸들이 아직 Claude 터미널일 때만 보낸다. 인자는 배열로 넘기고 셸을 거치지 않는다.
import { execFile } from 'node:child_process';

const defaultExec = (cmd, args, opts, cb) => execFile(cmd, args, opts, cb);

/**
 * @param {string} handle Orca 터미널 핸들(term_...)
 * @param {string} text 보낼 지시
 * @param {(cmd: string, args: string[], opts: object, cb: (e: Error|null, out?: string) => void) => void} [execFileImpl]
 * @returns {Promise<{sent: boolean, reason?: string}>}
 */
export async function sendOrcaPrompt(handle, text, execFileImpl = defaultExec) {
  const run = (args) =>
    new Promise((ok, fail) =>
      execFileImpl('orca', args, { timeout: 8000, maxBuffer: 4 * 1024 * 1024 }, (e, out) => (e ? fail(e) : ok(String(out ?? '')))),
    );
  if (typeof handle !== 'string' || !handle) return { sent: false, reason: '터미널 정보가 없어요' };
  if (typeof text !== 'string' || !text.trim()) return { sent: false, reason: '보낼 글이 없어요' };
  try {
    const list = JSON.parse(await run(['terminal', 'list', '--json']));
    const t = (list.result?.terminals || []).find((x) => x.handle === handle);
    if (!t) return { sent: false, reason: '터미널이 이미 없어요' };
    if (t.agentIdentity !== 'claude') return { sent: false, reason: '터미널이 Claude 상태가 아니에요' };
    await run(['terminal', 'send', '--terminal', handle, '--text', text, '--enter']);
    return { sent: true };
  } catch (err) {
    return { sent: false, reason: `orca 호출 실패: ${String(err.message).split('\n')[0]}` };
  }
}
