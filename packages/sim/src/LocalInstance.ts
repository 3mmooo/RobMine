import { CHUNKS_PER_COLUMN, encodeChunk, WORLDGEN_VERSION } from '@robmine/core';
import {
  type ClientMessage,
  decodeFrame,
  encodeFrames,
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

type SessionState = 'awaitingHello' | 'active' | 'closed';

/**
 * Der Instanz-Kern (Phase 0): beantwortet Hello mit Welcome, ChunkRequest mit
 * ChunkColumn. Unveränderte Spalten werden NICHT übertragen – der Client erzeugt
 * sie selbst aus dem Seed (Seed-Streaming); nur veränderte Chunks gehen als Blobs.
 *
 * Sitzungszustand: erst Hello (mit passender Protokollversion), dann alles andere.
 * Ein Kick beendet die Sitzung wirklich: Rahmen werden nicht mehr verarbeitet,
 * der Transport wird geschlossen.
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
  private state: SessionState = 'awaitingHello';
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
    transport.onClose(() => {
      this.state = 'closed';
    });
  }

  get sessionState(): SessionState {
    return this.state;
  }

  /** Als Methode, damit TypeScript den Zustand nach handleMessage() nicht wegnarrowt. */
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

  /** Beendet die Sitzung: Kick synchron senden, dann Transport schließen. */
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

  /** Bündelt ausstehende Nachrichten in Rahmen (≤ 255 Nachrichten, ≤ 1 MB je Rahmen). */
  flush(): void {
    this.flushScheduled = false;
    if (this.outbox.length === 0) return;
    const batch = this.outbox.splice(0);
    for (const frame of encodeFrames(this.tick, batch)) this.transport.send(frame);
  }

  close(): void {
    this.state = 'closed';
    this.transport.close();
  }
}
