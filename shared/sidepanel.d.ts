import type { Agent, HistoryEntry, WorldState } from './protocol';
import type { ToolState } from './places';

export type ToolClass = 'library' | 'server' | 'search' | 'other';
export interface ToolTally {
  primed: boolean;
  seen: Map<string, number>;
  counts: Record<ToolClass, number>;
}
export interface TimelineRow {
  agentId: string;
  name: string;
  hue: number;
  ts: number;
  kind: HistoryEntry['kind'];
  text: string;
  rel: string;
}

export const TOOL_CLASSES: ToolClass[];
export const TIMELINE_MAX: number;
export const TEXT_MAX: number;
export function toolClass(tool: string | undefined | null): ToolClass;
export function createTally(): ToolTally;
export function observeTools(tally: ToolTally, agents: Record<string, Agent>): Record<ToolClass, number>;
export function relTime(ts: number, now: number): string;
export function clipText(text: unknown, max?: number): string;
export function buildRows(state: WorldState, now: number, limit?: number): TimelineRow[];

export interface RoomInfo {
  name: string;
  use: string;
  tools: string;
  plain: string;
}
export type GuidePlace = 'library' | 'server' | 'search' | 'desk';
export const ROOM_INFO: Record<GuidePlace, RoomInfo>;
export const GUIDE_PLACES: GuidePlace[];
export function toolTag(tool: string | undefined | null, activity: string | undefined | null, max?: number): string;
export function liveRoomCounts(memo: Map<string, ToolState>, agents: Record<string, Agent>, nowMs: number): Record<GuidePlace, number>;
