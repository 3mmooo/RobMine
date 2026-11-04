import { WORLD_TITLES, type WorldId } from '@robmine/content';

const TOKEN_KEY = 'robmine-token';

export function storedToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? '';
  } catch {
    return '';
  }
}

function setToken(t: string): void {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // ohne Speicher: nur für diese Sitzung
  }
}

interface Me {
  name: string;
  friendCode: string;
  safeChat: boolean;
  friends: { name: string; online: string | null }[];
}

/**
 * Konto & Freunde (K): Anmelden, Registrieren (ohne E-Mail, mit Wiederherstellungscode),
 * Passwort zurücksetzen, Freundescode teilen/eingeben, Freunde online sehen und besuchen.
 * Nach An-/Abmelden lädt die Seite neu, damit die Verbindung das Konto nutzt.
 */
export class AccountPanel {
  private readonly panel: HTMLElement;
  private readonly api: string;
  private open = false;
  private view: 'login' | 'register' | 'recover' | 'me' = 'login';
  private me: Me | null = null;
  private message = '';
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  onToggle: ((open: boolean) => void) | null = null;
  onVisit: ((world: WorldId) => void) | null = null;
  canOpen: () => boolean = () => true;

  constructor(apiBase: string) {
    this.api = apiBase.replace(/\/$/, '');
    this.panel = document.createElement('div');
    this.panel.className = 'side-panel account hidden';
    (document.getElementById('overlay') ?? document.body).appendChild(this.panel);
    // Capture + stopImmediatePropagation: beim Tippen reagieren Spiel-Tasten (WASD, T, E …) nicht.
    // Muss vor Chat/Hotbar/Kamera registriert werden.
    window.addEventListener(
      'keydown',
      (e) => {
        if (this.open && (e.target as HTMLElement)?.tagName === 'INPUT') {
          if (e.code === 'Escape') this.toggle(false);
          e.stopImmediatePropagation();
          return;
        }
        if (e.code === 'KeyK' && !e.repeat && (this.open || this.canOpen())) this.toggle();
        else if (e.code === 'Escape' && this.open) this.toggle(false);
      },
      true,
    );
    if (storedToken()) this.view = 'me';
    this.render();
  }

  get isOpen(): boolean {
    return this.open;
  }

  toggle(force?: boolean): void {
    this.open = force ?? !this.open;
    this.panel.classList.toggle('hidden', !this.open);
    if (this.open && document.pointerLockElement) document.exitPointerLock();
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.refreshTimer = null;
    if (this.open && storedToken()) {
      void this.loadMe();
      this.refreshTimer = setInterval(() => void this.loadMe(), 10_000);
    }
    this.onToggle?.(this.open);
  }

  private async call(path: string, body?: unknown): Promise<Record<string, unknown>> {
    const res = await fetch(`${this.api}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        'content-type': 'application/json',
        ...(storedToken() ? { authorization: `Bearer ${storedToken()}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.status === 401 && path === '/api/me') {
      setToken('');
      this.view = 'login';
    }
    if (!res.ok) throw new Error(String(data.error ?? `Fehler ${res.status}`));
    return data;
  }

  private async loadMe(): Promise<void> {
    try {
      this.me = (await this.call('/api/me')) as unknown as Me;
      this.view = 'me';
    } catch (err) {
      this.message = (err as Error).message;
    }
    this.render();
  }

  private async submit(path: string, body: Record<string, unknown>): Promise<void> {
    this.message = '…';
    this.render();
    try {
      const r = await this.call(path, body);
      if (typeof r.token === 'string') setToken(r.token);
      if (typeof r.recoveryCode === 'string') {
        this.showRecovery(r.recoveryCode);
        return;
      }
      location.reload();
    } catch (err) {
      this.message = (err as Error).message;
      this.render();
    }
  }

  /** Wiederherstellungscode einmal anzeigen – erst danach neu verbinden. */
  private showRecovery(code: string): void {
    this.panel.innerHTML = '';
    this.title('Dein Wiederherstellungscode');
    this.note(
      'Schreib ihn auf (am besten mit deinen Eltern) und bewahre ihn gut auf. Nur damit kannst du ein vergessenes Passwort zurücksetzen. Er wird nie wieder angezeigt.',
    );
    const box = document.createElement('div');
    box.className = 'recovery-code';
    box.textContent = code;
    this.panel.appendChild(box);
    this.button('Aufgeschrieben – weiter', () => location.reload());
  }

  private title(text: string): void {
    const t = document.createElement('div');
    t.className = 'panel-title';
    t.textContent = text;
    this.panel.appendChild(t);
  }

  private note(text: string, cls = 'panel-note'): void {
    const n = document.createElement('div');
    n.className = cls;
    n.textContent = text;
    this.panel.appendChild(n);
  }

  private input(placeholder: string, type = 'text'): HTMLInputElement {
    const i = document.createElement('input');
    i.className = 'panel-input';
    i.placeholder = placeholder;
    i.type = type;
    i.autocomplete = 'off';
    this.panel.appendChild(i);
    return i;
  }

  private button(text: string, onClick: () => void, cls = 'panel-button'): HTMLButtonElement {
    const b = document.createElement('button');
    b.className = cls;
    b.textContent = text;
    b.onclick = onClick;
    this.panel.appendChild(b);
    return b;
  }

  private tabs(): void {
    const row = document.createElement('div');
    row.className = 'panel-tabs';
    for (const [v, label] of [
      ['login', 'Anmelden'],
      ['register', 'Neues Konto'],
      ['recover', 'Passwort vergessen'],
    ] as const) {
      const b = document.createElement('button');
      b.textContent = label;
      b.className = this.view === v ? 'active' : '';
      b.onclick = () => {
        this.view = v;
        this.message = '';
        this.render();
      };
      row.appendChild(b);
    }
    this.panel.appendChild(row);
  }

  private render(): void {
    this.panel.innerHTML = '';
    if (this.view === 'me' && storedToken()) {
      this.renderMe();
    } else if (this.view === 'register') {
      this.title('Konto & Freunde');
      this.tabs();
      this.note('Keine E-Mail nötig. Dein Name ist für alle sichtbar – nimm nicht deinen echten.');
      const name = this.input('Spielername (3–16 Zeichen)');
      const pw = this.input('Passwort (mind. 6 Zeichen)', 'password');
      const year = this.input('Geburtsjahr (z. B. 2014)', 'number');
      this.button('Konto anlegen', () =>
        this.submit('/api/register', {
          name: name.value.trim(),
          password: pw.value,
          birthYear: Number(year.value),
        }),
      );
      this.note('Unter 13 Jahren ist der Chat auf sichere Satzbausteine beschränkt.');
    } else if (this.view === 'recover') {
      this.title('Konto & Freunde');
      this.tabs();
      const name = this.input('Spielername');
      const code = this.input('Wiederherstellungscode (12 Wörter)');
      const pw = this.input('Neues Passwort', 'password');
      this.button('Passwort zurücksetzen', () =>
        this.submit('/api/recover', {
          name: name.value.trim(),
          recoveryCode: code.value,
          password: pw.value,
        }),
      );
    } else {
      this.title('Konto & Freunde');
      this.tabs();
      const name = this.input('Spielername');
      const pw = this.input('Passwort', 'password');
      this.button('Anmelden', () =>
        this.submit('/api/login', { name: name.value.trim(), password: pw.value }),
      );
      this.note('Als Gast kannst du spielen, aber keine Freunde hinzufügen.');
    }
    if (this.message) this.note(this.message, 'panel-message');
  }

  private renderMe(): void {
    const me = this.me;
    this.title(me ? me.name : 'Konto');
    if (!me) {
      this.note('Lade …');
      return;
    }
    const code = document.createElement('div');
    code.className = 'friend-code';
    code.innerHTML = 'Dein Freundescode: <b></b>';
    code.querySelector('b')!.textContent = me.friendCode;
    this.panel.appendChild(code);
    if (me.safeChat) this.note('Sicherer Chat ist aktiv (nur Satzbausteine).');
    const add = this.input('Freundescode eingeben');
    this.button('Freund hinzufügen', async () => {
      try {
        const r = await this.call('/api/friends', { code: add.value });
        this.message = `${String(r.added)} ist jetzt dein Freund ✨`;
        await this.loadMe();
      } catch (err) {
        this.message = (err as Error).message;
        this.render();
      }
    });
    const list = document.createElement('div');
    list.className = 'friend-list';
    if (me.friends.length === 0) {
      list.textContent = 'Noch keine Freunde – tauscht eure Freundescodes!';
    }
    for (const f of me.friends) {
      const row = document.createElement('div');
      row.className = f.online ? 'friend online' : 'friend';
      const n = document.createElement('span');
      n.textContent = f.name;
      const st = document.createElement('small');
      st.textContent = f.online
        ? `● ${WORLD_TITLES[f.online as WorldId] ?? f.online}`
        : '○ nicht online';
      row.append(n, st);
      if (f.online) {
        const go = document.createElement('button');
        go.textContent = 'Hingehen';
        go.onclick = () => this.onVisit?.(f.online as WorldId);
        row.appendChild(go);
      }
      list.appendChild(row);
    }
    this.panel.appendChild(list);
    this.button(
      'Abmelden',
      async () => {
        await this.call('/api/logout', {}).catch(() => undefined);
        setToken('');
        location.reload();
      },
      'panel-button quiet',
    );
    if (this.message) this.note(this.message, 'panel-message');
  }
}
