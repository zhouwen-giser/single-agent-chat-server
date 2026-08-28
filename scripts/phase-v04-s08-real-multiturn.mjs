import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";

import pg from "pg";

import {
  ConversationPersistenceRepository,
  GroundingPersistenceRepository,
  InteractionPersistenceRepository,
  PostgresWorldFocusRepository,
  runMigrations,
} from "../dist/packages/persistence/src/index.js";
import { createWsgsHttpClient } from "../dist/packages/wsgs-http-adapter/src/index.js";
import { WorldGroundingRuntime } from "../dist/packages/world-grounding-runtime/src/index.js";

const { Pool } = pg;
const expectedWsgsCommit = "3f9aa7cb8542573d2658a132644a9c649544737b";

if (process.env.ALLOW_REAL_WSGS_MULTITURN !== "YES") {
  throw new Error("ALLOW_REAL_WSGS_MULTITURN=YES is required");
}

const adminConnection = requiredEnvironment("TEST_DATABASE_URL");
const wsgsBaseUrl = new URL(requiredEnvironment("WSGS_BASE_URL"));
const wsgsSourceDir = requiredEnvironment("WSGS_SOURCE_DIR");
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

await assertHttpStatus(new URL("health/live", wsgsBaseUrl), 200);
await assertHttpStatus(new URL("health/ready", wsgsBaseUrl), 200);

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
  const realFetch = captureGroundingPosts(posts);
  const wsgs = createWsgsHttpClient({
    baseUrl: wsgsBaseUrl.href,
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
  assertWorldSuccess(vehicleFirst.text);
  const vehicleFocus = await repositories.worldFocus.getFocus({
    principalId: principal.principalId,
    threadId: vehicleThread,
  });
  assert.ok(
    vehicleFocus.references.some(({ displayName }) =>
      displayName.includes("2号车"),
    ),
  );

  const beforeVehicleFollowUp = posts.length;
  const vehicleFollowUp = await executeWorldTurn({
    runtime,
    conversation: repositories.conversation,
    principalId: principal.principalId,
    threadId: vehicleThread,
    protocol: "ag_ui",
    text: "它现在呢？",
    usage: focusUsage(),
  });
  assertWorldSuccess(vehicleFollowUp.text);
  assertKnownContext(posts.at(-1), "2号车");
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
    text: "A区内有哪些车辆？",
    usage: emptyWorldFocus(),
  });
  assertWorldSuccess(areaFirst.text);
  const areaFollowUp = await executeWorldTurn({
    runtime,
    conversation: repositories.conversation,
    principalId: principal.principalId,
    threadId: areaThread,
    protocol: "ag_ui",
    text: "那里附近还有什么？",
    usage: focusUsage(),
  });
  assertWorldSuccess(areaFollowUp.text);
  assertKnownContext(posts.at(-1), "A区");

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
    usage: focusUsage(),
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
    usage: focusUsage(),
  });
  assertWorldSuccess(restartFollowUp.text);
  assertKnownContext(posts.at(-1), "2号车");

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
  });
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

function captureGroundingPosts(posts) {
  return async (input, init) => {
    const inspectable =
      input instanceof Request ? input.clone() : new Request(input, init);
    const url = new URL(inspectable.url);
    if (inspectable.method === "POST" && url.pathname === "/v1/groundings") {
      posts.push(await inspectable.json());
    }
    return fetch(input, init);
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
  assert.ok(request.contextCapsule.priorGroundings.length > 0);
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

function focusUsage() {
  return {
    ...emptyWorldFocus(),
    knownWorldReferences: true,
    priorGrounding: true,
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

async function assertHttpStatus(url, expected) {
  const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
  assert.equal(response.status, expected, `${url.pathname} is not ready`);
}
