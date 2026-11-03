import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { AIR, RenderPass, WorldGenerator } from '@robmine/core';
import { BLOCK, createBlockRegistry, WORLD_BLOCKS } from '@robmine/content';
import type { FrameHandler, Transport } from '@robmine/protocol';
import { Instance } from '@robmine/sim';
import { type WebSocket, WebSocketServer } from 'ws';
import { FileColumnStorage } from './FileColumnStorage.ts';

export interface ServerOptions {
  port: number;
  host?: string;
  seed: number;
  dataDir: string;
  maxPlayers?: number;
  /** Erlaubte Origins für den WebSocket (leer = alle). */
  allowedOrigins?: string[];
  /** Ordner mit dem gebauten Client (apps/client/dist) – dann liefert der Server das Spiel aus. */
  staticDir?: string;
  log?: (msg: string) => void;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

export interface RunningServer {
  instance: Instance;
  port: number;
  close(): Promise<void>;
}

/** Transport über eine `ws`-Verbindung (Server-Seite). */
class WsServerTransport implements Transport {
  private frameHandler: FrameHandler | null = null;
  private closeHandler: (() => void) | null = null;
  private closed = false;
  private readonly socket: WebSocket;

  constructor(socket: WebSocket) {
    this.socket = socket;
    socket.on('message', (data, isBinary) => {
      if (!isBinary) return;
      const buf = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as ArrayBuffer);
      this.frameHandler?.(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
    });
    socket.on('close', () => this.handleClose());
    socket.on('error', () => this.handleClose());
  }

  send(data: Uint8Array): void {
    if (this.closed || this.socket.readyState !== this.socket.OPEN) return;
    // Gegendruck: zu langsame Verbindungen trennen statt Speicher zu füllen.
    if (this.socket.bufferedAmount > 8 * 1024 * 1024) {
      this.socket.close(1013, 'Verbindung zu langsam');
      return;
    }
    this.socket.send(data, { binary: true });
  }
  onFrame(h: FrameHandler): void {
    this.frameHandler = h;
  }
  onClose(h: () => void): void {
    this.closeHandler = h;
  }
  close(): void {
    if (this.closed) return;
    this.socket.close();
    this.handleClose();
  }
  private handleClose(): void {
    if (this.closed) return;
    this.closed = true;
    this.closeHandler?.();
  }
}

/** Startet HTTP (Gesundheitscheck) + WebSocket (/ws) + Instanz mit 20-Hz-Takt. */
export async function startServer(opts: ServerOptions): Promise<RunningServer> {
  const log = opts.log ?? ((m: string) => console.log(`[${new Date().toISOString()}] ${m}`));
  const registry = createBlockRegistry();
  const placeable = new Set<number>();
  for (const def of registry.defs) {
    if (!def || def.id === AIR || def.id === BLOCK.Urgestein) continue;
    if (registry.pass[def.id] === RenderPass.Fluid) continue;
    placeable.add(def.id);
  }
  const instance = new Instance({
    seed: opts.seed,
    spawn: [8.5, 112, 8.5],
    mode: 1,
    timeOfDay: 600,
    generator: new WorldGenerator(opts.seed, WORLD_BLOCKS),
    storage: new FileColumnStorage(opts.dataDir),
    placeable,
    unbreakable: new Set([BLOCK.Urgestein]),
    maxPlayers: opts.maxPlayers ?? 16,
  });
  instance.replaceable.add(BLOCK.Wasser);
  instance.onLog = log;

  const staticRoot = opts.staticDir ? resolve(opts.staticDir) : null;
  const http: Server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0]!;
    if (path === '/healthz') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, players: instance.playerCount, tick: instance.tick }));
      return;
    }
    // Der Client fragt das beim Start ab: gibt es hier einen Spielserver?
    if (path === '/server.json') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-cache' });
      res.end(JSON.stringify({ ws: 'auto' }));
      return;
    }
    if (staticRoot) {
      const rel = path === '/' ? '/index.html' : decodeURIComponent(path);
      const file = normalize(join(staticRoot, rel));
      if (file.startsWith(staticRoot) && existsSync(file) && statSync(file).isFile()) {
        const type = MIME[extname(file)] ?? 'application/octet-stream';
        const cache = rel.startsWith('/assets/')
          ? 'public, max-age=31536000, immutable'
          : 'no-cache';
        res.writeHead(200, { 'content-type': type, 'cache-control': cache });
        createReadStream(file).pipe(res);
        return;
      }
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Nicht gefunden');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('RobMine-Server läuft. Spiel-Verbindung über /ws.');
  });

  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 256 * 1024,
    perMessageDeflate: false,
  });
  http.on('upgrade', (req, socket, head) => {
    const url = req.url ?? '';
    const origin = req.headers.origin ?? '';
    if (!url.startsWith('/ws')) {
      socket.destroy();
      return;
    }
    if (opts.allowedOrigins?.length && !opts.allowedOrigins.includes(origin)) {
      log(`Abgelehnt (Origin ${origin})`);
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      instance.connect(new WsServerTransport(ws));
    });
  });

  // Takt: 20 Hz Spielerpositionen, Tageszeit läuft mit.
  let last = performance.now();
  const timer = setInterval(() => {
    const now = performance.now();
    instance.timeOfDay = (instance.timeOfDay + (now - last) / 1000) % 1440;
    last = now;
    instance.step();
  }, 50);

  await new Promise<void>((done) => http.listen(opts.port, opts.host ?? '0.0.0.0', done));
  const address = http.address();
  const port = typeof address === 'object' && address ? address.port : opts.port;
  log(`RobMine-Server auf Port ${port} (Seed ${opts.seed}, Daten ${opts.dataDir})`);

  return {
    instance,
    port,
    async close() {
      clearInterval(timer);
      await instance.shutdown('Server wird neu gestartet');
      wss.close();
      await new Promise<void>((done) => http.close(() => done()));
    },
  };
}
