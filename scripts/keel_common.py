"""Gemeinsame Helfer für die Keel-Skripte dieses Projekts (nur Standardbibliothek).

Die Sprint-Dateien tragen ihren Kopf als JSON zwischen zwei ``---``-Zeilen (gültiges YAML,
D-012). Dieses Modul liest und schreibt diese Köpfe und erzeugt ``docs/.keel/plan.json``.
"""

from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path

PROJECT = Path(__file__).resolve().parent.parent
DOCS = PROJECT / "docs"
SPRINTS = DOCS / "sprints"
KEEL = DOCS / ".keel"
PLAN_JSON = KEEL / "plan.json"
CLOCK = KEEL / "clock.jsonl"
SESSIONS = DOCS / "sessions.md"
PROGRESS = DOCS / "PROGRESS.md"
STATUSES = {"not-started", "in-progress", "done", "dropped"}
UNIT = "hours of AI working time plus supervision"


def repo_root() -> Path:
    out = subprocess.run(  # noqa: S603 - feste Argumente, kein Fremdeingang
        ["git", "-C", str(PROJECT), "rev-parse", "--show-toplevel"],  # noqa: S607
        capture_output=True,
        text=True,
        check=True,
    )
    return Path(out.stdout.strip())


def split_frontmatter(text: str) -> tuple[dict, str]:
    if not text.startswith("---\n"):
        raise ValueError("kein Kopf (---) am Dateianfang")
    end = text.index("\n---\n", 4)
    return json.loads(text[4:end]), text[end + 5 :]


def write_frontmatter(path: Path, data: dict, body: str) -> None:
    # Eine Zeile je Schlüssel und je Scheibe, damit Diffs lesbar bleiben.
    parts = []
    for key, value in data.items():
        if isinstance(value, list) and value and all(isinstance(v, dict) for v in value):
            inner = ",\n".join("    " + json.dumps(v, ensure_ascii=False) for v in value)
            parts.append(f"  {json.dumps(key)}: [\n{inner}\n  ]")
        else:
            parts.append(f"  {json.dumps(key)}: {json.dumps(value, ensure_ascii=False)}")
    text = "{\n" + ",\n".join(parts) + "\n}"
    json.loads(text)  # Selbstprüfung
    path.write_text("---\n" + text + "\n---\n" + body, encoding="utf-8")


def sprint_files() -> list[Path]:
    return sorted(SPRINTS.glob("sprint-*.md"), key=lambda p: int(re.findall(r"\d+", p.stem)[0]))


def load_sprints() -> list[tuple[Path, dict, str]]:
    return [(p, *split_frontmatter(p.read_text(encoding="utf-8"))) for p in sprint_files()]


def load_deferred() -> dict:
    path = SPRINTS / "deferred.md"
    if not path.exists():
        return {"items": []}
    return split_frontmatter(path.read_text(encoding="utf-8"))[0]


def find_slice(slice_id: str):
    for path, data, body in load_sprints():
        for item in data.get("slices", []):
            if item["id"] == slice_id:
                return path, data, body, item
    raise KeyError(f"Scheibe {slice_id} steht in keinem Sprint")


def card_value(label: str) -> str | None:
    if not PROGRESS.exists():
        return None
    for line in PROGRESS.read_text(encoding="utf-8").splitlines():
        m = re.match(rf"\s*-\s*{re.escape(label)}:\s*(.*)", line)
        if m:
            return m.group(1).strip()
    return None


def _num(x) -> float:
    return float(x) if isinstance(x, (int, float)) else 0.0


def build_plan() -> dict:
    sprints, all_done = [], []
    for path, data, _ in load_sprints():
        slices = data.get("slices", [])
        live = [s for s in slices if s.get("status") != "dropped"]
        done = [s for s in live if s.get("status") == "done"]
        all_done += done
        original = sum(_num(s.get("original_hours")) for s in live)
        completed = sum(_num(s.get("original_hours")) for s in done)
        sprints.append(
            {
                "sprint": data.get("sprint"),
                "goal": data.get("goal"),
                "status": data.get("status"),
                "file": str(path.relative_to(PROJECT)),
                "slices": slices,
                "original_estimated_hours": round(original, 4),
                "completed_original_hours": round(completed, 4),
                "actual_hours": round(sum(_num(s.get("actual_hours")) for s in done), 4),
                "remaining_hours": round(
                    sum(_num(s.get("residual_hours")) for s in live if s.get("status") != "done"), 4
                ),
                "percent_done": round(100 * completed / original, 1) if original else None,
            }
        )
    eligible = [
        s
        for s in all_done
        if s.get("actual_source") == "measured"
        and _num(s.get("original_hours")) > 0
        and isinstance(s.get("actual_hours"), (int, float))
    ]
    est_e = sum(_num(s["original_hours"]) for s in eligible)
    act_e = sum(_num(s["actual_hours"]) for s in eligible)
    pace = (act_e / est_e) if est_e else None
    original = sum(s["original_estimated_hours"] for s in sprints)
    completed = sum(s["completed_original_hours"] for s in sprints)
    actual = sum(s["actual_hours"] for s in sprints)
    remaining = sum(s["remaining_hours"] for s in sprints)
    totals = {
        "original_estimated_hours": round(original, 4),
        "completed_original_hours": round(completed, 4),
        "actual_hours": round(actual, 4),
        "remaining_hours": round(remaining, 4),
        "deviation_hours": round(actual - completed, 4),
        "pace_factor": round(pace, 4) if pace is not None else None,
        "pace_sample": {"slices": len(eligible), "estimated_hours": est_e, "actual_hours": act_e},
        "projected_remaining_hours": (
            0 if remaining == 0 else round(remaining * pace, 4) if pace is not None else None
        ),
        "percent_done": round(100 * completed / original, 1) if original else None,
    }
    return {
        "schema": "keel.plan/1",
        "unit": UNIT,
        "reconciliation_status": "reconciled",
        "scope_delta": {"added_scope": 0, "extraction": 0, "explicit_reestimates": 0},
        "sprints": sprints,
        "totals": totals,
        "deferred": load_deferred().get("items", []),
        "note": (
            "Generated by scripts/keel-time plan. Never edit by hand. "
            "Contingency and deferred items excluded."
        ),
    }


def write_plan() -> dict:
    plan = build_plan()
    KEEL.mkdir(parents=True, exist_ok=True)
    PLAN_JSON.write_text(json.dumps(plan, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return plan


def fmt_h(value) -> str:
    return "—" if value is None else f"{value:.2f}".rstrip("0").rstrip(".").replace(".", ",") + " h"
