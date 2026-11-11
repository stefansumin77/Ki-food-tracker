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

Die App läuft dann unter http://localhost:8787. Die lokale Datenbank wird automatisch angelegt (`wrangler d1 migrations apply nouri --local`). Zum Anmelden in der App „Eigenes Tagebuch starten“ oder Einstellungen → „Anmelden“ wählen und eine beliebige E-Mail-Adresse eingeben. Der Anmeldelink erscheint lokal im Terminal statt in einer E-Mail.

Ohne `OPENAI_API_KEY` in `.dev.vars` ist die Fotoanalyse aus; manuelle Eingabe und Barcode funktionieren trotzdem.

## Anmeldung (`AUTH_MODE`)

Wer angemeldet ist, entscheidet ausschließlich der Server:

| Wert | Bedeutung |
|---|---|
| `magic-link` | Anmeldung per E-Mail-Link, Sitzung als Cookie, Konten in D1 (Standard) |
| `local-dev` | Fester Testbenutzer, nur für Anfragen an localhost |
| `sites` | Nur hinter ChatGPT Sites, das den Header `oai-authenticated-user-id` sicher setzt |
| alles andere / leer | Niemand ist angemeldet, persönliche Funktionen antworten mit 401 |

So funktioniert der Magic Link:

1. `POST /api/auth/request` erzeugt einen Einmal-Link (15 Minuten gültig). In der Datenbank liegt nur der SHA-256-Hash. Die Antwort verrät nicht, ob ein Konto existiert. Pro Minute sind 5 Anfragen je IP und je Adresse erlaubt.
2. `GET /anmelden?token=…` zeigt nur einen „Anmelden“-Knopf. Das Öffnen allein verbraucht den Link nicht, damit E-Mail-Scanner ihn nicht entwerten.
3. `POST /api/auth/verify` verbraucht den Link atomar und setzt das Cookie `__Host-nouri_session` (HttpOnly, Secure, SameSite=Lax, 30 Tage).
4. `POST /api/auth/logout` beendet die Sitzung, `POST /api/account/delete` mit `{"confirm": true}` löscht Konto, Sitzungen und Links.

Links zeigen immer auf `APP_ORIGIN`. Ohne `APP_ORIGIN` und ohne E-Mail-Anbieter ist die Anmeldung auf echten Domains automatisch aus (Anbieter folgt in Stufe 7).

## Geheimnisse

API-Schlüssel gehören nie in den Code, in `wrangler.toml` oder in den Browser. Lokal in `.dev.vars` (wird nicht eingecheckt), produktiv mit `wrangler secret put OPENAI_API_KEY`.

## Aufbau

- `web/` – Frontend (HTML, CSS, JavaScript, Bilder, Schrift)
- `server/` – Worker: API, Anmeldung, Sicherheit, Fotoerkennung, Produktsuche
- `migrations/` – Datenbankschema für Cloudflare D1
- `tests/`, `server/*.test.mjs` – automatische Tests (laufen auch in GitHub Actions)
- `docs/` – Roadmap, Datenquellen, Hinweise aus dem ursprünglichen Export

Die Schrift DM Sans liegt unter `web/assets/fonts/` (SIL Open Font License 1.1).
