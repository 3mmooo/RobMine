import { AIR, RenderPass, WorldGenerator } from '@robmine/core';
import { BLOCK, createBlockRegistry, WORLD_BLOCKS } from '@robmine/content';
import { PortTransport } from '@robmine/protocol';
import { LocalInstance } from '@robmine/sim';
import { IndexedDbColumnStorage } from '../storage/IndexedDbColumnStorage.ts';

/**
 * Lokale Instanz (Solo): Der komplette Sim-Kern läuft hier im Worker und spricht
 * über einen MessagePort dasselbe Protokoll wie später der Server. Veränderte
 * Spalten landen in IndexedDB (eine Datenbank je Seed).
 */
export interface LocalSimInit {
  port: MessagePort;
  seed: number;
  spawn: [number, number, number];
  timeOfDay: number;
}

const ctx = self as unknown as Worker;
let instance: LocalInstance | null = null;

ctx.onmessage = (ev: MessageEvent<LocalSimInit>) => {
  const init = ev.data;
  if (!init || !init.port) return;
  instance?.close();
  const registry = createBlockRegistry();
  const placeable = new Set<number>();
  for (const def of registry.defs) {
    if (!def || def.id === AIR || def.id === BLOCK.Urgestein) continue;
    if (registry.pass[def.id] === RenderPass.Fluid) continue;
    placeable.add(def.id);
  }
  instance = new LocalInstance(new PortTransport(init.port), {
    seed: init.seed,
    spawn: init.spawn,
    timeOfDay: init.timeOfDay,
    mode: 0,
    generator: new WorldGenerator(init.seed, WORLD_BLOCKS),
    storage: new IndexedDbColumnStorage(`robmine-world-${init.seed >>> 0}`),
    placeable,
    unbreakable: new Set([BLOCK.Urgestein]),
  });
  instance.replaceable.add(BLOCK.Wasser);
};
