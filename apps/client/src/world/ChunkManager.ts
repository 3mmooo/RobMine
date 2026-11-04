import {
  type BlockRegistry,
  buildPaddedChunk,
  ChunkData,
  columnSet,
  initColumnLight,
  CHUNK_BITS,
  CHUNK_SIZE,
  CHUNKS_PER_COLUMN,
  chunkHasBlocks,
  type ChunkMesh,
  type Column,
  columnGet,
  columnGetLight,
  columnKey,
  createPaddedChunk,
} from '@robmine/core';
import { BLOCK } from '@robmine/content';
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
  /** Bit cy gesetzt = Chunk wurde während eines laufenden Mesh-Jobs geändert (danach erneut meshen). */
  dirtyMask: number;
  /** Nach Kapazitätsüberlauf: ab wann erneut gemesht werden darf. */
  meshRetryAt: number;
}

interface PendingMesh {
  key: string;
  cx: number;
  cy: number;
  cz: number;
  mesh: ChunkMesh;
  /** Identität des Spalteneintrags – veraltete Ergebnisse werden verworfen. */
  entry: ColumnEntry;
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
  opaqueReserved: number;
  pages: number;
  overflow: number;
  optimizes: number;
  retries: number;
}

const UNLOAD_MARGIN = 2;
const MAX_GEN_INFLIGHT_FACTOR = 3;
const MAX_PADDED_PER_UPDATE = 6;
const MAX_UPLOADS_PER_FRAME = 4;
const RETRY_DELAY_MS = 1500;

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
}

/**
 * Lädt Spalten im Radius um die Kamera (Spirale nach Distanz), lässt sie im
 * Gen-Pool erzeugen (inkl. Dekodieren veränderter Chunks und Licht), mesht Chunks im
 * Mesh-Pool, sobald alle 8 Nachbarspalten da sind, und lädt Meshes mit Zeitbudget je
 * Frame in die Batches. Fehlgeschlagene Spalten/Chunks werden nach kurzer Pause erneut
 * versucht.
 */
export class ChunkManager {
  private readonly columns = new Map<string, ColumnEntry>();
  /** Spalten, deren Laden fehlschlug: Schlüssel → Zeitpunkt des nächsten Versuchs. */
  private readonly retryAt = new Map<string, number>();
  private readonly pendingMeshes: PendingMesh[] = [];
  private readonly padded = createPaddedChunk();
  private chunksMeshed = 0;
  private retries = 0;
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
  readonly seed: number;
  /** Welt-ID für die Gen-Worker ('welt' | 'hafen'). */
  world = 'welt';
  radius: number;

  constructor(
    renderer: Renderer,
    connection: Connection,
    genPool: WorkerPool<GenRequest, GenResponse>,
    meshPool: WorkerPool<MeshRequest, MeshResponse>,
    seed: number,
    radius: number,
  ) {
    this.renderer = renderer;
    this.connection = connection;
    this.genPool = genPool;
    this.meshPool = meshPool;
    this.seed = seed;
    this.radius = radius;
  }

  /** Je Frame: weit entfernte Spalten entladen, fehlende anfordern, Meshing anstoßen. */
  update(camX: number, camZ: number): void {
    const ccx = Math.floor(camX / CHUNK_SIZE);
    const ccz = Math.floor(camZ / CHUNK_SIZE);
    const centerChanged =
      !this.lastCenter || this.lastCenter[0] !== ccx || this.lastCenter[1] !== ccz;
    this.lastCenter = [ccx, ccz];

    if (centerChanged) this.unloadFar(ccx, ccz);
    this.requestMissing(ccx, ccz);
    this.scheduleMeshing(ccx, ccz);
  }

  private requestMissing(ccx: number, ccz: number): void {
    const r = this.radius;
    const maxInflight = this.genPool.size * MAX_GEN_INFLIGHT_FACTOR;
    // Drossel über die Einträge in requested/generating – genPool.pending taugt nicht,
    // weil Gen-Jobs erst nach der asynchronen ChunkColumn-Antwort eingereiht werden.
    let inflight = 0;
    for (const e of this.columns.values()) if (e.state !== 'ready') inflight++;
    if (inflight >= maxInflight) return;
    const now = performance.now();
    for (const [dx, dz] of spiralOffsets(r)) {
      if (inflight >= maxInflight) break;
      const cx = ccx + dx;
      const cz = ccz + dz;
      const key = columnKey(cx, cz);
      if (this.columns.has(key)) continue;
      const retry = this.retryAt.get(key);
      if (retry !== undefined) {
        if (now < retry) continue;
        this.retryAt.delete(key);
      }
      const entry: ColumnEntry = {
        cx,
        cz,
        state: 'requested',
        col: null,
        meshedMask: 0,
        meshingMask: 0,
        dirtyMask: 0,
        meshRetryAt: 0,
      };
      this.columns.set(key, entry);
      inflight++;
      void this.loadColumn(entry, dx * dx + dz * dz);
    }
  }

  private async loadColumn(entry: ColumnEntry, priority: number): Promise<void> {
    const key = columnKey(entry.cx, entry.cz);
    try {
      const msg = await this.connection.requestColumn(entry.cx, entry.cz);
      if (this.columns.get(key) !== entry) return; // inzwischen entladen
      entry.state = 'generating';
      // Blobs stammen aus ByteReader.bytes() (eigene Kopien) → Transfer ist sicher.
      const transfer = msg.chunks.map((c) => c.blob.buffer as ArrayBuffer);
      const res = await this.genPool.run(
        {
          world: this.world,
          seed: this.seed,
          cx: entry.cx,
          cz: entry.cz,
          pristineMask: msg.pristineMask,
          chunks: msg.chunks,
        },
        transfer,
        priority,
      );
      if (this.columns.get(key) !== entry) return;
      this.genSamples.push(res.genMs);
      this.lightSamples.push(res.lightMs);
      entry.col = payloadToColumn(res.column);
      entry.state = 'ready';
    } catch (err) {
      if (this.columns.get(key) === entry) this.columns.delete(key);
      if ((err as Error).message !== 'abgebrochen') {
        console.warn('Spalte konnte nicht geladen werden', entry.cx, entry.cz, err);
        this.retryAt.set(key, performance.now() + RETRY_DELAY_MS);
        this.retries++;
      }
    }
  }

  private unloadFar(ccx: number, ccz: number): void {
    const limit = this.radius + UNLOAD_MARGIN;
    for (const [key, e] of this.columns) {
      if (Math.max(Math.abs(e.cx - ccx), Math.abs(e.cz - ccz)) <= limit) continue;
      this.columns.delete(key);
      this.connection.cancelColumn(e.cx, e.cz);
      for (let cy = 0; cy < CHUNKS_PER_COLUMN; cy++) this.removeChunkMesh(chunkKey(e.cx, cy, e.cz));
    }
    for (const key of this.retryAt.keys()) {
      const [kx, kz] = key.split(',').map(Number) as [number, number];
      if (Math.max(Math.abs(kx - ccx), Math.abs(kz - ccz)) > limit) this.retryAt.delete(key);
    }
    this.genPool.prune((req) => Math.max(Math.abs(req.cx - ccx), Math.abs(req.cz - ccz)) <= limit);
    this.meshPool.prune((req) => Math.max(Math.abs(req.cx - ccx), Math.abs(req.cz - ccz)) <= limit);
  }

  private scheduleMeshing(ccx: number, ccz: number): void {
    let built = 0;
    const r = this.radius;
    const now = performance.now();
    for (const [dx, dz] of spiralOffsets(r)) {
      if (built >= MAX_PADDED_PER_UPDATE) break;
      if (this.meshPool.queued > this.meshPool.size * 4) break;
      const e = this.columns.get(columnKey(ccx + dx, ccz + dz));
      if (!e || e.state !== 'ready' || !e.col) continue;
      if ((e.meshedMask | e.meshingMask) === 0xff) continue;
      if (e.meshRetryAt > now) continue;
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
        const height = this.padded.height.slice();
        const baseY = this.padded.baseY;
        const key = chunkKey(e.cx, cy, e.cz);
        const priority = dx * dx + dz * dz;
        this.meshPool
          .run(
            { key, cx: e.cx, cy, cz: e.cz, blocks, light, height, baseY },
            [
              blocks.buffer as ArrayBuffer,
              light.buffer as ArrayBuffer,
              height.buffer as ArrayBuffer,
            ],
            priority,
          )
          .then((res) => {
            this.meshSamples.push(res.ms);
            if (this.columns.get(columnKey(e.cx, e.cz)) !== e) return;
            e.meshingMask &= ~bit;
            if (e.dirtyMask & bit)
              e.dirtyMask &= ~bit; // geändert während des Jobs → erneut meshen
            else e.meshedMask |= bit;
            this.pendingMeshes.push({ key, cx: e.cx, cy, cz: e.cz, mesh: res.mesh, entry: e });
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
   * Zeitbudget (ms) nicht überschritten ist. Verwaiste Ergebnisse (Spalte entladen oder neu
   * angefordert) werden verworfen; bei Kapazitätsüberlauf wird der Chunk später neu gemesht.
   */
  applyPending(minPerFrame = MAX_UPLOADS_PER_FRAME, budgetMs = 3, maxPerFrame = 48): number {
    let n = 0;
    const t0 = performance.now();
    while (this.pendingMeshes.length > 0 && n < maxPerFrame) {
      if (n >= minPerFrame && performance.now() - t0 > budgetMs) break;
      const p = this.pendingMeshes.shift()!;
      if (this.columns.get(columnKey(p.cx, p.cz)) !== p.entry) continue;
      const r = this.renderer;
      let ok = true;
      if (p.mesh.opaque) ok = r.opaque.set(p.key, p.mesh.opaque, p.cx, p.cy, p.cz) && ok;
      else r.opaque.remove(p.key);
      if (p.mesh.cutout) ok = r.cutout.set(p.key, p.mesh.cutout, p.cx, p.cy, p.cz) && ok;
      else r.cutout.remove(p.key);
      if (p.mesh.fluid) ok = r.fluid.set(p.key, p.mesh.fluid, p.cx, p.cy, p.cz) && ok;
      else r.fluid.remove(p.key);
      if (ok) {
        this.chunksMeshed++;
      } else {
        // Kapazität voll: Bit freigeben, nach kurzer Pause erneut meshen.
        p.entry.meshedMask &= ~(1 << p.cy);
        p.entry.meshRetryAt = performance.now() + RETRY_DELAY_MS;
        this.retries++;
      }
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
    if (this.retryAt.size > 0) return false;
    const now = performance.now();
    let meshable = 0;
    for (const e of this.columns.values()) {
      if (e.state !== 'ready') return false;
      if (e.meshRetryAt > now) return false;
      if (!this.neighborsReady(e.cx, e.cz)) continue;
      meshable++;
      if (e.meshedMask !== 0xff) return false;
    }
    return meshable > 0;
  }

  stats(): ChunkStats {
    let loaded = 0;
    for (const e of this.columns.values()) if (e.state === 'ready') loaded++;
    const r = this.renderer;
    return {
      columnsLoaded: loaded,
      columnsRequested: this.columns.size - loaded,
      chunksMeshed: this.chunksMeshed,
      chunksVisible: r.opaque.chunkCount,
      genPending: this.genPool.pending,
      meshPending: this.meshPool.pending,
      uploadsPending: this.pendingMeshes.length,
      genMsAvg: this.genSamples.avg,
      genMsP95: this.genSamples.p95,
      lightMsAvg: this.lightSamples.avg,
      meshMsAvg: this.meshSamples.avg,
      meshMsP95: this.meshSamples.p95,
      paddedMsAvg: this.paddedSamples.avg,
      opaqueVertices: r.opaque.vertexCount,
      opaqueReserved: r.opaque.reservedVertexCount,
      pages: r.opaque.pageCount + r.cutout.pageCount + r.fluid.pageCount,
      overflow: r.opaque.overflowCount + r.cutout.overflowCount + r.fluid.overflowCount,
      optimizes: r.opaque.optimizeCount + r.cutout.optimizeCount + r.fluid.optimizeCount,
      retries: this.retries,
    };
  }

  /** Debug: Zustände der Spalten und Batches (für Tests/Konsole). */
  debugSummary(): Record<string, number> {
    let ready = 0;
    let meshable = 0;
    let fullyMeshed = 0;
    let meshing = 0;
    let retryPending = 0;
    let chunksWithBlocks = 0;
    let chunksInOpaque = 0;
    const now = performance.now();
    for (const e of this.columns.values()) {
      if (e.state !== 'ready') continue;
      ready++;
      if (e.meshingMask) meshing++;
      if (e.meshRetryAt > now) retryPending++;
      if (!this.neighborsReady(e.cx, e.cz)) continue;
      meshable++;
      if (e.meshedMask === 0xff) fullyMeshed++;
      for (let cy = 0; cy < CHUNKS_PER_COLUMN; cy++) {
        if (e.col && chunkHasBlocks(e.col, cy)) chunksWithBlocks++;
        if (this.renderer.opaque.has(chunkKey(e.cx, cy, e.cz))) chunksInOpaque++;
      }
    }
    return {
      entries: this.columns.size,
      ready,
      meshable,
      fullyMeshed,
      meshing,
      retryPending,
      retryAt: this.retryAt.size,
      pendingMeshes: this.pendingMeshes.length,
      chunksWithBlocks,
      chunksInOpaque,
      opaqueEntries: this.renderer.opaque.chunkCount,
      cutoutEntries: this.renderer.cutout.chunkCount,
      fluidEntries: this.renderer.fluid.chunkCount,
    };
  }

  /**
   * Bestätigte Blockänderung (vom Server): Block setzen, Höhenkarte und Licht der Spalte neu
   * berechnen, betroffene Chunks (eigene Spalte ganz, Nachbarspalten um die Änderung herum)
   * neu meshen.
   */
  applyBlockUpdate(x: number, y: number, z: number, block: number, registry: BlockRegistry): void {
    const cx = x >> CHUNK_BITS;
    const cz = z >> CHUNK_BITS;
    const e = this.columns.get(columnKey(cx, cz));
    if (!e || !e.col) return;
    const lx = x & (CHUNK_SIZE - 1);
    const lz = z & (CHUNK_SIZE - 1);
    columnSet(e.col, lx, y, lz, block);
    const hi = lx + lz * CHUNK_SIZE;
    if (block !== 0 && y > e.col.height[hi]!) e.col.height[hi] = y;
    else if (block === 0 && y === e.col.height[hi]) {
      let h = y - 1;
      while (h > 0 && columnGet(e.col, lx, h, lz) === 0) h--;
      e.col.height[hi] = h;
    }
    initColumnLight(e.col, registry);
    const cy = y >> CHUNK_BITS;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const n = this.columns.get(columnKey(cx + dx, cz + dz));
        if (!n || n.state !== 'ready') continue;
        const own = dx === 0 && dz === 0;
        for (let k = 0; k < CHUNKS_PER_COLUMN; k++) {
          if (!own && Math.abs(k - cy) > 1) continue;
          this.invalidateChunk(n, k);
        }
      }
    }
  }

  private invalidateChunk(e: ColumnEntry, cy: number): void {
    const bit = 1 << cy;
    e.meshedMask &= ~bit;
    if (e.meshingMask & bit) e.dirtyMask |= bit;
  }

  /** Blockwert an Weltposition (AIR, wenn die Spalte nicht geladen ist). */
  getBlock(x: number, y: number, z: number): number {
    const e = this.columns.get(columnKey(x >> CHUNK_BITS, z >> CHUNK_BITS));
    if (!e || !e.col) return 0;
    return columnGet(e.col, x & (CHUNK_SIZE - 1), y, z & (CHUNK_SIZE - 1));
  }

  /** Gepackter Lichtwert an Weltposition (voller Himmel, wenn nicht geladen). */
  getLight(x: number, y: number, z: number): number {
    const e = this.columns.get(columnKey(x >> CHUNK_BITS, z >> CHUNK_BITS));
    if (!e || !e.col) return 0xf000;
    return columnGetLight(e.col, x & (CHUNK_SIZE - 1), y, z & (CHUNK_SIZE - 1));
  }

  /** Ist die Spalte an dieser Weltposition geladen? */
  isLoadedAt(x: number, z: number): boolean {
    const e = this.columns.get(columnKey(x >> CHUNK_BITS, z >> CHUNK_BITS));
    return !!e && e.state === 'ready';
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

  /** Erzwingt Neuberechnung des Zentrums (z. B. nach Teleport). */
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
