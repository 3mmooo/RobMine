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

## Session 1b – 2026-11-03 – Adversarialer Review von Phase 0

3 unabhängige Reviewer (core / client / protokoll+tooling) + je Fund ein Skeptiker: 14 Funde, 10 bestätigt, alle behoben.

| #   | Fund                                                                                                                                                       | Behebung                                                                                                          |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 1   | Licht-BFS: Seeds übersprangen uniforme Luft-Chunks mit materialisiertem Licht → schwarze Unterseiten von Plattformen an Chunk-Unterkanten (ab Blocksetzen) | `scanAll` auch bei materialisiertem Licht; Regressionstest                                                        |
| 2   | `ChunkBatch` zählte Ist- statt Reserve-Vertices; Puffer bei Radius 8 schon voll → fehlende Chunks, Repack-Ruckler, verschwindende Chunks beim Remesh       | Reserve-basierte Zählung, mehrere BatchedMesh-Seiten je Pass (wachsen bei Bedarf), Ersetzen ohne Loch, Unit-Tests |
| 3   | Lade-Drossel ganz-oder-gar-nicht und nur bei Chunk-Wechsel → Teleport während des Ladens ergab leere Welt                                                  | Anfordern jeden Frame, Drossel über Einträge statt Pool, Entladen vor Anfordern, Retry mit Backoff                |
| 4   | Veränderte Spalten wurden im Main-Thread dekodiert und neu beleuchtet; height/biome blieben falsch                                                         | Dekodieren + Höhenkarte + Licht im Gen-Worker                                                                     |
| 5   | `Connection` ohne Fehlerpfad: Waiter hingen bei Decode-Fehler/Kick/Close ewig                                                                              | `fail()` lehnt alle Waiter ab, Kick/Close/Decode-Fehler beenden sauber, Hinweis im HUD                            |
| 6   | Verwaiste Mesh-Ergebnisse nach Teleport landeten im Batch                                                                                                  | Identitätsprüfung des Spalteneintrags in `applyPending`                                                           |
| 7   | Wasserwelle aus `gl_VertexID` – nicht deterministisch, sprang bei Repacks                                                                                  | Phase aus der Weltposition                                                                                        |
| 8   | Kick beendete die Sitzung nicht, Protokollversion und Hello-Gating wirkungslos                                                                             | Sitzungszustand (awaitingHello/active/closed), Kick schließt Transport, Tests                                     |
| 9   | `engines`/README erlaubten Node 22.12, Type-Stripping ist erst ab 22.18 Standard                                                                           | Node ≥ 22.18                                                                                                      |
| 10  | CI-Bench konnte nie fehlschlagen                                                                                                                           | `--strict --tolerance 1.5` + GitHub-Annotationen                                                                  |

Zusätzlich aus den „widerlegten" Funden übernommen: Byte-Budget je Rahmen beim Sender (`encodeFrames`, 1 MB), Plausibilitätsprüfung der Payload-Länge im RMC1-Decoder, `InlineRunner` liefert Fehler als Promise. Beim Nachtest fiel noch auf, dass `window.__rm.stats()` den 500-ms-Overlay-Cache lieferte – jetzt immer frisch.
