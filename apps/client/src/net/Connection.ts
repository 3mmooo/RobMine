import { columnKey } from '@robmine/core';
import {
  type ChunkColumnMsg,
  type ClientMessage,
  decodeFrame,
  encodeFrame,
  PROTOCOL_VERSION,
  type ServerMessage,
  type Transport,
  type WelcomeMsg,
} from '@robmine/protocol';

/**
 * Client-Seite der Verbindung zu einer Instanz (lokal im Worker oder Server).
 * Phase 0: Hello/Welcome, ChunkRequest/ChunkColumn, Ping/Pong.
 */
export class Connection {
  private welcomeResolve: ((w: WelcomeMsg) => void) | null = null;
  private readonly columnWaiters = new Map<string, (m: ChunkColumnMsg) => void>();
  private outbox: ClientMessage[] = [];
  private flushScheduled = false;
  tick = 0;
  welcome: WelcomeMsg | null = null;
  lastRttMs = 0;
  onKick: ((reason: string) => void) | null = null;
  private readonly transport: Transport;

  constructor(transport: Transport) {
    this.transport = transport;
    transport.onFrame((data) => this.handleFrame(data));
  }

  hello(token = '', clientBuild = 'dev'): Promise<WelcomeMsg> {
    return new Promise<WelcomeMsg>((resolve) => {
      this.welcomeResolve = resolve;
      this.send({ op: 'Hello', protoVer: PROTOCOL_VERSION, token, clientBuild });
    });
  }

  requestColumn(cx: number, cz: number): Promise<ChunkColumnMsg> {
    const key = columnKey(cx, cz);
    return new Promise<ChunkColumnMsg>((resolve) => {
      this.columnWaiters.set(key, resolve);
      this.send({ op: 'ChunkRequest', cx, cz });
    });
  }

  cancelColumn(cx: number, cz: number): void {
    this.columnWaiters.delete(columnKey(cx, cz));
  }

  ping(): void {
    this.send({ op: 'Ping', clientTime: Math.floor(performance.now()) & 0xffffffff });
  }

  private send(m: ClientMessage): void {
    this.outbox.push(m);
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    queueMicrotask(() => this.flush());
  }

  flush(): void {
    this.flushScheduled = false;
    while (this.outbox.length > 0) {
      const batch = this.outbox.splice(0, 255);
      this.transport.send(encodeFrame(this.tick++, batch));
    }
  }

  private handleFrame(data: Uint8Array): void {
    const frame = decodeFrame(data);
    for (const m of frame.messages) this.handleMessage(m as ServerMessage);
  }

  private handleMessage(m: ServerMessage): void {
    switch (m.op) {
      case 'Welcome':
        this.welcome = m;
        this.welcomeResolve?.(m);
        this.welcomeResolve = null;
        break;
      case 'ChunkColumn': {
        const key = columnKey(m.cx, m.cz);
        const waiter = this.columnWaiters.get(key);
        if (waiter) {
          this.columnWaiters.delete(key);
          waiter(m);
        }
        break;
      }
      case 'Pong':
        this.lastRttMs = (Math.floor(performance.now()) & 0xffffffff) - m.clientTime;
        break;
      case 'Kick':
        this.onKick?.(m.reason);
        break;
      default:
        break;
    }
  }

  close(): void {
    this.transport.close();
  }
}
