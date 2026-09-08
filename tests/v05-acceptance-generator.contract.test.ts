import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "@jest/globals";
import { Ajv2020, type AnySchema } from "ajv/dist/2020.js";

const root = process.cwd();
const acceptanceRoot = resolve(
  root,
  "acceptance/v0.5/observer-first-interactive-analysis",
);
const configRoot = resolve(
  root,
  "config/v0.5/observer-first-interactive-analysis",
);
const contractsRoot = resolve(
  root,
  "contracts/v0.5/observer-first-interactive-analysis",
);
const ledger = object(
  readJson(resolve(acceptanceRoot, "acceptance-ledger.json")),
);
const ledgerEntries = array(ledger.entries).map(object);

describe("v0.5 acceptance generator", () => {
  it("has no generated artifact drift", () => {
    const output = execFileSync(
      process.execPath,
      ["scripts/generate-v05-acceptance.mjs", "--check"],
      { cwd: root, encoding: "utf8" },
    );
    expect(output).toContain("SACS_V0_5_ACCEPTANCE_LEDGER_CHECK");
  });

  it("preserves all 31 canonical acceptance, config, and contract bytes", () => {
    const manifest = object(
      readJson(resolve(configRoot, "task-package-manifest.json")),
    );
    const files = array(manifest.files)
      .map(object)
      .filter(({ path }) =>
        /^(acceptance|config|contracts)\//u.test(string(path)),
      );
    expect(files).toHaveLength(31);
    for (const file of files) {
      const packagePath = string(file.path);
      const [group, ...segments] = packagePath.split("/");
      const base = {
        acceptance: acceptanceRoot,
        config: configRoot,
        contracts: contractsRoot,
      }[group];
      if (base === undefined) throw new Error(`Unexpected group: ${group}`);
      const bytes = readFileSync(resolve(base, ...segments));
      expect(bytes).toHaveLength(number(file.bytes));
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(
        string(file.sha256),
      );
    }
  });

  it("maps all 418 required rows once without bulk PASS", () => {
    expect(ledgerEntries).toHaveLength(418);
    expect(
      new Set(ledgerEntries.map(({ acceptanceId }) => acceptanceId)).size,
    ).toBe(418);
    expect(ledger.counts).toEqual({
      PASS: 0,
      FAIL: 0,
      NOT_RUN: 347,
      BLOCKED: 71,
      total: 418,
    });
    for (const entry of ledgerEntries) {
      expect(["NOT_RUN", "BLOCKED"]).toContain(string(entry.status));
      expect(string(entry.reasonCode).length).toBeGreaterThan(0);
      expect(array(entry.requiredEvidence).length).toBeGreaterThan(0);
      expect(array(entry.missingEvidenceTypes)).toEqual(
        array(entry.requiredEvidence),
      );
      expect(array(entry.evidence)).toHaveLength(0);
    }
  });

  it("preserves the exact A00 through A14 row counts", () => {
    expect(ledger.phases).toEqual({
      A00: { PASS: 0, FAIL: 0, NOT_RUN: 20, BLOCKED: 0, total: 20 },
      A01: { PASS: 0, FAIL: 0, NOT_RUN: 34, BLOCKED: 2, total: 36 },
      A02: { PASS: 0, FAIL: 0, NOT_RUN: 42, BLOCKED: 0, total: 42 },
      A03: { PASS: 0, FAIL: 0, NOT_RUN: 21, BLOCKED: 0, total: 21 },
      A04: { PASS: 0, FAIL: 0, NOT_RUN: 17, BLOCKED: 1, total: 18 },
      A05: { PASS: 0, FAIL: 0, NOT_RUN: 23, BLOCKED: 0, total: 23 },
      A06: { PASS: 0, FAIL: 0, NOT_RUN: 40, BLOCKED: 1, total: 41 },
      A07: { PASS: 0, FAIL: 0, NOT_RUN: 23, BLOCKED: 0, total: 23 },
      A08: { PASS: 0, FAIL: 0, NOT_RUN: 25, BLOCKED: 2, total: 27 },
      A09: { PASS: 0, FAIL: 0, NOT_RUN: 19, BLOCKED: 4, total: 23 },
      A10: { PASS: 0, FAIL: 0, NOT_RUN: 15, BLOCKED: 6, total: 21 },
      A11: { PASS: 0, FAIL: 0, NOT_RUN: 14, BLOCKED: 1, total: 15 },
      A12: { PASS: 0, FAIL: 0, NOT_RUN: 21, BLOCKED: 0, total: 21 },
      A13: { PASS: 0, FAIL: 0, NOT_RUN: 33, BLOCKED: 1, total: 34 },
      A14: { PASS: 0, FAIL: 0, NOT_RUN: 0, BLOCKED: 53, total: 53 },
    });
  });

  it("records package conflicts instead of aliasing or trusting the A14 template", () => {
    const report = object(
      readJson(resolve(acceptanceRoot, "package-contract-conflicts.json")),
    );
    const conflicts = array(report.conflicts).map(object);
    expect(report.status).toBe("BLOCKED");
    expect(report.canPromoteAcceptance).toBe(false);
    expect(conflicts.map(({ code }) => code)).toEqual([
      "MATRIX_EVIDENCE_TYPE_NOT_ALLOWLISTED",
      "A14_TEMPLATE_EVIDENCE_MISMATCH",
      "EVIDENCE_TEMPLATE_SCHEMA_MISMATCH",
    ]);
    const reportConflict = conflicts[0];
    expect(reportConflict.evidenceType).toBe("REPORT");
    expect(array(reportConflict.acceptanceIds)).toHaveLength(25);
    const e2e01 = ledgerEntries.find(
      ({ acceptanceId }) => acceptanceId === "AC-A14-E2E-01",
    );
    expect(e2e01).toBeDefined();
    expect(e2e01?.requiredEvidence).toEqual([
      "AGUI_OFFICIAL_CLIENT",
      "REAL_WSGS",
      "RUNNING_GOWM_GATEWAY",
      "REAL_GDPS_OR_STAS",
      "REAL_POSTGRES",
    ]);
    expect(e2e01?.status).toBe("BLOCKED");
    expect(e2e01?.reasonCode).toBe("PACKAGE_EVIDENCE_TEMPLATE_CONFLICT");
  });

  it("keeps all 28 live corpus cases one-to-one and fixture-ineligible", () => {
    const corpus = object(readJson(resolve(configRoot, "e2e-corpus.json")));
    const cases = array(corpus.cases).map(object);
    const e2eEntries = ledgerEntries.filter(({ acceptanceId }) =>
      string(acceptanceId).startsWith("AC-A14-E2E-"),
    );
    expect(corpus.fixtureCannotSatisfyLive).toBe(true);
    expect(cases).toHaveLength(28);
    expect(e2eEntries).toHaveLength(28);
    for (const [index, testCase] of cases.entries()) {
      const entry = e2eEntries[index];
      expect(entry.acceptanceId).toBe(
        `AC-A14-E2E-${String(index + 1).padStart(2, "0")}`,
      );
      expect(
        string(entry.scenario).startsWith(`${string(testCase.caseId)}:`),
      ).toBe(true);
      expect(entry.status).toBe("BLOCKED");
      expect(array(entry.evidence)).toHaveLength(0);
    }
  });

  it("emits a schema-valid evidence map and fails the clean-contract gate", () => {
    const schema = readJson(
      resolve(contractsRoot, "acceptance-evidence-map.schema.json"),
    );
    const evidenceMap = readJson(
      resolve(acceptanceRoot, "acceptance-evidence-map.json"),
    );
    const validate = new Ajv2020({ strict: false }).compile(
      schema as AnySchema,
    );
    expect(validate(evidenceMap)).toBe(true);
    expect(array(object(evidenceMap).entries)).toHaveLength(418);

    const result = spawnSync(
      process.execPath,
      [
        "scripts/generate-v05-acceptance.mjs",
        "--check",
        "--require-contract-clean",
      ],
      { cwd: root, encoding: "utf8" },
    );
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain(
      "Task-package contract conflicts remain",
    );
  });
});

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected object");
  }
  return value as Record<string, unknown>;
}

function array(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error("Expected array");
  return value;
}

function string(value: unknown): string {
  if (typeof value !== "string") throw new Error("Expected string");
  return value;
}

function number(value: unknown): number {
  if (typeof value !== "number") throw new Error("Expected number");
  return value;
}
