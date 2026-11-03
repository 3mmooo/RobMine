import { describe, expect, it } from 'vitest';
import { RenderPass } from '@robmine/core';
import { BLOCK, createBlockRegistry, WORLD_BLOCKS } from '../src/blocks.ts';
import { hexToRgb } from '../src/palette.ts';

describe('Block-Registry (content)', () => {
  it('registriert alle Blöcke mit festen IDs', () => {
    const reg = createBlockRegistry();
    for (const [name, id] of Object.entries(BLOCK)) {
      expect(reg.has(id), name).toBe(true);
    }
    expect(reg.get(BLOCK.Wasser).fluid).toBe(true);
    expect(reg.pass[BLOCK.Wasser]).toBe(RenderPass.Fluid);
    expect(reg.pass[BLOCK.HainBlaetter]).toBe(RenderPass.Cutout);
    expect(reg.pass[BLOCK.Feldstein]).toBe(RenderPass.Opaque);
    expect(reg.isEmissive(BLOCK.Glutfackel)).toBe(true);
    expect(reg.isEmissive(BLOCK.Erde)).toBe(false);
    expect(reg.opaque[BLOCK.Glas]).toBe(0);
  });

  it('Weltgen-Rollen zeigen auf gültige Blöcke', () => {
    const reg = createBlockRegistry();
    for (const id of Object.values(WORLD_BLOCKS)) expect(reg.has(id)).toBe(true);
  });

  it('hexToRgb wandelt korrekt', () => {
    expect(hexToRgb('#FF8000')).toEqual([255, 128, 0]);
  });
});
