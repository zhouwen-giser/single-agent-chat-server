import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "@jest/globals";

import {
  evaluateGeospatialCurrentness,
  geospatialCurrentnessDecisionSchema,
  geospatialCurrentnessEvaluationInputSchema,
  planGeospatialCurrentnessValidation,
} from "../packages/geospatial-explanation-policy/src/index.js";
import {
  calculateConsumerLockHash,
  defaultWsgsGeospatialConsumerLock,
  parseWsgsGeospatialConsumerLock,
  type WsgsGeospatialConsumerLock,
} from "../packages/wsgs-geospatial-consumer/src/index.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const previousHash = `sha256:${"a".repeat(64)}`;
const actualHash = `sha256:${"b".repeat(64)}`;
const resultHash = `sha256:${"c".repeat(64)}`;
const sourceProduct = {
  productId: "current-product-1",
  previousContentHash: previousHash,
};

describe("S22 WSGS-only geospatial currentness policy", () => {
  it("returns CURRENTNESS_UNAVAILABLE for the production BLOCKED lock", () => {
    expect(
      planGeospatialCurrentnessValidation({
        consumerLock: defaultWsgsGeospatialConsumerLock,
        sourceProduct,
        gapId: "gap-currentness",
      }),
    ).toMatchObject({
      status: "CURRENTNESS_UNAVAILABLE",
      gap: { gapKind: "CURRENTNESS_UNAVAILABLE" },
    });
    expect(
      evaluateGeospatialCurrentness({
        consumerLock: defaultWsgsGeospatialConsumerLock,
        sourceProduct,
        reuseMode: "STRICT_CURRENT",
        gapId: "gap-currentness",
        validation: dedicatedValidation(
          "some-unselected-operation",
          currentnessResult("CURRENT"),
        ),
      }),
    ).toMatchObject({
      validationStatus: "UNSUPPORTED",
      reuseDecision: "BLOCK_CURRENT_REUSE",
      canPresentAsCurrent: false,
      gap: { gapKind: "CURRENTNESS_UNAVAILABLE" },
    });
  });

  it("derives the exact WSGS operation or profile only from a READY lock", () => {
    const dedicated = readyLock({
      mode: "DEDICATED_OPERATION",
      operation: "VALIDATE_SOURCE_CURRENTNESS",
    });
    expect(
      planGeospatialCurrentnessValidation({
        consumerLock: dedicated,
        sourceProduct,
        gapId: "gap-1",
      }),
    ).toMatchObject({
      status: "REQUEST_READY",
      request: {
        authority: "WSGS",
        mode: "DEDICATED_OPERATION",
        operation: "VALIDATE_SOURCE_CURRENTNESS",
      },
    });

    const profiled = readyLock({
      mode: "EXECUTE_WORLD_QUERY_PROFILE",
      profile: "CURRENT_SOURCE_PRODUCT",
    });
    expect(
      planGeospatialCurrentnessValidation({
        consumerLock: profiled,
        sourceProduct,
        gapId: "gap-2",
      }),
    ).toMatchObject({
      status: "REQUEST_READY",
      request: {
        authority: "WSGS",
        mode: "EXECUTE_WORLD_QUERY_PROFILE",
        operation: "EXECUTE_WORLD_QUERY",
        profile: "CURRENT_SOURCE_PRODUCT",
      },
    });
    expect(
      evaluateGeospatialCurrentness({
        consumerLock: profiled,
        sourceProduct,
        reuseMode: "STRICT_CURRENT",
        gapId: "gap-profile",
        validation: {
          authority: "WSGS",
          mode: "EXECUTE_WORLD_QUERY_PROFILE",
          operation: "EXECUTE_WORLD_QUERY",
          profile: "CURRENT_SOURCE_PRODUCT",
          result: currentnessResult("CURRENT"),
        },
      }),
    ).toMatchObject({
      validationStatus: "CURRENT",
      reuseDecision: "REUSE_AS_CURRENT",
      canPresentAsCurrent: true,
    });
  });

  it("keeps an authoritative UNSUPPORTED mode unavailable", () => {
    const unsupported = readyLock({ mode: "UNSUPPORTED" });
    expect(
      planGeospatialCurrentnessValidation({
        consumerLock: unsupported,
        sourceProduct,
        gapId: "gap-unsupported",
      }),
    ).toMatchObject({
      status: "CURRENTNESS_UNAVAILABLE",
      gap: { gapKind: "CURRENTNESS_UNAVAILABLE" },
    });
    expect(
      evaluateGeospatialCurrentness({
        consumerLock: unsupported,
        sourceProduct,
        reuseMode: "STRICT_CURRENT",
        gapId: "gap-unsupported",
        validation: dedicatedValidation(
          "VALIDATE_SOURCE_CURRENTNESS",
          currentnessResult("CURRENT"),
        ),
      }),
    ).toMatchObject({
      validationStatus: "UNSUPPORTED",
      reuseDecision: "BLOCK_CURRENT_REUSE",
      canPresentAsCurrent: false,
      gap: { gapKind: "CURRENTNESS_UNAVAILABLE" },
    });
  });

  it("maps CURRENT to current reuse only with an exact selected route", () => {
    const lock = dedicatedLock();
    expect(
      evaluate(lock, "STRICT_CURRENT", currentnessResult("CURRENT")),
    ).toMatchObject({
      validationStatus: "CURRENT",
      reuseDecision: "REUSE_AS_CURRENT",
      presentation: "CURRENT_FACT",
      canPresentAsCurrent: true,
      absenceInferenceAllowed: false,
    });
    expect(
      evaluateGeospatialCurrentness({
        consumerLock: lock,
        sourceProduct,
        reuseMode: "STRICT_CURRENT",
        gapId: "gap-route",
        validation: dedicatedValidation(
          "DIFFERENT_OPERATION",
          currentnessResult("CURRENT"),
        ),
      }),
    ).toMatchObject({
      validationStatus: "UNKNOWN",
      reuseDecision: "BLOCK_CURRENT_REUSE",
      canPresentAsCurrent: false,
      gap: { gapKind: "EVIDENCE_INCOMPLETE" },
    });
  });

  it("blocks strict CHANGED reuse and requires a new grounding in BEST_EFFORT", () => {
    const lock = dedicatedLock();
    expect(
      evaluate(lock, "STRICT_CURRENT", currentnessResult("CHANGED")),
    ).toMatchObject({
      validationStatus: "CHANGED",
      reuseDecision: "BLOCK_CURRENT_REUSE",
      presentation: "HISTORICAL_RECORD_ONLY",
      canPresentAsCurrent: false,
      messageCode: "SOURCE_CHANGED_STRICT_REPLAY_BLOCKED",
      gap: { gapKind: "SOURCE_CHANGED" },
    });
    expect(
      evaluate(lock, "BEST_EFFORT", currentnessResult("CHANGED")),
    ).toMatchObject({
      validationStatus: "CHANGED",
      reuseDecision: "NEW_GROUNDING_REQUIRED",
      canPresentAsCurrent: false,
      messageCode: "SOURCE_ADVANCED",
      sourceAdvanced: {
        previousContentHash: previousHash,
        actualContentHash: actualHash,
      },
    });
  });

  it.each([
    [
      "NOT_AVAILABLE" as const,
      "DATA_GAP",
      "CURRENT_SOURCE_PRODUCT_NOT_AVAILABLE",
    ],
    ["UNKNOWN" as const, "CURRENTNESS_UNAVAILABLE", "CURRENTNESS_UNKNOWN"],
  ])("maps %s fail-closed", (status, gapKind, messageCode) => {
    expect(
      evaluate(dedicatedLock(), "STRICT_CURRENT", currentnessResult(status)),
    ).toMatchObject({
      validationStatus: status,
      reuseDecision: "BLOCK_CURRENT_REUSE",
      presentation: "UNAVAILABLE",
      canPresentAsCurrent: false,
      absenceInferenceAllowed: false,
      messageCode,
      gap: { gapKind },
    });
  });

  it("fails closed on source binding mismatch and rejects caller routing fields", () => {
    const mismatched = {
      ...currentnessResult("CURRENT"),
      productId: "different-product",
    };
    expect(
      evaluate(dedicatedLock(), "STRICT_CURRENT", mismatched),
    ).toMatchObject({
      validationStatus: "UNKNOWN",
      reuseDecision: "BLOCK_CURRENT_REUSE",
      gap: { gapKind: "EVIDENCE_INCOMPLETE" },
    });
    expect(() =>
      geospatialCurrentnessEvaluationInputSchema.parse({
        consumerLock: dedicatedLock(),
        sourceProduct,
        reuseMode: "STRICT_CURRENT",
        gapId: "gap-1",
        directEndpoint: "http://forbidden.invalid",
      }),
    ).toThrow();
    const current = evaluate(
      dedicatedLock(),
      "STRICT_CURRENT",
      currentnessResult("CURRENT"),
    );
    expect(() =>
      geospatialCurrentnessDecisionSchema.parse({
        ...current,
        canPresentAsCurrent: false,
      }),
    ).toThrow();
  });

  it("contains no direct product/world authority client or endpoint", () => {
    const source = readFileSync(
      `${root}packages/geospatial-explanation-policy/src/currentness-policy.ts`,
      "utf8",
    );
    expect(source).not.toMatch(
      /\bfetch\s*\(|axios|undici|baseUrl|endpoint|geo-product|\bgdps\b|\bgowm\b/iu,
    );
    expect(source).not.toContain("wsgs-http-adapter");
  });
});

function evaluate(
  lock: WsgsGeospatialConsumerLock,
  reuseMode: "STRICT_CURRENT" | "BEST_EFFORT",
  result: unknown,
) {
  return evaluateGeospatialCurrentness({
    consumerLock: lock,
    sourceProduct,
    reuseMode,
    gapId: "gap-currentness",
    validation: dedicatedValidation("VALIDATE_SOURCE_CURRENTNESS", result),
  });
}

function dedicatedValidation(operation: string, result: unknown) {
  return {
    authority: "WSGS",
    mode: "DEDICATED_OPERATION",
    operation,
    result,
  };
}

function currentnessResult(
  status: "CURRENT" | "CHANGED" | "NOT_AVAILABLE" | "UNKNOWN",
) {
  return {
    schemaVersion: "sacs-source-currentness/1.0",
    productId: sourceProduct.productId,
    previousContentHash: previousHash,
    ...(status === "CURRENT"
      ? { currentContentHash: previousHash }
      : status === "CHANGED"
        ? { currentContentHash: actualHash }
        : {}),
    status,
    checkedAt: "2026-08-29T08:00:00.000Z",
    validationGroundingId: "grounding-currentness",
    validationResultHash: resultHash,
  };
}

function dedicatedLock() {
  return readyLock({
    mode: "DEDICATED_OPERATION",
    operation: "VALIDATE_SOURCE_CURRENTNESS",
  });
}

function readyLock(
  currentness:
    | {
        mode: "DEDICATED_OPERATION";
        operation: string;
      }
    | {
        mode: "EXECUTE_WORLD_QUERY_PROFILE";
        profile: string;
      }
    | {
        mode: "UNSUPPORTED";
      },
) {
  const sha = `sha256:${"d".repeat(64)}`;
  const value = {
    schemaVersion: "sacs-wsgs-geospatial-consumer-lock/1.0",
    provenance: "AUTHORITATIVE_WSGS_HANDOFF",
    sources: {
      wsgsSha: "b".repeat(40),
      gowmSha: "c".repeat(40),
      gdpsSha: "d".repeat(40),
    },
    groundingContract: {
      contractVersion: "sacs-wsgs-grounding/1.0",
      resultSchemaHash: sha,
      capabilitiesSchemaHash: sha,
    },
    geospatialProfile: {
      profile: "sacs-wsgs-geospatial-findings/1.0",
      transportMode: "RESULT_EXTENSION",
      profileSchemaHash: sha,
      findingSchemaHash: sha,
      sourceProductSchemaHash: sha,
      gapSchemaHash: sha,
      requestedProducts: [],
    },
    currentness,
    status: "READY",
    consumerLockHash: sha,
  };
  value.consumerLockHash = calculateConsumerLockHash(value);
  return parseWsgsGeospatialConsumerLock(value);
}
