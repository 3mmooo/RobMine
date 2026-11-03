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

  it('Himmelslicht: offener Himmel 15, unter Stein 0, Höhleneingang fällt um 1 je Schritt', () => {
    const col = flatColumn(40);
    // Tunnel bei y=41..42 von x=0..10 unter einem Dach (y=43) aus Stein, offen bei x=0 Richtung... wir bauen
    // stattdessen eine Nische: Dach über x=5..15 bei y=41, darunter Luft bei y=41? Einfach: Überhang.
    for (let z = 10; z < 14; z++)
      for (let x = 5; x <= 15; x++) columnSet(col, x, 44, z, blocks.stone);
    initColumnLight(col, reg);
    expect(lightSky(columnGetLight(col, 20, 60, 20))).toBe(15);
    expect(lightSky(columnGetLight(col, 20, 41, 20))).toBe(15);
    expect(lightSky(columnGetLight(col, 20, 10, 20))).toBe(0); // im Stein
    // Direkt unter dem Überhang (x=5, Rand) ist es 14, weiter innen weniger
    const edge = lightSky(columnGetLight(col, 5, 43, 12));
    const inner = lightSky(columnGetLight(col, 10, 43, 12));
    expect(edge).toBeLessThanOrEqual(15);
    expect(edge).toBeGreaterThanOrEqual(13);
    expect(inner).toBeLessThan(edge);
    expect(inner).toBeGreaterThan(0);
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
    // Himmelslicht bleibt unberührt
    expect(lightSky(at(3))).toBe(15);
    // Unter dem Boden kommt nichts an
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
