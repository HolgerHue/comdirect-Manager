# Decisions – comdirect-Manager

> Append-only. Eine Sitzung öffnet hier festgehaltene Entscheidungen NIE von sich aus neu;
> nur der Nutzer kehrt eine Entscheidung um (als neuer Eintrag).

## D-001 – Projektregeln haben Vorrang vor Keels Voreinstellungen
- Date / phase: 2026-11-27 / Adoption
- Decision: Keel v7.5.0 führt das Projekt. Wo Keels Voreinstellungen den Projektregeln in `CLAUDE.md` widersprechen, gelten die Projektregeln. Der Nutzer hat die Einstellungen der Hotelsoftware (Repository KI-Entwicklung) übernommen.
- Why: Antwort des Nutzers vom 27.11.2026 („Wie Hotelsoftware“).
- Alternatives rejected (and why): einzeln abfragen – vom Nutzer nicht gewünscht.
- Supersedes: none

## D-002 – Dokumentation auf Deutsch
- Date / phase: 2026-11-27 / Adoption
- Decision: Keel-Dokumente, Kommentare und Commit-Nachrichten auf Deutsch; Bezeichner im Code bleiben wie vorgefunden. Issues, die Keel auf GitHub anlegt, auf Englisch (Keel-Regel für die Forge).
- Why: Wie Hotelsoftware; Mehrverbrauch an Tokens (rund 15–30 %) ist bekannt und akzeptiert.
- Alternatives rejected (and why): Englisch (Keel-Standard) – widerspricht der Vorgabe des Nutzers.
- Supersedes: none

## D-003 – Nicht automatisch: Push nur auf Anweisung; Issues nach jedem Sprint
- Date / phase: 2026-11-27 / Adoption
- Decision: `Autonomy: not automatic` – Keel committet, pusht aber nur auf ausdrückliche Anweisung; offene Commits stehen in PROGRESS. Forge-Issues: Durchsicht nach jedem Sprint, Intervall 24 h; Issue capture: on (gemeldete Fehler werden vor der Arbeit als Issue angelegt). Keel schließt nie ein Issue aus eigener Lesart.
- Why: Wie Hotelsoftware.
- Alternatives rejected (and why): automatischer Modus – vom Nutzer nicht gewählt.
- Supersedes: none

## D-004 – Branches: kein `develop`
- Date / phase: 2026-11-27 / Adoption
- Decision: Feature-Branch → `main` per Pull Request; Merge nur durch den Nutzer oder auf seine Anweisung. Keel taggt und veröffentlicht nichts von sich aus. Aktueller Arbeitsbranch: `claude/elegant-archimedes-tm9byp`.
- Why: Beobachtete Praxis des Repositorys (nur `main`) und Vorgabe wie Hotelsoftware.
- Alternatives rejected (and why): `develop` als Integrationsbranch (Keel-Standard) – vom Nutzer abgelehnt.
- Supersedes: none

## D-005 – Keine parallele Entwicklung; Benachrichtigung; kein Chaining
- Date / phase: 2026-11-27 / Adoption
- Decision: `Parallel development: off`, keine Agent-Teams. Benachrichtigung per PushNotification in die Claude-App des Nutzers. `Chaining: off` – die Übergabe steht in `docs/continuation-prompt.md` und wird im Chat gezeigt.
- Why: Wie Hotelsoftware; eine einzige große Datei lässt sich ohnehin nicht sinnvoll parallel bearbeiten.
- Alternatives rejected (and why): parallele Worker – Konflikte in `Finance.js` sicher.
- Supersedes: none

## D-006 – Produktiv in Gebrauch mit echten Daten
- Date / phase: 2026-11-27 / Adoption
- Decision: Installed base: in Betrieb auf iPhone/iPad des Nutzers mit echten Depot-, Konto- und Finanzreport-Daten in iCloud Drive. Jede Änderung bleibt rückwärtskompatibel zu vorhandenen JSON-Dateien und Caches; Formatwechsel nur mit Übernahme der alten Daten.
- Why: Antwort des Nutzers vom 27.11.2026.
- Alternatives rejected (and why): –
- Supersedes: none

## D-007 – Projekttyp, Stack, Barrierefreiheit, i18n, Testreihenfolge
- Date / phase: 2026-11-27 / Adoption
- Decision: Projekttyp „App mit Web-Oberfläche“ → Sicherheitsprofil `references/security/web-app.md`. Stack (adopted as-is): JavaScript für Scriptable (iOS), Oberfläche als HTML in einer Vollbild-WebView, pdf.js 3.11.174 vom CDN, Daten in iCloud Drive, Zugangsdaten in der Keychain. Barrierefreiheit: Ziel WCAG 2.2 AA für die WebView-Seiten, iOS-Abschnitt für native Dialoge. i18n: einsprachig Deutsch (so gebaut, adopted as-is). Test-first policy: pure-logic, nicht rückwirkend – gilt ab der nächsten Scheibe.
- Why: Antwort des Nutzers (Projektart) und vorgefundener Code.
- Alternatives rejected (and why): Profil library-component – passt nicht zu Bankzugangsdaten und OAuth.
- Supersedes: none

## D-008 – Sprint-Köpfe als JSON, Keel-Skripte aus der Hotelsoftware
- Date / phase: 2026-11-27 / Adoption
- Decision: Sprint-Dateien tragen ihren Kopf als JSON (gültiges YAML). `scripts/keel-time`, `keel-clock`, `keel_common.py`, `keel-handoff-verify` sind Kopien aus der Hotelsoftware; `keel-verify`, `keel-close`, `keel-affected-tests` sind für dieses Projekt geschrieben.
- Why: Gleiche Werkzeuge in beiden Projekten, nur Standardbibliothek von Python.
- Alternatives rejected (and why): neu schreiben – doppelte Arbeit.
- Supersedes: none

## D-009 – Keel nicht eingebettet, keine Website, kein Kundenbudget
- Date / phase: 2026-11-27 / Adoption
- Decision: Keel wird nicht nach `.claude/skills/keel/` kopiert; die Sperre in `CLAUDE.md`/`AGENTS.md` verweist auf das installierte Keel oder die Kopie in KI-Entwicklung. Website intent: no. Client budget: no (Eigenprojekt).
- Why: Antwort des Nutzers (Einbettung: nein); Website und Budget als Voreinstellung angenommen (Eigenprojekt, „wie Hotelsoftware“ ohne Website-Bezug).
- Alternatives rejected (and why): –
- Supersedes: none

## D-010 – Aktueller Stand ist `Finance.js`
- Date / phase: 2026-11-27 / Adoption
- Decision: `Finance.js` (intern „Depotbestand“ v3.31) ist der aktuelle Stand des Projekts. Der gelöschte `comdirect Manager.js` (v4.2.5, Commit cd25fd0) ist überholt; die README beschreibt noch ihn (Lücke, siehe `docs/04-adoption-audit.md`).
- Why: Aussage des Nutzers vom 27.11.2026.
- Alternatives rejected (and why): –
- Supersedes: none
