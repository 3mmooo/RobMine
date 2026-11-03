import { columnKey } from '@robmine/core';
import {
  type ChunkColumnMsg,
  type ClientMessage,
  decodeFrame,
  encodeFrames,
  PROTOCOL_VERSION,
  type ServerMessage,
  type Transport,
  type WelcomeMsg,
} from '@robmine/protocol';

interface Waiter<T> {
  resolve: (value: T) => void;
  reject: (err: Error) => void;
}

/**
 * Client-Seite der Verbindung zu einer Instanz (lokal im Worker oder Server).
 * Phase 0: Hello/Welcome, ChunkRequest/ChunkColumn, Ping/Pong.
 *
 * Fehlerpfad: Decode-Fehler, Kick oder Transport-Close beenden die Verbindung –
 * alle offenen Anfragen werden abgelehnt, nichts bleibt ewig „ausstehend".
 */
export class Connection {
  private welcomeWaiter: Waiter<WelcomeMsg> | null = null;
  private readonly columnWaiters = new Map<string, Waiter<ChunkColumnMsg>>();
  private outbox: ClientMessage[] = [];
  private flushScheduled = false;
  private readonly transport: Transport;
  tick = 0;
  welcome: WelcomeMsg | null = null;
  lastRttMs = 0;
  closed = false;
  closeReason: string | null = null;
  onKick: ((reason: string) => void) | null = null;
  onFail: ((err: Error) => void) | null = null;

  constructor(transport: Transport) {
    this.transport = transport;
    transport.onFrame((data) => this.handleFrame(data));
    transport.onClose(() => this.fail(new Error('Verbindung geschlossen')));
  }

  hello(token = '', clientBuild = 'dev'): Promise<WelcomeMsg> {
    if (this.closed) return Promise.reject(new Error(this.closeReason ?? 'Verbindung geschlossen'));
    return new Promise<WelcomeMsg>((resolve, reject) => {
      this.welcomeWaiter = { resolve, reject };
      this.send({ op: 'Hello', protoVer: PROTOCOL_VERSION, token, clientBuild });
    });
  }

  requestColumn(cx: number, cz: number): Promise<ChunkColumnMsg> {
    if (this.closed) return Promise.reject(new Error(this.closeReason ?? 'Verbindung geschlossen'));
    const key = columnKey(cx, cz);
    return new Promise<ChunkColumnMsg>((resolve, reject) => {
      this.columnWaiters.get(key)?.reject(new Error('abgebrochen'));
      this.columnWaiters.set(key, { resolve, reject });
      this.send({ op: 'ChunkRequest', cx, cz });
    });
  }

  /** Verwirft eine offene Spaltenanfrage (lehnt sie mit „abgebrochen" ab). */
  cancelColumn(cx: number, cz: number): void {
    const key = columnKey(cx, cz);
    const w = this.columnWaiters.get(key);
    if (!w) return;
    this.columnWaiters.delete(key);
    w.reject(new Error('abgebrochen'));
  }

  ping(): void {
    this.send({ op: 'Ping', clientTime: Math.floor(performance.now()) & 0xffffffff });
  }

  get pendingColumns(): number {
    return this.columnWaiters.size;
  }

  private send(m: ClientMessage): void {
    if (this.closed) return;
    this.outbox.push(m);
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    queueMicrotask(() => this.flush());
  }

  flush(): void {
    this.flushScheduled = false;
    if (this.closed || this.outbox.length === 0) return;
    const batch = this.outbox.splice(0);
    for (const frame of encodeFrames(this.tick++, batch)) this.transport.send(frame);
  }

  private handleFrame(data: Uint8Array): void {
    if (this.closed) return;
    let frame;
    try {
      frame = decodeFrame(data);
    } catch (err) {
      this.fail(new Error(`Ungültiger Rahmen vom Server: ${(err as Error).message}`));
      this.transport.close();
      return;
    }
    for (const m of frame.messages) {
      this.handleMessage(m as ServerMessage);
      if (this.closed) return;
    }
  }

  private handleMessage(m: ServerMessage): void {
    switch (m.op) {
      case 'Welcome':
        this.welcome = m;
        this.welcomeWaiter?.resolve(m);
        this.welcomeWaiter = null;
        break;
      case 'ChunkColumn': {
        const key = columnKey(m.cx, m.cz);
        const waiter = this.columnWaiters.get(key);
        if (waiter) {
          this.columnWaiters.delete(key);
          waiter.resolve(m);
        }
        break;
      }
      case 'Pong':
        this.lastRttMs = (Math.floor(performance.now()) & 0xffffffff) - m.clientTime;
        break;
      case 'Kick':
        this.onKick?.(m.reason);
        this.fail(new Error(`Verbindung beendet: ${m.reason}`));
        this.transport.close();
        break;
      default:
        break;
    }
  }

  /** Beendet die Verbindung clientseitig: alle Waiter ablehnen, nichts mehr senden. */
  private fail(err: Error): void {
    if (this.closed) return;
    this.closed = true;
    this.closeReason = err.message;
    this.outbox.length = 0;
    this.welcomeWaiter?.reject(err);
    this.welcomeWaiter = null;
    for (const w of this.columnWaiters.values()) w.reject(err);
    this.columnWaiters.clear();
    this.onFail?.(err);
  }

  close(): void {
    this.fail(new Error('Verbindung geschlossen'));
    this.transport.close();
  }
}
