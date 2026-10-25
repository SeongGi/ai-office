import type { Agent, WorldState } from './protocol';

export type Place = 'desk' | 'meeting' | 'lounge' | 'games' | 'kitchen';

export const LOUNGE_AFTER_MS: number;
export function breakPlace(id: string): 'lounge' | 'games' | 'kitchen';
export function hasLiveHelper(agent: Agent, agents: Record<string, Agent>): boolean;
export function desiredPlace(agent: Agent, agents: Record<string, Agent>, idleSinceMs: number | null, nowMs: number, meeting?: WorldState['meeting']): Place;
export function meetingCovers(meeting: WorldState['meeting'], agent: Agent): boolean;
