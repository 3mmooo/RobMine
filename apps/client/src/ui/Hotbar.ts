import type { BlockRegistry } from '@robmine/core';

/** Hotbar mit 9 Slots (Kreativ: unbegrenzt) + Block-Auswahl (E). */
export class Hotbar {
  readonly slots: number[];
  selected = 0;
  private readonly el: HTMLElement;
  private readonly picker: HTMLElement;
  private pickerOpen = false;
  onChange: (() => void) | null = null;
  private readonly registry: BlockRegistry;

  constructor(registry: BlockRegistry, defaults: number[], placeable: number[]) {
    this.registry = registry;
    this.slots = defaults.slice(0, 9);
    while (this.slots.length < 9) this.slots.push(defaults[0] ?? 1);
    const overlay = document.getElementById('overlay') ?? document.body;
    this.el = document.createElement('div');
    this.el.className = 'hotbar';
    overlay.appendChild(this.el);
    this.picker = document.createElement('div');
    this.picker.className = 'picker hidden';
    for (const id of placeable) {
      const def = registry.get(id);
      const btn = document.createElement('button');
      btn.className = 'picker-item';
      btn.title = def.label;
      btn.innerHTML = `<span class="swatch" style="background:${rgb(registry, id)}"></span><span>${def.label}</span>`;
      btn.addEventListener('click', () => {
        this.slots[this.selected] = id;
        this.togglePicker(false);
        this.render();
        this.onChange?.();
      });
      this.picker.appendChild(btn);
    }
    overlay.appendChild(this.picker);

    window.addEventListener('keydown', (e) => {
      if (e.code.startsWith('Digit')) {
        const n = Number(e.code.slice(5));
        if (n >= 1 && n <= 9) this.select(n - 1);
      } else if (e.code === 'KeyE') {
        this.togglePicker();
      } else if (e.code === 'Escape' && this.pickerOpen) {
        this.togglePicker(false);
      }
    });
    window.addEventListener('wheel', (e) => {
      if (this.pickerOpen) return;
      this.select((this.selected + (e.deltaY > 0 ? 1 : 8)) % 9);
    });
    this.render();
  }

  get block(): number {
    return this.slots[this.selected]!;
  }

  get isPickerOpen(): boolean {
    return this.pickerOpen;
  }

  select(i: number): void {
    this.selected = ((i % 9) + 9) % 9;
    this.render();
    this.onChange?.();
  }

  togglePicker(force?: boolean): void {
    this.pickerOpen = force ?? !this.pickerOpen;
    this.picker.classList.toggle('hidden', !this.pickerOpen);
    if (this.pickerOpen && document.pointerLockElement) document.exitPointerLock();
  }

  private render(): void {
    this.el.innerHTML = this.slots
      .map((id, i) => {
        const def = this.registry.get(id);
        return `<div class="slot${i === this.selected ? ' active' : ''}" title="${def.label}"><span class="swatch" style="background:${rgb(this.registry, id)}"></span><span class="num">${i + 1}</span></div>`;
      })
      .join('');
  }
}

function rgb(reg: BlockRegistry, id: number): string {
  const o = id * 3;
  return `rgb(${reg.colorTop[o]},${reg.colorTop[o + 1]},${reg.colorTop[o + 2]})`;
}
