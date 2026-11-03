import { BlockRegistry } from '../src/voxel/Block.ts';
import type { WorldBlocks } from '../src/worldgen/v1/pipeline.ts';

/** Minimale Test-Registry (unabhängig vom content-Paket). */
export function testRegistry(): {
  reg: BlockRegistry;
  blocks: WorldBlocks;
  glass: number;
  torch: number;
} {
  const reg = new BlockRegistry();
  const stone = reg.register({ id: 1, name: 'stone', label: 'Stein', colorSide: [120, 120, 120] });
  const dirt = reg.register({ id: 2, name: 'dirt', label: 'Erde', colorSide: [110, 80, 50] });
  const grass = reg.register({
    id: 3,
    name: 'grass',
    label: 'Gras',
    colorSide: [110, 80, 50],
    colorTop: [90, 170, 80],
  });
  const sand = reg.register({ id: 4, name: 'sand', label: 'Sand', colorSide: [220, 200, 150] });
  const gravel = reg.register({ id: 5, name: 'gravel', label: 'Kies', colorSide: [130, 130, 125] });
  const water = reg.register({
    id: 6,
    name: 'water',
    label: 'Wasser',
    colorSide: [60, 140, 210],
    opaque: false,
    solid: false,
    fluid: true,
    attenuation: 1,
  });
  const log = reg.register({ id: 7, name: 'log', label: 'Stamm', colorSide: [120, 90, 60] });
  const leaves = reg.register({
    id: 8,
    name: 'leaves',
    label: 'Blätter',
    colorSide: [70, 150, 60],
    opaque: false,
    cutout: true,
    attenuation: 1,
  });
  const snow = reg.register({ id: 9, name: 'snow', label: 'Schnee', colorSide: [240, 245, 255] });
  const bedrock = reg.register({
    id: 10,
    name: 'bedrock',
    label: 'Urgestein',
    colorSide: [40, 40, 45],
    hardness: -1,
  });
  const glass = reg.register({
    id: 11,
    name: 'glass',
    label: 'Glas',
    colorSide: [200, 230, 240],
    opaque: false,
    cutout: true,
  });
  const torch = reg.register({
    id: 12,
    name: 'torch',
    label: 'Fackel',
    colorSide: [255, 180, 90],
    opaque: false,
    solid: false,
    light: [14, 11, 6],
  });
  const simple = (
    id: number,
    name: string,
    extra: Partial<Parameters<typeof reg.register>[0]> = {},
  ) => reg.register({ id, name, label: name, colorSide: [100, 100, 100], ...extra });
  const forestGrass = simple(13, 'forest_grass');
  const blossomGrass = simple(14, 'blossom_grass');
  const blossomLeaves = simple(15, 'blossom_leaves', {
    opaque: false,
    cutout: true,
    attenuation: 1,
  });
  const needleLeaves = simple(16, 'needle_leaves', { opaque: false, cutout: true, attenuation: 1 });
  const moorGrass = simple(17, 'moor_grass');
  const ash = simple(18, 'ash');
  const basalt = simple(19, 'basalt');
  const crystal = simple(20, 'crystal', { opaque: false, cutout: true, light: [10, 7, 15] });
  return {
    reg,
    blocks: {
      grass: grass.id,
      dirt: dirt.id,
      stone: stone.id,
      sand: sand.id,
      gravel: gravel.id,
      water: water.id,
      log: log.id,
      leaves: leaves.id,
      snow: snow.id,
      bedrock: bedrock.id,
      forestGrass: forestGrass.id,
      blossomGrass: blossomGrass.id,
      blossomLeaves: blossomLeaves.id,
      needleLeaves: needleLeaves.id,
      moorGrass: moorGrass.id,
      ash: ash.id,
      basalt: basalt.id,
      crystal: crystal.id,
    },
    glass: glass.id,
    torch: torch.id,
  };
}

/** FNV-1a-Hash über ein Uint16Array (für Determinismus-Tests). */
export function hashU16(arr: Uint16Array | null): number {
  if (!arr) return 0;
  let h = 0x811c9dc5;
  for (let i = 0; i < arr.length; i++) {
    h ^= arr[i]!;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
