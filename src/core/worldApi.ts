import type { Effect, WorldState } from '../../shared/protocol';
import type { ThemeName } from '../world/palette';
import type { Anchor } from '../world/World';

export interface WorldPerf {
  frameMs: number;
  fps: number;
  syncMs: number;
  worstSyncMs: number;
  calls: number;
  triangles: number;
  agents: number;
}

/** What main.ts needs from a world view. Both the 3D and the 2D world satisfy it. */
export interface FloorWorld {
  onFrame?: () => void;
  readonly perf: WorldPerf;
  setTheme(theme: ThemeName): void;
  sync(state: WorldState): void;
  reset(): void;
  handleEffect(effect: Effect): void;
  setSelected(id: string | null): void;
  focusAgent(id: string): void;
  focusTeam(id: string): void;
  frameAll(instant?: boolean): void;
  anchors(): Anchor[];
  agentIds(): string[];
}
