// A believable, endless stream of agent activity. Used by `agent-floor demo`
// and by the web app when no server is reachable (for example the hosted demo).

const TEAMS = [
  {
    team: '결제 화면 개편',
    task: '한 페이지 결제 출시하기',
    members: [
      { agent: 'atlas', name: 'Atlas', role: 'Lead', source: 'claude-code' },
      { agent: 'pixel', name: 'Pixel', role: 'Frontend', source: 'claude-code', parent: 'atlas' },
      { agent: 'ledger', name: 'Ledger', role: 'Backend', source: 'claude-code', parent: 'atlas' },
      { agent: 'probe', name: 'Probe', role: 'Tests', source: 'claude-code', parent: 'atlas' },
    ],
  },
  {
    team: '인증 서비스',
    task: '리프레시 토큰 교체하기',
    members: [
      { agent: 'warden', name: 'Warden', role: 'Lead', source: 'codex' },
      { agent: 'cipher', name: 'Cipher', role: 'Security', source: 'codex', parent: 'warden' },
      { agent: 'relay', name: 'Relay', role: 'API', source: 'codex', parent: 'warden' },
    ],
  },
  {
    team: '문서 사이트',
    task: '가이드를 MDX로 옮기기',
    members: [
      { agent: 'quill', name: 'Quill', role: 'Lead', source: 'cursor' },
      { agent: 'scout', name: 'Scout', role: 'Research', source: 'cursor', parent: 'quill' },
    ],
  },
];

const WORK = {
  Lead: [
    ['TodoWrite', '계획 고치는 중'],
    ['Read', 'ARCHITECTURE.md 읽는 중'],
    ['Grep', '"TODO(checkout)" 찾는 중'],
    ['Bash', '실행 중: git diff --stat'],
  ],
  Frontend: [
    ['Edit', 'CheckoutForm.tsx 고치는 중'],
    ['Edit', 'PaymentSheet.tsx 고치는 중'],
    ['Write', 'AddressFields.tsx 쓰는 중'],
    ['Bash', '실행 중: pnpm lint'],
    ['Read', 'tokens.css 읽는 중'],
  ],
  Backend: [
    ['Edit', 'orders/service.py 고치는 중'],
    ['Write', 'migrations/0042_cart.sql 쓰는 중'],
    ['Bash', '실행 중: pytest orders'],
    ['Grep', '"def create_order" 찾는 중'],
  ],
  Tests: [
    ['Write', 'checkout.spec.ts 쓰는 중'],
    ['Bash', '실행 중: playwright test'],
    ['Bash', '실행 중: vitest --run'],
    ['Read', '커버리지 보고서 읽는 중'],
  ],
  Security: [
    ['Grep', '"jwt.decode" 찾는 중'],
    ['Read', 'token_store.go 읽는 중'],
    ['Bash', '실행 중: gosec ./...'],
  ],
  API: [
    ['Edit', 'handlers/refresh.go 고치는 중'],
    ['Bash', '실행 중: go test ./auth/...'],
    ['Write', 'openapi/refresh.yaml 쓰는 중'],
  ],
  Research: [
    ['WebFetch', 'mdxjs.com 읽는 중'],
    ['WebSearch', '웹에서 "mdx 3 migration" 검색 중'],
    ['Read', 'docs/guides/index.md 읽는 중'],
  ],
  Explorer: [
    ['Glob', '**/*.test.ts 파일 찾는 중'],
    ['Grep', '"useCart" 찾는 중'],
    ['Read', 'cart/store.ts 읽는 중'],
  ],
};

const CHAT = {
  Lead: ['Pixel, 주소 단계 맡아 줘요', 'Ledger, 주문 API에 멱등성 키가 필요해요', 'Probe, 카드 거절 경로도 확인해 줘요', '좋아요. 초록불 켜지면 머지해요.', '그 PR 나눠 줄 수 있어요?'],
  Frontend: ['폼은 연결했어요, 가격 엔드포인트가 필요해요', '초안 올렸어요, 봐 주세요', '오류 문구는 어떤 걸로 할까요?'],
  Backend: ['/v2/orders 엔드포인트가 열렸어요', '마이그레이션은 되돌릴 수 있어요', '이제 가격에 세금이 들어가요'],
  Tests: ['Safari에서 테스트 3개가 실패해요', 'CI가 전부 초록이에요', '제출 단계에서 경쟁 상태를 찾았어요'],
  Security: ['리프레시 토큰은 한 번만 쓰게 해야 해요', '교체 방식은 안전해 보여요', '저장할 때 토큰을 해시해 주세요'],
  API: ['계약서를 고쳤어요', '새 토큰 형식이 필요해요', '플래그 뒤에 숨겨서 내보낼게요'],
  Research: ['공식 마이그레이션 가이드를 찾았어요', '플러그인 두 개가 MDX 3에서 깨져요', '요약은 notes.md에 있어요'],
  Explorer: ['호출 위치 14곳을 찾았어요', '보고서 준비됐어요'],
};

const THINK = ['다음 단계 계획하는 중', '실패한 테스트 읽는 중', '두 방법 비교하는 중', '예외 상황 확인하는 중', '장단점 따져 보는 중'];

function pick(list, rand) {
  return list[Math.floor(rand() * list.length)];
}

function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const EXTRA_TEAMS = ['결제', '검색', '모바일 앱', '인프라', '청구', '분석', '온보딩', '알림', '디자인 시스템', '데이터 파이프라인'];
const EXTRA_ROLES = ['Frontend', 'Backend', 'Tests', 'Security', 'API', 'Research'];
const EXTRA_NAMES = ['Orbit', 'Quartz', 'Ember', 'Nimbus', 'Sable', 'Juniper', 'Flint', 'Mosaic', 'Harbor', 'Vesper', 'Cobalt', 'Lumen', 'Tundra', 'Kestrel', 'Onyx', 'Fable', 'Rune', 'Sorrel'];

/**
 * @param {number} [seed]
 * @param {{ agents?: number }} [opts] agents: total agents to reach (stress testing)
 */
export function createScript(seed = Date.now(), opts = {}) {
  const rand = mulberry32(seed);
  const queue = [];
  const all = [];
  const teams = TEAMS.map((t) => ({ ...t, members: [...t.members] }));
  // Stress mode: add generated teams of 4 to 8 agents until we reach the target.
  let count = teams.reduce((n, t) => n + t.members.length, 0);
  for (let i = 0; count < (opts.agents || 0); i++) {
    const team = EXTRA_TEAMS[i % EXTRA_TEAMS.length] + (i >= EXTRA_TEAMS.length ? ` ${Math.floor(i / EXTRA_TEAMS.length) + 1}` : '');
    const size = Math.min(4 + Math.floor(rand() * 5), opts.agents - count);
    const lead = `lead-${i}`;
    const members = [{ agent: lead, name: EXTRA_NAMES[i % EXTRA_NAMES.length], role: 'Lead', source: ['claude-code', 'codex', 'cursor'][i % 3] }];
    for (let m = 1; m < size; m++)
      members.push({ agent: `a-${i}-${m}`, name: EXTRA_NAMES[(i * 3 + m) % EXTRA_NAMES.length], role: EXTRA_ROLES[(i + m) % EXTRA_ROLES.length], source: members[0].source, parent: lead });
    teams.push({ team, task: `${team} v2 출시하기`, members });
    count += size;
  }

  // Arrivals: leads first, then their crew walks in one by one.
  for (const t of teams) {
    const [lead, ...crew] = t.members;
    const leadEv = { ...lead, team: t.team };
    all.push(leadEv);
    queue.push({ wait: opts.agents ? 150 : 700, events: [{ type: 'join', ...leadEv, status: 'thinking', activity: '요청서 읽는 중' }] });
    queue.push({ wait: 500, events: [{ type: 'task', agent: lead.agent, team: t.team, task: t.task }] });
    for (const m of crew) {
      const ev = { ...m, team: t.team };
      all.push(ev);
      queue.push({ wait: opts.agents ? 150 : 900, events: [{ type: 'join', ...ev, status: 'thinking', activity: '설명 듣는 중', text: pick(CHAT.Lead, rand) }] });
    }
  }

  let helper = null;
  let tick = 0;

  function randomStep() {
    tick++;
    const a = pick(all, rand);
    const r = rand();

    // Now and then a lead spawns a short-lived helper.
    if (!helper && tick % 23 === 0) {
      const lead = all.find((x) => x.role === 'Lead' && x.team === a.team) || all[0];
      helper = { agent: `${lead.agent}-explorer-${tick}`, name: '탐험가', role: 'Explorer', source: lead.source, team: lead.team, parent: lead.agent, left: 6 };
      return { wait: 900, events: [{ type: 'join', ...helper, status: 'thinking', activity: '코드베이스 살펴보는 중', text: '장바구니 호출 위치를 전부 찾아 줘요' }] };
    }
    if (helper && rand() < 0.35) {
      helper.left--;
      if (helper.left <= 0) {
        const h = helper;
        helper = null;
        return {
          wait: 1200,
          events: [
            { type: 'message', agent: h.agent, to: h.parent, text: '보고서 준비됐어요', status: 'done' },
            { type: 'status', agent: h.agent, status: 'done', activity: '결과를 넘겼어요' },
          ],
        };
      }
      const [tool, activity] = pick(WORK.Explorer, rand);
      return { wait: 700, events: [{ type: 'tool', agent: helper.agent, tool, activity }] };
    }

    if (r < 0.5) {
      const [tool, activity] = pick(WORK[a.role] || WORK.Lead, rand);
      return { wait: 600 + rand() * 900, events: [{ type: 'tool', agent: a.agent, tool, activity }] };
    }
    if (r < 0.72) {
      const mates = all.filter((x) => x.team === a.team && x.agent !== a.agent);
      // One in six messages crosses team lines.
      const pool = rand() < 0.17 ? all.filter((x) => x.team !== a.team) : mates;
      if (!pool.length) return randomStep();
      const to = pick(pool, rand);
      return { wait: 1300, events: [{ type: 'message', agent: a.agent, to: to.agent, text: pick(CHAT[a.role] || CHAT.Lead, rand), status: 'thinking' }] };
    }
    if (r < 0.88) {
      return { wait: 700, events: [{ type: 'status', agent: a.agent, status: 'thinking', activity: pick(THINK, rand) }] };
    }
    if (r < 0.93 && a.role === 'Lead') {
      return { wait: 1600, events: [{ type: 'status', agent: a.agent, status: 'waiting', activity: '푸시하려면 승인이 필요해요' }] };
    }
    if (r < 0.96) {
      return { wait: 900, events: [{ type: 'status', agent: a.agent, status: 'error', activity: '테스트 48개 중 2개 실패' }] };
    }
    return { wait: 900, events: [{ type: 'status', agent: a.agent, status: 'idle', activity: '동료를 기다리는 중' }] };
  }

  const speed = opts.agents ? Math.max(0.15, 12 / opts.agents) : 1;
  return {
    next() {
      if (queue.length) return queue.shift();
      const step = randomStep();
      return { ...step, wait: step.wait * speed };
    },
  };
}
