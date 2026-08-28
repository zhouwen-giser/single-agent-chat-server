import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import pg from "pg";

import {
  ConversationPersistenceRepository,
  GroundingPersistenceRepository,
  InteractionPersistenceRepository,
  PostgresWorldFocusRepository,
  runMigrations,
} from "../packages/persistence/src/index.js";
import {
  createWsgsHttpClient,
  type WsgsGroundingRequest,
} from "../packages/wsgs-http-adapter/src/index.js";
import { WorldGroundingRuntime } from "../packages/world-grounding-runtime/src/index.js";

const { Pool } = pg;
const connectionString = process.env.TEST_DATABASE_URL;
const describeWithPostgres =
  connectionString === undefined ? describe.skip : describe;
const databaseName = `sacs_world_${randomUUID().replaceAll("-", "")}`;

describeWithPostgres("SACS v0.4 world runtime on PostgreSQL and HTTP", () => {
  const adminPool = new Pool({ connectionString, max: 1 });
  const pool = new Pool({
    connectionString:
      connectionString === undefined
        ? undefined
        : withDatabase(connectionString, databaseName),
    max: 8,
  });

  beforeAll(async () => {
    const database = await adminPool.query<{ database_name: string }>(
      "SELECT current_database() AS database_name",
    );
    expect(database.rows[0]?.database_name).toBe("single_agent_chat_phase4");
    await adminPool.query(`CREATE DATABASE "${databaseName}"`);
    await runMigrations(pool);
  });

  afterAll(async () => {
    await pool.end();
    await adminPool.end();
  });

  it("persists the HTTP grounding once and replays without a second POST", async () => {
    const requests = new InteractionPersistenceRepository(pool, 60_000);
    const grounding = new GroundingPersistenceRepository(pool, 60_000);
    const principal = await requests.resolvePrincipal({
      issuer: "s04-test",
      subject: `principal-${randomUUID()}`,
      role: "user",
    });
    const thread = await requests.getOrCreateThread({
      clientType: "openwebui",
      externalThreadId: `thread-${randomUUID()}`,
      principalId: principal.principalId,
    });
    const posts: WsgsGroundingRequest[] = [];
    const fetchImpl = jest.fn(
      async (request: string | URL | Request, init?: RequestInit) => {
        const url = new URL(
          typeof request === "string"
            ? request
            : request instanceof URL
              ? request.href
              : request.url,
        );
        if (url.pathname === "/v1/capabilities") {
          return jsonResponse(capabilities());
        }
        if (url.pathname === "/v1/groundings") {
          const rawBody =
            typeof init?.body === "string"
              ? init.body
              : request instanceof Request
                ? await request.text()
                : "{}";
          const body = JSON.parse(rawBody) as WsgsGroundingRequest;
          posts.push(body);
          return jsonResponse(resultFor(body));
        }
        return jsonResponse({ error: "unexpected" }, 404);
      },
    );
    const runtime = new WorldGroundingRuntime({
      requests,
      grounding,
      wsgs: createWsgsHttpClient({
        baseUrl: "http://wsgs.test",
        fetchImpl,
      }),
      sdarCompatibilityLock: unavailableLock(),
      nextLeaseOwner: () => "s04-worker",
    });
    const turn = {
      protocol: "openai" as const,
      principalId: principal.principalId,
      threadId: thread.threadId,
      externalRequestId: `message-${randomUUID()}`,
      userText: "What is the published state of Road 7?",
      turnPlan: {
        schemaVersion: "0.4" as const,
        turnRoute: "WORLD_ANSWER" as const,
        groundingRequirement: "ANSWER_WORLD_QUERY" as const,
        answerMode: "GROUNDED" as const,
        worldFocusUsage: emptyWorldFocus(),
      },
    };

    const first = await runtime.answerWorld(turn);
    const replay = await runtime.answerWorld(turn);

    expect(replay).toBe(first);
    expect(first).toContain("Reference: Road 7");
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({
      operation: "EXECUTE_WORLD_QUERY",
      requestedProducts: [
        "MENTIONS",
        "RESOLVED_REFERENCES",
        "WORLD_QUERY",
        "WORLD_EVIDENCE",
      ],
      contextCapsule: {
        knownWorldReferences: [],
        priorGroundings: [],
        mapSelections: [],
        externalCorrelationHints: [],
        externalPredicates: [],
      },
    });
    const executions = await pool.query<{
      state: string;
      event_count: string;
    }>(`
      SELECT execution.state, count(event.event_id)::text AS event_count
      FROM chat_service.grounding_execution execution
      JOIN chat_service.grounding_event event
        ON event.grounding_id = execution.grounding_id
      GROUP BY execution.state
    `);
    expect(executions.rows).toEqual([{ state: "COMPLETED", event_count: "3" }]);
  });

  it("persists one compare-only preview and replays without a second HTTP POST", async () => {
    const requests = new InteractionPersistenceRepository(pool, 60_000);
    const grounding = new GroundingPersistenceRepository(pool, 60_000);
    const principal = await requests.resolvePrincipal({
      issuer: "s05-test",
      subject: `principal-${randomUUID()}`,
      role: "user",
    });
    const thread = await requests.getOrCreateThread({
      clientType: "openwebui",
      externalThreadId: `thread-${randomUUID()}`,
      principalId: principal.principalId,
    });
    const posts: WsgsGroundingRequest[] = [];
    const runtime = new WorldGroundingRuntime({
      requests,
      grounding,
      wsgs: createWsgsHttpClient({
        baseUrl: "http://wsgs.test",
        fetchImpl: async (request, init) => {
          const url = new URL(
            typeof request === "string"
              ? request
              : request instanceof URL
                ? request.href
                : request.url,
          );
          if (url.pathname === "/v1/capabilities") {
            return jsonResponse(capabilities());
          }
          if (url.pathname === "/v1/groundings") {
            const rawBody =
              typeof init?.body === "string"
                ? init.body
                : request instanceof Request
                  ? await request.text()
                  : "{}";
            const body = JSON.parse(rawBody) as WsgsGroundingRequest;
            posts.push(body);
            return jsonResponse(resultFor(body));
          }
          return jsonResponse({ error: "unexpected" }, 404);
        },
      }),
      sdarCompatibilityLock: unavailableLock(),
      nextLeaseOwner: () => "s05-worker",
    });
    const turn = {
      protocol: "openai" as const,
      principalId: principal.principalId,
      threadId: thread.threadId,
      externalRequestId: `message-${randomUUID()}`,
      userText: "Compare the published plan with Road 7 reality.",
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

    const first = await runtime.compareHybrid(turn);
    const replay = await runtime.compareHybrid(turn);

    expect(first).toContain("AUTHORITY_FUSION_PREVIEW_READY");
    expect(first).toContain("SACS COMPARE_ONLY");
    expect(replay).toBe(first);
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({
      operation: "EXECUTE_WORLD_QUERY",
      requestedProducts: [
        "WORLD_QUERY",
        "WORLD_EVIDENCE",
        "CORRELATION_FINDINGS",
        "PREDICATE_EVALUATIONS",
      ],
    });
  });

  it("validates an exact pending choice and resumes the original source", async () => {
    const requests = new InteractionPersistenceRepository(pool, 60_000);
    const grounding = new GroundingPersistenceRepository(pool, 60_000);
    const conversation = new ConversationPersistenceRepository(pool);
    const worldFocus = new PostgresWorldFocusRepository(pool);
    const principal = await requests.resolvePrincipal({
      issuer: "s07-test",
      subject: `principal-${randomUUID()}`,
      role: "user",
    });
    const thread = await requests.getOrCreateThread({
      clientType: "openwebui",
      externalThreadId: `thread-${randomUUID()}`,
      principalId: principal.principalId,
    });
    const originMessageId = `message-${randomUUID()}`;
    const originText = "滨河路附近有哪些设备？";
    await conversation.ingestUserMessage({
      principalId: principal.principalId,
      threadId: thread.threadId,
      protocol: "openai",
      externalMessageId: originMessageId,
      contentText: originText,
    });
    const posts: WsgsGroundingRequest[] = [];
    const runtime = new WorldGroundingRuntime({
      requests,
      grounding,
      conversation,
      worldFocus,
      wsgs: createWsgsHttpClient({
        baseUrl: "http://wsgs.test",
        fetchImpl: async (request, init) => {
          const url = new URL(
            typeof request === "string"
              ? request
              : request instanceof URL
                ? request.href
                : request.url,
          );
          if (url.pathname === "/v1/capabilities") {
            return jsonResponse(capabilities());
          }
          if (url.pathname === "/v1/groundings") {
            const rawBody =
              typeof init?.body === "string"
                ? init.body
                : request instanceof Request
                  ? await request.text()
                  : "{}";
            const body = JSON.parse(rawBody) as WsgsGroundingRequest;
            posts.push(body);
            return jsonResponse(
              posts.length === 1
                ? ambiguousResultFor(body)
                : selectedResultFor(body, posts.length),
            );
          }
          return jsonResponse({ error: "unexpected" }, 404);
        },
      }),
      sdarCompatibilityLock: unavailableLock(),
      nextLeaseOwner: () => `s07-worker-${randomUUID()}`,
    });
    const originTurn = {
      protocol: "openai" as const,
      principalId: principal.principalId,
      threadId: thread.threadId,
      externalRequestId: originMessageId,
      userText: originText,
      turnPlan: {
        schemaVersion: "0.4" as const,
        turnRoute: "WORLD_ANSWER" as const,
        groundingRequirement: "ANSWER_WORLD_QUERY" as const,
        answerMode: "GROUNDED" as const,
        worldFocusUsage: emptyWorldFocus(),
      },
    };

    await expect(
      runtime.continuePendingChoice({
        protocol: "openai",
        principalId: principal.principalId,
        threadId: thread.threadId,
        externalRequestId: `control-empty-${randomUUID()}`,
        userText: "第二个",
      }),
    ).resolves.toBe("WORLD_GROUNDING_NO_PENDING_CHOICE");
    expect(posts).toHaveLength(0);

    const ambiguous = await runtime.answerWorld(originTurn);
    const resumed = await runtime.continuePendingChoice({
      protocol: "ag_ui",
      principalId: principal.principalId,
      threadId: thread.threadId,
      externalRequestId: `control-${randomUUID()}`,
      userText: "第二个",
    });

    expect(ambiguous).toContain("WORLD_GROUNDING_CLARIFICATION_REQUIRED");
    expect(resumed).toContain("滨河路北区");
    expect(posts).toHaveLength(3);
    expect(posts.map(({ operation }) => operation)).toEqual([
      "EXECUTE_WORLD_QUERY",
      "VALIDATE_REFERENCES",
      "EXECUTE_WORLD_QUERY",
    ]);
    expect(posts.slice(1).map(({ source }) => source)).toEqual([
      expect.objectContaining({
        messageId: originMessageId,
        originalText: originText,
      }),
      expect.objectContaining({
        messageId: originMessageId,
        originalText: originText,
      }),
    ]);
    expect(posts[1]?.contextCapsule.knownWorldReferences).toEqual([
      expect.objectContaining({
        alias: "滨河路北区",
        sourceMessageId: originMessageId,
      }),
    ]);
    await expect(
      worldFocus.getOpenChoice({
        principalId: principal.principalId,
        threadId: thread.threadId,
      }),
    ).resolves.toBeUndefined();
    await expect(
      worldFocus.getFocus({
        principalId: principal.principalId,
        threadId: thread.threadId,
      }),
    ).resolves.toMatchObject({
      references: [expect.objectContaining({ displayName: "滨河路北区" })],
    });

    await pool.query(
      `
        UPDATE chat_service.conversation_world_reference
        SET valid_until = '2026-08-28T00:00:00.000Z'
        WHERE principal_id = $1 AND thread_id = $2
      `,
      [principal.principalId, thread.threadId],
    );
    const followUpMessageId = `message-${randomUUID()}`;
    const followUp = await runtime.answerWorld({
      ...originTurn,
      externalRequestId: followUpMessageId,
      userText: "它现在呢？",
      turnPlan: {
        ...originTurn.turnPlan,
        worldFocusUsage: {
          ...originTurn.turnPlan.worldFocusUsage,
          knownWorldReferences: true,
        },
      },
    });
    expect(followUp).toContain("滨河路北区");
    expect(posts.map(({ operation }) => operation)).toEqual([
      "EXECUTE_WORLD_QUERY",
      "VALIDATE_REFERENCES",
      "EXECUTE_WORLD_QUERY",
      "VALIDATE_REFERENCES",
      "EXECUTE_WORLD_QUERY",
    ]);
    expect(posts[3]?.contextCapsule.knownWorldReferences).toEqual([
      expect.objectContaining({ alias: "滨河路北区" }),
    ]);
    expect(posts[4]?.contextCapsule.knownWorldReferences).toEqual([
      expect.objectContaining({ alias: "滨河路北区" }),
    ]);
  });
});

function capabilities() {
  return {
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
  };
}

function resultFor(request: WsgsGroundingRequest) {
  return {
    schemaVersion: "1.0",
    requestId: request.requestId,
    groundingId: "grounding-http-1",
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
        safeSummary: { status: "published" },
      },
    ],
    evidenceItems: [
      {
        evidenceProductId: "evidence-1",
        productKind: "WORLD_FACT",
        authority: "GOWM",
        sourceOperation: "query-road",
        upstreamStatus: "COMPLETED",
        payloadSchemaUri: "urn:test:safe-evidence",
        payloadSchemaHash: `sha256:${"c".repeat(64)}`,
        safePayload: { status: "published" },
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
    resultHash: `sha256:${"d".repeat(64)}`,
  };
}

function ambiguousResultFor(request: WsgsGroundingRequest) {
  const first = resultFor(request);
  const firstProduct = expectDefined(first.referenceProducts[0]);
  const second = {
    ...firstProduct,
    productId: "product-2",
    displayName: "滨河路北区",
    referenceKey: {
      ...firstProduct.referenceKey,
      id: `wrf_${"e".repeat(32)}`,
    },
  };
  return {
    ...first,
    groundingId: "grounding-http-ambiguous",
    status: "AMBIGUOUS",
    referenceProducts: [{ ...firstProduct, displayName: "滨河路南区" }, second],
    ambiguities: [
      {
        ambiguityId: "ambiguity-1",
        mentionId: "mention-1",
        surfaceText: "滨河路",
        candidateProductIds: ["product-1", "product-2"],
        reason: "MULTIPLE_PLAUSIBLE_MATCHES",
      },
    ],
    resultHash: `sha256:${"e".repeat(64)}`,
  };
}

function selectedResultFor(request: WsgsGroundingRequest, ordinal: number) {
  const result = resultFor(request);
  const firstProduct = expectDefined(result.referenceProducts[0]);
  return {
    ...result,
    groundingId: `grounding-http-selected-${ordinal}`,
    referenceProducts: [
      {
        ...firstProduct,
        productId: "product-2",
        displayName: "滨河路北区",
        sourceOperation: request.operation,
        referenceKey: {
          ...firstProduct.referenceKey,
          id: `wrf_${"e".repeat(32)}`,
          version: String(42 + ordinal),
        },
        sourceWorldVersion: 42 + ordinal,
        validUntil: "2026-08-30T00:00:00.000Z",
        revalidationRequired: false,
      },
    ],
    resultHash: `sha256:${String(ordinal).repeat(64)}`,
  };
}

function expectDefined<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected test fixture value");
  return value;
}

function unavailableLock() {
  return {
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

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function withDatabase(connection: string, database: string): string {
  const url = new URL(connection);
  url.pathname = `/${database}`;
  return url.toString();
}
