import { describe, expect, it, jest } from "@jest/globals";

import type { CompletedRequestResult } from "../packages/request-result/src/index.js";
import {
  calculateConsumerLockHash,
  type WsgsGeospatialConsumerLock,
} from "../packages/wsgs-geospatial-consumer/src/index.js";
import {
  hashCanonicalJson,
  type WorldExplanationV1,
} from "../packages/world-explanation-contract/src/index.js";
import {
  WorldGroundingRuntime,
  type WorldGroundingRuntimeOptions,
} from "../packages/world-grounding-runtime/src/index.js";
import type {
  WsgsGroundingRequest,
  WsgsGroundingResult,
  WsgsHttpClient,
} from "../packages/wsgs-http-adapter/src/index.js";

const unavailableSdarLock = {
  profile: "sacs-sdar-operational-grounding/1.0",
  status: "UNAVAILABLE",
  dataPartMediaType: null,
  schemaSha256: null,
  handlerEvidence: null,
  validatorEvidence: null,
  realE2eEvidence: null,
  requiredRuntimeError: "SDAR_GROUNDING_EXTENSION_UNAVAILABLE",
  fallback: {
    dropDataPart: false,
    convertToText: false,
    modifySdar: false,
  },
};

describe("WorldGroundingRuntime geospatial explanations", () => {
  it("persists once and exact-replays one typed explanation without reading safePayload", async () => {
    const lock = readyConsumerLock();
    let outerResult: CompletedRequestResult | undefined;
    let durableGroundingResult: WsgsGroundingResult | undefined;
    let storedExplanation: StoredFixture | undefined;
    const saveOrReplay = jest.fn(async (input: SaveFixture) => {
      storedExplanation ??= storedFixture(input);
      return {
        created: storedExplanation.explanation === input.explanation,
        explanation: storedExplanation,
      };
    });
    const findExact = jest.fn(async () => storedExplanation);
    const requests = {
      claimRequest: jest.fn(async () =>
        outerResult === undefined
          ? {
              outcome: "acquired" as const,
              requestId: "interaction-explanation-1",
            }
          : { outcome: "replay" as const, result: outerResult },
      ),
      completeRequest: jest.fn(
        async (input: { readonly result: CompletedRequestResult }) => {
          outerResult = input.result;
        },
      ),
      authorizedRequestCreatedAt: jest.fn(
        async () => "2026-08-29T00:00:00.000Z",
      ),
    } as unknown as WorldGroundingRuntimeOptions["requests"];
    const grounding = {
      claim: jest.fn(async () => ({
        kind: "CREATED" as const,
        execution: { state: "GROUNDING_PENDING" },
      })),
      recordGroundingReady: jest.fn(
        async (input: { readonly result: WsgsGroundingResult }) => {
          durableGroundingResult = input.result;
          return { state: "GROUNDING_READY" as const };
        },
      ),
      complete: jest.fn(async () => ({ state: "COMPLETED" as const })),
      fail: jest.fn(async () => ({ state: "FAILED" as const })),
      cancel: jest.fn(async () => ({ state: "CANCELLED" as const })),
      get: jest.fn(async () => ({ groundingResult: durableGroundingResult })),
    } as unknown as WorldGroundingRuntimeOptions["grounding"];
    const createGrounding = jest.fn(async (request: WsgsGroundingRequest) =>
      geospatialResult(request, lock),
    );
    const wsgs = {
      contractVersion: "sacs-wsgs-grounding/1.0",
      endpoint: "http://wsgs.test/",
      geospatialConsumerLock: lock,
      capabilities: jest.fn(async () => ({
        service: "world-semantic-grounding-service",
        version: "0.2.0",
        contractVersion: "sacs-wsgs-grounding/1.0",
        supportedOperations: [
          "GROUND_REFERENCES",
          "COMPILE_WORLD_QUERY",
          "EXECUTE_WORLD_QUERY",
          "VALIDATE_REFERENCES",
        ],
        supportedProducts: [],
        gowmContract: {
          softwareVersion: "0.6.4",
          commit: lock.sources.gowmSha,
        },
        requiredCapabilitiesReady: true,
        optionalCapabilities: [],
      })),
      createGrounding,
      getGrounding: jest.fn(),
      waitForGrounding: jest.fn(),
      cancelGrounding: jest.fn(),
    } as unknown as WsgsHttpClient;
    const runtime = new WorldGroundingRuntime({
      requests,
      grounding,
      worldExplanations: {
        findExact,
        saveOrReplay,
      } as unknown as WorldGroundingRuntimeOptions["worldExplanations"],
      wsgs,
      sdarCompatibilityLock: unavailableSdarLock,
      nextLeaseOwner: () => "lease-explanation-1",
    });
    const turn = {
      protocol: "openai" as const,
      principalId: "principal-1",
      threadId: "thread-1",
      externalRequestId: "message-explanation-1",
      userText: "2号车位置的坡度是多少？",
      turnPlan: {
        schemaVersion: "0.4" as const,
        turnRoute: "WORLD_ANSWER" as const,
        groundingRequirement: "ANSWER_WORLD_QUERY" as const,
        answerMode: "GROUNDED" as const,
        worldFocusUsage: {
          knownWorldReferences: false,
          priorGrounding: false,
          mapSelections: false,
          externalCorrelationHints: false,
          externalPredicates: false,
        },
      },
    };

    const first = await runtime.answerWorldExplanation(turn);
    const replay = await runtime.answerWorldExplanation(turn);

    expect(typeof first).toBe("object");
    expect(replay).toEqual(first);
    const explanation = first as WorldExplanationV1;
    expect(explanation.locale).toBe("zh-CN");
    expect(explanation.renderedText).toContain("12.6 degree");
    expect(explanation.renderedText).not.toContain("untrusted-fact");
    expect(explanation.sourceProducts[0]).not.toHaveProperty("evidenceItemIds");
    expect(explanation.grounding.resultHash).toBe(sha("9"));
    expect(createGrounding).toHaveBeenCalledTimes(1);
    expect(saveOrReplay).toHaveBeenCalledTimes(1);
    expect(findExact).toHaveBeenCalledTimes(2);
    expect(requests.completeRequest).toHaveBeenCalledTimes(1);
  });
});

function readyConsumerLock(): WsgsGeospatialConsumerLock {
  const candidate = {
    schemaVersion: "sacs-wsgs-geospatial-consumer-lock/1.0" as const,
    provenance: "AUTHORITATIVE_WSGS_HANDOFF" as const,
    sources: {
      wsgsSha: "1".repeat(40),
      gowmSha: "2".repeat(40),
      gdpsSha: "3".repeat(40),
    },
    groundingContract: {
      contractVersion: "sacs-wsgs-grounding/1.0",
      resultSchemaHash: sha("1"),
      capabilitiesSchemaHash: sha("2"),
    },
    geospatialProfile: {
      profile: "sacs-wsgs-geospatial-findings/1.0" as const,
      transportMode: "RESULT_EXTENSION" as const,
      profileSchemaHash: sha("3"),
      findingSchemaHash: sha("4"),
      sourceProductSchemaHash: sha("5"),
      gapSchemaHash: sha("6"),
      requestedProducts: [],
    },
    currentness: { mode: "UNSUPPORTED" as const },
    status: "READY" as const,
    consumerLockHash: sha("0"),
  };
  return {
    ...candidate,
    consumerLockHash: calculateConsumerLockHash(candidate),
  };
}

function geospatialResult(
  request: WsgsGroundingRequest,
  lock: WsgsGeospatialConsumerLock,
): WsgsGroundingResult {
  const findings = [
    {
      findingId: "finding-slope-1",
      findingKind: "POINT_MEASUREMENT" as const,
      semanticConcept: "SLOPE",
      querySemantics: "READ_VALUE",
      status: "COMPLETED" as const,
      subjectReferenceProductIds: ["reference-vehicle-2"],
      evidenceItemIds: ["evidence-slope-1"],
      sourceProductIds: ["source-slope-1"],
      point: {
        type: "Point" as const,
        coordinates: [113.934, 22.544] as [number, number],
      },
      value: 12.6,
      unit: "degree",
    },
  ];
  const sourceProducts = [
    {
      sourceProductId: "source-slope-1",
      authority: "GDPS_CURRENT_PRODUCT" as const,
      productId: "gdps-slope-current",
      productType: "SLOPE",
      productProfile: "DEGREE",
      contentHash: sha("7"),
      descriptorId: "SLOPE/DEGREE",
      descriptorHash: sha("8"),
      evidenceItemIds: ["evidence-slope-1"],
    },
  ];
  return {
    schemaVersion: "1.0",
    requestId: request.requestId,
    groundingId: "grounding-explanation-1",
    status: "COMPLETED",
    source: {
      messageId: request.source.messageId,
      originalTextSha256: request.source.originalTextSha256,
    },
    mentions: [],
    referenceProducts: [
      {
        productId: "reference-vehicle-2",
        productKind: "RESOLVED_REFERENCE",
        referenceKey: {
          namespace: "gowm",
          kind: "WORLD_OBJECT",
          id: "wrf_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          version: "7",
        },
        referenceType: "WORLD_OBJECT",
        displayName: "2号车",
        sourceOperation: "reference.resolve@1.0",
        sourceWorldVersion: 7,
      },
    ],
    evidenceItems: [
      {
        evidenceProductId: "evidence-slope-1",
        productKind: "WORLD_FACT",
        authority: "GOWM",
        sourceOperation: "geo-raster.sample@1.0",
        upstreamStatus: "COMPLETED",
        payloadSchemaUri: "urn:test:slope",
        payloadSchemaHash: sha("a"),
        safePayload: { untrusted: "untrusted-fact" },
        receiptIds: ["receipt-slope-1"],
        evidenceIds: [],
        unknowns: [],
        warnings: [],
      },
    ],
    geospatialFindings: {
      profile: "sacs-wsgs-geospatial-findings/1.0",
      profileSchemaHash: lock.geospatialProfile.profileSchemaHash,
      findings,
      sourceProducts,
      gaps: [],
      findingSetHash: hashCanonicalJson(findings),
      sourceProductSetHash: hashCanonicalJson(sourceProducts),
    },
    ambiguities: [],
    unresolvedMentions: [],
    capabilityGaps: [],
    warnings: [],
    execution: {
      parserVersion: "test",
      semanticModelReceiptIds: [],
      queryCompilerVersion: "test",
      normalizerVersion: "test",
      elapsedMs: 1,
    },
    resultHash: sha("9"),
  };
}

interface SaveFixture {
  readonly principalId: string;
  readonly threadId: string;
  readonly groundingResultHash: string;
  readonly locale: string;
  readonly contractHash: string;
  readonly rendererPolicyHash: string;
  readonly explanation: WorldExplanationV1;
}

interface StoredFixture extends Omit<SaveFixture, "explanation"> {
  readonly explanationId: string;
  readonly groundingId: string;
  readonly contractVersion: string;
  readonly explanationStatus: WorldExplanationV1["explanationStatus"];
  readonly explanationHash: string;
  readonly explanation: WorldExplanationV1;
  readonly createdAt: Date;
}

function storedFixture(input: SaveFixture): StoredFixture {
  return {
    ...input,
    explanationId: input.explanation.explanationId,
    groundingId: input.explanation.grounding.groundingId,
    contractVersion: input.explanation.schemaVersion,
    explanationStatus: input.explanation.explanationStatus,
    explanationHash: input.explanation.explanationHash,
    createdAt: new Date(input.explanation.createdAt),
  };
}

function sha(character: string): `sha256:${string}` {
  return `sha256:${character.repeat(64)}`;
}
