import {
  type ColumnGenerator,
  HAFEN_SPAWN,
  HafenGenerator,
  type HafenBlocks,
  WorldGenerator,
} from '@robmine/core';
import { BLOCK, WORLD_BLOCKS } from './blocks.ts';

/** Welten: die Dämmerlande (unendlich, Survival) und der Laternenhafen (Treffpunkt). */
export type WorldId = 'welt' | 'hafen';
export const WORLD_IDS: readonly WorldId[] = ['welt', 'hafen'];
export const WORLD_TITLES: Record<WorldId, string> = {
  welt: 'Dämmerlande',
  hafen: 'Laternenhafen',
};

export function parseWorldId(s: string | null | undefined): WorldId | null {
  return s === 'welt' || s === 'hafen' ? s : null;
}

export const HAFEN_BLOCKS: HafenBlocks = {
  bedrock: BLOCK.Urgestein,
  stone: BLOCK.Feldstein,
  sand: BLOCK.Sand,
  dirt: BLOCK.Erde,
  grass: BLOCK.Gras,
  water: BLOCK.Wasser,
  planks: BLOCK.Hainbretter,
  log: BLOCK.HainStamm,
  lamp: BLOCK.Ambritlampe,
  frame: BLOCK.Basalt,
  portal: BLOCK.Portallicht,
  leaves: BLOCK.Bluetenblaetter,
};

export function createGenerator(world: WorldId, seed: number): ColumnGenerator {
  return world === 'hafen'
    ? new HafenGenerator(seed, HAFEN_BLOCKS)
    : new WorldGenerator(seed, WORLD_BLOCKS);
}

export function worldSpawn(world: WorldId): [number, number, number] {
  return world === 'hafen' ? [...HAFEN_SPAWN] : [8.5, 112, 8.5];
}
