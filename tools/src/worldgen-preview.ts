/**
 * Weltgen-Vorschau: rendert Höhen- und Biomkarte als PNG (eigener Mini-Encoder, node:zlib).
 *
 *   node tools/src/worldgen-preview.ts [--seed 42] [--size 512] [--out tools/out/worldgen.png]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { deflateSync } from 'node:zlib';
import { Biome, SEA_LEVEL, Terrain } from '@robmine/core';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

const seed = Number(arg('seed', '42'));
const size = Number(arg('size', '512'));
const out = arg('out', 'tools/out/worldgen.png');
const scale = Number(arg('scale', '4')); // Blöcke je Pixel

const terrain = new Terrain(seed);
const rgba = new Uint8Array(size * size * 4);

const BIOME_TINT: Record<number, [number, number, number]> = {
  [Biome.Hainland]: [123, 198, 126],
  [Biome.Perlkueste]: [242, 221, 164],
  [Biome.Sternenmeer]: [63, 167, 214],
};

let minH = 255;
let maxH = 0;
const counts = new Map<number, number>();
for (let py = 0; py < size; py++) {
  for (let px = 0; px < size; px++) {
    const wx = (px - size / 2) * scale;
    const wz = (py - size / 2) * scale;
    const c = terrain.climate(wx, wz);
    const h = terrain.heightFromClimate(wx, wz, c);
    const biome = terrain.biomeAt(h, c);
    counts.set(biome, (counts.get(biome) ?? 0) + 1);
    if (h < minH) minH = h;
    if (h > maxH) maxH = h;
    const tint = BIOME_TINT[biome] ?? [200, 200, 200];
    // Helligkeit nach Höhe, Meer dunkler mit Tiefe
    let shade: number;
    if (h < SEA_LEVEL) shade = 0.35 + 0.45 * (h / SEA_LEVEL);
    else shade = 0.55 + 0.45 * Math.min(1, (h - SEA_LEVEL) / 120);
    if (h >= 165) shade = 1.2;
    const o = (px + py * size) * 4;
    rgba[o] = Math.min(255, tint[0] * shade);
    rgba[o + 1] = Math.min(255, tint[1] * shade);
    rgba[o + 2] = Math.min(255, tint[2] * shade);
    rgba[o + 3] = 255;
  }
}

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, encodePng(size, size, rgba));
console.log(
  `Weltgen-Vorschau geschrieben: ${out} (${size}² Pixel, ${scale} Blöcke/Pixel, Seed ${seed})`,
);
console.log(`Höhe min ${minH} max ${maxH}`);
for (const [b, n] of counts)
  console.log(`  Biom ${b}: ${((n / (size * size)) * 100).toFixed(1)} %`);

/** Minimaler PNG-Encoder (RGBA, 8 Bit, ohne Interlace). */
function encodePng(width: number, height: number, pixels: Uint8Array): Buffer {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // Filter: none
    Buffer.from(pixels.buffer, pixels.byteOffset + y * width * 4, width * 4).copy(
      raw,
      y * (width * 4 + 1) + 1,
    );
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // Bittiefe
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

let crcTable: Uint32Array | null = null;
function crc32(buf: Buffer): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
