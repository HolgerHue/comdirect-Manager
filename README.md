# comdirect Manager

Postbox-Download, Finanzreport-, Depot- und Steuerauswertung in einer [Scriptable](https://scriptable.app)-App für iPhone und iPad.

Die App lädt die PDFs aus der comdirect-Postbox, liest sie lokal auf dem Gerät aus und stellt sie in vier Bereichen dar: Finanzen, Depot, Steuer und Postbox. Es werden keine Daten an Dritte übertragen — die Textextraktion läuft offline auf dem Gerät.

**Version 4.2.5**

---

## Funktionsumfang

### Finanzen
Wertet die Finanzreport-PDFs aus und ordnet jede Buchung einer Kategorie zu. Zuordnung über Schlüsselwörter, zusätzlich lassen sich einzelne Buchungen manuell einer Kategorie zuweisen. Auswertung nach Jahr und Monat, Diagramme für Einnahmen, Ausgaben und Kategorienverteilung, CSV-Export.

### Depot
Liest Wertpapierabrechnungen und Ertragsgutschriften:

- Käufe und Verkäufe mit Stückzahl, Kurs, Kurswert, Provision und Steuern
- Dividenden und Ausschüttungen inklusive Fremdwährung, Quellensteuer und Devisenkurs
- rechnerischer Bestand je Wertpapier aus den vorhandenen Abrechnungen
- Netto-Cashflow und Gebührenverlauf über alle Jahre

MiFID-II-Kosteninformationen werden erkannt und übersprungen — es sind Simulationen, keine Umsätze.

### Steuer
Liest die Jahressteuerbescheinigung und ordnet jedes Feld seiner amtlichen Zeile in der Anlage KAP zu. Der Sparer-Pauschbetrag wird aus dem Beleg hergeleitet: genutzter plus noch verfügbarer Freistellungsauftrag. Fehlt die Angabe, gilt der gesetzliche Betrag (ab 2023 1.000 € je Person, davor 801 €), bei höherer Nutzung verdoppelt.

### Postbox
Lädt Dokumente über die comdirect-API in den Arbeitsordner. Zeitraum, Archivfilter, Dateinamen-Präfixe und Seitengröße sind einstellbar, optional mit Unterordnern je Jahr.

---

## Installation

1. [Scriptable](https://apps.apple.com/app/scriptable/id1405459188) aus dem App Store installieren.
2. `comdirect_Manager.js` in den Scriptable-Ordner legen (`iCloud Drive/Scriptable/`).
3. Skript in Scriptable starten. Beim ersten Lauf werden alle benötigten Ordner und Dateien angelegt.

**Beim ersten Start ist eine Internetverbindung nötig.** Die App lädt einmalig `pdf.min.js` und `pdf.worker.min.js` (pdf.js 3.11.174) nach `comdirect/lib/`. Danach arbeitet die Textextraktion offline. Wer das vermeiden will, legt die beiden Dateien vorab in diesen Ordner.

---

## Ordnerstruktur

Alles liegt unterhalb von `iCloud Drive/Scriptable/comdirect/`:

```
com_fm.ini                        Einstellungen
categories.json                   Kategorien, Regeln und manuelle Zuordnungen
categories-backup-*.json          automatische Sicherungen des Kategorienstands
Comdirect-postbox-settings.json   Postbox-Einstellungen
reports/                          PDFs aus der Postbox
export/                           CSV-Exporte und Backups
lib/                              pdf.js-Cache
logs/<geraet>.log                 Protokoll je Gerät
bookings-cache.json               Analyse-Cache Finanzen
wertpapier-cache.json             Analyse-Cache Depot
steuer-cache.json                 Analyse-Cache Steuer
```

Der PDF-Bestand kann alternativ außerhalb liegen, über einen Scriptable-Dateibookmark (Einstellungen → PDF-Ablage).

---

## Synchronisierung zwischen Geräten

Der Arbeitsordner liegt in iCloud Drive, iPhone und iPad greifen also auf denselben Stand zu. Ist iCloud Drive nicht aktiv, fällt die App auf den gerätelokalen Ordner zurück und arbeitet ohne Synchronisierung.

Beim ersten Start nach einem Update aus einer älteren, rein lokalen Fassung wird der vorhandene Bestand einmalig nach iCloud übernommen. Kopiert wird nur, was in iCloud fehlt oder dort älter ist.

Bearbeiten beide Geräte die Kategorien, werden die Stände beim Speichern zusammengeführt: Kategorien über den Namen vereinigt, manuelle Zuordnungen ebenfalls, bei Konflikt gewinnt das gerade speichernde Gerät. **Löschungen setzen sich in diesem Fall nicht durch** — wer eine Kategorie entfernt, während das andere Gerät parallel speichert, bekommt sie zurück. Im Normalfall, also ein Gerät nach dem anderen, greift der Merge nicht und Löschen funktioniert wie erwartet.

Logdateien werden pro Gerät geführt, damit sie sich nicht gegenseitig überschreiben.

---

## Dateimuster

Welche PDF wie ausgewertet wird, entscheidet der Dateiname. Alle vier Muster sind in den Einstellungen änderbar; ein leeres Muster schaltet den jeweiligen Bereich ab.

| Bereich | INI-Schlüssel | Vorgabe |
|---|---|---|
| Finanzreport | `muster` | `Finanzreport` |
| Jahressteuer | `steuermuster` | `Jahressteuer` |
| Wertpapiere | `wertpapiermuster` | `Wertpapierabrechnung` |
| Erträge | `ertragsmuster` | `Ertragsgutschrift` |

Bei einem leeren Finanzreport-Muster wird jede PDF im Ordner gelesen. Kosteninformationen und Ertragsgutschriften bleiben auch dann ausgenommen.

---

## Konfiguration

`com_fm.ini` im Arbeitsordner, ein Schlüssel je Zeile im Format `schlüssel : wert`. Alle Werte lassen sich auch in der App setzen; die Datei ist die einzige Quelle der Konfiguration.

Zugangsdaten für die comdirect-API liegen im iOS-Keychain, nicht in der INI.

Kategorien und Schlüsselwörter stehen separat in `categories.json`. Vor der ersten Änderung im Kategorien-Editor legt die App eine Sicherung an; über **Kategorien-Editor → ⟲ Sicherung** lässt sich ein früherer Stand zurückholen.

---

## Zwischenspeicher

Jeder Bereich hat einen eigenen Analyse-Cache. Unveränderte PDFs werden über ihre Signatur erkannt und nicht erneut gelesen. Nach einer Änderung an der Auswertungslogik muss der betroffene Cache verworfen werden:

Bereich aktivieren → ⚙ → Export und Wartung → *Auswertung neu aufbauen* → *Nur \<Bereich\>* oder *Alle Bereiche*.

---

## Hinweise

Die ausgelesenen Werte sind eine Lesehilfe. Vor Abgabe der Steuererklärung immer mit der Originalbescheinigung abgleichen. Der rechnerische Depotbestand berücksichtigt nur vorhandene Abrechnungen, keine Depotüberträge oder Splits.

Das Projekt steht in keiner Verbindung zur comdirect oder zur Commerzbank AG.

---

## Lizenz

- Postbox-Teil: GPL-3.0-or-later
- Finanzteil: Portierung von [t4ri/Python-Finanzmanager](https://github.com/t4ri), CC BY-NC-SA 4.0
- Steuerteil: aus dem Jahressteuer Manager

Die Kombination folgt der jeweils strengsten Bedingung, also nicht-kommerzielle Nutzung unter Namensnennung und Weitergabe unter gleichen Bedingungen.
