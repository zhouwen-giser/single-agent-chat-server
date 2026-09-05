import { resolve } from "node:path";
import process from "node:process";
import {
  gitDevelopmentSource,
  gitSource,
  loadDevelopmentAcceptance,
  parseArguments,
  paths,
  readJson,
  validateDocument,
  verifyDevelopmentGateReport,
  writeJson,
} from "./v05-progressive-lib.mjs";

const args = parseArguments(process.argv.slice(2));
const root = args.value("--root") ?? process.cwd();
const layout = paths(root, args.value("--report-root"));
if (args.has("--release-ready")) {
  throw new Error("RELEASE_READY_REQUIRES_SOURCE_BOUND_QUALIFICATION_REPORT");
}
if (
  args.has("--release-failed") &&
  (args.has("--release-pending") || args.has("--release-report"))
) {
  throw new Error("Release status inputs are mutually exclusive");
}
if (args.has("--release-pending") && args.has("--release-report")) {
  throw new Error("Release status inputs are mutually exclusive");
}

const [
  source,
  developmentSource,
  developmentAcceptance,
  developmentReport,
  integrationReport,
] = await Promise.all([
  gitSource(root),
  gitDevelopmentSource(root),
  loadDevelopmentAcceptance(root),
  readJson(resolve(layout.reports, "DEVELOPMENT_VERIFICATION.json")),
  readJson(resolve(layout.reports, "INTEGRATION_STATUS.json")),
]);
await Promise.all([
  validateDocument({
    schemaPath: resolve(layout.contracts, "gate-result.schema.json"),
    document: developmentReport,
    label: "development verification",
  }),
  validateDocument({
    schemaPath: resolve(layout.contracts, "gate-result.schema.json"),
    document: integrationReport,
    label: "integration status",
  }),
]);
verifyDevelopmentGateReport(
  developmentReport,
  developmentAcceptance.rows,
  developmentReport.status === "PASS" ? developmentSource : undefined,
  developmentAcceptance.evidenceGroups,
);
const integrationEvaluation = evaluateIntegrationReport(
  integrationReport,
  source,
);

let releaseEvaluation = {
  status: "RELEASE_HARDENING_PENDING",
  pendingReason: "RELEASE_QUALIFICATION_NOT_REQUESTED",
};
const releaseReportPath = args.value("--release-report");
if (releaseReportPath !== undefined) {
  const releaseReport = await readJson(resolve(root, releaseReportPath));
  await validateDocument({
    schemaPath: resolve(layout.contracts, "gate-result.schema.json"),
    document: releaseReport,
    label: "release qualification",
  });
  releaseEvaluation = evaluateReleaseReport(releaseReport, source);
} else if (args.has("--release-failed")) {
  releaseEvaluation = { status: "RELEASE_FAILED", pendingReason: undefined };
}

const development = {
  PASS: "FEATURE_COMPLETE",
  FAIL: "CORE_BLOCKED",
  PENDING: "NOT_EVALUATED",
  NOT_RUN: "NOT_EVALUATED",
}[developmentReport.status];
const pendingReasons = [];
if (integrationEvaluation.status === "INTEGRATION_PENDING") {
  pendingReasons.push(
    integrationReport.status === "PENDING"
      ? "AUTHORITATIVE_WSGS_ANALYSIS_CONTROL_HANDOFF_UNAVAILABLE"
      : "REAL_WSGS_INTEGRATION_NOT_VERIFIED",
  );
}
if (releaseEvaluation.pendingReason !== undefined) {
  pendingReasons.push(releaseEvaluation.pendingReason);
}
const hardFailures = [];
if (development === "CORE_BLOCKED") {
  hardFailures.push("DEVELOPMENT_GATE_FAILED");
}

const report = {
  schemaVersion: "sacs-v05-progressive-status/1.0",
  source,
  development,
  integration: integrationEvaluation.status,
  release: releaseEvaluation.status,
  pendingReasons,
  hardFailures,
  updatedAt: args.value("--updated-at") ?? new Date().toISOString(),
};
await validateDocument({
  schemaPath: resolve(layout.contracts, "progressive-status.schema.json"),
  document: report,
  label: "progressive status",
});
if (args.has("--write")) {
  await writeJson(resolve(layout.reports, "PROGRESSIVE_STATUS.json"), report);
}
process.stdout.write(`${JSON.stringify(report)}\n`);

function evaluateIntegrationReport(document, currentSource) {
  if (
    document.track !== "INTEGRATION" ||
    !["SACS_V05_INTEGRATION_READINESS", "SACS_V05_REAL_INTEGRATION"].includes(
      document.gateId,
    ) ||
    !Array.isArray(document.checks)
  ) {
    throw new Error("Integration report identity is invalid");
  }
  const checks = checkMap(document.checks, "Integration");
  const realIntegrationComplete =
    document.gateId === "SACS_V05_REAL_INTEGRATION" &&
    document.status === "PASS" &&
    checks.get("HTTP_WSGS_ANALYSIS_ADAPTER")?.status === "PASS" &&
    checks.get("REAL_INTEGRATION_E2E")?.status === "PASS";
  if (realIntegrationComplete) {
    verifySource(document.source, currentSource, "INTEGRATION_SOURCE_MISMATCH");
  }
  return {
    status:
      document.status === "FAIL"
        ? "INTEGRATION_FAILED"
        : document.status === "NOT_RUN"
          ? "NOT_EVALUATED"
          : realIntegrationComplete
            ? "INTEGRATION_READY"
            : "INTEGRATION_PENDING",
  };
}

function evaluateReleaseReport(document, currentSource) {
  if (
    document.gateId !== "SACS_V05_RELEASE_QUALIFICATION" ||
    document.track !== "RELEASE" ||
    !Array.isArray(document.checks)
  ) {
    throw new Error("Release qualification report identity is invalid");
  }
  if (document.status === "FAIL") {
    return { status: "RELEASE_FAILED", pendingReason: undefined };
  }
  if (document.status !== "PASS") {
    return {
      status: "RELEASE_HARDENING_PENDING",
      pendingReason: "RELEASE_QUALIFICATION_INCOMPLETE",
    };
  }
  const expectedIds = Array.from(
    { length: 10 },
    (_, index) => `REL-${String(index + 1).padStart(3, "0")}`,
  );
  const observedIds = [];
  for (const check of checkMap(document.checks, "Release").values()) {
    if (check.status !== "PASS" || !Array.isArray(check.acceptanceIds)) {
      throw new Error(
        "Release PASS requires every qualification check to pass",
      );
    }
    observedIds.push(...check.acceptanceIds);
  }
  if (
    new Set(observedIds).size !== expectedIds.length ||
    JSON.stringify(observedIds.sort()) !== JSON.stringify(expectedIds)
  ) {
    throw new Error("Release PASS must cover exactly ten acceptance IDs");
  }
  verifySource(document.source, currentSource, "RELEASE_SOURCE_MISMATCH");
  return { status: "RELEASE_READY", pendingReason: undefined };
}

function checkMap(checks, label) {
  const result = new Map();
  for (const check of checks) {
    if (
      check === null ||
      typeof check !== "object" ||
      Array.isArray(check) ||
      typeof check.id !== "string" ||
      result.has(check.id)
    ) {
      throw new Error(`${label} report contains an invalid check`);
    }
    result.set(check.id, check);
  }
  return result;
}

function verifySource(actual, expected, code) {
  if (
    actual?.repository !== expected.repository ||
    actual?.branch !== expected.branch ||
    actual?.headSha !== expected.headSha
  ) {
    throw new Error(code);
  }
}
