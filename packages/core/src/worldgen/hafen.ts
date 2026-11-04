import { AIR } from '../voxel/Block.ts';
import { type Column, columnSet, newColumn } from '../voxel/Chunk.ts';
import { CHUNK_SIZE } from '../voxel/constants.ts';
import { hash2, hashToUnit } from '../math/rng.ts';

/** Alles, was Spalten aus einem Seed erzeugt (Weltgen v1, Laternenhafen, später Minispiele). */
export interface ColumnGenerator {
  readonly seed: number;
  generateColumn(cx: number, cz: number): Column;
}

/** Blockrollen für den Laternenhafen. */
export interface HafenBlocks {
  bedrock: number;
  stone: number;
  sand: number;
  dirt: number;
  grass: number;
  water: number;
  planks: number;
  log: number;
  lamp: number;
  frame: number;
  portal: number;
  leaves: number;
}

/** Wasseroberfläche (oberste Wasserlage). */
export const HAFEN_WATER_Y = 63;
/** Platzhöhe (oberster Block). */
export const HAFEN_PLAZA_Y = 70;
/** Portal zu den Dämmerlanden: Mittelpunkt der Leuchtfläche. */
export const HAFEN_PORTAL = { x: 0, z: -13, y0: HAFEN_PLAZA_Y + 1, height: 4, halfWidth: 1 };
export const HAFEN_SPAWN: [number, number, number] = [0.5, HAFEN_PLAZA_Y + 1, 4.5];

const ISLAND_R = 44;
const PLAZA_R = 16;

/**
 * Der Laternenhafen: eine kleine Insel im Meer mit gepflastertem Platz, Laternenring,
 * Blütenbäumen, Steg und einem Portal in die Dämmerlande. Jeder Block ist eine reine
 * Funktion der Weltkoordinate – Strukturen über Spaltengrenzen sind dadurch trivial.
 */
export class HafenGenerator implements ColumnGenerator {
  readonly seed: number;
  private readonly b: HafenBlocks;

  constructor(seed: number, blocks: HafenBlocks) {
    this.seed = seed >>> 0;
    this.b = blocks;
  }

  /** Geländehöhe (oberster fester Block) an (x,z). */
  groundY(x: number, z: number): number {
    const r = Math.hypot(x + 0.5, z + 0.5);
    const wobble = (hashToUnit(hash2(this.seed, Math.floor(x / 6), Math.floor(z / 6))) - 0.5) * 4;
    const edge = ISLAND_R + wobble;
    if (r <= PLAZA_R) return HAFEN_PLAZA_Y;
    if (r >= edge + 10) return 52;
    if (r >= edge) return Math.round(HAFEN_WATER_Y - 1 - ((r - edge) / 10) * 10);
    const t = (r - PLAZA_R) / (edge - PLAZA_R);
    return Math.round(HAFEN_PLAZA_Y - t * t * (HAFEN_PLAZA_Y - HAFEN_WATER_Y));
  }

  blockAt(x: number, y: number, z: number): number {
    const b = this.b;
    if (y === 0) return b.bedrock;
    const g = this.groundY(x, z);
    const r = Math.hypot(x + 0.5, z + 0.5);

    // Portal (Rahmen aus Basalt, Leuchtfläche in der x-Ebene bei z = PORTAL.z)
    const P = HAFEN_PORTAL;
    if (z === P.z && Math.abs(x - P.x) <= P.halfWidth + 1) {
      const top = P.y0 + P.height;
      if (y >= P.y0 && y <= top) {
        const inner = Math.abs(x - P.x) <= P.halfWidth && y < top;
        return inner ? b.portal : b.frame;
      }
    }

    // Laternenring um den Platz und Laternen am Steg
    if (y > HAFEN_PLAZA_Y && y <= HAFEN_PLAZA_Y + 4 && this.isLanternPost(x, z)) {
      return y === HAFEN_PLAZA_Y + 4 ? b.lamp : b.log;
    }

    // Steg nach Süden: von der Platzkante bis weit ins Wasser
    if (Math.abs(x) <= 1 && z >= PLAZA_R - 1 && z <= 72) {
      const deckY = Math.max(HAFEN_WATER_Y + 1, Math.min(HAFEN_PLAZA_Y, g));
      if (y === deckY && y > g - 1) return b.planks;
      if (y === deckY + 1 && Math.abs(x) === 1 && z % 8 === 0 && z > 24) return b.log;
      if (y === deckY + 2 && Math.abs(x) === 1 && z % 8 === 0 && z > 24) return b.lamp;
      if (y > deckY && y > g) return AIR;
    }

    // Blütenbäume auf der Wiese
    const tree = this.treeAt(x, z, y, g);
    if (tree !== AIR) return tree;

    if (y <= g) {
      if (r <= PLAZA_R) {
        if (y < g) return b.stone;
        // Pflaster: Ringe aus Stein und Brettern
        const ring = Math.floor(r / 3);
        return ring % 2 === 0 ? b.stone : b.planks;
      }
      if (y === g) return g >= HAFEN_WATER_Y + 1 && r < ISLAND_R - 4 ? b.grass : b.sand;
      if (y >= g - 3) return g >= HAFEN_WATER_Y ? b.dirt : b.sand;
      return b.stone;
    }
    if (y <= HAFEN_WATER_Y) return b.water;
    return AIR;
  }

  private isLanternPost(x: number, z: number): boolean {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      if (Math.round(Math.cos(a) * 14) === x && Math.round(Math.sin(a) * 14) === z) return true;
    }
    return false;
  }

  private treeAt(x: number, z: number, y: number, g: number): number {
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + 0.4;
      const tx = Math.round(Math.cos(a) * 27);
      const tz = Math.round(Math.sin(a) * 27);
      if (tz > 12 && Math.abs(tx) < 6) continue; // Steg frei lassen
      if (Math.abs(x - tx) > 2 || Math.abs(z - tz) > 2) continue;
      const base = this.groundY(tx, tz);
      const top = base + 5;
      if (x === tx && z === tz && y > base && y <= top) return this.b.log;
      const dx = x - tx;
      const dz = z - tz;
      const dy = y - top;
      if (y > g && dy >= -2 && dy <= 1 && dx * dx + dz * dz + dy * dy * 2 <= 8)
        return this.b.leaves;
    }
    return AIR;
  }

  generateColumn(cx: number, cz: number): Column {
    const col = newColumn(cx, cz);
    const x0 = cx * CHUNK_SIZE;
    const z0 = cz * CHUNK_SIZE;
    for (let lz = 0; lz < CHUNK_SIZE; lz++)
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const x = x0 + lx;
        const z = z0 + lz;
        let top = 0;
        for (let y = 0; y <= HAFEN_PLAZA_Y + 10; y++) {
          const v = this.blockAt(x, y, z);
          if (v !== AIR) {
            columnSet(col, lx, y, lz, v);
            top = y;
          }
        }
        col.height[lx + lz * CHUNK_SIZE] = top;
      }
    return col;
  }
}
