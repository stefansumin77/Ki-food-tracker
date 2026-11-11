# Nouri

Privates Ernährungstagebuch mit KI-Fotoanalyse. Läuft als Cloudflare Worker und wird zur Freemium-App ausgebaut (Free und Premium, siehe [docs/roadmap.md](docs/roadmap.md)).

## Voraussetzungen

- Node.js 22 oder neuer
- Für das spätere Deployment ein Cloudflare-Konto (noch nicht nötig)

## Einrichten und testen

```sh
npm ci
npm run build
npm test
```

## Lokal starten

```sh
cp .dev.vars.example .dev.vars
npm run dev
```

Die App läuft dann unter http://localhost:8787 mit einem lokalen Testbenutzer (`AUTH_MODE=local-dev`). Diese Testanmeldung funktioniert nur auf localhost, nie auf einer echten Domain. Ohne `OPENAI_API_KEY` in `.dev.vars` ist die Fotoanalyse aus; manuelle Eingabe und Barcode funktionieren trotzdem.

## Anmeldung (`AUTH_MODE`)

Wer angemeldet ist, entscheidet ausschließlich der Server:

| Wert | Bedeutung |
|---|---|
| `local-dev` | Fester Testbenutzer, nur für Anfragen an localhost |
| `sites` | Nur hinter ChatGPT Sites, das den Header `oai-authenticated-user-id` sicher setzt |
| alles andere / leer | Niemand ist angemeldet, persönliche Funktionen antworten mit 401 |

Die eigene Anmeldung per E-Mail-Link (Magic Link) kommt in Stufe 1.

## Geheimnisse

API-Schlüssel gehören nie in den Code, in `wrangler.toml` oder in den Browser. Lokal in `.dev.vars` (wird nicht eingecheckt), produktiv mit `wrangler secret put OPENAI_API_KEY`.

## Aufbau

- `web/` – Frontend (HTML, CSS, JavaScript, Bilder, Schrift)
- `server/` – Worker: API, Sicherheit, Fotoerkennung, Produktsuche
- `tests/`, `server/*.test.mjs` – automatische Tests (laufen auch in GitHub Actions)
- `docs/` – Roadmap, Datenquellen, Hinweise aus dem ursprünglichen Export

Die Schrift DM Sans liegt unter `web/assets/fonts/` (SIL Open Font License 1.1).
