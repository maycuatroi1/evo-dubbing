import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "public", "icons");
const UNIT = 128;
const SIZES = [16, 48, 128];
const SAMPLES = 8;
const PLATE = [10, 10, 10];
const MARK = [255, 255, 255];

const plate = { x: 0, y: 0, w: 128, h: 128, r: 28 };
const glyph = [
  { x: 24, y: 24, w: 16, h: 80, r: 4 },
  { x: 24, y: 24, w: 80, h: 16, r: 4 },
  { x: 24, y: 56, w: 48, h: 16, r: 4 },
  { x: 24, y: 88, w: 80, h: 16, r: 4 }
];

function inside(px, py, rect, radius) {
  const r = Math.min(radius, rect.w / 2, rect.h / 2);
  if (px < rect.x || px > rect.x + rect.w || py < rect.y || py > rect.y + rect.h) return false;
  const dx = Math.max(rect.x + r - px, 0, px - (rect.x + rect.w - r));
  const dy = Math.max(rect.y + r - py, 0, py - (rect.y + rect.h - r));
  return dx * dx + dy * dy <= r * r;
}

function coverage(px, py, step, test) {
  let hits = 0;
  for (let sy = 0; sy < SAMPLES; sy += 1) {
    for (let sx = 0; sx < SAMPLES; sx += 1) {
      const x = (px + (sx + 0.5) / SAMPLES) * step;
      const y = (py + (sy + 0.5) / SAMPLES) * step;
      if (test(x, y)) hits += 1;
    }
  }
  return hits / (SAMPLES * SAMPLES);
}

function render(size) {
  const step = UNIT / size;
  const sharpGlyph = size <= 16;
  const rgba = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      const aPlate = coverage(px, py, step, (x, y) => inside(x, y, plate, plate.r));
      if (aPlate === 0) continue;
      const aMark = coverage(px, py, step, (x, y) =>
        glyph.some((g) => inside(x, y, g, sharpGlyph ? 0 : g.r))
      );
      const alpha = aMark + aPlate * (1 - aMark);
      const at = (py * size + px) * 4;
      for (let c = 0; c < 3; c += 1) {
        const mixed = MARK[c] * aMark + PLATE[c] * aPlate * (1 - aMark);
        rgba[at + c] = Math.round(mixed / alpha);
      }
      rgba[at + 3] = Math.round(alpha * 255);
    }
  }
  return rgba;
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

mkdirSync(OUT_DIR, { recursive: true });
for (const size of SIZES) {
  const file = join(OUT_DIR, `icon-${size}.png`);
  const buf = png(size, render(size));
  writeFileSync(file, buf);
  process.stdout.write(`icon-${size}.png  ${buf.length} bytes\n`);
}
