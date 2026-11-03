import type { JobRunner } from '@robmine/sim';

/**
 * Typisierter Request/Response-Wrapper für Web Worker mit Prioritäts-Queue
 * und Transferables – bewusst ohne comlink (kein Proxy-Overhead im Hot-Path).
 */
interface Pending<Req, Res> {
  id: number;
  req: Req;
  transfer: ArrayBuffer[];
  priority: number;
  resolve: (res: Res) => void;
  reject: (err: Error) => void;
}

interface WorkerSlot {
  worker: Worker;
  busy: Pending<unknown, unknown> | null;
}

export interface WorkerResponse<Res> {
  id: number;
  res?: Res;
  error?: string;
}

export class WorkerPool<Req, Res> implements JobRunner<Req, Res> {
  private readonly slots: WorkerSlot[] = [];
  private readonly queue: Pending<Req, Res>[] = [];
  private nextId = 1;
  private inFlight = 0;
  private disposed = false;

  constructor(factory: () => Worker, size: number) {
    for (let i = 0; i < Math.max(1, size); i++) {
      const worker = factory();
      const slot: WorkerSlot = { worker, busy: null };
      worker.onmessage = (ev: MessageEvent<WorkerResponse<Res>>) => this.onResult(slot, ev.data);
      worker.onerror = (ev) => {
        const p = slot.busy as Pending<Req, Res> | null;
        slot.busy = null;
        if (p) {
          this.inFlight--;
          p.reject(new Error(`Worker-Fehler: ${ev.message}`));
        }
        this.pump();
      };
      this.slots.push(slot);
    }
  }

  get pending(): number {
    return this.inFlight;
  }

  get queued(): number {
    return this.queue.length;
  }

  get size(): number {
    return this.slots.length;
  }

  run(request: Req, transfer: ArrayBuffer[] = [], priority = 0): Promise<Res> {
    if (this.disposed) return Promise.reject(new Error('Pool ist geschlossen'));
    return new Promise<Res>((resolve, reject) => {
      const p: Pending<Req, Res> = {
        id: this.nextId++,
        req: request,
        transfer,
        priority,
        resolve,
        reject,
      };
      this.inFlight++;
      // Einsortieren nach Priorität (kleiner = früher). Lineare Suche reicht für wenige hundert Jobs.
      let i = this.queue.length;
      while (i > 0 && this.queue[i - 1]!.priority > priority) i--;
      this.queue.splice(i, 0, p);
      this.pump();
    });
  }

  /** Entfernt noch nicht gestartete Jobs, für die `keep` false liefert. */
  prune(keep: (req: Req) => boolean): number {
    let removed = 0;
    for (let i = this.queue.length - 1; i >= 0; i--) {
      const p = this.queue[i]!;
      if (!keep(p.req)) {
        this.queue.splice(i, 1);
        this.inFlight--;
        removed++;
        p.reject(new Error('abgebrochen'));
      }
    }
    return removed;
  }

  private pump(): void {
    for (const slot of this.slots) {
      if (slot.busy || this.queue.length === 0) continue;
      const p = this.queue.shift()!;
      slot.busy = p as Pending<unknown, unknown>;
      slot.worker.postMessage({ id: p.id, req: p.req }, p.transfer);
    }
  }

  private onResult(slot: WorkerSlot, data: WorkerResponse<Res>): void {
    const p = slot.busy as Pending<Req, Res> | null;
    slot.busy = null;
    if (p && p.id === data.id) {
      this.inFlight--;
      if (data.error !== undefined) p.reject(new Error(data.error));
      else p.resolve(data.res as Res);
    }
    this.pump();
  }

  dispose(): void {
    this.disposed = true;
    for (const slot of this.slots) slot.worker.terminate();
    for (const p of this.queue) p.reject(new Error('Pool geschlossen'));
    this.queue.length = 0;
    this.inFlight = 0;
  }
}

/** Worker-Seite: beantwortet Requests des WorkerPool. */
export function serveWorker<Req, Res>(
  handler: (req: Req) => { res: Res; transfer: ArrayBuffer[] },
): void {
  const ctx = self as unknown as Worker;
  ctx.onmessage = (ev: MessageEvent<{ id: number; req: Req }>) => {
    const { id, req } = ev.data;
    try {
      const { res, transfer } = handler(req);
      ctx.postMessage({ id, res } satisfies WorkerResponse<Res>, transfer);
    } catch (err) {
      ctx.postMessage({
        id,
        error: err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err),
      });
    }
  };
}
