import {
  BatchedMesh,
  Box3,
  BufferAttribute,
  BufferGeometry,
  Matrix4,
  type Material,
  Sphere,
  Vector3,
} from 'three';
import { CHUNK_SIZE, type MeshBuffers, NORMALS } from '@robmine/core';

interface Entry {
  geometryId: number;
  instanceId: number;
  reservedVertices: number;
  reservedIndices: number;
  vertices: number;
  indices: number;
}

const RESERVE_FACTOR = 1.25;
const MIN_RESERVE = 1024;
const _matrix = new Matrix4();
const CHUNK_BOX = new Box3(new Vector3(0, 0, 0), new Vector3(CHUNK_SIZE, CHUNK_SIZE, CHUNK_SIZE));
const CHUNK_SPHERE = new Sphere(
  new Vector3(CHUNK_SIZE / 2, CHUNK_SIZE / 2, CHUNK_SIZE / 2),
  Math.sqrt(3) * (CHUNK_SIZE / 2),
);

/**
 * Ein BatchedMesh je Render-Pass: alle Chunk-Geometrien in einem Draw (Multi-Draw),
 * Platzierung über die Instanz-Matrix, Frustum-Culling je Chunk.
 */
export class ChunkBatch {
  readonly mesh: BatchedMesh;
  private readonly entries = new Map<string, Entry>();
  private readonly maxVertices: number;
  private readonly maxIndices: number;
  private usedVertices = 0;
  private usedIndices = 0;
  private wastedVertices = 0;
  overflowCount = 0;
  readonly name: string;

  constructor(
    material: Material,
    name: string,
    maxInstances: number,
    maxVertices: number,
    maxIndices: number,
  ) {
    this.name = name;
    this.maxVertices = maxVertices;
    this.maxIndices = maxIndices;
    this.mesh = new BatchedMesh(maxInstances, maxVertices, maxIndices, material);
    this.mesh.name = `chunks:${name}`;
    this.mesh.frustumCulled = false; // Culling passiert je Chunk (perObjectFrustumCulled)
    this.mesh.perObjectFrustumCulled = true;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
  }

  get chunkCount(): number {
    return this.entries.size;
  }

  get vertexCount(): number {
    return this.usedVertices;
  }

  get capacityUsed(): number {
    return this.usedVertices / this.maxVertices;
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  /** Setzt oder ersetzt das Mesh eines Chunks. Liefert false bei Kapazitätsüberlauf. */
  set(key: string, buffers: MeshBuffers, cx: number, cy: number, cz: number): boolean {
    const geometry = buildGeometry(buffers);
    const existing = this.entries.get(key);
    try {
      if (existing) {
        if (
          buffers.vertexCount <= existing.reservedVertices &&
          buffers.indexCount <= existing.reservedIndices
        ) {
          this.mesh.setGeometryAt(existing.geometryId, geometry);
          this.usedVertices += buffers.vertexCount - existing.vertices;
          this.usedIndices += buffers.indexCount - existing.indices;
          existing.vertices = buffers.vertexCount;
          existing.indices = buffers.indexCount;
          geometry.dispose();
          return true;
        }
        this.remove(key);
      }
      const reservedVertices = Math.max(
        MIN_RESERVE,
        Math.ceil(buffers.vertexCount * RESERVE_FACTOR),
      );
      const reservedIndices = Math.max(
        Math.ceil(MIN_RESERVE * 1.5),
        Math.ceil(buffers.indexCount * RESERVE_FACTOR),
      );
      if (
        this.usedVertices + reservedVertices > this.maxVertices ||
        this.usedIndices + reservedIndices > this.maxIndices
      ) {
        this.overflowCount++;
        geometry.dispose();
        return false;
      }
      let geometryId: number;
      try {
        geometryId = this.mesh.addGeometry(geometry, reservedVertices, reservedIndices);
      } catch {
        // Fragmentiert: einmal aufräumen und erneut versuchen.
        this.mesh.optimize();
        this.wastedVertices = 0;
        geometryId = this.mesh.addGeometry(geometry, reservedVertices, reservedIndices);
      }
      const instanceId = this.mesh.addInstance(geometryId);
      _matrix.makeTranslation(cx * CHUNK_SIZE, cy * CHUNK_SIZE, cz * CHUNK_SIZE);
      this.mesh.setMatrixAt(instanceId, _matrix);
      this.entries.set(key, {
        geometryId,
        instanceId,
        reservedVertices,
        reservedIndices,
        vertices: buffers.vertexCount,
        indices: buffers.indexCount,
      });
      this.usedVertices += buffers.vertexCount;
      this.usedIndices += buffers.indexCount;
      return true;
    } catch (err) {
      this.overflowCount++;
      console.warn(`[ChunkBatch:${this.name}] Geometrie konnte nicht eingefügt werden`, err);
      return false;
    } finally {
      geometry.dispose();
    }
  }

  remove(key: string): void {
    const e = this.entries.get(key);
    if (!e) return;
    this.entries.delete(key);
    try {
      this.mesh.deleteInstance(e.instanceId);
      this.mesh.deleteGeometry(e.geometryId);
    } catch (err) {
      console.warn(`[ChunkBatch:${this.name}] Entfernen fehlgeschlagen`, err);
    }
    this.usedVertices -= e.vertices;
    this.usedIndices -= e.indices;
    this.wastedVertices += e.reservedVertices;
  }

  /** Packt den Puffer neu, wenn mehr als 30 % Verschnitt entstanden ist. */
  maybeOptimize(): boolean {
    if (this.wastedVertices < this.maxVertices * 0.3) return false;
    this.mesh.optimize();
    this.wastedVertices = 0;
    return true;
  }

  clear(): void {
    for (const key of Array.from(this.entries.keys())) this.remove(key);
  }

  dispose(): void {
    this.clear();
    this.mesh.dispose();
  }
}

/**
 * Baut eine BufferGeometry mit dem Vertexformat aus core/mesh/VertexFormat.
 * Zusätzlich ein echtes `normal`-Attribut (Int8, 3 Byte): ohne Normalen schaltet three auf
 * FLAT_SHADED (Ableitungs-Normalen), was auf Software-Rasterizern zu Pixelrauschen führt.
 */
export function buildGeometry(b: MeshBuffers): BufferGeometry {
  const g = new BufferGeometry();
  const n = b.vertexCount;
  const normals = new Int8Array(n * 3);
  for (let i = 0; i < n; i++) {
    const dir = NORMALS[b.data[i * 4]! & 7]!;
    normals[i * 3] = dir[0] * 127;
    normals[i * 3 + 1] = dir[1] * 127;
    normals[i * 3 + 2] = dir[2] * 127;
  }
  g.setAttribute('position', new BufferAttribute(b.position, 3, false));
  g.setAttribute('normal', new BufferAttribute(normals, 3, true));
  g.setAttribute('a_data', new BufferAttribute(b.data, 4, false));
  g.setAttribute('a_light', new BufferAttribute(b.light, 2, false));
  g.setAttribute('color', new BufferAttribute(b.color, 3, true));
  g.setIndex(new BufferAttribute(b.index, 1, false));
  g.boundingBox = CHUNK_BOX.clone();
  g.boundingSphere = CHUNK_SPHERE.clone();
  return g;
}
