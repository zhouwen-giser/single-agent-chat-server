#!/usr/bin/env python3
from pathlib import Path
import csv, json, re, sys
root=Path(__file__).resolve().parents[1]
errors=[]
required=[
"README.md","CODEX_MASTER_PROMPT.md","TASK_INDEX.md",
"00_WAIT_GATE_AND_BOOTSTRAP.md","01_SOURCE_REFERENCE_POLICY.md",
"02_PRODUCT_SCOPE_AND_NON_GOALS.md","03_TARGET_ARCHITECTURE.md",
"04_UNIFIED_INTERACTION_EVENT_CONTRACT.md","05_OPENAI_COMPATIBILITY_POLICY.md",
"06_AGUI_PROTOCOL_PROFILE.md","07_A2A_TO_AGUI_MAPPING.md",
"08_QUERY_AND_AUTHORIZATION.md","09_INTERRUPT_RESUME_CONTRACT.md",
"10_PERSISTENCE_MIGRATION_PLAN.md","11_SECURITY_IDENTITY_PRIVACY.md",
"12_GIT_GITHUB_DELIVERY_POLICY.md","13_TEST_EVIDENCE_RELEASE_POLICY.md",
"14_FINAL_PR_MERGE_POLICY.md","references/SOURCES.md",
"contracts/interaction-event.schema.json","contracts/interaction-request.schema.json",
"contracts/agui-public-state.schema.json","contracts/goal-state.schema.json",
"contracts/a2a-agui-mapping.csv","contracts/acceptance-matrix.csv",
"scripts/preflight-wait-gate.sh"]
for rel in required:
    if not (root/rel).exists(): errors.append("missing "+rel)
for i in range(15):
    rel=f"phases/P{i:02d}.md"
    if not (root/rel).exists(): errors.append("missing "+rel)
for p in root.glob("contracts/*.json"):
    try: json.loads(p.read_text(encoding="utf-8"))
    except Exception as e: errors.append(f"invalid json {p.name}: {e}")
try:
    rows=list(csv.reader((root/"contracts/acceptance-matrix.csv").open(encoding="utf-8")))
    if len(rows)!=23: errors.append(f"expected 22 acceptance cases, got {len(rows)-1}")
except Exception as e: errors.append(f"acceptance csv: {e}")
texts=[]
for p in root.rglob("*"):
    if p.is_file() and p.suffix.lower() in {".md",".sh",".yaml",".yml",".json",".csv"}:
        texts.append(p.read_text(encoding="utf-8",errors="ignore"))
all_text="\n".join(texts)
for pat in [r"git\s+push\s+--force",r"git\s+push\s+-f\b",r"gh\s+pr\s+merge[^\n]*--admin"]:
    if re.search(pat,all_text): errors.append("unsafe instruction: "+pat)
for required_text in [
"WAITING_FOR_SACS_PHASE13_MAIN",
"feature/sacs-v0.2-agui-interaction-gateway",
"@ag-ui/a2a","Experimental","Run","Task",
]:
    if required_text not in all_text: errors.append("missing concept: "+required_text)
if errors:
    for e in errors: print("ERROR:",e)
    sys.exit(1)
print("TASK_PACKAGE_OK")
print("phases=15")
print("acceptance_cases=22")
print("waiting_gate=mandatory")
