import { type PerspectiveCamera, Vector3 } from 'three';

/**
 * Flugkamera (Phase 0): Pointer Lock + WASD, Leertaste/Shift hoch/runter, Strg schnell.
 * Yaw/Pitch in Radiant; Blickrichtung −Z bei yaw 0.
 */
export class FlyCamera {
  yaw = 0;
  pitch = 0;
  speed = 18;
  fastMultiplier = 4;
  readonly position = new Vector3();
  private readonly keys = new Set<string>();
  private locked = false;
  private readonly forward = new Vector3();
  private readonly right = new Vector3();
  private readonly move = new Vector3();
  enabled = true;
  private readonly camera: PerspectiveCamera;

  constructor(camera: PerspectiveCamera, canvas: HTMLCanvasElement) {
    this.camera = camera;
    canvas.addEventListener('click', () => {
      if (!this.enabled || this.locked) return;
      canvas.requestPointerLock?.();
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked) this.keys.clear();
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked || !this.enabled) return;
      this.yaw -= e.movementX * 0.0022;
      this.pitch -= e.movementY * 0.0022;
      const lim = Math.PI / 2 - 0.01;
      if (this.pitch > lim) this.pitch = lim;
      if (this.pitch < -lim) this.pitch = -lim;
    });
    window.addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      if (e.code === 'Space') e.preventDefault();
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  get isLocked(): boolean {
    return this.locked;
  }

  setPose(x: number, y: number, z: number, yaw: number, pitch: number): void {
    this.position.set(x, y, z);
    this.yaw = yaw;
    this.pitch = pitch;
    this.apply();
  }

  update(dt: number): void {
    if (this.enabled && this.locked) {
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
      if (this.move.lengthSq() > 0) {
        this.move.normalize();
        const fast = this.keys.has('ControlLeft') || this.keys.has('ControlRight');
        this.position.addScaledVector(
          this.move,
          this.speed * (fast ? this.fastMultiplier : 1) * dt,
        );
      }
    }
    this.apply();
  }

  private apply(): void {
    this.camera.position.copy(this.position);
    this.camera.rotation.set(0, 0, 0);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;
  }
}
