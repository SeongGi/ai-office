// Static furniture, drawn in a local frame (metres). Top-down shapes with soft outlines.
import { darken, lighten, mix } from './color';
import { circle, ellipse, item, rbox, shape, style, text } from './draw';
import { OFFICE_D } from '../world/layout';
import { PALETTES2D, type Palette2D } from './palette2d';

type Ctx = CanvasRenderingContext2D;
let P: Palette2D = PALETTES2D.light;
export function setFurniturePalette(p: Palette2D) {
  P = p;
}

export function plant(ctx: Ctx, x: number, y: number, s = 1) {
  circle(ctx, x - 0.15 * s, y - 0.05 * s, 0.2 * s, P.leaf);
  circle(ctx, x + 0.15 * s, y - 0.04 * s, 0.2 * s, mix(P.leaf, P.leafLight, 0.4));
  ellipse(ctx, x, y + 0.14 * s, 0.17 * s, 0.13 * s, P.pot);
  circle(ctx, x, y - 0.17 * s, 0.22 * s, P.leafLight);
}

export function bin(ctx: Ctx, x: number, y: number) {
  circle(ctx, x, y, 0.15, P.dark ? '#6c7aa3' : '#cdd7e4');
  circle(ctx, x, y, 0.09, P.dark ? '#3a4472' : '#aeb9c9', { shadow: false });
}

export function rug(ctx: Ctx, x: number, y: number, w: number, h: number, color: string, round = false) {
  const build = () => {
    ctx.beginPath();
    if (round) ctx.ellipse(x, y, w / 2, h / 2, 0, 0, Math.PI * 2);
    else ctx.roundRect(x - w / 2, y - h / 2, w, h, 0.45);
  };
  shape(ctx, color, build, { shadow: false, lw: 0.04, line: mix(color, P.outline, 0.25) });
  ctx.save();
  ctx.setLineDash([0.22, 0.16]);
  ctx.lineWidth = 0.035;
  ctx.strokeStyle = lighten(color, 0.5);
  ctx.beginPath();
  if (round) ctx.ellipse(x, y, w / 2 - 0.2, h / 2 - 0.2, 0, 0, Math.PI * 2);
  else ctx.roundRect(x - w / 2 + 0.2, y - h / 2 + 0.2, w - 0.4, h - 0.4, 0.3);
  ctx.stroke();
  ctx.restore();
}

export function bookshelf(ctx: Ctx, x: number, y: number, rot: number, w: number, d = 0.45) {
  item(ctx, x, y, rot, () => {
    rbox(ctx, 0, 0, w, d, P.wood, 0.1);
    const cols = ['#ff9eb5', '#8ec9ff', '#ffd27a', '#a6e3b5', '#c3a6ff', '#ffb38a'];
    const n = Math.max(3, Math.round(w / 0.17));
    for (let r = 0; r < 2; r++) {
      const yy = (r - 0.5) * (d * 0.45);
      for (let i = 0; i < n; i++) {
        const bw = (w - 0.2) / n;
        const bx = -w / 2 + 0.1 + bw * (i + 0.5);
        rbox(ctx, bx, yy, bw * 0.78, d * 0.3, cols[(i * 2 + r * 3 + Math.abs(Math.floor(x * 7))) % cols.length], 0.03, { shadow: false, lw: 0.018 });
      }
    }
  });
}

export function credenza(ctx: Ctx, x: number, y: number, w: number) {
  rbox(ctx, x, y, w, 0.55, P.wood, 0.14);
  rbox(ctx, x - w * 0.22, y, w * 0.38, 0.4, lighten(P.wood, 0.25), 0.1, { shadow: false, lw: 0.025 });
  rbox(ctx, x + w * 0.22, y, w * 0.38, 0.4, lighten(P.wood, 0.25), 0.1, { shadow: false, lw: 0.025 });
  rbox(ctx, x + w * 0.2, y - 0.06, 0.5, 0.3, '#fbfbfd', 0.08, { lw: 0.03 });
  rbox(ctx, x + w * 0.2, y - 0.02, 0.3, 0.1, '#c9d3df', 0.04, { shadow: false, lw: 0.02 });
}

export function whiteboard(ctx: Ctx, x: number, y: number, rot: number, accent: string) {
  item(ctx, x, y, rot, () => {
    rbox(ctx, 0, 0, 1.6, 0.18, P.metal, 0.08);
    rbox(ctx, 0, -0.05, 1.5, 0.12, '#ffffff', 0.05, { shadow: false, lw: 0.02 });
    ctx.lineCap = 'round';
    ctx.lineWidth = 0.03;
    ctx.strokeStyle = accent;
    ctx.beginPath();
    ctx.moveTo(-0.6, -0.06);
    ctx.lineTo(0.0, -0.06);
    ctx.moveTo(0.2, -0.04);
    ctx.lineTo(0.55, -0.06);
    ctx.stroke();
  });
}

export function armchair(ctx: Ctx, x: number, y: number, rot: number, color: string) {
  item(ctx, x, y, rot, () => {
    rbox(ctx, 0, -0.18, 0.95, 0.42, darken(color, 0.12), 0.2);
    rbox(ctx, 0, 0.06, 0.95, 0.75, color, 0.28);
    rbox(ctx, 0, 0.12, 0.55, 0.5, lighten(color, 0.3), 0.2, { shadow: false, lw: 0.025 });
  });
}

export function sofa(ctx: Ctx, x: number, y: number, rot: number, w: number, color: string) {
  item(ctx, x, y, rot, () => {
    rbox(ctx, 0, -0.32, w, 0.5, darken(color, 0.12), 0.24);
    rbox(ctx, 0, 0.0, w, 0.9, color, 0.3);
    for (const s of [-1, 1]) rbox(ctx, (s * (w - 0.34)) / 2, 0.02, 0.34, 0.9, darken(color, 0.06), 0.16, { shadow: false, lw: 0.03 });
    const n = Math.max(2, Math.round((w - 0.7) / 0.85));
    const cw = (w - 0.7) / n;
    for (let i = 0; i < n; i++) rbox(ctx, -w / 2 + 0.35 + cw * (i + 0.5), 0.1, cw - 0.06, 0.58, lighten(color, 0.28), 0.2, { shadow: false, lw: 0.025 });
  });
}

export function coffeeTable(ctx: Ctx, x: number, y: number, w = 1.3, h = 0.7) {
  rbox(ctx, x, y, w, h, P.woodLight, Math.min(w, h) / 2);
}

export function roundTable(ctx: Ctx, x: number, y: number, r: number, stools = 3) {
  for (let i = 0; i < stools; i++) {
    const a = (i / stools) * Math.PI * 2 + 0.6;
    circle(ctx, x + Math.cos(a) * (r + 0.28), y + Math.sin(a) * (r + 0.28), 0.18, P.chairs[i % P.chairs.length]);
  }
  circle(ctx, x, y, r, P.woodLight);
  circle(ctx, x, y, r * 0.55, lighten(P.woodLight, 0.25), { shadow: false, lw: 0.025 });
}

export function beanbag(ctx: Ctx, x: number, y: number, color: string) {
  ellipse(ctx, x, y, 0.46, 0.4, color);
  ellipse(ctx, x - 0.1, y - 0.1, 0.2, 0.14, lighten(color, 0.35), { shadow: false, noLine: true });
}

export function lamp(ctx: Ctx, x: number, y: number) {
  circle(ctx, x, y, 0.2, '#ffe6a8');
  circle(ctx, x, y, 0.1, '#fff6d4', { shadow: false, noLine: true });
}

export function tv(ctx: Ctx, x: number, y: number) {
  rbox(ctx, x, y, 2.0, 0.55, P.woodLight, 0.14);
  rbox(ctx, x, y - 0.12, 1.55, 0.14, '#3a3f55', 0.05, { lw: 0.03 });
  rbox(ctx, x, y - 0.12, 1.4, 0.08, '#8fd3ff', 0.03, { shadow: false, noLine: true });
}

export function kitchenRun(ctx: Ctx, x: number, y: number, w: number) {
  rbox(ctx, x, y, w, 0.75, P.woodLight, 0.12);
  rbox(ctx, x, y + 0.04, w - 0.08, 0.6, lighten(P.woodLight, 0.4), 0.1, { shadow: false, lw: 0.02 });
  ellipse(ctx, x - w * 0.22, y + 0.04, 0.3, 0.2, '#b9dcf2', { shadow: false, lw: 0.03 });
  circle(ctx, x - w * 0.22, y + 0.04, 0.04, '#7fb5d6', { shadow: false, noLine: true });
  for (const dx of [0.1, 0.4]) circle(ctx, x + w * 0.2 + dx, y + 0.04, 0.12, '#4b4f66', { shadow: false, lw: 0.025 });
}

export function island(ctx: Ctx, x: number, y: number, w: number) {
  rbox(ctx, x - w * 0.28, y + 0.85, 0.34, 0.34, P.chairs[0], 0.17);
  rbox(ctx, x + w * 0.28, y + 0.85, 0.34, 0.34, P.chairs[1], 0.17);
  rbox(ctx, x, y, w, 0.95, P.wood, 0.2);
  rbox(ctx, x, y, w - 0.14, 0.8, lighten(P.wood, 0.3), 0.16, { shadow: false, lw: 0.02 });
}

export function fridge(ctx: Ctx, x: number, y: number) {
  rbox(ctx, x, y, 0.85, 0.8, '#cfeefb', 0.18);
  rbox(ctx, x - 0.18, y + 0.1, 0.06, 0.34, '#8db6c9', 0.03, { shadow: false, lw: 0.015 });
}

export function vending(ctx: Ctx, x: number, y: number, color = '#ff9eb5') {
  rbox(ctx, x, y, 0.95, 0.75, color, 0.16);
  rbox(ctx, x - 0.12, y + 0.04, 0.55, 0.5, '#fff7e6', 0.08, { shadow: false, lw: 0.025 });
  for (let i = 0; i < 3; i++) circle(ctx, x - 0.3 + i * 0.18, y + 0.04, 0.05, ['#ffd27a', '#8ec9ff', '#a6e3b5'][i], { shadow: false, lw: 0.015 });
}

export function cooler(ctx: Ctx, x: number, y: number) {
  circle(ctx, x, y, 0.22, '#e8f6ff');
  circle(ctx, x, y, 0.13, '#9fd8ff', { shadow: false, lw: 0.025 });
}

export function pingPong(ctx: Ctx, x: number, y: number) {
  rbox(ctx, x, y, 2.3, 1.3, '#5fb8a8', 0.16, { lw: 0.06 });
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 0.035;
  ctx.strokeRect(x - 1.07, y - 0.57, 2.14, 1.14);
  rbox(ctx, x, y, 0.05, 1.34, '#ffffff', 0.02, { shadow: false, lw: 0.012 });
}

export function booth(ctx: Ctx, x: number, y: number, color: string) {
  rbox(ctx, x, y, 1.3, 1.3, P.dark ? '#4a6da8' : '#cfe8ff', 0.22, { lw: 0.055 });
  rbox(ctx, x, y - 0.35, 1.0, 0.3, P.woodLight, 0.1, { shadow: false, lw: 0.025 });
  circle(ctx, x, y + 0.2, 0.22, color, { shadow: false });
}

/** A round-table meeting set. Chairs sit on an ellipse around the table. */
export function meetingTable(ctx: Ctx, x: number, y: number, rx: number, rz: number, chairs: number) {
  for (let i = 0; i < chairs; i++) {
    const a = (i / chairs) * Math.PI * 2 + Math.PI / chairs;
    const cx = x + Math.cos(a) * (rx + 0.55);
    const cy = y + Math.sin(a) * (rz + 0.55);
    circle(ctx, cx, cy, 0.27, P.chairs[i % P.chairs.length]);
  }
  ellipse(ctx, x, y, rx, rz, P.wood);
  ellipse(ctx, x, y, rx - 0.25, rz - 0.25, lighten(P.wood, 0.3), { shadow: false, lw: 0.025 });
}

export function screenWall(ctx: Ctx, x: number, y: number) {
  rbox(ctx, x, y, 2.4, 0.3, '#3a3f55', 0.1, { lw: 0.045 });
  rbox(ctx, x, y + 0.03, 2.2, 0.14, P.dark ? '#9fe0ff' : '#bfe6ff', 0.06, { shadow: false, noLine: true });
}

export function reception(ctx: Ctx, x: number, y: number, w: number) {
  rbox(ctx, x, y, w, 1.0, P.wood, 0.3);
  rbox(ctx, x, y - 0.05, w - 0.2, 0.7, lighten(P.wood, 0.3), 0.24, { shadow: false, lw: 0.025 });
  circle(ctx, x - w * 0.25, y - 0.08, 0.1, '#ffd27a', { shadow: false, lw: 0.025 });
  rbox(ctx, x + w * 0.2, y - 0.12, 0.5, 0.26, '#3a3f55', 0.06, { shadow: false, lw: 0.025 });
}

/** The interview room (면접실) is built for this width; narrower and the cats are left out. Room-local metres. */
export const INTERVIEW_MIN_W = 4.8;
export const INTERVIEW = {
  table: { x: 0, z: -0.45 },
  boss: { x: -1.6, z: -0.35 },
  candidate: { x: 1.6, z: -0.35 },
};

/** A small table with the interviewer and the candidate on stools either side of it, a board on the wall and a plant. */
export function interviewRoom(ctx: Ctx, w: number) {
  const t = INTERVIEW;
  rug(ctx, 0, -0.4, 4.4, 2.8, P.dark ? '#4f4486' : '#ffe9c9');
  whiteboard(ctx, 0, -OFFICE_D / 2 + 0.55, 0, '#ff8a5c');
  for (const [i, s] of [t.boss, t.candidate].entries()) circle(ctx, s.x, s.z + 0.08, 0.2, P.chairs[(i + 1) % P.chairs.length]);
  rbox(ctx, t.table.x, t.table.z, 1.3, 0.7, P.wood, 0.18);
  rbox(ctx, t.table.x, t.table.z, 1.16, 0.56, lighten(P.wood, 0.3), 0.14, { shadow: false, lw: 0.02 });
  rbox(ctx, t.table.x - 0.25, t.table.z + 0.02, 0.24, 0.32, '#ffffff', 0.03, { shadow: false, lw: 0.02 });
  rbox(ctx, t.table.x + 0.28, t.table.z - 0.02, 0.22, 0.28, '#fff7e0', 0.03, { shadow: false, lw: 0.02 });
  plant(ctx, w / 2 - 0.6, -OFFICE_D / 2 + 0.6, 1.1);
  plant(ctx, -w / 2 + 0.6, OFFICE_D / 2 - 0.7, 1.1);
}

/** Lounge benches for the new hires who wait, lounge-local metres. Needs a lounge at least this wide. */
export const NEWHIRE_MIN_W = 8.0;
export const NEWHIRES = [
  { x: 1.6, z: 2.2 },
  { x: 3.4, z: 2.2 },
];

export function newHireBench(ctx: Ctx) {
  rbox(ctx, 2.5, 2.36, 3.6, 0.5, P.woodLight, 0.2);
  rbox(ctx, 2.5, 2.3, 3.4, 0.36, lighten(P.woodLight, 0.35), 0.16, { shadow: false, lw: 0.02 });
}

export function logoBoard(ctx: Ctx, x: number, y: number, w: number, accent: string) {
  rbox(ctx, x, y, w, 1.05, P.plaque, 0.4, { lw: 0.08, line: accent });
  text(ctx, '성기 주식회사', x + 0.35, y + 0.02, 0.58, P.plaqueText, { weight: 800 });
  // small cat face badge
  circle(ctx, x - w / 2 + 0.7, y + 0.02, 0.33, '#ffd8a8', { lw: 0.045, shadow: false });
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(x - w / 2 + 0.7 + s * 0.12, y - 0.24);
    ctx.lineTo(x - w / 2 + 0.7 + s * 0.3, y - 0.42);
    ctx.lineTo(x - w / 2 + 0.7 + s * 0.3, y - 0.14);
    ctx.closePath();
    ctx.fillStyle = '#ffd8a8';
    ctx.fill();
    ctx.strokeStyle = style.outline;
    ctx.lineWidth = 0.04;
    ctx.stroke();
  }
  for (const s of [-1, 1]) circle(ctx, x - w / 2 + 0.7 + s * 0.12, y, 0.04, '#3a2d3d', { shadow: false, noLine: true });
  circle(ctx, x - w / 2 + 0.7, y + 0.1, 0.03, '#ff8fa3', { shadow: false, noLine: true });
}
