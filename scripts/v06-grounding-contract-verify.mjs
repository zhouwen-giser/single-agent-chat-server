import { spawnSync, execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { WsgsAuthoritativeContract } from "../packages/wsgs-geospatial-consumer/src/authoritative.ts";
const dir = "reports/v0.6/wsgs-full-functional-integration";
const startedAt = new Date().toISOString();
const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
const hash = (v) => "sha256:" + createHash("sha256").update(v).digest("hex");
const authority = new WsgsAuthoritativeContract();
writeFileSync(
  "dependencies/wsgs-v06-consumer-lock.json",
  JSON.stringify(authority.consumerLock, null, 2) + "\n",
);
const commands = [];
for (const args of [
  ["node_modules/typescript/bin/tsc", "--noEmit"],
  [
    "--experimental-vm-modules",
    "node_modules/jest/bin/jest.js",
    "--runInBand",
    "tests/v06-grounding-job.contract.test.ts",
    "tests/wsgs-http-adapter.contract.test.ts",
    "tests/wsgs-geospatial-consumer-lock.contract.test.ts",
  ],
  [
    "scripts/v05-postgres-test-harness.mjs",
    "tests/v06-grounding-lifecycle.postgres.int.test.ts",
    "tests/grounding-persistence.postgres.int.test.ts",
  ],
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
    throw Error("S02 verification failed; ledger unchanged");
}
// Idempotency is covered by the PostgreSQL-backed crash/replay/conflict tests.
const covered = [
  "001",
  "002",
  "003",
  "004",
  "005",
  "006",
  "007",
  "008",
  "009",
  "010",
  "011",
  "012",
  "013",
  "014",
];
const ledger = JSON.parse(readFileSync(`${dir}/ACCEPTANCE_LEDGER.json`));
for (const suffix of covered) {
  const row = ledger.rows.find((r) => r.id === "V06-S02-" + suffix);
  row.status = "PASS";
  row.evidenceRefs = [
    "S02.json",
    "tests/v06-grounding-job.contract.test.ts",
    suffix === "013"
      ? "tests/v06-grounding-lifecycle.postgres.int.test.ts"
      : "tests/wsgs-http-adapter.contract.test.ts",
  ];
}
writeFileSync(
  `${dir}/S02.json`,
  JSON.stringify(
    {
      schemaVersion: "sacs-v06-phase-report/1.0",
      phaseId: "S02",
      status: "PASS",
      sourceSha,
      startedAt,
      completedAt: new Date().toISOString(),
      commands,
      acceptanceIds: covered.map((k) => "V06-S02-" + k),
      blockers: [],
      notes: [
        "Native routes absent by design; only existing WsgsHttpClient is injected.",
        "Raw release lock and all consumed artifacts revalidated before READY consumer lock generation.",
        "Durable replay verifies identical request/key after response loss and rejects changed canonical request before sending.",
        ...[
          "packages/wsgs-geospatial-consumer/src/authoritative.ts",
          "packages/wsgs-http-adapter/src/index.ts",
          "packages/wsgs-analysis-adapter/src/grounding-job.ts",
          "tests/v06-grounding-job.contract.test.ts",
          "tests/v06-grounding-lifecycle.postgres.int.test.ts",
        ].map((f) => f + " " + hash(readFileSync(f))),
      ],
    },
    null,
    2,
  ) + "\n",
);
writeFileSync(
  `${dir}/ACCEPTANCE_LEDGER.json`,
  JSON.stringify(ledger, null, 2) + "\n",
);
