# Roadmap: Nouri als Freemium-App

Stand: 11.11.2026. Kostenpflichtige Dienste werden nur nach ausdrücklicher Zustimmung aktiviert (mit ⛔ markiert).

## Getroffene Entscheidungen

| Thema | Entscheidung |
|---|---|
| Hosting | Cloudflare Workers, Daten in Cloudflare D1 |
| KI-Modell | OpenAI GPT-4.1 mini (vorerst), Schlüssel nur als Server-Secret |
| Anmeldung | Magic Link per E-Mail (später zusätzlich Passkeys) |
| Bezahlung | Stripe-Abo, 5,99 € pro Monat, 3 Tage Testphase |
| Tageswechsel für Kontingente | Mitternacht Europe/Berlin |
| Design | Schwarzes Glas auf dunkelgrauem Hintergrund mit Farbbändern (siehe docs/design) |

## Funktionen: Free und Premium

| Funktion | Free | Premium |
|---|---|---|
| Manuell eintragen, Barcode/Produktsuche | ja | ja |
| Tagebuch, Übersicht, Ziele, Wasser, Wochenverlauf | ja | ja |
| Daten exportieren, Konto löschen | ja | ja |
| KI-Fotoscan Mahlzeit | nein | 30 pro Tag (gemeinsam mit Kühlschrank-Scans) |
| KI-Kühlschrank-Scan, Vorrat, Rezepte | nein | ja |
| Energiebedarf und Gewicht | nein | ja |

- KI-Endpunkte prüfen Plan und Kontingent auf dem Server. Free-Anfragen werden abgelehnt (402).
- Rezepte und Energiebedarf werden vorerst nur in der Oberfläche gesperrt (bewusste Entscheidung: einfacher Schutz, technisch umgehbar, da die Berechnung im Browser läuft).
- Kontingent: atomare Reservierung in D1 vor dem OpenAI-Aufruf, Rückbuchung bei Fehlern des Anbieters.

## Stufen

| Stufe | Inhalt | Status |
|---|---|---|
| 0 Fundament | Cloudflare-Konfiguration, Build ohne Sites, sichere Standard-Anmeldung, lokale Entwicklung, Schrift selbst gehostet, Tests in GitHub Actions | erledigt |
| 1 Konten | Magic Link, Sitzungen in D1, Abmelden, Konto löschen | erledigt (E-Mail-Versand lokal nur in der Konsole) |
| 2 Daten auf dem Server | Abgleich von Tagebuch und Feature-Daten, Übernahme der Browserdaten | offen |
| 3 Pläne und Kontingente | Free/Premium-Prüfung, 30 Scans pro Tag, Anzeige der Rest-Scans, Premium-Sperren in der Oberfläche | offen |
| 4 Stripe (Testmodus) | Checkout, Kundenportal, Webhook mit Signaturprüfung und Idempotenz, Testphase, Kündigungsbutton | offen |
| 5 Recht und Datenschutz | Einwilligung Gesundheitsdaten, Datenschutzerklärung, Impressum, AGB, Widerruf (rechtlich prüfen lassen) | offen |
| ⛔ 6 Staging | Cloudflare-Konto, D1, Secrets, OpenAI-Schlüssel mit Limit, Kosten pro Scan messen | wartet auf Zustimmung |
| ⛔ 7 Livegang | Stripe Livemodus, Domain, E-Mail-Dienst, Monitoring, Backups | wartet auf Zustimmung |
| 8 Danach | Größerer Nährwertkatalog, Daten in eigene Tabellen | offen |
