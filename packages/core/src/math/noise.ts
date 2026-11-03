import { createNoise2D, createNoise3D } from 'simplex-noise';
import { createRng } from './rng.ts';

export type Noise2 = (x: number, y: number) => number;
export type Noise3 = (x: number, y: number, z: number) => number;

/** Simplex-Noise 2D, deterministisch aus Seed, Rückgabe in [-1, 1]. */
export function noise2(seed: number): Noise2 {
  return createNoise2D(createRng(seed));
}

/** Simplex-Noise 3D, deterministisch aus Seed, Rückgabe in [-1, 1]. */
export function noise3(seed: number): Noise3 {
  return createNoise3D(createRng(seed));
}

/** Fraktale Summe (fBm), normalisiert auf ~[-1, 1]. */
export function fbm2(
  n: Noise2,
  x: number,
  y: number,
  octaves: number,
  lacunarity = 2,
  gain = 0.5,
): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let fx = x;
  let fy = y;
  for (let i = 0; i < octaves; i++) {
    sum += n(fx, fy) * amp;
    norm += amp;
    amp *= gain;
    fx *= lacunarity;
    fy *= lacunarity;
  }
  return sum / norm;
}

export function fbm3(
  n: Noise3,
  x: number,
  y: number,
  z: number,
  octaves: number,
  lacunarity = 2,
  gain = 0.5,
): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let fx = x;
  let fy = y;
  let fz = z;
  for (let i = 0; i < octaves; i++) {
    sum += n(fx, fy, fz) * amp;
    norm += amp;
    amp *= gain;
    fx *= lacunarity;
    fy *= lacunarity;
    fz *= lacunarity;
  }
  return sum / norm;
}

/** Ridged-Noise (Grate): Rückgabe in [0, 1], Spitzen bei 1. */
export function ridged2(n: Noise2, x: number, y: number, octaves: number): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let fx = x;
  let fy = y;
  for (let i = 0; i < octaves; i++) {
    const v = 1 - Math.abs(n(fx, fy));
    sum += v * v * amp;
    norm += amp;
    amp *= 0.5;
    fx *= 2;
    fy *= 2;
  }
  return sum / norm;
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
