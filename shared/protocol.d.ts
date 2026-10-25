export type Status = 'idle' | 'thinking' | 'working' | 'waiting' | 'done' | 'error' | 'offline';
export type EventType = 'join' | 'status' | 'tool' | 'message' | 'task' | 'leave' | 'reset' | 'meeting';

/** What clients POST to /events. Only `type` and `agent` are required. */
export interface InboundEvent {
  type: EventType;
  agent?: string | { id: string; name?: string; role?: string; source?: string };
  name?: string;
  role?: string;
  source?: string;
  team?: string | { id?: string; name: string };
  parent?: string;
  model?: string;
  cwd?: string;
  branch?: string;
  status?: Status;
  activity?: string;
  tool?: string;
  text?: string;
  task?: string;
  to?: string | string[];
  lastPrompt?: string;
  lastReply?: string;
  permission?: string;
  subagent?: { key?: string; type?: string };
  meeting?: 'start' | 'end';
  all?: boolean;
  ts?: number;
}

export interface FloorEvent {
  type: EventType;
  ts: number;
  agent: string;
  name?: string;
  role?: string;
  source?: string;
  parent?: string;
  model?: string;
  cwd?: string;
  branch?: string;
  team?: string;
  teamName?: string;
  status?: Status;
  activity?: string;
  tool?: string;
  text?: string;
  task?: string;
  to?: string[];
  lastPrompt?: string;
  lastReply?: string;
  permission?: string;
  meeting?: 'start' | 'end';
  all?: boolean;
}

export interface HistoryEntry {
  ts: number;
  kind: 'join' | 'status' | 'tool' | 'message' | 'task' | 'leave';
  text: string;
  tool?: string;
  status?: Status;
  to?: string[];
}

export interface Agent {
  id: string;
  name: string;
  role: string;
  team: string;
  source: string;
  parent?: string;
  model?: string;
  cwd?: string;
  branch?: string;
  status: Status;
  activity?: string;
  tool?: string;
  joinedAt: number;
  lastSeen: number;
  history: HistoryEntry[];
  boundKey?: string;
  /** 메인 세션만: 마지막으로 물어본 것, 마지막 답, 권한 모드(bypassPermissions 등). */
  lastPrompt?: string;
  lastReply?: string;
  permission?: string;
}

export interface Team {
  id: string;
  name: string;
  hue: number;
  order: number;
  task?: string;
  createdAt: number;
}

export interface WorldState {
  teams: Record<string, Team>;
  agents: Record<string, Agent>;
  seq: number;
  updatedAt: number;
  /** agent id -> time it left; used to ignore late events from a session that was dismissed. */
  left?: Record<string, number>;
  /** Active meeting. team is a team id, or '*' for everyone. */
  meeting?: { team: string; topic?: string; by?: string; startedAt: number; endsAt: number };
}

export type Effect =
  | { kind: 'reset' }
  | { kind: 'arrive'; agent: string }
  | { kind: 'leave'; agent: string }
  | { kind: 'meeting'; on: boolean; topic?: string }
  | { kind: 'message'; from: string; to: string; text: string };

export const PROTOCOL_VERSION: number;
export const STATUSES: Status[];
export const MEETING_MS: number;
export const EVENT_TYPES: EventType[];
export function createState(): WorldState;
export function slug(value: unknown): string;
export function normalizeEvent(raw: unknown, now?: number): FloorEvent | null;
export function applyEvent(state: WorldState, ev: FloorEvent | null): { state: WorldState; effects: Effect[] };
export function sweep(state: WorldState, now?: number, opts?: { offlineMs?: number; doneHelperMs?: number; staleMs?: number }): string[];
