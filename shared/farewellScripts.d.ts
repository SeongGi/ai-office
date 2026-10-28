export type FarewellLine = readonly [slot: 0 | 1 | 2 | 3, text: string];
export type FarewellScenario = readonly FarewellLine[];

export const MAX_LINE: number;
export const NAME_MAX: number;
export const HISTORY: number;
export const FAREWELL_SCRIPTS: readonly FarewellScenario[];
export const GOODBYES: readonly string[];
export function pickFarewell(rng: () => number, lastIds?: readonly number[]): { id: number; lines: FarewellScenario };
export function fillName(text: string, name: string | undefined | null): string;
