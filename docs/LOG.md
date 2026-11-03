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

**Perf-Bericht des Users (RTX 3060 Ti, Stufe Mittel, Radius 8, Phase 1):** 144 fps (Monitor-Limit), Frame 1,9 ms (p95 2,6 ms), 22 Draw Calls, 2,84 M Dreiecke, 6 Batch-Seiten, Heap 235 MB, 225 Spalten / 627 Chunks, Weltgen 8,1 ms/Spalte, Meshing 3,0 ms/Chunk, 0 Überläufe. → Budget 16,6 ms wird um den Faktor 8 unterschritten; Luft für Stufe Hoch (Radius 12) und Post-Effekte.

## Session 5 – 2026-11-03 – Phase 4 kompakt (Mehrspieler)

Protokoll v2: `Hello.name`, `PlayerMove` (C→S, 15 Hz), `Chat`, `Players` (S→C, 20 Hz, Sichtweite 160 m), `PlayerJoin`/`PlayerLeave`, `ChatMessage`. `@robmine/sim`: `Instance` (eine Welt, viele `Session`s; Rate-Limits je Nachrichtenart, Reichweitenprüfung 8 m für Blockaktionen, Spielerlimit, Kick bei Flut) – `LocalInstance` ist jetzt eine Instanz mit genau einer Sitzung. Chat-Filter (Leetspeak-Normalisierung, Schimpfwörter, Links/E-Mail/Telefon) + Namensbereinigung. `apps/server`: Node 22 + `ws`, `/ws`, `/healthz`, `/server.json`, optional Auslieferung des gebauten Clients (ein Link für alles), Speicherung veränderter Spalten als Dateien (atomar), 20-Hz-Takt, sauberes Herunterfahren. Client: `?server=…` bzw. automatische Erkennung, Mitspieler als Figuren mit Namensschild und Laufanimation (weich interpoliert), Chat (T). Docker + `docs/HOSTING.md`. Tests: Server-Integration (2 WebSocket-Clients) und E2E mit zwei Browsern (sehen sich, bauen gemeinsam, chatten). Gefundener Fehler: Namen bereits anwesender Spieler gingen verloren (kamen vor dem Handler an) → `Connection.roster`.

**Abkürzungen (bewusst, für später):** Bewegung meldet der Client selbst (keine Server-Prediction), Kreaturen/Survival laufen je Client, kein Konto/Login.

## Session 4 – 2026-11-03 – Phase 3 kompakt (Survival)

Reine Logik in `@robmine/sim` (getestet): `Inventory` + `craft`, `survival.ts` (Leben/Sättigung, Regeneration, Fallschaden nie tödlich bei vollem Leben, kein Hungertod), `creatures.ts` (Huscher: spawnt bei effektivem Licht < 4 im Ring 18–34 m, jagt, springt über Blöcke, greift an, verbrennt ab Licht 11). `@robmine/content/items.ts`: Glimmbeere (Essen, 30 % aus Blättern), Schattenstaub (Huscher-Drop), 6 Rezepte (Bretter, Werkbank, Glutfackel, Glas, Ambritlampe, Kristall), Drops je Block; Erreichbarkeitstest aller Rezepte. Client: `Game` (Modus Survival/Kreativ mit C, Inventar + Werte in localStorage je Seed, Drops erst nach Server-Bestätigung, optimistische Platzierung mit Rückbuchung nach 3 s), HUD (Herzen, Sättigung, Abbau-Fortschritt, Treffer-Blitz, „Dein Licht ist erloschen" ohne Itemverlust), Halten zum Abbauen (Härte × 0,9 s), Angriff (4 Schaden, Rückstoß), Kreaturen-Figuren mit leuchtenden Augen, Brennen/Treffer-Aufleuchten. Nacht heller (Mondlicht). **Abkürzung:** Kreaturen und Survival-Werte laufen in Phase 3 im Client; mit dem Server (Phase 4) wandern sie in die Instanz.

## Session 3 – 2026-11-03 – Phase 2 kompakt (Bauen)

Protokoll: `BlockAction` (C→S) / `BlockUpdate` (S→C). Die Instanz ist autoritativ: validiert (setzbar, unzerstörbar, Wasser ersetzbar), erzeugt die Spalte beim ersten Eingriff aus dem Seed, ändert die Welt, bestätigt per BlockUpdate und speichert verzögert (1,5 s) alle 8 Chunks der Spalte in IndexedDB (`robmine-world-<seed>`); beim nächsten Start liefert sie die Spalte als Blobs (Seed-Streaming unverändert). Client: DDA-Raycast (6 m), Hervorhebung, Linksklick abbauen (Partikel), Rechtsklick setzen (nicht in den eigenen Körper), Hotbar 1–9 + Mausrad, Block-Auswahl mit E, Licht der Spalte wird nach jeder Änderung neu berechnet (synchron, ≈5–10 ms) und betroffene Chunks neu gemesht. E2E: setzen → abbauen → Neuladen → Änderungen bleiben.

## Session 2 – 2026-11-03 – Phase 1 kompakt

Allein, ohne Agenten. Neu: 9 Oberflächen-Biome (Hainland, Flüsterwald mit Riesenbäumen, Blütental mit rosa Kronen, Glasdünen, Nebelmoor mit Tümpeln, Frostkamm mit Nadelbäumen, Himmelsgrat, Sternenmeer/Perlküste, Aschenfeld mit Basalt), Kristalle in tiefen Höhlen (farbiges Licht), Wasser mit Tiefenfarbe und Uferschaum (Tiefe im Vertex, aus der Höhenkarte), Spielerphysik (`core/physics/player.ts`: AABB, Schwerkraft, Sprung, automatische Stufe, Schwimmen) – Laufmodus ist Standard, **F** schaltet auf Fliegen. 71 Tests, Bench und E2E grün.

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
