import type { Column } from '../voxel/Chunk.ts';
import { LIGHT_FULL_SKY } from '../voxel/Chunk.ts';
import { AIR } from '../voxel/Block.ts';
import {
  CHUNK_BITS,
  CHUNK_MASK,
  CHUNK_SIZE,
  CHUNKS_PER_COLUMN,
  chunkIndex,
  paddedIndex,
} from '../voxel/constants.ts';
import type { PaddedChunk } from './greedy.ts';

export type ColumnLookup = (cx: number, cz: number) => Column | undefined;

/**
 * Baut den gepolsterten 34³-Eingabeblock für das Meshing von Chunk (cx, cy, cz)
 * aus der Spalte und ihren 8 horizontalen Nachbarn.
 *
 * Außerhalb der Welt: oben Luft mit vollem Himmelslicht, unten `belowBlock` (opak).
 * Fehlende Nachbarspalten werden wie Luft behandelt – der Aufrufer sollte sie
 * vorher laden, sonst entstehen sichtbare Ränder.
 */
export function buildPaddedChunk(
  lookup: ColumnLookup,
  cx: number,
  cy: number,
  cz: number,
  out: PaddedChunk,
  belowBlock: number,
): boolean {
  const { blocks, light } = out;
  let anyBlock = false;

  for (let pz = -1; pz <= CHUNK_SIZE; pz++) {
    const ncz = cz + (pz < 0 ? -1 : pz >= CHUNK_SIZE ? 1 : 0);
    const lz = pz & CHUNK_MASK;
    for (let px = -1; px <= CHUNK_SIZE; px++) {
      const ncx = cx + (px < 0 ? -1 : px >= CHUNK_SIZE ? 1 : 0);
      const lx = px & CHUNK_MASK;
      const col = lookup(ncx, ncz);
      for (let py = -1; py <= CHUNK_SIZE; py++) {
        const y = (cy << CHUNK_BITS) + py;
        const i = paddedIndex(px, py, pz);
        if (!col) {
          blocks[i] = AIR;
          light[i] = LIGHT_FULL_SKY;
          continue;
        }
        if (y < 0) {
          blocks[i] = belowBlock;
          light[i] = 0;
          continue;
        }
        if (y >= CHUNKS_PER_COLUMN * CHUNK_SIZE) {
          blocks[i] = AIR;
          light[i] = LIGHT_FULL_SKY;
          continue;
        }
        const chunk = col.chunks[y >> CHUNK_BITS]!;
        const ci = chunkIndex(lx, y & CHUNK_MASK, lz);
        const v = chunk.getIndex(ci);
        blocks[i] = v;
        light[i] = chunk.getLightIndex(ci);
        if (
          v !== AIR &&
          px >= 0 &&
          px < CHUNK_SIZE &&
          py >= 0 &&
          py < CHUNK_SIZE &&
          pz >= 0 &&
          pz < CHUNK_SIZE
        ) {
          anyBlock = true;
        }
      }
    }
  }
  return anyBlock;
}

/** Schnelltest: hat der Chunk selbst (ohne Rand) überhaupt Blöcke? */
export function chunkHasBlocks(col: Column, cy: number): boolean {
  const c = col.chunks[cy]!;
  if (c.isUniform) return c.uniformBlock !== AIR;
  return true;
}
