import { describe, expect, it } from "@jest/globals";
import {
  analysisSourceIdentitySchema,
  parseWritableAnalysisSource,
  sourceIsTerminal,
  sourceStatusMapping,
  verifySourceRequest,
} from "../packages/analysis-contract/src/source.js";
import { analysisRevisionSchema } from "../packages/analysis-contract/src/index.js";
const hash = "sha256:" + "a".repeat(64);
describe("v0.6 truthful analysis source contract", () => {
  it("separates Grounding identity from Native and legacy plan identity", () => {
    expect(
      parseWritableAnalysisSource({
        kind: "WSGS_GROUNDING_JOB",
        sourceId: "g1",
        sourceHash: hash,
      }),
    ).toEqual({ kind: "WSGS_GROUNDING_JOB", sourceId: "g1", sourceHash: hash });
    expect(() =>
      parseWritableAnalysisSource({
        kind: "WSGS_GROUNDING_JOB",
        sourceId: "g1",
        sourceHash: hash,
        sourceRevision: 1,
      }),
    ).toThrow("ANALYSIS_SOURCE_IDENTITY_INVALID");
    expect(
      analysisSourceIdentitySchema.parse({
        kind: "LEGACY_PLAN",
        sourceId: "p1",
        sourceHash: hash,
        readOnly: true,
      }).kind,
    ).toBe("LEGACY_PLAN");
    expect(() =>
      parseWritableAnalysisSource({
        kind: "LEGACY_PLAN",
        sourceId: "p1",
        sourceHash: hash,
        readOnly: true,
      }),
    ).toThrow("ANALYSIS_SOURCE_LEGACY_WRITE_FORBIDDEN");
  });
  it("rejects a fabricated plan on a Grounding revision and missing Native identity", () => {
    const r = {
      schemaVersion: "sacs-analysis-revision/1.0",
      revisionId: "r1",
      analysisId: "a1",
      revisionNumber: 0,
      cause: "INITIAL_QUERY",
      changedPaths: [],
      reusedNodeIds: [],
      invalidatedNodeIds: [],
      rerunNodeIds: [],
      status: "READY",
      createdAt: "2026-09-06T00:00:00Z",
    };
    expect(() => analysisRevisionSchema.parse(r)).toThrow();
    const source = {
      kind: "WSGS_GROUNDING_JOB",
      sourceId: "g1",
      sourceHash: hash,
    };
    expect(analysisRevisionSchema.parse({ ...r, source }).source).toEqual(
      source,
    );
    expect(() =>
      analysisRevisionSchema.parse({
        ...r,
        source,
        wsgsPlanId: "g1",
        planHash: hash,
      }),
    ).toThrow();
  });
  it("has an explicit deterministic mapping for every business status", () => {
    expect(Object.keys(sourceStatusMapping)).toHaveLength(8);
    expect(sourceStatusMapping.AMBIGUOUS).toEqual({
      run: "WAITING_INTERVENTION",
      session: "ACTIVE",
      view: "WAITING_SELECTION",
    });
    expect(sourceStatusMapping.UNRESOLVED.session).toBe("COMPLETED");
    expect(sourceIsTerminal("RUNNING")).toBe(false);
    expect(sourceIsTerminal("CANCELLED")).toBe(true);
  });
  it("does not trust a caller-supplied canonical request hash", () => {
    expect(() =>
      verifySourceRequest({
        canonicalGroundingRequest: { requestId: "r" },
        requestId: "r",
        requestHash: hash,
      } as Parameters<typeof verifySourceRequest>[0]),
    ).toThrow("ANALYSIS_SOURCE_REQUEST_HASH_MISMATCH");
  });
});
