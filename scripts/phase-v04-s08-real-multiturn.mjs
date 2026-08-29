import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";

import pg from "pg";

import { planGroundingRequest } from "../dist/packages/grounding-request-planner/src/index.js";
import {
  ConversationPersistenceRepository,
  GroundingPersistenceRepository,
  InteractionPersistenceRepository,
  PostgresWorldFocusRepository,
  runMigrations,
} from "../dist/packages/persistence/src/index.js";
import {
  createWsgsHttpClient,
  parseWsgsGroundingResult,
} from "../dist/packages/wsgs-http-adapter/src/index.js";
import { WorldGroundingRuntime } from "../dist/packages/world-grounding-runtime/src/index.js";

const { Pool } = pg;
const expectedWsgsCommit = "46e872359536b84351ce2b417117fc5725c59145";

if (process.env.ALLOW_REAL_WSGS_MULTITURN !== "YES") {
  throw new Error("ALLOW_REAL_WSGS_MULTITURN=YES is required");
}

const adminConnection = requiredEnvironment("TEST_DATABASE_URL");
const wsgsBaseUrl = new URL(requiredEnvironment("WSGS_BASE_URL"));
const wsgsSourceDir = requiredEnvironment("WSGS_SOURCE_DIR");
const wsgsBearerToken = requiredEnvironment("WSGS_BEARER_TOKEN");
assert.equal(
  execFileSync("git", ["-C", wsgsSourceDir, "rev-parse", "HEAD"], {
    encoding: "utf8",
    windowsHide: true,
  }).trim(),
  expectedWsgsCommit,
  "WSGS source checkout does not match the locked development-ready commit",
);
assert.equal(wsgsBaseUrl.protocol, "http:");
assert.ok(
  ["127.0.0.1", "localhost", "host.docker.internal"].includes(
    wsgsBaseUrl.hostname,
  ),
  "S08 WSGS endpoint must be local",
);

await assertHttpStatus(
  new URL("health/live", wsgsBaseUrl),
  200,
  wsgsBearerToken,
);
await assertHttpStatus(
  new URL("health/ready", wsgsBaseUrl),
  200,
  wsgsBearerToken,
);

const databaseName = `sacs_s08_${randomUUID().replaceAll("-", "")}`;
assert.match(databaseName, /^sacs_s08_[0-9a-f]{32}$/u);
const databaseConnection = withDatabase(adminConnection, databaseName);
const adminPool = new Pool({ connectionString: adminConnection, max: 1 });
let pool;

try {
  await adminPool.query(`CREATE DATABASE "${databaseName}"`);
  pool = new Pool({ connectionString: databaseConnection, max: 8 });
  await runMigrations(pool);

  const posts = [];
  const httpExchanges = [];
  const realFetch = captureGroundingPosts(posts, httpExchanges);
  const wsgs = createWsgsHttpClient({
    baseUrl: wsgsBaseUrl.href,
    bearerToken: wsgsBearerToken,
    fetchImpl: realFetch,
  });
  const capabilities = await wsgs.capabilities();
  assert.equal(capabilities.requiredCapabilitiesReady, true);
  assert.deepEqual(capabilities.supportedOperations, [
    "GROUND_REFERENCES",
    "COMPILE_WORLD_QUERY",
    "EXECUTE_WORLD_QUERY",
    "VALIDATE_REFERENCES",
  ]);

  const repositories = createRepositories(pool);
  const principal = await repositories.requests.resolvePrincipal({
    issuer: "s08-real-wsgs",
    subject: `principal-${randomUUID()}`,
    role: "user",
  });
  const runtime = createRuntime(repositories, wsgs);

  const vehicleThread = await createThread(
    repositories.requests,
    principal.principalId,
    "vehicle",
  );
  const vehicleFirst = await executeWorldTurn({
    runtime,
    conversation: repositories.conversation,
    principalId: principal.principalId,
    threadId: vehicleThread,
    protocol: "openai",
    text: "2号车在哪里？",
    usage: emptyWorldFocus(),
  });
  if (vehicleFirst.text.startsWith("WORLD_GROUNDING_")) {
    throw new Error(
      `S08_VEHICLE_INITIAL_FAILED ${JSON.stringify({
        sacsCode: vehicleFirst.text,
        operations: posts.map(({ operation }) => operation),
        latestGrounding: await boundedLatestGroundingDiagnostic(
          pool,
          principal.principalId,
          vehicleThread,
        ),
        httpExchanges: httpExchanges.slice(-12),
      })}`,
    );
  }
  assertWorldSuccess(vehicleFirst.text);
  const vehicleFocus = await repositories.worldFocus.getFocus({
    principalId: principal.principalId,
    threadId: vehicleThread,
  });
  if (vehicleFocus.references.length === 0) {
    throw new Error(
      `S08_VEHICLE_FOCUS_EMPTY ${JSON.stringify(
        await boundedLatestGroundingDiagnostic(
          pool,
          principal.principalId,
          vehicleThread,
        ),
      )}`,
    );
  }
  const vehicleAlias = vehicleFocus.references[0].displayName;

  const beforeVehicleFollowUp = posts.length;
  const vehicleFollowUp = await executeWorldTurn({
    runtime,
    conversation: repositories.conversation,
    principalId: principal.principalId,
    threadId: vehicleThread,
    protocol: "ag_ui",
    text: "它现在呢？",
    usage: knownReferenceUsage(),
  });
  if (vehicleFollowUp.text === "WORLD_GROUNDING_CONTEXT_UNAVAILABLE") {
    throw new Error(
      `S08_VEHICLE_FOLLOWUP_CONTEXT_UNAVAILABLE ${JSON.stringify({
        operations: posts
          .slice(beforeVehicleFollowUp)
          .map(({ operation }) => operation),
        httpExchanges: httpExchanges.slice(-12),
        latestGrounding: await boundedLatestGroundingDiagnostic(
          pool,
          principal.principalId,
          vehicleThread,
        ),
        focusStatuses: (
          await repositories.worldFocus.getFocus({
            principalId: principal.principalId,
            threadId: vehicleThread,
          })
        ).references.map(({ status, revalidationRequired, validUntil }) => ({
          status,
          revalidationRequired,
          validUntilState:
            validUntil === undefined
              ? "ABSENT"
              : Date.parse(validUntil) > Date.now()
                ? "FUTURE"
                : "EXPIRED",
        })),
      })}`,
    );
  }
  if (vehicleFollowUp.text.startsWith("WORLD_GROUNDING_")) {
    throw new Error(
      `S08_VEHICLE_FOLLOWUP_FAILED ${JSON.stringify({
        sacsCode: vehicleFollowUp.text,
        operations: posts
          .slice(beforeVehicleFollowUp)
          .map(({ operation }) => operation),
        httpExchanges: httpExchanges.slice(-12),
        latestGrounding: await boundedLatestGroundingDiagnostic(
          pool,
          principal.principalId,
          vehicleThread,
        ),
      })}`,
    );
  }
  assertWorldSuccess(vehicleFollowUp.text);
  assertKnownContext(posts.at(-1), vehicleAlias);
  assert.ok(posts.length > beforeVehicleFollowUp);
  const beforeReplay = posts.length;
  await runtime.answerWorld(vehicleFollowUp.turn);
  assert.equal(posts.length, beforeReplay, "replay duplicated a WSGS POST");

  const areaThread = await createThread(
    repositories.requests,
    principal.principalId,
    "area",
  );
  const areaFirst = await executeWorldTurn({
    runtime,
    conversation: repositories.conversation,
    principalId: principal.principalId,
    threadId: areaThread,
    protocol: "openai",
    text: "A区有哪些车？",
    usage: emptyWorldFocus(),
  });
  assertWorldSuccess(areaFirst.text);
  const areaFocus = await repositories.worldFocus.getFocus({
    principalId: principal.principalId,
    threadId: areaThread,
  });
  if (areaFocus.references.length === 0) {
    throw new Error(
      `S08_AREA_FOCUS_EMPTY ${JSON.stringify(
        await boundedLatestGroundingDiagnostic(
          pool,
          principal.principalId,
          areaThread,
        ),
      )}`,
    );
  }
  const areaAlias = areaFocus.references[0].displayName;
  const areaFollowUpStart = posts.length;
  const areaFollowUp = await executeWorldTurn({
    runtime,
    conversation: repositories.conversation,
    principalId: principal.principalId,
    threadId: areaThread,
    protocol: "ag_ui",
    text: "那里附近还有什么？",
    usage: knownReferenceUsage(),
  });
  if (areaFollowUp.text === "WORLD_GROUNDING_CONTEXT_UNAVAILABLE") {
    throw new Error(
      `S08_AREA_FOLLOWUP_CONTEXT_UNAVAILABLE ${JSON.stringify({
        operations: posts
          .slice(areaFollowUpStart)
          .map(({ operation }) => operation),
        httpExchanges: httpExchanges.slice(-12),
        latestGrounding: await boundedLatestGroundingDiagnostic(
          pool,
          principal.principalId,
          areaThread,
        ),
        focusStatuses: (
          await repositories.worldFocus.getFocus({
            principalId: principal.principalId,
            threadId: areaThread,
          })
        ).references.map(({ status, revalidationRequired, validUntil }) => ({
          status,
          revalidationRequired,
          validUntilState:
            validUntil === undefined
              ? "ABSENT"
              : Date.parse(validUntil) > Date.now()
                ? "FUTURE"
                : "EXPIRED",
        })),
      })}`,
    );
  }
  assertWorldSuccess(areaFollowUp.text);
  assertKnownContext(posts.at(-1), areaAlias);

  const ambiguityThread = await createThread(
    repositories.requests,
    principal.principalId,
    "ambiguity",
  );
  const ambiguous = await executeWorldTurn({
    runtime,
    conversation: repositories.conversation,
    principalId: principal.principalId,
    threadId: ambiguityThread,
    protocol: "openai",
    text: "滨河路附近有哪些设备？",
    usage: emptyWorldFocus(),
  });
  assert.match(ambiguous.text, /WORLD_GROUNDING_CLARIFICATION_REQUIRED/u);
  const choice = await repositories.worldFocus.getOpenChoice({
    principalId: principal.principalId,
    threadId: ambiguityThread,
  });
  assert.ok(choice);
  assert.equal(choice.candidates.length, 2);
  const controlMessageId = `message-${randomUUID()}`;
  await repositories.conversation.ingestUserMessage({
    principalId: principal.principalId,
    threadId: ambiguityThread,
    protocol: "ag_ui",
    externalMessageId: controlMessageId,
    contentText: "第二个",
  });
  const continuationStart = posts.length;
  const continued = await runtime.continuePendingChoice({
    protocol: "ag_ui",
    principalId: principal.principalId,
    threadId: ambiguityThread,
    externalRequestId: controlMessageId,
    userText: "第二个",
  });
  assert.ok(continued);
  if (continued.startsWith("WORLD_GROUNDING_")) {
    throw new Error(
      `S08_PENDING_CHOICE_CONTINUATION_FAILED ${JSON.stringify({
        sacsCode: continued,
        operations: posts
          .slice(continuationStart)
          .map(({ operation }) => operation),
        httpExchanges: httpExchanges.slice(-16),
        latestGrounding: await boundedLatestGroundingDiagnostic(
          pool,
          principal.principalId,
          ambiguityThread,
        ),
      })}`,
    );
  }
  assertWorldSuccess(continued);
  assert.deepEqual(
    posts.slice(continuationStart).map(({ operation }) => operation),
    ["VALIDATE_REFERENCES", "EXECUTE_WORLD_QUERY"],
  );
  for (const request of posts.slice(continuationStart)) {
    assert.equal(request.source.messageId, ambiguous.turn.externalRequestId);
    assert.equal(request.source.originalText, "滨河路附近有哪些设备？");
  }

  const emptyThread = await createThread(
    repositories.requests,
    principal.principalId,
    "no-choice",
  );
  const noChoiceStart = posts.length;
  assert.equal(
    await runtime.continuePendingChoice({
      protocol: "openai",
      principalId: principal.principalId,
      threadId: emptyThread,
      externalRequestId: `message-${randomUUID()}`,
      userText: "第二个",
    }),
    "WORLD_GROUNDING_NO_PENDING_CHOICE",
  );
  assert.equal(posts.length, noChoiceStart);

  await pool.query(
    `
      UPDATE chat_service.conversation_world_reference
      SET valid_until = now() - interval '1 minute'
      WHERE principal_id = $1 AND thread_id = $2
    `,
    [principal.principalId, vehicleThread],
  );
  const expiredStart = posts.length;
  const expiredFollowUp = await executeWorldTurn({
    runtime,
    conversation: repositories.conversation,
    principalId: principal.principalId,
    threadId: vehicleThread,
    protocol: "openai",
    text: "它现在的位置是否仍然有效？",
    usage: knownReferenceUsage(),
  });
  assertWorldSuccess(expiredFollowUp.text);
  assert.deepEqual(
    posts.slice(expiredStart).map(({ operation }) => operation),
    ["VALIDATE_REFERENCES", "EXECUTE_WORLD_QUERY"],
  );

  const isolatedFocus = await repositories.worldFocus.getFocus({
    principalId: principal.principalId,
    threadId: emptyThread,
  });
  assert.deepEqual(isolatedFocus.references, []);

  const restartedRepositories = createRepositories(pool);
  const restartedRuntime = createRuntime(restartedRepositories, wsgs);
  const restartFollowUp = await executeWorldTurn({
    runtime: restartedRuntime,
    conversation: restartedRepositories.conversation,
    principalId: principal.principalId,
    threadId: vehicleThread,
    protocol: "ag_ui",
    text: "它附近还有什么？",
    usage: knownReferenceUsage(),
  });
  assertWorldSuccess(restartFollowUp.text);
  assertKnownContext(posts.at(-1), vehicleAlias);

  process.stdout.write(
    `${JSON.stringify({
      marker: "SACS_MULTITURN_WORLD_GROUNDING_READY",
      status: "PASS",
      wsgsCommit: expectedWsgsCommit,
      database: "ISOLATED_EPHEMERAL",
      realWsgsPosts: posts.length,
      operationCounts: countOperations(posts),
      scenarios: 8,
      requestEvidenceHash: hashJson(
        posts.map(({ operation, source, contextCapsule }) => ({
          operation,
          sourceMessageId: source.messageId,
          knownReferenceCount: contextCapsule.knownWorldReferences.length,
          priorGroundingCount: contextCapsule.priorGroundings.length,
        })),
      ),
    })}\n`,
  );
} finally {
  if (pool !== undefined) await pool.end();
  await adminPool.query(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1`,
    [databaseName],
  );
  await adminPool.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
  await adminPool.end();
}

function createRepositories(pool) {
  return {
    requests: new InteractionPersistenceRepository(pool, 60_000),
    grounding: new GroundingPersistenceRepository(pool, 60_000),
    conversation: new ConversationPersistenceRepository(pool),
    worldFocus: new PostgresWorldFocusRepository(pool),
  };
}

function createRuntime(repositories, wsgs) {
  return new WorldGroundingRuntime({
    requests: repositories.requests,
    grounding: repositories.grounding,
    conversation: repositories.conversation,
    worldFocus: repositories.worldFocus,
    wsgs,
    sdarCompatibilityLock: unavailableSdarLock(),
    nextLeaseOwner: () => `s08-${randomUUID()}`,
    requestPlanner: liveRequestPlanner,
  });
}

function liveRequestPlanner(turnPlan) {
  const plan = planGroundingRequest(turnPlan);
  return {
    ...plan,
    executionPolicy: {
      ...plan.executionPolicy,
      deadlineMs: 120_000,
    },
  };
}

async function createThread(requests, principalId, label) {
  const thread = await requests.getOrCreateThread({
    clientType: "openwebui",
    externalThreadId: `s08-${label}-${randomUUID()}`,
    principalId,
  });
  return thread.threadId;
}

async function executeWorldTurn(input) {
  const externalRequestId = `message-${randomUUID()}`;
  await input.conversation.ingestUserMessage({
    principalId: input.principalId,
    threadId: input.threadId,
    protocol: input.protocol,
    externalMessageId: externalRequestId,
    contentText: input.text,
  });
  const turn = {
    protocol: input.protocol,
    principalId: input.principalId,
    threadId: input.threadId,
    externalRequestId,
    userText: input.text,
    turnPlan: {
      schemaVersion: "0.4",
      turnRoute: "WORLD_ANSWER",
      groundingRequirement: "ANSWER_WORLD_QUERY",
      answerMode: "GROUNDED",
      worldFocusUsage: input.usage,
    },
  };
  return { text: await input.runtime.answerWorld(turn), turn };
}

function captureGroundingPosts(posts, httpExchanges) {
  return async (input, init) => {
    const inspectable =
      input instanceof Request ? input.clone() : new Request(input, init);
    const url = new URL(inspectable.url);
    const isCreate =
      inspectable.method === "POST" && url.pathname === "/v1/groundings";
    if (isCreate) {
      posts.push(await inspectable.json());
    }
    const response = await fetch(input, init);
    if (url.pathname.startsWith("/v1/groundings")) {
      let errorCode = null;
      let errorStage = null;
      let contractDiagnostic;
      const responseBody = await response
        .clone()
        .json()
        .catch(() => undefined);
      errorCode = responseBody?.error?.code ?? responseBody?.code ?? null;
      errorStage = responseBody?.error?.stage ?? responseBody?.stage ?? null;
      if (!isCreate) {
        const request = posts.at(-1);
        contractDiagnostic = boundedResultContractDiagnostic(
          responseBody,
          request,
        );
      }
      httpExchanges.push({
        route: isCreate
          ? "CREATE"
          : url.pathname.endsWith("/cancel")
            ? "CANCEL"
            : "GET",
        status: response.status,
        errorCode,
        errorStage,
        ...(contractDiagnostic === undefined ? {} : { contractDiagnostic }),
      });
    }
    return response;
  };
}

function boundedResultContractDiagnostic(job, request) {
  let issues = [];
  if (job?.result !== undefined) {
    try {
      parseWsgsGroundingResult(job.result);
    } catch (error) {
      issues = Array.isArray(error?.issues)
        ? error.issues.slice(0, 16).map((issue) => ({
            path: issue.path
              .map((segment) => (typeof segment === "number" ? "[]" : segment))
              .join("."),
            code: issue.code,
          }))
        : [{ path: "", code: "UNKNOWN_PARSE_FAILURE" }];
    }
  }
  return {
    jobStatus: typeof job?.status === "string" ? job.status : null,
    hasResult: job?.result !== undefined,
    jobKeys:
      job !== null && typeof job === "object"
        ? Object.keys(job).sort().slice(0, 32)
        : [],
    resultKeys:
      job.result !== null && typeof job.result === "object"
        ? Object.keys(job.result).sort().slice(0, 48)
        : [],
    issues,
    identityMatches:
      request === undefined
        ? null
        : {
            requestId: job.result?.requestId === request.requestId,
            sourceMessageId:
              job.result?.source?.messageId === request.source.messageId,
            originalTextSha256:
              job.result?.source?.originalTextSha256 ===
              request.source.originalTextSha256,
          },
  };
}

function assertKnownContext(request, expectedAlias) {
  assert.ok(request, "expected a captured real WSGS request");
  assert.ok(
    request.contextCapsule.knownWorldReferences.some(({ alias }) =>
      alias.includes(expectedAlias),
    ),
    `expected KnownWorldReference for ${expectedAlias}`,
  );
  assert.equal(
    request.contextCapsule.priorGroundings.length,
    0,
    "current-reference follow-up must not request PINNED prior grounding replay",
  );
}

function assertWorldSuccess(text) {
  assert.doesNotMatch(
    text,
    /^(WORLD_GROUNDING_(?:FAILED|CAPABILITY_UNAVAILABLE|CONTEXT_UNAVAILABLE|REFERENCE_VALIDATION_FAILED|CONTRACT_VIOLATION|IN_PROGRESS)|WSGS_)/u,
  );
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

function knownReferenceUsage() {
  return {
    ...emptyWorldFocus(),
    knownWorldReferences: true,
  };
}

function unavailableSdarLock() {
  return {
    profile: "sacs-sdar-operational-grounding/1.0",
    status: "UNAVAILABLE",
    dataPartMediaType: null,
    schemaSha256: null,
    handlerEvidence: null,
    validatorEvidence: null,
    realE2eEvidence: null,
    requiredRuntimeError: "SDAR_GROUNDING_EXTENSION_UNAVAILABLE",
    fallback: { dropDataPart: false, convertToText: false, modifySdar: false },
  };
}

function countOperations(posts) {
  return Object.fromEntries(
    [...new Set(posts.map(({ operation }) => operation))]
      .sort()
      .map((operation) => [
        operation,
        posts.filter((request) => request.operation === operation).length,
      ]),
  );
}

async function boundedLatestGroundingDiagnostic(pool, principalId, threadId) {
  const result = await pool.query(
    `
      SELECT state, failure_code, grounding_result_json
      FROM chat_service.grounding_execution
      WHERE principal_id = $1 AND thread_id = $2
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [principalId, threadId],
  );
  const row = result.rows[0];
  const grounding = row?.grounding_result_json;
  const products = Array.isArray(grounding?.referenceProducts)
    ? grounding.referenceProducts
    : [];
  return {
    executionState: row?.state ?? "MISSING",
    failureCode: row?.failure_code ?? null,
    resultStatus: grounding?.status ?? null,
    mentionCount: Array.isArray(grounding?.mentions)
      ? grounding.mentions.length
      : 0,
    referenceProductCount: products.length,
    productStates: products.map((product) => ({
      sourceOperation: product.sourceOperation ?? null,
      revalidationRequired: product.revalidationRequired ?? null,
      validUntilState:
        product.validUntil === undefined
          ? "ABSENT"
          : Date.parse(product.validUntil) > Date.now()
            ? "FUTURE"
            : "EXPIRED",
    })),
    ambiguityCount: Array.isArray(grounding?.ambiguities)
      ? grounding.ambiguities.length
      : 0,
    unresolvedMentionCount: Array.isArray(grounding?.unresolvedMentions)
      ? grounding.unresolvedMentions.length
      : 0,
    capabilityGapCount: Array.isArray(grounding?.capabilityGaps)
      ? grounding.capabilityGaps.length
      : 0,
  };
}

function hashJson(value) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function withDatabase(connection, database) {
  const url = new URL(connection);
  url.pathname = `/${database}`;
  return url.toString();
}

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function assertHttpStatus(url, expected, bearerToken) {
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${bearerToken}` },
    signal: AbortSignal.timeout(30_000),
  });
  assert.equal(response.status, expected, `${url.pathname} is not ready`);
}
