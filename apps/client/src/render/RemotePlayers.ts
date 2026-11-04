import { type PerspectiveCamera, type Scene, Vector3 } from 'three';
import type { PlayerSnapshot } from '@robmine/protocol';
import { avatarFromNumber } from '@robmine/content';
import { animateFigure, buildFigure, type Figure } from './AvatarFigure.ts';

interface Remote {
  id: number;
  name: string;
  avatar: string;
  fig: Figure;
  label: HTMLElement;
  /** Ziel aus dem letzten Snapshot; dargestellt wird weich interpoliert. */
  target: { x: number; y: number; z: number; yaw: number; pitch: number } | null;
  phase: number;
  lastX: number;
  lastZ: number;
}

export interface RosterEntry {
  name: string;
  avatar: string;
}

const _v = new Vector3();

/** Andere Spieler als „Wanderer"-Figuren mit Namensschild (farbig nach ID). */
export class RemotePlayers {
  private readonly remotes = new Map<number, Remote>();
  private readonly info = new Map<number, RosterEntry>();
  private readonly scene: Scene;
  private readonly labels: HTMLElement;
  private readonly lookup: (id: number) => RosterEntry | undefined;

  constructor(scene: Scene, lookup: (id: number) => RosterEntry | undefined = () => undefined) {
    this.scene = scene;
    this.lookup = lookup;
    this.labels = document.createElement('div');
    this.labels.className = 'name-labels';
    (document.getElementById('overlay') ?? document.body).appendChild(this.labels);
  }

  get count(): number {
    return this.remotes.size;
  }

  /** Name/Avatar (neu) setzen – ein geänderter Avatar baut die Figur neu. */
  setInfo(id: number, name: string, avatar: string): void {
    this.info.set(id, { name, avatar });
    const r = this.remotes.get(id);
    if (!r) return;
    r.label.textContent = name;
    if (r.avatar !== avatar) {
      const old = r.fig.group;
      r.fig = buildFigure(avatar);
      r.avatar = avatar;
      r.fig.group.position.copy(old.position);
      r.fig.group.rotation.y = old.rotation.y;
      this.scene.remove(old);
      this.scene.add(r.fig.group);
    }
  }

  remove(id: number): void {
    this.info.delete(id);
    const r = this.remotes.get(id);
    if (!r) return;
    this.scene.remove(r.fig.group);
    r.label.remove();
    this.remotes.delete(id);
  }

  /** Snapshot vom Server: Ziele setzen; Spieler, die fehlen, sind außer Sicht. */
  applySnapshot(players: PlayerSnapshot[]): void {
    const seen = new Set<number>();
    for (const p of players) {
      seen.add(p.id);
      let r = this.remotes.get(p.id);
      if (!r) {
        r = this.create(p.id);
        r.fig.group.position.set(p.x, p.y, p.z);
        r.lastX = p.x;
        r.lastZ = p.z;
      }
      r.target = { x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch };
    }
    for (const [id, r] of this.remotes) {
      if (seen.has(id)) continue;
      this.scene.remove(r.fig.group);
      r.label.remove();
      this.remotes.delete(id);
    }
  }

  update(dt: number, camera: PerspectiveCamera): void {
    const k = 1 - Math.exp(-dt * 12);
    const w = window.innerWidth;
    const h = window.innerHeight;
    for (const r of this.remotes.values()) {
      const t = r.target;
      const grp = r.fig.group;
      if (t) {
        const g = grp.position;
        g.x += (t.x - g.x) * k;
        g.y += (t.y - g.y) * k;
        g.z += (t.z - g.z) * k;
        let dy = t.yaw - grp.rotation.y;
        dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        grp.rotation.y += dy * k;
        r.fig.head.rotation.x = t.pitch;
      }
      const speed =
        Math.hypot(grp.position.x - r.lastX, grp.position.z - r.lastZ) / Math.max(dt, 1e-3);
      r.lastX = grp.position.x;
      r.lastZ = grp.position.z;
      r.phase += dt * Math.min(speed, 8) * 2.4;
      animateFigure(r.fig, r.phase, Math.min(1, speed / 3));

      // Namensschild über dem Kopf
      _v.set(grp.position.x, grp.position.y + 2.25, grp.position.z).project(camera);
      const visible = _v.z < 1 && _v.z > -1 && camera.position.distanceTo(grp.position) < 64;
      r.label.style.display = visible ? 'block' : 'none';
      if (visible) {
        r.label.style.transform = `translate(${((_v.x + 1) / 2) * w}px, ${((1 - _v.y) / 2) * h}px) translate(-50%, -100%)`;
      }
    }
  }

  private create(id: number): Remote {
    const info = this.info.get(id) ?? this.lookup(id);
    const avatar = info?.avatar || avatarFromNumber(id);
    const fig = buildFigure(avatar);
    this.scene.add(fig.group);
    const label = document.createElement('div');
    label.className = 'name-label';
    label.textContent = info?.name ?? `Wanderer ${id}`;
    this.labels.appendChild(label);
    const r: Remote = {
      id,
      name: label.textContent,
      avatar,
      fig,
      label,
      target: null,
      phase: 0,
      lastX: 0,
      lastZ: 0,
    };
    this.remotes.set(id, r);
    return r;
  }
}
