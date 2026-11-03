import { CHUNKS_PER_COLUMN, encodeChunk, WORLDGEN_VERSION } from '@robmine/core';
import {
  type ClientMessage,
  decodeFrame,
  encodeFrame,
  type Message,
  PROTOCOL_VERSION,
  type ServerMessage,
  type Transport,
} from '@robmine/protocol';
import { World } from './World.ts';

export interface InstanceOptions {
  seed: number;
  spawn: [number, number, number];
  /** 0 Solo, 1 Lagerfeuer, 2 Scherbe, 3 Hub */
  mode?: number;
  timeOfDay?: number;
}

/**
 * Der Instanz-Kern (Phase 0): beantwortet Hello mit Welcome, ChunkRequest mit
 * ChunkColumn. Unveränderte Spalten werden NICHT übertragen – der Client erzeugt
 * sie selbst aus dem Seed (Seed-Streaming); nur veränderte Chunks gehen als Blobs.
 *
 * Läuft identisch im Browser-Worker (Solo) und später auf dem Server.
 */
export class LocalInstance {
  readonly world: World;
  readonly spawn: [number, number, number];
  readonly mode: number;
  timeOfDay: number;
  tick = 0;
  private nextPlayerId = 1;
  private readonly outbox: ServerMessage[] = [];
  private flushScheduled = false;
  private readonly transport: Transport;

  constructor(transport: Transport, opts: InstanceOptions) {
    this.transport = transport;
    this.world = new World(opts.seed);
    this.spawn = opts.spawn;
    this.mode = opts.mode ?? 0;
    this.timeOfDay = opts.timeOfDay ?? 600;
    transport.onFrame((data) => this.handleFrame(data));
  }

  private handleFrame(data: Uint8Array): void {
    let frame;
    try {
      frame = decodeFrame(data);
    } catch (err) {
      this.send({ op: 'Kick', reason: `Ungültiger Rahmen: ${(err as Error).message}` });
      return;
    }
    for (const m of frame.messages) this.handleMessage(m as ClientMessage);
  }

  private handleMessage(m: ClientMessage | Message): void {
    switch (m.op) {
      case 'Hello':
        if (m.protoVer !== PROTOCOL_VERSION) {
          this.send({
            op: 'Kick',
            reason: `Protokollversion ${m.protoVer} wird nicht unterstützt`,
          });
          return;
        }
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
        this.send(this.buildChunkColumn(m.cx, m.cz));
        break;
      default:
        // Server-Nachrichten vom Client werden ignoriert.
        break;
    }
  }

  buildChunkColumn(cx: number, cz: number): ServerMessage {
    const col = this.world.getColumn(cx, cz);
    if (!col) {
      return { op: 'ChunkColumn', cx, cz, pristineMask: 0xff, chunks: [] };
    }
    // Veränderte Spalte: alle Chunks als Blobs (Phase 0 kennt noch kein Chunk-Diff).
    const chunks: { cy: number; blob: Uint8Array }[] = [];
    for (let cy = 0; cy < CHUNKS_PER_COLUMN; cy++)
      chunks.push({ cy, blob: encodeChunk(col.chunks[cy]!) });
    return { op: 'ChunkColumn', cx, cz, pristineMask: 0, chunks };
  }

  private send(m: ServerMessage): void {
    this.outbox.push(m);
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    queueMicrotask(() => this.flush());
  }

  /** Bündelt alle ausstehenden Nachrichten in einen Rahmen (max. 255 je Rahmen). */
  flush(): void {
    this.flushScheduled = false;
    while (this.outbox.length > 0) {
      const batch = this.outbox.splice(0, 255);
      this.transport.send(encodeFrame(this.tick, batch));
    }
  }

  close(): void {
    this.transport.close();
  }
}
