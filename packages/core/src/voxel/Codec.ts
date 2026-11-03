import { deflateSync, inflateSync } from 'fflate';
import { ChunkData } from './Chunk.ts';
import { CHUNK_VOLUME } from './constants.ts';
import {
  bitsForPaletteSize,
  buildPalette,
  packIndices,
  packedByteLength,
  unpackIndices,
} from './Palette.ts';
import type { PaletteBits } from './Palette.ts';

/**
 * Chunk-Format RMC1 (Wire und Disk):
 *
 *   u8[4] 'RMC1' · u8 version · u8 flags
 *   flags bit0 = uniform  → u16 Blockwert (gesamt 8 Byte)
 *   flags bit1 = deflate  → u32 rawLen · deflate-raw(payload)
 *   sonst                 → u32 rawLen · payload
 *
 *   payload: u16 paletteLen · u16[paletteLen] · u8 bits · bitgepackte Indizes · u32 metaLen · meta
 *
 * Licht wird nie gespeichert (beim Laden neu berechnet).
 */
export const CHUNK_MAGIC = 'RMC1';
export const CHUNK_FORMAT_VERSION = 1;

const FLAG_UNIFORM = 1;
const FLAG_DEFLATE = 2;
const HEADER_BYTES = 6;
const DEFLATE_THRESHOLD = 64;

// 'RMC1' als Bytes (kein TextEncoder nötig – core bleibt frei von DOM/Node-Typen).
const MAGIC_BYTES = Uint8Array.of(0x52, 0x4d, 0x43, 0x31);

const scratchIndices = new Uint16Array(CHUNK_VOLUME);

export function encodeChunk(chunk: ChunkData): Uint8Array {
  if (chunk.isUniform) {
    const out = new Uint8Array(8);
    const view = new DataView(out.buffer);
    out.set(MAGIC_BYTES, 0);
    out[4] = CHUNK_FORMAT_VERSION;
    out[5] = FLAG_UNIFORM;
    view.setUint16(6, chunk.uniformBlock, true);
    return out;
  }

  const { palette, indices } = buildPalette(chunk.blocks!);
  const bits = bitsForPaletteSize(palette.length);
  const packed = packIndices(indices, bits, CHUNK_VOLUME);
  const rawLen = 2 + palette.length * 2 + 1 + packed.length + 4;
  const raw = new Uint8Array(rawLen);
  const rv = new DataView(raw.buffer);
  let o = 0;
  rv.setUint16(o, palette.length, true);
  o += 2;
  for (let i = 0; i < palette.length; i++, o += 2) rv.setUint16(o, palette[i]!, true);
  raw[o++] = bits;
  raw.set(packed, o);
  o += packed.length;
  rv.setUint32(o, 0, true); // metaLen (reserviert)

  let flags = 0;
  let body = raw;
  if (rawLen > DEFLATE_THRESHOLD) {
    const compressed = deflateSync(raw, { level: 6 });
    if (compressed.length < rawLen) {
      body = compressed;
      flags |= FLAG_DEFLATE;
    }
  }

  const out = new Uint8Array(HEADER_BYTES + 4 + body.length);
  const view = new DataView(out.buffer);
  out.set(MAGIC_BYTES, 0);
  out[4] = CHUNK_FORMAT_VERSION;
  out[5] = flags;
  view.setUint32(6, rawLen, true);
  out.set(body, HEADER_BYTES + 4);
  return out;
}

export function decodeChunk(data: Uint8Array): ChunkData {
  if (data.length < HEADER_BYTES) throw new Error('RMC1: Daten zu kurz');
  for (let i = 0; i < 4; i++) {
    if (data[i] !== MAGIC_BYTES[i]) throw new Error('RMC1: falsches Magic');
  }
  if (data[4] !== CHUNK_FORMAT_VERSION) throw new Error(`RMC1: unbekannte Version ${data[4]}`);
  const flags = data[5]!;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  if (flags & FLAG_UNIFORM) {
    return ChunkData.uniform(view.getUint16(6, true), 0);
  }

  const rawLen = view.getUint32(6, true);
  let raw = data.subarray(HEADER_BYTES + 4);
  if (flags & FLAG_DEFLATE) {
    raw = inflateSync(raw, { out: new Uint8Array(rawLen) });
  }
  if (raw.length < rawLen) throw new Error('RMC1: Payload unvollständig');
  const rv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  let o = 0;
  const paletteLen = rv.getUint16(o, true);
  o += 2;
  const palette = new Uint16Array(paletteLen);
  for (let i = 0; i < paletteLen; i++, o += 2) palette[i] = rv.getUint16(o, true);
  const bits = raw[o++] as PaletteBits;
  const packedLen = packedByteLength(bits, CHUNK_VOLUME);
  const packed = raw.subarray(o, o + packedLen);
  o += packedLen;
  const indices = unpackIndices(packed, bits, CHUNK_VOLUME, scratchIndices);

  const chunk = new ChunkData();
  const blocks = new Uint16Array(CHUNK_VOLUME);
  for (let i = 0; i < CHUNK_VOLUME; i++) blocks[i] = palette[indices[i]!]!;
  chunk.blocks = blocks;
  chunk.compactBlocks();
  return chunk;
}
