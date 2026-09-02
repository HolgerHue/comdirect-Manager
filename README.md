comdirect Finanzmanager für Scriptable

Eine native Scriptable-App für die comdirect-Postbox sowie die Auswertung von Finanzreports, Jahressteuerbescheinigungen und Wertpapierabrechnungen. Die App arbeitet ohne sichtbare Weboberfläche und stellt alle Bereiche in einer einheitlichen, für iPhone und iPad optimierten Tabellenansicht dar.

Dieses Projekt ist inoffiziell und steht in keiner Verbindung zur comdirect bank AG oder Commerzbank AG. Es ersetzt weder eine Anlage- noch eine Steuerberatung. Erkannte Werte müssen mit den Originaldokumenten geprüft werden.

Funktionen

Postbox

* Anmeldung an der comdirect-API
* Abruf und Download von PDF-Dokumenten
* Filter nach Zeitraum, Archivstatus, Werbung und Dateinamen
* Optionale Ablage nach Jahr und PDF-Unterordner
* Überspringen bereits vorhandener Dokumente
* Suche sowie Filterung der PDF-Bibliothek

Finanzreport

* Automatische Erkennung von Buchungen aus Finanzreport-PDFs
* Frei konfigurierbare Kategorien und Schlüsselwörter
* Auswertung nach Jahr und Monat
* Kategorien-, Buchungs- und Verlaufsansicht
* Einnahmen, Ausgaben, Saldo, Sparquote und Monatsvergleiche
* CSV-Export der Zusammenfassung und Einzelbuchungen

Wertpapiere

* Erkennung von Kauf- und Verkaufsabrechnungen
* Auswertung von Wertpapiername, WKN, ISIN, Stückzahl und Kurs
* Erkennung von Kurswert, Gebühren, Steuern und Endbetrag
* Jahresübersicht mit Käufen, Verkäufen und Netto-Cashflow
* Jahresvergleich für Investitionen und Gebühren
* Rechnerische Positionen aus den vorhandenen Abrechnungen
* Dokumentdetails mit Zugriff auf das Original-PDF
* CSV-Export sämtlicher Wertpapiergeschäfte

Jahressteuer

* Auswertung von Jahressteuerbescheinigungen
* Übersicht der Werte für die Anlage KAP
* Kapitalerträge, Aktiengewinne, Verluste und Steuerabzüge
* Sparer-Pauschbetrag und Auslastung
* Jahresvergleich und Steuerquote
* CSV-Export aller erkannten Steuerwerte

Allgemein

* Native UITable-Oberfläche ohne sichtbaren WebView
* Helles, dunkles oder systemabhängiges Farbschema
* Responsive Darstellung auf iPhone und iPad
* Einheitliche gestreifte Datenzeilen
* Lokale Analyse-Caches für einen schnellen Start
* Gemeinsames Backup aller Auswertungsbereiche
* Offline-PDF-Auswertung nach dem ersten Laden von PDF.js

Voraussetzungen

* iPhone oder iPad
* Installierte Scriptable-App
* Internetverbindung beim ersten Start zum Laden von PDF.js
* Optional: comdirect-Zugang und API-Zugangsdaten für den Postbox-Download
* Alternativ können vorhandene PDFs ohne Bankzugang importiert werden

Installation

1. Das ZIP-Archiv herunterladen und entpacken.
2. Die enthaltene JavaScript-Datei in Scriptable importieren.
3. Das Script einmal direkt in Scriptable starten.
4. Beim ersten Start werden der Arbeitsordner, die Konfiguration und die erforderlichen Unterordner automatisch angelegt.
5. Für den Postbox-Download unter Einstellungen → Comdirect-Zugang Zugangsnummer, PIN, Client-ID und Client-Secret eintragen.

Die Zugangsdaten werden ausschließlich im iOS-Keychain gespeichert. Sie werden nicht in com_fm.ini, Backups oder CSV-Dateien geschrieben.

Ablage und Ordnerstruktur

Die App legt ihre Arbeitsdateien standardmäßig hier ab:

Scriptable/
└── comdirect/
    ├── com_fm.ini
    ├── Comdirect-postbox-settings.json
    ├── bookings-cache.json
    ├── steuer-cache.json
    ├── wertpapier-cache.json
    ├── reports/
    │   └── … PDF-Dokumente
    ├── export/
    │   └── … CSV-Dateien und Backups
    └── lib/
        ├── pdf.min.js
        └── pdf.worker.min.js

Konfiguration, Caches, Exporte und PDF.js bleiben immer im Ordner von com_fm.ini. Nur die PDF-Ablage kann optional über einen Scriptable-Dateibookmark auf einen anderen Ordner verweisen.

PDF-Ablage über einen Scriptable-Dateibookmark

Ein Datei-Bookmark ermöglicht den dauerhaften Zugriff auf einen frei gewählten Ordner, beispielsweise in iCloud Drive oder bei einem unterstützten Dateianbieter.

1. Die Einstellungen der Scriptable-App öffnen.
2. Unter File Bookmarks beziehungsweise Datei-Bookmarks einen neuen Ordner-Bookmark anlegen.
3. Den gewünschten PDF-Ordner auswählen und einen eindeutigen Namen vergeben.
4. Den Finanzmanager starten.
5. Einstellungen → PDF-Ablage → Datei-Bookmark … öffnen.
6. Den zuvor erstellten Bookmark auswählen.

Der ausgewählte Ordner wird anschließend gemeinsam verwendet für:

* Downloads aus der comdirect-Postbox
* manuell importierte PDFs
* Finanzreport-Auswertung
* Wertpapierauswertung
* Jahressteuerauswertung
* Dokumentliste und Originalansicht

Die Auswahl wird in com_fm.ini gespeichert:

pfad : bookmark:Name des Bookmarks

Wird der Bookmark entfernt oder ist der Ordner vorübergehend nicht verfügbar, überschreibt die App keine gespeicherten Analysewerte. Der Bookmark kann erneut ausgewählt oder die lokale PDF-Ablage aktiviert werden.

Unterstützte Dokumentnamen

Die Standardmuster lauten:

muster : Finanzreport
steuermuster : Jahressteuer
wertpapiermuster : Wertpapierabrechnung

Die Muster können unter den jeweiligen Einstellungen geändert werden. Die Erkennung prüft, ob der angegebene Text im PDF-Dateinamen enthalten ist.

Bedienung

Die Hauptansicht besteht aus vier Bereichen:

Bereich	Inhalt
Finanzreport	Kategorien, Verlauf und Buchungen
Wertpapiere	Übersicht, Jahresvergleich, Positionen und Abrechnungen
Jahressteuer	Übersicht, Verlauf und Anlage KAP
Postbox	Download, Bestand, Suche und PDF-Dokumente

Die Symbolleiste bietet folgende Aktionen:

Symbol	Funktion
⤓	Dokumente aus der Postbox laden
⟳	PDF-Bestand erneut auswerten
◐ / ☀︎ / ☾	Darstellung umschalten
ⓘ	Integrierte Anleitung öffnen
⚙	Einstellungen öffnen

Konfiguration

com_fm.ini ist die zentrale Konfigurationsdatei. Änderungen über die App werden sofort gespeichert. Neben Darstellungs-, Filter- und Startoptionen enthält sie die Kategorien des Finanzreports.

Beispiel einer Kategorie:

Lebensmittel : rewe,aldi,edeka,lidl,kaufland

Die erste passende Kategorie gewinnt. Deshalb ist die Reihenfolge der Kategorien relevant und kann im integrierten Kategorien-Editor geändert werden.

Wertpapierpositionen

Der angezeigte Bestand wird ausschließlich aus den eingelesenen Kauf- und Verkaufsabrechnungen berechnet:

Rechnerischer Bestand = erkannte Käufe − erkannte Verkäufe

Depotüberträge, Kapitalmaßnahmen, Aktiensplits, Einbuchungen und nicht vorhandene Abrechnungen werden nicht automatisch berücksichtigt. Die Positionsansicht ist daher eine Auswertung der Dokumente und kein vollständiger Ersatz für die Depotanzeige der Bank.

Beim ersten Start der integrierten Version werden passende PDFs aus einem vorhandenen Ordner Scriptable/wertpapier-manager/abrechnungen in die gemeinsame lokale PDF-Ablage übernommen. Der alte Ordner bleibt unverändert erhalten.

Export und Backup

Unter Einstellungen → Export und Wartung stehen zur Verfügung:

* CSV-Export der Finanzreport-Übersicht
* CSV-Export der Einzelbuchungen
* CSV-Export der Jahressteuerwerte
* CSV-Export der Wertpapiergeschäfte
* JSON-Backup von Konfiguration und Auswertungsdaten
* Wiederherstellung eines zuvor erzeugten Backups
* Löschen und vollständiger Neuaufbau aller Analyse-Caches

Alle erzeugten Dateien werden im Unterordner export abgelegt und können anschließend über das iOS-Teilen-Menü exportiert werden.

Datenschutz und Sicherheit

* Zugangsdaten werden im iOS-Keychain gespeichert.
* PIN und Client-Secret werden nicht in Dateien exportiert.
* PDF-Dokumente verbleiben in der gewählten Ablage.
* Die PDF-Texterkennung läuft lokal in einem unsichtbaren WebView.
* PDF.js wird beim ersten Bedarf aus dem Internet geladen und anschließend im Ordner lib zwischengespeichert.
* Backups enthalten Auswertungsdaten, aber keine Zugangsdaten.

Bekannte Einschränkungen

* PDF-Layouts können sich ändern und dadurch die Texterkennung beeinflussen.
* Die Wertpapiererkennung ist auf typische comdirect- und Commerzbank-Abrechnungen ausgerichtet.
* Die Steuerwerte müssen vor einer Übernahme in die Steuererklärung mit dem Original abgeglichen werden.
* Ein Datei-Bookmark muss in Scriptable bestehen bleiben, damit der externe Ordner dauerhaft erreichbar ist.
* Die App führt keine Anlageberatung und keine automatische Kursabfrage durch.

Fehlerbehebung

Keine PDFs gefunden

* PDF-Ablage und Bookmark prüfen.
* Dateimuster in den Einstellungen kontrollieren.
* Dokumentfilter der Postbox prüfen.
* Mit ⟳ den Bestand neu einlesen.

PDF-Modul nicht verfügbar

Beim ersten Einsatz wird eine Internetverbindung benötigt. Danach liegen pdf.min.js und pdf.worker.min.js im lokalen Ordner lib.

Bookmark nicht verfügbar

Den Ordner in den Scriptable-Einstellungen erneut als Datei-Bookmark anlegen und danach im Finanzmanager unter PDF-Ablage auswählen.

Werte wurden unvollständig erkannt

* Original-PDF öffnen und prüfen.
* Dateimuster kontrollieren.
* Beim Finanzreport den Zeilenabstand anpassen.
* Unter Export und Wartung die Auswertung vollständig neu aufbauen.

Lizenz und Quellen

Die zusammengeführte App enthält Bestandteile aus mehreren Projekten. Die jeweiligen Lizenzhinweise befinden sich im Kopf der JavaScript-Datei. Rechte und Bedingungen der ursprünglichen Komponenten bleiben bestehen.

Haftungsausschluss

Die Software wird ohne Gewähr bereitgestellt. Für fehlerhaft erkannte Dokumente, unvollständige Auswertungen, finanzielle Entscheidungen oder Angaben gegenüber Behörden wird keine Haftung übernommen.
