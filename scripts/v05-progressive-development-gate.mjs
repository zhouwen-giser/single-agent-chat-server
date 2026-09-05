import { resolve } from "node:path";
import process from "node:process";
import {
  gitDevelopmentSource,
  loadDevelopmentAcceptance,
  parseArguments,
  paths,
  readJson,
  validateDocument,
  verifyDevelopmentGateReport,
} from "./v05-progressive-lib.mjs";

const args = parseArguments(process.argv.slice(2));
const root = args.value("--root") ?? process.cwd();
const reportRoot = args.value("--report-root");
const layout = paths(root, reportRoot);
const reportPath = resolve(layout.reports, "DEVELOPMENT_VERIFICATION.json");
if (args.has("--mark-pass") || args.has("--write")) {
  throw new Error("DEVELOPMENT_STANDALONE_PROMOTION_FORBIDDEN");
}
const { rows: developmentRows, evidenceGroups } =
  await loadDevelopmentAcceptance(root);
const report = await readJson(reportPath);

await validateDocument({
  schemaPath: resolve(layout.contracts, "gate-result.schema.json"),
  document: report,
  label: "development verification",
});
verifyDevelopmentGateReport(
  report,
  developmentRows,
  report.status === "PASS" ? await gitDevelopmentSource(root) : undefined,
  evidenceGroups,
);

process.stdout.write(`${JSON.stringify(report)}\n`);
if (args.has("--require-pass") && report.status !== "PASS") {
  process.exitCode = 1;
}
