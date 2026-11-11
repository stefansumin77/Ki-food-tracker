# Design

Nouri nutzt das Glas-Design „A2 · Schwarzes Glas“:

- Kräftig grauer, glasiger Hintergrund ohne Milchschleier, mit feinen scharfen Spiegelkanten
- Hintergrund „Laufbahn“: vier Stadion-Bahnen, die sich im Lauf des Tages füllen – außen Kalorien (Limette), dann Protein (Blau), Kohlenhydrate (Orange), Fett (Koralle). 100 % = Tagesziel erreicht, dann leuchtet die Bahn. Darüber läuft auf jeder Bahn eine Lichtspur.
- Alle Flächen (Karten, Navigation, Dialoge) aus schwarzem Glas mit Lichtkante und Spiegelung
- Im Tagebuch sind die Flächen transparenter, damit die Laufbahn durchscheint
- Icons und Hauptaktionen (Erfassen, aktiver Tab, Einstellungen) in weißem Glas
- Farbakzente: Kalorienring Limette → Himmelblau, Makros Blau / Orange / Koralle
- Schrift: Plus Jakarta Sans (lokal ausgeliefert), Zahlen und Überschriften kräftig (800) und eng gesetzt
- Kacheln wie im Laufbahn-Entwurf: große Karten 28 px Rundung, kleine 20 px, helle Lichtkante oben, tiefer Schatten
- Animationen beim Öffnen; bei „Bewegung reduzieren“ und „Transparenz reduzieren“ automatisch aus bzw. ohne Glas

Umgesetzt in `web/theme.css` (wird nach `web/style.css` geladen). Aufbau und Funktionen der App sind unverändert.

## Dateien

- `Glas.dc.html` – der gewählte Entwurf (A2)
- `Laufbahn.dc.html`, `Puls.dc.html`, `Formen.dc.html` – alternative Hintergrund-Ideen
- `Main.dc.html` (A · Frisch), `Kraft.dc.html` (B), `Sanft.dc.html` (C) – frühere Richtungen
- `canvas.json` – Anordnung der Entwürfe
- `app-screens-schrift.png` – aktueller Stand: Startseite, Tagebuch, Einstellungen mit neuer Schrift
- `app-screens-laufbahn-fuellstand.png` – Beispieltag (Bahnen knapp halb gefüllt) und leerer Tag
- `app-screens-laufbahn.png` – Startseite und Tagebuch mit Laufbahn
- `app-screens-1.png`, `app-screens-2.png` – frühere Bildschirmfotos (noch mit Farbbändern)

Die `.dc.html`-Dateien sind Entwürfe aus dem Claude-Design-Canvas und nicht Teil der App.
