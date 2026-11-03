/** Minimale Typen der Debug-API des Clients (window.__rm) für die E2E-Tests. */
interface RmDebugApiE2E {
  version: string;
  ready: boolean;
  frames: number;
  errors: string[];
  stats: () => unknown;
  report: () => string;
  teleport: (x: number, y: number, z: number) => void;
  setPose: (x: number, y: number, z: number, yaw: number, pitch: number) => void;
  setTime: (timeOfDay: number) => void;
  renderOnce: () => void;
  debug: () => Record<string, number>;
  setBlock: (x: number, y: number, z: number, block: number) => void;
  getBlock: (x: number, y: number, z: number) => number;
}

interface Window {
  __rm?: RmDebugApiE2E;
}
