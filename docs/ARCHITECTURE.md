# Architektur

## Kernentscheidung: isomorpher Sim-Kern

Auch Solo läuft gegen eine **lokale Server-Simulation im Worker** (`packages/sim` → `LocalInstance`, Transport über MessagePort). Multiplayer tauscht nur den Transport (WebSocket). Ein Weltmodell, eine Physik, ein Protokoll – „Server ist Wahrheit" gilt von Anfang an (ADR 0001).

## Pakete

| Paket               | Inhalt                                                                                                                                                     | Läuft in                                          |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `@robmine/core`     | Voxel-Datenmodell, Palette/Codec (RMC1), Noise/RNG, Weltgen v1, Licht-Flood-Fill (4 Kanäle), Greedy-Mesher + AO, später Physik                             | Browser-Worker, Node, Tests – ohne DOM/Node-Typen |
| `@robmine/content`  | Block-Registry (feste IDs), Palette-Tokens, Namens-Bibel; später Rezepte, Kreaturen, Vorlagen                                                              | überall                                           |
| `@robmine/protocol` | Nachrichten + Opcodes, ByteWriter/Reader (LE), Rahmen-Codec, Transport-Interface (PortTransport, Loopback)                                                 | überall                                           |
| `@robmine/sim`      | `World` (Spaltenspeicher), `LocalInstance` (Hello/Welcome, Seed-Streaming), JobRunner-Abstraktion                                                          | Browser-Worker (Solo), Server                     |
| `@robmine/client`   | Vite + three r187 (WebGLRenderer): Renderer-Fassade, Terrain-Material, `ChunkBatch` (BatchedMesh), `ChunkManager`, Worker-Pools, Flugkamera, Debug-Overlay | Browser                                           |
| `tools`             | `bench.ts` (Budgets), `worldgen-preview.ts` (PNG)                                                                                                          | Node (TS direkt, Type-Stripping)                  |
| `e2e`               | Playwright (Chromium, SwiftShader)                                                                                                                         | CI/lokal                                          |

## Datenmodell

- Chunk 32×32×32, Index `x + (z<<5) + (y<<10)`, Spalte = 8 Chunks (y 0–255), Meeresspiegel 64.
- Blockwert u16: Bits 0–11 Typ, 12–15 Zustand. **Uniform-Chunks** (nur Luft / nur Stein) halten kein Array.
- Licht u16: R, G, B (farbiges Blocklicht), Himmel – je 4 Bit. Nicht gespeichert, beim Laden berechnet.
- Codec `RMC1`: Palette + Bitpacking (1/2/4/8/16 Bit) + deflate-raw (fflate). Uniform 8 Byte, Oberflächen-Chunk 1–4 KB.

## Weltgen v1 (`core/worldgen/v1`)

Klimafelder (Kontinentalität 2048 m, Erosion 1024 m, Grate 256 m, Detail 64 m, Domain-Warp 256 m) → Höhen-Spline → Schichten (Urgestein, Feldstein, Erde, Deckblock, Wasser) → Höhlen (Spaghetti + Käse aus 3D-Noise, 9³-Gitter trilinear) → Bäume (Hash-Raster 6×6, ragen über Spaltengrenzen). Deterministisch je (Seed, cx, cz). Nach Launch eingefroren (Version pro Welt).

## Meshing

Greedy Meshing je Richtung mit Merge-Schlüssel (Typ, AO-Signatur, 4 Vertex-Lichtwerte). Vertex-AO (3-Nachbarn), geglättetes Licht (Mittel der 4 nicht-opaken Zellen), Diagonale wird bei AO-Asymmetrie gedreht. 12-Byte-Vertex: `position` u8×3, `a_data` u8×4 (Normale|Flags, AO|Muster, u, v), `a_light` u8×2, `color` u8×3. Drei Pässe: opak, cutout, Wasser.

## Rendering (Phase 0)

WebGLRenderer (ACES, sRGB) · Himmelskuppel-Shader (Tageszeit-Keyframes, Sonne, Sterne) · linearer Nebel in Horizontfarbe · HemisphereLight + **CSM** (3 Kaskaden, `three/addons/csm`) · je Pass ein **BatchedMesh** (Multi-Draw, Chunk-Culling, reservierte Vertexbereiche, `optimize()` bei > 30 % Verschnitt) · `MeshLambertMaterial` + `onBeforeCompile` (Vertex-Entpacken, Voxellicht × AO × Himmelslicht², Blockjitter, Kantenbevel, Muster) – der CSM-Hook wird umwickelt.

## Worker-Modell (Client)

`gen.worker` × min(4, Kerne−2): Weltgen + Licht je Spalte (Transferables) · `mesh.worker` × 2: Greedy Meshing · `localsim.worker`: Instanz-Kern (Protokoll über MessagePort) · eigener `WorkerPool` mit Prioritäts-Queue (Distanz) und `prune()` für veraltete Jobs. Kein SharedArrayBuffer.

## Lade-Pipeline

`ChunkManager.update()` → Spirale um die Kamera → `Connection.requestColumn` → `ChunkColumn` (pristineMask 0xff = selbst erzeugen) → Gen-Pool → Spalte im Main-Thread-Store → sobald alle 8 Nachbarspalten da sind: gepolsterter 34³-Block → Mesh-Pool → `applyPending()` mit Upload-Budget 4 Chunks/Frame → `ChunkBatch.set()`. Entladen ab Radius + 2.

## Protokoll (Phase 0)

Rahmen `u8 ver · u16 tick · u8 n · n × (u8 op · u32 len · payload)`, LE. Nachrichten: Hello/Welcome, Ping/Pong, ChunkRequest/ChunkColumn, Kick. Seed-Streaming: unveränderte Chunks werden nie übertragen.

## Budgets (siehe Masterplan 6.13)

Chunk-Gen ≤ 5 ms, Spalte ≤ 25 ms, Licht-Init ≤ 3 ms, Meshing ≤ 4 ms, Draw Calls ≤ 100, Main-JS ≤ 5 ms, Link → spielbar ≤ 5 s. `pnpm bench` prüft die Worker-Budgets.
