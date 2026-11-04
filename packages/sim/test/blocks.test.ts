import { describe, expect, it } from 'vitest';
import { AIR, decodeChunk, WorldGenerator } from '@robmine/core';
import { BLOCK, WORLD_BLOCKS } from '@robmine/content';
import {
  BlockActionKind,
  createLoopbackPair,
  decodeFrame,
  encodeFrame,
  type Message,
  PROTOCOL_VERSION,
  type Transport,
} from '@robmine/protocol';
import { LocalInstance } from '../src/LocalInstance.ts';
import { MemoryColumnStorage } from '../src/ColumnStorage.ts';

/** Sammelt Nachrichten; `next(min)` löst auf, sobald mindestens `min` angekommen sind. */
function collect(transport: Transport): (min?: number) => Promise<Message[]> {
  const received: Message[] = [];
  let waiters: (() => boolean)[] = [];
  transport.onFrame((data) => {
    received.push(...decodeFrame(data).messages);
    waiters = waiters.filter((w) => !w());
  });
  return (min = 1) =>
    new Promise<Message[]>((resolve) => {
      const check = (): boolean => {
        if (received.length < min) return false;
        resolve(received);
        return true;
      };
      if (!check()) waiters.push(check);
    });
}

const hello = (): Message => ({
  op: 'Hello',
  protoVer: PROTOCOL_VERSION,
  token: '',
  clientBuild: 't',
  name: 'Tester',
  avatar: '000000',
});

describe('Blockaktionen (autoritativ) + Persistenz', () => {
  it('setzt und bricht Blöcke, meldet BlockUpdate und speichert; Neustart lädt die Spalte', async () => {
    const storage = new MemoryColumnStorage();
    const gen = new WorldGenerator(42, WORLD_BLOCKS);
    const [client, server] = createLoopbackPair();
    const inst = new LocalInstance(server, {
      seed: 42,
      spawn: [0, 0, 0],
      generator: gen,
      storage,
      saveDelayMs: 10,
      unbreakable: new Set([BLOCK.Urgestein]),
    });
    const next = collect(client);
    const h = gen.generateColumn(0, 0).height[5 + 5 * 32]!;
    client.send(
      encodeFrame(0, [
        hello(),
        { op: 'BlockAction', kind: BlockActionKind.Place, x: 5, y: h + 1, z: 5, block: BLOCK.Glas },
        { op: 'BlockAction', kind: BlockActionKind.Break, x: 5, y: h, z: 5, block: 0 },
        { op: 'BlockAction', kind: BlockActionKind.Break, x: 5, y: 0, z: 5, block: 0 }, // Urgestein
      ]),
    );
    const msgs = await next(3);
    await inst.idle();
    const updates = msgs.filter((m) => m.op === 'BlockUpdate');
    expect(updates).toHaveLength(2);
    expect(updates[0]).toEqual({
      op: 'BlockUpdate',
      updates: [{ x: 5, y: h + 1, z: 5, block: BLOCK.Glas }],
    });
    expect(updates[1]).toEqual({ op: 'BlockUpdate', updates: [{ x: 5, y: h, z: 5, block: AIR }] });
    expect(inst.world.getBlock(5, h + 1, 5)).toBe(BLOCK.Glas);
    expect(inst.world.getBlock(5, 0, 5)).toBe(BLOCK.Urgestein);

    // Speichern (verzögert)
    await new Promise((r) => setTimeout(r, 40));
    await inst.idle();
    expect(storage.map.size).toBe(1);

    // Neue Instanz mit demselben Speicher: ChunkRequest liefert die veränderte Spalte als Blobs.
    inst.close();
    const [client2, server2] = createLoopbackPair();
    const inst2 = new LocalInstance(server2, {
      seed: 42,
      spawn: [0, 0, 0],
      generator: gen,
      storage,
    });
    const next2 = collect(client2);
    client2.send(encodeFrame(0, [hello(), { op: 'ChunkRequest', cx: 0, cz: 0 }]));
    const msgs2 = await next2(2);
    const cc = msgs2.find((m) => m.op === 'ChunkColumn');
    expect(cc && cc.op === 'ChunkColumn' && cc.pristineMask).toBe(0);
    if (!cc || cc.op !== 'ChunkColumn') return;
    const cy = (h + 1) >> 5;
    const chunk = decodeChunk(cc.chunks[cy]!.blob);
    expect(chunk.get(5, (h + 1) & 31, 5)).toBe(BLOCK.Glas);
    inst2.close();
  });
});
