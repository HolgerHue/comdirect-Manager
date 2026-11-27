# 02 – Funktionsbeschreibung (Ist-Stand)

> **Adopted project — reconstructed as-built** (27.11.2026) aus `Finance.js` v3.31 und `Kategorien-Editor.js` v3.2.
> Alles hier ist `as-built, unverified`, solange kein Test oder der Nutzer es bestätigt. Tiefe nach Bedarf: ein Bereich wird
> genauer beschrieben, wenn eine Scheibe ihn anfasst (progressive backfill).

## Bereiche (Funktionen)
| ID | Bereich | Was er tut | Schalter |
|---|---|---|---|
| F-01 | Depots | comdirect-Depot und manuelle Depots, Gesamtansicht „Σ Alle Depots“, manuelle Positionen und Zukäufe, Übertragen zwischen Depots; Tranchen werden nie zusammengefasst | – |
| F-02 | comdirect-Abruf | OAuth2-Passwort-Grant + Session-TAN (photoTAN); Positionen, Ø-Kaufkurse, Kontostände, Dividenden; History (Depotumsätze) separat | – |
| F-03 | Kurse und Charts | Yahoo (Portal-Fallback), Mini-Verläufe je Karte, News je Position, ETF-Zusammensetzung | – |
| F-04 | Analyse | Übersicht, Benchmark, Heatmap, Allokation, Top/Flop, Dividenden, Termine, TWR/IRR, Steuern & Kosten | `analysis` |
| F-05 | Durchschau (Overview) | Sektoren, Länder, Überschneidung, Kennzahlen, Einstiegs-Ampel | – |
| F-06 | Kauf-/Verkaufspriorität | Zusammenfassung, Aufstocken, Kaufen, Verkaufen, Sparplan, Hochrechnung; Sollgewicht Kern/Satellit/Reserve, Profile, Ruhestand mit Gleitpfad | – |
| F-07 | Kaufideen | Kandidatenliste, Geheimtipps, KI-Vorschläge über die Anthropic-API mit Websuche (Schlüssel des Nutzers) | – |
| F-08 | Dividenden | Kalender (Yahoo, DivvyDiary mit Schlüssel), echte Dividendeneingänge aus Kontoumsätzen | – |
| F-09 | Order | Order an comdirect: Handelsplätze, Vorabprüfung, Kostenindikation, Validierung mit TAN, Senden nach Bestätigung | `order` |
| F-10 | Planspiel | Simulation von Käufen/Verkäufen (FIFO-Tranchen) | `sim` |
| F-11 | Konten & Vermögen, Kredite | Konten.json, Dispo nach aktueller Nutzung, Kredite aus Finanzreports | – |
| F-12 | Finanzen | Finanzreport-PDFs per pdf.js lesen, Buchungen kategorisieren (Stichwörter + manuelle Zuordnung), Auswertung nach Jahr/Monat | `finance` |
| F-13 | Steuer | Jahressteuerbescheinigung → Anlage KAP, Steuerrechnung mit Familienstand | – |
| F-14 | Wertpapierbelege | Abrechnungen und Ertragsgutschriften aus PDFs für die History | – |
| F-15 | Postbox | neue PDFs über die comdirect-API in die PDF-Ablage laden | – |
| F-16 | Watchlist, Datenschutz | Watchlist.json; Beträge ausblenden (👁️/🙈) | – |
| F-17 | Einstellungen, Diagnose | Darstellung, Zusatzfunktionen, Zugänge, Ruhestand, Fehlerlog, iCloud-Abgleich, Übernahme aus dem alten Finance.js | – |
| F-18 | Kategorien-Editor | eigenes Skript: Kategorien und Stichwörter pflegen, Sicherung, manuelle Zuordnungen zurücksetzen | – |

## Hauptablauf
1. Start → Depotdatei laden (`Depotbestand/<depot>.json`), WebView mit HTML aufbauen, Mini-Verläufe nachladen.
2. Jeder Klick ist ein Link `scriptable:<aktion>?…`; `shouldAllowRequest` fängt ihn ab, die Aktion läuft, die Seite wird neu aufgebaut (80 Aktionen, `docs/api/INDEX.md`).
3. comdirect-Abruf: Anmeldung, TAN in der photoTAN-App bestätigen, Daten holen, Depotdatei mit Revisionszähler speichern.

## Daten (iCloud Drive/Scriptable/)
| Ort | Inhalt |
|---|---|
| `Depotbestand/Depots.json` | Depotliste, aktives Depot, Gesamtverlauf |
| `Depotbestand/depotbestand.json` (+ je Depot eigene Datei) | Positionen, Einstellungen, Revision, Gerätestempel |
| `Depotbestand/Konten.json`, `Watchlist.json`, `Historie.json`, `Dividendeneingaenge.json`, `Wertpapierbelege.json` | gemeinsame Daten aller Geräte |
| `Depotbestand/categories.json`, `Finanzreport*.json`, `Steuer.json`, `steuer-cache.json` | Finanzen und Steuer (ab v3.21 eigene Kopie) |
| `Depotbestand/Fehlerlog.txt`, `lib/` | Protokoll, pdf.js |
| `comdirect/` | Arbeitsordner des alten Finance.js; Quelle der Übernahme und der Report-PDFs |
| lokal (Gerät) | Kurs-/Analyse-Caches (`Exchange-TR-Cache.json`, `Exchange-Analyse-Cache.json`, `sparks.json`) |
| iOS-Keychain | comdirect-Zugang, Anthropic- und DivvyDiary-Schlüssel, Darstellungsschalter |

## Fremde Dienste
comdirect-API (`api.comdirect.de`), Yahoo Finance, DivvyDiary, Anthropic, OpenFIGI, Google News, Fondsweb, justETF, extraETF, finanzen.net, Consorsbank, cdnjs (pdf.js).

## Berechtigungen
Ein Nutzer; Schutz liegt bei iOS (Gerätesperre, Keychain) und comdirect (TAN). Eine Order wird nur nach eigener Bestätigung im Dialog gesendet und nie zweimal (`ORDER_PENDING = null`).
