import { describe, expect, it, jest } from "@jest/globals";

import type { CompletedRequestResult } from "../packages/request-result/src/index.js";
import { planGroundingRequest } from "../packages/grounding-request-planner/src/index.js";
import type {
  WsgsGroundingRequest,
  WsgsGroundingResult,
  WsgsGroundingJob,
  WsgsHttpClient,
} from "../packages/wsgs-http-adapter/src/index.js";
import {
  assertSdarGroundingExtensionAvailable,
  buildHybridAuthorityFusion,
  buildOperationalGroundingBundle,
  renderSafeWorldAnswer,
  WorldGroundingRuntime,
  WorldGroundingRuntimeError,
  type WorldGroundingRuntimeOptions,
} from "../packages/world-grounding-runtime/src/index.js";
import type { TurnPlan } from "../packages/world-grounding-contract/src/index.js";
import type { WorldFocusRepository } from "../packages/conversation-world-focus/src/index.js";

const unavailableLock = {
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

describe("SACS v0.4 world grounding runtime", () => {
  it("runs one durable WSGS grounding and replays the stored safe answer", async () => {
    let storedResult: CompletedRequestResult | undefined;
    const claims: Array<{
      readonly externalRequestId: string;
      readonly requestHash: string;
    }> = [];
    const claimRequest = jest.fn(
      async (input: {
        readonly externalRequestId: string;
        readonly requestHash: string;
      }) => {
        claims.push(input);
        return storedResult === undefined
          ? { outcome: "acquired" as const, requestId: "interaction-1" }
          : { outcome: "replay" as const, result: storedResult };
      },
    );
    const completeRequest = jest.fn(
      async (input: { readonly result: CompletedRequestResult }) => {
        storedResult = input.result;
      },
    );
    const requests = {
      claimRequest,
      completeRequest,
      authorizedRequestCreatedAt: jest.fn(
        async () => "2026-08-28T01:00:00.000Z",
      ),
    } as unknown as WorldGroundingRuntimeOptions["requests"];
    const grounding = {
      claim: jest.fn(async () => ({
        kind: "CREATED",
        execution: { state: "GROUNDING_PENDING" },
      })),
      recordGroundingReady: jest.fn(async () => ({ state: "GROUNDING_READY" })),
      complete: jest.fn(async () => ({ state: "COMPLETED" })),
      fail: jest.fn(async () => ({ state: "FAILED" })),
      cancel: jest.fn(async () => ({ state: "CANCELLED" })),
    } as unknown as WorldGroundingRuntimeOptions["grounding"];
    const createGrounding = jest.fn(
      async (request: WsgsGroundingRequest): Promise<WsgsGroundingResult> =>
        validResult(request),
    );
    const wsgs = {
      contractVersion: "sacs-wsgs-grounding/1.0",
      endpoint: "http://wsgs.test/",
      capabilities: jest.fn(async () => ({
        service: "world-semantic-grounding-service",
        version: "0.1.0",
        contractVersion: "sacs-wsgs-grounding/1.0",
        supportedOperations: [
          "GROUND_REFERENCES",
          "COMPILE_WORLD_QUERY",
          "EXECUTE_WORLD_QUERY",
          "VALIDATE_REFERENCES",
        ],
        supportedProducts: [],
        gowmContract: {
          softwareVersion: "0.4.0",
          commit: "db575f79c874a69f65a2043a7e463338524b713d",
          sourcePackageArtifacts: 33,
        },
        requiredCapabilitiesReady: true,
        optionalCapabilities: [],
      })),
      createGrounding,
      getGrounding: jest.fn(),
      waitForGrounding: jest.fn(),
      cancelGrounding: jest.fn(),
    } as unknown as WsgsHttpClient;
    let focusRevision = 0;
    const currentFocus = () => ({
      schemaVersion: "1.0" as const,
      principalId: "principal-1",
      threadId: "thread-1",
      revision: focusRevision,
      references: [],
      updatedAt: "2026-08-28T01:00:00.000Z",
    });
    const worldFocus = {
      getFocus: jest.fn(async () => currentFocus()),
      listUsableReferences: jest.fn(async () => []),
      listReferencesRequiringValidation: jest.fn(async () => []),
      applyReferences: jest.fn(async () => {
        focusRevision += 1;
        return currentFocus();
      }),
    } as unknown as WorldFocusRepository;
    const runtime = new WorldGroundingRuntime({
      requests,
      grounding,
      worldFocus,
      wsgs,
      sdarCompatibilityLock: unavailableLock,
      nextLeaseOwner: () => "lease-owner-1",
      requestPlanner: (turnPlan) => {
        const plan = planGroundingRequest(turnPlan);
        return {
          ...plan,
          executionPolicy: {
            ...plan.executionPolicy,
            deadlineMs: 120_000,
          },
        };
      },
    });
    const turn = worldTurn();

    const first = await runtime.answerWorld(turn);
    const replay = await runtime.answerWorld(turn);

    expect(first).toContain("WSGS published a world-grounding result");
    expect(first).toContain("Reference: Road 7");
    expect(first).toContain("reported NO_DATA");
    expect(first).toContain("does not establish");
    expect(replay).toBe(first);
    expect(createGrounding).toHaveBeenCalledTimes(1);
    expect(createGrounding.mock.calls[0]?.[0].executionPolicy.deadlineMs).toBe(
      120_000,
    );
    expect(grounding.recordGroundingReady).toHaveBeenCalledTimes(1);
    expect(grounding.complete).toHaveBeenCalledTimes(1);
    expect(completeRequest).toHaveBeenCalledTimes(1);
    expect(claimRequest).toHaveBeenCalledTimes(2);
    expect(focusRevision).toBe(1);
    expect(claims[1]).toMatchObject(claims[0] ?? {});
  });

  it("maps a valid terminal FAILED job without a result to a safe failure", async () => {
    const requests = {
      claimRequest: jest.fn(async () => ({
        outcome: "acquired" as const,
        requestId: "interaction-failed-job",
      })),
      completeRequest: jest.fn(async () => undefined),
      authorizedRequestCreatedAt: jest.fn(
        async () => "2026-08-28T01:00:00.000Z",
      ),
    } as unknown as WorldGroundingRuntimeOptions["requests"];
    const fail = jest.fn(async () => ({ state: "FAILED" as const }));
    const grounding = {
      claim: jest.fn(async () => ({
        kind: "CREATED" as const,
        execution: { state: "GROUNDING_PENDING" },
      })),
      recordGroundingReady: jest.fn(),
      complete: jest.fn(),
      fail,
      cancel: jest.fn(),
    } as unknown as WorldGroundingRuntimeOptions["grounding"];
    let requestId = "wsgs-request-pending";
    const createGrounding = jest.fn(
      async (request: WsgsGroundingRequest): Promise<WsgsGroundingJob> => {
        requestId = request.requestId;
        return {
          schemaVersion: "1.0",
          jobId: "job-failed-1",
          groundingId: "grounding-failed-1",
          requestId,
          status: "ACCEPTED",
          createdAt: "2026-08-28T01:00:00.000Z",
          updatedAt: "2026-08-28T01:00:00.000Z",
        };
      },
    );
    const waitForGrounding = jest.fn(async (): Promise<WsgsGroundingJob> => ({
      schemaVersion: "1.0",
      jobId: "job-failed-1",
      groundingId: "grounding-failed-1",
      requestId,
      status: "FAILED",
      createdAt: "2026-08-28T01:00:00.000Z",
      updatedAt: "2026-08-28T01:00:30.000Z",
      startedAt: "2026-08-28T01:00:00.100Z",
      finishedAt: "2026-08-28T01:00:30.000Z",
      error: {
        code: "PIPELINE_DEADLINE_EXCEEDED",
        message: "The bounded pipeline deadline elapsed.",
        retryable: true,
        stage: "PERSISTENCE",
      },
    }));
    const wsgs = {
      contractVersion: "sacs-wsgs-grounding/1.0",
      endpoint: "http://wsgs.test/",
      capabilities: jest.fn(async () => readyCapabilities()),
      createGrounding,
      getGrounding: jest.fn(),
      waitForGrounding,
      cancelGrounding: jest.fn(),
    } as unknown as WsgsHttpClient;
    const runtime = new WorldGroundingRuntime({
      requests,
      grounding,
      wsgs,
      sdarCompatibilityLock: unavailableLock,
      nextLeaseOwner: () => "lease-owner-failed-job",
    });

    await expect(runtime.answerWorld(worldTurn())).resolves.toBe(
      "WORLD_GROUNDING_FAILED",
    );
    expect(createGrounding).toHaveBeenCalledTimes(1);
    expect(waitForGrounding).toHaveBeenCalledTimes(1);
    expect(fail).toHaveBeenCalledWith(
      expect.objectContaining({ failureCode: "WORLD_GROUNDING_FAILED" }),
    );
    expect(grounding.recordGroundingReady).not.toHaveBeenCalled();
  });

  it("recovers a persisted ambiguity after outer Message completion is interrupted", async () => {
    let groundingClaims = 0;
    let persistedResult: unknown;
    const requests = {
      claimRequest: jest.fn(async () => ({
        outcome: "acquired" as const,
        requestId: "interaction-recovery",
      })),
      completeRequest: jest
        .fn<() => Promise<void>>()
        .mockRejectedValueOnce(new Error("outer completion interrupted"))
        .mockResolvedValueOnce(),
      authorizedRequestCreatedAt: jest.fn(
        async () => "2026-08-28T01:00:00.000Z",
      ),
    } as unknown as WorldGroundingRuntimeOptions["requests"];
    const grounding = {
      claim: jest.fn(async () => {
        groundingClaims += 1;
        return groundingClaims === 1
          ? {
              kind: "CREATED" as const,
              execution: { state: "GROUNDING_PENDING" },
            }
          : {
              kind: "REPLAY" as const,
              execution: {
                state: "FAILED",
                groundingResult: persistedResult,
                failureCode: "WSGS_AMBIGUOUS",
              },
            };
      }),
      recordGroundingReady: jest.fn(
        async (input: { readonly result: unknown }) => {
          persistedResult = input.result;
          return { state: "GROUNDING_READY" };
        },
      ),
      complete: jest.fn(),
      fail: jest.fn(async () => ({ state: "FAILED" })),
      cancel: jest.fn(),
    } as unknown as WorldGroundingRuntimeOptions["grounding"];
    const createGrounding = jest.fn(
      async (request: WsgsGroundingRequest): Promise<WsgsGroundingResult> => ({
        ...validResult(request),
        status: "AMBIGUOUS",
        ambiguities: [
          {
            ambiguityId: "ambiguity-recovery",
            mentionId: "mention-recovery",
            surfaceText: "Road 7",
            candidateProductIds: ["product-1", "product-2"],
            reason: "MULTIPLE_PLAUSIBLE_MATCHES",
          },
        ],
      }),
    );
    const wsgs = {
      contractVersion: "sacs-wsgs-grounding/1.0",
      endpoint: "http://wsgs.test/",
      capabilities: jest.fn(async () => readyCapabilities()),
      createGrounding,
      getGrounding: jest.fn(),
      waitForGrounding: jest.fn(),
      cancelGrounding: jest.fn(),
    } as unknown as WsgsHttpClient;
    const runtime = new WorldGroundingRuntime({
      requests,
      grounding,
      wsgs,
      sdarCompatibilityLock: unavailableLock,
      nextLeaseOwner: () => "lease-owner-recovery",
    });

    await expect(runtime.answerWorld(worldTurn())).rejects.toThrow(
      "outer completion interrupted",
    );
    await expect(runtime.answerWorld(worldTurn())).resolves.toContain(
      "WORLD_GROUNDING_CLARIFICATION_REQUIRED",
    );

    expect(createGrounding).toHaveBeenCalledTimes(1);
    expect(grounding.recordGroundingReady).toHaveBeenCalledTimes(1);
    expect(grounding.fail).toHaveBeenCalledTimes(1);
    expect(requests.completeRequest).toHaveBeenCalledTimes(2);
  });

  it("does not auto-select ambiguous references or infer absence", () => {
    const result = validResult(baseRequest());
    const ambiguous: WsgsGroundingResult = {
      ...result,
      status: "AMBIGUOUS",
      ambiguities: [
        {
          ambiguityId: "ambiguity-1",
          mentionId: "mention-1",
          surfaceText: "Road *7* <script>",
          candidateProductIds: ["product-1", "product-2"],
          reason: "MULTIPLE_PLAUSIBLE_MATCHES",
        },
      ],
    };
    const answer = renderSafeWorldAnswer(ambiguous);
    expect(answer).toContain("WORLD_GROUNDING_CLARIFICATION_REQUIRED");
    expect(answer).toContain("No candidate was selected automatically");
    expect(answer).not.toContain("<script>");

    expect(
      renderSafeWorldAnswer({ ...result, status: "UNRESOLVED" }),
    ).toContain("No conclusion about absence was made");
  });

  it("builds only validated, live, explicitly confirmed operational bundles", () => {
    const result = validResult(baseRequest(), {
      sourceOperation: "VALIDATE_REFERENCES",
      validUntil: "2026-08-28T03:00:00.000Z",
      revalidationRequired: false,
    });
    const bundle = buildOperationalGroundingBundle({
      validationResult: result,
      selectedProductIds: ["product-1"],
      explicitlyConfirmedProductIds: [],
      validatedAt: "2026-08-28T01:00:00.000Z",
      createdAt: "2026-08-28T01:01:00.000Z",
    });
    expect(bundle).toMatchObject({
      purpose: "SDAR_OPERATION",
      references: [
        {
          productId: "product-1",
          validationStatus: "VALIDATED",
          confirmationStatus: "NOT_REQUIRED",
        },
      ],
      ambiguityPolicy: { autoAcceptSuggestedUnique: false },
    });

    const ambiguous = {
      ...result,
      ambiguities: [
        {
          ambiguityId: "ambiguity-1",
          mentionId: "mention-1",
          surfaceText: "Road 7",
          candidateProductIds: ["product-1", "product-2"],
          reason: "MULTIPLE_PLAUSIBLE_MATCHES" as const,
        },
      ],
    };
    expect(() =>
      buildOperationalGroundingBundle({
        validationResult: ambiguous,
        selectedProductIds: ["product-1"],
        explicitlyConfirmedProductIds: [],
        validatedAt: "2026-08-28T01:00:00.000Z",
        createdAt: "2026-08-28T01:01:00.000Z",
      }),
    ).toThrow(WorldGroundingRuntimeError);

    expect(() =>
      buildOperationalGroundingBundle({
        validationResult: {
          ...result,
          referenceProducts: result.referenceProducts.map((product) => ({
            ...product,
            validUntil: "2026-08-28T00:00:00.000Z",
          })),
        },
        selectedProductIds: ["product-1"],
        explicitlyConfirmedProductIds: [],
        validatedAt: "2026-08-28T01:00:00.000Z",
        createdAt: "2026-08-28T01:01:00.000Z",
      }),
    ).toThrow();
  });

  it("returns the exact fail-closed SDAR extension code with no text downgrade", async () => {
    expect(() =>
      assertSdarGroundingExtensionAvailable(unavailableLock),
    ).toThrow("SDAR_GROUNDING_EXTENSION_UNAVAILABLE");
    const runtime = new WorldGroundingRuntime({
      requests: {} as WorldGroundingRuntimeOptions["requests"],
      grounding: {} as WorldGroundingRuntimeOptions["grounding"],
      wsgs: {} as WsgsHttpClient,
      sdarCompatibilityLock: unavailableLock,
    });
    await expect(
      runtime.submitOperational({
        ...worldTurn(),
        turnPlan: operationalTurnPlan(),
      }),
    ).resolves.toBe("SDAR_GROUNDING_EXTENSION_UNAVAILABLE");
  });

  it("durably renders a compare-only authority fusion preview once", async () => {
    const fixture = hybridRuntime((request) => ({
      ...validResult(request),
      evidenceItems: validResult(request).evidenceItems.map((item) => ({
        ...item,
        upstreamStatus: "COMPLETED" as const,
      })),
    }));
    const turn = hybridTurn();

    const first = await fixture.runtime.compareHybrid(turn);
    const replay = await fixture.runtime.compareHybrid(turn);

    expect(first).toContain("AUTHORITY_FUSION_PREVIEW_READY");
    expect(first).toContain("Plan authority: SDAR");
    expect(first).toContain("Published plan: Inspect Road 7 before dispatch");
    expect(first).toContain("Reality authority: WSGS_GOWM");
    expect(first).toContain("World version: 42");
    expect(first).toContain("SACS COMPARE_ONLY");
    expect(first).toContain("does not infer equivalence");
    expect(replay).toBe(first);
    expect(fixture.createGrounding).toHaveBeenCalledTimes(1);
    expect(fixture.completeRequest).toHaveBeenCalledTimes(1);
  });

  it("never marks incomplete or authority-ambiguous evidence as preview-ready", async () => {
    const result = validResult(baseRequest());
    const inputs: readonly WsgsGroundingResult[] = [
      result,
      { ...result, status: "UNRESOLVED" },
      {
        ...result,
        ambiguities: [
          {
            ambiguityId: "ambiguity-hybrid",
            mentionId: "mention-hybrid",
            surfaceText: "Road 7",
            candidateProductIds: ["product-1", "product-2"],
            reason: "MULTIPLE_PLAUSIBLE_MATCHES",
          },
        ],
      },
      {
        ...result,
        evidenceItems: result.evidenceItems.map((item) => ({
          ...item,
          upstreamStatus: "COMPLETED" as const,
        })),
        referenceProducts: [
          ...result.referenceProducts,
          ...result.referenceProducts.map((product) => ({
            ...product,
            productId: "product-2",
            sourceWorldVersion: 43,
          })),
        ],
      },
    ];

    for (const candidate of inputs) {
      expect(() =>
        buildHybridAuthorityFusion({
          result: candidate,
          sdarPlan: hybridTurn().sdarPlan,
          observedAt: "2026-08-28T01:00:00.000Z",
        }),
      ).toThrow("AUTHORITY_FUSION_PREVIEW_UNAVAILABLE");
    }
  });
});

function worldTurn() {
  return {
    protocol: "openai" as const,
    principalId: "principal-1",
    threadId: "thread-1",
    externalRequestId: "message-1",
    userText: "What is known about Road 7?",
    turnPlan: worldTurnPlan(),
  };
}

function worldTurnPlan(): TurnPlan {
  return {
    schemaVersion: "0.4",
    turnRoute: "WORLD_ANSWER",
    groundingRequirement: "ANSWER_WORLD_QUERY",
    answerMode: "GROUNDED",
    worldFocusUsage: emptyWorldFocus(),
  };
}

function operationalTurnPlan(): TurnPlan {
  return {
    schemaVersion: "0.4",
    turnRoute: "SDAR_TASK",
    groundingRequirement: "RESOLVE_REFERENCES",
    answerMode: "GROUNDED",
    taskDirective: { action: "CREATE" },
    worldFocusUsage: emptyWorldFocus(),
  };
}

function hybridTurn() {
  return {
    ...worldTurn(),
    turnPlan: {
      schemaVersion: "0.4" as const,
      turnRoute: "HYBRID_PLAN_REALITY_COMPARE" as const,
      groundingRequirement: "COMPARE_PLAN_REALITY" as const,
      answerMode: "HYBRID_COMPARISON" as const,
      taskDirective: {
        action: "STATUS" as const,
        selector: { taskId: "task-plan-1" },
      },
      worldFocusUsage: emptyWorldFocus(),
    },
    sdarPlan: {
      taskId: "task-plan-1",
      observedStatus: "INPUT_REQUIRED" as const,
      internalPhase: "awaiting_plan_confirmation" as const,
      publishedSummary: "Inspect Road 7 before dispatch.",
    },
  };
}

function hybridRuntime(
  resultForRequest: (request: WsgsGroundingRequest) => WsgsGroundingResult,
) {
  let storedResult: CompletedRequestResult | undefined;
  const completeRequest = jest.fn(
    async (input: { readonly result: CompletedRequestResult }) => {
      storedResult = input.result;
    },
  );
  const requests = {
    claimRequest: jest.fn(async () =>
      storedResult === undefined
        ? { outcome: "acquired" as const, requestId: "hybrid-interaction-1" }
        : { outcome: "replay" as const, result: storedResult },
    ),
    completeRequest,
    authorizedRequestCreatedAt: jest.fn(async () => "2026-08-28T01:00:00.000Z"),
  } as unknown as WorldGroundingRuntimeOptions["requests"];
  const grounding = {
    claim: jest.fn(async () => ({
      kind: "CREATED" as const,
      execution: { state: "GROUNDING_PENDING" },
    })),
    recordGroundingReady: jest.fn(async () => ({ state: "GROUNDING_READY" })),
    complete: jest.fn(async () => ({ state: "COMPLETED" })),
    fail: jest.fn(async () => ({ state: "FAILED" })),
    cancel: jest.fn(async () => ({ state: "CANCELLED" })),
  } as unknown as WorldGroundingRuntimeOptions["grounding"];
  const createGrounding = jest.fn(resultForRequest);
  const wsgs = {
    contractVersion: "sacs-wsgs-grounding/1.0",
    endpoint: "http://wsgs.test/",
    capabilities: jest.fn(async () => readyCapabilities()),
    createGrounding,
    getGrounding: jest.fn(),
    waitForGrounding: jest.fn(),
    cancelGrounding: jest.fn(),
  } as unknown as WsgsHttpClient;
  return {
    runtime: new WorldGroundingRuntime({
      requests,
      grounding,
      wsgs,
      sdarCompatibilityLock: unavailableLock,
      nextLeaseOwner: () => "hybrid-lease-owner",
    }),
    completeRequest,
    createGrounding,
  };
}

function emptyWorldFocus() {
  return {
    knownWorldReferences: false,
    priorGrounding: false,
    mapSelections: false,
    externalCorrelationHints: false,
    externalPredicates: false,
  };
}

function readyCapabilities() {
  return {
    service: "world-semantic-grounding-service" as const,
    version: "0.1.0",
    contractVersion: "sacs-wsgs-grounding/1.0" as const,
    supportedOperations: [
      "GROUND_REFERENCES",
      "COMPILE_WORLD_QUERY",
      "EXECUTE_WORLD_QUERY",
      "VALIDATE_REFERENCES",
    ] as const,
    supportedProducts: [],
    gowmContract: {
      softwareVersion: "0.4.0",
      commit: "db575f79c874a69f65a2043a7e463338524b713d",
      sourcePackageArtifacts: 33,
    },
    requiredCapabilitiesReady: true,
    optionalCapabilities: [],
  };
}

function baseRequest(): WsgsGroundingRequest {
  return {
    schemaVersion: "1.0",
    requestId: "wsgs-request-1",
    operation: "EXECUTE_WORLD_QUERY",
    source: {
      conversationRef: "thread-1",
      messageId: "message-1",
      originalText: "What is known about Road 7?",
      originalTextSha256: `sha256:${"a".repeat(64)}`,
      locale: "und",
      createdAt: "2026-08-28T01:00:00.000Z",
    },
    requestedProducts: ["WORLD_EVIDENCE"],
    contextCapsule: {
      knownWorldReferences: [],
      priorGroundings: [],
      mapSelections: [],
      externalCorrelationHints: [],
      externalPredicates: [],
    },
    executionPolicy: {
      readOnly: true,
      deadlineMs: 30_000,
      maxQueryOperations: 16,
      maxCandidatesPerMention: 5,
      maxResultBytes: 1_048_576,
      allowApproximation: false,
    },
  };
}

function validResult(
  request: WsgsGroundingRequest,
  referenceOverrides: Partial<
    WsgsGroundingResult["referenceProducts"][number]
  > = {},
): WsgsGroundingResult {
  return {
    schemaVersion: "1.0",
    requestId: request.requestId,
    groundingId: "grounding-result-1",
    status: "COMPLETED",
    source: {
      messageId: request.source.messageId,
      originalTextSha256: request.source.originalTextSha256,
    },
    mentions: [],
    referenceProducts: [
      {
        productId: "product-1",
        productKind: "RESOLVED_REFERENCE",
        referenceKey: {
          namespace: "gowm",
          kind: "road_segment",
          id: `wrf_${"b".repeat(32)}`,
          version: "42",
        },
        referenceType: "road_segment",
        displayName: "Road 7",
        sourceOperation: "query-road",
        sourceWorldVersion: 42,
        safeSummary: { state: "published" },
        ...referenceOverrides,
      },
    ],
    evidenceItems: [
      {
        evidenceProductId: "evidence-1",
        productKind: "WORLD_FACT",
        authority: "GOWM",
        sourceOperation: "query-road",
        upstreamStatus: "NO_DATA",
        payloadSchemaUri: "urn:test:safe-evidence",
        payloadSchemaHash: `sha256:${"c".repeat(64)}`,
        safePayload: { note: "not an absence conclusion" },
        receiptIds: [],
        evidenceIds: [],
        unknowns: [],
        warnings: [],
      },
    ],
    ambiguities: [],
    unresolvedMentions: [],
    capabilityGaps: [],
    warnings: [],
    execution: {
      parserVersion: "1",
      semanticModelReceiptIds: [],
      queryCompilerVersion: "1",
      normalizerVersion: "1",
      elapsedMs: 1,
    },
    validUntil: "2026-08-28T03:00:00.000Z",
    resultHash: `sha256:${"d".repeat(64)}`,
  };
}
