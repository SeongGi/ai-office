// Where a cat goes in a shared room and the way there. Pure (no canvas), so a test can walk every route against the walls.
// Spots are room-local metres: +Z is the door side of the room, -Z the back wall.
import { toWorld, type BuildingLayout } from './layout';
import { boothSeats, BOOTH_SEAT_Z, TOOL_AISLE, toolSpots, type ToolRoomKind } from './toolRooms';

export interface P {
  x: number;
  z: number;
}

export type BreakKind = 'lounge' | 'games' | 'kitchen' | 'booths';
export type TripKind = 'meeting' | BreakKind | ToolRoomKind;

/** A resting cat tries its own break room first, then the others in this order. */
export const BREAK_KINDS: BreakKind[] = ['lounge', 'games', 'kitchen', 'booths'];
export const isBreakKind = (k: string): k is BreakKind => (BREAK_KINDS as string[]).includes(k);

/**
 * Lounge bench for the new hires who wait (lounge-local metres). It stands against the back wall in the east: the cats on it
 * face the room and their sprites reach up into the lounge, never into a wall or the door plaque. Needs a lounge this wide.
 */
export const NEWHIRE_MIN_W = 8.6;
export const NEWHIRE_BENCH = { x: 2.95, z: -3.5, w: 2.5, d: 0.5 };
export const NEWHIRES = [
  { x: 2.65, z: -3.5 },
  { x: 3.65, z: -3.5 },
];

export const MEETING_CHAIRS = 8;
const MEETING_OUTER = 6;

export interface RoomSpot {
  x: number;
  z: number;
  look: number;
  sit: boolean;
  work: 0 | 1 | 2 | 3;
  /** A workstation: the renderer stands a desk and a chair here. */
  desk?: boolean;
}

/** Meeting room: ring of chairs round the table (sit), then a ring of standing places outside it. */
const MEETING = { cx: 0, cz: -0.3 };
/** The standing ring outside the chairs, set so no place is closer than 1 m to a chair or to its neighbour. */
const OUTER = { rx: 2.8, rz: 2.45 };
function meetingSpot(slot: number): RoomSpot {
  const chair = slot < MEETING_CHAIRS;
  const ang = chair ? (slot / MEETING_CHAIRS) * Math.PI * 2 + Math.PI / MEETING_CHAIRS : ((slot - MEETING_CHAIRS) / MEETING_OUTER) * Math.PI * 2;
  const rx = chair ? 2.05 : OUTER.rx;
  const rz = chair ? 1.35 : OUTER.rz;
  return { x: MEETING.cx + Math.cos(ang) * rx, z: MEETING.cz + Math.sin(ang) * rz, look: 0, sit: chair, work: 0 };
}

/**
 * Every place a cat can take in a room of kind `kind` and width `w`, in the order it is handed out.
 * Standing places in a break room are at least 1.5 apart, seats at least 1.0.
 */
export function roomSpots(kind: TripKind, w: number): RoomSpot[] {
  if (kind === 'library' || kind === 'server' || kind === 'search') {
    return toolSpots(kind, w).map((s) => ({ x: s.x, z: s.z, look: s.look, sit: !!s.desk, work: s.work, desk: s.desk }));
  }
  if (kind === 'meeting') return Array.from({ length: MEETING_CHAIRS + MEETING_OUTER }, (_, i) => meetingSpot(i));
  if (kind === 'booths') return boothSeats(w).map((x) => ({ x, z: BOOTH_SEAT_Z, look: 0, sit: true, work: 0, desk: true }));
  const s = (x: number, z: number, look: number, sit = false): RoomSpot => ({ x, z, look, sit, work: 0 });
  if (kind === 'games') {
    // Ping pong players first (slots 0 and 1), then the sides of the table, then the ends.
    return [
      s(-1.7, -0.4, 1),
      s(1.7, -0.4, -1),
      s(-0.8, 0.95, 0.5),
      s(0.8, 0.95, -0.5),
      s(-0.8, -1.7, 0.5),
      s(0.8, -1.7, -0.5),
      s(-2.6, 1.2, 1),
      s(2.6, 1.2, -1),
    ];
  }
  if (kind === 'kitchen') {
    return [s(-2.2, -0.5, 1), s(1.6, -0.5, -1), s(-0.3, 0.55, 0), s(-0.3, -1.6, 0), s(-w / 2 + 1.5, 1.3, 1), s(w / 2 - 1.5, 1.3, -1)];
  }
  // lounge: sofa, armchairs and beanbags first (sit), then standing spots
  return [
    s(-0.8, -1.9, 0, true),
    s(0.2, -1.9, 0, true),
    s(1.2, -1.9, 0, true),
    s(-2.3, -0.1, 0, true),
    s(2.7, -0.1, 0, true),
    s(w / 2 - 1.0, 2.2, 0, true),
    s(w / 2 - 2.0, 2.7, 0, true),
    s(-1.4, 1.2, 0),
    s(0.2, 1.0, 0),
    s(1.8, 1.2, 0),
    s(-2.9, 1.5, 0),
  ];
}

export interface Trip {
  route: P[];
  look: number;
  sit: boolean;
  work: 0 | 1 | 2 | 3;
  spot: RoomSpot;
}

/** World route from the corridor outside a team's door to spot number `slot` of a shared room, or null when there is no such room or spot. */
export function tripRoute(plan: BuildingLayout, team: string, kind: TripKind, slot: number): Trip | null {
  const room = plan.rooms.get(team);
  const am = plan.amenities.find((a) => a.kind === kind);
  if (!room || !am) return null;
  const spots = roomSpots(kind, am.rect.w);
  const spot = spots[slot];
  if (!spot) return null;
  const frame = { x: am.rect.x, z: am.rect.z, yaw: am.side === 'north' ? 0 : Math.PI };
  const aw = (x: number, z: number): P => {
    const [wx, wz] = toWorld(frame, [x, z]);
    return { x: wx, z: wz };
  };
  const [dx, dz] = toWorld(room, room.entry[room.entry.length - 1]);
  const door: P = { x: dx, z: dz };
  const lane: P = { x: am.rect.x, z: 0 };
  const w = am.rect.w;
  const front = am.rect.d / 2 - 0.7;
  const inside: P[] = [door, lane, aw(0, front)];
  let pts: P[];
  if (kind === 'library' || kind === 'server' || kind === 'search') {
    // Tool rooms: in through the door, along the aisle, down a free lane to the spot.
    const via = toolSpots(kind, w)[slot].via;
    pts = [aw(0, TOOL_AISLE), aw(via, TOOL_AISLE), aw(via, spot.z), aw(spot.x, spot.z)];
  } else if (kind === 'meeting') {
    // Walk round the outside of the table (outer ring) from the door side to the target angle.
    const chair = spot.sit;
    const ang = chair ? (slot / MEETING_CHAIRS) * Math.PI * 2 + Math.PI / MEETING_CHAIRS : ((slot - MEETING_CHAIRS) / MEETING_OUTER) * Math.PI * 2;
    pts = [];
    let a0 = Math.PI / 2;
    let da = ((ang - a0 + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    const steps = Math.max(1, Math.ceil(Math.abs(da) / 0.6));
    da /= steps;
    for (let i = 1; i <= steps; i++) {
      a0 += da;
      pts.push(aw(MEETING.cx + Math.cos(a0) * OUTER.rx, MEETING.cz + Math.sin(a0) * OUTER.rz));
    }
    pts.push(aw(spot.x, spot.z));
  } else if (kind === 'booths') {
    // Along the front of the row, then straight down the booth to the chair.
    pts = [aw(spot.x, front), aw(spot.x, spot.z)];
  } else if (kind === 'games' || kind === 'kitchen') {
    // In down the middle, along the aisle in front of the island (or the table), and round its end to the spots behind it.
    const aisle = kind === 'kitchen' ? 1.0 : 1.2;
    const behind = kind === 'kitchen' ? spot.z < -1.0 : spot.z < -1.1;
    const x = !behind ? spot.x : kind === 'kitchen' ? -1.9 : Math.sign(spot.x) * 1.7;
    pts = [aw(0, aisle), aw(x, aisle), aw(x, spot.z), aw(spot.x, spot.z)];
  } else {
    // lounge: in west of the TV to the aisle between the TV and the coffee table; the sofa is reached round the table.
    const aisle = 0.6;
    pts = [aw(-1.4, aisle)];
    if (spot.z < -1.0) {
      const x = spot.x <= 0.2 ? -1.2 : 1.3;
      pts.push(aw(x, aisle), aw(x, -1.3), aw(spot.x, -1.3));
    } else pts.push(aw(spot.x, aisle));
    pts.push(aw(spot.x, spot.z));
    inside[2] = aw(-1.4, front);
  }
  const route = [...inside, ...pts].filter((p, i, all) => i === 0 || Math.hypot(p.x - all[i - 1].x, p.z - all[i - 1].z) > 1e-6);
  return { route, look: spot.look, sit: spot.sit, work: spot.work, spot };
}
