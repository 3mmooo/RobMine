export interface DebugReport {
  build: string;
  seed: number;
  quality: string;
  radius: number;
  fps: number;
  frameMs: number;
  frameMsP95: number;
  drawCalls: number;
  triangles: number;
  geometries: number;
  heapMB: number | null;
  gpu: string;
  camera: { x: number; y: number; z: number; yaw: number; pitch: number };
  timeOfDay: number;
  chunks: Record<string, number>;
}

/** Performance-/Welt-Overlay (F3) mit „Bericht kopieren". */
export class DebugOverlay {
  private readonly el: HTMLElement;
  private readonly text: HTMLElement;
  private readonly button: HTMLButtonElement;
  private visible = false;
  private frames = 0;
  private frameMsSum = 0;
  private frameMsList: number[] = [];
  private lastSample = performance.now();
  fps = 0;
  frameMs = 0;
  frameMsP95 = 0;
  private lastReport: DebugReport | null = null;
  private readonly provider: () => DebugReport;

  constructor(provider: () => DebugReport) {
    this.provider = provider;
    this.el =
      document.getElementById('debug') ?? document.body.appendChild(document.createElement('div'));
    this.el.className = 'debug hidden';
    this.text = document.createElement('div');
    this.button = document.createElement('button');
    this.button.textContent = 'Bericht kopieren';
    this.button.addEventListener('click', () => void this.copy());
    this.el.append(this.text, this.button);
    window.addEventListener('keydown', (e) => {
      if (e.code === 'F3') {
        e.preventDefault();
        this.toggle();
      }
    });
  }

  toggle(force?: boolean): void {
    this.visible = force ?? !this.visible;
    this.el.classList.toggle('hidden', !this.visible);
  }

  /** Je Frame aufrufen. */
  tick(frameMs: number): void {
    this.frames++;
    this.frameMsSum += frameMs;
    this.frameMsList.push(frameMs);
    const now = performance.now();
    if (now - this.lastSample >= 500) {
      const dt = (now - this.lastSample) / 1000;
      this.fps = this.frames / dt;
      this.frameMs = this.frameMsSum / Math.max(1, this.frames);
      const sorted = [...this.frameMsList].sort((a, b) => a - b);
      this.frameMsP95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
      this.frames = 0;
      this.frameMsSum = 0;
      this.frameMsList = [];
      this.lastSample = now;
      this.lastReport = this.provider();
      if (this.visible) this.render(this.lastReport);
    }
  }

  report(): DebugReport {
    return this.lastReport ?? this.provider();
  }

  private render(r: DebugReport): void {
    const c = r.camera;
    const lines = [
      `RobMine ${r.build} · Seed ${r.seed} · ${r.quality} · Radius ${r.radius}`,
      `FPS ${r.fps.toFixed(0)}  Frame ${r.frameMs.toFixed(2)} ms (p95 ${r.frameMsP95.toFixed(2)})`,
      `Draw Calls ${r.drawCalls}  Dreiecke ${(r.triangles / 1000).toFixed(0)}k  Geometrien ${r.geometries}`,
      `Heap ${r.heapMB === null ? '–' : r.heapMB.toFixed(0) + ' MB'}`,
      `Kamera ${c.x.toFixed(1)} ${c.y.toFixed(1)} ${c.z.toFixed(1)}  yaw ${c.yaw.toFixed(2)} pitch ${c.pitch.toFixed(2)}`,
      `Zeit ${formatTime(r.timeOfDay)}`,
      `Spalten ${r.chunks['columnsLoaded']}/${(r.chunks['columnsLoaded'] ?? 0) + (r.chunks['columnsRequested'] ?? 0)}  Chunks ${r.chunks['chunksMeshed']}  sichtbar ${r.chunks['chunksVisible']}`,
      `Jobs gen ${r.chunks['genPending']}  mesh ${r.chunks['meshPending']}  upload ${r.chunks['uploadsPending']}`,
      `Gen ${(r.chunks['genMsAvg'] ?? 0).toFixed(1)} ms (p95 ${(r.chunks['genMsP95'] ?? 0).toFixed(1)})  Licht ${(r.chunks['lightMsAvg'] ?? 0).toFixed(1)} ms`,
      `Mesh ${(r.chunks['meshMsAvg'] ?? 0).toFixed(1)} ms (p95 ${(r.chunks['meshMsP95'] ?? 0).toFixed(1)})  Pad ${(r.chunks['paddedMsAvg'] ?? 0).toFixed(2)} ms`,
      `Vertices opak ${((r.chunks['opaqueVertices'] ?? 0) / 1000).toFixed(0)}k  Überlauf ${r.chunks['overflow']}`,
      `GPU ${r.gpu}`,
    ];
    this.text.textContent = lines.join('\n');
  }

  private async copy(): Promise<void> {
    const json = JSON.stringify(this.report(), null, 2);
    try {
      await navigator.clipboard.writeText(json);
      this.button.textContent = 'Kopiert ✓';
    } catch {
      this.button.textContent = 'Kopieren fehlgeschlagen';
      console.log(json);
    }
    setTimeout(() => (this.button.textContent = 'Bericht kopieren'), 1500);
  }
}

export function formatTime(t: number): string {
  const total = ((t % 1440) + 1440) % 1440;
  const h = Math.floor(total / 60);
  const m = Math.floor(total % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
