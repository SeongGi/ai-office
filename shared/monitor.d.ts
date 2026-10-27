import type { Status } from './protocol';

export type ScreenMode = 'off' | 'dim' | 'code' | 'dots' | 'cursor' | 'error';
export type MonitorHue = 'green' | 'blue' | 'teal' | 'amber';

export function screenMode(status: Status): ScreenMode;
export function toolHue(tool: string | undefined | null): MonitorHue;
export const MONITOR_COLORS: Record<MonitorHue, string>;
export const SCROLL_ROWS_PER_SEC: number;
