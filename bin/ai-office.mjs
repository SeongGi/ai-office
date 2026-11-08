#!/usr/bin/env node
// ai-office CLI
//
//   ai-office [start] [--port 4317] [--open]   run the floor
//   ai-office hook <claude|codex|cursor>      used by agent hooks (reads stdin / argv)
//   ai-office emit --agent id --status working --activity "..."  [--team x] [--to id --text "..."]
//   ai-office setup <claude|codex|cursor> [--write] [--project]
//   ai-office meeting start [--all] [topic] | meeting end
//   ai-office seed                             이 기기의 열린 Claude 세션을 서버에 올린다
//   ai-office close-agent                      서버가 맡긴 닫기와 지시 요청을 이 기기에서 실행한다(AI_OFFICE_DEVICE 필수)
//   ai-office demo                             push a scripted demo into a running floor
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { env, isOwnHook } from '../shared/env.cjs';

const here = dirname(fileURLToPath(import.meta.url));
const SELF = resolve(here, 'ai-office.mjs');
const PORT = Number(env('PORT')) || 4317;
const URL_BASE = (env('URL') || `http://127.0.0.1:${PORT}`).replace(/\/$/, '');
const IS_LOCAL = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/.test(URL_BASE);
const require = createRequire(import.meta.url);
const TOKEN = env('TOKEN') || '';
const authHeaders = (extra = {}) => (TOKEN ? { ...extra, Authorization: `Bearer ${TOKEN}` } : extra);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const [, , cmd = 'app', ...rest] = process.argv;

function flags(args) {
  const out = { _: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = args[i + 1];
      if (next === undefined || next.startsWith('--')) out[key] = true;
      else {
        out[key] = next;
        i++;
      }
    } else out._.push(a);
  }
  return out;
}

async function post(events) {
  if (!events.length) return;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 1200);
  try {
    await fetch(`${URL_BASE}/events`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(events),
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function readStdin() {
  if (process.stdin.isTTY) return '';
  let data = '';
  for await (const chunk of process.stdin) data += chunk;
  return data;
}

function parseJson(text) {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- auto-launch

async function healthy() {
  try {
    const res = await fetch(`${URL_BASE}/health`, { signal: AbortSignal.timeout(400) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Send events; if the floor is not running, open the desktop app and resend.
 * Guarded so it never spams windows: one launcher at a time (lock file), a
 * snooze after "Quit", and AI_OFFICE_AUTOLAUNCH=0 to turn it off.
 */
async function postOrLaunch(events) {
  if (!events.length) return;
  try {
    await post(events);
    return;
  } catch {
    /* not running (or slow); fall through */
  }
  if (!IS_LOCAL || env('AUTOLAUNCH') === '0') return;
  const { isSnoozed, takeLaunchLock } = require('../desktop/state.cjs');
  if (isSnoozed()) return;
  if (takeLaunchLock()) await openApp({ fromHook: true });
  // Wait for the floor (ours or one another hook is starting), then resend.
  for (let i = 0; i < 35; i++) {
    await sleep(100);
    if (await healthy()) {
      await post(events).catch(() => {});
      return;
    }
  }
}

function findChromium() {
  if (process.platform === 'darwin') {
    for (const app of ['Google Chrome', 'Microsoft Edge', 'Brave Browser', 'Chromium', 'Arc'])
      if (existsSync(`/Applications/${app}.app`)) return { mac: app };
    return null;
  }
  const names = process.platform === 'win32' ? ['chrome', 'msedge'] : ['google-chrome', 'chromium', 'chromium-browser', 'microsoft-edge', 'brave-browser'];
  for (const n of names) {
    const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [n], { encoding: 'utf8' });
    if (r.status === 0 && r.stdout.trim()) return { bin: r.stdout.trim().split(/\r?\n/)[0] };
  }
  return null;
}

/**
 * Open the floor in its own window. Prefers the Electron desktop app; falls
 * back to a Chromium "app window" (no tabs, no address bar), then the browser.
 */
async function openApp({ fromHook = false, browser = false } = {}) {
  const detached = { detached: true, stdio: 'ignore' };
  let electron = null;
  if (!browser) {
    try {
      electron = require('electron');
    } catch {
      electron = null;
    }
  }
  if (typeof electron === 'string' && existsSync(electron)) {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    spawn(electron, [resolve(here, '../desktop/main.cjs'), ...(fromHook ? ['--from-hook'] : [])], { ...detached, env }).unref();
    return 'desktop';
  }
  // No Electron: run the server in the background, then open a window onto it.
  if (!(await healthy())) {
    spawn(process.execPath, [SELF, 'start'], detached).unref();
    for (let i = 0; i < 30 && !(await healthy()); i++) await sleep(100);
  }
  const url = `http://127.0.0.1:${PORT}/?app=1`;
  const chromium = browser ? null : findChromium();
  if (chromium?.mac) spawn('open', ['-na', chromium.mac, '--args', `--app=${url}`, '--new-window'], detached).unref();
  else if (chromium?.bin) spawn(chromium.bin, [`--app=${url}`], detached).unref();
  else {
    const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
    const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
    spawn(opener, args, detached).unref();
  }
  return chromium ? 'app-window' : 'browser';
}

async function app(args) {
  const f = flags(args);
  const how = await openApp({ browser: Boolean(f.browser) });
  console.log(
    how === 'desktop'
      ? 'AI Office is opening in its own window. It keeps running in the menu bar when you close it.'
      : how === 'app-window'
        ? 'AI Office is opening in an app window. Install Electron (npm i -g electron) for the full desktop app.'
        : `AI Office is running at http://127.0.0.1:${PORT}`,
  );
}

// ---------------------------------------------------------------- hook
// A hook must never slow down or break the agent. Every failure is swallowed
// and the process always exits 0.
async function hook(kind) {
  let response = '';
  try {
    if (kind === 'claude') {
      const { fromClaude } = await import('../adapters/claude.mjs');
      await postOrLaunch(fromClaude(parseJson(await readStdin())));
    } else if (kind === 'codex') {
      const { fromCodex } = await import('../adapters/codex.mjs');
      // notify passes JSON as the last argv entry; hooks pass it on stdin.
      const arg = rest.slice(1).find((x) => x.trim().startsWith('{'));
      const input = parseJson(arg) || parseJson(await readStdin());
      await postOrLaunch(fromCodex(input));
    } else if (kind === 'cursor') {
      const { fromCursor, cursorResponse } = await import('../adapters/cursor.mjs');
      const input = parseJson(await readStdin());
      response = cursorResponse(input?.hook_event_name);
      await postOrLaunch(fromCursor(input));
    }
  } catch {
    // Floor not running, or bad payload. Stay silent.
  }
  if (response) process.stdout.write(response);
  process.exit(0);
}

// ---------------------------------------------------------------- emit
async function emit(args) {
  const f = flags(args);
  if (!f.agent) {
    console.error('Usage: ai-office emit --agent <id> [--type status] [--status working] [--activity "..."] [--team name] [--role role] [--to id --text "..."]');
    process.exit(1);
  }
  const ev = {
    type: f.type || (f.to ? 'message' : f.tool ? 'tool' : f.task ? 'task' : 'status'),
    agent: f.agent,
    team: f.team,
    name: f.name,
    role: f.role,
    source: f.source || 'cli',
    parent: f.parent,
    status: f.status,
    activity: f.activity,
    tool: f.tool,
    task: f.task,
    to: f.to ? String(f.to).split(',') : undefined,
    text: f.text,
  };
  try {
    await post([ev]);
  } catch (err) {
    console.error(`Could not reach ${URL_BASE}. Is the floor running? (${err.message})`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------- meeting
async function meeting(args) {
  const f = flags(args);
  const action = f._[0];
  if (action !== 'start' && action !== 'end') {
    console.error('사용법: ai-office meeting start [--all] [주제] | ai-office meeting end');
    process.exit(1);
  }
  // A bare flag swallows the next word in flags(); read the topic from raw args instead.
  const topic = args.slice(1).filter((x) => x !== '--all').join(' ').trim();
  const ev = { type: 'meeting', meeting: action, source: 'cli' };
  if (action === 'start') {
    if (topic) ev.text = topic;
    if (args.includes('--all')) ev.all = true;
  }
  try {
    await post([ev]);
  } catch (err) {
    console.error(`${URL_BASE}에 연결하지 못했어요. 오피스가 켜져 있나요? (${err.message})`);
    process.exit(1);
  }
  console.log(action === 'start' ? `전체 회의를 시작했어요${topic ? `: ${topic}` : ''}` : '회의를 끝냈어요');
}

// ---------------------------------------------------------------- setup
// When run through `npx`, this file lives in a throwaway cache, so point hooks
// at the package name instead of the file path.
const viaNpx = /[\\/]_npx[\\/]/.test(SELF);
const hookCmd = (kind) => (viaNpx ? `npx -y ai-office hook ${kind}` : `node "${SELF}" hook ${kind}`);

function claudeHooks() {
  const command = hookCmd('claude');
  const events = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'Notification', 'Stop', 'SubagentStop', 'PreCompact', 'SessionEnd'];
  const hooks = {};
  for (const e of events) {
    const entry = { hooks: [{ type: 'command', command, timeout: 5 }] };
    if (e === 'PreToolUse' || e === 'PostToolUse' || e === 'PostToolUseFailure') entry.matcher = '*';
    hooks[e] = [entry];
  }
  return hooks;
}

function cursorHooks() {
  const command = hookCmd('cursor');
  const names = ['beforeSubmitPrompt', 'afterAgentThought', 'afterAgentResponse', 'afterFileEdit', 'afterShellExecution', 'afterMCPExecution', 'stop'];
  return { version: 1, hooks: Object.fromEntries(names.map((n) => [n, [{ command }]])) };
}

async function readJsonFile(path) {
  if (!existsSync(path)) return {};
  const parsed = parseJson(await readFile(path, 'utf8'));
  if (!parsed) throw new Error(`${path} is not valid JSON. Fix it or merge the snippet by hand.`);
  return parsed;
}

async function backupAndWrite(path, data) {
  await mkdir(dirname(path), { recursive: true });
  if (existsSync(path)) await copyFile(path, `${path}.bak`);
  await writeFile(path, JSON.stringify(data, null, 2) + '\n');
}

// 옛 이름으로 설치된 항목과 새 항목을 둘 다 알아본다(규칙은 shared/env.cjs).
const isOurs = isOwnHook;

async function setup(args) {
  const f = flags(args);
  const kind = f._[0];
  if (kind === 'claude') {
    const hooks = claudeHooks();
    const path = f.project ? resolve('.claude/settings.json') : join(homedir(), '.claude', 'settings.json');
    if (!f.write) {
      console.log(`Add this to ${path} (or rerun with --write to merge it for you):\n`);
      console.log(JSON.stringify({ hooks }, null, 2));
      return;
    }
    const settings = await readJsonFile(path);
    settings.hooks ||= {};
    for (const [event, entries] of Object.entries(hooks)) {
      const kept = (settings.hooks[event] || []).filter((e) => !isOurs(e));
      settings.hooks[event] = [...kept, ...entries];
    }
    await backupAndWrite(path, settings);
    console.log(`Merged AI Office hooks into ${path} (backup at ${path}.bak). AI Office will open by itself the next time a Claude Code session starts.`);
  } else if (kind === 'cursor') {
    const config = cursorHooks();
    const path = f.project ? resolve('.cursor/hooks.json') : join(homedir(), '.cursor', 'hooks.json');
    if (!f.write) {
      console.log(`Add this to ${path} (or rerun with --write to merge it for you):\n`);
      console.log(JSON.stringify(config, null, 2));
      return;
    }
    const current = await readJsonFile(path);
    current.version ||= 1;
    current.hooks ||= {};
    for (const [event, entries] of Object.entries(config.hooks)) {
      const kept = (current.hooks[event] || []).filter((e) => !isOurs(e));
      current.hooks[event] = [...kept, ...entries];
    }
    await backupAndWrite(path, current);
    console.log(`Merged AI Office hooks into ${path} (backup at ${path}.bak). AI Office will open by itself the next time a Cursor agent runs.`);
  } else if (kind === 'codex') {
    const path = join(homedir(), '.codex', 'config.toml');
    console.log(`Add this line near the top of ${path}:\n`);
    console.log(viaNpx ? 'notify = ["npx", "-y", "ai-office", "hook", "codex"]\n' : `notify = ["node", "${SELF}", "hook", "codex"]\n`);
    console.log('Codex allows one notify program. If you already have one, chain them in a small script.');
  } else {
    console.log('Usage: ai-office setup <claude|codex|cursor> [--write] [--project]');
    process.exit(1);
  }
}

// ---------------------------------------------------------------- start
async function start(args) {
  const f = flags(args);
  const { startServer } = await import('../server/index.mjs');
  const port = Number(f.port) || undefined;
  const host = f.host || undefined;
  try {
    await startServer({ port, host });
    if (f.open) await openApp({ browser: Boolean(f.browser) });
    console.log('Connect an agent:  ai-office setup claude | codex | cursor');
    console.log('Press Ctrl+C to stop.');
  } catch (err) {
    console.error(err.code === 'EADDRINUSE' ? `Port ${port || 4317} is already in use. Try --port 4318.` : err.message);
    process.exit(1);
  }
}

// ---------------------------------------------------------------- seed
async function seed() {
  const { seedEvents } = await import('../adapters/seed.mjs');
  const events = seedEvents();
  if (!events.length) {
    console.log('올릴 세션이 없어요');
    return;
  }
  let accepted = 0;
  try {
    for (let i = 0; i < events.length; i += 200) {
      const res = await fetch(`${URL_BASE}/events`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(events.slice(i, i + 200)),
        signal: AbortSignal.timeout(8000),
      });
      if (res.status === 401) throw new Error('토큰이 맞지 않아요(AI_OFFICE_TOKEN)');
      if (!res.ok) throw new Error(`서버 응답 ${res.status}`);
      accepted += (await res.json()).accepted || 0;
    }
  } catch (err) {
    console.error(`${URL_BASE}에 올리지 못했어요. (${err.message})`);
    process.exit(1);
  }
  console.log(`세션 ${events.length}개 중 ${accepted}개를 올렸어요`);
}

// ---------------------------------------------------------------- close-agent
async function closeAgent() {
  const device = String(env('DEVICE') || '').trim();
  if (!device) {
    console.error('AI_OFFICE_DEVICE가 필요해요(이 기기 이름).');
    process.exit(1);
  }
  const { closeOrcaTerminal } = await import('../adapters/orca-close.mjs');
  const { sendOrcaPrompt } = await import('../adapters/orca-send.mjs');
  let stop = false;
  let wake = () => {};
  const bye = () => {
    stop = true;
    wake();
  };
  process.on('SIGINT', bye);
  process.on('SIGTERM', bye);
  const stamp = () => new Date().toLocaleTimeString('ko-KR', { hour12: false });
  console.log(`[${stamp()}] close-agent 시작: 기기 "${device}", 서버 ${URL_BASE}`);
  let down = false;
  while (!stop) {
    try {
      const res = await fetch(`${URL_BASE}/close-queue?device=${encodeURIComponent(device)}`, {
        headers: authHeaders(),
        signal: AbortSignal.timeout(5000),
      });
      if (res.status === 401) throw new Error('토큰이 맞지 않아요');
      if (!res.ok) throw new Error(`서버 응답 ${res.status}`);
      if (down) console.log(`[${stamp()}] 서버에 다시 연결됐어요`);
      down = false;
      const { items = [] } = await res.json();
      for (const item of items) {
        // kind가 없는 옛 서버의 항목은 닫기다. 지시 글은 로그에 남기지 않는다.
        if (item.kind === 'prompt') {
          const r = await sendOrcaPrompt(item.terminal, String(item.text ?? ''));
          console.log(`[${stamp()}] ${item.agent}: ${r.sent ? '지시를 보냈어요' : `지시를 보내지 않았어요 (${r.reason})`}`);
        } else {
          const r = await closeOrcaTerminal(item.terminal);
          console.log(`[${stamp()}] ${item.agent}: ${r.closed ? '닫았어요' : `닫지 않았어요 (${r.reason})`}`);
        }
      }
    } catch (err) {
      if (!down) console.log(`[${stamp()}] 서버에 닿지 못해요, 계속 다시 시도해요 (${err.message})`);
      down = true;
    }
    await new Promise((r) => {
      wake = r;
      setTimeout(r, 2000);
    });
  }
  console.log(`[${stamp()}] close-agent 종료`);
  process.exit(0);
}

// ---------------------------------------------------------------- demo
async function demo(args) {
  const f = flags(args);
  const { createScript } = await import('../shared/demo-script.js');
  const script = createScript(Date.now(), { agents: Number(f.agents) || 0 });
  console.log(`Streaming a demo into ${URL_BASE}. Ctrl+C to stop.`);
  let failures = 0;
  for (;;) {
    const step = script.next();
    try {
      await post(step.events);
      failures = 0;
    } catch {
      // A slow moment is fine; give up only if the floor is really gone.
      if (++failures >= 5) {
        console.error(`Could not reach ${URL_BASE}. Start the floor first: ai-office start`);
        process.exit(1);
      }
    }
    await new Promise((r) => setTimeout(r, step.wait));
  }
}

const commands = { app, start, hook: () => hook(rest[0]), emit, setup, demo, meeting, seed, 'close-agent': closeAgent };
if (cmd === '--help' || cmd === '-h' || cmd === 'help') {
  console.log(`ai-office: a live 3D office for your coding agents

  ai-office                              open the desktop app (starts the floor too)
  ai-office start [--port 4317] [--open] run the floor without a window
  ai-office setup <claude|codex|cursor> [--write] [--project]
  ai-office emit --agent <id> --status working --activity "Writing tests" [--team checkout]
  ai-office meeting start [--all] [주제]  전체 회의 시작 (meeting end 로 끝냄)
  ai-office seed                         이 기기의 열린 Claude 세션을 서버에 올림
  ai-office close-agent                  서버가 맡긴 닫기와 지시 요청을 이 기기에서 실행
  ai-office demo [--agents 60]          (stress test with many agents)
  ai-office hook <claude|codex|cursor>    (called by agent hooks)

Environment: AI_OFFICE_URL, AI_OFFICE_TOKEN, AI_OFFICE_DEVICE, AI_OFFICE_PORT, AI_OFFICE_TEAM, AI_OFFICE_NAME,\n             AI_OFFICE_AUTOLAUNCH=0 (hooks never open the app)`);
} else if (commands[cmd]) {
  await commands[cmd](rest);
} else if (cmd.startsWith('--')) {
  await start([cmd, ...rest]);
} else {
  console.error(`Unknown command "${cmd}". Try ai-office --help`);
  process.exit(1);
}
