/**
 * Generates the PWA icon set with zero dependencies (pure Node + zlib).
 *
 * Design: deep-navy rounded square with an electric-blue radial glow and a
 * bold white "O" ring — the Omnivex mark. The maskable variant fills the whole
 * canvas so it survives any Android/iOS mask.
 *
 * Usage: node scripts/generate-icons.mjs
 */

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "public", "icons");
fs.mkdirSync(outDir, { recursive: true });

/* ------------------------------------------------------------------ */
/* Minimal PNG encoder (RGBA, 8-bit)                                   */
/* ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
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

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ------------------------------------------------------------------ */
/* Icon drawing                                                        */
/* ------------------------------------------------------------------ */

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function roundedRectAlpha(x, y, size, radius) {
  const half = size / 2;
  const dx = Math.max(Math.abs(x - half) - (half - radius), 0);
  const dy = Math.max(Math.abs(y - half) - (half - radius), 0);
  const d = Math.hypot(dx, dy) - radius;
  return clamp(0.5 - d, 0, 1); // 1 inside, soft 1px edge
}

function drawIcon(size, { maskable = false } = {}) {
  const rgba = Buffer.alloc(size * size * 4);
  const center = size / 2;
  const glowR = size * 0.62;
  const ringR = size * (maskable ? 0.27 : 0.285);
  const ringT = size * 0.098;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;

      // background: near-black navy with a blue radial glow from upper center
      const gd = Math.hypot(x - center, y - size * 0.32) / glowR;
      const glow = clamp(1 - gd, 0, 1) ** 2;
      let r = lerp(5, 40, glow);
      let g = lerp(7, 13, glow);
      let b = lerp(12, 255, glow * 0.92);

      // the "O" ring
      const d = Math.abs(Math.hypot(x - center, y - center) - ringR);
      const edge = clamp(ringT / 2 - d + 0.5, 0, 1);
      if (edge > 0) {
        r = lerp(r, 255, edge);
        g = lerp(g, 255, edge);
        b = lerp(b, 255, edge);
      }
      // subtle inner accent shadow on the ring
      const inner = clamp(ringT / 2 - Math.abs(Math.hypot(x - center, y - center) - (ringR - ringT * 0.42)) + 0.5, 0, 1);
      if (inner > 0 && edge < 0.4) {
        r = lerp(r, 12, inner * 0.35);
        g = lerp(g, 6, inner * 0.35);
        b = lerp(b, 60, inner * 0.35);
      }

      let alpha = 255;
      if (!maskable) {
        alpha = Math.round(255 * roundedRectAlpha(x + 0.5, y + 0.5, size, size * 0.22));
      }

      rgba[i] = Math.round(clamp(r, 0, 255));
      rgba[i + 1] = Math.round(clamp(g, 0, 255));
      rgba[i + 2] = Math.round(clamp(b, 0, 255));
      rgba[i + 3] = alpha;
    }
  }
  return encodePng(size, size, rgba);
}

const targets = [
  ["icon-192.png", 192, { maskable: false }],
  ["icon-512.png", 512, { maskable: false }],
  ["icon-maskable-512.png", 512, { maskable: true }],
  ["apple-touch-icon.png", 180, { maskable: true }],
];

for (const [name, size, opts] of targets) {
  const buf = drawIcon(size, opts);
  fs.writeFileSync(path.join(outDir, name), buf);
  console.log(`✓ ${name} (${size}x${size}, ${buf.length} bytes)`);
}

/* favicon.svg for browsers that prefer vector */
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs>
    <radialGradient id="g" cx="50%" cy="32%" r="72%">
      <stop offset="0%" stop-color="#280dff"/>
      <stop offset="100%" stop-color="#05070c"/>
    </radialGradient>
  </defs>
  <rect width="64" height="64" rx="14" fill="url(#g)"/>
  <circle cx="32" cy="32" r="17" fill="none" stroke="#ffffff" stroke-width="10"/>
</svg>
`;
fs.writeFileSync(path.join(root, "public", "favicon.svg"), svg);
console.log("✓ favicon.svg");
