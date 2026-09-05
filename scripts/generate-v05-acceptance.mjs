import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

const root = process.cwd();
const acceptanceRoot = resolve(
  root,
  "acceptance/v0.5/observer-first-interactive-analysis",
);
const configRoot = resolve(
  root,
  "config/v0.5/observer-first-interactive-analysis",
);
const contractsRoot = resolve(
  root,
  "contracts/v0.5/observer-first-interactive-analysis",
);
const matrixPath = resolve(acceptanceRoot, "acceptance-matrix.csv");
const traceabilityPath = resolve(acceptanceRoot, "traceability.csv");
const templatePath = resolve(acceptanceRoot, "evidence-map.template.json");
const evidenceMapSchemaPath = resolve(
  contractsRoot,
  "acceptance-evidence-map.schema.json",
);
const e2eCorpusPath = resolve(configRoot, "e2e-corpus.json");
const phaseMarkersPath = resolve(configRoot, "phase-markers.json");
const taskManifestPath = resolve(configRoot, "task-package-manifest.json");

const EXPECTED_PHASE_COUNTS = Object.freeze({
  A00: 20,
  A01: 36,
  A02: 42,
  A03: 21,
  A04: 18,
  A05: 23,
  A06: 41,
  A07: 23,
  A08: 27,
  A09: 23,
  A10: 21,
  A11: 15,
  A12: 21,
  A13: 34,
  A14: 53,
});
const EXPECTED_STATUS_COUNTS = Object.freeze({
  PASS: 0,
  FAIL: 0,
  NOT_RUN: 347,
  BLOCKED: 71,
  total: 418,
});
const ALLOWED_ROW_STATUSES = Object.freeze([
  "PASS",
  "FAIL",
  "NOT_RUN",
  "BLOCKED",
]);
const LIVE_EVIDENCE_TYPES = new Set([
  "REAL_CHAIN",
  "REAL_WSGS",
  "RUNNING_GOWM_GATEWAY",
  "REAL_GDPS_OR_STAS",
]);

const argumentsSet = new Set(process.argv.slice(2));
const checkOnly = argumentsSet.has("--check");
const requireContractClean = argumentsSet.has("--require-contract-clean");

const [
  matrixBytes,
  traceabilityBytes,
  templateBytes,
  evidenceMapSchemaBytes,
  e2eCorpusBytes,
  phaseMarkersBytes,
  taskManifestBytes,
] = await Promise.all([
  readFile(matrixPath),
  readFile(traceabilityPath),
  readFile(templatePath),
  readFile(evidenceMapSchemaPath),
  readFile(e2eCorpusPath),
  readFile(phaseMarkersPath),
  readFile(taskManifestPath),
]);

const rows = parseCsv(matrixBytes.toString("utf8"));
const traceabilityRows = parseCsv(traceabilityBytes.toString("utf8"));
const evidenceTemplate = JSON.parse(templateBytes.toString("utf8"));
const evidenceMapSchema = JSON.parse(evidenceMapSchemaBytes.toString("utf8"));
const e2eCorpus = JSON.parse(e2eCorpusBytes.toString("utf8"));
const phaseMarkers = JSON.parse(phaseMarkersBytes.toString("utf8"));
const taskManifest = JSON.parse(taskManifestBytes.toString("utf8"));

verifyMatrix(rows, traceabilityRows, e2eCorpus);
const canonicalImports = await verifyCanonicalImports(taskManifest);
const packageContractConflicts = detectAndVerifyPackageConflicts(
  rows,
  evidenceTemplate,
  evidenceMapSchema,
);
const templateConflictIds = new Set(
  packageContractConflicts
    .filter(({ code }) => code === "A14_TEMPLATE_EVIDENCE_MISMATCH")
    .flatMap(({ acceptanceIds }) => acceptanceIds),
);
const allowedEvidenceTypes = new Set(evidenceTemplate.allowedEvidenceTypes);

const entries = rows.map((row) => {
  const requiredEvidence = splitEvidence(row.evidence);
  const unknownEvidenceTypes = requiredEvidence.filter(
    (type) => !allowedEvidenceTypes.has(type),
  );
  const decision = decideRow({
    row,
    requiredEvidence,
    unknownEvidenceTypes,
    templateConflictIds,
  });
  return {
    acceptanceId: row.id,
    required: true,
    phase: row.phase,
    area: row.area,
    scenario: row.scenario,
    expected: row.expected,
    requiredEvidence,
    status: decision.status,
    reasonCode: decision.reasonCode,
    blockerMarkers: decision.blockerMarkers,
    missingEvidenceTypes: requiredEvidence,
    evidence: [],
  };
});

verifyNoBulkPass(entries);
const counts = summarize(entries);
if (JSON.stringify(counts) !== JSON.stringify(EXPECTED_STATUS_COUNTS)) {
  throw new Error(
    `Unexpected default status counts: ${JSON.stringify(counts)}`,
  );
}
const phaseSummaries = Object.fromEntries(
  Object.keys(EXPECTED_PHASE_COUNTS).map((phase) => [
    phase,
    summarize(entries.filter((entry) => entry.phase === phase)),
  ]),
);

const ledger = {
  schemaVersion: "sacs-v05-acceptance-ledger/1.0",
  sourceMatrix: {
    path: relativePath(matrixPath),
    sha256: sha256(matrixBytes),
    rowCount: rows.length,
  },
  canonicalImports: {
    manifestPath: relativePath(taskManifestPath),
    artifactCount: canonicalImports.length,
    artifacts: canonicalImports,
  },
  decisionPolicy: {
    mode: "FAIL_CLOSED_EXPLICIT_ROW_DECISIONS",
    defaultStatus: "NOT_RUN",
    noAggregatePass: true,
    passRequiresAllEvidenceTypes: true,
    fixtureEvidenceCanSatisfyLiveRows: false,
    packageContractConflictsBlockPromotion: true,
    finalDecision: "BLOCKED",
    finalMarker: "SACS_V0_5_OBSERVER_FIRST_INTERACTIVE_ANALYSIS_BLOCKED",
  },
  allowedStatuses: ALLOWED_ROW_STATUSES,
  blockerMarkersAsserted: [
    "SACS_WSGS_ANALYSIS_HANDOFF_NOT_READY",
    "SACS_INTERACTIVE_LIVE_ENVIRONMENT_NOT_READY",
    "SACS_V0_5_OBSERVER_FIRST_INTERACTIVE_ANALYSIS_BLOCKED",
  ],
  phaseMarkersWithheld: phaseMarkers.markers,
  packageContractConflicts: packageContractConflicts.map(({ code }) => code),
  counts,
  phases: phaseSummaries,
  entries,
};

const evidenceMap = {
  schemaVersion: "sacs-v05-acceptance-evidence-map/1.0",
  entries: entries.map(({ acceptanceId, status, evidence }) => ({
    acceptanceId,
    status,
    evidence,
  })),
};

const conflictReport = {
  schemaVersion: "sacs-v05-package-contract-conflicts/1.0",
  status: "BLOCKED",
  canPromoteAcceptance: false,
  safePolicy:
    "Canonical task-package conflicts are preserved and block affected rows; no alias or template evidence is promoted implicitly.",
  conflicts: packageContractConflicts,
};

const outputs = new Map([
  [resolve(acceptanceRoot, "acceptance-ledger.json"), json(ledger)],
  [resolve(acceptanceRoot, "acceptance-evidence-map.json"), json(evidenceMap)],
  [
    resolve(acceptanceRoot, "package-contract-conflicts.json"),
    json(conflictReport),
  ],
]);

if (checkOnly) {
  const drift = [];
  for (const [path, expected] of outputs) {
    const actual = await readFile(path, "utf8").catch(() => undefined);
    if (actual !== expected) drift.push(relativePath(path));
  }
  if (drift.length > 0) {
    throw new Error(`v0.5 acceptance artifact drift: ${drift.join(", ")}`);
  }
} else {
  for (const [path, content] of outputs) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, "utf8");
  }
}

if (requireContractClean && packageContractConflicts.length > 0) {
  throw new Error(
    `Task-package contract conflicts remain: ${packageContractConflicts
      .map(({ code }) => code)
      .join(", ")}`,
  );
}

process.stdout.write(
  `SACS_V0_5_ACCEPTANCE_LEDGER_${checkOnly ? "CHECK" : "GENERATED"} ${JSON.stringify(counts)} conflicts=${packageContractConflicts.length}\n`,
);

function verifyMatrix(matrixRows, traces, corpus) {
  if (matrixRows.length !== 418) {
    throw new Error(
      `Expected 418 acceptance rows, received ${matrixRows.length}`,
    );
  }
  const ids = new Set();
  const phaseCounts = {};
  for (const row of matrixRows) {
    if (row.required !== "yes") {
      throw new Error(`${row.id} is not marked required=yes`);
    }
    if (ids.has(row.id)) throw new Error(`Duplicate acceptance ID: ${row.id}`);
    ids.add(row.id);
    if (!(row.phase in EXPECTED_PHASE_COUNTS)) {
      throw new Error(`${row.id} has unknown phase: ${row.phase}`);
    }
    phaseCounts[row.phase] = (phaseCounts[row.phase] ?? 0) + 1;
    if (splitEvidence(row.evidence).length === 0) {
      throw new Error(`${row.id} has no required evidence`);
    }
  }
  for (const [phase, expected] of Object.entries(EXPECTED_PHASE_COUNTS)) {
    if (phaseCounts[phase] !== expected) {
      throw new Error(
        `${phase} expected ${expected} rows, received ${phaseCounts[phase] ?? 0}`,
      );
    }
  }
  const tracedPhases = traces.map(({ phase }) => phase);
  if (
    tracedPhases.length !== 15 ||
    tracedPhases.some(
      (phase, index) => phase !== `A${String(index).padStart(2, "0")}`,
    )
  ) {
    throw new Error("Traceability must cover A00 through A14 exactly once");
  }
  if (corpus.fixtureCannotSatisfyLive !== true || corpus.cases.length !== 28) {
    throw new Error(
      "E2E corpus must contain exactly 28 fixture-ineligible cases",
    );
  }
  const e2eRows = matrixRows.filter(({ id }) => id.startsWith("AC-A14-E2E-"));
  if (e2eRows.length !== 28)
    throw new Error("Expected exactly 28 A14 E2E rows");
  for (const [index, testCase] of corpus.cases.entries()) {
    const expectedId = `AC-A14-E2E-${String(index + 1).padStart(2, "0")}`;
    const row = e2eRows[index];
    if (
      row.id !== expectedId ||
      !row.scenario.startsWith(`${testCase.caseId}:`)
    ) {
      throw new Error(`E2E case mapping mismatch at ${expectedId}`);
    }
  }
}

async function verifyCanonicalImports(manifest) {
  if (
    manifest.requiredAcceptance !== 418 ||
    manifest.phases !== 15 ||
    manifest.schemas !== 19 ||
    manifest.e2eCases !== 28
  ) {
    throw new Error("Task-package manifest cardinalities are not canonical");
  }
  const imported = manifest.files.filter(({ path }) =>
    /^(acceptance|config|contracts)\//u.test(path),
  );
  if (imported.length !== 31) {
    throw new Error(
      `Expected 31 canonical imports, received ${imported.length}`,
    );
  }
  return Promise.all(
    imported.map(async (item) => {
      const path = importedPath(item.path);
      const bytes = await readFile(path);
      if (bytes.length !== item.bytes || sha256Hex(bytes) !== item.sha256) {
        throw new Error(`Canonical import drift: ${item.path}`);
      }
      return {
        packagePath: item.path,
        repositoryPath: relativePath(path),
        bytes: item.bytes,
        sha256: `sha256:${item.sha256}`,
      };
    }),
  );
}

function importedPath(packagePath) {
  const [group, ...segments] = packagePath.split("/");
  const base = {
    acceptance: acceptanceRoot,
    config: configRoot,
    contracts: contractsRoot,
  }[group];
  if (base === undefined) throw new Error(`Unsupported import: ${packagePath}`);
  return resolve(base, ...segments);
}

function detectAndVerifyPackageConflicts(matrixRows, template, schema) {
  const allowedTypes = new Set(template.allowedEvidenceTypes);
  const unknownByType = new Map();
  for (const row of matrixRows) {
    for (const type of splitEvidence(row.evidence)) {
      if (!allowedTypes.has(type)) {
        const ids = unknownByType.get(type) ?? [];
        ids.push(row.id);
        unknownByType.set(type, ids);
      }
    }
  }
  const conflicts = [...unknownByType.entries()].map(
    ([evidenceType, acceptanceIds]) => ({
      code: "MATRIX_EVIDENCE_TYPE_NOT_ALLOWLISTED",
      evidenceType,
      acceptanceIds,
      safeResolution:
        "Keep affected rows BLOCKED until the canonical package explicitly allowlists the type or changes the matrix; do not silently alias it.",
    }),
  );
  const matrixById = new Map(matrixRows.map((row) => [row.id, row]));
  for (const templateEntry of template.entries) {
    const row = matrixById.get(templateEntry.acceptanceId);
    if (row === undefined) {
      conflicts.push({
        code: "TEMPLATE_REFERENCES_UNKNOWN_ACCEPTANCE_ID",
        acceptanceIds: [templateEntry.acceptanceId],
        safeResolution: "Do not ingest the template entry.",
      });
      continue;
    }
    const matrixTypes = splitEvidence(row.evidence);
    const templateTypes = [
      ...new Set(templateEntry.evidence.map(({ type }) => type)),
    ];
    if (!sameSet(matrixTypes, templateTypes)) {
      conflicts.push({
        code: "A14_TEMPLATE_EVIDENCE_MISMATCH",
        acceptanceIds: [row.id],
        matrixRequiredEvidence: matrixTypes,
        templateEvidence: templateTypes,
        safeResolution:
          "Use the matrix ALL-OF requirement and keep the row BLOCKED; REAL_CHAIN cannot replace the five required live evidence types.",
      });
    }
  }
  const schemaProperties = new Set(Object.keys(schema.properties ?? {}));
  const unsupportedTemplateProperties = Object.keys(template).filter(
    (property) => !schemaProperties.has(property),
  );
  if (
    schema.additionalProperties === false &&
    unsupportedTemplateProperties.length > 0
  ) {
    conflicts.push({
      code: "EVIDENCE_TEMPLATE_SCHEMA_MISMATCH",
      acceptanceIds: [],
      unsupportedTemplateProperties,
      safeResolution:
        "Generated evidence maps omit schema-forbidden template metadata while retaining the conflict report.",
    });
  }
  const reportConflict = conflicts.find(
    ({ code, evidenceType }) =>
      code === "MATRIX_EVIDENCE_TYPE_NOT_ALLOWLISTED" &&
      evidenceType === "REPORT",
  );
  if (reportConflict?.acceptanceIds.length !== 25) {
    throw new Error("Expected the canonical 25-row REPORT allowlist conflict");
  }
  const a14Mismatch = conflicts.find(
    ({ code }) => code === "A14_TEMPLATE_EVIDENCE_MISMATCH",
  );
  if (
    a14Mismatch?.acceptanceIds.length !== 1 ||
    a14Mismatch.acceptanceIds[0] !== "AC-A14-E2E-01"
  ) {
    throw new Error("Expected the canonical A14 template conflict");
  }
  if (
    !conflicts.some(({ code }) => code === "EVIDENCE_TEMPLATE_SCHEMA_MISMATCH")
  ) {
    throw new Error("Expected the canonical evidence-template schema conflict");
  }
  return conflicts;
}

function decideRow({
  row,
  requiredEvidence,
  unknownEvidenceTypes,
  templateConflictIds,
}) {
  if (unknownEvidenceTypes.length > 0) {
    return blocked("PACKAGE_EVIDENCE_TYPE_CONFLICT", []);
  }
  if (templateConflictIds.has(row.id)) {
    return blocked("PACKAGE_EVIDENCE_TEMPLATE_CONFLICT", []);
  }
  if (requiredEvidence.includes("UPSTREAM_LOCK")) {
    return blocked("AUTHORITATIVE_WSGS_ANALYSIS_HANDOFF_NOT_READY", [
      "SACS_WSGS_ANALYSIS_HANDOFF_NOT_READY",
    ]);
  }
  if (requiredEvidence.some((type) => LIVE_EVIDENCE_TYPES.has(type))) {
    return blocked("INTERACTIVE_LIVE_EVIDENCE_NOT_READY", [
      "SACS_INTERACTIVE_LIVE_ENVIRONMENT_NOT_READY",
    ]);
  }
  if (requiredEvidence.includes("REAL_POSTGRES")) {
    return notRun("REAL_POSTGRES_NOT_RUN");
  }
  if (requiredEvidence.some((type) => type === "CI" || type === "GIT")) {
    return notRun("CI_OR_GIT_EVIDENCE_NOT_RUN");
  }
  if (
    requiredEvidence.some(
      (type) => type === "SOURCE_LOCK" || type === "LIVE_DISCOVERY",
    )
  ) {
    return notRun("SOURCE_OR_RUNTIME_DISCOVERY_NOT_RUN");
  }
  return notRun("LOCAL_EVIDENCE_NOT_RUN");
}

function blocked(reasonCode, markers) {
  return {
    status: "BLOCKED",
    reasonCode,
    blockerMarkers: [
      ...markers,
      "SACS_V0_5_OBSERVER_FIRST_INTERACTIVE_ANALYSIS_BLOCKED",
    ],
  };
}

function notRun(reasonCode) {
  return { status: "NOT_RUN", reasonCode, blockerMarkers: [] };
}

function verifyNoBulkPass(items) {
  if (items.length !== 418) throw new Error("Ledger must contain 418 entries");
  const ids = new Set();
  for (const item of items) {
    if (ids.has(item.acceptanceId)) {
      throw new Error(`Duplicate ledger entry: ${item.acceptanceId}`);
    }
    ids.add(item.acceptanceId);
    if (!ALLOWED_ROW_STATUSES.includes(item.status)) {
      throw new Error(
        `${item.acceptanceId} has unsupported status ${item.status}`,
      );
    }
    if (item.status === "PASS") {
      const suppliedTypes = new Set(item.evidence.map(({ type }) => type));
      const missing = item.requiredEvidence.filter(
        (type) => !suppliedTypes.has(type),
      );
      if (missing.length > 0) {
        throw new Error(
          `${item.acceptanceId} cannot PASS without ${missing.join(", ")}`,
        );
      }
    }
    if (item.status !== "PASS" && item.missingEvidenceTypes.length === 0) {
      throw new Error(`${item.acceptanceId} lacks explicit missing evidence`);
    }
  }
}

function summarize(items) {
  const summary = { PASS: 0, FAIL: 0, NOT_RUN: 0, BLOCKED: 0, total: 0 };
  for (const item of items) {
    summary[item.status] += 1;
    summary.total += 1;
  }
  return summary;
}

function splitEvidence(value) {
  return value.split("/").filter(Boolean);
}

function sameSet(left, right) {
  return (
    left.length === right.length &&
    left.every((value) => right.includes(value)) &&
    right.every((value) => left.includes(value))
  );
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
  return `sha256:${sha256Hex(value)}`;
}

function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

function relativePath(path) {
  return relative(root, path).replaceAll("\\", "/");
}

function json(value) {
  return `${JSON.stringify(value, undefined, 2)}\n`;
}
