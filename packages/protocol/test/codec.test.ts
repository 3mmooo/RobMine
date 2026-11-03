import { describe, expect, it } from 'vitest';
import { decodeFrame, encodeFrame } from '../src/codec.ts';
import { ByteReader, ByteWriter } from '../src/bytes.ts';
import type { Message } from '../src/messages.ts';
import { createLoopbackPair } from '../src/transport.ts';

const samples: Message[] = [
  { op: 'Hello', protoVer: 1, token: 'gast-äöü-🙂', clientBuild: 'dev' },
  { op: 'Ping', clientTime: 123456 },
  { op: 'ChunkRequest', cx: -7, cz: 2147483647 },
  {
    op: 'Welcome',
    playerId: 42,
    worldSeed: 0xdeadbeef,
    worldgenVersion: 1,
    spawn: [12.5, 70, -3.25],
    timeOfDay: 600,
    mode: 0,
  },
  {
    op: 'ChunkColumn',
    cx: 3,
    cz: -4,
    pristineMask: 0b11110011,
    chunks: [
      { cy: 2, blob: Uint8Array.from([1, 2, 3, 4, 5]) },
      { cy: 3, blob: new Uint8Array(0) },
    ],
  },
  { op: 'Pong', clientTime: 99, serverTick: 1000 },
  { op: 'BlockAction', kind: 1, x: -5, y: 70, z: 123456, block: 4095 },
  {
    op: 'BlockUpdate',
    updates: [
      { x: 1, y: 2, z: 3, block: 7 },
      { x: -1, y: 255, z: -3, block: 0 },
    ],
  },
  { op: 'Kick', reason: 'Wartung' },
];

describe('Protokoll-Codec', () => {
  it('alle Nachrichten überleben den Roundtrip in einem Rahmen', () => {
    const frame = encodeFrame(777, samples);
    const back = decodeFrame(frame);
    expect(back.version).toBe(1);
    expect(back.tick).toBe(777);
    expect(back.messages).toEqual(samples);
  });

  it('leerer Rahmen ist 4 Byte', () => {
    expect(encodeFrame(0, []).length).toBe(4);
  });

  it('erkennt beschädigte Rahmen', () => {
    const frame = encodeFrame(1, [{ op: 'Ping', clientTime: 1 }]);
    expect(() => decodeFrame(frame.subarray(0, frame.length - 1))).toThrow();
    const wrongVersion = frame.slice();
    wrongVersion[0] = 9;
    expect(() => decodeFrame(wrongVersion)).toThrow(/Protokollversion/);
    const extra = new Uint8Array(frame.length + 1);
    extra.set(frame);
    expect(() => decodeFrame(extra)).toThrow(/überzählige/);
  });

  it('ByteWriter wächst und ByteReader prüft Grenzen', () => {
    const w = new ByteWriter(2);
    for (let i = 0; i < 1000; i++) w.u16(i);
    w.f64(Math.PI).i32(-5).str('x');
    const r = new ByteReader(w.toUint8Array());
    for (let i = 0; i < 1000; i++) expect(r.u16()).toBe(i);
    expect(r.f64()).toBe(Math.PI);
    expect(r.i32()).toBe(-5);
    expect(r.str()).toBe('x');
    expect(() => r.u8()).toThrow(RangeError);
  });

  it('Loopback-Transport liefert Rahmen in beide Richtungen', async () => {
    const [a, b] = createLoopbackPair();
    const gotB = new Promise<Uint8Array>((resolve) => b.onFrame(resolve));
    const gotA = new Promise<Uint8Array>((resolve) => a.onFrame(resolve));
    a.send(encodeFrame(1, [{ op: 'Ping', clientTime: 5 }]));
    b.send(encodeFrame(2, [{ op: 'Pong', clientTime: 5, serverTick: 9 }]));
    expect(decodeFrame(await gotB).messages[0]).toEqual({ op: 'Ping', clientTime: 5 });
    expect(decodeFrame(await gotA).messages[0]).toEqual({
      op: 'Pong',
      clientTime: 5,
      serverTick: 9,
    });
    const closed = new Promise<void>((resolve) => b.onClose(resolve));
    a.close();
    await closed;
  });
});
