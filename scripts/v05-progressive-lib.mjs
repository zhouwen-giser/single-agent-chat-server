import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { promisify } from "node:util";
import {
  lstat,
  mkdir,
  readFile,
  readlink,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";
import Ajv2020 from "ajv/dist/2020.js";
import { format } from "prettier";

const execFileAsync = promisify(execFile);

export const DEVELOPMENT_WORKTREE_DIGEST_ALGORITHM =
  "sacs-v05-git-worktree-content/1.0";
export const DEVELOPMENT_WORKTREE_EXCLUSIONS = Object.freeze([
  "reports/v0.5/progressive/DEVELOPMENT_VERIFICATION.json",
  "reports/v0.5/progressive/INTEGRATION_STATUS.json",
  "reports/v0.5/progressive/PROGRESSIVE_STATUS.json",
]);

export const DEVELOPMENT_VERIFICATION_COMMANDS = Object.freeze([
  Object.freeze({
    id: "development-contracts",
    executable: "node",
    arguments: Object.freeze([
      "scripts/v05-progressive-development-validate.mjs",
    ]),
  }),
  Object.freeze({
    id: "typecheck",
    executable: "pnpm",
    arguments: Object.freeze(["typecheck"]),
  }),
  Object.freeze({
    id: "build",
    executable: "pnpm",
    arguments: Object.freeze(["build"]),
  }),
  Object.freeze({
    id: "focused-tests",
    executable: "pnpm",
    arguments: Object.freeze(["test:v05:focused"]),
  }),
  Object.freeze({
    id: "postgres-and-local-e2e",
    executable: "node",
    arguments: Object.freeze([
      "scripts/v05-postgres-test-harness.mjs",
      "tests/analysis-persistence.postgres.int.test.ts",
      "tests/analysis-development-persistence.postgres.int.test.ts",
      "tests/v05-analysis-local.e2e.test.ts",
    ]),
  }),
  Object.freeze({
    id: "migration-chain",
    executable: "node",
    arguments: Object.freeze(["scripts/verify-migrations.mjs"]),
  }),
  Object.freeze({
    id: "v05-architecture",
    executable: "node",
    arguments: Object.freeze(["scripts/verify-v05-architecture.mjs"]),
  }),
  Object.freeze({
    id: "repository-architecture",
    executable: "node",
    arguments: Object.freeze(["scripts/verify-architecture.mjs"]),
  }),
  Object.freeze({
    id: "secret-scan",
    executable: "node",
    arguments: Object.freeze(["scripts/verify-secrets.mjs"]),
  }),
]);

export const DEVELOPMENT_EVIDENCE_COMMAND_IDS_BY_GROUP = Object.freeze({
  "DEV-SOURCE": Object.freeze(["development-contracts"]),
  "DEV-CONTRACT": Object.freeze([
    "development-contracts",
    "typecheck",
    "build",
  ]),
  "DEV-POSTGRES": Object.freeze(["postgres-and-local-e2e", "migration-chain"]),
  "DEV-POLICY": Object.freeze(["focused-tests"]),
  "DEV-AGUI": Object.freeze(["focused-tests", "postgres-and-local-e2e"]),
  "DEV-MAP": Object.freeze(["focused-tests", "postgres-and-local-e2e"]),
  "DEV-SECURITY": Object.freeze([
    "focused-tests",
    "postgres-and-local-e2e",
    "v05-architecture",
    "repository-architecture",
    "secret-scan",
  ]),
  "DEV-CONTROL": Object.freeze(["focused-tests", "postgres-and-local-e2e"]),
  "DEV-REVISION": Object.freeze(["focused-tests", "postgres-and-local-e2e"]),
  "DEV-ARCH": Object.freeze([
    "focused-tests",
    "migration-chain",
    "v05-architecture",
    "repository-architecture",
  ]),
  "DEV-FIXTURE": Object.freeze([
    "focused-tests",
    "postgres-and-local-e2e",
    "v05-architecture",
  ]),
  "DEV-E2E": Object.freeze(["postgres-and-local-e2e"]),
  "DEV-TRUTH": Object.freeze(["focused-tests", "postgres-and-local-e2e"]),
  "DEV-STATUS": Object.freeze(["development-contracts", "focused-tests"]),
});

export const ACTIVE_REPORTS = Object.freeze([
  "CURRENT_IMPLEMENTATION_MATRIX.json",
  "DEVELOPMENT_VERIFICATION.json",
  "INTEGRATION_STATUS.json",
  "PROGRESSIVE_STATUS.json",
]);

export const DEVELOPMENT_REPORTS = Object.freeze([
  "CURRENT_IMPLEMENTATION_MATRIX.json",
  "DEVELOPMENT_VERIFICATION.json",
]);

export const PACKAGE_SCHEMA_FILES = Object.freeze([
  "compatibility.schema.json",
  "delivery-profile.schema.json",
  "evidence-map.schema.json",
  "fixture-adapter.schema.json",
  "gate-result.schema.json",
  "implementation-matrix.schema.json",
  "progressive-status.schema.json",
]);

export function paths(root = process.cwd(), reportRoot) {
  const resolvedRoot = resolve(root);
  return {
    root: resolvedRoot,
    config: resolve(resolvedRoot, "config/v0.5/progressive-delivery"),
    contracts: resolve(resolvedRoot, "contracts/v0.5/progressive-delivery"),
    reports: reportRoot
      ? resolve(reportRoot)
      : resolve(resolvedRoot, "reports/v0.5/progressive"),
  };
}

export function parseArguments(argv) {
  const flags = new Set();
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) {
      throw new Error(`Unexpected positional argument: ${argument}`);
    }
    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith("--")) {
      values.set(argument, next);
      index += 1;
    } else {
      flags.add(argument);
    }
  }
  return {
    has(name) {
      return flags.has(name) || values.has(name);
    },
    value(name) {
      return values.get(name);
    },
  };
}

export async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

export async function prettyJson(value) {
  return format(JSON.stringify(value), { parser: "json" });
}

export async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, await prettyJson(value), "utf8");
}

export async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, await prettyJson(value), {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    await rename(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

export function hashCanonicalValue(value) {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

export function validator() {
  return new Ajv2020({
    allErrors: true,
    strict: false,
    validateFormats: false,
  });
}

export async function validateDocument({ schemaPath, document, label }) {
  const schema = await readJson(schemaPath);
  const validate = validator().compile(schema);
  if (!validate(document)) {
    throw new Error(
      `${label} schema validation failed: ${JSON.stringify(validate.errors)}`,
    );
  }
}

export function createDevelopmentGateReport({
  evidence,
  rows,
  evidenceGroups,
  currentSource,
}) {
  verifyDevelopmentRunEvidence(evidence, currentSource, true);
  const rowsByGroup = developmentRowsByGroup(rows);
  const report = {
    schemaVersion: "sacs-v05-gate-result/1.0",
    gateId: "SACS_V05_DEVELOPMENT",
    track: "DEVELOPMENT",
    status: "PASS",
    source: evidence.source,
    verificationRun: evidence,
    checks: [...rowsByGroup].map(([id, acceptanceIds]) => ({
      id,
      status: "PASS",
      acceptanceIds,
      evidence: evidenceForGroup(evidenceGroups, id),
      commandIds: commandIdsForGroup(id),
    })),
  };
  verifyDevelopmentGateReport(report, rows, currentSource, evidenceGroups);
  return report;
}

export function verifyDevelopmentGateReport(
  document,
  rows,
  expectedSource,
  evidenceGroups,
) {
  if (
    document.gateId !== "SACS_V05_DEVELOPMENT" ||
    document.track !== "DEVELOPMENT" ||
    !Array.isArray(document.checks)
  ) {
    throw new Error("Development gate report identity is invalid");
  }
  const rowsByGroup = developmentRowsByGroup(rows);
  if (document.checks.length !== rowsByGroup.size) {
    throw new Error("Development report evidence-group inventory is invalid");
  }
  const checks = new Map();
  for (const check of document.checks) {
    if (
      check === null ||
      typeof check !== "object" ||
      Array.isArray(check) ||
      typeof check.id !== "string" ||
      checks.has(check.id)
    ) {
      throw new Error("Development report contains an invalid check");
    }
    checks.set(check.id, check);
  }
  for (const group of rowsByGroup.keys()) {
    if (!checks.has(group)) {
      throw new Error(`Development report is missing evidence group ${group}`);
    }
  }
  if (document.status !== "PASS") return;

  const observedAcceptanceIds = [];
  for (const [group, expectedIds] of rowsByGroup) {
    const check = checks.get(group);
    if (
      check === undefined ||
      !hasExactKeys(check, [
        "acceptanceIds",
        "commandIds",
        "evidence",
        "id",
        "status",
      ]) ||
      !Array.isArray(check.acceptanceIds)
    ) {
      throw new Error(`Development report is missing evidence group ${group}`);
    }
    const actualIds = [...check.acceptanceIds].sort();
    if (JSON.stringify(actualIds) !== JSON.stringify([...expectedIds].sort())) {
      throw new Error(
        `Development report has invalid acceptance IDs for ${group}`,
      );
    }
    observedAcceptanceIds.push(...actualIds);
    if (check.status !== "PASS") {
      throw new Error(`Development PASS requires ${group} to pass`);
    }
    if (
      JSON.stringify(check.commandIds) !==
      JSON.stringify(commandIdsForGroup(group))
    ) {
      throw new Error(
        `Development report has invalid command evidence for ${group}`,
      );
    }
    if (
      JSON.stringify(check.evidence) !==
      JSON.stringify(evidenceForGroup(evidenceGroups, group))
    ) {
      throw new Error(
        `Development report has invalid configured evidence for ${group}`,
      );
    }
  }
  const expectedAcceptanceIds = rows.map(({ id }) => id).sort();
  if (
    new Set(observedAcceptanceIds).size !== 38 ||
    JSON.stringify(observedAcceptanceIds.sort()) !==
      JSON.stringify(expectedAcceptanceIds)
  ) {
    throw new Error("Development report must cover exactly 38 acceptance IDs");
  }
  if (expectedSource === undefined) {
    throw new Error("DEVELOPMENT_SOURCE_MISMATCH");
  }
  assertDevelopmentSource(document.source, expectedSource, false);
  if (
    document.verificationRun === undefined ||
    !sameDevelopmentSource(
      document.source,
      document.verificationRun.source,
      true,
    )
  ) {
    throw new Error("DEVELOPMENT_EVIDENCE_SOURCE_MISMATCH");
  }
  verifyDevelopmentRunEvidence(document.verificationRun, expectedSource, false);
}

export function verifyDevelopmentRunEvidence(
  evidence,
  expectedSource,
  requireExactHead = false,
) {
  if (
    evidence === null ||
    typeof evidence !== "object" ||
    Array.isArray(evidence) ||
    !hasExactKeys(evidence, [
      "commands",
      "evidenceDigest",
      "finishedAt",
      "runId",
      "schemaVersion",
      "source",
      "startedAt",
    ]) ||
    evidence.schemaVersion !== "sacs-v05-development-run-evidence/1.0" ||
    typeof evidence.runId !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(evidence.runId) ||
    !validDateTime(evidence.startedAt) ||
    !validDateTime(evidence.finishedAt) ||
    Date.parse(evidence.finishedAt) < Date.parse(evidence.startedAt) ||
    !Array.isArray(evidence.commands)
  ) {
    throw new Error("DEVELOPMENT_RUN_EVIDENCE_INVALID");
  }
  assertDevelopmentSource(evidence.source, expectedSource, requireExactHead);
  if (evidence.commands.length !== DEVELOPMENT_VERIFICATION_COMMANDS.length) {
    throw new Error("DEVELOPMENT_COMMAND_EVIDENCE_INVENTORY_INVALID");
  }
  const observedIds = new Set();
  for (let index = 0; index < evidence.commands.length; index += 1) {
    const command = evidence.commands[index];
    const expected = DEVELOPMENT_VERIFICATION_COMMANDS[index];
    if (
      command === null ||
      typeof command !== "object" ||
      Array.isArray(command) ||
      !hasExactKeys(command, [
        "arguments",
        "executable",
        "exitCode",
        "finishedAt",
        "id",
        "sourceAfter",
        "sourceBefore",
        "startedAt",
        "status",
      ]) ||
      command.id !== expected.id ||
      observedIds.has(command.id) ||
      command.executable !== expected.executable ||
      JSON.stringify(command.arguments) !==
        JSON.stringify(expected.arguments) ||
      command.exitCode !== 0 ||
      command.status !== "PASS" ||
      !validDateTime(command.startedAt) ||
      !validDateTime(command.finishedAt) ||
      Date.parse(command.startedAt) < Date.parse(evidence.startedAt) ||
      Date.parse(command.finishedAt) < Date.parse(command.startedAt) ||
      Date.parse(command.finishedAt) > Date.parse(evidence.finishedAt) ||
      !sameDevelopmentSource(command.sourceBefore, evidence.source, true) ||
      !sameDevelopmentSource(command.sourceAfter, evidence.source, true)
    ) {
      throw new Error(`DEVELOPMENT_COMMAND_EVIDENCE_INVALID:${expected.id}`);
    }
    observedIds.add(command.id);
  }
  const { evidenceDigest, ...evidenceCore } = evidence;
  if (
    typeof evidenceDigest !== "string" ||
    evidenceDigest !== hashCanonicalValue(evidenceCore)
  ) {
    throw new Error("DEVELOPMENT_RUN_EVIDENCE_DIGEST_MISMATCH");
  }
}

function developmentRowsByGroup(rows) {
  const rowsByGroup = new Map();
  for (const row of rows) {
    const ids = rowsByGroup.get(row.evidenceGroup) ?? [];
    ids.push(row.id);
    rowsByGroup.set(row.evidenceGroup, ids);
  }
  return rowsByGroup;
}

function commandIdsForGroup(group) {
  const commandIds = DEVELOPMENT_EVIDENCE_COMMAND_IDS_BY_GROUP[group];
  if (commandIds === undefined) {
    throw new Error(`Development evidence group ${group} has no command map`);
  }
  return [...commandIds];
}

function evidenceForGroup(evidenceGroups, group) {
  const evidence = evidenceGroups?.groups?.[group];
  if (
    !Array.isArray(evidence) ||
    evidence.length === 0 ||
    evidence.some((entry) => typeof entry !== "string" || entry.length === 0)
  ) {
    throw new Error(`Development evidence group ${group} is invalid`);
  }
  return [...evidence];
}

function assertDevelopmentSource(actual, expected, requireExactHead) {
  if (
    !isDevelopmentSource(actual) ||
    !isDevelopmentSource(expected) ||
    !sameDevelopmentSource(actual, expected, requireExactHead)
  ) {
    throw new Error("DEVELOPMENT_SOURCE_MISMATCH");
  }
}

function isDevelopmentSource(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    hasExactKeys(value, [
      "branch",
      "headSha",
      "repository",
      "worktreeDigest",
      "worktreeDigestAlgorithm",
      "worktreeExclusions",
    ]) &&
    typeof value.repository === "string" &&
    value.repository.length > 0 &&
    typeof value.branch === "string" &&
    value.branch.length > 0 &&
    typeof value.headSha === "string" &&
    /^[0-9a-f]{40}$/u.test(value.headSha) &&
    typeof value.worktreeDigest === "string" &&
    /^sha256:[0-9a-f]{64}$/u.test(value.worktreeDigest) &&
    value.worktreeDigestAlgorithm === DEVELOPMENT_WORKTREE_DIGEST_ALGORITHM &&
    JSON.stringify(value.worktreeExclusions) ===
      JSON.stringify(DEVELOPMENT_WORKTREE_EXCLUSIONS)
  );
}

function sameDevelopmentSource(left, right, requireExactHead) {
  if (!isDevelopmentSource(left) || !isDevelopmentSource(right)) return false;
  return (
    left.repository === right.repository &&
    left.branch === right.branch &&
    (!requireExactHead || left.headSha === right.headSha) &&
    left.worktreeDigest === right.worktreeDigest &&
    left.worktreeDigestAlgorithm === right.worktreeDigestAlgorithm &&
    JSON.stringify(left.worktreeExclusions) ===
      JSON.stringify(right.worktreeExclusions)
  );
}

function hasExactKeys(value, expectedKeys) {
  return (
    JSON.stringify(Object.keys(value).sort()) ===
    JSON.stringify([...expectedKeys].sort())
  );
}

function validDateTime(value) {
  return (
    typeof value === "string" &&
    Number.isFinite(Date.parse(value)) &&
    /^\d{4}-\d{2}-\d{2}T/u.test(value)
  );
}

export async function loadAcceptance(root = process.cwd()) {
  const layout = paths(root);
  const [matrix, evidenceGroups] = await Promise.all([
    readJson(resolve(layout.config, "acceptance-matrix.json")),
    readJson(resolve(layout.config, "evidence-groups.json")),
  ]);
  verifyAcceptanceMatrix(matrix, evidenceGroups);
  return { matrix, evidenceGroups };
}

export async function loadDevelopmentAcceptance(root = process.cwd()) {
  const layout = paths(root);
  const [matrix, evidenceGroups] = await Promise.all([
    readJson(resolve(layout.config, "acceptance-matrix.json")),
    readJson(resolve(layout.config, "evidence-groups.json")),
  ]);
  const rows = verifyDevelopmentAcceptance(matrix, evidenceGroups);
  return { matrix, evidenceGroups, rows };
}

export async function loadIntegrationAcceptance(root = process.cwd()) {
  const layout = paths(root);
  const [matrix, evidenceGroups] = await Promise.all([
    readJson(resolve(layout.config, "acceptance-matrix.json")),
    readJson(resolve(layout.config, "evidence-groups.json")),
  ]);
  if (
    matrix === null ||
    typeof matrix !== "object" ||
    !Array.isArray(matrix.rows) ||
    evidenceGroups === null ||
    typeof evidenceGroups !== "object" ||
    evidenceGroups.groups === null ||
    typeof evidenceGroups.groups !== "object" ||
    Array.isArray(evidenceGroups.groups)
  ) {
    throw new Error("Integration acceptance configuration is invalid");
  }
  const rows = matrix.rows.filter(
    (row) =>
      row !== null &&
      typeof row === "object" &&
      !Array.isArray(row) &&
      row.track === "INTEGRATION",
  );
  const expectedIds = Array.from(
    { length: 12 },
    (_, index) => `INT-${String(index + 1).padStart(3, "0")}`,
  );
  const actualIds = rows.map(({ id }) => id).sort();
  if (JSON.stringify(actualIds) !== JSON.stringify(expectedIds)) {
    throw new Error(
      `Expected exact INTEGRATION acceptance IDs ${expectedIds.join(", ")}`,
    );
  }
  for (const row of rows) {
    if (
      row.blockingScope !== "TRACK" ||
      !["READY_OR_PENDING", "PASS", "PASS_IF_READY"].includes(row.expected) ||
      typeof row.scenario !== "string" ||
      row.scenario.length === 0 ||
      typeof row.evidenceGroup !== "string" ||
      !row.evidenceGroup.startsWith("INT-") ||
      !Array.isArray(evidenceGroups.groups[row.evidenceGroup]) ||
      evidenceGroups.groups[row.evidenceGroup].length === 0
    ) {
      throw new Error(`${row.id} has an invalid INTEGRATION contract`);
    }
  }
  return { matrix, evidenceGroups, rows };
}

export function verifyDevelopmentAcceptance(matrix, evidenceGroups) {
  if (
    matrix === null ||
    typeof matrix !== "object" ||
    !Array.isArray(matrix.rows)
  ) {
    throw new Error("Development acceptance matrix is invalid");
  }
  if (
    evidenceGroups === null ||
    typeof evidenceGroups !== "object" ||
    evidenceGroups.groups === null ||
    typeof evidenceGroups.groups !== "object" ||
    Array.isArray(evidenceGroups.groups)
  ) {
    throw new Error("Development evidence groups are invalid");
  }

  const rows = matrix.rows.filter(
    (row) =>
      row !== null &&
      typeof row === "object" &&
      !Array.isArray(row) &&
      row.track === "DEVELOPMENT",
  );
  const expectedIds = Array.from(
    { length: 38 },
    (_, index) => `DEV-${String(index + 1).padStart(3, "0")}`,
  );
  const actualIds = rows.map(({ id }) => id).sort();
  if (JSON.stringify(actualIds) !== JSON.stringify(expectedIds)) {
    throw new Error(
      `Expected exact DEVELOPMENT acceptance IDs ${expectedIds.join(", ")}`,
    );
  }
  for (const row of rows) {
    if (
      row.blockingScope !== "CORE" ||
      row.expected !== "PASS" ||
      typeof row.scenario !== "string" ||
      row.scenario.length === 0 ||
      typeof row.evidenceGroup !== "string" ||
      !row.evidenceGroup.startsWith("DEV-")
    ) {
      throw new Error(`${row.id} has an invalid DEVELOPMENT contract`);
    }
    const evidence = evidenceGroups.groups[row.evidenceGroup];
    if (
      !Array.isArray(evidence) ||
      evidence.length === 0 ||
      evidence.some((entry) => typeof entry !== "string" || entry.length === 0)
    ) {
      throw new Error(
        `${row.id} uses invalid DEVELOPMENT evidence group ${row.evidenceGroup}`,
      );
    }
  }
  return rows;
}

export function verifyAcceptanceMatrix(matrix, evidenceGroups) {
  const expectedCounts = {
    DEVELOPMENT: 38,
    INTEGRATION: 12,
    RELEASE: 10,
  };
  if (matrix.rows.length !== 60) {
    throw new Error(
      `Expected 60 active acceptance rows, got ${matrix.rows.length}`,
    );
  }
  const ids = new Set();
  const counts = { DEVELOPMENT: 0, INTEGRATION: 0, RELEASE: 0 };
  for (const row of matrix.rows) {
    if (ids.has(row.id)) throw new Error(`Duplicate acceptance ID: ${row.id}`);
    ids.add(row.id);
    if (!(row.track in counts)) throw new Error(`Unknown track: ${row.track}`);
    counts[row.track] += 1;
    if (!(row.evidenceGroup in evidenceGroups.groups)) {
      throw new Error(
        `${row.id} uses unknown evidence group ${row.evidenceGroup}`,
      );
    }
    if (row.track === "DEVELOPMENT" && row.blockingScope !== "CORE") {
      throw new Error(`${row.id} must use CORE blocking scope`);
    }
    if (row.track !== "DEVELOPMENT" && row.blockingScope !== "TRACK") {
      throw new Error(`${row.id} must use TRACK blocking scope`);
    }
  }
  for (const [track, expected] of Object.entries(expectedCounts)) {
    if (counts[track] !== expected || matrix.counts[track] !== expected) {
      throw new Error(
        `${track} expected ${expected} rows, got ${counts[track]} / declared ${matrix.counts[track]}`,
      );
    }
  }
  if (
    matrix.counts.total !== 60 ||
    matrix.supersedes.rowCount !== 418 ||
    matrix.supersedes.decision !== "SUPERSEDED_STRICT_QUALIFICATION"
  ) {
    throw new Error("Active acceptance supersession metadata is invalid");
  }
}

export async function validateStaticConfiguration(root = process.cwd()) {
  const layout = paths(root);
  const schemaInventory = (await readdir(layout.contracts))
    .filter((name) => name.endsWith(".schema.json"))
    .sort();
  const expectedInventory = [
    ...PACKAGE_SCHEMA_FILES,
    "active-acceptance-matrix.schema.json",
  ].sort();
  if (JSON.stringify(schemaInventory) !== JSON.stringify(expectedInventory)) {
    throw new Error(
      `Progressive schema inventory mismatch: ${schemaInventory}`,
    );
  }

  for (const schemaName of schemaInventory) {
    validator().compile(await readJson(resolve(layout.contracts, schemaName)));
  }

  const [
    deliveryProfiles,
    fixtureAdapter,
    compatibility,
    matrix,
    hardConstraints,
    softConstraints,
    gateCommands,
    runtime,
    localE2e,
    reportBudget,
    integrationReadiness,
    releaseReadiness,
    evidenceGroups,
    evidenceMapTemplate,
  ] = await Promise.all(
    [
      "delivery-profiles.json",
      "fixture-adapter.json",
      "integration-compatibility.json",
      "acceptance-matrix.json",
      "hard-constraints.json",
      "soft-constraints.json",
      "gate-commands.json",
      "development-runtime.json",
      "local-e2e.json",
      "report-budget.json",
      "integration-readiness.json",
      "release-readiness.json",
      "evidence-groups.json",
      "evidence-map.template.json",
    ].map((name) => readJson(resolve(layout.config, name))),
  );

  await Promise.all([
    validateDocument({
      schemaPath: resolve(layout.contracts, "delivery-profile.schema.json"),
      document: deliveryProfiles,
      label: "delivery profiles",
    }),
    validateDocument({
      schemaPath: resolve(layout.contracts, "fixture-adapter.schema.json"),
      document: fixtureAdapter,
      label: "fixture adapter",
    }),
    validateDocument({
      schemaPath: resolve(layout.contracts, "compatibility.schema.json"),
      document: compatibility,
      label: "integration compatibility",
    }),
    validateDocument({
      schemaPath: resolve(
        layout.contracts,
        "active-acceptance-matrix.schema.json",
      ),
      document: matrix,
      label: "active acceptance matrix",
    }),
    validateDocument({
      schemaPath: resolve(layout.contracts, "evidence-map.schema.json"),
      document: evidenceMapTemplate,
      label: "evidence map template",
    }),
  ]);
  verifyAcceptanceMatrix(matrix, evidenceGroups);

  const profiles = deliveryProfiles.profiles.map(({ profile }) => profile);
  if (
    JSON.stringify(profiles) !==
    JSON.stringify(["DEVELOPMENT", "INTEGRATION", "RELEASE"])
  ) {
    throw new Error(
      "Delivery profiles must be DEVELOPMENT, INTEGRATION, RELEASE",
    );
  }
  if (
    hardConstraints.constraints.length !== 10 ||
    hardConstraints.globalBlockAllowedOnlyForConstraintFailure !== true
  ) {
    throw new Error("Exactly ten global hard constraints are required");
  }
  if (
    softConstraints.developmentEffect !== "NONE" ||
    softConstraints.integrationEffect !== "PENDING"
  ) {
    throw new Error("Soft constraints must not block DEVELOPMENT");
  }
  if (
    runtime.adapterMode !== "fixture" ||
    runtime.productionDefault !== "FAIL_CLOSED_WITHOUT_REAL_ADAPTER" ||
    fixtureAdapter.productionEligible !== false
  ) {
    throw new Error(
      "Fixture composition must remain non-production and fail closed",
    );
  }
  if (localE2e.cases.length !== 8) {
    throw new Error(
      `Expected eight local E2E cases, got ${localE2e.cases.length}`,
    );
  }
  verifyGateCommands(gateCommands);
  if (
    reportBudget.maxActiveReports !== 4 ||
    JSON.stringify(reportBudget.reports) !== JSON.stringify(ACTIVE_REPORTS) ||
    reportBudget.reportOnlyCommitPerMicrophase !== false
  ) {
    throw new Error(
      "The active report budget must be exactly four concise reports",
    );
  }
  if (
    integrationReadiness.missingHandoffDecision !== "INTEGRATION_PENDING" ||
    integrationReadiness.pendingExitCode !== 0
  ) {
    throw new Error(
      "Missing integration handoff must yield PENDING with exit 0",
    );
  }
  if (
    releaseReadiness.unrequestedDecision !== "RELEASE_HARDENING_PENDING" ||
    releaseReadiness.pendingExitCode !== 0 ||
    releaseReadiness.acceptanceIds.length !== 10
  ) {
    throw new Error(
      "Unrequested release qualification must yield PENDING with exit 0",
    );
  }
  return { layout, matrix, evidenceGroups };
}

export async function validateDevelopmentConfiguration(
  root = process.cwd(),
  reportRoot,
) {
  const layout = paths(root, reportRoot);
  const [deliveryProfiles, fixtureAdapter, hardConstraints, runtime, localE2e] =
    await Promise.all(
      [
        "delivery-profiles.json",
        "fixture-adapter.json",
        "hard-constraints.json",
        "development-runtime.json",
        "local-e2e.json",
      ].map((name) => readJson(resolve(layout.config, name))),
    );
  const { matrix, evidenceGroups, rows } =
    await loadDevelopmentAcceptance(root);

  const developmentProfile = Array.isArray(deliveryProfiles.profiles)
    ? deliveryProfiles.profiles.find(
        (profile) =>
          profile !== null &&
          typeof profile === "object" &&
          !Array.isArray(profile) &&
          profile.profile === "DEVELOPMENT",
      )
    : undefined;
  if (
    deliveryProfiles.defaultProfile !== "DEVELOPMENT" ||
    developmentProfile?.completionMarker !== "SACS_V05_FEATURE_COMPLETE" ||
    developmentProfile.externalDependencyPolicy !== "NOT_APPLICABLE"
  ) {
    throw new Error("The DEVELOPMENT delivery profile is invalid");
  }
  await validateDocument({
    schemaPath: resolve(layout.contracts, "fixture-adapter.schema.json"),
    document: fixtureAdapter,
    label: "development fixture adapter",
  });
  if (
    hardConstraints.constraints?.length !== 10 ||
    hardConstraints.globalBlockAllowedOnlyForConstraintFailure !== true
  ) {
    throw new Error("Exactly ten DEVELOPMENT hard constraints are required");
  }
  if (
    runtime.adapterMode !== "fixture" ||
    runtime.productionDefault !== "FAIL_CLOSED_WITHOUT_REAL_ADAPTER" ||
    fixtureAdapter.productionEligible !== false
  ) {
    throw new Error(
      "Development fixture composition must remain non-production and fail closed",
    );
  }
  if (!Array.isArray(localE2e.cases) || localE2e.cases.length !== 8) {
    throw new Error(
      `Expected eight DEVELOPMENT local E2E cases, got ${localE2e.cases?.length ?? 0}`,
    );
  }

  const reports = Object.fromEntries(
    await Promise.all(
      DEVELOPMENT_REPORTS.map(async (name) => [
        name,
        await readJson(resolve(layout.reports, name)),
      ]),
    ),
  );
  await Promise.all([
    validateDocument({
      schemaPath: resolve(
        layout.contracts,
        "implementation-matrix.schema.json",
      ),
      document: reports["CURRENT_IMPLEMENTATION_MATRIX.json"],
      label: "current implementation matrix",
    }),
    validateDocument({
      schemaPath: resolve(layout.contracts, "gate-result.schema.json"),
      document: reports["DEVELOPMENT_VERIFICATION.json"],
      label: "development verification",
    }),
  ]);
  if (reports["DEVELOPMENT_VERIFICATION.json"].track !== "DEVELOPMENT") {
    throw new Error("DEVELOPMENT_VERIFICATION.json must describe DEVELOPMENT");
  }
  return { layout, matrix, evidenceGroups, rows, reports };
}

export async function validateActiveReports(root = process.cwd(), reportRoot) {
  const layout = paths(root, reportRoot);
  const inventory = (await readdir(layout.reports))
    .filter((name) => name.endsWith(".json"))
    .sort();
  const expected = [...ACTIVE_REPORTS].sort();
  if (JSON.stringify(inventory) !== JSON.stringify(expected)) {
    throw new Error(
      `Active report inventory must be exactly ${expected.join(", ")}; got ${inventory.join(", ")}`,
    );
  }
  const documents = Object.fromEntries(
    await Promise.all(
      ACTIVE_REPORTS.map(async (name) => [
        name,
        await readJson(resolve(layout.reports, name)),
      ]),
    ),
  );
  await Promise.all([
    validateDocument({
      schemaPath: resolve(
        layout.contracts,
        "implementation-matrix.schema.json",
      ),
      document: documents["CURRENT_IMPLEMENTATION_MATRIX.json"],
      label: "current implementation matrix",
    }),
    validateDocument({
      schemaPath: resolve(layout.contracts, "gate-result.schema.json"),
      document: documents["DEVELOPMENT_VERIFICATION.json"],
      label: "development verification",
    }),
    validateDocument({
      schemaPath: resolve(layout.contracts, "gate-result.schema.json"),
      document: documents["INTEGRATION_STATUS.json"],
      label: "integration status",
    }),
    validateDocument({
      schemaPath: resolve(layout.contracts, "progressive-status.schema.json"),
      document: documents["PROGRESSIVE_STATUS.json"],
      label: "progressive status",
    }),
  ]);
  if (documents["DEVELOPMENT_VERIFICATION.json"].track !== "DEVELOPMENT") {
    throw new Error("DEVELOPMENT_VERIFICATION.json must describe DEVELOPMENT");
  }
  if (documents["INTEGRATION_STATUS.json"].track !== "INTEGRATION") {
    throw new Error("INTEGRATION_STATUS.json must describe INTEGRATION");
  }
  return documents;
}

export async function gitSource(root = process.cwd()) {
  const [{ stdout: head }, { stdout: branch }] = await Promise.all([
    execFileAsync("git", ["rev-parse", "HEAD"], { cwd: root }),
    execFileAsync("git", ["branch", "--show-current"], { cwd: root }),
  ]);
  return {
    repository: "zhouwen-giser/single-agent-chat-server",
    branch: branch.trim() || "DETACHED",
    headSha: head.trim(),
  };
}

export async function gitDevelopmentSource(root = process.cwd()) {
  const resolvedRoot = resolve(root);
  const [source, { stdout }] = await Promise.all([
    gitSource(resolvedRoot),
    execFileAsync(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
      {
        cwd: resolvedRoot,
        encoding: "buffer",
        maxBuffer: 64 * 1024 * 1024,
      },
    ),
  ]);
  const inventory = (Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout))
    .toString("utf8")
    .split("\0")
    .filter((path) => path.length > 0)
    .filter((path) => !isDevelopmentDigestExcluded(path))
    .sort((left, right) => Buffer.from(left).compare(Buffer.from(right)));
  if (new Set(inventory).size !== inventory.length) {
    throw new Error("DEVELOPMENT_WORKTREE_INVENTORY_INVALID");
  }
  const entries = [];
  for (const path of inventory) {
    if (path.startsWith("/") || path.split("/").includes("..")) {
      throw new Error("DEVELOPMENT_WORKTREE_PATH_INVALID");
    }
    const absolutePath = resolve(resolvedRoot, path);
    let metadata;
    try {
      metadata = await lstat(absolutePath);
    } catch (error) {
      if (error?.code === "ENOENT") {
        continue;
      }
      throw error;
    }
    if (metadata.isFile()) {
      entries.push({
        path,
        kind: "FILE",
        executable: (metadata.mode & 0o111) !== 0,
        contentDigest: `sha256:${createHash("sha256")
          .update(await readFile(absolutePath))
          .digest("hex")}`,
      });
      continue;
    }
    if (metadata.isSymbolicLink()) {
      entries.push({
        path,
        kind: "SYMLINK",
        target: await readlink(absolutePath),
      });
      continue;
    }
    throw new Error(`DEVELOPMENT_WORKTREE_ENTRY_UNSUPPORTED:${path}`);
  }
  return {
    ...source,
    worktreeDigestAlgorithm: DEVELOPMENT_WORKTREE_DIGEST_ALGORITHM,
    worktreeDigest: hashCanonicalValue({
      algorithm: DEVELOPMENT_WORKTREE_DIGEST_ALGORITHM,
      exclusions: DEVELOPMENT_WORKTREE_EXCLUSIONS,
      entries,
    }),
    worktreeExclusions: [...DEVELOPMENT_WORKTREE_EXCLUSIONS],
  };
}

function isDevelopmentDigestExcluded(path) {
  return DEVELOPMENT_WORKTREE_EXCLUSIONS.some(
    (entry) =>
      path === entry ||
      (entry.endsWith("/") &&
        (path === entry.slice(0, -1) || path.startsWith(entry))),
  );
}

function canonicalJson(value) {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new Error("Canonical JSON number invalid");
    return Object.is(value, -0) ? "0" : JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  throw new Error("Canonical JSON value invalid");
}

function verifyGateCommands(gateCommands) {
  const byCommand = new Map(
    gateCommands.commands.map((entry) => [entry.command, entry]),
  );
  if (
    byCommand.get("pnpm verify:v05")?.aliasFor !== "pnpm verify:v05:development"
  ) {
    throw new Error("verify:v05 must alias verify:v05:development");
  }
  const integration = byCommand.get("pnpm check:v05:integration-readiness");
  const release = byCommand.get("pnpm check:v05:release-readiness");
  if (
    integration?.pendingAllowed !== true ||
    integration.pendingExitCode !== 0 ||
    release?.pendingAllowed !== true ||
    release.pendingExitCode !== 0
  ) {
    throw new Error("Readiness PENDING results must exit zero");
  }
}
