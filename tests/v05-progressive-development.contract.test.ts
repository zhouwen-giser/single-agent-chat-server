import { execFileSync, spawnSync } from "node:child_process";
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

const root = process.cwd();
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("SACS v0.5 DEVELOPMENT-only progressive contracts", () => {
  it("validates with only the two DEVELOPMENT-side reports present", () => {
    const reportRoot = makeDevelopmentReportRoot();
    const result = spawnJson(
      "scripts/v05-progressive-development-validate.mjs",
      ["--report-root", reportRoot],
    );

    expect(result.status).toBe(0);
    expect(result.json).toEqual({
      marker: "SACS_V05_DEVELOPMENT_CONTRACTS_READY",
      status: "PASS",
      acceptance: { DEVELOPMENT: 38 },
      activeDevelopmentReports: 2,
    });
  });

  it("ignores malformed INTEGRATION and RELEASE rows and profiles", () => {
    const isolatedRoot = makeIsolatedDevelopmentRoot();
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
      return candidate?.track === "DEVELOPMENT"
        ? candidate
        : index % 2 === 0
          ? null
          : "ignored-track-garbage";
    });
    writeFileSync(matrixPath, JSON.stringify(matrix));

    const profilesPath = join(
      isolatedRoot,
      "config/v0.5/progressive-delivery/delivery-profiles.json",
    );
    const profiles = object(JSON.parse(readFileSync(profilesPath, "utf8")));
    profiles.profiles = array(profiles.profiles).map((profile, index) => {
      const candidate =
        profile !== null &&
        typeof profile === "object" &&
        !Array.isArray(profile)
          ? object(profile)
          : undefined;
      return candidate?.profile === "DEVELOPMENT"
        ? candidate
        : index % 2 === 0
          ? null
          : "ignored-profile-garbage";
    });
    writeFileSync(profilesPath, JSON.stringify(profiles));

    const result = spawnJson(
      "scripts/v05-progressive-development-validate.mjs",
      ["--root", isolatedRoot],
    );
    expect(result.status).toBe(0);
    expect(result.json).toMatchObject({
      marker: "SACS_V05_DEVELOPMENT_CONTRACTS_READY",
      status: "PASS",
      acceptance: { DEVELOPMENT: 38 },
    });
  });

  it("requires source-bound run evidence and forbids standalone promotion", () => {
    const reportRoot = makeDevelopmentReportRoot();
    const environment = {
      SACS_WSGS_REPOSITORY_DIR: "/definitely/unavailable",
      SACS_WSGS_ANALYSIS_HANDOFF_DIR: "/definitely/unavailable",
      SACS_V05_RELEASE_REQUESTED: "true",
      SACS_V05_RELEASE_EVIDENCE_FILE: "/definitely/unavailable",
    };
    const checked = spawnJson(
      "scripts/v05-progressive-development-gate.mjs",
      ["--check", "--report-root", reportRoot],
      environment,
    );
    expect(checked.status).toBe(0);
    expect(checked.json).toMatchObject({
      track: "DEVELOPMENT",
      status: "NOT_RUN",
    });

    const forbidden = spawnScript(
      "scripts/v05-progressive-development-gate.mjs",
      ["--mark-pass", "--report-root", reportRoot],
      environment,
    );
    expect(forbidden.status).toBe(1);
    expect(forbidden.stderr).toContain(
      "DEVELOPMENT_STANDALONE_PROMOTION_FORBIDDEN",
    );

    const report = createValidDevelopmentReport(root);
    writeFileSync(
      join(reportRoot, "DEVELOPMENT_VERIFICATION.json"),
      JSON.stringify(report),
    );
    const verified = spawnJson(
      "scripts/v05-progressive-development-gate.mjs",
      ["--check", "--report-root", reportRoot, "--require-pass"],
      environment,
    );
    expect(verified.status).toBe(0);
    expect(verified.json).toMatchObject({
      track: "DEVELOPMENT",
      status: "PASS",
    });
    const acceptanceIds = array(verified.json.checks)
      .map(object)
      .flatMap(({ acceptanceIds }) => array(acceptanceIds).map(string));
    expect(acceptanceIds).toHaveLength(38);
    expect(new Set(acceptanceIds).size).toBe(38);

    object(report.source).headSha = "0".repeat(40);
    writeFileSync(
      join(reportRoot, "DEVELOPMENT_VERIFICATION.json"),
      JSON.stringify(report),
    );
    const tampered = spawnScript(
      "scripts/v05-progressive-development-gate.mjs",
      ["--check", "--report-root", reportRoot, "--require-pass"],
      environment,
    );
    expect(tampered.status).toBe(1);
    expect(tampered.stderr).toContain("DEVELOPMENT_EVIDENCE_SOURCE_MISMATCH");
  });

  it("rejects evidence after the tested worktree changes", () => {
    const isolatedRoot = makeIsolatedDevelopmentGitRoot();
    const reportRoot = join(isolatedRoot, "reports/v0.5/progressive");
    const report = createValidDevelopmentReport(isolatedRoot);
    writeFileSync(
      join(reportRoot, "DEVELOPMENT_VERIFICATION.json"),
      JSON.stringify(report),
    );

    const verified = spawnJson("scripts/v05-progressive-development-gate.mjs", [
      "--root",
      isolatedRoot,
      "--report-root",
      reportRoot,
      "--require-pass",
    ]);
    expect(verified.status).toBe(0);

    writeFileSync(join(isolatedRoot, "tested-source.txt"), "changed\n");
    const stale = spawnScript("scripts/v05-progressive-development-gate.mjs", [
      "--root",
      isolatedRoot,
      "--report-root",
      reportRoot,
      "--require-pass",
    ]);
    expect(stale.status).toBe(1);
    expect(stale.stderr).toContain("DEVELOPMENT_SOURCE_MISMATCH");
  });

  it("keeps the DEVELOPMENT orchestrator and focused suite track-local", () => {
    const verifier = source("scripts/verify-v05-development.mjs");
    const focused = source("scripts/v05-focused-tests.mjs");
    const gate = source("scripts/v05-progressive-development-gate.mjs");
    const library = source("scripts/v05-progressive-lib.mjs");

    for (const text of [verifier, focused, gate]) {
      expect(text).not.toContain("v05-progressive-integration-readiness");
      expect(text).not.toContain("v05-progressive-release-readiness");
      expect(text).not.toContain("v05-progressive-status.mjs");
    }
    expect(library).toContain("v05-progressive-development-validate.mjs");
    expect(verifier).not.toContain('"scripts/v05-progressive-validate.mjs"');
    expect(verifier).not.toContain("--mark-pass");
    expect(focused).toContain("v05-progressive-development.contract.test.ts");
    expect(focused).not.toContain("v05-progressive-delivery.contract.test.ts");
  });
});

function makeDevelopmentReportRoot(): string {
  const directory = mkdtempSync(join(tmpdir(), "sacs-v05-development-"));
  temporaryDirectories.push(directory);
  mkdirSync(directory, { recursive: true });
  cpSync(
    resolve(
      root,
      "reports/v0.5/progressive/CURRENT_IMPLEMENTATION_MATRIX.json",
    ),
    join(directory, "CURRENT_IMPLEMENTATION_MATRIX.json"),
  );
  writeFileSync(
    join(directory, "DEVELOPMENT_VERIFICATION.json"),
    JSON.stringify(notRunDevelopmentReport()),
  );
  return directory;
}

function makeIsolatedDevelopmentRoot(): string {
  const directory = mkdtempSync(join(tmpdir(), "sacs-v05-development-root-"));
  temporaryDirectories.push(directory);
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
  mkdirSync(join(directory, "reports/v0.5/progressive"), { recursive: true });
  cpSync(
    resolve(
      root,
      "reports/v0.5/progressive/CURRENT_IMPLEMENTATION_MATRIX.json",
    ),
    join(
      directory,
      "reports/v0.5/progressive/CURRENT_IMPLEMENTATION_MATRIX.json",
    ),
  );
  writeFileSync(
    join(directory, "reports/v0.5/progressive/DEVELOPMENT_VERIFICATION.json"),
    JSON.stringify(notRunDevelopmentReport()),
  );
  return directory;
}

function makeIsolatedDevelopmentGitRoot(): string {
  const directory = makeIsolatedDevelopmentRoot();
  writeFileSync(join(directory, "tested-source.txt"), "tested\n");
  git(directory, ["init", "--quiet"]);
  git(directory, ["config", "user.name", "SACS Contract Test"]);
  git(directory, ["config", "user.email", "sacs-contract@example.invalid"]);
  git(directory, ["add", "."]);
  git(directory, ["commit", "--quiet", "-m", "test: source-bound gate"]);
  return directory;
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

function notRunDevelopmentReport(): Record<string, unknown> {
  const matrix = object(
    JSON.parse(
      readFileSync(
        resolve(
          root,
          "config/v0.5/progressive-delivery/acceptance-matrix.json",
        ),
        "utf8",
      ),
    ),
  );
  const groups = new Set(
    array(matrix.rows)
      .map(object)
      .filter(({ track }) => track === "DEVELOPMENT")
      .map(({ evidenceGroup }) => string(evidenceGroup)),
  );
  return {
    schemaVersion: "sacs-v05-gate-result/1.0",
    gateId: "SACS_V05_DEVELOPMENT",
    track: "DEVELOPMENT",
    status: "NOT_RUN",
    checks: [...groups].map((id) => ({ id, status: "NOT_RUN" })),
  };
}

function spawnJson(
  script: string,
  arguments_: string[] = [],
  environment: NodeJS.ProcessEnv = {},
): { status: number | null; json: Record<string, unknown> } {
  const result = spawnSync(process.execPath, [script, ...arguments_], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, ...environment },
  });
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

function git(repository: string, arguments_: string[]): string {
  return execFileSync("git", arguments_, {
    cwd: repository,
    encoding: "utf8",
  }).trim();
}

function source(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
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
