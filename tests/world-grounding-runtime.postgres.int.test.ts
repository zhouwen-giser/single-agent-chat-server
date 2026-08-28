import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import pg from "pg";

import {
  GroundingPersistenceRepository,
  InteractionPersistenceRepository,
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
