import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "@jest/globals";
import { Ajv2020 } from "ajv/dist/2020.js";

import {
  parseGroundingRequestPlan,
  parseHybridPlanRealityCompare,
  parseOperationalGroundingBundle,
  parseTurnPlan,
} from "../packages/world-grounding-contract/src/index.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const sha = `sha256:${"a".repeat(64)}`;
const worldFocusUsage = {
  knownWorldReferences: false,
  priorGrounding: false,
  mapSelections: false,
  externalCorrelationHints: false,
  externalPredicates: false,
};

describe("SACS v0.4 world-grounding authority contracts", () => {
  it("compiles every v0.4 JSON Schema", () => {
    const ajv = new Ajv2020({ strict: false, validateFormats: false });
    ajv.addSchema(readJson("contracts/v0.3/task-selector.schema.json"));
    ajv.addSchema(readJson("contracts/v0.4/turn-plan.schema.json"));
    expect(() =>
      ajv.compile(
        readJson("contracts/v0.4/grounding-request-plan.schema.json"),
      ),
    ).not.toThrow();
    expect(() =>
      ajv.compile(
        readJson("contracts/v0.4/operational-grounding-bundle.schema.json"),
      ),
    ).not.toThrow();
    expect(() =>
      ajv.compile(
        readJson("contracts/v0.4/hybrid-plan-reality-compare.schema.json"),
      ),
    ).not.toThrow();
  });

  it("accepts bounded model intent without WSGS implementation choices", () => {
    expect(
      parseTurnPlan({
        schemaVersion: "0.4",
        turnRoute: "WORLD_ANSWER",
        groundingRequirement: "ANSWER_WORLD_QUERY",
        answerMode: "GROUNDED",
        worldFocusUsage: { ...worldFocusUsage, mapSelections: true },
      }),
    ).toMatchObject({ turnRoute: "WORLD_ANSWER" });
  });

  it.each([
    "operation",
    "requestedProducts",
    "provider",
    "referenceKey",
    "productId",
  ])("rejects model authority escalation through %s", (forbiddenField) => {
    expect(() =>
      parseTurnPlan({
        schemaVersion: "0.4",
        turnRoute: "GENERAL_CHAT",
        groundingRequirement: "NONE",
        answerMode: "DIRECT",
        worldFocusUsage,
        [forbiddenField]: "forbidden",
      }),
    ).toThrow();
  });

  it("requires deterministic code to own WSGS operation and products", () => {
    expect(
      parseGroundingRequestPlan({
        schemaVersion: "1.0",
        plannedBy: "SACS_DETERMINISTIC_V1",
        operation: "EXECUTE_WORLD_QUERY",
        requestedProducts: ["WORLD_QUERY", "WORLD_EVIDENCE"],
        contextUsage: worldFocusUsage,
        executionPolicy: {
          readOnly: true,
          deadlineMs: 30_000,
          maxQueryOperations: 16,
          maxCandidatesPerMention: 5,
          maxResultBytes: 1_048_576,
          allowApproximation: false,
        },
      }),
    ).toMatchObject({ plannedBy: "SACS_DETERMINISTIC_V1" });
  });

  it.each([
    "identity",
    "actor",
    "dataScope",
    "datasetScope",
    "permissions",
    "chatHistory",
  ])(
    "rejects transport or overbroad context field %s from the request plan",
    (forbiddenField) => {
      expect(() =>
        parseGroundingRequestPlan({
          schemaVersion: "1.0",
          plannedBy: "SACS_DETERMINISTIC_V1",
          operation: "GROUND_REFERENCES",
          requestedProducts: ["RESOLVED_REFERENCES"],
          contextUsage: worldFocusUsage,
          executionPolicy: {
            readOnly: true,
            deadlineMs: 30_000,
            maxQueryOperations: 16,
            maxCandidatesPerMention: 5,
            maxResultBytes: 1_048_576,
            allowApproximation: false,
          },
          [forbiddenField]: {},
        }),
      ).toThrow();
    },
  );

  it("accepts only explicitly safe operational grounding bundles", () => {
    expect(
      parseOperationalGroundingBundle(validOperationalBundle()),
    ).toMatchObject({
      purpose: "SDAR_OPERATION",
      ambiguityPolicy: { autoAcceptSuggestedUnique: false },
    });
  });

  it("rejects stale, unvalidated, suggested-unique, and free-text operational inputs", () => {
    const stale = validOperationalBundle();
    const staleReference = stale.references.at(0);
    if (!staleReference) throw new Error("test fixture requires one reference");
    staleReference.validUntil = "2026-08-28T00:00:00.000Z";
    expect(() => parseOperationalGroundingBundle(stale)).toThrow();

    const unvalidated = validOperationalBundle() as Record<string, unknown>;
    const unvalidatedReference = (
      unvalidated.references as Array<Record<string, unknown>>
    ).at(0);
    if (!unvalidatedReference) {
      throw new Error("test fixture requires one reference");
    }
    unvalidatedReference["validationStatus"] = "UNVALIDATED";
    expect(() => parseOperationalGroundingBundle(unvalidated)).toThrow();

    expect(() =>
      parseOperationalGroundingBundle({
        ...validOperationalBundle(),
        ambiguityPolicy: {
          outcome: "SUGGESTED_UNIQUE",
          autoAcceptSuggestedUnique: true,
        },
      }),
    ).toThrow();
    expect(() =>
      parseOperationalGroundingBundle({
        ...validOperationalBundle(),
        rawTextFallback: "just send this to SDAR",
      }),
    ).toThrow();
  });

  it("keeps SDAR plan, WSGS/GOWM reality, and SACS composition authorities separate", () => {
    expect(
      parseHybridPlanRealityCompare({
        schemaVersion: "1.0",
        mode: "HYBRID_PLAN_REALITY_COMPARE",
        generatedAt: "2026-08-28T01:02:00.000Z",
        plan: {
          authority: "SDAR",
          taskId: "task-1",
          observedStatus: "WORKING",
          publishedSummary: "Published plan summary",
          observedAt: "2026-08-28T01:00:00.000Z",
        },
        reality: {
          authority: "WSGS_GOWM",
          groundingId: "grounding-1",
          resultHash: sha,
          sourceWorldVersion: 42,
          evidenceItemIds: ["evidence-1"],
          observedAt: "2026-08-28T01:01:00.000Z",
        },
        composition: {
          authority: "SACS",
          relationship: "COMPARE_ONLY",
          summary: "Observed state differs from the published plan.",
          differences: [
            { subject: "road", planned: "open", observed: "closed" },
          ],
        },
      }),
    ).toMatchObject({
      plan: { authority: "SDAR" },
      reality: { authority: "WSGS_GOWM" },
      composition: { authority: "SACS", relationship: "COMPARE_ONLY" },
    });
  });
});

function validOperationalBundle() {
  return {
    schemaVersion: "1.0" as const,
    purpose: "SDAR_OPERATION" as const,
    groundingId: "grounding-1",
    groundingResultHash: sha,
    references: [
      {
        productId: "product-1",
        referenceKey: {
          namespace: "gowm" as const,
          kind: "road_segment",
          id: `wrf_${"b".repeat(32)}`,
          version: "42",
        },
        sourceWorldVersion: 42,
        validUntil: "2026-08-28T02:00:00.000Z",
        revalidationRequired: false as const,
        validationStatus: "VALIDATED" as const,
        confirmationStatus: "EXPLICITLY_CONFIRMED" as const,
      },
    ],
    evidenceItemIds: ["evidence-1"],
    ambiguityPolicy: {
      outcome: "EXPLICITLY_CONFIRMED" as const,
      autoAcceptSuggestedUnique: false as const,
    },
    validation: {
      authority: "WSGS" as const,
      operation: "VALIDATE_REFERENCES" as const,
      validatedAt: "2026-08-28T01:00:00.000Z",
      validationResultHash: sha,
    },
    createdAt: "2026-08-28T01:01:00.000Z",
  };
}

function readJson(path: string): object {
  return JSON.parse(readFileSync(`${root}${path}`, "utf8")) as object;
}
