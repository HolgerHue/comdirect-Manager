# PROGRESS – comdirect-Manager

> Lebender Zustand. In jeder Sitzung ZUERST lesen. Aktuell und kurz halten.
> Keel-Übernahme vom 27.11.2026; Projektregeln in `../CLAUDE.md` haben Vorrang (D-001).

## Project card
- Name / one-line purpose: comdirect-Manager – Scriptable-App „Depotbestand“ für iPhone/iPad: Depots aus der comdirect-API, Kurse, Analyse, Dividenden, Sparplan sowie Finanzreports, Steuer (Anlage KAP) und Postbox aus den comdirect-PDFs
- Project type: web app (Scriptable-App mit HTML-WebView) / none
- Stack & target platform(s): JavaScript in Scriptable (iOS/iPadOS), Oberfläche als HTML in einer WebView, pdf.js 3.11.174, Daten in iCloud Drive, Zugangsdaten in der iOS-Keychain (`docs/03-technical-plan.md`)
- License: offen – README nennt GPL-3.0-or-later (Postbox) + CC BY-NC-SA 4.0 (Finanzteil); keine LICENSE-Datei, Dateiköpfe ohne Lizenz (Lücke G-03)
- Docs language: Deutsch (D-002)
- Security profile: references/security/web-app.md
- Security audit: required – Bankzugang (OAuth2 + photoTAN), echte Finanzdaten, API-Schlüssel (Anthropic) in der Keychain
- Accessibility: WCAG 2.2 AA für die WebView-Seiten (references/accessibility.md, Web + iOS) – Ist-Stand ungeprüft
- i18n: single – Deutsch (adopted as-is, D-007)
- Installed base: in Betrieb mit echten Daten (D-006)
- Design system: existing – Apple-UI mit „Liquid Glass“, hell/dunkel/System (im Code, keine Design-Quelle)
- Keel portability: lock only (`CLAUDE.md`, `AGENTS.md`), nicht eingebettet (D-009)
- Assistant config: none (tools: claude) – D-013; Pre-commit-Prüfung aktiv (D-011)
- E2E: n/a – läuft nur in Scriptable; Prüfung hier nur `node --check` (Syntax)
- CI runs on: none
- Models: n/a (die App selbst ruft die Anthropic-API mit dem Schlüssel des Nutzers)
- Keel baseline: v7.5.0
- Website intent: no (D-009)
- Client budget: no (D-009)
- User guide: n/a bis Phase 6 (Anleitung (?) in der App vorhanden)
- Docs theme: n/a bis Phase 6
- Test-first policy: pure-logic (D-007), nicht rückwirkend
- Push test scope: affected
- Parallel development: off (D-005)
- Playground host: none – Scriptable gibt es nur auf iOS; Ersatz: `node --check` und künftig Node-Tests reiner Funktionen (Lücke G-05)
- Sprints: on
- Durability: git remote origin https://github.com/HolgerHue/comdirect-Manager
- Autonomy: not automatic – Keel fragt und pusht nur auf ausdrückliche Anweisung / issues: after-sprint / Issue sweep interval: 24h / Issue capture: on (D-003)
- Branches: kein `develop`; Feature-Branch → `main` per Pull Request, Merge nur durch/auf Anweisung des Nutzers (D-004) – aktuell `claude/elegant-archimedes-tm9byp`
- Notify: PushNotification – Claude-App des Nutzers (D-005)
- Chaining: off (D-005)
- Chaining model: n/a
- Chain verified: n/a

## Phase status
| Phase | Status | Key artifacts |
|-------|--------|---------------|
| 1 Discovery | adopted (as-built) | docs/01-discovery.md |
| 2 Functional spec | adopted (as-built) | docs/02-functional-spec.md, docs/03-technical-plan.md, docs/flows/, docs/threat-model.md |
| 3 Design handoff | adopted (as-built) – UI vor Keel, aktuelles Aussehen ist die Grundlinie, kein BUILD-SPEC | – |
| 4 Faithful build | adopted (as-built) – siehe Phase 3 | – |
| 5 Development | pending | docs/sprints/ |
| 6 Documentation | pending | – |
| 7 Release | pending | – |
| 8 Website | n/a (D-009) | – |

## Current position
- Phase: Adoption — Sprint 0, Scheibe S-007 (Abschluss)
- Next action: Einordnung der Lücken G-01–G-11 durch den Nutzer (`docs/04-adoption-audit.md`), dann Sprint 1 planen

## Open items
- Unresolved user questions: Einordnung G-01–G-11; Lizenz (G-03); Kategorien-Editor umstellen oder entfernen (G-02)
- Open Design Requests: none
- Unverified external steps/assets: Verhalten in Scriptable (hier nicht ausführbar)
- Forge issues in progress: none
- Unpushed local commits: siehe `git log origin/claude/elegant-archimedes-tm9byp..`

### Deferred items (consciously postponed work)
- none

Last updated: 2026-11-27 – Keel-Übernahme begonnen
