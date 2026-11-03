import { describe, expect, it } from 'vitest';
import {
  createRng,
  hash2,
  hash3,
  hashToUnit,
  hashU32,
  normalizeSeed,
  seedFromString,
  splitSeed,
} from '../src/math/rng.ts';
import { fbm2, fbm3, noise2, noise3, ridged2 } from '../src/math/noise.ts';

describe('RNG & Hashes', () => {
  it('mulberry32 ist deterministisch und liefert [0,1)', () => {
    const a = createRng(42);
    const b = createRng(42);
    for (let i = 0; i < 1000; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    expect(createRng(43)()).not.toBe(createRng(42)());
  });

  it('Hashes sind stabil (Golden-Werte) und gut verteilt', () => {
    expect(hashU32(0)).toBe(0);
    expect(hash2(1, 2, 3)).toBe(hash2(1, 2, 3));
    expect(hash2(1, 2, 3)).not.toBe(hash2(1, 3, 2));
    expect(hash3(7, 1, 2, 3)).not.toBe(hash3(7, 3, 2, 1));
    const buckets = Array.from({ length: 16 }, () => 0);
    for (let i = 0; i < 16000; i++) buckets[Math.floor(hashToUnit(hash2(99, i, -i)) * 16)]!++;
    for (const b of buckets) expect(Math.abs(b - 1000)).toBeLessThan(150);
  });

  it('Seeds aus Strings und Zahlen werden normalisiert', () => {
    expect(normalizeSeed(42)).toBe(42);
    expect(normalizeSeed('42')).toBe(42);
    expect(normalizeSeed('lumenfall')).toBe(seedFromString('lumenfall'));
    expect(normalizeSeed(-1)).toBe(0xffffffff);
    expect(splitSeed(1, 1)).not.toBe(splitSeed(1, 2));
  });
});

describe('Noise', () => {
  it('ist deterministisch für gleichen Seed und bleibt in [-1, 1]', () => {
    const a = noise2(7);
    const b = noise2(7);
    const c = noise2(8);
    let differs = false;
    for (let i = 0; i < 1000; i++) {
      const x = i * 0.37;
      const y = i * 0.11;
      const v = a(x, y);
      expect(v).toBe(b(x, y));
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThanOrEqual(1);
      if (v !== c(x, y)) differs = true;
    }
    expect(differs).toBe(true);
  });

  it('fBm und ridged bleiben im Wertebereich', () => {
    const n2 = noise2(3);
    const n3 = noise3(4);
    for (let i = 0; i < 500; i++) {
      const x = i * 0.73;
      const f = fbm2(n2, x, -x, 4);
      expect(f).toBeGreaterThanOrEqual(-1);
      expect(f).toBeLessThanOrEqual(1);
      const r = ridged2(n2, x, x * 0.5, 3);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(1);
      const g = fbm3(n3, x, x * 0.3, -x, 3);
      expect(g).toBeGreaterThanOrEqual(-1);
      expect(g).toBeLessThanOrEqual(1);
    }
  });
});
