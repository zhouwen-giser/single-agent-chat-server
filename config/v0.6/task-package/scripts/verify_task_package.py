#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import sys
from collections import Counter
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]

def fail(message: str) -> None:
    raise SystemExit(f"TASK_PACKAGE_INVALID: {message}")

def load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        fail(f"{path.relative_to(ROOT)}: {exc}")

def sha256(path: Path) -> str:
    return "sha256:" + hashlib.sha256(path.read_bytes()).hexdigest()

def canonical_hash(value: Any) -> str:
    payload = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return "sha256:" + hashlib.sha256(payload).hexdigest()

def main() -> None:
    required = [
        "README.md",
        "CODEX_GOAL_PROMPT.md",
        "SACS_V0.6_WSGS_FULL_FUNCTIONAL_INTEGRATION_GOAL.md",
        "DESIGN_BASELINE.md",
        "ARCHITECTURE_DECISIONS.md",
        "PRODUCT_BOUNDARY.md",
        "SOURCE_BASELINE.json",
        "PACKAGE_MANIFEST.json",
        "acceptance/acceptance-matrix.json",
        "acceptance/e2e-cases.json",
        "acceptance/required-commands.json",
        "phases/phase-plan.json",
        "CHECKSUMS.json",
    ]
    for rel in required:
        if not (ROOT / rel).is_file():
            fail(f"missing required file {rel}")

    for path in ROOT.rglob("*"):
        if path.is_symlink():
            fail(f"symlink forbidden: {path.relative_to(ROOT)}")
        rel = path.relative_to(ROOT)
        if ".." in rel.parts:
            fail(f"path traversal: {rel}")

    manifest = load_json(ROOT / "PACKAGE_MANIFEST.json")
    matrix = load_json(ROOT / "acceptance/acceptance-matrix.json")
    e2e = load_json(ROOT / "acceptance/e2e-cases.json")
    commands = load_json(ROOT / "acceptance/required-commands.json")
    plan = load_json(ROOT / "phases/phase-plan.json")
    ledger_template = load_json(ROOT / "templates/ACCEPTANCE_LEDGER.template.json")
    checksums = load_json(ROOT / "CHECKSUMS.json")

    if manifest.get("schemaVersion") != "sacs-v06-task-package/1.0":
        fail("manifest schemaVersion")
    if matrix.get("packageId") != manifest.get("packageId"):
        fail("acceptance matrix packageId mismatch")
    if e2e.get("packageId") != manifest.get("packageId"):
        fail("E2E packageId mismatch")
    if commands.get("packageId") != manifest.get("packageId"):
        fail("required commands packageId mismatch")

    phases = plan.get("phases")
    if not isinstance(phases, list):
        fail("phase plan is not a list")
    phase_ids = [item.get("id") for item in phases]
    if len(phase_ids) != len(set(phase_ids)):
        fail("duplicate phase IDs")
    if phase_ids != [f"S{i:02d}" for i in range(10)]:
        fail(f"unexpected phase order: {phase_ids}")
    for item in phases:
        phase_file = item.get("file")
        if not isinstance(phase_file, str) or not (ROOT / phase_file).is_file():
            fail(f"missing phase file for {item.get('id')}")

    # dependency DAG
    seen: set[str] = set()
    for item in phases:
        for dep in item.get("dependsOn", []):
            if dep not in seen:
                fail(f"phase {item.get('id')} depends on later/unknown {dep}")
        seen.add(item["id"])

    rows = matrix.get("rows")
    if not isinstance(rows, list) or not rows:
        fail("acceptance rows missing")
    row_ids = [row.get("id") for row in rows]
    if len(row_ids) != len(set(row_ids)):
        fail("duplicate acceptance IDs")
    for row in rows:
        if row.get("phase") not in phase_ids:
            fail(f"acceptance {row.get('id')} has unknown phase")
        expected_prefix = f"V06-{row['phase']}-"
        if not str(row.get("id")).startswith(expected_prefix):
            fail(f"acceptance ID/phase mismatch: {row.get('id')}")
        if not row.get("evidenceRequired"):
            fail(f"acceptance lacks evidence type: {row.get('id')}")

    cases = e2e.get("cases")
    if not isinstance(cases, list) or not cases:
        fail("E2E cases missing")
    case_ids = [case.get("id") for case in cases]
    if len(case_ids) != len(set(case_ids)):
        fail("duplicate E2E case IDs")
    for case in cases:
        if case.get("phase") not in phase_ids:
            fail(f"E2E {case.get('id')} has unknown phase")
        if not case.get("steps") or not case.get("assertions"):
            fail(f"E2E {case.get('id')} lacks steps/assertions")

    command_names = [item.get("name") for item in commands.get("commands", [])]
    if len(command_names) != len(set(command_names)):
        fail("duplicate required command names")
    expected_commands = {
        "pnpm test:v06:contracts",
        "pnpm test:v06:unit",
        "pnpm test:v06:postgres",
        "pnpm test:v06:local-e2e",
        "pnpm check:v06:integration-readiness",
        "pnpm test:v06:real-wsgs",
        "pnpm verify:v06:development",
        "pnpm verify:v06:integration",
        "pnpm verify:v06:release",
        "pnpm verify:v06",
        "pnpm verify:v06:evidence",
    }
    if set(command_names) != expected_commands:
        fail("required command inventory drift")

    ledger_rows = ledger_template.get("rows")
    if not isinstance(ledger_rows, list):
        fail("ledger template rows missing")
    ledger_ids = [row.get("id") for row in ledger_rows]
    if ledger_ids != row_ids:
        fail("ledger template does not exactly match acceptance matrix order")

    inventory = manifest.get("inventory", {})
    actual_counts = {
        "phaseCount": len(phases),
        "acceptanceRowCount": len(rows),
        "e2eCaseCount": len(cases),
        "schemaCount": len(list((ROOT / "schemas").glob("*.json"))),
        "templateCount": len(list((ROOT / "templates").iterdir())),
        "contractCount": len(list((ROOT / "contracts").glob("*.md"))),
    }
    if inventory != actual_counts:
        fail(f"manifest inventory mismatch: expected {inventory}, actual {actual_counts}")

    listed = checksums.get("files")
    if not isinstance(listed, list):
        fail("CHECKSUMS files missing")
    listed_map = {entry.get("path"): entry.get("sha256") for entry in listed}
    if len(listed_map) != len(listed):
        fail("duplicate CHECKSUMS path")
    actual_files = sorted(
        str(path.relative_to(ROOT)).replace("\\", "/")
        for path in ROOT.rglob("*")
        if path.is_file() and path.name != "CHECKSUMS.json"
    )
    if sorted(listed_map) != actual_files:
        missing = sorted(set(actual_files) - set(listed_map))
        extra = sorted(set(listed_map) - set(actual_files))
        fail(f"checksum inventory drift missing={missing} extra={extra}")
    actual_map: dict[str, str] = {}
    for rel in actual_files:
        actual = sha256(ROOT / rel)
        actual_map[rel] = actual
        if listed_map[rel] != actual:
            fail(f"checksum mismatch: {rel}")
    if checksums.get("bundleHash") != canonical_hash(actual_map):
        fail("bundleHash mismatch")

    phase_counts = Counter(row["phase"] for row in rows)
    track_counts = Counter(row["track"] for row in rows)
    output = {
        "status": "PASS",
        "packageId": manifest["packageId"],
        "packageVersion": manifest["packageVersion"],
        "bundleHash": checksums["bundleHash"],
        "fileCount": len(actual_files) + 1,
        "phaseCount": len(phases),
        "acceptanceRowCount": len(rows),
        "e2eCaseCount": len(cases),
        "phaseCounts": dict(sorted(phase_counts.items())),
        "trackCounts": dict(sorted(track_counts.items())),
    }
    print(json.dumps(output, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    main()
