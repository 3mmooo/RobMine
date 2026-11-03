import { meshChunk, meshTransferables } from '@robmine/core';
import { createBlockRegistry } from '@robmine/content';
import type { MeshRequest, MeshResponse } from './jobs.ts';
import { serveWorker } from './rpc.ts';

const registry = createBlockRegistry();

serveWorker<MeshRequest, MeshResponse>((req) => {
  const t0 = performance.now();
  const mesh = meshChunk({ blocks: req.blocks, light: req.light }, registry);
  const ms = performance.now() - t0;
  return {
    res: { key: req.key, cx: req.cx, cy: req.cy, cz: req.cz, mesh, ms },
    transfer: meshTransferables(mesh),
  };
});
