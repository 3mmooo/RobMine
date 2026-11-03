/**
 * Bench: erzeugt N Spalten (Weltgen + Licht) und mesht alle Chunks darin.
 * Vergleicht Median/p95 mit den Budgets aus dem Masterplan (6.13).
 *
 *   node tools/src/bench.ts [--columns 200] [--seed 42] [--strict]
 */
import { performance } from 'node:perf_hooks';
import {
  buildPaddedChunk,
  chunkHasBlocks,
  CHUNKS_PER_COLUMN,
  type Column,
  columnKey,
  createPaddedChunk,
  encodeChunk,
  initColumnLight,
  meshChunk,
  WorldGenerator,
} from '@robmine/core';
import { BLOCK, createBlockRegistry, WORLD_BLOCKS } from '@robmine/content';

const BUDGET = {
  genMs: 5, // je Chunk (Spalte / 8) – wir messen je Spalte und teilen
  columnMs: 25,
  lightMs: 3,
  meshMs: 4,
  codecKb: 8,
};

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

const columns = Number(arg('columns', '200'));
const seed = Number(arg('seed', '42'));
const strict = process.argv.includes('--strict');

const registry = createBlockRegistry();
const gen = new WorldGenerator(seed, WORLD_BLOCKS);
const store = new Map<string, Column>();
const lookup = (cx: number, cz: number) => store.get(columnKey(cx, cz));

function stats(values: number[]): { median: number; p95: number; max: number; mean: number } {
  const s = [...values].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(s.length * p))] ?? 0;
  const mean = s.reduce((a, b) => a + b, 0) / Math.max(1, s.length);
  return { median: q(0.5), p95: q(0.95), max: s[s.length - 1] ?? 0, mean };
}

// 1. Weltgen + Licht in einem Quadrat um den Ursprung
const side = Math.ceil(Math.sqrt(columns));
const genTimes: number[] = [];
const lightTimes: number[] = [];
let materialized = 0;
for (let i = 0; i < columns; i++) {
  const cx = (i % side) - Math.floor(side / 2);
  const cz = Math.floor(i / side) - Math.floor(side / 2);
  const t0 = performance.now();
  const col = gen.generateColumn(cx, cz);
  const t1 = performance.now();
  initColumnLight(col, registry);
  const t2 = performance.now();
  genTimes.push(t1 - t0);
  lightTimes.push(t2 - t1);
  for (const c of col.chunks) if (!c.isUniform) materialized++;
  store.set(columnKey(cx, cz), col);
}

// 2. Meshing aller Chunks mit vollständigen Nachbarn
const padded = createPaddedChunk();
const meshTimes: number[] = [];
let quads = 0;
let vertices = 0;
let meshedChunks = 0;
for (const col of store.values()) {
  let ok = true;
  for (let dz = -1; dz <= 1 && ok; dz++)
    for (let dx = -1; dx <= 1; dx++) if (!lookup(col.cx + dx, col.cz + dz)) ok = false;
  if (!ok) continue;
  for (let cy = 0; cy < CHUNKS_PER_COLUMN; cy++) {
    if (!chunkHasBlocks(col, cy)) continue;
    if (!buildPaddedChunk(lookup, col.cx, cy, col.cz, padded, BLOCK.Urgestein)) continue;
    const t0 = performance.now();
    const mesh = meshChunk(padded, registry);
    meshTimes.push(performance.now() - t0);
    quads += mesh.quadCount;
    vertices +=
      (mesh.opaque?.vertexCount ?? 0) +
      (mesh.cutout?.vertexCount ?? 0) +
      (mesh.fluid?.vertexCount ?? 0);
    meshedChunks++;
  }
}

// 3. Codec-Größe
const sizes: number[] = [];
for (const col of store.values())
  for (const c of col.chunks) if (!c.isUniform) sizes.push(encodeChunk(c).length / 1024);

const g = stats(genTimes);
const l = stats(lightTimes);
const m = stats(meshTimes);
const s = stats(sizes);

const rows: [string, number, number, number, number, number][] = [
  ['Weltgen je Spalte (ms)', g.median, g.p95, g.max, g.mean, BUDGET.columnMs],
  ['Weltgen je Chunk (ms, Spalte/8)', g.median / 8, g.p95 / 8, g.max / 8, g.mean / 8, BUDGET.genMs],
  ['Licht je Spalte (ms)', l.median, l.p95, l.max, l.mean, BUDGET.lightMs * 8],
  ['Meshing je Chunk (ms)', m.median, m.p95, m.max, m.mean, BUDGET.meshMs],
  ['Chunk-Blob (KB)', s.median, s.p95, s.max, s.mean, BUDGET.codecKb],
];

console.log(
  `\nRobMine Bench – Seed ${seed}, ${columns} Spalten, ${materialized} materialisierte Chunks, ${meshedChunks} gemeshte Chunks`,
);
console.log(
  `Quads gesamt ${quads} (Ø ${(quads / Math.max(1, meshedChunks)).toFixed(0)} je Chunk), Vertices ${vertices}`,
);
console.log('');
console.log(
  'Metrik'.padEnd(36),
  'Median'.padStart(9),
  'p95'.padStart(9),
  'max'.padStart(9),
  'Ø'.padStart(9),
  'Budget'.padStart(9),
  '',
);
let failed = 0;
for (const [name, median, p95, max, mean, budget] of rows) {
  const ok = median <= budget;
  if (!ok) failed++;
  console.log(
    name.padEnd(36),
    median.toFixed(2).padStart(9),
    p95.toFixed(2).padStart(9),
    max.toFixed(2).padStart(9),
    mean.toFixed(2).padStart(9),
    budget.toFixed(2).padStart(9),
    ok ? ' ✓' : ' ✗ (Median über Budget)',
  );
}
console.log('');
if (failed > 0) {
  console.log(`${failed} Budget(s) überschritten.`);
  if (strict) process.exit(1);
} else {
  console.log('Alle Budgets eingehalten.');
}
