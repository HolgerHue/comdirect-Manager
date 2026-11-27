# Ablauf: Finanzreports einlesen (as-built, unverified)

1. PDF-Ablage (Bookmark oder `iCloud/comdirect/reports`) → neue PDFs (Signatur) finden.
2. Text per pdf.js in einer unsichtbaren WebView (max. 60 s je PDF).
3. Parser → Buchungen mit stabiler ID; Kategorie über Stichwörter oder manuelle Zuordnung (`categories.json`).
4. Cache `Finanzreport-Seiten.json`/`Finanzreport-Buchungen.json`; Auswertung im Browser der Seite.
