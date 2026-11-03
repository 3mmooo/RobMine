import type { DebugReport } from '../ui/DebugOverlay.ts';

/** Schnittstelle für E2E-Tests und Konsole: window.__rm */
export interface RmDebugApi {
  version: string;
  ready: boolean;
  /** Frames seit Start. */
  frames: number;
  stats: () => DebugReport;
  report: () => string;
  teleport: (x: number, y: number, z: number) => void;
  setTime: (timeOfDay: number) => void;
  setPose: (x: number, y: number, z: number, yaw: number, pitch: number) => void;
  renderOnce: () => void;
  /** Zustände der Spalten/Batches (siehe ChunkManager.debugSummary). */
  debug: () => Record<string, number>;
  errors: string[];
}

declare global {
  interface Window {
    __rm?: RmDebugApi;
  }
}

export function exposeDebugApi(api: RmDebugApi): void {
  window.__rm = api;
  window.addEventListener('error', (e) => api.errors.push(String(e.message)));
  window.addEventListener('unhandledrejection', (e) =>
    api.errors.push(String((e.reason as Error)?.message ?? e.reason)),
  );
}
