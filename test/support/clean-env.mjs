// 테스트 프로세스가 개발자 셸의 에이전트 연결 설정을 물려받지 않도록 비운다.
// 에이전트 안에서 npm test를 돌리면 이 변수들이 이미 설정되어 있어서 서버가 401을 돌려주는 등 가짜 실패가 났다.
// 새 이름(AI_OFFICE_*)과 deprecated 옛 이름(AGENT_FLOOR_*)을 모두 지운다.
import { createRequire } from 'node:module';

const { envKeys } = createRequire(import.meta.url)('../../shared/env.cjs');

for (const name of ['URL', 'TOKEN', 'DEVICE', 'TEAM', 'NAME', 'HOME', 'PORT', 'HOST', 'AUTOLAUNCH', 'SEED']) {
  for (const key of envKeys(name)) delete process.env[key];
}
