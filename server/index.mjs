// AI Office server. Zero dependencies.
//
//   POST /events        one event or an array of events (see docs/protocol.md)
//   GET  /stream        Server-Sent Events: a `snapshot`, then `event` + `effects`
//   GET  /state         current world as JSON
//   POST /close         {agent}: 그 메인 세션의 Orca 터미널에 /exit을 보낸다(화면 퇴사는 /events leave). 제어 권한 필요
//   POST /rename        {agent, name}: 메인 세션의 이름을 고친다. 빈 이름은 고친 이름을 지운다. 제어 권한 필요
//   POST /send          {agent, text}: 그 메인 세션의 Orca 터미널에 지시를 보낸다. 제어 권한 필요
//   GET  /whoami        {control, email?}: 이 요청이 제어 권한을 가졌는지
//   GET  /office        {name, configured, locked}: 사무실 이름. 정하기 전에는 AI Office
//   POST /office        {name}: 사무실 이름을 정한다. 제어 권한 필요, AI_OFFICE_OFFICE_NAME이 있으면 고정이라 409
//   GET  /close-queue   ?device=<이름>: 다른 기기가 소유한 세션의 닫기와 지시 요청을 꺼내 간다(close-agent가 부른다)
//   POST /reset         clear the floor
//
// AI_OFFICE_TOKEN이 있으면 /health와 OPTIONS 말고는 전부 토큰이 필요하다.
// AI_OFFICE_MACHINE_PORT가 있으면 기계용 두 번째 포트가 열린다. POST /events, GET /close-queue, GET /health만 답하고
// Bearer 토큰이 필수이며 제어 권한은 없다. 사람은 구글 로그인 프록시(oauth2-proxy)를 거친 메인 포트로만 들어온다.
//   GET  /*             the built web app (dist/)
import { createServer } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { appendFile, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from '../shared/env.cjs';
import { TERMINAL_HANDLE_RE } from '../adapters/common.mjs';
import { seedEvents } from '../adapters/seed.mjs';
import { closeOrcaTerminal } from '../adapters/orca-close.mjs';
import { sendOrcaPrompt } from '../adapters/orca-send.mjs';
import { DEFAULT_OFFICE_NAME, validateOfficeName } from '../shared/officeName.js';
import { applyEvent, createState, normalizeEvent, sweep, PROTOCOL_VERSION } from '../shared/protocol.js';

const here = dirname(fileURLToPath(import.meta.url));
const MAX_BODY = 256 * 1024;
const QUEUE_TTL_MS = 60_000;
// 이유를 모르는 waiting을 입력 대기로 보는 기준 시간.
const WAIT_UNKNOWN_MS = 15 * 60_000;
const QUEUE_MAX = 200;
const SEND_MAX_CHARS = 2000;
const SEND_RATE_MAX = 6;
const SEND_RATE_WINDOW_MS = 60_000;
const AUDIT_TEXT_MAX = 500;
const NAME_MAX = 40;
const NAMES_MAX = 500;
const DEFAULT_NAMES = new Set(['Claude', 'Codex']);
const listOf = (v) =>
  (Array.isArray(v) ? v : String(v || '').split(','))
    .map((x) => String(x).trim().toLowerCase())
    .filter(Boolean);
// 한 방에 앉는 메인 세션 수. 넘치면 같은 팀의 다음 방("<팀> 2")을 연다.
const ROOM_MAX = Number(env('ROOM_MAX')) || 5;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

export function startServer({
  port = Number(env('PORT')) || 4317,
  host = env('HOST') || '127.0.0.1',
  staticDir = resolve(here, '../dist'),
  log = console.log,
  token = env('TOKEN') || '',
  device = env('DEVICE') || '',
  seed = env('SEED') !== '0',
  execFileImpl,
  // 기계용 두 번째 포트. 비워 두면 열지 않는다(0은 아무 빈 포트).
  machinePort = env('MACHINE_PORT') ? Number(env('MACHINE_PORT')) : null,
  // 프록시가 붙여 주는 x-auth-request-email 헤더를 사람 신원으로 믿을지.
  trustProxyEmail = env('TRUST_PROXY_EMAIL') === '1',
  // 제어 권한(닫기, 지시 보내기)을 가진 이메일 목록.
  admins = env('ADMINS'),
  allowBypassSend = env('ALLOW_BYPASS_SEND') === '1',
  auditPath = env('AUDIT') || resolve(here, '../data/audit.log'),
  // 관리자가 고친 직원 이름을 남기는 파일. 기본은 감사 기록과 같은 폴더.
  namesPath = env('NAMES') || join(dirname(auditPath), 'names.json'),
  // 사무실 이름을 남기는 파일. 기본은 감사 기록과 같은 폴더.
  officePath = env('OFFICE_FILE') || join(dirname(auditPath), 'office.json'),
  // 사무실 이름을 환경변수로 고정한다. 있으면 화면에서 바꿀 수 없다.
  officeName = env('OFFICE_NAME'),
  // 세션의 터미널과 기기 연결을 남기는 파일. 기본은 감사 기록과 같은 폴더.
  routesPath = env('ROUTES') || join(dirname(auditPath), 'routes.json'),
  // 시작할 때와, 닫기/지시 보내기가 터미널 핸들을 못 찾았을 때 다시 부르는 조회. 테스트가 갈아 끼운다.
  seedImpl = seedEvents,
} = {}) {
  const loopback = host === '127.0.0.1' || host === 'localhost' || host === '::1';
  const adminList = listOf(admins);
  // 프록시(oauth2-proxy)가 이미 로그인한 사람만 들여보내고 관리자 목록까지 있으면, 메인 포트의 토큰은 건너뛴다.
  // 메인 포트는 Docker가 밖으로 내보내지 않으므로 프록시를 거치지 않고는 닿을 수 없다.
  // 기계는 토큰이 필수인 기계용 포트로만 들어온다.
  const proxyGate = trustProxyEmail && adminList.length > 0;
  const mainToken = proxyGate ? '' : token;
  // 토큰이나 프록시 없이 밖으로 열면 누구나 오피스를 읽고 세션을 닫을 수 있다. 명시 허락이 없으면 시작하지 않는다.
  if (!loopback && !token && !proxyGate && env('INSECURE') !== '1') {
    return Promise.reject(
      new Error('AI_OFFICE_TOKEN 없이 외부 주소(' + host + ')로 열 수 없어요. 토큰을 정하거나, 정말 필요하면 AI_OFFICE_INSECURE=1을 쓰세요.'),
    );
  }
  if (machinePort !== null && !token) {
    return Promise.reject(new Error('기계용 포트(AI_OFFICE_MACHINE_PORT)는 AI_OFFICE_TOKEN이 있어야 열 수 있어요.'));
  }
  const state = createState();
  const clients = new Set();

  function broadcast(name, data) {
    const frame = `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of clients) res.write(frame);
  }

  /** 이미 앉은 직원은 방을 바꾸지 않는다. 새 메인 세션은 자리가 있는 첫 방에 앉힌다. */
  function assignRoom(ev) {
    if (!ev.team || ev.type === 'meeting') return;
    const known = state.agents[ev.agent] || (ev.parent && state.agents[ev.parent]);
    if (known) {
      ev.team = known.team;
      ev.teamName = state.teams[known.team]?.name ?? ev.teamName;
      return;
    }
    if (ev.parent) return;
    const base = ev.team;
    for (let n = 1; ; n++) {
      const id = n === 1 ? base : `${base}-${n}`;
      const seated = Object.values(state.agents).filter((a) => a.team === id && !a.parent).length;
      if (seated < ROOM_MAX) {
        ev.team = id;
        if (n > 1) ev.teamName = `${ev.teamName} ${n}`;
        return;
      }
    }
  }

  // 세션 id -> Orca 터미널 핸들, 세션 id -> 기기 이름. 화면에는 내보내지 않는다.
  const terminals = new Map();
  const devices = new Map();
  // 다른 기기가 소유한 세션의 닫기와 지시 요청(kind: 'close' | 'prompt'). 그 기기의 close-agent가 가져가 실행한다.
  let closeQueue = [];
  const pruneQueue = (now = Date.now()) => {
    closeQueue = closeQueue.filter((q) => now - q.ts <= QUEUE_TTL_MS);
  };

  // 서버가 재시작되면 terminals(메모리)가 비워진다. 세션이 그 뒤로 한 번도 움직이지 않았으면
  // (완료돼서 조용히 있는 세션이 특히 그렇다) handle이 영영 비어 있는다. 지금 다시 찾아본다 —
  // seed.mjs와 같은 방식(~/.claude/sessions의 pid로 터미널 핸들 복구)을 그 세션 하나에 대해 재실행한다.
  function recoverHandle(id) {
    try {
      for (const ev of seedImpl()) {
        if (ev.agent !== id || !ev.terminal) continue;
        terminals.set(id, ev.terminal);
        if (ev.device) devices.set(id, ev.device);
        return ev.terminal;
      }
    } catch (err) {
      log(`handle 복구 실패: ${err.message}`);
    }
    return undefined;
  }

  // 닫기와 지시가 같이 쓰는 검사. 메인 세션만, 일하지 않을 때만, 터미널 핸들을 알 때만 통과한다.
  // 통과하면 { agent, handle } 를, 막히면 { reason } 을 돌려준다.
  function guardSession(id, doing) {
    const agent = state.agents[id];
    if (!agent) return { reason: '직원을 찾지 못했어요' };
    if (agent.parent) return { reason: `서브에이전트는 ${doing}지 않아요` };
    const handle = terminals.get(id) || recoverHandle(id);
    if (!handle) return { reason: '아직 이 세션과 연결 전이에요. 세션이 한 번 움직이면 연결돼요' };
    if (['thinking', 'working'].includes(agent.status)) return { reason: `일하는 중이라 ${doing}지 않았어요`, busy: true };
    if (agent.status === 'waiting') {
      // 입력 대기(idle)는 쉬는 중과 같다. 권한 확인은 /exit 글자가 대화상자의 답이 될 수 있어 막는다.
      // 이유를 모르는 waiting은 15분 넘게 이어졌을 때만 입력 대기로 본다.
      if (agent.waitKind === 'permission') return { reason: `권한 확인을 기다리는 중이라 ${doing}지 않았어요`, busy: true };
      const old = Date.now() - (agent.statusSince ?? agent.lastSeen ?? Date.now()) > WAIT_UNKNOWN_MS;
      if (agent.waitKind !== 'idle' && !old) return { reason: `일하는 중이라 ${doing}지 않았어요`, busy: true };
    }
    return { agent, handle };
  }

  /** 다른 기기 세션의 요청을 큐에 넣는다. 넘치면 사유를 돌려준다. */
  function enqueue(item) {
    const now = Date.now();
    pruneQueue(now);
    // 닫기는 세션마다 하나만 남긴다. 지시는 보낸 순서대로 모두 남긴다.
    if (item.kind === 'close') closeQueue = closeQueue.filter((q) => !(q.kind === 'close' && q.agent === item.agent));
    if (closeQueue.length >= QUEUE_MAX) return '요청이 너무 많이 밀려 있어요';
    closeQueue.push({ ...item, ts: now });
    return null;
  }

  // 그 터미널이 아직 Claude일 때만 /exit을 보낸다.
  // 세션이 이 서버와 같은 기기에서 왔으면 바로 닫고, 아니면 그 기기의 close-agent에게 맡긴다.
  async function closeSession(id) {
    const g = guardSession(id, '닫');
    if (!g.handle) return { closed: false, reason: g.reason, ...(g.busy ? { busy: true } : {}) };
    const owner = devices.get(id) || '';
    if (owner !== device) {
      const full = enqueue({ kind: 'close', agent: id, terminal: g.handle, device: owner });
      return full ? { closed: false, reason: full, busy: true } : { closed: 'queued' };
    }
    const result = await closeOrcaTerminal(g.handle, execFileImpl);
    if (result.closed) terminals.delete(id);
    return result;
  }

  // 닫기와 같은 검사에 더해, 권한 확인 없이 도는 세션(bypassPermissions)에는 보내지 않는다.
  async function sendSession(id, text) {
    const g = guardSession(id, '보내');
    if (!g.handle) return { sent: false, reason: g.reason };
    if (g.agent.permission === 'bypassPermissions' && !allowBypassSend) {
      return { sent: false, reason: '권한 확인 없이 도는 세션이라 막았어요' };
    }
    const owner = devices.get(id) || '';
    if (owner !== device) {
      const full = enqueue({ kind: 'prompt', agent: id, terminal: g.handle, device: owner, text });
      return full ? { sent: false, reason: full } : { sent: 'queued' };
    }
    return sendOrcaPrompt(g.handle, text, execFileImpl);
  }

  // ---- 누가 요청했나. 프록시 헤더는 TRUST_PROXY_EMAIL=1일 때만 믿는다(켜지 않으면 위조 헤더는 무시한다).
  function emailOf(req) {
    if (!trustProxyEmail) return '';
    const v = req.headers['x-auth-request-email'] || req.headers['x-forwarded-email'];
    return String(Array.isArray(v) ? v[0] : v || '').trim().toLowerCase();
  }
  // 관리자 목록이 있으면 목록에 든 사람만. 목록도 프록시 신뢰도 없으면 이 컴퓨터에서만 쓰는 개발 모드라 모두 허용한다.
  function canControl(req) {
    if (adminList.length) return trustProxyEmail && adminList.includes(emailOf(req));
    return !trustProxyEmail && loopback;
  }

  // ---- 감사 기록. 쓰지 못해도 요청은 그대로 진행한다. 지시 글은 stdout에 남기지 않는다.
  async function audit(req, entry) {
    try {
      await mkdir(dirname(auditPath), { recursive: true });
      const line = { ts: new Date().toISOString(), email: emailOf(req), ...entry };
      if (typeof line.text === 'string') line.text = line.text.slice(0, AUDIT_TEXT_MAX);
      await appendFile(auditPath, JSON.stringify(line) + '\n');
    } catch {
      // 기록 실패가 지시를 막으면 안 된다.
    }
  }
  const auditResult = (r) => (r.sent === true || r.closed === true ? 'ok' : r.sent === 'queued' || r.closed === 'queued' ? 'queued' : `refused: ${r.reason}`);

  // ---- 지시 보내기 속도 제한: 같은 이메일(없으면 IP)당 1분에 6번.
  const sendHits = new Map();
  function rateLimited(req) {
    const key = emailOf(req) || req.socket.remoteAddress || '';
    const now = Date.now();
    const hits = (sendHits.get(key) || []).filter((t) => now - t < SEND_RATE_WINDOW_MS);
    if (hits.length >= SEND_RATE_MAX) {
      sendHits.set(key, hits);
      return true;
    }
    hits.push(now);
    sendHits.set(key, hits);
    return false;
  }
  const agentInfo = (id) => {
    const a = state.agents[id];
    return { agent: id, name: a?.name, device: devices.get(id) || '' };
  };

  function takeCloseQueue(owner) {
    pruneQueue();
    const mine = closeQueue.filter((q) => q.device === owner);
    closeQueue = closeQueue.filter((q) => q.device !== owner);
    return mine;
  }

  // ---- 직원 이름. customNames: 관리자가 고친 이름(파일로 남긴다), hookNames: 훅이 마지막으로 보낸 구체적인 이름.
  // 둘 다 삽입 순서대로 500개까지만 두고, 넘치면 오래된 것부터 지운다.
  const customNames = new Map();
  const hookNames = new Map();
  function remember(map, id, name) {
    map.delete(id);
    map.set(id, name);
    while (map.size > NAMES_MAX) map.delete(map.keys().next().value);
  }
  try {
    const saved = JSON.parse(readFileSync(namesPath, 'utf8'));
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
      for (const [id, name] of Object.entries(saved)) {
        if (typeof name === 'string' && name.trim()) remember(customNames, id.slice(0, 128), name.trim().slice(0, NAME_MAX));
      }
    }
  } catch {
    // 파일이 없거나 깨졌으면 빈 이름표로 시작한다.
  }
  // 저장은 하나씩 순서대로 쓴다. 쓰지 못해도 요청은 그대로 진행한다.
  let saving = Promise.resolve();
  function saveNames() {
    saving = saving.then(async () => {
      try {
        await mkdir(dirname(namesPath), { recursive: true });
        const tmp = `${namesPath}.tmp`;
        await writeFile(tmp, JSON.stringify(Object.fromEntries(customNames)));
        await rename(tmp, namesPath);
      } catch {
        // 이름 저장 실패가 이름 고치기를 막으면 안 된다.
      }
    });
    return saving;
  }

  // ---- 사무실 이름. 우선순위는 환경변수 고정 → office.json → 미설정(기본 이름 표시).
  // 파일 쓰기가 실패해도 요청은 성공하고, 그때는 서버를 다시 띄우면 이름이 사라진다.
  const lockedCheck = typeof officeName === 'string' && officeName.trim() ? validateOfficeName(officeName) : null;
  if (lockedCheck && !lockedCheck.ok) log(`AI_OFFICE_OFFICE_NAME을 쓰지 않았어요: ${lockedCheck.reason}`);
  const lockedName = lockedCheck?.ok ? lockedCheck.name : '';
  let savedOfficeName = '';
  try {
    const saved = JSON.parse(readFileSync(officePath, 'utf8'));
    const check = validateOfficeName(saved?.name);
    if (check.ok) savedOfficeName = check.name;
  } catch {
    // 파일이 없거나 깨졌으면 아직 정하지 않은 것으로 시작한다.
  }
  const officeInfo = () => {
    const name = lockedName || savedOfficeName;
    return { name: name || DEFAULT_OFFICE_NAME, configured: Boolean(name), locked: Boolean(lockedName) };
  };
  let savingOffice = Promise.resolve();
  function saveOffice() {
    savingOffice = savingOffice.then(async () => {
      try {
        await mkdir(dirname(officePath), { recursive: true });
        const tmp = `${officePath}.tmp`;
        await writeFile(tmp, JSON.stringify({ name: savedOfficeName }));
        await rename(tmp, officePath);
      } catch {
        // 이름 저장 실패가 이름 정하기를 막으면 안 된다.
      }
    });
    return savingOffice;
  }

  // 세션의 터미널과 기기도 파일로 남겨, 서버를 다시 띄워도 쉬는 세션에 지시와 퇴사가 닿게 한다.
  try {
    const saved = JSON.parse(readFileSync(routesPath, 'utf8'));
    for (const [id, h] of Object.entries(saved?.terminals ?? {})) {
      if (typeof h === 'string' && TERMINAL_HANDLE_RE.test(h)) terminals.set(id.slice(0, 128), h);
    }
    for (const [id, d] of Object.entries(saved?.devices ?? {})) {
      if (typeof d === 'string' && d.length <= 48) devices.set(id.slice(0, 128), d);
    }
  } catch {
    // 파일이 없거나 깨졌으면 빈 채로 시작한다. 세션이 다시 훅을 보내면 채워진다.
  }
  let savingRoutes = Promise.resolve();
  function saveRoutes() {
    savingRoutes = savingRoutes.then(async () => {
      try {
        await mkdir(dirname(routesPath), { recursive: true });
        const tmp = `${routesPath}.tmp`;
        await writeFile(tmp, JSON.stringify({ terminals: Object.fromEntries(terminals), devices: Object.fromEntries(devices) }));
        await rename(tmp, routesPath);
      } catch {
        // 저장 실패가 이벤트 처리를 막으면 안 된다.
      }
    });
  }

  /** 정규화, 방을 정하고 적용, 방송. 내부에서만 쓴다(rename도 여기로 들어온다). */
  function applyAndBroadcast(raw, tweak) {
    const ev = normalizeEvent(raw);
    if (!ev) return false;
    tweak?.(ev);
    assignRoom(ev);
    const { effects } = applyEvent(state, ev);
    broadcast('event', { event: ev, effects });
    return true;
  }

  function ingest(raw) {
    // rename은 관리자 길(POST /rename)로만 만든다. 바깥 이벤트로는 받지 않는다.
    if (raw && raw.type === 'rename') return false;
    let routesChanged = false;
    if (raw && typeof raw.agent === 'string' && typeof raw.terminal === 'string' && TERMINAL_HANDLE_RE.test(raw.terminal)) {
      if (terminals.get(raw.agent) !== raw.terminal) routesChanged = true;
      terminals.set(raw.agent, raw.terminal);
    }
    if (raw && typeof raw.agent === 'string' && typeof raw.device === 'string' && raw.device.length <= 48) {
      if (devices.get(raw.agent) !== raw.device) routesChanged = true;
      devices.set(raw.agent, raw.device);
    }
    if (routesChanged) saveRoutes();
    return applyAndBroadcast(raw, (ev) => {
      if (!ev.name || !ev.agent || ev.parent || ev.subagent) return;
      if (!DEFAULT_NAMES.has(ev.name)) remember(hookNames, ev.agent, ev.name);
      const custom = customNames.get(ev.agent);
      if (custom) ev.name = custom;
    });
  }

  if (seed) {
    try {
      for (const ev of seedImpl()) ingest(ev);
    } catch (err) {
      log(`seed failed: ${err.message}`);
    }
  }

  const sweeper = setInterval(() => {
    const removed = sweep(state);
    if (removed.length) broadcast('removed', { agents: removed });
  }, 2000);
  const heartbeat = setInterval(() => {
    for (const res of clients) res.write(': ping\n\n');
  }, 20000);

  async function readBody(req) {
    let size = 0;
    const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY) throw Object.assign(new Error('Body too large'), { status: 413 });
      chunks.push(chunk);
    }
    const text = Buffer.concat(chunks).toString('utf8');
    return text ? JSON.parse(text) : null;
  }

  function cors(req, res) {
    // Local tool: allow any localhost origin plus the hosted demo to talk to it.
    const origin = req.headers.origin;
    if (origin && /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    }
  }

  function json(res, status, body) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  }

  async function serveStatic(req, res) {
    const url = new URL(req.url, 'http://x');
    let path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
    let file = join(staticDir, path);
    if (!file.startsWith(staticDir)) return json(res, 403, { error: 'Forbidden' });
    try {
      const s = await stat(file);
      if (s.isDirectory()) file = join(file, 'index.html');
    } catch {
      file = join(staticDir, 'index.html');
    }
    try {
      const body = await readFile(file);
      const cache = file.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache';
      res.writeHead(200, {
        'Content-Type': MIME[extname(file)] || 'application/octet-stream',
        'Cache-Control': cache,
        // 검색엔진과 일반 봇 색인 차단. 실제 접근 제한은 구글 로그인(oauth2-proxy)이 한다.
        'X-Robots-Tag': 'noindex, nofollow, noarchive',
      });
      res.end(body);
    } catch {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('AI Office server is running, but the web app is not built.\nRun `npm run build`, or use `npm run dev` while developing.\n');
    }
  }

  // ---- 토큰 인증. 프록시 헤더(x-forwarded-for 등)는 믿지 않는다.
  const digest = (v) => createHash('sha256').update(String(v)).digest();
  const sameToken = (given) => timingSafeEqual(digest(given), digest(token));
  function cookieToken(req) {
    for (const part of String(req.headers.cookie || '').split(';')) {
      const i = part.indexOf('=');
      if (i > 0 && part.slice(0, i).trim() === 'af_token') {
        try {
          return decodeURIComponent(part.slice(i + 1).trim());
        } catch {
          return '';
        }
      }
    }
    return '';
  }
  function authorized(req) {
    if (!mainToken) return true;
    const m = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization || ''));
    if (m && sameToken(m[1].trim())) return true;
    const c = cookieToken(req);
    return c !== '' && sameToken(c);
  }
  const LOGIN_PAGE = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${DEFAULT_OFFICE_NAME}</title>
<style>body{font-family:system-ui,sans-serif;background:#1b1d23;color:#eee;display:grid;place-items:center;min-height:100vh;margin:0}form{display:grid;gap:12px;width:min(320px,80vw)}input,button{font:inherit;padding:10px;border-radius:8px;border:1px solid #555}button{background:#ffb84d;color:#222;border:0;cursor:pointer}</style></head>
<body><form method="get" action="/"><h1>${DEFAULT_OFFICE_NAME}</h1><p>접속 토큰을 입력하세요</p><input type="password" name="token" autofocus autocomplete="current-password"><button type="submit">들어가기</button></form></body></html>`;

  const server = createServer(async (req, res) => {
    // DNS-rebinding guard: when bound to loopback, only answer loopback hostnames.
    if (loopback && !/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(req.headers.host || '')) {
      return json(res, 403, { error: 'Forbidden host' });
    }
    cors(req, res);
    if (req.method === 'OPTIONS') return res.writeHead(204).end();
    const parsed = new URL(req.url, 'http://x');
    const { pathname } = parsed;
    if (mainToken && !(pathname === '/health' && req.method === 'GET')) {
      const given = parsed.searchParams.get('token');
      if (req.method === 'GET' && given !== null && sameToken(given)) {
        parsed.searchParams.delete('token');
        const secure = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https' ? '; Secure' : '';
        res.writeHead(302, {
          'Set-Cookie': `af_token=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000${secure}`,
          Location: parsed.pathname + parsed.search,
          'Cache-Control': 'no-store',
        });
        return res.end();
      }
      if (!authorized(req)) {
        if (req.method === 'GET' && String(req.headers.accept || '').includes('text/html')) {
          res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
          return res.end(LOGIN_PAGE);
        }
        return json(res, 401, { error: 'Unauthorized' });
      }
    }
    // Requiring JSON forces a CORS preflight, so random web pages cannot post
    // "simple" form requests to your floor. curl and the hooks send this header.
    if (req.method === 'POST' && !String(req.headers['content-type'] || '').includes('application/json')) {
      return json(res, 415, { error: 'Send Content-Type: application/json' });
    }

    try {
      if (pathname === '/events' && req.method === 'POST') {
        const body = await readBody(req);
        const list = Array.isArray(body) ? body : [body];
        let accepted = 0;
        for (const raw of list.slice(0, 200)) if (ingest(raw)) accepted++;
        return json(res, accepted ? 202 : 400, { accepted, rejected: list.length - accepted });
      }
      if (pathname === '/whoami' && req.method === 'GET') {
        const email = emailOf(req);
        return json(res, 200, { control: canControl(req), ...(email ? { email } : {}) });
      }
      if (pathname === '/close' && req.method === 'POST') {
        const body = await readBody(req);
        const id = String(body?.agent ?? '');
        if (!canControl(req)) {
          await audit(req, { ...agentInfo(id), kind: 'close', result: 'denied' });
          return json(res, 403, { error: '이 계정에는 제어 권한이 없어요' });
        }
        const result = await closeSession(id);
        await audit(req, { ...agentInfo(id), kind: 'close', result: auditResult(result) });
        return json(res, 200, result);
      }
      if (pathname === '/office' && req.method === 'GET') return json(res, 200, officeInfo());
      if (pathname === '/office' && req.method === 'POST') {
        const body = await readBody(req);
        const asked = typeof body?.name === 'string' ? body.name : '';
        if (!canControl(req)) {
          await audit(req, { kind: 'office-name', result: 'denied', text: asked });
          return json(res, 403, { error: '이 계정에는 제어 권한이 없어요' });
        }
        if (lockedName) {
          await audit(req, { kind: 'office-name', result: 'refused: locked', text: asked });
          return json(res, 409, { error: '사무실 이름이 서버 설정으로 고정돼 있어요' });
        }
        const check = validateOfficeName(body?.name);
        if (!check.ok) {
          await audit(req, { kind: 'office-name', result: `refused: ${check.reason}`, text: asked });
          return json(res, 400, { error: check.reason });
        }
        savedOfficeName = check.name;
        broadcast('office', officeInfo());
        await saveOffice();
        await audit(req, { kind: 'office-name', result: 'ok', text: check.name });
        return json(res, 200, officeInfo());
      }
      if (pathname === '/rename' && req.method === 'POST') {
        const body = await readBody(req);
        const id = String(body?.agent ?? '');
        const asked = typeof body?.name === 'string' ? body.name.trim() : '';
        if (!canControl(req)) {
          await audit(req, { ...agentInfo(id), kind: 'rename', result: 'denied', text: asked });
          return json(res, 403, { error: '이 계정에는 제어 권한이 없어요' });
        }
        const refuse = async (status, reason) => {
          await audit(req, { ...agentInfo(id), kind: 'rename', result: `refused: ${reason}`, text: asked });
          return json(res, status, { ok: false, reason });
        };
        const agent = state.agents[id];
        if (!agent) return refuse(404, '직원을 찾지 못했어요');
        if (agent.parent || agent.role !== 'Lead') return refuse(400, '메인 세션만 이름을 고칠 수 있어요');
        if (agent.status === 'offline') return refuse(400, '퇴사한 직원은 이름을 고칠 수 없어요');
        if (typeof body?.name !== 'string') return refuse(400, '이름을 글자로 보내 주세요');
        if (asked.length > NAME_MAX) return refuse(400, `이름은 ${NAME_MAX}자 이하로 써 주세요`);
        let name;
        if (asked) {
          const ev = normalizeEvent({ type: 'rename', agent: id, name: asked });
          name = ev.name;
          remember(customNames, id, name);
        } else {
          // 비우면 고친 이름을 지우고 훅이 보낸 제목으로, 없으면 Claude로 되돌린다.
          customNames.delete(id);
          name = hookNames.get(id) || 'Claude';
        }
        applyAndBroadcast({ type: 'rename', agent: id, name });
        await saveNames();
        await audit(req, { ...agentInfo(id), kind: 'rename', result: 'ok', text: name });
        return json(res, 200, { ok: true, name });
      }
      if (pathname === '/send' && req.method === 'POST') {
        const body = await readBody(req);
        const id = String(body?.agent ?? '');
        const text = typeof body?.text === 'string' ? body.text.trim() : '';
        if (!canControl(req)) {
          await audit(req, { ...agentInfo(id), kind: 'prompt', result: 'denied', text });
          return json(res, 403, { error: '이 계정에는 제어 권한이 없어요' });
        }
        if (rateLimited(req)) {
          await audit(req, { ...agentInfo(id), kind: 'prompt', result: 'rate-limited', text });
          return json(res, 429, { error: '너무 자주 보냈어요. 잠시 뒤에 다시 보내 주세요' });
        }
        if (!text || text.length > SEND_MAX_CHARS) {
          const result = { sent: false, reason: `지시는 1자 이상 ${SEND_MAX_CHARS}자 이하로 써 주세요` };
          await audit(req, { ...agentInfo(id), kind: 'prompt', result: auditResult(result), text });
          return json(res, 400, result);
        }
        const result = await sendSession(id, text);
        await audit(req, { ...agentInfo(id), kind: 'prompt', result: auditResult(result), text });
        return json(res, 200, result);
      }
      if (pathname === '/close-queue' && req.method === 'GET') {
        const owner = parsed.searchParams.get('device') || '';
        return json(res, 200, { items: takeCloseQueue(owner) });
      }
      if (pathname === '/stream' && req.method === 'GET') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        });
        res.write(`retry: 1500\nevent: snapshot\ndata: ${JSON.stringify({ version: PROTOCOL_VERSION, state, office: officeInfo() })}\n\n`);
        clients.add(res);
        req.on('close', () => clients.delete(res));
        return;
      }
      if (pathname === '/state' && req.method === 'GET') return json(res, 200, state);
      if (pathname === '/health') return json(res, 200, { ok: true, version: PROTOCOL_VERSION, agents: Object.keys(state.agents).length });
      if (pathname === '/reset' && req.method === 'POST') {
        ingest({ type: 'reset' });
        return json(res, 200, { ok: true });
      }
      if (req.method === 'GET') return serveStatic(req, res);
      return json(res, 404, { error: 'Not found' });
    } catch (err) {
      return json(res, err.status || 400, { error: err.message || 'Bad request' });
    }
  });

  // 기계용 포트: 길이 셋뿐이고 Bearer 토큰이 필수다. 쿠키도 로그인 화면도 정적 파일도 없다.
  // 길이 아니면 토큰을 묻기 전에 404로 돌려 어떤 길이 있는지 드러내지 않는다.
  const machineServer =
    machinePort === null
      ? null
      : createServer(async (req, res) => {
          const { pathname, searchParams } = new URL(req.url, 'http://x');
          const route = `${req.method} ${pathname}`;
          if (!['POST /events', 'GET /close-queue', 'GET /health'].includes(route)) return json(res, 404, { error: 'Not found' });
          // 열어 두는 /health는 살아 있다는 사실 말고는 아무것도 알려 주지 않는다.
          if (route === 'GET /health') return json(res, 200, { ok: true });
          const m = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization || ''));
          if (!(m && sameToken(m[1].trim()))) return json(res, 401, { error: 'Unauthorized' });
          try {
            if (route === 'GET /close-queue') return json(res, 200, { items: takeCloseQueue(searchParams.get('device') || '') });
            if (!String(req.headers['content-type'] || '').includes('application/json')) {
              return json(res, 415, { error: 'Send Content-Type: application/json' });
            }
            const body = await readBody(req);
            const list = Array.isArray(body) ? body : [body];
            let accepted = 0;
            for (const raw of list.slice(0, 200)) if (ingest(raw)) accepted++;
            return json(res, accepted ? 202 : 400, { accepted, rejected: list.length - accepted });
          } catch (err) {
            return json(res, err.status || 400, { error: err.message || 'Bad request' });
          }
        });

  return new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      log(`AI Office is live at http://${host === '0.0.0.0' ? 'localhost' : host}:${port}${mainToken ? ' (토큰 인증 켜짐)' : proxyGate ? ' (프록시 로그인 신뢰)' : ''}`);
      if (machineServer === null) return done();
      machineServer.once('error', reject);
      machineServer.listen(machinePort, host, () => {
        log(`기계용 포트가 열렸어요: ${host}:${machineServer.address().port} (events, close-queue, health만)`);
        done();
      });
    });

    function done() {
      resolvePromise({
        server,
        machineServer,
        state,
        ingest,
        close() {
          clearInterval(sweeper);
          clearInterval(heartbeat);
          for (const res of clients) res.end();
          return Promise.all([new Promise((r) => server.close(r)), machineServer ? new Promise((r) => machineServer.close(r)) : null]);
        },
      });
    }
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startServer().catch((err) => {
    console.error(err.code === 'EADDRINUSE' ? 'Port is already in use. Set AI_OFFICE_PORT to pick another.' : err);
    process.exit(1);
  });
}
