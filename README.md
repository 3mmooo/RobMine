# RobMine

**Arbeitstitel RobMine – Namensvorschlag „Lumenfall".** Eine unendliche, weich beleuchtete Voxelwelt im Browser: überleben, bauen, craften – und mit Freunden eigene Minispiele erschaffen. Sofort per Link spielbar, kein Download.

> Stand: **Phase 0 – Fundament.** Flug über das Hainland mit Himmel, Kaskadenschatten, Nebel, farbigem Voxellicht und Ambient Occlusion. Der Masterplan steht in [`docs/VISION.md`](docs/VISION.md) und [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Schnellstart

Voraussetzungen: Node ≥ 22.18 (führt `.ts`-Werkzeuge direkt aus), pnpm 10 (`corepack enable` reicht).

```bash
pnpm install
```

```bash
pnpm dev
```

Dann `http://127.0.0.1:5173` öffnen, in das Fenster klicken und fliegen: **WASD** bewegen, **Leertaste/Shift** hoch/runter, **Strg** schnell, **F3** Statistik-Overlay (mit „Bericht kopieren").

### URL-Parameter

| Parameter | Bedeutung                                                                | Beispiel                    |
| --------- | ------------------------------------------------------------------------ | --------------------------- |
| `seed`    | Welt-Seed (Zahl oder Text)                                               | `?seed=lumenfall`           |
| `quality` | `low` / `medium` / `high` (Sichtweite, Schatten, Auflösung)              | `?quality=high`             |
| `radius`  | Sichtweite in Spalten (2–16), überschreibt die Stufe                     | `?radius=10`                |
| `t`       | Tageszeit in Sekunden des 24-Minuten-Zyklus (0–1440)                     | `?t=1100` (Abend)           |
| `det`     | `1` = deterministisch: feste Zeit, keine Eingabe (für Tests/Screenshots) | `?det=1`                    |
| `cam`     | Kamera `x,y,z,yaw,pitch`                                                 | `?cam=12,92,20,-0.65,-0.28` |
| `debug`   | `1` = Overlay sofort sichtbar                                            | `?debug=1`                  |

## Befehle

| Befehl                        | Was passiert                                                                            |
| ----------------------------- | --------------------------------------------------------------------------------------- |
| `pnpm dev`                    | Dev-Server mit Hot Reload                                                               |
| `pnpm build` / `pnpm preview` | Produktions-Build / Vorschau unter `:4173`                                              |
| `pnpm typecheck`              | TypeScript 7 (`tsc --noEmit`) in allen Paketen                                          |
| `pnpm lint` / `pnpm format`   | oxlint / prettier                                                                       |
| `pnpm test`                   | Vitest (core, content, protocol, sim)                                                   |
| `pnpm bench`                  | Weltgen/Licht/Meshing/Codec gegen die Budgets (`--strict` bricht bei Überschreitung ab) |
| `pnpm preview:worldgen`       | Höhen-/Biomkarte als PNG nach `tools/out/worldgen.png`                                  |
| `pnpm e2e`                    | Playwright im echten Chromium: Smoke, Budgets, Screenshot, Leak-Check                   |

## Aufbau

```
packages/core       reine TS-Logik: Voxel-Datenmodell, Codec, Noise, Weltgen v1, Licht, Greedy-Mesher
packages/content    Blöcke, Palette, Namens-Bibel (Daten)
packages/protocol   Binärprotokoll: Nachrichten, ByteWriter/Reader, Rahmen, Transport (Loopback)
packages/sim        Instanz-Kern (World, LocalInstance) – läuft im Browser-Worker und später auf dem Server
apps/client         Vite + three.js: Renderer, Material, BatchedMesh, ChunkManager, Worker, Flugkamera
tools               bench, worldgen-preview
e2e                 Playwright-Tests + Screenshots
docs                VISION, ARCHITECTURE, DOD (Definition of Done je Phase), LOG, ADRs
```

Alle Inhalte (Blöcke, Welt, Namen, Shader, Sounds) sind eigen und werden prozedural erzeugt – keine Fremd-Assets.
