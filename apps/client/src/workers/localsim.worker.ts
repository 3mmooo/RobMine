import { PortTransport } from '@robmine/protocol';
import { LocalInstance } from '@robmine/sim';

/**
 * Lokale Instanz (Solo): Der komplette Sim-Kern läuft hier im Worker und spricht
 * über einen MessagePort dasselbe Protokoll wie später der Server.
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
  instance = new LocalInstance(new PortTransport(init.port), {
    seed: init.seed,
    spawn: init.spawn,
    timeOfDay: init.timeOfDay,
    mode: 0,
  });
};
