/**
 * Paletten-Kodierung: Ein Chunk mit n verschiedenen Blockwerten wird als
 * Palette (u16[]) + bitgepackte Indizes (1/2/4/8/16 Bit) gespeichert.
 */

export type PaletteBits = 0 | 1 | 2 | 4 | 8 | 16;

export function bitsForPaletteSize(n: number): PaletteBits {
  if (n <= 1) return 0;
  if (n <= 2) return 1;
  if (n <= 4) return 2;
  if (n <= 16) return 4;
  if (n <= 256) return 8;
  return 16;
}

// Gemeinsamer Scratch für buildPalette: Generation-Stempel statt Reset je Aufruf.
const lookupGen = new Uint32Array(65536);
const lookupIdx = new Uint16Array(65536);
let generation = 0;

export interface PaletteResult {
  palette: Uint16Array;
  indices: Uint16Array;
}

/** Erzeugt Palette und Index-Array (Reihenfolge = erstes Auftreten). */
export function buildPalette(values: Uint16Array): PaletteResult {
  generation = (generation + 1) >>> 0;
  if (generation === 0) {
    lookupGen.fill(0);
    generation = 1;
  }
  const gen = generation;
  const indices = new Uint16Array(values.length);
  const palette: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    if (lookupGen[v] !== gen) {
      lookupGen[v] = gen;
      lookupIdx[v] = palette.length;
      palette.push(v);
    }
    indices[i] = lookupIdx[v]!;
  }
  return { palette: Uint16Array.from(palette), indices };
}

export function packedByteLength(bits: PaletteBits, count: number): number {
  return bits === 0 ? 0 : Math.ceil((count * bits) / 8);
}

/** Packt `count` Indizes mit `bits` Bit je Index (LSB-first) in ein Byte-Array. */
export function packIndices(indices: Uint16Array, bits: PaletteBits, count: number): Uint8Array {
  const out = new Uint8Array(packedByteLength(bits, count));
  if (bits === 0) return out;
  if (bits === 8) {
    for (let i = 0; i < count; i++) out[i] = indices[i]! & 0xff;
    return out;
  }
  if (bits === 16) {
    for (let i = 0; i < count; i++) {
      const v = indices[i]!;
      out[i * 2] = v & 0xff;
      out[i * 2 + 1] = (v >>> 8) & 0xff;
    }
    return out;
  }
  const perByte = 8 / bits;
  const mask = (1 << bits) - 1;
  for (let i = 0; i < count; i++) {
    const byte = Math.floor(i / perByte);
    const shift = (i % perByte) * bits;
    out[byte] = out[byte]! | ((indices[i]! & mask) << shift);
  }
  return out;
}

/** Entpackt Indizes; `out` muss mindestens `count` Einträge haben. */
export function unpackIndices(
  packed: Uint8Array,
  bits: PaletteBits,
  count: number,
  out: Uint16Array,
): Uint16Array {
  if (bits === 0) {
    out.fill(0, 0, count);
    return out;
  }
  if (bits === 8) {
    for (let i = 0; i < count; i++) out[i] = packed[i]!;
    return out;
  }
  if (bits === 16) {
    for (let i = 0; i < count; i++) out[i] = packed[i * 2]! | (packed[i * 2 + 1]! << 8);
    return out;
  }
  const perByte = 8 / bits;
  const mask = (1 << bits) - 1;
  for (let i = 0; i < count; i++) {
    const byte = Math.floor(i / perByte);
    const shift = (i % perByte) * bits;
    out[i] = (packed[byte]! >>> shift) & mask;
  }
  return out;
}
