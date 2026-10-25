// Tiny colour helpers (no three.js). Colours are '#rrggbb' strings.

const parsed = new Map<string, [number, number, number]>();

function parse(hex: string): [number, number, number] {
  let v = parsed.get(hex);
  if (v) return v;
  let h = hex.replace('#', '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  v = [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  parsed.set(hex, v);
  return v;
}

const hex2 = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');

export function rgb(r: number, g: number, b: number) {
  return `#${hex2(r)}${hex2(g)}${hex2(b)}`;
}

const mixCache = new Map<string, string>();

/** t = 0 gives a, t = 1 gives b. */
export function mix(a: string, b: string, t: number) {
  const key = `${a}|${b}|${t}`;
  let out = mixCache.get(key);
  if (out) return out;
  const x = parse(a);
  const y = parse(b);
  out = rgb(x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t);
  mixCache.set(key, out);
  return out;
}

export const lighten = (c: string, t: number) => mix(c, '#ffffff', t);
export const darken = (c: string, t: number) => mix(c, '#000000', t);

export function rgba(c: string, a: number) {
  const [r, g, b] = parse(c);
  return `rgba(${r},${g},${b},${a})`;
}

export function hsl(h: number, s: number, l: number) {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return rgb(f(0) * 255, f(8) * 255, f(4) * 255);
}
