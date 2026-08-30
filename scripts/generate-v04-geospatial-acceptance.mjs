import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { format } from "prettier";

const root = process.cwd();
const matrixPath = resolve(
  root,
  "acceptance/v0.4/geospatial-explanation/acceptance-matrix.csv",
);
const s19RestartEvidencePath = resolve(
  root,
  "reports/v0.4/geospatial/S19-restart-replay.json",
);
const s23PostgresEvidencePath = resolve(
  root,
  "reports/v0.4/geospatial/S23-postgres-evidence.json",
);
const reportRoot = resolve(root, "reports/v0.4/geospatial");
const argumentsSet = new Set(process.argv.slice(2));
const checkOnly = argumentsSet.has("--check");
const phaseArgumentIndex = process.argv.indexOf("--phase");
const selectedPhase =
  phaseArgumentIndex === -1 ? undefined : process.argv[phaseArgumentIndex + 1];
const ALLOWED_ACCEPTANCE_STATUSES = Object.freeze([
  "PASS",
  "FAIL",
  "NOT_RUN",
  "BLOCKED",
]);
const ALLOWED_EVIDENCE_TYPES = Object.freeze([
  "SOURCE_LOCK",
  "STATIC_GUARD",
  "SCHEMA",
  "UNIT",
  "CONTRACT",
  "REAL_POSTGRES",
  "FAKE_WSGS_INTEGRATION",
  "REAL_WSGS",
  "RUNNING_GOWM_GATEWAY",
  "REAL_GDPS_SOURCE",
  "OPENAI_HTTP",
  "AGUI_HTTP_SSE",
  "RECOVERY",
  "SECURITY",
  "CI",
  "GIT",
  "REPORT_ASSERTION",
]);
const EVIDENCE_EQUIVALENTS = Object.freeze({
  STATIC: ["STATIC_GUARD"],
  AGUI: ["AGUI_HTTP_SSE"],
  OPENAI: ["OPENAI_HTTP"],
  REPORT: ["REPORT_ASSERTION"],
});

const STATUS_IDS = Object.freeze({
  PASS: splitIds(`
    AC-B001 AC-B002 AC-B003 AC-B004 AC-B005 AC-B006 AC-B007 AC-B008 AC-B009 AC-B010 AC-B011
    AC-B012 AC-B013 AC-B014 AC-B015 AC-B016 AC-B017 AC-B018 AC-B019 AC-B020 AC-B021 AC-B022
    AC-C001 AC-C002 AC-C003 AC-C004 AC-C005 AC-C006 AC-C007 AC-C008 AC-C009 AC-C010 AC-C011
    AC-C012 AC-C013 AC-C014 AC-C015 AC-C016 AC-C017 AC-C018 AC-C019 AC-C020 AC-C021 AC-C022
    AC-C023 AC-C024 AC-C025 AC-C026 AC-C027 AC-C028 AC-C029 AC-C030 AC-C031 AC-C032
    AC-N001 AC-N002 AC-N003 AC-N004 AC-N005 AC-N006 AC-N007 AC-N008 AC-N009 AC-N010 AC-N011
    AC-N012 AC-N013 AC-N014 AC-N015 AC-N016 AC-N017 AC-N018 AC-N019 AC-N020 AC-N021 AC-N022
    AC-N023 AC-N024 AC-N025 AC-N026 AC-N027 AC-N028 AC-N029 AC-N030 AC-N031 AC-N032
    AC-E001 AC-E002 AC-E003 AC-E004 AC-E005 AC-E006 AC-E007 AC-E008 AC-E009 AC-E010 AC-E011
    AC-E012 AC-E013 AC-E014 AC-E015 AC-E016 AC-E017 AC-E018 AC-E019 AC-E020 AC-E021 AC-E022
    AC-E023 AC-E024 AC-E025 AC-E026 AC-E027 AC-E028 AC-E029 AC-E030 AC-E031 AC-E032 AC-E033
    AC-E034
    AC-A001 AC-A002 AC-A003 AC-A004 AC-A005 AC-A006 AC-A007 AC-A008 AC-A009 AC-A010 AC-A011
    AC-A012 AC-A013 AC-A014 AC-A015 AC-A016 AC-A017 AC-A018 AC-A019 AC-A020 AC-A021 AC-A022
    AC-A023 AC-A024 AC-A025 AC-A026
    AC-P001 AC-P002 AC-P003 AC-P004 AC-P005 AC-P006 AC-P007 AC-P008 AC-P009 AC-P010 AC-P011
    AC-P012 AC-P013 AC-P014 AC-P015 AC-P016 AC-P017 AC-P018 AC-P019 AC-P020 AC-P021 AC-P022
    AC-P023 AC-P024 AC-P025
    AC-F001 AC-F002 AC-F003 AC-F004 AC-F005 AC-F006 AC-F007 AC-F008 AC-F009 AC-F010 AC-F011
    AC-F012 AC-F013 AC-F014 AC-F015 AC-F016 AC-F017 AC-F018
  `),
  BLOCKED: splitIds(`
    AC-U001 AC-U002 AC-U003 AC-U004 AC-U005 AC-U006 AC-U007 AC-U008 AC-U009 AC-U010 AC-U011
    AC-U012 AC-U013 AC-U014 AC-U015 AC-U016 AC-U017 AC-U018 AC-U019 AC-U020 AC-U021 AC-U022
    AC-U023 AC-U024 AC-U025 AC-U026 AC-U027 AC-U028
    AC-M001 AC-M002 AC-M003 AC-M004 AC-M005 AC-M006 AC-M007 AC-M008 AC-M009 AC-M010 AC-M011
    AC-M012 AC-M013 AC-M014 AC-M015 AC-M016 AC-M017 AC-M018 AC-M019 AC-M020 AC-M021 AC-M022
    AC-G001 AC-G002 AC-G003 AC-G004 AC-G005 AC-G006 AC-G007 AC-G008 AC-G009 AC-G010 AC-G011
    AC-G012 AC-G013 AC-G014 AC-G015 AC-G016 AC-G017 AC-G018 AC-G019 AC-G020 AC-G021 AC-G022
    AC-G023 AC-G024 AC-G025 AC-G026 AC-G027 AC-G028
    AC-R001 AC-R002 AC-R003 AC-R004 AC-R005 AC-R006 AC-R007 AC-R008 AC-R009 AC-R010 AC-R011
    AC-R012 AC-R013 AC-R014 AC-R015 AC-R016 AC-R017 AC-R018
    AC-Z001 AC-Z002 AC-Z003 AC-Z004 AC-Z005 AC-Z006 AC-Z007 AC-Z008 AC-Z009 AC-Z010 AC-Z011
    AC-Z012 AC-Z013 AC-Z014 AC-Z017 AC-Z018 AC-Z020
  `),
  NOT_RUN: splitIds(`AC-Z015 AC-Z016 AC-Z019`),
});

const PHASE_EVIDENCE = Object.freeze({
  S13: [
    ["SOURCE_LOCK", "reports/v0.4/geospatial/S13-source-lock.json"],
    ["GIT", "reports/v0.4/geospatial/S13-source-lock.json"],
    ["CI", "reports/v0.4/geospatial/S13-source-lock.json"],
    ["REPORT_ASSERTION", "reports/v0.4/geospatial/S13-acceptance.json"],
    ["REPORT_ASSERTION", "reports/v0.4/geospatial/S13-completion.md"],
  ],
  S14: [
    ["SCHEMA", "dependencies/wsgs-geospatial-consumer-lock.json"],
    ["CONTRACT", "tests/wsgs-geospatial-consumer-lock.contract.test.ts"],
    ["STATIC_GUARD", "scripts/verify-v04-s14.mjs"],
  ],
  S15: [
    ["SCHEMA", "contracts/v0.4/geospatial/world-explanation.schema.json"],
    ["CONTRACT", "tests/world-explanation-contracts.contract.test.ts"],
    ["CONTRACT", "tests/world-explanation-hash.contract.test.ts"],
  ],
  S16: [
    ["UNIT", "tests/world-explanation-assembler.unit.test.ts"],
    ["CONTRACT", "tests/world-explanation-renderer.unit.test.ts"],
    ["SECURITY", "tests/world-finding-normalizer.security.test.ts"],
    ["STATIC_GUARD", "scripts/verify-architecture.mjs"],
  ],
  S17: [
    ["UNIT", "tests/world-explanation-assembler.unit.test.ts"],
    ["UNIT", "tests/world-explanation-renderer.unit.test.ts"],
    ["CONTRACT", "tests/world-explanation-hash.contract.test.ts"],
  ],
  S18: [
    ["UNIT", "tests/world-explanation-projection.unit.test.ts"],
    ["UNIT", "tests/world-grounding-explanation.unit.test.ts"],
    ["OPENAI_HTTP", "tests/openai-api.contract.test.ts"],
    ["AGUI_HTTP_SSE", "tests/ag-ui-api.contract.test.ts"],
  ],
  S19: [
    ["SCHEMA", "migrations/0013_world_explanation.sql"],
    ["CONTRACT", "tests/world-explanation-persistence.contract.test.ts"],
    ["UNIT", "tests/world-explanation-persistence.contract.test.ts"],
    [
      "REAL_POSTGRES",
      "tests/world-explanation-persistence.postgres.int.test.ts",
    ],
    ["RECOVERY", "reports/v0.4/geospatial/S19-restart-replay.json"],
    ["STATIC_GUARD", "scripts/phase-v04-s19-restart-replay.mjs"],
  ],
  S20: [
    [
      "UNIT",
      "tests/finding-reference-resolver.unit.test.ts",
      "SUPPLEMENTARY_ONLY",
    ],
    [
      "CONTRACT",
      "tests/multiturn-world-focus.contract.test.ts",
      "SUPPLEMENTARY_ONLY",
    ],
    ["REPORT_ASSERTION", "reports/v0.4/geospatial/S24-real-e2e.json"],
  ],
  S21: [
    ["UNIT", "tests/geospatial-gap-policy.unit.test.ts"],
    ["CONTRACT", "packages/geospatial-explanation-policy/src/gap-policy.ts"],
  ],
  S22: [
    ["UNIT", "tests/geospatial-currentness-policy.unit.test.ts"],
    [
      "STATIC_GUARD",
      "packages/geospatial-explanation-policy/src/currentness-policy.ts",
    ],
    ["SCHEMA", "dependencies/wsgs-geospatial-consumer-lock.json"],
  ],
  S23: [
    ["UNIT", "tests/geospatial-authority-boundary.static.test.ts"],
    ["UNIT", "tests/authority-fusion.unit.test.ts"],
    ["CONTRACT", "tests/authority-fusion.contract.test.ts"],
    ["UNIT", "tests/world-grounding-runtime.unit.test.ts"],
    ["UNIT", "tests/world-grounding-application.unit.test.ts"],
    ["UNIT", "tests/world-explanation-projection.unit.test.ts"],
    ["OPENAI_HTTP", "tests/openai-api.contract.test.ts"],
    ["AGUI_HTTP_SSE", "tests/ag-ui-api.contract.test.ts"],
    ["REAL_POSTGRES", "reports/v0.4/geospatial/S23-postgres-evidence.json"],
    [
      "STATIC_GUARD",
      "packages/geospatial-explanation-policy/src/presentation-policy.ts",
    ],
  ],
  S24: [["REPORT_ASSERTION", "reports/v0.4/geospatial/S24-real-e2e.json"]],
});

const PHASE_METADATA = Object.freeze({
  S13: ["PASS", "SACS_GEOSPATIAL_BASELINE_LOCKED", true],
  S14: ["BLOCKED", "SACS_WSGS_GEOSPATIAL_CONTRACT_READY", false],
  S15: ["PASS", "SACS_GEOSPATIAL_EXPLANATION_CONTRACT_READY", true],
  S16: ["PASS", "SACS_GEOSPATIAL_FINDING_NORMALIZER_READY", true],
  S17: ["PASS", "SACS_GEOSPATIAL_NARRATIVE_READY", true],
  S18: ["PASS", "SACS_AGUI_GEOSPATIAL_PROJECTION_READY", true],
  S19: ["PASS", "SACS_GEOSPATIAL_EXPLANATION_REPLAY_READY", true],
  S20: ["BLOCKED", "SACS_GEOSPATIAL_MULTITURN_READY", false],
  S21: ["BLOCKED", "SACS_GEOSPATIAL_GAP_SEMANTICS_READY", false],
  S22: ["BLOCKED", "SACS_GEOSPATIAL_CURRENTNESS_READY", false],
  S23: ["PASS", "SACS_GEOSPATIAL_AUTHORITY_BOUNDARY_READY", true],
  S24: ["BLOCKED", "SACS_GEOSPATIAL_REAL_E2E_READY", false],
});

const PHASE_TEST_RUNS = Object.freeze({
  S13: [
    {
      command: "pnpm test (pre-feature baseline)",
      result: "PASS 311; package-defined skip 100; total 411",
      evidence: "reports/v0.4/geospatial/S13-completion.md",
    },
  ],
  S14: [
    {
      command: "pnpm test:v04:s14",
      result: "PASS 23/23",
      evidence: "three focused contract/unit suites",
    },
  ],
  S15: [
    {
      command: "focused Jest S15-S18 file set",
      result: "PASS within 8 suites / 72 tests",
      evidence: "world explanation contract and hash suites",
    },
  ],
  S16: [
    {
      command: "focused Jest S15-S18 file set",
      result: "PASS within 8 suites / 72 tests",
      evidence: "assembler and renderer hostile-input coverage",
    },
  ],
  S17: [
    {
      command: "focused Jest S15-S18 file set",
      result: "PASS within 8 suites / 72 tests",
      evidence: "assembler, renderer, and hash suites",
    },
  ],
  S18: [
    {
      command: "focused Jest S15-S18 file set",
      result: "PASS within 8 suites / 72 tests",
      evidence: "projection, runtime, OpenAI HTTP, and AG-UI HTTP/SSE suites",
    },
  ],
  S19: [
    {
      command: "pnpm test:v04:s19 with isolated TEST_DATABASE_URL",
      result: "PASS 2 suites / 12 tests",
      evidence:
        "contract plus tests/world-explanation-persistence.postgres.int.test.ts",
    },
    {
      command: "node scripts/phase-v04-s19-restart-replay.mjs",
      result:
        "PASS; isolated PostgreSQL physically restarted and exact replay recovered",
      evidence: "reports/v0.4/geospatial/S19-restart-replay.json",
    },
  ],
  S20: [
    {
      command: "pnpm test:v04:s20 with isolated TEST_DATABASE_URL",
      result: "PASS 4 suites / 28 tests",
      evidence:
        "local resolver/focus/application/PostgreSQL only; structured selection ingress and REAL_WSGS remain BLOCKED",
    },
  ],
  S21: [
    {
      command: "focused Jest S21-S23 file set",
      result: "PASS within 5 suites / 45 tests",
      evidence: "geospatial gap policy suite",
    },
  ],
  S22: [
    {
      command: "focused Jest S21-S23 file set",
      result: "PASS within 5 suites / 45 tests",
      evidence: "WSGS-only currentness policy suite",
    },
  ],
  S23: [
    {
      command: "pnpm test:v04:s23 with isolated TEST_DATABASE_URL",
      result: "PASS 9 suites / 88 tests, including 5 real PostgreSQL tests",
      evidence:
        "authority guards plus three-section runtime, exact replay, OpenAI HTTP, and AG-UI HTTP/SSE parity",
    },
  ],
  S24: [
    {
      command: "pnpm test",
      result:
        "PASS 60 suites / 456 tests; 15 suites / 109 tests skipped; 565 total",
      evidence:
        "full current worktree regression; prior 411-case baseline preserved",
    },
    {
      command: "pnpm docker:build",
      result: "PASS; single-agent-chat-server:0.4.0 built",
      evidence: "local container candidate build",
    },
    {
      command: "pnpm verify:container",
      result: "PASS; version=0.4.0, user=node, healthcheck present",
      evidence: "local container metadata verification",
    },
    {
      command: "pnpm test:v04:s24:preflight",
      result: "PASS 2 suites / 24 tests",
      evidence:
        "strict readiness/capability preflight plus per-row acceptance evidence contract",
    },
    {
      command: "pnpm preflight:v04:s24",
      result: "BLOCKED safely; 0 read-only requests; 0 business POSTs",
      evidence: "reports/v0.4/geospatial/S24-real-e2e.json",
    },
    {
      command:
        "pnpm verify:migrations; pnpm verify:architecture; pnpm verify:secrets",
      result: "PASS; PASS; PASS",
      evidence: "reports/v0.4/geospatial/S24-closure-gates.json",
    },
  ],
});

const [matrixBytes, s19RestartEvidenceBytes, s23PostgresEvidenceBytes] =
  await Promise.all([
    readFile(matrixPath),
    readFile(s19RestartEvidencePath),
    readFile(s23PostgresEvidencePath),
  ]);
verifyS19RestartEvidence(JSON.parse(s19RestartEvidenceBytes.toString("utf8")));
verifyS23PostgresEvidence(
  JSON.parse(s23PostgresEvidenceBytes.toString("utf8")),
);
const rows = parseCsv(matrixBytes.toString("utf8"));
const decisionById = buildDecisionMap();
verifyMatrix(rows, decisionById);

const entries = rows.map((row) => {
  const status = decisionById.get(row.id);
  return {
    acceptanceId: row.id,
    required: row.required === "yes",
    phase: row.phase,
    area: row.area,
    scenario: row.scenario,
    expected: row.expected,
    requiredEvidence: row.evidence.split("/").filter(Boolean),
    status,
    reason: reasonFor(row, status),
    evidence: evidenceFor(row),
  };
});
verifyEvidenceDecisions(entries);

const phaseSummaries = Object.fromEntries(
  Object.keys(PHASE_METADATA).map((phase) => {
    const phaseEntries = entries.filter((entry) => entry.phase === phase);
    return [phase, summarize(phaseEntries)];
  }),
);
const counts = summarize(entries);
const matrixHash = sha256(matrixBytes);

const ledger = {
  schemaVersion: "sacs-geospatial-acceptance-ledger/1.0",
  sourceMatrix: {
    path: "acceptance/v0.4/geospatial-explanation/acceptance-matrix.csv",
    sha256: matrixHash,
    rowCount: rows.length,
  },
  decisionPolicy: {
    mode: "EXPLICIT_ACCEPTANCE_ID_MAPPING",
    noAggregatePass: true,
    fixtureEvidenceCanSatisfyLiveRows: false,
    authoritativeWsgsGeospatialConsumerLockStatus: "BLOCKED",
    finalDecision: "BLOCKED",
  },
  allowedStatuses: ALLOWED_ACCEPTANCE_STATUSES,
  counts,
  phases: phaseSummaries,
  entries,
};

const evidenceMap = {
  schemaVersion: "sacs-geospatial-acceptance-evidence-map/1.0",
  allowedEvidenceTypes: ALLOWED_EVIDENCE_TYPES,
  entries: entries.map((entry) => ({
    acceptanceId: entry.acceptanceId,
    evidence: entry.evidence.map((item) => ({
      ...item,
      claimStatus: entry.status,
    })),
  })),
};

const phaseSummaryReport = {
  schemaVersion: "sacs-geospatial-phase-summary/1.0",
  finalDecision: "BLOCKED",
  blockerMarkers: [
    "SACS_WSGS_GEOSPATIAL_HANDOFF_NOT_READY",
    "SACS_GEOSPATIAL_LIVE_ENVIRONMENT_NOT_READY",
    "SACS_V0_4_WORLD_GROUNDING_GEOSPATIAL_EXPLANATION_BLOCKED",
  ],
  phases: Object.fromEntries(
    Object.entries(PHASE_METADATA).map(
      ([phase, [status, marker, asserted]]) => [
        phase,
        {
          status,
          marker,
          markerAsserted: asserted,
          acceptance: phaseSummaries[phase],
          testRuns: PHASE_TEST_RUNS[phase],
          report: `reports/v0.4/geospatial/${phase}-phase-report.md`,
        },
      ],
    ),
  ),
};

const s14Intake = {
  schemaVersion: "sacs-wsgs-geospatial-intake-report/1.0",
  phase: "S14",
  status: "BLOCKED",
  marker: "SACS_WSGS_GEOSPATIAL_CONTRACT_READY",
  markerAsserted: false,
  blocker: {
    code: "SACS_WSGS_GEOSPATIAL_HANDOFF_NOT_READY",
    safeDetail:
      "No authoritative WSGS-owned consumer lock, finding profile, result schema lock, provenance lock, and checksum bundle is available.",
  },
  provisionalArtifacts: {
    acceptedAsAuthority: false,
    consumerLock: "dependencies/wsgs-geospatial-consumer-lock.json",
    purpose: "FAIL_CLOSED_CONTRACT_DEVELOPMENT_ONLY",
  },
  businessRequestsAllowed: false,
};

const closureGates = {
  schemaVersion: "sacs-geospatial-closure-gates/1.0",
  sourceScope: "LOCAL_WORKTREE",
  gates: {
    base411FinalRegression: {
      status: "BLOCKED",
      localGateStatus: "PASS",
      missingEvidenceTypes: ["CI", "GIT"],
      command: "pnpm test",
      baselineTotal: 411,
      current: {
        suitesPassed: 60,
        suitesSkipped: 15,
        testsPassed: 456,
        testsSkipped: 109,
        testsTotal: 565,
      },
      regressionDetected: false,
    },
    migration0013Contiguous: {
      status: "BLOCKED",
      localGateStatus: "PASS",
      missingEvidenceTypes: ["CI", "GIT"],
      command: "pnpm verify:migrations",
    },
    architectureBoundary: {
      status: "BLOCKED",
      localGateStatus: "PASS",
      missingEvidenceTypes: ["CI", "GIT"],
      command: "pnpm verify:architecture",
    },
    repositorySecretPatterns: {
      status: "BLOCKED",
      localGateStatus: "PASS",
      missingEvidenceTypes: ["CI", "GIT"],
      command: "pnpm verify:secrets",
    },
    containerBuild: {
      status: "BLOCKED",
      localGateStatus: "PASS",
      missingEvidenceTypes: ["CI", "GIT"],
      buildCommand: "pnpm docker:build",
      verificationCommand: "pnpm verify:container",
      image: "single-agent-chat-server:0.4.0",
      version: "0.4.0",
      runtimeUser: "node",
      healthcheckPresent: true,
    },
    composeWithRealWsgs: {
      status: "BLOCKED",
      reasonCode: "AUTHORITATIVE_WSGS_GEOSPATIAL_HANDOFF_MISSING",
    },
    restartReplay: { status: "NOT_RUN" },
    wsgsOutageRecovery: { status: "NOT_RUN" },
    draftPullRequest: { status: "NOT_RUN", reasonCode: "NOT_AUTHORIZED" },
    protectedActions: {
      status: "BLOCKED",
      localGateStatus: "PASS",
      missingEvidenceTypes: ["CI", "GIT"],
      performed: [],
    },
  },
};

const outputs = new Map([
  [resolve(reportRoot, "acceptance-ledger.json"), json(ledger)],
  [resolve(reportRoot, "acceptance-evidence-map.json"), json(evidenceMap)],
  [resolve(reportRoot, "phase-summary.json"), json(phaseSummaryReport)],
  [resolve(reportRoot, "S14-intake.json"), json(s14Intake)],
  [resolve(reportRoot, "S24-closure-gates.json"), json(closureGates)],
  [resolve(reportRoot, "FINAL_REPORT.md"), finalReport(phaseSummaries, counts)],
]);

for (const [phase, metadata] of Object.entries(PHASE_METADATA)) {
  outputs.set(
    resolve(reportRoot, `${phase}-phase-report.md`),
    phaseReport(
      phase,
      metadata,
      entries.filter((entry) => entry.phase === phase),
    ),
  );
}

for (const [path, content] of outputs) {
  outputs.set(
    path,
    await format(content, {
      parser: path.endsWith(".json") ? "json" : "markdown",
    }),
  );
}

if (checkOnly) {
  const drift = [];
  for (const [path, expected] of outputs) {
    const actual = await readFile(path, "utf8").catch(() => undefined);
    if (actual !== expected)
      drift.push(relative(root, path).replaceAll("\\", "/"));
  }
  if (drift.length > 0) {
    throw new Error(`Geospatial acceptance report drift: ${drift.join(", ")}`);
  }
} else {
  for (const [path, content] of outputs) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, "utf8");
  }
}

if (selectedPhase !== undefined) {
  const summary = phaseSummaries[selectedPhase];
  if (summary === undefined) throw new Error(`Unknown phase: ${selectedPhase}`);
  process.stdout.write(
    `SACS_V0_4_GEOSPATIAL_ACCEPTANCE_${selectedPhase}_${PHASE_METADATA[selectedPhase][0]} ${JSON.stringify(summary)}\n`,
  );
} else {
  process.stdout.write(
    `SACS_V0_4_GEOSPATIAL_ACCEPTANCE_LEDGER_${checkOnly ? "CHECK" : "GENERATED"} ${JSON.stringify(counts)}\n`,
  );
}

function splitIds(value) {
  return value.trim().split(/\s+/u).filter(Boolean);
}

function buildDecisionMap() {
  const decisions = new Map();
  for (const [status, ids] of Object.entries(STATUS_IDS)) {
    for (const id of ids) {
      if (decisions.has(id))
        throw new Error(`Duplicate acceptance decision: ${id}`);
      decisions.set(id, status);
    }
  }
  return decisions;
}

function verifyMatrix(matrixRows, decisions) {
  if (matrixRows.length !== 305) {
    throw new Error(
      `Expected 305 acceptance rows, received ${matrixRows.length}`,
    );
  }
  const ids = new Set();
  for (const row of matrixRows) {
    if (ids.has(row.id))
      throw new Error(`Duplicate matrix acceptance ID: ${row.id}`);
    ids.add(row.id);
    if (!decisions.has(row.id))
      throw new Error(`Acceptance ID has no explicit decision: ${row.id}`);
  }
  for (const id of decisions.keys()) {
    if (!ids.has(id))
      throw new Error(`Decision references unknown acceptance ID: ${id}`);
  }
  if (decisions.size !== matrixRows.length) {
    throw new Error(
      `Decision count ${decisions.size} does not match matrix row count ${matrixRows.length}`,
    );
  }
}

function verifyEvidenceDecisions(items) {
  for (const item of items) {
    if (!ALLOWED_ACCEPTANCE_STATUSES.includes(item.status)) {
      throw new Error(
        `${item.acceptanceId} uses unsupported status: ${item.status}`,
      );
    }
    const qualifyingEvidence = item.evidence.filter(
      ({ scope, sourceSha256 }) =>
        scope !== "SUPPLEMENTARY_ONLY" && sourceSha256 !== undefined,
    );
    const available = new Set(qualifyingEvidence.map(({ type }) => type));
    const missing = item.requiredEvidence.filter((required) => {
      const accepted = [required, ...(EVIDENCE_EQUIVALENTS[required] ?? [])];
      return accepted.every((type) => !available.has(type));
    });
    if (item.status === "PASS" && missing.length !== 0) {
      throw new Error(
        `${item.acceptanceId} cannot PASS without evidence types: ${missing.join(", ")}`,
      );
    }
  }
}

function verifyS19RestartEvidence(value) {
  const expected = {
    schemaVersion: "sacs-geospatial-s19-restart-replay/1.0",
    status: "PASS",
    latestMigration: 13,
    databaseRestartPerformed: true,
    exactReplayRecovered: true,
    credentialsPrintedOrPersisted: false,
    sharedServicesModified: false,
  };
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (value?.[key] !== expectedValue) {
      throw new Error(`S19 restart evidence is not promotable: ${key}`);
    }
  }
  for (const key of [
    "containerIdentityHash",
    "containerImageHash",
    "explanationHash",
    "groundingResultHash",
    "durableJsonHash",
  ]) {
    if (!/^sha256:[a-f0-9]{64}$/u.test(value?.[key])) {
      throw new Error(`S19 restart evidence has an invalid ${key}`);
    }
  }
}

function verifyS23PostgresEvidence(value) {
  const expected = {
    schemaVersion: "sacs-geospatial-s23-postgres-evidence/1.0",
    status: "PASS",
    scope: "DEDICATED_ISOLATED_POSTGRESQL",
    testSuitesPassed: 1,
    testsPassed: 5,
    credentialsPrintedOrPersisted: false,
    sharedServicesModified: false,
  };
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (value?.[key] !== expectedValue) {
      throw new Error(`S23 PostgreSQL evidence is not promotable: ${key}`);
    }
  }
  if (
    value?.geospatialHybrid?.agUiExactReplay !== true ||
    value?.geospatialHybrid?.wsgsProtocolPosts !== 1 ||
    value?.geospatialHybrid?.persistedWorldExplanations !== 1 ||
    value?.geospatialHybrid?.persistedAuthorityFusionEvaluations !== 1 ||
    value?.wsgsEvidence?.transport !== "INJECTED_PROTOCOL_FIXTURE" ||
    value?.wsgsEvidence?.realWsgsClaimed !== false
  ) {
    throw new Error("S23 PostgreSQL evidence has unsafe or incomplete scope");
  }
}

function reasonFor(row, status) {
  if (row.phase === "S14" && status === "BLOCKED") {
    return `BLOCKED: ${row.scenario} requires bytes from the missing authoritative WSGS consumer handoff bundle.`;
  }
  if (row.phase === "S14") {
    return `PASS: the local intake enforces ${row.scenario} while keeping the provisional task-package profile non-authoritative and BLOCKED.`;
  }
  if (row.phase === "S20") {
    return `BLOCKED: ${row.scenario} requires same-shape REAL_WSGS plus scoped PostgreSQL evidence; local resolver tests are supplementary only.`;
  }
  if ((row.phase === "S21" || row.phase === "S22") && status === "BLOCKED") {
    return `BLOCKED: ${row.scenario} has local unit/contract coverage, but its required REAL_WSGS evidence cannot run without the authoritative geospatial consumer handoff.`;
  }
  if (row.id === "AC-P024") {
    return "PASS: the dedicated S19 PostgreSQL container was physically restarted and the exact persisted explanation was recovered without modifying shared services.";
  }
  if (row.id === "AC-P025") {
    return "PASS: the S19 replay marker is asserted after migration, exact replay, concurrency, and isolated physical restart evidence passed.";
  }
  if (row.id.startsWith("AC-R")) {
    return `BLOCKED: ${row.scenario} cannot run without the authoritative WSGS geospatial profile and complete live SACS-to-WSGS-to-GOWM-to-GDPS chain.`;
  }
  if (
    row.phase === "S24" &&
    [
      "AC-Z009",
      "AC-Z010",
      "AC-Z011",
      "AC-Z012",
      "AC-Z013",
      "AC-Z017",
      "AC-Z018",
      "AC-Z020",
    ].includes(row.id)
  ) {
    return `BLOCKED: ${row.scenario} passed its available local/report gate, but required exact-head CI and GIT evidence is absent because publication was not authorized.`;
  }
  if (row.phase === "S24" && status === "BLOCKED") {
    return `BLOCKED: ${row.scenario} depends on live-chain evidence that is unavailable while the WSGS geospatial consumer lock is BLOCKED.`;
  }
  if (row.phase === "S24" && status === "NOT_RUN") {
    return `NOT_RUN: ${row.scenario} was not executed in this local evidence pass.`;
  }
  if (row.id === "AC-Z009") {
    return "PASS: the current full repository run passed 59 suites and 430 tests, with 15 suites and 108 tests explicitly skipped (538 total), preserving the prior 411-case baseline.";
  }
  if (row.id === "AC-Z013") {
    return "PASS: single-agent-chat-server:0.4.0 built successfully and container verification confirmed version 0.4.0, user node, and a present healthcheck.";
  }
  if (row.phase === "S24") {
    return `PASS: ${row.scenario} is independently supported by the recorded local closure evidence and does not claim live E2E completion.`;
  }
  return `PASS: local source, contract, or test evidence independently verifies ${row.scenario} — ${row.expected}.`;
}

function evidenceFor(row) {
  const evidence = PHASE_EVIDENCE[row.phase];
  if (evidence === undefined)
    throw new Error(`No evidence catalog for phase ${row.phase}`);
  return evidence.map(([type, path, scope = "PRIMARY"]) => {
    if (!ALLOWED_EVIDENCE_TYPES.includes(type)) {
      throw new Error(`Unsupported evidence type: ${type}`);
    }
    return {
      type,
      path,
      scope,
      acceptanceId: row.id,
      assertionLocator: `${row.id}: ${row.scenario}`,
      ...hashEvidenceSource(path),
    };
  });
}

function hashEvidenceSource(path) {
  const absolutePath = resolve(root, path);
  const relativePath = relative(root, absolutePath);
  if (
    relativePath.length === 0 ||
    relativePath.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
    relativePath === ".." ||
    isAbsolute(relativePath)
  ) {
    throw new Error(`Evidence path escapes repository: ${path}`);
  }
  try {
    return { sourceSha256: sha256(readFileSync(absolutePath)) };
  } catch {
    return { sourceUnavailable: true };
  }
}

function summarize(items) {
  const result = {
    total: items.length,
    PASS: 0,
    FAIL: 0,
    BLOCKED: 0,
    NOT_RUN: 0,
  };
  for (const item of items) result[item.status] += 1;
  return result;
}

function phaseReport(phase, [status, marker, asserted], phaseEntries) {
  const summary = summarize(phaseEntries);
  const testRows = PHASE_TEST_RUNS[phase]
    .map(
      (run) =>
        `| ${escapeMarkdown(run.command)} | ${escapeMarkdown(run.result)} | ${escapeMarkdown(run.evidence)} |`,
    )
    .join("\n");
  const rows = phaseEntries
    .map(
      (entry) =>
        `| ${entry.acceptanceId} | ${entry.status} | ${escapeMarkdown(entry.scenario)} | ${escapeMarkdown(entry.reason)} |`,
    )
    .join("\n");
  const blocker =
    phase === "S20"
      ? "STRUCTURED_GEOSPATIAL_SELECTION_INGRESS_UNAVAILABLE: the frozen northbound contracts contain no trusted Finding selector or MapSelection envelope; free text, OpenAI passthrough fields, AG-UI state/context/forwardedProps, and TurnPlan booleans cannot be promoted to world identity. Authoritative REAL_WSGS evidence is also unavailable."
      : ["S14", "S21", "S22", "S24"].includes(phase)
        ? "Authoritative WSGS geospatial consumer handoff/live-chain evidence is unavailable."
        : "No local implementation blocker is recorded; final live completion remains blocked upstream.";
  return `# SACS Geospatial Explanation Phase Report — ${phase}\n\n## Phase\n\n${phase}: **${status}**\n\n## Source SHAs\n\nSee \`reports/v0.4/geospatial/S13-source-lock.json\`; source, runtime, and deployment identities remain distinct.\n\n## Upstream profile/lock hashes\n\nThe checked-in consumer lock is explicitly provisional and \`BLOCKED\`. It is not an authoritative WSGS handoff.\n\n## Changes\n\nSee the phase-scoped source and test evidence mapped in \`acceptance-ledger.json\`.\n\n## Tests actually run\n\n| command | result | evidence |\n|---|---|---|\n${testRows}\n\nFixture or unit evidence is supplementary wherever the matrix requires REAL_WSGS.\n\n## Acceptance IDs\n\nSummary: ${summary.PASS} PASS, ${summary.FAIL} FAIL, ${summary.NOT_RUN} NOT_RUN, ${summary.BLOCKED} BLOCKED (${summary.total} total).\n\n| ID | status | scenario | decision |\n|---|---|---|---|\n${rows}\n\n## Regressions\n\nNo row is bulk-passed. The full 565-case accounting and the 0.4.0 container candidate pass locally; required exact-head CI/GIT, compose, live-chain, SACS-runtime recovery, and PR evidence retains explicit BLOCKED/NOT_RUN status.\n\n## Commit / Push / Draft PR\n\nLocal implementation evidence may reference local commits. This report does not claim a push, PR update, merge, tag, release, or deployment.\n\n## Marker\n\n\`${marker}\`: **${asserted ? "ASSERTED" : "WITHHELD"}**\n\n## Blockers\n\n${blocker}\n`;
}

function finalReport(phaseSummariesValue, totalCounts) {
  const phaseRows = Object.entries(PHASE_METADATA)
    .map(([phase, [status, marker, asserted]]) => {
      const summary = phaseSummariesValue[phase];
      return `| ${phase} | ${status} | ${summary.PASS}/${summary.total} | ${marker} ${asserted ? "asserted" : "withheld"} |`;
    })
    .join("\n");
  return `# SACS v0.4 Geospatial Explanation Final Report\n\n## Decision\n\n**BLOCKED** — safe local implementation evidence exists, but the authoritative WSGS-owned geospatial consumer handoff/profile and real SACS→WSGS→GOWM→GDPS evidence are unavailable.\n\n## Source and PR State\n\nThe pre-change source/PR/CI baseline is recorded in \`S13-source-lock.json\`. Subsequent implementation is local on \`codex/sacs-v0.4-geospatial-explanation\`; this report does not claim an exact-head CI run, push, or PR update.\n\n## WSGS Geospatial Consumer Profile\n\nThe checked-in profile is a task-package proposal with consumer-lock status \`BLOCKED\`. It cannot authorize geospatial business requests or satisfy any acceptance row that requires \`UPSTREAM_LOCK\` or \`REAL_WSGS\`.\n\n## WorldExplanation Contract\n\nA strict \`WorldExplanationV1\` contract, canonical hash, six-part replay identity, typed finding/source/gap closure, and append-only migration 0013 are implemented locally.\n\n## Finding Normalization\n\nThe normalizer accepts only the six locked finding kinds and authoritative WSGS fields. Raw GDPS payloads, \`safePayload\`, unknown extensions, authority overrides, and SACS-side spatial calculations remain rejected.\n\n## Narrative and Protocol Projections\n\nThe deterministic zh/en renderer produces the one persisted explanation projected to OpenAI, AG-UI typed events, map features, and replay. Hybrid presentation keeps SDAR task truth, WSGS/GOWM world truth, and SACS compare-only checks in three explicit sections; protocol-visible status text is redacted.\n\n## Persistence and Replay\n\nMigration 0013, isolated PostgreSQL behavior, physical database restart, and exact replay recovery pass; the S19 marker is asserted. The dedicated restart gate reports that no shared service was modified.\n\n## Multi-turn\n\nPendingChoice and thread-scoped WorldFocus are wired. FindingReferenceResolver and MapSelection remain safe primitives because the frozen northbound contracts have no trusted structured selection envelope, and feature-only ReferenceKeys are not automatically projected into persistent finding links. All S20 rows therefore remain BLOCKED.\n\n## Gap and Currentness Semantics\n\nLocal gap and WSGS-only currentness policies pass their unit/contract evidence. Production currentness remains fail-closed while the authoritative lock is absent.\n\n## Authority Fusion Boundary\n\nThe evaluator remains typed and geospatial findings remain contextual. The exact three-section hybrid runtime, protocol parity, and six-part replay identity pass focused local source/unit/HTTP/isolated-PostgreSQL evidence; the PostgreSQL run used an injected WSGS protocol fixture and is not REAL_WSGS evidence.\n\n## Real SACS→WSGS→GOWM→GDPS E2E\n\nAll 18 required real cases are BLOCKED. The S24 preflight validates the provisional lock and stops before reading transport credentials, issuing GETs, or sending business POSTs.\n\n## Regression / Security / Container\n\nThe final local repository run passed 60 suites and 456 tests, with 15 suites and 109 tests skipped (565 total). Migration, architecture, secret-pattern, build, and container verification gates pass locally. Their S24 acceptance rows remain BLOCKED because the matrix additionally requires exact-head CI and GIT publication evidence. Compose/live-chain, SACS-runtime recovery, and PR gates remain BLOCKED or NOT_RUN.\n\n## Known Limitations\n\nThe authoritative WSGS consumer bundle and live geospatial profile are absent; S20 lacks a versioned trusted selection ingress; all REAL_WSGS/real Gateway/real GDPS-source rows are blocked; no final exact-head CI or Draft PR evidence exists because publication was not authorized.\n\n## Acceptance ledger\n\n${totalCounts.PASS} PASS, ${totalCounts.FAIL} FAIL, ${totalCounts.NOT_RUN} NOT_RUN, ${totalCounts.BLOCKED} BLOCKED across ${totalCounts.total} independently mapped rows.\n\n## Git / Draft PR\n\nNo push, PR update, merge, tag, release, deployment, or shared-infrastructure mutation is claimed by this report.\n\n## Final Marker\n\n\`SACS_V0_4_WORLD_GROUNDING_GEOSPATIAL_EXPLANATION_BLOCKED\`\n`;
}

function parseCsv(value) {
  const records = [];
  let record = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quoted) {
      if (character === '"' && value[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      record.push(field);
      field = "";
    } else if (character === "\n") {
      record.push(field.replace(/\r$/u, ""));
      records.push(record);
      record = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (field.length > 0 || record.length > 0) {
    record.push(field.replace(/\r$/u, ""));
    records.push(record);
  }
  if (quoted) throw new Error("Unterminated CSV quoted field");
  const [rawHeaders, ...data] = records.filter((item) => item.some(Boolean));
  const headers = rawHeaders.map((header, index) =>
    index === 0 ? header.replace(/^\uFEFF/u, "") : header,
  );
  return data.map((values, rowIndex) => {
    if (values.length !== headers.length) {
      throw new Error(
        `CSV row ${rowIndex + 2} has ${values.length} fields; expected ${headers.length}`,
      );
    }
    return Object.fromEntries(
      headers.map((header, index) => [header, values[index]]),
    );
  });
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function json(value) {
  return `${JSON.stringify(value, undefined, 2)}\n`;
}

function escapeMarkdown(value) {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}
