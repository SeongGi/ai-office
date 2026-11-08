export type NpcTag = 'nod' | 'hop' | 'sip' | 'stretch' | 'cheer';
export type NpcLine = readonly [slot: 0 | 1, text: string, tag?: NpcTag];
export type NpcScenario = readonly NpcLine[];
export type NpcPlace = 'interview' | 'info' | 'lounge' | 'banter';

export const MAX_LINE: number;
export const NPC_SCRIPTS: Record<NpcPlace, readonly NpcScenario[]>;

export const OFFICE_FALLBACK: Record<string, string>;
/** 대사의 {office} 자리를 사무실 이름으로 바꾼다. 길어지면 이름 없는 대체 문장을 쓴다. */
export function fillOffice(text: string, office: string): string;
