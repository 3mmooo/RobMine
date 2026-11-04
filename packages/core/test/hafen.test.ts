import { describe, expect, it } from 'vitest';
import { columnGet } from '../src/voxel/Chunk.ts';
import {
  HAFEN_PLAZA_Y,
  HAFEN_PORTAL,
  HAFEN_WATER_Y,
  HafenGenerator,
} from '../src/worldgen/hafen.ts';

const B = {
  bedrock: 11,
  stone: 1,
  sand: 4,
  dirt: 2,
  grass: 3,
  water: 6,
  planks: 23,
  log: 7,
  lamp: 14,
  frame: 22,
  portal: 25,
  leaves: 18,
};

describe('Laternenhafen', () => {
  const gen = new HafenGenerator(42, B);

  it('hat Platz, Portal, Laternen und Meer', () => {
    expect(gen.groundY(0, 4)).toBe(HAFEN_PLAZA_Y);
    for (let y = HAFEN_PORTAL.y0; y < HAFEN_PORTAL.y0 + HAFEN_PORTAL.height; y++)
      expect(gen.blockAt(0, y, HAFEN_PORTAL.z)).toBe(B.portal);
    expect(gen.blockAt(2, HAFEN_PORTAL.y0, HAFEN_PORTAL.z)).toBe(B.frame);
    expect(gen.blockAt(0, HAFEN_PORTAL.y0 + HAFEN_PORTAL.height, HAFEN_PORTAL.z)).toBe(B.frame);
    let lamps = 0;
    for (let x = -16; x <= 16; x++)
      for (let z = -16; z <= 16; z++) if (gen.blockAt(x, HAFEN_PLAZA_Y + 4, z) === B.lamp) lamps++;
    expect(lamps).toBe(8);
    expect(gen.blockAt(120, HAFEN_WATER_Y, 0)).toBe(B.water);
    expect(gen.blockAt(120, HAFEN_WATER_Y + 1, 0)).toBe(0);
    // Steg über dem Wasser
    expect(gen.blockAt(0, HAFEN_WATER_Y + 1, 60)).toBe(B.planks);
  });

  it('Spalten entsprechen blockAt (nahtlos über Spaltengrenzen)', () => {
    for (const [cx, cz] of [
      [0, 0],
      [-1, -1],
      [0, 1],
    ] as const) {
      const col = gen.generateColumn(cx, cz);
      for (let i = 0; i < 300; i++) {
        const lx = (i * 7) & 31;
        const lz = (i * 13) & 31;
        const y = 60 + (i % 20);
        expect(columnGet(col, lx, y, lz)).toBe(gen.blockAt(cx * 32 + lx, y, cz * 32 + lz));
      }
    }
  });
});
