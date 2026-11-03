import { describe, expect, it } from 'vitest';
import { decodeChunk, WorldGenerator, WORLDGEN_VERSION } from '@robmine/core';
import { createBlockRegistry, WORLD_BLOCKS } from '@robmine/content';
import {
  createLoopbackPair,
  decodeFrame,
  encodeFrame,
  encodeFrames,
  type Message,
  PROTOCOL_VERSION,
  type Transport,
} from '@robmine/protocol';
import { LocalInstance } from '../src/LocalInstance.ts';
import { InlineRunner } from '../src/WorkerPool.ts';

function collect(transport: Transport): { next: () => Promise<Message[]>; closed: Promise<void> } {
  const received: Message[] = [];
  const waiters: ((m: Message[]) => void)[] = [];
  transport.onFrame((data) => {
    received.push(...decodeFrame(data).messages);
    for (const w of waiters.splice(0)) w(received);
  });
  const closed = new Promise<void>((resolve) => transport.onClose(resolve));
  return {
    next: () =>
      new Promise<Message[]>((resolve) => {
        if (received.length) resolve(received);
        else waiters.push(resolve);
      }),
    closed,
  };
}

const hello = (): Message => ({
  op: 'Hello',
  protoVer: PROTOCOL_VERSION,
  token: '',
  clientBuild: 'test',
});

describe('LocalInstance', () => {
  it('antwortet auf Hello mit Welcome (Seed, Spawn, Weltgen-Version)', async () => {
    const [client, server] = createLoopbackPair();
    const inst = new LocalInstance(server, { seed: 42, spawn: [8, 80, 8] });
    const { next } = collect(client);
    client.send(encodeFrame(0, [hello()]));
    const msgs = await next();
    expect(msgs[0]).toEqual({
      op: 'Welcome',
      playerId: 1,
      worldSeed: 42,
      worldgenVersion: WORLDGEN_VERSION,
      spawn: [8, 80, 8],
      timeOfDay: 600,
      mode: 0,
    });
    expect(inst.sessionState).toBe('active');
    inst.close();
  });

  it('lehnt falsche Protokollversion ab: Kick + Transport geschlossen', async () => {
    const [client, server] = createLoopbackPair();
    const inst = new LocalInstance(server, { seed: 1, spawn: [0, 0, 0] });
    const { next, closed } = collect(client);
    client.send(encodeFrame(0, [{ op: 'Hello', protoVer: 99, token: '', clientBuild: 'test' }]));
    const msgs = await next();
    expect(msgs[0]!.op).toBe('Kick');
    await closed;
    expect(inst.sessionState).toBe('closed');
  });

  it('bedient keine Anfragen vor dem Hello und beendet die Sitzung', async () => {
    const [client, server] = createLoopbackPair();
    const inst = new LocalInstance(server, { seed: 1, spawn: [0, 0, 0] });
    const { next, closed } = collect(client);
    client.send(encodeFrame(0, [{ op: 'ChunkRequest', cx: 0, cz: 0 }]));
    const msgs = await next();
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toEqual({ op: 'Kick', reason: 'Hello erwartet' });
    await closed;
    expect(inst.sessionState).toBe('closed');
  });

  it('kaputter Rahmen führt zu Kick, danach wird nichts mehr verarbeitet', async () => {
    const [client, server] = createLoopbackPair();
    const inst = new LocalInstance(server, { seed: 1, spawn: [0, 0, 0] });
    const { next, closed } = collect(client);
    client.send(Uint8Array.of(9, 9, 9));
    const msgs = await next();
    expect(msgs[0]!.op).toBe('Kick');
    await closed;
    expect(inst.sessionState).toBe('closed');
  });

  it('Seed-Streaming: unveränderte Spalte → pristineMask 0xff ohne Blobs; veränderte → Blobs', async () => {
    const [client, server] = createLoopbackPair();
    const inst = new LocalInstance(server, { seed: 42, spawn: [0, 0, 0] });
    const { next } = collect(client);
    client.send(encodeFrame(0, [hello(), { op: 'ChunkRequest', cx: 3, cz: -2 }]));
    let msgs = await next();
    expect(msgs[0]!.op).toBe('Welcome');
    expect(msgs[1]).toEqual({ op: 'ChunkColumn', cx: 3, cz: -2, pristineMask: 0xff, chunks: [] });

    // Spalte in der Welt verändern → sie wird als Blobs geliefert.
    const gen = new WorldGenerator(42, WORLD_BLOCKS);
    const col = gen.generateColumn(0, 0);
    col.chunks[2]!.set(1, 1, 1, 15);
    inst.world.setColumn(col);
    msgs.length = 0;
    client.send(encodeFrame(1, [{ op: 'ChunkRequest', cx: 0, cz: 0 }]));
    msgs = await next();
    const cc = msgs[0]!;
    expect(cc.op).toBe('ChunkColumn');
    if (cc.op !== 'ChunkColumn') return;
    expect(cc.pristineMask).toBe(0);
    expect(cc.chunks.length).toBe(8);
    const chunk2 = decodeChunk(cc.chunks[2]!.blob);
    expect(chunk2.get(1, 1, 1)).toBe(15);
    expect(Array.from(chunk2.blocks!)).toEqual(Array.from(col.chunks[2]!.blocks!));
    inst.close();
  });

  it('viele Antworten werden in mehrere Rahmen gestückelt (Byte-Budget)', async () => {
    const [client, server] = createLoopbackPair();
    const inst = new LocalInstance(server, { seed: 42, spawn: [0, 0, 0] });
    const gen = new WorldGenerator(42, WORLD_BLOCKS);
    for (let cx = 0; cx < 6; cx++)
      for (let cz = 0; cz < 6; cz++) inst.world.setColumn(gen.generateColumn(cx, cz));
    const frames: number[] = [];
    let total = 0;
    client.onFrame((data) => {
      frames.push(data.length);
      total += decodeFrame(data).messages.length;
    });
    const requests: Message[] = [hello()];
    for (let cx = 0; cx < 6; cx++)
      for (let cz = 0; cz < 6; cz++) requests.push({ op: 'ChunkRequest', cx, cz });
    for (const f of encodeFrames(0, requests)) client.send(f);
    // 36 Spalten × 8 Chunks werden kodiert (deflate) – auf die Antworten warten.
    const deadline = Date.now() + 10_000;
    await new Promise<void>((resolve) => {
      const timer = setInterval(() => {
        if (total >= 37 || Date.now() > deadline) {
          clearInterval(timer);
          resolve();
        }
      }, 20);
    });
    expect(total).toBe(37);
    expect(frames.length).toBeGreaterThanOrEqual(1);
    for (const len of frames) expect(len).toBeLessThanOrEqual(1024 * 1024 + 64 * 1024);
    inst.close();
  });

  it('Registry und Weltgen aus content passen zusammen', () => {
    const reg = createBlockRegistry();
    const gen = new WorldGenerator(7, WORLD_BLOCKS);
    const col = gen.generateColumn(0, 0);
    for (const c of col.chunks) {
      if (c.isUniform) {
        expect(reg.has(c.uniformBlock)).toBe(true);
      } else {
        for (let i = 0; i < c.blocks!.length; i += 97)
          expect(reg.has(c.blocks![i]! & 0xfff)).toBe(true);
      }
    }
  });

  it('InlineRunner liefert Fehler als abgelehntes Promise', async () => {
    const ok = new InlineRunner<number, number>((n) => n * 2);
    await expect(ok.run(21)).resolves.toBe(42);
    const bad = new InlineRunner<number, number>(() => {
      throw new Error('kaputt');
    });
    await expect(bad.run(1)).rejects.toThrow('kaputt');
  });
});
