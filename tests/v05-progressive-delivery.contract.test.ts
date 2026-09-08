import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "@jest/globals";
import { Ajv2020, type AnySchema } from "ajv/dist/2020.js";

const root = process.cwd();
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("SACS v0.5 progressive delivery contracts", () => {
  it("validates the isolated config, schema, and four-report budget", () => {
    const result = runJson("scripts/v05-progressive-validate.mjs");
    expect(result).toEqual({
      marker: "SACS_V05_PROGRESSIVE_GATES_READY",
      status: "PASS",
      acceptance: {
        total: 60,
        DEVELOPMENT: 38,
        INTEGRATION: 12,
        RELEASE: 10,
      },
      activeReports: 4,
      packageSchemas: 7,
      extensionSchemas: 1,
    });
  });

  it("keeps 38/12/10 unique active rows and supersedes the 418-row decision", () => {
    const matrix = object(
      readJson("config/v0.5/progressive-delivery/acceptance-matrix.json"),
    );
    const rows = array(matrix.rows).map(object);
    expect(rows).toHaveLength(60);
    expect(new Set(rows.map(({ id }) => string(id))).size).toBe(60);
    expect(count(rows, "DEVELOPMENT")).toBe(38);
    expect(count(rows, "INTEGRATION")).toBe(12);
    expect(count(rows, "RELEASE")).toBe(10);
    expect(object(matrix.supersedes)).toMatchObject({
      rowCount: 418,
      decision: "SUPERSEDED_STRICT_QUALIFICATION",
    });
  });

  it("validates all four active reports against the progressive schemas", () => {
    const pairs = [
      ["implementation-matrix", "CURRENT_IMPLEMENTATION_MATRIX"],
      ["gate-result", "DEVELOPMENT_VERIFICATION"],
      ["gate-result", "INTEGRATION_STATUS"],
      ["progressive-status", "PROGRESSIVE_STATUS"],
    ] as const;
    const ajv = new Ajv2020({ strict: false, validateFormats: false });
    for (const [schemaName, reportName] of pairs) {
      const schema = readJson(
        `contracts/v0.5/progressive-delivery/${schemaName}.schema.json`,
      );
      const report = readJson(`reports/v0.5/progressive/${reportName}.json`);
      expect(ajv.compile(schema as AnySchema)(report)).toBe(true);
    }
  });

  it("returns INTEGRATION_PENDING with exit 0 when the checkout is absent", () => {
    const result = spawnJson(
      "scripts/v05-progressive-integration-readiness.mjs",
      ["--wsgs-repo", join(makeTemporaryDirectory(), "missing")],
    );
    expect(result.status).toBe(0);
    expect(result.json).toMatchObject({
      track: "INTEGRATION",
      status: "PENDING",
    });
    expect(object(array(result.json.checks)[0]).decision).toBe(
      "INTEGRATION_PENDING",
    );
  });

  it("evaluates I00 without depending on DEVELOPMENT or RELEASE rows", () => {
    const isolatedRoot = makeIsolatedProgressiveRoot();
    const matrixPath = join(
      isolatedRoot,
      "config/v0.5/progressive-delivery/acceptance-matrix.json",
    );
    const matrix = object(JSON.parse(readFileSync(matrixPath, "utf8")));
    matrix.rows = array(matrix.rows).map((row, index) => {
      const candidate =
        row !== null && typeof row === "object" && !Array.isArray(row)
          ? object(row)
          : undefined;
      return candidate?.track === "INTEGRATION"
        ? candidate
        : index % 2 === 0
          ? null
          : "ignored-track-garbage";
    });
    writeFileSync(matrixPath, JSON.stringify(matrix));
    const fixture = makeWsgsRepository();
    const result = spawnJson(
      "scripts/v05-progressive-integration-readiness.mjs",
      [
        "--root",
        isolatedRoot,
        "--wsgs-repo",
        fixture.repository,
        "--handoff-dir",
        fixture.handoffRelativePath,
        "--expected-wsgs-sha",
        fixture.sourceSha,
        "--require-ready",
      ],
    );
    expect(result.status).toBe(0);
    expect(result.json.status).toBe("PASS");
  });

  it("does not let an arbitrary /tmp bundle self-attest readiness", () => {
    const handoff = makeTemporaryDirectory();
    writeAuthoritativeHandoff(handoff, "a".repeat(40));
    const result = spawnJson(
      "scripts/v05-progressive-integration-readiness.mjs",
      [
        "--wsgs-repo",
        handoff,
        "--handoff-dir",
        ".",
        "--expected-wsgs-sha",
        "a".repeat(40),
        "--require-ready",
      ],
    );
    expect(result.status).toBe(1);
    expect(result.json.status).toBe("PENDING");
    expect(check(result.json, "AUTHORITATIVE_WSGS_SOURCE")).toMatchObject({
      status: "PENDING",
      reason: "AUTHORITATIVE_WSGS_CHECKOUT_UNAVAILABLE",
    });
  });

  it("accepts only a semantic handoff tracked at an authoritative WSGS HEAD", () => {
    const fixture = makeWsgsRepository();
    const first = runIntegrationReadiness(fixture);
    expect(first.status).toBe(0);
    expect(first.json).toMatchObject({ track: "INTEGRATION", status: "PASS" });
    expect(object(array(first.json.checks)[0])).toMatchObject({
      readiness: "READY",
      decision: "INTEGRATION_PENDING",
      compatibilityLevel: "BACKWARD_COMPATIBLE",
      handoffDirectory: fixture.handoffRelativePath,
    });
    expect(check(first.json, "AUTHORITATIVE_WSGS_SOURCE")).toMatchObject({
      repository: "zhouwen-giser/world-semantic-grounding-service",
      headSha: fixture.headSha,
      expectedSourceSha: fixture.sourceSha,
    });
    expect(check(first.json, "AUTHORITATIVE_WSGS_BUNDLE").status).toBe("PASS");
    expect(check(first.json, "REAL_INTEGRATION_E2E").status).toBe("NOT_RUN");

    writeFileSync(
      join(
        fixture.repository,
        fixture.handoffRelativePath,
        "WSGS_ANALYSIS_PLAN_SCHEMA_LOCK.json",
      ),
      JSON.stringify({ type: "object" }),
    );
    const afterWorktreeMutation = runIntegrationReadiness(fixture);
    expect(afterWorktreeMutation.status).toBe(0);
    expect(afterWorktreeMutation.json.status).toBe("PASS");
  });

  it("rejects a Git checkout whose origin only resembles the WSGS repository", () => {
    const fixture = makeWsgsRepository();
    git(fixture.repository, [
      "remote",
      "set-url",
      "origin",
      "https://evilgithub.com/zhouwen-giser/world-semantic-grounding-service.git",
    ]);
    const result = runIntegrationReadiness(fixture);
    expect(result.status).toBe(1);
    expect(result.json.status).toBe("FAIL");
    expect(check(result.json, "AUTHORITATIVE_WSGS_SOURCE")).toMatchObject({
      status: "FAIL",
      reason: "AUTHORITATIVE_WSGS_REMOTE_MISMATCH",
    });
  });

  it("rejects tracked schemas that compile but carry no required semantics", () => {
    const fixture = makeWsgsRepository({ genericSchemas: true });
    const result = runIntegrationReadiness(fixture);
    expect(result.status).toBe(1);
    expect(result.json.status).toBe("FAIL");
    expect(check(result.json, "AUTHORITATIVE_WSGS_BUNDLE")).toMatchObject({
      status: "FAIL",
    });
    expect(
      string(check(result.json, "AUTHORITATIVE_WSGS_BUNDLE").reason),
    ).toContain("WSGS_ANALYSIS_SCHEMA_SEMANTICS_INCOMPATIBLE");
  });

  it("keeps release readiness pending even when ad hoc evidence claims PASS", () => {
    const directory = makeTemporaryDirectory();
    const evidence = join(directory, "release-evidence.json");
    writeFileSync(
      evidence,
      JSON.stringify({
        entries: Array.from({ length: 10 }, (_, index) => ({
          acceptanceId: `REL-${String(index + 1).padStart(3, "0")}`,
          status: "PASS",
          evidence: [`untrusted-proof-${index + 1}`],
        })),
      }),
    );
    const result = spawnJson("scripts/v05-progressive-release-readiness.mjs", [
      "--requested",
      "--evidence-file",
      evidence,
    ]);
    expect(result.status).toBe(0);
    expect(result.json).toMatchObject({ track: "RELEASE", status: "PENDING" });
    expect(object(array(result.json.checks)[0])).toMatchObject({
      decision: "RELEASE_HARDENING_PENDING",
      requested: true,
      qualificationRunnerAvailable: false,
      reason: "REAL_RELEASE_QUALIFICATION_RUNNER_UNAVAILABLE",
    });
  });

  it("fails closed when real integration or release runners are unavailable", () => {
    const integration = spawnJson(
      "scripts/v05-progressive-integration-verify.mjs",
    );
    expect(integration.status).toBe(1);
    expect(integration.json).toMatchObject({
      track: "INTEGRATION",
      status: "FAIL",
    });
    expect(check(integration.json, "HTTP_WSGS_ANALYSIS_ADAPTER").reason).toBe(
      "REAL_HTTP_WSGS_ANALYSIS_ADAPTER_UNAVAILABLE",
    );
    expect(check(integration.json, "REAL_INTEGRATION_E2E").reason).toBe(
      "REAL_SIX_CASE_INTEGRATION_RUNNER_UNAVAILABLE",
    );

    const release = spawnJson("scripts/v05-progressive-release-verify.mjs");
    expect(release.status).toBe(1);
    expect(release.json).toMatchObject({ track: "RELEASE", status: "FAIL" });
    expect(check(release.json, "REAL_RELEASE_QUALIFICATION").reason).toBe(
      "REAL_RELEASE_QUALIFICATION_RUNNER_UNAVAILABLE",
    );
  });

  it("maps package commands to independent and fail-closed track runners", () => {
    const packageJson = object(readJson("package.json"));
    const scripts = object(packageJson.scripts);
    expect(scripts["verify:v05"]).toBe("pnpm verify:v05:development");
    expect(string(scripts["verify:v05:development"])).not.toContain(
      "integration",
    );
    expect(scripts["verify:v05:integration"]).toBe(
      "node scripts/v05-progressive-integration-readiness.mjs --require-ready && node scripts/v05-progressive-integration-verify.mjs",
    );
    expect(scripts["verify:v05:release"]).toBe(
      "node scripts/v05-progressive-release-verify.mjs",
    );
    expect(scripts["dev:v05:analysis"]).toBe(
      "NODE_ENV=development SACS_ANALYSIS_ADAPTER_MODE=fixture tsx apps/server/src/v05-analysis-main.ts",
    );
  });

  it("does not promote integration or release track failures to hard failures", () => {
    const reportRoot = makeTemporaryDirectory();
    writeValidStatusInputs(reportRoot, { integrationStatus: "FAIL" });
    const result = spawnJson("scripts/v05-progressive-status.mjs", [
      "--report-root",
      reportRoot,
      "--release-failed",
    ]);
    expect(result.status).toBe(0);
    expect(result.json).toMatchObject({
      development: "FEATURE_COMPLETE",
      integration: "INTEGRATION_FAILED",
      release: "RELEASE_FAILED",
      hardFailures: [],
    });
  });

  it("rejects a self-declared DEVELOPMENT PASS and a stale source binding", () => {
    const reportRoot = makeTemporaryDirectory();
    writeFileSync(
      join(reportRoot, "DEVELOPMENT_VERIFICATION.json"),
      JSON.stringify({ status: "PASS" }),
    );
    writeIntegrationStatus(reportRoot, "PENDING");
    const malformed = spawnScript("scripts/v05-progressive-status.mjs", [
      "--report-root",
      reportRoot,
    ]);
    expect(malformed.status).toBe(1);
    expect(malformed.stderr).toContain("schema validation failed");

    const development = writeValidStatusInputs(reportRoot);
    object(development.source).headSha = "0".repeat(40);
    writeFileSync(
      join(reportRoot, "DEVELOPMENT_VERIFICATION.json"),
      JSON.stringify(development),
    );
    const stale = spawnScript("scripts/v05-progressive-status.mjs", [
      "--report-root",
      reportRoot,
    ]);
    expect(stale.status).toBe(1);
    expect(stale.stderr).toContain("DEVELOPMENT_EVIDENCE_SOURCE_MISMATCH");
  });

  it("requires all 38 DEVELOPMENT IDs and rejects bare release promotion", () => {
    const reportRoot = makeTemporaryDirectory();
    const development = writeValidStatusInputs(reportRoot);
    const firstCheck = object(array(development.checks)[0]);
    firstCheck.acceptanceIds = array(firstCheck.acceptanceIds).slice(1);
    writeFileSync(
      join(reportRoot, "DEVELOPMENT_VERIFICATION.json"),
      JSON.stringify(development),
    );
    const incomplete = spawnScript("scripts/v05-progressive-status.mjs", [
      "--report-root",
      reportRoot,
    ]);
    expect(incomplete.status).toBe(1);
    expect(incomplete.stderr).toContain("invalid acceptance IDs");

    writeValidStatusInputs(reportRoot);
    const selfPromoted = spawnScript("scripts/v05-progressive-status.mjs", [
      "--report-root",
      reportRoot,
      "--release-ready",
    ]);
    expect(selfPromoted.status).toBe(1);
    expect(selfPromoted.stderr).toContain(
      "RELEASE_READY_REQUIRES_SOURCE_BOUND_QUALIFICATION_REPORT",
    );
  });
});

interface WsgsRepositoryFixture {
  repository: string;
  handoffRelativePath: string;
  sourceSha: string;
  headSha: string;
}

function makeWsgsRepository(
  options: { genericSchemas?: boolean } = {},
): WsgsRepositoryFixture {
  const repository = makeTemporaryDirectory();
  git(repository, ["init", "--quiet"]);
  git(repository, ["config", "user.name", "SACS Contract Test"]);
  git(repository, ["config", "user.email", "sacs-contract@example.invalid"]);
  git(repository, [
    "remote",
    "add",
    "origin",
    "https://github.com/zhouwen-giser/world-semantic-grounding-service.git",
  ]);
  writeFileSync(join(repository, "README.md"), "authoritative WSGS fixture\n");
  git(repository, ["add", "README.md"]);
  git(repository, [
    "commit",
    "--quiet",
    "-m",
    "fixture: source implementation",
  ]);
  const sourceSha = git(repository, ["rev-parse", "HEAD"]);
  const handoffRelativePath = "contracts/consumers/sacs-analysis-control-v1";
  const handoff = join(repository, handoffRelativePath);
  mkdirSync(handoff, { recursive: true });
  writeAuthoritativeHandoff(handoff, sourceSha, options);
  git(repository, ["add", handoffRelativePath]);
  git(repository, [
    "commit",
    "--quiet",
    "-m",
    "contracts: publish SACS handoff",
  ]);
  return {
    repository,
    handoffRelativePath,
    sourceSha,
    headSha: git(repository, ["rev-parse", "HEAD"]),
  };
}

function runIntegrationReadiness(fixture: WsgsRepositoryFixture): {
  status: number | null;
  json: Record<string, unknown>;
} {
  return spawnJson("scripts/v05-progressive-integration-readiness.mjs", [
    "--wsgs-repo",
    fixture.repository,
    "--handoff-dir",
    fixture.handoffRelativePath,
    "--expected-wsgs-sha",
    fixture.sourceSha,
    "--require-ready",
  ]);
}

function runJson(script: string): Record<string, unknown> {
  return JSON.parse(
    execFileSync(process.execPath, [script], { cwd: root, encoding: "utf8" }),
  ) as Record<string, unknown>;
}

function spawnJson(
  script: string,
  arguments_: string[] = [],
  environment: NodeJS.ProcessEnv = {},
): { status: number | null; json: Record<string, unknown> } {
  const result = spawnScript(script, arguments_, environment);
  if (result.stdout.trim().length === 0) {
    throw new Error(`No JSON output: ${result.stderr}`);
  }
  return {
    status: result.status,
    json: JSON.parse(result.stdout) as Record<string, unknown>,
  };
}

function spawnScript(
  script: string,
  arguments_: string[] = [],
  environment: NodeJS.ProcessEnv = {},
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [script, ...arguments_], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, ...environment },
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function makeTemporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "sacs-v05-progressive-"));
  temporaryDirectories.push(directory);
  mkdirSync(directory, { recursive: true });
  return directory;
}

function makeIsolatedProgressiveRoot(): string {
  const directory = makeTemporaryDirectory();
  cpSync(
    resolve(root, "config/v0.5/progressive-delivery"),
    join(directory, "config/v0.5/progressive-delivery"),
    { recursive: true },
  );
  cpSync(
    resolve(root, "contracts/v0.5/progressive-delivery"),
    join(directory, "contracts/v0.5/progressive-delivery"),
    { recursive: true },
  );
  return directory;
}

function writeValidStatusInputs(
  reportRoot: string,
  options: { integrationStatus?: "FAIL" | "PENDING" } = {},
): Record<string, unknown> {
  const development = createValidDevelopmentReport(root);
  writeFileSync(
    join(reportRoot, "DEVELOPMENT_VERIFICATION.json"),
    JSON.stringify(development),
  );
  writeIntegrationStatus(reportRoot, options.integrationStatus ?? "PENDING");
  return development;
}

function createValidDevelopmentReport(sourceRoot: string) {
  const program = `
    import {
      createDevelopmentGateReport,
      DEVELOPMENT_VERIFICATION_COMMANDS,
      gitDevelopmentSource,
      hashCanonicalValue,
      loadDevelopmentAcceptance,
    } from "./scripts/v05-progressive-lib.mjs";
    const sourceRoot = process.argv[1];
    const source = await gitDevelopmentSource(sourceRoot);
    const startedAt = "2026-09-05T00:00:00.000Z";
    const finishedAt = "2026-09-05T00:00:01.000Z";
    const commands = DEVELOPMENT_VERIFICATION_COMMANDS.map((command) => ({
      id: command.id,
      executable: command.executable,
      arguments: [...command.arguments],
      exitCode: 0,
      status: "PASS",
      startedAt,
      finishedAt,
      sourceBefore: source,
      sourceAfter: source,
    }));
    const evidenceCore = {
      schemaVersion: "sacs-v05-development-run-evidence/1.0",
      runId: "development-contract-fixture",
      startedAt,
      finishedAt,
      source,
      commands,
    };
    const evidence = {
      ...evidenceCore,
      evidenceDigest: hashCanonicalValue(evidenceCore),
    };
    const { rows, evidenceGroups } = await loadDevelopmentAcceptance(sourceRoot);
    process.stdout.write(JSON.stringify(createDevelopmentGateReport({
      evidence,
      rows,
      evidenceGroups,
      currentSource: source,
    })));
  `;
  return JSON.parse(
    execFileSync(
      process.execPath,
      ["--input-type=module", "--eval", program, sourceRoot],
      { cwd: root, encoding: "utf8" },
    ),
  ) as Record<string, unknown>;
}

function writeIntegrationStatus(
  reportRoot: string,
  status: "FAIL" | "PENDING",
): void {
  writeFileSync(
    join(reportRoot, "INTEGRATION_STATUS.json"),
    JSON.stringify({
      schemaVersion: "sacs-v05-gate-result/1.0",
      gateId: "SACS_V05_INTEGRATION_READINESS",
      track: "INTEGRATION",
      status,
      checks: [
        {
          id: "HTTP_WSGS_ANALYSIS_ADAPTER",
          status: "NOT_RUN",
          acceptanceIds: ["INT-007"],
        },
        {
          id: "REAL_INTEGRATION_E2E",
          status: "NOT_RUN",
          acceptanceIds: [
            "INT-008",
            "INT-009",
            "INT-010",
            "INT-011",
            "INT-012",
          ],
        },
      ],
    }),
  );
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(resolve(root, path), "utf8")) as unknown;
}

function count(rows: Record<string, unknown>[], track: string): number {
  return rows.filter((row) => row.track === track).length;
}

function check(
  report: Record<string, unknown>,
  id: string,
): Record<string, unknown> {
  const result = array(report.checks)
    .map(object)
    .find((entry) => entry.id === id);
  if (result === undefined) throw new Error(`Missing check ${id}`);
  return result;
}

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected object");
  }
  return value as Record<string, unknown>;
}

function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("Expected array");
  return value;
}

function string(value: unknown): string {
  if (typeof value !== "string") throw new Error("Expected string");
  return value;
}

function writeAuthoritativeHandoff(
  directory: string,
  wsgsSha: string,
  options: { genericSchemas?: boolean } = {},
): void {
  const readiness = object(
    readJson("config/v0.5/progressive-delivery/integration-readiness.json"),
  );
  const schemaArtifacts = array(readiness.requiredArtifacts)
    .map(object)
    .filter(({ requiredSemanticProperties }) =>
      Array.isArray(requiredSemanticProperties),
    );
  const lockFieldByFile: Record<string, string> = {
    "WSGS_ANALYSIS_PLAN_SCHEMA_LOCK.json": "planSchemaHash",
    "WSGS_ANALYSIS_EVENT_SCHEMA_LOCK.json": "eventSchemaHash",
    "WSGS_TOOL_INTERACTION_SCHEMA_LOCK.json": "toolInteractionSchemaHash",
    "WSGS_REVISION_CONTROL_SCHEMA_LOCK.json": "revisionControlSchemaHash",
    "WSGS_CANCEL_SCHEMA_LOCK.json": "cancelSchemaHash",
    "WSGS_INTERVENTION_SCHEMA_LOCK.json": "interventionSchemaHash",
  };
  const lockHashes: Record<string, string> = {};
  const fileHashes: Record<string, string> = {};
  for (const artifact of schemaArtifacts) {
    const file = string(artifact.file);
    const capability = string(artifact.capability);
    const required = array(artifact.requiredSemanticProperties).map(string);
    const schema = options.genericSchemas
      ? {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          $id: `urn:wsgs:${capability.toLowerCase()}:1.0`,
          type: "object",
        }
      : {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          $id: `urn:wsgs:${capability.toLowerCase()}:1.0`,
          type: "object",
          additionalProperties: false,
          required,
          properties: Object.fromEntries(required.map((name) => [name, {}])),
        };
    const bytes = Buffer.from(JSON.stringify(schema), "utf8");
    writeFileSync(join(directory, file), bytes);
    const digest = digestBytes(bytes);
    lockHashes[lockFieldByFile[file]] = digest;
    fileHashes[file] = digest;
  }
  const lockFile = "WSGS_ANALYSIS_CONSUMER_LOCK.json";
  const lockBytes = Buffer.from(
    JSON.stringify({
      schemaVersion: "sacs-wsgs-analysis-consumer-lock/1.0",
      profile: "sacs-wsgs-analysis-presentation/1.0",
      provenance: "AUTHORITATIVE_WSGS_HANDOFF",
      wsgsSha,
      transportMode: "STREAMING_EVENTS",
      ...lockHashes,
      endpoints: {
        snapshot: "/v1/groundings/{groundingId}/analysis",
        events: "/v1/groundings/{groundingId}/analysis/events",
        compileRevision:
          "/v1/groundings/{groundingId}/analysis:compile-revision",
        cancel: "/v1/groundings/{groundingId}/analysis:cancel",
        resolveIntervention:
          "/v1/groundings/{groundingId}/analysis/interventions/{id}:resolve",
      },
      sequenceSemantics: "MONOTONIC_PER_UPSTREAM_ANALYSIS_ID",
      idempotencySemantics: "EVENT_ID_AND_SEQUENCE_PAYLOAD_HASH",
      recoverySemantics: "SNAPSHOT_THEN_LIVE_EVENTS",
      statusSemantics: "PUBLISHED_STATUS_ONLY",
      status: "READY",
    }),
    "utf8",
  );
  writeFileSync(join(directory, lockFile), lockBytes);
  fileHashes[lockFile] = digestBytes(lockBytes);
  const orderedNames = [
    lockFile,
    ...schemaArtifacts.map(({ file }) => string(file)),
  ];
  writeFileSync(
    join(directory, "CHECKSUMS.json"),
    JSON.stringify({
      schemaVersion: "wsgs-analysis-handoff-checksums/1.0",
      algorithm: "SHA-256",
      files: orderedNames.map((path) => ({ path, sha256: fileHashes[path] })),
      bundleHash: digestValue(fileHashes),
    }),
  );
}

function git(directory: string, arguments_: string[]): string {
  return execFileSync("git", ["-C", directory, ...arguments_], {
    encoding: "utf8",
  }).trim();
}

function digestBytes(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function digestValue(value: unknown): string {
  return digestBytes(Buffer.from(JSON.stringify(canonicalize(value)), "utf8"));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => [
        key,
        canonicalize((value as Record<string, unknown>)[key]),
      ]),
  );
}
