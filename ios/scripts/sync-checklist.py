#!/usr/bin/env python3
"""Bundle the reviewed 93-step source without a runtime network dependency."""
import hashlib
import json
import re
from pathlib import Path

root = Path(__file__).resolve().parents[2]
source = json.loads((root / "docs/gorev-referansi.json").read_text())
groups = {}
for row in source["checklist"]["tasks"]:
    stage = row["stage"].strip()
    if stage not in groups:
        groups[stage] = {
            "id": "group-" + hashlib.sha256(stage.encode()).hexdigest()[:12],
            "title": re.sub(r"^\d+\.\s*", "", stage).replace("Whatsapp", "WhatsApp"),
            "items": [],
        }
    groups[stage]["items"].append({
        "id": f"step-row-{row['sourceRow']}",
        "code": row["sourceTaskId"],
        "title": row["task"],
        "criterion": row["completionCriterion"],
        "input": row["hotelInput"],
        "department": row["responsibleRole"],
        "priority": {"Kritik": 1, "Yüksek": 3}.get(row["priority"], 5),
    })

destination = root / "ios/DGTLFACEChecklist/Resources/checklist.json"
destination.parent.mkdir(parents=True, exist_ok=True)
destination.write_text(json.dumps({
    "schemaVersion": 1,
    "title": "DGTLFACE İş Listesi",
    "groups": list(groups.values()),
}, ensure_ascii=False, indent=2) + "\n")
print(f"{sum(len(g['items']) for g in groups.values())} işlem, {len(groups)} grup hazırlandı.")
