import { spawnSync, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
const phase = process.argv[2];
if (phase !== "C00")
  throw Error("No verification mapping implemented for this phase yet.");
const dir = "reports/v0.6/frozen-wsgs-consumer";
const sha = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
const startedAt = new Date().toISOString();
const commands = [];
const commandsToRun = [
  [
    "git",
    [
      "merge-base",
      "--is-ancestor",
      "7838a52c74b0cfb3575f34cb46c13ceb6f7c0ef2",
      "HEAD",
    ],
  ],
  [process.execPath, ["node_modules/typescript/bin/tsc", "--noEmit"]],
  [
    process.execPath,
    [
      "--experimental-vm-modules",
      "node_modules/jest/bin/jest.js",
      "--runInBand",
      "tests/v06-frozen-public.contract.test.ts",
    ],
  ],
  [process.execPath, ["scripts/verify-architecture.mjs"]],
  [
    process.execPath,
    [
      "node_modules/eslint/bin/eslint.js",
      "packages/wsgs-geospatial-consumer/src/frozen-world-analysis.ts",
      "tests/v06-frozen-public.contract.test.ts",
    ],
  ],
  [process.execPath, ["--check", "scripts/v06-frozen-intake.mjs"]],
  [process.execPath, ["--check", "scripts/v06-frozen-phase-verify.mjs"]],
];
for (const [i, [program, args]] of commandsToRun.entries()) {
  const result = spawnSync(program, args, {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  const output = (result.stdout ?? "") + (result.stderr ?? "");
  process.stdout.write(output);
  const path = `${dir}/${phase}-command-${i + 1}.txt`;
  writeFileSync(path, output);
  commands.push({
    command: [program === process.execPath ? "node" : program, ...args].join(
      " ",
    ),
    exitCode: result.status ?? 1,
    sourceSha: sha,
    outputDigest: "sha256:" + createHash("sha256").update(output).digest("hex"),
    evidencePath: path,
  });
  if (result.status !== 0)
    throw Error(`${phase} verification failed; ledger unchanged.`);
}
const ledger = JSON.parse(readFileSync(`${dir}/ACCEPTANCE_LEDGER.json`));
const mapping = {
  "AC-001": {
    command: commands[0],
    locations: [
      "reports/v0.6/frozen-wsgs-consumer/ExecPlan.md: Verified starting point",
    ],
  },
  "AC-002": {
    command: commands[2],
    locations: [
      "tests/v06-frozen-public.contract.test.ts: AC-002 verifies exact release bytes and original public dependency closure",
    ],
  },
  "AC-003": {
    command: commands[2],
    locations: [
      "tests/v06-frozen-public.contract.test.ts: AC-003 actual SACS loader / drift / official hash / unsupported schema cases",
    ],
  },
};
for (const [id, evidence] of Object.entries(mapping)) {
  const row = ledger.scenarios.find((row) => row.id === id);
  Object.assign(row, {
    status: "PASS",
    testLocations: evidence.locations,
    command: evidence.command.command,
    exitCode: 0,
    evidencePaths: [
      `${dir}/${phase}.json`,
      evidence.command.evidencePath,
      `${dir}/SOURCE_IMPORT.json`,
      `${dir}/handoff-verification.json`,
    ],
    notes:
      "Executed SACS evidence; offline contracts only, not live upstream acceptance.",
  });
}
ledger.ledgerType = "EXECUTED_SACS_EVIDENCE";
ledger.decision = "IN_PROGRESS";
writeFileSync(
  `${dir}/${phase}.json`,
  JSON.stringify(
    {
      phase,
      status: "PASS",
      sourceSha: sha,
      startedAt,
      completedAt: new Date().toISOString(),
      commands,
      acceptanceIds: Object.keys(mapping),
      scope: "SACS_PUBLIC_IMPORT_AND_LOADER_ONLY",
      notRun: ["ENV-001"],
      excluded: ["EX-001", "EX-002", "EX-003", "EX-004"],
    },
    null,
    2,
  ) + "\n",
);
writeFileSync(
  `${dir}/ACCEPTANCE_LEDGER.json`,
  JSON.stringify(ledger, null, 2) + "\n",
);
console.log(`${phase}: PASS (${Object.keys(mapping).join(", ")})`);
