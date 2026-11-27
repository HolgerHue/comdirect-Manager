# Keel-Abgleich (MANIFEST Table 1, Keel v7.5.0)

> Erzeugt bei der Übernahme am 27.11.2026 aus `MANIFEST.md`, Platte und `docs/decisions.md`. Stand: Phasen 1–4 adopted, Phase 5 offen.
> Zeilen für spätere Phasen (6–8) sind `n/a` mit „Phase noch nicht erreicht“ und werden dort neu bewertet.

| Requirement (MANIFEST Table 1) | State | Where / decision | Notes |
|---|---|---|---|
| docs/PROGRESS.md | present | docs/PROGRESS.md | — |
| docs/decisions.md | present | docs/decisions.md | — |
| docs/lessons-learned.md | present | docs/lessons-learned.md | — |
| docs/sessions.md | present | docs/sessions.md | — |
| scripts/keel-time | present | scripts/keel-time | Kopie Hotelsoftware (D-008) |
| scripts/keel-clock | present | scripts/keel-clock | byte-gleich mit keel_clock.py (cmp) |
| docs/.keel/clock.jsonl | present | gerätelokal, gitignored | — |
| Off-machine durability | present | origin github.com/HolgerHue/comdirect-Manager | — |
| Clean working tree at block close | present | Commit je Scheibe | — |
| CLAUDE.md + AGENTS.md | present | Wurzel | gleicher Block (keel-verify) |
| GEMINI.md | n/a | — | Gemini CLI nicht im Einsatz |
| .claude/skills/keel/ + .agents/skills/keel/ | declined | D-009 | — |
| docs/00-competitive-landscape.md | declined | D-012 | — |
| docs/01-discovery.md | present | docs/01-discovery.md | as-built |
| docs/estimate.md | present | docs/estimate.md | — |
| docs/token-ledger.md | present | docs/token-ledger.md | — |
| docs/02-functional-spec.md | present | docs/02-functional-spec.md | as-built |
| docs/03-technical-plan.md | present | docs/03-technical-plan.md | mit Änderungsplan |
| docs/threat-model.md | present | docs/threat-model.md | S-006 |
| docs/flows/ | present | docs/flows/ | 3 Abläufe |
| docs/budget.md | n/a | Client budget: no (D-009) | — |
| docs/spec-references/ | n/a | — | Spec nennt keine |
| docs/rubrics/ | n/a | — | keine Rubrik angenommen |
| docs/design/references/ | n/a | — | Nutzer hat keine |
| Assistant rules | declined | D-013 | — |
| Assistant subagents | declined | D-013 | — |
| docs/design/DESIGN-BRIEF.md | n/a | Phase 3 adopted as-built | UI vor Keel, Grundlinie = Ist-Aussehen |
| docs/design/design-handoff/ | n/a | Phase 4 adopted as-built | wie oben |
| docs/BUILD-SPEC.md | n/a | Phase 4 adopted as-built | kein rückwirkender BUILD-SPEC (adoption.md §4) |
| docs/design/design-requests/ | n/a | — | noch keine Design Request |
| .gitignore + .gitattributes | present | Wurzel | — |
| docs/sprints/ | present | docs/sprints/ | — |
| docs/sprints/deferred.md | present | docs/sprints/deferred.md | — |
| docs/.keel/plan.json | present | docs/.keel/plan.json | — |
| scripts/keel-parallel | n/a | Parallel development: off (D-005) | — |
| docs/.keel/parallel/ | n/a | D-005 | — |
| docs/.keel/slices/ | n/a | D-005 | — |
| docs/05-test-points.md | present | docs/05-test-points.md | — |
| docs/api/INDEX.md | present | docs/api/INDEX.md | 80 Aktionen, von keel-verify geprüft |
| docs/keel-conformance.md | present | diese Datei | — |
| docs/playground.md | present | docs/playground.md | Echtlauf nur iOS |
| scripts/keel-verify | present | scripts/keel-verify | — |
| scripts/playground-tunnel | n/a | — | niemand ruft das Projekt von außen auf |
| scripts/keel-site | n/a | Playground host: none | — |
| scripts/keel-affected-tests | present | scripts/keel-affected-tests | node --check, node --test, keel-verify |
| .githooks/pre-push + core.hooksPath | present | .githooks/pre-push | hooksPath je Klon setzen (keel-doctor) |
| scripts/keel-doctor | present | scripts/keel-doctor | — |
| scripts/ build/minify | n/a | — | keine minifizierten Dateien (Datei geht so nach Scriptable) |
| scripts/keel-handoff-verify | present | scripts/keel-handoff-verify | — |
| Single-lane lock | n/a | Chaining: off (D-005) | — |
| scripts/keel-tools/ | n/a | Chaining: off | — |
| scripts/keel-continue | n/a | Chaining: off | — |
| scripts/keel-close | present | scripts/keel-close | — |
| .githooks/post-commit + core.hooksPath | present | .githooks/post-commit | — |
| scripts/keel-stop-hook + Stop-Registrierung | present | .claude/settings.json (D-011) | Probelauf blockiert bei offenem Baum |
| scripts/keel-session-pid.sh | present | scripts/keel-session-pid.sh | — |
| scripts/keel-chain-check | n/a | Chaining: off | — |
| Chaining model: line | n/a | Chaining: off | — |
| Chain verified: line | n/a | Chaining: off | — |
| .githooks/pre-commit | present | .githooks/pre-commit (D-011) | Negativprobe gestoppt |
| Permission allow-lists | declined | D-013 | — |
| CI workflow | declined | D-013 | — |
| MCP registration | n/a | — | Plan nennt keine MCP-Server |
| docs/architecture.md | n/a | Phase 6 noch nicht erreicht | — |
| docs/api/, docs/usage/, docs/reference/ | n/a | Phase 6 noch nicht erreicht | INDEX vorhanden |
| docs/security.md | n/a | Phase 6 noch nicht erreicht | — |
| docs/accessibility.md | n/a | Phase 6 noch nicht erreicht | — |
| README.md | present | README.md | veraltet (G-01) |
| guide/ | n/a | Phase 6 noch nicht erreicht | — |
| guide/_theme/ | n/a | Phase 6 noch nicht erreicht | — |
| docs/07-release.md | n/a | Phase 7 noch nicht erreicht | — |
| docs/security-audit.md | n/a | Phase 7 noch nicht erreicht | Security audit: required |
| docs/security-audit/ in .gitignore | n/a | noch kein Audit gelaufen | — |
| Phase-8-Zeilen (site-docs, art-direction, art-ledger, launch-report, operations) | n/a | Website intent: no (D-009) | — |
| docs/.keel/e2e-status.json | n/a | kein E2E: Befehl | — |
| docs/.keel/e2e-history.jsonl | n/a | kein E2E | — |
| docs/issues.md | n/a | — | Forge-Issues noch nicht abgerufen (GitHub-Anbindung in dieser Sitzung getrennt) |
| docs/old/ | n/a | — | noch kein Sprint-Abschluss mit Archiv |
| docs/04-adoption-audit.md | present | docs/04-adoption-audit.md | S-006 |
| CLAUDE_CODE_EXPERIMENTAL_AGENTS_TEAMS | declined | D-005, D-011 | Projektregel: keine Agent-Teams |
| Parallel development: auto; max_workers | n/a | Parallel development: off | — |
