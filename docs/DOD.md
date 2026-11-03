# Definition of Done je Phase

Keine Phase n+1 ohne grüne Verifikation n **und** Freigabe des Users.

## Phase 0 – Fundament

- [ ] `pnpm install && pnpm typecheck && pnpm lint && pnpm test` grün (≥ 20 Unit-Tests)
- [ ] `pnpm bench`: Weltgen ≤ 5 ms je Chunk, Meshing ≤ 4 ms je Chunk (Median)
- [ ] `pnpm build` ohne Fehler, Bundle ≤ 800 KB gzip
- [ ] `pnpm e2e`: ≥ 150 Chunks gemesht, 0 Konsolenfehler, Screenshot `e2e/screenshots/phase0-hainland.png` mit ≥ 30 % Nicht-Himmel, Draw Calls ≤ 20, Leak-Check nach Teleport
- [ ] `pnpm dev`: Hainland-Hügel mit Gras/Erde/Feldstein, Hain-Bäumen, Himmelsgradient, Sonne, weichen Schatten, Nebel am Horizont, AO in Mulden; WASD + Maus fliegen; F3 ≥ 60 fps bei Sichtweite 8 auf dem Rechner des Users
- [ ] Screenshot im Chat gezeigt, Perf-Bericht in `docs/LOG.md` eingetragen, Freigabe des Users

## Phase 1 – Lebendige Welt

- [ ] Alle Oberflächen-Biome + Wurzelhöhlen/Kristallschlund/Glutkluft, Erze, Strukturen (Verlorene Laternen, Ruinen), Biom-Karte 4096² zeigt alle Biome
- [ ] Farbiges Blocklicht sichtbar (Laternen 4 Farben, Kristalle), Wasser mit Tiefe/Schaum, Tag/Nacht-Zyklus mit Wolkenschatten, Partikel, Post (Bloom/SMAA), Fernland-LOD, 4 Qualitätsstufen, Floating Origin
- [ ] Spielerphysik 1./3. Person, 10-min-Lauf ohne Durchfallen
- [ ] 8 Golden-Screenshots Δ ≤ 2 %, Budgets bei Mittel, 1000 Spalten ohne Leak

## Phase 2 – Hand anlegen

- [ ] Abbauen/Setzen, Hotbar/Inventar, Drops, inkrementelles Licht (Dunkel-BFS getestet), Blockphysik/Wasser, Baumodus, Baupläne, Solo-Persistenz (IndexedDB)
- [ ] Round-Trip 10 000 Aktionen Client↔Lokalserver ohne Desync, Reload → identisch

## Phase 3 – Erste Stunde

- [ ] Crafting (7 Stufen, ~90 Rezepte, Erreichbarkeits-Test), Survival-Werte, Zyklus, Schattenbrut + friedliche Kreaturen, Lichtbrand, Der Gräber, Glimm-Onboarding, HUD, SFX
- [ ] 20-min-Autoplay-Bot ohne Fehler, Checkliste erste Stunde

## Phase 4 – Gemeinsam

- [ ] Node-Gateway, Instanz-Worker, WebSocket-Transport, Prediction/Interpolation, Interest-Tiers, SQLite, Lagerfeuer-Codes, Chat + Filter, Deploy
- [ ] 16 Bots 30 min: Tick p95 ≤ 10 ms, ≤ 15 KB/s/Spieler, 0 Desyncs; Cheat-Tests abgelehnt; öffentliche URL

## Phasen 5–9

Siehe Masterplan (Laternenhafen & Soziales, Werkstatt & Scherben, Tiefe & Bosse, Politur, Launch) – die Checklisten werden zu Beginn der jeweiligen Phase hier ausgearbeitet.
