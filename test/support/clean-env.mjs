// 테스트 프로세스가 개발자 셸의 에이전트 연결 설정을 물려받지 않도록 비운다.
// 에이전트 안에서 npm test를 돌리면 이 변수들이 이미 설정되어 있어서 서버가 401을 돌려주는 등 가짜 실패가 났다.
for (const name of ['AGENT_FLOOR_URL', 'AGENT_FLOOR_TOKEN', 'AGENT_FLOOR_DEVICE', 'AGENT_FLOOR_TEAM']) {
  delete process.env[name];
}
