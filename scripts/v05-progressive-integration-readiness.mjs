import { Buffer } from "node:buffer";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { isAbsolute, relative, resolve, sep } from "node:path";
import process from "node:process";
import { URL } from "node:url";
import { promisify, TextDecoder } from "node:util";
import {
  loadIntegrationAcceptance,
  parseArguments,
  paths,
  readJson,
  validateDocument,
  validator,
  writeJson,
} from "./v05-progressive-lib.mjs";

const execFileAsync = promisify(execFile);
const args = parseArguments(process.argv.slice(2));
const root = args.value("--root") ?? process.cwd();
const reportRoot = args.value("--report-root");
const layout = paths(root, reportRoot);
const readiness = await readJson(
  resolve(layout.config, "integration-readiness.json"),
);
const configuredRepository =
  args.value("--wsgs-repo") ??
  args.value("--wsgs-repository") ??
  process.env[readiness.repositoryEnvironmentVariable] ??
  readiness.defaultRepositoryDirectory;
const configuredHandoff =
  args.value("--handoff-dir") ??
  process.env[readiness.environmentVariable] ??
  readiness.defaultHandoffDirectory;
const expectedWsgsSha =
  args.value("--expected-wsgs-sha") ??
  process.env[readiness.expectedShaEnvironmentVariable];
await loadIntegrationAcceptance(root);

const source = await inspectAuthoritativeSource({
  configuredRepository,
  configuredHandoff,
  expectedRepository: readiness.expectedRepository,
  expectedWsgsSha,
});
let artifactChecks = pendingArtifactChecks(
  readiness.requiredArtifacts,
  "AUTHORITATIVE_WSGS_CHECKOUT_UNAVAILABLE",
);
let bundleCheck = {
  id: "AUTHORITATIVE_WSGS_BUNDLE",
  status: "PENDING",
  reason: "AUTHORITATIVE_BUNDLE_UNAVAILABLE",
};
let verifiedCompatibilityLevel;

if (source.internal !== undefined) {
  try {
    const committed = await loadCommittedBundle({
      ...source.internal,
      requiredArtifacts: readiness.requiredArtifacts,
    });
    artifactChecks = committed.checks;
    const hasInvalidArtifact = artifactChecks.some(
      ({ status }) => status === "FAIL",
    );
    const hasMissingArtifact = artifactChecks.some(
      ({ status }) => status === "PENDING",
    );
    if (hasInvalidArtifact) {
      bundleCheck = {
        id: "AUTHORITATIVE_WSGS_BUNDLE",
        status: "FAIL",
        reason: "AUTHORITATIVE_BUNDLE_ARTIFACT_INVALID",
      };
    } else if (!hasMissingArtifact) {
      const verification = await verifyAuthoritativeBundle({
        ...source.internal,
        requiredArtifacts: readiness.requiredArtifacts,
        requiredLockSemantics: readiness.requiredLockSemantics,
        values: committed.values,
        bytes: committed.bytes,
        expectedWsgsSha,
      });
      verifiedCompatibilityLevel = verification.compatibilityLevel;
      bundleCheck = {
        id: "AUTHORITATIVE_WSGS_BUNDLE",
        status: "PASS",
        verification:
          "GIT_HEAD_TRACKED_EXACT_INVENTORY_CHECKSUM_SCHEMA_AND_SEMANTICS",
      };
    }
  } catch (error) {
    bundleCheck = {
      id: "AUTHORITATIVE_WSGS_BUNDLE",
      status: readinessErrorStatus(error),
      reason: readinessErrorCode(error, "AUTHORITATIVE_WSGS_BUNDLE_INVALID"),
    };
  }
}

const allReadinessChecks = [...artifactChecks, source.check, bundleCheck];
const hasInvalid = allReadinessChecks.some(({ status }) => status === "FAIL");
const hasMissing = allReadinessChecks.some(
  ({ status }) => status === "PENDING",
);
const status = hasInvalid ? "FAIL" : hasMissing ? "PENDING" : "PASS";
const readinessStatus = {
  PASS: "READY",
  PENDING: "PENDING",
  FAIL: "INCOMPATIBLE",
}[status];
const decision =
  status === "FAIL" ? "INTEGRATION_FAILED" : "INTEGRATION_PENDING";
const compatibilityLevel = {
  PASS: verifiedCompatibilityLevel ?? "BACKWARD_COMPATIBLE",
  PENDING: "UNAVAILABLE",
  FAIL: "INCOMPATIBLE",
}[status];
const report = {
  schemaVersion: "sacs-v05-gate-result/1.0",
  gateId: "SACS_V05_INTEGRATION_READINESS",
  track: "INTEGRATION",
  status,
  checks: [
    {
      id: "AUTHORITATIVE_WSGS_ANALYSIS_HANDOFF",
      status,
      readiness: readinessStatus,
      decision,
      compatibilityLevel,
      repository: readiness.expectedRepository,
      handoffDirectory: source.internal?.handoffRelativePath ?? "UNRESOLVED",
      acceptanceIds:
        status === "PENDING" ? ["INT-001", "INT-002"] : ["INT-001"],
    },
    ...artifactChecks,
    source.check,
    bundleCheck,
    {
      id: "HTTP_WSGS_ANALYSIS_ADAPTER",
      status: "NOT_RUN",
      acceptanceIds: ["INT-007"],
      reason: "REAL_INTEGRATION_NOT_EXECUTED_BY_READINESS_CHECK",
    },
    {
      id: "REAL_INTEGRATION_E2E",
      status: "NOT_RUN",
      acceptanceIds: ["INT-008", "INT-009", "INT-010", "INT-011", "INT-012"],
      reason: "REAL_INTEGRATION_NOT_EXECUTED_BY_READINESS_CHECK",
    },
  ],
};

await validateDocument({
  schemaPath: resolve(layout.contracts, "gate-result.schema.json"),
  document: report,
  label: "integration readiness",
});
if (args.has("--write")) {
  await writeJson(resolve(layout.reports, "INTEGRATION_STATUS.json"), report);
}

process.stdout.write(`${JSON.stringify(report)}\n`);
if (status === "FAIL" || (args.has("--require-ready") && status !== "PASS")) {
  process.exitCode = 1;
}

async function inspectAuthoritativeSource(input) {
  if (
    typeof input.expectedRepository !== "string" ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(input.expectedRepository)
  ) {
    return failedSource("AUTHORITATIVE_WSGS_REPOSITORY_CONFIG_INVALID");
  }
  if (
    typeof input.expectedWsgsSha === "string" &&
    input.expectedWsgsSha.length > 0 &&
    !/^[0-9a-f]{40}$/u.test(input.expectedWsgsSha)
  ) {
    return failedSource("AUTHORITATIVE_WSGS_SHA_INVALID");
  }
  if (
    typeof input.configuredRepository !== "string" ||
    input.configuredRepository.length === 0
  ) {
    return pendingSource("AUTHORITATIVE_WSGS_CHECKOUT_UNAVAILABLE");
  }

  const repositoryPath = resolve(root, input.configuredRepository);
  try {
    const [topLevel, headSha, remoteUrl] = await Promise.all([
      gitText(repositoryPath, ["rev-parse", "--show-toplevel"]),
      gitText(repositoryPath, ["rev-parse", "--verify", "HEAD^{commit}"]),
      gitText(repositoryPath, ["remote", "get-url", "origin"]),
    ]);
    if (resolve(topLevel) !== repositoryPath) {
      return failedSource("AUTHORITATIVE_WSGS_CHECKOUT_ROOT_REQUIRED");
    }
    if (!/^[0-9a-f]{40}$/u.test(headSha)) {
      return failedSource("AUTHORITATIVE_WSGS_HEAD_INVALID");
    }
    const repository = repositorySlug(remoteUrl);
    if (repository?.toLowerCase() !== input.expectedRepository.toLowerCase()) {
      return failedSource("AUTHORITATIVE_WSGS_REMOTE_MISMATCH");
    }
    const handoffRelativePath = relativeToRepository(
      repositoryPath,
      input.configuredHandoff,
    );
    return {
      check: {
        id: "AUTHORITATIVE_WSGS_SOURCE",
        status: "PASS",
        repository: input.expectedRepository,
        headSha,
        expectedSourceSha: input.expectedWsgsSha,
        verification: "INDEPENDENT_GIT_CHECKOUT_HEAD_AND_ORIGIN",
      },
      internal: {
        repositoryPath,
        repository,
        headSha,
        handoffRelativePath,
      },
    };
  } catch (error) {
    if (readinessErrorCode(error, "").startsWith("AUTHORITATIVE_")) {
      return failedSource(
        readinessErrorCode(error, "AUTHORITATIVE_WSGS_INVALID"),
      );
    }
    return pendingSource("AUTHORITATIVE_WSGS_CHECKOUT_UNAVAILABLE");
  }
}

function relativeToRepository(repositoryPath, configuredHandoffPath) {
  if (
    typeof configuredHandoffPath !== "string" ||
    configuredHandoffPath.length === 0
  ) {
    throw readinessError("AUTHORITATIVE_WSGS_HANDOFF_PATH_INVALID");
  }
  const absolutePath = resolve(repositoryPath, configuredHandoffPath);
  const relativePath = relative(repositoryPath, absolutePath);
  if (
    relativePath.length === 0 ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw readinessError("AUTHORITATIVE_WSGS_HANDOFF_OUTSIDE_CHECKOUT");
  }
  return relativePath.split(sep).join("/");
}

async function loadCommittedBundle(input) {
  const tree = await gitText(input.repositoryPath, [
    "ls-tree",
    "-r",
    input.headSha,
    "--",
    input.handoffRelativePath,
  ]);
  const entries = new Map();
  for (const line of tree.length === 0 ? [] : tree.split("\n")) {
    const separator = line.indexOf("\t");
    if (separator < 0) {
      throw readinessError("WSGS_ANALYSIS_HANDOFF_GIT_TREE_INVALID");
    }
    const [mode, type, objectId] = line.slice(0, separator).split(" ");
    entries.set(line.slice(separator + 1), { mode, type, objectId });
  }
  const expectedPaths = input.requiredArtifacts.map(
    ({ file }) => `${input.handoffRelativePath}/${file}`,
  );
  const unexpectedPaths = [...entries.keys()].filter(
    (path) => !expectedPaths.includes(path),
  );
  if (unexpectedPaths.length > 0) {
    throw readinessError("WSGS_ANALYSIS_HANDOFF_EXACT_INVENTORY_INVALID");
  }

  const values = new Map();
  const bytes = new Map();
  const checks = [];
  for (const artifact of input.requiredArtifacts) {
    const path = `${input.handoffRelativePath}/${artifact.file}`;
    const entry = entries.get(path);
    if (entry === undefined) {
      checks.push({
        id: artifact.capability,
        artifact: artifact.file,
        status: "PENDING",
        reason: "AUTHORITATIVE_ARTIFACT_UNAVAILABLE_AT_WSGS_HEAD",
      });
      continue;
    }
    if (
      entry.type !== "blob" ||
      !["100644", "100755"].includes(entry.mode) ||
      !/^[0-9a-f]{40,64}$/u.test(entry.objectId)
    ) {
      checks.push({
        id: artifact.capability,
        artifact: artifact.file,
        status: "FAIL",
        reason: "AUTHORITATIVE_ARTIFACT_NOT_A_TRACKED_REGULAR_FILE",
      });
      continue;
    }
    try {
      const artifactBytes = await gitBytes(input.repositoryPath, [
        "cat-file",
        "blob",
        entry.objectId,
      ]);
      const value = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(artifactBytes),
      );
      bytes.set(artifact.file, artifactBytes);
      values.set(artifact.file, value);
      if (
        artifact.capability === "CONSUMER_LOCK" &&
        value?.status === "BLOCKED"
      ) {
        checks.push({
          id: artifact.capability,
          artifact: artifact.file,
          status: "PENDING",
          reason: "CONSUMER_LOCK_NOT_READY",
        });
      } else if (
        artifact.capability === "CONSUMER_LOCK" &&
        (value === null ||
          typeof value !== "object" ||
          value.status !== "READY")
      ) {
        checks.push({
          id: artifact.capability,
          artifact: artifact.file,
          status: "FAIL",
          reason: "CONSUMER_LOCK_INVALID",
        });
      } else {
        checks.push({
          id: artifact.capability,
          artifact: artifact.file,
          status: "PASS",
        });
      }
    } catch {
      checks.push({
        id: artifact.capability,
        artifact: artifact.file,
        status: "FAIL",
        reason: "AUTHORITATIVE_ARTIFACT_INVALID",
      });
    }
  }
  return { values, bytes, checks };
}

async function verifyAuthoritativeBundle(input) {
  const lock = object(
    input.values.get("WSGS_ANALYSIS_CONSUMER_LOCK.json"),
    "WSGS_ANALYSIS_CONSUMER_LOCK_INVALID",
  );
  const checksums = object(
    input.values.get("CHECKSUMS.json"),
    "WSGS_ANALYSIS_CHECKSUMS_INVALID",
  );
  if (
    lock.schemaVersion !== "sacs-wsgs-analysis-consumer-lock/1.0" ||
    lock.profile !== "sacs-wsgs-analysis-presentation/1.0" ||
    lock.provenance !== "AUTHORITATIVE_WSGS_HANDOFF" ||
    lock.status !== "READY" ||
    !/^[0-9a-f]{40}$/u.test(lock.wsgsSha) ||
    !["STREAMING_EVENTS", "POLLING_SNAPSHOT"].includes(lock.transportMode)
  ) {
    throw readinessError("WSGS_ANALYSIS_CONSUMER_LOCK_INVALID");
  }
  if (
    input.expectedWsgsSha !== undefined &&
    input.expectedWsgsSha.length > 0 &&
    lock.wsgsSha !== input.expectedWsgsSha
  ) {
    throw readinessError("WSGS_ANALYSIS_SOURCE_SHA_MISMATCH");
  }
  if (
    !(await gitCommitExists(input.repositoryPath, lock.wsgsSha)) ||
    !(await gitIsAncestor(input.repositoryPath, lock.wsgsSha, input.headSha))
  ) {
    throw readinessError("WSGS_ANALYSIS_SOURCE_SHA_NOT_REACHABLE_FROM_HEAD");
  }
  assertLockRoutes(lock);
  const requiredSemantics = object(
    input.requiredLockSemantics,
    "WSGS_ANALYSIS_REQUIRED_SEMANTICS_INVALID",
  );
  for (const [field, expected] of Object.entries(requiredSemantics)) {
    if (lock[field] !== expected) {
      throw readinessError(
        `WSGS_ANALYSIS_LOCK_SEMANTICS_INCOMPATIBLE:${field}`,
      );
    }
  }
  if (
    checksums.schemaVersion !== "wsgs-analysis-handoff-checksums/1.0" ||
    checksums.algorithm !== "SHA-256" ||
    !Array.isArray(checksums.files)
  ) {
    throw readinessError("WSGS_ANALYSIS_CHECKSUMS_INVALID");
  }

  const schemaLocks = new Map(
    input.requiredArtifacts
      .filter(({ requiredSemanticProperties }) =>
        Array.isArray(requiredSemanticProperties),
      )
      .map((artifact) => [artifact.file, artifact]),
  );
  const schemaHashFields = {
    "WSGS_ANALYSIS_PLAN_SCHEMA_LOCK.json": "planSchemaHash",
    "WSGS_ANALYSIS_EVENT_SCHEMA_LOCK.json": "eventSchemaHash",
    "WSGS_TOOL_INTERACTION_SCHEMA_LOCK.json": "toolInteractionSchemaHash",
    "WSGS_REVISION_CONTROL_SCHEMA_LOCK.json": "revisionControlSchemaHash",
    "WSGS_CANCEL_SCHEMA_LOCK.json": "cancelSchemaHash",
    "WSGS_INTERVENTION_SCHEMA_LOCK.json": "interventionSchemaHash",
  };
  const checkedNames = input.requiredArtifacts
    .map(({ file }) => file)
    .filter((name) => name !== "CHECKSUMS.json");
  const checksumEntries = checksums.files.map((entry) =>
    object(entry, "WSGS_ANALYSIS_CHECKSUMS_INVALID"),
  );
  if (
    checksumEntries.length !== checkedNames.length ||
    new Set(checksumEntries.map(({ path }) => path)).size !==
      checkedNames.length ||
    !checkedNames.every((name) =>
      checksumEntries.some(({ path }) => path === name),
    )
  ) {
    throw readinessError("WSGS_ANALYSIS_CHECKSUM_INVENTORY_INVALID");
  }

  const checkedHashes = {};
  for (const name of checkedNames) {
    const artifactBytes = input.bytes.get(name);
    if (artifactBytes === undefined) {
      throw readinessError("WSGS_ANALYSIS_HANDOFF_BYTES_INVALID");
    }
    const actual = sha256(artifactBytes);
    const declared = checksumEntries.find(({ path }) => path === name)?.sha256;
    if (declared !== actual) {
      throw readinessError(`WSGS_ANALYSIS_CHECKSUM_DRIFT:${name}`);
    }
    checkedHashes[name] = actual;
    const lockField = schemaHashFields[name];
    if (lockField !== undefined && lock[lockField] !== actual) {
      throw readinessError(`WSGS_ANALYSIS_SCHEMA_HASH_MISMATCH:${name}`);
    }
    const schemaRequirement = schemaLocks.get(name);
    if (schemaRequirement !== undefined) {
      verifySchemaSemantics(
        name,
        input.values.get(name),
        schemaRequirement.requiredSemanticProperties,
      );
    }
  }
  if (checksums.bundleHash !== canonicalHash(checkedHashes)) {
    throw readinessError("WSGS_ANALYSIS_CHECKSUM_BUNDLE_HASH_DRIFT");
  }
  return {
    compatibilityLevel:
      lock.wsgsSha === input.headSha ? "EXACT" : "BACKWARD_COMPATIBLE",
  };
}

function verifySchemaSemantics(name, value, requiredSemanticProperties) {
  const schema = object(value, `WSGS_ANALYSIS_SCHEMA_LOCK_INVALID:${name}`);
  if (
    schema.$schema !== "https://json-schema.org/draft/2020-12/schema" ||
    typeof schema.$id !== "string" ||
    !/^(?:urn:|https:\/\/)/u.test(schema.$id)
  ) {
    throw readinessError(`WSGS_ANALYSIS_SCHEMA_ID_OR_DIALECT_INVALID:${name}`);
  }
  try {
    validator().compile(schema);
  } catch {
    throw readinessError(`WSGS_ANALYSIS_SCHEMA_COMPILE_FAILED:${name}`);
  }
  if (
    !Array.isArray(requiredSemanticProperties) ||
    requiredSemanticProperties.length === 0
  ) {
    throw readinessError(`WSGS_ANALYSIS_SCHEMA_REQUIREMENTS_INVALID:${name}`);
  }
  const properties = collectSchemaNames(schema, "properties");
  const required = collectRequiredNames(schema);
  for (const property of requiredSemanticProperties) {
    if (!properties.has(property) || !required.has(property)) {
      throw readinessError(
        `WSGS_ANALYSIS_SCHEMA_SEMANTICS_INCOMPATIBLE:${name}:${property}`,
      );
    }
  }
}

function collectSchemaNames(value, keyword, result = new Set()) {
  if (Array.isArray(value)) {
    for (const entry of value) collectSchemaNames(entry, keyword, result);
    return result;
  }
  if (value === null || typeof value !== "object") return result;
  if (
    value[keyword] !== null &&
    typeof value[keyword] === "object" &&
    !Array.isArray(value[keyword])
  ) {
    for (const name of Object.keys(value[keyword])) result.add(name);
  }
  for (const nested of Object.values(value)) {
    collectSchemaNames(nested, keyword, result);
  }
  return result;
}

function collectRequiredNames(value, result = new Set()) {
  if (Array.isArray(value)) {
    for (const entry of value) collectRequiredNames(entry, result);
    return result;
  }
  if (value === null || typeof value !== "object") return result;
  if (Array.isArray(value.required)) {
    for (const name of value.required) {
      if (typeof name === "string") result.add(name);
    }
  }
  for (const nested of Object.values(value)) {
    collectRequiredNames(nested, result);
  }
  return result;
}

function assertLockRoutes(lock) {
  const endpoints = object(lock.endpoints, "WSGS_ANALYSIS_ENDPOINTS_INVALID");
  const names = [
    "snapshot",
    "compileRevision",
    "cancel",
    "resolveIntervention",
  ];
  if (lock.transportMode === "STREAMING_EVENTS") names.push("events");
  if (
    lock.transportMode === "POLLING_SNAPSHOT" &&
    endpoints.events !== undefined
  ) {
    throw readinessError("WSGS_ANALYSIS_ENDPOINTS_INVALID");
  }
  const routes = names.map((name) => endpoints[name]);
  if (
    routes.some(
      (route) =>
        typeof route !== "string" ||
        route.length > 1_024 ||
        !/^\/(?!\/)[A-Za-z0-9._{}:/-]+$/u.test(route) ||
        route.split("/").includes(".."),
    ) ||
    new Set(routes).size !== routes.length
  ) {
    throw readinessError("WSGS_ANALYSIS_ENDPOINTS_INVALID");
  }
}

async function gitText(repositoryPath, arguments_) {
  const { stdout } = await execFileAsync(
    "git",
    ["-C", repositoryPath, ...arguments_],
    { encoding: "utf8", maxBuffer: 4 * 1_024 * 1_024 },
  );
  return stdout.trim();
}

async function gitBytes(repositoryPath, arguments_) {
  const { stdout } = await execFileAsync(
    "git",
    ["-C", repositoryPath, ...arguments_],
    { encoding: null, maxBuffer: 4 * 1_024 * 1_024 },
  );
  return stdout;
}

async function gitCommitExists(repositoryPath, commit) {
  try {
    await gitText(repositoryPath, ["cat-file", "-e", `${commit}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

async function gitIsAncestor(repositoryPath, ancestor, descendant) {
  try {
    await gitText(repositoryPath, [
      "merge-base",
      "--is-ancestor",
      ancestor,
      descendant,
    ]);
    return true;
  } catch {
    return false;
  }
}

function repositorySlug(remoteUrl) {
  if (typeof remoteUrl !== "string") return undefined;
  const normalized = remoteUrl.trim();
  const scpMatch = normalized.match(
    /^git@github\.com:([^/]+\/[^/]+?)(?:\.git)?$/u,
  );
  if (scpMatch !== null) return scpMatch[1];
  try {
    const parsed = new URL(normalized);
    if (parsed.hostname.toLowerCase() !== "github.com") return undefined;
    const path = parsed.pathname
      .replace(/^\/+|\/+$/gu, "")
      .replace(/\.git$/u, "");
    return /^[^/]+\/[^/]+$/u.test(path) ? path : undefined;
  } catch {
    return undefined;
  }
}

function pendingArtifactChecks(requiredArtifacts, reason) {
  return requiredArtifacts.map(({ capability, file }) => ({
    id: capability,
    artifact: file,
    status: "PENDING",
    reason,
  }));
}

function pendingSource(reason) {
  return {
    check: { id: "AUTHORITATIVE_WSGS_SOURCE", status: "PENDING", reason },
  };
}

function failedSource(reason) {
  return {
    check: { id: "AUTHORITATIVE_WSGS_SOURCE", status: "FAIL", reason },
  };
}

function readinessError(code, status = "FAIL") {
  const error = new Error(code);
  error.readinessStatus = status;
  return error;
}

function readinessErrorCode(error, fallback) {
  return error !== null &&
    typeof error === "object" &&
    typeof error.message === "string"
    ? error.message
    : fallback;
}

function readinessErrorStatus(error) {
  return error !== null &&
    typeof error === "object" &&
    error.readinessStatus === "PENDING"
    ? "PENDING"
    : "FAIL";
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function canonicalHash(value) {
  return sha256(Buffer.from(JSON.stringify(canonicalize(value)), "utf8"));
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])]),
  );
}

function object(value, code) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw readinessError(code);
  }
  return value;
}
