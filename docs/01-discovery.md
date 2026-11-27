# 01 – Discovery

> **Adopted project — reconstructed as-built** (27.11.2026). Aus Code, README und Antworten des Nutzers.
> Was nur aus dem Code gelesen ist, steht als `as-built, unverified`.

## Problem und Ergebnis
Ein Privatanleger mit comdirect-Depot und -Girokonto will auf iPhone und iPad ohne fremden Dienst sehen, was er hat, was es bringt und was er als Nächstes kaufen oder verkaufen sollte, und will die comdirect-PDFs (Finanzreport, Steuerbescheinigung, Abrechnungen) auswerten. Die Daten bleiben auf seinen Geräten und in seiner iCloud.

## Nutzer
Ein Nutzer (der Entwickler selbst), zwei Geräte (iPhone, iPad), gemeinsamer Stand über iCloud Drive. Kein Mehrbenutzerbetrieb.

## Umfang des Ist-Stands (Version 3.31, `Finance.js`)
Siehe `docs/02-functional-spec.md`. Kurz: Depots (comdirect + manuell), Kurse und Charts, Analyse, Dividenden, Kauf-/Verkaufspriorität, Sparplan, Hochrechnung bis zur Rente, Kaufideen (auch per KI), Order an comdirect, Konten und Kredite, Finanzen aus Finanzreports mit Kategorien, Steuer (Anlage KAP), Postbox-Download, Kategorien-Editor als eigenes Skript.

## Projektart und Plattform
- Projektart: App mit Web-Oberfläche (D-007) → Sicherheitsprofil `web-app`.
- Plattform: Scriptable auf iOS/iPadOS. Oberfläche ist HTML in einer Vollbild-WebView; Aktionen laufen über Links `scriptable:<aktion>?…`, die `shouldAllowRequest` abfängt.

## Rahmenbedingungen
- In Betrieb mit echten Daten (D-006): Rückwärtskompatibilität der Dateien ist Pflicht.
- Kein Build, keine Abhängigkeiten außer pdf.js (vom CDN geladen und zwischengespeichert).
- Läuft nur in Scriptable; in dieser Umgebung nur Syntaxprüfung (`node --check`) möglich.

## Sprache, Barrierefreiheit
- Oberfläche einsprachig Deutsch (D-007). Doku Deutsch (D-002).
- Ziel WCAG 2.2 AA für die WebView-Seiten; Ist-Stand ungeprüft.

## Design
Bestehend, im Code: Apple-Stil mit „Liquid Glass“, hell/dunkel/System, Emoji-Icons. Keine Design-Quelle außerhalb des Codes; das aktuelle Aussehen ist die Grundlinie.

## Wettbewerb
Nicht untersucht (für die Übernahme optional). Der Code nennt getquin als Vorbild der Analyse.

## Website, Budget
Keine Website, kein Kundenbudget (D-009).
