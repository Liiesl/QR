import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public');
mkdirSync(outDir, { recursive: true });

// Minimal PNG encoder (RGBA8, filter 0)
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, c]);
}

function encodePNG(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

function hex(rgb) {
  const n = parseInt(rgb.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function drawIcon(size, { maskable = false } = {}) {
  const buf = Buffer.alloc(size * size * 4);
  const INK = hex('#0e1116'), BONE = hex('#ede9e3'), SIGNAL = hex('#ffb300');
  const pad = maskable ? Math.floor(size * 0.12) : 0;

  const rect = (x0, y0, x1, y1, col, r = 255) => {
    for (let y = Math.max(0, y0); y < Math.min(size, y1); y++)
      for (let x = Math.max(0, x0); x < Math.min(size, x1); x++) {
        const i = (y * size + x) * 4;
        buf[i] = col[0]; buf[i + 1] = col[1]; buf[i + 2] = col[2]; buf[i + 3] = r;
      }
  };

  // background
  rect(0, 0, size, size, maskable ? SIGNAL : INK);
  const bg0 = maskable ? pad : 0;
  const bg1 = size - (maskable ? pad : 0);
  if (maskable) {
    // rounded-ish inner field
    rect(bg0, bg0, bg1, bg1, INK);
  }

  const s = bg1 - bg0;
  const cx = bg0 + s * 0.5, cy = bg0 + s * 0.5;
  const box = s * 0.62;
  const x0 = Math.floor(cx - box / 2), y0 = Math.floor(cy - box / 2);
  const x1 = Math.floor(cx + box / 2), y1 = Math.floor(cy + box / 2);
  const bw = Math.max(6, Math.floor(size * 0.035));

  // viewfinder border
  rect(x0, y0, x1, y0 + bw, SIGNAL);
  rect(x0, y1 - bw, x1, y1, SIGNAL);
  rect(x0, y0, x0 + bw, y1, SIGNAL);
  rect(x1 - bw, y0, x1, y1, SIGNAL);

  // QR finders
  const f = Math.floor(box * 0.28), g = Math.floor(box * 0.12);
  const fx = [x0 + g, x1 - g - f, x0 + g];
  const fy = [y0 + g, y0 + g, y1 - g - f];
  for (let k = 0; k < 3; k++) {
    rect(fx[k], fy[k], fx[k] + f, fy[k] + f, BONE);
    const inner = Math.floor(f * 0.38);
    const ix = fx[k] + Math.floor((f - inner) / 2), iy = fy[k] + Math.floor((f - inner) / 2);
    rect(ix, iy, ix + inner, iy + inner, INK);
  }
  // data bits
  const m = Math.floor(box * 0.1);
  rect(x1 - g - m * 2, y1 - g - m * 2, x1 - g, y1 - g, BONE);
  rect(x0 + g + f + g, y0 + g, x0 + g + f + g + m, y0 + g + m, BONE);
  rect(x0 + g + f + g, y1 - g - m, x0 + g + f + g + m, y1 - g, BONE);

  return encodePNG(size, size, buf);
}

function encodeICO(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + 16 * images.length;
  const parts = [header];
  const payloads = [];
  for (const { size, data } of images) {
    const entry = Buffer.alloc(16);
    entry[0] = size >= 256 ? 0 : size;
    entry[1] = size >= 256 ? 0 : size;
    entry[2] = 0; entry[3] = 0;
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    parts.push(entry);
    payloads.push(data);
  }
  return Buffer.concat([...parts, ...payloads]);
}

writeFileSync(join(outDir, 'pwa-192x192.png'), drawIcon(192));
writeFileSync(join(outDir, 'pwa-512x512.png'), drawIcon(512));
writeFileSync(join(outDir, 'maskable-512x512.png'), drawIcon(512, { maskable: true }));
writeFileSync(join(outDir, 'apple-touch-icon.png'), drawIcon(180));
writeFileSync(join(outDir, 'favicon.ico'), encodeICO([
  { size: 16, data: drawIcon(16) },
  { size: 32, data: drawIcon(32) },
  { size: 48, data: drawIcon(48) },
]));
console.log('icons written to public/');
