---
{
  "schema": "keel.sprint/1",
  "sprint": 1,
  "goal": "Lücken „jetzt“ aus der Übernahme beheben (D-014)",
  "status": "not-started",
  "slices": [
    {"id": "S-008", "title": "G-02 Kategorien-Editor.js entfernen, Doku und INDEX anpassen", "status": "not-started", "original_hours": 0.25, "residual_hours": 0.25, "change_kind": "added", "parent_slice": null, "owns": ["G-02"], "estimate_changes": [], "depends_on": [], "criteria": ["G-02"]},
    {"id": "S-009", "title": "G-01 README auf Finance.js 3.31 (Depotbestand) umstellen", "status": "not-started", "original_hours": 0.5, "residual_hours": 0.5, "change_kind": "added", "parent_slice": null, "owns": ["G-01"], "estimate_changes": [], "depends_on": ["S-008"], "criteria": ["G-01"]},
    {"id": "S-010", "title": "G-05 Testgerüst (Node, Attrappen der Scriptable-APIs) und erste Tests: toNumber, Parser Finanzreport/Steuer, FIFO", "status": "not-started", "original_hours": 3.0, "residual_hours": 3.0, "change_kind": "added", "parent_slice": null, "owns": ["G-05"], "estimate_changes": [], "depends_on": [], "criteria": ["G-05"]},
    {"id": "S-011", "title": "G-07 Sicherheitsaudit nach references/security-audit.md (HTML-Ausgabe, Aktionen, Order)", "status": "not-started", "original_hours": 3.0, "residual_hours": 3.0, "change_kind": "added", "parent_slice": null, "owns": ["G-07"], "estimate_changes": [], "depends_on": [], "criteria": ["G-07"]}
  ]
}
---

# Sprint 1 – Lücken aus der Übernahme

- **Abnahme:** je Lücke der Beleg in `docs/04-adoption-audit.md`; `scripts/keel-verify` grün.
- **Hinweis:** Bestätigte Sicherheitsfunde aus S-011 werden eigene Scheiben, jede beginnt mit einem fehlschlagenden Test.
