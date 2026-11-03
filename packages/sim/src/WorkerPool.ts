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

/** Führt Jobs synchron im selben Thread aus (Tests, Server-Fallback). */
export class InlineRunner<Req, Res> implements JobRunner<Req, Res> {
  private inFlight = 0;
  private readonly fn: (req: Req) => Res;

  constructor(fn: (req: Req) => Res) {
    this.fn = fn;
  }

  get pending(): number {
    return this.inFlight;
  }

  run(request: Req): Promise<Res> {
    this.inFlight++;
    try {
      return Promise.resolve(this.fn(request));
    } finally {
      this.inFlight--;
    }
  }

  dispose(): void {
    // nichts zu tun
  }
}
