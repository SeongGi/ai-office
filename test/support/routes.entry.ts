// Bundled by test/walls.test.mjs: the real layout, route and cat-walking code, without the canvas.
import { ELEVATOR, OFFICE_D, CORRIDOR, SeatBook, computeLayout, toWorld, BOOTHS_MIN_W, type BuildingLayout, type RoomLayout, type Seat } from '../../src/world/layout';
import { roomSpots, tripRoute, BREAK_KINDS, NEWHIRE_BENCH, NEWHIRES, NEWHIRE_MIN_W } from '../../src/world/trips';
import { boothCount, boothSeats, BOOTH_PITCH, toolObstacles } from '../../src/world/toolRooms';
import { DOOR_GAP, wallSegments } from '../../src/world/walls';
import { Agent2D, type P, type SeatW } from '../../src/world2d/agent2d';

export { ELEVATOR, OFFICE_D, CORRIDOR, SeatBook, computeLayout, toWorld, BOOTHS_MIN_W, roomSpots, tripRoute, BREAK_KINDS, NEWHIRE_BENCH, NEWHIRES, NEWHIRE_MIN_W };
export { boothCount, boothSeats, BOOTH_PITCH, toolObstacles, DOOR_GAP, wallSegments, Agent2D };
export type { BuildingLayout, RoomLayout, Seat, P, SeatW };

/** Same as World2D.seatWorld. */
export function seatWorld(room: RoomLayout, seat: Seat): SeatW {
  const w = (p: [number, number]): P => {
    const [x, z] = toWorld(room, p);
    return { x, z };
  };
  const p = w([seat.x, seat.z]);
  const c = Math.cos(room.yaw);
  const s = Math.sin(room.yaw);
  const lx = -Math.sin(seat.yaw);
  const lz = -Math.cos(seat.yaw);
  return { x: p.x, z: p.z, fx: lx * c + lz * s, fz: -lx * s + lz * c, path: seat.path.map(w), door: w(room.entry[room.entry.length - 1]) };
}

/** Same as World2D.exitFor, with the cab spawn point the cats appear at. */
export const SPAWN: P = { x: ELEVATOR.x, z: ELEVATOR.z + 0.3 - 0.55 };
export function exitFor(room: RoomLayout): P[] {
  return [...room.exit.map((p) => { const [x, z] = toWorld(room, p); return { x, z }; }), SPAWN];
}
