import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BLOCK } from '@robmine/content';
import {
  BlockActionKind,
  decodeFrame,
  encodeFrame,
  type Message,
  openWebSocket,
  PROTOCOL_VERSION,
  WebSocketTransport,
  WelcomeFlag,
} from '@robmine/protocol';
import { AccountError, Accounts } from '../src/Accounts.ts';
import { type RunningServer, startServer } from '../src/server.ts';

describe('Konten', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'robmine-acc-'));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('registrieren, anmelden, wiederherstellen, Freunde, Speichern', () => {
    const acc = new Accounts(dir, () => new Date('2026-06-01'));
    const kid = acc.register('Mika_12', 'passwort1', 2016);
    expect(kid.account.safeChat).toBe(true);
    expect(kid.recoveryCode.split(' ')).toHaveLength(12);
    const adult = acc.register('Robin', 'passwort2', 1990);
    expect(adult.account.safeChat).toBe(false);
    expect(() => acc.register('robin', 'xxxxxx1', 1990)).toThrow(AccountError);
    expect(() => acc.register('ab', 'xxxxxx1', 1990)).toThrow(AccountError);
    expect(() => acc.register('Neu', '123', 1990)).toThrow(AccountError);
    expect(() => acc.login('Robin', 'falsch')).toThrow(AccountError);
    const login = acc.login('ROBIN', 'passwort2');
    expect(acc.byTokenValue(login.token)?.name).toBe('Robin');
    expect(acc.isReserved('mika_12')).toBe(true);

    // Freunde (beidseitig) + online-Anzeige
    const robin = acc.byTokenValue(login.token)!;
    expect(acc.addFriend(robin, kid.account.friendCode.toLowerCase())).toBe('Mika_12');
    const mika = acc.byTokenValue(kid.token)!;
    acc.setPresence(mika.id, 'hafen', true);
    expect(acc.friendsOf(robin)).toEqual([{ name: 'Mika_12', online: 'hafen' }]);
    acc.setPresence(mika.id, 'hafen', false);
    expect(acc.friendsOf(mika)).toEqual([{ name: 'Robin', online: null }]);
    expect(() => acc.addFriend(robin, robin.friendCode)).toThrow(AccountError);

    // Wiederherstellen: alte Tokens ungültig, neuer Code
    expect(() => acc.recover('Mika_12', 'falsch', 'neuespw')).toThrow(AccountError);
    const rec = acc.recover('mika_12', `  ${kid.recoveryCode.toUpperCase()} `, 'neuespw');
    expect(acc.byTokenValue(kid.token)).toBeNull();
    expect(acc.byTokenValue(rec.token)?.name).toBe('Mika_12');
    expect(rec.recoveryCode).not.toBe(kid.recoveryCode);
    acc.saveNow();

    // Neu laden: alles noch da
    const again = new Accounts(dir, () => new Date('2026-06-01'));
    expect(again.count).toBe(2);
    expect(again.login('Mika_12', 'neuespw').account.safeChat).toBe(true);
    expect(again.friendsOf(again.byTokenValue(rec.token)!)).toEqual([
      { name: 'Robin', online: null },
    ]);
    again.saveNow();
  });
});

class Client {
  readonly messages: Message[] = [];
  private waiters: (() => boolean)[] = [];
  readonly transport: WebSocketTransport;
  constructor(ws: WebSocket) {
    this.transport = new WebSocketTransport(ws);
    this.transport.onFrame((d) => {
      this.messages.push(...decodeFrame(d).messages);
      this.waiters = this.waiters.filter((w) => !w());
    });
  }
  send(...m: Message[]): void {
    this.transport.send(encodeFrame(0, m));
  }
  waitFor(pred: (m: Message) => boolean, ms = 4000): Promise<Message> {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('Timeout')), ms);
      const check = (): boolean => {
        const m = this.messages.find(pred);
        if (!m) return false;
        clearTimeout(t);
        resolve(m);
        return true;
      };
      if (!check()) this.waiters.push(check);
    });
  }
}

const hello = (name: string, tok: string): Message => ({
  op: 'Hello',
  protoVer: PROTOCOL_VERSION,
  token: tok,
  clientBuild: 't',
  name,
  avatar: 'zzzzzz',
});

describe('Laternenhafen-Server: Konto-API, sicherer Chat, kein Bauen', () => {
  let server: RunningServer;
  let dir: string;
  let base: string;
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'robmine-hub-'));
    server = await startServer({
      port: 0,
      host: '127.0.0.1',
      seed: 42,
      dataDir: dir,
      log: () => {},
    });
    base = `127.0.0.1:${server.port}`;
  });
  afterAll(async () => {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const post = async (path: string, body: unknown, token = '') => {
    const res = await fetch(`http://${base}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
    return { status: res.status, data: (await res.json()) as Record<string, unknown> };
  };

  it('Konto über HTTP, Hello mit Token, Satzbausteine, Hub ist unbebaubar', async () => {
    const r = await post('/api/register', { name: 'Ada', password: 'geheim1', birthYear: 1985 });
    expect(r.status).toBe(200);
    const token = String(r.data.token);
    expect((await post('/api/register', { name: 'Ada', password: 'x', birthYear: 1 })).status).toBe(
      400,
    );

    const a = new Client(await openWebSocket(`ws://${base}/ws/hafen`));
    const g = new Client(await openWebSocket(`ws://${base}/ws/hafen`));
    a.send(hello('Falsch', token));
    const wa = await a.waitFor((m) => m.op === 'Welcome');
    expect(wa).toMatchObject({ world: 'hafen', name: 'Ada', flags: WelcomeFlag.LoggedIn });
    // Gast mit reserviertem Namen bekommt einen anderen; Gäste: sicherer Chat
    g.send(hello('ada', ''));
    const wg = await g.waitFor((m) => m.op === 'Welcome');
    expect(wg.op === 'Welcome' && wg.name).toMatch(/^Gast\d+$/);
    expect(wg.op === 'Welcome' && wg.flags).toBe(WelcomeFlag.SafeChat);
    const joined = await a.waitFor((m) => m.op === 'PlayerJoin');
    expect(joined.op === 'PlayerJoin' && joined.avatar).toBe('000000'); // bereinigt

    // Freunde online
    const me = await fetch(`http://${base}/api/me`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(((await me.json()) as { name: string }).name).toBe('Ada');

    // Freier Text vom Gast wird verworfen, Satzbaustein kommt an
    g.send({ op: 'Chat', text: 'meine adresse ist …' });
    g.send({ op: 'Chat', text: 'Hallo! 👋' });
    const chat = await a.waitFor((m) => m.op === 'ChatMessage' && m.from !== 0);
    expect(chat.op === 'ChatMessage' && chat.text).toBe('Hallo! 👋');
    // Freier Text der Erwachsenen erreicht den Gast nicht, Satzbausteine schon
    a.send({ op: 'Chat', text: 'Willkommen im Hafen' });
    a.send({ op: 'Chat', text: 'Danke!' });
    await g.waitFor((m) => m.op === 'ChatMessage' && m.text === 'Danke!');
    expect(g.messages.some((m) => m.op === 'ChatMessage' && m.text === 'Willkommen im Hafen')).toBe(
      false,
    );

    // Avatar ändern → die anderen erfahren es
    g.send({ op: 'SetAvatar', avatar: '123450' });
    await a.waitFor((m) => m.op === 'PlayerJoin' && m.avatar === '123450');

    // Im Hafen wird nichts gebaut
    a.send({
      op: 'BlockAction',
      kind: BlockActionKind.Place,
      x: 3,
      y: 72,
      z: 3,
      block: BLOCK.Glas,
    });
    await new Promise((res) => setTimeout(res, 200));
    expect(a.messages.some((m) => m.op === 'BlockUpdate')).toBe(false);
    a.transport.close();
    g.transport.close();
  });
});
