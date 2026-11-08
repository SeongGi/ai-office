import { createScript } from '../../shared/demo-script.js';
import type { Effect, FloorEvent, WorldState } from '../../shared/protocol';
import { store } from './store';
import { DEMO_ONLY } from '../config';
import { applyOffice, touchOffice } from './office';

const params = new URLSearchParams(location.search);

/** Where the floor server lives. Same origin by default; `?server=` overrides. */
function serverBase() {
  const explicit = params.get('server');
  if (explicit) return explicit.replace(/\/$/, '');
  return '';
}

let demoTimer: number | undefined;
let sweepTimer: number | undefined;
let demoRunning = false;

export function startDemo() {
  if (demoRunning) return;
  demoRunning = true;
  store.replace({ teams: {}, agents: {}, seq: 0, updatedAt: Date.now() });
  store.setMode('demo');
  const script = createScript();
  const step = () => {
    const { wait, events } = script.next();
    for (const ev of events) store.applyLocal({ ...ev, ts: Date.now() });
    demoTimer = window.setTimeout(step, wait);
  };
  step();
  sweepTimer = window.setInterval(() => store.sweepLocal(), 2000);
}

export function stopDemo() {
  if (!demoRunning) return;
  demoRunning = false;
  window.clearTimeout(demoTimer);
  window.clearInterval(sweepTimer);
}

export function isDemoRunning() {
  return demoRunning;
}

export interface DismissResult {
  ok: boolean;
  reason?: string;
}

/**
 * 퇴사시킨다. 서버가 상태를 보고 판단해야 하므로 /close를 먼저 부르고 답을 본다.
 * 닫혔거나(true, 'queued') 닫을 수 있는 Claude 세션이 아니면(이미 퇴근, 터미널 모름) leave를 보낸다.
 * 일하는 중이거나 권한 확인 중이라 거절하면 내보내지 않고 사유를 돌려준다.
 */
export async function dismissAgent(agent: string, activity: string): Promise<DismissResult> {
  if (demoRunning) {
    store.applyLocal({ type: 'leave', agent, activity, ts: Date.now() });
    return { ok: true };
  }
  const leave = () =>
    fetch(`${serverBase()}/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'leave', agent, activity }),
    }).catch(() => {});
  let body: { closed?: boolean | 'queued'; reason?: string; busy?: boolean } | null;
  try {
    const res = await fetch(`${serverBase()}/close`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agent }),
    });
    body = await res.json().catch(() => null);
  } catch {
    return { ok: false, reason: '서버에 닿지 못했어요' };
  }
  if (body?.busy === true) return { ok: false, reason: body.reason || '지금은 닫지 않았어요' };
  await leave();
  return { ok: true };
}

/** 이 화면에서 지시를 보낼 수 있는지. /whoami를 한 번만 물어 기억한다. 서버가 없으면 false. */
let control: boolean | null = null;

export function controlAllowed() {
  return control === true && !demoRunning;
}

async function loadWhoami() {
  try {
    const res = await fetch(`${serverBase()}/whoami`);
    control = res.ok ? Boolean((await res.json()).control) : false;
  } catch {
    control = null; // 서버에 닿지 못했으니 다음 접속 때 다시 묻는다
  }
  touchOffice(); // 권한을 알게 됐으니 이름 질문을 띄울지 다시 본다
}

export interface SendResult {
  sent: boolean | 'queued';
  reason?: string;
}

/** 직원에게 지시를 보낸다. 거절 사유는 서버가 한국어로 준다. */
export async function sendInstruction(agent: string, text: string): Promise<SendResult> {
  try {
    const res = await fetch(`${serverBase()}/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agent, text }),
    });
    const body = await res.json().catch(() => ({}));
    if (body && body.sent !== undefined) return body as SendResult;
    return { sent: false, reason: body?.error || `서버 응답 ${res.status}` };
  } catch {
    return { sent: false, reason: '서버에 닿지 못했어요' };
  }
}

export interface RenameResult {
  ok: boolean;
  name?: string;
  reason?: string;
}

/** 직원 이름을 고친다. 빈 이름은 고친 이름을 지우고 세션 제목으로 돌린다. 거절 사유는 서버가 한국어로 준다. */
export async function renameAgent(agent: string, name: string): Promise<RenameResult> {
  try {
    const res = await fetch(`${serverBase()}/rename`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agent, name }),
    });
    const body = await res.json().catch(() => ({}));
    if (body?.ok === true) return { ok: true, name: body.name };
    return { ok: false, reason: body?.reason || body?.error || `서버 응답 ${res.status}` };
  } catch {
    return { ok: false, reason: '서버에 닿지 못했어요' };
  }
}

export interface OfficeNameResult {
  ok: boolean;
  reason?: string;
}

/** 사무실 이름을 정한다. 거절 사유는 서버가 한국어로 준다. 성공하면 바로 화면에도 반영한다. */
export async function setOfficeName(name: string): Promise<OfficeNameResult> {
  try {
    const res = await fetch(`${serverBase()}/office`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok && typeof body?.name === 'string') {
      applyOffice(body);
      return { ok: true };
    }
    return { ok: false, reason: body?.error || `서버 응답 ${res.status}` };
  } catch {
    return { ok: false, reason: '서버에 닿지 못했어요' };
  }
}

export function connect() {
  if (params.has('demo') || (DEMO_ONLY && !params.has('server'))) {
    startDemo();
    return;
  }
  const base = serverBase();
  let opened = false;
  // Without a reachable server (hosted demo, floor not started) show the demo
  // after a moment, but keep retrying so a live floor takes over when it appears.
  const fallback = window.setTimeout(() => {
    if (!opened) startDemo();
  }, 2200);

  const open = () => {
    const es = new EventSource(`${base}/stream`);
    es.addEventListener('snapshot', (msg) => {
      opened = true;
      window.clearTimeout(fallback);
      if (control === null) void loadWhoami();
      stopDemo();
      const { state, office } = JSON.parse((msg as MessageEvent).data) as { state: WorldState; office?: unknown };
      applyOffice(office);
      store.replace(state);
      store.setMode('live');
    });
    es.addEventListener('office', (msg) => {
      applyOffice(JSON.parse((msg as MessageEvent).data));
    });
    es.addEventListener('event', (msg) => {
      if (demoRunning) return;
      const { event, effects } = JSON.parse((msg as MessageEvent).data) as { event: FloorEvent; effects: Effect[] };
      store.applyRemote(event, effects);
    });
    es.addEventListener('removed', (msg) => {
      if (demoRunning) return;
      store.remove((JSON.parse((msg as MessageEvent).data) as { agents: string[] }).agents);
    });
    es.onerror = () => {
      if (!demoRunning && opened) store.setMode('connecting');
      // EventSource retries on its own while the server answers with errors;
      // if it gives up (CLOSED) we retry after a pause.
      if (es.readyState === EventSource.CLOSED) window.setTimeout(open, 3000);
    };
  };
  open();
}
