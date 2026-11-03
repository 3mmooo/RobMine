import { normalizeSeed } from '@robmine/core';
import { PortTransport } from '@robmine/protocol';
import { Renderer, type QualityLevel } from './render/Renderer.ts';
import { ChunkManager } from './world/ChunkManager.ts';
import { FlyCamera } from './input/FlyCamera.ts';
import { DebugOverlay, type DebugReport } from './ui/DebugOverlay.ts';
import { exposeDebugApi } from './debug/expose.ts';
import { Connection } from './net/Connection.ts';
import { WorkerPool } from './workers/rpc.ts';
import type { GenRequest, GenResponse, MeshRequest, MeshResponse } from './workers/jobs.ts';
import type { LocalSimInit } from './workers/localsim.worker.ts';

const BUILD = 'phase0';

interface Params {
  seed: number;
  deterministic: boolean;
  timeOfDay: number;
  quality: QualityLevel;
  radius: number | undefined;
  cam: [number, number, number, number, number] | null;
  debug: boolean;
  /** Debug: Render-Pässe ausblenden (opaque, cutout, fluid, sky). */
  hide: string[];
}

function readParams(): Params {
  const q = new URLSearchParams(location.search);
  const quality = (q.get('quality') ?? 'medium') as QualityLevel;
  const camRaw = q.get('cam');
  let cam: Params['cam'] = null;
  if (camRaw) {
    const parts = camRaw.split(',').map(Number);
    if (parts.length === 5 && parts.every((n) => Number.isFinite(n)))
      cam = parts as [number, number, number, number, number];
  }
  const radius = q.get('radius') ? Number(q.get('radius')) : undefined;
  return {
    seed: normalizeSeed(q.get('seed') ?? '42'),
    deterministic: q.get('det') === '1',
    timeOfDay: q.get('t') ? Number(q.get('t')) : 600,
    quality: ['low', 'medium', 'high'].includes(quality) ? quality : 'medium',
    radius:
      radius && Number.isFinite(radius) ? Math.max(2, Math.min(16, Math.round(radius))) : undefined,
    cam,
    debug: q.get('debug') === '1',
    hide: (q.get('hide') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  };
}

async function main(): Promise<void> {
  const params = readParams();
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const hint = document.getElementById('hint');

  const renderer = new Renderer(canvas, params.quality, params.radius);
  const fly = new FlyCamera(renderer.camera, canvas);
  fly.enabled = !params.deterministic;
  for (const h of params.hide) {
    if (h === 'opaque') renderer.opaque.setVisible(false);
    if (h === 'cutout') renderer.cutout.setVisible(false);
    if (h === 'fluid') renderer.fluid.setVisible(false);
    if (h === 'sky') renderer.sky.mesh.visible = false;
  }

  // Worker-Pools
  const cores = navigator.hardwareConcurrency || 4;
  const genPool = new WorkerPool<GenRequest, GenResponse>(
    () => new Worker(new URL('./workers/gen.worker.ts', import.meta.url), { type: 'module' }),
    Math.min(4, Math.max(1, cores - 2)),
  );
  const meshPool = new WorkerPool<MeshRequest, MeshResponse>(
    () => new Worker(new URL('./workers/mesh.worker.ts', import.meta.url), { type: 'module' }),
    2,
  );

  // Lokale Instanz im Worker, Verbindung über MessageChannel (gleiches Protokoll wie online).
  const simWorker = new Worker(new URL('./workers/localsim.worker.ts', import.meta.url), {
    type: 'module',
  });
  const channel = new MessageChannel();
  const spawn: [number, number, number] = [8.5, 112, 8.5];
  const init: LocalSimInit = {
    port: channel.port2,
    seed: params.seed,
    spawn,
    timeOfDay: params.timeOfDay,
  };
  simWorker.postMessage(init, [channel.port2]);
  const connection = new Connection(new PortTransport(channel.port1));
  connection.onFail = (err) => {
    console.error('Verbindung verloren:', err.message);
    if (hint) {
      hint.textContent = `Verbindung verloren: ${err.message} – Seite neu laden.`;
      hint.classList.remove('hidden');
    }
  };
  const welcome = await connection.hello('', BUILD);

  const chunks = new ChunkManager(
    renderer,
    connection,
    genPool,
    meshPool,
    welcome.worldSeed,
    renderer.preset.radius,
  );

  // Startpose: Spawn oder Deterministik-Kamera.
  if (params.cam)
    fly.setPose(params.cam[0], params.cam[1], params.cam[2], params.cam[3], params.cam[4]);
  else fly.setPose(welcome.spawn[0], welcome.spawn[1], welcome.spawn[2], -0.6, -0.22);

  let timeOfDay = params.deterministic ? params.timeOfDay : welcome.timeOfDay;
  renderer.setTimeOfDay(timeOfDay);

  const api = {
    version: BUILD,
    ready: false,
    frames: 0,
    errors: [] as string[],
    stats: (): DebugReport => overlay.fresh(),
    report: () => JSON.stringify(overlay.fresh(), null, 2),
    teleport: (x: number, y: number, z: number) => {
      fly.setPose(x, y, z, fly.yaw, fly.pitch);
      chunks.resetCenter();
      api.ready = false;
    },
    setPose: (x: number, y: number, z: number, yaw: number, pitch: number) => {
      fly.setPose(x, y, z, yaw, pitch);
      chunks.resetCenter();
    },
    setTime: (t: number) => {
      timeOfDay = t;
      renderer.setTimeOfDay(timeOfDay);
    },
    renderOnce: () => frame(performance.now(), true),
    debug: () => chunks.debugSummary(),
  };
  exposeDebugApi(api);

  const gpu = describeGpu(renderer);
  const overlay = new DebugOverlay(() => ({
    build: BUILD,
    seed: params.seed,
    quality: params.quality,
    radius: chunks.radius,
    fps: overlay.fps,
    frameMs: overlay.frameMs,
    frameMsP95: overlay.frameMsP95,
    drawCalls: renderer.drawCalls,
    triangles: renderer.triangles,
    geometries: renderer.geometries,
    heapMB: heapMB(),
    gpu,
    camera: {
      x: fly.position.x,
      y: fly.position.y,
      z: fly.position.z,
      yaw: fly.yaw,
      pitch: fly.pitch,
    },
    timeOfDay,
    chunks: { ...chunks.stats() } as unknown as Record<string, number>,
  }));
  if (params.debug) overlay.toggle(true);

  let last = performance.now();
  let elapsed = 0;
  let hintHidden = false;

  function frame(now: number, force = false): void {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!params.deterministic) {
      elapsed += dt;
      timeOfDay = (timeOfDay + dt) % 1440;
      if (api.frames % 4 === 0) renderer.setTimeOfDay(timeOfDay);
    }
    fly.update(dt);
    chunks.update(fly.position.x, fly.position.z);
    chunks.applyPending();
    renderer.render(elapsed);
    api.frames++;
    overlay.tick(performance.now() - now);
    if (!api.ready && chunks.settled) api.ready = true;
    if (!hintHidden && fly.isLocked && hint) {
      hint.classList.add('hidden');
      hintHidden = true;
    }
    if (!force) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

function heapMB(): number | null {
  const mem = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
  return mem ? mem.usedJSHeapSize / (1024 * 1024) : null;
}

function describeGpu(renderer: Renderer): string {
  try {
    const gl = renderer.gl.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (ext) return String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL));
    return String(gl.getParameter(gl.RENDERER));
  } catch {
    return 'unbekannt';
  }
}

main().catch((err) => {
  console.error(err);
  const el = document.getElementById('hint');
  if (el) el.textContent = `Fehler beim Start: ${(err as Error).message}`;
});
