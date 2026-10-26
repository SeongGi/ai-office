// The chibi cat. Drawn in "cat units" (about metres, y up is negative) around the feet.
import type { Status } from '../../shared/protocol';
import { darken, lighten, mix, rgba } from './color';
import { outlineOf, star, style, text } from './draw';
import { STATUS_COLORS } from './palette2d';

type Ctx = CanvasRenderingContext2D;

/** What the cat holds and does while it hangs out. Written by activities.ts, read here. */
export interface CatAct {
  /** 0 nothing, 1 hot mug, 2 can, 3 paddle, 4 toy ball. */
  prop: 0 | 1 | 2 | 3 | 4;
  /** Which hand holds the prop: 1 right, -1 left. */
  side: 1 | -1;
  /** 0..1, the prop is at the mouth. */
  sip: number;
  /** 0..1, the paddle swings. */
  swing: number;
  /** 0..1, both arms up and a yawn. */
  stretch: number;
  /** 0..1, both arms up and wiggling. */
  cheer: number;
  /** Tool room pose: 0 none, 1 reading a book, 2 typing at a console, 3 looking at a screen (a paw on the mouse). */
  work: 0 | 1 | 2 | 3;
}

export interface CatView {
  x: number;
  z: number;
  status: Status;
  /** 0 standing, 1 seated. */
  sit: number;
  moving: boolean;
  walkPhase: number;
  /** -1 left .. 1 right: which way the face leans. */
  look: number;
  /** Hop height in metres. */
  hop: number;
  shake: number;
  hover: number;
  selected: number;
  badge: number;
  /** Seconds of talking left. */
  talk: number;
  fur: string;
  belly: string;
  stripe: string;
  stripes: boolean;
  scarf: string;
  iris: string;
  seed: number;
  alpha: number;
  /** Seated at a desk (paws type) rather than lounging. */
  atDesk: boolean;
  act?: CatAct;
  /** 0..1, a speech bubble is over the head, so the small status badge steps aside. */
  bubble?: number;
}

/** Height of the head top above the feet, in cat units. */
export const HEAD_TOP = 1.28;

/** Where the paddle blade is, from the feet, when it is held out at rest (the ball in a rally meets it). */
export const PADDLE = { x: 0.56, y: -0.62 };

const EYE = '#2d2438';
const PINK = '#ff93a8';

function limb(ctx: Ctx, x1: number, y1: number, x2: number, y2: number, w: number, fill: string, ol: string, lw: number, cx?: number, cy?: number) {
  ctx.lineCap = 'round';
  for (const [col, width] of [[ol, w + lw * 2], [fill, w]] as const) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    if (cx !== undefined && cy !== undefined) ctx.quadraticCurveTo(cx, cy, x2, y2);
    else ctx.lineTo(x2, y2);
    ctx.strokeStyle = col;
    ctx.lineWidth = width;
    ctx.stroke();
  }
}

/** Arm ends the pose asks for. Module level so a frame allocates nothing. */
const HAND = { l: false, lx: 0, ly: 0, r: false, rx: 0, ry: 0 };

function armPose(a: CatAct | undefined, sy: number, headCY: number, t: number) {
  HAND.l = HAND.r = false;
  if (!a) return;
  const up = Math.max(a.stretch, a.cheer);
  if (up > 0.01) {
    const wig = a.cheer > a.stretch ? Math.sin(t * 16) * 0.04 : 0;
    const out = a.stretch > a.cheer ? 0.18 * a.stretch : 0;
    const lift = a.stretch > a.cheer ? 1.0 * a.stretch : 0.5 * a.cheer;
    HAND.l = HAND.r = true;
    HAND.lx = -0.38 - out;
    HAND.rx = 0.38 + out;
    HAND.ly = sy + 0.2 - lift + wig;
    HAND.ry = sy + 0.2 - lift - wig;
    return;
  }
  if (a.work === 1) {
    HAND.l = HAND.r = true;
    HAND.lx = -0.27;
    HAND.rx = 0.27;
    HAND.ly = HAND.ry = sy + 0.16;
    return;
  }
  if (a.work === 3) {
    HAND.r = true;
    HAND.rx = 0.2;
    HAND.ry = sy + 0.36 + Math.sin(t * 2.3) * 0.015;
  }
  if (!a.prop) return;
  const s = a.side;
  let x = s * 0.38;
  let y = sy + 0.14;
  if (a.prop === 1 || a.prop === 2) {
    x = s * (0.38 - 0.22 * a.sip);
    y = sy + 0.14 + (headCY + 0.3 - (sy + 0.14)) * a.sip;
  } else if (a.prop === 3) {
    x = s * (0.42 + 0.1 * a.swing);
    y = sy - 0.02 - 0.2 * a.swing;
  } else y = sy + 0.2 + Math.max(0, Math.sin(t * 5.6)) * 0.05;
  if (s < 0) {
    HAND.l = true;
    HAND.lx = x;
    HAND.ly = y;
  } else {
    HAND.r = true;
    HAND.rx = x;
    HAND.ry = y;
  }
}

/** An open book held in front of the chest; a page flips now and then. */
function drawBook(ctx: Ctx, c: CatView, t: number, ol: string) {
  const flip = Math.max(0, Math.sin(((t * 0.4 + c.seed * 5) % 1) * Math.PI * 2 * 3) - 0.6);
  ctx.save();
  ctx.translate(0, -0.28);
  ctx.lineJoin = 'round';
  ctx.lineWidth = 0.03;
  ctx.strokeStyle = ol;
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.roundRect(s < 0 ? -0.26 : 0.0, -0.14, 0.26, 0.3, 0.025);
    ctx.fillStyle = s < 0 ? '#fffdf5' : '#fff7e0';
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    for (let i = 0; i < 3; i++) {
      ctx.moveTo(s * 0.05 + (s < 0 ? -0.2 : 0.02), -0.07 + i * 0.07);
      ctx.lineTo(s * 0.05 + (s < 0 ? -0.04 : 0.18), -0.07 + i * 0.07);
    }
    ctx.lineWidth = 0.015;
    ctx.strokeStyle = '#c9b99a';
    ctx.stroke();
    ctx.lineWidth = 0.03;
    ctx.strokeStyle = ol;
  }
  if (flip > 0) {
    ctx.beginPath();
    ctx.roundRect(0, -0.14, 0.26 * (1 - flip * 1.6), 0.3, 0.025);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

const CAN_COLORS = ['#ff7a8a', '#6bc5ff', '#ffd23f'];

/** The thing in the held hand: mug (with steam), can, paddle, or a tossed ball. */
function drawProp(ctx: Ctx, c: CatView, a: CatAct, t: number, ol: string) {
  const s = a.side;
  const hx = s < 0 ? HAND.lx : HAND.rx;
  const hy = s < 0 ? HAND.ly : HAND.ry;
  ctx.save();
  ctx.lineJoin = 'round';
  if (a.prop === 1 || a.prop === 2) {
    ctx.translate(hx, hy - 0.04);
    ctx.rotate(-s * 0.75 * a.sip);
    ctx.lineWidth = 0.032;
    ctx.strokeStyle = ol;
    if (a.prop === 1) {
      ctx.beginPath();
      ctx.arc(0.105 * s, 0, 0.048, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.roundRect(-0.085, -0.09, 0.17, 0.17, 0.04);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.roundRect(-0.065, -0.075, 0.13, 0.045, 0.02);
      ctx.fillStyle = '#8a5a3c';
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.roundRect(-0.055, -0.1, 0.11, 0.18, 0.03);
      ctx.fillStyle = CAN_COLORS[Math.floor(c.seed * 3) % 3];
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.roundRect(-0.04, -0.03, 0.08, 0.04, 0.015);
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.fill();
    }
    ctx.restore();
    if (a.prop === 1 && a.sip < 0.4) {
      // steam puffs
      ctx.save();
      ctx.translate(hx, hy - 0.16);
      for (let i = 0; i < 3; i++) {
        const p = (t * 0.55 + i / 3 + c.seed) % 1;
        ctx.beginPath();
        ctx.arc(Math.sin(p * 7 + i * 2) * 0.04 + (i - 1) * 0.045, -p * 0.4, 0.028 + p * 0.035, 0, Math.PI * 2);
        const al = (1 - p) * 0.8 * (1 - a.sip * 2.5);
        ctx.fillStyle = rgba(style.dark ? '#dfe6ff' : '#ffffff', al);
        ctx.fill();
        ctx.lineWidth = 0.014;
        ctx.strokeStyle = rgba(style.dark ? '#ffffff' : '#9aa6bd', al * 0.7);
        ctx.stroke();
      }
      ctx.restore();
    }
    return;
  }
  if (a.prop === 3) {
    ctx.translate(hx, hy);
    ctx.rotate(s * (0.3 + 0.95 * a.swing));
    ctx.lineWidth = 0.03;
    ctx.strokeStyle = ol;
    ctx.beginPath();
    ctx.roundRect(-0.025, -0.12, 0.05, 0.14, 0.02);
    ctx.fillStyle = '#c9915f';
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, -0.24, 0.14, 0, Math.PI * 2);
    ctx.fillStyle = '#ff6b6b';
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    return;
  }
  if (a.prop === 4) {
    // toss up, fall, catch
    const p = (t * 0.85 + c.seed * 3) % 1;
    const y = hy - 0.05 - 4 * p * (1 - p) * 0.95;
    ctx.beginPath();
    ctx.arc(hx + s * 0.04 * Math.sin(p * Math.PI), y, 0.07, 0, Math.PI * 2);
    ctx.fillStyle = '#ffd23f';
    ctx.fill();
    ctx.lineWidth = 0.03;
    ctx.strokeStyle = '#f2a516';
    ctx.stroke();
  }
  ctx.restore();
}

function eyeOpen(c: CatView, t: number) {
  const idle = c.status === 'idle' || c.status === 'offline';
  const period = idle ? 5.5 : 3.7;
  const dur = idle ? 0.8 : 0.2;
  const p = ((t + c.seed * 3.1) % period) / dur;
  if (p < 1) return 1 - Math.sin(Math.PI * p) * (idle ? 0.92 : 1);
  return 1;
}

export function drawCat(ctx: Ctx, c: CatView, t: number, k: number) {
  const ol = outlineOf(c.fur);
  const lw = 0.05;
  const sit = c.sit;
  const moving = c.moving;
  const dark = style.dark;
  ctx.save();
  ctx.translate(c.x, c.z);
  ctx.scale(k * (1 + c.hover * 0.05), k * (1 + c.hover * 0.05));
  ctx.globalAlpha *= c.alpha;
  ctx.lineJoin = 'round';

  // ---- ring and ground shadow
  if (c.selected > 0.01) {
    const pulse = 1 + Math.sin(t * 4) * 0.04;
    ctx.beginPath();
    ctx.ellipse(0, 0.02, 0.7 * pulse * c.selected, 0.3 * pulse * c.selected, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,214,100,0.28)';
    ctx.fill();
    ctx.lineWidth = 0.07;
    ctx.strokeStyle = '#ffc94d';
    ctx.stroke();
  } else if (c.hover > 0.01) {
    ctx.beginPath();
    ctx.ellipse(0, 0.02, 0.6, 0.26, 0, 0, Math.PI * 2);
    ctx.lineWidth = 0.05;
    ctx.strokeStyle = rgba('#ffffff', 0.7 * c.hover);
    ctx.stroke();
  }
  if (sit < 0.6) {
    ctx.beginPath();
    ctx.ellipse(0, 0.03, 0.4 * (1 - c.hop * 0.6), 0.13, 0, 0, Math.PI * 2);
    ctx.fillStyle = style.shadow;
    ctx.fill();
  }

  // ---- motion
  const bob = moving ? Math.abs(Math.sin(c.walkPhase)) * 0.06 : Math.sin(t * 2 + c.seed * 6) * 0.01;
  const lift = c.hover * 0.07 + c.hop + bob;
  const sx = c.shake * Math.sin(t * 42) * 0.05 + (moving ? Math.sin(c.walkPhase) * 0.015 : 0);
  ctx.translate(sx, -lift);

  const bodyCY = -0.3 + 0.1 * sit;
  const headCY = -0.8 + 0.2 * sit;
  const status = c.status;
  const sleepy = status === 'idle' || status === 'offline';
  const tilt =
    status === 'thinking' ? 0.2 + Math.sin(t * 2) * 0.04
    : status === 'waiting' ? Math.sin(t * 5) * 0.06
    : sleepy ? Math.sin(t * 0.9 + c.seed * 5) * 0.07 + 0.04
    : status === 'error' ? Math.sin(t * 40) * 0.03
    : c.act && c.act.work === 3 ? -0.1 + Math.sin(t * 1.3 + c.seed * 4) * 0.03
    : Math.sin(t * 1.5 + c.seed * 4) * 0.015;
  const side = c.look >= 0 ? 1 : -1;
  const act = c.act;

  // ---- tail
  {
    const wag = Math.sin(t * (moving ? 9 : status === 'done' || status === 'working' ? 5 : 2.2) + c.seed * 6);
    const rx = 0.2 * side * -1;
    const y0 = bodyCY + 0.14;
    limb(ctx, rx, y0, rx * 2.6 + wag * 0.12 * -side, y0 - 0.5, 0.15, c.fur, ol, lw, rx * 3.4, y0 + 0.05);
    ctx.beginPath();
    ctx.arc(rx * 2.6 + wag * 0.12 * -side, y0 - 0.5, 0.075, 0, Math.PI * 2);
    ctx.fillStyle = c.stripes ? c.stripe : lighten(c.fur, 0.35);
    ctx.fill();
  }

  // ---- feet
  {
    const swing = moving ? Math.sin(c.walkPhase) : 0;
    for (const s of [-1, 1]) {
      const raise = moving ? Math.max(0, swing * s) * 0.09 : 0;
      const fx = s * (0.14 + 0.03 * sit);
      const fy = -0.06 - raise + (moving ? swing * s * 0.04 : 0);
      ctx.beginPath();
      ctx.ellipse(fx, fy, 0.125, 0.09, 0, 0, Math.PI * 2);
      ctx.fillStyle = c.fur;
      ctx.fill();
      ctx.lineWidth = lw;
      ctx.strokeStyle = ol;
      ctx.stroke();
    }
  }

  // ---- body
  {
    const ry = 0.27 - 0.03 * sit;
    ctx.beginPath();
    ctx.ellipse(0, bodyCY, 0.26, ry, 0, 0, Math.PI * 2);
    ctx.fillStyle = c.fur;
    ctx.fill();
    ctx.lineWidth = lw;
    ctx.strokeStyle = ol;
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(0, bodyCY + 0.05, 0.16, ry * 0.66, 0, 0, Math.PI * 2);
    ctx.fillStyle = c.belly;
    ctx.fill();
  }

  // ---- arms (behind the head)
  {
    const sy = bodyCY - 0.1;
    const swing = moving ? Math.sin(c.walkPhase) * 0.12 : 0;
    const typing = (c.atDesk && status === 'working') || act?.work === 2;
    armPose(act, sy, headCY, t);
    // left arm
    if (HAND.l) limb(ctx, -0.23, sy, HAND.lx, HAND.ly, 0.12, c.fur, ol, lw);
    else if (typing) {
      const p = Math.sin(t * 15);
      limb(ctx, -0.22, sy, -0.14, bodyCY + 0.22 + p * 0.03, 0.12, c.fur, ol, lw);
    } else limb(ctx, -0.23, sy, -0.33, sy + 0.2 + swing, 0.12, c.fur, ol, lw);
    // right arm
    if (HAND.r) limb(ctx, 0.23, sy, HAND.rx, HAND.ry, 0.12, c.fur, ol, lw);
    else if (status === 'waiting') {
      const wave = Math.sin(t * 9) * 0.07;
      limb(ctx, 0.23, sy, 0.45 + wave, sy - 0.38, 0.12, c.fur, ol, lw);
    } else if (status === 'done') {
      limb(ctx, 0.23, sy, 0.44, sy - 0.32 + Math.sin(t * 12) * 0.04, 0.12, c.fur, ol, lw);
      limb(ctx, -0.23, sy, -0.44, sy - 0.32 + Math.sin(t * 12 + 1) * 0.04, 0.12, c.fur, ol, lw);
    } else if (typing) {
      const p = Math.sin(t * 15 + 2);
      limb(ctx, 0.22, sy, 0.14, bodyCY + 0.22 + p * 0.03, 0.12, c.fur, ol, lw);
    } else limb(ctx, 0.23, sy, 0.33, sy + 0.2 - swing, 0.12, c.fur, ol, lw);
  }

  // ---- scarf
  {
    const y = headCY + 0.4;
    const sc = c.scarf;
    ctx.beginPath();
    ctx.roundRect(-0.27, y - 0.07, 0.54, 0.15, 0.075);
    ctx.fillStyle = sc;
    ctx.fill();
    ctx.lineWidth = lw * 0.9;
    ctx.strokeStyle = outlineOf(sc);
    ctx.stroke();
    // knot tail
    ctx.save();
    ctx.translate(0.17 * side, y + 0.05);
    ctx.rotate(0.28 * side);
    ctx.beginPath();
    ctx.roundRect(-0.055, 0, 0.11, 0.22, 0.05);
    ctx.fillStyle = darken(sc, 0.1);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  // ---- head
  ctx.save();
  ctx.translate(c.look * 0.04, headCY);
  ctx.rotate(act && act.sip > 0 ? tilt + act.side * 0.16 * act.sip : tilt);
  const earWig = status === 'waiting' ? Math.sin(t * 12) * 0.12 : 0;
  const earDrop = sleepy ? 0.18 : 0;
  const silhouette = () => {
    ctx.beginPath();
    ctx.ellipse(0, 0, 0.47, 0.4, 0, 0, Math.PI * 2);
    ctx.moveTo(0.53, 0.08);
    ctx.arc(0.41, 0.08, 0.12, 0, Math.PI * 2);
    ctx.moveTo(-0.29, 0.08);
    ctx.arc(-0.41, 0.08, 0.12, 0, Math.PI * 2);
    for (const s of [-1, 1] as const) {
      ctx.save();
      ctx.translate(s * 0.3, -0.36);
      ctx.rotate(s * (0.45 + earDrop) + (s > 0 ? earWig : -earWig));
      ctx.moveTo(0.15, 0);
      ctx.ellipse(0, 0, 0.15, 0.18, 0, 0, Math.PI * 2);
      ctx.restore();
    }
  };
  silhouette();
  ctx.lineWidth = lw * 2;
  ctx.strokeStyle = ol;
  ctx.stroke();
  silhouette();
  ctx.fillStyle = c.fur;
  ctx.fill();
  // inner ears
  for (const s of [-1, 1] as const) {
    ctx.save();
    ctx.translate(s * 0.3, -0.36);
    ctx.rotate(s * (0.45 + earDrop) + (s > 0 ? earWig : -earWig));
    ctx.translate(0, -0.03);
    ctx.beginPath();
    ctx.ellipse(0, 0, 0.075, 0.1, 0, 0, Math.PI * 2);
    ctx.fillStyle = PINK;
    ctx.fill();
    ctx.restore();
  }
  // markings
  ctx.lineCap = 'round';
  if (c.stripes) {
    ctx.strokeStyle = c.stripe;
    ctx.lineWidth = 0.05;
    ctx.beginPath();
    for (const x of [-0.13, 0, 0.13]) {
      ctx.moveTo(x, -0.38);
      ctx.lineTo(x * 0.9, x === 0 ? -0.2 : -0.26);
    }
    for (const s of [-1, 1]) {
      ctx.moveTo(s * 0.46, 0.0);
      ctx.lineTo(s * 0.36, 0.01);
      ctx.moveTo(s * 0.45, 0.1);
      ctx.lineTo(s * 0.36, 0.08);
    }
    ctx.stroke();
  }
  // muzzle
  ctx.beginPath();
  ctx.ellipse(0, 0.24, 0.16, 0.1, 0, 0, Math.PI * 2);
  ctx.fillStyle = c.belly;
  ctx.fill();

  // eyes
  const open = act && act.sip > 0.5 ? 0 : eyeOpen(c, t);
  const ex = 0.2;
  const ey = 0.04;
  const lx = c.look * 0.035;
  const up = status === 'thinking' ? -0.03 : 0;
  for (const s of [-1, 1] as const) {
    const x = s * ex + lx;
    if (status === 'done') {
      // happy ^ ^
      ctx.beginPath();
      ctx.arc(x, ey + 0.07, 0.085, Math.PI * 1.12, Math.PI * 1.88);
      ctx.lineWidth = 0.055;
      ctx.strokeStyle = EYE;
      ctx.stroke();
    } else if (status === 'error') {
      // > <
      ctx.beginPath();
      ctx.moveTo(x - s * 0.07, ey - 0.07);
      ctx.lineTo(x + s * 0.07, ey);
      ctx.lineTo(x - s * 0.07, ey + 0.07);
      ctx.lineWidth = 0.05;
      ctx.strokeStyle = EYE;
      ctx.stroke();
    } else if (status === 'offline' || open < 0.18) {
      ctx.beginPath();
      ctx.arc(x, ey - 0.02, 0.08, Math.PI * 0.12, Math.PI * 0.88);
      ctx.lineWidth = 0.05;
      ctx.strokeStyle = EYE;
      ctx.stroke();
    } else {
      ctx.save();
      ctx.translate(x, ey + up);
      ctx.scale(1, open);
      ctx.beginPath();
      ctx.ellipse(0, 0, 0.09, 0.12, 0, 0, Math.PI * 2);
      ctx.fillStyle = EYE;
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(0, 0.05, 0.062, 0.058, 0, 0, Math.PI * 2);
      ctx.fillStyle = c.iris;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(-0.03, -0.045, 0.04, 0, Math.PI * 2);
      ctx.arc(0.035, 0.05, 0.02, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.restore();
    }
  }
  // blush
  ctx.fillStyle = 'rgba(255,128,160,0.55)';
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(s * 0.33, 0.19, 0.085, 0.05, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // nose and mouth
  ctx.beginPath();
  ctx.ellipse(0, 0.17, 0.04, 0.028, 0, 0, Math.PI * 2);
  ctx.fillStyle = PINK;
  ctx.fill();
  if (c.talk > 0 || status === 'waiting' || (act && act.stretch > 0.3)) {
    const m = c.talk > 0 ? 0.04 + Math.abs(Math.sin(t * 14)) * 0.04 : act && act.stretch > 0.3 ? 0.05 + act.stretch * 0.05 : 0.05;
    ctx.beginPath();
    ctx.ellipse(0, 0.25, 0.04, m, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#ff6f8d';
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.arc(-0.035, 0.205, 0.035, 0.1, Math.PI * 0.9);
    ctx.arc(0.035, 0.205, 0.035, Math.PI * 0.1, Math.PI * 0.9);
    ctx.lineWidth = 0.022;
    ctx.strokeStyle = status === 'error' ? '#a34a5a' : mix(ol, '#5a3a40', 0.3);
    ctx.stroke();
  }
  // whiskers
  ctx.strokeStyle = rgba(dark ? '#ffffff' : '#6b5560', 0.5);
  ctx.lineWidth = 0.02;
  ctx.beginPath();
  for (const s of [-1, 1]) {
    for (const dy of [-0.045, 0.01, 0.065]) {
      ctx.moveTo(s * 0.4, 0.2 + dy * 0.4);
      ctx.lineTo(s * 0.58, 0.18 + dy * 2.1);
    }
  }
  ctx.stroke();
  ctx.restore(); // head frame

  if (act && act.work === 1) drawBook(ctx, c, t, ol);

  // ---- held prop (in front of the face while sipping)
  if (act && act.prop && act.stretch < 0.01 && act.cheer < 0.01) drawProp(ctx, c, act, t, ol);

  // ---- status effects
  const b = (c.bubble ?? 0) > 0.05 && (status === 'thinking' || status === 'error') ? 0 : c.badge;
  if (b > 0.02) {
    const bx = 0.5;
    const by = headCY - 0.62;
    ctx.save();
    ctx.translate(bx, by);
    ctx.scale(b, b);
    if (status === 'thinking') {
      ctx.beginPath();
      ctx.arc(-0.12, 0.2, 0.045, 0, Math.PI * 2);
      ctx.arc(-0.05, 0.12, 0.065, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.beginPath();
      ctx.roundRect(-0.27, -0.16, 0.54, 0.3, 0.15);
      ctx.fill();
      ctx.lineWidth = 0.035;
      ctx.strokeStyle = outlineOf('#8fd3ff');
      ctx.stroke();
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.arc(-0.14 + i * 0.14, -0.01 - Math.max(0, Math.sin(t * 5 - i * 0.9)) * 0.05, 0.04, 0, Math.PI * 2);
        ctx.fillStyle = STATUS_COLORS.thinking;
        ctx.fill();
      }
    } else if (status === 'waiting') {
      const j = Math.sin(t * 6) * 0.05;
      ctx.translate(0, j);
      ctx.beginPath();
      ctx.arc(0, 0, 0.2, 0, Math.PI * 2);
      ctx.fillStyle = STATUS_COLORS.waiting;
      ctx.fill();
      ctx.lineWidth = 0.045;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
      text(ctx, '!', 0, 0.01, 0.3, '#ffffff', { weight: 900 });
    } else if (status === 'done') {
      ctx.rotate(Math.sin(t * 3) * 0.3);
      star(ctx, 0, 0, 0.22);
      ctx.fillStyle = '#ffd23f';
      ctx.fill();
      ctx.lineWidth = 0.05;
      ctx.strokeStyle = '#f2a516';
      ctx.stroke();
    } else if (status === 'error') {
      const fall = (t * 0.9) % 1;
      ctx.translate(-0.02, fall * 0.16);
      ctx.beginPath();
      ctx.moveTo(0, -0.18);
      ctx.bezierCurveTo(0.16, 0.02, 0.12, 0.16, 0, 0.16);
      ctx.bezierCurveTo(-0.12, 0.16, -0.16, 0.02, 0, -0.18);
      ctx.fillStyle = rgba('#8fd3ff', 1 - fall * 0.6);
      ctx.fill();
      ctx.lineWidth = 0.04;
      ctx.strokeStyle = rgba('#4aa8e0', 1 - fall * 0.6);
      ctx.stroke();
    }
    ctx.restore();
  }
  if ((status === 'idle' || status === 'offline') && sit > 0.5) {
    for (let i = 0; i < 2; i++) {
      const p = ((t * 0.35 + i * 0.5 + c.seed) % 1);
      ctx.globalAlpha = c.alpha * Math.sin(Math.PI * p) * 0.9;
      text(ctx, 'z', 0.46 + p * 0.22 + i * 0.1, headCY - 0.3 - p * 0.5, 0.2 + i * 0.12, dark ? '#c3d0ff' : '#7f93e8', { weight: 800 });
    }
    ctx.globalAlpha = c.alpha;
  }

  ctx.restore();
}
