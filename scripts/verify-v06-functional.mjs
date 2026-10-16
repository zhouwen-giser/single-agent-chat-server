import { spawnSync, execFileSync } from "node:child_process";
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
const mode = process.argv[2];
if (!["development", "integration", "release", "status"].includes(mode))
  throw Error("Choose development, integration, release or status");
const matrix = JSON.parse(
  await readFile(
    "config/v0.6/functional-closure/acceptance-matrix.json",
    "utf8",
  ),
);
const folder =
  process.env.SACS_FUNCTIONAL_GATE_OUTPUT ?? ".tmp/v06-functional-gate";
const environment = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) =>
      !/^(?:CHAT_|AG_UI_|OPENWEBUI_|SDAR_|WSGS_|SACS_|DATABASE_|POSTGRES_|CONVERSATION_|TEST_DATABASE_URL)/u.test(
        key,
      ),
  ),
);
Object.assign(environment, {
  NODE_ENV: "test",
  DOTENV_CONFIG_PATH: "/dev/null",
  DOTENV_CONFIG_QUIET: "true",
  SACS_BROWSER_EVIDENCE_DIR: folder + "/browser",
  SACS_PROCESS_EVIDENCE_DIR: folder + "/process",
});
const commands = [
  ["format", "corepack", ["pnpm", "format:check"]],
  ["lint", "corepack", ["pnpm", "lint"]],
  ["types", "corepack", ["pnpm", "typecheck"]],
  ["architecture", "corepack", ["pnpm", "verify:architecture"]],
  ["migrations", "corepack", ["pnpm", "verify:migrations"]],
  ["licenses", "corepack", ["pnpm", "verify:licenses"]],
  ["secrets", "corepack", ["pnpm", "verify:secrets"]],
  ["build", "corepack", ["pnpm", "build"]],
  ["frozen", "node", ["scripts/v06-frozen-tests.mjs", "all"]],
  ["browser", "corepack", ["pnpm", "test:v06:browser"]],
  ["browser-postgres", "corepack", ["pnpm", "test:v06:browser:postgres"]],
  ["process", "corepack", ["pnpm", "test:v06:process"]],
  ["checkpoint", "corepack", ["pnpm", "test:v06:checkpoint"]],
  [
    "postgres",
    "node",
    [
      "scripts/v05-postgres-test-harness.mjs",
      "tests/v06-source-persistence.postgres.int.test.ts",
      "tests/v06-grounding-lifecycle.postgres.int.test.ts",
      "tests/v06-analysis-local.e2e.test.ts",
      "tests/persistence.postgres.int.test.ts",
      "tests/analysis-development-persistence.postgres.int.test.ts",
    ],
  ],
  [
    "real-input-contract",
    "node",
    [
      "--experimental-vm-modules",
      "node_modules/jest/bin/jest.js",
      "--runInBand",
      "tests/v06-functional-real-cases.unit.test.ts",
    ],
  ],
];
async function source() {
  const files = [];
  const walk = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else files.push(path);
    }
  };
  for (const dir of [
    "apps",
    "packages",
    "src",
    "scripts",
    "tests",
    "migrations",
    "contracts",
    "dependencies",
  ])
    await walk(dir);
  files.push(
    "package.json",
    "pnpm-lock.yaml",
    "Dockerfile",
    "compose.yaml",
    ".eslintrc.cjs",
    ".env.example",
    ".github/workflows/ci.yml",
  );
  const hash = createHash("sha256");
  for (const path of files.sort()) {
    hash.update(path + "\0");
    hash.update(
      createHash("sha256")
        .update(await readFile(path))
        .digest("hex") + "\n",
    );
  }
  return "sha256:" + hash.digest("hex");
}
if (process.argv.includes("--list")) {
  process.stdout.write(
    JSON.stringify(
      { mode, commands: mode === "development" ? commands : [] },
      null,
      2,
    ) + "\n",
  );
  process.exit(0);
}
async function qualifiedEvidence(path, track, ids) {
  if (!path) return undefined;
  const bytes = await readFile(path);
  const value = JSON.parse(bytes.toString("utf8"));
  if (
    value.schemaVersion !== "sacs-functional-executed-evidence/1.0" ||
    value.track !== track ||
    value.status !== "PASS" ||
    value.sourceManifestSha256 !== (await source())
  )
    throw Error("QUALIFICATION_EVIDENCE_SOURCE_INVALID");
  if (
    !Array.isArray(value.cases) ||
    ids.some(
      (id) =>
        value.cases.filter(
          (c) =>
            c.id === id &&
            c.status === "PASS" &&
            Array.isArray(c.assertions) &&
            c.assertions.length > 0,
        ).length !== 1,
    )
  )
    throw Error("QUALIFICATION_CASE_EVIDENCE_MISSING");
  if (
    !Array.isArray(value.checks) ||
    value.checks.length === 0 ||
    value.checks.some(
      (c) =>
        c.exitCode !== 0 ||
        c.skipped === true ||
        !c.command ||
        !/^sha256:[a-f0-9]{64}$/u.test(c.outputSha256 ?? ""),
    )
  )
    throw Error("QUALIFICATION_EXECUTED_CHECKS_REQUIRED");
  return {
    sourceManifestSha256: value.sourceManifestSha256,
    evidenceSha256:
      "sha256:" + createHash("sha256").update(bytes).digest("hex"),
  };
}
const report = {
  schemaVersion: "sacs-functional-gate/1.0",
  mode,
  sourceSha: execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
  sourceManifestSha256: await source(),
  status: "INCOMPLETE",
  checks: [],
  requiredRows:
    mode === "development"
      ? matrix.decisionRules.developmentRequired
      : mode === "integration"
        ? matrix.decisionRules.realWsgsRequired
        : matrix.decisionRules.releaseRequired,
};
await mkdir(folder, { recursive: true });
let exitCode = 0;
if (mode === "development") {
  for (const [id, command, args] of commands) {
    const started = Date.now(),
      result = spawnSync(command, args, {
        env: environment,
        encoding: "utf8",
        maxBuffer: 32 * 1024 * 1024,
      });
    const bytes = (result.stdout ?? "") + (result.stderr ?? "");
    const log = folder + "/" + id + ".txt";
    await writeFile(log, bytes.replace(/\n+$/u, "") + "\n");
    report.checks.push({
      id,
      command: [command, ...args],
      exitCode: result.status ?? 1,
      elapsedMs: Date.now() - started,
      log,
      outputSha256:
        "sha256:" +
        createHash("sha256")
          .update(await readFile(log))
          .digest("hex"),
    });
    process.stdout.write(
      JSON.stringify({
        check: id,
        exitCode: result.status,
        elapsedMs: Date.now() - started,
      }) + "\n",
    );
    if (result.status !== 0) {
      report.status = "FAILED";
      exitCode = 1;
      break;
    }
    if ((await source()) !== report.sourceManifestSha256) {
      report.status = "SOURCE_CHANGED";
      exitCode = 1;
      break;
    }
  }
  if (!exitCode) report.status = "DEVELOPMENT_CHECKS_PASS";
} else {
  const required =
    mode === "status" ? matrix.cases.map((c) => c.id) : report.requiredRows;
  const missing = matrix.cases
    .filter((c) => required.includes(c.id) && c.status !== "PASS")
    .map((c) => ({ id: c.id, status: c.status }));
  report.pending = missing;
  if (mode === "integration") {
    const env = {
      ...environment,
      SACS_FUNCTIONAL_REAL_CASES: process.env.SACS_FUNCTIONAL_REAL_CASES ?? "",
      SACS_FUNCTIONAL_REAL_OUTPUT: folder + "/real-preflight",
    };
    const result = spawnSync(
      process.execPath,
      ["scripts/v06-functional-real-preflight.mjs"],
      { env, encoding: "utf8" },
    );
    report.checks.push({
      id: "real-input-preflight",
      exitCode: result.status ?? 1,
    });
    if (result.status !== 0 || missing.length) {
      report.status = "REAL_WSGS_PENDING";
      exitCode = result.status === 1 ? 1 : 2;
    } else {
      report.qualifiedEvidence = await qualifiedEvidence(
        process.env.SACS_FUNCTIONAL_REAL_EVIDENCE,
        "REAL_WSGS",
        matrix.decisionRules.realWsgsRequired,
      );
      report.status = report.qualifiedEvidence
        ? "REAL_WSGS_PASS"
        : "REAL_WSGS_EVIDENCE_REQUIRED";
      exitCode = report.qualifiedEvidence ? 0 : 2;
    }
  } else if (mode === "release") {
    const real = await qualifiedEvidence(
      process.env.SACS_FUNCTIONAL_REAL_EVIDENCE,
      "REAL_WSGS",
      matrix.decisionRules.realWsgsRequired,
    );
    const release = await qualifiedEvidence(
      process.env.SACS_FUNCTIONAL_RELEASE_EVIDENCE,
      "RELEASE",
      matrix.decisionRules.releaseRequired,
    );
    const allRequired = matrix.cases.filter(
      (c) => c.required && c.status !== "PASS",
    );
    report.qualifiedEvidence = { real, release };
    report.status =
      real && release && allRequired.length === 0
        ? "RELEASE_PASS"
        : "RELEASE_PENDING";
    exitCode = report.status === "RELEASE_PASS" ? 0 : 2;
    report.reasons =
      report.status === "RELEASE_PASS"
        ? []
        : [
            "Current real WSGS evidence and authorized real model/capacity qualification required",
            "Current candidate CI/container/SBOM qualification required",
          ];
  } else
    report.status = missing.length
      ? "PARTIAL"
      : "RECORDED_CLOSURE_REQUIRES_CURRENT_SOURCE_REVALIDATION";
}
await writeFile(
  folder + "/" + mode.toUpperCase() + ".json",
  JSON.stringify(report, null, 2) + "\n",
);
process.stdout.write(
  JSON.stringify({
    mode,
    status: report.status,
    pending: report.pending ?? [],
    sourceManifestSha256: report.sourceManifestSha256,
  }) + "\n",
);
process.exitCode = exitCode;
