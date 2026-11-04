import { BoxGeometry, Color, Group, Mesh, MeshLambertMaterial } from 'three';
import { AVATAR_PARTS, decodeAvatar } from '@robmine/content';

const HEAD = new BoxGeometry(0.56, 0.56, 0.56);
const BODY = new BoxGeometry(0.56, 0.72, 0.32);
const LIMB = new BoxGeometry(0.22, 0.68, 0.22);
const box = (w: number, h: number, d: number): BoxGeometry => new BoxGeometry(w, h, d);
// Frisuren und Hüte (relativ zur Kopfmitte)
const HAIR_TOP = box(0.6, 0.14, 0.6);
const HAIR_BACK = box(0.6, 0.5, 0.12);
const HAIR_LONG = box(0.6, 0.8, 0.12);
const HAIR_SPIKE = box(0.14, 0.2, 0.14);
const HAIR_TAIL = box(0.16, 0.4, 0.16);
const HAT_BEANIE = box(0.62, 0.24, 0.62);
const HAT_BRIM = box(0.62, 0.06, 0.3);
const HAT_LANTERN_RIM = box(0.86, 0.05, 0.86);
const HAT_LANTERN_TOP = box(0.44, 0.34, 0.44);
const EYE = box(0.08, 0.1, 0.02);

const materials = new Map<string, MeshLambertMaterial>();
function mat(hex: string, emissive = false): MeshLambertMaterial {
  const key = `${hex}${emissive ? '!' : ''}`;
  let m = materials.get(key);
  if (!m) {
    m = new MeshLambertMaterial({ color: new Color(hex) });
    if (emissive) m.emissive = new Color(hex).multiplyScalar(0.8);
    materials.set(key, m);
  }
  return m;
}

/** Eine Wanderer-Figur mit Gelenken (Füße bei y = 0, Blick nach -z). */
export interface Figure {
  group: Group;
  head: Group;
  legL: Group;
  legR: Group;
  armL: Group;
  armR: Group;
}

export function buildFigure(code: string): Figure {
  const a = decodeAvatar(code);
  const skin = mat(AVATAR_PARTS.skin[a.skin]!);
  const shirt = mat(AVATAR_PARTS.shirt[a.shirt]!);
  const pants = mat(AVATAR_PARTS.pants[a.pants]!);
  const hairMat = mat(AVATAR_PARTS.hairColor[a.hairColor]!);
  const group = new Group();
  const body = new Mesh(BODY, shirt);
  body.position.y = 1.08;
  body.castShadow = true;
  const head = new Group();
  head.position.y = 1.44;
  const headMesh = new Mesh(HEAD, skin);
  headMesh.position.y = 0.28;
  headMesh.castShadow = true;
  head.add(headMesh);
  const add = (geo: BoxGeometry, m: MeshLambertMaterial, x: number, y: number, z: number) => {
    const mesh = new Mesh(geo, m);
    mesh.position.set(x, y, z);
    head.add(mesh);
    return mesh;
  };
  // Augen (vorne = -z)
  const eye = mat('#1E1B2E');
  add(EYE, eye, -0.12, 0.3, -0.285);
  add(EYE, eye, 0.12, 0.3, -0.285);

  // Frisur: 0 keine, 1 kurz, 2 lang, 3 Strubbel, 4 Zopf
  if (a.hair > 0) {
    add(HAIR_TOP, hairMat, 0, 0.6, 0);
    if (a.hair === 1 || a.hair === 4) add(HAIR_BACK, hairMat, 0, 0.36, 0.26);
    if (a.hair === 2) add(HAIR_LONG, hairMat, 0, 0.22, 0.26);
    if (a.hair === 3)
      for (const [x, z] of [
        [-0.18, -0.1],
        [0.05, 0.12],
        [0.2, -0.15],
        [-0.05, 0.22],
      ] as const)
        add(HAIR_SPIKE, hairMat, x, 0.74, z);
    if (a.hair === 4) add(HAIR_TAIL, hairMat, 0, 0.18, 0.38);
  }
  // Hut: 0 keiner, 1 Mütze, 2 Schirmkappe, 3 Laternenhut (leuchtet)
  if (a.hat === 1) add(HAT_BEANIE, shirt, 0, 0.64, 0);
  if (a.hat === 2) {
    add(HAT_BEANIE, shirt, 0, 0.62, 0);
    add(HAT_BRIM, shirt, 0, 0.52, -0.42);
  }
  if (a.hat === 3) {
    add(HAT_LANTERN_RIM, mat('#3A2A1E'), 0, 0.6, 0);
    add(HAT_LANTERN_TOP, mat('#FFB347', true), 0, 0.8, 0);
  }

  const limb = (m: MeshLambertMaterial, x: number, y: number): Group => {
    const pivot = new Group();
    pivot.position.set(x, y, 0);
    const mesh = new Mesh(LIMB, m);
    mesh.position.y = -0.34;
    mesh.castShadow = true;
    pivot.add(mesh);
    group.add(pivot);
    return pivot;
  };
  const legL = limb(pants, -0.14, 0.72);
  const legR = limb(pants, 0.14, 0.72);
  const armL = limb(shirt, -0.39, 1.42);
  const armR = limb(shirt, 0.39, 1.42);
  group.add(body, head);
  return { group, head, legL, legR, armL, armR };
}

/** Laufanimation: `phase` läuft mit der Geschwindigkeit, `amount` 0…1. */
export function animateFigure(f: Figure, phase: number, amount: number): void {
  const swing = Math.sin(phase) * amount * 0.8;
  f.legL.rotation.x = swing;
  f.legR.rotation.x = -swing;
  f.armL.rotation.x = -swing * 0.8;
  f.armR.rotation.x = swing * 0.8;
}
