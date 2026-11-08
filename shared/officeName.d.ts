export const DEFAULT_OFFICE_NAME: string;
export const OFFICE_NAME_MAX: number;
export type OfficeNameCheck = { ok: true; name: string } | { ok: false; reason: string };
/** 사무실 이름을 검증한다. 앞뒤 공백을 자르고 1~24자(코드 포인트 기준)만 받는다. */
export function validateOfficeName(raw: unknown): OfficeNameCheck;
