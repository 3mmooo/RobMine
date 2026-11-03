# ADR 0002 – three r187 mit WebGLRenderer (kein WebGPU in v1)

**Status:** angenommen (2026-11-03)

## Kontext

three r187 bietet `WebGLRenderer` (stabil, offiziell für reine WebGL-2-Anwendungen empfohlen) und `WebGPURenderer` (laut Manual noch „experimental"). WebGPU ist 2026 nicht universell verfügbar (Firefox Linux/Android nur Pre-Release), Headless-Chromium in CI rendert nur WebGL (SwiftShader). Im WebGPURenderer gibt es kein `ShaderMaterial`/`onBeforeCompile`/`EffectComposer` – alles müsste in TSL geschrieben werden.

## Entscheidung

- v1 rendert mit `WebGLRenderer`, GLSL-Patches über `onBeforeCompile`, CSM über `three/addons/csm/CSM.js`, Post-Processing später über das `postprocessing`-Paket (6.39.x, peer < 0.188).
- `three` und `@types/three` werden exakt gepinnt (0.187.0); Upgrades nur in eigener Session mit Migration-Guide und Screenshot-Diffs.
- Die Render-Schicht bleibt hinter einer Fassade (`Renderer`, `TerrainMaterial`, `ChunkBatch`), damit ein WebGPU/TSL-Pfad als eigene Phase (10+) hinzukommen kann.

## Konsequenzen

- Draw-Call-Budget wird über `BatchedMesh` (Multi-Draw) gehalten, nicht über Instancing-Tricks.
- Keine SharedArrayBuffer-Abhängigkeit (kein COOP/COEP nötig) – Chunk-Daten laufen als Transferables.
