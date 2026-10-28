export type NpcTag = 'nod' | 'hop' | 'sip' | 'stretch' | 'cheer';
export type NpcLine = readonly [slot: 0 | 1, text: string, tag?: NpcTag];
export type NpcScenario = readonly NpcLine[];
export type NpcPlace = 'interview' | 'info' | 'lounge' | 'banter';

export const MAX_LINE: number;
export const NPC_SCRIPTS: Record<NpcPlace, readonly NpcScenario[]>;
