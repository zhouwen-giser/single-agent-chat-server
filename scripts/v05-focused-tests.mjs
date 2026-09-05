import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import process from "node:process";

const tests = [
  "tests/analysis-domain.unit.test.ts",
  "tests/analysis-persistence.contract.test.ts",
  "tests/analysis-projection-reducer.unit.test.ts",
  "tests/analysis-event-pump.unit.test.ts",
  "tests/analysis-revision.unit.test.ts",
  "tests/analysis-control-coordinator.unit.test.ts",
  "tests/analysis-tool-interaction.security.test.ts",
  "tests/analysis-authority-boundary.static.test.ts",
  "tests/agui-v03-analysis-projection.unit.test.ts",
  "tests/analysis-reference-client.contract.test.ts",
  "tests/agui-profile.contract.test.ts",
  "tests/agui-production-typed-events.unit.test.ts",
  "tests/analysis-control-api.contract.test.ts",
  "tests/v05-wsgs-analysis-consumer.contract.test.ts",
  "tests/world-finding-normalizer.security.test.ts",
  "tests/geospatial-authority-boundary.static.test.ts",
  "tests/server-config.unit.test.ts",
  "tests/agui-v03-development-readiness.unit.test.ts",
  "tests/v05-wsgs-analysis-adapter.unit.test.ts",
  "tests/v05-analysis-development-runtime.unit.test.ts",
  "tests/v05-analysis-development-composition.unit.test.ts",
  "tests/v05-progressive-development.contract.test.ts",
];

await Promise.all(tests.map((file) => access(file)));
const status = await new Promise((resolve, reject) => {
  const child = spawn(
    process.execPath,
    [
      "--experimental-vm-modules",
      "node_modules/jest/bin/jest.js",
      "--runInBand",
      ...tests,
    ],
    { cwd: process.cwd(), env: process.env, stdio: "inherit" },
  );
  child.once("error", reject);
  child.once("exit", (code, signal) => {
    if (signal !== null) {
      reject(new Error(`Focused Jest terminated by ${signal}`));
    } else resolve(code ?? 1);
  });
});
if (status !== 0) process.exitCode = status;
