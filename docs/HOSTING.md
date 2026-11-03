# Mehrspieler hosten

Der Spielserver liefert das Spiel **und** die Mehrspieler-Verbindung unter einer Adresse aus. Wer den Link öffnet, landet automatisch in derselben Welt.

## Lokal ausprobieren (gleiches WLAN)

```bash
pnpm install
```

```bash
pnpm build
```

```bash
STATIC_DIR=apps/client/dist pnpm server
```

Dann `http://<IP-deines-Rechners>:8080` im Browser öffnen – Freunde im selben WLAN nehmen dieselbe Adresse.

## Online (ca. 5 € im Monat)

1. Einen kleinen Linux-Server mieten (z. B. Hetzner Cloud CX22/CAX11 oder vergleichbar, 2 vCPU / 4 GB reichen für 16 Spieler).
2. Docker installieren und dieses Repository auf den Server holen.
3. Bauen und starten:

```bash
docker build -t robmine .
```

```bash
docker run -d --restart unless-stopped --name robmine -p 8080:8080 -v robmine-data:/data robmine
```

4. Für HTTPS (nötig, damit der Link überall funktioniert) eine Domain auf den Server zeigen lassen und [Caddy](https://caddyserver.com) davor setzen – die `Caddyfile` ist zwei Zeilen:

```
spiel.deine-domain.de {
  reverse_proxy 127.0.0.1:8080
}
```

Danach ist das Spiel unter `https://spiel.deine-domain.de` erreichbar.

## Einstellungen (Umgebungsvariablen)

| Variable          | Standard | Bedeutung                                                   |
| ----------------- | -------- | ----------------------------------------------------------- |
| `PORT`            | 8080     | HTTP/WebSocket-Port                                         |
| `SEED`            | 42       | Welt-Seed                                                   |
| `DATA_DIR`        | `/data`  | veränderte Spalten (Backups: diesen Ordner sichern)         |
| `MAX_PLAYERS`     | 16       | Spielerlimit                                                |
| `ALLOWED_ORIGINS` | leer     | erlaubte Herkunft der Webseite (kommagetrennt), leer = alle |

Gesundheitscheck: `GET /healthz` → `{ ok, players, tick }`.

## Mit einer anderen Client-Adresse verbinden

Jede Client-Version lässt sich per Parameter auf einen Server lenken: `?server=wss://spiel.deine-domain.de/ws&name=Anna`.
