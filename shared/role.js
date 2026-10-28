// 직원의 직무와 지금 하는 일을 맥락에서 읽어 낸다. 키워드 표만 쓰고 LLM은 부르지 않는다.
// 브라우저와 서버가 같이 쓰는 순수 함수다. 타입은 role.d.ts.

/** 위에서부터 처음 맞는 줄이 직무가 된다. 새 직무는 줄만 더하면 된다. */
const ROLE_RULES = [
  ['보안 점검', /보안|취약점|\bcve\b|\bcsp\b|pentest|침투|secur|vulnerab|audit|감사/i],
  ['비용 계산', /비용|요금|가격|견적|cost|pricing|billing|finops/i],
  ['배포 담당', /배포|출시|릴리스|릴리즈|deploy|release|rollout|publish|\bplay\b/i],
  ['인프라 운영', /인프라|cloud|클라우드|terraform|aws|gcp|azure|k8s|kubernetes|docker|\becs\b|장애|운영|infra|\bcdn\b|네트워크/i],
  ['테스트 검증', /테스트|검증|\bqa\b|\btest|e2e|회귀|verify/i],
  ['코드 리뷰', /리뷰|review|\bpr\b/i],
  ['데이터 분석', /데이터|분석|통계|\bsql\b|data|analy|dashboard|리포트|report|지표/i],
  ['문서 작성', /문서|보고서|제안서|\bsow\b|\bdocs?\b|readme|가이드|정리|작성|발표|\bppt/i],
  ['리서치', /리서치|조사|비교|research|survey|탐색|검색/i],
  ['프런트엔드 개발', /프런트|프론트|화면|\bui\b|\bux\b|디자인|css|react|vue|front|사무실|고양이|웹|앱|app/i],
  ['백엔드 개발', /백엔드|\bapi\b|서버|\bdb\b|데이터베이스|backend|server|python|챗봇|의존성|chat|개선|수정|구현/i],
];
const FALLBACK_ROLE = '범용 개발';
const MAX_DOING = 40;

/** 자동으로 도는 감시 직원(Claude 세션이 아닌 것)의 출처. */
const WATCHER_SOURCES = new Set(['cloud-status']);

function oneLine(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

function clipTo(text, max) {
  const t = oneLine(text);
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

function firstSentence(text) {
  const t = oneLine(text);
  const m = t.match(/^.*?[.!?。]\s|^.*?[.!?。]$/);
  return (m ? m[0] : t).trim();
}

function pickRole(text) {
  for (const [role, re] of ROLE_RULES) if (re.test(text)) return role;
  return FALLBACK_ROLE;
}

/** 이 직원이 Claude 세션이 아니라 자동으로 도는 감시 직원인지. */
export function isWatcher(agent) {
  return Boolean(agent) && !agent.parent && WATCHER_SOURCES.has(agent.source);
}

/** 지금 하는 일에 붙일 활동 문구. 일하는 중일 때만 쓴다. */
function nowText(agent) {
  if (agent.status !== 'working' && agent.status !== 'thinking') return '';
  return oneLine(agent.activity);
}

/**
 * @param {import('./protocol.js').Agent & { lastPrompt?: string }} agent
 * @returns {{ role: string, doing: string, kind: string }}
 */
export function describeJob(agent) {
  if (isWatcher(agent)) {
    const act = oneLine(agent.activity) || '상태를 지켜보는 중';
    return { role: '자동 감시', doing: clipTo(`${agent.name}: ${act}`, MAX_DOING), kind: '자동 감시 (Claude 세션 아님)' };
  }
  const isSub = Boolean(agent.parent);
  const title = oneLine(agent.name);
  const defaultName = !title || /^(claude|codex)$/i.test(title);
  const prompt = firstSentence(agent.lastPrompt);
  const base = (!defaultName && title) || prompt || oneLine(agent.activity) || '대기 중';
  const text = [defaultName ? '' : title, prompt, agent.team, agent.cwd, isSub ? agent.role : ''].join(' ');
  const role = pickRole(text);
  const act = nowText(agent);
  let doing = clipTo(base, MAX_DOING);
  if (act && act !== base) {
    const tail = `지금: ${act}`;
    // 한 문장을 넘기지 않도록 제목을 줄이고 활동을 붙인다.
    const room = MAX_DOING - tail.length - 3;
    doing = room >= 8 ? `${clipTo(base, room)}, ${tail}` : clipTo(tail, MAX_DOING);
  }
  return { role, doing, kind: isSub ? '서브에이전트' : '세션' };
}
