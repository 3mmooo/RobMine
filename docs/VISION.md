# Vision – RobMine / „Lumenfall"

## In einem Satz

Eine unendliche, weich beleuchtete Voxelwelt im Browser, in der **Licht das Gameplay ist**: Die Sonne der Dämmerlande verglimmt, aus der Dunkelheit kriecht die Schattenbrut, und jede Laterne, die du setzt, erobert dauerhaft Gebiet zurück – während du im Laternenhafen Freunde triffst und in der Werkstatt eigene Minispiele („Scherben") ohne Programmieren baust.

## Welt-Logik

Die Dämmerlande sind aus Licht gewachsen, das zu Würfeln erstarrt ist. Beim **Lichtbruch** zersprang der Mond zu Scherben (sichtbar am Himmel), die **Große Laterne** (die Sonne) begann zu verglimmen. Wo Licht fehlt, zerfällt die Welt: Aus **Nachtrissen** kriecht die **Schattenbrut**, die im Licht verbrennt. Wanderer (Spieler) können Würfel lösen und neu setzen, weil erstarrtes Licht formbar ist – **Bauen ist Heilen.**

## Leitprinzipien

1. **Licht ist Gameplay.** Jede Lichtquelle hat Farbe, Radius und Wirkung; die Bedrohung ist Dunkelheit, nicht die Uhrzeit.
2. **Nie nerven, immer locken.** Keine Strafe ohne Ausweg: kein Hungertod, kein Werkzeugbruch, kein Itemverlust ohne Rückweg.
3. **Ein Look für alles.** Hauptspiel, Hub, Avatare und Scherben teilen Blöcke, Shader und Teile-System.
4. **Der Server hat immer recht.** Der Client sendet nur Eingaben – auch in Spieler-Minispielen.
5. **Sicher by design.** Sicherer Chat für Kinder, keine Fremd-DMs, kein Echtgeld, keine Lootboxen, nur positive Bewertungen.
6. **Link → Spiel in 5 Sekunden.** Kein Download, kein Konto-Zwang.

## Namens-Bibel (verbindlich – siehe `packages/content/src/names.ts`)

| Begriff            | Bedeutung                                            |
| ------------------ | ---------------------------------------------------- |
| Dämmerlande        | die Survival-Welt                                    |
| Große Laterne      | die Sonne (wird mit Urfunken heller)                 |
| Wanderer           | Spieler/Avatar                                       |
| Glimm              | Lichtwesen-Begleiter (Hilfe, Hinweise, Aufträge)     |
| Schattenbrut       | Huscher, Brocker, Flüsterer, Nachtgeier              |
| Urfunke            | Boss-Belohnung, macht die Sonne heller               |
| Verlorene Laternen | Kartenpunkte: Respawn, Schnellreise, Karte aufdecken |
| Nachtrisse         | Dunkelzonen (Ascheland), mit Licht zu schließen      |
| Finsternis         | jede 7. Nacht, Wellen-Event                          |
| Funken             | Ingame-Währung (nur verdienbar)                      |
| Laternenhafen      | der Hub                                              |
| Lagerfeuer         | private Mehrspieler-Welt per Code                    |
| Scherbe            | ein Spieler-Minispiel                                |
| Werkstatt          | der Creator-Modus                                    |
| Elternschlüssel    | zweites Passwort für Eltern-Einstellungen            |
| Wächter-Panel      | Moderations-Admin                                    |

Materialstufen: Hain → Feldstein → Ambrit → Graustahl → Glutkern → Frostglas → Sternenglas. Werkzeuge brechen nie.

## Biome (Weltgen v1)

Hainland (Start), Flüsterwald, Blütental, Glasdünen, Nebelmoor, Frostkamm, Himmelsgrat, Sternenmeer + Perlküste, Aschenfeld, Wurzelhöhlen (y 40–64), Kristallschlund (y 16–48), Glutkluft (y 1–16), Schwebeinseln (y 190–250), Ascheland (dynamisch um Nachtrisse). Phase 0 generiert Hainland, Perlküste und Sternenmeer.

## Bosse & Urfunken (v1.0 = die ersten vier)

Der Gräber (Hainland) → Funke der Erde · Wurzelmutter (Flüsterwald) → Funke des Wachstums · Sandschlund (Glasdünen) → Funke des Sturms (Gleiter) · Frostwache (Frostkamm) → Funke der Stille. Später: Tiefenauge, Himmelswächter, Der Finsterkern.

## Plattform in Kürze

Laternenhafen (Hub, 32 Spieler) · Raumtypen Solo / Lagerfeuer (8, Code) / Scherbe (16) · Gastkonto sofort, Konto ohne E-Mail (Wiederherstellungscode) · unter 13: Sicherer Chat, Elternschlüssel · Karawane bis 8 · Funken-Ökonomie ohne Echtgeld · Discovery mit „Frisch"-Garantie und nur Lob.

## Werkstatt in Kürze

16 Funktionsblöcke + Regelkarten (WENN / UND / DANN) als Daten, serverseitig ausgeführt; Vorlagen Hüpfpfad, Arena, Fabrikinsel, Verstecken, Lichtrennen, Freibau; Veröffentlichen mit automatischer Prüfung und Versionen; später Funkenskript (QuickJS-Sandbox).
