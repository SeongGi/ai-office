// Draws the Agent Floor mark (four rounded squares, one orange) as a PNG, in code,
// so the desktop app ships without binary assets.
const zlib = require('node:zlib');

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/**
 * @param {number} size  pixels
 * @param {{ template?: boolean, background?: boolean }} opts
 *   template: black-only mark for the macOS menu bar (the OS tints it)
 *   background: rounded app-icon tile behind the mark
 */
function markPng(size, { template = false, background = false } = {}) {
  const px = Buffer.alloc(size * size * 4);
  const set = (x, y, r, g, b, a) => {
    const i = (y * size + x) * 4;
    // Alpha-composite over what is there.
    const ia = px[i + 3] / 255;
    const na = a / 255;
    const oa = na + ia * (1 - na);
    if (oa <= 0) return;
    px[i] = (r * na + px[i] * ia * (1 - na)) / oa;
    px[i + 1] = (g * na + px[i + 1] * ia * (1 - na)) / oa;
    px[i + 2] = (b * na + px[i + 2] * ia * (1 - na)) / oa;
    px[i + 3] = oa * 255;
  };
  // Signed-distance rounded rectangle with 1px anti-aliasing.
  const rrect = (x0, y0, w, h, r, color) => {
    for (let y = Math.floor(y0); y < Math.ceil(y0 + h); y++)
      for (let x = Math.floor(x0); x < Math.ceil(x0 + w); x++) {
        const cx = Math.max(x0 + r, Math.min(x + 0.5, x0 + w - r));
        const cy = Math.max(y0 + r, Math.min(y + 0.5, y0 + h - r));
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) - r;
        const a = Math.max(0, Math.min(1, 0.5 - d));
        if (a > 0 && x >= 0 && y >= 0 && x < size && y < size) set(x, y, color[0], color[1], color[2], a * (color[3] ?? 255));
      }
  };
  let pad = size * 0.14;
  if (background) {
    rrect(size * 0.06, size * 0.06, size * 0.88, size * 0.88, size * 0.2, [22, 26, 33, 255]);
    pad = size * 0.27;
  }
  const gap = size * (background ? 0.04 : 0.08);
  const cell = (size - pad * 2 - gap) / 2;
  const radius = cell * 0.28;
  const grey = template ? [0, 0, 0, 150] : [138, 148, 166, 255];
  const orange = template ? [0, 0, 0, 255] : [255, 95, 46, 255];
  for (let i = 0; i < 4; i++) {
    const cx = pad + (i % 2) * (cell + gap);
    const cy = pad + Math.floor(i / 2) * (cell + gap);
    rrect(cx, cy, cell, cell, radius, i === 0 ? orange : grey);
  }
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

module.exports = { markPng };
