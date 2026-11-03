# ADR 0001 – Isomorpher Sim-Kern ab Tag 1

**Status:** angenommen (2026-11-03)

## Kontext

Das Spiel braucht Solo (sofort, offline-fähig) und Multiplayer (serverautoritativ, fair). Zwei getrennte Codepfade („Solo-Welt im Main-Thread" und „Server-Welt") führen bei allen Vorbildern zu Divergenz, Dupes und teurem Nachrüsten.

## Entscheidung

Der Instanz-Kern (`packages/sim`) läuft **immer** als eigene Simulation hinter einem `Transport`:

- Solo: `LocalInstance` im `localsim.worker`, Transport = MessagePort (Loopback).
- Online: dieselbe Klasse im Node-`worker_threads`, Transport = WebSocket.

Der Client ist in beiden Fällen nur Darstellung + Vorhersage. Weltgen, Licht, Physik und Regeln liegen in `packages/core`/`sim` ohne DOM/Node-Abhängigkeiten und laufen bitgleich in Web Workers und Node.

## Konsequenzen

- Solo-Welten werden ohne Umbau zu Lagerfeuern (Upload der Spalten).
- Jede spätere Spielmechanik muss über Nachrichten gehen – kein „schneller Hack" im Client.
- Seed-Streaming: unveränderte Chunks werden nie übertragen; der Client erzeugt sie selbst.
