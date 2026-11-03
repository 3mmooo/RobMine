import { describe, expect, it } from 'vitest';
import { decodeChunk, WorldGenerator, WORLDGEN_VERSION } from '@robmine/core';
import { createBlockRegistry, WORLD_BLOCKS } from '@robmine/content';
import {
  createLoopbackPair,
  decodeFrame,
  encodeFrame,
  type Message,
  PROTOCOL_VERSION,
} from '@robmine/protocol';
import { LocalInstance } from '../src/LocalInstance.ts';

function collect(transport: ReturnType<typeof createLoopbackPair>[0]): () => Promise<Message[]> {
  const received: Message[] = [];
  const waiters: ((m: Message[]) => void)[] = [];
  transport.onFrame((data) => {
    received.push(...decodeFrame(data).messages);
    for (const w of waiters.splice(0)) w(received);
  });
  return () =>
    new Promise<Message[]>((resolve) => {
      if (received.length) resolve(received);
      else waiters.push(resolve);
    });
}

describe('LocalInstance', () => {
  it('antwortet auf Hello mit Welcome (Seed, Spawn, Weltgen-Version)', async () => {
    const [client, server] = createLoopbackPair();
    const inst = new LocalInstance(server, { seed: 42, spawn: [8, 80, 8] });
    const next = collect(client);
    client.send(
      encodeFrame(0, [{ op: 'Hello', protoVer: PROTOCOL_VERSION, token: '', clientBuild: 'test' }]),
    );
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
    inst.close();
  });

  it('lehnt falsche Protokollversion ab', async () => {
    const [client, server] = createLoopbackPair();
    const inst = new LocalInstance(server, { seed: 1, spawn: [0, 0, 0] });
    const next = collect(client);
    client.send(encodeFrame(0, [{ op: 'Hello', protoVer: 99, token: '', clientBuild: 'test' }]));
    const msgs = await next();
    expect(msgs[0]!.op).toBe('Kick');
    inst.close();
  });

  it('Seed-Streaming: unveränderte Spalte → pristineMask 0xff ohne Blobs; veränderte → Blobs', async () => {
    const [client, server] = createLoopbackPair();
    const inst = new LocalInstance(server, { seed: 42, spawn: [0, 0, 0] });
    const next = collect(client);
    client.send(encodeFrame(0, [{ op: 'ChunkRequest', cx: 3, cz: -2 }]));
    let msgs = await next();
    expect(msgs[0]).toEqual({ op: 'ChunkColumn', cx: 3, cz: -2, pristineMask: 0xff, chunks: [] });

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
});
