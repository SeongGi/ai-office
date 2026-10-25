// Round-cartoon drawing primitives. All coordinates are metres; the caller sets the transform.
import { mix } from './color';

export const UI_FONT = '"Geist Variable", "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", system-ui, sans-serif';

export const style = {
  outline: '#8a6a5c',
  shadow: 'rgba(120,85,60,0.20)',
  dark: false,
};

export function setStyle(s: { outline: string; shadow: string; dark: boolean }) {
  style.outline = s.outline;
  style.shadow = s.shadow;
  style.dark = s.dark;
}

const outlineCache = new Map<string, string>();
/** A soft outline colour: the fill pulled toward the theme outline colour. */
export function outlineOf(fill: string) {
  const key = fill + style.outline;
  let c = outlineCache.get(key);
  if (!c) outlineCache.set(key, (c = mix(fill, style.outline, style.dark ? 0.7 : 0.55)));
  return c;
}

/** Shadow offset (world +x 0.07, +z 0.12 metres) expressed in the current local frame. */
function shadowOffset(ctx: CanvasRenderingContext2D, dx: number, dz: number): [number, number] {
  const m = ctx.getTransform();
  const sc = Math.hypot(m.a, m.b) || 1;
  return [(m.a * dx + m.b * dz) / sc, (m.c * dx + m.d * dz) / sc];
}

export interface ShapeOpts {
  lw?: number;
  line?: string;
  shadow?: boolean | number;
  noLine?: boolean;
}

/** Fill a path with a soft drop shadow and a thick soft outline. */
export function shape(ctx: CanvasRenderingContext2D, fill: string, build: () => void, o: ShapeOpts = {}) {
  const lw = o.lw ?? 0.05;
  if (o.shadow !== false) {
    const k = typeof o.shadow === 'number' ? o.shadow : 1;
    const [ox, oy] = shadowOffset(ctx, 0.07 * k, 0.12 * k);
    ctx.save();
    ctx.translate(ox, oy);
    build();
    ctx.fillStyle = style.shadow;
    ctx.fill();
    ctx.restore();
  }
  build();
  ctx.fillStyle = fill;
  ctx.fill();
  if (!o.noLine) {
    ctx.lineWidth = lw;
    ctx.strokeStyle = o.line ?? outlineOf(fill);
    ctx.lineJoin = 'round';
    ctx.stroke();
  }
}

/** Rounded box, centre based. */
export function rbox(ctx: CanvasRenderingContext2D, cx: number, cy: number, w: number, h: number, fill: string, r = 0.12, o: ShapeOpts = {}) {
  shape(ctx, fill, () => {
    ctx.beginPath();
    ctx.roundRect(cx - w / 2, cy - h / 2, w, h, Math.min(r, w / 2, h / 2));
  }, o);
}

export function ellipse(ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, fill: string, o: ShapeOpts = {}) {
  shape(ctx, fill, () => {
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  }, o);
}

export const circle = (ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, fill: string, o: ShapeOpts = {}) => ellipse(ctx, cx, cy, r, r, fill, o);

/** Run `fn` in a frame translated to (x, y) and rotated by `rot` (canvas radians). */
export function item(ctx: CanvasRenderingContext2D, x: number, y: number, rot: number, fn: () => void) {
  ctx.save();
  ctx.translate(x, y);
  if (rot) ctx.rotate(rot);
  fn();
  ctx.restore();
}

/** Text with a size in metres. Drawn at a fixed large font size and scaled, so tiny sizes stay crisp. */
export function text(ctx: CanvasRenderingContext2D, str: string, x: number, y: number, size: number, color: string, o: { weight?: number; align?: CanvasTextAlign } = {}) {
  ctx.save();
  ctx.translate(x, y);
  const k = size / 100;
  ctx.scale(k, k);
  ctx.font = `${o.weight ?? 700} 100px ${UI_FONT}`;
  ctx.textAlign = o.align ?? 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(str, 0, 0);
  ctx.restore();
}

/** Width of `str` in metres at `size`. */
export function textWidth(ctx: CanvasRenderingContext2D, str: string, size: number, weight = 700) {
  ctx.save();
  ctx.font = `${weight} 100px ${UI_FONT}`;
  const w = ctx.measureText(str).width;
  ctx.restore();
  return (w * size) / 100;
}

export function star(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, rot = 0) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = rot - Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.5 : r;
    const px = cx + Math.cos(a) * rr;
    const py = cy + Math.sin(a) * rr;
    if (i) ctx.lineTo(px, py);
    else ctx.moveTo(px, py);
  }
  ctx.closePath();
}
