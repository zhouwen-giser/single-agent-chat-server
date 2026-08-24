import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import pg from "pg";

import {
  ConversationPersistenceRepository,
  InteractionPersistenceRepository,
  runMigrations,
} from "../dist/packages/persistence/src/index.js";

import { writeRealGateEvidence } from "./real-gate-evidence.mjs";
import {
  assertCandidateIntegrity,
  digest,
  optional,
  required,
  stamp,
  startSacs,
} from "./p13-live-harness.mjs";

const { Pool } = pg;
const startedAt = new Date().toISOString();
const candidate = assertCandidateIntegrity();
const databaseUrl =
  optional("P13_DATABASE_URL") ?? required("TEST_DATABASE_URL");
const database = new URL(databaseUrl).pathname.slice(1);
assert.equal(
  database,
  "single_agent_chat_phase4",
  "P13 destructive migration gate is restricted to its isolated test database",
);
const container = required("P13_POSTGRES_CONTAINER");
assert.match(container, /^sacs-v03-[a-z0-9-]+$/u);

const runStamp = stamp("p13-migration");
const principalId = `${runStamp}-principal`;
const threadId = `${runStamp}-thread`;
const chatId = `${runStamp}-chat`;
const legacyTaskId = `${runStamp}-legacy-task`;
const legacyContextId = `${runStamp}-legacy-context`;
const currentTaskId = `${runStamp}-current-task`;
const currentContextId = `${runStamp}-current-context`;
const legacyRequestId = `${runStamp}-legacy-request`;
const messageRequestExternalId = `${runStamp}-message-request`;
const messageRequestHash = digest(`${runStamp}:message-request`);
const messageId = `${runStamp}-message`;
const runId = `${runStamp}-run`;
const migrationDirectory = await mkdtemp(join(tmpdir(), "sacs-p13-v02-"));
let pool;
let sacsBeforeRestart;
let sacsAfterRestart;

try {
  const migrationFiles = await readdir("migrations");
  for (let version = 1; version <= 6; version += 1) {
    const prefix = String(version).padStart(4, "0");
    const matches = migrationFiles.filter((file) =>
      file.startsWith(`${prefix}_`),
    );
    assert.equal(matches.length, 1, `Migration ${prefix} must be unique`);
    const source = `migrations/${matches[0]}`;
    await cp(source, join(migrationDirectory, source.split("/").at(-1)));
  }

  pool = new Pool({ connectionString: databaseUrl, max: 4 });
  await pool.query("DROP SCHEMA IF EXISTS chat_service CASCADE");
  await pool.query("DROP SCHEMA IF EXISTS langgraph_checkpoint CASCADE");
  const v02Migrations = await runMigrations(pool, migrationDirectory);
  assert.equal(v02Migrations.length, 6);
  await seedV02(pool);

  const allMigrations = await runMigrations(pool);
  assert.equal(allMigrations.length, 9);
  const interactions = new InteractionPersistenceRepository(pool, 60_000, 8);
  const conversations = new ConversationPersistenceRepository(pool);

  const legacyReplayBeforeRestart = await interactions.claimRequest({
    protocol: "openai",
    externalRequestId: legacyRequestId,
    principalId,
    threadId,
    requestHash: digest(`${runStamp}:legacy-request`),
    leaseOwner: `${runStamp}-legacy-replay`,
  });
  assert.deepEqual(legacyReplayBeforeRestart, {
    outcome: "replay",
    result: {
      kind: "task",
      taskId: legacyTaskId,
      contextId: legacyContextId,
    },
  });

  const secondTask = await interactions.createTaskBinding({
    principalId,
    threadId,
    sdarTaskId: currentTaskId,
    sdarContextId: currentContextId,
    status: "WORKING",
  });
  await conversations.ingestUserMessage({
    principalId,
    threadId,
    protocol: "openai",
    externalMessageId: `${runStamp}-user-message`,
    contentText: "Remember the migration marker.",
    taskId: currentTaskId,
  });
  const assistant = await conversations.appendAssistantMessage({
    principalId,
    threadId,
    protocol: "ag_ui",
    externalMessageId: `${runStamp}-assistant-message`,
    contentText: "The migration marker is durable.",
    taskId: currentTaskId,
  });
  await conversations.saveSummary({
    principalId,
    threadId,
    summary: "A v0.2 thread was upgraded and retained its task.",
    summarizedThroughSequence: assistant.message.sequence,
    expectedVersion: 0,
  });

  const messageClaim = await interactions.claimRequest({
    protocol: "ag_ui",
    externalRequestId: messageRequestExternalId,
    principalId,
    threadId,
    requestHash: messageRequestHash,
    leaseOwner: `${runStamp}-message-owner`,
  });
  assert.equal(messageClaim.outcome, "acquired");
  if (messageClaim.outcome !== "acquired") throw new Error("unreachable");
  await interactions.completeRequest({
    requestId: messageClaim.requestId,
    principalId,
    leaseOwner: `${runStamp}-message-owner`,
    result: {
      kind: "message",
      messageId,
      relatedTaskId: currentTaskId,
      contextId: currentContextId,
      message: {
        messageId,
        taskId: currentTaskId,
        contextId: currentContextId,
        role: "AGENT",
        parts: [
          { kind: "text", mediaType: "text/plain", text: "durable result" },
        ],
      },
      renderedText: "durable result",
    },
  });
  await interactions.startRun({
    runId,
    protocol: "ag_ui",
    principalId,
    threadId,
    externalRequestId: `${runStamp}-run-request`,
  });
  await interactions.finishRun({
    runId,
    principalId,
    status: "FINISHED",
    lastSequence: 4,
    outcome: { durable: true },
    taskId: currentTaskId,
    contextId: currentContextId,
  });

  sacsBeforeRestart = await startSacs(`${runStamp}-before-restart`);
  await sacsBeforeRestart.stop();
  sacsBeforeRestart = undefined;

  await pool.end();
  pool = undefined;
  restartContainer(container);
  await waitForPostgres(databaseUrl);
  sacsAfterRestart = await startSacs(`${runStamp}-after-restart`);

  pool = new Pool({ connectionString: databaseUrl, max: 4 });
  const recoveredInteractions = new InteractionPersistenceRepository(
    pool,
    60_000,
    8,
  );
  const recoveredConversations = new ConversationPersistenceRepository(pool);
  const reconciliation = await recoveredInteractions.reconcileStartup({
    leaseOwner: `${runStamp}-restart-owner`,
  });
  const active = await recoveredInteractions.listActiveTasksForChat({
    principalId,
    threadId,
  });
  assert.deepEqual(
    new Set(active.map((task) => task.sdarTaskId)),
    new Set([legacyTaskId, currentTaskId]),
  );
  assert.ok(
    reconciliation.activeBindings.some(
      (task) => task.sdarTaskId === legacyTaskId,
    ),
  );
  const focus = await recoveredInteractions.findFocusedTaskForChat({
    principalId,
    threadId,
  });
  assert.equal(focus?.bindingId, secondTask.bindingId);
  const messages = await recoveredConversations.loadRecentMessages({
    principalId,
    threadId,
  });
  assert.equal(messages.length, 2);
  assert.deepEqual(
    messages.map((message) => message.role),
    ["user", "assistant"],
  );
  const summary = await recoveredConversations.loadSummary({
    principalId,
    threadId,
  });
  assert.equal(summary?.version, 1);

  const legacyReplay = await recoveredInteractions.claimRequest({
    protocol: "openai",
    externalRequestId: legacyRequestId,
    principalId,
    threadId,
    requestHash: digest(`${runStamp}:legacy-request`),
    leaseOwner: `${runStamp}-legacy-replay-after-restart`,
  });
  assert.equal(legacyReplay.outcome, "replay");
  assert.equal(
    legacyReplay.outcome === "replay" ? legacyReplay.result.kind : undefined,
    "task",
  );
  const messageReplay = await recoveredInteractions.claimRequest({
    protocol: "ag_ui",
    externalRequestId: messageRequestExternalId,
    principalId,
    threadId,
    requestHash: messageRequestHash,
    leaseOwner: `${runStamp}-message-replay-after-restart`,
  });
  assert.equal(messageReplay.outcome, "replay");
  assert.deepEqual(
    messageReplay.outcome === "replay" ? messageReplay.result : undefined,
    {
      kind: "message",
      messageId,
      relatedTaskId: currentTaskId,
      contextId: currentContextId,
      message: {
        messageId,
        taskId: currentTaskId,
        contextId: currentContextId,
        role: "AGENT",
        parts: [
          { kind: "text", mediaType: "text/plain", text: "durable result" },
        ],
      },
      renderedText: "durable result",
    },
  );
  const persistedRun = await pool.query(
    "SELECT status, last_sequence, task_id, context_id, outcome_json FROM chat_service.interaction_run WHERE run_id = $1",
    [runId],
  );
  assert.deepEqual(persistedRun.rows[0], {
    status: "FINISHED",
    last_sequence: "4",
    task_id: currentTaskId,
    context_id: currentContextId,
    outcome_json: { durable: true },
  });
  const postgresVersion = await pool.query("SHOW server_version");

  const result = {
    status: "PASSED",
    candidateSha: candidate.candidateSha,
    databaseName: database,
    postgresContainer: container,
    upgradePath: "v0.2-migrations-0001-through-0006-to-v0.3-0007-through-0009",
    schemaVersions: allMigrations.map((migration) => migration.version),
    restartPerformed: true,
    sacsRestartPerformed: true,
    contextRecovered: true,
    taskDirectoryRecovered: true,
    focusedTaskRecovered: true,
    activeTaskCount: active.length,
    legacyTaskResultRecovered: true,
    messageResultReplayRecovered: true,
    durableRunRecovered: true,
    postgresVersion: postgresVersion.rows[0].server_version,
    startedAt,
    endedAt: new Date().toISOString(),
    command: "pnpm verify:v03:migration-restart",
    exitCode: 0,
    requiredSkips: 0,
    identifiersRecordedAsHashes: [
      digest(legacyTaskId),
      digest(currentTaskId),
      digest(threadId),
    ],
  };
  await writeRealGateEvidence(
    "P13_MIGRATION_EVIDENCE_FILE",
    "migration-restart",
    result,
  );
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally {
  if (sacsBeforeRestart !== undefined)
    await sacsBeforeRestart.stop().catch(() => undefined);
  if (sacsAfterRestart !== undefined)
    await sacsAfterRestart.stop().catch(() => undefined);
  if (pool !== undefined) await pool.end().catch(() => undefined);
  await rm(migrationDirectory, { recursive: true, force: true });
}

async function seedV02(databasePool) {
  await databasePool.query(
    `INSERT INTO chat_service.principal(principal_id, issuer, subject, role)
     VALUES ($1, 'open-webui', $1, 'user')`,
    [principalId],
  );
  await databasePool.query(
    `INSERT INTO chat_service.chat_thread_binding(
       thread_id, openwebui_chat_id, user_id, user_role
     ) VALUES ($1, $2, $3, 'user')`,
    [threadId, chatId, principalId],
  );
  await databasePool.query(
    `INSERT INTO chat_service.conversation_thread(thread_id, principal_id)
     VALUES ($1, $2)`,
    [threadId, principalId],
  );
  await databasePool.query(
    `INSERT INTO chat_service.client_thread_binding(
       binding_id, client_type, external_thread_id, principal_id,
       internal_thread_id
     ) VALUES ($1, 'openwebui', $2, $3, $4)`,
    [`${runStamp}-client-binding`, chatId, principalId, threadId],
  );
  await databasePool.query(
    `INSERT INTO chat_service.conversation_task_binding(
       binding_id, thread_id, conversation_thread_id, sdar_task_id,
       sdar_context_id, status, version
     ) VALUES ($1, $2, $2, $3, $4, 'WORKING', 2)`,
    [`${runStamp}-legacy-binding`, threadId, legacyTaskId, legacyContextId],
  );
  await databasePool.query(
    `INSERT INTO chat_service.interaction_request(
       request_id, protocol, external_request_id, principal_id, thread_id,
       request_hash, status, result_task_id
     ) VALUES ($1, 'openai', $2, $3, $4, $5, 'COMPLETED', $6)`,
    [
      `${runStamp}-legacy-request-row`,
      legacyRequestId,
      principalId,
      threadId,
      digest(`${runStamp}:legacy-request`),
      legacyTaskId,
    ],
  );
}

function restartContainer(name) {
  const result = spawnSync("docker", ["restart", name], {
    cwd: process.cwd(),
    encoding: "utf8",
    shell: false,
  });
  if (result.status !== 0 || result.stdout.trim() !== name) {
    throw new Error("Unable to restart the isolated P13 PostgreSQL container");
  }
}

async function waitForPostgres(connectionString) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const candidatePool = new Pool({ connectionString, max: 1 });
    try {
      await candidatePool.query("SELECT 1");
      await candidatePool.end();
      return;
    } catch {
      await candidatePool.end().catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error("PostgreSQL did not recover after the P13 restart");
}
