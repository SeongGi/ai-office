// What a desk monitor shows. Pure on purpose so both renderers and the tests share one answer.

import { toolRoom } from './places.js';

/** 'off' dark, 'dim' idle or done, 'code' scrolling lines, 'dots' pulsing dots, 'cursor' blinking cursor, 'error' red with '!'. */
export function screenMode(status) {
  switch (status) {
    case 'working': return 'code';
    case 'thinking': return 'dots';
    case 'waiting': return 'cursor';
    case 'error': return 'error';
    case 'offline': return 'off';
    default: return 'dim';
  }
}

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

/** Colour family of the code lines: edit-like green, shell and server blue, search teal, read amber, else green. */
export function toolHue(tool) {
  if (typeof tool === 'string' && EDIT_TOOLS.has(tool)) return 'green';
  switch (toolRoom(tool)) {
    case 'server': return 'blue';
    case 'search': return 'teal';
    case 'library': return 'amber';
    default: return 'green';
  }
}

export const MONITOR_COLORS = { green: '#4ade80', blue: '#60a5fa', teal: '#2dd4bf', amber: '#fbbf24' };

/** How fast the code lines scroll, in rows per second. */
export const SCROLL_ROWS_PER_SEC = 2.5;
