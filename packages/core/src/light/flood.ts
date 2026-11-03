import type { BlockRegistry } from '../voxel/Block.ts';
import { blockType } from '../voxel/Block.ts';
import type { Column } from '../voxel/Chunk.ts';
import { LIGHT_FULL_SKY } from '../voxel/Chunk.ts';
import {
  CHUNK_BITS,
  CHUNK_MASK,
  CHUNK_SIZE,
  CHUNKS_PER_COLUMN,
  WORLD_HEIGHT,
} from '../voxel/constants.ts';
import { lightB, lightG, lightR, lightSky, packLight } from './Light.ts';

/**
 * Licht-Initialisierung je Spalte (Phase 0: ohne Nachbarspalten).
 *
 * 1. Himmelslicht: je (x,z) von oben nach unten 15, bis ein opaker Block kommt;
 *    nicht-opake Blöcke mit Dämpfung (Wasser, Blätter) ziehen ab.
 * 2. BFS-Ausbreitung des Himmelslichts in alle Richtungen (−1 je Schritt,
 *    zusätzlich Dämpfung des Zielblocks), damit Höhlen-Eingänge und Überhänge
 *    weich ausleuchten.
 * 3. Blocklicht: BFS von allen Emittern, drei Farbkanäle getrennt.
 */

// Spalten-lokaler Zellindex: x + z*32 + y*1024 (18 Bit)
const COL_STRIDE_Z = CHUNK_SIZE;
const COL_STRIDE_Y = CHUNK_SIZE * CHUNK_SIZE;
const COL_CELLS = COL_STRIDE_Y * WORLD_HEIGHT;

// Wiederverwendete Queue (Ringpuffer) für die BFS.
const QUEUE_CAP = 1 << 20;
const queue = new Int32Array(QUEUE_CAP);

function colIndex(x: number, y: number, z: number): number {
  return x + z * COL_STRIDE_Z + y * COL_STRIDE_Y;
}

function getLightCell(col: Column, i: number): number {
  const y = i >>> 10;
  return col.chunks[y >> CHUNK_BITS]!.getLightIndex((i & 1023) | ((y & CHUNK_MASK) << 10));
}

function setLightCell(col: Column, i: number, v: number): void {
  const y = i >>> 10;
  col.chunks[y >> CHUNK_BITS]!.setLightIndex((i & 1023) | ((y & CHUNK_MASK) << 10), v);
}

function getBlockCell(col: Column, i: number): number {
  const y = i >>> 10;
  return col.chunks[y >> CHUNK_BITS]!.getIndex((i & 1023) | ((y & CHUNK_MASK) << 10));
}

export function initColumnLight(col: Column, reg: BlockRegistry): void {
  const opaque = reg.opaque;
  const atten = reg.attenuation;

  // Startzustand: Chunks ohne Blöcke → volles Himmelslicht; Chunks mit Blöcken → 0, wird gescannt.
  for (let cy = 0; cy < CHUNKS_PER_COLUMN; cy++) {
    const c = col.chunks[cy]!;
    c.light = null;
    if (c.isUniform) {
      const t = blockType(c.uniformBlock);
      c.uniformLight = opaque[t] ? 0 : LIGHT_FULL_SKY;
    } else {
      c.uniformLight = 0;
    }
  }

  // 1. Himmelslicht von oben.
  for (let z = 0; z < CHUNK_SIZE; z++) {
    for (let x = 0; x < CHUNK_SIZE; x++) {
      let sky = 15;
      for (let y = WORLD_HEIGHT - 1; y >= 0; y--) {
        const chunk = col.chunks[y >> CHUNK_BITS]!;
        if (chunk.isUniform) {
          // Uniform-Luft: Himmelslicht unverändert (bleibt 15 oder was wir bereits haben).
          const t = blockType(chunk.uniformBlock);
          if (opaque[t]) break; // Uniform-Stein: darunter nichts mehr zu tun
          if (sky !== 15) {
            // seltener Fall: gedämpftes Licht trifft Uniform-Luft → materialisieren
            chunk.setLight(x, y & CHUNK_MASK, z, packLight(0, 0, 0, sky));
          }
          continue;
        }
        const li = x | (z << CHUNK_BITS) | ((y & CHUNK_MASK) << 10);
        const t = blockType(chunk.blocks![li]!);
        if (opaque[t]) {
          sky = 0;
          // Alle Zellen darunter in diesem Chunk sind bereits 0 (Startwert) – weiter prüfen
          // lohnt sich nur, wenn unten wieder Luft kommt; dafür läuft die Schleife weiter.
          continue;
        }
        if (sky > 0) {
          const a = atten[t]!;
          if (a > 0) sky = Math.max(0, sky - a);
          if (sky > 0) chunk.setLightIndex(li, packLight(0, 0, 0, sky));
        }
      }
    }
  }

  // 2. BFS Himmelslicht.
  let head = 0;
  let tail = 0;
  const push = (i: number): void => {
    queue[tail] = i;
    tail = (tail + 1) & (QUEUE_CAP - 1);
  };

  for (let cy = 0; cy < CHUNKS_PER_COLUMN; cy++) {
    const chunk = col.chunks[cy]!;
    const below = cy > 0 ? col.chunks[cy - 1]! : null;
    // Chunks mit Blöcken ODER mit materialisiertem Licht (Schatten von oben in reiner Luft)
    // müssen vollständig abgetastet werden – sonst bleiben 15/0-Grenzen im Inneren ohne Seed.
    const scanAll = !chunk.isUniform || !chunk.isUniformLight;
    const scanBottom =
      chunk.isUniform &&
      !opaque[blockType(chunk.uniformBlock)] &&
      below !== null &&
      !below.isUniform;
    if (!scanAll && !scanBottom) continue;
    const yStart = cy << CHUNK_BITS;
    const yEnd = scanAll ? yStart + CHUNK_SIZE : yStart + 1;
    for (let y = yStart; y < yEnd; y++) {
      for (let z = 0; z < CHUNK_SIZE; z++) {
        for (let x = 0; x < CHUNK_SIZE; x++) {
          const i = colIndex(x, y, z);
          const sky = lightSky(getLightCell(col, i));
          if (sky <= 1) continue;
          if (hasDarkerNeighbor(col, opaque, x, y, z, sky)) push(i);
        }
      }
    }
  }

  while (head !== tail) {
    const i = queue[head]!;
    head = (head + 1) & (QUEUE_CAP - 1);
    const sky = lightSky(getLightCell(col, i));
    if (sky <= 1) continue;
    const x = i & CHUNK_MASK;
    const z = (i >>> CHUNK_BITS) & CHUNK_MASK;
    const y = i >>> 10;
    // 6 Nachbarn
    if (x > 0) spreadSky(col, opaque, atten, i - 1, sky, push);
    if (x < CHUNK_MASK) spreadSky(col, opaque, atten, i + 1, sky, push);
    if (z > 0) spreadSky(col, opaque, atten, i - COL_STRIDE_Z, sky, push);
    if (z < CHUNK_MASK) spreadSky(col, opaque, atten, i + COL_STRIDE_Z, sky, push);
    if (y > 0) spreadSky(col, opaque, atten, i - COL_STRIDE_Y, sky, push);
    if (y < WORLD_HEIGHT - 1) spreadSky(col, opaque, atten, i + COL_STRIDE_Y, sky, push);
  }

  // 3. Blocklicht von Emittern.
  head = 0;
  tail = 0;
  const emission = reg.light;
  for (let cy = 0; cy < CHUNKS_PER_COLUMN; cy++) {
    const chunk = col.chunks[cy]!;
    if (chunk.isUniform) continue;
    const blocks = chunk.blocks!;
    const yBase = cy << CHUNK_BITS;
    for (let li = 0; li < blocks.length; li++) {
      const t = blockType(blocks[li]!);
      const o = t * 3;
      const r = emission[o]!;
      const g = emission[o + 1]!;
      const b = emission[o + 2]!;
      if ((r | g | b) === 0) continue;
      const x = li & CHUNK_MASK;
      const z = (li >>> CHUNK_BITS) & CHUNK_MASK;
      const y = yBase + (li >>> 10);
      const i = colIndex(x, y, z);
      const cur = getLightCell(col, i);
      setLightCell(
        col,
        i,
        packLight(
          Math.max(lightR(cur), r),
          Math.max(lightG(cur), g),
          Math.max(lightB(cur), b),
          lightSky(cur),
        ),
      );
      push(i);
    }
  }

  while (head !== tail) {
    const i = queue[head]!;
    head = (head + 1) & (QUEUE_CAP - 1);
    const v = getLightCell(col, i);
    const r = lightR(v);
    const g = lightG(v);
    const b = lightB(v);
    if (r <= 1 && g <= 1 && b <= 1) continue;
    const x = i & CHUNK_MASK;
    const z = (i >>> CHUNK_BITS) & CHUNK_MASK;
    const y = i >>> 10;
    if (x > 0) spreadBlock(col, opaque, atten, i - 1, r, g, b, push);
    if (x < CHUNK_MASK) spreadBlock(col, opaque, atten, i + 1, r, g, b, push);
    if (z > 0) spreadBlock(col, opaque, atten, i - COL_STRIDE_Z, r, g, b, push);
    if (z < CHUNK_MASK) spreadBlock(col, opaque, atten, i + COL_STRIDE_Z, r, g, b, push);
    if (y > 0) spreadBlock(col, opaque, atten, i - COL_STRIDE_Y, r, g, b, push);
    if (y < WORLD_HEIGHT - 1) spreadBlock(col, opaque, atten, i + COL_STRIDE_Y, r, g, b, push);
  }

  // Speicher sparen: Light-Arrays wieder uniform machen, wo möglich.
  for (const c of col.chunks) c.compactLight();
}

function hasDarkerNeighbor(
  col: Column,
  opaque: Uint8Array,
  x: number,
  y: number,
  z: number,
  sky: number,
): boolean {
  const i = colIndex(x, y, z);
  const limit = sky - 1;
  return (
    (x > 0 && darker(col, opaque, i - 1, limit)) ||
    (x < CHUNK_MASK && darker(col, opaque, i + 1, limit)) ||
    (z > 0 && darker(col, opaque, i - COL_STRIDE_Z, limit)) ||
    (z < CHUNK_MASK && darker(col, opaque, i + COL_STRIDE_Z, limit)) ||
    (y > 0 && darker(col, opaque, i - COL_STRIDE_Y, limit)) ||
    (y < WORLD_HEIGHT - 1 && darker(col, opaque, i + COL_STRIDE_Y, limit))
  );
}

function darker(col: Column, opaque: Uint8Array, j: number, limit: number): boolean {
  if (opaque[blockType(getBlockCell(col, j))]) return false;
  return lightSky(getLightCell(col, j)) < limit;
}

function spreadSky(
  col: Column,
  opaque: Uint8Array,
  atten: Uint8Array,
  j: number,
  sky: number,
  push: (i: number) => void,
): void {
  const t = blockType(getBlockCell(col, j));
  if (opaque[t]) return;
  const target = sky - 1 - atten[t]!;
  if (target <= 0) return;
  const cur = getLightCell(col, j);
  if (lightSky(cur) >= target) return;
  setLightCell(col, j, (cur & 0x0fff) | (target << 12));
  push(j);
}

function spreadBlock(
  col: Column,
  opaque: Uint8Array,
  atten: Uint8Array,
  j: number,
  r: number,
  g: number,
  b: number,
  push: (i: number) => void,
): void {
  const t = blockType(getBlockCell(col, j));
  if (opaque[t]) return;
  const loss = 1 + atten[t]!;
  const nr = r - loss;
  const ng = g - loss;
  const nb = b - loss;
  if (nr <= 0 && ng <= 0 && nb <= 0) return;
  const cur = getLightCell(col, j);
  const cr = lightR(cur);
  const cg = lightG(cur);
  const cb = lightB(cur);
  if (nr <= cr && ng <= cg && nb <= cb) return;
  setLightCell(
    col,
    j,
    packLight(Math.max(cr, nr), Math.max(cg, ng), Math.max(cb, nb), lightSky(cur)),
  );
  push(j);
}

export const COLUMN_CELLS = COL_CELLS;
