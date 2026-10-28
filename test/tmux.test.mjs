import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../server/index.mjs';
import { sendOrcaPrompt } from '../adapters/orca-send.mjs';
import { closeOrcaTerminal } from '../adapters/orca-close.mjs';
import { fromClaude } from '../adapters/claude.mjs';
import { seedEvents } from '../adapters/seed.mjs';

const PANE = 'tmux:%5';

/** 가짜 tmux. 진짜 tmux는 절대 부르지 않는다. */
function fakeTmux(current, calls = []) {
  const impl = (cmd, args, opts, cb) => {
    calls.push([cmd, ...args]);
    if (args[0] === 'display-message') cb(null, '1000\n');
    else if (cmd === 'ps') cb(null, `  1 0 launchd\n 1000 1 zsh\n 1001 1000 zsh\n 1002 1001 ${current === 'claude' ? '/usr/local/bin/claude' : current}\n 2000 1 claude\n`);
    else cb(null, '');
  };
  impl.calls = calls;
  return impl;
}

test('orca-send: tmux 핸들은 claude일 때만 보내고 Enter는 따로 보낸다', async () => {
  const f = fakeTmux('claude');
  assert.deepEqual(await sendOrcaPrompt(PANE, '  테스트; rm -rf / ', f), { sent: true });
  assert.deepEqual(f.calls, [
    ['tmux', 'display-message', '-p', '-t', '%5', '#{pane_pid}'],
    ['ps', '-A', '-o', 'pid=,ppid=,comm='],
    ['tmux', 'send-keys', '-t', '%5', '-l', '--', '테스트; rm -rf /'],
    ['tmux', 'send-keys', '-t', '%5', 'Enter'],
  ]);
  const sh = fakeTmux('zsh');
  assert.match((await sendOrcaPrompt(PANE, 'hi', sh)).reason, /Claude 상태가 아니에요/);
  assert.equal(sh.calls.length, 2, 'claude가 아니면 send-keys를 부르지 않는다(다른 창의 claude는 세지 않는다)');
  assert.equal((await sendOrcaPrompt(PANE, 'a\0b', fakeTmux('claude'))).sent, false);
  assert.equal((await sendOrcaPrompt(PANE, '  ', sh)).sent, false);
  assert.equal((await sendOrcaPrompt('tmux:%x', 'hi', sh)).sent, false);
  const boom = (cmd, args, opts, cb) => cb(new Error('tmux missing'));
  assert.match((await sendOrcaPrompt(PANE, 'hi', boom)).reason, /tmux 호출 실패/);
});

test('orca-close: tmux 핸들은 claude일 때만 /exit를 보낸다', async () => {
  const f = fakeTmux('claude');
  assert.deepEqual(await closeOrcaTerminal(PANE, f), { closed: true });
  assert.deepEqual(f.calls[2], ['tmux', 'send-keys', '-t', '%5', '-l', '--', '/exit']);
  assert.deepEqual(f.calls[3], ['tmux', 'send-keys', '-t', '%5', 'Enter']);
  const sh = fakeTmux('vim');
  const r = await closeOrcaTerminal(PANE, sh);
  assert.equal(r.closed, false);
  assert.match(r.reason, /Claude 상태가 아니에요/);
  assert.equal(sh.calls.length, 2);
});

test('claude 어댑터: Orca 핸들이 없으면 TMUX_PANE을 쓴다', () => {
  const keep = { o: process.env.ORCA_TERMINAL_HANDLE, t: process.env.TMUX_PANE };
  const join0 = () => fromClaude({ hook_event_name: 'SessionStart', session_id: 'abcd1234', cwd: '/x/p' })[0].terminal;
  try {
    delete process.env.ORCA_TERMINAL_HANDLE;
    process.env.TMUX_PANE = '%5';
    assert.equal(join0(), PANE);
    process.env.TMUX_PANE = 'bad';
    assert.equal(join0(), undefined);
    process.env.ORCA_TERMINAL_HANDLE = 'term_abcdef123456';
    process.env.TMUX_PANE = '%5';
    assert.equal(join0(), 'term_abcdef123456');
  } finally {
    for (const [k, v] of [['ORCA_TERMINAL_HANDLE', keep.o], ['TMUX_PANE', keep.t]]) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test('seed: Orca 핸들이 없으면 세션 파일의 tmux 창으로 대신하되 살아 있을 때만', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'af-seedtmux-'));
  const root = join(dir, 'projects');
  const sessionsDir = join(dir, 'sessions');
  await mkdir(join(root, '-x-proj'), { recursive: true });
  await mkdir(sessionsDir);
  const line = JSON.stringify({ cwd: '/x/proj', type: 'user', message: { role: 'user', content: 'hi' } });
  for (const id of ['aaaa1111', 'bbbb2222', 'cccc3333']) await writeFile(join(root, '-x-proj', `${id}-0000-0000-0000-000000000000.jsonl`), line + '\n');
  const sess = (pid, id, tmux) => writeFile(join(sessionsDir, `${pid}.json`), JSON.stringify({ pid, sessionId: `${id}-0000-0000-0000-000000000000`, tmux }));
  await sess(111, 'aaaa1111', 'Reference_Architecture-Portal-4:@5.%5');
  await sess(222, 'bbbb2222', 'x:@1.%7'); // 죽은 프로세스
  await sess(333, 'cccc3333', 'x:@1.%9'); // Orca 핸들이 먼저
  const handleOf = (pid) => (pid === 333 ? 'term_abcdef123456' : '');
  const aliveOf = (pid) => pid !== 222;
  const ev = seedEvents({ root, sessionsDir, handleOf, aliveOf });
  const t = (p) => ev.find((e) => e.agent.includes(p)).terminal;
  assert.equal(t('aaaa1111'), 'tmux:%5');
  assert.equal(t('bbbb2222'), undefined);
  assert.equal(t('cccc3333'), 'term_abcdef123456');
});

test('server: routes.json과 ingest가 tmux 핸들을 받고 잘못된 모양은 버린다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'af-tmuxroutes-'));
  const routesPath = join(dir, 'routes.json');
  await writeFile(routesPath, JSON.stringify({ terminals: { lap: PANE, bad: 'tmux:%x' }, devices: { lap: '서버기기', bad: '서버기기' } }));
  const f = fakeTmux('claude');
  const floor = await startServer({
    port: 0, log: () => {}, seed: false, token: '', admins: 'me@test.dev', trustProxyEmail: true,
    allowBypassSend: false, machinePort: null, auditPath: join(dir, 'a.log'), device: '서버기기', routesPath, execFileImpl: f,
  });
  const base = `http://127.0.0.1:${floor.server.address().port}`;
  const H = { 'Content-Type': 'application/json', 'x-auth-request-email': 'me@test.dev' };
  try {
    const join1 = (agent, terminal) =>
      fetch(`${base}/events`, { method: 'POST', headers: H, body: JSON.stringify([{ type: 'join', agent, team: 'T', status: 'idle', terminal, device: '서버기기' }]) });
    await join1('lap', undefined);
    await join1('bad', undefined);
    const ok = await (await fetch(`${base}/send`, { method: 'POST', headers: H, body: JSON.stringify({ agent: 'lap', text: 'hi' }) })).json();
    assert.deepEqual(ok, { sent: true });
    assert.deepEqual(f.calls[2], ['tmux', 'send-keys', '-t', '%5', '-l', '--', 'hi']);
    const bad = await (await fetch(`${base}/send`, { method: 'POST', headers: H, body: JSON.stringify({ agent: 'bad', text: 'hi' }) })).json();
    assert.equal(bad.sent, false);
    await join1('ing', 'tmux:%12');
    const viaIngest = await (await fetch(`${base}/send`, { method: 'POST', headers: H, body: JSON.stringify({ agent: 'ing', text: 'yo' }) })).json();
    assert.deepEqual(viaIngest, { sent: true });
  } finally {
    await floor.close();
  }
});
