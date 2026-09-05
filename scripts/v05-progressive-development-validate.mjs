import process from "node:process";
import {
  parseArguments,
  validateDevelopmentConfiguration,
} from "./v05-progressive-lib.mjs";

const args = parseArguments(process.argv.slice(2));
const root = args.value("--root") ?? process.cwd();
const reportRoot = args.value("--report-root");
const { rows, reports } = await validateDevelopmentConfiguration(
  root,
  reportRoot,
);

process.stdout.write(
  `${JSON.stringify({
    marker: "SACS_V05_DEVELOPMENT_CONTRACTS_READY",
    status: "PASS",
    acceptance: { DEVELOPMENT: rows.length },
    activeDevelopmentReports: Object.keys(reports).length,
  })}\n`,
);
