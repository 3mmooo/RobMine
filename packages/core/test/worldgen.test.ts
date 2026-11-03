import { describe, expect, it } from 'vitest';
import { WorldGenerator } from '../src/worldgen/v1/pipeline.ts';
import { Biome } from '../src/worldgen/v1/biomes.ts';
import { columnGet, columnMaterializedChunks } from '../src/voxel/Chunk.ts';
import { CHUNK_SIZE, SEA_LEVEL, WORLD_HEIGHT } from '../src/voxel/constants.ts';
import { AIR } from '../src/voxel/Block.ts';
import { hashU16, testRegistry } from './helpers.ts';

const { blocks } = testRegistry();

function columnHash(gen: WorldGenerator, cx: number, cz: number): string {
  const col = gen.generateColumn(cx, cz);
  const parts: string[] = [];
  for (const c of col.chunks)
    parts.push(c.isUniform ? `u${c.uniformBlock}` : hashU16(c.blocks).toString(16));
  return parts.join('|');
}

describe('Weltgen v1', () => {
  it('ist deterministisch: gleicher Seed → gleiche Spalte, anderer Seed → andere', () => {
    const a = new WorldGenerator(42, blocks);
    const b = new WorldGenerator(42, blocks);
    const c = new WorldGenerator(43, blocks);
    for (const [cx, cz] of [
      [0, 0],
      [3, -2],
      [-7, 11],
    ] as const) {
      expect(columnHash(a, cx, cz)).toBe(columnHash(b, cx, cz));
    }
    expect(columnHash(a, 0, 0)).not.toBe(columnHash(c, 0, 0));
  });

  it('Höhen liegen in [1, 250] und die Oberfläche ist konsistent', () => {
    const gen = new WorldGenerator(42, blocks);
    for (const [cx, cz] of [
      [0, 0],
      [5, 5],
      [-3, 2],
      [20, -20],
    ] as const) {
      const col = gen.generateColumn(cx, cz);
      for (let z = 0; z < CHUNK_SIZE; z++) {
        for (let x = 0; x < CHUNK_SIZE; x++) {
          const h = col.height[x + z * CHUNK_SIZE]!;
          expect(h).toBeGreaterThanOrEqual(1);
          expect(h).toBeLessThanOrEqual(250);
          // Oberflächenblock ist fest, darüber Luft oder Wasser (oder Baum).
          expect(columnGet(col, x, h, z)).not.toBe(AIR);
          const above = columnGet(col, x, h + 1, z);
          const okAbove =
            above === AIR ||
            above === blocks.water ||
            above === blocks.log ||
            above === blocks.leaves ||
            above === blocks.blossomLeaves ||
            above === blocks.needleLeaves;
          expect(okAbove).toBe(true);
          expect(columnGet(col, x, 0, z)).toBe(blocks.bedrock);
        }
      }
    }
  });

  it('Wasser füllt bis zum Meeresspiegel, Sand am Strand', () => {
    const gen = new WorldGenerator(42, blocks);
    let water = 0;
    let beach = 0;
    for (let cx = -12; cx <= 12; cx += 3) {
      for (let cz = -12; cz <= 12; cz += 3) {
        const col = gen.generateColumn(cx, cz);
        for (let z = 0; z < CHUNK_SIZE; z++) {
          for (let x = 0; x < CHUNK_SIZE; x++) {
            const i = x + z * CHUNK_SIZE;
            const h = col.height[i]!;
            if (h < SEA_LEVEL) {
              water++;
              expect(columnGet(col, x, SEA_LEVEL, z)).toBe(blocks.water);
              expect(col.biome[i]).not.toBe(Biome.Hainland);
            }
            if (col.biome[i] === Biome.Perlkueste) {
              beach++;
              expect(columnGet(col, x, h, z)).toBe(blocks.sand);
            }
          }
        }
      }
    }
    expect(water).toBeGreaterThan(0);
    expect(beach).toBeGreaterThan(0);
  });

  it('Uniform-Chunks werden genutzt (Luft oben, Stein unten)', () => {
    const gen = new WorldGenerator(42, blocks);
    const col = gen.generateColumn(0, 0);
    expect(columnMaterializedChunks(col)).toBeLessThanOrEqual(4);
    expect(col.chunks[7]!.isUniform).toBe(true);
    expect(col.chunks[7]!.uniformBlock).toBe(AIR);
  });

  it('erzeugt Bäume mit Stamm und Krone, auch über Spaltengrenzen hinweg', () => {
    const gen = new WorldGenerator(42, blocks);
    let logs = 0;
    let leaves = 0;
    for (let cx = 0; cx < 4; cx++) {
      for (let cz = 0; cz < 4; cz++) {
        const col = gen.generateColumn(cx, cz);
        for (let z = 0; z < CHUNK_SIZE; z++) {
          for (let x = 0; x < CHUNK_SIZE; x++) {
            for (let y = 60; y < WORLD_HEIGHT; y++) {
              const v = columnGet(col, x, y, z);
              if (v === blocks.log) logs++;
              else if (v === blocks.leaves) leaves++;
            }
          }
        }
      }
    }
    expect(logs).toBeGreaterThan(20);
    expect(leaves).toBeGreaterThan(logs);
    // Baum-Standorte sind deterministisch und liegen genau auf ihrer Rasterzelle.
    let spots = 0;
    for (let x = -100; x < 100; x++)
      for (let z = -100; z < 100; z++) if (gen.treeAt(x, z) > 0) spots++;
    expect(spots).toBeGreaterThan(200);
    expect(spots).toBeLessThan(800);
  });

  it('Höhlen existieren unter der Oberfläche', () => {
    const gen = new WorldGenerator(42, blocks);
    let airUnderground = 0;
    for (let cx = 0; cx < 3; cx++) {
      for (let cz = 0; cz < 3; cz++) {
        const col = gen.generateColumn(cx, cz);
        for (let z = 0; z < CHUNK_SIZE; z++) {
          for (let x = 0; x < CHUNK_SIZE; x++) {
            const h = col.height[x + z * CHUNK_SIZE]!;
            for (let y = 6; y < h - 4; y++) if (columnGet(col, x, y, z) === AIR) airUnderground++;
          }
        }
      }
    }
    expect(airUnderground).toBeGreaterThan(100);
  });
});
