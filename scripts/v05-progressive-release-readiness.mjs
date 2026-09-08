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
  resolve(layout.config, "release-readiness.json"),
);
const requested =
  args.has("--requested") ||
  process.env[readiness.requestEnvironmentVariable] === "true";
const runnerAvailable = readiness.qualificationRunner?.available === true;
const reason = requested
  ? runnerAvailable
    ? "REAL_RELEASE_QUALIFICATION_NOT_EXECUTED_BY_READINESS_CHECK"
    : "REAL_RELEASE_QUALIFICATION_RUNNER_UNAVAILABLE"
  : "RELEASE_QUALIFICATION_NOT_REQUESTED";
const checks = readiness.acceptanceIds.map((acceptanceId) => ({
  id: acceptanceId,
  status: "NOT_RUN",
  reason,
}));
const report = {
  schemaVersion: "sacs-v05-gate-result/1.0",
  gateId: "SACS_V05_RELEASE_READINESS",
  track: "RELEASE",
  status: "PENDING",
  checks: [
    {
      id: "RELEASE_DECISION",
      status: "PENDING",
      readiness: "PENDING",
      decision: "RELEASE_HARDENING_PENDING",
      requested,
      qualificationRunnerAvailable: runnerAvailable,
      reason,
    },
    ...checks,
  ],
};

await validateDocument({
  schemaPath: resolve(layout.contracts, "gate-result.schema.json"),
  document: report,
  label: "release readiness",
});
process.stdout.write(`${JSON.stringify(report)}\n`);
if (args.has("--require-ready")) process.exitCode = 1;
