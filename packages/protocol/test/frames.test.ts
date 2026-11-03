import { describe, expect, it } from 'vitest';
import { decodeFrame, encodeFrames } from '../src/codec.ts';
import type { Message } from '../src/messages.ts';

const big = (cx: number): Message => ({
  op: 'ChunkColumn',
  cx,
  cz: 0,
  pristineMask: 0,
  chunks: [{ cy: 0, blob: new Uint8Array(700) }],
});

describe('encodeFrames', () => {
  it('stückelt nach 255 Nachrichten', () => {
    const msgs: Message[] = [];
    for (let i = 0; i < 600; i++) msgs.push({ op: 'Ping', clientTime: i });
    const frames = encodeFrames(5, msgs);
    expect(frames.length).toBe(3);
    const counts = frames.map((f) => decodeFrame(f).messages.length);
    expect(counts).toEqual([255, 255, 90]);
    expect(decodeFrame(frames[2]!).messages[0]).toEqual({ op: 'Ping', clientTime: 510 });
  });

  it('stückelt nach Byte-Budget und lässt übergroße Nachrichten allein', () => {
    const frames = encodeFrames(1, [big(1), big(2), big(3), big(4)], 1500);
    expect(frames.length).toBe(2);
    expect(decodeFrame(frames[0]!).messages.length).toBe(2);
    expect(decodeFrame(frames[1]!).messages.length).toBe(2);
    const single = encodeFrames(1, [big(1)], 100);
    expect(single.length).toBe(1);
    expect(decodeFrame(single[0]!).messages.length).toBe(1);
    expect(encodeFrames(1, [])).toEqual([]);
  });
});
