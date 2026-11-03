import { describe, expect, it } from 'vitest';
import { initColumnLight } from '../src/light/flood.ts';
import { lightB, lightG, lightR, lightSky, packLight } from '../src/light/Light.ts';
import { columnGetLight, columnSet, newColumn } from '../src/voxel/Chunk.ts';
import { CHUNK_SIZE } from '../src/voxel/constants.ts';
import { testRegistry } from './helpers.ts';

const { reg, blocks, torch } = testRegistry();

function flatColumn(h: number) {
  const col = newColumn(0, 0);
  for (let z = 0; z < CHUNK_SIZE; z++)
    for (let x = 0; x < CHUNK_SIZE; x++)
      for (let y = 0; y <= h; y++) columnSet(col, x, y, z, blocks.stone);
  return col;
}

describe('Licht', () => {
  it('packt vier Kanäle verlustfrei', () => {
    const v = packLight(3, 7, 11, 15);
    expect(lightR(v)).toBe(3);
    expect(lightG(v)).toBe(7);
    expect(lightB(v)).toBe(11);
    expect(lightSky(v)).toBe(15);
  });

  it('Himmelslicht: offener Himmel 15, unter Stein 0, unter einem Überhang fällt es ab', () => {
    const col = flatColumn(40);
    // Überhang: Platte x=5..15, z=10..13 bei y=44, darunter Luft.
    for (let z = 10; z < 14; z++)
      for (let x = 5; x <= 15; x++) columnSet(col, x, 44, z, blocks.stone);
    initColumnLight(col, reg);
    expect(lightSky(columnGetLight(col, 20, 60, 20))).toBe(15);
    expect(lightSky(columnGetLight(col, 20, 41, 20))).toBe(15);
    expect(lightSky(columnGetLight(col, 20, 10, 20))).toBe(0); // im Stein
    const edge = lightSky(columnGetLight(col, 5, 43, 12));
    const inner = lightSky(columnGetLight(col, 10, 43, 12));
    expect(edge).toBeLessThanOrEqual(15);
    expect(edge).toBeGreaterThanOrEqual(13);
    expect(inner).toBeLessThan(edge);
    expect(inner).toBeGreaterThan(0);
  });

  it('Platte an einer Chunk-Unterkante über leeren Chunks: Unterseite wird beleuchtet (kein schwarzes Dach)', () => {
    // Boden bis y=40 (cy=1), Chunks cy=2/3 reine Luft, opake Platte in der untersten Lage von cy=4 (y=128).
    const col = flatColumn(40);
    for (let z = 8; z <= 24; z++)
      for (let x = 8; x <= 24; x++) columnSet(col, x, 128, z, blocks.stone);
    initColumnLight(col, reg);
    expect(lightSky(columnGetLight(col, 8, 127, 16))).toBe(14);
    expect(lightSky(columnGetLight(col, 16, 127, 16))).toBe(6);
    // Weiter unten kommt das Licht seitlich von den offenen Nachbarspalten (x=7): 15 − 9 = 6.
    expect(lightSky(columnGetLight(col, 16, 120, 16))).toBe(6);
    expect(lightSky(columnGetLight(col, 16, 129, 16))).toBe(15);
  });

  it('Blocklicht: Fackel strahlt farbig und fällt um 1 je Block', () => {
    const col = flatColumn(40);
    columnSet(col, 16, 41, 16, torch);
    initColumnLight(col, reg);
    const at = (dx: number) => columnGetLight(col, 16 + dx, 41, 16);
    expect(lightR(at(0))).toBe(14);
    expect(lightG(at(0))).toBe(11);
    expect(lightB(at(0))).toBe(6);
    expect(lightR(at(1))).toBe(13);
    expect(lightR(at(3))).toBe(11);
    expect(lightB(at(6))).toBe(0);
    expect(lightR(at(6))).toBe(8);
    expect(lightSky(at(3))).toBe(15);
    expect(lightR(columnGetLight(col, 16, 39, 16))).toBe(0);
  });

  it('Wasser dämpft Himmelslicht', () => {
    const col = flatColumn(30);
    for (let z = 0; z < CHUNK_SIZE; z++)
      for (let x = 0; x < CHUNK_SIZE; x++)
        for (let y = 31; y <= 40; y++) columnSet(col, x, y, z, blocks.water);
    initColumnLight(col, reg);
    expect(lightSky(columnGetLight(col, 10, 41, 10))).toBe(15);
    expect(lightSky(columnGetLight(col, 10, 40, 10))).toBe(14);
    expect(lightSky(columnGetLight(col, 10, 31, 10))).toBe(5);
  });

  it('uniforme Chunks bleiben nach der Berechnung kompakt', () => {
    const col = flatColumn(40);
    initColumnLight(col, reg);
    expect(col.chunks[7]!.isUniformLight).toBe(true);
    expect(col.chunks[0]!.isUniformLight).toBe(true);
    expect(col.chunks[1]!.isUniformLight).toBe(false);
  });
});
