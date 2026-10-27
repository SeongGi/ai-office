import type { Agent, WorldState } from './protocol';

export type ToolRoom = 'library' | 'server' | 'search';
export type Place = 'desk' | 'meeting' | 'lounge' | 'games' | 'kitchen' | ToolRoom;

export const LOUNGE_AFTER_MS: number;
export function breakPlace(id: string): 'lounge' | 'games' | 'kitchen';
export function hasLiveHelper(agent: Agent, agents: Record<string, Agent>): boolean;
export function desiredPlace(agent: Agent, agents: Record<string, Agent>, idleSinceMs: number | null, nowMs: number, meeting?: WorldState['meeting'], tool?: ToolRoom | null): Place;
export function meetingCovers(meeting: WorldState['meeting'], agent: Agent): boolean;
export function initialPlace(agent: Agent, agents: Record<string, Agent>, nowMs: number, meeting?: WorldState['meeting']): Place;
export function idleAgeMs(agent: Agent, nowMs: number): number;

export function toolRoom(tool: string | undefined | null): ToolRoom | null;
export const TOOL_REPEAT_MS: number;
export const TOOL_LONG_CALL_MS: number;
export const TOOL_MIN_STAY_MS: number;
export const TOOL_LEAVE_MS: number;
export const TOOL_FRESH_MS: number;
export interface ToolState {
  room: ToolRoom | null;
  since: number;
  cand: ToolRoom | null;
  candAt: number;
  seenAt: number | null;
  lastRoom: ToolRoom | null;
  lastAt: number;
}
export function createToolState(): ToolState;
export function stepToolRoom(st: ToolState, agent: Agent, nowMs: number): ToolRoom | null;
export function initialToolState(agent: Agent, nowMs: number): ToolState;
export const TOOL_FAIL_PREFIX: string;
export const TOOL_FAIL_SHOW_MS: number;
export function isToolFailure(agent: Agent): boolean;
export function effectiveStatus(agent: Agent, nowMs: number): Agent['status'];
export function failureTool(agent: Agent): string;
export function thinkingText(activity: string | undefined | null): string;
export function bubbleLines(text: string): [string, string];

export const CELEBRATE_MS: number;
export const CELEBRATE_GAP_MS: number;
export interface CelebrateState {
  at: number | null;
}
export function createCelebrateState(): CelebrateState;
export function shouldCelebrate(st: CelebrateState, prev: Agent['status'], next: Agent['status'], nowMs: number): boolean;
