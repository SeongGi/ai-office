// The wall lines of the building, shared by the picture and the test that walks routes against them.
import type { AmenityKind, BuildingLayout } from './layout';
import { CORRIDOR } from './layout';

/** Half width of a door gap in a corridor wall. */
export const DOOR_GAP = 0.62;

/** Kitchen, lounge and games have an open front: two short wall stubs and nothing between them. */
export const isOpenFront = (kind: AmenityKind) => kind === 'kitchen' || kind === 'lounge' || kind === 'games';
/** Length of each stub beside an open front. */
export const OPEN_STUB = 0.9;

/** One room's span along its wing: a door gap at world x `door`, or null for an open front. */
export interface WallUnit {
  side: 'north' | 'south';
  x0: number;
  w: number;
  door: number | null;
  open: boolean;
}

export function wallUnits(plan: BuildingLayout): WallUnit[] {
  const out: WallUnit[] = [];
  for (const r of plan.rooms.values()) out.push({ side: r.side, x0: r.x - r.w / 2, w: r.w, door: r.x + (r.side === 'north' ? r.doorX : -r.doorX), open: false });
  for (const a of plan.amenities) {
    const open = isOpenFront(a.kind);
    out.push({ side: a.side, x0: a.rect.x - a.rect.w / 2, w: a.rect.w, door: open ? null : a.rect.x, open });
  }
  return out;
}

/** Every wall segment [x1, z1, x2, z2] between the rooms and the corridor, without the outer outline. */
export function wallSegments(plan: BuildingLayout, units: WallUnit[] = wallUnits(plan)): [number, number, number, number][] {
  const segs: [number, number, number, number][] = [];
  for (const u of units) {
    const outerZ = u.side === 'north' ? plan.z0 : plan.z1;
    const wallZ = u.side === 'north' ? -CORRIDOR / 2 : CORRIDOR / 2;
    segs.push([u.x0, outerZ, u.x0, wallZ], [u.x0 + u.w, outerZ, u.x0 + u.w, wallZ]);
    if (u.open) {
      segs.push([u.x0, wallZ, u.x0 + OPEN_STUB, wallZ], [u.x0 + u.w - OPEN_STUB, wallZ, u.x0 + u.w, wallZ]);
    } else if (u.door !== null) {
      segs.push([u.x0, wallZ, u.door - DOOR_GAP, wallZ], [u.door + DOOR_GAP, wallZ, u.x0 + u.w, wallZ]);
    }
  }
  return segs;
}
