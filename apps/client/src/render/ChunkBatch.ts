import {
  BatchedMesh,
  Box3,
  BufferAttribute,
  BufferGeometry,
  Group,
  type Material,
  Matrix4,
  Sphere,
  Vector3,
} from 'three';
import { CHUNK_SIZE, type MeshBuffers, NORMALS } from '@robmine/core';

export interface ChunkBatchOptions {
  /** Vertices je Seite (ein BatchedMesh). */
  pageVertices: number;
  /** Indizes je Seite (Standard: 1,5 × Vertices). */
  pageIndices?: number;
  /** Geometrien je Seite. */
  pageInstances?: number;
  /** Maximale Anzahl Seiten (Standard 8). */
  maxPages?: number;
  /** Mindestreserve je Geometrie in Vertices (Standard 512). */
  minReserveVertices?: number;
  /** Reserve-Faktor über dem Ist-Wert (Standard 1,15). */
  reserveFactor?: number;
  castShadow?: boolean;
  receiveShadow?: boolean;
  renderOrder?: number;
}

interface Page {
  mesh: BatchedMesh;
  /** Summe der reservierten Bereiche aller lebenden Geometrien. */
  liveReservedVertices: number;
  liveReservedIndices: number;
  /** Reserve gelöschter Geometrien, die erst optimize() zurückholt. */
  wastedVertices: number;
  entries: number;
}

interface Entry {
  page: Page;
  geometryId: number;
  instanceId: number;
  reservedVertices: number;
  reservedIndices: number;
  vertices: number;
  indices: number;
}

const _matrix = new Matrix4();
const CHUNK_BOX = new Box3(new Vector3(0, 0, 0), new Vector3(CHUNK_SIZE, CHUNK_SIZE, CHUNK_SIZE));
const CHUNK_SPHERE = new Sphere(
  new Vector3(CHUNK_SIZE / 2, CHUNK_SIZE / 2, CHUNK_SIZE / 2),
  Math.sqrt(3) * (CHUNK_SIZE / 2),
);

/**
 * Chunk-Geometrien eines Render-Passes in BatchedMesh-"Seiten": alle Chunks einer Seite
 * in einem Draw (Multi-Draw), Platzierung über die Instanz-Matrix, Culling je Chunk.
 *
 * Kapazität wird in RESERVIERTEN Vertices geführt (so belegt BatchedMesh den Puffer),
 * nicht in Ist-Werten. Ist eine Seite voll, kommt die nächste; ein Ersetzen, das nicht
 * mehr passt, lässt das alte Mesh stehen (kein Loch).
 */
export class ChunkBatch {
  readonly group = new Group();
  readonly name: string;
  readonly pages: Page[] = [];
  private readonly entries = new Map<string, Entry>();
  private readonly material: Material;
  private readonly pageVertices: number;
  private readonly pageIndices: number;
  private readonly pageInstances: number;
  private readonly maxPages: number;
  private readonly minReserve: number;
  private readonly reserveFactor: number;
  private readonly castShadow: boolean;
  private readonly receiveShadow: boolean;
  private readonly renderOrder: number;
  private usedVertices = 0;
  private usedIndices = 0;
  overflowCount = 0;
  optimizeCount = 0;

  constructor(material: Material, name: string, options: ChunkBatchOptions) {
    this.material = material;
    this.name = name;
    this.group.name = `chunks:${name}`;
    this.pageVertices = options.pageVertices;
    this.pageIndices = options.pageIndices ?? Math.ceil(options.pageVertices * 1.5);
    this.pageInstances = options.pageInstances ?? 2048;
    this.maxPages = options.maxPages ?? 8;
    this.minReserve = options.minReserveVertices ?? 512;
    this.reserveFactor = options.reserveFactor ?? 1.15;
    this.castShadow = options.castShadow ?? true;
    this.receiveShadow = options.receiveShadow ?? true;
    this.renderOrder = options.renderOrder ?? 0;
  }

  get chunkCount(): number {
    return this.entries.size;
  }

  /** Tatsächlich genutzte Vertices (Statistik). */
  get vertexCount(): number {
    return this.usedVertices;
  }

  /** Reservierte Vertices über alle Seiten (bestimmt die Kapazität). */
  get reservedVertexCount(): number {
    let n = 0;
    for (const p of this.pages) n += p.liveReservedVertices;
    return n;
  }

  get pageCount(): number {
    return this.pages.length;
  }

  /** Anteil der reservierten Kapazität am Maximum (alle möglichen Seiten). */
  get capacityUsed(): number {
    return this.reservedVertexCount / (this.pageVertices * this.maxPages);
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  /** Setzt oder ersetzt das Mesh eines Chunks. Liefert false bei Kapazitätsüberlauf. */
  set(key: string, buffers: MeshBuffers, cx: number, cy: number, cz: number): boolean {
    const geometry = buildGeometry(buffers);
    try {
      const existing = this.entries.get(key);
      if (existing) {
        if (
          buffers.vertexCount <= existing.reservedVertices &&
          buffers.indexCount <= existing.reservedIndices
        ) {
          existing.page.mesh.setGeometryAt(existing.geometryId, geometry);
          this.usedVertices += buffers.vertexCount - existing.vertices;
          this.usedIndices += buffers.indexCount - existing.indices;
          existing.vertices = buffers.vertexCount;
          existing.indices = buffers.indexCount;
          return true;
        }
        const rv = this.reserve(buffers.vertexCount, this.minReserve);
        const ri = this.reserve(buffers.indexCount, Math.ceil(this.minReserve * 1.5));
        const page = this.findPage(rv, ri, existing);
        if (!page) {
          this.overflowCount++;
          return false; // altes Mesh bleibt sichtbar
        }
        this.remove(key);
        return this.insert(page, key, geometry, buffers, rv, ri, cx, cy, cz);
      }
      const rv = this.reserve(buffers.vertexCount, this.minReserve);
      const ri = this.reserve(buffers.indexCount, Math.ceil(this.minReserve * 1.5));
      const page = this.findPage(rv, ri, null);
      if (!page) {
        this.overflowCount++;
        return false;
      }
      return this.insert(page, key, geometry, buffers, rv, ri, cx, cy, cz);
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
      e.page.mesh.deleteInstance(e.instanceId);
      e.page.mesh.deleteGeometry(e.geometryId);
    } catch (err) {
      console.warn(`[ChunkBatch:${this.name}] Entfernen fehlgeschlagen`, err);
    }
    e.page.liveReservedVertices -= e.reservedVertices;
    e.page.liveReservedIndices -= e.reservedIndices;
    e.page.wastedVertices += e.reservedVertices;
    e.page.entries--;
    this.usedVertices -= e.vertices;
    this.usedIndices -= e.indices;
  }

  /** Packt Seiten neu, auf denen mehr als 30 % Verschnitt entstanden ist. */
  maybeOptimize(): number {
    let n = 0;
    for (const p of this.pages) {
      if (p.wastedVertices < this.pageVertices * 0.3) continue;
      p.mesh.optimize();
      p.wastedVertices = 0;
      this.optimizeCount++;
      n++;
    }
    return n;
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  clear(): void {
    for (const key of Array.from(this.entries.keys())) this.remove(key);
  }

  dispose(): void {
    this.clear();
    for (const p of this.pages) {
      this.group.remove(p.mesh);
      p.mesh.dispose();
    }
    this.pages.length = 0;
  }

  private reserve(count: number, min: number): number {
    return Math.max(min, Math.ceil(count * this.reserveFactor));
  }

  /** Seite mit genug reservierbarer Kapazität – die Reserve von `existing` zählt als frei. */
  private findPage(rv: number, ri: number, existing: Entry | null): Page | null {
    for (const p of this.pages) {
      const freeV =
        this.pageVertices -
        p.liveReservedVertices +
        (existing?.page === p ? existing.reservedVertices : 0);
      const freeI =
        this.pageIndices -
        p.liveReservedIndices +
        (existing?.page === p ? existing.reservedIndices : 0);
      if (freeV >= rv && freeI >= ri) return p;
    }
    if (this.pages.length < this.maxPages) return this.addPage();
    return null;
  }

  private insert(
    page: Page,
    key: string,
    geometry: BufferGeometry,
    buffers: MeshBuffers,
    rv: number,
    ri: number,
    cx: number,
    cy: number,
    cz: number,
  ): boolean {
    const mesh = page.mesh;
    // Fragmentiert (gelöschte Bereiche hinter dem Schreibzeiger)? Dann einmal kompaktieren.
    if (mesh.unusedVertexCount < rv || mesh.unusedIndexCount < ri) {
      mesh.optimize();
      page.wastedVertices = 0;
      this.optimizeCount++;
    }
    const geometryId = mesh.addGeometry(geometry, rv, ri);
    const instanceId = mesh.addInstance(geometryId);
    _matrix.makeTranslation(cx * CHUNK_SIZE, cy * CHUNK_SIZE, cz * CHUNK_SIZE);
    mesh.setMatrixAt(instanceId, _matrix);
    this.entries.set(key, {
      page,
      geometryId,
      instanceId,
      reservedVertices: rv,
      reservedIndices: ri,
      vertices: buffers.vertexCount,
      indices: buffers.indexCount,
    });
    page.liveReservedVertices += rv;
    page.liveReservedIndices += ri;
    page.entries++;
    this.usedVertices += buffers.vertexCount;
    this.usedIndices += buffers.indexCount;
    return true;
  }

  private addPage(): Page {
    const mesh = new BatchedMesh(
      this.pageInstances,
      this.pageVertices,
      this.pageIndices,
      this.material,
    );
    mesh.name = `chunks:${this.name}:${this.pages.length}`;
    mesh.frustumCulled = false; // Culling passiert je Chunk (perObjectFrustumCulled)
    mesh.perObjectFrustumCulled = true;
    mesh.castShadow = this.castShadow;
    mesh.receiveShadow = this.receiveShadow;
    mesh.renderOrder = this.renderOrder;
    this.group.add(mesh);
    const page: Page = {
      mesh,
      liveReservedVertices: 0,
      liveReservedIndices: 0,
      wastedVertices: 0,
      entries: 0,
    };
    this.pages.push(page);
    return page;
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
