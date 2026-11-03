import { hash2, hashToUnit } from '../../math/rng.ts';
import { AIR } from '../../voxel/Block.ts';
import { type Column, columnGet, columnSet, newColumn } from '../../voxel/Chunk.ts';
import {
  CHUNK_BITS,
  CHUNK_SIZE,
  CHUNKS_PER_COLUMN,
  SEA_LEVEL,
  WORLD_HEIGHT,
} from '../../voxel/constants.ts';
import { Biome } from './biomes.ts';
import { isCave, Terrain } from './terrain.ts';

/**
 * Weltgen v1 – deterministisch je (seed, cx, cz), identisch in Worker und Server.
 *
 * Reihenfolge je Spalte:
 *   1 Klima + Höhe je (x,z)      2 Schichten (Urgestein, Stein, Erde, Deckblock, Wasser)
 *   3 Höhlen (3D-Noise, 9³-Gitter)  4 Bäume (Hash-Raster, auch aus Nachbarspalten hineinragend)
 */
export const WORLDGEN_VERSION = 1;

/** Blockrollen, die die Weltgen braucht – die IDs liefert das content-Paket. */
export interface WorldBlocks {
  grass: number;
  dirt: number;
  stone: number;
  sand: number;
  gravel: number;
  water: number;
  log: number;
  leaves: number;
  snow: number;
  bedrock: number;
}

const GRID = 9; // 9×9×9 Noise-Gitter je Chunk (alle 4 Blöcke)
const GRID_STEP = 4;
const gridA = new Float32Array(GRID * GRID * GRID);
const gridB = new Float32Array(GRID * GRID * GRID);
const gridC = new Float32Array(GRID * GRID * GRID);

const TREE_RADIUS = 3;
const SNOW_LINE = 165;
/** Kronenschichten relativ zur Stammspitze: [dy, Radius, max. Distanz²]. */
const CROWN_LAYERS: readonly (readonly [number, number, number])[] = [
  [-2, 2, 5],
  [-1, 3, 10],
  [0, 3, 8],
  [1, 2, 4],
  [2, 1, 1],
];

export class WorldGenerator {
  readonly seed: number;
  readonly terrain: Terrain;
  readonly blocks: WorldBlocks;
  private readonly treeSeed: number;

  constructor(seed: number, blocks: WorldBlocks) {
    this.seed = seed >>> 0;
    this.terrain = new Terrain(this.seed);
    this.blocks = blocks;
    this.treeSeed = (this.seed ^ 0x7bee) >>> 0;
  }

  generateColumn(cx: number, cz: number): Column {
    const col = newColumn(cx, cz);
    const B = this.blocks;
    const t = this.terrain;
    const baseX = cx * CHUNK_SIZE;
    const baseZ = cz * CHUNK_SIZE;

    // 1. Höhen + Biome
    const heights = col.height;
    let minH = WORLD_HEIGHT;
    let maxH = 0;
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const wx = baseX + x;
        const wz = baseZ + z;
        const c = t.climate(wx, wz);
        const h = t.heightFromClimate(wx, wz, c);
        const i = x + z * CHUNK_SIZE;
        heights[i] = h;
        col.biome[i] = t.biomeAt(h, c);
        if (h < minH) minH = h;
        if (h > maxH) maxH = h;
      }
    }

    // 2. Schichten – Chunks, die vollständig unter minH-4 liegen, bleiben uniform Stein.
    const stoneTop = Math.max(0, minH - 4);
    for (let cy = 0; cy < CHUNKS_PER_COLUMN; cy++) {
      const y0 = cy << CHUNK_BITS;
      const y1 = y0 + CHUNK_SIZE - 1;
      const chunk = col.chunks[cy]!;
      if (y1 < stoneTop && y0 > 0) {
        chunk.uniformBlock = B.stone;
        continue;
      }
      if (y0 > Math.max(maxH, SEA_LEVEL)) {
        chunk.uniformBlock = AIR; // reine Luft
        continue;
      }
      const arr = chunk.materializeBlocks();
      for (let z = 0; z < CHUNK_SIZE; z++) {
        for (let x = 0; x < CHUNK_SIZE; x++) {
          const i = x + z * CHUNK_SIZE;
          const h = heights[i]!;
          const biome = col.biome[i]!;
          const wx = baseX + x;
          const wz = baseZ + z;
          for (let y = y0; y <= y1; y++) {
            let v = AIR;
            if (y === 0) v = B.bedrock;
            else if (
              y <= 2 &&
              hashToUnit(hash2(this.seed ^ 0x6ed, wx * 7 + y, wz * 13)) < 0.6 - y * 0.2
            )
              v = B.bedrock;
            else if (y < h - 3) v = B.stone;
            else if (y < h) v = biome === Biome.Hainland && h > SEA_LEVEL + 2 ? B.dirt : B.sand;
            else if (y === h) v = this.surfaceBlock(biome, h, wx, wz);
            else if (y <= SEA_LEVEL) v = B.water;
            if (v !== AIR) arr[i | ((y - y0) << 10)] = v;
          }
        }
      }
    }

    // 3. Höhlen
    this.carveCaves(col, baseX, baseZ, heights);

    // 4. Bäume (auch aus Nachbarspalten hineinragend)
    this.placeTrees(col, baseX, baseZ);

    // Uniform-Chunks zurückverdichten (z. B. ganz Luft über flachem Land).
    for (const c of col.chunks) c.compactBlocks();
    return col;
  }

  private surfaceBlock(biome: number, h: number, wx: number, wz: number): number {
    const B = this.blocks;
    if (biome === Biome.Sternenmeer) {
      return hashToUnit(hash2(this.seed ^ 0x5a, wx, wz)) < 0.25 ? B.gravel : B.sand;
    }
    if (biome === Biome.Perlkueste) return B.sand;
    if (h >= SNOW_LINE) return B.snow;
    return B.grass;
  }

  private carveCaves(col: Column, baseX: number, baseZ: number, heights: Uint8Array): void {
    const t = this.terrain;
    const B = this.blocks;
    for (let cy = 0; cy < CHUNKS_PER_COLUMN; cy++) {
      const chunk = col.chunks[cy]!;
      const y0 = cy << CHUNK_BITS;
      if (chunk.isUniform && chunk.uniformBlock === AIR) continue;
      if (y0 > 200) continue;
      // Gitter füllen
      let gi = 0;
      for (let gy = 0; gy < GRID; gy++) {
        const wy = y0 + gy * GRID_STEP;
        for (let gz = 0; gz < GRID; gz++) {
          const wz = baseZ + gz * GRID_STEP;
          for (let gx = 0; gx < GRID; gx++, gi++) {
            const wx = baseX + gx * GRID_STEP;
            gridA[gi] = t.nCaveA(wx / 96, wy / 96, wz / 96);
            gridB[gi] = t.nCaveB(wx / 96 + 7.1, wy / 96 - 3.3, wz / 96 + 11.9);
            gridC[gi] = t.nCaveC(wx / 48, wy / 48, wz / 48);
          }
        }
      }
      const arr = chunk.materializeBlocks();
      let carved = false;
      for (let z = 0; z < CHUNK_SIZE; z++) {
        const gz = z >> 2;
        const fz = (z & 3) / 4;
        for (let x = 0; x < CHUNK_SIZE; x++) {
          const gx = x >> 2;
          const fx = (x & 3) / 4;
          const h = heights[x + z * CHUNK_SIZE]!;
          for (let ly = 0; ly < CHUNK_SIZE; ly++) {
            const y = y0 + ly;
            if (y >= h - 4 || y < 6) continue;
            const li = x | (z << CHUNK_BITS) | (ly << 10);
            const v = arr[li]!;
            if (v !== B.stone && v !== B.dirt) continue;
            const gy = ly >> 2;
            const fy = (ly & 3) / 4;
            // Spaghetti: beide Noises nahe 0 – zweiten nur auswerten, wenn der erste passt.
            const a = trilinear(gridA, gx, gy, gz, fx, fy, fz);
            let cave = false;
            if (Math.abs(a) < 0.075) {
              const b = trilinear(gridB, gx, gy, gz, fx, fy, fz);
              cave = isCave(a, b, 0, y);
            }
            if (!cave && y < 48) {
              const c = trilinear(gridC, gx, gy, gz, fx, fy, fz);
              cave = isCave(1, 1, c, y);
            }
            if (cave) {
              arr[li] = AIR;
              carved = true;
            }
          }
        }
      }
      if (!carved) chunk.compactBlocks();
    }
  }

  /** Deterministischer Baum-Standort? (nur auf Gras im Hainland, Abstand per Raster + Jitter) */
  treeAt(wx: number, wz: number): number {
    // Raster 6×6 mit Jitter: je Zelle maximal ein Baum.
    const cellX = Math.floor(wx / 6);
    const cellZ = Math.floor(wz / 6);
    const h = hash2(this.treeSeed, cellX, cellZ);
    if (hashToUnit(h) > 0.55) return 0; // Zelle leer
    const jx = (h >>> 8) % 6;
    const jz = (h >>> 16) % 6;
    if (cellX * 6 + jx !== wx || cellZ * 6 + jz !== wz) return 0;
    const height = 4 + ((h >>> 24) % 3); // Stammhöhe 4–6
    return height;
  }

  private placeTrees(col: Column, baseX: number, baseZ: number): void {
    const B = this.blocks;
    const t = this.terrain;
    for (let dz = -TREE_RADIUS; dz < CHUNK_SIZE + TREE_RADIUS; dz++) {
      for (let dx = -TREE_RADIUS; dx < CHUNK_SIZE + TREE_RADIUS; dx++) {
        const wx = baseX + dx;
        const wz = baseZ + dz;
        const trunk = this.treeAt(wx, wz);
        if (trunk === 0) continue;
        const inside = dx >= 0 && dx < CHUNK_SIZE && dz >= 0 && dz < CHUNK_SIZE;
        let h: number;
        let biome: number;
        if (inside) {
          const i = dx + dz * CHUNK_SIZE;
          h = col.height[i]!;
          biome = col.biome[i]!;
        } else {
          const c = t.climate(wx, wz);
          h = t.heightFromClimate(wx, wz, c);
          biome = t.biomeAt(h, c);
        }
        if (biome !== Biome.Hainland || h >= SNOW_LINE || h <= SEA_LEVEL + 2) continue;
        this.stampTree(col, dx, h + 1, dz, trunk, B);
      }
    }
  }

  private stampTree(
    col: Column,
    lx: number,
    baseY: number,
    lz: number,
    trunk: number,
    B: WorldBlocks,
  ): void {
    const top = baseY + trunk;
    // Krone: gerundete Schichten (Radius, max. Distanz²) von unten nach oben.
    for (let k = 0; k < CROWN_LAYERS.length; k++) {
      const [dy, r, maxD2] = CROWN_LAYERS[k]!;
      const y = top + dy;
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (dx * dx + dz * dz > maxD2) continue;
          const x = lx + dx;
          const z = lz + dz;
          if (x < 0 || x >= CHUNK_SIZE || z < 0 || z >= CHUNK_SIZE) continue;
          if (columnGet(col, x, y, z) === AIR) columnSet(col, x, y, z, B.leaves);
        }
      }
    }
    if (lx >= 0 && lx < CHUNK_SIZE && lz >= 0 && lz < CHUNK_SIZE) {
      for (let y = baseY; y <= top; y++) columnSet(col, lx, y, lz, B.log);
    }
  }
}

function trilinear(
  g: Float32Array,
  gx: number,
  gy: number,
  gz: number,
  fx: number,
  fy: number,
  fz: number,
): number {
  const i000 = gx + gz * GRID + gy * GRID * GRID;
  const i100 = i000 + 1;
  const i010 = i000 + GRID * GRID;
  const i110 = i010 + 1;
  const i001 = i000 + GRID;
  const i101 = i001 + 1;
  const i011 = i001 + GRID * GRID;
  const i111 = i011 + 1;
  const c00 = g[i000]! + (g[i100]! - g[i000]!) * fx;
  const c10 = g[i010]! + (g[i110]! - g[i010]!) * fx;
  const c01 = g[i001]! + (g[i101]! - g[i001]!) * fx;
  const c11 = g[i011]! + (g[i111]! - g[i011]!) * fx;
  const c0 = c00 + (c10 - c00) * fy;
  const c1 = c01 + (c11 - c01) * fy;
  return c0 + (c1 - c0) * fz;
}
