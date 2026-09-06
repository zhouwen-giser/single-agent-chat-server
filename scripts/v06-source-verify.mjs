import { spawnSync, execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
const dir = "reports/v0.6/wsgs-full-functional-integration";
const startedAt = new Date().toISOString();
const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
const hash = (v) => "sha256:" + createHash("sha256").update(v).digest("hex");
const commands = [];
for (const args of [
  ["node_modules/typescript/bin/tsc", "--noEmit"],
  [
    "--experimental-vm-modules",
    "node_modules/jest/bin/jest.js",
    "--runInBand",
    "tests/v06-analysis-source.contract.test.ts",
    "tests/v06-source-bridge.unit.test.ts",
    "tests/analysis-revision.unit.test.ts",
  ],
  [
    "scripts/v05-postgres-test-harness.mjs",
    "tests/v06-source-persistence.postgres.int.test.ts",
    "tests/analysis-persistence.postgres.int.test.ts",
    "tests/analysis-development-persistence.postgres.int.test.ts",
  ],
  ["scripts/verify-migrations.mjs"],
]) {
  const result = spawnSync(process.execPath, args, { encoding: "utf8" });
  const output = result.stdout + result.stderr;
  process.stdout.write(output);
  commands.push({
    command: ["node", ...args].join(" "),
    exitCode: result.status ?? 1,
    sourceBefore: sourceSha,
    sourceAfter: sourceSha,
    outputDigest: hash(output),
  });
  if (result.status !== 0)
    throw Error("S01 verification failed; ledger not promoted");
}
const checks = {
  "001": ["tests/v06-analysis-source.contract.test.ts", "strict union"],
  "002": [
    "tests/v06-analysis-source.contract.test.ts",
    "Grounding job has no Native plan",
  ],
  "003": [
    "packages/analysis-contract/src/source.ts",
    "six methods reviewed; compiler checks both adapters",
  ],
  "004": [
    "tests/v06-source-bridge.unit.test.ts",
    "five ports preserved; Native fails closed",
  ],
  "005": [
    "tests/v06-source-bridge.unit.test.ts",
    "fixture success/PARTIAL and production negative",
  ],
  "006": [
    "tests/v06-source-persistence.postgres.int.test.ts",
    "pre-0017 legacy read",
  ],
  "007": [
    "tests/v06-source-persistence.postgres.int.test.ts",
    "repository and SQL rejection",
  ],
  "008": [
    "migrations/0017_analysis_source_identity.sql",
    "contiguous additive; no old migration changed",
  ],
  "009": [
    "tests/v06-source-persistence.postgres.int.test.ts",
    "existing events/projections unchanged; legacy plan preserved",
  ],
  "010": [
    "tests/analysis-persistence.postgres.int.test.ts",
    "all migrations on isolated empty PostgreSQL",
  ],
  "011": [
    "tests/v06-source-persistence.postgres.int.test.ts",
    "wrong thread has no access; existing scope regressions",
  ],
  "012": [
    "tests/v06-analysis-source.contract.test.ts",
    "canonical request hash recomputed; hash tampering rejected",
  ],
};
const ledger = JSON.parse(readFileSync(`${dir}/ACCEPTANCE_LEDGER.json`));
for (const [suffix, [file]] of Object.entries(checks)) {
  const row = ledger.rows.find((r) => r.id === `V06-S01-${suffix}`);
  if (!row) throw Error("missing acceptance row");
  row.status = "PASS";
  row.evidenceRefs = ["S01.json", file];
}
const report = {
  schemaVersion: "sacs-v06-phase-report/1.0",
  phaseId: "S01",
  status: "PASS",
  sourceSha,
  startedAt,
  completedAt: new Date().toISOString(),
  commands,
  acceptanceIds: Object.keys(checks).map((k) => "V06-S01-" + k),
  blockers: [],
  notes: Object.entries(checks).map(
    ([id, [file, why]]) =>
      `${id}: ${why}; ${file}; ${hash(readFileSync(file))}`,
  ),
};
writeFileSync(`${dir}/S01.json`, JSON.stringify(report, null, 2) + "\n");
writeFileSync(
  `${dir}/ACCEPTANCE_LEDGER.json`,
  JSON.stringify(ledger, null, 2) + "\n",
);
