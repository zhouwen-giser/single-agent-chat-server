import { createHmac } from "node:crypto";
import process from "node:process";
import assert from "node:assert/strict";

import { AgentCapabilitiesSchema, EventSchemas, EventType } from "@ag-ui/core";
import { HttpAgent } from "@ag-ui/client";
import pg from "pg";

import { writeRealGateEvidence } from "./real-gate-evidence.mjs";

const baseUrl = process.env.P11_SACS_URL ?? "http://127.0.0.1:3000";
const serviceKey = requiredEnvironment("P11_AG_UI_SERVICE_KEY");
const jwtSecret = requiredEnvironment("P11_PRINCIPAL_JWT_SECRET");
const databaseUrl = requiredEnvironment("P11_DATABASE_URL");
const stamp = process.env.P11_RUN_STAMP ?? `p11-${Date.now()}`;
const subject = `official-client-${stamp}`;
const headers = {
  authorization: `Bearer ${serviceKey}`,
  "x-openwebui-user-jwt": signPrincipal(subject),
};
const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });

try {
  const capabilitiesResponse = await fetch(`${baseUrl}/ag-ui/capabilities`, {
    headers,
  });
  assert.equal(capabilitiesResponse.status, 200);
  const capabilities = AgentCapabilitiesSchema.parse(
    await capabilitiesResponse.json(),
  );
  assert.equal(capabilities.transport.streaming, true);
  assert.equal(capabilities.transport.resumable, false);
  assert.equal(capabilities.tools.supported, false);
  assert.equal(capabilities.multiAgent.supported, false);
  assert.equal(capabilities.custom.rawEvents, false);

  const interactionThread = `${stamp}-interrupt`;
  const initial = await officialRun({
    threadId: interactionThread,
    runId: `${stamp}-interrupt-create`,
    message: "Execute P11 official AG-UI client task",
  });
  assertOfficialProfile(initial.events);
  assertTypes(initial.events, [
    EventType.RUN_STARTED,
    EventType.STATE_SNAPSHOT,
    EventType.ACTIVITY_SNAPSHOT,
    EventType.CUSTOM,
    EventType.TEXT_MESSAGE_START,
    EventType.TEXT_MESSAGE_CONTENT,
    EventType.TEXT_MESSAGE_END,
    EventType.RUN_FINISHED,
  ]);
  const interrupt = requiredInterrupt(initial.events);
  assert.equal(interrupt.reason, "sdar.plan_confirmation");
  assert.deepEqual(interrupt.metadata.allowedActions, [
    "confirm_plan",
    "reject_plan",
    "revise_plan",
    "patch_goal",
  ]);
  const initialTask = requiredTaskIdentity(initial.events);

  const resumed = await officialRun({
    threadId: interactionThread,
    runId: `${stamp}-interrupt-resume`,
    resume: [
      {
        interruptId: interrupt.id,
        status: "resolved",
        payload: { action: "confirm_plan" },
      },
    ],
  });
  assertOfficialProfile(resumed.events);
  assertNoRunError(resumed.events);
  assertTypes(resumed.events, [EventType.RUN_STARTED, EventType.RUN_FINISHED]);

  let terminalState;
  let statusRuns = 0;
  for (; statusRuns < 30; statusRuns += 1) {
    const status = await officialRun({
      threadId: interactionThread,
      runId: `${stamp}-status-${statusRuns}`,
      message: "status",
    });
    assertOfficialProfile(status.events);
    assertNoRunError(status.events);
    const identity = optionalTaskIdentity(status.events);
    if (identity !== undefined)
      assert.equal(identity.taskId, initialTask.taskId);
    terminalState =
      latestTaskState(status.events) ?? publishedTaskState(status.events);
    if (
      ["COMPLETED", "FAILED", "CANCELED", "REJECTED"].includes(terminalState)
    ) {
      break;
    }
    await delay(250);
  }
  assert.equal(terminalState, "COMPLETED");

  const idempotencyThread = `${stamp}-idempotency`;
  const idempotencyRunId = `${stamp}-idempotency-run`;
  const idempotencyMessage = "Execute P11 idempotency task";
  const first = await officialRun({
    threadId: idempotencyThread,
    runId: idempotencyRunId,
    message: idempotencyMessage,
  });
  const firstIdentity = requiredTaskIdentity(first.events);
  const replay = await officialRun({
    threadId: idempotencyThread,
    runId: idempotencyRunId,
    message: idempotencyMessage,
  });
  assertOfficialProfile(replay.events);
  assert.equal(
    requiredTaskIdentity(replay.events).taskId,
    firstIdentity.taskId,
  );
  const conflict = await officialRun({
    threadId: idempotencyThread,
    runId: idempotencyRunId,
    message: "Execute a changed P11 idempotency task",
  });
  const conflictError = conflict.events.find(
    (event) => event.type === EventType.RUN_ERROR,
  );
  assert.equal(conflictError?.code, "run_id_conflict");
  assert.equal(await taskBindingCount(idempotencyThread), 1);

  const reconnectThread = `${stamp}-reconnect`;
  const reconnectRunId = `${stamp}-reconnect-run`;
  const reconnectMessage = "Execute P11 abort and reconnect task";
  const abortingAgent = createAgent(reconnectThread, reconnectMessage);
  const abortedEvents = [];
  let abortedTask;
  await abortingAgent
    .runAgent(
      { runId: reconnectRunId },
      {
        onEvent({ event }) {
          abortedEvents.push(event);
          if (
            abortedTask === undefined &&
            event.type === EventType.CUSTOM &&
            event.name === "sdar.task.bound"
          ) {
            abortedTask = event.value;
            abortingAgent.abortRun();
          }
        },
      },
    )
    .catch((error) => {
      if (error?.name !== "AbortError") throw error;
    });
  assert.ok(abortedTask?.taskId);
  const reconnected = await officialRun({
    threadId: reconnectThread,
    runId: reconnectRunId,
    message: reconnectMessage,
  });
  assertOfficialProfile(reconnected.events);
  assertNoRunError(reconnected.events);
  assert.equal(
    requiredTaskIdentity(reconnected.events).taskId,
    abortedTask.taskId,
  );
  assert.notEqual(latestTaskState(reconnected.events), "CANCELED");
  assert.equal(await taskBindingCount(reconnectThread), 1);

  const interruptRow = await pool.query(
    `SELECT status, task_id FROM chat_service.agui_interrupt_binding
     WHERE interrupt_id = $1`,
    [interrupt.id],
  );
  assert.deepEqual(interruptRow.rows, [
    { status: "RESOLVED", task_id: initialTask.taskId },
  ]);

  const result = {
    status: "PASSED",
    officialClient: "@ag-ui/client@0.0.57",
    capabilitiesSchema: "AgentCapabilitiesSchema@0.0.57",
    runEventSchema: "EventSchemas@0.0.57",
    taskId: initialTask.taskId,
    terminalState,
    statusRuns: statusRuns + 1,
    eventTypes: [...new Set(initial.events.map((event) => event.type))],
    interruptReason: interrupt.reason,
    resume: "PASSED",
    runIdempotency: "PASSED",
    abortReconnect: "PASSED",
    rawEvents: false,
    toolCalls: false,
  };
  await writeRealGateEvidence(
    "P11_OFFICIAL_AGUI_EVIDENCE_FILE",
    "official-ag-ui",
    result,
  );
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally {
  await pool.end();
}

async function officialRun({ threadId, runId, message, resume }) {
  const events = [];
  const agent = createAgent(threadId, message);
  const result = await agent.runAgent(
    {
      runId,
      ...(resume === undefined ? {} : { resume }),
    },
    {
      onEvent({ event }) {
        events.push(event);
      },
    },
  );
  return { events, result };
}

function createAgent(threadId, message) {
  return new HttpAgent({
    url: `${baseUrl}/ag-ui`,
    headers,
    threadId,
    initialMessages:
      message === undefined
        ? []
        : [
            {
              id: `${threadId}:${Buffer.from(message).toString("base64url")}`,
              role: "user",
              content: message,
            },
          ],
  });
}

function assertOfficialProfile(events) {
  assert.ok(events.length > 0);
  for (const event of events) EventSchemas.parse(event);
  assert.equal(
    events.some((event) => event.type === EventType.RAW),
    false,
  );
  assert.equal(
    events.some((event) => String(event.type).startsWith("TOOL_CALL")),
    false,
  );
}

function assertTypes(events, required) {
  const types = new Set(events.map((event) => event.type));
  for (const type of required) assert.ok(types.has(type), `missing ${type}`);
}

function assertNoRunError(events) {
  assert.equal(
    events.some((event) => event.type === EventType.RUN_ERROR),
    false,
  );
}

function requiredInterrupt(events) {
  const finished = events.find(
    (event) =>
      event.type === EventType.RUN_FINISHED &&
      event.outcome?.type === "interrupt",
  );
  const interrupt = finished?.outcome?.interrupts?.[0];
  assert.ok(interrupt?.id);
  return interrupt;
}

function requiredTaskIdentity(events) {
  const identity = optionalTaskIdentity(events);
  assert.ok(identity?.taskId);
  assert.ok(identity?.contextId);
  return identity;
}

function optionalTaskIdentity(events) {
  const bound = events.find(
    (event) =>
      event.type === EventType.CUSTOM && event.name === "sdar.task.bound",
  );
  return bound?.value;
}

function publishedTaskState(events) {
  for (const event of [...events].reverse()) {
    if (event.type !== EventType.TEXT_MESSAGE_CONTENT) continue;
    const match = /\bis (COMPLETED|FAILED|CANCELED|REJECTED)\b/u.exec(
      event.delta ?? "",
    );
    if (match !== null) return match[1];
  }
  return undefined;
}

function latestTaskState(events) {
  let state;
  for (const event of events) {
    if (event.type === EventType.STATE_SNAPSHOT) {
      state = event.snapshot?.task?.state ?? state;
    }
    if (event.type === EventType.STATE_DELTA) {
      for (const operation of event.delta ?? []) {
        if (
          operation.path === "/task" &&
          operation.value?.state !== undefined
        ) {
          state = operation.value.state;
        }
      }
    }
  }
  return state;
}

async function taskBindingCount(externalThreadId) {
  const result = await pool.query(
    `SELECT count(*)::int AS count
       FROM chat_service.conversation_task_binding task
       JOIN chat_service.client_thread_binding thread
         ON thread.internal_thread_id = task.conversation_thread_id
       JOIN chat_service.principal principal
         ON principal.principal_id = thread.principal_id
      WHERE thread.client_type = 'ag_ui'
        AND thread.external_thread_id = $1
        AND principal.issuer = 'openwebui-jwt'
        AND principal.subject = $2`,
    [externalThreadId, subject],
  );
  return result.rows[0]?.count;
}

function signPrincipal(principalSubject) {
  const now = Math.floor(Date.now() / 1_000);
  const encode = (value) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({
    iss: "open-webui",
    sub: principalSubject,
    role: "user",
    iat: now,
    exp: now + 600,
  })}`;
  const signature = createHmac("sha256", jwtSecret)
    .update(unsigned)
    .digest("base64url");
  return `${unsigned}.${signature}`;
}

function requiredEnvironment(name) {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required for the real P11 E2E`);
  }
  return value;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
