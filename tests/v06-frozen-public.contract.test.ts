import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "@jest/globals";
import {
  FrozenWorldAnalysisContract,
  verifyFrozenWorldAnalysis,
  publicCanonicalJson,
  publicCanonicalHash,
  publicFindingSetHash,
  publicResultHash,
} from "../packages/wsgs-geospatial-consumer/src/frozen-world-analysis.js";
import { createPublicValidator } from "../dependencies/wsgs-world-analysis-v1/public/validator.mjs";
const root = "dependencies/wsgs-world-analysis-v1/public";
const read = (file: string) =>
  JSON.parse(readFileSync(root + "/" + file, "utf8"));
const manifest = read("examples/manifest.json") as {
  examples: {
    path: string;
    schema: "request" | "result" | "job" | "capabilities";
    valid: boolean;
    expectedCode?: string;
  }[];
};
const contract = new FrozenWorldAnalysisContract();
const validate = createPublicValidator();
describe("Frozen WSGS SACS public import AC-002 AC-003", () => {
  it("AC-002 verifies exact release bytes and original public dependency closure", () => {
    expect(verifyFrozenWorldAnalysis()).toBeGreaterThan(100);
    const source = JSON.parse(
      readFileSync(
        "reports/v0.6/frozen-wsgs-consumer/SOURCE_IMPORT.json",
        "utf8",
      ),
    );
    expect(source.handoffCommit).toBe(
      "75d14147f72ff27d3e2e1f15194ff6e25ba6e9f5",
    );
    expect(Object.keys(source.publicFiles)).toHaveLength(117);
    expect(source.releaseLockHash).toBe(
      "sha256:45f027673834f3d9e654a889eea25eaf81522f594af8dddf6939b91a0dd4c41a",
    );
  });
  it.each(manifest.examples)(
    "AC-003 actual SACS loader $path expected=$valid",
    (example) => {
      const value = read(example.path);
      const result = validate(example.schema, value);
      expect(result.valid).toBe(example.valid);
      if (example.valid)
        expect(contract.parse(example.schema, value)).toEqual(value);
      else {
        expect(
          result.errors.some((error) => error.code === example.expectedCode),
        ).toBe(true);
        expect(() => contract.parse(example.schema, value)).toThrow(
          "WSGS_PUBLIC_CONTRACT_INVALID",
        );
      }
    },
  );
  it.each([
    "common.schema.json",
    "generated/schema-documents.mjs",
    "validator.mjs",
    "contract-release-lock.json",
  ])("AC-003 rejects frozen artifact drift: %s", (file) => {
    const dir = mkdtempSync(join(tmpdir(), "sacs-public-drift-"));
    try {
      cpSync(root, dir, { recursive: true });
      writeFileSync(join(dir, file), "{}");
      expect(() => verifyFrozenWorldAnalysis(dir)).toThrow(
        "WSGS_FROZEN_CONTRACT_DRIFT",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("AC-003 uses official UTF-16 hash vectors and distinct set/result preimages", () => {
    for (const vector of read("hash-vectors.json").vectors) {
      expect(publicCanonicalJson(vector.input)).toBe(vector.canonical);
      expect(publicCanonicalHash(vector.input)).toBe(vector.hash);
    }
    const result = contract.parse("result", read("examples/ranking.json"));
    expect(publicFindingSetHash(result.worldAnalysisFindings)).toBe(
      result.worldAnalysisFindings.findingSetHash,
    );
    expect(publicResultHash(result)).toBe(result.resultHash);
    expect(publicFindingSetHash(result.worldAnalysisFindings)).not.toBe(
      publicCanonicalHash(result.worldAnalysisFindings.findings),
    );
  });
  it("AC-003 keeps public validation free of WSGS runtime and Provider imports", () => {
    const code = readFileSync(root + "/validator.mjs", "utf8");
    expect(
      [...code.matchAll(/from "([^"]+)"/gu)].map((match) => match[1]),
    ).toEqual([
      "node:crypto",
      "ajv/dist/2020.js",
      "ajv-formats",
      "./generated/schema-documents.mjs",
    ]);
  });
  it("AC-003 rejects unsupported schema, malformed references and hash changes without shape fallback", () => {
    expect(validate("urn:unknown", {})).toMatchObject({
      valid: false,
      errors: [{ code: "UNKNOWN_SCHEMA" }],
    });
    const result = read("examples/ranking.json");
    result.worldAnalysisFindings.findings[0].evidenceIds = ["foreign"];
    expect(() => contract.parse("result", result)).toThrow(
      "WSGS_PUBLIC_CONTRACT_INVALID",
    );
  });
});
