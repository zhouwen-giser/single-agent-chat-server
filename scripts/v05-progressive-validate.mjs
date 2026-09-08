import {
  parseArguments,
  validateActiveReports,
  validateStaticConfiguration,
} from "./v05-progressive-lib.mjs";

const args = parseArguments(process.argv.slice(2));
const root = args.value("--root") ?? process.cwd();
const reportRoot = args.value("--report-root");

const { matrix } = await validateStaticConfiguration(root);
const reports = await validateActiveReports(root, reportRoot);

process.stdout.write(
  `${JSON.stringify({
    marker: "SACS_V05_PROGRESSIVE_GATES_READY",
    status: "PASS",
    acceptance: matrix.counts,
    activeReports: Object.keys(reports).length,
    packageSchemas: 7,
    extensionSchemas: 1,
  })}\n`,
);
