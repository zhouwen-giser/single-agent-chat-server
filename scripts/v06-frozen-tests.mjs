import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const modes = ["contracts", "unit", "http", "all"];
const args = process.argv.slice(2);
const positional = args.filter((arg) => arg !== "--list");
const mode = positional[0] ?? "all";
if (
  positional.length > 1 ||
  args.filter((arg) => arg === "--list").length > 1 ||
  !modes.includes(mode)
) {
  process.stderr.write(
    "Usage: node scripts/v06-frozen-tests.mjs [contracts|unit|http|all] [--list]\n",
  );
  process.exit(2);
}

// Explicit predecessor coverage, never the repository's release/DB aggregate gates.
const legacy = {
  contracts: [
    "tests/v06-analysis-source.contract.test.ts",
    "tests/v06-grounding-job.contract.test.ts",
    "tests/wsgs-http-adapter.contract.test.ts",
    "tests/sdar-a2a-adapter.contract.test.ts",
    "tests/analysis-reference-client.contract.test.ts",
    "tests/analysis-control-api.contract.test.ts",
    "tests/multi-task-coordinator.contract.test.ts",
    "tests/openai-api.contract.test.ts",
    "tests/openai-predecessor-regression.contract.test.ts",
    "tests/structured-world-selection.contract.test.ts",
    "tests/structured-world-selection-api.contract.test.ts",
    "tests/authority-fusion-input.contract.test.ts",
  ],
  unit: [
    "tests/v06-analysis-config.unit.test.ts",
    "tests/v06-world-analysis-view.unit.test.ts",
    "tests/v06-source-bridge.unit.test.ts",
    "tests/v05-analysis-development-runtime.unit.test.ts",
    "tests/grounding-request-planner.unit.test.ts",
    "tests/world-grounding-runtime.unit.test.ts",
    "tests/world-grounding-application.unit.test.ts",
    "tests/world-grounding-explanation.unit.test.ts",
    "tests/world-explanation-renderer.unit.test.ts",
    "tests/finding-reference-resolver.unit.test.ts",
    "tests/structured-world-selection-resolver.unit.test.ts",
    "tests/authority-fusion-input.unit.test.ts",
    "tests/agui-v03-analysis-projection.unit.test.ts",
    "tests/agui-v03-development-readiness.unit.test.ts",
    "tests/analysis-control-coordinator.unit.test.ts",
    "tests/query-service.unit.test.ts",
  ],
  http: [
    "tests/sdar-a2a-adapter.contract.test.ts",
    "tests/structured-world-selection-api.contract.test.ts",
  ],
};
const frozenHttp = [
  "tests/v06-frozen-http.contract.test.ts",
  "tests/v06-frozen-source.unit.test.ts",
  "tests/v06-frozen-cancel.unit.test.ts",
  "tests/v06-frozen-request.unit.test.ts",
];
const discovered = readdirSync(resolve(root, "tests"))
  .filter((name) =>
    /^v06-frozen-[a-z0-9-]+\.(?:unit|contract|integration)\.test\.ts$/u.test(
      name,
    ),
  )
  .map((name) => `tests/${name}`)
  .sort();
const frozenByMode = {
  contracts: discovered.filter((name) => name.endsWith(".contract.test.ts")),
  unit: discovered.filter((name) => name.endsWith(".unit.test.ts")),
  http: [
    ...frozenHttp,
    ...discovered.filter((name) => name.endsWith(".integration.test.ts")),
  ],
  all: discovered,
};
const legacyTests = [
  ...new Set(mode === "all" ? Object.values(legacy).flat() : legacy[mode]),
].sort();
const frozenTests = [...new Set(frozenByMode[mode])].sort();
const tests = [...new Set([...frozenTests, ...legacyTests])].sort();
for (const test of tests) {
  if (
    !/^tests\/[a-z0-9-]+\.(?:unit|contract|integration)\.test\.ts$/u.test(
      test,
    ) ||
    /(?:postgres|docker|release|real-e2e|real-model|real-sdar)/u.test(test) ||
    !existsSync(resolve(root, test))
  )
    throw new Error(`FROZEN_CORE_TEST_PATH_REJECTED: ${test}`);
}
if (frozenTests.length === 0) throw new Error("FROZEN_CORE_TESTS_MISSING");
const command = [
  process.execPath,
  "--experimental-vm-modules",
  resolve(root, "node_modules/jest/bin/jest.js"),
  "--runInBand",
  "--runTestsByPath",
  ...tests,
];
const plan = {
  schemaVersion: "sacs-frozen-source-test-plan/1.0",
  mode,
  cwd: root,
  command,
  frozenTests,
  legacyTests,
  tests,
  boundary: "TYPESCRIPT_SOURCE_WITH_CONTROLLED_PORTS_AND_LOOPBACK_HTTP",
  environmental: { "ENV-001": "NOT_RUN" },
};
if (args.includes("--list")) {
  process.stdout.write(JSON.stringify(plan, null, 2) + "\n");
} else {
  // Jest otherwise loads the developer's .env via dotenv/config. This track must
  // not inherit real endpoints/credentials; every dependency is a controlled port.
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        !/^(?:SACS_|WSGS_|SDAR_|GOWM_|GSAP_|GDPS_|OPENAI_|MODEL_|DATABASE_URL$|TEST_DATABASE_URL$|PGHOST$|PGPORT$|PGUSER$|PGPASSWORD$|PGDATABASE$)/u.test(
          key,
        ) &&
        !/(?:^|_)(?:TOKEN|PASSWORD|SECRET|API_KEY|BASE_URL|ENDPOINT)(?:$|_)/u.test(
          key,
        ),
    ),
  );
  const status = await new Promise((resolveStatus, reject) => {
    const child = spawn(command[0], command.slice(1), {
      cwd: root,
      env: {
        ...environment,
        NODE_ENV: "test",
        DOTENV_CONFIG_PATH: process.platform === "win32" ? "NUL" : "/dev/null",
        DOTENV_CONFIG_QUIET: "true",
      },
      shell: false,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal !== null)
        reject(new Error(`FROZEN_CORE_TESTS_INTERRUPTED: ${signal}`));
      else resolveStatus(code ?? 1);
    });
  });
  process.exitCode = status;
}
