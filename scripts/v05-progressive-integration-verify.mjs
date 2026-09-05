import { resolve } from "node:path";
import process from "node:process";
import {
  parseArguments,
  paths,
  readJson,
  validateDocument,
} from "./v05-progressive-lib.mjs";

const args = parseArguments(process.argv.slice(2));
const root = args.value("--root") ?? process.cwd();
const layout = paths(root, args.value("--report-root"));
const readiness = await readJson(
  resolve(layout.config, "integration-readiness.json"),
);
const runnerCases = readiness.realIntegrationRunner?.cases;
const runnerAvailable = readiness.realIntegrationRunner?.available === true;
const adapterAvailable = readiness.httpAdapterAvailable === true;
const caseInventoryValid =
  Array.isArray(runnerCases) &&
  runnerCases.length === 6 &&
  new Set(runnerCases).size === 6;
const checks = [
  {
    id: "HTTP_WSGS_ANALYSIS_ADAPTER",
    status: adapterAvailable ? "NOT_RUN" : "FAIL",
    acceptanceIds: ["INT-007"],
    reason: adapterAvailable
      ? "REAL_HTTP_ADAPTER_NOT_EXECUTED"
      : "REAL_HTTP_WSGS_ANALYSIS_ADAPTER_UNAVAILABLE",
  },
  {
    id: "REAL_INTEGRATION_E2E",
    status: runnerAvailable && caseInventoryValid ? "NOT_RUN" : "FAIL",
    acceptanceIds: ["INT-008", "INT-009", "INT-010", "INT-011", "INT-012"],
    requiredCases: Array.isArray(runnerCases) ? runnerCases : [],
    reason:
      runnerAvailable && caseInventoryValid
        ? "REAL_SIX_CASE_INTEGRATION_NOT_EXECUTED"
        : "REAL_SIX_CASE_INTEGRATION_RUNNER_UNAVAILABLE",
  },
];
const report = {
  schemaVersion: "sacs-v05-gate-result/1.0",
  gateId: "SACS_V05_REAL_INTEGRATION",
  track: "INTEGRATION",
  status: "FAIL",
  checks,
};

await validateDocument({
  schemaPath: resolve(layout.contracts, "gate-result.schema.json"),
  document: report,
  label: "real integration verification",
});
process.stdout.write(`${JSON.stringify(report)}\n`);
process.exitCode = 1;
