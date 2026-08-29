import { describe, expect, it, jest } from "@jest/globals";

import {
  GroundingContextAssembler,
  PendingChoiceResolver,
  WorldFocusUpdater,
  isDeterministicChoiceControl,
  worldReferenceIdentityHash,
  type ConversationWorldFocus,
  type PendingGroundingChoice,
  type WorldFocusRepository,
} from "../packages/conversation-world-focus/src/index.js";
import type { WsgsGroundingResult } from "../packages/wsgs-http-adapter/src/index.js";
import type {
  GroundingRequestPlan,
  TurnPlan,
} from "../packages/world-grounding-contract/src/index.js";

const hash = `sha256:${"a".repeat(64)}`;
const now = "2026-08-29T00:00:00.000Z";

describe("SACS v0.4 S07 conversation world focus runtime", () => {
  it("assembles only TurnPlan-authorized context and excludes fusion-only input", async () => {
    const reference = expectDefined(focus().references[0]);
    const repository = {
      getFocus: jest.fn(async () => focus()),
      listUsableReferences: jest.fn(async () => [
        { focusReference: reference, sourceMessageId: "message-origin" },
      ]),
    } as unknown as WorldFocusRepository;
    const assembler = new GroundingContextAssembler(repository);

    const assembled = await assembler.assemble({
      principalId: "principal-1",
      threadId: "thread-1",
      turnPlan: turnPlan({ knownWorldReferences: true, priorGrounding: true }),
      fusionRequirements: {
        correlationHints: [
          {
            hintId: "hint-1",
            externalAuthority: "SDAR",
            kind: "EXTERNAL_TASK",
            value: "task-1",
          },
        ],
        predicates: [],
      },
      now,
    });

    expect(assembled).toMatchObject({
      focusRevision: 1,
      source: "AUTHORITY_FUSION",
      contextCapsule: {
        knownWorldReferences: [
          {
            alias: "2号车",
            sourceMessageId: "message-origin",
            sourceGroundingId: "grounding-result-1",
          },
        ],
        priorGroundings: [
          {
            groundingId: "grounding-result-1",
            resultHash: hash,
            selectedProductIds: ["product-1"],
          },
        ],
        externalCorrelationHints: [],
        externalPredicates: [],
      },
    });
  });

  it("fails closed before emitting an invalid MapSelection", async () => {
    const repository = {
      getFocus: jest.fn(async () => focus()),
      listUsableReferences: jest.fn(async () => []),
    } as unknown as WorldFocusRepository;
    const assembler = new GroundingContextAssembler(repository);
    const invalid = await assembler.assemble({
      principalId: "principal-1",
      threadId: "thread-1",
      turnPlan: turnPlan({ mapSelections: true }),
      mapSelections: [
        {
          selectionId: "selection-no-hash",
          kind: "AREA",
          revision: 1,
          geometry: { type: "Polygon" },
        },
      ],
      now,
    });
    const reference = expectDefined(focus().references[0]);
    const valid = await assembler.assemble({
      principalId: "principal-1",
      threadId: "thread-1",
      turnPlan: turnPlan({ mapSelections: true }),
      mapSelections: [
        {
          selectionId: "selection-reference",
          kind: "FEATURE",
          revision: 1,
          referenceKey: reference.referenceKey,
        },
      ],
      now,
    });

    expect(invalid.contextCapsule.mapSelections).toEqual([]);
    expect(valid.contextCapsule.mapSelections).toHaveLength(1);
  });

  it("resolves only exact ordinals or exact display names", () => {
    const resolver = new PendingChoiceResolver();
    const choice = pendingChoice();

    expect(resolver.resolve("第二个", choice)).toMatchObject({
      kind: "SELECTED",
      candidate: { productId: "product-2" },
    });
    expect(resolver.resolve("第二处", choice)).toMatchObject({
      kind: "SELECTED",
      candidate: { productId: "product-2" },
    });
    expect(resolver.resolve("滨河路南区", choice)).toMatchObject({
      kind: "SELECTED",
      candidate: { productId: "product-1" },
    });
    expect(resolver.resolve("我想要北边那个", choice)).toEqual({
      kind: "CLARIFY",
      reason: "CHOICE_INPUT_NOT_DETERMINISTIC",
    });
    expect(isDeterministicChoiceControl("第3个")).toBe(true);
    expect(isDeterministicChoiceControl("第二处")).toBe(true);
    expect(isDeterministicChoiceControl("大概第二个")).toBe(false);
  });

  it("creates a bounded PendingChoice for AMBIGUOUS and does not mutate focus", async () => {
    const createChoice = jest.fn(
      async (choice: PendingGroundingChoice) => choice,
    );
    const applyReferences = jest.fn();
    const repository = {
      getFocus: jest.fn(async () => focus()),
      createChoice,
      applyReferences,
    } as unknown as WorldFocusRepository;
    const updater = new WorldFocusUpdater(repository, {
      nextChoiceId: () => "fixed",
      now: () => new Date(now),
    });

    const updated = await updater.apply({
      principalId: "principal-1",
      threadId: "thread-1",
      groundingExecutionId: "grounding-execution-2",
      originMessageId: "message-origin",
      turnPlan: turnPlan(),
      requestPlan: requestPlan(),
      result: ambiguousResult(),
    });

    expect(updated.choice).toMatchObject({
      choiceId: "choice-fixed",
      originGroundingId: "grounding-execution-2",
      originMessageId: "message-origin",
      status: "OPEN",
      candidates: [
        { ordinal: 1, productId: "product-1" },
        { ordinal: 2, productId: "product-2" },
      ],
    });
    expect(createChoice).toHaveBeenCalledTimes(1);
    expect(applyReferences).not.toHaveBeenCalled();
  });

  it("absorbs only safe PARTIAL references", async () => {
    const applied = { ...focus(), revision: 2 };
    const applyReferences = jest.fn(async () => applied);
    const repository = {
      getFocus: jest.fn(async () => focus()),
      applyReferences,
    } as unknown as WorldFocusRepository;
    const updater = new WorldFocusUpdater(repository, {
      now: () => new Date(now),
    });
    const result = completedResult();
    const product = expectDefined(result.referenceProducts[0]);
    result.status = "PARTIAL";
    result.referenceProducts.push(
      {
        ...product,
        productId: "product-expired",
        validUntil: "2026-08-28T23:59:00.000Z",
      },
      {
        ...product,
        productId: "product-stale",
        revalidationRequired: true,
      },
    );

    await expect(
      updater.apply({
        principalId: "principal-1",
        threadId: "thread-1",
        groundingExecutionId: "grounding-execution-2",
        originMessageId: "message-origin",
        turnPlan: turnPlan(),
        requestPlan: requestPlan(),
        result,
      }),
    ).resolves.toMatchObject({ focus: { revision: 2 } });
    expect(applyReferences).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedRevision: 1,
        references: [expect.objectContaining({ productId: "product-1" })],
      }),
    );
  });

  it("tracks a COMPLETED reference as STALE until WSGS validation", async () => {
    const applyReferences = jest.fn(async () => ({ ...focus(), revision: 2 }));
    const repository = {
      getFocus: jest.fn(async () => focus()),
      applyReferences,
    } as unknown as WorldFocusRepository;
    const updater = new WorldFocusUpdater(repository, {
      now: () => new Date(now),
    });
    const result = completedResult();
    result.referenceProducts[0] = {
      ...expectDefined(result.referenceProducts[0]),
      validUntil: undefined,
      revalidationRequired: true,
    };

    await updater.apply({
      principalId: "principal-1",
      threadId: "thread-1",
      groundingExecutionId: "grounding-execution-stale",
      originMessageId: "message-origin",
      turnPlan: turnPlan(),
      requestPlan: requestPlan(),
      result,
    });

    expect(applyReferences).toHaveBeenCalledWith(
      expect.objectContaining({
        references: [
          expect.objectContaining({
            productId: "product-1",
            revalidationRequired: true,
          }),
        ],
      }),
    );
  });

  it("tracks an expired COMPLETED reference for fail-closed revalidation", async () => {
    const applyReferences = jest.fn(async () => ({ ...focus(), revision: 2 }));
    const repository = {
      getFocus: jest.fn(async () => focus()),
      applyReferences,
    } as unknown as WorldFocusRepository;
    const updater = new WorldFocusUpdater(repository, {
      now: () => new Date(now),
    });
    const result = completedResult();
    result.referenceProducts[0] = {
      ...expectDefined(result.referenceProducts[0]),
      validUntil: "2026-08-27T00:00:00.000Z",
      revalidationRequired: false,
    };

    await updater.apply({
      principalId: "principal-1",
      threadId: "thread-1",
      groundingExecutionId: "grounding-execution-expired",
      originMessageId: "message-origin",
      turnPlan: turnPlan(),
      requestPlan: requestPlan(),
      result,
    });

    expect(applyReferences).toHaveBeenCalledWith(
      expect.objectContaining({
        references: [
          expect.objectContaining({
            productId: "product-1",
            validUntil: "2026-08-27T00:00:00.000Z",
          }),
        ],
      }),
    );
  });
});

function focus(): ConversationWorldFocus {
  const referenceKey = {
    namespace: "gowm" as const,
    kind: "vehicle",
    id: `wrf_${"1".repeat(32)}`,
    version: "world-7",
  };
  return {
    schemaVersion: "1.0",
    principalId: "principal-1",
    threadId: "thread-1",
    revision: 1,
    lastGroundingId: "grounding-result-1",
    lastGroundingResultHash: hash,
    references: [
      {
        referenceIdentityHash: worldReferenceIdentityHash(referenceKey),
        referenceKey,
        productId: "product-1",
        displayName: "2号车",
        referenceType: "vehicle",
        sourceGroundingId: "grounding-result-1",
        sourceResultHash: hash,
        sourceWorldVersion: 7,
        validUntil: "2026-08-29T01:00:00.000Z",
        revalidationRequired: false,
        status: "VALID",
        lastUsedAt: now,
      },
    ],
    updatedAt: now,
  };
}

function pendingChoice(): PendingGroundingChoice {
  return {
    schemaVersion: "1.0",
    choiceId: "choice-1",
    principalId: "principal-1",
    threadId: "thread-1",
    originMessageId: "message-origin",
    originGroundingId: "grounding-execution-1",
    originResultHash: hash,
    originTurnPlan: turnPlan() as unknown as Record<string, unknown>,
    originRequestPlan: requestPlan() as unknown as Record<string, unknown>,
    mentionId: "mention-1",
    surfaceText: "滨河路",
    candidates: [
      { ordinal: 1, productId: "product-1", displayName: "滨河路南区" },
      { ordinal: 2, productId: "product-2", displayName: "滨河路北区" },
    ],
    status: "OPEN",
    expiresAt: "2026-08-29T01:00:00.000Z",
    createdAt: now,
    updatedAt: now,
  };
}

function turnPlan(usage: Partial<TurnPlan["worldFocusUsage"]> = {}): TurnPlan {
  return {
    schemaVersion: "0.4",
    turnRoute: "WORLD_ANSWER",
    groundingRequirement: "ANSWER_WORLD_QUERY",
    answerMode: "GROUNDED",
    worldFocusUsage: {
      knownWorldReferences: false,
      priorGrounding: false,
      mapSelections: false,
      externalCorrelationHints: false,
      externalPredicates: false,
      ...usage,
    },
  };
}

function requestPlan(): GroundingRequestPlan {
  return {
    schemaVersion: "1.0",
    plannedBy: "SACS_DETERMINISTIC_V1",
    operation: "EXECUTE_WORLD_QUERY",
    requestedProducts: ["RESOLVED_REFERENCES"],
    contextUsage: turnPlan().worldFocusUsage,
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

function completedResult(): WsgsGroundingResult {
  return {
    schemaVersion: "1.0",
    requestId: "wsgs-request-1",
    groundingId: "grounding-result-2",
    status: "COMPLETED",
    source: {
      messageId: "message-origin",
      originalTextSha256: hash,
    },
    mentions: [],
    referenceProducts: [
      {
        productId: "product-1",
        productKind: "RESOLVED_REFERENCE",
        referenceKey: {
          namespace: "gowm",
          kind: "vehicle",
          id: `wrf_${"1".repeat(32)}`,
          version: "world-8",
        },
        referenceType: "vehicle",
        displayName: "2号车",
        sourceOperation: "query-vehicle",
        sourceWorldVersion: 8,
        validUntil: "2026-08-29T01:00:00.000Z",
        revalidationRequired: false,
        safeSummary: { status: "published" },
      },
    ],
    evidenceItems: [],
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
    resultHash: hash,
  };
}

function ambiguousResult(): WsgsGroundingResult {
  const result = completedResult();
  const product = expectDefined(result.referenceProducts[0]);
  result.status = "AMBIGUOUS";
  result.referenceProducts.push({
    ...product,
    productId: "product-2",
    displayName: "滨河路北区",
    referenceKey: {
      ...product.referenceKey,
      id: `wrf_${"2".repeat(32)}`,
    },
  });
  result.referenceProducts[0] = {
    ...product,
    displayName: "滨河路南区",
  };
  result.ambiguities = [
    {
      mentionId: "mention-1",
      surfaceText: "滨河路",
      ambiguityId: "ambiguity-1",
      reason: "MULTIPLE_PLAUSIBLE_MATCHES",
      candidateProductIds: ["product-1", "product-2"],
    },
  ];
  return result;
}

function expectDefined<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected test fixture value");
  return value;
}
