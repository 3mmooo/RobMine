import { type BlockRegistry, blockType, RenderPass } from '../voxel/Block.ts';
import {
  CHUNK_SIZE,
  PADDED_AREA,
  PADDED_SIZE,
  PADDED_VOLUME,
  paddedIndex,
} from '../voxel/constants.ts';
import { lightB, lightG, lightR, lightSky } from '../light/Light.ts';
import {
  type ChunkMesh,
  FLAG_EMISSIVE,
  FLAG_FLUID_TOP,
  FLAG_WIND,
  MeshBuilder,
  NORMAL_NX,
  NORMAL_NY,
  NORMAL_NZ,
  NORMAL_PX,
  NORMAL_PY,
  NORMAL_PZ,
} from './VertexFormat.ts';

/**
 * Greedy Meshing mit Vertex-AO und geglättetem Licht (4 Kanäle).
 *
 * Eingabe: gepolsterter Chunk (34³) mit Blöcken und Licht, damit Flächen am
 * Chunkrand korrekt verdeckt und beleuchtet werden.
 *
 * Je Richtung werden Flächen nur verschmolzen, wenn Blocktyp, AO-Signatur und
 * alle vier Vertex-Lichtwerte identisch sind – sonst bricht das weiche Licht.
 */
export interface PaddedChunk {
  blocks: Uint16Array; // PADDED_VOLUME
  light: Uint16Array; // PADDED_VOLUME
  /** Oberflächenhöhe der Spalte je (x,z) – für die Wassertiefe. */
  height: Uint8Array; // CHUNK_SIZE²
  /** Welt-y der untersten Lage des Chunks. */
  baseY: number;
}

export function createPaddedChunk(): PaddedChunk {
  return {
    blocks: new Uint16Array(PADDED_VOLUME),
    light: new Uint16Array(PADDED_VOLUME),
    height: new Uint8Array(CHUNK_SIZE * CHUNK_SIZE),
    baseY: 0,
  };
}

/** Maximale im Vertex kodierte Wassertiefe. */
export const MAX_WATER_DEPTH = 31;

interface Direction {
  normal: number;
  /** Achse der Flächennormale: 0 x, 1 y, 2 z. */
  axis: number;
  sign: number;
  /** Achsen für Quad-Breite (du) und -Höhe (dv): 0 x, 1 y, 2 z. */
  uAxis: number;
  vAxis: number;
}

// du × dv = normal (CCW von außen gesehen).
const DIRECTIONS: readonly Direction[] = [
  { normal: NORMAL_PX, axis: 0, sign: 1, uAxis: 1, vAxis: 2 },
  { normal: NORMAL_NX, axis: 0, sign: -1, uAxis: 2, vAxis: 1 },
  { normal: NORMAL_PY, axis: 1, sign: 1, uAxis: 2, vAxis: 0 },
  { normal: NORMAL_NY, axis: 1, sign: -1, uAxis: 0, vAxis: 2 },
  { normal: NORMAL_PZ, axis: 2, sign: 1, uAxis: 0, vAxis: 1 },
  { normal: NORMAL_NZ, axis: 2, sign: -1, uAxis: 1, vAxis: 0 },
];

const STRIDE = [1, PADDED_AREA, PADDED_SIZE] as const; // Schritt je Achse im gepolsterten Array

// Masken je Slice (32×32), indexiert mit a + b*32 (a entlang u, b entlang v).
const maskType = new Uint16Array(CHUNK_SIZE * CHUNK_SIZE);
const maskAo = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
const maskFlags = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
/** Zusatzwert je Fläche (Wassertiefe bei Fluid-Oberseiten), Teil des Merge-Schlüssels. */
const maskExtra = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
const maskL0 = new Uint16Array(CHUNK_SIZE * CHUNK_SIZE);
const maskL1 = new Uint16Array(CHUNK_SIZE * CHUNK_SIZE);
const maskL2 = new Uint16Array(CHUNK_SIZE * CHUNK_SIZE);
const maskL3 = new Uint16Array(CHUNK_SIZE * CHUNK_SIZE);

const builders = {
  opaque: new MeshBuilder(8192),
  cutout: new MeshBuilder(2048),
  fluid: new MeshBuilder(2048),
};

const pos = [0, 0, 0];

export function meshChunk(input: PaddedChunk, reg: BlockRegistry): ChunkMesh {
  const { blocks, light } = input;
  const pass = reg.pass;
  const opaque = reg.opaque;
  builders.opaque.reset();
  builders.cutout.reset();
  builders.fluid.reset();
  let quadCount = 0;

  for (const dir of DIRECTIONS) {
    const { axis, uAxis, vAxis, sign, normal } = dir;
    const nStep = STRIDE[axis]! * sign; // Schritt zum Nachbarn in Normalenrichtung
    const uStep = STRIDE[uAxis]!;
    const vStep = STRIDE[vAxis]!;

    for (let slice = 0; slice < CHUNK_SIZE; slice++) {
      // --- Maske aufbauen ---
      let any = false;
      for (let b = 0; b < CHUNK_SIZE; b++) {
        for (let a = 0; a < CHUNK_SIZE; a++) {
          pos[axis] = slice;
          pos[uAxis] = a;
          pos[vAxis] = b;
          const i = paddedIndex(pos[0]!, pos[1]!, pos[2]!);
          const m = a + b * CHUNK_SIZE;
          const value = blocks[i]!;
          const t = blockType(value);
          const p = pass[t]!;
          if (p === RenderPass.None) {
            maskType[m] = 0;
            continue;
          }
          const j = i + nStep;
          const nt = blockType(blocks[j]!);
          if (!faceVisible(p, t, nt, opaque, pass)) {
            maskType[m] = 0;
            continue;
          }
          any = true;
          maskType[m] = t;

          // Flags
          let flags = 0;
          if (reg.isEmissive(t)) flags |= FLAG_EMISSIVE;
          let extra = 0;
          if (p === RenderPass.Fluid && normal === NORMAL_PY) {
            flags |= FLAG_FLUID_TOP;
            // Wassertiefe: Abstand von der Oberfläche zum Spaltenboden.
            const floorY = input.height[pos[0]! + pos[2]! * CHUNK_SIZE]!;
            extra = Math.max(0, Math.min(MAX_WATER_DEPTH, input.baseY + slice - floorY));
          }
          if (p === RenderPass.Cutout) flags |= FLAG_WIND;
          maskFlags[m] = flags;
          maskExtra[m] = extra;

          // AO + Licht je Ecke. Ecken in Quad-Reihenfolge:
          // 0 (−u,−v), 1 (+u,−v), 2 (+u,+v), 3 (−u,+v)
          const front = j; // Zelle vor der Fläche
          const ao0 = cornerAo(blocks, opaque, front, -uStep, -vStep);
          const ao1 = cornerAo(blocks, opaque, front, uStep, -vStep);
          const ao2 = cornerAo(blocks, opaque, front, uStep, vStep);
          const ao3 = cornerAo(blocks, opaque, front, -uStep, vStep);
          maskAo[m] = ao0 | (ao1 << 2) | (ao2 << 4) | (ao3 << 6);
          maskL0[m] = cornerLight(blocks, light, opaque, front, -uStep, -vStep);
          maskL1[m] = cornerLight(blocks, light, opaque, front, uStep, -vStep);
          maskL2[m] = cornerLight(blocks, light, opaque, front, uStep, vStep);
          maskL3[m] = cornerLight(blocks, light, opaque, front, -uStep, vStep);
        }
      }
      if (!any) continue;

      // --- Greedy-Verschmelzung ---
      for (let b = 0; b < CHUNK_SIZE; b++) {
        for (let a = 0; a < CHUNK_SIZE;) {
          const m = a + b * CHUNK_SIZE;
          const t = maskType[m]!;
          if (t === 0) {
            a++;
            continue;
          }
          const ao = maskAo[m]!;
          const fl = maskFlags[m]!;
          const ex = maskExtra[m]!;
          const l0 = maskL0[m]!;
          const l1 = maskL1[m]!;
          const l2 = maskL2[m]!;
          const l3 = maskL3[m]!;

          // Breite
          let w = 1;
          while (a + w < CHUNK_SIZE && sameFace(m + w, t, ao, fl, ex, l0, l1, l2, l3)) w++;
          // Höhe
          let h = 1;
          outer: while (b + h < CHUNK_SIZE) {
            const row = m + h * CHUNK_SIZE;
            for (let k = 0; k < w; k++) {
              if (!sameFace(row + k, t, ao, fl, ex, l0, l1, l2, l3)) break outer;
            }
            h++;
          }

          emitQuad(reg, dir, slice, a, b, w, h, t, ao, fl, ex, l0, l1, l2, l3);
          quadCount++;

          // Maske leeren
          for (let y = 0; y < h; y++) {
            const row = m + y * CHUNK_SIZE;
            for (let k = 0; k < w; k++) maskType[row + k] = 0;
          }
          a += w;
        }
      }
    }
  }

  return {
    opaque: builders.opaque.finish(),
    cutout: builders.cutout.finish(),
    fluid: builders.fluid.finish(),
    quadCount,
  };
}

function sameFace(
  m: number,
  t: number,
  ao: number,
  fl: number,
  ex: number,
  l0: number,
  l1: number,
  l2: number,
  l3: number,
): boolean {
  return (
    maskType[m] === t &&
    maskAo[m] === ao &&
    maskFlags[m] === fl &&
    maskExtra[m] === ex &&
    maskL0[m] === l0 &&
    maskL1[m] === l1 &&
    maskL2[m] === l2 &&
    maskL3[m] === l3
  );
}

/** Ist die Fläche von Block t (Pass p) zum Nachbarn nt sichtbar? */
function faceVisible(
  p: number,
  t: number,
  nt: number,
  opaque: Uint8Array,
  pass: Uint8Array,
): boolean {
  if (opaque[nt]) return false; // opaker Nachbar verdeckt immer
  if (nt === t) return false; // gleicher Typ: innere Fläche (Blätter, Wasser, Glas)
  if (p === RenderPass.Fluid && pass[nt] === RenderPass.Fluid) return false; // Wasser an Wasser
  return true;
}

/**
 * Vertex-AO nach dem klassischen 3-Nachbarn-Schema (0 dunkel … 3 hell).
 * `front` ist die Zelle vor der Fläche, su/sv die Schritte zur Ecke.
 */
function cornerAo(
  blocks: Uint16Array,
  opaque: Uint8Array,
  front: number,
  su: number,
  sv: number,
): number {
  const s1 = opaque[blockType(blocks[front + su]!)]!;
  const s2 = opaque[blockType(blocks[front + sv]!)]!;
  if (s1 && s2) return 0;
  const c = opaque[blockType(blocks[front + su + sv]!)]!;
  return 3 - (s1 + s2 + c);
}

/** Geglättetes Licht an einer Ecke: Mittel der nicht-opaken Zellen (front, side1, side2, corner). */
function cornerLight(
  blocks: Uint16Array,
  light: Uint16Array,
  opaque: Uint8Array,
  front: number,
  su: number,
  sv: number,
): number {
  let r = 0;
  let g = 0;
  let b = 0;
  let s = 0;
  let n = 0;
  const l0 = light[front]!;
  r += lightR(l0);
  g += lightG(l0);
  b += lightB(l0);
  s += lightSky(l0);
  n++;
  const i1 = front + su;
  const i2 = front + sv;
  const o1 = opaque[blockType(blocks[i1]!)]!;
  const o2 = opaque[blockType(blocks[i2]!)]!;
  if (!o1) {
    const l = light[i1]!;
    r += lightR(l);
    g += lightG(l);
    b += lightB(l);
    s += lightSky(l);
    n++;
  }
  if (!o2) {
    const l = light[i2]!;
    r += lightR(l);
    g += lightG(l);
    b += lightB(l);
    s += lightSky(l);
    n++;
  }
  // Die Ecke zählt nur, wenn sie nicht hinter zwei Seiten "eingeschlossen" ist.
  if (!(o1 && o2)) {
    const i3 = front + su + sv;
    if (!opaque[blockType(blocks[i3]!)]) {
      const l = light[i3]!;
      r += lightR(l);
      g += lightG(l);
      b += lightB(l);
      s += lightSky(l);
      n++;
    }
  }
  // Rundung: auf ganze Lichtstufen, gepackt wie ein Lichtwert.
  const inv = 1 / n;
  return (
    Math.round(r * inv) |
    (Math.round(g * inv) << 4) |
    (Math.round(b * inv) << 8) |
    (Math.round(s * inv) << 12)
  );
}

const corner = [0, 0, 0];

function emitQuad(
  reg: BlockRegistry,
  dir: Direction,
  slice: number,
  a: number,
  b: number,
  w: number,
  h: number,
  t: number,
  ao: number,
  flags: number,
  extra: number,
  l0: number,
  l1: number,
  l2: number,
  l3: number,
): void {
  const p = reg.pass[t]!;
  // Fluid-Oberseiten tragen in v die Wassertiefe statt der Quad-Koordinate.
  const fluidTop = (flags & FLAG_FLUID_TOP) !== 0;
  const qv0 = fluidTop ? extra : 0;
  const qvh = fluidTop ? extra : h;
  const builder =
    p === RenderPass.Fluid
      ? builders.fluid
      : p === RenderPass.Cutout
        ? builders.cutout
        : builders.opaque;
  builder.ensure(4);

  const { axis, uAxis, vAxis, sign, normal } = dir;
  const plane = sign > 0 ? slice + 1 : slice;
  const colors =
    normal === NORMAL_PY ? reg.colorTop : normal === NORMAL_NY ? reg.colorBottom : reg.colorSide;
  const co = t * 3;
  const r = colors[co]!;
  const g = colors[co + 1]!;
  const bl = colors[co + 2]!;
  const pattern = reg.pattern[t]!;

  const ao0 = ao & 3;
  const ao1 = (ao >>> 2) & 3;
  const ao2 = (ao >>> 4) & 3;
  const ao3 = (ao >>> 6) & 3;

  // Ecken: 0 (a,b) 1 (a+w,b) 2 (a+w,b+h) 3 (a,b+h)
  const v0 = vertex(
    builder,
    axis,
    uAxis,
    vAxis,
    plane,
    a,
    b,
    normal,
    flags,
    ao0,
    pattern,
    0,
    qv0,
    l0,
    r,
    g,
    bl,
  );
  const v1 = vertex(
    builder,
    axis,
    uAxis,
    vAxis,
    plane,
    a + w,
    b,
    normal,
    flags,
    ao1,
    pattern,
    w,
    qv0,
    l1,
    r,
    g,
    bl,
  );
  const v2 = vertex(
    builder,
    axis,
    uAxis,
    vAxis,
    plane,
    a + w,
    b + h,
    normal,
    flags,
    ao2,
    pattern,
    w,
    qvh,
    l2,
    r,
    g,
    bl,
  );
  const v3 = vertex(
    builder,
    axis,
    uAxis,
    vAxis,
    plane,
    a,
    b + h,
    normal,
    flags,
    ao3,
    pattern,
    0,
    qvh,
    l3,
    r,
    g,
    bl,
  );

  // Diagonale drehen, wenn AO asymmetrisch – vermeidet Kreuzmuster.
  if (ao0 + ao2 > ao1 + ao3) {
    builder.pushTriangle(v0, v1, v2);
    builder.pushTriangle(v0, v2, v3);
  } else {
    builder.pushTriangle(v1, v2, v3);
    builder.pushTriangle(v1, v3, v0);
  }
}

function vertex(
  builder: MeshBuilder,
  axis: number,
  uAxis: number,
  vAxis: number,
  plane: number,
  u: number,
  v: number,
  normal: number,
  flags: number,
  ao: number,
  pattern: number,
  qu: number,
  qv: number,
  lightPacked: number,
  r: number,
  g: number,
  b: number,
): number {
  corner[axis] = plane;
  corner[uAxis] = u;
  corner[vAxis] = v;
  return builder.pushVertex(
    corner[0]!,
    corner[1]!,
    corner[2]!,
    normal,
    flags,
    ao,
    pattern,
    qu,
    qv,
    (lightR(lightPacked) << 4) | lightG(lightPacked),
    (lightB(lightPacked) << 4) | lightSky(lightPacked),
    r,
    g,
    b,
  );
}
