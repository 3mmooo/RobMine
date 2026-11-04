import { type PerspectiveCamera, Quaternion, type Scene, Vector3 } from 'three';
import { PLAYER } from '@robmine/core';
import type { FlyCamera } from '../input/FlyCamera.ts';
import { animateFigure, buildFigure, type Figure } from './AvatarFigure.ts';

const _eye = new Vector3();
const _dir = new Vector3();
const _pos = new Vector3();

/**
 * Eigene Figur + Kamera in der dritten Person (F5: Ich-Sicht → hinter mir → von vorn).
 * Die Kamera wird nur für das Rendern versetzt und danach zurückgesetzt – Physik,
 * Chunk-Laden und Anvisieren arbeiten weiter mit der Augenposition.
 */
export class SelfView {
  /** 0 Ich-Sicht, 1 hinter mir, 2 von vorn. */
  mode = 0;
  /** Erzwingt die Frontansicht (Avatar-Editor). */
  front = false;
  isSolid: ((x: number, y: number, z: number) => boolean) | null = null;
  private fig: Figure;
  private readonly scene: Scene;
  private readonly savedPos = new Vector3();
  private readonly savedQuat = new Quaternion();
  private moved = false;
  private phase = 0;
  private lastX = 0;
  private lastZ = 0;

  constructor(scene: Scene, avatar: string) {
    this.scene = scene;
    this.fig = buildFigure(avatar);
    this.fig.group.visible = false;
    scene.add(this.fig.group);
  }

  setAvatar(avatar: string): void {
    const visible = this.fig.group.visible;
    this.scene.remove(this.fig.group);
    this.fig = buildFigure(avatar);
    this.fig.group.visible = visible;
    this.scene.add(this.fig.group);
  }

  cycle(): void {
    this.mode = (this.mode + 1) % 3;
  }

  /** Vor dem Rendern: Figur an die Spielerposition, Kamera ggf. versetzen. */
  begin(fly: FlyCamera, camera: PerspectiveCamera, dt: number): void {
    const mode = this.front ? 2 : this.mode;
    const g = this.fig.group;
    g.visible = mode !== 0;
    if (mode === 0) return;
    const feetY = fly.position.y - PLAYER.eyeHeight;
    g.position.set(fly.position.x, feetY, fly.position.z);
    g.rotation.y = fly.yaw;
    this.fig.head.rotation.x = fly.pitch * 0.6;
    const speed =
      Math.hypot(g.position.x - this.lastX, g.position.z - this.lastZ) / Math.max(dt, 1e-3);
    this.lastX = g.position.x;
    this.lastZ = g.position.z;
    this.phase += dt * Math.min(speed, 8) * 2.4;
    animateFigure(this.fig, this.phase, Math.min(1, speed / 3));

    this.savedPos.copy(camera.position);
    this.savedQuat.copy(camera.quaternion);
    this.moved = true;
    _eye.copy(fly.position);
    if (mode === 1) camera.getWorldDirection(_dir).negate();
    else _dir.set(-Math.sin(fly.yaw), 0.25, -Math.cos(fly.yaw)).normalize();
    // Nicht durch Wände: bis kurz vor den ersten festen Block
    let dist = mode === 1 ? 4 : 3.2;
    for (let d = 0.3; d <= dist; d += 0.2) {
      _pos.copy(_eye).addScaledVector(_dir, d);
      if (this.isSolid?.(Math.floor(_pos.x), Math.floor(_pos.y), Math.floor(_pos.z))) {
        dist = Math.max(0.3, d - 0.3);
        break;
      }
    }
    camera.position.copy(_eye).addScaledVector(_dir, dist);
    if (mode === 2) camera.lookAt(_eye.x, _eye.y - 0.3, _eye.z);
  }

  /** Nach dem Rendern: Kamera zurück auf die Augen. */
  end(camera: PerspectiveCamera): void {
    if (!this.moved) return;
    camera.position.copy(this.savedPos);
    camera.quaternion.copy(this.savedQuat);
    this.moved = false;
  }
}
