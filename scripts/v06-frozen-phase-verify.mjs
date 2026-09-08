import { spawnSync, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
const phase = process.argv[2];
if (
  !["C00", "C01", "C02", "C03-planner", "C03", "C04", "C05", "C06"].includes(
    phase,
  )
)
  throw Error("No verification mapping implemented for this phase yet.");
const dir = "reports/v0.6/frozen-wsgs-consumer";
const sha = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
const startedAt = new Date().toISOString();
const listSourceFiles = () =>
  execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard"],
    { encoding: "utf8" },
  )
    .trim()
    .split("\n")
    .filter(
      (path) =>
        /^(apps|packages|tests|scripts|migrations)\//u.test(path) ||
        /^(package\.json|pnpm-lock\.yaml|tsconfig.*\.json|jest.*)$/u.test(path),
    );
const sourceFiles = listSourceFiles();
const digestSourceTree = () =>
  "sha256:" +
  createHash("sha256")
    .update(
      [...new Set(listSourceFiles())]
        .sort()
        .map(
          (path) =>
            path +
            ":" +
            createHash("sha256").update(readFileSync(path)).digest("hex"),
        )
        .join("\n"),
    )
    .digest("hex");
const sourceTreeDigest = digestSourceTree();
const environment = {
  ...Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        !/^(?:SACS_|WSGS_|SDAR_|GOWM_|GSAP_|GDPS_|OPENAI_|MODEL_|DATABASE_URL$|TEST_DATABASE_URL$|PGHOST$|PGPORT$|PGUSER$|PGPASSWORD$|PGDATABASE$)/u.test(
          key,
        ) &&
        !/(?:^|_)(?:TOKEN|PASSWORD|SECRET|API_KEY|BASE_URL|ENDPOINT)(?:$|_)/u.test(
          key,
        ),
    ),
  ),
  NODE_ENV: "test",
  DOTENV_CONFIG_PATH: process.platform === "win32" ? "NUL" : "/dev/null",
  DOTENV_CONFIG_QUIET: "true",
};
const commands = [];
let phaseTestPaths = [];
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
if (phase === "C03-planner") {
  commandsToRun.splice(
    0,
    commandsToRun.length,
    [process.execPath, ["node_modules/typescript/bin/tsc", "--noEmit"]],
    [
      process.execPath,
      [
        "--experimental-vm-modules",
        "node_modules/jest/bin/jest.js",
        "--runInBand",
        "tests/v06-frozen-public.contract.test.ts",
        "tests/v06-frozen-request.unit.test.ts",
      ],
    ],
    [process.execPath, ["scripts/verify-architecture.mjs"]],
    [
      process.execPath,
      [
        "node_modules/eslint/bin/eslint.js",
        "packages/grounding-request-planner/src/frozen-request.ts",
        "packages/wsgs-geospatial-consumer/src/frozen-world-analysis.ts",
        "tests/v06-frozen-request.unit.test.ts",
      ],
    ],
  );
}
if (["C03", "C04", "C05", "C06"].includes(phase)) {
  const tests = [
    "tests/v06-frozen-public.contract.test.ts",
    "tests/v06-frozen-http.contract.test.ts",
    "tests/v06-frozen-source.unit.test.ts",
    "tests/v06-frozen-persistence.unit.test.ts",
    "tests/v06-frozen-cancel.unit.test.ts",
    "tests/v06-frozen-view.unit.test.ts",
    "tests/v06-frozen-request.unit.test.ts",
    "tests/v06-frozen-revision-persistence.unit.test.ts",
    "tests/v06-frozen-source-pump.unit.test.ts",
    "tests/v06-frozen-source-history.unit.test.ts",
    "tests/v06-frozen-client.unit.test.ts",
    "tests/v06-frozen-entry.integration.test.ts",
    "tests/v06-frozen-factory-compat.unit.test.ts",
    "tests/v05-analysis-development-runtime.unit.test.ts",
    "tests/analysis-control-api.contract.test.ts",
    "tests/analysis-control-coordinator.unit.test.ts",
    "tests/analysis-reference-client.contract.test.ts",
    "tests/multi-task-coordinator.contract.test.ts",
    "tests/sdar-a2a-adapter.contract.test.ts",
    "tests/openai-api.contract.test.ts",
    "tests/openai-predecessor-regression.contract.test.ts",
    "tests/query-service.unit.test.ts",
    "tests/world-grounding-application.unit.test.ts",
  ];
  // C03 proves the integrated change; C04/C05 retain every assertion needed by
  // their own AC groups. C06 reruns the delivered full frozen + legacy plan.
  const focusedPhases = {
    C04: [
      "tests/v06-frozen-client.unit.test.ts",
      "tests/v06-frozen-view.unit.test.ts",
      "tests/v06-frozen-entry.integration.test.ts",
      "tests/analysis-reference-client.contract.test.ts",
      "tests/sdar-a2a-adapter.contract.test.ts",
      "tests/world-grounding-application.unit.test.ts",
    ],
    C05: [
      "tests/v06-frozen-entry.integration.test.ts",
      "tests/v06-frozen-factory-compat.unit.test.ts",
      "tests/v06-frozen-source.unit.test.ts",
      "tests/v06-frozen-source-pump.unit.test.ts",
      "tests/openai-api.contract.test.ts",
      "tests/openai-predecessor-regression.contract.test.ts",
      "tests/world-grounding-application.unit.test.ts",
      "tests/query-service.unit.test.ts",
      "tests/analysis-control-api.contract.test.ts",
    ],
  };
  if (focusedPhases[phase])
    tests.splice(0, tests.length, ...focusedPhases[phase]);
  if (phase === "C06")
    tests.splice(
      0,
      tests.length,
      ...JSON.parse(
        execFileSync(
          process.execPath,
          ["scripts/v06-frozen-tests.mjs", "all", "--list"],
          { encoding: "utf8", env: environment },
        ),
      ).tests,
    );
  phaseTestPaths = [...new Set(tests)];
  commandsToRun.splice(
    0,
    commandsToRun.length,
    [process.execPath, ["node_modules/typescript/bin/tsc", "--noEmit"]],
    [
      process.execPath,
      phase === "C06"
        ? ["scripts/v06-frozen-tests.mjs", "all"]
        : [
            "--experimental-vm-modules",
            "node_modules/jest/bin/jest.js",
            "--runInBand",
            ...tests,
          ],
    ],
    [process.execPath, ["scripts/verify-architecture.mjs"]],
    [
      process.execPath,
      [
        "node_modules/eslint/bin/eslint.js",
        ...sourceFiles.filter(
          (path) =>
            /\.ts$/u.test(path) &&
            (tests.includes(path) ||
              /^(packages\/(analysis-client|analysis-control-runtime|analysis-runtime|analysis-development-runtime|persistence|world-grounding-runtime|world-explanation-runtime|grounding-request-planner)\/src|apps\/server\/src\/(v06-grounding-analysis\.ts|api\/(analysis|openai)-routes\.ts|chat\/(conversation-application-service|sdar-chat-runner)\.ts)|tests\/helpers\/(memory-(frozen-analysis|grounding)|frozen-wsgs-http)\.ts)/u.test(
                path,
              )),
        ),
      ],
    ],
    [process.execPath, ["scripts/verify-migrations.mjs"]],
    ["git", ["diff", "--check"]],
  );
}
for (const [i, [program, args]] of commandsToRun.entries()) {
  const result = spawnSync(program, args, {
    encoding: "utf8",
    env: environment,
    maxBuffer: 16 * 1024 * 1024,
  });
  const output =
    (result.stdout ?? "") +
    (result.stderr ?? "") +
    (result.error ? `\n${result.error.message}\n` : "");
  process.stdout.write(output);
  const path = `${dir}/${phase}-command-${i + 1}.txt`;
  writeFileSync(path, output);
  commands.push({
    command: [program === process.execPath ? "node" : program, ...args].join(
      " ",
    ),
    exitCode: result.error ? 1 : (result.status ?? 1),
    sourceSha: sha,
    outputDigest: "sha256:" + createHash("sha256").update(output).digest("hex"),
    evidencePath: path,
  });
  if (result.error || result.status !== 0)
    throw Error(`${phase} verification failed; ledger unchanged.`);
}
if (digestSourceTree() !== sourceTreeDigest)
  throw Error(
    `${phase} source tree changed during verification; ledger unchanged.`,
  );
const ledger = JSON.parse(readFileSync(`${dir}/ACCEPTANCE_LEDGER.json`));
const required = ledger.scenarios.filter(
  (row) => row.classification === "REQUIRED",
);
if (
  required.length !== 40 ||
  new Set(required.map((row) => row.id)).size !== 40 ||
  required.some((row) => !/^AC-(?:00[1-9]|0[1-3][0-9]|040)$/u.test(row.id))
)
  throw Error(
    "Frozen acceptance matrix must retain exactly AC-001 through AC-040.",
  );
let mapping =
  phase === "C03-planner"
    ? {}
    : phase === "C02"
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
const finalPhaseLocations = {
  C03: Object.fromEntries(
    Array.from({ length: 11 }, (_, i) => [
      "AC-" + String(i + 19).padStart(3, "0"),
      [
        "tests/v06-frozen-entry.integration.test.ts: normal control/Chat/AG-UI two-turn, source revision and selection cases",
        "tests/v06-frozen-request.unit.test.ts: exact selections, unique ordinals, TTL, scope and conflicts",
        "tests/v06-frozen-revision-persistence.unit.test.ts: actual PostgreSQL repository driver-boundary CAS/claim/recovery intent",
        ...(i === 10
          ? [
              "tests/v06-frozen-source-pump.unit.test.ts; tests/v06-frozen-source-history.unit.test.ts: delayed source isolation and historical audit",
            ]
          : []),
      ],
    ]),
  ),
  C04: Object.fromEntries(
    Array.from({ length: 5 }, (_, i) => [
      "AC-" + String(i + 34).padStart(3, "0"),
      [
        "tests/v06-frozen-client.unit.test.ts: same-source views, actual geometry, clipping closure, realtime TTL and non-executing candidates",
        "tests/v06-frozen-view.unit.test.ts: five finding semantics and strict action requirements",
        "tests/v06-frozen-entry.integration.test.ts: normal entries with A2A spies, stored authority and real second HTTP query",
      ],
    ]),
  ),
  C05: Object.fromEntries(
    ["AC-007", "AC-008", "AC-039"].map((id) => [
      id,
      [
        "tests/v06-frozen-entry.integration.test.ts: normal shared main composition, 200/202, Chat/AG-UI START/RECONNECT/control and different second Grounding",
      ],
    ]),
  ),
  C06: {
    "AC-040": [
      "C06-command-2.txt: explicit frozen and affected legacy regression suites; C06-command-1.txt: source typecheck; SOURCE_RUN.md: source commands and scope",
    ],
  },
};
if (finalPhaseLocations[phase])
  mapping = Object.fromEntries(
    Object.entries(finalPhaseLocations[phase]).map(([id, locations]) => [
      id,
      { command: commands[1], locations },
    ]),
  );
for (const [id, evidence] of Object.entries(mapping)) {
  const row = ledger.scenarios.find((row) => row.id === id);
  // Point each AC at its own executed assertion, not just a broad suite label.
  const assertionLocations = phaseTestPaths.flatMap((path) =>
    readFileSync(path, "utf8")
      .split("\n")
      .flatMap((line, index) =>
        line.includes(id) ? [`${path}:${index + 1}: ${line.trim()}`] : [],
      ),
  );
  Object.assign(row, {
    status: "PASS",
    testLocations: [...new Set([...assertionLocations, ...evidence.locations])],
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
ledger.decision =
  phase === "C06" &&
  ledger.scenarios
    .filter((r) => r.classification === "REQUIRED")
    .every((r) => r.status === "PASS")
    ? "SACS_WSGS_FROZEN_WORLD_ANALYSIS_CONSUMER_DEV_READY"
    : "IN_PROGRESS";
writeFileSync(
  `${dir}/${phase}.json`,
  JSON.stringify(
    {
      phase,
      status: "PASS",
      sourceSha: sha,
      sourceTreeDigest,
      startedAt,
      completedAt: new Date().toISOString(),
      commands,
      acceptanceIds: Object.keys(mapping),
      scope: ["C03", "C04", "C05", "C06"].includes(phase)
        ? "NORMAL_SACS_SOURCE_COMPOSITION_LOCAL_HTTP_AND_STORAGE_BOUNDARIES; NO_DOCKER_NO_LIVE_UPSTREAM_NO_BUILD_GATE"
        : phase === "C03-planner"
          ? "PLANNER_ONLY; C03 source control/revisions/normal entry integration still required; NO NEW AC PASS"
          : phase === "C02"
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
