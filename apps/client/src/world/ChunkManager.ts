import {
  buildPaddedChunk,
  ChunkData,
  CHUNK_BITS,
  CHUNK_SIZE,
  CHUNKS_PER_COLUMN,
  chunkHasBlocks,
  type Column,
  columnKey,
  createPaddedChunk,
  decodeChunk,
  initColumnLight,
  type BlockRegistry,
} from '@robmine/core';
import { BLOCK } from '@robmine/content';
import type { ChunkMesh } from '@robmine/core';
import type { Renderer } from '../render/Renderer.ts';
import type { Connection } from '../net/Connection.ts';
import type { WorkerPool } from '../workers/rpc.ts';
import type {
  ColumnPayload,
  GenRequest,
  GenResponse,
  MeshRequest,
  MeshResponse,
} from '../workers/jobs.ts';

type ColumnState = 'requested' | 'generating' | 'ready';

interface ColumnEntry {
  cx: number;
  cz: number;
  state: ColumnState;
  col: Column | null;
  /** Bit cy gesetzt = Chunk ist gemesht oder als leer bekannt. */
  meshedMask: number;
  /** Bit cy gesetzt = Mesh-Job läuft. */
  meshingMask: number;
}

interface PendingMesh {
  key: string;
  cx: number;
  cy: number;
  cz: number;
  mesh: ChunkMesh;
}

export interface ChunkStats {
  columnsLoaded: number;
  columnsRequested: number;
  chunksMeshed: number;
  chunksVisible: number;
  genPending: number;
  meshPending: number;
  uploadsPending: number;
  genMsAvg: number;
  genMsP95: number;
  lightMsAvg: number;
  meshMsAvg: number;
  meshMsP95: number;
  paddedMsAvg: number;
  opaqueVertices: number;
  overflow: number;
}

const UNLOAD_MARGIN = 2;
const MAX_GEN_INFLIGHT_FACTOR = 3;
const MAX_PADDED_PER_UPDATE = 6;
const MAX_UPLOADS_PER_FRAME = 4;

class Samples {
  private readonly values: number[] = [];
  push(v: number): void {
    this.values.push(v);
    if (this.values.length > 400) this.values.shift();
  }
  get avg(): number {
    if (!this.values.length) return 0;
    let s = 0;
    for (const v of this.values) s += v;
    return s / this.values.length;
  }
  get p95(): number {
    if (!this.values.length) return 0;
    const sorted = [...this.values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]!;
  }
  get count(): number {
    return this.values.length;
  }
}

/**
 * Lädt Spalten im Radius um die Kamera (Spirale nach Distanz), lässt sie im
 * Gen-Pool erzeugen, mesht Chunks im Mesh-Pool, sobald alle 8 Nachbarspalten da
 * sind, und lädt Meshes mit Upload-Budget je Frame in die Batches.
 */
export class ChunkManager {
  private readonly columns = new Map<string, ColumnEntry>();
  private readonly pendingMeshes: PendingMesh[] = [];
  private readonly padded = createPaddedChunk();
  private chunksMeshed = 0;
  private lastCenter: [number, number] | null = null;
  readonly genSamples = new Samples();
  readonly lightSamples = new Samples();
  readonly meshSamples = new Samples();
  readonly paddedSamples = new Samples();
  private readonly lookup = (cx: number, cz: number): Column | undefined => {
    const e = this.columns.get(columnKey(cx, cz));
    return e && e.state === 'ready' ? (e.col ?? undefined) : undefined;
  };

  private readonly renderer: Renderer;
  private readonly connection: Connection;
  private readonly genPool: WorkerPool<GenRequest, GenResponse>;
  private readonly meshPool: WorkerPool<MeshRequest, MeshResponse>;
  private readonly registry: BlockRegistry;
  readonly seed: number;
  radius: number;

  constructor(
    renderer: Renderer,
    connection: Connection,
    genPool: WorkerPool<GenRequest, GenResponse>,
    meshPool: WorkerPool<MeshRequest, MeshResponse>,
    registry: BlockRegistry,
    seed: number,
    radius: number,
  ) {
    this.renderer = renderer;
    this.connection = connection;
    this.genPool = genPool;
    this.meshPool = meshPool;
    this.registry = registry;
    this.seed = seed;
    this.radius = radius;
  }

  /** Spalten im Radius anfordern, Meshing anstoßen, weit entfernte entladen. */
  update(camX: number, camZ: number): void {
    const ccx = Math.floor(camX / CHUNK_SIZE);
    const ccz = Math.floor(camZ / CHUNK_SIZE);
    const centerChanged =
      !this.lastCenter || this.lastCenter[0] !== ccx || this.lastCenter[1] !== ccz;
    this.lastCenter = [ccx, ccz];

    if (centerChanged) {
      this.requestMissing(ccx, ccz);
      this.unloadFar(ccx, ccz);
    }
    this.scheduleMeshing(ccx, ccz);
  }

  private requestMissing(ccx: number, ccz: number): void {
    const r = this.radius;
    const maxInflight = this.genPool.size * MAX_GEN_INFLIGHT_FACTOR;
    // Spirale: alle Offsets nach Distanz sortiert (einmal je Radius berechnet).
    for (const [dx, dz] of spiralOffsets(r)) {
      if (this.genPool.pending >= maxInflight) break;
      const cx = ccx + dx;
      const cz = ccz + dz;
      const key = columnKey(cx, cz);
      if (this.columns.has(key)) continue;
      const entry: ColumnEntry = {
        cx,
        cz,
        state: 'requested',
        col: null,
        meshedMask: 0,
        meshingMask: 0,
      };
      this.columns.set(key, entry);
      void this.loadColumn(entry, dx * dx + dz * dz);
    }
  }

  private async loadColumn(entry: ColumnEntry, priority: number): Promise<void> {
    const key = columnKey(entry.cx, entry.cz);
    try {
      const msg = await this.connection.requestColumn(entry.cx, entry.cz);
      if (this.columns.get(key) !== entry) return; // inzwischen entladen
      entry.state = 'generating';
      let col: Column;
      if (msg.pristineMask === 0xff) {
        // Seed-Streaming: unveränderte Spalte selbst erzeugen.
        const res = await this.genPool.run(
          { seed: this.seed, cx: entry.cx, cz: entry.cz },
          [],
          priority,
        );
        if (this.columns.get(key) !== entry) return;
        this.genSamples.push(res.genMs);
        this.lightSamples.push(res.lightMs);
        col = payloadToColumn(res.column);
      } else {
        // Veränderte Spalte vom Server: Blobs dekodieren, fehlende Chunks (pristine) generieren.
        const res = await this.genPool.run(
          { seed: this.seed, cx: entry.cx, cz: entry.cz },
          [],
          priority,
        );
        if (this.columns.get(key) !== entry) return;
        col = payloadToColumn(res.column);
        for (const c of msg.chunks) col.chunks[c.cy] = decodeChunk(c.blob);
        initColumnLight(col, this.registry);
      }
      entry.col = col;
      entry.state = 'ready';
      // Nach Nachbar-Ankunft dürfen angrenzende Spalten meshen – passiert im nächsten scheduleMeshing.
    } catch (err) {
      if ((err as Error).message !== 'abgebrochen')
        console.warn('Spalte konnte nicht geladen werden', entry.cx, entry.cz, err);
      if (this.columns.get(key) === entry) this.columns.delete(key);
    }
  }

  private unloadFar(ccx: number, ccz: number): void {
    const limit = this.radius + UNLOAD_MARGIN;
    for (const [key, e] of this.columns) {
      const dx = e.cx - ccx;
      const dz = e.cz - ccz;
      if (Math.max(Math.abs(dx), Math.abs(dz)) <= limit) continue;
      this.columns.delete(key);
      this.connection.cancelColumn(e.cx, e.cz);
      for (let cy = 0; cy < CHUNKS_PER_COLUMN; cy++) this.removeChunkMesh(chunkKey(e.cx, cy, e.cz));
    }
    this.genPool.prune((req) => Math.max(Math.abs(req.cx - ccx), Math.abs(req.cz - ccz)) <= limit);
    this.meshPool.prune((req) => Math.max(Math.abs(req.cx - ccx), Math.abs(req.cz - ccz)) <= limit);
  }

  private scheduleMeshing(ccx: number, ccz: number): void {
    let built = 0;
    const r = this.radius;
    for (const [dx, dz] of spiralOffsets(r)) {
      if (built >= MAX_PADDED_PER_UPDATE) break;
      if (this.meshPool.queued > this.meshPool.size * 4) break;
      const e = this.columns.get(columnKey(ccx + dx, ccz + dz));
      if (!e || e.state !== 'ready' || !e.col) continue;
      if ((e.meshedMask | e.meshingMask) === 0xff) continue;
      if (!this.neighborsReady(e.cx, e.cz)) continue;
      for (let cy = 0; cy < CHUNKS_PER_COLUMN && built < MAX_PADDED_PER_UPDATE; cy++) {
        const bit = 1 << cy;
        if ((e.meshedMask | e.meshingMask) & bit) continue;
        if (!chunkHasBlocks(e.col, cy)) {
          e.meshedMask |= bit;
          continue;
        }
        const t0 = performance.now();
        const any = buildPaddedChunk(this.lookup, e.cx, cy, e.cz, this.padded, BLOCK.Urgestein);
        this.paddedSamples.push(performance.now() - t0);
        if (!any) {
          e.meshedMask |= bit;
          continue;
        }
        built++;
        e.meshingMask |= bit;
        const blocks = this.padded.blocks.slice();
        const light = this.padded.light.slice();
        const key = chunkKey(e.cx, cy, e.cz);
        const priority = dx * dx + dz * dz;
        this.meshPool
          .run(
            { key, cx: e.cx, cy, cz: e.cz, blocks, light },
            [blocks.buffer as ArrayBuffer, light.buffer as ArrayBuffer],
            priority,
          )
          .then((res) => {
            this.meshSamples.push(res.ms);
            if (this.columns.get(columnKey(e.cx, e.cz)) !== e) return;
            e.meshingMask &= ~bit;
            e.meshedMask |= bit;
            this.pendingMeshes.push({ key, cx: e.cx, cy, cz: e.cz, mesh: res.mesh });
          })
          .catch((err: Error) => {
            e.meshingMask &= ~bit;
            if (err.message !== 'abgebrochen') console.warn('Meshing fehlgeschlagen', key, err);
          });
      }
    }
  }

  private neighborsReady(cx: number, cz: number): boolean {
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dz === 0) continue;
        const e = this.columns.get(columnKey(cx + dx, cz + dz));
        if (!e || e.state !== 'ready') return false;
      }
    }
    return true;
  }

  /**
   * Lädt fertige Meshes in die Batches: mindestens `minPerFrame`, danach weiter, solange das
   * Zeitbudget (ms) nicht überschritten ist – bei niedriger Framerate laden wir so mehr je Frame.
   */
  applyPending(minPerFrame = MAX_UPLOADS_PER_FRAME, budgetMs = 3, maxPerFrame = 48): number {
    let n = 0;
    const t0 = performance.now();
    while (this.pendingMeshes.length > 0 && n < maxPerFrame) {
      if (n >= minPerFrame && performance.now() - t0 > budgetMs) break;
      const p = this.pendingMeshes.shift()!;
      const r = this.renderer;
      if (p.mesh.opaque) r.opaque.set(p.key, p.mesh.opaque, p.cx, p.cy, p.cz);
      else r.opaque.remove(p.key);
      if (p.mesh.cutout) r.cutout.set(p.key, p.mesh.cutout, p.cx, p.cy, p.cz);
      else r.cutout.remove(p.key);
      if (p.mesh.fluid) r.fluid.set(p.key, p.mesh.fluid, p.cx, p.cy, p.cz);
      else r.fluid.remove(p.key);
      this.chunksMeshed++;
      n++;
    }
    if (n > 0) {
      this.renderer.opaque.maybeOptimize();
      this.renderer.cutout.maybeOptimize();
      this.renderer.fluid.maybeOptimize();
    }
    return n;
  }

  private removeChunkMesh(key: string): void {
    this.renderer.opaque.remove(key);
    this.renderer.cutout.remove(key);
    this.renderer.fluid.remove(key);
  }

  /**
   * Alles geladen und gemesht? Gemesht werden nur Spalten, deren 8 Nachbarn geladen sind –
   * am Rand der (kreisförmigen) Laderegion bleiben Spalten absichtlich ungemesht.
   */
  get settled(): boolean {
    if (!this.lastCenter) return false;
    if (this.genPool.pending > 0 || this.meshPool.pending > 0 || this.pendingMeshes.length > 0) {
      return false;
    }
    let meshable = 0;
    for (const e of this.columns.values()) {
      if (e.state !== 'ready') return false;
      if (!this.neighborsReady(e.cx, e.cz)) continue;
      meshable++;
      if (e.meshedMask !== 0xff) return false;
    }
    return meshable > 0;
  }

  stats(): ChunkStats {
    let loaded = 0;
    for (const e of this.columns.values()) if (e.state === 'ready') loaded++;
    return {
      columnsLoaded: loaded,
      columnsRequested: this.columns.size - loaded,
      chunksMeshed: this.chunksMeshed,
      chunksVisible: this.renderer.opaque.chunkCount,
      genPending: this.genPool.pending,
      meshPending: this.meshPool.pending,
      uploadsPending: this.pendingMeshes.length,
      genMsAvg: this.genSamples.avg,
      genMsP95: this.genSamples.p95,
      lightMsAvg: this.lightSamples.avg,
      meshMsAvg: this.meshSamples.avg,
      meshMsP95: this.meshSamples.p95,
      paddedMsAvg: this.paddedSamples.avg,
      opaqueVertices: this.renderer.opaque.vertexCount,
      overflow:
        this.renderer.opaque.overflowCount +
        this.renderer.cutout.overflowCount +
        this.renderer.fluid.overflowCount,
    };
  }

  /** Höhe der Oberfläche an Weltposition, falls die Spalte geladen ist. */
  surfaceHeight(x: number, z: number): number | undefined {
    const e = this.columns.get(columnKey(x >> CHUNK_BITS, z >> CHUNK_BITS));
    if (!e || !e.col) return undefined;
    return e.col.height[(x & (CHUNK_SIZE - 1)) + (z & (CHUNK_SIZE - 1)) * CHUNK_SIZE];
  }

  get columnCount(): number {
    return this.columns.size;
  }

  /** Erzwingt Neuladen (z. B. nach Teleport weit weg). */
  resetCenter(): void {
    this.lastCenter = null;
  }
}

export function chunkKey(cx: number, cy: number, cz: number): string {
  return `${cx},${cy},${cz}`;
}

function payloadToColumn(p: ColumnPayload): Column {
  const chunks: ChunkData[] = p.chunks.map((c) => {
    const d = new ChunkData();
    d.uniformBlock = c.uniformBlock;
    d.uniformLight = c.uniformLight;
    d.blocks = c.blocks;
    d.light = c.light;
    return d;
  });
  return { cx: p.cx, cz: p.cz, chunks, height: p.height, biome: p.biome };
}

const spiralCache = new Map<number, [number, number][]>();

/** Alle Offsets im Quadrat ±r, sortiert nach Distanz (kreisförmige Ladereihenfolge). */
export function spiralOffsets(r: number): [number, number][] {
  let list = spiralCache.get(r);
  if (list) return list;
  list = [];
  for (let dz = -r; dz <= r; dz++)
    for (let dx = -r; dx <= r; dx++)
      if (dx * dx + dz * dz <= (r + 0.5) * (r + 0.5)) list.push([dx, dz]);
  list.sort((a, b) => a[0] * a[0] + a[1] * a[1] - (b[0] * b[0] + b[1] * b[1]));
  spiralCache.set(r, list);
  return list;
}
