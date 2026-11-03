/**
 * Vertex-Format der Chunk-Meshes (12 Byte je Vertex, vier Uint8-Attribute):
 *
 *   position  u8×3  x, y, z (0–32, chunk-lokal)
 *   a_data    u8×4  [0] normalIndex (0–5) | flags << 3
 *                   [1] ao (0–3) | pattern << 2 (0–63)
 *                   [2] u (quad-lokal, 0–32)
 *                   [3] v (quad-lokal, 0–32)
 *   a_light   u8×2  [0] R<<4 | G   [1] B<<4 | Sky   (je Kanal 0–15)
 *   color     u8×3  r, g, b (normalized)
 *
 * Normalen: 0 +x, 1 −x, 2 +y, 3 −y, 4 +z, 5 −z.
 */
export const VERTEX_BYTES = 12;

export const FLAG_EMISSIVE = 1;
export const FLAG_FLUID_TOP = 2;
export const FLAG_WIND = 4;

export const NORMAL_PX = 0;
export const NORMAL_NX = 1;
export const NORMAL_PY = 2;
export const NORMAL_NY = 3;
export const NORMAL_PZ = 4;
export const NORMAL_NZ = 5;

export const NORMALS: readonly (readonly [number, number, number])[] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

export interface MeshBuffers {
  position: Uint8Array;
  data: Uint8Array;
  light: Uint8Array;
  color: Uint8Array;
  index: Uint32Array;
  vertexCount: number;
  indexCount: number;
}

export interface ChunkMesh {
  opaque: MeshBuffers | null;
  cutout: MeshBuffers | null;
  fluid: MeshBuffers | null;
  /** Anzahl Quads über alle Pässe. */
  quadCount: number;
}

/** Liefert die Transferables eines Chunk-Meshes (für postMessage). */
export function meshTransferables(mesh: ChunkMesh): ArrayBuffer[] {
  const out: ArrayBuffer[] = [];
  for (const b of [mesh.opaque, mesh.cutout, mesh.fluid]) {
    if (!b) continue;
    out.push(
      b.position.buffer as ArrayBuffer,
      b.data.buffer as ArrayBuffer,
      b.light.buffer as ArrayBuffer,
      b.color.buffer as ArrayBuffer,
      b.index.buffer as ArrayBuffer,
    );
  }
  return out;
}

/** Wachsender Puffer für ein Mesh. */
export class MeshBuilder {
  position: Uint8Array;
  data: Uint8Array;
  light: Uint8Array;
  color: Uint8Array;
  index: Uint32Array;
  vertexCount = 0;
  indexCount = 0;
  private capacity: number;

  constructor(initialVertices = 4096) {
    this.capacity = initialVertices;
    this.position = new Uint8Array(initialVertices * 3);
    this.data = new Uint8Array(initialVertices * 4);
    this.light = new Uint8Array(initialVertices * 2);
    this.color = new Uint8Array(initialVertices * 3);
    this.index = new Uint32Array(Math.ceil(initialVertices * 1.5));
  }

  reset(): void {
    this.vertexCount = 0;
    this.indexCount = 0;
  }

  ensure(extraVertices: number): void {
    if (this.vertexCount + extraVertices <= this.capacity) return;
    let cap = this.capacity;
    while (this.vertexCount + extraVertices > cap) cap *= 2;
    this.position = grow(this.position, cap * 3);
    this.data = grow(this.data, cap * 4);
    this.light = grow(this.light, cap * 2);
    this.color = grow(this.color, cap * 3);
    const idx = new Uint32Array(Math.ceil(cap * 1.5));
    idx.set(this.index.subarray(0, this.indexCount));
    this.index = idx;
    this.capacity = cap;
  }

  /** Schreibt einen Vertex und liefert seinen Index. */
  pushVertex(
    x: number,
    y: number,
    z: number,
    normalIndex: number,
    flags: number,
    ao: number,
    pattern: number,
    u: number,
    v: number,
    lightRG: number,
    lightBS: number,
    r: number,
    g: number,
    b: number,
  ): number {
    const i = this.vertexCount++;
    const p = i * 3;
    this.position[p] = x;
    this.position[p + 1] = y;
    this.position[p + 2] = z;
    const d = i * 4;
    this.data[d] = normalIndex | (flags << 3);
    this.data[d + 1] = ao | (pattern << 2);
    this.data[d + 2] = u;
    this.data[d + 3] = v;
    const l = i * 2;
    this.light[l] = lightRG;
    this.light[l + 1] = lightBS;
    this.color[p] = r;
    this.color[p + 1] = g;
    this.color[p + 2] = b;
    return i;
  }

  pushTriangle(a: number, b: number, c: number): void {
    const i = this.indexCount;
    this.index[i] = a;
    this.index[i + 1] = b;
    this.index[i + 2] = c;
    this.indexCount += 3;
  }

  /** Kopiert die belegten Bereiche in exakt passende Arrays (transferierbar). */
  finish(): MeshBuffers | null {
    if (this.vertexCount === 0) return null;
    const n = this.vertexCount;
    return {
      position: this.position.slice(0, n * 3),
      data: this.data.slice(0, n * 4),
      light: this.light.slice(0, n * 2),
      color: this.color.slice(0, n * 3),
      index: this.index.slice(0, this.indexCount),
      vertexCount: n,
      indexCount: this.indexCount,
    };
  }
}

function grow(src: Uint8Array, length: number): Uint8Array {
  const out = new Uint8Array(length);
  out.set(src);
  return out;
}
