// 사무실 이름의 기본값과 검증 규칙. 서버와 화면이 같이 쓴다.
export const DEFAULT_OFFICE_NAME = 'AI Office';
export const OFFICE_NAME_MAX = 24;

// 제어 문자, 줄/문단 구분자, 방향 제어 문자(U+202A~202E, U+2066~2069), 제로폭 문자(U+200B~200F, U+FEFF)
const FORBIDDEN = /[\p{Cc}\u2028\u2029\u202a-\u202e\u2066-\u2069\u200b-\u200f\ufeff]/u;

/** 사무실 이름을 검증한다. 앞뒤 공백을 자르고 1~24자(코드 포인트 기준)만 받는다. */
export function validateOfficeName(raw) {
  if (typeof raw !== 'string') return { ok: false, reason: '이름을 글자로 보내 주세요' };
  const name = raw.trim();
  const length = [...name].length;
  if (length < 1) return { ok: false, reason: '이름을 한 글자 이상 써 주세요' };
  if (length > OFFICE_NAME_MAX) return { ok: false, reason: `이름은 ${OFFICE_NAME_MAX}자 이하로 써 주세요` };
  if (FORBIDDEN.test(name)) return { ok: false, reason: '이름에 쓸 수 없는 문자가 들어 있어요' };
  return { ok: true, name };
}
