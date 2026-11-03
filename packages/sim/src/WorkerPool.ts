/**
 * Abstraktion für Hintergrundarbeit (Weltgen, Meshing): Der Sim-Kern weiß nicht,
 * ob Jobs in Web Workers, worker_threads oder inline laufen.
 */
export interface JobRunner<Req, Res> {
  run(request: Req, transfer?: ArrayBuffer[], priority?: number): Promise<Res>;
  /** Anzahl noch nicht abgeschlossener Jobs. */
  readonly pending: number;
  dispose(): void;
}

/**
 * Führt Jobs synchron im selben Thread aus (Tests, Server-Fallback).
 * Hält den Vertrag: Fehler kommen als abgelehntes Promise, nie als synchroner Throw;
 * `pending` ist nach Rückgabe immer 0, weil der Job bereits gelaufen ist.
 */
export class InlineRunner<Req, Res> implements JobRunner<Req, Res> {
  private readonly fn: (req: Req) => Res;

  constructor(fn: (req: Req) => Res) {
    this.fn = fn;
  }

  get pending(): number {
    return 0;
  }

  run(request: Req): Promise<Res> {
    try {
      return Promise.resolve(this.fn(request));
    } catch (err) {
      return Promise.reject(err instanceof Error ? err : new Error(String(err)));
    }
  }

  dispose(): void {
    // nichts zu tun
  }
}
