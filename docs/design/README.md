# Design

Nouri nutzt das Glas-Design „A2 · Schwarzes Glas“:

- Dunkelgrauer, glasiger Hintergrund mit langsam schwebenden Farbbändern, feinen Wellenlinien und Lichtpunkten
- Alle Flächen (Karten, Navigation, Dialoge) aus schwarzem Glas mit Lichtkante und Spiegelung
- Icons und Hauptaktionen (Erfassen, aktiver Tab, Einstellungen) in weißem Glas
- Farbakzente: Kalorienring Limette → Himmelblau, Makros Blau / Orange / Koralle
- Animationen beim Öffnen; bei „Bewegung reduzieren“ und „Transparenz reduzieren“ automatisch aus bzw. ohne Glas

Umgesetzt in `web/theme.css` (wird nach `web/style.css` geladen). Aufbau und Funktionen der App sind unverändert.

## Dateien

- `Glas.dc.html` – der gewählte Entwurf (A2)
- `Laufbahn.dc.html`, `Puls.dc.html`, `Formen.dc.html` – alternative Hintergrund-Ideen
- `Main.dc.html` (A · Frisch), `Kraft.dc.html` (B), `Sanft.dc.html` (C) – frühere Richtungen
- `canvas.json` – Anordnung der Entwürfe
- `app-screens-1.png`, `app-screens-2.png` – Bildschirmfotos der echten App mit dem neuen Design

Die `.dc.html`-Dateien sind Entwürfe aus dem Claude-Design-Canvas und nicht Teil der App.
