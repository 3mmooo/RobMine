import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { AIR, RenderPass } from '@robmine/core';
import {
  BLOCK,
  createBlockRegistry,
  createGenerator,
  parseWorldId,
  type WorldId,
  worldSpawn,
} from '@robmine/content';
import type { FrameHandler, Transport } from '@robmine/protocol';
import { Instance } from '@robmine/sim';
import { type WebSocket, WebSocketServer } from 'ws';
import { AccountError, Accounts } from './Accounts.ts';
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
  /** Gäste nur mit sicherem Chat (Standard true). */
  guestSafeChat?: boolean;
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
  /** Die Dämmerlande (Bauen, Survival). */
  instance: Instance;
  /** Der Laternenhafen (Treffpunkt, nicht bebaubar). */
  hub: Instance;
  accounts: Accounts;
  port: number;
  close(): Promise<void>;
}

const readJson = (req: IncomingMessage): Promise<Record<string, unknown>> =>
  new Promise((done, fail) => {
    let body = '';
    req.on('data', (c: Buffer) => {
      body += c.toString('utf8');
      if (body.length > 4096) {
        fail(new AccountError('Anfrage zu groß'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        done(body ? (JSON.parse(body) as Record<string, unknown>) : {});
      } catch {
        fail(new AccountError('Ungültige Anfrage'));
      }
    });
    req.on('error', fail);
  });
const json = (res: ServerResponse, status: number, data: unknown): void => {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(data));
};

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
  const accounts = new Accounts(opts.dataDir);
  const makeInstance = (world: WorldId): Instance => {
    const hub = world === 'hafen';
    const inst = new Instance({
      seed: opts.seed,
      spawn: worldSpawn(world),
      mode: hub ? 3 : 1,
      timeOfDay: 600,
      world,
      buildable: !hub,
      generator: createGenerator(world, opts.seed),
      ...(hub ? {} : { storage: new FileColumnStorage(opts.dataDir) }),
      placeable,
      unbreakable: new Set([BLOCK.Urgestein, BLOCK.Portallicht]),
      maxPlayers: opts.maxPlayers ?? 16,
      guestSafeChat: opts.guestSafeChat ?? true,
      authenticate: (token) => {
        const a = accounts.byTokenValue(token);
        if (!a) return null;
        return { accountId: a.id, name: a.name, safeChat: accounts.publicOf(a).safeChat };
      },
      isReservedName: (name) => accounts.isReserved(name),
      onPresence: (id, online) => accounts.setPresence(id, world, online),
    });
    inst.replaceable.add(BLOCK.Wasser);
    inst.onLog = (m) => log(`[${world}] ${m}`);
    return inst;
  };
  const instance = makeInstance('welt');
  const hub = makeInstance('hafen');
  const instances: Instance[] = [instance, hub];

  // Konto-API (JSON). Einfache Drossel je IP gegen Passwort-Raten.
  const attempts = new Map<string, { n: number; t: number }>();
  const throttled = (ip: string): boolean => {
    const now = Date.now();
    const e = attempts.get(ip);
    if (!e || now - e.t > 60_000) {
      attempts.set(ip, { n: 1, t: now });
      return false;
    }
    return ++e.n > 20;
  };
  const handleApi = async (req: IncomingMessage, res: ServerResponse, path: string) => {
    const ip = req.socket.remoteAddress ?? '?';
    const auth = (req.headers.authorization ?? '').replace(/^Bearer /, '');
    try {
      if (req.method === 'POST' && path === '/api/register') {
        if (throttled(ip)) return json(res, 429, { error: 'Zu viele Versuche – kurz warten' });
        const b = await readJson(req);
        const r = accounts.register(String(b.name), String(b.password), Number(b.birthYear));
        log(`Konto angelegt: ${r.account.name}`);
        return json(res, 200, r);
      }
      if (req.method === 'POST' && path === '/api/login') {
        if (throttled(ip)) return json(res, 429, { error: 'Zu viele Versuche – kurz warten' });
        const b = await readJson(req);
        return json(res, 200, accounts.login(String(b.name), String(b.password)));
      }
      if (req.method === 'POST' && path === '/api/recover') {
        if (throttled(ip)) return json(res, 429, { error: 'Zu viele Versuche – kurz warten' });
        const b = await readJson(req);
        return json(
          res,
          200,
          accounts.recover(String(b.name), String(b.recoveryCode), String(b.password)),
        );
      }
      const a = accounts.byTokenValue(auth);
      if (!a) return json(res, 401, { error: 'Nicht angemeldet' });
      if (req.method === 'GET' && path === '/api/me')
        return json(res, 200, { ...accounts.publicOf(a), friends: accounts.friendsOf(a) });
      if (req.method === 'POST' && path === '/api/friends') {
        const b = await readJson(req);
        const name = accounts.addFriend(a, String(b.code));
        return json(res, 200, { added: name, friends: accounts.friendsOf(a) });
      }
      if (req.method === 'POST' && path === '/api/friends/remove') {
        const b = await readJson(req);
        accounts.removeFriend(a, String(b.name));
        return json(res, 200, { friends: accounts.friendsOf(a) });
      }
      if (req.method === 'POST' && path === '/api/logout') {
        accounts.logout(auth);
        return json(res, 200, { ok: true });
      }
      return json(res, 404, { error: 'Unbekannt' });
    } catch (err) {
      if (err instanceof AccountError) return json(res, 400, { error: err.message });
      log(`API-Fehler: ${(err as Error).message}`);
      return json(res, 500, { error: 'Serverfehler' });
    }
  };

  const staticRoot = opts.staticDir ? resolve(opts.staticDir) : null;
  const http: Server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0]!;
    if (path === '/healthz') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          ok: true,
          players: instance.playerCount + hub.playerCount,
          hub: hub.playerCount,
          tick: instance.tick,
        }),
      );
      return;
    }
    if (path.startsWith('/api/')) {
      void handleApi(req, res, path);
      return;
    }
    // Der Client fragt das beim Start ab: gibt es hier einen Spielserver?
    if (path === '/server.json') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-cache' });
      res.end(JSON.stringify({ ws: 'auto', accounts: true }));
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
    const url = (req.url ?? '').split('?')[0]!;
    const origin = req.headers.origin ?? '';
    // /ws und /ws/welt → Dämmerlande, /ws/hafen → Laternenhafen
    const m = /^\/ws(?:\/([a-z]+))?\/?$/.exec(url);
    const world = m ? (m[1] ? parseWorldId(m[1]) : 'welt') : null;
    if (!world) {
      socket.destroy();
      return;
    }
    const target = world === 'hafen' ? hub : instance;
    if (opts.allowedOrigins?.length && !opts.allowedOrigins.includes(origin)) {
      log(`Abgelehnt (Origin ${origin})`);
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      target.connect(new WsServerTransport(ws));
    });
  });

  // Takt: 20 Hz Spielerpositionen, Tageszeit läuft mit.
  let last = performance.now();
  const timer = setInterval(() => {
    const now = performance.now();
    instance.timeOfDay = (instance.timeOfDay + (now - last) / 1000) % 1440;
    last = now;
    for (const inst of instances) inst.step(); // im Hafen bleibt es Tag
  }, 50);

  await new Promise<void>((done) => http.listen(opts.port, opts.host ?? '0.0.0.0', done));
  const address = http.address();
  const port = typeof address === 'object' && address ? address.port : opts.port;
  log(`RobMine-Server auf Port ${port} (Seed ${opts.seed}, Daten ${opts.dataDir})`);

  return {
    instance,
    hub,
    accounts,
    port,
    async close() {
      clearInterval(timer);
      await Promise.all(instances.map((i) => i.shutdown('Server wird neu gestartet')));
      accounts.saveNow();
      wss.close();
      await new Promise<void>((done) => http.close(() => done()));
    },
  };
}
