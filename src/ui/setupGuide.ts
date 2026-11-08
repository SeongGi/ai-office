// 연결 안내 시트에 보여 주는 도구별 설치 단계.

// AI Office는 npm에 올라가 있지 않으므로 소스에서 설치한다(README의 Quick start와 같은 순서).
const INSTALL = {
  label: '소스에서 설치하기 (npm에는 올라가 있지 않아요)',
  code: 'git clone https://github.com/SeongGi/ai-office\ncd ai-office\nnpm install && npm run build\nnpm link',
};

export const SETUP: Record<string, { title: string; steps: { label: string; code: string }[]; note: string }> = {
  claude: {
    title: 'Claude Code',
    steps: [
      INSTALL,
      { label: '~/.claude/settings.json에 훅 추가하기', code: 'ai-office setup claude --write' },
    ],
    note: '세션이 시작되면 이 사무실이 저절로 열려요. 세션마다 프로젝트 폴더 이름의 사무실이 생기고, 서브에이전트는 들어와서 설명을 듣고 결과를 보고해요.',
  },
  codex: {
    title: 'Codex',
    steps: [
      INSTALL,
      { label: '~/.codex/config.toml에 넣을 notify 줄 출력하기', code: 'ai-office setup codex' },
    ],
    note: 'Codex는 매 차례가 끝날 때 알려 줘요. 그래서 책상은 답변 한 번에 한 번씩 바뀌어요.',
  },
  cursor: {
    title: 'Cursor',
    steps: [
      INSTALL,
      { label: '~/.cursor/hooks.json에 훅 추가하기', code: 'ai-office setup cursor --write' },
    ],
    note: '이 사무실은 듣기만 해요. 권한 요청에 대신 답하는 일은 절대 없어요.',
  },
  http: {
    title: '그 밖의 도구',
    steps: [
      INSTALL,
      { label: '오피스 켜기', code: 'ai-office' },
      {
        label: '아무 언어로나 이벤트 보내기',
        code: `curl -X POST localhost:4317/events \\\n  -H 'content-type: application/json' \\\n  -d '{"type":"tool","agent":"bot-1","team":"Payments","tool":"Bash","activity":"테스트 돌리는 중"}'`,
      },
    ],
    note: '이벤트 종류: join, status, tool, message, task, leave. 자세한 내용은 docs/protocol.md를 봐 주세요.',
  },
};
