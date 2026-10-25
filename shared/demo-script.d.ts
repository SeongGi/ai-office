import type { InboundEvent } from './protocol';

export interface DemoStep {
  wait: number;
  events: InboundEvent[];
}

export function createScript(seed?: number, opts?: { agents?: number }): { next(): DemoStep };
