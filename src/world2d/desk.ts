// A desk with a glowing monitor, and the chair. Both are drawn per agent every frame.
import type { Status } from '../../shared/protocol';
import { darken, lighten, mix, rgba } from './color';
import { circle, ellipse, item, rbox, shape } from './draw';
import { PALETTES2D, STATUS_COLORS, hash, type ThemeName } from './palette2d';

type Ctx = CanvasRenderingContext2D;

export const DESK_W = 1.48;
export const DESK_D = 0.7;
export const DESK_OFFSET = 0.8;

export interface DeskView {
  id: string;
  seatX: number;
  seatZ: number;
  /** Unit vector the seated cat faces (world). */
  fx: number;
  fz: number;
  status: Status;
}

const MUGS = ['#ff9eb5', '#8ec9ff', '#ffd27a', '#a6e3b5', '#c3a6ff'];

export const deskCenter = (d: DeskView): [number, number] => [d.seatX + d.fx * DESK_OFFSET, d.seatZ + d.fz * DESK_OFFSET];

export function drawChair(ctx: Ctx, d: DeskView, theme: ThemeName) {
  const P = PALETTES2D[theme];
  const col = P.chairs[hash(d.id) % P.chairs.length];
  const ang = Math.atan2(-d.fx, d.fz);
  item(ctx, d.seatX, d.seatZ, ang, () => {
    ellipse(ctx, 0, -0.26, 0.36, 0.13, darken(col, 0.1));
    circle(ctx, 0, 0, 0.36, col);
    circle(ctx, 0, 0, 0.2, lighten(col, 0.3), { shadow: false, noLine: true });
  });
}

function screenColors(status: Status, dark: boolean) {
  const base = STATUS_COLORS[status];
  if (status === 'offline') return { fill: '#2b3042', line: '#555d78', glow: 0 };
  if (status === 'idle') return { fill: mix(base, dark ? '#202640' : '#ffffff', 0.45), line: lighten(base, 0.5), glow: 0.12 };
  return { fill: lighten(base, 0.05), line: '#ffffff', glow: 0.5 };
}

export function drawDesk(ctx: Ctx, d: DeskView, t: number, theme: ThemeName) {
  const P = PALETTES2D[theme];
  const dark = theme === 'dark';
  const [cx, cz] = deskCenter(d);
  const ang = Math.atan2(-d.fx, d.fz);
  const h = hash(d.id);
  const sc = screenColors(d.status, dark);
  item(ctx, cx, cz, ang, () => {
    rbox(ctx, 0, 0, DESK_W, DESK_D, P.wood, 0.17, { lw: 0.055 });
    rbox(ctx, 0, 0, DESK_W - 0.14, DESK_D - 0.14, lighten(P.wood, 0.28), 0.12, { shadow: false, lw: 0.02 });
    // keyboard and mouse near the cat
    rbox(ctx, -0.04, -0.2, 0.46, 0.14, '#fbfbff', 0.05, { lw: 0.03, shadow: false });
    circle(ctx, 0.3, -0.2, 0.055, '#fbfbff', { lw: 0.03, shadow: false });
    // mug
    circle(ctx, -0.6, -0.1, 0.07, MUGS[h % MUGS.length], { lw: 0.035 });
  });

  // The monitor stands upright and faces the viewer, so its colour always reads, whichever way the cat faces.
  const mx = cx + d.fx * 0.1;
  const mz = cz + d.fz * 0.1;
  const pc = mz - 0.23;
  if (sc.glow > 0) {
    const r = dark ? 1.25 : 0.95;
    const g = ctx.createRadialGradient(mx, pc, 0, mx, pc, r);
    g.addColorStop(0, rgba(sc.fill, (dark ? 0.5 : 0.3) * Math.min(1, sc.glow * 2)));
    g.addColorStop(1, rgba(sc.fill, 0));
    ctx.fillStyle = g;
    ctx.fillRect(mx - r, pc - r, r * 2, r * 2);
  }
  rbox(ctx, mx, mz - 0.04, 0.2, 0.1, '#4a5068', 0.04, { lw: 0.03 });
  rbox(ctx, mx, pc, 0.84, 0.46, '#3a3f55', 0.12, { lw: 0.045 });
  shape(ctx, sc.fill, () => {
    ctx.beginPath();
    ctx.roundRect(mx - 0.35, pc - 0.18, 0.7, 0.36, 0.06);
  }, { shadow: false, noLine: true });
  ctx.lineCap = 'round';
  ctx.strokeStyle = sc.line;
  ctx.lineWidth = 0.04;
  ctx.beginPath();
  if (d.status === 'working') {
    const o = (t * 0.6) % 1;
    for (let i = 0; i < 4; i++) {
      const y = pc - 0.14 + i * 0.095;
      const len = 0.2 + 0.28 * Math.abs(Math.sin((o + i * 0.27) * Math.PI * 2));
      ctx.moveTo(mx - 0.3, y);
      ctx.lineTo(mx - 0.3 + len, y);
    }
  } else if (d.status === 'thinking') {
    ctx.lineWidth = 0.09 + Math.max(0, Math.sin(t * 5)) * 0.03;
    for (let i = 0; i < 3; i++) {
      ctx.moveTo(mx - 0.18 + i * 0.18, pc);
      ctx.lineTo(mx - 0.18 + i * 0.18 + 0.001, pc);
    }
  } else if (d.status === 'waiting') {
    ctx.lineWidth = 0.07;
    ctx.moveTo(mx, pc - 0.14);
    ctx.lineTo(mx, pc + 0.03);
    ctx.moveTo(mx, pc + 0.12);
    ctx.lineTo(mx + 0.001, pc + 0.12);
  } else if (d.status === 'done') {
    ctx.lineWidth = 0.07;
    ctx.moveTo(mx - 0.14, pc);
    ctx.lineTo(mx - 0.04, pc + 0.1);
    ctx.lineTo(mx + 0.16, pc - 0.1);
  } else if (d.status === 'error') {
    ctx.lineWidth = 0.07;
    ctx.moveTo(mx - 0.1, pc - 0.1);
    ctx.lineTo(mx + 0.1, pc + 0.1);
    ctx.moveTo(mx + 0.1, pc - 0.1);
    ctx.lineTo(mx - 0.1, pc + 0.1);
  } else if (d.status === 'idle') {
    ctx.moveTo(mx - 0.3, pc - 0.08);
    ctx.lineTo(mx + 0.1, pc - 0.08);
    ctx.moveTo(mx - 0.3, pc + 0.04);
    ctx.lineTo(mx + 0.25, pc + 0.04);
  }
  ctx.stroke();
}
