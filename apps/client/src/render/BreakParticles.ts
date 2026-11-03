import { BoxGeometry, Color, InstancedMesh, Matrix4, MeshLambertMaterial, Object3D } from 'three';

const MAX = 512;
const _obj = new Object3D();
const _hidden = new Matrix4().makeScale(0, 0, 0);

/** Kleine Würfel-Partikel beim Abbauen (CPU-simuliert, ein InstancedMesh). */
export class BreakParticles {
  readonly mesh: InstancedMesh;
  private readonly pos = new Float32Array(MAX * 3);
  private readonly vel = new Float32Array(MAX * 3);
  private readonly life = new Float32Array(MAX);
  private next = 0;
  private readonly color = new Color();

  constructor() {
    const geometry = new BoxGeometry(0.12, 0.12, 0.12);
    const material = new MeshLambertMaterial({ color: 0xffffff });
    this.mesh = new InstancedMesh(geometry, material, MAX);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    for (let i = 0; i < MAX; i++) this.mesh.setMatrixAt(i, _hidden);
    this.mesh.count = MAX;
  }

  /** Partikelwolke an Blockposition (Blockmitte) in Blockfarbe. */
  burst(bx: number, by: number, bz: number, r: number, g: number, b: number, count = 24): void {
    for (let n = 0; n < count; n++) {
      const i = this.next;
      this.next = (this.next + 1) % MAX;
      const p = i * 3;
      this.pos[p] = bx + 0.15 + Math.random() * 0.7;
      this.pos[p + 1] = by + 0.15 + Math.random() * 0.7;
      this.pos[p + 2] = bz + 0.15 + Math.random() * 0.7;
      this.vel[p] = (Math.random() - 0.5) * 4;
      this.vel[p + 1] = 2 + Math.random() * 4;
      this.vel[p + 2] = (Math.random() - 0.5) * 4;
      this.life[i] = 0.5 + Math.random() * 0.4;
      const shade = 0.8 + Math.random() * 0.4;
      this.color.setRGB((r / 255) * shade, (g / 255) * shade, (b / 255) * shade);
      this.mesh.setColorAt(i, this.color);
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  update(dt: number): void {
    let any = false;
    for (let i = 0; i < MAX; i++) {
      if (this.life[i]! <= 0) continue;
      any = true;
      const p = i * 3;
      this.life[i] = this.life[i]! - dt;
      this.vel[p + 1] = this.vel[p + 1]! - 18 * dt;
      this.pos[p] = this.pos[p]! + this.vel[p]! * dt;
      this.pos[p + 1] = this.pos[p + 1]! + this.vel[p + 1]! * dt;
      this.pos[p + 2] = this.pos[p + 2]! + this.vel[p + 2]! * dt;
      if (this.life[i]! <= 0) {
        this.mesh.setMatrixAt(i, _hidden);
        continue;
      }
      const s = Math.min(1, this.life[i]! * 3);
      _obj.position.set(this.pos[p]!, this.pos[p + 1]!, this.pos[p + 2]!);
      _obj.scale.setScalar(s);
      _obj.rotation.set(this.life[i]! * 5, this.life[i]! * 3, 0);
      _obj.updateMatrix();
      this.mesh.setMatrixAt(i, _obj.matrix);
    }
    if (any) this.mesh.instanceMatrix.needsUpdate = true;
  }
}
