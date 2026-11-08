// localStorage 읽기와 쓰기. 키는 새 이름(ai-office...)으로만 저장하고,
// 읽을 때는 새 키가 없으면 옛 키(deprecated, 호환용)도 읽는다.
// 옛 키는 새 키의 접두어만 다르다(예: ai-office:theme <-> agent-floor:theme).

const LEGACY_PREFIX = 'agent-floor'; // deprecated, 호환용

/** 새 키를 읽고, 없으면 옛 키를 읽는다. 저장소를 못 읽으면 null. */
export function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key) ?? localStorage.getItem(key.replace(/^ai-office/, LEGACY_PREFIX));
  } catch {
    return null;
  }
}
