import { describe, expect, it } from 'vitest';
import { ChunkData, columnGet, columnSet, newColumn } from '../src/voxel/Chunk.ts';
import { blockState, blockType, makeBlock } from '../src/voxel/Block.ts';
import {
  CHUNK_SIZE,
  CHUNK_VOLUME,
  chunkIndex,
  PADDED_SIZE,
  PADDED_VOLUME,
  paddedIndex,
} from '../src/voxel/constants.ts';
import { decodeChunk, encodeChunk } from '../src/voxel/Codec.ts';
import {
  bitsForPaletteSize,
  buildPalette,
  packIndices,
  unpackIndices,
} from '../src/voxel/Palette.ts';
import { createRng } from '../src/math/rng.ts';
import { testRegistry } from './helpers.ts';

describe('Chunk-Index', () => {
  it('ist für alle Koordinaten eindeutig und umkehrbar', () => {
    const seen = new Uint8Array(CHUNK_VOLUME);
    for (let y = 0; y < CHUNK_SIZE; y++) {
      for (let z = 0; z < CHUNK_SIZE; z++) {
        for (let x = 0; x < CHUNK_SIZE; x++) {
          const i = chunkIndex(x, y, z);
          expect(i).toBeGreaterThanOrEqual(0);
          expect(i).toBeLessThan(CHUNK_VOLUME);
          expect(seen[i]).toBe(0);
          seen[i] = 1;
          expect(i & 31).toBe(x);
          expect((i >>> 5) & 31).toBe(z);
          expect(i >>> 10).toBe(y);
        }
      }
    }
  });

  it('gepolsterter Index deckt -1..32 ab', () => {
    expect(paddedIndex(-1, -1, -1)).toBe(0);
    expect(paddedIndex(32, 32, 32)).toBe(PADDED_VOLUME - 1);
    expect(paddedIndex(0, 0, 0)).toBe(1 + PADDED_SIZE + PADDED_SIZE * PADDED_SIZE);
  });

  it('Blockwert packt Typ und Zustand', () => {
    const v = makeBlock(4095, 9);
    expect(blockType(v)).toBe(4095);
    expect(blockState(v)).toBe(9);
    expect(makeBlock(7)).toBe(7);
  });
});

describe('ChunkData', () => {
  it('bleibt uniform, bis ein abweichender Wert gesetzt wird', () => {
    const c = ChunkData.uniform(5, 0);
    expect(c.isUniform).toBe(true);
    c.set(1, 2, 3, 5);
    expect(c.isUniform).toBe(true);
    c.set(1, 2, 3, 6);
    expect(c.isUniform).toBe(false);
    expect(c.get(1, 2, 3)).toBe(6);
    expect(c.get(0, 0, 0)).toBe(5);
    c.set(1, 2, 3, 5);
    expect(c.compactBlocks()).toBe(true);
    expect(c.isUniform).toBe(true);
  });

  it('Spalte liest und schreibt über Chunkgrenzen hinweg', () => {
    const col = newColumn(0, 0);
    columnSet(col, 3, 200, 4, 9);
    expect(columnGet(col, 3, 200, 4)).toBe(9);
    expect(col.chunks[6]!.isUniform).toBe(false);
    expect(col.chunks[5]!.isUniform).toBe(true);
    expect(columnGet(col, 3, 300, 4)).toBe(0);
  });
});

describe('Palette', () => {
  it('wählt die Bitbreite nach Palettengröße', () => {
    expect(bitsForPaletteSize(1)).toBe(0);
    expect(bitsForPaletteSize(2)).toBe(1);
    expect(bitsForPaletteSize(3)).toBe(2);
    expect(bitsForPaletteSize(16)).toBe(4);
    expect(bitsForPaletteSize(17)).toBe(8);
    expect(bitsForPaletteSize(257)).toBe(16);
  });

  it.each([1, 2, 4, 8, 16] as const)('packt und entpackt %i Bit verlustfrei', (bits) => {
    const count = 1000;
    const max = 1 << bits;
    const rng = createRng(bits);
    const indices = new Uint16Array(count);
    for (let i = 0; i < count; i++) indices[i] = Math.floor(rng() * max);
    const packed = packIndices(indices, bits, count);
    expect(packed.length).toBe(Math.ceil((count * bits) / 8));
    const out = unpackIndices(packed, bits, count, new Uint16Array(count));
    expect(Array.from(out)).toEqual(Array.from(indices));
  });

  it('baut die Palette in Reihenfolge des ersten Auftretens', () => {
    const values = Uint16Array.from([7, 7, 3, 7, 9, 3]);
    const { palette, indices } = buildPalette(values);
    expect(Array.from(palette)).toEqual([7, 3, 9]);
    expect(Array.from(indices)).toEqual([0, 0, 1, 0, 2, 1]);
  });
});

describe('Codec RMC1', () => {
  it('uniformer Chunk ist 8 Byte und kommt identisch zurück', () => {
    const c = ChunkData.uniform(42, 0);
    const data = encodeChunk(c);
    expect(data.length).toBe(8);
    const back = decodeChunk(data);
    expect(back.isUniform).toBe(true);
    expect(back.uniformBlock).toBe(42);
  });

  it('zufälliger Chunk mit 300 Paletteneinträgen überlebt den Roundtrip', () => {
    const c = new ChunkData();
    const arr = c.materializeBlocks();
    const rng = createRng(123);
    for (let i = 0; i < CHUNK_VOLUME; i++) arr[i] = 100 + Math.floor(rng() * 300);
    const back = decodeChunk(encodeChunk(c));
    expect(back.isUniform).toBe(false);
    expect(Array.from(back.blocks!)).toEqual(Array.from(arr));
  });

  it('Chunk mit wenigen Typen überlebt den Roundtrip (2-Bit-Pfad)', () => {
    const c = new ChunkData();
    const arr = c.materializeBlocks();
    for (let i = 0; i < CHUNK_VOLUME; i++) arr[i] = [0, 1, 3][i % 3]!;
    const back = decodeChunk(encodeChunk(c));
    expect(Array.from(back.blocks!)).toEqual(Array.from(arr));
  });

  it('ein typischer Oberflächen-Chunk ist kleiner als 4 KB', () => {
    const { blocks } = testRegistry();
    const c = new ChunkData();
    const arr = c.materializeBlocks();
    // Hügelige Oberfläche: Stein bis h-3, Erde, Gras, darüber Luft.
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const h = 10 + Math.round(6 * Math.sin(x / 5) * Math.cos(z / 7)) + 6;
        for (let y = 0; y < CHUNK_SIZE; y++) {
          let v = 0;
          if (y < h - 3) v = blocks.stone;
          else if (y < h) v = blocks.dirt;
          else if (y === h) v = blocks.grass;
          arr[chunkIndex(x, y, z)] = v;
        }
      }
    }
    const data = encodeChunk(c);
    expect(data.length).toBeLessThan(4096);
    expect(decodeChunk(data).blocks).toEqual(arr);
  });

  it('lehnt falsches Magic ab', () => {
    expect(() => decodeChunk(Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8))).toThrow(/Magic/);
  });
});
