import { hash2, hash3, hashToUnit } from '../../math/rng.ts';
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
 *   1 Klima + Höhe + Biom je (x,z)   2 Schichten je Biom (Urgestein, Füllung, Deckblock, Wasser)
 *   3 Höhlen (3D-Noise, 9³-Gitter) + Kristalle   4 Bäume je Biom (Hash-Raster, über Spaltengrenzen)
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
  forestGrass: number;
  blossomGrass: number;
  blossomLeaves: number;
  needleLeaves: number;
  moorGrass: number;
  ash: number;
  basalt: number;
  crystal: number;
}

const GRID = 9; // 9×9×9 Noise-Gitter je Chunk (alle 4 Blöcke)
const GRID_STEP = 4;
const gridA = new Float32Array(GRID * GRID * GRID);
const gridB = new Float32Array(GRID * GRID * GRID);
const gridC = new Float32Array(GRID * GRID * GRID);

const TREE_RADIUS = 4;
const SNOW_LINE = 150;
const CRYSTAL_MAX_Y = 40;

type TreeKind = 'hain' | 'riese' | 'bluete' | 'nadel' | 'moor';

/** Kronenschichten relativ zur Stammspitze: [dy, Radius, max. Distanz²]. */
const CROWN: Record<TreeKind, readonly (readonly [number, number, number])[]> = {
  hain: [
    [-2, 2, 5],
    [-1, 3, 10],
    [0, 3, 8],
    [1, 2, 4],
    [2, 1, 1],
  ],
  riese: [
    [-4, 3, 10],
    [-3, 4, 17],
    [-2, 4, 17],
    [-1, 4, 13],
    [0, 3, 10],
    [1, 2, 5],
    [2, 1, 1],
  ],
  bluete: [
    [-2, 2, 5],
    [-1, 3, 10],
    [0, 3, 10],
    [1, 2, 5],
    [2, 1, 1],
  ],
  nadel: [
    [-6, 3, 10],
    [-5, 2, 5],
    [-4, 3, 10],
    [-3, 2, 5],
    [-2, 2, 4],
    [-1, 1, 2],
    [0, 1, 1],
    [1, 0, 0],
  ],
  moor: [
    [-1, 2, 5],
    [0, 2, 4],
    [1, 1, 1],
  ],
};

interface TreeSpec {
  kind: TreeKind;
  /** Anteil belegter Rasterzellen 0–1. */
  density: number;
  minTrunk: number;
  maxTrunk: number;
}

function treeSpecFor(biome: number): TreeSpec | null {
  switch (biome) {
    case Biome.Hainland:
      return { kind: 'hain', density: 0.45, minTrunk: 4, maxTrunk: 6 };
    case Biome.Fluesterwald:
      return { kind: 'riese', density: 0.6, minTrunk: 7, maxTrunk: 11 };
    case Biome.Bluetental:
      return { kind: 'bluete', density: 0.35, minTrunk: 4, maxTrunk: 6 };
    case Biome.Frostkamm:
      return { kind: 'nadel', density: 0.4, minTrunk: 7, maxTrunk: 10 };
    case Biome.Nebelmoor:
      return { kind: 'moor', density: 0.2, minTrunk: 3, maxTrunk: 4 };
    default:
      return null;
  }
}

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

    // 1. Höhen + Biome (+ Moor-Tümpel: Oberfläche 2 tiefer, Wasser darüber)
    const heights = col.height;
    const pool = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
    let minH = WORLD_HEIGHT;
    let maxH = 0;
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const wx = baseX + x;
        const wz = baseZ + z;
        const c = t.climate(wx, wz);
        let h = t.heightFromClimate(wx, wz, c);
        const biome = t.biomeAt(h, c);
        const i = x + z * CHUNK_SIZE;
        if (biome === Biome.Nebelmoor && h > SEA_LEVEL + 3 && t.poolAt(wx, wz)) {
          pool[i] = 1;
          h -= 2;
        }
        heights[i] = h;
        col.biome[i] = biome;
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
      if (y0 > Math.max(maxH + 2, SEA_LEVEL)) {
        chunk.uniformBlock = AIR;
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
          const waterTop = pool[i] ? h + 1 : SEA_LEVEL;
          const filler = this.fillerBlock(biome, h);
          for (let y = y0; y <= y1; y++) {
            let v = AIR;
            if (y === 0) v = B.bedrock;
            else if (
              y <= 2 &&
              hashToUnit(hash2(this.seed ^ 0x6ed, wx * 7 + y, wz * 13)) < 0.6 - y * 0.2
            )
              v = B.bedrock;
            else if (y < h - 3) v = biome === Biome.Aschenfeld ? B.basalt : B.stone;
            else if (y < h) v = filler;
            else if (y === h) v = pool[i] ? B.dirt : this.surfaceBlock(biome, h, wx, wz);
            else if (y <= waterTop) v = B.water;
            if (v !== AIR) arr[i | ((y - y0) << 10)] = v;
          }
        }
      }
    }

    // 3. Höhlen + Kristalle
    this.carveCaves(col, baseX, baseZ, heights);

    // 4. Bäume (auch aus Nachbarspalten hineinragend)
    this.placeTrees(col, baseX, baseZ);

    for (const c of col.chunks) c.compactBlocks();
    return col;
  }

  private fillerBlock(biome: number, h: number): number {
    const B = this.blocks;
    switch (biome) {
      case Biome.Sternenmeer:
      case Biome.Perlkueste:
      case Biome.Glasduenen:
        return B.sand;
      case Biome.Aschenfeld:
        return B.basalt;
      case Biome.Himmelsgrat:
        return B.stone;
      case Biome.Frostkamm:
        return h >= SNOW_LINE - 20 ? B.stone : B.dirt;
      default:
        return B.dirt;
    }
  }

  private surfaceBlock(biome: number, h: number, wx: number, wz: number): number {
    const B = this.blocks;
    switch (biome) {
      case Biome.Sternenmeer:
        return hashToUnit(hash2(this.seed ^ 0x5a, wx, wz)) < 0.25 ? B.gravel : B.sand;
      case Biome.Perlkueste:
      case Biome.Glasduenen:
        return B.sand;
      case Biome.Fluesterwald:
        return B.forestGrass;
      case Biome.Bluetental:
        return B.blossomGrass;
      case Biome.Nebelmoor:
        return B.moorGrass;
      case Biome.Frostkamm:
        return B.snow;
      case Biome.Aschenfeld:
        return B.ash;
      case Biome.Himmelsgrat:
        return h >= SNOW_LINE
          ? B.snow
          : hashToUnit(hash2(this.seed ^ 0x9c, wx, wz)) < 0.3
            ? B.gravel
            : B.stone;
      default:
        return h >= SNOW_LINE ? B.snow : B.grass;
    }
  }

  private carveCaves(col: Column, baseX: number, baseZ: number, heights: Uint8Array): void {
    const t = this.terrain;
    const B = this.blocks;
    for (let cy = 0; cy < CHUNKS_PER_COLUMN; cy++) {
      const chunk = col.chunks[cy]!;
      const y0 = cy << CHUNK_BITS;
      if (chunk.isUniform && chunk.uniformBlock === AIR) continue;
      if (y0 > 200) continue;
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
            if (v !== B.stone && v !== B.dirt && v !== B.basalt) continue;
            const gy = ly >> 2;
            const fy = (ly & 3) / 4;
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
            if (!cave) continue;
            carved = true;
            // Kristalle (farbiges Licht) auf dem Höhlenboden tiefer Grotten.
            const below = ly > 0 ? arr[li - 1024]! : B.stone;
            if (
              y < CRYSTAL_MAX_Y &&
              (below === B.stone || below === B.basalt) &&
              hashToUnit(hash3(this.seed ^ 0xc5, baseX + x, y, baseZ + z)) < 0.035
            ) {
              arr[li] = B.crystal;
            } else {
              arr[li] = AIR;
            }
          }
        }
      }
      if (!carved) chunk.compactBlocks();
    }
  }

  /** Deterministischer Baum-Standort je Biom (Raster 6×6 + Jitter); 0 = kein Baum. */
  treeAt(wx: number, wz: number, biome: number = Biome.Hainland): number {
    const spec = treeSpecFor(biome);
    if (!spec) return 0;
    const cellX = Math.floor(wx / 6);
    const cellZ = Math.floor(wz / 6);
    const h = hash2(this.treeSeed, cellX, cellZ);
    if (hashToUnit(h) > spec.density) return 0;
    const jx = (h >>> 8) % 6;
    const jz = (h >>> 16) % 6;
    if (cellX * 6 + jx !== wx || cellZ * 6 + jz !== wz) return 0;
    return spec.minTrunk + ((h >>> 24) % (spec.maxTrunk - spec.minTrunk + 1));
  }

  private placeTrees(col: Column, baseX: number, baseZ: number): void {
    const B = this.blocks;
    const t = this.terrain;
    for (let dz = -TREE_RADIUS; dz < CHUNK_SIZE + TREE_RADIUS; dz++) {
      for (let dx = -TREE_RADIUS; dx < CHUNK_SIZE + TREE_RADIUS; dx++) {
        const wx = baseX + dx;
        const wz = baseZ + dz;
        const inside = dx >= 0 && dx < CHUNK_SIZE && dz >= 0 && dz < CHUNK_SIZE;
        let h: number;
        let biome: number;
        if (inside) {
          const i = dx + dz * CHUNK_SIZE;
          h = col.height[i]!;
          biome = col.biome[i]!;
          // Tümpel-Zellen tragen keine Bäume (Oberfläche unter Wasser).
          if (columnGet(col, dx, h + 1, dz) === B.water) continue;
        } else {
          const c = t.climate(wx, wz);
          h = t.heightFromClimate(wx, wz, c);
          biome = t.biomeAt(h, c);
          if (biome === Biome.Nebelmoor && h > SEA_LEVEL + 3 && t.poolAt(wx, wz)) continue;
        }
        const spec = treeSpecFor(biome);
        if (!spec) continue;
        const trunk = this.treeAt(wx, wz, biome);
        if (trunk === 0) continue;
        if (h >= SNOW_LINE + 10 || h <= SEA_LEVEL + 2) continue;
        const leaves =
          spec.kind === 'bluete'
            ? B.blossomLeaves
            : spec.kind === 'nadel'
              ? B.needleLeaves
              : B.leaves;
        this.stampTree(col, dx, h + 1, dz, trunk, CROWN[spec.kind], leaves, B.log);
      }
    }
  }

  private stampTree(
    col: Column,
    lx: number,
    baseY: number,
    lz: number,
    trunk: number,
    crown: readonly (readonly [number, number, number])[],
    leaves: number,
    log: number,
  ): void {
    const top = baseY + trunk;
    for (let k = 0; k < crown.length; k++) {
      const [dy, r, maxD2] = crown[k]!;
      const y = top + dy;
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (dx * dx + dz * dz > maxD2) continue;
          const x = lx + dx;
          const z = lz + dz;
          if (x < 0 || x >= CHUNK_SIZE || z < 0 || z >= CHUNK_SIZE) continue;
          if (columnGet(col, x, y, z) === AIR) columnSet(col, x, y, z, leaves);
        }
      }
    }
    if (lx >= 0 && lx < CHUNK_SIZE && lz >= 0 && lz < CHUNK_SIZE) {
      for (let y = baseY; y <= top; y++) columnSet(col, lx, y, lz, log);
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
