'use strict';
// 데스크톱 앱이 어떤 서버를 창에 띄울지 정한다.
//
//   1) 환경변수 AI_OFFICE_URL(옛 이름 AGENT_FLOOR_URL)이 원격 주소이면 그 서버를 연다.
//      다음에 터미널에서 그냥 켜도 같은 서버가 열리도록 주소만 desktop.json에 저장한다.
//   2) 환경변수가 없으면 desktop.json에 저장된 원격 주소를 연다.
//   3) 둘 다 없으면 지금까지처럼 로컬 서버(필요하면 앱 안에서 띄움)를 연다.
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
    return JSON.parse(fs.readFileSync(savedFile(source), 'utf8'));
  } catch {
    return {};
  }
}

function writeSaved(source, data) {
  try {
    const file = savedFile(source);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
  } catch {
    /* 저장하지 못해도 이번 실행은 그대로 진행한다 */
  }
}

/**
 * 창에 띄울 대상을 정한다.
 * 원격이면 { remote: true, origin, url, token }, 로컬이면 { remote: false, origin, url, port }.
 * token은 환경변수의 토큰이고 없으면 ''이다.
 */
function resolveTarget(source = process.env) {
  const fromEnv = remoteOrigin(env('URL', source));
  let origin = fromEnv;
  if (fromEnv) {
    if (readSaved(source).url !== fromEnv) writeSaved(source, { url: fromEnv });
  } else {
    origin = remoteOrigin(readSaved(source).url);
  }
  if (origin) {
    const url = `${origin}/?app=1`;
    return { remote: true, origin, url, token: env('TOKEN', source) || '' };
  }
  const port = Number(env('PORT', source)) || 4317;
  const local = `http://127.0.0.1:${port}`;
  return { remote: false, origin: local, url: `${local}/?app=1`, port };
}

exports.resolveTarget = resolveTarget;
exports.remoteOrigin = remoteOrigin;
