import { describe, expect, it } from 'vitest';
import { MeshLambertMaterial } from 'three';
import type { MeshBuffers } from '@robmine/core';
import { ChunkBatch } from '../src/render/ChunkBatch.ts';

/** Ein Quad-Mesh mit `quads` Vierecken (4 Vertices, 6 Indizes je Quad). */
function mesh(quads: number): MeshBuffers {
  const n = quads * 4;
  const position = new Uint8Array(n * 3);
  const data = new Uint8Array(n * 4);
  const light = new Uint8Array(n * 2);
  const color = new Uint8Array(n * 3);
  const index = new Uint32Array(quads * 6);
  for (let q = 0; q < quads; q++) {
    const v = q * 4;
    position.set([0, q & 31, 0, 1, q & 31, 0, 1, q & 31, 1, 0, q & 31, 1], v * 3);
    index.set([v, v + 1, v + 2, v, v + 2, v + 3], q * 6);
  }
  return { position, data, light, color, index, vertexCount: n, indexCount: quads * 6 };
}

describe('ChunkBatch (Seiten + Reserve-Zählung)', () => {
  it('legt neue Seiten an, wenn die Reserve einer Seite erschöpft ist', () => {
    const batch = new ChunkBatch(new MeshLambertMaterial(), 'test', {
      pageVertices: 4000,
      pageInstances: 64,
      maxPages: 3,
      minReserveVertices: 100,
      reserveFactor: 1.0,
    });
    // 1000-Vertex-Meshes: 4 je Seite (Reserve 1000) → ab dem 5. eine zweite Seite.
    for (let i = 0; i < 4; i++) expect(batch.set(`c${i}`, mesh(250), i, 0, 0)).toBe(true);
    expect(batch.pageCount).toBe(1);
    expect(batch.set('c4', mesh(250), 4, 0, 0)).toBe(true);
    expect(batch.pageCount).toBe(2);
    expect(batch.chunkCount).toBe(5);
    expect(batch.reservedVertexCount).toBe(5000);
    expect(batch.vertexCount).toBe(5000);
  });

  it('meldet Überlauf erst, wenn alle Seiten voll sind, und lässt ein altes Mesh beim Ersetzen stehen', () => {
    const batch = new ChunkBatch(new MeshLambertMaterial(), 'test', {
      pageVertices: 2000,
      pageInstances: 16,
      maxPages: 1,
      minReserveVertices: 100,
      reserveFactor: 1.0,
    });
    expect(batch.set('a', mesh(250), 0, 0, 0)).toBe(true); // 1000
    expect(batch.set('b', mesh(250), 1, 0, 0)).toBe(true); // 2000 → voll
    expect(batch.set('c', mesh(100), 2, 0, 0)).toBe(false);
    expect(batch.overflowCount).toBe(1);
    expect(batch.chunkCount).toBe(2);
    // Ersetzen mit größerem Mesh, das nicht passt: altes bleibt erhalten.
    expect(batch.set('a', mesh(400), 0, 0, 0)).toBe(false);
    expect(batch.has('a')).toBe(true);
    expect(batch.chunkCount).toBe(2);
    // Ersetzen mit kleinerem Mesh passt in die bestehende Reserve.
    expect(batch.set('a', mesh(50), 0, 0, 0)).toBe(true);
    expect(batch.vertexCount).toBe(200 + 1000);
    expect(batch.reservedVertexCount).toBe(2000);
  });

  it('gibt Reserve beim Entfernen frei und kompaktiert fragmentierte Seiten', () => {
    const batch = new ChunkBatch(new MeshLambertMaterial(), 'test', {
      pageVertices: 3000,
      pageInstances: 16,
      maxPages: 1,
      minReserveVertices: 100,
      reserveFactor: 1.0,
    });
    expect(batch.set('a', mesh(250), 0, 0, 0)).toBe(true);
    expect(batch.set('b', mesh(250), 1, 0, 0)).toBe(true);
    expect(batch.set('c', mesh(250), 2, 0, 0)).toBe(true);
    batch.remove('a');
    expect(batch.reservedVertexCount).toBe(2000);
    // Hinter dem Schreibzeiger ist kein Platz mehr → optimize() holt die Lücke von 'a' zurück.
    expect(batch.set('d', mesh(250), 3, 0, 0)).toBe(true);
    expect(batch.optimizeCount).toBe(1);
    expect(batch.chunkCount).toBe(3);
    expect(batch.overflowCount).toBe(0);
    batch.dispose();
    expect(batch.chunkCount).toBe(0);
    expect(batch.pageCount).toBe(0);
  });
});
