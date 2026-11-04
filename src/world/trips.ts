// Where a cat goes in a shared room and the way there. Pure (no canvas), so a test can walk every route against the walls.
// Spots are room-local metres: +Z is the door side of the room, -Z the back wall.
import { OFFICE_D, toWorld, type BuildingLayout } from './layout';
import { boothSeats, BOOTH_SEAT_Z, TOOL_AISLE, toolSpots, type Box, type ToolRoomKind } from './toolRooms';

export interface P {
  x: number;
  z: number;
}

export type BreakKind = 'lounge' | 'games' | 'kitchen' | 'booths';
export type TripKind = 'meeting' | BreakKind | ToolRoomKind;

/** A resting cat tries its own break room first, then the others in this order. */
export const BREAK_KINDS: BreakKind[] = ['lounge', 'games', 'kitchen', 'booths'];
export const isBreakKind = (k: string): k is BreakKind => (BREAK_KINDS as string[]).includes(k);

/** The rooms a cat that wants `want` tries, in order: a resting cat or one that finds the meeting chairs taken goes on to the break rooms. */
export function tripKinds(want: TripKind): TripKind[] {
  if (isBreakKind(want)) return [want, ...BREAK_KINDS.filter((k) => k !== want)];
  if (want === 'meeting') return ['meeting', ...BREAK_KINDS];
  return [want];
}

/**
 * One cat per spot: the first room of tripKinds(want) with a free spot gets cat `id`, recorded in `slots`. `width` gives a room's
 * width, or undefined when the building has no such room. null when every room is full (the cat stays at its desk).
 */
export function claimSpot(slots: Record<TripKind, Map<string, number>>, want: TripKind, id: string, width: (kind: TripKind) => number | undefined) {
  for (const kind of tripKinds(want)) {
    const w = width(kind);
    if (w === undefined) continue;
    const used = new Set(slots[kind].values());
    let slot = 0;
    while (used.has(slot)) slot++;
    if (slot >= roomSpots(kind, w).length) continue;
    slots[kind].set(id, slot);
    return { kind, slot };
  }
  return null;
}

/**
 * Lounge bench for the new hires who wait (lounge-local metres). It stands along the east wall at the back, the two cats stand
 * on it one behind the other: their sprites (1.3 wide, 1.4 tall) reach up into the lounge, never into a wall or the door plaque.
 */
export const NEWHIRE_MIN_W = 9;
export const NEWHIRE_BENCH = { x: 3.45, z: -2.35, w: 0.55, d: 2.8 };
export const NEWHIRES = [
  { x: 3.4, z: -3.1 },
  { x: 3.4, z: -1.6 },
];

export const MEETING_CHAIRS = 6;

export interface RoomSpot {
  x: number;
  z: number;
  look: number;
  sit: boolean;
  work: 0 | 1 | 2 | 3;
  /** A workstation: the renderer stands a desk and a chair here. */
  desk?: boolean;
}

const MEETING = { cx: 0, cz: -0.3 };
/** The chair ring. With six chairs from 30 degrees, the two chairs on each side are 2 * SEAT.rz apart in z, which must clear a 1.4 tall sprite. */
const SEAT = { rx: 2.05, rz: 1.42 };
/** The way round the outside of the table that the cats walk along. */
const WALK = { rx: 2.8, rz: 2.45 };
function meetingSpot(slot: number): RoomSpot {
  const ang = (slot / MEETING_CHAIRS) * Math.PI * 2 + Math.PI / MEETING_CHAIRS;
  return { x: MEETING.cx + Math.cos(ang) * SEAT.rx, z: MEETING.cz + Math.sin(ang) * SEAT.rz, look: 0, sit: true, work: 0 };
}

/**
 * Every place a cat can take in a room of kind `kind` and width `w`, in the order it is handed out.
 * No two places are closer than 1.0; in the break rooms and the booths two places are 1.9 apart in x or 1.5 apart in z.
 * The meeting room has only its chairs: a cat that finds them all taken goes to a break room (tripKinds).
 */
export function roomSpots(kind: TripKind, w: number): RoomSpot[] {
  if (kind === 'library' || kind === 'server' || kind === 'search') {
    return toolSpots(kind, w).map((s) => ({ x: s.x, z: s.z, look: s.look, sit: !!s.desk, work: s.work, desk: s.desk }));
  }
  if (kind === 'meeting') return Array.from({ length: MEETING_CHAIRS }, (_, i) => meetingSpot(i));
  if (kind === 'booths') return boothSeats(w).map((x) => ({ x, z: BOOTH_SEAT_Z, look: 0, sit: true, work: 0, desk: true }));
  const s = (x: number, z: number, look: number, sit = false): RoomSpot => ({ x, z, look, sit, work: 0 });
  // Two standing places in one room are at least 1.9 apart in x, or at least 1.5 apart in z: a sprite is 1.3 wide and 1.4 tall.
  if (kind === 'games') {
    // Ping pong players first (slots 0 and 1), then the table's front and back, then the corners.
    return [
      s(-2.1, -0.4, 1),
      s(2.1, -0.4, -1),
      s(0, 1.2, 0),
      s(0, -1.9, 0),
      s(-2.1, 1.4, 1),
      s(2.1, 1.4, -1),
      s(-2.1, -2.25, 1),
      s(2.1, -2.25, -1),
    ];
  }
  if (kind === 'kitchen') {
    return [s(-2.5, -0.5, 1), s(1.9, -0.5, -1), s(-0.3, 0.95, 0), s(-0.3, -1.6, 0), s(-w / 2 + 1.35, 1.1, 1), s(w / 2 - 1.35, 1.1, -1)];
  }
  // lounge: sofa, armchairs and a beanbag first (sit), then standing spots
  return [
    s(-0.8, -1.9, 0, true),
    s(1.2, -1.9, 0, true),
    s(-2.3, -0.1, 0, true),
    s(2.7, -0.1, 0, true),
    s(w / 2 - 1.1, 2.2, 0, true),
    s(-3.2, 1.6, 0),
    s(0.2, 0.9, 0),
  ];
}

/** Furniture a standing cat must not be put on (room-local boxes) in the kitchen and the games room. */
export function roomObstacles(kind: TripKind, w: number): Box[] {
  if (kind === 'games') return [{ x: 0, z: -0.4, w: 2.3, d: 1.3 }];
  if (kind !== 'kitchen') return [];
  return [
    { x: 0, z: -OFFICE_D / 2 + 0.55, w: w - 2.5, d: 0.75 },
    { x: w / 2 - 0.9, z: -OFFICE_D / 2 + 0.55, w: 0.85, d: 0.8 },
    { x: -w / 2 + 0.7, z: -OFFICE_D / 2 + 0.55, w: 0.95, d: 0.75 },
    { x: -0.3, z: -0.2, w: 2.4, d: 1.5 },
    { x: -w / 2 + 1.5, z: 2.1, w: 1.1, d: 1.1 },
    { x: w / 2 - 1.5, z: 2.0, w: 1.1, d: 1.1 },
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
    // Walk round the outside of the table from the door side to the angle of the spot.
    const ang = spot.sit
      ? (slot / MEETING_CHAIRS) * Math.PI * 2 + Math.PI / MEETING_CHAIRS
      : Math.atan2((spot.z - MEETING.cz) / WALK.rz, (spot.x - MEETING.cx) / WALK.rx);
    pts = [];
    let a0 = Math.PI / 2;
    let da = ((ang - a0 + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    const steps = Math.max(1, Math.ceil(Math.abs(da) / 0.6));
    da /= steps;
    for (let i = 1; i <= steps; i++) {
      a0 += da;
      pts.push(aw(MEETING.cx + Math.cos(a0) * WALK.rx, MEETING.cz + Math.sin(a0) * WALK.rz));
    }
    pts.push(aw(spot.x, spot.z));
  } else if (kind === 'booths') {
    // Along the front of the row, then straight down the booth to the chair.
    pts = [aw(spot.x, front), aw(spot.x, spot.z)];
  } else if (kind === 'games' || kind === 'kitchen') {
    // In down the middle, along the aisle in front of the island (or the table), and round its end to the spots behind it.
    const aisle = kind === 'kitchen' ? 1.0 : 1.2;
    const behind = kind === 'kitchen' ? spot.z < -1.0 : spot.z < -1.1;
    const x = !behind ? spot.x : kind === 'kitchen' ? -1.9 : (Math.sign(spot.x) || 1) * 1.7;
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
