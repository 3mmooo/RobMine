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
  type PlayerSnapshot,
  PROTOCOL_VERSION,
  type ServerMessage,
  type Transport,
} from '@robmine/protocol';
import type { ColumnStorage } from './ColumnStorage.ts';
import { filterChat, sanitizeName } from './chat.ts';
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
  /** Maximale Spielerzahl. */
  maxPlayers?: number;
}

type SessionState = 'awaitingHello' | 'active' | 'closed';

/** Reichweite für Blockaktionen (Anti-Cheat) und Sichtweite für Spieler-Updates. */
const REACH = 8;
const VIEW_RANGE = 160;

/** Einfacher Token-Bucket je Nachrichtenart. */
class RateLimit {
  private tokens: number;
  private last = Date.now();
  private readonly perSecond: number;
  private readonly burst: number;
  constructor(perSecond: number, burst: number) {
    this.perSecond = perSecond;
    this.burst = burst;
    this.tokens = burst;
  }
  take(): boolean {
    const now = Date.now();
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.last) / 1000) * this.perSecond);
    this.last = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

/** Eine Verbindung (ein Spieler) zur Instanz. */
export class Session {
  readonly id: number;
  name = '';
  state: SessionState = 'awaitingHello';
  x = 0;
  y = 0;
  z = 0;
  yaw = 0;
  pitch = 0;
  hasPosition = false;
  private readonly outbox: ServerMessage[] = [];
  private flushScheduled = false;
  private readonly instance: Instance;
  readonly transport: Transport;
  readonly limits = {
    move: new RateLimit(40, 60),
    block: new RateLimit(20, 30),
    chat: new RateLimit(1, 4),
    chunk: new RateLimit(400, 800),
  };
  private violations = 0;

  constructor(instance: Instance, transport: Transport, id: number) {
    this.instance = instance;
    this.transport = transport;
    this.id = id;
    transport.onFrame((data) => this.handleFrame(data));
    transport.onClose(() => this.instance.removeSession(this));
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
      this.instance.handleMessage(this, m as ClientMessage);
      if (this.isClosed()) return;
    }
  }

  /** Zu viele verworfene Nachrichten → Verbindung trennen. */
  violation(): void {
    if (++this.violations > 200) this.kick('Zu viele Nachrichten');
  }

  send(m: ServerMessage): void {
    if (this.state === 'closed') return;
    this.outbox.push(m);
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    queueMicrotask(() => this.flush());
  }

  flush(): void {
    this.flushScheduled = false;
    if (this.outbox.length === 0 || this.state === 'closed') return;
    const batch = this.outbox.splice(0);
    for (const frame of encodeFrames(this.instance.tick, batch)) this.transport.send(frame);
  }

  kick(reason: string): void {
    if (this.state === 'closed') return;
    this.outbox.push({ op: 'Kick', reason });
    this.flush();
    this.close();
  }

  close(): void {
    if (this.state === 'closed') return;
    this.state = 'closed';
    this.transport.close();
    this.instance.removeSession(this);
  }
}

/**
 * Der Instanz-Kern (eine Welt, beliebig viele Sitzungen): Hello/Welcome, Seed-Streaming,
 * autoritative Blockaktionen (an alle verteilt), Spielerpositionen (20 Hz an alle in
 * Sichtweite), Chat mit Filter. Läuft im Browser-Worker (Solo) und im Node-Server.
 *
 * Abkürzung bis zur Prediction-Phase: Bewegungen meldet der Client selbst (PlayerMove);
 * der Server prüft nur Plausibilität (Geschwindigkeit) und die Reichweite von Blockaktionen.
 */
export class Instance {
  readonly world: World;
  readonly spawn: [number, number, number];
  readonly mode: number;
  timeOfDay: number;
  tick = 0;
  readonly sessions = new Set<Session>();
  /** Blocktypen, die beim Setzen ersetzt werden dürfen (z. B. Wasser). */
  readonly replaceable = new Set<number>();
  private nextPlayerId = 1;
  private readonly generator: WorldGenerator | null;
  private readonly storage: ColumnStorage | null;
  private readonly placeable: ReadonlySet<number> | null;
  private readonly unbreakable: ReadonlySet<number>;
  private readonly saveDelayMs: number;
  private readonly maxPlayers: number;
  private readonly dirty = new Set<string>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly loading = new Map<string, Promise<Column | null>>();
  private pendingWork: Promise<unknown> = Promise.resolve();
  onLog: ((msg: string) => void) | null = null;

  constructor(opts: InstanceOptions) {
    this.world = new World(opts.seed);
    this.spawn = opts.spawn;
    this.mode = opts.mode ?? 0;
    this.timeOfDay = opts.timeOfDay ?? 600;
    this.generator = opts.generator ?? null;
    this.storage = opts.storage ?? null;
    this.placeable = opts.placeable ?? null;
    this.unbreakable = opts.unbreakable ?? new Set();
    this.saveDelayMs = opts.saveDelayMs ?? 1500;
    this.maxPlayers = opts.maxPlayers ?? 16;
  }

  /** Neue Verbindung annehmen. */
  connect(transport: Transport): Session {
    const s = new Session(this, transport, this.nextPlayerId++);
    if (this.nextPlayerId > 65000) this.nextPlayerId = 1;
    this.sessions.add(s);
    return s;
  }

  get playerCount(): number {
    let n = 0;
    for (const s of this.sessions) if (s.state === 'active') n++;
    return n;
  }

  removeSession(s: Session): void {
    if (!this.sessions.delete(s)) return;
    if (s.state !== 'closed') s.state = 'closed';
    if (s.name) {
      this.broadcast({ op: 'PlayerLeave', id: s.id }, s);
      this.broadcast(
        { op: 'ChatMessage', from: 0, name: 'Laternenhafen', text: `${s.name} ist gegangen.` },
        s,
      );
      this.onLog?.(`${s.name} (#${s.id}) getrennt`);
    }
  }

  /** Wartet, bis alle laufenden Lade-/Speichervorgänge abgeschlossen sind. */
  idle(): Promise<unknown> {
    return this.pendingWork;
  }

  /** 20-Hz-Takt: Positionen der anderen Spieler an jede Sitzung. */
  step(): void {
    this.tick = (this.tick + 1) & 0xffff;
    const active = Array.from(this.sessions).filter((s) => s.state === 'active' && s.hasPosition);
    if (active.length < 2) return;
    for (const s of active) {
      const players: PlayerSnapshot[] = [];
      for (const o of active) {
        if (o === s) continue;
        if (Math.hypot(o.x - s.x, o.z - s.z) > VIEW_RANGE) continue;
        players.push({ id: o.id, x: o.x, y: o.y, z: o.z, yaw: o.yaw, pitch: o.pitch });
      }
      if (players.length) s.send({ op: 'Players', players });
    }
  }

  broadcast(m: ServerMessage, except?: Session): void {
    for (const s of this.sessions) if (s !== except && s.state === 'active') s.send(m);
  }

  handleMessage(s: Session, m: ClientMessage | Message): void {
    if (m.op !== 'Hello' && s.state !== 'active') {
      s.kick('Hello erwartet');
      return;
    }
    switch (m.op) {
      case 'Hello': {
        if (s.state === 'active') return s.kick('Doppeltes Hello');
        if (m.protoVer !== PROTOCOL_VERSION)
          return s.kick(`Protokollversion ${m.protoVer} wird nicht unterstützt – bitte neu laden`);
        if (this.playerCount >= this.maxPlayers)
          return s.kick('Server voll – versuch es gleich noch einmal');
        s.state = 'active';
        s.name = sanitizeName(m.name, s.id);
        s.send({
          op: 'Welcome',
          playerId: s.id,
          worldSeed: this.world.seed,
          worldgenVersion: WORLDGEN_VERSION,
          spawn: this.spawn,
          timeOfDay: Math.floor(this.timeOfDay) % 1440,
          mode: this.mode,
        });
        // Wer ist schon da?
        for (const o of this.sessions) {
          if (o !== s && o.state === 'active') s.send({ op: 'PlayerJoin', id: o.id, name: o.name });
        }
        this.broadcast({ op: 'PlayerJoin', id: s.id, name: s.name }, s);
        if (this.sessions.size > 1)
          this.broadcast(
            { op: 'ChatMessage', from: 0, name: 'Laternenhafen', text: `${s.name} ist da.` },
            s,
          );
        this.onLog?.(`${s.name} (#${s.id}) verbunden`);
        break;
      }
      case 'Ping':
        s.send({ op: 'Pong', clientTime: m.clientTime, serverTick: this.tick });
        break;
      case 'ChunkRequest':
        if (!s.limits.chunk.take()) return s.violation();
        this.track(this.answerChunkRequest(s, m.cx, m.cz));
        break;
      case 'PlayerMove': {
        if (!s.limits.move.take()) return s.violation();
        if (![m.x, m.y, m.z, m.yaw, m.pitch].every(Number.isFinite)) return s.violation();
        if (Math.abs(m.x) > 1e6 || Math.abs(m.z) > 1e6 || m.y < -64 || m.y > 512)
          return s.violation();
        s.x = m.x;
        s.y = m.y;
        s.z = m.z;
        s.yaw = m.yaw;
        s.pitch = m.pitch;
        s.hasPosition = true;
        break;
      }
      case 'BlockAction': {
        if (!s.limits.block.take()) return s.violation();
        if (s.hasPosition) {
          const d = Math.hypot(m.x + 0.5 - s.x, m.y + 0.5 - (s.y + 1.6), m.z + 0.5 - s.z);
          if (d > REACH) return;
        }
        this.track(this.applyBlockAction(m.kind, m.x, m.y, m.z, m.block));
        break;
      }
      case 'Chat': {
        if (!s.limits.chat.take()) {
          s.send({
            op: 'ChatMessage',
            from: 0,
            name: 'Laternenhafen',
            text: 'Nicht so schnell 🙂',
          });
          return;
        }
        const { text } = filterChat(m.text);
        if (!text) return;
        const msg: ServerMessage = { op: 'ChatMessage', from: s.id, name: s.name, text };
        s.send(msg);
        this.broadcast(msg, s);
        break;
      }
      default:
        break;
    }
  }

  private track(p: Promise<unknown>): void {
    const safe = p.catch((err) => console.error('[Instance]', err));
    this.pendingWork = this.pendingWork.then(() => safe);
  }

  private async answerChunkRequest(s: Session, cx: number, cz: number): Promise<void> {
    const col = await this.loadColumn(cx, cz, false);
    if (s.state !== 'active') return;
    s.send(this.buildChunkColumn(cx, cz, col));
  }

  /** Spalte aus Welt, Speicher oder (bei `create`) Generator. */
  private loadColumn(cx: number, cz: number, create: boolean): Promise<Column | null> {
    const existing = this.world.getColumn(cx, cz);
    if (existing) return Promise.resolve(existing);
    const key = `${cx},${cz}`;
    const running = this.loading.get(key);
    if (running && !create) return running;
    const p = (async () => {
      if (running) {
        const col = await running;
        if (col) return col;
      }
      if (this.storage) {
        const blobs = await this.storage.load(cx, cz);
        const again = this.world.getColumn(cx, cz);
        if (again) return again;
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
        const again = this.world.getColumn(cx, cz);
        if (again) return again;
        const col = this.generator.generateColumn(cx, cz);
        this.world.setColumn(col);
        return col;
      }
      return null;
    })().finally(() => {
      if (this.loading.get(key) === p) this.loading.delete(key);
    });
    this.loading.set(key, p);
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
    if (!col) return;
    const lx = x & CHUNK_MASK;
    const lz = z & CHUNK_MASK;
    const current = columnGet(col, lx, y, lz);
    let next: number;
    if (kind === BlockActionKind.Break) {
      if (current === AIR || this.unbreakable.has(current & 0xfff)) return;
      next = AIR;
    } else if (kind === BlockActionKind.Place) {
      if (current !== AIR && !this.replaceable.has(current & 0xfff)) return;
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
    this.broadcast({ op: 'BlockUpdate', updates: [{ x, y, z, block: next }] });
    this.markDirty(col);
  }

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

  /** Alle trennen und ausstehende Änderungen speichern. */
  async shutdown(reason = 'Wartung'): Promise<void> {
    for (const s of Array.from(this.sessions)) s.kick(reason);
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    await this.saveDirty();
    await this.idle();
  }

  /** Beendet nur den Speicher-Timer (speichert sofort). */
  protected flushSave(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
      this.track(this.saveDirty());
    }
  }
}
