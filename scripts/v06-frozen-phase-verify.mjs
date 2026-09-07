import { spawnSync, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
const phase = process.argv[2];
if (!["C00", "C01", "C02"].includes(phase))
  throw Error("No verification mapping implemented for this phase yet.");
const dir = "reports/v0.6/frozen-wsgs-consumer";
const sha = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
const startedAt = new Date().toISOString();
const commands = [];
const commandsToRun = ["C01", "C02"].includes(phase)
  ? [
      [process.execPath, ["node_modules/typescript/bin/tsc", "--noEmit"]],
      [
        process.execPath,
        [
          "--experimental-vm-modules",
          "node_modules/jest/bin/jest.js",
          "--runInBand",
          "tests/v06-frozen-public.contract.test.ts",
          "tests/v06-frozen-http.contract.test.ts",
          "tests/v06-frozen-source.unit.test.ts",
          "tests/v06-frozen-persistence.unit.test.ts",
          "tests/v06-frozen-cancel.unit.test.ts",
          "tests/v06-grounding-job.contract.test.ts",
          "tests/v06-analysis-config.unit.test.ts",
          "tests/v06-analysis-source.contract.test.ts",
          "tests/v06-world-analysis-view.unit.test.ts",
          "tests/wsgs-http-adapter.contract.test.ts",
          "tests/world-grounding-runtime.unit.test.ts",
        ],
      ],
      [process.execPath, ["scripts/verify-architecture.mjs"]],
      [
        process.execPath,
        [
          "node_modules/eslint/bin/eslint.js",
          "packages/wsgs-http-adapter/src/index.ts",
          "packages/wsgs-analysis-adapter/src/grounding-job.ts",
          "packages/wsgs-analysis-adapter/src/config.ts",
          "packages/wsgs-analysis-adapter/src/contract-identity.ts",
          "packages/analysis-contract/src/source.ts",
          "packages/world-grounding-runtime/src/index.ts",
          "packages/analysis-runtime/src/grounding-source-runtime.ts",
          "packages/analysis-control-runtime/src/grounding-source-control.ts",
          "packages/persistence/src/analysis-repository.ts",
          "packages/persistence/src/grounding-repository.ts",
          "packages/persistence/src/analysis-development-repository.ts",
          "packages/authority-fusion/src/index.ts",
          "packages/world-explanation-runtime/src/analysis-view.ts",
          "apps/server/src/v06-grounding-analysis.ts",
          "tests/v06-frozen-http.contract.test.ts",
          "tests/v06-frozen-source.unit.test.ts",
          "tests/v06-frozen-cancel.unit.test.ts",
          "tests/v06-frozen-persistence.unit.test.ts",
          "tests/helpers/frozen-wsgs-http.ts",
          "tests/helpers/memory-grounding.ts",
        ],
      ],
    ]
  : [
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
if (phase === "C02") {
  commandsToRun[1][1].push("tests/v06-frozen-view.unit.test.ts");
  commandsToRun[3][1].push(
    "packages/world-explanation-runtime/src/frozen-analysis-view.ts",
    "packages/analysis-contract/src/index.ts",
    "tests/v06-frozen-view.unit.test.ts",
  );
}
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
const mapping =
  phase === "C02"
    ? Object.fromEntries(
        [
          "AC-011",
          "AC-012",
          "AC-013",
          "AC-014",
          "AC-015",
          "AC-016",
          "AC-017",
          "AC-018",
        ].map((id) => [
          id,
          {
            command: commands[1],
            locations: [
              `tests/v06-frozen-view.unit.test.ts: ${id} public examples and semantic assertions`,
              ...(id === "AC-018"
                ? [
                    "tests/v06-frozen-http.contract.test.ts: caller result budget on POST and GET",
                  ]
                : []),
            ],
          },
        ]),
      )
    : phase === "C01"
      ? Object.fromEntries(
          [
            [
              "AC-004",
              "tests/v06-frozen-http.contract.test.ts: exact config/header lifecycle and rejection cases",
            ],
            [
              "AC-005",
              "tests/v06-frozen-source.unit.test.ts: saved 1.1 / new 1.2 runtime; tests/v06-frozen-persistence.unit.test.ts: SQL identity checks",
            ],
            [
              "AC-006",
              "tests/v06-frozen-http.contract.test.ts: supported versus available, unavailable optional capabilities",
            ],
            [
              "AC-009",
              "tests/v06-frozen-http.contract.test.ts: HTTP errors / six malformed or foreign response cases",
            ],
            [
              "AC-010",
              "tests/v06-frozen-http.contract.test.ts: full body and original digest; tests/v06-frozen-persistence.unit.test.ts: profile replay conflict",
            ],
            [
              "AC-030",
              "tests/v06-frozen-http.contract.test.ts: three terminal statuses stop observation",
            ],
            [
              "AC-031",
              "tests/v06-frozen-http.contract.test.ts: local failures, abort, timeout never cancel or forge state",
            ],
            [
              "AC-032",
              "tests/v06-frozen-cancel.unit.test.ts: real control HTTP intent/replay/error; tests/v06-frozen-persistence.unit.test.ts: terminal races",
            ],
            [
              "AC-033",
              "tests/v06-frozen-source.unit.test.ts: same memory repository runtime rebuild/replay, no extra POST",
            ],
          ].map(([id, location]) => [
            id,
            { command: commands[1], locations: [location] },
          ]),
        )
      : {
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
      "Executed SACS evidence; local boundary tests only, not live upstream or real PostgreSQL acceptance.",
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
      scope:
        phase === "C02"
          ? "SACS_FIVE_FINDING_PROJECTION; normal two-turn shared composition acceptance remains C05"
          : phase === "C01"
            ? "SACS_HTTP_SOURCE_AND_PERSISTENCE_BOUNDARIES; AC-007/008 projection completion awaits C02/C05"
            : "SACS_PUBLIC_IMPORT_AND_LOADER_ONLY",
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
