import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "@jest/globals";
import { Ajv2020 } from "ajv/dist/2020.js";

import {
  calculateStructuredWorldSelectionSourceHash,
  hashWorldExplanation,
  parseWorldExplanationV1,
  structuredWorldSelectionSchema,
  type StructuredWorldSelection,
  type WorldExplanationV1,
} from "../packages/world-explanation-contract/src/index.js";
import { assembleWorldExplanation } from "../packages/world-explanation-runtime/src/index.js";
import {
  assemblyInput,
  explanationReference,
  sha,
  sixFindings,
} from "./world-explanation-fixtures.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const selectedAt = "2026-08-30T00:00:00.000Z";
const expiresAt = "2026-08-30T00:04:00.000Z";

describe("C03 structured world selection contract", () => {
  it("accepts strict ReferenceKey and upstream-token identities", () => {
    const explanation = explanationWithLease();
    const referenceSelection = selectionFor(explanation, {
      selectionKind: "REFERENCE_SET_MEMBER",
      referenceKey: explanation.references[0]?.referenceKey,
    });
    const tokenSelection = selectionFor(explanation, {
      selectionId: "selection-token-1",
      selectionKind: "FINDING_FEATURE",
      findingId: "finding-features-1",
      featureId: "feature-high-1",
      upstreamSelectionToken: "opaque-upstream-token",
    });

    expect(structuredWorldSelectionSchema.parse(referenceSelection)).toEqual(
      referenceSelection,
    );
    expect(structuredWorldSelectionSchema.parse(tokenSelection)).toEqual(
      tokenSelection,
    );
  });

  it("rejects a bare ordinal, both identity forms, and missing finding identity", () => {
    const explanation = explanationWithLease();
    const valid = selectionFor(explanation, {
      selectionKind: "REFERENCE_SET_MEMBER",
      referenceKey: explanation.references[0]?.referenceKey,
    });

    expect(() =>
      structuredWorldSelectionSchema.parse({
        ...valid,
        referenceKey: undefined,
        findingOrdinal: 1,
      }),
    ).toThrow();
    expect(() =>
      structuredWorldSelectionSchema.parse({
        ...valid,
        upstreamSelectionToken: "also-present",
      }),
    ).toThrow();
    expect(() =>
      structuredWorldSelectionSchema.parse({
        ...valid,
        selectionKind: "MAP_FEATURE",
      }),
    ).toThrow();
  });

  it("binds the source hash to the explanation, finding, reference lease, and token", () => {
    const explanation = explanationWithLease();
    const referenceSelection = selectionFor(explanation, {
      selectionKind: "REFERENCE_SET_MEMBER",
      referenceKey: explanation.references[0]?.referenceKey,
    });
    const renewed = explanationWithLease("2026-08-30T00:10:00.000Z");
    const renewedSelection = selectionFor(renewed, {
      selectionKind: "REFERENCE_SET_MEMBER",
      referenceKey: renewed.references[0]?.referenceKey,
    });
    const tokenSelection = selectionFor(explanation, {
      selectionId: "selection-token-2",
      selectionKind: "FINDING_FEATURE",
      findingId: "finding-features-1",
      featureId: "feature-high-1",
      upstreamSelectionToken: "opaque-upstream-token",
    });

    expect(referenceSelection.sourceHash).not.toBe(renewedSelection.sourceHash);
    expect(tokenSelection.sourceHash).not.toBe(referenceSelection.sourceHash);
  });

  it("rejects expired source references and expiry before selection time", () => {
    const expired = explanationWithLease("2026-08-29T23:59:59.000Z");
    expect(() =>
      selectionFor(expired, {
        selectionKind: "REFERENCE_SET_MEMBER",
        referenceKey: expired.references[0]?.referenceKey,
      }),
    ).toThrow("STRUCTURED_SELECTION_REFERENCE_REVALIDATION_REQUIRED");

    const explanation = explanationWithLease();
    const valid = selectionFor(explanation, {
      selectionKind: "REFERENCE_SET_MEMBER",
      referenceKey: explanation.references[0]?.referenceKey,
    });
    expect(() =>
      structuredWorldSelectionSchema.parse({
        ...valid,
        expiresAt: selectedAt,
      }),
    ).toThrow();
  });

  it("keeps the copied JSON Schema aligned with the runtime shape", () => {
    const explanation = explanationWithLease();
    const value = selectionFor(explanation, {
      selectionKind: "REFERENCE_SET_MEMBER",
      referenceKey: explanation.references[0]?.referenceKey,
    });
    const ajv = new Ajv2020({ strict: false, validateFormats: false });
    const validate = ajv.compile(
      JSON.parse(
        readFileSync(
          root +
            "contracts/v0.4/geospatial/structured-world-selection.schema.json",
          "utf8",
        ),
      ) as object,
    );

    expect(validate(value)).toBe(true);
    expect(validate({ ...value, upstreamSelectionToken: "both" })).toBe(false);
  });
});

function explanationWithLease(
  validUntil = "2026-08-30T00:05:00.000Z",
): WorldExplanationV1 {
  const base = assembleWorldExplanation(assemblyInput(sixFindings()));
  const draft = {
    ...base,
    explanationHash: sha("0"),
    references: [
      {
        ...explanationReference(),
        sourceOperation: "VALIDATE_REFERENCES",
        validUntil,
        revalidationRequired: false,
      },
    ],
  };
  return parseWorldExplanationV1({
    ...draft,
    explanationHash: hashWorldExplanation(draft),
  });
}

function selectionFor(
  explanation: WorldExplanationV1,
  overrides: Partial<StructuredWorldSelection>,
): StructuredWorldSelection {
  const withoutHash = {
    schemaVersion: "sacs-structured-world-selection/1.0" as const,
    selectionId: "selection-1",
    principalId: "principal-1",
    threadId: "thread-1",
    groundingId: explanation.grounding.groundingId,
    explanationId: explanation.explanationId,
    selectionKind: "REFERENCE_SET_MEMBER" as const,
    selectionRevision: 1,
    selectedAt,
    expiresAt,
    ...overrides,
  };
  return structuredWorldSelectionSchema.parse({
    ...withoutHash,
    sourceHash: calculateStructuredWorldSelectionSourceHash({
      explanation,
      selection: withoutHash,
    }),
  });
}
