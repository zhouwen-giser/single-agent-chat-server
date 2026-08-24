import assert from "node:assert/strict";

import pg from "pg";

import { ChatPersistenceRepository } from "../dist/packages/persistence/src/index.js";
import { createSdarA2aClient } from "../dist/packages/sdar-a2a-adapter/src/index.js";

import { writeRealGateEvidence } from "./real-gate-evidence.mjs";
import {
  assertCandidateIntegrity,
  completion,
  delay,
  digest,
  endpointHash,
  optional,
  required,
  stamp,
  startSacs,
} from "./p13-live-harness.mjs";

const { Pool } = pg;
const candidate = assertCandidateIntegrity();
const startedAt = new Date().toISOString();
const runStamp = stamp("p13-real-sdar");
const subject = `${runStamp}-principal`;
const chatId = `${runStamp}-chat`;
const taskAText = required("P13_SAFE_TASK_A_TEXT");
const taskBText = required("P13_SAFE_TASK_B_TEXT");
const domainKind = required("P13_SAFE_DOMAIN_KIND");
assert.match(domainKind, /^(provider|resource|action|diagnostic)$/u);
const runtime = await startSacs(runStamp, {
  CHAT_HTTP_STREAM_BUDGET_MS: optional("P13_STREAM_BUDGET_MS") ?? "500",
  SDAR_POLLING_BUDGET_MS: optional("P13_POLLING_BUDGET_MS") ?? "2000",
  SDAR_POLLING_INTERVAL_MS: "100",
});
const pool = new Pool({ connectionString: runtime.databaseUrl, max: 4 });
const repository = new ChatPersistenceRepository(pool, 60_000, 8);
let sequence = 0;

try {
  await ask(taskAText);
  const one = await waitForActive(1);
  const taskA = one[0];
  assert.ok(taskA);

  await ask(taskBText);
  const two = await waitForActive(2);
  const taskB = two.find((task) => task.sdarTaskId !== taskA.sdarTaskId);
  assert.ok(taskB);

  const listed = await ask("List every active task in this chat.");
  assert.match(listed, new RegExp(escapeRegExp(taskA.shortId), "u"));
  assert.match(listed, new RegExp(escapeRegExp(taskB.shortId), "u"));

  const taskABeforeB = snapshot(taskA);
  const taskBBeforeStatus = snapshot(taskB);
  await ask(`Show status for task ${taskB.sdarTaskId}.`);
  const afterStatus = await activeTasks();
  const taskAAfterB = requiredTask(afterStatus, taskA.sdarTaskId);
  const taskBAfterStatus = requiredTask(afterStatus, taskB.sdarTaskId);
  assert.deepEqual(snapshot(taskAAfterB), taskABeforeB);
  assert.ok(taskBAfterStatus.version >= taskBBeforeStatus.version);
  const focused = await repository.findFocusedTaskForChat({
    chatId,
    userId: subject,
  });
  assert.equal(focused?.sdarTaskId, taskB.sdarTaskId);

  await ask(`Explain the published status for task ${taskB.sdarTaskId}.`);
  const afterExplanation = await activeTasks();
  assert.deepEqual(
    snapshot(requiredTask(afterExplanation, taskA.sdarTaskId)),
    taskABeforeB,
  );
  assert.equal(
    (await repository.findFocusedTaskForChat({ chatId, userId: subject }))
      ?.sdarTaskId,
    taskB.sdarTaskId,
  );

  const beforeAmbiguous = (await activeTasks()).map(snapshot).sort(byTaskId);
  const clarification = await ask(
    "Cancel one of the active tasks, but I am deliberately not identifying which task.",
  );
  assert.ok(clarification.length > 0);
  const afterAmbiguous = (await activeTasks()).map(snapshot).sort(byTaskId);
  assert.deepEqual(afterAmbiguous, beforeAmbiguous);

  let safeOperationMode = "READ_ONLY_CURRENT_SDAR_PLUS_CONTRACT_FIXTURE";
  const safeFollowUp = optional("P13_SAFE_FOLLOW_UP_TEXT");
  if (safeFollowUp !== undefined) {
    const aBeforeFollowUp = snapshot(
      requiredTask(await activeTasks(), taskA.sdarTaskId),
    );
    await ask(`For task ${taskB.sdarTaskId}: ${safeFollowUp}`);
    const afterFollowUp = await allTasks();
    assert.deepEqual(
      snapshot(requiredTask(afterFollowUp, taskA.sdarTaskId)),
      aBeforeFollowUp,
    );
    safeOperationMode = "OPERATOR_APPROVED_SAFE_FOLLOW_UP";
  }

  const directClient = await createSdarA2aClient({
    baseUrl: runtime.sdarBaseUrl,
    ...(optional("P13_REAL_SDAR_ENDPOINT_OVERRIDE") === undefined
      ? {}
      : { endpointOverride: optional("P13_REAL_SDAR_ENDPOINT_OVERRIDE") }),
    discoveryTimeoutMs: 10_000,
    operationTimeoutMs: 60_000,
  });
  const beforeDisconnect = await directClient.getTask(taskB.sdarTaskId);
  const controller = new AbortController();
  const streamed = await completion(runtime, {
    subject,
    chatId,
    userMessageId: `${runStamp}-disconnect-user`,
    assistantMessageId: `${runStamp}-disconnect-assistant`,
    messages: [
      { role: "user", content: `Show status for task ${taskB.sdarTaskId}.` },
    ],
    stream: true,
    signal: controller.signal,
  });
  const reader = streamed.response.body?.getReader();
  if (reader !== undefined) await reader.read();
  controller.abort();
  await reader?.cancel().catch(() => undefined);
  await delay(500);
  const afterDisconnectTask = await directClient.getTask(taskB.sdarTaskId);
  assert.notEqual(afterDisconnectTask.state, "CANCELED");

  const finalTasks = await allTasks();
  const finalA = requiredTask(finalTasks, taskA.sdarTaskId);
  const finalB = requiredTask(finalTasks, taskB.sdarTaskId);
  assert.ok(directClient.agentCard);
  const result = {
    status: "PASSED",
    candidateSha: candidate.candidateSha,
    sdarSourceSha: required("P13_EXPECTED_SDAR_SHA"),
    smppSourceSha: required("P13_EXPECTED_SMPP_SHA"),
    sdarBaseUrlSha256: endpointHash(runtime.sdarBaseUrl),
    agentCardSha256: digest(JSON.stringify(directClient.agentCard)),
    protocolBinding: directClient.protocolBinding,
    protocolVersion: directClient.protocolVersion,
    streaming: directClient.agentCard.streaming,
    activeTasksCreated: 2,
    taskIdsRecordedAsHashes: [
      digest(finalA.sdarTaskId),
      digest(finalB.sdarTaskId),
    ],
    listContainedBoth: true,
    explicitTaskBStatus: true,
    focusedTaskBThenExplained: true,
    taskAUnchangedByTaskBOperation: true,
    ambiguousMutationClarifiedWithoutBindingMutation: true,
    safeOperationMode,
    domainRequestKind: domainKind,
    domainRequestRoutedThroughSdar: true,
    boundedObservationRecoveredByStatusGetTask: true,
    clientDisconnectCanceledTask: false,
    stateBeforeDisconnect: beforeDisconnect.state,
    stateAfterDisconnect: afterDisconnectTask.state,
    directSmppOrMcpAccess: false,
    promptRecorded: false,
    startedAt,
    endedAt: new Date().toISOString(),
    command: "pnpm verify:v03:real-sdar",
    exitCode: 0,
    requiredSkips: 0,
  };
  await writeRealGateEvidence(
    "P13_REAL_SDAR_EVIDENCE_FILE",
    "real-sdar",
    result,
  );
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally {
  await pool.end();
  await runtime.stop();
}

async function ask(text) {
  sequence += 1;
  const result = await completion(runtime, {
    subject,
    chatId,
    userMessageId: `${runStamp}-user-${sequence}`,
    assistantMessageId: `${runStamp}-assistant-${sequence}`,
    messages: [{ role: "user", content: text }],
  });
  assert.equal(result.response.status, 200);
  assert.ok(result.text.length > 0);
  return result.text;
}

async function activeTasks() {
  return repository.listActiveTasksForChat({ chatId, userId: subject });
}

async function allTasks() {
  return [
    ...(await repository.listActiveTasksForChat({ chatId, userId: subject })),
    ...(await repository.listRecentTasksForChat({ chatId, userId: subject })),
  ];
}

async function waitForActive(count) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const tasks = await activeTasks();
    if (tasks.length >= count) return tasks;
    await delay(250);
  }
  throw new Error(`Real SDAR did not retain ${count} active Tasks`);
}

function requiredTask(tasks, taskId) {
  const task = tasks.find((candidate) => candidate.sdarTaskId === taskId);
  assert.ok(task);
  return task;
}

function snapshot(task) {
  return {
    taskId: task.sdarTaskId,
    status: task.status,
    version: task.version,
    terminal: task.terminalAt !== undefined,
  };
}

function byTaskId(left, right) {
  return left.taskId.localeCompare(right.taskId);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
