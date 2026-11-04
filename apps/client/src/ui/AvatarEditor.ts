import {
  AVATAR_LABELS,
  AVATAR_ORDER,
  AVATAR_PARTS,
  type Avatar,
  decodeAvatar,
  encodeAvatar,
} from '@robmine/content';

/** Avatar-Editor (M): sechs Teile durchschalten, Vorschau zeigt die eigene Figur von vorn. */
export class AvatarEditor {
  private readonly panel: HTMLElement;
  private avatar: Avatar;
  private open = false;
  onChange: ((code: string) => void) | null = null;
  onToggle: ((open: boolean) => void) | null = null;
  /** Darf gerade geöffnet werden? (z. B. nicht während Chat/Inventar) */
  canOpen: () => boolean = () => true;

  constructor(code: string) {
    this.avatar = decodeAvatar(code);
    this.panel = document.createElement('div');
    this.panel.className = 'side-panel hidden';
    (document.getElementById('overlay') ?? document.body).appendChild(this.panel);
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyM' && !e.repeat && (this.open || this.canOpen())) this.toggle();
      else if (e.code === 'Escape' && this.open) this.toggle(false);
    });
    this.render();
  }

  get isOpen(): boolean {
    return this.open;
  }

  get code(): string {
    return encodeAvatar(this.avatar);
  }

  toggle(force?: boolean): void {
    this.open = force ?? !this.open;
    this.panel.classList.toggle('hidden', !this.open);
    if (this.open && document.pointerLockElement) document.exitPointerLock();
    this.onToggle?.(this.open);
  }

  private step(part: (typeof AVATAR_ORDER)[number], delta: number): void {
    const n = AVATAR_PARTS[part].length;
    this.avatar[part] = (this.avatar[part] + delta + n) % n;
    this.render();
    this.onChange?.(this.code);
  }

  private render(): void {
    this.panel.innerHTML = '';
    const title = document.createElement('div');
    title.className = 'panel-title';
    title.textContent = 'Dein Wanderer';
    this.panel.appendChild(title);
    for (const part of AVATAR_ORDER) {
      const row = document.createElement('div');
      row.className = 'panel-row';
      const label = document.createElement('span');
      label.className = 'panel-label';
      label.textContent = AVATAR_LABELS[part];
      const prev = document.createElement('button');
      prev.textContent = '‹';
      prev.onclick = () => this.step(part, -1);
      const next = document.createElement('button');
      next.textContent = '›';
      next.onclick = () => this.step(part, 1);
      const value = document.createElement('span');
      value.className = 'panel-value';
      const v = AVATAR_PARTS[part][this.avatar[part]]!;
      if (v.startsWith('#')) {
        const sw = document.createElement('i');
        sw.className = 'swatch';
        sw.style.background = v;
        value.appendChild(sw);
      } else value.textContent = v;
      row.append(label, prev, value, next);
      this.panel.appendChild(row);
    }
    const note = document.createElement('div');
    note.className = 'panel-note';
    note.textContent = 'M oder Esc schließt · F5 wechselt die Ansicht';
    this.panel.appendChild(note);
  }
}
