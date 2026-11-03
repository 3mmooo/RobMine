import { BlockRegistry, type WorldBlocks } from '@robmine/core';
import { hexToRgb, PALETTE } from './palette.ts';

/** Feste Block-IDs – nie umnummerieren, gespeicherte Welten hängen daran. */
export const BLOCK = {
  Luft: 0,
  Feldstein: 1,
  Erde: 2,
  Gras: 3,
  Sand: 4,
  Kies: 5,
  Wasser: 6,
  HainStamm: 7,
  HainBlaetter: 8,
  Schnee: 9,
  Eis: 10,
  Urgestein: 11,
  Glutfackel: 12,
  Glas: 13,
  Ambritlampe: 14,
  Kristall: 15,
} as const;

/** Material-Muster-IDs für den Fragment-Shader. */
export const PATTERN = {
  Flat: 0,
  Stone: 1,
  Soil: 2,
  Grass: 3,
  Sand: 4,
  Wood: 5,
  Leaves: 6,
  Snow: 7,
} as const;

export function createBlockRegistry(): BlockRegistry {
  const reg = new BlockRegistry();
  reg.register({
    id: BLOCK.Feldstein,
    name: 'feldstein',
    label: 'Feldstein',
    colorSide: hexToRgb(PALETTE.stone),
    hardness: 1.5,
    pattern: PATTERN.Stone,
  });
  reg.register({
    id: BLOCK.Erde,
    name: 'erde',
    label: 'Erde',
    colorSide: hexToRgb(PALETTE.dirt),
    hardness: 0.5,
    pattern: PATTERN.Soil,
  });
  reg.register({
    id: BLOCK.Gras,
    name: 'gras',
    label: 'Grasboden',
    colorTop: hexToRgb(PALETTE.grassTop),
    colorSide: hexToRgb(PALETTE.grassSide),
    colorBottom: hexToRgb(PALETTE.dirt),
    hardness: 0.6,
    pattern: PATTERN.Grass,
  });
  reg.register({
    id: BLOCK.Sand,
    name: 'sand',
    label: 'Sand',
    colorSide: hexToRgb(PALETTE.sand),
    hardness: 0.5,
    pattern: PATTERN.Sand,
  });
  reg.register({
    id: BLOCK.Kies,
    name: 'kies',
    label: 'Kies',
    colorSide: hexToRgb(PALETTE.gravel),
    hardness: 0.6,
    pattern: PATTERN.Stone,
  });
  reg.register({
    id: BLOCK.Wasser,
    name: 'wasser',
    label: 'Wasser',
    colorSide: hexToRgb(PALETTE.water),
    hardness: -1,
    opaque: false,
    solid: false,
    fluid: true,
    attenuation: 1,
  });
  reg.register({
    id: BLOCK.HainStamm,
    name: 'hain_stamm',
    label: 'Hain-Stamm',
    colorTop: hexToRgb(PALETTE.logEnd),
    colorSide: hexToRgb(PALETTE.log),
    colorBottom: hexToRgb(PALETTE.logEnd),
    hardness: 2,
    pattern: PATTERN.Wood,
  });
  reg.register({
    id: BLOCK.HainBlaetter,
    name: 'hain_blaetter',
    label: 'Hain-Blätter',
    colorSide: hexToRgb(PALETTE.leaves),
    hardness: 0.2,
    opaque: false,
    cutout: true,
    attenuation: 1,
    pattern: PATTERN.Leaves,
  });
  reg.register({
    id: BLOCK.Schnee,
    name: 'schnee',
    label: 'Schnee',
    colorSide: hexToRgb(PALETTE.snow),
    hardness: 0.2,
    pattern: PATTERN.Snow,
  });
  reg.register({
    id: BLOCK.Eis,
    name: 'eis',
    label: 'Eis',
    colorSide: hexToRgb(PALETTE.ice),
    hardness: 0.5,
    opaque: false,
    cutout: true,
    attenuation: 1,
  });
  reg.register({
    id: BLOCK.Urgestein,
    name: 'urgestein',
    label: 'Urgestein',
    colorSide: hexToRgb(PALETTE.bedrock),
    hardness: -1,
    pattern: PATTERN.Stone,
  });
  reg.register({
    id: BLOCK.Glutfackel,
    name: 'glutfackel',
    label: 'Glutfackel',
    colorSide: hexToRgb(PALETTE.torch),
    hardness: 0.1,
    opaque: false,
    solid: false,
    light: [14, 11, 6],
  });
  reg.register({
    id: BLOCK.Glas,
    name: 'glas',
    label: 'Glas',
    colorSide: hexToRgb(PALETTE.glass),
    hardness: 0.3,
    opaque: false,
    cutout: true,
  });
  reg.register({
    id: BLOCK.Ambritlampe,
    name: 'ambritlampe',
    label: 'Ambritlampe',
    colorSide: hexToRgb(PALETTE.ambrit),
    hardness: 0.5,
    light: [15, 13, 7],
  });
  reg.register({
    id: BLOCK.Kristall,
    name: 'kristall',
    label: 'Kristall',
    colorSide: hexToRgb(PALETTE.crystal),
    hardness: 1.2,
    opaque: false,
    cutout: true,
    light: [10, 7, 15],
  });
  return reg;
}

/** Blockrollen für die Weltgen v1. */
export const WORLD_BLOCKS: WorldBlocks = {
  grass: BLOCK.Gras,
  dirt: BLOCK.Erde,
  stone: BLOCK.Feldstein,
  sand: BLOCK.Sand,
  gravel: BLOCK.Kies,
  water: BLOCK.Wasser,
  log: BLOCK.HainStamm,
  leaves: BLOCK.HainBlaetter,
  snow: BLOCK.Schnee,
  bedrock: BLOCK.Urgestein,
};
