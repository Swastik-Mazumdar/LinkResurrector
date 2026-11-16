/**
 * Generates the MV3 action/extension icons (16/48/128 px) as pure-PNG files
 * with zero dependencies — a rounded obsidian badge with a crisp white
 * border and the bold crimson "LR" monogram.
 *
 * Run: npm run icons
 */

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

/* ---------- bitmap glyphs for the "LR" monogram (6x8 each) ---------- */
const GLYPH_L = [
  '100000',
  '100000',
  '100000',
  '100000',
  '100000',
  '100000',
  '100000',
  '111111',
];
const GLYPH_R = [
  '111110',
  '100001',
  '100001',
  '111110',
  '100010',
  '100010',
  '100010',
  '100010',
];

const BG = [9, 9, 11, 255]; // #09090B
const WHITE = [244, 244, 245, 255]; // #F4F4F5 border
const RED = [239, 68, 68, 255]; // #EF4444 monogram

function insideRoundedRect(x, y, size, radius, inset = 0) {
  const min = inset;
  const max = size - 1 - inset;
  if (x < min || x > max || y < min || y > max) return false;
  const rx = Math.min(x - min, max - x);
  const ry = Math.min(y - min, max - y);
  const corner = radius - inset;
  if (rx >= corner || ry >= corner) return true;
  const dx = corner - rx;
  const dy = corner - ry;
  return dx * dx + dy * dy <= corner * corner;
}

function drawIcon(size) {
  const px = new Uint8Array(size * size * 4);
  const radius = Math.round(size * 0.24);
  const border = Math.max(1, Math.round(size * 0.055));

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!insideRoundedRect(x, y, size, radius)) continue;
      const inBorder =
        !insideRoundedRect(x, y, size, radius, border) ||
        x <= 0 ||
        y <= 0 ||
        x >= size - 1 ||
        y >= size - 1;
      const color = inBorder ? WHITE : BG;
      const i = (y * size + x) * 4;
      px[i] = color[0];
      px[i + 1] = color[1];
      px[i + 2] = color[2];
      px[i + 3] = color[3];
    }
  }

  if (size >= 32) {
    // Cell scale that fits the 13x8 monogram inside the safe area.
    const safe = size - border * 2 - Math.round(size * 0.08);
    const cell = Math.max(1, Math.min(Math.floor(safe / 13), Math.floor(safe / 8)));
    const gridW = 13 * cell;
    const gridH = 8 * cell;
    const x0 = Math.round((size - gridW) / 2);
    const y0 = Math.round((size - gridH) / 2);

    const stamp = (glyph, colOffset) => {
      for (let gy = 0; gy < glyph.length; gy++) {
        for (let gx = 0; gx < glyph[gy].length; gx++) {
          if (glyph[gy][gx] !== '1') continue;
          for (let py = 0; py < cell; py++) {
            for (let pxx = 0; pxx < cell; pxx++) {
              const x = x0 + (colOffset + gx) * cell + pxx;
              const y = y0 + gy * cell + py;
              if (x < 0 || x >= size || y < 0 || y >= size) continue;
              const i = (y * size + x) * 4;
              px[i] = RED[0];
              px[i + 1] = RED[1];
              px[i + 2] = RED[2];
              px[i + 3] = RED[3];
            }
          }
        }
      }
    };
    stamp(GLYPH_L, 0);
    stamp(GLYPH_R, 7); // 6 glyph cols + 1 col gap
  } else {
    // Tiny sizes: draw a bold crimson pulse bar instead of unreadable glyphs.
    const barH = Math.max(2, Math.round(size * 0.16));
    const barW = Math.round(size * 0.5);
    const yStart = Math.round((size - barH) / 2);
    const xStart = Math.round((size - barW) / 2);
    for (let y = yStart; y < yStart + barH; y++) {
      for (let x = xStart; x < xStart + barW; x++) {
        const i = (y * size + x) * 4;
        px[i] = RED[0];
        px[i + 1] = RED[1];
        px[i + 2] = RED[2];
        px[i + 3] = RED[3];
      }
    }
  }
  return px;
}

/* ---------- minimal PNG encoder (RGBA, filter 0, zlib) ---------- */
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
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

function encodePNG(size, pixels) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    Buffer.from(pixels.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT_DIR, { recursive: true });
for (const size of [16, 48, 128]) {
  const file = join(OUT_DIR, `icon${size}.png`);
  writeFileSync(file, encodePNG(size, drawIcon(size)));
  console.log(`✓ public/icons/icon${size}.png`);
}
