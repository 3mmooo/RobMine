import { describe, expect, it } from 'vitest';
import { createRng } from '@robmine/core';
import { BLOCK, createBlockRegistry, dropsFor, ITEM, RECIPES } from '@robmine/content';
import { canCraft, craft, Inventory } from '../src/inventory.ts';
import {
  createSurvival,
  damage,
  eat,
  fallDamage,
  respawn,
  SURVIVAL,
  tickSurvival,
} from '../src/survival.ts';
import { CreatureSystem, type CreatureWorld, HUSCHER } from '../src/creatures.ts';

const recipe = (id: string) => RECIPES.find((r) => r.id === id)!;

describe('Inventar & Crafting', () => {
  it('Stamm → Bretter → Werkbank, Fackeln nur an der Werkbank', () => {
    const inv = new Inventory();
    inv.add(BLOCK.HainStamm, 2);
    inv.add(BLOCK.Feldstein, 1);
    expect(craft(inv, recipe('bretter'), false)).toBe(true);
    expect(craft(inv, recipe('bretter'), false)).toBe(true);
    expect(inv.count(BLOCK.Hainbretter)).toBe(8);
    expect(inv.has(BLOCK.HainStamm)).toBe(false);
    expect(craft(inv, recipe('werkbank'), false)).toBe(true);
    expect(inv.count(BLOCK.Werkbank)).toBe(1);
    expect(canCraft(inv, recipe('fackel'), false)).toBe(false);
    expect(craft(inv, recipe('fackel'), true)).toBe(true);
    expect(inv.count(BLOCK.Glutfackel)).toBe(4);
    expect(inv.count(BLOCK.Hainbretter)).toBe(3);
    // fehlt Zutat → nichts passiert
    expect(craft(inv, recipe('fackel'), true)).toBe(false);
    expect(inv.count(BLOCK.Hainbretter)).toBe(3);
  });

  it('Jedes Rezept ist aus abbaubaren Rohstoffen erreichbar', () => {
    const reg = createBlockRegistry();
    // Rohstoffe aus der Welt (Drops) + Kreaturen-Drop
    const raw = new Set<number>([ITEM.Schattenstaub]);
    for (const def of reg.defs) {
      if (!def) continue;
      for (const [id] of dropsFor(reg, def.id, 0)) raw.add(id);
    }
    const reachable = new Set(raw);
    for (let changed = true; changed;) {
      changed = false;
      for (const r of RECIPES) {
        if (reachable.has(r.out)) continue;
        if (r.inputs.every(([id]) => reachable.has(id))) {
          reachable.add(r.out);
          changed = true;
        }
      }
    }
    for (const r of RECIPES) expect(reachable.has(r.out), r.id).toBe(true);
  });

  it('Drops: Gras → Erde, Blätter → manchmal Glimmbeere, Urgestein nichts', () => {
    const reg = createBlockRegistry();
    expect(dropsFor(reg, BLOCK.Gras, 0.5)).toEqual([[BLOCK.Erde, 1]]);
    expect(dropsFor(reg, BLOCK.HainBlaetter, 0.1)).toEqual([[ITEM.Glimmbeere, 1]]);
    expect(dropsFor(reg, BLOCK.HainBlaetter, 0.9)).toEqual([]);
    expect(dropsFor(reg, BLOCK.Urgestein, 0)).toEqual([]);
    expect(dropsFor(reg, BLOCK.Feldstein, 0)).toEqual([[BLOCK.Feldstein, 1]]);
  });

  it('JSON-Roundtrip', () => {
    const inv = new Inventory();
    inv.add(5, 3);
    inv.add(ITEM.Glimmbeere, 2);
    const back = Inventory.fromJSON(JSON.parse(JSON.stringify(inv.toJSON())));
    expect(back.count(5)).toBe(3);
    expect(back.count(ITEM.Glimmbeere)).toBe(2);
  });
});

describe('Survival', () => {
  it('Hunger sinkt, Regeneration nur bei Sättigung > 6, kein Hungertod', () => {
    const s = createSurvival();
    damage(s, 5);
    tickSurvival(s, SURVIVAL.regenInterval * 2 + 0.01, false);
    expect(s.health).toBe(17);
    s.hunger = 0;
    tickSurvival(s, 1000, false);
    expect(s.health).toBe(17);
    expect(s.dead).toBe(false);
    expect(eat(s, 4)).toBe(true);
    expect(s.hunger).toBe(4);
  });

  it('Fallschaden ab 4 Blöcken, bei vollem Leben nie tödlich; Tod und Wiederaufleben', () => {
    const s = createSurvival();
    expect(fallDamage(s, 3)).toBe(0);
    expect(fallDamage(s, 6)).toBe(3);
    expect(fallDamage(s, 100)).toBe(19);
    damage(s, 25);
    expect(s.dead).toBe(true);
    respawn(s);
    expect(s.dead).toBe(false);
    expect(s.health).toBe(SURVIVAL.maxHealth);
  });

  it('Treffer-Abklingzeit verhindert Schaden in jedem Frame', () => {
    const s = createSurvival();
    expect(damage(s, 2)).toBe(true);
    expect(damage(s, 2)).toBe(false);
    tickSurvival(s, 1, false);
    expect(damage(s, 2)).toBe(true);
  });
});

describe('Schattenbrut', () => {
  // Flache Welt: Boden y ≤ 10. Licht steuerbar.
  let light = 0;
  const world: CreatureWorld = {
    isSolid: (_x, y) => y <= 10,
    isFluid: () => false,
    lightAt: () => light,
    surfaceY: () => 10,
  };
  const player = { x: 0, y: 11, z: 0, alive: true };

  it('spawnt nur im Dunkeln, jagt den Spieler und greift an', () => {
    const sys = new CreatureSystem();
    const rng = createRng(1);
    light = 15;
    for (let i = 0; i < 100; i++) sys.update(0.1, player, world, rng);
    expect(sys.creatures.length).toBe(0);
    light = 0;
    for (let i = 0; i < 30; i++) sys.update(0.1, player, world, rng);
    expect(sys.creatures.length).toBeGreaterThan(0);
    let dmg = 0;
    for (let i = 0; i < 600; i++) dmg += sys.update(1 / 30, player, world, rng).playerDamage;
    expect(dmg).toBeGreaterThan(0);
  });

  it('verbrennt im Licht', () => {
    const sys = new CreatureSystem();
    sys.enabled = true;
    sys.spawnAt(10.5, 11, 0.5);
    light = 13;
    const rng = createRng(2);
    let burned = 0;
    for (let i = 0; i < 100 && sys.creatures.length > 0; i++)
      burned += sys
        .update(0.1, { ...player, alive: false }, world, rng)
        .died.filter((d) => d.burned).length;
    expect(burned).toBe(1);
    expect(sys.creatures.length).toBe(0);
    expect(HUSCHER.maxHealth / HUSCHER.burnDps).toBeLessThan(10);
  });

  it('Raycast trifft den Körper, Treffer tötet nach genug Schaden', () => {
    const sys = new CreatureSystem();
    const c = sys.spawnAt(5.5, 11, 0.5);
    const hit = sys.raycast(0, 12.5, 0.5, 1, 0, 0, 10);
    expect(hit?.creature).toBe(c);
    expect(hit!.dist).toBeCloseTo(5.1, 1);
    expect(sys.raycast(0, 12.5, 0.5, -1, 0, 0, 10)).toBeNull();
    expect(sys.hit(c, 4, 0, 0)).toBe(false);
    expect(sys.hit(c, 8, 0, 0)).toBe(true);
  });
});
