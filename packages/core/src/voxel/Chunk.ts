import { AIR } from './Block.ts';
import {
  CHUNK_AREA,
  CHUNK_BITS,
  CHUNK_MASK,
  CHUNK_VOLUME,
  CHUNKS_PER_COLUMN,
  chunkIndex,
  WORLD_HEIGHT,
} from './constants.ts';

/** Lichtwert für "voller Himmel, kein Blocklicht". */
export const LIGHT_FULL_SKY = 0xf000;

/**
 * Ein 32³-Chunk. Blöcke und Licht liegen in Typed Arrays – oder, wenn der
 * gesamte Chunk denselben Wert hat (Luft über der Welt, Stein darunter),
 * nur als ein einzelner Wert ohne Array ("uniform").
 */
export class ChunkData {
  blocks: Uint16Array | null = null;
  uniformBlock = AIR;
  light: Uint16Array | null = null;
  uniformLight = 0;

  static uniform(block: number, light: number): ChunkData {
    const c = new ChunkData();
    c.uniformBlock = block;
    c.uniformLight = light;
    return c;
  }

  get isUniform(): boolean {
    return this.blocks === null;
  }

  get isUniformLight(): boolean {
    return this.light === null;
  }

  get(x: number, y: number, z: number): number {
    const b = this.blocks;
    return b === null ? this.uniformBlock : b[chunkIndex(x, y, z)]!;
  }

  getIndex(i: number): number {
    const b = this.blocks;
    return b === null ? this.uniformBlock : b[i]!;
  }

  set(x: number, y: number, z: number, value: number): void {
    this.setIndex(chunkIndex(x, y, z), value);
  }

  setIndex(i: number, value: number): void {
    let b = this.blocks;
    if (b === null) {
      if (value === this.uniformBlock) return;
      b = this.materializeBlocks();
    }
    b[i] = value;
  }

  materializeBlocks(): Uint16Array {
    if (this.blocks) return this.blocks;
    const b = new Uint16Array(CHUNK_VOLUME);
    if (this.uniformBlock !== 0) b.fill(this.uniformBlock);
    this.blocks = b;
    return b;
  }

  getLight(x: number, y: number, z: number): number {
    const l = this.light;
    return l === null ? this.uniformLight : l[chunkIndex(x, y, z)]!;
  }

  getLightIndex(i: number): number {
    const l = this.light;
    return l === null ? this.uniformLight : l[i]!;
  }

  setLight(x: number, y: number, z: number, value: number): void {
    this.setLightIndex(chunkIndex(x, y, z), value);
  }

  setLightIndex(i: number, value: number): void {
    let l = this.light;
    if (l === null) {
      if (value === this.uniformLight) return;
      l = this.materializeLight();
    }
    l[i] = value;
  }

  materializeLight(): Uint16Array {
    if (this.light) return this.light;
    const l = new Uint16Array(CHUNK_VOLUME);
    if (this.uniformLight !== 0) l.fill(this.uniformLight);
    this.light = l;
    return l;
  }

  /** Macht den Chunk wieder uniform, falls alle Blöcke gleich sind. Liefert true, wenn uniform. */
  compactBlocks(): boolean {
    const b = this.blocks;
    if (b === null) return true;
    const v = b[0]!;
    for (let i = 1; i < CHUNK_VOLUME; i++) if (b[i] !== v) return false;
    this.blocks = null;
    this.uniformBlock = v;
    return true;
  }

  compactLight(): boolean {
    const l = this.light;
    if (l === null) return true;
    const v = l[0]!;
    for (let i = 1; i < CHUNK_VOLUME; i++) if (l[i] !== v) return false;
    this.light = null;
    this.uniformLight = v;
    return true;
  }
}

/** Eine Spalte aus 8 Chunks mit Höhen- und Biomkarte. */
export interface Column {
  cx: number;
  cz: number;
  chunks: ChunkData[];
  /** Höchster nicht-Luft-Block je (x,z) – Index x + z*32. */
  height: Uint8Array;
  /** Biom-ID je (x,z). */
  biome: Uint8Array;
}

export function newColumn(cx: number, cz: number): Column {
  const chunks: ChunkData[] = [];
  for (let i = 0; i < CHUNKS_PER_COLUMN; i++) chunks.push(ChunkData.uniform(AIR, LIGHT_FULL_SKY));
  return { cx, cz, chunks, height: new Uint8Array(CHUNK_AREA), biome: new Uint8Array(CHUNK_AREA) };
}

export function columnGet(col: Column, x: number, y: number, z: number): number {
  if (y < 0 || y >= WORLD_HEIGHT) return AIR;
  return col.chunks[y >> CHUNK_BITS]!.get(x, y & CHUNK_MASK, z);
}

export function columnSet(col: Column, x: number, y: number, z: number, value: number): void {
  if (y < 0 || y >= WORLD_HEIGHT) return;
  col.chunks[y >> CHUNK_BITS]!.set(x, y & CHUNK_MASK, z, value);
}

export function columnGetLight(col: Column, x: number, y: number, z: number): number {
  if (y < 0) return 0;
  if (y >= WORLD_HEIGHT) return LIGHT_FULL_SKY;
  return col.chunks[y >> CHUNK_BITS]!.getLight(x, y & CHUNK_MASK, z);
}

export function columnSetLight(col: Column, x: number, y: number, z: number, value: number): void {
  if (y < 0 || y >= WORLD_HEIGHT) return;
  col.chunks[y >> CHUNK_BITS]!.setLight(x, y & CHUNK_MASK, z, value);
}

/** Anzahl der nicht-uniformen Chunks (grobe Speicherkennzahl). */
export function columnMaterializedChunks(col: Column): number {
  let n = 0;
  for (const c of col.chunks) if (!c.isUniform) n++;
  return n;
}

/** Berechnet die Höhenkarte (oberster Nicht-Luft-Block je (x,z)) neu, z. B. nach Blockänderungen. */
export function recomputeColumnHeights(col: Column): void {
  for (let z = 0; z < CHUNK_SIZE_LOCAL; z++) {
    for (let x = 0; x < CHUNK_SIZE_LOCAL; x++) {
      let h = 0;
      for (let cy = CHUNKS_PER_COLUMN - 1; cy >= 0 && h === 0; cy--) {
        const chunk = col.chunks[cy]!;
        if (chunk.isUniform) {
          if (chunk.uniformBlock !== AIR) h = (cy << CHUNK_BITS) + CHUNK_SIZE_LOCAL - 1;
          continue;
        }
        for (let ly = CHUNK_SIZE_LOCAL - 1; ly >= 0; ly--) {
          if (chunk.blocks![chunkIndex(x, ly, z)] !== AIR) {
            h = (cy << CHUNK_BITS) + ly;
            break;
          }
        }
      }
      col.height[x + z * CHUNK_SIZE_LOCAL] = h;
    }
  }
}

const CHUNK_SIZE_LOCAL = 1 << CHUNK_BITS;
