// Where cats stand in the tool rooms (자료실, 서버실, 정보검색실) and where the server racks are.
// Room-local metres, shared by the 2D and the 3D renderer so both put the cats at the same spots.
import { OFFICE_D } from './layout';

export type ToolRoomKind = 'library' | 'server' | 'search';

/** Where a cat stands in a tool room (room-local metres). `via` is the lane it walks down from the aisle; `work` the pose (1 book, 2 typing, 3 looking). */
export interface ToolSpot {
  x: number;
  z: number;
  look: number;
  via: number;
  work: 1 | 2 | 3;
}

/** The aisle (room-local z) the cats walk along inside a tool room, in front of the furniture. */
export const TOOL_AISLE = 2.4;

export function toolSpots(kind: ToolRoomKind, w: number): ToolSpot[] {
  const e = w / 2;
  if (kind === 'library') {
    return [
      { x: -0.7, z: 0.55, look: 0.3, via: -0.7, work: 1 },
      { x: 0.7, z: 0.55, look: -0.3, via: 0.7, work: 1 },
      { x: -e + 1.1, z: -1.9, look: -1, via: -e + 1.1, work: 1 },
      { x: e - 1.1, z: -1.9, look: 1, via: e - 1.1, work: 1 },
      { x: 0, z: -2.9, look: 0, via: e - 1.1, work: 1 },
    ];
  }
  if (kind === 'server') {
    return [
      { x: -0.6, z: 1.25, look: 0.3, via: -0.6, work: 2 },
      { x: 0.6, z: 1.25, look: -0.3, via: 0.6, work: 2 },
      { x: -1.2, z: -2.5, look: 0, via: -1.25, work: 3 },
      { x: 1.2, z: -2.5, look: 0, via: 1.25, work: 3 },
      { x: 0, z: -2.5, look: 0, via: 1.25, work: 3 },
    ];
  }
  return [
    { x: -0.6, z: 0.2, look: 0.3, via: -0.6, work: 2 },
    { x: 0.6, z: 0.2, look: -0.3, via: 0.6, work: 2 },
    { x: -e + 0.9, z: -1.2, look: -0.7, via: -e + 0.9, work: 3 },
    { x: e - 0.9, z: -1.2, look: 0.7, via: e - 0.9, work: 3 },
    { x: 0, z: -2.5, look: 0, via: e - 0.9, work: 3 },
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
