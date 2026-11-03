import {
  AIR,
  CHUNK_BITS,
  CHUNK_MASK,
  CHUNKS_PER_COLUMN,
  type Column,
  columnGet,
  columnSet,
  decodeChunk,
  encodeChunk,
  type WorldGenerator,
  WORLD_HEIGHT,
  WORLDGEN_VERSION,
} from '@robmine/core';
import {
  BlockActionKind,
  type ClientMessage,
  decodeFrame,
  encodeFrames,
  type Message,
  PROTOCOL_VERSION,
  type ServerMessage,
  type Transport,
} from '@robmine/protocol';
import type { ColumnStorage } from './ColumnStorage.ts';
import { World } from './World.ts';

export interface InstanceOptions {
  seed: number;
  spawn: [number, number, number];
  /** 0 Solo, 1 Lagerfeuer, 2 Scherbe, 3 Hub */
  mode?: number;
  timeOfDay?: number;
  /** Erzeugt Spalten, die zum ersten Mal verändert werden. Ohne Generator: keine Blockaktionen. */
  generator?: WorldGenerator;
  /** Persistenz veränderter Spalten. */
  storage?: ColumnStorage;
  /** Menge der setzbaren Blocktypen (Validierung); undefined = alle. */
  placeable?: ReadonlySet<number>;
  /** Unzerstörbare Blöcke. */
  unbreakable?: ReadonlySet<number>;
  /** Verzögerung bis zum Speichern nach einer Änderung (ms). */
  saveDelayMs?: number;
}

type SessionState = 'awaitingHello' | 'active' | 'closed';

/**
 * Der Instanz-Kern: Hello/Welcome, Seed-Streaming (unveränderte Spalten werden nicht
 * übertragen), Blockaktionen (autoritativ: validieren → Welt ändern → BlockUpdate an den
 * Client → verzögert speichern). Läuft identisch im Browser-Worker (Solo) und auf dem Server.
 */
export class LocalInstance {
  readonly world: World;
  readonly spawn: [number, number, number];
  readonly mode: number;
  timeOfDay: number;
  tick = 0;
  private nextPlayerId = 1;
  private state: SessionState = 'awaitingHello';
  private readonly outbox: ServerMessage[] = [];
  private flushScheduled = false;
  private readonly transport: Transport;
  private readonly generator: WorldGenerator | null;
  private readonly storage: ColumnStorage | null;
  private readonly placeable: ReadonlySet<number> | null;
  private readonly unbreakable: ReadonlySet<number>;
  private readonly saveDelayMs: number;
  private readonly dirty = new Set<string>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly loading = new Map<string, Promise<Column | null>>();
  /** Offene asynchrone Arbeit (Tests warten darauf). */
  private pendingWork: Promise<unknown> = Promise.resolve();

  constructor(transport: Transport, opts: InstanceOptions) {
    this.transport = transport;
    this.world = new World(opts.seed);
    this.spawn = opts.spawn;
    this.mode = opts.mode ?? 0;
    this.timeOfDay = opts.timeOfDay ?? 600;
    this.generator = opts.generator ?? null;
    this.storage = opts.storage ?? null;
    this.placeable = opts.placeable ?? null;
    this.unbreakable = opts.unbreakable ?? new Set();
    this.saveDelayMs = opts.saveDelayMs ?? 1500;
    transport.onFrame((data) => this.handleFrame(data));
    transport.onClose(() => {
      this.state = 'closed';
    });
  }

  get sessionState(): SessionState {
    return this.state;
  }

  /** Wartet, bis alle laufenden Lade-/Speichervorgänge abgeschlossen sind. */
  idle(): Promise<unknown> {
    return this.pendingWork;
  }

  private isClosed(): boolean {
    return this.state === 'closed';
  }

  private handleFrame(data: Uint8Array): void {
    if (this.state === 'closed') return;
    let frame;
    try {
      frame = decodeFrame(data);
    } catch (err) {
      this.kick(`Ungültiger Rahmen: ${(err as Error).message}`);
      return;
    }
    for (const m of frame.messages) {
      this.handleMessage(m as ClientMessage);
      if (this.isClosed()) return;
    }
  }

  private handleMessage(m: ClientMessage | Message): void {
    if (m.op !== 'Hello' && this.state !== 'active') {
      this.kick('Hello erwartet');
      return;
    }
    switch (m.op) {
      case 'Hello':
        if (this.state === 'active') {
          this.kick('Doppeltes Hello');
          return;
        }
        if (m.protoVer !== PROTOCOL_VERSION) {
          this.kick(`Protokollversion ${m.protoVer} wird nicht unterstützt`);
          return;
        }
        this.state = 'active';
        this.send({
          op: 'Welcome',
          playerId: this.nextPlayerId++,
          worldSeed: this.world.seed,
          worldgenVersion: WORLDGEN_VERSION,
          spawn: this.spawn,
          timeOfDay: this.timeOfDay,
          mode: this.mode,
        });
        break;
      case 'Ping':
        this.send({ op: 'Pong', clientTime: m.clientTime, serverTick: this.tick });
        break;
      case 'ChunkRequest':
        this.track(this.answerChunkRequest(m.cx, m.cz));
        break;
      case 'BlockAction':
        this.track(this.applyBlockAction(m.kind, m.x, m.y, m.z, m.block));
        break;
      default:
        break;
    }
  }

  private track(p: Promise<unknown>): void {
    const safe = p.catch((err) => console.error('[LocalInstance]', err));
    this.pendingWork = this.pendingWork.then(() => safe);
  }

  private async answerChunkRequest(cx: number, cz: number): Promise<void> {
    const col = await this.loadColumn(cx, cz, false);
    if (this.isClosed()) return;
    this.send(this.buildChunkColumn(cx, cz, col));
  }

  /** Spalte aus Welt, Speicher oder (bei `create`) Generator. */
  private loadColumn(cx: number, cz: number, create: boolean): Promise<Column | null> {
    const existing = this.world.getColumn(cx, cz);
    if (existing) return Promise.resolve(existing);
    const key = `${cx},${cz}`;
    let p = this.loading.get(key);
    if (!p) {
      p = (async () => {
        if (this.storage) {
          const blobs = await this.storage.load(cx, cz);
          if (blobs && blobs.length === CHUNKS_PER_COLUMN) {
            const col = this.generator
              ? this.generator.generateColumn(cx, cz)
              : { cx, cz, chunks: [], height: new Uint8Array(1024), biome: new Uint8Array(1024) };
            col.chunks = blobs.map((b) => decodeChunk(b));
            this.world.setColumn(col);
            return col;
          }
        }
        if (create && this.generator) {
          const col = this.generator.generateColumn(cx, cz);
          this.world.setColumn(col);
          return col;
        }
        return null;
      })().finally(() => this.loading.delete(key));
      this.loading.set(key, p);
    }
    return p;
  }

  buildChunkColumn(cx: number, cz: number, col: Column | null): ServerMessage {
    if (!col) return { op: 'ChunkColumn', cx, cz, pristineMask: 0xff, chunks: [] };
    const chunks: { cy: number; blob: Uint8Array }[] = [];
    for (let cy = 0; cy < CHUNKS_PER_COLUMN; cy++)
      chunks.push({ cy, blob: encodeChunk(col.chunks[cy]!) });
    return { op: 'ChunkColumn', cx, cz, pristineMask: 0, chunks };
  }

  private async applyBlockAction(
    kind: number,
    x: number,
    y: number,
    z: number,
    block: number,
  ): Promise<void> {
    if (!this.generator) return;
    if (y < 1 || y >= WORLD_HEIGHT) return;
    const col = await this.loadColumn(x >> CHUNK_BITS, z >> CHUNK_BITS, true);
    if (!col || this.isClosed()) return;
    const lx = x & CHUNK_MASK;
    const lz = z & CHUNK_MASK;
    const current = columnGet(col, lx, y, lz);
    let next: number;
    if (kind === BlockActionKind.Break) {
      if (current === AIR || this.unbreakable.has(current & 0xfff)) return;
      next = AIR;
    } else if (kind === BlockActionKind.Place) {
      if (current !== AIR && !this.isReplaceable(current)) return;
      if (block === AIR || (this.placeable && !this.placeable.has(block & 0xfff))) return;
      next = block;
    } else return;
    columnSet(col, lx, y, lz, next);
    const i = lx + lz * 32;
    if (next !== AIR && y > col.height[i]!) col.height[i] = y;
    else if (next === AIR && y === col.height[i]) {
      let h = y - 1;
      while (h > 0 && columnGet(col, lx, h, lz) === AIR) h--;
      col.height[i] = h;
    }
    this.send({ op: 'BlockUpdate', updates: [{ x, y, z, block: next }] });
    this.markDirty(col);
  }

  private isReplaceable(block: number): boolean {
    // Wasser darf überbaut werden (Phase 2: keine Flüssigkeitssimulation).
    return this.replaceable.has(block & 0xfff);
  }

  /** Blocktypen, die beim Setzen ersetzt werden dürfen (z. B. Wasser). */
  readonly replaceable = new Set<number>();

  private markDirty(col: Column): void {
    this.dirty.add(`${col.cx},${col.cz}`);
    if (!this.storage) return;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.track(this.saveDirty());
    }, this.saveDelayMs);
  }

  /** Speichert alle veränderten Spalten sofort. */
  async saveDirty(): Promise<void> {
    if (!this.storage) return;
    const keys = Array.from(this.dirty);
    this.dirty.clear();
    for (const key of keys) {
      const [cx, cz] = key.split(',').map(Number) as [number, number];
      const col = this.world.getColumn(cx, cz);
      if (!col) continue;
      await this.storage.save(
        cx,
        cz,
        col.chunks.map((c) => encodeChunk(c)),
      );
    }
  }

  private kick(reason: string): void {
    if (this.state === 'closed') return;
    this.outbox.push({ op: 'Kick', reason });
    this.flush();
    this.state = 'closed';
    this.transport.close();
  }

  private send(m: ServerMessage): void {
    if (this.state === 'closed') return;
    this.outbox.push(m);
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    queueMicrotask(() => this.flush());
  }

  flush(): void {
    this.flushScheduled = false;
    if (this.outbox.length === 0) return;
    const batch = this.outbox.splice(0);
    for (const frame of encodeFrames(this.tick, batch)) this.transport.send(frame);
  }

  close(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
      this.track(this.saveDirty());
    }
    this.state = 'closed';
    this.transport.close();
  }
}
