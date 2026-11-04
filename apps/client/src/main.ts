import { AIR, normalizeSeed, PLAYER, RenderPass } from '@robmine/core';
import {
  avatarFromNumber,
  BLOCK,
  createBlockRegistry,
  ITEM,
  normalizeAvatar,
  parseWorldId,
  SAFE_PHRASES,
  WORLD_TITLES,
  type WorldId,
} from '@robmine/content';
import { Hotbar } from './ui/Hotbar.ts';
import { Interaction } from './game/Interaction.ts';
import { Game } from './game/Game.ts';
import { BreakParticles } from './render/BreakParticles.ts';
import {
  openWebSocket,
  PortTransport,
  type Transport,
  WebSocketTransport,
  WelcomeFlag,
} from '@robmine/protocol';
import { RemotePlayers } from './render/RemotePlayers.ts';
import { Chat } from './ui/Chat.ts';
import { AvatarEditor } from './ui/AvatarEditor.ts';
import { AccountPanel, storedToken } from './ui/AccountPanel.ts';
import { SelfView } from './render/SelfView.ts';
import { Renderer, type QualityLevel } from './render/Renderer.ts';
import { ChunkManager } from './world/ChunkManager.ts';
import { FlyCamera } from './input/FlyCamera.ts';
import { DebugOverlay, type DebugReport } from './ui/DebugOverlay.ts';
import { exposeDebugApi } from './debug/expose.ts';
import { Connection } from './net/Connection.ts';
import { WorkerPool } from './workers/rpc.ts';
import type { GenRequest, GenResponse, MeshRequest, MeshResponse } from './workers/jobs.ts';
import type { LocalSimInit } from './workers/localsim.worker.ts';

const BUILD = 'phase5';

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
  /** Mehrspieler: WebSocket-URL des Servers (z. B. wss://spiel.example.de/ws). */
  server: string | null;
  name: string;
  /** Welt: 'hafen' (Laternenhafen) oder 'welt' (Dämmerlande); null = Standard. */
  world: WorldId | null;
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
    server: q.get('server'),
    name: q.get('name') ?? storedName(),
    world: parseWorldId(q.get('world')),
  };
}

/** Eigener Avatar aus localStorage (einmal zufällig erzeugt). */
function storedAvatar(): string {
  try {
    let a = localStorage.getItem('robmine-avatar');
    if (!a) {
      a = avatarFromNumber(Math.floor(Math.random() * 1e9));
      localStorage.setItem('robmine-avatar', a);
    }
    return normalizeAvatar(a);
  } catch {
    return avatarFromNumber(7);
  }
}

/** Seite mit anderer Welt neu laden (Portal, H, „Hingehen"). */
function gotoWorld(world: WorldId): void {
  const q = new URLSearchParams(location.search);
  q.set('world', world);
  location.search = q.toString();
}

/** Fragt `./server.json` ab (liefert nur der Spielserver aus); sonst Solo. */
async function detectServer(): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 1500);
    const res = await fetch('./server.json', { signal: ctrl.signal, cache: 'no-store' });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = (await res.json()) as { ws?: string };
    return typeof data.ws === 'string' ? data.ws : null;
  } catch {
    return null;
  }
}

/** Anzeigename aus localStorage (einmal zufällig erzeugt). */
function storedName(): string {
  try {
    let n = localStorage.getItem('robmine-name');
    if (!n) {
      n = `Wanderer${1000 + Math.floor(Math.random() * 9000)}`;
      localStorage.setItem('robmine-name', n);
    }
    return n;
  } catch {
    return 'Wanderer';
  }
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

  // Verbindung: Server (Mehrspieler) oder lokale Instanz im Worker – gleiches Protokoll.
  let transport: Transport;
  // Wird das Spiel vom Spielserver selbst ausgeliefert, verbindet es sich automatisch.
  if (!params.server && !params.deterministic) params.server = await detectServer();
  if (params.server === 'auto')
    params.server = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  // Mit Server startet man im Laternenhafen, solo in den Dämmerlanden.
  const world: WorldId = params.world ?? (params.server ? 'hafen' : 'welt');
  const hub = world === 'hafen';
  let wsUrl = params.server;
  if (wsUrl && /\/ws\/?$/.test(wsUrl)) wsUrl = `${wsUrl.replace(/\/$/, '')}/${world}`;
  if (wsUrl) {
    if (hint) hint.textContent = `Verbinde mit ${WORLD_TITLES[world]} …`;
    transport = new WebSocketTransport(await openWebSocket(wsUrl));
  } else {
    const simWorker = new Worker(new URL('./workers/localsim.worker.ts', import.meta.url), {
      type: 'module',
    });
    const channel = new MessageChannel();
    const init: LocalSimInit = {
      port: channel.port2,
      seed: params.seed,
      world,
      timeOfDay: params.timeOfDay,
    };
    simWorker.postMessage(init, [channel.port2]);
    transport = new PortTransport(channel.port1);
  }
  const connection = new Connection(transport);
  connection.onFail = (err) => {
    console.error('Verbindung verloren:', err.message);
    if (hint) {
      hint.textContent = `Verbindung verloren: ${err.message} – Seite neu laden.`;
      hint.classList.remove('hidden');
    }
  };
  const avatar = storedAvatar();
  const token = params.server ? storedToken() : '';
  const welcome = await connection.hello(params.name, avatar, BUILD, token);
  const safeChat = (welcome.flags & WelcomeFlag.SafeChat) !== 0;

  const chunks = new ChunkManager(
    renderer,
    connection,
    genPool,
    meshPool,
    welcome.worldSeed,
    renderer.preset.radius,
  );
  chunks.world = welcome.world;

  // Bauen: Hotbar, Partikel, Anvisieren; bestätigte Änderungen vom Server einarbeiten.
  const registry = createBlockRegistry();
  const placeable = registry.defs
    .filter((d) => d && d.id !== AIR && d.id !== BLOCK.Urgestein && !d.fluid)
    .map((d) => d!.id);
  const hotbar = new Hotbar(
    registry,
    [
      BLOCK.HainStamm,
      BLOCK.Hainbretter,
      BLOCK.Werkbank,
      BLOCK.Glutfackel,
      BLOCK.Feldstein,
      BLOCK.Erde,
      BLOCK.Glas,
      BLOCK.Ambritlampe,
      ITEM.Glimmbeere,
    ],
    placeable,
  );
  const particles = new BreakParticles();
  renderer.scene.add(particles.mesh);

  // Spielzustand (Survival/Kreativ, Inventar, Leben, Schattenbrut) – nicht im Testmodus.
  // Im Laternenhafen gibt es kein Survival und kein Bauen.
  const game =
    params.deterministic || hub
      ? null
      : new Game(registry, fly, chunks, renderer, hotbar, particles, welcome.worldSeed);
  if (game) hotbar.setSource(game);
  else document.querySelector('.hotbar')?.classList.add('hidden');

  connection.onBlockUpdate = (updates) => {
    for (const u of updates) {
      const old = chunks.getBlock(u.x, u.y, u.z);
      chunks.applyBlockUpdate(u.x, u.y, u.z, u.block, registry);
      game?.onBlockConfirmed(u.x, u.y, u.z, old, u.block);
    }
  };
  const interaction = game
    ? new Interaction(renderer, fly, chunks, registry, connection, hotbar, particles, game)
    : null;

  // Mitspieler + Chat (nur sichtbar, wenn ein Server verbunden ist).
  const remotes = new RemotePlayers(renderer.scene, (id) => connection.roster.get(id));
  connection.onPlayers = (players) => remotes.applySnapshot(players);
  connection.onPlayerJoin = (id, name, av) => remotes.setInfo(id, name, av);
  connection.onPlayerLeave = (id) => remotes.remove(id);

  // Eigene Figur (F5) + Avatar-Editor (M) + Konto & Freunde (K, nur mit Server).
  const self = new SelfView(renderer.scene, avatar);
  const interactive = !params.deterministic;
  const account =
    interactive && wsUrl
      ? new AccountPanel(wsUrl.replace(/^ws/, 'http').replace(/\/ws.*$/, ''))
      : null;
  const editor = interactive ? new AvatarEditor(avatar) : null;
  const panelsOpen = (): boolean =>
    !!(editor?.isOpen || account?.isOpen || chat?.isOpen || hotbar.isPickerOpen);
  if (editor) {
    editor.canOpen = () => !panelsOpen();
    editor.onChange = (code) => {
      self.setAvatar(code);
      connection.setAvatar(code);
      try {
        localStorage.setItem('robmine-avatar', code);
      } catch {
        // egal
      }
    };
    editor.onToggle = (open) => {
      self.front = open;
      fly.enabled = !open;
    };
  }
  if (account) {
    account.canOpen = () => !panelsOpen();
    account.onToggle = (open) => {
      fly.enabled = !open;
    };
    account.onVisit = (w) => gotoWorld(w);
  }
  const chat = params.server && interactive ? new Chat(safeChat ? SAFE_PHRASES : null) : null;
  if (chat) {
    chat.onSend = (text) => connection.sendChat(text);
    chat.onToggle = (open) => {
      fly.enabled = !open;
    };
    connection.onChat = (m) => chat.add(m.name, m.text, m.from === 0);
    chat.add(
      '',
      `${WORLD_TITLES[world]} – verbunden als ${welcome.name}. T zum Chatten${safeChat ? ' (Satzbausteine)' : ''}.`,
      true,
    );
  }
  window.addEventListener('keydown', (e) => {
    if (!interactive || e.repeat || panelsOpen()) return;
    if (e.code === 'F5') {
      e.preventDefault();
      self.cycle();
    } else if (e.code === 'KeyH' && !hub) gotoWorld('hafen');
  });
  let moveTimer = 0;

  // Kollision/Wasser für den Laufmodus aus den geladenen Spalten.
  fly.isSolid = (x, y, z) => registry.solid[chunks.getBlock(x, y, z) & 0xfff] === 1;
  fly.isFluid = (x, y, z) => registry.pass[chunks.getBlock(x, y, z) & 0xfff] === RenderPass.Fluid;
  self.isSolid = fly.isSolid;
  if (hub) fly.canFly = false;

  // Startpose: Spawn oder Deterministik-Kamera. Ohne feste Kamera: sobald die Spawn-Spalte
  // geladen ist, auf den Boden setzen und in den Laufmodus wechseln.
  let spawned = !!params.cam;
  let spawnPoint: [number, number, number] | null = null;
  if (game) {
    game.onRespawn = () => {
      if (!spawnPoint) return;
      fly.setPose(spawnPoint[0], spawnPoint[1], spawnPoint[2], fly.yaw, -0.1);
      fly.setWalk(true);
    };
  }
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
    setBlock: (x: number, y: number, z: number, block: number) =>
      connection.sendBlockAction(block === AIR ? 0 : 1, x, y, z, block),
    getBlock: (x: number, y: number, z: number) => chunks.getBlock(x, y, z),
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
  let leaving = false;
  if (hub && hint)
    hint.textContent =
      'Willkommen im Laternenhafen! WASD laufen · M Avatar · K Konto & Freunde · T Chat · F5 Ansicht · Durchs Portal im Norden geht es in die Dämmerlande';
  fly.onModeChange = (mode) => {
    if (!hint || hintHidden) return;
    if (mode === 'drag')
      hint.textContent =
        'Maus gedrückt halten zum Umsehen · WASD laufen · Linksklick halten = abbauen · Rechtsklick setzen/essen · E Inventar & Herstellen · C Kreativ';
    else if (mode === 'touch')
      hint.textContent = 'Links wischen = laufen · rechts wischen = umsehen';
  };
  fly.onWalkChange = (walk) => {
    if (!hint || hintHidden) return;
    if (hub) return;
    hint.textContent = walk
      ? 'WASD laufen · Leertaste springen · Linksklick halten = abbauen · Rechtsklick setzen/essen · E Inventar · C Kreativ · M Avatar · H Hafen'
      : 'WASD fliegen · Leertaste/Shift hoch/runter · Strg schnell · F laufen · F3 Statistik';
  };

  function frame(now: number, force = false): void {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!params.deterministic) {
      elapsed += dt;
      if (!hub) timeOfDay = (timeOfDay + dt) % 1440; // im Hafen ist immer Tag
      if (api.frames % 4 === 0) renderer.setTimeOfDay(timeOfDay);
    }
    if (!spawned) {
      const sx = Math.floor(fly.position.x);
      const sz = Math.floor(fly.position.z);
      const h = chunks.surfaceHeight(sx, sz);
      if (h !== undefined && chunks.isLoadedAt(sx, sz)) {
        fly.setPose(fly.position.x, h + 1.01 + PLAYER.eyeHeight, fly.position.z, fly.yaw, -0.1);
        fly.setWalk(true);
        spawnPoint = [fly.position.x, fly.position.y, fly.position.z];
        spawned = true;
      }
    }
    fly.update(dt);
    chunks.update(fly.position.x, fly.position.z);
    interaction?.update(dt);
    if (spawned) game?.update(dt);
    remotes.update(dt, renderer.camera);
    if (params.server && spawned) {
      moveTimer += dt;
      if (moveTimer >= 1 / 15) {
        moveTimer = 0;
        const p = fly.walk
          ? fly.player
          : { x: fly.position.x, y: fly.position.y - PLAYER.eyeHeight, z: fly.position.z };
        connection.sendMove(p.x, p.y, p.z, fly.yaw, fly.pitch);
      }
    }
    // Portal im Hafen: hineinlaufen → Dämmerlande
    if (hub && spawned && !leaving) {
      const p = fly.position;
      const fx = Math.floor(p.x);
      const fz = Math.floor(p.z);
      const fy = Math.floor(p.y - PLAYER.eyeHeight + 0.2);
      if (
        (chunks.getBlock(fx, fy, fz) & 0xfff) === BLOCK.Portallicht ||
        (chunks.getBlock(fx, fy + 1, fz) & 0xfff) === BLOCK.Portallicht
      ) {
        leaving = true;
        if (hint) {
          hint.textContent = 'Auf in die Dämmerlande …';
          hint.classList.remove('hidden');
        }
        gotoWorld('welt');
      }
    }
    particles.update(dt);
    chunks.applyPending();
    self.begin(fly, renderer.camera, dt);
    renderer.render(elapsed);
    self.end(renderer.camera);
    api.frames++;
    overlay.tick(performance.now() - now);
    if (!api.ready && chunks.settled) api.ready = true;
    if (!hintHidden && fly.hasInteracted && hint) {
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
