import type { Status } from '../../shared/protocol';

/** 화면에 보이는 한국어 상태 이름. 상태 키 자체는 그대로 둔다. */
export const STATUS_LABEL_KO: Record<Status, string> = {
  idle: '쉬는 중',
  thinking: '생각 중',
  working: '일하는 중',
  waiting: '도움이 필요해요',
  done: '끝냈어요',
  error: '문제가 생겼어요',
  offline: '퇴근했어요',
};

/** 직원 카드에 쓰는 문구. */
export const CARD_KO = {
  kind: '종류',
  mainSession: '메인 세션',
  subagent: '서브에이전트',
  parent: '상위',
  source: '출처',
  session: '세션',
  project: '프로젝트',
  model: '모델',
  cwd: '작업 폴더',
  branch: '브랜치',
  unknown: '확인 안 됨',
  job: '하는 일',
  leave: '퇴사',
  leaveConfirm: '정말 퇴사?',
  leaveNote: '화면에서만 퇴사 처리돼요. 세션은 그대로예요.',
  leaveActivity: '퇴사 처리',
  convo: '최근 대화',
  asked: '물어본 것',
  answered: '답한 것',
  sendTitle: '지시 보내기',
  sendPlaceholder: '이 직원에게 일을 시켜요',
  send: '보내기',
  sendConfirm: '정말 보낼까요?',
  sendTarget: (name: string) => `${name}에게 보내요`,
  sendSent: '보냈어요',
  sendQueued: '대기열에 넣었어요 (서버기기 도우미가 전달해요)',
  sendBusy: '일하는 중이라 지금은 보낼 수 없어요',
  sendSub: '서브에이전트에게는 보낼 수 없어요',
  sendWorking: '보내는 중이에요',
};

/** 고양이 위 이름표에 붙는 상태 알약 문구. */
export const PILL_KO: Record<Status, string> = {
  idle: '쉬는 중',
  thinking: '생각하는 중',
  working: '일하는 중',
  waiting: '기다리는 중',
  done: '끝냈어요',
  error: '문제 생겼어요',
  offline: '퇴근',
};

export const PILL_MEETING_KO = '회의 중';

/** 알약 뒤에 붙는 짧은 설명. 길면 말줄임표로 줄인다. */
export function pillDetail(activity: string | undefined, max = 18): string {
  const t = (activity ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}
