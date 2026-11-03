import {
  BoxGeometry,
  Color,
  Group,
  Mesh,
  MeshLambertMaterial,
  type PerspectiveCamera,
  type Scene,
  Vector3,
} from 'three';
import type { PlayerSnapshot } from '@robmine/protocol';

interface Remote {
  id: number;
  name: string;
  group: Group;
  head: Group;
  legL: Group;
  legR: Group;
  armL: Group;
  armR: Group;
  label: HTMLElement;
  /** Ziel aus dem letzten Snapshot; dargestellt wird weich interpoliert. */
  target: { x: number; y: number; z: number; yaw: number; pitch: number } | null;
  phase: number;
  lastX: number;
  lastZ: number;
}

const SKINS = ['#F2C9A0', '#D9A066', '#A86B3C', '#6B4423', '#F6D7C3', '#8C5A3C'];
const SHIRTS = [
  '#3FA7D6',
  '#E4572E',
  '#76B041',
  '#FFC914',
  '#9B5DE5',
  '#F15BB5',
  '#00BBF9',
  '#FF924C',
];
const PANTS = ['#2E4057', '#3D3B30', '#4A3C5C', '#264653'];

const HEAD = new BoxGeometry(0.56, 0.56, 0.56);
const BODY = new BoxGeometry(0.56, 0.72, 0.32);
const LIMB = new BoxGeometry(0.22, 0.68, 0.22);
const _v = new Vector3();

/** Andere Spieler als „Wanderer"-Figuren mit Namensschild (farbig nach ID). */
export class RemotePlayers {
  private readonly remotes = new Map<number, Remote>();
  private readonly names = new Map<number, string>();
  private readonly scene: Scene;
  private readonly labels: HTMLElement;
  private readonly nameOf: (id: number) => string | undefined;

  constructor(scene: Scene, nameOf: (id: number) => string | undefined = () => undefined) {
    this.scene = scene;
    this.nameOf = nameOf;
    this.labels = document.createElement('div');
    this.labels.className = 'name-labels';
    (document.getElementById('overlay') ?? document.body).appendChild(this.labels);
  }

  get count(): number {
    return this.remotes.size;
  }

  setName(id: number, name: string): void {
    this.names.set(id, name);
    const r = this.remotes.get(id);
    if (r) r.label.textContent = name;
  }

  remove(id: number): void {
    this.names.delete(id);
    const r = this.remotes.get(id);
    if (!r) return;
    this.scene.remove(r.group);
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
        r.group.position.set(p.x, p.y, p.z);
        r.lastX = p.x;
        r.lastZ = p.z;
      }
      r.target = { x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch };
    }
    for (const [id, r] of this.remotes) {
      if (seen.has(id)) continue;
      this.scene.remove(r.group);
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
      if (t) {
        const g = r.group.position;
        g.x += (t.x - g.x) * k;
        g.y += (t.y - g.y) * k;
        g.z += (t.z - g.z) * k;
        let dy = t.yaw - r.group.rotation.y;
        dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        r.group.rotation.y += dy * k;
        r.head.rotation.x = t.pitch;
      }
      const speed =
        Math.hypot(r.group.position.x - r.lastX, r.group.position.z - r.lastZ) / Math.max(dt, 1e-3);
      r.lastX = r.group.position.x;
      r.lastZ = r.group.position.z;
      r.phase += dt * Math.min(speed, 8) * 2.4;
      const swing = Math.sin(r.phase) * Math.min(1, speed / 3) * 0.8;
      r.legL.rotation.x = swing;
      r.legR.rotation.x = -swing;
      r.armL.rotation.x = -swing * 0.8;
      r.armR.rotation.x = swing * 0.8;

      // Namensschild über dem Kopf
      _v.set(r.group.position.x, r.group.position.y + 2.15, r.group.position.z).project(camera);
      const visible = _v.z < 1 && _v.z > -1 && camera.position.distanceTo(r.group.position) < 64;
      r.label.style.display = visible ? 'block' : 'none';
      if (visible) {
        r.label.style.transform = `translate(${((_v.x + 1) / 2) * w}px, ${((1 - _v.y) / 2) * h}px) translate(-50%, -100%)`;
      }
    }
  }

  private create(id: number): Remote {
    const pick = <T>(arr: readonly T[], salt: number): T =>
      arr[((id * 2654435761 + salt) >>> 0) % arr.length]!;
    const skin = new MeshLambertMaterial({ color: new Color(pick(SKINS, 1)) });
    const shirt = new MeshLambertMaterial({ color: new Color(pick(SHIRTS, 7)) });
    const pants = new MeshLambertMaterial({ color: new Color(pick(PANTS, 13)) });
    const group = new Group();
    const body = new Mesh(BODY, shirt);
    body.position.y = 1.08;
    const head = new Group();
    head.position.y = 1.44;
    const headMesh = new Mesh(HEAD, skin);
    headMesh.position.y = 0.28;
    head.add(headMesh);
    const limb = (mat: MeshLambertMaterial, x: number, y: number): Group => {
      const pivot = new Group();
      pivot.position.set(x, y, 0);
      const m = new Mesh(LIMB, mat);
      m.position.y = -0.34;
      m.castShadow = true;
      pivot.add(m);
      group.add(pivot);
      return pivot;
    };
    const legL = limb(pants, -0.14, 0.72);
    const legR = limb(pants, 0.14, 0.72);
    const armL = limb(shirt, -0.39, 1.42);
    const armR = limb(shirt, 0.39, 1.42);
    body.castShadow = true;
    headMesh.castShadow = true;
    group.add(body, head);
    this.scene.add(group);
    const label = document.createElement('div');
    label.className = 'name-label';
    label.textContent = this.names.get(id) ?? this.nameOf(id) ?? `Wanderer ${id}`;
    this.labels.appendChild(label);
    const r: Remote = {
      id,
      name: label.textContent,
      group,
      head,
      legL,
      legR,
      armL,
      armR,
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
