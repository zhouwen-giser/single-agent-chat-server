import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  access,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, relative, resolve } from "node:path";

const root = process.cwd();
const args = process.argv.slice(2);
const checkOnly = args.includes("--check");
const importIndex = args.indexOf("--import-package");
const importPackageRoot =
  importIndex >= 0 && args[importIndex + 1]
    ? resolve(root, args[importIndex + 1])
    : undefined;

const acceptanceRoot = resolve(root, "acceptance/closure/v0.4-v0.5");
const configRoot = resolve(root, "config/closure/v0.4-v0.5");
const contractsRoot = resolve(root, "contracts/closure/v0.4-v0.5");
const reportRoot = resolve(root, "reports/closure");

const MATRIX_RELATIVE =
  "acceptance/closure/v0.4-v0.5/acceptance-matrix.csv";
const EXPECTED_TRACK_COUNTS = Object.freeze({
  GLOBAL: 31,
  V0_4: 102,
  V0_5: 165,
});
const EXPECTED_PHASE_COUNTS = Object.freeze({
  C00: 15,
  C01: 34,
  C02: 14,
  C03: 16,
  C04: 12,
  C05: 18,
  C06: 8,
  C07: 8,
  C08: 23,
  C09: 24,
  C10: 28,
  C11: 30,
  C12: 30,
  C13: 22,
  C14: 16,
});
const ALLOWED_STATUSES = new Set(["PASS", "FAIL", "NOT_RUN", "BLOCKED"]);
const CONTRACT_FILES = Object.freeze([
  "acceptance-evidence-map.schema.json",
  "branch-plan.schema.json",
  "closure-decision.schema.json",
  "implementation-reconciliation.schema.json",
  "real-e2e-report.schema.json",
  "remote-delivery-report.schema.json",
  "structured-selection.schema.json",
  "upstream-dependency-report.schema.json",
]);
const FROZEN_ACCEPTANCE_FILES = Object.freeze([
  "acceptance-matrix.csv",
  "traceability.csv",
  "evidence-map.template.json",
]);
const FROZEN_CONFIG_FILES = Object.freeze([
  "branch-plan.json",
  "final-decision-policy.json",
  "v04-closure-gates.json",
  "v05-implementation-gates.json",
]);
const V05_POSTGRES_EVIDENCE_IDS = new Set([
  "AC-V5-LIFECYCLE-002",
  "AC-V5-LIFECYCLE-003",
  "AC-V5-LIFECYCLE-005",
  "AC-V5-LIFECYCLE-006",
  "AC-V5-LIFECYCLE-008",
  "AC-V5-LIFECYCLE-009",
  "AC-V5-LIFECYCLE-010",
  "AC-V5-LIFECYCLE-011",
  "AC-V5-LIFECYCLE-012",
  "AC-V5-STEER-006",
  "AC-V5-STEER-007",
  "AC-V5-STEER-008",
  "AC-V5-STEER-009",
  "AC-V5-STEER-010",
  "AC-V5-STEER-019",
  "AC-V5-STEER-020",
]);

if (importPackageRoot) {
  if (checkOnly) {
    throw new Error("--import-package and --check are mutually exclusive");
  }
  await importFrozenPackage(importPackageRoot);
}

await requireFile(resolve(acceptanceRoot, "acceptance-matrix.csv"));
await requireFile(resolve(configRoot, "task-package-manifest.json"));

const matrixBytes = await readFile(
  resolve(acceptanceRoot, "acceptance-matrix.csv"),
);
const rows = parseCsv(matrixBytes.toString("utf8"));
verifyMatrix(rows);

const manifest = JSON.parse(
  await readFile(resolve(configRoot, "task-package-manifest.json"), "utf8"),
);
const taskPackageLock = JSON.parse(
  await readFile(resolve(configRoot, "task-package-lock.json"), "utf8"),
);
const finalDecisionPolicy = JSON.parse(
  await readFile(resolve(configRoot, "final-decision-policy.json"), "utf8"),
);
const v04Gates = JSON.parse(
  await readFile(resolve(configRoot, "v04-closure-gates.json"), "utf8"),
);
const v05Gates = JSON.parse(
  await readFile(resolve(configRoot, "v05-implementation-gates.json"), "utf8"),
);
const qualificationSourceLock = JSON.parse(
  await readFile(resolve(configRoot, "qualification-source-lock.json"), "utf8"),
);

const git = captureGitSnapshot(qualificationSourceLock);
const generatedAt = git.headCommittedAt ?? `${manifest.generatedAt}T00:00:00.000Z`;
const auditedRunEvidence = await buildAuditedRunEvidence(git);
const evidenceIndex = await buildEvidenceIndex(auditedRunEvidence);
const expectedCrosswalk = buildCrosswalk(rows, evidenceIndex);
const entries = buildLedgerEntries(rows, expectedCrosswalk, evidenceIndex);
verifyLedger(entries, expectedCrosswalk);

const counts = summarizeAll(entries);
const packageConflicts = buildPackageConflicts(rows);
const v04SourceSha = git.v04.localSha ?? git.headSha;
const v05SourceSha = git.v05.localSha ?? git.headSha;
const v04Decision = buildDecision({
  track: "V0_4",
  decision: "BLOCKED_UPSTREAM",
  sourceSha: v04SourceSha,
  counts: counts.tracks.V0_4,
  blockers: [
    "SACS_WSGS_GEOSPATIAL_HANDOFF_NOT_READY",
    "STRUCTURED_GEOSPATIAL_SELECTION_INGRESS_NOT_QUALIFIED",
    "REAL_V04_CHAIN_NOT_RUN",
  ],
  nonClaims: [
    "No authoritative WSGS geospatial bundle was observed by this report-generation pass.",
    "No real SACS-to-WSGS-to-GOWM-to-GDPS case is promoted from historical blocked evidence.",
    "No exact-head PR or hosted CI success is claimed.",
  ],
});
const v05Decision = buildDecision({
  track: "V0_5",
  decision: "BLOCKED_PREREQUISITE",
  sourceSha: v05SourceSha,
  counts: counts.tracks.V0_5,
  blockers: [
    "SACS_V04_GEOSPATIAL_EXPLANATION_BASELINE_NOT_READY",
    "SACS_WSGS_ANALYSIS_HANDOFF_NOT_READY",
    "ROW_LEVEL_LOCAL_AND_REAL_QUALIFICATION_NOT_RUN",
  ],
  nonClaims: [
    "The historical v0.5 aggregate test report is supplementary and is not per-acceptance exact-head evidence.",
    "No real WSGS analysis plan, event, revision, cancel, intervention, or recovery chain is claimed.",
    "DEVELOPMENT_READY_BLOCKED_LIVE is not claimed while local required rows remain NOT_RUN.",
  ],
});

verifyTrackDecision(v04Decision, finalDecisionPolicy);
verifyTrackDecision(v05Decision, finalDecisionPolicy);

const sourceLock = buildSourceLock({
  generatedAt,
  git,
  manifest,
  taskPackageLock,
  auditedRunEvidence,
});
const implementationMatrix = buildImplementationMatrix({
  generatedAt,
  git,
  manifest,
  v04Gates,
  v05Gates,
});
const branchPrCi = buildBranchPrCi({ generatedAt, git });
const v04Dependency = buildDependency({
  dependencyId: "WSGS_GEospatial_PRESENTATION_HANDOFF",
  owner: "WSGS",
  marker: "SACS_WSGS_GEOSPATIAL_HANDOFF_NOT_READY",
  requiredArtifacts: [
    "WSGS_SACS_CONSUMER_LOCK.json",
    "WSGS_GEOSPATIAL_FINDING_PROFILE.json",
    "WSGS_RESULT_SCHEMA_LOCK.json",
    "WSGS_UPSTREAM_PROVENANCE_LOCK.json",
    "CHECKSUMS.json",
  ],
  blockingGates: ["C02", "C03", "C04", "C05", "C06"],
});
const v05Dependency = buildDependency({
  dependencyId: "WSGS_ANALYSIS_PRESENTATION_CONTROL_HANDOFF",
  owner: "WSGS",
  marker: "SACS_WSGS_ANALYSIS_HANDOFF_NOT_READY",
  requiredArtifacts: [
    "WSGS_ANALYSIS_CONSUMER_LOCK.json",
    "WSGS_ANALYSIS_PLAN_SCHEMA_LOCK.json",
    "WSGS_ANALYSIS_EVENT_SCHEMA_LOCK.json",
    "WSGS_TOOL_INTERACTION_SCHEMA_LOCK.json",
    "WSGS_REVISION_CONTROL_SCHEMA_LOCK.json",
    "WSGS_CANCEL_SCHEMA_LOCK.json",
    "WSGS_INTERVENTION_SCHEMA_LOCK.json",
    "CHECKSUMS.json",
  ],
  blockingGates: ["C08", "C11", "C12", "C13"],
});
const remoteDelivery = buildRemoteDelivery({ generatedAt, git });
const acceptanceLedger = {
  schemaVersion: "sacs-v04-v05-closure-acceptance-ledger/1.0",
  sourceMatrix: {
    path: MATRIX_RELATIVE,
    sha256: sha256(matrixBytes),
    rowCount: rows.length,
  },
  taskPackage: {
    name: manifest.name,
    packageVersion: manifest.packageVersion,
    archiveSha256: taskPackageLock.archive.sha256,
    manifestSha256: taskPackageLock.manifestSha256,
  },
  decisionPolicy: {
    mode: "FAIL_CLOSED_EXPLICIT_PER_ACCEPTANCE_CROSSWALK",
    noAggregatePass: true,
    passRequiresAllEvidenceTypes: true,
    fixtureEvidenceCanSatisfyLiveRows: false,
    exactSourceScopeRequiredForReuse: true,
    reportIsNotAliasedToReportAssertion: true,
    independentTrackDecisions: true,
  },
  counts,
  entries,
};
const acceptanceEvidenceMap = {
  schemaVersion: "sacs-v04-v05-acceptance-evidence-map/1.0",
  entries: entries.map((entry) => ({
    acceptanceId: entry.acceptanceId,
    status: entry.status,
    evidence: entry.evidence,
  })),
};
const v04RealE2e = buildRealE2e({
  track: "V0_4",
  sourceSha: v04SourceSha,
  rows: rows.filter(({ phase }) => phase === "C05"),
  blocker: "SACS_WSGS_GEOSPATIAL_HANDOFF_NOT_READY",
});
const v05RealE2e = buildRealE2e({
  track: "V0_5",
  sourceSha: v05SourceSha,
  rows: rows.filter(({ phase }) => phase === "C13"),
  blocker: "SACS_WSGS_ANALYSIS_HANDOFF_NOT_READY",
});
const v04GapCurrentness = buildGapCurrentness(
  rows.filter(({ phase }) => phase === "C04"),
  v04SourceSha,
);
const phaseSummary = buildPhaseSummary({
  entries,
  counts,
  v04Decision,
  v05Decision,
});

const outputs = new Map([
  [resolve(configRoot, "evidence-crosswalk.json"), json(expectedCrosswalk)],
  [resolve(reportRoot, "C00-source-lock.json"), json(sourceLock)],
  [
    resolve(reportRoot, "C00-implementation-matrix.json"),
    json(implementationMatrix),
  ],
  [resolve(reportRoot, "C00-branch-pr-ci.json"), json(branchPrCi)],
  [
    resolve(reportRoot, "v04-upstream-dependency.json"),
    json(v04Dependency),
  ],
  [
    resolve(reportRoot, "v05-upstream-dependency.json"),
    json(v05Dependency),
  ],
  [resolve(reportRoot, "v04-remote-delivery.json"), json(remoteDelivery)],
  [
    resolve(reportRoot, "audited-run-evidence.json"),
    json(auditedRunEvidence),
  ],
  [resolve(reportRoot, "evidence-index.json"), json(evidenceIndex)],
  [resolve(reportRoot, "acceptance-ledger.json"), json(acceptanceLedger)],
  [
    resolve(reportRoot, "acceptance-evidence-map.json"),
    json(acceptanceEvidenceMap),
  ],
  [
    resolve(reportRoot, "package-contract-conflicts.json"),
    json(packageConflicts),
  ],
  [
    resolve(reportRoot, "v04-gap-currentness.json"),
    json(v04GapCurrentness),
  ],
  [resolve(reportRoot, "v04-real-e2e.json"), json(v04RealE2e)],
  [resolve(reportRoot, "v05-real-e2e.json"), json(v05RealE2e)],
  [resolve(reportRoot, "v04-decision.json"), json(v04Decision)],
  [resolve(reportRoot, "v05-decision.json"), json(v05Decision)],
  [resolve(reportRoot, "phase-summary.json"), json(phaseSummary)],
  [
    resolve(reportRoot, "FINAL_REPORT.md"),
    finalReport({
      git,
      counts,
      v04Decision,
      v05Decision,
      packageConflicts,
      evidenceIndex,
      auditedRunEvidence,
    }),
  ],
]);

for (const phase of Object.keys(EXPECTED_PHASE_COUNTS)) {
  const phaseEntries = entries.filter((entry) => entry.phase === phase);
  outputs.set(
    resolve(reportRoot, `${phase}-phase-report.md`),
    phaseReport(phase, phaseEntries, git),
  );
}

await emitOutputs(outputs, checkOnly);

console.log(
  `CLOSURE_QUALIFICATION_REPORTS_${checkOnly ? "VALID" : "GENERATED"} ` +
    `rows=${entries.length} global=${counts.tracks.GLOBAL.required} ` +
    `v04=${counts.tracks.V0_4.required} v05=${counts.tracks.V0_5.required} ` +
    `pass=${counts.overall.PASS} fail=${counts.overall.FAIL} ` +
    `notRun=${counts.overall.NOT_RUN} blocked=${counts.overall.BLOCKED} ` +
    `v04Decision=${v04Decision.decision} v05Decision=${v05Decision.decision}`,
);

async function importFrozenPackage(packageRoot) {
  const manifestPath = resolve(packageRoot, "MANIFEST.json");
  const manifestBytes = await readFile(manifestPath);
  const value = JSON.parse(manifestBytes.toString("utf8"));

  if (value.requiredAcceptance !== 298 || value.schemas !== 8) {
    throw new Error("Unexpected task-package cardinality");
  }

  for (const item of value.files) {
    const bytes = await readFile(resolve(packageRoot, item.path));
    if (bytes.byteLength !== item.bytes) {
      throw new Error(`Task-package byte mismatch: ${item.path}`);
    }
    if (sha256Hex(bytes) !== item.sha256) {
      throw new Error(`Task-package hash mismatch: ${item.path}`);
    }
  }

  await mkdir(acceptanceRoot, { recursive: true });
  await mkdir(configRoot, { recursive: true });
  await mkdir(contractsRoot, { recursive: true });

  for (const name of FROZEN_ACCEPTANCE_FILES) {
    await writeFile(
      resolve(acceptanceRoot, name),
      await readFile(resolve(packageRoot, "acceptance", name)),
    );
  }
  for (const name of FROZEN_CONFIG_FILES) {
    await writeFile(
      resolve(configRoot, name),
      await readFile(resolve(packageRoot, "config", name)),
    );
  }
  for (const name of CONTRACT_FILES) {
    await writeFile(
      resolve(contractsRoot, name),
      await readFile(resolve(packageRoot, "contracts", name)),
    );
  }
  await writeFile(
    resolve(configRoot, "task-package-manifest.json"),
    manifestBytes,
  );

  const archivePath = resolve(
    "D:/downloads/SACS_v0.4_v0.5_Closure_and_Qualification_Codex_Goal.zip",
  );
  const archiveBytes = await readFile(archivePath);
  const actualFiles = await listFiles(packageRoot);
  const lock = {
    schemaVersion: "sacs-v04-v05-task-package-lock/1.0",
    name: value.name,
    packageVersion: value.packageVersion,
    generatedAt: value.generatedAt,
    archive: {
      fileName: basename(archivePath),
      bytes: archiveBytes.byteLength,
      sha256: sha256(archiveBytes),
    },
    manifestSha256: sha256(manifestBytes),
    integrity: {
      actualFiles: actualFiles.length,
      manifestPayloadFiles: value.files.length,
      payloadHashesVerified: value.files.length,
      schemas: value.schemas,
      requiredAcceptance: value.requiredAcceptance,
      status: "PASS",
    },
    importedFiles: {
      acceptance: [...FROZEN_ACCEPTANCE_FILES],
      config: [...FROZEN_CONFIG_FILES],
      contracts: [...CONTRACT_FILES],
    },
  };
  await writeFile(resolve(configRoot, "task-package-lock.json"), json(lock));
}

function buildCrosswalk(matrixRows, evidence) {
  const availableEvidence = new Map(
    evidence.entries.map((entry) => [entry.evidenceId, entry]),
  );
  return {
    schemaVersion: "sacs-v04-v05-closure-evidence-crosswalk/1.0",
    sourceMatrix: {
      path: MATRIX_RELATIVE,
      rowCount: matrixRows.length,
    },
    policy: {
      explicitEntryPerAcceptanceId: true,
      defaultStatus: "NOT_RUN",
      passRequiresAllEvidenceTypes: true,
      reportAliasForbidden: true,
      fixtureCannotSatisfyLiveEvidence: true,
    },
    entries: matrixRows.map((row) => {
      const classification = classifyRow(row);
      const candidates = candidateEvidenceFor(row).filter((id) =>
        availableEvidence.has(id),
      );
      const suppliedTypes = new Set(
        candidates
          .map((id) => availableEvidence.get(id))
          .filter(({ promotable }) => promotable)
          .map(({ type }) => type),
      );
      const requiredEvidenceTypes = splitEvidence(row.evidence);
      return {
        acceptanceId: row.id,
        track: row.track,
        phase: row.phase,
        requiredEvidenceTypes,
        initialStatus: classification.status,
        reasonCode:
          classification.status === "NOT_RUN" && suppliedTypes.size > 0
            ? "REQUIRED_EVIDENCE_ALL_OF_INCOMPLETE"
            : classification.reasonCode,
        dependencies: classification.dependencies,
        blockerMarkers: classification.blockerMarkers,
        missingEvidenceTypes: requiredEvidenceTypes.filter(
          (type) => !suppliedTypes.has(type),
        ),
        reusePolicy: reusePolicyFor(row),
        candidateEvidenceIds: candidates,
        contractConflicts: hasReportEvidenceConflict(row)
          ? ["MATRIX_REPORT_EVIDENCE_TYPE_NOT_ALLOWLISTED"]
          : [],
      };
    }),
  };
}

function buildLedgerEntries(matrixRows, crosswalk, evidenceIndexValue) {
  const mapping = new Map(
    crosswalk.entries.map((entry) => [entry.acceptanceId, entry]),
  );
  const evidence = new Map(
    evidenceIndexValue.entries.map((entry) => [entry.evidenceId, entry]),
  );
  return matrixRows.map((row) => {
    const map = mapping.get(row.id);
    const candidates = map.candidateEvidenceIds
      .map((id) => evidence.get(id))
      .filter(Boolean)
      .map((item) => ({
        evidenceId: item.evidenceId,
        type: item.type,
        path: item.path,
        sha256: item.sha256,
        assertionLocator: assertionLocatorFor(item.evidenceId, row),
        scope: item.scope,
        promotable: item.promotable,
        fixture: item.fixture,
        limitations: item.limitations,
      }));
    return {
      acceptanceId: row.id,
      required: row.required === "yes",
      track: row.track,
      phase: row.phase,
      area: row.area,
      scenario: row.scenario,
      expected: row.expected,
      requiredEvidenceTypes: map.requiredEvidenceTypes,
      status: map.initialStatus,
      reasonCode: map.reasonCode,
      dependencies: map.dependencies,
      blockerMarkers: map.blockerMarkers,
      evidence: candidates,
      missingEvidenceTypes: map.missingEvidenceTypes,
      reusedFrom: candidates.map(({ evidenceId }) => evidenceId),
      nonClaims: nonClaimsFor(row),
    };
  });
}

function classifyRow(row) {
  if (hasReportEvidenceConflict(row)) {
    return blocked(
      "MATRIX_REPORT_EVIDENCE_TYPE_NOT_ALLOWLISTED",
      ["TASK_PACKAGE_EVIDENCE_CONTRACT_CONFLICT"],
      ["TASK_PACKAGE_CONTRACT_CLEAN"],
    );
  }

  if (row.phase === "C02") {
    return blocked(
      "AUTHORITATIVE_WSGS_GEOSPATIAL_HANDOFF_MISSING",
      ["SACS_WSGS_GEOSPATIAL_HANDOFF_NOT_READY"],
      ["V04_WSGS_GEOSPATIAL_HANDOFF"],
    );
  }
  if (["C03", "C04", "C05"].includes(row.phase)) {
    return blocked(
      "V04_REAL_WSGS_QUALIFICATION_BLOCKED_BY_HANDOFF",
      ["SACS_WSGS_GEOSPATIAL_HANDOFF_NOT_READY"],
      ["V04_WSGS_GEOSPATIAL_HANDOFF"],
    );
  }
  if (
    row.phase === "C01" &&
    [
      "AC-V4-DELIVERY-003",
      "AC-V4-DELIVERY-004",
      "AC-V4-DELIVERY-005",
      "AC-V4-DELIVERY-006",
    ].includes(row.id)
  ) {
    return blocked(
      "REMOTE_PUBLICATION_NOT_AUTHORIZED_BY_CURRENT_REQUEST",
      ["REMOTE_PUBLICATION_WITHHELD"],
      ["REMOTE_PUBLICATION_AUTHORIZATION"],
    );
  }
  if (row.id === "AC-V4-DELIVERY-011") {
    return blocked(
      "REAL_COMPOSE_GATE_BLOCKED_BY_WSGS_HANDOFF",
      ["SACS_WSGS_GEOSPATIAL_HANDOFF_NOT_READY"],
      ["V04_WSGS_GEOSPATIAL_HANDOFF"],
    );
  }
  if (row.phase === "C08" && row.id.startsWith("AC-V5-HANDOFF-")) {
    return blocked(
      "AUTHORITATIVE_WSGS_ANALYSIS_HANDOFF_MISSING",
      ["SACS_WSGS_ANALYSIS_HANDOFF_NOT_READY"],
      ["V05_WSGS_ANALYSIS_HANDOFF"],
    );
  }
  if (
    row.phase === "C11" ||
    row.phase === "C13" ||
    (row.phase === "C12" && row.id.startsWith("AC-V5-RECOVERY-"))
  ) {
    return blocked(
      "V05_REAL_WSGS_QUALIFICATION_BLOCKED_BY_HANDOFF",
      ["SACS_WSGS_ANALYSIS_HANDOFF_NOT_READY"],
      ["V05_WSGS_ANALYSIS_HANDOFF"],
    );
  }

  return {
    status: "NOT_RUN",
    reasonCode: reasonForNotRun(row),
    dependencies: [],
    blockerMarkers: [],
  };
}

function blocked(reasonCode, blockerMarkers, dependencies) {
  return { status: "BLOCKED", reasonCode, blockerMarkers, dependencies };
}

function reasonForNotRun(row) {
  const evidence = splitEvidence(row.evidence);
  if (evidence.includes("REAL_POSTGRES")) return "REAL_POSTGRES_NOT_RUN";
  if (evidence.includes("AGUI_OFFICIAL_CLIENT")) {
    return "AGUI_OFFICIAL_CLIENT_PER_AC_EVIDENCE_NOT_RUN";
  }
  if (evidence.includes("REFERENCE_CLIENT")) {
    return "REFERENCE_CLIENT_PER_AC_EVIDENCE_NOT_RUN";
  }
  if (evidence.includes("CI") || evidence.includes("GIT")) {
    return "CURRENT_SOURCE_REMOTE_CI_RECONCILIATION_NOT_RUN";
  }
  return "LOCAL_PER_AC_EVIDENCE_NOT_RUN";
}

function reusePolicyFor(row) {
  if (splitEvidence(row.evidence).some((type) => type.startsWith("REAL_"))) {
    return "LIVE_EVIDENCE_MUST_BE_RERUN_UNLESS_EXACT_CASE_PROVEN";
  }
  if (row.phase === "C00" || row.phase === "C07") {
    return "HISTORICAL_SOURCE_LOCK_IS_CONTEXT_ONLY";
  }
  return "EXACT_SOURCE_SCOPE_AND_ASSERTION_LOCATOR_REQUIRED";
}

function candidateEvidenceFor(row) {
  const result = [];
  if (row.track === "V0_4" || row.phase === "C00") {
    result.push("V04_ACCEPTANCE_LEDGER_HISTORICAL");
  }
  if (row.phase === "C01") {
    result.push("V04_S19_POSTGRES_RESTART", "V04_S23_REAL_POSTGRES");
  }
  if (["C03", "C04", "C05", "C06"].includes(row.phase)) {
    result.push("V04_S24_BLOCKED_REAL_E2E");
  }
  if (row.track === "V0_5" || row.phase === "C00") {
    result.push("V05_SOURCE_LOCK_HISTORICAL");
  }
  if (["C08", "C09", "C10", "C11", "C12"].includes(row.phase)) {
    result.push("V05_LOCAL_VERIFICATION_SUPPLEMENTARY");
  }
  if (row.phase === "C13") result.push("V05_PHASE_SUMMARY_BLOCKED");
  if (V05_POSTGRES_EVIDENCE_IDS.has(row.id)) {
    result.push("V05_REAL_POSTGRES_7_TESTS");
  }
  if (["AC-C00-014", "AC-V4-HANDOFF-014"].includes(row.id)) {
    result.push("CURRENT_WSGS_18277_GROUNDING_SMOKE");
  }
  return [...new Set(result)];
}

function nonClaimsFor(row) {
  const claims = [];
  const evidence = splitEvidence(row.evidence);
  if (evidence.some((type) => type.startsWith("REAL_"))) {
    claims.push("Historical fixture or blocked reports do not satisfy live evidence.");
  }
  if (hasReportEvidenceConflict(row)) {
    claims.push("REPORT is not silently aliased to REPORT_ASSERTION.");
  }
  if (row.phase === "C00") {
    claims.push("Task-package generation baselines are not current source truth.");
  }
  return claims;
}

async function buildEvidenceIndex(auditedEvidence) {
  const auditedEvidenceBytes = Buffer.from(json(auditedEvidence), "utf8");
  const definitions = [
    {
      evidenceId: "V04_ACCEPTANCE_LEDGER_HISTORICAL",
      type: "REPORT_ASSERTION",
      path: "reports/v0.4/geospatial/acceptance-ledger.json",
      scope: "HISTORICAL",
      fixture: false,
      limitations: [
        "The 305-row ledger uses different acceptance IDs and cannot transfer PASS decisions.",
        "Its source and remote observations predate this closure run.",
      ],
    },
    {
      evidenceId: "V04_S19_POSTGRES_RESTART",
      type: "REAL_POSTGRES",
      path: "reports/v0.4/geospatial/S19-restart-replay.json",
      scope: "SUPPLEMENTARY",
      fixture: true,
      limitations: [
        "It proves an isolated PostgreSQL physical restart and exact replay, not a SACS process restart.",
        "Its grounding result is fixture-scoped and is not REAL_WSGS evidence.",
      ],
    },
    {
      evidenceId: "V04_S23_REAL_POSTGRES",
      type: "REAL_POSTGRES",
      path: "reports/v0.4/geospatial/S23-postgres-evidence.json",
      scope: "SUPPLEMENTARY",
      fixture: true,
      limitations: [
        "The PostgreSQL instance is real and isolated.",
        "The report explicitly identifies WSGS as INJECTED_PROTOCOL_FIXTURE.",
      ],
    },
    {
      evidenceId: "V04_S24_BLOCKED_REAL_E2E",
      type: "REPORT_ASSERTION",
      path: "reports/v0.4/geospatial/S24-real-e2e.json",
      scope: "HISTORICAL",
      fixture: false,
      limitations: [
        "All 18 cases are BLOCKED and no GET or business POST was issued.",
        "It proves fail-closed behavior only and cannot satisfy a live row.",
      ],
    },
    {
      evidenceId: "V05_SOURCE_LOCK_HISTORICAL",
      type: "SOURCE",
      path: "reports/v0.5/observer-first-interactive-analysis/source-lock.json",
      scope: "HISTORICAL",
      fixture: false,
      limitations: [
        "The source lock does not include the commit that created it and is not current C00 truth.",
      ],
    },
    {
      evidenceId: "V05_LOCAL_VERIFICATION_SUPPLEMENTARY",
      type: "UNIT",
      path: "reports/v0.5/observer-first-interactive-analysis/local-verification.json",
      scope: "SUPPLEMENTARY",
      fixture: false,
      limitations: [
        "The current report records implementation commit 9ce9b224, 16 focused suites and 116 tests PASS, but it has no closure-package per-acceptance result map.",
        "Its PostgreSQL 7/7 and limited WSGS smoke are separately scoped; the authoritative WSGS analysis handoff and real analysis chain remain blocked.",
      ],
    },
    {
      evidenceId: "V05_PHASE_SUMMARY_BLOCKED",
      type: "REPORT_ASSERTION",
      path: "reports/v0.5/observer-first-interactive-analysis/phase-summary.json",
      scope: "HISTORICAL",
      fixture: false,
      limitations: [
        "The prior 418-row ledger contains zero PASS and does not satisfy this package's 165-row V0_5 denominator.",
      ],
    },
    {
      evidenceId: "V05_REAL_POSTGRES_7_TESTS",
      type: "REAL_POSTGRES",
      path: "reports/closure/audited-run-evidence.json",
      scope: "PRIMARY",
      fixture: false,
      promotable: true,
      inlineBytes: auditedEvidenceBytes,
      limitations: [
        "Promotion is limited to the lifecycle/proposal assertions exercised by tests/analysis-persistence.postgres.int.test.ts.",
        "The test container was removed after the successful run.",
      ],
    },
    {
      evidenceId: "CURRENT_WSGS_18277_GROUNDING_SMOKE",
      type: "REAL_WSGS",
      path: "reports/closure/audited-run-evidence.json",
      scope: "SUPPLEMENTARY",
      fixture: false,
      promotable: false,
      inlineBytes: auditedEvidenceBytes,
      limitations: [
        "This proves only readiness and one ordinary read-only GROUND_REFERENCES execution.",
        "It does not prove either authoritative handoff bundle, geospatial typed findings, analysis events, revision control, cancel, intervention, GOWM, or GDPS/STAS.",
      ],
    },
  ];

  const entries = [];
  for (const definition of definitions) {
    const path = resolve(root, definition.path);
    try {
      const bytes = definition.inlineBytes ?? (await readFile(path));
      const { inlineBytes: _inlineBytes, ...safeDefinition } = definition;
      entries.push({
        ...safeDefinition,
        exists: true,
        bytes: bytes.byteLength,
        sha256: sha256(bytes),
        promotable: definition.promotable ?? false,
      });
    } catch {
      const { inlineBytes: _inlineBytes, ...safeDefinition } = definition;
      entries.push({
        ...safeDefinition,
        exists: false,
        bytes: 0,
        sha256: null,
        promotable: false,
        limitations: [...definition.limitations, "The referenced file is absent."],
      });
    }
  }
  return {
    schemaVersion: "sacs-v04-v05-closure-evidence-index/1.0",
    policy: {
      historicalStatusCannotBeCopied: true,
      candidateEvidenceIsNonPromotableByDefault: true,
      exactSourceAndAssertionLocatorRequired: true,
      secretsOrRawReferenceIdsPersisted: false,
    },
    entries,
  };
}

async function buildAuditedRunEvidence(gitSnapshot) {
  const sourceScopePaths = [
    "tests/analysis-persistence.postgres.int.test.ts",
    "packages/persistence/src/analysis-repository.ts",
    "packages/persistence/src/runtime.ts",
    "migrations/0015_interactive_analysis.sql",
  ];
  const sourceScope = [];
  for (const path of sourceScopePaths) {
    try {
      const bytes = await readFile(resolve(root, path));
      sourceScope.push({ path, sha256: sha256(bytes) });
    } catch {
      sourceScope.push({ path, sha256: null, status: "ABSENT" });
    }
  }
  const wsgs = {
    status: "PASS",
    endpoint: "http://127.0.0.1:18277",
    readiness: { httpStatus: 200 },
    runtimeRevision: "b3315cbb5dce9635911a90ac095b93b1efab8e70",
    request: {
      operation: "GROUND_REFERENCES",
      authentication: "NONE",
      executionPolicyReadOnly: true,
      submitHttpStatus: 202,
      pollHttpStatuses: [200],
    },
    terminal: {
      status: "COMPLETED",
      resultStatus: "COMPLETED",
      errorCode: null,
      errorStage: null,
      referenceProductCount: 1,
      capabilityGapCount: 0,
      resultHash:
        "sha256:1458ab0e3570611925f206e025d06f2742c98f1b3316377bf0db760cffa4b45c",
    },
    limitations: [
      "No bearer credential was used or persisted.",
      "This is a base-operation smoke, not authoritative geospatial or analysis-presentation handoff evidence.",
      "No GOWM/GDPS/STAS claim is made by this smoke record.",
    ],
  };
  return {
    schemaVersion: "sacs-v04-v05-audited-run-evidence/1.0",
    observedAt: "2026-08-30T10:03:37.8328244Z",
    source: {
      worktreeHead: gitSnapshot.headSha,
      branch: gitSnapshot.branch,
      scopeFiles: sourceScope,
      scopeHash: sha256(Buffer.from(json(sourceScope), "utf8")),
    },
    wsgs,
    realPostgres: {
      status: "PASS",
      suite: "tests/analysis-persistence.postgres.int.test.ts",
      suitesPassed: 1,
      testsPassed: 7,
      testsFailed: 0,
      containerRemovedAfterRun: true,
      sharedServicesModified: false,
      assertionNodes: [
        "atomically appends an event and restores its exact projection snapshot",
        "replays an exact duplicate but rejects event or sequence collisions",
        "rolls back event insertion when the projection is invalid",
        "switches active revisions with CAS and preserves late events as audit only",
        "keeps a queued revision inactive until the old run is terminal, then activates and starts atomically",
        "enforces scoped proposal idempotency and one pending proposal",
        "enforces run-attempt uniqueness and append-only events in PostgreSQL",
      ],
    },
    security: {
      credentialsPrintedOrPersisted: false,
      rawReferenceIdsPersisted: false,
    },
  };
}

function assertionLocatorFor(evidenceId, row) {
  if (evidenceId === "V05_REAL_POSTGRES_7_TESTS") {
    return `tests/analysis-persistence.postgres.int.test.ts :: ${postgresAssertionFor(row.acceptanceId)}`;
  }
  if (evidenceId === "CURRENT_WSGS_18277_GROUNDING_SMOKE") {
    return "audited-run-evidence.json#/wsgs";
  }
  return `${row.id}: ${row.scenario}`;
}

function postgresAssertionFor(acceptanceId) {
  if (["AC-V5-LIFECYCLE-008", "AC-V5-LIFECYCLE-009"].includes(acceptanceId)) {
    return "replays an exact duplicate but rejects event or sequence collisions";
  }
  if (["AC-V5-LIFECYCLE-010", "AC-V5-LIFECYCLE-012", "AC-V5-STEER-007"].includes(acceptanceId)) {
    return "switches active revisions with CAS and preserves late events as audit only";
  }
  if (["AC-V5-STEER-006", "AC-V5-STEER-008", "AC-V5-STEER-009", "AC-V5-STEER-010"].includes(acceptanceId)) {
    return "enforces scoped proposal idempotency and one pending proposal";
  }
  if (["AC-V5-STEER-019", "AC-V5-STEER-020", "AC-V5-LIFECYCLE-002"].includes(acceptanceId)) {
    return "keeps a queued revision inactive until the old run is terminal, then activates and starts atomically";
  }
  if (["AC-V5-LIFECYCLE-003", "AC-V5-LIFECYCLE-005"].includes(acceptanceId)) {
    return "enforces run-attempt uniqueness and append-only events in PostgreSQL";
  }
  return "atomically appends an event and restores its exact projection snapshot";
}

function buildPackageConflicts(matrixRows) {
  const reportRows = matrixRows
    .filter((row) => splitEvidence(row.evidence).includes("REPORT"))
    .map(({ id }) => id);
  if (reportRows.length !== 24) {
    throw new Error(`Expected 24 REPORT conflict rows, received ${reportRows.length}`);
  }
  return {
    schemaVersion: "sacs-v04-v05-package-contract-conflicts/1.0",
    status: "BLOCKED",
    canPromoteAffectedAcceptance: false,
    safePolicy:
      "Canonical conflicts are preserved. REPORT is not silently aliased to REPORT_ASSERTION, and weak schemas are supplemented by generator invariants.",
    conflicts: [
      {
        code: "MATRIX_REPORT_EVIDENCE_TYPE_NOT_ALLOWLISTED",
        evidenceType: "REPORT",
        templateType: "REPORT_ASSERTION",
        acceptanceIds: reportRows,
        safeResolution:
          "Keep affected rows BLOCKED until the canonical task package defines an explicit mapping or allowlists REPORT.",
      },
      {
        code: "CLOSURE_DECISION_SCHEMA_NOT_TRACK_CONDITIONAL",
        acceptanceIds: ["AC-FINAL-015", "AC-FINAL-016"],
        safeResolution:
          "Enforce the narrower track-specific enums from final-decision-policy.json in the generator.",
      },
      {
        code: "V05_DEFERRED_CONFIG_OMITS_LARGE_SCALE_TRAJECTORY",
        acceptanceIds: ["AC-V5-NONGOAL-010"],
        safeResolution:
          "Treat Large-scale trajectory playback as deferred because the master prompt and acceptance matrix are stricter than the config list.",
      },
      {
        code: "MACHINE_SCHEMAS_DO_NOT_ENFORCE_CARDINALITY",
        acceptanceIds: [],
        safeResolution:
          "Enforce 298 unique ledger entries, exact track/phase counts, non-empty missing evidence, and 18/22 E2E case sets in this generator.",
      },
    ],
  };
}

function buildSourceLock({
  generatedAt: at,
  git: snapshot,
  manifest: packageManifest,
  taskPackageLock: lock,
  auditedRunEvidence: audited,
}) {
  return {
    schemaVersion: "sacs-v04-v05-closure-source-lock/1.0",
    capturedAt: at,
    status: "NOT_RUN",
    reasonCode: "REMOTE_UPSTREAM_SOURCE_AND_CI_REFRESH_NOT_RUN",
    taskPackage: {
      name: packageManifest.name,
      packageVersion: packageManifest.packageVersion,
      archiveSha256: lock.archive.sha256,
      manifestSha256: lock.manifestSha256,
      integrity: lock.integrity,
    },
    sacs: snapshot,
    packageGenerationBaselines: packageManifest.knownBaselines,
    upstreamCurrentSources: {
      wsgs: { status: "NOT_RUN", sourceSha: null },
      gdps: { status: "NOT_RUN", sourceSha: null },
      gowm: { status: "NOT_RUN", sourceSha: null },
    },
    runtime: {
      status: "PARTIAL",
      wsgs: {
        readiness: "PASS",
        endpoint: audited.wsgs.endpoint,
        runtimeRevision: audited.wsgs.runtimeRevision,
        baseOperationSmoke: "PASS",
        authoritativeGeospatialHandoff: "NOT_VERIFIED",
        authoritativeAnalysisHandoff: "NOT_VERIFIED",
      },
      gowm: { readiness: "NOT_RUN", availability: "NOT_RUN" },
      credentialsPrintedOrPersisted: false,
    },
    nonClaims: [
      "Package-generation SHAs are context, not current source truth.",
      "No remote fetch or authenticated capability request was performed by the report generator.",
      "The recorded ordinary grounding POST does not establish either authoritative handoff or a downstream GOWM/GDPS/STAS chain.",
    ],
  };
}

function buildImplementationMatrix({ generatedAt: at, git: snapshot, manifest: packageManifest, v04Gates: v4, v05Gates: v5 }) {
  return {
    schemaVersion: "sacs-v04-v05-closure-implementation-matrix/1.0",
    generatedAt: at,
    status: "NOT_RUN",
    sources: {
      sacs: { status: "LOCAL_ONLY", sha: snapshot.headSha },
      wsgs: {
        status: "NOT_RUN",
        packageGenerationSha: packageManifest.knownBaselines.wsgs,
      },
      gdps: {
        status: "NOT_RUN",
        packageGenerationSha: packageManifest.knownBaselines.gdpsMain,
      },
      gowm: {
        status: "NOT_RUN",
        packageGenerationSha: packageManifest.knownBaselines.gowmMain,
      },
    },
    v04: {
      branch: "codex/sacs-v0.4-geospatial-explanation",
      headSha: snapshot.v04.localSha,
      items: [
        ...v4.preserveImplemented.map((id) => ({
          id,
          status: "IMPLEMENTED_LOCAL_ONLY",
          evidence: ["reports/v0.4/geospatial/acceptance-ledger.json"],
        })),
        ...v4.requiredRemaining.map((id) => ({
          id,
          status: statusForV04Remaining(id),
          evidence: [],
        })),
      ],
    },
    v05: {
      branch: "codex/sacs-v0.5-observer-first-interactive-analysis",
      headSha: snapshot.v05.localSha,
      items: v5.coreScope.map((id) => ({
        id,
        status:
          id === "RevisionRecompile" || id === "InterruptCancelResume"
            ? "BLOCKED_UPSTREAM"
            : "IMPLEMENTED_LOCAL_ONLY",
        evidence: [
          "reports/v0.5/observer-first-interactive-analysis/local-verification.json",
        ],
      })),
    },
  };
}

function statusForV04Remaining(id) {
  if (
    [
      "AuthoritativeWsgsGeospatialHandoff",
      "RealGapCurrentnessEvidence",
      "Real18CaseE2E",
      "ComposeRestartOutageRecovery",
    ].includes(id)
  ) {
    return "BLOCKED_UPSTREAM";
  }
  return "MISSING";
}

function buildBranchPrCi({ generatedAt: at, git: snapshot }) {
  return {
    schemaVersion: "sacs-v04-v05-branch-pr-ci/1.0",
    capturedAt: at,
    status: "NOT_RUN",
    remoteRefresh: "NOT_RUN",
    v04: {
      branch: "codex/sacs-v0.4-geospatial-explanation",
      localSha: snapshot.v04.localSha,
      trackingSha: snapshot.v04.trackingSha,
      cachedRemoteSha: snapshot.v04.cachedRemoteSha,
      pullRequest: "NOT_RUN",
      ci: "NOT_RUN",
    },
    v05: {
      branch: "codex/sacs-v0.5-observer-first-interactive-analysis",
      localSha: snapshot.v05.localSha,
      trackingSha: snapshot.v05.trackingSha,
      cachedRemoteSha: snapshot.v05.cachedRemoteSha,
      pullRequest: "NOT_RUN",
      ci: "NOT_RUN",
    },
    protectedActions: {
      push: "NOT_RUN",
      pullRequestCreateOrUpdate: "NOT_RUN",
      merge: "NOT_RUN",
      tag: "NOT_RUN",
      release: "NOT_RUN",
      deploy: "NOT_RUN",
    },
  };
}

function buildDependency({ dependencyId, owner, marker, requiredArtifacts, blockingGates }) {
  return {
    schemaVersion: "sacs-upstream-dependency-report/1.0",
    dependencyId,
    owner,
    status: "MISSING",
    requiredArtifacts,
    blockingGates,
    details: {
      marker,
      authoritativeArtifactsObserved: 0,
      instanceReadinessDoesNotSubstituteForHandoff: true,
      credentialsReadOrPersisted: false,
    },
  };
}

function buildRemoteDelivery({ generatedAt: at, git: snapshot }) {
  return {
    schemaVersion: "sacs-remote-delivery-candidate/1.0",
    capturedAt: at,
    status: "BLOCKED",
    reasonCode: "CURRENT_REMOTE_PUBLICATION_NOT_AUTHORIZED_OR_REFRESHED",
    branch: "codex/sacs-v0.4-geospatial-explanation",
    localSha: snapshot.v04.localSha,
    trackingSha: snapshot.v04.trackingSha,
    remoteSha: snapshot.v04.cachedRemoteSha,
    prState: "NOT_RUN",
    ciState: "NOT_RUN",
    workflowRunIds: [],
    protectedActionsPerformed: [],
  };
}

function buildDecision({ track, decision, sourceSha, counts: trackCounts, blockers, nonClaims }) {
  return {
    schemaVersion: "sacs-closure-decision/1.0",
    track,
    decision,
    sourceSha,
    acceptance: {
      required: trackCounts.required,
      pass: trackCounts.PASS,
      fail: trackCounts.FAIL,
      notRun: trackCounts.NOT_RUN,
      blocked: trackCounts.BLOCKED,
    },
    blockers,
    nonClaims,
    pullRequest: {
      state: "NOT_RUN",
      exactHeadCi: "NOT_RUN",
      protectedActionsPerformed: [],
    },
  };
}

function buildRealE2e({ track, sourceSha, rows: caseRows, blocker }) {
  const expectedCount = track === "V0_4" ? 18 : 22;
  if (caseRows.length !== expectedCount) {
    throw new Error(`${track} expected ${expectedCount} E2E rows, received ${caseRows.length}`);
  }
  return {
    schemaVersion: "sacs-real-e2e-report/1.0",
    track,
    sourceSha,
    environmentFingerprint: `sha256:${"0".repeat(64)}`,
    cases: caseRows.map((row) => ({
      caseId: row.id,
      status: "BLOCKED",
      evidence: [],
      reasonCode: blocker,
      scenario: row.scenario,
      credentialsPrintedOrPersisted: false,
      rawReferenceIdsPersisted: false,
    })),
    decision: "BLOCKED",
  };
}

function buildGapCurrentness(caseRows, sourceSha) {
  if (caseRows.length !== 12) {
    throw new Error(`V0_4 gap/currentness expected 12 rows, received ${caseRows.length}`);
  }
  return {
    schemaVersion: "sacs-v04-gap-currentness-report/1.0",
    status: "BLOCKED",
    sourceSha,
    reasonCode: "SACS_WSGS_GEOSPATIAL_HANDOFF_NOT_READY",
    cases: caseRows.map((row) => ({
      acceptanceId: row.id,
      scenario: row.scenario,
      status: "BLOCKED",
      evidence: [],
    })),
    nonClaims: [
      "Local gap/currentness policy tests do not satisfy REAL_WSGS, RUNNING_GOWM, or REAL_GDPS.",
    ],
  };
}

function buildPhaseSummary({ entries: ledgerEntries, counts: allCounts, v04Decision: v4, v05Decision: v5 }) {
  return {
    schemaVersion: "sacs-v04-v05-closure-phase-summary/1.0",
    decisions: { v04: v4.decision, v05: v5.decision },
    counts: allCounts,
    phases: Object.fromEntries(
      Object.keys(EXPECTED_PHASE_COUNTS).map((phase) => {
        const phaseEntries = ledgerEntries.filter((entry) => entry.phase === phase);
        const summary = summarize(phaseEntries);
        return [phase, { status: aggregateStatus(summary), acceptance: summary }];
      }),
    ),
    protectedActionsPerformed: [],
  };
}

function phaseReport(phase, phaseEntries, gitSnapshot) {
  const summary = summarize(phaseEntries);
  const status = aggregateStatus(summary);
  const rows = phaseEntries
    .map(
      (entry) =>
        `| ${entry.acceptanceId} | ${entry.status} | ${escapeMarkdown(entry.scenario)} | ${entry.reasonCode} | ${escapeMarkdown(entry.missingEvidenceTypes.join(", "))} |`,
    )
    .join("\n");
  return `# Closure Qualification Phase Report — ${phase}\n\n## Status\n\n**${status}** — ${summary.PASS} PASS, ${summary.FAIL} FAIL, ${summary.NOT_RUN} NOT_RUN, ${summary.BLOCKED} BLOCKED (${summary.required} required).\n\n## Source\n\n- Qualification source branch: \`${gitSnapshot.branch}\`\n- Pinned qualification source: \`${gitSnapshot.headSha}\`\n- Remote/PR/CI refresh: \`NOT_RUN\`\n- Audited WSGS base-operation smoke: \`PARTIAL / SUPPLEMENTARY\`\n\n## Acceptance\n\n| ID | status | scenario | reason | missing evidence |\n|---|---|---|---|---|\n${rows}\n\n## Evidence policy\n\nEvery acceptance row is explicit. Historical reports are supplementary unless exact source scope and assertion locators are proven. Fixture evidence cannot satisfy live rows, and \`REPORT\` is not aliased to \`REPORT_ASSERTION\`.\n\n## Protected actions\n\nNo push, PR mutation, merge, tag, release, deployment, shared-infrastructure restart, or credential persistence is claimed.\n`;
}

function finalReport({
  git: snapshot,
  counts: allCounts,
  v04Decision: v4,
  v05Decision: v5,
  packageConflicts: conflicts,
  evidenceIndex: evidence,
  auditedRunEvidence: audited,
}) {
  const phaseRows = Object.entries(EXPECTED_PHASE_COUNTS)
    .map(([phase, required]) => {
      const summary = allCounts.phases[phase];
      return `| ${phase} | ${required} | ${summary.PASS} | ${summary.FAIL} | ${summary.NOT_RUN} | ${summary.BLOCKED} | ${aggregateStatus(summary)} |`;
    })
    .join("\n");
  const conflictRows = conflicts.conflicts
    .map((conflict) => `- \`${conflict.code}\`: ${conflict.safeResolution}`)
    .join("\n");
  const evidenceRows = evidence.entries
    .map(
      (entry) =>
        `| ${entry.evidenceId} | ${entry.scope} | ${entry.promotable ? "yes" : "no"} | ${escapeMarkdown(entry.path)} |`,
    )
    .join("\n");
  return `# SACS v0.4 / v0.5 Closure and Qualification Final Report\n\n## Outcome\n\n- V4 decision: **${v4.decision}**\n- V5 decision: **${v5.decision}**\n- GLOBAL rows are reported independently and are not folded into either decision denominator.\n\n## Exact qualification sources\n\n- Pinned SACS qualification source: \`${snapshot.branch}@${snapshot.headSha}\`\n- V4 local source: \`codex/sacs-v0.4-geospatial-explanation@${snapshot.v04.localSha ?? "NOT_FOUND"}\`\n- V5 qualification source: \`codex/sacs-v0.5-observer-first-interactive-analysis@${snapshot.v05.localSha ?? "NOT_FOUND"}\`\n- The closure artifact commit is intentionally not treated as product qualification source.\n- Remote/PR/CI refresh: \`NOT_RUN\`\n\n## Independent acceptance denominators\n\n- GLOBAL: ${allCounts.tracks.GLOBAL.PASS} PASS, ${allCounts.tracks.GLOBAL.FAIL} FAIL, ${allCounts.tracks.GLOBAL.NOT_RUN} NOT_RUN, ${allCounts.tracks.GLOBAL.BLOCKED} BLOCKED / ${allCounts.tracks.GLOBAL.required}\n- V0_4: ${allCounts.tracks.V0_4.PASS} PASS, ${allCounts.tracks.V0_4.FAIL} FAIL, ${allCounts.tracks.V0_4.NOT_RUN} NOT_RUN, ${allCounts.tracks.V0_4.BLOCKED} BLOCKED / ${allCounts.tracks.V0_4.required}\n- V0_5: ${allCounts.tracks.V0_5.PASS} PASS, ${allCounts.tracks.V0_5.FAIL} FAIL, ${allCounts.tracks.V0_5.NOT_RUN} NOT_RUN, ${allCounts.tracks.V0_5.BLOCKED} BLOCKED / ${allCounts.tracks.V0_5.required}\n\nNo aggregate PASS is calculated.\n\n## Phase accounting\n\n| phase | required | PASS | FAIL | NOT_RUN | BLOCKED | status |\n|---|---:|---:|---:|---:|---:|---|\n${phaseRows}\n\n## V4 decision\n\n**${v4.decision}**. The checked-in historical reports do not contain an authoritative five-artifact WSGS geospatial handoff or a completed real 18-case chain. Existing isolated PostgreSQL evidence remains supplementary and is never promoted to REAL_WSGS.\n\n## V5 decision\n\n**${v5.decision}**. The current focused local run and isolated PostgreSQL suite pass, but closure-package per-acceptance SCHEMA/UNIT mappings remain incomplete, the prior 418-row ledger contains zero PASS, and the authoritative eight-artifact WSGS analysis handoff is absent. Therefore \`DEVELOPMENT_READY_BLOCKED_LIVE\` is not claimed.\n\n## Candidate and audited evidence\n\n| evidence | scope | promotable | path |\n|---|---|---|---|\n${evidenceRows}\n\n## Canonical package conflicts\n\n${conflictRows}\n\nThe 24 rows requiring \`REPORT\` remain BLOCKED because the canonical template allowlists \`REPORT_ASSERTION\` instead. No silent alias is applied.\n\n## Audited runtime evidence\n\n- WSGS \`${audited.wsgs.endpoint}\` readiness returned HTTP ${audited.wsgs.readiness.httpStatus}.\n- One unauthenticated, read-only \`GROUND_REFERENCES\` request completed with one reference product, zero capability gaps, and no error code/stage.\n- Runtime OCI revision: \`${audited.wsgs.runtimeRevision}\`.\n- Isolated PostgreSQL: \`${audited.realPostgres.suite}\` passed 1 suite / 7 tests; the container was removed afterward.\n\nThe WSGS smoke is only base-operation evidence and does not promote any authoritative geospatial/analysis handoff or GOWM/GDPS/STAS row. PostgreSQL evidence is attached only to the lifecycle/proposal assertions actually exercised; rows still lack their remaining all-of evidence.\n\n## Real E2E and environment\n\nNo geospatial 18-case chain, analysis 22-case chain, shared-service failure injection, or SACS/container restart was performed by this reporting pass. Readiness and one ordinary grounding operation cannot replace either authoritative handoff bundle.\n\n## Security and protected actions\n\nNo bearer token, raw world reference ID, or response body is persisted. No push, PR mutation, merge, tag, release, deployment, or shared-infrastructure mutation is claimed.\n`;
}

function captureGitSnapshot(sourceLock) {
  const qualificationSourceSha = sourceLock?.qualificationSourceSha;
  const qualificationSourceBranch = sourceLock?.qualificationSourceBranch;
  if (!/^[0-9a-f]{40}$/u.test(qualificationSourceSha ?? "")) {
    throw new Error("qualificationSourceSha must be a full lowercase Git SHA");
  }
  const actualHeadSha = gitValue(["rev-parse", "HEAD"]);
  const branch = gitValue(["rev-parse", "--abbrev-ref", "HEAD"]);
  if (branch !== qualificationSourceBranch) {
    throw new Error(
      `Qualification source branch mismatch: ${branch} != ${qualificationSourceBranch}`,
    );
  }
  try {
    gitValue(["cat-file", "-e", `${qualificationSourceSha}^{commit}`]);
    gitValue([
      "merge-base",
      "--is-ancestor",
      qualificationSourceSha,
      actualHeadSha,
    ]);
  } catch {
    throw new Error("Qualification source commit is missing or not an ancestor");
  }
  const headCommittedAt = gitValue([
    "show",
    "-s",
    "--format=%cI",
    qualificationSourceSha,
  ]);
  const dirty = gitLines(["status", "--porcelain"]);
  const dirtyOutsideClosure = dirty.filter(
    (line) => !isClosurePath(line.slice(3)),
  );
  const committedChangesOutsideClosure = gitLines([
    "diff",
    "--name-only",
    `${qualificationSourceSha}..${actualHeadSha}`,
    "--",
  ]).filter((path) => !isClosurePath(path));
  if (
    sourceLock?.policy?.allowOnlyClosureChangesAfterSource === true &&
    (dirtyOutsideClosure.length > 0 ||
      committedChangesOutsideClosure.length > 0)
  ) {
    throw new Error(
      "Non-closure changes exist after the pinned qualification source",
    );
  }
  return {
    repository: "single-agent-chat-server",
    branch,
    headSha: qualificationSourceSha,
    headCommittedAt,
    qualificationSourcePinned: true,
    closureArtifactCommitIsNotQualificationSource: true,
    dirtyOutsideClosure,
    committedChangesOutsideClosure,
    closurePathsExcludedFromDirtyAssessment: true,
    v04: branchSnapshot("codex/sacs-v0.4-geospatial-explanation"),
    v05: branchSnapshot(
      "codex/sacs-v0.5-observer-first-interactive-analysis",
      qualificationSourceSha,
    ),
  };
}

function branchSnapshot(name, localShaOverride) {
  return {
    branch: name,
    localSha:
      localShaOverride ?? gitOptional(["rev-parse", `refs/heads/${name}`]),
    trackingSha: gitOptional(["rev-parse", `${name}@{upstream}`]),
    cachedRemoteSha: gitOptional(["rev-parse", `refs/remotes/origin/${name}`]),
    remoteRefRefresh: "NOT_RUN",
  };
}

function isClosurePath(path) {
  const normalized = path.replaceAll("\\", "/");
  return (
    normalized.startsWith("acceptance/closure/") ||
    normalized.startsWith("config/closure/") ||
    normalized.startsWith("contracts/closure/") ||
    normalized.startsWith("reports/closure/") ||
    normalized === "scripts/generate-closure-qualification.mjs"
  );
}

function gitValue(arguments_) {
  return execFileSync("git", arguments_, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

function gitOptional(arguments_) {
  try {
    return gitValue(arguments_);
  } catch {
    return null;
  }
}

function gitLines(arguments_) {
  const value = gitValue(arguments_);
  return value ? value.split(/\r?\n/u) : [];
}

function verifyMatrix(matrixRows) {
  if (matrixRows.length !== 298) {
    throw new Error(`Expected 298 acceptance rows, received ${matrixRows.length}`);
  }
  const ids = new Set();
  for (const row of matrixRows) {
    if (row.required !== "yes") throw new Error(`${row.id} is not required`);
    if (ids.has(row.id)) throw new Error(`Duplicate acceptance ID: ${row.id}`);
    ids.add(row.id);
    if (splitEvidence(row.evidence).length === 0) {
      throw new Error(`${row.id} has no evidence requirement`);
    }
  }
  verifyGroupedCounts(matrixRows, "track", EXPECTED_TRACK_COUNTS);
  verifyGroupedCounts(matrixRows, "phase", EXPECTED_PHASE_COUNTS);
}

function verifyLedger(ledgerEntries, crosswalk) {
  if (ledgerEntries.length !== 298 || crosswalk.entries.length !== 298) {
    throw new Error("Ledger and crosswalk must each contain 298 entries");
  }
  const ids = new Set();
  for (const entry of ledgerEntries) {
    if (ids.has(entry.acceptanceId)) {
      throw new Error(`Duplicate ledger entry: ${entry.acceptanceId}`);
    }
    ids.add(entry.acceptanceId);
    if (!ALLOWED_STATUSES.has(entry.status)) {
      throw new Error(`${entry.acceptanceId} has invalid status ${entry.status}`);
    }
    if (entry.status === "PASS") {
      const supplied = new Set(
        entry.evidence
          .filter(({ promotable }) => promotable)
          .map(({ type }) => type),
      );
      const missing = entry.requiredEvidenceTypes.filter((type) => !supplied.has(type));
      if (missing.length > 0) {
        throw new Error(`${entry.acceptanceId} cannot PASS without ${missing.join(", ")}`);
      }
    } else if (entry.missingEvidenceTypes.length === 0) {
      throw new Error(`${entry.acceptanceId} lacks explicit missing evidence`);
    }
  }
}

function verifyTrackDecision(decision, policy) {
  const policyKey = decision.track === "V0_4" ? "v04" : "v05";
  if (!policy[policyKey].allowed.includes(decision.decision)) {
    throw new Error(`${decision.track} uses forbidden decision ${decision.decision}`);
  }
  const acceptance = decision.acceptance;
  if (
    acceptance.pass + acceptance.fail + acceptance.notRun + acceptance.blocked !==
    acceptance.required
  ) {
    throw new Error(`${decision.track} acceptance counts do not sum`);
  }
  if (decision.decision === "MERGE_READY" || decision.decision === "REAL_READY") {
    if (
      acceptance.fail !== 0 ||
      acceptance.notRun !== 0 ||
      acceptance.blocked !== 0 ||
      acceptance.pass !== acceptance.required
    ) {
      throw new Error(`${decision.track} cannot be ready with non-PASS rows`);
    }
  }
}

function summarizeAll(items) {
  return {
    overall: summarize(items),
    tracks: Object.fromEntries(
      Object.keys(EXPECTED_TRACK_COUNTS).map((track) => [
        track,
        summarize(items.filter((item) => item.track === track)),
      ]),
    ),
    phases: Object.fromEntries(
      Object.keys(EXPECTED_PHASE_COUNTS).map((phase) => [
        phase,
        summarize(items.filter((item) => item.phase === phase)),
      ]),
    ),
  };
}

function summarize(items) {
  const result = {
    required: items.length,
    PASS: 0,
    FAIL: 0,
    NOT_RUN: 0,
    BLOCKED: 0,
  };
  for (const item of items) result[item.status] += 1;
  return result;
}

function aggregateStatus(summary) {
  if (summary.FAIL > 0) return "FAIL";
  if (summary.BLOCKED > 0) return "BLOCKED";
  if (summary.NOT_RUN > 0) return "NOT_RUN";
  return "PASS";
}

function verifyGroupedCounts(rowsValue, key, expected) {
  const actual = Object.fromEntries(
    Object.keys(expected).map((value) => [
      value,
      rowsValue.filter((row) => row[key] === value).length,
    ]),
  );
  for (const [value, count] of Object.entries(expected)) {
    if (actual[value] !== count) {
      throw new Error(`${key} ${value}: expected ${count}, received ${actual[value]}`);
    }
  }
}

async function emitOutputs(outputs, verifyOnly) {
  const drift = [];
  for (const [path, content] of outputs) {
    if (verifyOnly) {
      try {
        const current = await readFile(path, "utf8");
        if (current !== content) drift.push(relative(root, path));
      } catch {
        drift.push(relative(root, path));
      }
    } else {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content, "utf8");
    }
  }
  if (drift.length > 0) {
    throw new Error(`Closure qualification artifact drift: ${drift.join(", ")}`);
  }
}

async function requireFile(path) {
  try {
    await access(path);
  } catch {
    throw new Error(
      `Missing frozen closure input ${relative(root, path)}; run with --import-package <extracted-package-root> first`,
    );
  }
}

async function listFiles(directory) {
  const result = [];
  for (const name of await readdir(directory)) {
    const path = resolve(directory, name);
    const value = await stat(path);
    if (value.isDirectory()) result.push(...(await listFiles(path)));
    else result.push(path);
  }
  return result;
}

function splitEvidence(value) {
  return value.split("/").filter(Boolean);
}

function hasReportEvidenceConflict(row) {
  return splitEvidence(row.evidence).includes("REPORT");
}

function sha256(value) {
  return `sha256:${sha256Hex(value)}`;
}

function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function escapeMarkdown(value) {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
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
  const [headers, ...body] = records.filter(
    (row) => row.length > 1 || row[0]?.length > 0,
  );
  return body.map((row) =>
    Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])),
  );
}
