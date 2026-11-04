import { createHash, randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { filterChat, sanitizeName } from '@robmine/sim';

/**
 * Konten ohne E-Mail: Name + Passwort + Wiederherstellungscode (12 Wörter, einmal angezeigt).
 * Passwörter und Codes nur als scrypt-Hash, Sitzungs-Token nur als SHA-256. Unter 13 Jahren
 * gilt immer der sichere Chat. Freunde per Freundescode (beidseitig).
 * Speicherung: eine JSON-Datei, atomar geschrieben – genügt für einen kleinen Server.
 */
interface AccountRecord {
  id: string;
  name: string;
  salt: string;
  hash: string;
  recoverySalt: string;
  recoveryHash: string;
  birthYear: number;
  friendCode: string;
  friends: string[];
  tokens: string[];
  created: number;
}

export interface PublicAccount {
  name: string;
  friendCode: string;
  safeChat: boolean;
}

export class AccountError extends Error {}

const WORDS = (
  'anker apfel birke blatt boot brise dach dorf eiche feder fels fluss funke garten glut hafen ' +
  'himmel insel kerze kiesel klang krone lampe laterne licht mond moos nebel netz ozean perle ' +
  'pfad quelle regen ring sand segel sonne stern stein strand tau traum turm ufer wald welle ' +
  'wind wolke zweig beere blume dune falke fuchs igel kranich luchs otter rabe reh specht wal'
).split(' ');
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_TOKENS = 5;

const hashToken = (t: string): string => createHash('sha256').update(t).digest('hex');
const scrypt = (secret: string, salt: string): string =>
  scryptSync(secret.normalize('NFKC'), salt, 32).toString('hex');
const sameHex = (a: string, b: string): boolean =>
  a.length === b.length && timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));

export class Accounts {
  private readonly file: string;
  private readonly byId = new Map<string, AccountRecord>();
  private readonly byName = new Map<string, AccountRecord>();
  private readonly byCode = new Map<string, AccountRecord>();
  private readonly byToken = new Map<string, AccountRecord>();
  /** accountId → Welt-ID → Anzahl offener Sitzungen. */
  private readonly presence = new Map<string, Map<string, number>>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly now: () => Date;

  constructor(dataDir: string, now: () => Date = () => new Date()) {
    mkdirSync(dataDir, { recursive: true });
    this.file = join(dataDir, 'accounts.json');
    this.now = now;
    try {
      const list = JSON.parse(readFileSync(this.file, 'utf8')) as AccountRecord[];
      for (const a of list) this.index(a);
    } catch {
      // noch keine Konten
    }
  }

  private index(a: AccountRecord): void {
    this.byId.set(a.id, a);
    this.byName.set(a.name.toLowerCase(), a);
    this.byCode.set(a.friendCode, a);
    for (const t of a.tokens) this.byToken.set(t, a);
  }

  get count(): number {
    return this.byId.size;
  }

  isReserved(name: string): boolean {
    return this.byName.has(name.toLowerCase());
  }

  private safeChat(a: AccountRecord): boolean {
    return this.now().getFullYear() - a.birthYear < 13;
  }

  publicOf(a: AccountRecord): PublicAccount {
    return { name: a.name, friendCode: a.friendCode, safeChat: this.safeChat(a) };
  }

  private newRecoveryCode(): string {
    return Array.from({ length: 12 }, () => WORDS[randomInt(WORDS.length)]).join(' ');
  }

  private newFriendCode(): string {
    for (;;) {
      let c = '';
      for (let i = 0; i < 6; i++) c += CODE_CHARS[randomInt(CODE_CHARS.length)];
      if (!this.byCode.has(c)) return c;
    }
  }

  private issueToken(a: AccountRecord): string {
    const token = randomBytes(32).toString('base64url');
    const h = hashToken(token);
    a.tokens.push(h);
    while (a.tokens.length > MAX_TOKENS) this.byToken.delete(a.tokens.shift()!);
    this.byToken.set(h, a);
    this.scheduleSave();
    return token;
  }

  register(
    name: string,
    password: string,
    birthYear: number,
  ): { token: string; recoveryCode: string; account: PublicAccount } {
    const clean = sanitizeName(String(name ?? ''), 0);
    if (clean !== name || name.length < 3 || name.length > 16)
      throw new AccountError('Name: 3–16 Zeichen, nur Buchstaben, Ziffern und _');
    if (filterChat(name).text !== name) throw new AccountError('Dieser Name ist nicht erlaubt');
    if (this.isReserved(name)) throw new AccountError('Name ist schon vergeben');
    if (typeof password !== 'string' || password.length < 6 || password.length > 128)
      throw new AccountError('Passwort: mindestens 6 Zeichen');
    const year = this.now().getFullYear();
    if (!Number.isInteger(birthYear) || birthYear < year - 120 || birthYear > year)
      throw new AccountError('Bitte ein gültiges Geburtsjahr angeben');
    const salt = randomBytes(16).toString('hex');
    const recoverySalt = randomBytes(16).toString('hex');
    const recoveryCode = this.newRecoveryCode();
    const a: AccountRecord = {
      id: randomBytes(8).toString('hex'),
      name,
      salt,
      hash: scrypt(password, salt),
      recoverySalt,
      recoveryHash: scrypt(recoveryCode, recoverySalt),
      birthYear,
      friendCode: this.newFriendCode(),
      friends: [],
      tokens: [],
      created: Date.now(),
    };
    this.index(a);
    const token = this.issueToken(a);
    return { token, recoveryCode, account: this.publicOf(a) };
  }

  login(name: string, password: string): { token: string; account: PublicAccount } {
    const a = this.byName.get(String(name ?? '').toLowerCase());
    if (!a || typeof password !== 'string' || !sameHex(scrypt(password, a.salt), a.hash))
      throw new AccountError('Name oder Passwort falsch');
    return { token: this.issueToken(a), account: this.publicOf(a) };
  }

  /** Neues Passwort mit dem Wiederherstellungscode; alle alten Sitzungen enden, neuer Code. */
  recover(
    name: string,
    recoveryCode: string,
    newPassword: string,
  ): { token: string; recoveryCode: string; account: PublicAccount } {
    const a = this.byName.get(String(name ?? '').toLowerCase());
    const code = String(recoveryCode ?? '')
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .join(' ');
    if (!a || !sameHex(scrypt(code, a.recoverySalt), a.recoveryHash))
      throw new AccountError('Name oder Wiederherstellungscode falsch');
    if (typeof newPassword !== 'string' || newPassword.length < 6)
      throw new AccountError('Passwort: mindestens 6 Zeichen');
    for (const t of a.tokens) this.byToken.delete(t);
    a.tokens = [];
    a.salt = randomBytes(16).toString('hex');
    a.hash = scrypt(newPassword, a.salt);
    const fresh = this.newRecoveryCode();
    a.recoverySalt = randomBytes(16).toString('hex');
    a.recoveryHash = scrypt(fresh, a.recoverySalt);
    return { token: this.issueToken(a), recoveryCode: fresh, account: this.publicOf(a) };
  }

  /** Token → Konto (für Hello und die REST-API). */
  byTokenValue(token: string): AccountRecord | null {
    if (!token) return null;
    return this.byToken.get(hashToken(token)) ?? null;
  }

  logout(token: string): void {
    const a = this.byTokenValue(token);
    if (!a) return;
    const h = hashToken(token);
    a.tokens = a.tokens.filter((t) => t !== h);
    this.byToken.delete(h);
    this.scheduleSave();
  }

  addFriend(a: AccountRecord, code: string): string {
    const other = this.byCode.get(
      String(code ?? '')
        .trim()
        .toUpperCase(),
    );
    if (!other) throw new AccountError('Freundescode nicht gefunden');
    if (other === a) throw new AccountError('Das ist dein eigener Code 🙂');
    if (!a.friends.includes(other.id)) a.friends.push(other.id);
    if (!other.friends.includes(a.id)) other.friends.push(a.id);
    this.scheduleSave();
    return other.name;
  }

  removeFriend(a: AccountRecord, name: string): void {
    const other = this.byName.get(String(name ?? '').toLowerCase());
    if (!other) return;
    a.friends = a.friends.filter((id) => id !== other.id);
    other.friends = other.friends.filter((id) => id !== a.id);
    this.scheduleSave();
  }

  friendsOf(a: AccountRecord): { name: string; online: string | null }[] {
    return a.friends
      .map((id) => this.byId.get(id))
      .filter((f): f is AccountRecord => !!f)
      .map((f) => ({ name: f.name, online: this.whereIs(f.id) }))
      .sort((x, y) => Number(!!y.online) - Number(!!x.online) || x.name.localeCompare(y.name));
  }

  setPresence(accountId: string, world: string, online: boolean): void {
    let m = this.presence.get(accountId);
    if (!m) this.presence.set(accountId, (m = new Map()));
    const n = (m.get(world) ?? 0) + (online ? 1 : -1);
    if (n > 0) m.set(world, n);
    else m.delete(world);
    if (m.size === 0) this.presence.delete(accountId);
  }

  whereIs(accountId: string): string | null {
    const m = this.presence.get(accountId);
    return m ? (m.keys().next().value ?? null) : null;
  }

  private scheduleSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.saveNow();
    }, 200);
  }

  saveNow(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(Array.from(this.byId.values())));
    renameSync(tmp, this.file);
  }
}
