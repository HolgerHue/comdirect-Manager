---
{
  "schema": "keel.sprint/1",
  "sprint": 0,
  "goal": "Keel-Übernahme (Adoption) des comdirect-Managers, ohne Codeänderung",
  "status": "in-progress",
  "slices": [
    {"id": "S-001", "title": "Bestandsaufnahme (nur lesen)", "status": "done", "original_hours": 0.25, "residual_hours": 0, "change_kind": "added", "parent_slice": null, "owns": ["ADOPT-1"], "estimate_changes": [], "actual_hours": 0.25, "actual_source": "estimated", "depends_on": [], "criteria": ["ADOPT-1"]},
    {"id": "S-002", "title": "Zustandsdateien, Portabilitäts-Sperre, Plan, Zeitmessung", "status": "done", "original_hours": 0.75, "residual_hours": 0, "change_kind": "added", "parent_slice": null, "owns": ["ADOPT-2"], "estimate_changes": [], "depends_on": ["S-001"], "criteria": ["ADOPT-2"], "actual_hours": 0.02, "actual_source": "measured"},
    {"id": "S-003", "title": "01-discovery, 02-functional-spec, 03-technical-plan, api/INDEX als Ist-Stand", "status": "done", "original_hours": 1.5, "residual_hours": 0, "change_kind": "added", "parent_slice": null, "owns": ["ADOPT-4"], "estimate_changes": [], "depends_on": ["S-002"], "criteria": ["ADOPT-4"], "actual_hours": 0.03, "actual_source": "measured"},
    {"id": "S-004", "title": "Keel-Werkzeugskripte und Git-Hooks", "status": "not-started", "original_hours": 0.75, "residual_hours": 0.75, "change_kind": "added", "parent_slice": null, "owns": ["ADOPT-2b"], "estimate_changes": [], "depends_on": ["S-002"], "criteria": ["ADOPT-2b"]},
    {"id": "S-005", "title": "Abgleich gegen MANIFEST (keel-conformance.md)", "status": "not-started", "original_hours": 0.75, "residual_hours": 0.75, "change_kind": "added", "parent_slice": null, "owns": ["ADOPT-4a"], "estimate_changes": [], "depends_on": ["S-003", "S-004"], "criteria": ["ADOPT-4a"]},
    {"id": "S-006", "title": "Lückenprüfung (04-adoption-audit.md), Selbstprüfung Fallen, Bedrohungsmodell", "status": "not-started", "original_hours": 1.5, "residual_hours": 1.5, "change_kind": "added", "parent_slice": null, "owns": ["ADOPT-5"], "estimate_changes": [], "depends_on": ["S-005"], "criteria": ["ADOPT-5"]},
    {"id": "S-007", "title": "Abschluss: Commit, Übergabe", "status": "not-started", "original_hours": 0.25, "residual_hours": 0.25, "change_kind": "added", "parent_slice": null, "owns": ["ADOPT-6"], "estimate_changes": [], "depends_on": ["S-006"], "criteria": ["ADOPT-6"]}
  ]
}
---

# Sprint 0 – Keel-Übernahme

- **Abnahme:** Definition of Done aus `references/adoption.md` Punkt für Punkt erfüllt und dem Nutzer als Liste gemeldet.
- **Hinweise:** Die Übernahme ändert keinen Code. Stunden sind KI-Arbeitszeit plus Begleitzeit des Nutzers. S-001 lief vor der Zeitmessung und ist daher geschätzt (`actual_source: estimated`).
- **Format:** Der Kopf ist JSON, also gültiges YAML; so lesen ihn die Keel-Skripte ohne Zusatzbibliothek (D-008).
