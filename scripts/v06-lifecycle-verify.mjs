import { spawnSync, execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
const dir = "reports/v0.6/wsgs-full-functional-integration";
const startedAt = new Date().toISOString();
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const sourceSha = git("rev-parse", "HEAD");
const hash = (value) =>
  "sha256:" + createHash("sha256").update(value).digest("hex");
const commands = [];
const argsList = [
  ["node_modules/typescript/bin/tsc", "--noEmit"],
  [
    "node_modules/eslint/bin/eslint.js",
    "apps",
    "packages",
    "src",
    "tests",
    "scripts",
  ],
  ["scripts/verify-architecture.mjs"],
  ["scripts/verify-migrations.mjs"],
  [
    "--experimental-vm-modules",
    "node_modules/jest/bin/jest.js",
    "--runInBand",
    "tests/v06-grounding-job.contract.test.ts",
    "tests/v06-world-analysis-view.unit.test.ts",
    "tests/v06-analysis-config.unit.test.ts",
    "tests/world-grounding-runtime.unit.test.ts",
    "tests/v05-analysis-development-runtime.unit.test.ts",
    "tests/wsgs-http-adapter.contract.test.ts",
    "tests/openai-api.contract.test.ts",
  ],
  [
    "scripts/v05-postgres-test-harness.mjs",
    "tests/v06-grounding-lifecycle.postgres.int.test.ts",
    "tests/v06-source-persistence.postgres.int.test.ts",
    "tests/grounding-persistence.postgres.int.test.ts",
    "tests/v06-analysis-local.e2e.test.ts",
  ],
];
for (const [i, args] of argsList.entries()) {
  const result = spawnSync(process.execPath, args, {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  const output = result.stdout + result.stderr;
  process.stdout.write(output);
  const path = `${dir}/S03-command-${i + 1}.log`;
  writeFileSync(path, output);
  commands.push({
    command: ["node", ...args].join(" "),
    exitCode: result.status ?? 1,
    sourceBefore: sourceSha,
    sourceAfter: git("rev-parse", "HEAD"),
    outputDigest: hash(output),
    evidencePaths: [path],
  });
  if (result.status !== 0)
    throw Error("S03 verification failed; acceptance ledger unchanged");
}
const coverage = {
  "001": [
    "tests/v06-grounding-lifecycle.postgres.int.test.ts",
    "persists exact intent before network",
  ],
  "002": [
    "tests/v06-grounding-job.contract.test.ts",
    "bounded polling and semantic changes",
  ],
  "003": [
    "tests/v06-grounding-lifecycle.postgres.int.test.ts",
    "concurrent waits and terminal source result",
  ],
  "004": [
    "tests/world-grounding-runtime.unit.test.ts",
    "answerWorld regression; OpenAI API contract",
  ],
  "005": [
    "tests/v06-grounding-lifecycle.postgres.int.test.ts",
    "atomically binds a scoped revision/run",
  ],
  "006": [
    "tests/v06-grounding-lifecycle.postgres.int.test.ts",
    "one shared pump for ten concurrent ensure calls",
  ],
  "007": [
    "tests/v06-grounding-lifecycle.postgres.int.test.ts",
    "deduplicates observations; health polls do not append events",
  ],
  "008": [
    "tests/v06-grounding-lifecycle.postgres.int.test.ts",
    "post-send/pre-bind crash and cancelled intent recovery",
  ],
  "009": [
    "tests/v06-grounding-lifecycle.postgres.int.test.ts",
    "stale run rejected by active source/run guard",
  ],
  "010": [
    "tests/v06-grounding-lifecycle.postgres.int.test.ts",
    "rejects terminal reopening",
  ],
  "011": [
    "tests/v06-grounding-lifecycle.postgres.int.test.ts",
    "fences cancellation before dispatch; lost response stays requested",
  ],
  "012": [
    "tests/v06-analysis-local.e2e.test.ts",
    "full canonical snapshot after source transitions and reconnect",
  ],
  "013": [
    "tests/v06-analysis-local.e2e.test.ts",
    "foreign-user snapshot 404; scoped repository tests",
  ],
};
const sourcePaths = git(
  "ls-files",
  "--cached",
  "--others",
  "--exclude-standard",
)
  .split("\n")
  .filter(
    (path) =>
      /^(apps|packages|tests|scripts|migrations)\//u.test(path) &&
      /\.(ts|mjs|sql)$/u.test(path),
  )
  .sort();
const sourceDigests = Object.fromEntries(
  sourcePaths.map((path) => [path, hash(readFileSync(path))]),
);
writeFileSync(
  `${dir}/S03-source-digests.json`,
  JSON.stringify(sourceDigests, null, 2) + "\n",
);
const notes = [
  "Coverage is LOCAL only. The HTTP upstream in local E2E is simulated and is not real WSGS evidence.",
  "Includes foundations for S04/S05/S07, which are not promoted to phase completion. Source revision/choice control remains unavailable pending S06.",
  `Source files digest: ${hash(JSON.stringify(sourceDigests))}`,
  ...Object.entries(coverage).map(
    ([id, [file, detail]]) => `V06-S03-${id}: ${file}: ${detail}`,
  ),
];
writeFileSync(
  `${dir}/S03.json`,
  JSON.stringify(
    {
      schemaVersion: "sacs-v06-phase-report/1.0",
      phaseId: "S03",
      status: "PASS",
      sourceSha,
      startedAt,
      completedAt: new Date().toISOString(),
      commands,
      acceptanceIds: Object.keys(coverage).map((id) => "V06-S03-" + id),
      blockers: [],
      notes,
    },
    null,
    2,
  ) + "\n",
);
const ledger = JSON.parse(readFileSync(`${dir}/ACCEPTANCE_LEDGER.json`));
for (const [id, [file]] of Object.entries(coverage)) {
  const row = ledger.rows.find((row) => row.id === "V06-S03-" + id);
  row.status = "PASS";
  row.evidenceRefs = ["S03.json", "S03-source-digests.json", file];
  row.verifiedAt = new Date().toISOString();
}
ledger.sourceSha = sourceSha;
ledger.updatedAt = new Date().toISOString();
writeFileSync(
  `${dir}/ACCEPTANCE_LEDGER.json`,
  JSON.stringify(ledger, null, 2) + "\n",
);
const status = JSON.parse(readFileSync(`${dir}/PROGRESSIVE_STATUS.json`));
status.sourceSha = sourceSha;
status.updatedAt = new Date().toISOString();
status.markers = [
  ...new Set([...status.markers, "SACS_V06_OBSERVED_GROUNDING_RUNTIME_READY"]),
];
writeFileSync(
  `${dir}/PROGRESSIVE_STATUS.json`,
  JSON.stringify(status, null, 2) + "\n",
);
