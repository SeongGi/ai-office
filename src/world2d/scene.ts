// The static part of the picture: floors, walls, furniture, signs. Drawn into a cache and redrawn
// only when the layout or the theme changes.
import type { Team } from '../../shared/protocol';
import { CORRIDOR, ELEVATOR, LOBBY_WIDTH, OFFICE_D, type AmenityKind, type BuildingLayout, type RoomLayout } from '../world/layout';
import { lighten, mix } from './color';
import { circle, item, rbox, setStyle, shape, text, textWidth } from './draw';
import * as F from './furniture';
import { receptionSpot } from './npcs';
import { PALETTES2D, type Palette2D, type ThemeName } from './palette2d';

type Ctx = CanvasRenderingContext2D;

export interface SceneData {
  plan: BuildingLayout;
  teams: Record<string, Team>;
  theme: ThemeName;
}

export interface Rect4 {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

/** Elevator facade geometry (world). Doors close the interior; cats spawn inside it. */
export const ELEV = {
  x: ELEVATOR.x,
  plane: ELEVATOR.z + 0.3, // where the door panels stand
  top: ELEVATOR.z - 1.8,
  halfW: 1.0,
};

export function sceneBounds(plan: BuildingLayout): Rect4 {
  return { x0: plan.x0 - 1.5, z0: ELEV.top - 1.6, x1: plan.x1 + 1.5, z1: plan.z1 + 1.6 };
}

export function sceneKey(d: SceneData) {
  const rooms = [...d.plan.rooms.values()]
    .map((r) => `${r.team.id}:${d.teams[r.team.id]?.name ?? r.team.name}:${d.teams[r.team.id]?.hue ?? r.team.hue}:${r.x.toFixed(2)}:${r.w.toFixed(2)}:${r.podLeft.toFixed(2)}:${r.hasLead ? 1 : 0}:${r.doorX.toFixed(2)}`)
    .join('|');
  const am = d.plan.amenities.map((a) => `${a.kind}:${a.rect.x.toFixed(2)}:${a.rect.w.toFixed(2)}`).join('|');
  return `${d.theme}|${d.plan.x1.toFixed(2)}|${rooms}|${am}`;
}

const AMENITY_NAME: Record<AmenityKind, string> = { kitchen: '주방', meeting: '회의실', lounge: '라운지', games: '게임존', booths: '1인 부스', interview: '면접실', library: '자료실', server: '서버실', search: '정보검색실' };
const AMENITY_TINT: Record<AmenityKind, string> = { kitchen: '#e4f4e8', meeting: '#ebe4f8', lounge: '#fbe8e2', games: '#e1f1f8', booths: '#eceff7', interview: '#f6ecd9', library: '#f1ead8', server: '#e3e8f3', search: '#e2f0f6' };

const yawOf = (side: 'north' | 'south') => (side === 'north' ? 0 : Math.PI);
const roomDoorX = (r: RoomLayout) => r.x + (r.side === 'north' ? r.doorX : -r.doorX);

interface Unit {
  side: 'north' | 'south';
  x0: number;
  w: number;
  door: number | null; // world x of the door gap, null = open front
  open: boolean;
  label: string;
  accent: string | null;
}

function unitsOf(d: SceneData, P: Palette2D): Unit[] {
  const out: Unit[] = [];
  for (const r of d.plan.rooms.values()) {
    const team = d.teams[r.team.id] ?? r.team;
    out.push({ side: r.side, x0: r.x - r.w / 2, w: r.w, door: roomDoorX(r), open: false, label: team.name, accent: P.accent(team.hue) });
  }
  for (const a of d.plan.amenities) {
    const open = a.kind === 'kitchen' || a.kind === 'lounge' || a.kind === 'games';
    out.push({ side: a.side, x0: a.rect.x - a.rect.w / 2, w: a.rect.w, door: open ? null : a.rect.x, open, label: AMENITY_NAME[a.kind], accent: null });
  }
  return out;
}

const hit = (cull: Rect4 | null, x0: number, z0: number, x1: number, z1: number, pad = 3) =>
  !cull || (x1 + pad > cull.x0 && x0 - pad < cull.x1 && z1 + pad > cull.z0 && z0 - pad < cull.z1);

export function drawScene(ctx: Ctx, d: SceneData, cull: Rect4 | null) {
  const P = PALETTES2D[d.theme];
  setStyle(P);
  F.setFurniturePalette(P);
  const plan = d.plan;
  const view = cull ?? sceneBounds(plan);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // --- background
  ctx.fillStyle = P.bg;
  ctx.fillRect(view.x0 - 2, view.z0 - 2, view.x1 - view.x0 + 4, view.z1 - view.z0 + 4);

  const bx0 = plan.x0;
  const bx1 = plan.x1;
  const bz0 = plan.z0;
  const bz1 = plan.z1;
  const body = () => {
    ctx.beginPath();
    ctx.roundRect(bx0, bz0, bx1 - bx0, bz1 - bz0, 0.9);
  };

  // --- floors (clipped to the rounded building outline)
  shape(ctx, P.corridor, body, { shadow: 1.6, noLine: true });
  ctx.save();
  body();
  ctx.clip();
  const tile = (x0: number, z0: number, x1: number, z1: number, step: number) => {
    ctx.strokeStyle = P.gridLine;
    ctx.lineWidth = 0.025;
    ctx.beginPath();
    for (let x = Math.ceil(x0 / step) * step; x < x1; x += step) {
      ctx.moveTo(x, z0);
      ctx.lineTo(x, z1);
    }
    for (let z = Math.ceil(z0 / step) * step; z < z1; z += step) {
      ctx.moveTo(x0, z);
      ctx.lineTo(x1, z);
    }
    ctx.stroke();
  };
  tile(plan.corridor.x - plan.corridor.w / 2, -CORRIDOR / 2, plan.corridor.x + plan.corridor.w / 2, CORRIDOR / 2, 1.7);
  ctx.fillStyle = P.lobby;
  ctx.fillRect(bx0, bz0, LOBBY_WIDTH, bz1 - bz0);
  tile(bx0, bz0, bx0 + LOBBY_WIDTH, bz1, 1.7);
  for (const r of plan.rooms.values()) {
    if (!hit(cull, r.x - r.w / 2, r.z - r.d / 2, r.x + r.w / 2, r.z + r.d / 2)) continue;
    const team = d.teams[r.team.id] ?? r.team;
    ctx.fillStyle = P.roomFloor(team.hue);
    ctx.fillRect(r.x - r.w / 2, r.z - r.d / 2, r.w, r.d);
    tile(r.x - r.w / 2, r.z - r.d / 2, r.x + r.w / 2, r.z + r.d / 2, 1.0);
  }
  for (const a of plan.amenities) {
    const q = a.rect;
    if (!hit(cull, q.x - q.w / 2, q.z - q.d / 2, q.x + q.w / 2, q.z + q.d / 2)) continue;
    ctx.fillStyle = P.dark ? mix(P.lobby, AMENITY_TINT[a.kind], 0.12) : AMENITY_TINT[a.kind];
    ctx.fillRect(q.x - q.w / 2, q.z - q.d / 2, q.w, q.d);
    tile(q.x - q.w / 2, q.z - q.d / 2, q.x + q.w / 2, q.z + q.d / 2, 1.0);
  }
  ctx.restore();

  // --- furniture
  drawLobby(ctx, P, plan);
  for (const r of plan.rooms.values()) {
    if (!hit(cull, r.x - r.w / 2, r.z - r.d / 2, r.x + r.w / 2, r.z + r.d / 2)) continue;
    drawOffice(ctx, P, r, P.accent((d.teams[r.team.id] ?? r.team).hue), (d.teams[r.team.id] ?? r.team).hue);
  }
  for (const a of plan.amenities) {
    const q = a.rect;
    if (!hit(cull, q.x - q.w / 2, q.z - q.d / 2, q.x + q.w / 2, q.z + q.d / 2)) continue;
    item(ctx, q.x, q.z, -yawOf(a.side), () => drawAmenity(ctx, P, a.kind, q.w));
  }

  // --- walls
  drawWalls(ctx, P, plan, unitsOf(d, P), body);

  // --- elevator facade, then plaques
  drawElevatorFrame(ctx, P);
  for (const u of unitsOf(d, P)) {
    if (!hit(cull, u.x0, plan.z0, u.x0 + u.w, plan.z1)) continue;
    drawPlaque(ctx, P, u);
  }

  // --- night: warm pools of light
  if (P.dark) {
    ctx.save();
    body();
    ctx.clip();
    ctx.globalCompositeOperation = 'lighter';
    const glow = (x: number, z: number, r: number, a: number) => {
      const g = ctx.createRadialGradient(x, z, 0, x, z, r);
      g.addColorStop(0, `rgba(255,190,120,${a})`);
      g.addColorStop(1, 'rgba(255,190,120,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - r, z - r, r * 2, r * 2);
    };
    for (const r of plan.rooms.values()) glow(r.x, r.z, Math.max(r.w, r.d) * 0.62, 0.11);
    for (const a of plan.amenities) glow(a.rect.x, a.rect.z, Math.max(a.rect.w, OFFICE_D) * 0.6, 0.09);
    glow(plan.lobby.x, 0, 8, 0.12);
    for (let x = plan.corridor.x - plan.corridor.w / 2 + 3; x < plan.corridor.x + plan.corridor.w / 2; x += 7) glow(x, 0, 3.4, 0.1);
    ctx.restore();
  }
}

// ---------------------------------------------------------------- walls and signs

function drawWalls(ctx: Ctx, P: Palette2D, plan: BuildingLayout, units: Unit[], body: () => void) {
  const zN = -CORRIDOR / 2;
  const zS = CORRIDOR / 2;
  const segs: [number, number, number, number][] = [];
  const GAP = 0.62;
  for (const u of units) {
    const outerZ = u.side === 'north' ? plan.z0 : plan.z1;
    const wallZ = u.side === 'north' ? zN : zS;
    segs.push([u.x0, outerZ, u.x0, wallZ], [u.x0 + u.w, outerZ, u.x0 + u.w, wallZ]);
    if (u.open) {
      segs.push([u.x0, wallZ, u.x0 + 0.9, wallZ], [u.x0 + u.w - 0.9, wallZ, u.x0 + u.w, wallZ]);
    } else if (u.door !== null) {
      segs.push([u.x0, wallZ, u.door - GAP, wallZ], [u.door + GAP, wallZ, u.x0 + u.w, wallZ]);
    }
  }
  const trace = () => {
    ctx.beginPath();
    for (const [x1, z1, x2, z2] of segs) {
      ctx.moveTo(x1, z1);
      ctx.lineTo(x2, z2);
    }
    ctx.roundRect(plan.x0, plan.z0, plan.x1 - plan.x0, plan.z1 - plan.z0, 0.9);
  };
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.translate(0.08, 0.15);
  trace();
  ctx.strokeStyle = P.shadow;
  ctx.lineWidth = 0.36;
  ctx.stroke();
  ctx.restore();
  trace();
  ctx.strokeStyle = P.outline;
  ctx.lineWidth = 0.36;
  ctx.stroke();
  trace();
  ctx.strokeStyle = P.wall;
  ctx.lineWidth = 0.22;
  ctx.stroke();
  void body;
}

/** Split a label into two lines at the separator that makes them most even (or at the middle letter). */
function splitLabel(label: string): [string, string] {
  const mid = label.length / 2;
  let at = -1;
  for (let i = 1; i < label.length - 1; i++) {
    if (!/[\s_\-./]/.test(label[i])) continue;
    const worst = (j: number) => Math.max(j + 1, label.length - j - 1);
    if (at < 0 || worst(i) < worst(at)) at = i;
  }
  if (at < 0) return [label.slice(0, Math.ceil(mid)), label.slice(Math.ceil(mid))];
  const sep = /\s/.test(label[at]);
  return [label.slice(0, sep ? at : at + 1).trim(), label.slice(at + 1).trim()];
}

function drawPlaque(ctx: Ctx, P: Palette2D, u: Unit) {
  const wallZ = u.side === 'north' ? -CORRIDOR / 2 : CORRIDOR / 2;
  const extra = u.accent ? 0.95 : 0.7;
  // Widest sign that still clears the door gap on one side of the door.
  const GAP = 0.62 + 0.25;
  const maxW =
    u.door === null
      ? u.w - 0.4
      : Math.max(u.door - GAP - (u.x0 + 0.2), u.x0 + u.w - 0.2 - (u.door + GAP));
  // The full name always shows: one line, else two lines, else a smaller font.
  let size = 0.32;
  let lines = [u.label];
  let w = textWidth(ctx, u.label, size) + extra;
  if (w > maxW && u.label.length > 6) {
    lines = splitLabel(u.label);
    const widest = (sz: number) => Math.max(...lines.map((l) => textWidth(ctx, l, sz)));
    w = widest(size) + extra;
    if (w > maxW) {
      size = Math.max(0.2, (size * (maxW - extra)) / (w - extra));
      w = widest(size) + extra;
    }
  }
  w = Math.max(1.5, w);
  let x = u.x0 + u.w / 2;
  if (u.door !== null) {
    const away = Math.sign(x - u.door) || 1;
    const need = 0.62 + 0.25 + w / 2;
    if (Math.abs(x - u.door) < need) x = u.door + away * need;
    x = Math.max(u.x0 + w / 2 + 0.2, Math.min(u.x0 + u.w - w / 2 - 0.2, x));
  }
  const h = lines.length > 1 ? 0.82 : 0.52;
  rbox(ctx, x, wallZ, w, h, P.plaque, lines.length > 1 ? 0.3 : 0.26, { lw: 0.05, line: u.accent ?? P.outline });
  const tx = u.accent ? x + 0.15 : x;
  if (u.accent) circle(ctx, x - w / 2 + 0.3, wallZ, 0.11, u.accent, { shadow: false, noLine: true });
  if (lines.length > 1) {
    text(ctx, lines[0], tx, wallZ - size * 0.58, size, P.plaqueText);
    text(ctx, lines[1], tx, wallZ + size * 0.58, size, P.plaqueText);
  } else text(ctx, lines[0], tx, wallZ + 0.01, size, P.plaqueText);
}

function drawElevatorFrame(ctx: Ctx, P: Palette2D) {
  const x = ELEV.x;
  const zc = (ELEV.top + ELEV.plane) / 2;
  const h = ELEV.plane - ELEV.top;
  rbox(ctx, x, zc, ELEV.halfW * 2 + 0.3, h + 0.25, P.dark ? '#5b6890' : '#d5dbe6', 0.3, { lw: 0.07 });
  rbox(ctx, x, zc, ELEV.halfW * 2, h, P.dark ? '#ffd88a' : '#fff1c9', 0.16, { lw: 0.04, shadow: false });
  rbox(ctx, x, ELEV.top + 0.35, ELEV.halfW * 2 - 0.5, 0.1, lighten(P.dark ? '#ffd88a' : '#fff1c9', 0.4), 0.05, { shadow: false, noLine: true });
  rbox(ctx, x, ELEV.top - 0.5, 2.1, 0.5, '#3a3f55', 0.25, { lw: 0.05 });
  text(ctx, '엘리베이터', x, ELEV.top - 0.49, 0.3, '#ffd37a');
  rbox(ctx, x + 1.5, ELEV.plane - 0.55, 0.3, 0.55, P.dark ? '#8392b8' : '#c9d3df', 0.12, { lw: 0.04 });
}

// ---------------------------------------------------------------- rooms

function drawLobby(ctx: Ctx, P: Palette2D, plan: BuildingLayout) {
  const x0 = plan.x0;
  const lx = x0 + LOBBY_WIDTH / 2;
  const z0 = plan.z0;
  const z1 = plan.z1;
  F.rug(ctx, lx + 0.4, z1 - 3.8, 5.0, 3.2, P.dark ? '#4a4378' : '#ffd9c7');
  F.logoBoard(ctx, x0 + 4.3, z0 + 0.95, 5.6, '#ff8a5c');
  const rc = receptionSpot(x0, z0);
  F.reception(ctx, rc.x, rc.z, rc.w);
  F.sofa(ctx, lx + 0.4, z1 - 2.1, 0, 2.7, P.sofa[0]);
  F.armchair(ctx, lx - 2.0, z1 - 3.8, Math.PI / 2, P.sofa[2]);
  F.armchair(ctx, lx + 2.8, z1 - 3.8, -Math.PI / 2, P.sofa[1]);
  F.coffeeTable(ctx, lx + 0.4, z1 - 3.8, 1.3, 0.7);
  F.plant(ctx, x0 + 0.9, z0 + 0.9, 1.1);
  F.plant(ctx, x0 + 0.9, z1 - 0.9, 1.1);
  F.plant(ctx, lx + 4.0, z1 - 0.9, 1.0);
  F.cooler(ctx, x0 + 0.7, -2.6);
  F.bookshelf(ctx, lx + 4.4, z1 - 4.8, Math.PI / 2, 1.6);
  F.lamp(ctx, lx - 2.1, z1 - 2.0);
}

function drawOffice(ctx: Ctx, P: Palette2D, r: RoomLayout, accent: string, hue: number) {
  item(ctx, r.x, r.z, -r.yaw, () => {
    const { w, d } = r;
    const back = -d / 2;
    const front = d / 2;
    const podW = r.podRight - r.podLeft;
    const podC = (r.podLeft + r.podRight) / 2;
    const leftEdge = -w / 2;
    const rightEdge = w / 2;
    const lane = r.podRight + 0.85;
    const rugW = podW + (r.hasLead ? 3.2 : 1.4);
    F.rug(ctx, r.hasLead ? podC - 1.0 : podC, -0.1, rugW, 4.4, P.rug(hue));
    F.credenza(ctx, podC, back + 0.42, Math.min(2.4, Math.max(1.4, podW - 0.4)));
    F.whiteboard(ctx, leftEdge + 1.25, back + 0.55, 0, accent);
    const leadLane = r.hasLead ? r.podLeft - 2.05 : r.podLeft - 0.6;
    if (leadLane - leftEdge > 1.2) {
      F.bookshelf(ctx, leftEdge + 0.3, -0.9, Math.PI / 2, 1.5);
      if (leadLane - leftEdge > 2.0) {
        F.armchair(ctx, leftEdge + 1.1, front - 1.5, Math.PI * 0.75, P.chairs[Math.floor(hue) % P.chairs.length]);
        F.lamp(ctx, leftEdge + 0.4, front - 2.5);
      } else F.plant(ctx, leftEdge + 0.5, front - 1.0, 1.0);
    }
    F.plant(ctx, leftEdge + 0.45, front - 0.55, 1.0);
    if (rightEdge - lane > 0.9) {
      F.plant(ctx, rightEdge - 0.5, back + 0.6, 1.1);
      F.cooler(ctx, rightEdge - 0.4, -0.6);
      F.plant(ctx, rightEdge - 0.5, front - 0.6, 1.1);
      if (rightEdge - lane > 1.6) F.beanbag(ctx, rightEdge - 1.0, front - 1.7, P.sofa[Math.floor(hue) % P.sofa.length]);
    } else F.plant(ctx, rightEdge - 0.45, back + 0.55, 1.0);
    F.bin(ctx, r.podRight + 0.35, 1.9);
    F.bin(ctx, r.podLeft - 0.35, -1.9);
  });
}

function drawAmenity(ctx: Ctx, P: Palette2D, kind: AmenityKind, w: number) {
  const d = OFFICE_D;
  const back = -d / 2;
  switch (kind) {
    case 'kitchen':
      F.kitchenRun(ctx, 0, back + 0.55, Math.min(w - 2.4, 5.0));
      F.fridge(ctx, w / 2 - 0.9, back + 0.55);
      F.island(ctx, -0.3, -0.5, 2.4);
      F.roundTable(ctx, -w / 2 + 1.5, 2.1, 0.55, 3);
      F.roundTable(ctx, w / 2 - 1.5, 2.0, 0.55, 3);
      F.vending(ctx, -w / 2 + 0.7, back + 0.55);
      F.plant(ctx, -w / 2 + 0.6, 0.4, 1.0);
      break;
    case 'interview':
      if (w >= F.INTERVIEW_MIN_W) F.interviewRoom(ctx, w);
      break;
    case 'library':
      F.libraryRoom(ctx, w);
      break;
    case 'server':
      F.serverRoom(ctx, w);
      break;
    case 'search':
      F.searchRoom(ctx, w);
      break;
    case 'meeting':
      F.screenWall(ctx, 0, back + 0.4);
      F.meetingTable(ctx, 0, -0.3, 1.5, 0.8, 8);
      F.plant(ctx, w / 2 - 0.6, back + 0.6, 1.1);
      F.plant(ctx, -w / 2 + 0.6, d / 2 - 0.7, 1.1);
      break;
    case 'lounge':
      F.rug(ctx, 0.2, -0.4, 4.8, 3.4, P.dark ? '#4f4486' : '#ffd4cc', true);
      F.sofa(ctx, 0.2, -2.1, 0, 2.8, P.sofa[0]);
      F.armchair(ctx, -2.3, -0.2, Math.PI / 2, P.sofa[2]);
      F.armchair(ctx, 2.7, -0.2, -Math.PI / 2, P.sofa[1]);
      F.coffeeTable(ctx, 0.2, -0.4, 1.4, 0.7);
      F.tv(ctx, 0.2, 1.7);
      F.beanbag(ctx, w / 2 - 1.0, 2.2, P.sofa[3]);
      F.beanbag(ctx, w / 2 - 2.0, 2.7, P.sofa[2]);
      F.bookshelf(ctx, -w / 2 + 0.3, -1.0, Math.PI / 2, 1.8);
      if (w >= F.NEWHIRE_MIN_W) F.newHireBench(ctx);
      F.plant(ctx, w / 2 - 0.6, back + 0.6, 1.1);
      F.plant(ctx, -w / 2 + 0.6, back + 0.6, 1.1);
      break;
    case 'games':
      if (w > 5.2) F.pingPong(ctx, 0, -0.4);
      F.beanbag(ctx, -w / 2 + 1.0, d / 2 - 1.4, P.sofa[2]);
      F.beanbag(ctx, -w / 2 + 2.0, d / 2 - 1.1, P.sofa[3]);
      F.vending(ctx, w / 2 - 0.7, back + 0.6, '#8ec9ff');
      F.plant(ctx, -w / 2 + 0.6, back + 0.6, 1.1);
      break;
    case 'booths': {
      const n = Math.max(1, Math.floor((w - 0.4) / 1.6));
      for (let i = 0; i < n; i++) {
        const bx = -w / 2 + 1.0 + i * 1.6;
        if (bx > w / 2 - 0.6) break;
        F.booth(ctx, bx, back + 1.0, P.chairs[i % P.chairs.length]);
      }
      if (w > 2.5) F.plant(ctx, w / 2 - 0.55, d / 2 - 0.8, 1.0);
      break;
    }
  }
}
