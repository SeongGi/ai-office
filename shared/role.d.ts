import type { Agent } from './protocol';

export interface JobInfo {
  /** 짧은 한국어 직무 이름. */
  role: string;
  /** 지금 하는 일 한 문장(40자 이하). */
  doing: string;
  /** '세션', '서브에이전트', '자동 감시' */
  kind: string;
}

export function describeJob(agent: Agent): JobInfo;
export function isWatcher(agent: Pick<Agent, 'source' | 'parent'>): boolean;
