// Where cats stand in the tool rooms (자료실, 서버실, 정보검색실) and where the server racks are.
// Room-local metres, shared by the 2D and the 3D renderer so both put the cats at the same spots.
import { OFFICE_D } from './layout';

export type ToolRoomKind = 'library' | 'server' | 'search';

/**
 * Where a cat stands in a tool room (room-local metres). `via` is the lane it walks down from the aisle; `work` the pose (1 book, 2 typing, 3 looking).
 * A `desk` spot is a workstation: the cat sits on the chair at (x, z) and faces the back wall (-Z), the desk stands DESK_OFFSET in front of it.
 */
export interface ToolSpot {
  x: number;
  z: number;
  look: number;
  via: number;
  work: 1 | 2 | 3;
  desk?: boolean;
}

/** The aisle (room-local z) the cats walk along inside a tool room, in front of the furniture. */
export const TOOL_AISLE = 2.4;

/** Workstation seats of the server and search rooms: two chairs side by side with a free lane between the desks. */
const DESK_X = 1.3;
const DESK_SEAT_Z = 1.6;
/** A desk is 1.48 wide and 0.7 deep, its centre 0.8 in front of the seat; the monitor stands up to 0.2 behind the desk. */
const DESK_BOX = { halfW: 0.74, near: 0.45, far: 1.36 };

const deskSpots = (): ToolSpot[] => [
  { x: -DESK_X, z: DESK_SEAT_Z, look: 0, via: -DESK_X, work: 2, desk: true },
  { x: DESK_X, z: DESK_SEAT_Z, look: 0, via: DESK_X, work: 2, desk: true },
];

export function toolSpots(kind: ToolRoomKind, w: number): ToolSpot[] {
  const e = w / 2;
  if (kind === 'library') {
    return [
      { x: -0.7, z: 0.55, look: 0.3, via: -0.7, work: 1 },
      { x: 0.7, z: 0.55, look: -0.3, via: 0.7, work: 1 },
      { x: -e + 1.1, z: -1.7, look: -1, via: -e + 1.1, work: 1 },
      { x: e - 1.1, z: -1.7, look: 1, via: e - 1.1, work: 1 },
      { x: 0, z: -1.5, look: 0, via: e - 1.1, work: 1 },
    ];
  }
  // Looking spots stand beside a rack or the globe and walk down the middle lane between the desks. A cat sprite is 1.3 wide and 1.4 tall, so none reaches a wall or a wall plaque.
  if (kind === 'server') {
    return [
      ...deskSpots(),
      { x: -1.05, z: -1.2, look: 0.3, via: 0, work: 3 },
      { x: 1.05, z: -1.2, look: -0.3, via: 0, work: 3 },
    ];
  }
  return [
    ...deskSpots(),
    { x: -0.95, z: -1.75, look: 0.3, via: 0, work: 3 },
    { x: 0.95, z: -1.75, look: -0.3, via: 0, work: 3 },
  ];
}

/** Rack cabinets of the server room: centre and size in room-local metres (rot in canvas radians). */
export function serverRacks(w: number): { x: number; z: number; rot: number }[] {
  const e = w / 2;
  const back = -OFFICE_D / 2 + 0.55;
  return [
    { x: -1.4, z: back, rot: 0 },
    { x: 0, z: back, rot: 0 },
    { x: 1.4, z: back, rot: 0 },
    { x: -e + 0.45, z: -1.2, rot: Math.PI / 2 },
    { x: e - 0.45, z: -1.2, rot: Math.PI / 2 },
  ];
}

/** The monitor wall of the search room (centres, width 1.15, depth 0.3) and the globe (centre, box side 0.92). */
export function searchWall(): { x: number; z: number }[] {
  return [-1.4, 0, 1.4].map((x) => ({ x, z: -OFFICE_D / 2 + 0.45 }));
}
export const globeSpot = (w: number) => ({ x: -w / 2 + 0.85, z: -2.4 });

export interface Box {
  x: number;
  z: number;
  w: number;
  d: number;
}

/** What stands on the floor of a tool room (room-local boxes), so a route or a seat can be checked against it. Desks include the monitor. */
export function toolObstacles(kind: ToolRoomKind, w: number): Box[] {
  const out: Box[] = [];
  if (kind === 'server') {
    for (const r of serverRacks(w)) out.push(r.rot ? { x: r.x, z: r.z, w: 0.8, d: 1.0 } : { x: r.x, z: r.z, w: 1.0, d: 0.8 });
  }
  if (kind === 'search') {
    for (const m of searchWall()) out.push({ x: m.x, z: m.z, w: 1.15, d: 0.3 });
    const g = globeSpot(w);
    out.push({ x: g.x, z: g.z, w: 0.92, d: 0.92 });
  }
  if (kind !== 'library') {
    for (const s of toolSpots(kind, w)) {
      if (!s.desk) continue;
      const z0 = s.z - DESK_BOX.far;
      const z1 = s.z - DESK_BOX.near;
      out.push({ x: s.x, z: (z0 + z1) / 2, w: DESK_BOX.halfW * 2, d: z1 - z0 });
    }
  }
  return out;
}

// ---------------------------------------------------------------- 1인 부스

/** Booths stand in a row along the back wall, one every BOOTH_PITCH (a cat sprite is 1.3 wide), with a partition between two of them. */
export const BOOTH_PITCH = 1.9;
/** The chair of a booth; the desk is 0.8 in front of it, against the back wall. */
export const BOOTH_SEAT_Z = -2.25;
const BOOTH_MARGIN = 0.3;

/** How many booths fit between the walls of a room w wide: the outer partitions keep BOOTH_MARGIN from the wall line. */
export function boothCount(w: number) {
  return Math.max(0, Math.floor((w - 2 * BOOTH_MARGIN) / BOOTH_PITCH));
}

/** Room-local x of each booth chair, centred in the room. */
export function boothSeats(w: number): number[] {
  const n = boothCount(w);
  return Array.from({ length: n }, (_, i) => (i - (n - 1) / 2) * BOOTH_PITCH);
}
