# nouri

Deutschsprachige, responsive Web-App zum bewussten Erfassen von Ernährung. Die Oberfläche verwendet Weiß, Schwarz und transparente Glasflächen; Lebensmittelbilder behalten ihre natürlichen Farben. Eine schwebende Navigation verbindet Tagesübersicht, Kamera und Verlauf.

## Funktionen

- Deutlich gekennzeichneter Beispieltag; eigene Daten starten leer.
- Kalorien, Protein, Kohlenhydrate, Fett, Ballaststoffe und Zucker.
- Mahlzeiten erfassen, bearbeiten, löschen und Portionen proportional skalieren.
- Persönliche Tagesziele, Wasserprotokoll, Datumsauswahl und Wochenverlauf.
- Lokale Speicherung im Browser sowie JSON-Export und validierter Import.
- Foto-Upload, Drag-and-drop und Kamera mit Rückkamera-Auswahl.
- Serverseitige KI-Bildanalyse über die OpenAI Responses API, mit überprüfbarem Ergebnis vor Übernahme.

## KI aktivieren

Ein geschütztes `OPENAI_API_KEY` muss in der Server-Laufzeit eingerichtet werden. Es darf niemals im Frontend stehen. Bei Sites den OpenAI-Developers-Skill für die sichere Schlüsselbereitstellung verwenden und den Schlüssel als Laufzeitgeheimnis konfigurieren. Danach erneut veröffentlichen. Optional: `OPENAI_MODEL` (Standard `gpt-4.1-mini`).

Ohne Schlüssel meldet die App transparent, dass die KI noch nicht aktiviert ist. Es gibt keine vorgetäuschten Analyseergebnisse. Manuelle Erfassung funktioniert unabhängig davon.

Die KI erhält nur das ausgewählte, im Browser verkleinerte Foto und optionale Hinweise. `store: false` wird an die API übergeben. Schätzungen sind keine exakten Messungen. Speisebestandteile und Portionsgrößen müssen geprüft werden.

## Entwicklung

Node.js 22+. `esbuild` ist eine reine Entwicklungsabhängigkeit für den modularen Worker-Build; es gibt keine neuen Framework-Abhängigkeiten im Browser.

```sh
npm ci
npm run build
npm test
```

`web/` enthält die Oberfläche; `server/api.mjs` den API-Handler. Der Build bettet alle Webdateien einschließlich Bilder in einen Cloudflare-Worker unter `dist/server/index.js` ein. `.openai/hosting.json` enthält die bestehende Site-ID. Buildausgabe und Manifest werden gemeinsam veröffentlicht.

## Daten

Tagebuchdaten bleiben pro angemeldetem Benutzer im `localStorage` des jeweiligen Browsers. Der bisherige Tagebuchschlüssel wird einmalig migriert. Kein Geräteabgleich. Kleine KI-Fotovorschauen werden lokal mit dem Eintrag gespeichert. Ein Export sollte regelmäßig als Sicherung erstellt werden. Private Sites verwenden den vorgelagerten Sites-Zugriffsschutz.

## Validierung

API-Tests prüfen unter anderem fehlende Schlüssel, Inputvalidierung, Herkunftsprüfung, nicht erkannte Lebensmittel, Providerfehler und die Struktur des KI-Ergebnisses. Artefakttests rufen den gebauten Worker direkt auf, prüfen alle lokalen Assets, Seitenstruktur und Sicherheitseinstellungen. Browser- und reale Kameratests müssen in einer Umgebung mit verfügbarer Browsersteuerung erfolgen.

## Bilder

Mahlzeitenbilder von Unsplash. Sie dienen ausschließlich als Beispiele und Illustration.

## Vier integrierte Ernährungsfunktionen

- **Mahlzeitenscanner mit Unsicherheit:** Zutaten, Zubereitung und Mengen getrennt bestätigen; Öl, Saucen und Extras explizit prüfen. Nährwerte werden aus zugeordneten Quellen neu berechnet, nicht aus Modell-Arithmetik übernommen. Freiwillige Korrekturen sind wiederverwendbar und löschbar.
- **Kühlschrank & Vorrat:** Foto oder Kamera, bearbeitbare Zutaten, bestätigter persönlicher Vorrat und passende Rezeptvorschläge mit fehlenden Zutaten und Portionswerten.
- **Produktscanner:** Barcode-Kamera bei Browserunterstützung, EAN-Eingabe, Open Food Facts, Portionsrechnung und vergleichbare Alternativen. Unbekannte Produkte können anhand der Verpackung manuell erfasst werden. Fehlende Daten sind keine Nullen, und es werden keine Preise erfunden.
- **Adaptiver Bedarf:** Profil, Gewichte und ausdrücklich vollständig erfasste Tage; robuste Trendberechnung, kleine begrenzte Kalorienvorschläge und optionale Makroorientierung. Ziele ändern sich ausschließlich nach Zustimmung. Manuelle Makroziele bleiben erhalten.

Zugang über die bestehenden Scan-, Einstellungen- und Fortschrittsansichten. Gestaltung und Hauptnavigation sind unverändert.

**Dokumentation:** [Integration, Sicherheit und Konfiguration](docs/nutrition-integration.md), [Nährwertquellen und Lizenzen](docs/nutrition-sources.md).

**Grenzen:** Der eingebettete generische Katalog umfasst vier tatsächlich verifizierte USDA-Datensätze und drei einfache Rezeptkombinationen. Für weitere Lebensmittel sind ausdrücklich ausgewählte Verpackungsdaten beziehungsweise Open-Food-Facts-Produkte notwendig. Eine Zuordnung zu generischen Rezeptzutaten wird nicht stillschweigend vorgenommen. Fotoscans benötigen weiterhin `OPENAI_API_KEY`. Ohne native Barcode-Erkennung bleibt die manuelle EAN-Eingabe verfügbar. Browser-/Kameratests und eine echte KI-Anfrage sind ohne verfügbare Browsersteuerung beziehungsweise API-Zugang nicht verifiziert.
