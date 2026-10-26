import type { Agent } from './protocol';

export type TopicKind = 'error' | 'waiting' | 'busy' | 'done' | 'task' | 'none';
export interface Topic { kind: TopicKind; text: string }
export interface ChatLineText { from: string; to: string; text: string }
export interface ChatOpts {
  rnd?: () => number;
  teamTaskA?: string;
  teamTaskB?: string;
  where?: 'desk' | 'break';
}

export function cleanLine(text: unknown, max?: number): string;
export function topicOf(agent: Agent, teamTask?: string): Topic;
export function makeChat(a: Agent, b: Agent, opts?: ChatOpts): [ChatLineText, ChatLineText] | null;
