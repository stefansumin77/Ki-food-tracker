# Nouri – vollständiger Quellcodeexport

Diese ZIP ist eine eigenständige Kopie des bestehenden Projekts. Design, Farben, Typografie, Abstände, Navigation, Assets und implementierte Funktionen wurden für diesen Export nicht verändert. Die ursprüngliche Projektanleitung ist unter `README.original.md` erhalten.

## Voraussetzungen und Installation

- Node.js 22 oder neuer und npm.
- Internetzugang für die Installation; die npm-Abhängigkeiten sind in `package-lock.json` festgeschrieben.
- Zum Ausführen der App eine Cloudflare-Workers-kompatible Laufzeit oder ein eigener HTTP-Adapter. Es handelt sich nicht um einen Express-/Next.js-Server.

ZIP entpacken, im entpackten Projektordner ein Terminal öffnen:

```sh
npm ci
npm run build
npm test
```

`npm ci` installiert `esbuild` als Entwicklungsabhängigkeit. Im Browser ist kein zusätzliches JavaScript-Framework erforderlich. Der Build erzeugt `dist/server/index.js` und `dist/.openai/hosting.json`. Eine bereits gebaute Version ist enthalten. Für den Test der Quellcodekopie muss der Build vorher vorhanden sein.

Wichtig: `npm start` und `npm run dev` sind im Originalprojekt nicht definiert. `node dist/server/index.js` startet keinen Webserver: Das Modul exportiert einen Worker mit `fetch(request, env, ctx)`.

## Laufzeit und lokale Vorschau

Für eine optionale Workers-Vorschau kann Cloudflare Wrangler separat installiert/verwendet werden:

```sh
npx wrangler@4 dev dist/server/index.js --port 8787
```

Dieser zusätzliche Vorschau-CLI ist keine Abhängigkeit des Originalprojekts. Kamera und Barcodefunktionen brauchen HTTPS oder einen dafür zugelassenen localhost-Kontext. Ohne den nachfolgend beschriebenen Ersatz der Sites-Anmeldung sind persönliche APIs auch in der lokalen Vorschau gesperrt und persönliche Browserdaten werden nicht gespeichert. Eine Vorschau ohne Anmeldung ist kein vollständig eingerichteter eigenständiger Betrieb.

## API-Schlüssel und Umgebungsvariablen

`.env.example` enthält ausschließlich Variablennamen und Platzhalter, keine echten Zugangsdaten. Beispiel:

```dotenv
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4.1-mini
OFF_CONTACT_EMAIL=
```

- `OPENAI_API_KEY`: erforderlich für echte Mahlzeiten- und Kühlschrank-Fotoerkennung. Nur serverseitig als Secret konfigurieren.
- `OPENAI_MODEL`: optionales Modell für Bild- und strukturierte Erkennung.
- `OFF_CONTACT_EMAIL`: optionaler Anwendungskontakt für Open Food Facts.
- `NUTRITION_RATE_LIMITER`: optionales Cloudflare-Binding mit `limit({key})`, kein String in einer `.env`-Datei. Ohne Binding gelten nur prozess-/isolate-lokale Limits.

Die vorhandenen Skripte lesen `.env` **nicht automatisch** ein. Die gewählte Worker-Laufzeit beziehungsweise der eigene Adapter muss Werte in das `env`-Argument des Workers übergeben. Für Wrangler werden lokale Werte üblicherweise in `.dev.vars` und produktive Werte mit Wrangler-Secrets konfiguriert. Echte Schlüssel und `.dev.vars` niemals veröffentlichen. Ein ChatGPT-Abonnement stellt keinen OpenAI-API-Schlüssel für die exportierte App bereit.

## Was von ChatGPT Sites abhängt

### Anmeldung und Autorisierung

Sites schützt die bestehende App und setzt serverseitig `oai-authenticated-user-id`. Der Worker übernimmt diese bestätigte Identität und erzeugt daraus ein `nouri-user-id`-Meta-Element im HTML. Browserdaten werden nach dieser ID getrennt; persönliche APIs prüfen diese ID.

**Außerhalb von Sites muss eine eigene geprüfte Anmeldung oder ein vertrauenswürdiger vorgeschalteter Gateway integriert werden.** Dieser muss vom Client gelieferte Identitätsheader entfernen und erst nach erfolgreicher Sessionprüfung eine stabile Benutzer-ID setzen. Den Header einfach im Browser zu setzen oder aus einem ungeschützten Client-Header zu übernehmen wäre unsicher. Ohne bestätigte Identität liefern persönliche APIs `401`, und die App lädt/speichert keine persönlichen Browserdaten.

Relevante Stellen: `server/security.mjs`, `server/worker.mjs`, `web/app.js`.

### Hosting und Veröffentlichung

`.openai/hosting.json` und die enthaltene Projekt-ID gehören zum bestehenden Sites-Projekt. Sie sind als ursprüngliche Konfiguration enthalten; sie übertragen weder Eigentum noch Berechtigungen oder Hosting. **Für einen Export außerhalb von Sites nicht das bestehende Projekt mit dem Publishing-Helfer überschreiben.** Die externe Bereitstellung benötigt eine eigene Laufzeit-/Hostingkonfiguration. Für ein anderes Sites-Projekt wäre eine eigene Projekt-ID erforderlich.

`scripts/publish-source.mjs` ist der ursprüngliche Sites-Quellübertragungshilfe-Code. Er benötigt separat erteilten Repository-Zugang über versteckte Standardeingabe. Der Export enthält keine solchen Zugangsdaten. Installation, Build und Tests veröffentlichen nichts.

### Worker-spezifische Dienste

`caches.default` wird optional für öffentliche Produktdaten verwendet; ohne Cache-API bleibt ein flüchtiger Cache. Die globale Rate-Limiter-Anbindung ist optional. Ein eigener Node-Adapter muss Request/Response, `env`, gegebenenfalls `ctx.waitUntil`, Caching und globale Rate-Limits passend abbilden. Das Sites-Buildverfahren löst den virtuellen Import `nouri:assets` auf und bettet alle Dateien aus `web/` in den Worker ein.

## Daten, Datenbankschema und Umzug

Es gibt **keine Serverdatenbank**, keine SQL-Tabellen, keine SQL-Migrationen und keine serverseitig gespeicherten Benutzerfotos. Deshalb existiert kein SQL-Datenbankschema, das exportiert werden könnte. Die tatsächlichen Datenmodelle und Validatoren sind enthalten:

- `web/app.js`: Tagebuch, Ziele, Zutaten und Quellenmetadaten.
- `web/feature-store.js`: Vorräte, freiwillige Korrekturen, Profil, Gewichte, bestätigte Tracking-Tage und Zielanpassungen.

Persönliche Daten liegen im `localStorage` des jeweiligen Browsers und sind an dessen Domain sowie die bestätigte Benutzer-ID gebunden. Sie befinden sich nicht im Repository und sind **nicht Teil dieser Quellcode-ZIP**. Für einen Domainwechsel zuerst in der bestehenden App unter Einstellungen **„Daten exportieren“** eine JSON-Sicherung erstellen; nach Einrichtung der externen Anmeldung über **„Sicherung importieren“** wiederherstellen. Ein Serverdatenbank- oder Cross-Device-Abgleich ist nicht enthalten.

## Enthaltene Funktionen und Integrationsgrenzen

- Ernährungstagebuch, Ziele, Kalorien-/Makroübersicht, Wasser, Verlauf und JSON-Sicherung.
- Mahlzeiten- und Kühlschrank-Kamera/Upload mit sicherem serverseitigem OpenAI-Interface; ohne eingerichteten Schlüssel keine simulierte Erkennung.
- Bestätigbare Zutaten, getrennte Erkennungs-/Mengenunsicherheit, Portions- und Zubereitungskorrekturen sowie Fragen zu Öl, Sauce und Extras.
- Persönlicher Vorrat und quellbasierte Rezeptvorschläge; der eingebettete generische Katalog umfasst vier verifizierte USDA-Datensätze und drei einfache Rezeptkombinationen.
- Open Food Facts für verpackte Produkte; unvollständige Werte bleiben unbekannt, Preise/Verfügbarkeit werden nicht erfunden. Die Datenbank ist gemeinschaftlich gepflegt; Verpackung prüfen.
- Barcode-Kamera bei nativer `BarcodeDetector`-Unterstützung, sonst manuelle EAN-Eingabe.
- Deterministischer adaptiver Energiebedarf mit ausreichend bestätigtem Verlauf; keine Zieländerung ohne Zustimmung, manuelle Makroziele bleiben erhalten.

Externe Dienste: OpenAI, Open Food Facts und Google Fonts (DM Sans). Die tatsächlich lokal verwendeten Bilder/SVGs sind vollständig in `web/assets/` enthalten. Die Google-Fonts-Schriftdateien waren nicht lokal gespeichert; die unveränderte CSS-Datei lädt sie extern. Für vollständig offline betriebenes Hosting müssten diese separat unter Beachtung ihrer Lizenz selbst gehostet werden.

## Inhalt der Kopie

`web/`: Frontend und Assets. `server/`: Backend, Sicherheits-/Erkennungs-/Produktdienste und Worker. `scripts/`: Build, Tests und ursprünglicher Quellübertragungshelfer. `tests/`: Tests. `docs/`: Implementierung, Datenquellen, Lizenzhinweise und Konfiguration. `dist/`: vorhandener Build. `package.json` und Lockfile: Abhängigkeiten. `.env.example`: Platzhalter. `.openai/hosting.json`: originale Sites-Konfiguration.

`EXPORT-MANIFEST.json` enthält den ursprünglichen Git-Stand, den Exportzeitpunkt, Dateigrößen und SHA-256-Prüfsummen. Git-Interna, installierte `node_modules`, Cache-Dateien, echte Umgebungsdateien und temporäre Archive sind nicht enthalten.

Die Kopie wurde gegen die verfügbaren Quelldateien geprüft. Im ursprünglichen Stand bestanden 121 automatisierte Tests. Echte Kamera-/Browserprüfung und echte OpenAI-Aufrufe sind dadurch nicht ersetzt; der Export schaltet keine externen Dienste frei.
