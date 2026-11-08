// 사무실 이름 상태. 서버가 snapshot과 office 이벤트로 알려 주는 값을 들고, 바뀌면 구독자에게 알린다.
import { DEFAULT_OFFICE_NAME } from '../../shared/officeName.js';

export interface OfficeInfo {
  /** 화면에 보여 줄 이름. 정하기 전에는 기본 이름이다. */
  name: string;
  /** 사용자가 정했는지(환경변수 또는 파일). */
  configured: boolean;
  /** 서버 설정으로 고정돼 화면에서 바꿀 수 없는지. */
  locked: boolean;
}

let info: OfficeInfo = { name: DEFAULT_OFFICE_NAME, configured: false, locked: false };
const listeners = new Set<() => void>();

export const officeInfo = () => info;
export const officeName = () => info.name;

/** 구독한다. 이름이 바뀌었거나 touchOffice가 불렸을 때 부른다. 구독을 끊는 함수를 돌려준다. */
export function onOfficeChange(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** 이름이 그대로여도 구독자를 다시 부른다(권한처럼 이름 밖의 조건이 바뀐 때). */
export function touchOffice() {
  for (const fn of listeners) fn();
}

/** 서버가 보낸 값을 반영한다. 모양이 틀리면 무시한다. */
export function applyOffice(next: unknown) {
  const v = next as Partial<OfficeInfo> | null;
  if (!v || typeof v.name !== 'string' || !v.name) return;
  const merged: OfficeInfo = { name: v.name, configured: v.configured === true, locked: v.locked === true };
  if (merged.name === info.name && merged.configured === info.configured && merged.locked === info.locked) return;
  info = merged;
  touchOffice();
}
