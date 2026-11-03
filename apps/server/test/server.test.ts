import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BLOCK } from '@robmine/content';
import {
  BlockActionKind,
  decodeFrame,
  encodeFrame,
  type Message,
  openWebSocket,
  PROTOCOL_VERSION,
  WebSocketTransport,
} from '@robmine/protocol';
import { type RunningServer, startServer } from '../src/server.ts';

class TestClient {
  readonly messages: Message[] = [];
  private waiters: (() => boolean)[] = [];
  readonly transport: WebSocketTransport;
  constructor(ws: WebSocket) {
    this.transport = new WebSocketTransport(ws);
    this.transport.onFrame((data) => {
      this.messages.push(...decodeFrame(data).messages);
      this.waiters = this.waiters.filter((w) => !w());
    });
  }
  send(...msgs: Message[]): void {
    this.transport.send(encodeFrame(0, msgs));
  }
  waitFor(pred: (m: Message) => boolean, timeoutMs = 4000): Promise<Message> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout')), timeoutMs);
      const check = (): boolean => {
        const m = this.messages.find(pred);
        if (!m) return false;
        clearTimeout(timer);
        resolve(m);
        return true;
      };
      if (!check()) this.waiters.push(check);
    });
  }
}

const hello = (name: string): Message => ({
  op: 'Hello',
  protoVer: PROTOCOL_VERSION,
  token: '',
  clientBuild: 'test',
  name,
});

describe('Spielserver (WebSocket, zwei Spieler)', () => {
  let server: RunningServer;
  let dir: string;
  let url: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'robmine-'));
    server = await startServer({
      port: 0,
      host: '127.0.0.1',
      seed: 42,
      dataDir: dir,
      log: () => {},
    });
    url = `ws://127.0.0.1:${server.port}/ws`;
  });

  afterAll(async () => {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('zwei Spieler sehen sich, bauen gemeinsam und chatten (gefiltert)', async () => {
    const a = new TestClient(await openWebSocket(url));
    const b = new TestClient(await openWebSocket(url));
    a.send(hello('Anna'));
    const wa = await a.waitFor((m) => m.op === 'Welcome');
    b.send(hello('Ben!!'));
    const wb = await b.waitFor((m) => m.op === 'Welcome');
    expect(wa.op === 'Welcome' && wb.op === 'Welcome' && wa.playerId !== wb.playerId).toBe(true);

    // Beitritt wird angekündigt (Name bereinigt).
    const joined = await a.waitFor((m) => m.op === 'PlayerJoin');
    expect(joined).toMatchObject({ op: 'PlayerJoin', name: 'Ben' });

    // Positionen → Snapshot beim jeweils anderen
    a.send({ op: 'PlayerMove', x: 10, y: 150, z: 10, yaw: 1, pitch: 0 });
    b.send({ op: 'PlayerMove', x: 12, y: 150, z: 10, yaw: 2, pitch: 0 });
    const snap = await b.waitFor((m) => m.op === 'Players');
    expect(snap.op === 'Players' && snap.players[0]).toMatchObject({ x: 10, y: 150, z: 10 });

    // Block setzen durch A → BlockUpdate auch bei B
    a.send({
      op: 'BlockAction',
      kind: BlockActionKind.Place,
      x: 11,
      y: 152,
      z: 10,
      block: BLOCK.Glas,
    });
    const upd = await b.waitFor((m) => m.op === 'BlockUpdate');
    expect(upd).toEqual({
      op: 'BlockUpdate',
      updates: [{ x: 11, y: 152, z: 10, block: BLOCK.Glas }],
    });

    // Außer Reichweite → abgelehnt
    a.send({
      op: 'BlockAction',
      kind: BlockActionKind.Place,
      x: 60,
      y: 152,
      z: 10,
      block: BLOCK.Glas,
    });
    await new Promise((r) => setTimeout(r, 200));
    expect(server.instance.world.getBlock(60, 152, 10)).toBe(0);

    // Chat mit Filter
    a.send({ op: 'Chat', text: 'hallo www.spam.de du arschloch' });
    const chat = await b.waitFor((m) => m.op === 'ChatMessage' && m.from !== 0);
    expect(chat.op === 'ChatMessage' && chat.text).toBe('hallo *** du ********');

    // Verlassen → PlayerLeave bei A
    b.transport.close();
    const leave = await a.waitFor((m) => m.op === 'PlayerLeave');
    expect(leave.op === 'PlayerLeave' && wb.op === 'Welcome' && leave.id === wb.playerId).toBe(
      true,
    );
    a.transport.close();
  });

  it('Änderungen werden gespeichert und neue Spieler bekommen die veränderte Spalte', async () => {
    await server.instance.saveDirty();
    const c = new TestClient(await openWebSocket(url));
    c.send(hello('Cleo'), { op: 'ChunkRequest', cx: 0, cz: 0 });
    const col = await c.waitFor((m) => m.op === 'ChunkColumn');
    expect(col.op === 'ChunkColumn' && col.pristineMask).toBe(0);
    c.transport.close();
  });

  it('falsche Protokollversion wird abgewiesen', async () => {
    const d = new TestClient(await openWebSocket(url));
    d.send({ ...hello('Dora'), protoVer: 1 } as Message);
    const kick = await d.waitFor((m) => m.op === 'Kick');
    expect(kick.op === 'Kick' && kick.reason).toMatch(/Protokollversion/);
  });
});
