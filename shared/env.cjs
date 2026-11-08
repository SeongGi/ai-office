'use strict';
// 옛 이름(Agent Floor 시절)과의 호환 규칙을 정의하는 유일한 곳이다.
// 환경변수, 상태 폴더, 설치된 훅 항목 알아보기가 여기에 있다.
// 서버, bin, adapters, desktop, scripts, vite 설정이 모두 여기서 읽는다.
// CommonJS(desktop/*.cjs)와 ESM(.mjs)이 둘 다 쓸 수 있도록 CJS로 만들었다.
//
//   AI_OFFICE_<이름>        현재 이름. 있으면 항상 이 값이 이긴다.
//   AGENT_FLOOR_<이름>      deprecated, 호환용 옛 이름. 새 이름이 없을 때만 읽는다.
//
// 값이 빈 문자열이어도 "설정됨"으로 본다(새 이름을 비워 옛 값을 가릴 수 있어야 한다).

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PREFIX = 'AI_OFFICE_';
const LEGACY_PREFIX = 'AGENT_FLOOR_'; // deprecated, 호환용

/** 환경변수를 읽는다. name은 접두어 없는 이름(예: 'PORT'). 설정이 없으면 undefined. */
function env(name, source = process.env) {
  const current = source[PREFIX + name];
  if (current !== undefined) return current;
  return source[LEGACY_PREFIX + name];
}

/** 새 이름과 옛 이름의 환경변수 키를 모두 돌려준다(환경을 비우는 코드용). */
function envKeys(name) {
  return [PREFIX + name, LEGACY_PREFIX + name];
}

/**
 * 상태 폴더 경로를 정한다.
 *   1) AI_OFFICE_HOME(없으면 deprecated AGENT_FLOOR_HOME)
 *   2) ~/.ai-office
 *   3) 단 ~/.ai-office가 없고 옛 ~/.agent-floor가 있으면 옛 폴더를 계속 쓴다.
 */
function stateDir({ source = process.env, home = os.homedir(), exists = fs.existsSync } = {}) {
  const explicit = env('HOME', source);
  if (explicit) return explicit;
  const current = path.join(home, '.ai-office');
  const legacy = path.join(home, '.agent-floor'); // deprecated, 호환용
  if (!exists(current) && exists(legacy)) return legacy;
  return current;
}

const OUR_HOOK_RE = /\b(?:ai-office|agent-floor)\.mjs|\b(?:ai-office|agent-floor)\s+hook\b/; // agent-floor는 deprecated, 호환용

/**
 * 설정 파일 안의 훅 항목이 우리가 설치한 것인지 알아본다. 명령 문자열에 현재 스크립트(ai-office.mjs)나
 * 옛 스크립트(agent-floor.mjs), 또는 `<이름> hook`(npx, npm link로 설치한 명령)이 있으면 우리 것이다.
 * `setup --write`가 옛 항목도 같은 항목으로 보고 새 명령으로 바꾸게 해서 중복을 막는다.
 */
function isOwnHook(entry) {
  return OUR_HOOK_RE.test(JSON.stringify(entry));
}

exports.env = env;
exports.isOwnHook = isOwnHook;
exports.envKeys = envKeys;
exports.stateDir = stateDir;
