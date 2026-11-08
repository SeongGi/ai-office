// 이름 변경(Agent Floor -> AI Office) 호환 규칙을 확인한다.
// 새 환경변수(AI_OFFICE_*)가 우선이고, 옛 이름(AGENT_FLOOR_*)은 새 이름이 없을 때만 읽는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deviceName } from '../adapters/common.mjs';
import { startServer } from '../server/index.mjs';

const { env, envKeys, stateDir, isOwnHook } = createRequire(import.meta.url)('../shared/env.cjs');
const CLI = fileURLToPath(new URL('../bin/ai-office.mjs', import.meta.url));

/** 환경변수를 잠시 바꿔 실행하고 원래대로 돌려놓는다. 값이 undefined면 지운다. */
async function withEnv(vars, fn) {
  const saved = {};
  for (const key of Object.keys(vars)) {
    saved[key] = process.env[key];
    if (vars[key] === undefined) delete process.env[key];
    else process.env[key] = vars[key];
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const NONE = { AI_OFFICE_DEVICE: undefined, AGENT_FLOOR_DEVICE: undefined };

test('env: 새 이름만 설정하면 새 값을 읽는다', () => {
  assert.equal(env('DEVICE', { AI_OFFICE_DEVICE: '새' }), '새');
  return withEnv({ ...NONE, AI_OFFICE_DEVICE: '새 기기' }, () => assert.equal(deviceName(), '새 기기'));
});

test('env: 옛 이름만 설정하면 옛 값을 읽는다', () => {
  assert.equal(env('DEVICE', { AGENT_FLOOR_DEVICE: '옛' }), '옛');
  return withEnv({ ...NONE, AGENT_FLOOR_DEVICE: '옛 기기' }, () => assert.equal(deviceName(), '옛 기기'));
});

test('env: 둘 다 설정하면 새 이름이 이긴다', () => {
  assert.equal(env('DEVICE', { AI_OFFICE_DEVICE: '새', AGENT_FLOOR_DEVICE: '옛' }), '새');
  return withEnv({ AI_OFFICE_DEVICE: '새 기기', AGENT_FLOOR_DEVICE: '옛 기기' }, () => assert.equal(deviceName(), '새 기기'));
});

test('env: 아무것도 없으면 undefined, 키 목록은 새 이름이 먼저다', () => {
  assert.equal(env('DEVICE', {}), undefined);
  assert.deepEqual(envKeys('TOKEN'), ['AI_OFFICE_TOKEN', 'AGENT_FLOOR_TOKEN']);
});

test('서버는 옛 토큰 이름도 읽고, 둘 다 있으면 새 토큰을 쓴다', async () => {
  const get = (base, token) => fetch(`${base}/state`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  const gone = { AI_OFFICE_TOKEN: undefined, AGENT_FLOOR_TOKEN: undefined };
  await withEnv({ ...gone, AGENT_FLOOR_TOKEN: 'old-tok' }, async () => {
    const floor = await startServer({ port: 0, log: () => {}, seed: false });
    const base = `http://127.0.0.1:${floor.server.address().port}`;
    try {
      assert.equal((await get(base)).status, 401);
      assert.equal((await get(base, 'old-tok')).status, 200);
    } finally {
      await floor.close();
    }
  });
  await withEnv({ AI_OFFICE_TOKEN: 'new-tok', AGENT_FLOOR_TOKEN: 'old-tok' }, async () => {
    const floor = await startServer({ port: 0, log: () => {}, seed: false });
    const base = `http://127.0.0.1:${floor.server.address().port}`;
    try {
      assert.equal((await get(base, 'new-tok')).status, 200);
      assert.equal((await get(base, 'old-tok')).status, 401);
    } finally {
      await floor.close();
    }
  });
});

test('stateDir: AI_OFFICE_HOME, 옛 AGENT_FLOOR_HOME, 새 이름이 우선이다', () => {
  const home = '/h';
  const exists = () => false;
  assert.equal(stateDir({ source: { AI_OFFICE_HOME: '/new' }, home, exists }), '/new');
  assert.equal(stateDir({ source: { AGENT_FLOOR_HOME: '/old' }, home, exists }), '/old');
  assert.equal(stateDir({ source: { AI_OFFICE_HOME: '/new', AGENT_FLOOR_HOME: '/old' }, home, exists }), '/new');
});

test('stateDir: 새 폴더가 없고 옛 폴더만 있으면 옛 폴더를 쓴다', () => {
  const home = '/h';
  const only = (...dirs) => (p) => dirs.includes(p);
  assert.equal(stateDir({ source: {}, home, exists: only() }), join(home, '.ai-office'));
  assert.equal(stateDir({ source: {}, home, exists: only(join(home, '.agent-floor')) }), join(home, '.agent-floor'));
  assert.equal(stateDir({ source: {}, home, exists: only(join(home, '.ai-office')) }), join(home, '.ai-office'));
  assert.equal(stateDir({ source: {}, home, exists: only(join(home, '.ai-office'), join(home, '.agent-floor')) }), join(home, '.ai-office'));
});

test('isOwnHook: 옛 항목과 새 항목을 모두 알아보고 남의 훅은 건드리지 않는다', () => {
  assert.ok(isOwnHook({ hooks: [{ type: 'command', command: 'node "/a/agent-floor.mjs" hook claude' }] }));
  assert.ok(isOwnHook({ hooks: [{ type: 'command', command: 'node "/a/ai-office.mjs" hook claude' }] }));
  assert.ok(isOwnHook({ command: 'npx -y agent-floor hook cursor' }));
  assert.ok(isOwnHook({ command: 'ai-office hook cursor' }));
  assert.ok(!isOwnHook({ hooks: [{ type: 'command', command: 'echo done' }] }));
});

/** 임시 HOME에서 CLI를 실행한다. 실제 홈 설정은 건드리지 않는다. */
function runCli(home, args) {
  const clean = { ...process.env, HOME: home, USERPROFILE: home };
  for (const key of Object.keys(clean)) if (/^(AI_OFFICE|AGENT_FLOOR)_/.test(key)) delete clean[key];
  const res = spawnSync(process.execPath, [CLI, ...args], { env: clean, cwd: home, encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr);
  return res;
}

test('setup claude --write: 옛 훅 항목을 중복 없이 새 명령으로 바꾼다', () => {
  const home = mkdtempSync(join(tmpdir(), 'ai-office-compat-'));
  const dir = join(home, '.claude');
  mkdirSync(dir, { recursive: true });
  const old = (cmd) => ({ hooks: [{ type: 'command', command: cmd, timeout: 5 }] });
  const mine = { hooks: [{ type: 'command', command: 'echo mine' }] };
  writeFileSync(
    join(dir, 'settings.json'),
    JSON.stringify({
      theme: 'dark',
      hooks: {
        SessionStart: [mine, old('node "/old/agent-floor/bin/agent-floor.mjs" hook claude'), old('npx -y agent-floor hook claude')],
        PreToolUse: [{ matcher: '*', ...old('node "/old/agent-floor/bin/agent-floor.mjs" hook claude') }],
      },
    }),
  );
  const check = () => {
    const settings = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'));
    assert.equal(settings.theme, 'dark');
    for (const [event, entries] of Object.entries(settings.hooks)) {
      const text = JSON.stringify(entries);
      assert.ok(!/agent-floor\.mjs|agent-floor hook/.test(text), `${event}에 옛 항목이 남았다`);
      const ours = entries.filter((e) => JSON.stringify(e).includes('ai-office.mjs'));
      assert.equal(ours.length, 1, `${event}의 새 항목이 하나여야 한다`);
    }
    assert.deepEqual(settings.hooks.SessionStart[0], mine);
    assert.equal(settings.hooks.SessionStart.length, 2);
    return settings;
  };
  runCli(home, ['setup', 'claude', '--write']);
  const first = check();
  runCli(home, ['setup', 'claude', '--write']);
  assert.deepEqual(check(), first, '두 번 실행해도 같아야 한다');
});

test('setup cursor --write: 옛 훅 항목도 같은 방식으로 바꾼다', () => {
  const home = mkdtempSync(join(tmpdir(), 'ai-office-compat-'));
  const dir = join(home, '.cursor');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'hooks.json'), JSON.stringify({ version: 1, hooks: { stop: [{ command: 'agent-floor hook cursor' }] } }));
  runCli(home, ['setup', 'cursor', '--write']);
  const config = JSON.parse(readFileSync(join(dir, 'hooks.json'), 'utf8'));
  assert.equal(config.hooks.stop.length, 1);
  assert.match(config.hooks.stop[0].command, /ai-office\.mjs" hook cursor$/);
});
