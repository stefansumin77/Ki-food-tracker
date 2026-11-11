# KI Food Tracker

Ein einfacher Kalorien- und Nährwert-Tracker als Web-App. Du fotografierst deine Mahlzeit oder beschreibst sie, und Claude schätzt Kalorien, Eiweiß, Kohlenhydrate und Fett.

## Funktionen

- Mahlzeit per Foto und/oder Text erfassen, Nährwerte werden von der KI geschätzt
- Ergebnis vor dem Speichern prüfen und anpassen
- Tagebuch mit Tagessumme, Tagesziel und Makros, Blättern zwischen Tagen
- Export und Import der Daten als JSON

## Nutzung

1. GitHub Pages einschalten: **Settings → Pages → Branch `main`, Ordner `/ (root)`**.
2. Die Seite öffnen: `https://stefansumin77.github.io/Ki-food-tracker/`
3. Unter **Einstellungen** einen Claude API-Schlüssel eintragen (von console.anthropic.com).

## Datenschutz

- Einträge und API-Schlüssel liegen nur im Browser des jeweiligen Geräts (localStorage).
- Fotos und Beschreibungen werden zur Analyse direkt an die Claude-API von Anthropic gesendet.
- Der API-Schlüssel steht im Browser. Nutze die App deshalb nur selbst und setze in der Anthropic-Console ein Ausgabenlimit.

Die Werte sind Schätzungen und ersetzen keine Ernährungsberatung.
