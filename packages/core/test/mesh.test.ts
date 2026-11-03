import { describe, expect, it } from 'vitest';
import { createPaddedChunk, meshChunk, type PaddedChunk } from '../src/mesh/greedy.ts';
import { buildPaddedChunk } from '../src/mesh/padded.ts';
import { FLAG_FLUID_TOP, NORMAL_PY } from '../src/mesh/VertexFormat.ts';
import { LIGHT_FULL_SKY, newColumn, columnSet } from '../src/voxel/Chunk.ts';
import { CHUNK_SIZE, paddedIndex } from '../src/voxel/constants.ts';
import { testRegistry } from './helpers.ts';

const { reg, blocks, glass } = testRegistry();

function emptyPadded(): PaddedChunk {
  const p = createPaddedChunk();
  p.light.fill(LIGHT_FULL_SKY);
  return p;
}

function set(p: PaddedChunk, x: number, y: number, z: number, v: number): void {
  p.blocks[paddedIndex(x, y, z)] = v;
}

describe('Greedy Mesher', () => {
  it('ein Block → 6 Quads, 24 Vertices, 36 Indizes', () => {
    const p = emptyPadded();
    set(p, 5, 5, 5, blocks.stone);
    const m = meshChunk(p, reg);
    expect(m.quadCount).toBe(6);
    expect(m.opaque!.vertexCount).toBe(24);
    expect(m.opaque!.indexCount).toBe(36);
    expect(m.cutout).toBeNull();
    expect(m.fluid).toBeNull();
  });

  it('zwei benachbarte Blöcke → 6 Quads (innere Flächen verdeckt, Außenflächen verschmolzen)', () => {
    const p = emptyPadded();
    set(p, 5, 5, 5, blocks.stone);
    set(p, 6, 5, 5, blocks.stone);
    const m = meshChunk(p, reg);
    expect(m.quadCount).toBe(6);
    expect(m.opaque!.vertexCount).toBe(24);
    // Mindestens ein Quad ist 2 Blöcke breit (u- oder v-Koordinate 2).
    let wide = false;
    for (let i = 0; i < m.opaque!.vertexCount; i++) {
      if (m.opaque!.data[i * 4 + 2] === 2 || m.opaque!.data[i * 4 + 3] === 2) wide = true;
    }
    expect(wide).toBe(true);
  });

  it('zwei verschiedene benachbarte Blöcke → 10 Quads (nicht verschmolzen)', () => {
    const p = emptyPadded();
    set(p, 5, 5, 5, blocks.stone);
    set(p, 6, 5, 5, blocks.dirt);
    expect(meshChunk(p, reg).quadCount).toBe(10);
  });

  it('eine 32×32-Platte → 6 Quads (voll verschmolzen)', () => {
    const p = emptyPadded();
    for (let z = 0; z < CHUNK_SIZE; z++)
      for (let x = 0; x < CHUNK_SIZE; x++) set(p, x, 3, z, blocks.stone);
    const m = meshChunk(p, reg);
    expect(m.quadCount).toBe(6);
  });

  it('ein voller Chunk ohne Rand → 6 Quads; mit opakem Rand → 0 Quads', () => {
    const p = emptyPadded();
    for (let y = 0; y < CHUNK_SIZE; y++)
      for (let z = 0; z < CHUNK_SIZE; z++)
        for (let x = 0; x < CHUNK_SIZE; x++) set(p, x, y, z, blocks.stone);
    expect(meshChunk(p, reg).quadCount).toBe(6);
    p.blocks.fill(blocks.stone);
    expect(meshChunk(p, reg).quadCount).toBe(0);
  });

  it('Schachbrett erzeugt für jeden Block 6 Flächen', () => {
    const p = emptyPadded();
    let n = 0;
    for (let y = 0; y < CHUNK_SIZE; y++)
      for (let z = 0; z < CHUNK_SIZE; z++)
        for (let x = 0; x < CHUNK_SIZE; x++)
          if ((x + y + z) % 2 === 0) {
            set(p, x, y, z, blocks.stone);
            n++;
          }
    expect(meshChunk(p, reg).quadCount).toBe(n * 6);
  });

  it('AO: Ecke neben einer Wand ist dunkler als freie Ecke', () => {
    const p = emptyPadded();
    // Boden 3×3 bei y=0 und eine Wand bei x=0 (y=1)
    for (let z = 0; z < 3; z++) for (let x = 0; x < 3; x++) set(p, x, 0, z, blocks.stone);
    for (let z = 0; z < 3; z++) set(p, 0, 1, z, blocks.stone);
    const m = meshChunk(p, reg);
    const data = m.opaque!.data;
    const pos = m.opaque!.position;
    let darkFound = false;
    let brightFound = false;
    for (let i = 0; i < m.opaque!.vertexCount; i++) {
      const normal = data[i * 4]! & 7;
      if (normal !== NORMAL_PY) continue;
      const y = pos[i * 3 + 1]!;
      if (y !== 1) continue; // Oberseite des Bodens
      const x = pos[i * 3]!;
      const ao = data[i * 4 + 1]! & 3;
      if (x === 1) {
        // direkt an der Wand
        expect(ao).toBeLessThan(3);
        darkFound = true;
      }
      if (x === 3) {
        expect(ao).toBe(3);
        brightFound = true;
      }
    }
    expect(darkFound).toBe(true);
    expect(brightFound).toBe(true);
  });

  it('Wasser-Oberfläche landet im Fluid-Pass mit Flag, Blätter im Cutout-Pass', () => {
    const p = emptyPadded();
    set(p, 2, 2, 2, blocks.water);
    set(p, 2, 1, 2, blocks.sand);
    set(p, 8, 8, 8, blocks.leaves);
    set(p, 9, 8, 8, blocks.leaves);
    set(p, 12, 8, 8, glass);
    const m = meshChunk(p, reg);
    expect(m.fluid).not.toBeNull();
    // Wasser hat 5 sichtbare Flächen (Unterseite liegt auf Sand).
    expect(m.fluid!.indexCount / 6).toBe(5);
    let topFlag = false;
    for (let i = 0; i < m.fluid!.vertexCount; i++) {
      const d = m.fluid!.data[i * 4]!;
      if ((d & 7) === NORMAL_PY) expect(d >>> 3).toBe(FLAG_FLUID_TOP);
      if ((d & 7) === NORMAL_PY) topFlag = true;
    }
    expect(topFlag).toBe(true);
    // Zwei Blätterblöcke: innere Fläche verdeckt, Außenflächen verschmolzen → 6 Quads; Glas: 6 Quads
    expect(m.cutout!.indexCount / 6).toBe(12);
    // Sand unter Wasser: Oberseite bleibt sichtbar (Wasser ist nicht opak), Unterseite+Seiten sichtbar → 6
    expect(m.opaque!.indexCount / 6).toBe(6);
  });

  it('Flächen am Chunkrand werden durch den Rand (Nachbar-Chunk) verdeckt', () => {
    const p = emptyPadded();
    set(p, 0, 5, 5, blocks.stone);
    expect(meshChunk(p, reg).quadCount).toBe(6);
    set(p, -1, 5, 5, blocks.stone); // Nachbar im Rand
    expect(meshChunk(p, reg).quadCount).toBe(5);
  });

  it('buildPaddedChunk holt Nachbarspalten und Weltgrenzen korrekt', () => {
    const a = newColumn(0, 0);
    const b = newColumn(1, 0);
    columnSet(a, 31, 10, 7, blocks.stone);
    columnSet(b, 0, 10, 7, blocks.dirt);
    const lookup = (cx: number, cz: number) =>
      cx === 0 && cz === 0 ? a : cx === 1 && cz === 0 ? b : undefined;
    const p = createPaddedChunk();
    const any = buildPaddedChunk(lookup, 0, 0, 0, p, blocks.bedrock);
    expect(any).toBe(true);
    expect(p.blocks[paddedIndex(31, 10, 7)]).toBe(blocks.stone);
    expect(p.blocks[paddedIndex(32, 10, 7)]).toBe(blocks.dirt);
    expect(p.blocks[paddedIndex(5, -1, 5)]).toBe(blocks.bedrock);
    expect(p.light[paddedIndex(5, 5, 5)]).toBe(LIGHT_FULL_SKY);
    // Der Stein-Block grenzt an Erde im Nachbarchunk → nur 5 Flächen
    expect(meshChunk(p, reg).quadCount).toBe(5);
  });
});
