import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeJob, displayName, isWatcher } from '../shared/role.js';

const agent = (extra) => ({ id: 'claude-code:a1', name: 'Claude', role: 'Lead', team: 'portal', source: 'claude-code', status: 'idle', history: [], ...extra });

test('describeJob: 제목으로 직무를 고른다', () => {
  const cases = [
    ['백엔드 의존성 취약점 점검', '보안 점검'],
    ['챗봇 월 비용계산기 적용', '비용 계산'],
    ['CSP 장애 및 CVE 대응', '보안 점검'],
    ['출석체크 앱 Play 출시', '배포 담당'],
    ['Cloud-status 개선', '인프라 운영'],
    ['에이전트 사무실 고양이 개선', '프런트엔드 개발'],
    ['회귀 테스트 보강', '테스트 검증'],
    ['제안서 초안 작성', '문서 작성'],
  ];
  for (const [name, role] of cases) {
    const j = describeJob(agent({ name }));
    assert.equal(j.role, role, name);
    assert.equal(j.kind, '세션');
    assert.ok(j.doing.length <= 40, name);
  }
  assert.equal(describeJob(agent({ name: 'Claude' })).role, '범용 개발');
});

test('describeJob: 기본 이름이면 질문 첫 문장, 일하는 중이면 지금 활동을 붙인다', () => {
  const j = describeJob(agent({ lastPrompt: 'API 응답이 느린 이유를 찾아줘. 로그도 봐줘.', status: 'working', activity: 'Bash 실행' }));
  assert.equal(j.role, '백엔드 개발');
  assert.match(j.doing, /^API 응답이 느린 이유를 찾아줘\./);
  assert.match(j.doing, /지금: Bash 실행$/);
  assert.ok(j.doing.length <= 40);
  const idle = describeJob(agent({ name: '결제 버그 수정', activity: '기다리는 중' }));
  assert.equal(idle.doing, '결제 버그 수정');
  const long = describeJob(agent({ name: '아주 긴 제목'.repeat(10), status: 'working', activity: '파일 읽는 중' }));
  assert.ok(long.doing.length <= 40);
});

test('describeJob: 서브에이전트와 자동 감시', () => {
  const sub = describeJob(agent({ id: 'claude-code:a1:x', parent: 'claude-code:a1', role: 'Explore', name: 'Explore', activity: '코드 탐색', status: 'working' }));
  assert.equal(sub.kind, '서브에이전트');
  const watcher = agent({ source: 'cloud-status', name: 'Cloud Status', activity: 'AWS 상태 확인' });
  assert.ok(isWatcher(watcher));
  const w = describeJob(watcher);
  assert.equal(w.role, '자동 감시');
  assert.match(w.kind, /Claude 세션 아님/);
  assert.match(w.doing, /AWS 상태 확인/);
  assert.equal(isWatcher(agent({ source: 'cloud-status', parent: 'x' })), false);
});

test('displayName: 메인은 이름 그대로, 서브는 메인-서브', () => {
  const main = agent({ id: 'm', name: '사무실' });
  const agents = { m: main };
  assert.equal(displayName(main, agents), '사무실');
  assert.equal(displayName(agent({ id: 's', parent: 'm', name: '탐색기' }), agents), '사무실-탐색기');
  assert.equal(displayName(agent({ id: 's', parent: 'm', name: '', role: 'Explore' }), agents), '사무실-Explore');
  assert.equal(displayName(agent({ id: 's', parent: 'm', name: '', role: '' }), agents), '사무실-서브');
});

test('displayName: 접두사 중복, 긴 이름, 부모 없음', () => {
  const main = agent({ id: 'm', name: '사무실' });
  const agents = { m: main };
  assert.equal(displayName(agent({ id: 's', parent: 'm', name: '사무실 탐색' }), agents), '사무실 탐색');
  const long = { m: agent({ id: 'm', name: 'A'.repeat(30) }) };
  const out = displayName(agent({ id: 's', parent: 'm', name: 'B'.repeat(30) }), long);
  assert.ok(out.length <= 28, out);
  assert.equal(out, 'A'.repeat(13) + '…-' + 'B'.repeat(11) + '…');
  assert.equal(displayName(agent({ id: 's', parent: 'gone', name: '고아' }), agents), '고아');
});
