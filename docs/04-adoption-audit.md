# Lückenprüfung der Übernahme (27.11.2026)

> Gegen Keels Standards, aus Befehlen und Dateien belegt. Einordnung mit dem Nutzer: **jetzt** (Sprint 1), **beim Anfassen** (deferred), **akzeptiert**.
> Einordnung bestätigt am 27.11.2026 (D-014).

| ID | Lücke | Wo / Beleg | Schwere | Standard | Vorschlag |
|---|---|---|---|---|---|
| G-01 | README beschreibt den gelöschten „comdirect Manager“ v4.2.5 (Datei `comdirect_Manager.js`, Ordner `comdirect/`) statt `Finance.js` 3.31 (`Depotbestand/`) | `README.md`; Commit cd25fd0 | mittel | Doku = Wirklichkeit | jetzt |
| G-02 | `Kategorien-Editor.js` bearbeitet `comdirect/categories.json`; `Finance.js` liest seit 3.21 nur `Depotbestand/categories.json` und hat einen eigenen Editor → Änderungen im separaten Editor wirken nicht | Editor Z. 27–28; Finance Z. 140–143, 3917 | hoch | Funktion | jetzt (Nutzer entscheidet: Editor umstellen oder entfernen) |
| G-03 | Lizenz unklar: keine LICENSE-Datei, Dateiköpfe ohne Lizenz; README kombiniert GPL-3.0 mit CC BY-NC-SA 4.0 – die beiden sind nicht miteinander verträglich (GPL verbietet die Zusatzbeschränkung „nicht kommerziell“) | `README.md` „Lizenz“ | mittel | Lizenz | jetzt (Nutzer entscheidet) |
| G-04 | Namen uneinheitlich: Datei `Finance.js`, Kopf `Exchange.js`, `APP.name` „Depotbestand“; „Finance.js“ im Code meint das alte Programm | Z. 4, 183, 14534 | niedrig | Konsistenz | beim Anfassen (Umbenennen von `APP.name` würde Ordner und Keychain verschieben → nie ohne Übernahme, D-006) |
| G-05 | Keine Tests; reine Logik (`toNumber`, PDF-Parser, Steuer, FIFO, TWR/IRR, Hochrechnung) ungeprüft – die Versionsliste 3.31 zeigt mehrere Rechenfehler | kein `tests/` | hoch | Tests, Test-first | jetzt: Testgerüst mit Node + erste Tests der Kernrechnungen |
| G-06 | Eine Datei mit 17 246 Zeilen und 748 Funktionen; Doppelungen wahrscheinlich (Parser „unverändert übernommen“), nicht gemessen | `Finance.js` | mittel | Wiederverwendung | beim Anfassen |
| G-07 | HTML aus Zeichenketten; fremde Daten (News, Yahoo, KI, PDF) laufen in 64 `innerHTML`-Stellen; Maskierung nicht vollständig geprüft; Card verlangt Sicherheitsaudit | `docs/threat-model.md` | hoch | Sicherheit | jetzt: Sicherheitsaudit nach `references/security-audit.md` |
| G-08 | Depotdaten gehen an Anthropic, wenn KI an ist; Hinweis für den Nutzer in der App ungeprüft | Z. 8743 ff. | mittel | Datenschutz | beim Anfassen |
| G-09 | pdf.js vom CDN ohne Prüfsumme, danach dauerhaft ausgeführt | Z. 14536 | mittel | Lieferkette | beim Anfassen |
| G-10 | Barrierefreiheit der WebView-Seiten ungeprüft (Emoji als Schaltflächen, Kontraste, VoiceOver) | Oberfläche | mittel | WCAG 2.2 AA | beim Anfassen |
| G-11 | Forge-Issues nicht erfasst (GitHub-Anbindung in dieser Sitzung getrennt) | – | niedrig | Issues-Log | bei der nächsten Sitzung mit GitHub |

## Selbstprüfung bekannter Fallen (`references/anti-patterns.md`, belegt)
- Doku verspricht Nicht-Vorhandenes: ja → G-01 (README nennt `comdirect_Manager.js`, existiert nicht: `ls`).
- Version an mehreren Stellen: `APP.version` = Versionsliste (keel-verify OK); README 4.2.5 abweichend → G-01.
- Erklärtes Werkzeug, das nichts ausführt: keins (keine Manifeste).
- Erzeugte Datei, die niemand nutzt: `Kategorien-Editor.js` gegenüber dem eingebauten Editor → G-02.
- Geheimnis im Verlauf: `git log -p | grep` auf Schlüsselmuster ohne Fund (27.11.2026).

## Einordnung
Mit dem Nutzer am 27.11.2026 (D-014): **jetzt** (Sprint 1) G-01 → S-009, G-02 → S-008 (Editor entfernen), G-05 → S-010, G-07 → S-011. **Beim Anfassen** (deferred) G-04, G-06, G-08, G-09, G-10, G-11 → S-012–S-017. **Offen:** G-03 Lizenz – Nutzer entscheidet später.
