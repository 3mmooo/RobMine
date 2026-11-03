/**
 * Deterministische Zufallsquellen – identisch in Browser-Workern und Node.
 * Alle Funktionen arbeiten mit 32-Bit-Ganzzahlen, damit keine Plattform-
 * unterschiede entstehen.
 */

/** lowbias32 – schneller Integer-Hash mit guter Verteilung. */
export function hashU32(x: number): number {
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  return (x ^ (x >>> 16)) >>> 0;
}

export function hash2(seed: number, x: number, y: number): number {
  let h = hashU32((seed ^ Math.imul(x, 0x9e3779b1)) >>> 0);
  h = hashU32((h ^ Math.imul(y, 0x85ebca77)) >>> 0);
  return h;
}

export function hash3(seed: number, x: number, y: number, z: number): number {
  let h = hashU32((seed ^ Math.imul(x, 0x9e3779b1)) >>> 0);
  h = hashU32((h ^ Math.imul(y, 0x85ebca77)) >>> 0);
  h = hashU32((h ^ Math.imul(z, 0xc2b2ae3d)) >>> 0);
  return h;
}

/** Wandelt einen u32-Hash in [0, 1). */
export function hashToUnit(h: number): number {
  return (h >>> 0) / 4294967296;
}

/** Leitet aus einem Welt-Seed einen Unter-Seed ab (z. B. je Noise-Feld). */
export function splitSeed(seed: number, salt: number): number {
  return hashU32((hashU32(seed >>> 0) ^ Math.imul(salt + 1, 0x27d4eb2f)) >>> 0);
}

/** mulberry32 – kleiner, schneller, seedbarer PRNG mit Rückgabe in [0, 1). */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a über die UTF-16-Codeeinheiten eines Strings → u32. */
export function seedFromString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Normalisiert einen Seed-Parameter (Zahl oder String) auf u32. */
export function normalizeSeed(seed: number | string): number {
  if (typeof seed === 'string') {
    const n = Number(seed);
    return Number.isFinite(n) && seed.trim() !== '' ? n >>> 0 : seedFromString(seed);
  }
  return seed >>> 0;
}
