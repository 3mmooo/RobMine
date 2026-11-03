/**
 * Grundkonstanten des Voxel-Datenmodells.
 *
 * Chunk = 32×32×32 Blöcke, Spalte = 8 Chunks (y 0–255).
 * Index-Layout im Chunk: x + (z << 5) + (y << 10) – Zeilen entlang x liegen zusammen.
 */
export const CHUNK_BITS = 5;
export const CHUNK_SIZE = 32;
export const CHUNK_MASK = CHUNK_SIZE - 1;
export const CHUNK_AREA = CHUNK_SIZE * CHUNK_SIZE; // 1024
export const CHUNK_VOLUME = CHUNK_AREA * CHUNK_SIZE; // 32768
export const CHUNKS_PER_COLUMN = 8;
export const WORLD_HEIGHT = CHUNK_SIZE * CHUNKS_PER_COLUMN; // 256
export const SEA_LEVEL = 64;

/** Gepolsterter Chunk (1 Block Rand auf jeder Seite) für das Meshing. */
export const PADDED_SIZE = CHUNK_SIZE + 2; // 34
export const PADDED_AREA = PADDED_SIZE * PADDED_SIZE; // 1156
export const PADDED_VOLUME = PADDED_AREA * PADDED_SIZE; // 39304

/** Blockwert (u16): Bits 0–11 Typ, Bits 12–15 Zustand. */
export const BLOCK_TYPE_MASK = 0x0fff;
export const BLOCK_STATE_SHIFT = 12;
export const MAX_BLOCK_TYPES = 4096;

export function chunkIndex(x: number, y: number, z: number): number {
  return x | (z << CHUNK_BITS) | (y << (CHUNK_BITS * 2));
}

export function paddedIndex(x: number, y: number, z: number): number {
  return x + 1 + (z + 1) * PADDED_SIZE + (y + 1) * PADDED_AREA;
}

export function columnKey(cx: number, cz: number): string {
  return `${cx},${cz}`;
}

export function floorDiv(a: number, b: number): number {
  return Math.floor(a / b);
}

export function worldToChunk(v: number): number {
  return v >> CHUNK_BITS;
}

export function worldToLocal(v: number): number {
  return v & CHUNK_MASK;
}
