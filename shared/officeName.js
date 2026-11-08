// 사무실 이름의 기본값과 검증 규칙. 서버와 화면이 같이 쓴다.
export const DEFAULT_OFFICE_NAME = 'AI Office';
export const OFFICE_NAME_MAX = 24;

// trim 전 원문에 거는 검사: 형식 문자(\p{Cf}: 방향 제어 U+202A~202E와 U+2066~2069, 제로폭 U+200B~200F, U+FEFF 등)와
// 짝 없는 서로게이트(\p{Cs}). 앞뒤에 있어도 trim이 지우기 전에 거부한다.
const FORBIDDEN_RAW = /[\p{Cf}\p{Cs}\u202a-\u202e\u2066-\u2069\u200b-\u200f\ufeff]/u;
// 제어 문자와 줄/문단 구분자. 앞뒤 공백 줄바꿈은 trim이 정리하므로 자른 뒤에 검사한다.
const FORBIDDEN_TRIMMED = /[\p{Cc}\u2028\u2029]/u;
// 공백처럼 보이지만 글자가 없는 문자: 공백류, 한글 채움 문자(U+3164, U+115F, U+1160, U+FFA0), 점자 빈칸(U+2800)
const INVISIBLE = /[\s\p{Z}\p{Cf}\u3164\u115f\u1160\uffa0\u2800]/gu;

/** 사무실 이름을 검증한다. 앞뒤 공백을 자르고 1~24자(코드 포인트 기준)에 보이는 글자가 있어야 한다. */
export function validateOfficeName(raw) {
  if (typeof raw !== 'string') return { ok: false, reason: '이름을 글자로 보내 주세요' };
  if (FORBIDDEN_RAW.test(raw)) return { ok: false, reason: '이름에 쓸 수 없는 문자가 들어 있어요' };
  const name = raw.trim();
  const length = [...name].length;
  if (length < 1) return { ok: false, reason: '이름을 한 글자 이상 써 주세요' };
  if (length > OFFICE_NAME_MAX) return { ok: false, reason: `이름은 ${OFFICE_NAME_MAX}자 이하로 써 주세요` };
  if (FORBIDDEN_TRIMMED.test(name)) return { ok: false, reason: '이름에 쓸 수 없는 문자가 들어 있어요' };
  if (!name.replace(INVISIBLE, '')) return { ok: false, reason: '보이는 글자가 있는 이름을 써 주세요' };
  return { ok: true, name };
}
