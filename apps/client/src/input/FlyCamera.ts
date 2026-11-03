import { type PerspectiveCamera, Vector3 } from 'three';
import { type BlockQuery, createPlayerState, PLAYER, stepPlayer } from '@robmine/core';

export type LookMode = 'none' | 'locked' | 'drag' | 'touch';

/**
 * Flugkamera (Phase 0): WASD, Leertaste/Shift hoch/runter, Strg schnell.
 *
 * Umsehen in drei Varianten:
 *  - Pointer Lock (Klick ins Bild) – Standard am Desktop.
 *  - Drag-Modus (Maus gedrückt halten), wenn Pointer Lock nicht verfügbar oder blockiert ist
 *    (eingebettete Seiten, manche Browser).
 *  - Touch: linke Bildhälfte = bewegen (Richtung der Blickrichtung), rechte Hälfte = umsehen.
 *
 * Yaw/Pitch in Radiant; Blickrichtung −Z bei yaw 0.
 */
export class FlyCamera {
  yaw = 0;
  pitch = 0;
  speed = 18;
  fastMultiplier = 4;
  enabled = true;
  readonly position = new Vector3();
  /** Wird aufgerufen, wenn sich die Art des Umsehens ändert (für HUD-Hinweise). */
  onModeChange: ((mode: LookMode) => void) | null = null;
  /** Laufmodus: Schwerkraft + Kollision (F schaltet um), sonst Flug. */
  walk = false;
  isSolid: BlockQuery | null = null;
  isFluid: BlockQuery | null = null;
  readonly player = createPlayerState(0, 0, 0);
  onWalkChange: ((walk: boolean) => void) | null = null;
  /** Darf mit F geflogen werden? (Survival: nein) */
  canFly = true;
  private mode: LookMode = 'none';
  private interacted = false;
  private readonly keys = new Set<string>();
  private readonly forward = new Vector3();
  private readonly right = new Vector3();
  private readonly move = new Vector3();
  private readonly camera: PerspectiveCamera;
  private readonly canvas: HTMLCanvasElement;
  private lockRequested = false;
  private lockTimer: ReturnType<typeof setTimeout> | null = null;
  private dragPointer: number | null = null;
  private lastDragX = 0;
  private lastDragY = 0;
  private movePointer: number | null = null;
  private moveOriginX = 0;
  private moveOriginY = 0;
  private readonly touchMove = { x: 0, y: 0 };

  constructor(camera: PerspectiveCamera, canvas: HTMLCanvasElement) {
    this.camera = camera;
    this.canvas = canvas;

    canvas.addEventListener('click', () => this.tryPointerLock());
    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === canvas;
      if (this.lockTimer) {
        clearTimeout(this.lockTimer);
        this.lockTimer = null;
      }
      this.lockRequested = false;
      if (locked) this.setMode('locked');
      else if (this.mode === 'locked') this.setMode('drag');
      if (!locked) this.keys.clear();
    });
    document.addEventListener('pointerlockerror', () => this.fallbackToDrag());

    document.addEventListener('mousemove', (e) => {
      if (this.mode !== 'locked' || !this.enabled) return;
      this.look(e.movementX, e.movementY);
    });

    // Pointer Events: Drag (Maus ohne Lock) und Touch.
    canvas.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      if (e.pointerType === 'touch') {
        if (e.clientX < window.innerWidth / 2 && this.movePointer === null) {
          this.movePointer = e.pointerId;
          this.moveOriginX = e.clientX;
          this.moveOriginY = e.clientY;
        } else if (this.dragPointer === null) {
          this.dragPointer = e.pointerId;
          this.lastDragX = e.clientX;
          this.lastDragY = e.clientY;
        }
        this.setMode('touch');
        canvas.setPointerCapture(e.pointerId);
        e.preventDefault();
        return;
      }
      if (this.mode === 'locked') return;
      this.dragPointer = e.pointerId;
      this.lastDragX = e.clientX;
      this.lastDragY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.enabled) return;
      if (e.pointerId === this.dragPointer && this.mode !== 'locked') {
        this.look(e.clientX - this.lastDragX, e.clientY - this.lastDragY);
        this.lastDragX = e.clientX;
        this.lastDragY = e.clientY;
      } else if (e.pointerId === this.movePointer) {
        const dx = (e.clientX - this.moveOriginX) / 60;
        const dy = (e.clientY - this.moveOriginY) / 60;
        this.touchMove.x = Math.max(-1, Math.min(1, dx));
        this.touchMove.y = Math.max(-1, Math.min(1, dy));
      }
    });
    const release = (e: PointerEvent): void => {
      if (e.pointerId === this.dragPointer) this.dragPointer = null;
      if (e.pointerId === this.movePointer) {
        this.movePointer = null;
        this.touchMove.x = 0;
        this.touchMove.y = 0;
      }
    };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);

    window.addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      if (e.code === 'Space') e.preventDefault();
      if (e.code === 'KeyF' && !e.repeat && (this.canFly || !this.walk)) this.setWalk(!this.walk);
      this.keys.add(e.code);
      this.markInteracted();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  get isLocked(): boolean {
    return this.mode === 'locked';
  }

  /** Rennt der Spieler gerade (Strg + Bewegung im Laufmodus)? */
  get sprinting(): boolean {
    const moving =
      this.keys.has('KeyW') ||
      this.keys.has('KeyA') ||
      this.keys.has('KeyS') ||
      this.keys.has('KeyD');
    return this.walk && moving && (this.keys.has('ControlLeft') || this.keys.has('ControlRight'));
  }

  get lookMode(): LookMode {
    return this.mode;
  }

  /** Hat der Spieler schon gesteuert (Hinweis ausblenden)? */
  get hasInteracted(): boolean {
    return this.interacted;
  }

  setPose(x: number, y: number, z: number, yaw: number, pitch: number): void {
    this.position.set(x, y, z);
    this.yaw = yaw;
    this.pitch = pitch;
    this.syncPlayerFromCamera();
    this.apply();
  }

  /** Laufen (true) oder Fliegen (false); beim Umschalten wird die Position übernommen. */
  setWalk(walk: boolean): void {
    if (walk && (!this.isSolid || !this.isFluid)) return;
    if (this.walk === walk) return;
    this.walk = walk;
    this.syncPlayerFromCamera();
    this.onWalkChange?.(walk);
  }

  private syncPlayerFromCamera(): void {
    const p = this.player;
    p.x = this.position.x;
    p.y = this.position.y - PLAYER.eyeHeight;
    p.z = this.position.z;
    p.vx = p.vy = p.vz = 0;
    p.onGround = false;
  }

  update(dt: number): void {
    if (this.enabled && this.walk && this.isSolid && this.isFluid) {
      let moveX = this.touchMove.x;
      let moveZ = -this.touchMove.y;
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) moveZ += 1;
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) moveZ -= 1;
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) moveX += 1;
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) moveX -= 1;
      if (moveX !== 0 || moveZ !== 0) this.markInteracted();
      stepPlayer(
        this.player,
        {
          moveX,
          moveZ,
          yaw: this.yaw,
          jump: this.keys.has('Space'),
          sprint: this.keys.has('ControlLeft') || this.keys.has('ControlRight'),
        },
        dt,
        this.isSolid,
        this.isFluid,
      );
      this.position.set(this.player.x, this.player.y + PLAYER.eyeHeight, this.player.z);
      this.apply();
      return;
    }
    if (this.enabled) {
      const cy = Math.cos(this.yaw);
      const sy = Math.sin(this.yaw);
      this.forward.set(-sy, 0, -cy);
      this.right.set(cy, 0, -sy);
      this.move.set(0, 0, 0);
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) this.move.add(this.forward);
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) this.move.sub(this.forward);
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) this.move.add(this.right);
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) this.move.sub(this.right);
      if (this.keys.has('Space')) this.move.y += 1;
      if (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')) this.move.y -= 1;
      // Touch: in Blickrichtung (inkl. Neigung) fliegen, seitlich strafen.
      if (this.touchMove.x !== 0 || this.touchMove.y !== 0) {
        this.camera.getWorldDirection(this.forward);
        this.move.addScaledVector(this.forward, -this.touchMove.y);
        this.move.addScaledVector(this.right, this.touchMove.x);
        this.markInteracted();
      }
      if (this.move.lengthSq() > 0) {
        if (this.move.lengthSq() > 1) this.move.normalize();
        const fast = this.keys.has('ControlLeft') || this.keys.has('ControlRight');
        this.position.addScaledVector(
          this.move,
          this.speed * (fast ? this.fastMultiplier : 1) * dt,
        );
      }
    }
    this.apply();
  }

  private tryPointerLock(): void {
    if (!this.enabled || this.mode === 'locked' || this.lockRequested) return;
    if (this.mode === 'touch') return;
    const request = this.canvas.requestPointerLock as (() => Promise<void> | void) | undefined;
    if (!request) {
      this.fallbackToDrag();
      return;
    }
    this.lockRequested = true;
    try {
      const result = request.call(this.canvas);
      if (result && typeof (result as Promise<void>).catch === 'function') {
        (result as Promise<void>).catch(() => this.fallbackToDrag());
      }
    } catch {
      this.fallbackToDrag();
      return;
    }
    // Kein pointerlockchange innerhalb 300 ms → blockiert (z. B. eingebettete Seite).
    this.lockTimer = setTimeout(() => {
      this.lockTimer = null;
      if (document.pointerLockElement !== this.canvas) this.fallbackToDrag();
    }, 300);
  }

  private fallbackToDrag(): void {
    this.lockRequested = false;
    if (this.mode === 'locked' || this.mode === 'touch') return;
    this.setMode('drag');
  }

  private look(dx: number, dy: number): void {
    this.yaw -= dx * 0.0022;
    this.pitch -= dy * 0.0022;
    const lim = Math.PI / 2 - 0.01;
    if (this.pitch > lim) this.pitch = lim;
    if (this.pitch < -lim) this.pitch = -lim;
    if (dx !== 0 || dy !== 0) this.markInteracted();
  }

  private setMode(mode: LookMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.onModeChange?.(mode);
  }

  private markInteracted(): void {
    this.interacted = true;
  }

  private apply(): void {
    this.camera.position.copy(this.position);
    this.camera.rotation.set(0, 0, 0);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;
  }
}
