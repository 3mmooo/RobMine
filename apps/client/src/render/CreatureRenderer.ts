import {
  BoxGeometry,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  type Scene,
} from 'three';
import type { Creature } from '@robmine/sim';

interface Figure {
  group: Group;
  body: MeshLambertMaterial;
  legL: Mesh;
  legR: Mesh;
  phase: number;
}

const BODY = new BoxGeometry(0.7, 0.8, 0.55);
const HEAD = new BoxGeometry(0.62, 0.55, 0.6);
const LEG = new BoxGeometry(0.22, 0.6, 0.22);
const EYE = new BoxGeometry(0.12, 0.08, 0.04);
const EYE_MAT = new MeshBasicMaterial({ color: new Color(0xd9b8ff) });
const BASE = new Color(0x2a1e4a);
const BURN = new Color(0xff7a2a);
const HURT = new Color(0xff2a3a);

/** Huscher als kleine Voxel-Figuren mit leuchtenden Augen (aus Rundformen später). */
export class CreatureRenderer {
  private readonly figures = new Map<number, Figure>();
  private readonly scene: Scene;

  constructor(scene: Scene) {
    this.scene = scene;
  }

  update(creatures: readonly Creature[], dt: number, time: number): void {
    const alive = new Set<number>();
    for (const c of creatures) {
      alive.add(c.id);
      let f = this.figures.get(c.id);
      if (!f) {
        f = this.create();
        this.figures.set(c.id, f);
      }
      const b = c.body;
      f.group.position.set(b.x, b.y, b.z);
      f.group.rotation.y = c.yaw;
      const speed = Math.hypot(b.vx, b.vz);
      f.phase += dt * speed * 3.2;
      const swing = Math.sin(f.phase) * Math.min(1, speed / 3) * 0.7;
      f.legL.rotation.x = swing;
      f.legR.rotation.x = -swing;
      if (c.hurtFlash > 0) f.body.emissive.copy(HURT).multiplyScalar(0.8);
      else if (c.burning)
        f.body.emissive.copy(BURN).multiplyScalar(0.5 + 0.3 * Math.sin(time * 20));
      else f.body.emissive.setRGB(0.05, 0.02, 0.1);
    }
    for (const [id, f] of this.figures) {
      if (alive.has(id)) continue;
      this.scene.remove(f.group);
      f.body.dispose();
      this.figures.delete(id);
    }
  }

  private create(): Figure {
    const group = new Group();
    const body = new MeshLambertMaterial({ color: BASE });
    const torso = new Mesh(BODY, body);
    torso.position.y = 1.0;
    const head = new Mesh(HEAD, body);
    head.position.y = 1.62;
    const eyeL = new Mesh(EYE, EYE_MAT);
    const eyeR = new Mesh(EYE, EYE_MAT);
    // Blickrichtung −Z
    eyeL.position.set(-0.14, 1.66, -0.31);
    eyeR.position.set(0.14, 1.66, -0.31);
    const legL = new Mesh(LEG, body);
    const legR = new Mesh(LEG, body);
    legL.geometry.translate(0, 0, 0);
    legL.position.set(-0.18, 0.6, 0);
    legR.position.set(0.18, 0.6, 0);
    // Beine um die Hüfte schwingen: Pivot oben
    for (const leg of [legL, legR]) {
      const pivot = new Group();
      pivot.position.copy(leg.position);
      leg.position.set(0, -0.3, 0);
      pivot.add(leg);
      group.add(pivot);
    }
    group.add(torso, head, eyeL, eyeR);
    for (const m of [torso, head, legL, legR]) m.castShadow = true;
    this.scene.add(group);
    return {
      group,
      body,
      legL: legL.parent as unknown as Mesh,
      legR: legR.parent as unknown as Mesh,
      phase: 0,
    };
  }
}
