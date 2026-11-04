import type { Amenity } from '../world/layout';

/**
 * Where the meeting room roster starts: its left edge, the outer wall it hangs from and which way the lines stack.
 * A north room lists upward from its north wall, a south room downward from its south wall: always outside the
 * building, away from the corridor signs. The room always sits east of the lobby, so the roster stays clear of the elevator.
 */
export function rosterOrigin(am: Amenity): { x: number; wall: number; dir: 1 | -1 } {
  const dir = am.side === 'north' ? -1 : 1;
  return { x: am.rect.x - am.rect.w / 2 + 0.2, wall: am.rect.z + (dir * am.rect.d) / 2, dir };
}
