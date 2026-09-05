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
const runnerAvailable = readiness.qualificationRunner?.available === true;
const report = {
  schemaVersion: "sacs-v05-gate-result/1.0",
  gateId: "SACS_V05_RELEASE_QUALIFICATION",
  track: "RELEASE",
  status: "FAIL",
  checks: [
    {
      id: "REAL_RELEASE_QUALIFICATION",
      status: "FAIL",
      acceptanceIds: readiness.acceptanceIds,
      requested: true,
      qualificationRunnerAvailable: runnerAvailable,
      reason: runnerAvailable
        ? "REAL_RELEASE_QUALIFICATION_EXECUTION_NOT_IMPLEMENTED"
        : "REAL_RELEASE_QUALIFICATION_RUNNER_UNAVAILABLE",
    },
  ],
};

await validateDocument({
  schemaPath: resolve(layout.contracts, "gate-result.schema.json"),
  document: report,
  label: "release qualification verification",
});
process.stdout.write(`${JSON.stringify(report)}\n`);
process.exitCode = 1;
