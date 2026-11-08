'use strict';
// 데스크톱 앱이 어떤 서버를 창에 띄울지 정한다.
//
//   1) 환경변수 AI_OFFICE_URL(옛 이름 AGENT_FLOOR_URL)이 원격 주소이면 그 서버를 연다.
//      다음에 터미널에서 그냥 켜도 같은 서버가 열리도록 주소만 desktop.json에 저장한다.
//   2) 환경변수가 없으면 desktop.json에 저장된 선택을 따른다.
//      { "url": "https://..." }이면 그 원격 서버를, { "mode": "local" }이면 로컬 서버를 연다.
//   3) 저장된 선택이 없거나 파일이 깨졌으면 needsChoice를 켜서 돌려준다. 앱이 선택 화면을 띄운다.
//      이때도 로컬 서버 값(origin, url, port)은 함께 담는다.
//
// 토큰은 파일에 저장하지 않고 주소에도 싣지 않는다. 주소에 실으면 로그인 프록시가 돌아올 주소로
// 기억해 외부 로그인 과정에 실려 갈 수 있다. 환경변수에 토큰이 있으면 main.cjs가 그 서버 전용
// af_token 쿠키로 넣는다. 토큰이 없으면 서버나 프록시의 로그인 화면에서 들어간다.

const fs = require('node:fs');
const path = require('node:path');
const { env, stateDir } = require('../shared/env.cjs');

const LOCAL_RE = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/;

/** 원격 http(s) 주소면 끝의 /를 뗀 origin을 돌려주고, 아니면 null. */
function remoteOrigin(raw) {
  if (!raw || LOCAL_RE.test(raw)) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return u.origin;
  } catch {
    return null;
  }
}

function savedFile(source) {
  return path.join(stateDir({ source }), 'desktop.json');
}

function readSaved(source) {
  try {
    const data = JSON.parse(fs.readFileSync(savedFile(source), 'utf8'));
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

/** 저장에 실패하면 예외를 던진다. */
function writeSavedStrict(source, data) {
  const file = savedFile(source);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

function writeSaved(source, data) {
  try {
    writeSavedStrict(source, data);
  } catch {
    /* 저장하지 못해도 이번 실행은 그대로 진행한다 */
  }
}

function localTarget(source) {
  const port = Number(env('PORT', source)) || 4317;
  const local = `http://127.0.0.1:${port}`;
  return { remote: false, origin: local, url: `${local}/?app=1`, port };
}

/**
 * 창에 띄울 대상을 정한다.
 * 원격이면 { remote: true, origin, url, token }, 로컬이면 { remote: false, origin, url, port }.
 * 저장된 선택이 없으면 로컬 값에 needsChoice: true를 더해 돌려준다.
 * token은 환경변수의 토큰이고 없으면 ''이다.
 */
function resolveTarget(source = process.env) {
  const fromEnv = remoteOrigin(env('URL', source));
  const saved = readSaved(source);
  let origin = fromEnv;
  if (fromEnv) {
    if (saved.url !== fromEnv) writeSaved(source, { url: fromEnv });
  } else {
    origin = remoteOrigin(saved.url);
  }
  if (origin) {
    const url = `${origin}/?app=1`;
    return { remote: true, origin, url, token: env('TOKEN', source) || '' };
  }
  if (saved.mode === 'local') return localTarget(source);
  return { ...localTarget(source), needsChoice: true };
}

/** 저장된 선택을 { mode: 'local' }, { url }, null 가운데 하나로 돌려준다. */
function currentChoice(source = process.env) {
  const saved = readSaved(source);
  const origin = remoteOrigin(saved.url);
  if (origin) return { url: origin };
  if (saved.mode === 'local') return { mode: 'local' };
  return null;
}

/**
 * 사용자가 고른 연결 방식을 desktop.json에 저장한다. choice는 { mode: 'local' } 또는 { url }이다.
 * 주소는 origin만 저장하고, 토큰은 어떤 경우에도 저장하지 않는다.
 */
function saveChoice(choice, source = process.env) {
  let data;
  if (choice && typeof choice === 'object' && choice.mode === 'local') {
    data = { mode: 'local' };
  } else if (choice && typeof choice === 'object' && typeof choice.url === 'string') {
    const origin = remoteOrigin(choice.url.trim());
    if (!origin) return { ok: false, error: '서버 주소는 http:// 또는 https://로 시작하는 원격 주소여야 해요. (예: https://ai-office.example.com)' };
    data = { url: origin };
  } else {
    return { ok: false, error: '연결 방식을 고르지 못했어요.' };
  }
  try {
    writeSavedStrict(source, data);
  } catch (err) {
    return { ok: false, error: `설정을 저장하지 못했어요: ${err && err.message ? err.message : err}` };
  }
  return { ok: true };
}

// 원격 서버 앞의 로그인 프록시(oauth2-proxy)는 Google 로그인으로 보낸다. 로그인 중에는
// accounts.google.com 안에서 페이지가 여러 번 바뀌므로, 이 이동은 창 안에서 허용해야 쿠키가 앱에 남는다.
const LOGIN_HOST_RE = /^(?:[a-z0-9-]+\.)*google\.com$/;

/** 창 안에서 이동해도 되는 주소인지 정한다. 아니면 기본 브라우저로 연다. */
function allowInWindow(target, raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.origin === target.origin) return true;
  return Boolean(target.remote) && u.protocol === 'https:' && LOGIN_HOST_RE.test(u.hostname);
}

exports.resolveTarget = resolveTarget;
exports.allowInWindow = allowInWindow;
exports.remoteOrigin = remoteOrigin;
exports.saveChoice = saveChoice;
exports.currentChoice = currentChoice;
