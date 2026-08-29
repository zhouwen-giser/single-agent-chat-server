import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "@jest/globals";
import { Ajv2020 } from "ajv/dist/2020.js";

import {
  DEFAULT_WORLD_EXPLANATION_RENDERER_POLICY,
  explanationGapSchema,
  explanationReplayKeySchema,
  findingKinds,
  mapProjectionFeatureSchema,
  parseWorldFinding,
  rendererPolicySchema,
  sourceCurrentnessSchema,
  sourceProductSchema,
  worldExplanationV1Schema,
  worldFocusExplanationProjectionSchema,
} from "../packages/world-explanation-contract/src/index.js";
import { assembleWorldExplanation } from "../packages/world-explanation-runtime/src/index.js";
import {
  assemblyInput,
  pointMeasurement,
  sha,
  sixFindings,
  sourceProduct,
} from "./world-explanation-fixtures.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const schemaPaths = [
  "contracts/v0.4/geospatial/world-explanation.schema.json",
  "contracts/v0.4/geospatial/explanation-gap.schema.json",
  "contracts/v0.4/geospatial/map-projection.schema.json",
  "contracts/v0.4/geospatial/explanation-replay-key.schema.json",
  "contracts/v0.4/geospatial/world-focus-explanation-projection.schema.json",
  "contracts/v0.4/geospatial/source-currentness.schema.json",
  "contracts/v0.4/geospatial/finding-normalization-report.schema.json",
  "contracts/v0.4/geospatial/renderer-policy.schema.json",
  "contracts/v0.4/geospatial/provisional-wsgs-consumer/world-finding.schema.json",
  "contracts/v0.4/geospatial/provisional-wsgs-consumer/source-product.schema.json",
];

describe("S15 world explanation contracts", () => {
  it("compiles every SACS-owned and explicitly provisional consumer schema", () => {
    for (const path of schemaPaths) {
      const ajv = new Ajv2020({ strict: false, validateFormats: false });
      expect(() => ajv.compile(readJson(path))).not.toThrow();
    }
  });

  it("keeps all six WorldFinding branches strict and typed", () => {
    expect(
      sixFindings().map((finding) => parseWorldFinding(finding).findingKind),
    ).toEqual(findingKinds);
    expect(() =>
      parseWorldFinding({ ...pointMeasurement(), extraFact: true }),
    ).toThrow();
    expect(() =>
      parseWorldFinding({ ...pointMeasurement(), unit: undefined }),
    ).toThrow();
    expect(() =>
      parseWorldFinding({ ...pointMeasurement(), value: Number.NaN }),
    ).toThrow();
  });

  it("separates raw SourceProduct evidence closure from the sanitized explanation projection", () => {
    expect(sourceProductSchema.parse(sourceProduct()).evidenceItemIds).toEqual([
      "evidence-1",
    ]);
    expect(() =>
      sourceProductSchema.parse({
        ...sourceProduct(),
        productVersion: "historical",
      }),
    ).toThrow();
    const explanation = assembleWorldExplanation(assemblyInput());
    expect(explanation.sourceProducts[0]).not.toHaveProperty("evidenceItemIds");
    expect(explanation.sourceProducts[0]).not.toHaveProperty("assetUri");
  });

  it("requires exactly one map locator", () => {
    const base = {
      projectionId: "projection-1",
      findingId: "finding-1",
      semanticRole: "HIGH_GROUND",
    };
    expect(
      mapProjectionFeatureSchema.parse({
        ...base,
        payloadRef: "payload-1",
      }),
    ).toHaveProperty("payloadRef", "payload-1");
    expect(() => mapProjectionFeatureSchema.parse(base)).toThrow();
    expect(() =>
      mapProjectionFeatureSchema.parse({
        ...base,
        payloadRef: "payload-1",
        geometry: { type: "Point", coordinates: [1, 2] },
      }),
    ).toThrow();
  });

  it("locks replay, focus, currentness, gap, policy, and explanation shapes", () => {
    expect(
      explanationReplayKeySchema.parse({
        principalId: "principal-1",
        threadId: "thread-1",
        groundingResultHash: sha("1"),
        locale: "zh-CN",
        contractHash: sha("2"),
        rendererPolicyHash: sha("3"),
      }),
    ).toHaveProperty("threadId", "thread-1");
    expect(
      worldFocusExplanationProjectionSchema.parse({
        schemaVersion: "sacs-world-focus-explanation/1.0",
        explanationId: "explanation-1",
        explanationHash: sha("1"),
        groundingId: "grounding-1",
        groundingResultHash: sha("2"),
        findingLinks: [{ findingId: "finding-1", ordinal: 1 }],
      }),
    ).toHaveProperty("findingLinks");
    expect(
      sourceCurrentnessSchema.parse({
        schemaVersion: "sacs-source-currentness/1.0",
        productId: "product-1",
        previousContentHash: sha("4"),
        currentContentHash: sha("4"),
        status: "CURRENT",
        checkedAt: "2026-08-29T00:00:00Z",
        validationGroundingId: "grounding-1",
        validationResultHash: sha("5"),
      }),
    ).toHaveProperty("status", "CURRENT");
    expect(
      explanationGapSchema.parse({
        gapId: "gap-1",
        gapKind: "DATA_GAP",
        severity: "BLOCKING",
        messageCode: "PRODUCT_NOT_AVAILABLE",
      }),
    ).toHaveProperty("gapKind", "DATA_GAP");
    expect(
      rendererPolicySchema.parse(DEFAULT_WORLD_EXPLANATION_RENDERER_POLICY),
    ).toBeDefined();
    expect(
      worldExplanationV1Schema.parse(assembleWorldExplanation(assemblyInput())),
    ).toBeDefined();
  });

  it("validates runtime examples against the copied JSON schemas", () => {
    const ajv = new Ajv2020({ strict: false, validateFormats: false });
    const explanationValidator = ajv.compile(
      readJson("contracts/v0.4/geospatial/world-explanation.schema.json"),
    );
    const findingValidator = ajv.compile(
      readJson(
        "contracts/v0.4/geospatial/provisional-wsgs-consumer/world-finding.schema.json",
      ),
    );
    const sourceValidator = ajv.compile(
      readJson(
        "contracts/v0.4/geospatial/provisional-wsgs-consumer/source-product.schema.json",
      ),
    );
    expect(
      explanationValidator(assembleWorldExplanation(assemblyInput())),
    ).toBe(true);
    for (const finding of sixFindings()) {
      expect(findingValidator(finding)).toBe(true);
    }
    expect(sourceValidator(sourceProduct())).toBe(true);
  });
});

function readJson(path: string): object {
  return JSON.parse(readFileSync(root + path, "utf8")) as object;
}
