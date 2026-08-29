import { readFileSync } from "node:fs";

import { describe, expect, it } from "@jest/globals";
import { Ajv2020 } from "ajv/dist/2020.js";

import {
  findingReferenceSelectorSchema,
  MAP_SELECTION_MAX_GEOMETRY_BYTES,
} from "../packages/conversation-world-focus/src/index.js";

const sha256 = "sha256:" + "a".repeat(64);
const referenceKey = {
  namespace: "gowm",
  kind: "DERIVED_REFERENCE",
  id: "wrf_" + "1".repeat(32),
  version: "world-7",
};

describe("SACS v0.4 S20 multi-turn safety contracts", () => {
  it("requires explanation, finding, and paired feature identities instead of a bare ordinal", () => {
    expect(
      findingReferenceSelectorSchema.safeParse({
        findingOrdinal: 2,
        featureOrdinal: 2,
      }).success,
    ).toBe(false);
    expect(
      findingReferenceSelectorSchema.safeParse({
        principalId: "principal-1",
        threadId: "thread-1",
        explanationId: "explanation-1",
        explanationHash: sha256,
        findingId: "finding-1",
        findingOrdinal: 1,
        featureOrdinal: 2,
      }).success,
    ).toBe(false);
    expect(
      findingReferenceSelectorSchema.safeParse({
        principalId: "principal-1",
        threadId: "thread-1",
        explanationId: "explanation-1",
        explanationHash: sha256,
        findingId: "finding-1",
        findingOrdinal: 1,
        featureId: "feature-2",
        featureOrdinal: 2,
      }).success,
    ).toBe(true);
  });

  it("uses one repeatable-read snapshot for exact scoped explanation and focus projections", () => {
    const source = readFileSync(
      new URL(
        "../packages/persistence/src/world-explanation-repository.ts",
        import.meta.url,
      ),
      "utf8",
    );
    expect(source).toContain(
      'client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY")',
    );
    expect(source).toContain("AND explanation_id = $3");
    expect(source).toContain("AND explanation_hash = $4");
    expect(source).toContain("AND source_finding_id = $5");
    expect(source).toContain("AND source_finding_ordinal = $6");
  });

  it("requires MapSelection stable identity pairs in the local JSON contract", () => {
    const schema = JSON.parse(
      readFileSync(
        new URL(
          "../contracts/v0.4/grounding-context-assembly.schema.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ) as {
      properties: { mapSelections: { items: object } };
    };
    const validate = new Ajv2020({
      strict: false,
      validateFormats: false,
    }).compile(schema.properties.mapSelections.items);
    expect(
      validate({ selectionId: "selection-1", kind: "AREA", revision: 1 }),
    ).toBe(false);
    expect(
      validate({
        selectionId: "selection-1",
        kind: "AREA",
        revision: 1,
        geometry: { type: "Polygon" },
      }),
    ).toBe(false);
    expect(
      validate({
        selectionId: "selection-1",
        kind: "FEATURE",
        revision: 1,
        referenceKey,
      }),
    ).toBe(true);
    expect(
      validate({
        selectionId: "selection-1",
        kind: "AREA",
        revision: 1,
        geometry: { type: "Polygon" },
        geometryHash: sha256,
      }),
    ).toBe(true);
    expect(MAP_SELECTION_MAX_GEOMETRY_BYTES).toBe(1_048_576);
  });
});
