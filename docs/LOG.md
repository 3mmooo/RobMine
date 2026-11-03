# Session-Log

## Session 1 – 2026-11-03 – Phase 0: Fundament

**Gebaut:** Monorepo (pnpm 10, TS 7, Vite 8, Vitest 5, oxlint, prettier, Playwright 1.63), `core` (Datenmodell, Palette/Codec RMC1, RNG/Noise, Weltgen v1 Hainland/Perlküste/Sternenmeer mit Höhlen und Bäumen, Licht-Flood-Fill 4 Kanäle, Greedy-Mesher + AO), `content` (16 Blöcke, Palette, Namens-Bibel), `protocol` (Rahmen, 7 Nachrichten, PortTransport), `sim` (World, LocalInstance mit Seed-Streaming), `client` (Renderer mit CSM/Himmel/Nebel, Terrain-Material, BatchedMesh-Batches, ChunkManager, 3 Worker-Typen, Flugkamera, F3-Overlay, `window.__rm`), `tools` (bench, worldgen-preview, snapshot), `e2e` (Smoke + Leak-Check), Docs.

**Entscheidungen:** siehe ADR 0001 (isomorpher Sim-Kern), ADR 0002 (WebGLRenderer r187, kein WebGPU in v1).

**Gelernt (Fehler, die behoben wurden):**

- three schaltet Geometrien ohne `normal`-Attribut auf `FLAT_SHADED` – deshalb liefert jede Chunk-Geometrie ein Int8-`normal` (3 Byte).
- `inverseTransformDirection` ist seit r185 nur noch ein Deprecation-Alias; Welt-Normalen kommen jetzt als `flat`-Varying aus dem Vertex-Shader.
- Varyings mit konstanten Ganzzahlwerten (Flags, Muster) müssen `flat` sein – sonst erzeugen Interpolationsfehler (3.9999 statt 4) zufällige „emissive" Pixel (Speckles auf Blättern/Wasser).
- `settled` darf nur Spalten mit vollständigen Nachbarn verlangen: die Laderegion ist kreisförmig, Randspalten meshen absichtlich nicht.
- Upload-Budget je Frame ist zeitbasiert (min 4, ≤ 3 ms, max 48), sonst dauert das Laden bei niedriger Framerate (SwiftShader) über eine Minute.

**Messwerte (Container, 4 vCPU, Node 22 – `pnpm bench --columns 200`):**

| Metrik                      | Median  | p95     | Budget |
| --------------------------- | ------- | ------- | ------ |
| Weltgen je Spalte           | 3,7 ms  | 7,5 ms  | 25 ms  |
| Weltgen je Chunk (Spalte/8) | 0,46 ms | 0,93 ms | 5 ms   |
| Licht je Spalte             | 6,5 ms  | 10,9 ms | 24 ms  |
| Meshing je Chunk            | 3,45 ms | 6,5 ms  | 4 ms   |
| Chunk-Blob                  | 0,53 KB | 2,0 KB  | 8 KB   |

Ø 1.347 Quads je Oberflächen-Chunk; Client-Bundle 161 KB gzip (+ 3 Worker à 4–8 KB). E2E (Chromium/SwiftShader, Radius 6): 137 Spalten, 350 Chunks gemesht, 4 Draw Calls (Niedrig) bzw. 10 (Mittel mit 3 Schattenkaskaden), 455k Dreiecke, 0 Konsolenfehler, Geometrien stabil nach Teleport.

**Perf-Bericht des Users (echte GPU):** ausstehend – bitte F3 → „Bericht kopieren" hier eintragen.
