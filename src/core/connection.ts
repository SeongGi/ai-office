import { createScript } from '../../shared/demo-script.js';
import type { Effect, FloorEvent, WorldState } from '../../shared/protocol';
import { store } from './store';
import { DEMO_ONLY } from '../config';

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

/** 화면에서만 직원을 내보낸다. 서버에 leave 이벤트만 보내고 세션 기록은 건드리지 않는다. */
export function dismissAgent(agent: string, activity: string) {
  if (demoRunning) {
    store.applyLocal({ type: 'leave', agent, activity, ts: Date.now() });
    return;
  }
  // 세션도 같이 닫는다. 서버가 상태를 보고 판단해야 하므로 /close를 먼저 부르고, 끝난 뒤 leave를 보낸다.
  // 서버가 조건(메인, 쉬는 중, Claude 터미널)을 못 맞추면 화면 퇴사만 남는다.
  const leave = () =>
    fetch(`${serverBase()}/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'leave', agent, activity }),
    }).catch(() => {});
  void fetch(`${serverBase()}/close`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ agent }),
  })
    .catch(() => {})
    .then(leave);
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
      const { state } = JSON.parse((msg as MessageEvent).data) as { state: WorldState };
      store.replace(state);
      store.setMode('live');
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
