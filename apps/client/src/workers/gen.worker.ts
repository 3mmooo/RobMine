import {
  decodeChunk,
  initColumnLight,
  recomputeColumnHeights,
  WorldGenerator,
} from '@robmine/core';
import { createBlockRegistry, WORLD_BLOCKS } from '@robmine/content';
import type { ColumnPayload, GenRequest, GenResponse } from './jobs.ts';
import { serveWorker } from './rpc.ts';

const registry = createBlockRegistry();
let generator: WorldGenerator | null = null;

/**
 * Erzeugt eine Spalte aus dem Seed, ersetzt veränderte Chunks durch die Server-Blobs
 * (Seed-Streaming) und berechnet das Licht – alles im Worker, der Main-Thread
 * packt nur noch Typed Arrays um.
 */
serveWorker<GenRequest, GenResponse>((req) => {
  if (!generator || generator.seed !== req.seed >>> 0)
    generator = new WorldGenerator(req.seed, WORLD_BLOCKS);
  const t0 = performance.now();
  const col = generator.generateColumn(req.cx, req.cz);
  if (req.chunks.length > 0) {
    for (const c of req.chunks) col.chunks[c.cy] = decodeChunk(c.blob);
    recomputeColumnHeights(col);
  }
  const t1 = performance.now();
  initColumnLight(col, registry);
  const t2 = performance.now();

  const transfer: ArrayBuffer[] = [
    col.height.buffer as ArrayBuffer,
    col.biome.buffer as ArrayBuffer,
  ];
  const column: ColumnPayload = {
    cx: col.cx,
    cz: col.cz,
    height: col.height,
    biome: col.biome,
    chunks: col.chunks.map((c) => {
      if (c.blocks) transfer.push(c.blocks.buffer as ArrayBuffer);
      if (c.light) transfer.push(c.light.buffer as ArrayBuffer);
      return {
        uniformBlock: c.uniformBlock,
        uniformLight: c.uniformLight,
        blocks: c.blocks,
        light: c.light,
      };
    }),
  };
  return { res: { column, ms: t2 - t0, genMs: t1 - t0, lightMs: t2 - t1 }, transfer };
});
