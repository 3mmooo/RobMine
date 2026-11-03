/** Chat: T oder Enter öffnet die Eingabe, Nachrichten blenden nach 10 s aus. */
export class Chat {
  private readonly log: HTMLElement;
  private readonly input: HTMLInputElement;
  private open = false;
  onSend: ((text: string) => void) | null = null;
  /** Wird beim Öffnen/Schließen aufgerufen (Steuerung sperren). */
  onToggle: ((open: boolean) => void) | null = null;

  constructor() {
    const overlay = document.getElementById('overlay') ?? document.body;
    this.log = document.createElement('div');
    this.log.className = 'chat-log';
    this.input = document.createElement('input');
    this.input.className = 'chat-input hidden';
    this.input.maxLength = 200;
    this.input.placeholder = 'Nachricht … (Enter senden, Esc abbrechen)';
    overlay.append(this.log, this.input);

    window.addEventListener(
      'keydown',
      (e) => {
        if (this.open) {
          if (e.code === 'Enter') {
            const text = this.input.value.trim();
            if (text) this.onSend?.(text);
            this.close();
          } else if (e.code === 'Escape') this.close();
          e.stopPropagation();
          return;
        }
        if ((e.code === 'KeyT' || e.code === 'Enter') && !e.repeat) {
          e.preventDefault();
          this.show();
        }
      },
      true,
    );
  }

  get isOpen(): boolean {
    return this.open;
  }

  add(name: string, text: string, system = false): void {
    const line = document.createElement('div');
    line.className = system ? 'chat-line system' : 'chat-line';
    const who = document.createElement('b');
    who.textContent = system ? '' : `${name}: `;
    const body = document.createElement('span');
    body.textContent = system ? text : text;
    line.append(who, body);
    this.log.appendChild(line);
    while (this.log.children.length > 8) this.log.firstChild?.remove();
    setTimeout(() => line.classList.add('fade'), 10_000);
  }

  private show(): void {
    this.open = true;
    this.input.classList.remove('hidden');
    this.input.value = '';
    if (document.pointerLockElement) document.exitPointerLock();
    this.onToggle?.(true);
    setTimeout(() => this.input.focus(), 0);
  }

  private close(): void {
    this.open = false;
    this.input.blur();
    this.input.classList.add('hidden');
    this.onToggle?.(false);
  }
}
