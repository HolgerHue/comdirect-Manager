# 03 – Technischer Plan (Ist-Stand)

> **Adopted project — reconstructed as-built** (27.11.2026). `[E]` = vorhanden, `[A]` = laut Prüfung noch zu bauen.

## Stack
- JavaScript (ES2017+, `async/await`) für **Scriptable** auf iOS/iPadOS; Scriptable-APIs: `WebView`, `FileManager`, `Keychain`, `Request`, `Alert`/`WebAlert`, `Device`, `Pasteboard`.
- Oberfläche: HTML/CSS/JS als Zeichenkette erzeugt, in einer Vollbild-`WebView` geladen; Browser-Skripte in der Seite rechnen z. T. selbst (Finanzen).
- PDF-Text: pdf.js 3.11.174 (`pdf.min.js`, `pdf.worker.min.js`), einmalig von cdnjs geladen und in `Depotbestand/lib/` gespeichert; unsichtbare WebView.
- Keine Paketverwaltung, kein Build, keine Minifizierung (die Datei wird so in Scriptable gelegt).

## Code map
| Pfad | Zeilen | Inhalt |
|---|---|---|
| `Finance.js` [E] | 1–181 | Kopf: Funktionsübersicht, Versionsliste 2.82–3.31 |
| | 183–355 | `APP`, Hilfsfunktionen (`toNumber`, `esc`), Ablage `storagePaths()` |
| | 356–1318 | Seiten-Cache, Depotliste, manuelle Positionen, Zukauf |
| | 1319–2452 | comdirect-Zugang (Keychain), REST-API: OAuth2, Session-TAN, Positionen |
| | 2453–3517 | Mini-Verläufe, News, ETF-Zusammensetzung, Darstellung, Stufen |
| | 3518–4379 | Dialoge (HTML-Overlays), Gesamtansicht, comdirect-Abruf |
| | 4380–5576 | Hauptseite, Anbindung Overview |
| | 5577–7433 | Yahoo-Zugang, Fundamentaldaten, Technik, Bewertung, Überschneidung, Ampel |
| | 7434–10142 | Gesamtrendite, Sollgewichtung, Ruhestand, Priorität, Hochrechnung, Sparplan, Kaufideen/KI |
| | 10143–11078 | Fehlerlog, Dividendentermine, DivvyDiary |
| | 11079–11906 | Order (Anmeldung, Handelsplätze, Prüfung, Senden), Seiten, Aktionen, Datenschutz |
| | 11907–13140 | Zwischenspeicher, Watchlist, Analyse-Seite |
| | 13141–14606 | TWR/IRR, Steuern & Kosten, Konten, Einmalbetrag, Dividendeneingänge |
| | 14607–16205 | PDF-Ablage, Übernahme aus altem Finance.js, Postbox, pdf.js, Steuer, Kategorien, Parser, Kredite, Seite Finanzen |
| | 16206–16681 | Wertpapierbelege aus PDFs |
| | 16682–17246 | `run()`: WebView, `shouldAllowRequest`, Aktionsverteiler; letzte Zeile `await run();` |
| `Kategorien-Editor.js` [E] | 1166 | Editor.js 3.2, native `UITable`, bearbeitet `comdirect/categories.json` |
| `README.md` [E] | – | beschreibt noch den alten comdirect Manager v4.2.5 (G-01) |
| `CLAUDE.md`, `AGENTS.md` [E] | – | Projektregeln + Keel-Sperre |
| `scripts/` [E] | – | Keel-Werkzeuge (`keel-time`, `keel-clock`, `keel-verify`, `keel-close`, `keel-affected-tests`, `keel-handoff-verify`) |
| `tests/` [A] | – | Node-Tests reiner Funktionen (G-05) |

## Beobachtete Konventionen
- Eine Datei je Skript; Abschnitte mit `/* ---- Titel ---- */`; Kommentare und Oberfläche Deutsch; Bezeichner Englisch/Deutsch gemischt.
- `var`/`function` und `const`/`let` gemischt; Zeichenketten mit `"`; HTML per Zeichenkettenverkettung, Ausgabe durch `esc()` (311 Aufrufe).
- Zahlen: `toNumber()` für deutsche Eingaben; Geld in Euro als `Number`.
- Fehler: `try/catch` mit `logEvent("FEHLER", …)` ins `Fehlerlog.txt`; Darstellungsfehler werden verschluckt.
- Speichern: vor dem Schreiben frisch lesen, Revisionszähler, Gerätestempel, Sicherung.
- Versionen: `APP.version` (z. Z. 3.31) + Zeile in der Versionsliste; Parser-Versionen `FIN_PARSER_VERSION`, `FIN_TAX_PARSER_VERSION`, `SEC_PARSER_VERSION` für Caches.

## Befehle
| Zweck | Befehl | Stand |
|---|---|---|
| Syntaxprüfung | `node --check Finance.js && node --check Kategorien-Editor.js` | geprüft 27.11.2026, grün |
| Betroffene Prüfungen | `scripts/keel-affected-tests --run` | ab S-004 |
| Keel-Prüfung | `scripts/keel-verify` | ab S-004 |
| Echtlauf | Datei nach `iCloud Drive/Scriptable/` legen und in Scriptable starten | nur durch den Nutzer (PLATFORM-IMPOSSIBLE) |

## Versionsstellen
| Stelle | Wert |
|---|---|
| `Finance.js` `APP.version` | 3.31 |
| `Finance.js` Versionsliste (Kopf) | letzte Zeile 3.31 |
| `Kategorien-Editor.js` Kopf | Editor.js 3.2 |
| `README.md` | 4.2.5 (veraltet, G-01) |

## Änderungsplan (change map)
| Art der Änderung | Was alles angefasst wird |
|---|---|
| Neue Funktion / Verhalten in `Finance.js` | Code; `APP.version` + Versionszeile; `docs/02-functional-spec.md`; neue Aktion → `docs/api/INDEX.md`; Anleitung (?) in der App, falls sichtbar |
| Neue oder geänderte Aktion `scriptable:<aktion>` | Verteiler in `run()`; erzeugender Link; `docs/api/INDEX.md` |
| Neues Feld / neue Datei in iCloud | Lesen mit Vorgabe für alte Dateien (D-006); Abgleich zwischen Geräten (frisch lesen, Revision); `docs/02-functional-spec.md` Datentabelle; INDEX „Dateien“ |
| Parser für PDFs geändert | zugehörige `*_PARSER_VERSION` erhöhen (Cache verwerfen); Hinweis zu Buchungs-IDs (dürfen gleich bleiben) |
| Format `categories.json` | `Finance.js` **und** `Kategorien-Editor.js`; Sicherung vor dem Schreiben |
| Neuer fremder Dienst / Host | `docs/02-functional-spec.md` „Fremde Dienste“; `docs/threat-model.md`; Schlüssel nur in die Keychain |
| Neuer Schlüssel / Zugang | Keychain-Eintrag `Depotbestand.<name>`; Einstellungen zum Setzen/Löschen; INDEX „Keychain“ |
| Order-Ablauf | Bestätigungsdialog bleibt; einmaliges Senden; `docs/threat-model.md` |
| Release | Versionsstellen gleich; README; Tag nur auf Anweisung |

## Lizenzregel für Abhängigkeiten
Einzige Abhängigkeit: pdf.js (Apache-2.0) – verträglich mit GPL-3.0 und CC BY-NC-SA. Die Lizenz des Projekts selbst ist offen (G-03).
