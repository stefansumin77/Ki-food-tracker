# Design

Nouri nutzt das Glas-Design „A2 · Schwarzes Glas“:

- Ganz neutrales Schwarzgrau (ohne Farbstich) mit leichtem Lichtschein von oben, ohne Spiegeleffekte
- Hintergrund „Laufbahn“: vier Stadion-Bahnen, die sich im Lauf des Tages füllen – außen Kalorien (Limette), dann Protein (Blau), Kohlenhydrate (Orange), Fett (Koralle). 100 % = Tagesziel erreicht, dann leuchtet die Bahn. Darüber läuft auf jeder Bahn eine Lichtspur. Alles bewusst verblasst, damit es im Hintergrund bleibt.
- Navigation und Dialoge aus schwarzem Glas, ohne Glanz oder Spiegelung
- Kacheln auf Startseite und im Tagebuch dunkel und leicht durchsichtig (70 % Schwarz mit Weichzeichner), die Laufbahn scheint durch
- Icons und Hauptaktionen (Erfassen, aktiver Tab, Einstellungen) in weißem Glas
- Farbakzente: Kalorienring Limette → Himmelblau, Makros Blau / Orange / Koralle
- Laufbahn-Fokus: Ein Tipp auf eine Makro-Kachel oder den Kalorienring holt die Bahnen nach vorne. Die Inhalte treten zurück, die ganze Runde erscheint verkleinert, die gewählte Bahn leuchtet, das fehlende Stück ist gepunktet. Eine kompakte Karte mit runden Ecken zeigt „noch X g“, „gegessen von Ziel · %“ und alle vier Ziele (2 × 2) zum Umschalten. Schließen mit „Fertig“, Escape oder Tipp daneben.
- Tagebuch nach Mahlzeiten gegliedert: Frühstück, Mittagessen, Abendessen, Snack – je mit Kalorien-Summe und Plus-Knopf, der das Formular mit der passenden Kategorie öffnet
- Schrift: Plus Jakarta Sans (lokal ausgeliefert), Zahlen und Überschriften kräftig (800) und eng gesetzt
- Kacheln: große Karten 28 px Rundung, kleine 20 px, feiner heller Rand, tiefer Schatten
- Animationen beim Öffnen; bei „Bewegung reduzieren“ und „Transparenz reduzieren“ automatisch aus bzw. ohne Glas

Umgesetzt in `web/theme.css` (wird nach `web/style.css` geladen). Aufbau und Funktionen der App sind unverändert.

## Dateien

- `rundgang-1.png`, `rundgang-2.png`, `rundgang-3.png` – Rundgang durch alle Bildschirme der App (aktueller Stand)

- `Glas.dc.html` – der gewählte Entwurf (A2)
- `Laufbahn.dc.html`, `Puls.dc.html`, `Formen.dc.html` – alternative Hintergrund-Ideen
- `Main.dc.html` (A · Frisch), `Kraft.dc.html` (B), `Sanft.dc.html` (C) – frühere Richtungen
- `canvas.json` – Anordnung der Entwürfe
- `app-screens-laufbahn-fokus.png` – Startseite, Laufbahn-Fokus für Protein und für Kalorien
- `app-screens-mahlzeiten.png` – Startseite, Tagebuch nach Mahlzeiten, leerer Tag
- `app-screens-transparent.png` – durchsichtige Kacheln, ohne Spiegeleffekte
- `app-screens-schrift.png` – Startseite, Tagebuch, Einstellungen mit neuer Schrift
- `app-screens-laufbahn-fuellstand.png` – Beispieltag (Bahnen knapp halb gefüllt) und leerer Tag
- `app-screens-laufbahn.png` – Startseite und Tagebuch mit Laufbahn
- `app-screens-1.png`, `app-screens-2.png` – frühere Bildschirmfotos (noch mit Farbbändern)

Die `.dc.html`-Dateien sind Entwürfe aus dem Claude-Design-Canvas und nicht Teil der App.
