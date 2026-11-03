import { type BlockRegistry, RenderPass } from '@robmine/core';
import { BLOCK } from './blocks.ts';
import { hexToRgb, PALETTE } from './palette.ts';

/** Items, die keine Blöcke sind, haben IDs ab 1000. */
export const ITEM = {
  Glimmbeere: 1001,
  Schattenstaub: 1002,
} as const;

export interface ItemDef {
  id: number;
  label: string;
  color: readonly [number, number, number];
  /** Sättigung beim Essen (0 = nicht essbar). */
  food: number;
}

export const ITEMS: Record<number, ItemDef> = {
  [ITEM.Glimmbeere]: {
    id: ITEM.Glimmbeere,
    label: 'Glimmbeere',
    color: hexToRgb(PALETTE.glimmberry),
    food: 4,
  },
  [ITEM.Schattenstaub]: {
    id: ITEM.Schattenstaub,
    label: 'Schattenstaub',
    color: hexToRgb(PALETTE.shadowDust),
    food: 0,
  },
};

export function isItem(id: number): boolean {
  return id >= 1000;
}

/** Anzeigename + Farbe für Blöcke und Items. */
export function describe(reg: BlockRegistry, id: number): { label: string; rgb: string } {
  if (isItem(id)) {
    const it = ITEMS[id];
    const c = it?.color ?? [200, 200, 200];
    return { label: it?.label ?? `Item ${id}`, rgb: `rgb(${c[0]},${c[1]},${c[2]})` };
  }
  const def = reg.get(id);
  const o = id * 3;
  return {
    label: def.label,
    rgb: `rgb(${reg.colorTop[o]},${reg.colorTop[o + 1]},${reg.colorTop[o + 2]})`,
  };
}

export interface Recipe {
  id: string;
  out: number;
  count: number;
  inputs: readonly (readonly [number, number])[];
  /** Muss eine Werkbank in der Nähe stehen? */
  workbench: boolean;
}

export const RECIPES: readonly Recipe[] = [
  {
    id: 'bretter',
    out: BLOCK.Hainbretter,
    count: 4,
    inputs: [[BLOCK.HainStamm, 1]],
    workbench: false,
  },
  {
    id: 'werkbank',
    out: BLOCK.Werkbank,
    count: 1,
    inputs: [[BLOCK.Hainbretter, 4]],
    workbench: false,
  },
  {
    id: 'fackel',
    out: BLOCK.Glutfackel,
    count: 4,
    inputs: [
      [BLOCK.Hainbretter, 1],
      [BLOCK.Feldstein, 1],
    ],
    workbench: true,
  },
  { id: 'glas', out: BLOCK.Glas, count: 1, inputs: [[BLOCK.Sand, 2]], workbench: true },
  {
    id: 'ambritlampe',
    out: BLOCK.Ambritlampe,
    count: 1,
    inputs: [
      [BLOCK.Glas, 1],
      [BLOCK.Kristall, 1],
    ],
    workbench: true,
  },
  {
    id: 'kristallfackel',
    out: BLOCK.Kristall,
    count: 1,
    inputs: [
      [ITEM.Schattenstaub, 3],
      [BLOCK.Glas, 1],
    ],
    workbench: true,
  },
];

/** Was ein abgebauter Block fallen lässt (`rand` in [0, 1)). */
export function dropsFor(reg: BlockRegistry, block: number, rand: number): [number, number][] {
  switch (block) {
    case BLOCK.Gras:
    case BLOCK.Waldgras:
    case BLOCK.Bluetengras:
    case BLOCK.Moorgras:
      return [[BLOCK.Erde, 1]];
    case BLOCK.HainBlaetter:
    case BLOCK.Bluetenblaetter:
    case BLOCK.Nadelblaetter:
      return rand < 0.3 ? [[ITEM.Glimmbeere, 1]] : [];
    case BLOCK.Urgestein:
      return [];
    default:
      if (reg.pass[block] === RenderPass.Fluid) return [];
      return [[block, 1]];
  }
}
